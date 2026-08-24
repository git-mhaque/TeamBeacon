from __future__ import annotations

import os
import sqlite3
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable
from urllib.parse import quote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from packages.connectors.jira_config import load_env_files
from services.api.integrations.jira_sync import _ensure_schema, _resolve_db_path
from services.api.issues.current_sprint_work import is_subtask_issue_type


_ALLOWED_ACTIVITY_FILTERS = {"all", "new", "in_progress", "completed", "current_wip", "scope"}
_ALLOWED_TABLE_WINDOWS = {1, 2, 4, 12}
_MAX_REPORTING_PERIOD_DAYS = 366
_DONE_STATUS_NAMES = {"closed", "complete", "completed", "done", "resolved"}
_IN_PROGRESS_STATUS_NAMES = {
    "analysis",
    "awaiting cab approval",
    "blocked",
    "in progress",
    "in review",
    "kickoff",
    "qa",
    "qa required",
    "release ready",
    "testing",
}
_TODO_STATUS_NAMES = {"backlog", "new", "open", "planned", "ready for development", "to do", "todo"}


def _connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def _normalize(value: Any) -> str:
    return str(value or "").strip().casefold()


def _normalize_group_id(group_id: int | str) -> int:
    try:
        normalized = int(group_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("groupId must be an integer.") from exc
    if normalized <= 0:
        raise ValueError("groupId must be a positive integer.")
    return normalized


def _normalize_group_ids(
    group_ids: Iterable[int | str] | int | str | None,
    group_id: int | str | None,
) -> list[int]:
    if group_ids is None:
        raw_values: list[int | str] = []
    elif isinstance(group_ids, (int, str)):
        raw_values = [group_ids]
    else:
        raw_values = list(group_ids)
    if group_id is not None:
        raw_values.insert(0, group_id)
    if not raw_values:
        raise ValueError("groupId is required.")

    normalized: list[int] = []
    seen: set[int] = set()
    for raw_value in raw_values:
        value = _normalize_group_id(raw_value)
        if value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    return normalized


def _normalize_epic_keys(epic_keys: Iterable[str] | None) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in epic_keys or []:
        if not isinstance(raw, str):
            raise ValueError("epicKey values must be strings.")
        value = raw.strip().upper()
        if not value:
            continue
        if value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    return normalized


def _normalize_timezone(timezone_name: str | None) -> tuple[str, ZoneInfo]:
    normalized = (timezone_name or "UTC").strip() or "UTC"
    try:
        return normalized, ZoneInfo(normalized)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"Unknown timezone: {normalized}") from exc


def _normalize_activity_filter(activity: str | None) -> str:
    normalized = _normalize(activity) or "all"
    if normalized not in _ALLOWED_ACTIVITY_FILTERS:
        allowed = ", ".join(sorted(_ALLOWED_ACTIVITY_FILTERS))
        raise ValueError(f"activity must be one of: {allowed}.")
    return normalized


def _normalize_table_window(table_window_weeks: int | str | None) -> int | None:
    if table_window_weeks is None or str(table_window_weeks).strip() == "":
        return None
    try:
        normalized = int(table_window_weeks)
    except (TypeError, ValueError) as exc:
        raise ValueError("tableWindowWeeks must be an integer.") from exc
    if normalized not in _ALLOWED_TABLE_WINDOWS:
        raise ValueError("tableWindowWeeks must be one of: 1, 2, 4, 12.")
    return normalized


def _normalize_chart_window(chart_weeks: int | str) -> int:
    try:
        normalized = int(chart_weeks)
    except (TypeError, ValueError) as exc:
        raise ValueError("chartWeeks must be an integer.") from exc
    if normalized < 1 or normalized > 52:
        raise ValueError("chartWeeks must be between 1 and 52.")
    return normalized


def _normalize_chart_date(value: str | None, *, field_name: str) -> date | None:
    candidate = str(value or "").strip()
    if not candidate:
        return None
    try:
        return date.fromisoformat(candidate)
    except ValueError as exc:
        raise ValueError(f"{field_name} must be a valid ISO date (YYYY-MM-DD).") from exc


def _resolve_chart_range(
    *,
    chart_weeks: int | str,
    chart_start: str | None,
    chart_end: str | None,
    local_today: date,
) -> tuple[date, date]:
    normalized_start = _normalize_chart_date(chart_start, field_name="chartStart")
    normalized_end = _normalize_chart_date(chart_end, field_name="chartEnd")
    if (normalized_start is None) != (normalized_end is None):
        raise ValueError("chartStart and chartEnd must both be provided when setting a chart range.")
    if normalized_start is None or normalized_end is None:
        normalized_chart_weeks = _normalize_chart_window(chart_weeks)
        return _week_start(local_today) - timedelta(weeks=normalized_chart_weeks - 1), local_today
    if normalized_start > normalized_end:
        raise ValueError("chartStart cannot be after chartEnd.")
    if normalized_end > local_today:
        raise ValueError("chartEnd cannot be after today in the selected timezone.")
    range_days = (normalized_end - normalized_start).days + 1
    if range_days > _MAX_REPORTING_PERIOD_DAYS:
        raise ValueError(f"reporting period cannot exceed {_MAX_REPORTING_PERIOD_DAYS} days.")
    return normalized_start, normalized_end


def _build_weekly_buckets(chart_start: date, chart_end: date) -> list[dict[str, Any]]:
    buckets: list[dict[str, Any]] = []
    cursor = chart_start
    while cursor <= chart_end:
        days_until_sunday = 6 - cursor.weekday()
        bucket_end = min(cursor + timedelta(days=days_until_sunday), chart_end)
        buckets.append(
            {
                "weekStart": cursor.isoformat(),
                "weekEnd": bucket_end.isoformat(),
                "newCount": 0,
                "completedCount": 0,
                "netFlow": 0,
            }
        )
        cursor = bucket_end + timedelta(days=1)
    return buckets


def _normalize_limit(limit: int | str) -> int:
    try:
        normalized = int(limit)
    except (TypeError, ValueError) as exc:
        raise ValueError("limit must be an integer.") from exc
    if normalized < 1:
        raise ValueError("limit must be a positive integer.")
    return min(normalized, 1000)


def _parse_source_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    candidate = str(value).strip()
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


def _to_iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _event_local_date(value: datetime | None, reporting_timezone: ZoneInfo) -> date | None:
    if value is None:
        return None
    return value.astimezone(reporting_timezone).date()


def _is_date_in_window(value: date | None, start_date: date, end_date: date) -> bool:
    return value is not None and start_date <= value <= end_date


def _week_start(value: date) -> date:
    return value - timedelta(days=value.weekday())


def _latest_completed_full_sync_started_at(conn: sqlite3.Connection) -> str | None:
    row = conn.execute(
        """
        SELECT started_at
        FROM sync_run_history
        WHERE source_type = 'jira'
          AND sync_mode = 'full'
          AND status = 'completed'
          AND started_at IS NOT NULL
          AND TRIM(started_at) <> ''
        ORDER BY datetime(started_at) DESC, id DESC
        LIMIT 1
        """
    ).fetchone()
    if row is None:
        return None
    value = str(row["started_at"] or "").strip()
    return value or None


def _current_full_sync_issue_clause(conn: sqlite3.Connection) -> tuple[str, list[Any]]:
    latest_full_sync_started_at = _latest_completed_full_sync_started_at(conn)
    if latest_full_sync_started_at is None:
        return "", []
    return "AND datetime(i.synced_at) >= datetime(?)", [latest_full_sync_started_at]


def _resolve_jira_base_url() -> str | None:
    try:
        load_env_files()
    except Exception:  # noqa: BLE001
        return None
    base_url = str(os.environ.get("JIRA_BASE_URL", "")).strip()
    return base_url.rstrip("/") if base_url else None


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
    base_url = str(row["base_url"] or "").strip()
    return base_url.rstrip("/") if base_url else None


def _jira_issue_url(jira_base_url: str | None, issue_key: str | None) -> str | None:
    if not jira_base_url or not issue_key:
        return None
    return f"{jira_base_url}/browse/{quote(issue_key, safe='')}"


def _load_single_group_epics(
    conn: sqlite3.Connection,
    group_id: int,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    group_row = conn.execute(
        "SELECT id, name FROM epic_groups WHERE id = ? LIMIT 1",
        (group_id,),
    ).fetchone()
    if group_row is None:
        raise ValueError(f"Unknown groupId: {group_id}")

    epic_rows = conn.execute(
        """
        SELECT
          em.epic_key,
          COALESCE(NULLIF(TRIM(em.epic_name), ''), NULLIF(TRIM(i.summary), ''), em.epic_key) AS epic_name
        FROM epic_metadata_groups emg
        JOIN epic_metadata em ON em.id = emg.epic_metadata_id
        LEFT JOIN issues i ON i.issue_key = em.epic_key
        WHERE emg.group_id = ?
        ORDER BY LOWER(COALESCE(NULLIF(TRIM(em.epic_name), ''), NULLIF(TRIM(i.summary), ''), em.epic_key)), em.epic_key
        """,
        (group_id,),
    ).fetchall()
    epics = [
        {"epicKey": str(row["epic_key"]), "epicName": str(row["epic_name"])}
        for row in epic_rows
    ]
    group = {
        "id": int(group_row["id"]),
        "name": str(group_row["name"]),
        "epicCount": len(epics),
    }
    return group, epics


def _load_group_epics(
    conn: sqlite3.Connection,
    group_ids: Iterable[int],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    groups: list[dict[str, Any]] = []
    epics_by_key: dict[str, dict[str, Any]] = {}
    for group_id in group_ids:
        group, epics = _load_single_group_epics(conn, group_id)
        groups.append(group)
        for epic in epics:
            epics_by_key.setdefault(str(epic["epicKey"]), epic)
    epic_options = sorted(
        epics_by_key.values(),
        key=lambda epic: (str(epic["epicName"]).casefold(), str(epic["epicKey"])),
    )
    return groups, epic_options


def _status_category_key(status_category: Any, status_name: Any) -> str:
    category = _normalize(status_category)
    name = _normalize(status_name)
    if category in {"done"}:
        return "done"
    if category in {"in progress", "in-progress", "indeterminate"}:
        return "in_progress"
    if category in {"to do", "todo", "new"}:
        return "todo"
    if name in _DONE_STATUS_NAMES:
        return "done"
    if name in _IN_PROGRESS_STATUS_NAMES:
        return "in_progress"
    if name in _TODO_STATUS_NAMES:
        return "todo"
    return "unknown"


def _build_status_catalog(conn: sqlite3.Connection) -> dict[str, str]:
    rows = conn.execute(
        """
        SELECT status_name, status_category, COUNT(*) AS usage_count
        FROM issues
        WHERE status_name IS NOT NULL AND TRIM(status_name) <> ''
        GROUP BY status_name, status_category
        """
    ).fetchall()
    candidates: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for row in rows:
        status_name = _normalize(row["status_name"])
        category = _status_category_key(row["status_category"], row["status_name"])
        candidates[status_name].append((int(row["usage_count"]), category))

    catalog: dict[str, str] = {}
    for status_name, options in candidates.items():
        catalog[status_name] = sorted(options, key=lambda item: (-item[0], item[1]))[0][1]
    return catalog


def _catalog_category(status_name: Any, catalog: dict[str, str]) -> str:
    normalized = _normalize(status_name)
    if normalized in catalog:
        return catalog[normalized]
    return _status_category_key(None, normalized)


def _load_in_progress_started_at(
    conn: sqlite3.Connection,
    current_wip_rows: list[sqlite3.Row],
    status_catalog: dict[str, str],
) -> dict[str, datetime]:
    issue_keys = [str(row["issue_key"]) for row in current_wip_rows]
    if not issue_keys:
        return {}

    placeholders = ",".join("?" for _ in issue_keys)
    rows = conn.execute(
        f"""
        SELECT issue_key, changed_at, from_value, to_value
        FROM issue_changelog
        WHERE issue_key IN ({placeholders})
          AND LOWER(field_name) = 'status'
        ORDER BY issue_key ASC, datetime(changed_at) ASC, id ASC
        """,
        issue_keys,
    ).fetchall()

    current_start_by_issue: dict[str, datetime] = {}
    for row in rows:
        issue_key = str(row["issue_key"])
        from_category = _catalog_category(row["from_value"], status_catalog)
        to_category = _catalog_category(row["to_value"], status_catalog)
        changed_at = _parse_source_datetime(row["changed_at"])
        if changed_at is None:
            continue
        if to_category == "in_progress" and from_category != "in_progress":
            current_start_by_issue[issue_key] = changed_at
        elif to_category != "in_progress":
            current_start_by_issue.pop(issue_key, None)
    return current_start_by_issue


def _load_fallback_completion_dates(
    conn: sqlite3.Connection,
    issue_keys: list[str],
) -> dict[str, datetime]:
    if not issue_keys:
        return {}
    placeholders = ",".join("?" for _ in issue_keys)
    rows = conn.execute(
        f"""
        SELECT issue_key, changed_at
        FROM issue_changelog
        WHERE issue_key IN ({placeholders})
          AND LOWER(field_name) = 'resolution'
          AND COALESCE(TRIM(to_value), '') <> ''
        ORDER BY issue_key ASC, datetime(changed_at) ASC, id ASC
        """,
        issue_keys,
    ).fetchall()
    completed_at_by_issue: dict[str, datetime] = {}
    for row in rows:
        changed_at = _parse_source_datetime(row["changed_at"])
        if changed_at is not None:
            completed_at_by_issue[str(row["issue_key"])] = changed_at
    return completed_at_by_issue


def _resolve_owning_epic(row: sqlite3.Row, selected_epic_set: set[str]) -> str | None:
    candidates = (row["epic_key"], row["parent_issue_key"], row["parent_epic_key"])
    for candidate in candidates:
        normalized = str(candidate or "").strip().upper()
        if normalized in selected_epic_set:
            return normalized
    return None


def _build_empty_response(
    *,
    groups: list[dict[str, Any]],
    selected_group_ids: list[int],
    epic_options: list[dict[str, Any]],
    selected_epic_keys: list[str],
    chart_start_date: date,
    chart_end_date: date,
    table_start_date: date,
    table_end_date: date,
    table_window_weeks: int | None,
    activity: str,
    timezone_name: str,
    local_today: date,
    limit: int,
) -> dict[str, Any]:
    current_week_start = _week_start(local_today)
    weekly = _build_weekly_buckets(chart_start_date, chart_end_date)
    periods = []
    for weeks in (1, 2, 4, 12, 26, 52):
        start = current_week_start - timedelta(weeks=weeks - 1)
        periods.append(
            {
                "weeks": weeks,
                "startDate": start.isoformat(),
                "endDate": local_today.isoformat(),
                "newCount": 0,
                "completedCount": 0,
                "netFlow": 0,
            }
        )
    return {
        "source": "local",
        "scope": "initiative-deep-dive",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "timezone": timezone_name,
        "group": groups[0] if len(groups) == 1 else None,
        "groups": groups,
        "selectedGroupIds": selected_group_ids,
        "epicOptions": epic_options,
        "selectedEpicKeys": selected_epic_keys,
        "selectionMode": "selected" if selected_epic_keys else "all",
        "chartWeeks": len(weekly),
        "chartRange": {
            "startDate": chart_start_date.isoformat(),
            "endDate": chart_end_date.isoformat(),
            "days": (chart_end_date - chart_start_date).days + 1,
        },
        "reportingPeriod": {
            "startDate": chart_start_date.isoformat(),
            "endDate": chart_end_date.isoformat(),
            "days": (chart_end_date - chart_start_date).days + 1,
        },
        "weekly": weekly,
        "periods": periods,
        "selectedPeriod": {
            "weeks": table_window_weeks,
            "startDate": table_start_date.isoformat(),
            "endDate": table_end_date.isoformat(),
            "days": (table_end_date - table_start_date).days + 1,
        },
        "currentWipCount": 0,
        "tableCounts": {"all": 0, "new": 0, "inProgress": 0, "completed": 0},
        "activity": activity,
        "count": 0,
        "limit": limit,
        "truncated": False,
        "cards": [],
        "error": None,
    }


def get_initiative_deep_dive(
    *,
    group_id: int | str | None = None,
    group_ids: Iterable[int | str] | int | str | None = None,
    epic_keys: Iterable[str] | None = None,
    chart_weeks: int | str = 12,
    chart_start: str | None = None,
    chart_end: str | None = None,
    table_window_weeks: int | str | None = None,
    activity: str | None = "all",
    timezone_name: str | None = None,
    limit: int | str = 500,
    db_path: str | None = None,
    now: datetime | None = None,
    jira_base_url: str | None = None,
) -> dict[str, Any]:
    normalized_group_ids = _normalize_group_ids(group_ids, group_id)
    requested_epic_keys = _normalize_epic_keys(epic_keys)
    normalized_table_window = _normalize_table_window(table_window_weeks)
    normalized_activity = _normalize_activity_filter(activity)
    safe_limit = _normalize_limit(limit)
    resolved_timezone_name, reporting_timezone = _normalize_timezone(timezone_name)

    if now is None:
        local_now = datetime.now(reporting_timezone)
    elif now.tzinfo is None:
        local_now = now.replace(tzinfo=reporting_timezone)
    else:
        local_now = now.astimezone(reporting_timezone)
    local_today = local_now.date()
    current_week_start = _week_start(local_today)
    chart_start_date, chart_end_date = _resolve_chart_range(
        chart_weeks=chart_weeks,
        chart_start=chart_start,
        chart_end=chart_end,
        local_today=local_today,
    )
    if normalized_table_window is None:
        table_start_date = chart_start_date
        table_end_date = chart_end_date
    else:
        table_start_date = current_week_start - timedelta(weeks=normalized_table_window - 1)
        table_end_date = local_today

    resolved_db_path = db_path or _resolve_db_path()
    conn = _connect(resolved_db_path)
    try:
        _ensure_schema(conn)
        requested_jira_base_url = str(jira_base_url or "").strip().rstrip("/")
        resolved_jira_base_url = (
            requested_jira_base_url
            or _resolve_jira_base_url()
            or _resolve_jira_base_url_from_db(conn)
        )
        groups, epic_options = _load_group_epics(conn, normalized_group_ids)
        epic_options = [
            {
                **epic,
                "issueUrl": _jira_issue_url(resolved_jira_base_url, str(epic.get("epicKey") or "")),
            }
            for epic in epic_options
        ]
        available_epic_keys = [str(epic["epicKey"]) for epic in epic_options]
        available_epic_set = set(available_epic_keys)
        unknown_epic_keys = [key for key in requested_epic_keys if key not in available_epic_set]
        if unknown_epic_keys:
            raise ValueError(
                "epicKey values must belong to the selected work streams: " + ", ".join(unknown_epic_keys)
            )
        selected_epic_keys = requested_epic_keys or available_epic_keys
        if not selected_epic_keys:
            return _build_empty_response(
                groups=groups,
                selected_group_ids=normalized_group_ids,
                epic_options=epic_options,
                selected_epic_keys=requested_epic_keys,
                chart_start_date=chart_start_date,
                chart_end_date=chart_end_date,
                table_start_date=table_start_date,
                table_end_date=table_end_date,
                table_window_weeks=normalized_table_window,
                activity=normalized_activity,
                timezone_name=resolved_timezone_name,
                local_today=local_today,
                limit=safe_limit,
            )

        placeholders = ",".join("?" for _ in selected_epic_keys)
        current_scope_clause, current_scope_params = _current_full_sync_issue_clause(conn)
        issue_rows = conn.execute(
            f"""
            SELECT
              i.issue_key,
              i.issue_type,
              i.summary,
              i.status_name,
              i.status_category,
              i.story_points,
              i.assignee_account_id,
              tm.display_name AS assignee_display_name,
              i.created_at_source,
              i.updated_at_source,
              i.resolved_at_source,
              i.epic_key,
              i.parent_issue_key,
              p.epic_key AS parent_epic_key
            FROM issues i
            LEFT JOIN issues p ON p.issue_key = i.parent_issue_key
            LEFT JOIN team_members tm ON tm.account_id = i.assignee_account_id
            WHERE LOWER(COALESCE(i.issue_type, '')) <> 'epic'
              AND (
                i.epic_key IN ({placeholders})
                OR i.parent_issue_key IN ({placeholders})
                OR p.epic_key IN ({placeholders})
              )
              {current_scope_clause}
            """,
            selected_epic_keys * 3 + current_scope_params,
        ).fetchall()

        selected_epic_set = set(selected_epic_keys)
        scoped_rows = [
            row
            for row in issue_rows
            if not is_subtask_issue_type(row["issue_type"])
            and _resolve_owning_epic(row, selected_epic_set) is not None
        ]
        current_wip_rows = [
            row
            for row in scoped_rows
            if _status_category_key(row["status_category"], row["status_name"]) == "in_progress"
        ]
        status_catalog = _build_status_catalog(conn)
        in_progress_started_at = _load_in_progress_started_at(conn, current_wip_rows, status_catalog)
        missing_completion_keys = [
            str(row["issue_key"])
            for row in scoped_rows
            if _status_category_key(row["status_category"], row["status_name"]) == "done"
            and _parse_source_datetime(row["resolved_at_source"]) is None
        ]
        fallback_completion_dates = _load_fallback_completion_dates(conn, missing_completion_keys)
    finally:
        conn.close()

    epic_name_by_key = {str(epic["epicKey"]): str(epic["epicName"]) for epic in epic_options}
    weekly_counts = _build_weekly_buckets(chart_start_date, chart_end_date)

    card_events: list[dict[str, Any]] = []
    for row in scoped_rows:
        issue_key = str(row["issue_key"])
        status_bucket = _status_category_key(row["status_category"], row["status_name"])
        created_at = _parse_source_datetime(row["created_at_source"])
        created_local_date = _event_local_date(created_at, reporting_timezone)
        completed_at = None
        if status_bucket == "done":
            completed_at = _parse_source_datetime(row["resolved_at_source"])
            if completed_at is None:
                completed_at = fallback_completion_dates.get(issue_key)
        completed_local_date = _event_local_date(completed_at, reporting_timezone)
        started_at = in_progress_started_at.get(issue_key) if status_bucket == "in_progress" else None
        started_local_date = _event_local_date(started_at, reporting_timezone)

        for event_kind, event_date in (("new", created_local_date), ("completed", completed_local_date)):
            if event_date is None or event_date < chart_start_date or event_date > chart_end_date:
                continue
            for bucket in weekly_counts:
                bucket_start = date.fromisoformat(str(bucket["weekStart"]))
                bucket_end = date.fromisoformat(str(bucket["weekEnd"]))
                if not bucket_start <= event_date <= bucket_end:
                    continue
                count_key = "newCount" if event_kind == "new" else "completedCount"
                bucket[count_key] += 1
                break

        card_events.append(
            {
                "row": row,
                "issueKey": issue_key,
                "statusBucket": status_bucket,
                "owningEpicKey": _resolve_owning_epic(row, selected_epic_set),
                "createdAt": created_at,
                "createdDate": created_local_date,
                "inProgressStartedAt": started_at,
                "inProgressStartedDate": started_local_date,
                "completedAt": completed_at,
                "completedDate": completed_local_date,
            }
        )

    for bucket in weekly_counts:
        bucket["netFlow"] = int(bucket["newCount"]) - int(bucket["completedCount"])

    periods: list[dict[str, Any]] = []
    for weeks in (1, 2, 4, 12, 26, 52):
        start_date = current_week_start - timedelta(weeks=weeks - 1)
        new_count = sum(
            1 for card in card_events if _is_date_in_window(card["createdDate"], start_date, local_today)
        )
        completed_count = sum(
            1 for card in card_events if _is_date_in_window(card["completedDate"], start_date, local_today)
        )
        periods.append(
            {
                "weeks": weeks,
                "startDate": start_date.isoformat(),
                "endDate": local_today.isoformat(),
                "newCount": new_count,
                "completedCount": completed_count,
                "netFlow": new_count - completed_count,
            }
        )

    table_counts: Counter[str] = Counter()
    matching_cards: list[dict[str, Any]] = []
    for card in card_events:
        is_new = _is_date_in_window(card["createdDate"], table_start_date, table_end_date)
        is_in_progress = card["statusBucket"] == "in_progress" and _is_date_in_window(
            card["inProgressStartedDate"], table_start_date, table_end_date
        )
        is_completed = _is_date_in_window(card["completedDate"], table_start_date, table_end_date)
        is_current_wip = card["statusBucket"] == "in_progress"
        if is_new:
            table_counts["new"] += 1
        if is_in_progress:
            table_counts["inProgress"] += 1
        if is_completed:
            table_counts["completed"] += 1
        if is_new or is_in_progress or is_completed:
            table_counts["all"] += 1

        filter_matches = {
            "all": is_new or is_in_progress or is_completed,
            "new": is_new,
            "in_progress": is_in_progress,
            "completed": is_completed,
            "current_wip": is_current_wip,
            "scope": True,
        }
        if not filter_matches[normalized_activity]:
            continue

        activity_types: list[str] = []
        activity_datetimes: list[datetime] = []
        if is_new:
            activity_types.append("new")
            if card["createdAt"] is not None:
                activity_datetimes.append(card["createdAt"])
        if is_in_progress or (normalized_activity == "current_wip" and is_current_wip):
            activity_types.append("in_progress")
            if card["inProgressStartedAt"] is not None:
                activity_datetimes.append(card["inProgressStartedAt"])
        if is_completed:
            activity_types.append("completed")
            if card["completedAt"] is not None:
                activity_datetimes.append(card["completedAt"])

        row = card["row"]
        fallback_activity_at = (
            _parse_source_datetime(row["updated_at_source"])
            or card["createdAt"]
            or datetime.min.replace(tzinfo=timezone.utc)
        )
        latest_activity_at = max(activity_datetimes, default=fallback_activity_at)
        owning_epic_key = str(card["owningEpicKey"] or "")
        matching_cards.append(
            {
                "issueKey": card["issueKey"],
                "issueUrl": _jira_issue_url(resolved_jira_base_url, card["issueKey"]),
                "summary": str(row["summary"] or ""),
                "issueType": str(row["issue_type"] or ""),
                "epicKey": owning_epic_key,
                "epicName": epic_name_by_key.get(owning_epic_key, owning_epic_key),
                "epicUrl": _jira_issue_url(resolved_jira_base_url, owning_epic_key),
                "status": str(row["status_name"] or ""),
                "statusCategory": str(row["status_category"] or ""),
                "storyPoints": row["story_points"],
                "assigneeAccountId": row["assignee_account_id"],
                "assigneeDisplayName": row["assignee_display_name"],
                "activityTypes": activity_types,
                "latestActivityAt": _to_iso(latest_activity_at),
                "createdAt": _to_iso(card["createdAt"]),
                "inProgressStartedAt": _to_iso(card["inProgressStartedAt"]),
                "completedAt": _to_iso(card["completedAt"]),
            }
        )

    matching_cards.sort(
        key=lambda card: (
            _parse_source_datetime(card["latestActivityAt"]) or datetime.min.replace(tzinfo=timezone.utc),
            str(card["issueKey"]),
        ),
        reverse=True,
    )
    total_count = len(matching_cards)
    visible_cards = matching_cards[:safe_limit]

    return {
        "source": "local",
        "scope": "initiative-deep-dive",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "timezone": resolved_timezone_name,
        "group": groups[0] if len(groups) == 1 else None,
        "groups": groups,
        "selectedGroupIds": normalized_group_ids,
        "epicOptions": epic_options,
        "selectedEpicKeys": requested_epic_keys,
        "selectionMode": "selected" if requested_epic_keys else "all",
        "chartWeeks": len(weekly_counts),
        "chartRange": {
            "startDate": chart_start_date.isoformat(),
            "endDate": chart_end_date.isoformat(),
            "days": (chart_end_date - chart_start_date).days + 1,
        },
        "reportingPeriod": {
            "startDate": chart_start_date.isoformat(),
            "endDate": chart_end_date.isoformat(),
            "days": (chart_end_date - chart_start_date).days + 1,
        },
        "weekly": weekly_counts,
        "periods": periods,
        "selectedPeriod": {
            "weeks": normalized_table_window,
            "startDate": table_start_date.isoformat(),
            "endDate": table_end_date.isoformat(),
            "days": (table_end_date - table_start_date).days + 1,
        },
        "currentWipCount": len(current_wip_rows),
        "tableCounts": {
            "all": table_counts["all"],
            "new": table_counts["new"],
            "inProgress": table_counts["inProgress"],
            "completed": table_counts["completed"],
        },
        "activity": normalized_activity,
        "count": total_count,
        "limit": safe_limit,
        "truncated": total_count > len(visible_cards),
        "cards": visible_cards,
        "error": None,
    }
