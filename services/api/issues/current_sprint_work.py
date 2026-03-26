from __future__ import annotations

import json
import sqlite3
from typing import Any, Literal

from packages.connectors.jira_config import JiraRuntimeConfig, load_env_files
from packages.connectors.jira_rest_stub import DEFAULT_SPRINT_FIELD_CANDIDATES
from services.api.integrations.jira_sync import _ensure_schema, _resolve_db_path
from services.api.issues.current_sprint import get_current_sprint

WorkBucket = Literal["done", "in_progress", "planned"]


def _normalize(value: str | None) -> str:
    if value is None:
        return ""
    return value.strip().lower()


def _bucket_for_issue(status_category: str | None, status_name: str | None) -> WorkBucket:
    category = _normalize(status_category)
    name = _normalize(status_name)

    if category in {"done"}:
        return "done"
    if category in {"in progress", "in-progress", "indeterminate"}:
        return "in_progress"
    if category in {"to do", "todo", "new"}:
        return "planned"

    if name in {"done", "closed", "resolved", "completed", "complete"}:
        return "done"
    if name in {"in progress", "in-progress", "in review", "qa", "testing"}:
        return "in_progress"
    return "planned"


def _extract_sprint_id_from_fields(fields: dict[str, Any], sprint_field_candidates: tuple[str, ...]) -> int | None:
    for field_name in sprint_field_candidates:
        candidate = fields.get(field_name)
        if candidate is None:
            continue

        if isinstance(candidate, dict):
            sprint_id = candidate.get("id")
            if isinstance(sprint_id, int):
                return sprint_id
            if isinstance(sprint_id, str) and sprint_id.isdigit():
                return int(sprint_id)

        if isinstance(candidate, list):
            for entry in reversed(candidate):
                if isinstance(entry, dict):
                    sprint_id = entry.get("id")
                    if isinstance(sprint_id, int):
                        return sprint_id
                    if isinstance(sprint_id, str) and sprint_id.isdigit():
                        return int(sprint_id)
                if isinstance(entry, str):
                    marker = "id="
                    marker_index = entry.find(marker)
                    if marker_index >= 0:
                        start = marker_index + len(marker)
                        digits = []
                        for char in entry[start:]:
                            if char.isdigit():
                                digits.append(char)
                            else:
                                break
                        if digits:
                            return int("".join(digits))

        if isinstance(candidate, str):
            marker = "id="
            marker_index = candidate.find(marker)
            if marker_index >= 0:
                start = marker_index + len(marker)
                digits = []
                for char in candidate[start:]:
                    if char.isdigit():
                        digits.append(char)
                    else:
                        break
                if digits:
                    return int("".join(digits))

    return None


def _resolve_sprint_field_candidates() -> tuple[str, ...]:
    try:
        load_env_files()
        runtime = JiraRuntimeConfig.from_env()
        return runtime.sprint_field_candidates
    except Exception:  # noqa: BLE001
        return DEFAULT_SPRINT_FIELD_CANDIDATES


def _resolve_jira_base_url() -> str | None:
    try:
        load_env_files()
        runtime = JiraRuntimeConfig.from_env()
        return runtime.base_url.rstrip("/")
    except Exception:  # noqa: BLE001
        return None


def _coerce_story_points(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return float(stripped)
        except ValueError:
            return None
    return None


def _round_story_points(value: float) -> float:
    return round(value, 2)


def _issue_sort_key(issue: dict[str, Any]) -> tuple[str, str, str]:
    category = _normalize(issue.get("statusCategory"))
    status = _normalize(issue.get("status"))
    issue_key = _normalize(issue.get("issueKey"))
    category_key = category or "zzzz"
    status_key = status or "zzzz"
    issue_key_key = issue_key or "zzzz"
    return (category_key, status_key, issue_key_key)


def get_current_sprint_work(
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
            "work": {
                "done": [],
                "inProgress": [],
                "planned": [],
                "totals": {
                    "done": 0,
                    "inProgress": 0,
                    "planned": 0,
                    "total": 0,
                    "storyPoints": {
                        "done": 0,
                        "inProgress": 0,
                        "planned": 0,
                        "total": 0,
                    },
                },
            },
            "error": sprint_payload.get("error"),
        }

    conn = sqlite3.connect(resolved_db_path)
    conn.row_factory = sqlite3.Row
    try:
        _ensure_schema(conn)
        rows = conn.execute(
            """
            SELECT
              i.issue_key,
              i.summary,
              i.status_name,
              i.status_category,
              i.story_points,
              i.epic_key,
              e.summary AS epic_summary
            FROM issues i
            LEFT JOIN issues e ON e.issue_key = i.epic_key
            WHERE i.sprint_external_id = ?
            ORDER BY i.issue_key ASC
            """,
            (sprint["id"],),
        ).fetchall()

        fallback_rows: list[sqlite3.Row] = []
        if not rows:
            fallback_rows = conn.execute(
                """
                SELECT
                  i.issue_key,
                  i.summary,
                  i.status_name,
                  i.status_category,
                  i.story_points,
                  i.epic_key,
                  e.summary AS epic_summary,
                  i.raw_json
                FROM issues i
                LEFT JOIN issues e ON e.issue_key = i.epic_key
                ORDER BY i.issue_key ASC
                """
            ).fetchall()
    finally:
        conn.close()

    done: list[dict[str, Any]] = []
    in_progress: list[dict[str, Any]] = []
    planned: list[dict[str, Any]] = []
    done_story_points = 0.0
    in_progress_story_points = 0.0
    planned_story_points = 0.0
    jira_base_url = _resolve_jira_base_url()

    if rows:
        filtered_rows = rows
    else:
        sprint_field_candidates = _resolve_sprint_field_candidates()
        filtered_rows: list[dict[str, Any]] = []
        for row in fallback_rows:
            try:
                payload = json.loads(row["raw_json"] or "{}")
            except (TypeError, json.JSONDecodeError):
                continue
            fields = payload.get("fields")
            if not isinstance(fields, dict):
                continue
            sprint_external_id = _extract_sprint_id_from_fields(fields, sprint_field_candidates)
            if sprint_external_id != sprint["id"]:
                continue
            filtered_rows.append(
                {
                    "issue_key": row["issue_key"],
                    "summary": row["summary"],
                    "status_name": row["status_name"],
                    "status_category": row["status_category"],
                    "story_points": row["story_points"],
                    "epic_key": row["epic_key"],
                    "epic_summary": row["epic_summary"],
                }
            )

    for row in filtered_rows:
        story_points = _coerce_story_points(row["story_points"])
        issue_key = row["issue_key"]
        issue_payload = {
            "issueKey": issue_key,
            "summary": row["summary"],
            "status": row["status_name"],
            "statusCategory": row["status_category"],
            "storyPoints": story_points,
            "epicKey": row["epic_key"],
            "epicName": row["epic_summary"],
            "epicUrl": (
                f"{jira_base_url}/browse/{row['epic_key']}"
                if jira_base_url and row["epic_key"]
                else None
            ),
            "issueUrl": f"{jira_base_url}/browse/{issue_key}" if jira_base_url else None,
        }
        bucket = _bucket_for_issue(row["status_category"], row["status_name"])
        if bucket == "done":
            done.append(issue_payload)
            if story_points is not None:
                done_story_points += story_points
        elif bucket == "in_progress":
            in_progress.append(issue_payload)
            if story_points is not None:
                in_progress_story_points += story_points
        else:
            planned.append(issue_payload)
            if story_points is not None:
                planned_story_points += story_points

    done.sort(key=_issue_sort_key)
    in_progress.sort(key=_issue_sort_key)
    planned.sort(key=_issue_sort_key)

    return {
        "source": "local",
        "sprint": sprint,
        "work": {
            "done": done,
            "inProgress": in_progress,
            "planned": planned,
            "totals": {
                "done": len(done),
                "inProgress": len(in_progress),
                "planned": len(planned),
                "total": len(done) + len(in_progress) + len(planned),
                "storyPoints": {
                    "done": _round_story_points(done_story_points),
                    "inProgress": _round_story_points(in_progress_story_points),
                    "planned": _round_story_points(planned_story_points),
                    "total": _round_story_points(done_story_points + in_progress_story_points + planned_story_points),
                },
            },
        },
        "error": None,
    }
