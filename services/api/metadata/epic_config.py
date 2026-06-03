from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import json
import sqlite3
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from services.api.integrations.jira_sync import _ensure_schema, _resolve_db_path


def _connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def _column_exists(conn: sqlite3.Connection, table_name: str, column_name: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return any(str(row[1]) == column_name for row in rows)


def _ensure_metadata_schema(conn: sqlite3.Connection) -> None:
    _ensure_schema(conn)
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS epic_groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS work_types (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS epic_metadata (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          epic_key TEXT NOT NULL UNIQUE,
          epic_name TEXT,
          success_criteria_json TEXT NOT NULL DEFAULT '[]',
          timeline_enabled INTEGER NOT NULL DEFAULT 0,
          timeline_start_date TEXT,
          target_completion_date TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS epic_metadata_groups (
          epic_metadata_id INTEGER NOT NULL,
          group_id INTEGER NOT NULL,
          PRIMARY KEY(epic_metadata_id, group_id),
          FOREIGN KEY (epic_metadata_id) REFERENCES epic_metadata(id),
          FOREIGN KEY (group_id) REFERENCES epic_groups(id)
        );

        CREATE TABLE IF NOT EXISTS epic_metadata_work_types (
          epic_metadata_id INTEGER NOT NULL,
          work_type_id INTEGER NOT NULL,
          PRIMARY KEY(epic_metadata_id, work_type_id),
          FOREIGN KEY (epic_metadata_id) REFERENCES epic_metadata(id),
          FOREIGN KEY (work_type_id) REFERENCES work_types(id)
        );

        CREATE TABLE IF NOT EXISTS initiative_views (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          description TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS initiative_view_epics (
          view_id INTEGER NOT NULL,
          epic_metadata_id INTEGER NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(view_id, epic_metadata_id),
          FOREIGN KEY (view_id) REFERENCES initiative_views(id),
          FOREIGN KEY (epic_metadata_id) REFERENCES epic_metadata(id)
        );

        CREATE INDEX IF NOT EXISTS idx_initiative_view_epics_view
        ON initiative_view_epics(view_id, sort_order, epic_metadata_id);
        """
    )
    if not _column_exists(conn, "epic_metadata", "epic_name"):
        conn.execute(
            """
            ALTER TABLE epic_metadata
            ADD COLUMN epic_name TEXT
            """
        )
    if not _column_exists(conn, "epic_metadata", "timeline_enabled"):
        conn.execute(
            """
            ALTER TABLE epic_metadata
            ADD COLUMN timeline_enabled INTEGER NOT NULL DEFAULT 0
            """
        )
    if not _column_exists(conn, "epic_metadata", "timeline_start_date"):
        conn.execute(
            """
            ALTER TABLE epic_metadata
            ADD COLUMN timeline_start_date TEXT
            """
        )
    if not _column_exists(conn, "epic_metadata", "target_completion_date"):
        conn.execute(
            """
            ALTER TABLE epic_metadata
            ADD COLUMN target_completion_date TEXT
            """
        )


def _resolve_epic_name_from_issues(conn: sqlite3.Connection, epic_key: str) -> str | None:
    row = conn.execute(
        """
        SELECT summary
        FROM issues
        WHERE issue_key = ?
        ORDER BY datetime(updated_at_source) DESC, id DESC
        LIMIT 1
        """,
        (epic_key,),
    ).fetchone()
    if row is None:
        return None
    value = row["summary"]
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _normalize_name(name: str) -> str:
    normalized = name.strip()
    if not normalized:
        raise ValueError("Name is required.")
    return normalized


def _normalize_lookup_id(lookup_id: int | str) -> int:
    try:
        normalized = int(lookup_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("id must be an integer.") from exc
    if normalized <= 0:
        raise ValueError("id must be a positive integer.")
    return normalized


def _normalize_epic_key(epic_key: str) -> str:
    normalized = epic_key.strip().upper()
    if not normalized:
        raise ValueError("epicKey is required.")
    return normalized


def _normalize_view_id(view_id: int | str) -> int:
    try:
        normalized = int(view_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("viewId must be an integer.") from exc
    if normalized <= 0:
        raise ValueError("viewId must be a positive integer.")
    return normalized


def _normalize_optional_view_id(view_id: int | str | None) -> int | None:
    if view_id is None:
        return None
    if isinstance(view_id, str) and view_id.strip().lower() in {"", "all"}:
        return None
    return _normalize_view_id(view_id)


def _normalize_optional_description(description: str | None) -> str | None:
    if description is None:
        return None
    if not isinstance(description, str):
        raise ValueError("description must be a string.")
    normalized = description.strip()
    return normalized or None


def _normalize_epic_key_list(epic_keys: list[str] | None) -> list[str]:
    if not epic_keys:
        return []
    deduped: list[str] = []
    seen: set[str] = set()
    for raw in epic_keys:
        if not isinstance(raw, str):
            raise ValueError("epicKeys must contain strings.")
        normalized = _normalize_epic_key(raw)
        if normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(normalized)
    return deduped


def _normalize_criteria(values: list[str] | None) -> list[str]:
    if not values:
        return []
    cleaned = [value.strip() for value in values if isinstance(value, str) and value.strip()]
    # Keep deterministic ordering while preserving first occurrence.
    deduped: list[str] = []
    seen: set[str] = set()
    for value in cleaned:
        lowered = value.casefold()
        if lowered in seen:
            continue
        seen.add(lowered)
        deduped.append(value)
    return deduped


def _normalize_timeline_enabled(value: bool | None) -> bool:
    if value is None:
        return False
    if not isinstance(value, bool):
        raise ValueError("timelineEnabled must be a boolean.")
    return value


def _normalize_optional_iso_date(value: str | None, *, field_name: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a string date.")

    candidate = value.strip()
    if not candidate:
        return None

    parsed_date: date | None = None
    try:
        if len(candidate) == 10:
            parsed_date = date.fromisoformat(candidate)
        else:
            normalized = f"{candidate[:-1]}+00:00" if candidate.endswith("Z") else candidate
            parsed_date = datetime.fromisoformat(normalized).date()
    except ValueError as exc:
        raise ValueError(f"{field_name} must be a valid ISO date (YYYY-MM-DD).") from exc

    if parsed_date is None:
        return None
    return parsed_date.isoformat()


def _normalize_timeline_start_date(value: str | None) -> str | None:
    return _normalize_optional_iso_date(value, field_name="timelineStartDate")


def _normalize_target_completion_date(value: str | None, *, timeline_enabled: bool) -> str | None:
    normalized = _normalize_optional_iso_date(value, field_name="targetCompletionDate")
    if timeline_enabled and normalized is None:
        raise ValueError("targetCompletionDate is required when timelineEnabled is true.")
    return normalized


def _resolve_reporting_timezone(timezone_name: str | None) -> tuple[str, ZoneInfo]:
    candidate = (timezone_name or "").strip()
    if not candidate:
        candidate = "UTC"
    try:
        return candidate, ZoneInfo(candidate)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(
            "timezone must be a valid IANA timezone (for example: Australia/Melbourne)."
        ) from exc


def _resolve_reporting_period(
    *,
    period_start: str | None,
    period_end: str | None,
    timezone_name: str | None,
) -> tuple[date, date, str, ZoneInfo]:
    resolved_timezone_name, resolved_timezone = _resolve_reporting_timezone(timezone_name)
    normalized_start = _normalize_optional_iso_date(period_start, field_name="periodStart")
    normalized_end = _normalize_optional_iso_date(period_end, field_name="periodEnd")

    if (normalized_start is None) != (normalized_end is None):
        raise ValueError("periodStart and periodEnd must both be provided when setting a reporting period.")

    if normalized_start is None or normalized_end is None:
        period_end_date = datetime.now(resolved_timezone).date()
        period_start_date = period_end_date - timedelta(days=6)
        return period_start_date, period_end_date, resolved_timezone_name, resolved_timezone

    period_start_date = date.fromisoformat(normalized_start)
    period_end_date = date.fromisoformat(normalized_end)
    if period_start_date > period_end_date:
        raise ValueError("periodStart cannot be after periodEnd.")
    return period_start_date, period_end_date, resolved_timezone_name, resolved_timezone


def _parse_source_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    candidate = str(value).strip()
    if not candidate:
        return None

    normalized = f"{candidate[:-1]}+00:00" if candidate.endswith("Z") else candidate
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        parsed = None
        for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f"):
            try:
                parsed = datetime.strptime(candidate, pattern)
                break
            except ValueError:
                continue
        if parsed is None:
            return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _is_done_issue(row: sqlite3.Row) -> bool:
    status_category = str(row["status_category"] or "").strip().lower()
    status_name = str(row["status_name"] or "").strip().lower()
    return (
        status_category == "done"
        or status_name in {"done", "closed", "resolved"}
        or row["resolved_at_source"] is not None
    )


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
    started_at = str(row["started_at"] or "").strip()
    return started_at or None


def _current_full_sync_issue_clause(conn: sqlite3.Connection, issue_alias: str = "i") -> tuple[str, list[Any]]:
    latest_full_sync_started_at = _latest_completed_full_sync_started_at(conn)
    if latest_full_sync_started_at is None:
        return "", []
    return f"AND datetime({issue_alias}.synced_at) >= datetime(?)", [latest_full_sync_started_at]


def _is_completed_in_period(
    row: sqlite3.Row,
    *,
    period_start_date: date,
    period_end_date: date,
    reporting_timezone: ZoneInfo,
) -> bool:
    timestamp_raw = row["resolved_at_source"] or row["updated_at_source"] or row["synced_at"]
    event_at = _parse_source_datetime(timestamp_raw)
    if event_at is None:
        return False
    local_event_date = event_at.astimezone(reporting_timezone).date()
    return period_start_date <= local_event_date <= period_end_date


def _normalize_int_ids(
    values: list[int] | None,
    field_name: str,
    *,
    max_items: int | None = None,
) -> list[int]:
    if not values:
        return []
    deduped: list[int] = []
    seen: set[int] = set()
    for raw in values:
        try:
            value = int(raw)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{field_name} must contain integer ids.") from exc
        if value <= 0:
            raise ValueError(f"{field_name} must contain positive integer ids.")
        if value in seen:
            continue
        seen.add(value)
        deduped.append(value)
    if max_items is not None and len(deduped) > max_items:
        raise ValueError(f"{field_name} can contain at most {max_items} id.")
    return deduped


def _fetch_lookup_items(conn: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        f"""
        SELECT id, name
        FROM {table}
        ORDER BY LOWER(name) ASC, id ASC
        """
    ).fetchall()
    return [{"id": int(row["id"]), "name": str(row["name"])} for row in rows]


def get_epic_lookup_config(db_path: str | None = None) -> dict[str, Any]:
    resolved_db_path = db_path or _resolve_db_path()
    conn = _connect(resolved_db_path)
    try:
        _ensure_metadata_schema(conn)
        groups = _fetch_lookup_items(conn, "epic_groups")
        work_types = _fetch_lookup_items(conn, "work_types")
    finally:
        conn.close()
    return {"groups": groups, "workTypes": work_types}


def _read_view_epic_keys(conn: sqlite3.Connection, view_id: int) -> list[str]:
    rows = conn.execute(
        """
        SELECT em.epic_key
        FROM initiative_view_epics ive
        JOIN epic_metadata em ON em.id = ive.epic_metadata_id
        WHERE ive.view_id = ?
        ORDER BY ive.sort_order ASC, em.epic_key ASC
        """,
        (view_id,),
    ).fetchall()
    return [str(row["epic_key"]) for row in rows]


def _read_initiative_view(conn: sqlite3.Connection, view_id: int) -> dict[str, Any] | None:
    row = conn.execute(
        """
        SELECT id, name, description, updated_at
        FROM initiative_views
        WHERE id = ?
        LIMIT 1
        """,
        (view_id,),
    ).fetchone()
    if row is None:
        return None
    epic_keys = _read_view_epic_keys(conn, view_id)
    description = row["description"]
    return {
        "id": int(row["id"]),
        "name": str(row["name"]),
        "description": str(description).strip() if description is not None and str(description).strip() else None,
        "epicKeys": epic_keys,
        "epicCount": len(epic_keys),
        "isDefault": False,
        "updatedAt": row["updated_at"],
    }


def _read_all_configured_view(conn: sqlite3.Connection) -> dict[str, Any]:
    count_row = conn.execute("SELECT COUNT(*) AS count FROM epic_metadata").fetchone()
    epic_count = int(count_row["count"] or 0) if count_row is not None else 0
    return {
        "id": "all",
        "name": "All Configured",
        "description": "All epics with metadata configured in TeamBeacon.",
        "epicKeys": [],
        "epicCount": epic_count,
        "isDefault": True,
        "updatedAt": None,
    }


def _resolve_view_payload(conn: sqlite3.Connection, view_id: int | None) -> dict[str, Any]:
    if view_id is None:
        return _read_all_configured_view(conn)
    view = _read_initiative_view(conn, view_id)
    if view is None:
        raise ValueError(f"viewId {view_id} was not found.")
    return view


def get_initiative_views(db_path: str | None = None) -> dict[str, Any]:
    resolved_db_path = db_path or _resolve_db_path()
    conn = _connect(resolved_db_path)
    try:
        _ensure_metadata_schema(conn)
        rows = conn.execute(
            """
            SELECT id
            FROM initiative_views
            ORDER BY LOWER(name) ASC, id ASC
            """
        ).fetchall()
        views = [_read_all_configured_view(conn)]
        for row in rows:
            view = _read_initiative_view(conn, int(row["id"]))
            if view is not None:
                views.append(view)
    finally:
        conn.close()
    return {"views": views}


def _replace_view_epics(conn: sqlite3.Connection, view_id: int, epic_keys: list[str]) -> None:
    conn.execute("DELETE FROM initiative_view_epics WHERE view_id = ?", (view_id,))
    if not epic_keys:
        return

    placeholders = ",".join("?" for _ in epic_keys)
    rows = conn.execute(
        f"""
        SELECT id, epic_key
        FROM epic_metadata
        WHERE epic_key IN ({placeholders})
        """,
        epic_keys,
    ).fetchall()
    metadata_id_by_key = {str(row["epic_key"]): int(row["id"]) for row in rows}
    missing = [epic_key for epic_key in epic_keys if epic_key not in metadata_id_by_key]
    if missing:
        raise ValueError(f"Cannot add unconfigured epic keys to a view: {missing}.")

    for index, epic_key in enumerate(epic_keys):
        conn.execute(
            """
            INSERT INTO initiative_view_epics (view_id, epic_metadata_id, sort_order)
            VALUES (?, ?, ?)
            """,
            (view_id, metadata_id_by_key[epic_key], index),
        )


def create_initiative_view(
    *,
    name: str,
    epic_keys: list[str] | None = None,
    description: str | None = None,
    db_path: str | None = None,
) -> dict[str, Any]:
    normalized_name = _normalize_name(name)
    normalized_description = _normalize_optional_description(description)
    normalized_epic_keys = _normalize_epic_key_list(epic_keys)
    resolved_db_path = db_path or _resolve_db_path()
    conn = _connect(resolved_db_path)
    try:
        _ensure_metadata_schema(conn)
        try:
            cursor = conn.execute(
                """
                INSERT INTO initiative_views (name, description, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                """,
                (normalized_name, normalized_description),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError(f'View "{normalized_name}" already exists.') from exc
        view_id = int(cursor.lastrowid)
        _replace_view_epics(conn, view_id, normalized_epic_keys)
        view = _read_initiative_view(conn, view_id)
        conn.commit()
    finally:
        conn.close()

    if view is None:
        raise RuntimeError("Initiative view row was not persisted.")
    return view


def update_initiative_view(
    *,
    view_id: int | str,
    name: str,
    epic_keys: list[str] | None = None,
    description: str | None = None,
    db_path: str | None = None,
) -> dict[str, Any]:
    normalized_view_id = _normalize_view_id(view_id)
    normalized_name = _normalize_name(name)
    normalized_description = _normalize_optional_description(description)
    normalized_epic_keys = _normalize_epic_key_list(epic_keys)
    resolved_db_path = db_path or _resolve_db_path()
    conn = _connect(resolved_db_path)
    try:
        _ensure_metadata_schema(conn)
        existing = conn.execute(
            "SELECT id FROM initiative_views WHERE id = ? LIMIT 1",
            (normalized_view_id,),
        ).fetchone()
        if existing is None:
            raise ValueError(f"viewId {normalized_view_id} was not found.")

        try:
            conn.execute(
                """
                UPDATE initiative_views
                SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (normalized_name, normalized_description, normalized_view_id),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError(f'View "{normalized_name}" already exists.') from exc
        _replace_view_epics(conn, normalized_view_id, normalized_epic_keys)
        view = _read_initiative_view(conn, normalized_view_id)
        conn.commit()
    finally:
        conn.close()

    if view is None:
        raise RuntimeError("Initiative view row was not persisted.")
    return view


def delete_initiative_view(view_id: int | str, db_path: str | None = None) -> dict[str, Any]:
    normalized_view_id = _normalize_view_id(view_id)
    resolved_db_path = db_path or _resolve_db_path()
    conn = _connect(resolved_db_path)
    try:
        _ensure_metadata_schema(conn)
        existing = conn.execute(
            "SELECT id FROM initiative_views WHERE id = ? LIMIT 1",
            (normalized_view_id,),
        ).fetchone()
        if existing is None:
            raise ValueError(f"viewId {normalized_view_id} was not found.")
        mapping_result = conn.execute(
            "DELETE FROM initiative_view_epics WHERE view_id = ?",
            (normalized_view_id,),
        )
        view_result = conn.execute(
            "DELETE FROM initiative_views WHERE id = ?",
            (normalized_view_id,),
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "id": normalized_view_id,
        "deleted": True,
        "removedMappings": int(mapping_result.rowcount or 0),
        "removedRows": int(view_result.rowcount or 0),
    }


def search_unconfigured_epics(
    *,
    query: str | None = None,
    limit: int = 20,
    db_path: str | None = None,
) -> dict[str, Any]:
    resolved_db_path = db_path or _resolve_db_path()
    normalized_query = (query or "").strip().casefold()
    safe_limit = max(1, min(int(limit), 100))

    conn = _connect(resolved_db_path)
    try:
        _ensure_metadata_schema(conn)
        rows = conn.execute(
            """
            SELECT i.issue_key, i.summary
            FROM issues i
            LEFT JOIN epic_metadata em ON em.epic_key = i.issue_key
            WHERE em.epic_key IS NULL
              AND LOWER(COALESCE(i.issue_type, '')) = 'epic'
              AND (
                ? = ''
                OR LOWER(i.issue_key) LIKE '%' || ? || '%'
                OR LOWER(COALESCE(i.summary, '')) LIKE '%' || ? || '%'
              )
            ORDER BY datetime(i.updated_at_source) DESC, i.issue_key ASC
            LIMIT ?
            """,
            (normalized_query, normalized_query, normalized_query, safe_limit),
        ).fetchall()
    finally:
        conn.close()

    epics = [
        {
            "epicKey": str(row["issue_key"]),
            "epicName": str(row["summary"]) if row["summary"] is not None else "",
        }
        for row in rows
    ]
    return {"epics": epics}


def _insert_lookup_item(table: str, name: str, db_path: str | None = None) -> dict[str, Any]:
    normalized_name = _normalize_name(name)
    resolved_db_path = db_path or _resolve_db_path()
    conn = _connect(resolved_db_path)
    try:
        _ensure_metadata_schema(conn)
        conn.execute(
            f"""
            INSERT INTO {table} (name, updated_at)
            VALUES (?, CURRENT_TIMESTAMP)
            ON CONFLICT(name) DO UPDATE SET
              updated_at = CURRENT_TIMESTAMP
            """,
            (normalized_name,),
        )
        row = conn.execute(
            f"""
            SELECT id, name
            FROM {table}
            WHERE name = ?
            LIMIT 1
            """,
            (normalized_name,),
        ).fetchone()
        conn.commit()
    finally:
        conn.close()

    if row is None:
        raise RuntimeError("Lookup row was not persisted.")
    return {"id": int(row["id"]), "name": str(row["name"])}


def _update_lookup_item(
    table: str,
    lookup_id: int | str,
    name: str,
    db_path: str | None = None,
) -> dict[str, Any]:
    normalized_id = _normalize_lookup_id(lookup_id)
    normalized_name = _normalize_name(name)
    resolved_db_path = db_path or _resolve_db_path()
    conn = _connect(resolved_db_path)
    try:
        _ensure_metadata_schema(conn)
        existing = conn.execute(
            f"SELECT id FROM {table} WHERE id = ? LIMIT 1",
            (normalized_id,),
        ).fetchone()
        if existing is None:
            raise ValueError(f"id {normalized_id} was not found.")

        try:
            conn.execute(
                f"""
                UPDATE {table}
                SET name = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (normalized_name, normalized_id),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError(f'Name "{normalized_name}" already exists.') from exc

        row = conn.execute(
            f"SELECT id, name FROM {table} WHERE id = ? LIMIT 1",
            (normalized_id,),
        ).fetchone()
        conn.commit()
    finally:
        conn.close()

    if row is None:
        raise RuntimeError("Lookup row was not persisted.")
    return {"id": int(row["id"]), "name": str(row["name"])}


def _delete_lookup_item(
    *,
    table: str,
    mapping_table: str,
    mapping_column: str,
    lookup_id: int | str,
    db_path: str | None = None,
) -> dict[str, Any]:
    normalized_id = _normalize_lookup_id(lookup_id)
    resolved_db_path = db_path or _resolve_db_path()
    conn = _connect(resolved_db_path)
    try:
        _ensure_metadata_schema(conn)
        existing = conn.execute(
            f"SELECT id FROM {table} WHERE id = ? LIMIT 1",
            (normalized_id,),
        ).fetchone()
        if existing is None:
            raise ValueError(f"id {normalized_id} was not found.")

        mapping_result = conn.execute(
            f"DELETE FROM {mapping_table} WHERE {mapping_column} = ?",
            (normalized_id,),
        )
        lookup_result = conn.execute(
            f"DELETE FROM {table} WHERE id = ?",
            (normalized_id,),
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "id": normalized_id,
        "deleted": True,
        "removedMappings": int(mapping_result.rowcount or 0),
        "removedLookupRows": int(lookup_result.rowcount or 0),
    }


def add_epic_group(name: str, db_path: str | None = None) -> dict[str, Any]:
    return _insert_lookup_item("epic_groups", name, db_path=db_path)


def add_work_type(name: str, db_path: str | None = None) -> dict[str, Any]:
    return _insert_lookup_item("work_types", name, db_path=db_path)


def update_epic_group(lookup_id: int | str, name: str, db_path: str | None = None) -> dict[str, Any]:
    return _update_lookup_item("epic_groups", lookup_id, name, db_path=db_path)


def update_work_type(lookup_id: int | str, name: str, db_path: str | None = None) -> dict[str, Any]:
    return _update_lookup_item("work_types", lookup_id, name, db_path=db_path)


def delete_epic_group(lookup_id: int | str, db_path: str | None = None) -> dict[str, Any]:
    return _delete_lookup_item(
        table="epic_groups",
        mapping_table="epic_metadata_groups",
        mapping_column="group_id",
        lookup_id=lookup_id,
        db_path=db_path,
    )


def delete_work_type(lookup_id: int | str, db_path: str | None = None) -> dict[str, Any]:
    return _delete_lookup_item(
        table="work_types",
        mapping_table="epic_metadata_work_types",
        mapping_column="work_type_id",
        lookup_id=lookup_id,
        db_path=db_path,
    )


def delete_epic_metadata(
    epic_key: str,
    db_path: str | None = None,
) -> dict[str, Any]:
    normalized_key = _normalize_epic_key(epic_key)
    resolved_db_path = db_path or _resolve_db_path()
    conn = _connect(resolved_db_path)
    try:
        _ensure_metadata_schema(conn)
        row = conn.execute(
            """
            SELECT id
            FROM epic_metadata
            WHERE epic_key = ?
            LIMIT 1
            """,
            (normalized_key,),
        ).fetchone()
        if row is None:
            raise ValueError(f"epicKey {normalized_key} is not configured.")

        metadata_id = int(row["id"])
        group_result = conn.execute(
            "DELETE FROM epic_metadata_groups WHERE epic_metadata_id = ?",
            (metadata_id,),
        )
        work_type_result = conn.execute(
            "DELETE FROM epic_metadata_work_types WHERE epic_metadata_id = ?",
            (metadata_id,),
        )
        view_result = conn.execute(
            "DELETE FROM initiative_view_epics WHERE epic_metadata_id = ?",
            (metadata_id,),
        )
        metadata_result = conn.execute(
            "DELETE FROM epic_metadata WHERE id = ?",
            (metadata_id,),
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "epicKey": normalized_key,
        "deleted": True,
        "removedGroupMappings": int(group_result.rowcount or 0),
        "removedWorkTypeMappings": int(work_type_result.rowcount or 0),
        "removedViewMappings": int(view_result.rowcount or 0),
        "removedMetadataRows": int(metadata_result.rowcount or 0),
    }


def _validate_lookup_ids(
    conn: sqlite3.Connection,
    *,
    group_ids: list[int],
    work_type_ids: list[int],
) -> None:
    if group_ids:
        placeholders = ",".join("?" for _ in group_ids)
        rows = conn.execute(
            f"SELECT id FROM epic_groups WHERE id IN ({placeholders})",
            group_ids,
        ).fetchall()
        found = {int(row["id"]) for row in rows}
        missing = [group_id for group_id in group_ids if group_id not in found]
        if missing:
            raise ValueError(f"Unknown group ids: {missing}.")

    if work_type_ids:
        placeholders = ",".join("?" for _ in work_type_ids)
        rows = conn.execute(
            f"SELECT id FROM work_types WHERE id IN ({placeholders})",
            work_type_ids,
        ).fetchall()
        found = {int(row["id"]) for row in rows}
        missing = [work_type_id for work_type_id in work_type_ids if work_type_id not in found]
        if missing:
            raise ValueError(f"Unknown work type ids: {missing}.")


def _read_epic_metadata_entry(conn: sqlite3.Connection, epic_key: str) -> dict[str, Any] | None:
    epic_row = conn.execute(
        """
        SELECT
          id,
          epic_key,
          epic_name,
          success_criteria_json,
          timeline_enabled,
          timeline_start_date,
          target_completion_date,
          updated_at
        FROM epic_metadata
        WHERE epic_key = ?
        LIMIT 1
        """,
        (epic_key,),
    ).fetchone()
    if epic_row is None:
        return None

    metadata_id = int(epic_row["id"])
    synced_epic_name = _resolve_epic_name_from_issues(conn, epic_key)
    if synced_epic_name:
        epic_title = synced_epic_name
    else:
        persisted_epic_name = epic_row["epic_name"]
        epic_title = str(persisted_epic_name).strip() if persisted_epic_name is not None else None
    criteria_raw = epic_row["success_criteria_json"] or "[]"
    try:
        criteria = json.loads(criteria_raw)
    except json.JSONDecodeError:
        criteria = []
    if not isinstance(criteria, list):
        criteria = []
    success_criteria = [str(item) for item in criteria if isinstance(item, str)]

    group_rows = conn.execute(
        """
        SELECT g.id, g.name
        FROM epic_metadata_groups mg
        JOIN epic_groups g ON g.id = mg.group_id
        WHERE mg.epic_metadata_id = ?
        ORDER BY LOWER(g.name) ASC, g.id ASC
        """,
        (metadata_id,),
    ).fetchall()
    work_type_rows = conn.execute(
        """
        SELECT wt.id, wt.name
        FROM epic_metadata_work_types mwt
        JOIN work_types wt ON wt.id = mwt.work_type_id
        WHERE mwt.epic_metadata_id = ?
        ORDER BY LOWER(wt.name) ASC, wt.id ASC
        """,
        (metadata_id,),
    ).fetchall()

    groups = [{"id": int(row["id"]), "name": str(row["name"])} for row in group_rows]
    work_types = [{"id": int(row["id"]), "name": str(row["name"])} for row in work_type_rows]

    return {
        "epicKey": str(epic_row["epic_key"]),
        "epicTitle": epic_title,
        "successCriteria": success_criteria,
        "timelineEnabled": bool(int(epic_row["timeline_enabled"] or 0)),
        "timelineStartDate": (
            str(epic_row["timeline_start_date"]).strip()
            if epic_row["timeline_start_date"] is not None and str(epic_row["timeline_start_date"]).strip()
            else None
        ),
        "targetCompletionDate": (
            str(epic_row["target_completion_date"]).strip()
            if epic_row["target_completion_date"] is not None and str(epic_row["target_completion_date"]).strip()
            else None
        ),
        "groupIds": [group["id"] for group in groups],
        "groups": groups,
        "workTypeIds": [work_type["id"] for work_type in work_types],
        "workTypes": work_types,
        "updatedAt": epic_row["updated_at"],
    }


def get_epic_metadata(
    *,
    epic_key: str | None = None,
    limit: int = 50,
    db_path: str | None = None,
) -> dict[str, Any]:
    resolved_db_path = db_path or _resolve_db_path()
    safe_limit = max(1, min(int(limit), 200))
    conn = _connect(resolved_db_path)
    try:
        _ensure_metadata_schema(conn)
        if epic_key:
            normalized_key = _normalize_epic_key(epic_key)
            entry = _read_epic_metadata_entry(conn, normalized_key)
            return {"epics": [] if entry is None else [entry]}

        rows = conn.execute(
            """
            SELECT epic_key
            FROM epic_metadata
            ORDER BY datetime(updated_at) DESC, epic_key ASC
            LIMIT ?
            """,
            (safe_limit,),
        ).fetchall()
        entries: list[dict[str, Any]] = []
        for row in rows:
            entry = _read_epic_metadata_entry(conn, str(row["epic_key"]))
            if entry is not None:
                entries.append(entry)
    finally:
        conn.close()
    return {"epics": entries}


def _read_epic_completion_metrics(
    conn: sqlite3.Connection,
    epic_key: str,
    *,
    period_start_date: date,
    period_end_date: date,
    reporting_timezone: ZoneInfo,
) -> tuple[int, int, int]:
    current_scope_clause, current_scope_params = _current_full_sync_issue_clause(conn, "i")
    rows = conn.execute(
        f"""
        SELECT
          i.status_name,
          i.status_category,
          i.resolved_at_source,
          i.updated_at_source,
          i.synced_at
        FROM issues i
        WHERE i.issue_key <> ?
          AND LOWER(COALESCE(i.issue_type, '')) <> 'epic'
          AND (
            i.epic_key = ?
            OR i.parent_issue_key = ?
            OR EXISTS (
              SELECT 1
              FROM issues p
              WHERE p.issue_key = i.parent_issue_key
                AND p.epic_key = ?
            )
          )
          {current_scope_clause}
        """,
        [epic_key, epic_key, epic_key, epic_key, *current_scope_params],
    ).fetchall()
    total_cards = len(rows)
    completed_cards = 0
    completed_in_period = 0
    for row in rows:
        if not _is_done_issue(row):
            continue
        completed_cards += 1
        if _is_completed_in_period(
            row,
            period_start_date=period_start_date,
            period_end_date=period_end_date,
            reporting_timezone=reporting_timezone,
        ):
            completed_in_period += 1

    return (total_cards, completed_cards, completed_in_period)


def _fetch_configured_epic_rows(
    conn: sqlite3.Connection,
    *,
    limit: int | None = None,
    view_id: int | str | None = None,
) -> tuple[list[sqlite3.Row], dict[str, Any]]:
    normalized_view_id = _normalize_optional_view_id(view_id)
    view = _resolve_view_payload(conn, normalized_view_id)
    limit_clause = "" if limit is None else "LIMIT ?"

    if normalized_view_id is None:
        params: list[Any] = [] if limit is None else [limit]
        rows = conn.execute(
            f"""
            SELECT
              em.epic_key,
              em.epic_name,
              em.updated_at,
              i.summary AS issue_summary
            FROM epic_metadata em
            LEFT JOIN issues i ON i.issue_key = em.epic_key
            ORDER BY datetime(em.updated_at) DESC, em.epic_key ASC
            {limit_clause}
            """,
            params,
        ).fetchall()
        return rows, view

    params = [normalized_view_id] if limit is None else [normalized_view_id, limit]
    rows = conn.execute(
        f"""
        SELECT
          em.epic_key,
          em.epic_name,
          em.updated_at,
          i.summary AS issue_summary
        FROM initiative_view_epics ive
        JOIN epic_metadata em ON em.id = ive.epic_metadata_id
        LEFT JOIN issues i ON i.issue_key = em.epic_key
        WHERE ive.view_id = ?
        ORDER BY ive.sort_order ASC, em.epic_key ASC
        {limit_clause}
        """,
        params,
    ).fetchall()
    return rows, view


def get_configured_epic_summary(
    *,
    limit: int = 50,
    period_start: str | None = None,
    period_end: str | None = None,
    timezone_name: str | None = None,
    view_id: int | str | None = None,
    db_path: str | None = None,
) -> dict[str, Any]:
    resolved_db_path = db_path or _resolve_db_path()
    safe_limit = max(1, min(int(limit), 200))
    (
        period_start_date,
        period_end_date,
        resolved_timezone_name,
        resolved_timezone,
    ) = _resolve_reporting_period(
        period_start=period_start,
        period_end=period_end,
        timezone_name=timezone_name,
    )

    conn = _connect(resolved_db_path)
    try:
        _ensure_metadata_schema(conn)
        rows, view = _fetch_configured_epic_rows(conn, limit=safe_limit, view_id=view_id)

        epics: list[dict[str, Any]] = []
        for row in rows:
            epic_key = str(row["epic_key"])
            metadata_entry = _read_epic_metadata_entry(conn, epic_key)
            epic_name_raw = row["epic_name"] if row["epic_name"] is not None else row["issue_summary"]
            if metadata_entry and metadata_entry.get("epicTitle"):
                epic_name_raw = metadata_entry.get("epicTitle")
            epic_name = str(epic_name_raw).strip() if epic_name_raw is not None else ""
            total_cards, completed_cards, completed_in_period = _read_epic_completion_metrics(
                conn,
                epic_key,
                period_start_date=period_start_date,
                period_end_date=period_end_date,
                reporting_timezone=resolved_timezone,
            )
            completion_percent = round((completed_cards / total_cards) * 100, 1) if total_cards > 0 else 0.0
            delta_percent = round((completed_in_period / total_cards) * 100, 1) if total_cards > 0 else 0.0
            success_criteria = (
                [str(item) for item in metadata_entry.get("successCriteria", []) if isinstance(item, str)]
                if metadata_entry
                else []
            )
            timeline_enabled = bool(metadata_entry.get("timelineEnabled")) if metadata_entry else False
            timeline_start_date = (
                str(metadata_entry["timelineStartDate"]).strip()
                if metadata_entry and metadata_entry.get("timelineStartDate")
                else None
            )
            target_completion_date = (
                str(metadata_entry["targetCompletionDate"]).strip()
                if metadata_entry and metadata_entry.get("targetCompletionDate")
                else None
            )
            groups = metadata_entry.get("groups", []) if metadata_entry else []
            work_types = metadata_entry.get("workTypes", []) if metadata_entry else []
            epics.append(
                {
                    "epicKey": epic_key,
                    "epicName": epic_name,
                    "completedCards": completed_cards,
                    "totalCards": total_cards,
                    "completionPercent": completion_percent,
                    "completedLastWeek": completed_in_period,
                    "deltaPercent": delta_percent,
                    "completedInPeriod": completed_in_period,
                    "deltaPercentInPeriod": delta_percent,
                    "groups": groups,
                    "workTypes": work_types,
                    "successCriteria": success_criteria,
                    "timelineEnabled": timeline_enabled,
                    "timelineStartDate": timeline_start_date,
                    "targetCompletionDate": target_completion_date,
                    "ragScore": None,
                    "insightComment": None,
                    "updatedAt": row["updated_at"],
                }
            )
    finally:
        conn.close()
    return {
        "epics": epics,
        "reportingPeriod": {
            "startDate": period_start_date.isoformat(),
            "endDate": period_end_date.isoformat(),
            "days": (period_end_date - period_start_date).days + 1,
            "timezone": resolved_timezone_name,
        },
        "view": view,
    }


def get_epic_completed_cards(
    *,
    epic_key: str,
    limit: int = 200,
    period_start: str | None = None,
    period_end: str | None = None,
    timezone_name: str | None = None,
    db_path: str | None = None,
) -> dict[str, Any]:
    normalized_key = _normalize_epic_key(epic_key)
    safe_limit = max(1, min(int(limit), 500))
    (
        period_start_date,
        period_end_date,
        resolved_timezone_name,
        resolved_timezone,
    ) = _resolve_reporting_period(
        period_start=period_start,
        period_end=period_end,
        timezone_name=timezone_name,
    )

    resolved_db_path = db_path or _resolve_db_path()
    conn = _connect(resolved_db_path)
    try:
        _ensure_metadata_schema(conn)
        current_scope_clause, current_scope_params = _current_full_sync_issue_clause(conn, "i")
        rows = conn.execute(
            f"""
            SELECT
              i.issue_key,
              i.summary,
              i.status_name,
              i.status_category,
              i.story_points,
              i.assignee_account_id,
              i.resolved_at_source,
              i.updated_at_source,
              i.synced_at
            FROM issues i
            WHERE i.issue_key <> ?
              AND LOWER(COALESCE(i.issue_type, '')) <> 'epic'
              AND (
                i.epic_key = ?
                OR i.parent_issue_key = ?
                OR EXISTS (
                  SELECT 1
                  FROM issues p
                  WHERE p.issue_key = i.parent_issue_key
                    AND p.epic_key = ?
                )
              )
              {current_scope_clause}
            ORDER BY datetime(COALESCE(i.resolved_at_source, i.updated_at_source, i.synced_at)) DESC, i.issue_key ASC
            """,
            [normalized_key, normalized_key, normalized_key, normalized_key, *current_scope_params],
        ).fetchall()

        epic_name = _resolve_epic_name_from_issues(conn, normalized_key)

        completed_cards: list[dict[str, Any]] = []
        completed_count = 0
        for row in rows:
            if not _is_done_issue(row):
                continue
            if not _is_completed_in_period(
                row,
                period_start_date=period_start_date,
                period_end_date=period_end_date,
                reporting_timezone=resolved_timezone,
            ):
                continue

            completed_count += 1
            if len(completed_cards) >= safe_limit:
                continue

            completed_at_raw = row["resolved_at_source"] or row["updated_at_source"] or row["synced_at"]
            completed_at = _parse_source_datetime(completed_at_raw)
            completed_cards.append(
                {
                    "issueKey": row["issue_key"],
                    "summary": row["summary"],
                    "status": row["status_name"],
                    "statusCategory": row["status_category"],
                    "storyPoints": row["story_points"],
                    "assigneeAccountId": row["assignee_account_id"],
                    "completedAt": completed_at.isoformat() if completed_at is not None else None,
                }
            )
    finally:
        conn.close()

    return {
        "source": "local",
        "epicKey": normalized_key,
        "epicName": epic_name,
        "count": completed_count,
        "limit": safe_limit,
        "truncated": completed_count > len(completed_cards),
        "completedCards": completed_cards,
        "reportingPeriod": {
            "startDate": period_start_date.isoformat(),
            "endDate": period_end_date.isoformat(),
            "days": (period_end_date - period_start_date).days + 1,
            "timezone": resolved_timezone_name,
        },
    }


def get_configured_epics_completed_cards(
    *,
    limit: int = 300,
    period_start: str | None = None,
    period_end: str | None = None,
    timezone_name: str | None = None,
    view_id: int | str | None = None,
    db_path: str | None = None,
) -> dict[str, Any]:
    safe_limit = max(1, min(int(limit), 1000))
    (
        period_start_date,
        period_end_date,
        resolved_timezone_name,
        resolved_timezone,
    ) = _resolve_reporting_period(
        period_start=period_start,
        period_end=period_end,
        timezone_name=timezone_name,
    )

    resolved_db_path = db_path or _resolve_db_path()
    conn = _connect(resolved_db_path)
    try:
        _ensure_metadata_schema(conn)
        configured_rows, view = _fetch_configured_epic_rows(conn, view_id=view_id)

        configured_epic_keys = [str(row["epic_key"]) for row in configured_rows]
        if not configured_epic_keys:
            return {
                "source": "local",
                "scope": "configured",
                "count": 0,
                "limit": safe_limit,
                "truncated": False,
                "completedCards": [],
                "perEpicCounts": {},
                "reportingPeriod": {
                    "startDate": period_start_date.isoformat(),
                    "endDate": period_end_date.isoformat(),
                    "days": (period_end_date - period_start_date).days + 1,
                    "timezone": resolved_timezone_name,
                },
                "view": view,
            }

        epic_name_by_key: dict[str, str] = {}
        for row in configured_rows:
            key = str(row["epic_key"])
            name_raw = row["epic_name"] if row["epic_name"] is not None else row["issue_summary"]
            name = str(name_raw).strip() if name_raw is not None else ""
            epic_name_by_key[key] = name

        placeholders = ",".join("?" for _ in configured_epic_keys)
        current_scope_clause, current_scope_params = _current_full_sync_issue_clause(conn, "i")
        query = f"""
            SELECT
              i.issue_key,
              i.summary,
              i.status_name,
              i.status_category,
              i.story_points,
              i.assignee_account_id,
              i.resolved_at_source,
              i.updated_at_source,
              i.synced_at,
              i.epic_key,
              i.parent_issue_key,
              p.epic_key AS parent_epic_key
            FROM issues i
            LEFT JOIN issues p ON p.issue_key = i.parent_issue_key
            WHERE LOWER(COALESCE(i.issue_type, '')) <> 'epic'
              AND (
                i.epic_key IN ({placeholders})
                OR i.parent_issue_key IN ({placeholders})
                OR p.epic_key IN ({placeholders})
              )
              {current_scope_clause}
            ORDER BY datetime(COALESCE(i.resolved_at_source, i.updated_at_source, i.synced_at)) DESC, i.issue_key ASC
        """
        params = configured_epic_keys + configured_epic_keys + configured_epic_keys + current_scope_params
        issue_rows = conn.execute(query, params).fetchall()

        configured_epic_set = set(configured_epic_keys)
        completed_cards: list[dict[str, Any]] = []
        per_epic_counts: dict[str, int] = {}
        completed_count = 0
        for row in issue_rows:
            if not _is_done_issue(row):
                continue
            if not _is_completed_in_period(
                row,
                period_start_date=period_start_date,
                period_end_date=period_end_date,
                reporting_timezone=resolved_timezone,
            ):
                continue

            owning_epic_key = None
            raw_epic_key = str(row["epic_key"] or "").strip()
            raw_parent_key = str(row["parent_issue_key"] or "").strip()
            raw_parent_epic_key = str(row["parent_epic_key"] or "").strip()
            if raw_epic_key in configured_epic_set:
                owning_epic_key = raw_epic_key
            elif raw_parent_key in configured_epic_set:
                owning_epic_key = raw_parent_key
            elif raw_parent_epic_key in configured_epic_set:
                owning_epic_key = raw_parent_epic_key
            if not owning_epic_key:
                continue

            completed_count += 1
            per_epic_counts[owning_epic_key] = per_epic_counts.get(owning_epic_key, 0) + 1
            if len(completed_cards) >= safe_limit:
                continue

            completed_at_raw = row["resolved_at_source"] or row["updated_at_source"] or row["synced_at"]
            completed_at = _parse_source_datetime(completed_at_raw)
            completed_cards.append(
                {
                    "issueKey": row["issue_key"],
                    "summary": row["summary"],
                    "status": row["status_name"],
                    "statusCategory": row["status_category"],
                    "storyPoints": row["story_points"],
                    "assigneeAccountId": row["assignee_account_id"],
                    "completedAt": completed_at.isoformat() if completed_at is not None else None,
                    "epicKey": owning_epic_key,
                    "epicName": epic_name_by_key.get(owning_epic_key) or owning_epic_key,
                }
            )
    finally:
        conn.close()

    return {
        "source": "local",
        "scope": "configured",
        "count": completed_count,
        "limit": safe_limit,
        "truncated": completed_count > len(completed_cards),
        "completedCards": completed_cards,
        "perEpicCounts": per_epic_counts,
        "reportingPeriod": {
            "startDate": period_start_date.isoformat(),
            "endDate": period_end_date.isoformat(),
            "days": (period_end_date - period_start_date).days + 1,
            "timezone": resolved_timezone_name,
        },
        "view": view,
    }


def upsert_epic_metadata(
    *,
    epic_key: str,
    success_criteria: list[str] | None,
    group_ids: list[int] | None,
    work_type_ids: list[int] | None,
    timeline_enabled: bool | None = None,
    timeline_start_date: str | None = None,
    target_completion_date: str | None = None,
    db_path: str | None = None,
) -> dict[str, Any]:
    normalized_key = _normalize_epic_key(epic_key)
    normalized_criteria = _normalize_criteria(success_criteria)
    normalized_group_ids = _normalize_int_ids(group_ids, "groupIds", max_items=1)
    normalized_work_type_ids = _normalize_int_ids(work_type_ids, "workTypeIds", max_items=1)
    normalized_timeline_enabled = _normalize_timeline_enabled(timeline_enabled)
    normalized_timeline_start_date = _normalize_timeline_start_date(timeline_start_date)
    normalized_target_completion_date = _normalize_target_completion_date(
        target_completion_date,
        timeline_enabled=normalized_timeline_enabled,
    )
    if not normalized_timeline_enabled:
        normalized_timeline_start_date = None
        normalized_target_completion_date = None
    if (
        normalized_timeline_start_date is not None
        and normalized_target_completion_date is not None
        and normalized_timeline_start_date > normalized_target_completion_date
    ):
        raise ValueError("timelineStartDate cannot be after targetCompletionDate.")

    resolved_db_path = db_path or _resolve_db_path()
    conn = _connect(resolved_db_path)
    try:
        _ensure_metadata_schema(conn)
        epic_name = _resolve_epic_name_from_issues(conn, normalized_key)
        _validate_lookup_ids(
            conn,
            group_ids=normalized_group_ids,
            work_type_ids=normalized_work_type_ids,
        )
        conn.execute(
            """
            INSERT INTO epic_metadata (
              epic_key,
              epic_name,
              success_criteria_json,
              timeline_enabled,
              timeline_start_date,
              target_completion_date,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(epic_key) DO UPDATE SET
              epic_name = COALESCE(excluded.epic_name, epic_metadata.epic_name),
              success_criteria_json = excluded.success_criteria_json,
              timeline_enabled = excluded.timeline_enabled,
              timeline_start_date = excluded.timeline_start_date,
              target_completion_date = excluded.target_completion_date,
              updated_at = CURRENT_TIMESTAMP
            """,
            (
                normalized_key,
                epic_name,
                json.dumps(normalized_criteria, separators=(",", ":"), ensure_ascii=False),
                1 if normalized_timeline_enabled else 0,
                normalized_timeline_start_date,
                normalized_target_completion_date,
            ),
        )
        row = conn.execute(
            "SELECT id FROM epic_metadata WHERE epic_key = ? LIMIT 1",
            (normalized_key,),
        ).fetchone()
        if row is None:
            raise RuntimeError("Epic metadata row was not persisted.")
        metadata_id = int(row["id"])

        conn.execute(
            "DELETE FROM epic_metadata_groups WHERE epic_metadata_id = ?",
            (metadata_id,),
        )
        conn.execute(
            "DELETE FROM epic_metadata_work_types WHERE epic_metadata_id = ?",
            (metadata_id,),
        )
        for group_id in normalized_group_ids:
            conn.execute(
                """
                INSERT INTO epic_metadata_groups (epic_metadata_id, group_id)
                VALUES (?, ?)
                """,
                (metadata_id, group_id),
            )
        for work_type_id in normalized_work_type_ids:
            conn.execute(
                """
                INSERT INTO epic_metadata_work_types (epic_metadata_id, work_type_id)
                VALUES (?, ?)
                """,
                (metadata_id, work_type_id),
            )
        entry = _read_epic_metadata_entry(conn, normalized_key)
        conn.commit()
    finally:
        conn.close()

    if entry is None:
        raise RuntimeError("Failed to read persisted epic metadata.")
    return entry
