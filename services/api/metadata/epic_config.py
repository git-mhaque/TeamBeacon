from __future__ import annotations

import json
import sqlite3
from typing import Any

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
        """
    )
    if not _column_exists(conn, "epic_metadata", "epic_name"):
        conn.execute(
            """
            ALTER TABLE epic_metadata
            ADD COLUMN epic_name TEXT
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


def _normalize_epic_key(epic_key: str) -> str:
    normalized = epic_key.strip().upper()
    if not normalized:
        raise ValueError("epicKey is required.")
    return normalized


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


def _normalize_int_ids(values: list[int] | None, field_name: str) -> list[int]:
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


def add_epic_group(name: str, db_path: str | None = None) -> dict[str, Any]:
    return _insert_lookup_item("epic_groups", name, db_path=db_path)


def add_work_type(name: str, db_path: str | None = None) -> dict[str, Any]:
    return _insert_lookup_item("work_types", name, db_path=db_path)


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
        SELECT id, epic_key, epic_name, success_criteria_json, updated_at
        FROM epic_metadata
        WHERE epic_key = ?
        LIMIT 1
        """,
        (epic_key,),
    ).fetchone()
    if epic_row is None:
        return None

    metadata_id = int(epic_row["id"])
    persisted_epic_name = epic_row["epic_name"]
    epic_title = str(persisted_epic_name).strip() if persisted_epic_name is not None else None
    if not epic_title:
        epic_title = _resolve_epic_name_from_issues(conn, epic_key)
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


def _read_epic_completion_counts(conn: sqlite3.Connection, epic_key: str) -> tuple[int, int]:
    row = conn.execute(
        """
        SELECT
          COUNT(*) AS total_cards,
          SUM(
            CASE
              WHEN (
                LOWER(COALESCE(i.status_category, '')) = 'done'
                OR LOWER(COALESCE(i.status_name, '')) IN ('done', 'closed', 'resolved')
                OR i.resolved_at_source IS NOT NULL
              ) THEN 1
              ELSE 0
            END
          ) AS completed_cards
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
        """,
        (epic_key, epic_key, epic_key, epic_key),
    ).fetchone()
    if row is None:
        return (0, 0)
    total_cards = int(row["total_cards"] or 0)
    completed_cards = int(row["completed_cards"] or 0)
    return (total_cards, completed_cards)


def get_configured_epic_summary(
    *,
    limit: int = 50,
    db_path: str | None = None,
) -> dict[str, Any]:
    resolved_db_path = db_path or _resolve_db_path()
    safe_limit = max(1, min(int(limit), 200))
    conn = _connect(resolved_db_path)
    try:
        _ensure_metadata_schema(conn)
        rows = conn.execute(
            """
            SELECT
              em.epic_key,
              em.epic_name,
              em.updated_at,
              i.summary AS issue_summary
            FROM epic_metadata em
            LEFT JOIN issues i ON i.issue_key = em.epic_key
            ORDER BY datetime(em.updated_at) DESC, em.epic_key ASC
            LIMIT ?
            """,
            (safe_limit,),
        ).fetchall()

        epics: list[dict[str, Any]] = []
        for row in rows:
            epic_key = str(row["epic_key"])
            epic_name_raw = row["epic_name"] if row["epic_name"] is not None else row["issue_summary"]
            epic_name = str(epic_name_raw).strip() if epic_name_raw is not None else ""
            total_cards, completed_cards = _read_epic_completion_counts(conn, epic_key)
            completion_percent = round((completed_cards / total_cards) * 100, 1) if total_cards > 0 else 0.0
            epics.append(
                {
                    "epicKey": epic_key,
                    "epicName": epic_name,
                    "completedCards": completed_cards,
                    "totalCards": total_cards,
                    "completionPercent": completion_percent,
                    "ragScore": None,
                    "insightComment": None,
                    "updatedAt": row["updated_at"],
                }
            )
    finally:
        conn.close()
    return {"epics": epics}


def upsert_epic_metadata(
    *,
    epic_key: str,
    success_criteria: list[str] | None,
    group_ids: list[int] | None,
    work_type_ids: list[int] | None,
    db_path: str | None = None,
) -> dict[str, Any]:
    normalized_key = _normalize_epic_key(epic_key)
    normalized_criteria = _normalize_criteria(success_criteria)
    normalized_group_ids = _normalize_int_ids(group_ids, "groupIds")
    normalized_work_type_ids = _normalize_int_ids(work_type_ids, "workTypeIds")

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
            INSERT INTO epic_metadata (epic_key, epic_name, success_criteria_json, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(epic_key) DO UPDATE SET
              epic_name = COALESCE(excluded.epic_name, epic_metadata.epic_name),
              success_criteria_json = excluded.success_criteria_json,
              updated_at = CURRENT_TIMESTAMP
            """,
            (
                normalized_key,
                epic_name,
                json.dumps(normalized_criteria, separators=(",", ":"), ensure_ascii=False),
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
