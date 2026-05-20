from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Any

from packages.connectors.jira_config import JiraRuntimeConfig, load_env_files
from services.api.integrations.jira_sync import _ensure_schema, _resolve_db_path
from services.api.issues.current_sprint import get_current_sprint
from services.api.issues.current_sprint_work import get_current_sprint_work


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if value is None:
        return None
    candidate = value.strip()
    if not candidate:
        return None
    if candidate.endswith("Z"):
        candidate = f"{candidate[:-1]}+00:00"
    try:
        return datetime.fromisoformat(candidate)
    except ValueError:
        return None


def _normalize_sprint_values(value: str | None) -> set[str]:
    if value is None:
        return set()
    return {segment.strip().lower() for segment in value.split(",") if segment and segment.strip()}


def _status_contains_blocked(status_value: str | None) -> bool:
    if status_value is None:
        return False
    return "blocked" in status_value.strip().lower()


def _coerce_story_points(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        candidate = value.strip()
        if not candidate:
            return None
        try:
            return float(candidate)
        except ValueError:
            return None
    return None


def _round_story_points(value: float) -> float:
    return round(value, 2)


def _resolve_jira_base_url() -> str | None:
    try:
        load_env_files()
        runtime = JiraRuntimeConfig.from_env()
        return runtime.base_url.rstrip("/")
    except Exception:  # noqa: BLE001
        return None


def _build_issue_cards(
    issue_keys: set[str],
    summary_by_issue_key: dict[str, str],
    story_points_by_issue_key: dict[str, float],
    epic_by_issue_key: dict[str, dict[str, str | None]],
    status_by_issue_key: dict[str, dict[str, str | None]],
    jira_base_url: str | None,
    override_by_issue_key: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    for issue_key in sorted(issue_keys):
        override = (override_by_issue_key or {}).get(issue_key, {})
        summary = override.get("summary") or summary_by_issue_key.get(issue_key) or "-"
        story_points_override = _coerce_story_points(override.get("storyPoints"))
        story_points = (
            story_points_override
            if story_points_override is not None
            else story_points_by_issue_key.get(issue_key)
        )

        epic_context = epic_by_issue_key.get(issue_key, {})
        epic_key = epic_context.get("epicKey")
        epic_name = override.get("epicName") or epic_context.get("epicName")
        status_context = status_by_issue_key.get(issue_key, {})
        status_override = override.get("status")
        status = (
            status_override.strip()
            if isinstance(status_override, str) and status_override.strip()
            else status_context.get("status")
        )
        status_category_override = override.get("statusCategory")
        status_category = (
            status_category_override.strip()
            if isinstance(status_category_override, str) and status_category_override.strip()
            else status_context.get("statusCategory")
        )
        issue_url = override.get("issueUrl") or (f"{jira_base_url}/browse/{issue_key}" if jira_base_url else None)
        epic_url = override.get("epicUrl") or (
            f"{jira_base_url}/browse/{epic_key}" if jira_base_url and isinstance(epic_key, str) and epic_key else None
        )
        cards.append(
            {
                "issueKey": issue_key,
                "summary": summary,
                "issueUrl": issue_url,
                "epicName": epic_name,
                "epicUrl": epic_url,
                "storyPoints": story_points,
                "status": status,
                "statusCategory": status_category,
            }
        )
    return cards


def _empty_change_group() -> dict[str, Any]:
    return {
        "count": 0,
        "storyPointsTotal": 0,
        "issueKeys": [],
        "issueCards": [],
    }


def get_current_sprint_changes(
    *,
    db_path: str | None = None,
) -> dict[str, Any]:
    resolved_db_path = db_path or _resolve_db_path()
    sprint_payload = get_current_sprint(db_path=resolved_db_path)
    sprint = sprint_payload.get("sprint")
    if sprint is None:
        return {
            "source": "local",
            "sprint": None,
            "changes": {
                "addedAfterStart": _empty_change_group(),
                "removedAfterStart": _empty_change_group(),
                "blockedCards": _empty_change_group(),
            },
            "error": sprint_payload.get("error"),
        }

    sprint_name = str(sprint.get("name") or "").strip()
    sprint_start_raw = sprint.get("startDate")
    sprint_start = _parse_iso_datetime(sprint_start_raw if isinstance(sprint_start_raw, str) else None)

    work_payload = get_current_sprint_work(db_path=resolved_db_path)
    work = work_payload.get("work", {})
    blocked_issue_keys: set[str] = set()
    current_sprint_issue_keys: set[str] = set()
    blocked_overrides: dict[str, dict[str, Any]] = {}
    blocked_story_points_by_issue_key: dict[str, float] = {}
    for issue in [
        *(work.get("done") or []),
        *(work.get("inProgress") or []),
        *(work.get("planned") or []),
    ]:
        if not isinstance(issue, dict):
            continue
        issue_key = issue.get("issueKey")
        normalized_issue_key = issue_key.strip() if isinstance(issue_key, str) and issue_key.strip() else None
        if normalized_issue_key is not None:
            current_sprint_issue_keys.add(normalized_issue_key)
        status = issue.get("status")
        status_category = issue.get("statusCategory")
        if _status_contains_blocked(status if isinstance(status, str) else None) or _status_contains_blocked(
            status_category if isinstance(status_category, str) else None
        ):
            if normalized_issue_key is not None:
                blocked_issue_keys.add(normalized_issue_key)
                summary_raw = issue.get("summary")
                issue_url_raw = issue.get("issueUrl")
                epic_name_raw = issue.get("epicName")
                epic_url_raw = issue.get("epicUrl")
                status_raw = issue.get("status")
                status_category_raw = issue.get("statusCategory")
                blocked_overrides[normalized_issue_key] = {
                    "summary": summary_raw if isinstance(summary_raw, str) and summary_raw.strip() else None,
                    "issueUrl": issue_url_raw if isinstance(issue_url_raw, str) and issue_url_raw.strip() else None,
                    "epicName": epic_name_raw if isinstance(epic_name_raw, str) and epic_name_raw.strip() else None,
                    "epicUrl": epic_url_raw if isinstance(epic_url_raw, str) and epic_url_raw.strip() else None,
                    "status": status_raw if isinstance(status_raw, str) and status_raw.strip() else None,
                    "statusCategory": (
                        status_category_raw
                        if isinstance(status_category_raw, str) and status_category_raw.strip()
                        else None
                    ),
                }
                story_points = _coerce_story_points(issue.get("storyPoints"))
                if story_points is not None:
                    blocked_story_points_by_issue_key[normalized_issue_key] = story_points
                    blocked_overrides[normalized_issue_key]["storyPoints"] = story_points

    added_issue_keys: set[str] = set()
    removed_issue_keys: set[str] = set()
    if sprint_start is not None:
        sprint_change_rows: list[sqlite3.Row] = []
        conn = sqlite3.connect(resolved_db_path)
        conn.row_factory = sqlite3.Row
        try:
            _ensure_schema(conn)
            if sprint_name:
                sprint_change_rows = conn.execute(
                    """
                    SELECT issue_key, from_value, to_value
                    FROM issue_changelog
                    WHERE LOWER(COALESCE(field_name, '')) = 'sprint'
                      AND datetime(changed_at) >= datetime(?)
                    ORDER BY datetime(changed_at) DESC, id DESC
                    """,
                    (sprint_start.isoformat(),),
                ).fetchall()

            sprint_name_token = sprint_name.lower()
            candidate_issue_keys = set(current_sprint_issue_keys)
            baseline_membership_by_issue_key: dict[str, bool] = {
                issue_key: True for issue_key in current_sprint_issue_keys
            }

            for row in sprint_change_rows:
                issue_key = str(row["issue_key"] or "").strip()
                if not issue_key:
                    continue
                from_tokens = _normalize_sprint_values(row["from_value"])
                to_tokens = _normalize_sprint_values(row["to_value"])
                had_sprint = sprint_name_token in from_tokens
                has_sprint = sprint_name_token in to_tokens
                if had_sprint == has_sprint:
                    continue
                candidate_issue_keys.add(issue_key)
                baseline_membership_by_issue_key.setdefault(issue_key, issue_key in current_sprint_issue_keys)

            for row in sprint_change_rows:
                issue_key = str(row["issue_key"] or "").strip()
                if not issue_key or issue_key not in baseline_membership_by_issue_key:
                    continue
                from_tokens = _normalize_sprint_values(row["from_value"])
                to_tokens = _normalize_sprint_values(row["to_value"])
                had_sprint = sprint_name_token in from_tokens
                has_sprint = sprint_name_token in to_tokens
                if had_sprint != has_sprint:
                    baseline_membership_by_issue_key[issue_key] = had_sprint

            created_after_start_issue_keys: set[str] = set()
            if candidate_issue_keys:
                issue_keys_to_check = sorted(candidate_issue_keys)
                placeholders = ",".join("?" for _ in issue_keys_to_check)
                created_rows = conn.execute(
                    f"""
                    SELECT issue_key
                    FROM issues
                    WHERE issue_key IN ({placeholders})
                      AND created_at_source IS NOT NULL
                      AND datetime(created_at_source) >= datetime(?)
                    """,
                    (*issue_keys_to_check, sprint_start.isoformat()),
                ).fetchall()
                created_after_start_issue_keys = {
                    str(row["issue_key"]).strip()
                    for row in created_rows
                    if row["issue_key"] is not None and str(row["issue_key"]).strip()
                }
        finally:
            conn.close()

        baseline_issue_keys = {
            issue_key
            for issue_key, was_in_sprint_at_start in baseline_membership_by_issue_key.items()
            if was_in_sprint_at_start
        } - created_after_start_issue_keys
        added_issue_keys = current_sprint_issue_keys - baseline_issue_keys
        removed_issue_keys = baseline_issue_keys - current_sprint_issue_keys

    summary_by_issue_key: dict[str, str] = {}
    story_points_by_issue_key: dict[str, float] = {}
    epic_by_issue_key: dict[str, dict[str, str | None]] = {}
    status_by_issue_key: dict[str, dict[str, str | None]] = {}
    issue_keys_for_summary = sorted(added_issue_keys | removed_issue_keys | blocked_issue_keys)
    if issue_keys_for_summary:
        placeholders = ",".join("?" for _ in issue_keys_for_summary)
        conn = sqlite3.connect(resolved_db_path)
        conn.row_factory = sqlite3.Row
        try:
            _ensure_schema(conn)
            rows = conn.execute(
                f"""
                SELECT
                  i.issue_key,
                  i.summary,
                  i.story_points,
                  i.epic_key,
                  e.summary AS epic_summary,
                  i.status_name,
                  i.status_category
                FROM issues i
                LEFT JOIN issues e ON e.issue_key = i.epic_key
                WHERE i.issue_key IN ({placeholders})
                """,
                tuple(issue_keys_for_summary),
            ).fetchall()
        finally:
            conn.close()
        summary_by_issue_key = {
            str(row["issue_key"]): str(row["summary"]).strip()
            for row in rows
            if row["issue_key"] is not None and row["summary"] is not None
        }
        story_points_by_issue_key = {
            str(row["issue_key"]): _coerce_story_points(row["story_points"]) or 0.0
            for row in rows
            if row["issue_key"] is not None
        }
        epic_by_issue_key = {
            str(row["issue_key"]): {
                "epicKey": str(row["epic_key"]).strip()
                if row["epic_key"] is not None and str(row["epic_key"]).strip()
                else None,
                "epicName": str(row["epic_summary"]).strip()
                if row["epic_summary"] is not None and str(row["epic_summary"]).strip()
                else None,
            }
            for row in rows
            if row["issue_key"] is not None
        }
        status_by_issue_key = {
            str(row["issue_key"]): {
                "status": str(row["status_name"]).strip()
                if row["status_name"] is not None and str(row["status_name"]).strip()
                else None,
                "statusCategory": str(row["status_category"]).strip()
                if row["status_category"] is not None and str(row["status_category"]).strip()
                else None,
            }
            for row in rows
            if row["issue_key"] is not None
        }

    def _sum_story_points(issue_keys: set[str]) -> float:
        total = 0.0
        for issue_key in issue_keys:
            if issue_key in blocked_story_points_by_issue_key:
                total += blocked_story_points_by_issue_key[issue_key]
                continue
            total += story_points_by_issue_key.get(issue_key, 0.0)
        return _round_story_points(total)

    jira_base_url = _resolve_jira_base_url()

    return {
        "source": "local",
        "sprint": sprint,
        "changes": {
            "addedAfterStart": {
                "count": len(added_issue_keys),
                "storyPointsTotal": _sum_story_points(added_issue_keys),
                "issueKeys": sorted(added_issue_keys),
                "issueCards": _build_issue_cards(
                    added_issue_keys,
                    summary_by_issue_key,
                    story_points_by_issue_key,
                    epic_by_issue_key,
                    status_by_issue_key,
                    jira_base_url,
                ),
            },
            "removedAfterStart": {
                "count": len(removed_issue_keys),
                "storyPointsTotal": _sum_story_points(removed_issue_keys),
                "issueKeys": sorted(removed_issue_keys),
                "issueCards": _build_issue_cards(
                    removed_issue_keys,
                    summary_by_issue_key,
                    story_points_by_issue_key,
                    epic_by_issue_key,
                    status_by_issue_key,
                    jira_base_url,
                ),
            },
            "blockedCards": {
                "count": len(blocked_issue_keys),
                "storyPointsTotal": _sum_story_points(blocked_issue_keys),
                "issueKeys": sorted(blocked_issue_keys),
                "issueCards": _build_issue_cards(
                    blocked_issue_keys,
                    summary_by_issue_key,
                    story_points_by_issue_key,
                    epic_by_issue_key,
                    status_by_issue_key,
                    jira_base_url,
                    blocked_overrides,
                ),
            },
        },
        "error": None,
    }
