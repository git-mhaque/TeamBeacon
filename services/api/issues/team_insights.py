from __future__ import annotations

import os
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from math import ceil
from statistics import median, pstdev
from typing import Any
from urllib.parse import quote

from packages.connectors.jira_config import JiraRuntimeConfig, load_env_files
from services.api.integrations.jira_sync import _ensure_schema, _resolve_db_path
from services.api.issues.current_sprint_work import is_subtask_issue_type


def _normalize(value: str | None) -> str:
    if value is None:
        return ""
    return value.strip().lower()


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


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if value is None:
        return None
    candidate = value.strip()
    if not candidate:
        return None
    if candidate.endswith("Z"):
        candidate = f"{candidate[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _round_metric(value: float) -> float:
    return round(value, 2)


def _status_key(value: str | None) -> str:
    normalized = _normalize(value)
    return normalized if normalized else "unknown"


def _status_label(status_key: str) -> str:
    if status_key == "unknown":
        return "Unknown"
    return " ".join(token.capitalize() for token in status_key.split())


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        raise ValueError("Cannot calculate percentile of an empty list.")
    sorted_values = sorted(values)
    rank = max(1, int(ceil(percentile * len(sorted_values))))
    return sorted_values[min(rank - 1, len(sorted_values) - 1)]


def _resolve_configured_board_id() -> int | None:
    try:
        load_env_files()
        runtime = JiraRuntimeConfig.from_env()
        return runtime.board_id
    except Exception:  # noqa: BLE001
        return None


def _resolve_jira_base_url() -> str | None:
    try:
        load_env_files()
    except Exception:  # noqa: BLE001
        return None
    base_url = str(os.environ.get("JIRA_BASE_URL", "")).strip()
    if not base_url:
        return None
    return base_url.rstrip("/")


def _resolve_jira_base_url_from_db(conn: sqlite3.Connection) -> str | None:
    try:
        row = conn.execute(
            """
            SELECT base_url
            FROM integration_configs
            WHERE source_type = 'jira'
              AND is_enabled = 1
            ORDER BY datetime(updated_at) DESC, id DESC
            LIMIT 1
            """
        ).fetchone()
    except sqlite3.Error:
        return None
    if row is None:
        return None
    base_url = str(row["base_url"]).strip() if row["base_url"] is not None else ""
    if not base_url:
        return None
    return base_url.rstrip("/")


def _is_done_status(status_category: str | None, status_name: str | None) -> bool:
    category = _normalize(status_category)
    status = _normalize(status_name)
    if category == "done":
        return True
    return status in {"done", "closed", "resolved", "complete", "completed"}


def _is_todo_status(status_category: str | None, status_name: str | None) -> bool:
    category = _normalize(status_category)
    status = _normalize(status_name)
    if category in {"to do", "todo", "new"}:
        return True
    return status in {
        "to do",
        "todo",
        "backlog",
        "selected for development",
        "open",
        "new",
        "ready for development",
    }


def _is_in_progress_status(status_name: str | None) -> bool:
    status = _normalize(status_name)
    if not status:
        return False
    if "in progress" in status:
        return True
    if status.startswith("qa"):
        return True
    return status in {
        "analysis",
        "in review",
        "testing",
        "blocked",
        "awaiting cab approval",
        "kickoff",
        "release ready",
    }


def _status_category_label(status_key: str, status_category: str | None = None) -> str:
    category = _normalize(status_category)
    if category in {"to do", "todo", "new"} or _is_todo_status(status_category, status_key):
        return "To Do"
    if category == "done" or _is_done_status(status_category, status_key):
        return "Done"
    if category == "in progress" or _is_in_progress_status(status_key):
        return "In Progress"
    return "Other"


def _default_include_cycle_time_status(status_key: str, status_category: str | None = None) -> bool:
    return not _is_todo_status(status_category, status_key)


def _preferred_status_label(label_counts: Counter[str]) -> str:
    if not label_counts:
        return "Unknown"
    return sorted(label_counts.items(), key=lambda item: (-item[1], item[0].lower(), item[0]))[0][0]


def _preferred_status_category(category_counts: Counter[str]) -> str | None:
    if not category_counts:
        return None
    return sorted(category_counts.items(), key=lambda item: (-item[1], item[0]))[0][0]


def _record_status_catalog_entry(
    *,
    labels_by_key: dict[str, Counter[str]],
    categories_by_key: dict[str, Counter[str]],
    raw_status: str | None,
    raw_category: str | None = None,
) -> None:
    status_key = _status_key(raw_status)
    if status_key == "unknown":
        return
    status_label = str(raw_status).strip()
    if status_label:
        labels_by_key[status_key][status_label] += 1
    normalized_category = _normalize(raw_category)
    if normalized_category:
        categories_by_key[status_key][normalized_category] += 1


def _build_available_cycle_time_statuses(
    conn: sqlite3.Connection,
    *,
    board_id: int | None,
) -> tuple[list[dict[str, Any]], list[str]]:
    labels_by_key: dict[str, Counter[str]] = defaultdict(Counter)
    categories_by_key: dict[str, Counter[str]] = defaultdict(Counter)

    issue_status_rows = conn.execute(
        """
        SELECT
          i.status_name,
          i.status_category,
          i.issue_type
        FROM issues i
        LEFT JOIN sprints s ON s.external_sprint_id = i.sprint_external_id
        WHERE (? IS NULL OR s.board_external_id = ?)
        """,
        (board_id, board_id),
    ).fetchall()
    for row in issue_status_rows:
        if is_subtask_issue_type(row["issue_type"]):
            continue
        _record_status_catalog_entry(
            labels_by_key=labels_by_key,
            categories_by_key=categories_by_key,
            raw_status=row["status_name"],
            raw_category=row["status_category"],
        )

    changelog_status_rows = conn.execute(
        """
        SELECT
          c.from_value,
          c.to_value,
          i.issue_type
        FROM issue_changelog c
        JOIN issues i ON i.issue_key = c.issue_key
        LEFT JOIN sprints s ON s.external_sprint_id = i.sprint_external_id
        WHERE lower(c.field_name) = 'status'
          AND (? IS NULL OR s.board_external_id = ?)
        """,
        (board_id, board_id),
    ).fetchall()
    for row in changelog_status_rows:
        if is_subtask_issue_type(row["issue_type"]):
            continue
        _record_status_catalog_entry(
            labels_by_key=labels_by_key,
            categories_by_key=categories_by_key,
            raw_status=row["from_value"],
        )
        _record_status_catalog_entry(
            labels_by_key=labels_by_key,
            categories_by_key=categories_by_key,
            raw_status=row["to_value"],
        )

    category_order = {"To Do": 0, "In Progress": 1, "Done": 2, "Other": 3}
    statuses: list[dict[str, Any]] = []
    default_status_keys: list[str] = []
    for status_key in labels_by_key:
        preferred_label = _preferred_status_label(labels_by_key[status_key])
        preferred_category = _preferred_status_category(categories_by_key[status_key])
        category_label = _status_category_label(preferred_label, preferred_category)
        default_included = _default_include_cycle_time_status(preferred_label, preferred_category)
        if default_included:
            default_status_keys.append(status_key)
        statuses.append(
            {
                "statusKey": status_key,
                "status": preferred_label,
                "statusCategory": category_label,
                "defaultIncluded": default_included,
            }
        )

    statuses.sort(key=lambda item: (category_order.get(item["statusCategory"], 99), item["status"].lower()))
    return statuses, sorted(default_status_keys)


def _build_issue_status_cycle_days(
    *,
    cycle_ended_at: datetime,
    created_at: datetime | None,
    current_status_name: str | None,
    status_changes: list[tuple[datetime, str | None, str | None]],
) -> dict[str, float]:
    timeline = _build_issue_status_timeline(
        cycle_ended_at=cycle_ended_at,
        created_at=created_at,
        current_status_name=current_status_name,
        status_changes=status_changes,
    )
    issue_status_cycle_days: dict[str, float] = defaultdict(float)
    for segment in timeline:
        status_key = segment["statusKey"]
        duration_days = float(segment["days"])
        if duration_days <= 0:
            continue
        issue_status_cycle_days[status_key] += duration_days
    return dict(issue_status_cycle_days)


def _build_issue_status_timeline(
    *,
    cycle_ended_at: datetime | None,
    created_at: datetime | None,
    current_status_name: str | None,
    status_changes: list[tuple[datetime, str | None, str | None]],
) -> list[dict[str, Any]]:
    if cycle_ended_at is None:
        return []

    sorted_changes = sorted(status_changes, key=lambda item: item[0])
    if not sorted_changes and created_at is None:
        return []

    timeline_start = (
        created_at
        if created_at is not None and created_at < cycle_ended_at
        else sorted_changes[0][0]
        if sorted_changes
        else cycle_ended_at
    )
    if timeline_start >= cycle_ended_at:
        return []

    current_status_key: str | None = None
    for changed_at, _from_key, to_key in sorted_changes:
        if changed_at <= timeline_start:
            if to_key is not None:
                current_status_key = to_key
            continue
        break

    if current_status_key is None:
        for changed_at, from_key, _to_key in sorted_changes:
            if changed_at > timeline_start and from_key is not None:
                current_status_key = from_key
                break

    if current_status_key is None and current_status_name is not None:
        current_status_key = _status_key(current_status_name)
    if current_status_key is None:
        return []

    cursor = timeline_start
    timeline: list[dict[str, Any]] = []

    def append_segment(status_key: str, started_at: datetime, ended_at: datetime) -> None:
        if ended_at <= started_at:
            return
        duration_days = (ended_at - started_at).total_seconds() / 86400.0
        if duration_days <= 0:
            return
        if (
            timeline
            and timeline[-1]["statusKey"] == status_key
            and timeline[-1]["endedAt"] == started_at.isoformat()
        ):
            timeline[-1]["endedAt"] = ended_at.isoformat()
            timeline[-1]["days"] = _round_metric(float(timeline[-1]["days"]) + duration_days)
            return
        timeline.append(
            {
                "statusKey": status_key,
                "startedAt": started_at.isoformat(),
                "endedAt": ended_at.isoformat(),
                "days": _round_metric(duration_days),
            }
        )

    for changed_at, _from_key, to_key in sorted_changes:
        if changed_at <= timeline_start:
            continue
        if changed_at > cycle_ended_at:
            break
        append_segment(current_status_key, cursor, changed_at)
        if to_key is not None:
            current_status_key = to_key
        cursor = changed_at

    append_segment(current_status_key, cursor, cycle_ended_at)
    return timeline


def _completion_ratio_percent(
    *,
    committed_story_points: float,
    completed_story_points: float,
    committed_count: int,
    completed_count: int,
) -> float:
    if committed_story_points > 0:
        return _round_metric((completed_story_points / committed_story_points) * 100.0)
    if committed_count > 0:
        return _round_metric((completed_count / committed_count) * 100.0)
    return 0.0


def _empty_response(error: str | None = None) -> dict[str, Any]:
    return {
        "source": "local",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "windowSize": 0,
        "metrics": {
            "avgCommittedStoryPoints": 0.0,
            "avgCompletedStoryPoints": 0.0,
            "completionRatioPercent": 0.0,
            "carryoverPercent": 0.0,
            "avgCycleTimeDays": None,
            "cycleTimeStdDevDays": None,
            "medianCycleTimeDays": None,
        },
        "trend": [],
        "statusCycleTime": {
            "trackedIssues": 0,
            "completedIssues": 0,
            "excludedIssues": 0,
            "totalDays": 0.0,
            "appliedStatusKeys": [],
            "defaultStatusKeys": [],
            "availableStatuses": [],
            "rows": [],
        },
        "cardsInWindow": {
            "totalCards": 0,
            "inProgressCards": 0,
            "completedCards": 0,
            "trackedCards": 0,
            "appliedStatusKeys": [],
            "rows": [],
        },
        "workMix": {
            "sprintId": None,
            "sprintName": None,
            "totalIssues": 0,
            "slices": [],
        },
        "summary": "Work mix will appear once sprint data is synced.",
        "error": error,
    }


def get_team_insights(
    *,
    sprint_limit: int = 6,
    cycle_time_status_keys: list[str] | None = None,
    db_path: str | None = None,
    board_id: int | None = None,
) -> dict[str, Any]:
    safe_sprint_limit = max(1, min(int(sprint_limit), 12))
    resolved_db_path = db_path or _resolve_db_path()
    scoped_board_id = board_id if board_id is not None else _resolve_configured_board_id()

    conn = sqlite3.connect(resolved_db_path)
    conn.row_factory = sqlite3.Row
    try:
        _ensure_schema(conn)
        jira_base_url = _resolve_jira_base_url() or _resolve_jira_base_url_from_db(conn)
        sprint_rows = conn.execute(
            """
            SELECT
              external_sprint_id,
              board_external_id,
              name,
              state,
              start_date,
              end_date,
              complete_date,
              updated_at
            FROM sprints
            WHERE lower(state) IN ('active', 'closed', 'complete', 'completed')
              AND (? IS NULL OR board_external_id = ?)
            ORDER BY
              datetime(COALESCE(complete_date, end_date, start_date, updated_at)) DESC,
              external_sprint_id DESC
            LIMIT ?
            """,
            (scoped_board_id, scoped_board_id, safe_sprint_limit),
        ).fetchall()

        if not sprint_rows:
            return _empty_response("No sprint history found in local data.")

        sprint_ids = [
            int(row["external_sprint_id"])
            for row in sprint_rows
            if row["external_sprint_id"] is not None
        ]
        issue_rows: list[sqlite3.Row] = []
        if sprint_ids:
            placeholders = ",".join("?" for _ in sprint_ids)
            issue_rows = conn.execute(
                f"""
                SELECT
                  i.sprint_external_id,
                  i.issue_key,
                  i.issue_type,
                  i.summary,
                  i.status_name,
                  i.status_category,
                  i.story_points,
                  i.created_at_source,
                  i.resolved_at_source,
                  i.epic_key,
                  em.epic_name
                FROM issues i
                LEFT JOIN epic_metadata em ON em.epic_key = i.epic_key
                WHERE i.sprint_external_id IN ({placeholders})
                """,
                tuple(sprint_ids),
            ).fetchall()
            issue_rows = [
                row for row in issue_rows
                if not is_subtask_issue_type(row["issue_type"])
            ]

        available_statuses, default_cycle_time_status_keys = _build_available_cycle_time_statuses(
            conn,
            board_id=scoped_board_id,
        )
        requested_cycle_time_status_keys = (
            sorted({_status_key(value) for value in cycle_time_status_keys if _status_key(value) != "unknown"})
            if cycle_time_status_keys is not None
            else default_cycle_time_status_keys
        )
        available_status_key_set = {entry["statusKey"] for entry in available_statuses}
        applied_cycle_time_status_keys = [
            status_key for status_key in requested_cycle_time_status_keys if status_key in available_status_key_set
        ]
        applied_cycle_time_status_key_set = set(applied_cycle_time_status_keys)

        status_changes_by_issue_key: dict[str, list[tuple[datetime, str | None, str | None]]] = defaultdict(list)
        issue_keys = sorted({str(row["issue_key"]).strip() for row in issue_rows if row["issue_key"] is not None})
        if issue_keys:
            issue_placeholders = ",".join("?" for _ in issue_keys)
            changelog_rows = conn.execute(
                f"""
                SELECT
                  issue_key,
                  changed_at,
                  from_value,
                  to_value
                FROM issue_changelog
                WHERE lower(field_name) = 'status'
                  AND issue_key IN ({issue_placeholders})
                ORDER BY datetime(changed_at) ASC, id ASC
                """,
                tuple(issue_keys),
            ).fetchall()
            for changelog_row in changelog_rows:
                issue_key_raw = changelog_row["issue_key"]
                if issue_key_raw is None:
                    continue
                issue_key = str(issue_key_raw).strip()
                if not issue_key:
                    continue
                changed_at = _parse_iso_datetime(changelog_row["changed_at"])
                if changed_at is None:
                    continue
                status_changes_by_issue_key[issue_key].append(
                    (
                        changed_at,
                        _status_key(changelog_row["from_value"]) if changelog_row["from_value"] is not None else None,
                        _status_key(changelog_row["to_value"]) if changelog_row["to_value"] is not None else None,
                    )
                )

        issues_by_sprint: dict[int, list[sqlite3.Row]] = defaultdict(list)
        for row in issue_rows:
            sprint_external_id = row["sprint_external_id"]
            if sprint_external_id is None:
                continue
            issues_by_sprint[int(sprint_external_id)].append(row)

        trend: list[dict[str, Any]] = []
        cycle_time_days: list[float] = []
        status_cycle_total_days_by_status: dict[str, float] = defaultdict(float)
        status_cycle_issue_days_by_status: dict[str, list[float]] = defaultdict(list)
        status_cycle_issue_keys_by_status: dict[str, set[str]] = defaultdict(set)
        now_utc = datetime.now(timezone.utc)
        available_status_label_by_key = {
            entry["statusKey"]: entry["status"]
            for entry in available_statuses
        }
        cards_in_window_rows: list[dict[str, Any]] = []
        cards_in_window_completed = 0
        cards_in_window_in_progress = 0
        cards_in_window_tracked = 0
        tracked_cycle_issues = 0
        completed_cycle_issues = 0
        total_committed_story_points = 0.0
        total_completed_story_points = 0.0
        total_committed_cards = 0
        total_completed_cards = 0

        # Present oldest->newest so trend bars progress left-to-right in time order.
        for sprint_row in reversed(sprint_rows):
            sprint_external_id = int(sprint_row["external_sprint_id"])
            sprint_is_active = _normalize(sprint_row["state"]) == "active"
            sprint_issues = issues_by_sprint.get(sprint_external_id, [])

            committed_story_points = 0.0
            completed_story_points = 0.0
            committed_cards = len(sprint_issues)
            completed_cards = 0
            sprint_cycle_time_days: list[float] = []

            for issue_row in sprint_issues:
                story_points = _coerce_story_points(issue_row["story_points"])
                if story_points is not None:
                    committed_story_points += story_points

                status_name_raw = issue_row["status_name"]
                status_category_raw = issue_row["status_category"]
                issue_type_raw = issue_row["issue_type"]
                issue_type_key = _normalize(issue_type_raw)
                is_epic = issue_type_key == "epic"
                is_done_issue = _is_done_status(status_category_raw, status_name_raw)
                issue_key = (
                    str(issue_row["issue_key"]).strip()
                    if issue_row["issue_key"] is not None
                    else ""
                )
                created_at = _parse_iso_datetime(issue_row["created_at_source"])
                resolved_at = _parse_iso_datetime(issue_row["resolved_at_source"])
                cycle_ended_at = resolved_at if resolved_at is not None else now_utc
                issue_status_timeline = _build_issue_status_timeline(
                    cycle_ended_at=cycle_ended_at,
                    created_at=created_at,
                    current_status_name=status_name_raw,
                    status_changes=status_changes_by_issue_key.get(issue_key, []),
                )
                issue_status_cycle_days: dict[str, float] = defaultdict(float)
                for segment in issue_status_timeline:
                    status_key = str(segment["statusKey"]).strip()
                    if not status_key:
                        continue
                    issue_days = float(segment["days"])
                    if issue_days <= 0:
                        continue
                    issue_status_cycle_days[status_key] += issue_days
                selected_issue_status_days = {
                    status_key: issue_days
                    for status_key, issue_days in issue_status_cycle_days.items()
                    if status_key in applied_cycle_time_status_key_set and issue_days > 0
                }
                cycle_time_to_date_days = sum(selected_issue_status_days.values())

                if is_done_issue:
                    completed_cards += 1
                    if story_points is not None:
                        completed_story_points += story_points

                if not is_epic and issue_key:
                    if is_done_issue:
                        cards_in_window_completed += 1
                    else:
                        cards_in_window_in_progress += 1
                    if cycle_time_to_date_days > 0:
                        cards_in_window_tracked += 1

                    total_timeline_days = sum(
                        max(0.0, float(segment["days"]))
                        for segment in issue_status_timeline
                    )
                    timeline_rows: list[dict[str, Any]] = []
                    for segment in issue_status_timeline:
                        status_key = str(segment["statusKey"]).strip()
                        days = max(0.0, float(segment["days"]))
                        if not status_key or days <= 0:
                            continue
                        timeline_rows.append(
                            {
                                "statusKey": status_key,
                                "status": available_status_label_by_key.get(status_key, _status_label(status_key)),
                                "changedAt": segment["startedAt"],
                                "days": _round_metric(days),
                                "percentOfTicketTime": (
                                    _round_metric((days / total_timeline_days) * 100.0)
                                    if total_timeline_days > 0
                                    else 0.0
                                ),
                                "isCycleTimeStatus": status_key in applied_cycle_time_status_key_set,
                            }
                        )

                    status_key = _status_key(status_name_raw)
                    status_label = available_status_label_by_key.get(
                        status_key,
                        str(status_name_raw).strip() if status_name_raw is not None and str(status_name_raw).strip() else "Unknown",
                    )
                    issue_type_label = (
                        str(issue_type_raw).strip()
                        if issue_type_raw is not None and str(issue_type_raw).strip()
                        else "Unspecified"
                    )
                    summary = (
                        str(issue_row["summary"]).strip()
                        if issue_row["summary"] is not None and str(issue_row["summary"]).strip()
                        else "-"
                    )
                    epic_key = (
                        str(issue_row["epic_key"]).strip()
                        if issue_row["epic_key"] is not None and str(issue_row["epic_key"]).strip()
                        else None
                    )
                    epic_name = (
                        str(issue_row["epic_name"]).strip()
                        if issue_row["epic_name"] is not None and str(issue_row["epic_name"]).strip()
                        else None
                    )
                    cards_in_window_rows.append(
                        {
                            "issueKey": issue_key,
                            "issueUrl": (
                                f"{jira_base_url}/browse/{quote(issue_key)}"
                                if jira_base_url and issue_key
                                else None
                            ),
                            "epicKey": epic_key,
                            "epicName": epic_name,
                            "sprintId": sprint_external_id,
                            "sprintName": sprint_row["name"],
                            "status": status_label,
                            "statusKey": status_key,
                            "issueType": issue_type_label,
                            "issueTypeKey": issue_type_key if issue_type_key else "unknown",
                            "storyPoints": _round_metric(story_points) if story_points is not None else None,
                            "cycleTimeDays": (
                                _round_metric(cycle_time_to_date_days)
                                if is_done_issue and resolved_at is not None and cycle_time_to_date_days > 0
                                else None
                            ),
                            "cycleTimeToDateDays": _round_metric(cycle_time_to_date_days) if cycle_time_to_date_days > 0 else None,
                            "summary": summary,
                            "isCompleted": is_done_issue,
                            "statusTimeline": timeline_rows,
                        }
                    )

                duration_days = cycle_time_to_date_days
                if is_done_issue and not is_epic:
                    completed_cycle_issues += 1

                should_include_cycle_time = (
                    not is_epic
                    and bool(issue_key)
                    and duration_days > 0
                    and (is_done_issue or sprint_is_active)
                )
                if should_include_cycle_time:
                    cycle_time_days.append(duration_days)
                    sprint_cycle_time_days.append(duration_days)
                    tracked_cycle_issues += 1

                    for status_key, issue_days in selected_issue_status_days.items():
                        if issue_days <= 0:
                            continue
                        status_cycle_total_days_by_status[status_key] += issue_days
                        status_cycle_issue_days_by_status[status_key].append(issue_days)
                        status_cycle_issue_keys_by_status[status_key].add(issue_key)

            completion_ratio_percent = _completion_ratio_percent(
                committed_story_points=committed_story_points,
                completed_story_points=completed_story_points,
                committed_count=committed_cards,
                completed_count=completed_cards,
            )
            carryover_percent = _round_metric(max(0.0, 100.0 - completion_ratio_percent)) if committed_cards > 0 else 0.0

            total_committed_story_points += committed_story_points
            total_completed_story_points += completed_story_points
            total_committed_cards += committed_cards
            total_completed_cards += completed_cards

            trend.append(
                {
                    "sprintId": sprint_external_id,
                    "sprintName": sprint_row["name"],
                    "state": sprint_row["state"],
                    "startDate": sprint_row["start_date"],
                    "endDate": sprint_row["end_date"],
                    "committedStoryPoints": _round_metric(committed_story_points),
                    "completedStoryPoints": _round_metric(completed_story_points),
                    "avgCycleTimeDays": (
                        _round_metric(sum(sprint_cycle_time_days) / len(sprint_cycle_time_days))
                        if sprint_cycle_time_days
                        else None
                    ),
                    "completionRatioPercent": completion_ratio_percent,
                    "carryoverPercent": carryover_percent,
                }
            )

        sprint_count = len(trend)
        avg_committed_story_points = _round_metric(total_committed_story_points / sprint_count) if sprint_count > 0 else 0.0
        avg_completed_story_points = _round_metric(total_completed_story_points / sprint_count) if sprint_count > 0 else 0.0

        overall_completion_ratio_percent = _completion_ratio_percent(
            committed_story_points=total_committed_story_points,
            completed_story_points=total_completed_story_points,
            committed_count=total_committed_cards,
            completed_count=total_completed_cards,
        )
        overall_carryover_percent = (
            _round_metric(max(0.0, 100.0 - overall_completion_ratio_percent))
            if total_committed_cards > 0
            else 0.0
        )
        avg_cycle_time_days = _round_metric(sum(cycle_time_days) / len(cycle_time_days)) if cycle_time_days else None
        cycle_time_std_dev_days = _round_metric(float(pstdev(cycle_time_days))) if cycle_time_days else None
        median_cycle_time_days = _round_metric(float(median(cycle_time_days))) if cycle_time_days else None
        total_status_cycle_days = sum(status_cycle_total_days_by_status.values())
        status_cycle_rows = []
        for status_key, total_days in status_cycle_total_days_by_status.items():
            issue_days = status_cycle_issue_days_by_status.get(status_key, [])
            if not issue_days:
                continue
            status_cycle_rows.append(
                {
                    "status": available_status_label_by_key.get(status_key, _status_label(status_key)),
                    "issueCount": len(status_cycle_issue_keys_by_status.get(status_key, set())),
                    "avgDays": _round_metric(sum(issue_days) / len(issue_days)),
                    "medianDays": _round_metric(float(median(issue_days))),
                    "p85Days": _round_metric(_percentile(issue_days, 0.85)),
                    "maxDays": _round_metric(max(issue_days)),
                    "totalDays": _round_metric(total_days),
                    "percentOfCycleTime": (
                        _round_metric((total_days / total_status_cycle_days) * 100.0) if total_status_cycle_days > 0 else 0.0
                    ),
                }
            )
        status_cycle_rows.sort(key=lambda item: (-item["totalDays"], item["status"].lower()))
        cards_in_window_rows.sort(
            key=lambda item: (
                item["cycleTimeToDateDays"] is None,
                -(item["cycleTimeToDateDays"] or 0.0),
                item["issueKey"].lower(),
            )
        )

        latest_active_sprint = next((row for row in sprint_rows if _normalize(row["state"]) == "active"), None)
        work_mix_sprint = latest_active_sprint or sprint_rows[0]
        work_mix_sprint_id = int(work_mix_sprint["external_sprint_id"])
        work_mix_rows = conn.execute(
            """
            SELECT
              i.issue_key,
              i.issue_type,
              COALESCE(
                (
                  SELECT wt.name
                  FROM epic_metadata em
                  JOIN epic_metadata_work_types emwt ON emwt.epic_metadata_id = em.id
                  JOIN work_types wt ON wt.id = emwt.work_type_id
                  WHERE em.epic_key = i.epic_key
                  ORDER BY wt.name ASC
                  LIMIT 1
                ),
                (
                  SELECT eg.name
                  FROM epic_metadata em
                  JOIN epic_metadata_groups emg ON emg.epic_metadata_id = em.id
                  JOIN epic_groups eg ON eg.id = emg.group_id
                  WHERE em.epic_key = i.epic_key
                  ORDER BY eg.name ASC
                  LIMIT 1
                )
              ) AS metadata_label
            FROM issues i
            WHERE i.sprint_external_id = ?
            ORDER BY i.issue_key ASC
            """,
            (work_mix_sprint_id,),
        ).fetchall()
        work_mix_rows = [
            row for row in work_mix_rows
            if not is_subtask_issue_type(row["issue_type"])
        ]
    finally:
        conn.close()

    mix_counts: dict[str, int] = defaultdict(int)
    for row in work_mix_rows:
        metadata_label = row["metadata_label"]
        issue_type = row["issue_type"]
        label = (
            str(metadata_label).strip()
            if metadata_label is not None and str(metadata_label).strip()
            else str(issue_type).strip()
            if issue_type is not None and str(issue_type).strip()
            else "Unassigned"
        )
        mix_counts[label] += 1

    total_mix_issues = sum(mix_counts.values())
    sorted_mix = sorted(mix_counts.items(), key=lambda item: (-item[1], item[0].lower()))
    mix_slices = [
        {
            "label": label,
            "count": count,
            "percent": _round_metric((count / total_mix_issues) * 100.0) if total_mix_issues > 0 else 0.0,
        }
        for label, count in sorted_mix
    ]

    if mix_slices:
        preview = ", ".join(
            f"{slice_item['label']} {slice_item['percent']:.0f}%"
            for slice_item in mix_slices[:3]
        )
        summary = (
            f"Work mix is currently {preview}. Monitor completion and carryover together to rebalance team capacity."
        )
    else:
        summary = "Work mix will appear once sprint issues are synced."

    return {
        "source": "local",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "windowSize": sprint_count,
        "metrics": {
            "avgCommittedStoryPoints": avg_committed_story_points,
            "avgCompletedStoryPoints": avg_completed_story_points,
            "completionRatioPercent": overall_completion_ratio_percent,
            "carryoverPercent": overall_carryover_percent,
            "avgCycleTimeDays": avg_cycle_time_days,
            "cycleTimeStdDevDays": cycle_time_std_dev_days,
            "medianCycleTimeDays": median_cycle_time_days,
        },
        "trend": trend,
        "statusCycleTime": {
            "trackedIssues": tracked_cycle_issues,
            "completedIssues": completed_cycle_issues,
            "excludedIssues": max(0, completed_cycle_issues - tracked_cycle_issues),
            "totalDays": _round_metric(total_status_cycle_days),
            "appliedStatusKeys": applied_cycle_time_status_keys,
            "defaultStatusKeys": default_cycle_time_status_keys,
            "availableStatuses": available_statuses,
            "rows": status_cycle_rows,
        },
        "cardsInWindow": {
            "totalCards": len(cards_in_window_rows),
            "inProgressCards": cards_in_window_in_progress,
            "completedCards": cards_in_window_completed,
            "trackedCards": cards_in_window_tracked,
            "appliedStatusKeys": applied_cycle_time_status_keys,
            "rows": cards_in_window_rows,
        },
        "workMix": {
            "sprintId": work_mix_sprint_id,
            "sprintName": work_mix_sprint["name"],
            "totalIssues": total_mix_issues,
            "slices": mix_slices,
        },
        "summary": summary,
        "error": None,
    }
