"""Inventory of synced cards with no direct or inherited epic link."""

from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import asdict, dataclass
from typing import Any

from packages.connectors.jira_config import load_env_files
from services.api.integrations.jira_sync import _ensure_schema, _resolve_db_path
from services.api.issues.initiative_deep_dive import (
    _resolve_jira_base_url,
    _resolve_jira_base_url_from_db,
)


@dataclass(frozen=True)
class UnmappedCard:
    issue_key: str
    summary: str
    issue_type: str | None
    status: str
    created_by: str | None
    parent_issue_key: str | None
    parent_missing: bool
    created_at: str | None

    def to_api(self) -> dict[str, Any]:
        fields = {
            "issue_key": "issueKey", "issue_type": "issueType",
            "parent_issue_key": "parentIssueKey", "parent_missing": "parentMissing",
            "created_at": "createdAt", "created_by": "createdBy",
        }
        return {fields.get(key, key): value for key, value in asdict(self).items()}


def _creator_name(raw_json: str) -> str | None:
    try:
        payload = json.loads(raw_json)
    except (ValueError, TypeError):
        return None
    fields = payload.get("fields") if isinstance(payload, dict) else None
    creator = fields.get("creator") if isinstance(fields, dict) else None
    if not isinstance(creator, dict):
        return None
    for key in ("displayName", "name", "accountId"):
        value = creator.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def get_unmapped_cards(
    db_path: str | None = None, project_key: str | None = None,
) -> dict[str, Any]:
    load_env_files()
    project_key = project_key or os.getenv("JIRA_PROJECT_KEY")
    conn = sqlite3.connect(db_path or _resolve_db_path())
    conn.row_factory = sqlite3.Row
    try:
        _ensure_schema(conn)
        # UNION deduplicates ancestors and terminates even if parent links form a cycle.
        # An explicit epic link counts even when that epic isn't locally configured/synced.
        rows = conn.execute("""
            WITH RECURSIVE mapped(issue_key) AS (
                SELECT issue_key FROM issues
                WHERE LOWER(TRIM(COALESCE(issue_type, ''))) = 'epic'
                   OR NULLIF(TRIM(epic_key), '') IS NOT NULL
                UNION
                SELECT child.issue_key FROM issues child
                JOIN mapped parent ON parent.issue_key = child.parent_issue_key
            )
            SELECT i.issue_key, i.summary, i.issue_type, i.status_name AS status,
                   i.raw_json,
                   NULLIF(TRIM(i.parent_issue_key), '') AS parent_issue_key,
                   CASE WHEN NULLIF(TRIM(i.parent_issue_key), '') IS NOT NULL
                             AND p.issue_key IS NULL THEN 1 ELSE 0 END AS parent_missing,
                   i.created_at_source AS created_at
            FROM issues i
            LEFT JOIN mapped m ON m.issue_key = i.issue_key
            LEFT JOIN issues p ON p.issue_key = TRIM(i.parent_issue_key)
            WHERE m.issue_key IS NULL AND (? IS NULL OR i.project_key = ?)
            ORDER BY datetime(COALESCE(i.created_at_source, i.synced_at)) DESC, i.issue_key
        """, (project_key, project_key)).fetchall()
        cards = []
        for row in rows:
            card = dict(row)
            card["created_by"] = _creator_name(card.pop("raw_json"))
            card["parent_missing"] = bool(card["parent_missing"])
            cards.append(UnmappedCard(**card).to_api())
        last_synced_at = conn.execute("""
            SELECT MAX(finished_at) FROM sync_run_history
            WHERE source_type = 'jira' AND status = 'completed'
        """).fetchone()[0]
        return {
            "cards": cards, "count": len(cards), "projectKey": project_key,
            "lastSyncedAt": last_synced_at,
            "jiraBaseUrl": _resolve_jira_base_url() or _resolve_jira_base_url_from_db(conn),
        }
    finally:
        conn.close()
