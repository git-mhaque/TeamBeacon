"""Work stream inventory and atomic, assignment-only bulk updates."""

from __future__ import annotations

import os
from typing import Any

from packages.connectors.jira_config import load_env_files
from services.api.metadata.epic_config import (
    _connect,
    _ensure_metadata_schema,
    _resolve_db_path,
)


class MappingConflict(ValueError):
    """An assignment changed after the client loaded its draft."""


def get_epic_mapping_inventory(
    db_path: str | None = None, project_key: str | None = None
) -> dict[str, Any]:
    load_env_files()
    project_key = project_key or os.getenv("JIRA_PROJECT_KEY")
    conn = _connect(db_path or _resolve_db_path())
    try:
        _ensure_metadata_schema(conn)
        rows = conn.execute(
            """
            SELECT i.issue_key AS epicKey, i.summary AS title,
                   i.status_name AS status, g.group_id AS workStreamId,
                   (SELECT MIN(wt.work_type_id) FROM epic_metadata_work_types wt
                    WHERE wt.epic_metadata_id = em.id) AS workTypeId
            FROM issues i
            LEFT JOIN epic_metadata em ON em.epic_key = i.issue_key
            LEFT JOIN epic_metadata_groups g ON g.epic_metadata_id = em.id
            WHERE LOWER(COALESCE(i.issue_type, '')) = 'epic'
              AND (? IS NULL OR i.project_key = ?)
            ORDER BY i.issue_key
        """,
            (project_key, project_key),
        ).fetchall()
        epics = [dict(row) for row in rows]
        sync = conn.execute("""
            SELECT MAX(finished_at) FROM sync_run_history
            WHERE source_type = 'jira' AND status = 'completed'
        """).fetchone()[0]
        return {"epics": epics, "lastSyncedAt": sync}
    finally:
        conn.close()


def save_epic_mappings(changes: Any, db_path: str | None = None) -> dict[str, Any]:
    if not isinstance(changes, list) or not changes or len(changes) > 1000:
        raise ValueError("changes must contain between 1 and 1000 assignments.")
    seen: set[str] = set()
    for change in changes:
        if not isinstance(change, dict) or not isinstance(change.get("epicKey"), str):
            raise ValueError("Each assignment requires an epicKey.")  # noqa: TRY004 - API validation contract
        key = change["epicKey"]
        if not key.strip() or key in seen:
            raise ValueError("Epic keys must be nonempty and unique.")
        seen.add(key)
        if "workStreamId" not in change and "workTypeId" not in change:
            raise ValueError(f"{key}: at least one assignment is required.")
        for target_field, expected_field in (
            ("workStreamId", "expectedWorkStreamId"),
            ("workTypeId", "expectedWorkTypeId"),
        ):
            if target_field not in change and expected_field not in change:
                continue
            for field in (target_field, expected_field):
                if field not in change or (
                    change[field] is not None
                    and (type(change[field]) is not int or change[field] <= 0)
                ):
                    raise ValueError(f"{key}: {field} must be a positive integer or null.")
    conn = _connect(db_path or _resolve_db_path())
    try:
        _ensure_metadata_schema(conn)
        conn.execute("BEGIN IMMEDIATE")
        assignments = (
            ("workStreamId", "expectedWorkStreamId", "epic_groups", "epic_metadata_groups", "group_id"),
            ("workTypeId", "expectedWorkTypeId", "work_types", "epic_metadata_work_types", "work_type_id"),
        )
        for change in changes:
            key = change["epicKey"]
            issue = conn.execute(
                "SELECT issue_type FROM issues WHERE issue_key = ?", (key,),
            ).fetchone()
            if issue is None or (issue[0] or "").casefold() != "epic":
                raise ValueError(f"{key}: synced epic no longer exists.")
            for field, expected_field, lookup_table, mapping_table, column in assignments:
                if field not in change:
                    continue
                target = change[field]
                if target is not None and not conn.execute(
                    f"SELECT 1 FROM {lookup_table} WHERE id = ?", (target,),
                ).fetchone():
                    raise ValueError(f"{key}: {field} no longer exists.")
                current = conn.execute(
                    f"""SELECT m.{column} FROM epic_metadata em
                        JOIN {mapping_table} m ON m.epic_metadata_id = em.id
                        WHERE em.epic_key = ?""", (key,),
                ).fetchall()
                expected = change[expected_field]
                if [row[0] for row in current] != ([] if expected is None else [expected]):
                    raise MappingConflict(
                        f"{key}: assignment changed. Reload the inventory before saving."
                    )
        for change in changes:
            key = change["epicKey"]
            conn.execute(
                "INSERT INTO epic_metadata (epic_key) VALUES (?) ON CONFLICT(epic_key) DO NOTHING",
                (key,),
            )
            metadata_id = conn.execute(
                "SELECT id FROM epic_metadata WHERE epic_key = ?", (key,),
            ).fetchone()[0]
            for field, _, _, mapping_table, column in assignments:
                if field not in change:
                    continue
                conn.execute(
                    f"DELETE FROM {mapping_table} WHERE epic_metadata_id = ?", (metadata_id,),
                )
                if change[field] is not None:
                    conn.execute(
                        f"INSERT INTO {mapping_table} (epic_metadata_id, {column}) VALUES (?, ?)",
                        (metadata_id, change[field]),
                    )
            conn.execute(
                "UPDATE epic_metadata SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (metadata_id,),
            )
        conn.commit()
        return {"savedCount": len(changes)}
    finally:
        conn.close()  # Closing an uncommitted transaction rolls back the entire batch.
