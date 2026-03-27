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

    added_issue_keys: set[str] = set()
    removed_issue_keys: set[str] = set()

    if sprint_name:
        conn = sqlite3.connect(resolved_db_path)
        conn.row_factory = sqlite3.Row
        try:
            _ensure_schema(conn)
            where_sql = "LOWER(COALESCE(field_name, '')) = 'sprint'"
            params: list[Any] = []
            if sprint_start is not None:
                where_sql += " AND datetime(changed_at) >= datetime(?)"
                params.append(sprint_start.isoformat())
            rows = conn.execute(
                f"""
                SELECT issue_key, from_value, to_value
                FROM issue_changelog
                WHERE {where_sql}
                ORDER BY datetime(changed_at) ASC, id ASC
                """,
                tuple(params),
            ).fetchall()
        finally:
            conn.close()

        sprint_name_token = sprint_name.lower()
        for row in rows:
            issue_key = str(row["issue_key"])
            from_tokens = _normalize_sprint_values(row["from_value"])
            to_tokens = _normalize_sprint_values(row["to_value"])
            had_sprint = sprint_name_token in from_tokens
            has_sprint = sprint_name_token in to_tokens
            if has_sprint and not had_sprint:
                added_issue_keys.add(issue_key)
            if had_sprint and not has_sprint:
                removed_issue_keys.add(issue_key)

    work_payload = get_current_sprint_work(db_path=resolved_db_path)
    work = work_payload.get("work", {})
    blocked_issue_keys: set[str] = set()
    blocked_overrides: dict[str, dict[str, Any]] = {}
    blocked_story_points_by_issue_key: dict[str, float] = {}
    for issue in [
        *(work.get("done") or []),
        *(work.get("inProgress") or []),
        *(work.get("planned") or []),
    ]:
        if not isinstance(issue, dict):
            continue
        status = issue.get("status")
        status_category = issue.get("statusCategory")
        if _status_contains_blocked(status if isinstance(status, str) else None) or _status_contains_blocked(
            status_category if isinstance(status_category, str) else None
        ):
            issue_key = issue.get("issueKey")
            if isinstance(issue_key, str) and issue_key.strip():
                normalized_issue_key = issue_key.strip()
                blocked_issue_keys.add(normalized_issue_key)
                summary_raw = issue.get("summary")
                issue_url_raw = issue.get("issueUrl")
                epic_name_raw = issue.get("epicName")
                epic_url_raw = issue.get("epicUrl")
                blocked_overrides[normalized_issue_key] = {
                    "summary": summary_raw if isinstance(summary_raw, str) and summary_raw.strip() else None,
                    "issueUrl": issue_url_raw if isinstance(issue_url_raw, str) and issue_url_raw.strip() else None,
                    "epicName": epic_name_raw if isinstance(epic_name_raw, str) and epic_name_raw.strip() else None,
                    "epicUrl": epic_url_raw if isinstance(epic_url_raw, str) and epic_url_raw.strip() else None,
                }
                story_points = _coerce_story_points(issue.get("storyPoints"))
                if story_points is not None:
                    blocked_story_points_by_issue_key[normalized_issue_key] = story_points
                    blocked_overrides[normalized_issue_key]["storyPoints"] = story_points

    summary_by_issue_key: dict[str, str] = {}
    story_points_by_issue_key: dict[str, float] = {}
    epic_by_issue_key: dict[str, dict[str, str | None]] = {}
    issue_keys_for_summary = sorted(added_issue_keys | removed_issue_keys | blocked_issue_keys)
    if issue_keys_for_summary:
        placeholders = ",".join("?" for _ in issue_keys_for_summary)
        conn = sqlite3.connect(resolved_db_path)
        conn.row_factory = sqlite3.Row
        try:
            _ensure_schema(conn)
            rows = conn.execute(
                f"""
                SELECT i.issue_key, i.summary, i.story_points, i.epic_key, e.summary AS epic_summary
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
                    jira_base_url,
                    blocked_overrides,
                ),
            },
        },
        "error": None,
    }
