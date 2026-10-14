"""Work stream inventory and atomic, assignment-only bulk updates."""

from __future__ import annotations

import json
import os
from typing import Any

from packages.connectors.epic_scope import is_eligible_epic
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
                   i.status_name AS status, g.group_id AS workStreamId, i.labels_json
            FROM issues i
            LEFT JOIN epic_metadata em ON em.epic_key = i.issue_key
            LEFT JOIN epic_metadata_groups g ON g.epic_metadata_id = em.id
            WHERE LOWER(COALESCE(i.issue_type, '')) = 'epic'
              AND (? IS NULL OR i.project_key = ?)
            ORDER BY i.issue_key
        """,
            (project_key, project_key),
        ).fetchall()
        epics = []
        for row in rows:
            if is_eligible_epic("Epic", json.loads(row["labels_json"])):
                epic = dict(row)
                del epic["labels_json"]
                epics.append(epic)
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
        for field in ("workStreamId", "expectedWorkStreamId"):
            if field not in change or (
                change[field] is not None
                and (type(change[field]) is not int or change[field] <= 0)
            ):
                raise ValueError(f"{key}: {field} must be a positive integer or null.")
    conn = _connect(db_path or _resolve_db_path())
    try:
        _ensure_metadata_schema(conn)
        conn.execute("BEGIN IMMEDIATE")
        for change in changes:
            key, target = change["epicKey"], change["workStreamId"]
            issue = conn.execute(
                "SELECT issue_type, labels_json FROM issues WHERE issue_key = ?",
                (key,),
            ).fetchone()
            if issue is None or not is_eligible_epic(issue[0], json.loads(issue[1])):
                raise ValueError(f"{key}: eligible synced epic no longer exists.")
            if (
                target is not None
                and not conn.execute(
                    "SELECT 1 FROM epic_groups WHERE id = ?", (target,)
                ).fetchone()
            ):
                raise ValueError(f"{key}: work stream no longer exists.")
            current = conn.execute(
                """
                SELECT g.group_id FROM epic_metadata em
                JOIN epic_metadata_groups g ON g.epic_metadata_id = em.id
                WHERE em.epic_key = ?
            """,
                (key,),
            ).fetchall()
            ids = [row[0] for row in current]
            expected = change["expectedWorkStreamId"]
            if ids != ([] if expected is None else [expected]):
                raise MappingConflict(
                    f"{key}: assignment changed. Reload the inventory before saving."
                )
        for change in changes:
            key, target = change["epicKey"], change["workStreamId"]
            conn.execute(
                "INSERT INTO epic_metadata (epic_key) VALUES (?) ON CONFLICT(epic_key) DO NOTHING",
                (key,),
            )
            metadata_id = conn.execute(
                "SELECT id FROM epic_metadata WHERE epic_key = ?", (key,)
            ).fetchone()[0]
            conn.execute(
                "DELETE FROM epic_metadata_groups WHERE epic_metadata_id = ?",
                (metadata_id,),
            )
            if target is not None:
                conn.execute(
                    "INSERT INTO epic_metadata_groups VALUES (?, ?)",
                    (metadata_id, target),
                )
            conn.execute(
                "UPDATE epic_metadata SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (metadata_id,),
            )
        conn.commit()
        return {"savedCount": len(changes)}
    finally:
        conn.close()  # Closing an uncommitted transaction rolls back the entire batch.
