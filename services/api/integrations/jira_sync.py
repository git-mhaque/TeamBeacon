from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Literal

from packages.connectors.jira_config import JiraRuntimeConfig, load_env_files
from packages.connectors.jira_rest_stub import JiraRestConnector
from packages.connectors.models import (
    BoardRecord,
    ChangelogItemRecord,
    IssueRecord,
    JiraProjectVersionRecord,
    JiraVersionRef,
    SprintRecord,
)

ProgressCallback = Callable[[dict[str, Any]], None]
SyncRunner = Callable[..., dict[str, Any]]
SyncMode = Literal["full", "since_last", "since_date"]

SYNC_MODE_FULL: SyncMode = "full"
SYNC_MODE_SINCE_LAST: SyncMode = "since_last"
SYNC_MODE_SINCE_DATE: SyncMode = "since_date"


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _resolve_db_path() -> str:
    load_env_files()
    configured = os.getenv("TEAMBEACON_DB_PATH")
    if configured:
        return configured
    return str(_repo_root() / "teambeacon.db")


def _migration_path() -> Path:
    return Path(__file__).resolve().parents[1] / "db" / "migrations" / "0001_initial.sql"


def _column_exists(conn: sqlite3.Connection, table_name: str, column_name: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return any(str(row[1]) == column_name for row in rows)


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(_migration_path().read_text(encoding="utf-8"))
    if not _column_exists(conn, "sync_run_history", "sync_mode"):
        conn.execute(
            """
            ALTER TABLE sync_run_history
            ADD COLUMN sync_mode TEXT NOT NULL DEFAULT 'full'
            """
        )
    if not _column_exists(conn, "sync_run_history", "requested_since"):
        conn.execute(
            """
            ALTER TABLE sync_run_history
            ADD COLUMN requested_since TEXT
            """
        )
    if not _column_exists(conn, "issues", "parent_issue_key"):
        conn.execute(
            """
            ALTER TABLE issues
            ADD COLUMN parent_issue_key TEXT
            """
        )
    conn.execute(
        """
        UPDATE issues
        SET parent_issue_key = COALESCE(
          NULLIF(parent_issue_key, ''),
          NULLIF(json_extract(raw_json, '$.fields.parent.key'), ''),
          NULLIF(epic_key, '')
        )
        WHERE (parent_issue_key IS NULL OR TRIM(parent_issue_key) = '')
          AND (
            NULLIF(json_extract(raw_json, '$.fields.parent.key'), '') IS NOT NULL
            OR NULLIF(epic_key, '') IS NOT NULL
          )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_issues_epic_key ON issues(epic_key)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_issues_parent_issue_key ON issues(parent_issue_key)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS jira_project_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_key TEXT,
          version_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          archived INTEGER NOT NULL DEFAULT 0,
          released INTEGER NOT NULL DEFAULT 0,
          start_date TEXT,
          release_date TEXT,
          raw_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(project_key, version_id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS issue_release_links (
          issue_key TEXT NOT NULL,
          project_key TEXT,
          version_id TEXT NOT NULL,
          version_name TEXT NOT NULL,
          archived INTEGER NOT NULL DEFAULT 0,
          released INTEGER NOT NULL DEFAULT 0,
          release_date TEXT,
          raw_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(issue_key, version_id),
          FOREIGN KEY (issue_key) REFERENCES issues(issue_key)
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_jira_project_versions_project ON jira_project_versions(project_key, released, archived)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_issue_release_links_version ON issue_release_links(version_id, project_key)"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_issue_release_links_issue ON issue_release_links(issue_key)")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_issue_changelog_author_issue ON issue_changelog(author_account_id, issue_key)"
    )


def _scope_key(board_id: int) -> str:
    return f"board:{board_id}"


def _to_json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def _to_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def _parse_jira_date(value: str | None) -> datetime | None:
    if not value:
        return None
    candidate = value.strip()
    if not candidate:
        return None
    try:
        parsed = datetime.strptime(candidate, "%Y-%m-%d")
    except ValueError:
        return _parse_iso_datetime(candidate)
    return parsed.replace(tzinfo=timezone.utc)


def _extract_fix_versions_from_raw_payload(raw_payload: dict[str, Any]) -> list[JiraVersionRef]:
    fields = raw_payload.get("fields")
    if not isinstance(fields, dict):
        return []
    versions: list[JiraVersionRef] = []
    for raw_version in fields.get("fixVersions") or []:
        if not isinstance(raw_version, dict):
            continue
        name_raw = raw_version.get("name")
        if not isinstance(name_raw, str) or not name_raw.strip():
            continue
        version_id_raw = raw_version.get("id")
        version_id = str(version_id_raw).strip() if version_id_raw is not None else name_raw.strip()
        if not version_id:
            version_id = name_raw.strip()
        versions.append(
            JiraVersionRef(
                version_id=version_id,
                name=name_raw.strip(),
                archived=bool(raw_version.get("archived")),
                released=bool(raw_version.get("released")),
                release_date=_parse_jira_date(raw_version.get("releaseDate")),
                raw=raw_version,
            )
        )
    return versions


def _extract_fix_versions_from_raw_json(raw_json: str | None) -> list[JiraVersionRef]:
    if not raw_json:
        return []
    try:
        payload = json.loads(raw_json)
    except (TypeError, ValueError):
        return []
    if not isinstance(payload, dict):
        return []
    return _extract_fix_versions_from_raw_payload(payload)


def _safe_percent(downloaded: int, total: int | None) -> float | None:
    if total is None or total <= 0:
        return None
    return round((downloaded / total) * 100, 2)


def _extract_sprint_id_from_fields(fields: dict[str, Any], sprint_field_candidates: tuple[str, ...]) -> int | None:
    for field_name in sprint_field_candidates:
        if field_name not in fields:
            continue
        candidate = fields.get(field_name)

        if candidate is None:
            return None

        if isinstance(candidate, dict):
            sprint_id = candidate.get("id")
            if isinstance(sprint_id, int):
                return sprint_id
            if isinstance(sprint_id, str) and sprint_id.isdigit():
                return int(sprint_id)
            return None

        if isinstance(candidate, list):
            for entry in reversed(candidate):
                if isinstance(entry, dict):
                    sprint_id = entry.get("id")
                    if isinstance(sprint_id, int):
                        return sprint_id
                    if isinstance(sprint_id, str) and sprint_id.isdigit():
                        return int(sprint_id)
                if isinstance(entry, str):
                    match = re.search(r"id=(\d+)", entry)
                    if match:
                        return int(match.group(1))
            return None

        if isinstance(candidate, str):
            match = re.search(r"id=(\d+)", candidate)
            if match:
                return int(match.group(1))
            return None

        return None

    return None


def _extract_sprint_id_from_raw_json(raw_json: str | None, sprint_field_candidates: tuple[str, ...]) -> int | None:
    if not raw_json:
        return None
    try:
        payload = json.loads(raw_json)
    except (TypeError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    fields = payload.get("fields")
    if not isinstance(fields, dict):
        return None
    return _extract_sprint_id_from_fields(fields, sprint_field_candidates)


def _backfill_missing_sprint_external_ids(
    conn: sqlite3.Connection,
    sprint_field_candidates: tuple[str, ...],
) -> int:
    rows = conn.execute(
        """
        SELECT issue_key, raw_json
        FROM issues
        WHERE sprint_external_id IS NULL
          AND raw_json IS NOT NULL
          AND TRIM(raw_json) <> ''
        """
    ).fetchall()
    updated = 0
    for issue_key, raw_json in rows:
        sprint_id = _extract_sprint_id_from_raw_json(raw_json, sprint_field_candidates)
        if sprint_id is None:
            continue
        result = conn.execute(
            """
            UPDATE issues
            SET sprint_external_id = ?, synced_at = CURRENT_TIMESTAMP
            WHERE issue_key = ? AND sprint_external_id IS NULL
            """,
            (sprint_id, issue_key),
        )
        updated += int(result.rowcount or 0)
    return updated


def _normalize_sync_mode(mode: str | None) -> SyncMode:
    if mode is None:
        return SYNC_MODE_FULL
    normalized = mode.strip().lower()
    if normalized == SYNC_MODE_FULL:
        return SYNC_MODE_FULL
    if normalized == SYNC_MODE_SINCE_LAST:
        return SYNC_MODE_SINCE_LAST
    if normalized == SYNC_MODE_SINCE_DATE:
        return SYNC_MODE_SINCE_DATE
    raise ValueError("Unsupported sync mode. Allowed values: full, since_last, since_date.")


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
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


def _parse_requested_since(value: str | None) -> datetime | None:
    if value is None:
        return None
    candidate = value.strip()
    if not candidate:
        return None
    try:
        date_only = datetime.strptime(candidate, "%Y-%m-%d")
        return date_only.replace(tzinfo=timezone.utc)
    except ValueError:
        pass
    return _parse_iso_datetime(candidate)


def _upsert_checkpoint(
    conn: sqlite3.Connection,
    scope_key: str,
    *,
    status: str,
    last_cursor: str | None = None,
    last_synced_at: str | None = None,
    error_message: str | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO sync_checkpoints (
          source_type,
          scope_key,
          last_cursor,
          last_synced_at,
          status,
          error_message,
          updated_at
        ) VALUES ('jira', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(source_type, scope_key) DO UPDATE SET
          last_cursor = COALESCE(excluded.last_cursor, sync_checkpoints.last_cursor),
          last_synced_at = COALESCE(excluded.last_synced_at, sync_checkpoints.last_synced_at),
          status = excluded.status,
          error_message = excluded.error_message,
          updated_at = CURRENT_TIMESTAMP
        """,
        (scope_key, last_cursor, last_synced_at, status, error_message),
    )


def _read_last_synced_at(db_path: str, scope_key: str) -> str | None:
    conn = sqlite3.connect(db_path)
    try:
        _ensure_schema(conn)
        row = conn.execute(
            """
            SELECT last_synced_at
            FROM sync_checkpoints
            WHERE source_type = 'jira' AND scope_key = ?
            LIMIT 1
            """,
            (scope_key,),
        ).fetchone()
        if row is None:
            return None
        return row[0]
    finally:
        conn.close()


def _read_last_completed_sync_finished_at(db_path: str, scope_key: str) -> str | None:
    conn = sqlite3.connect(db_path)
    try:
        _ensure_schema(conn)
        row = conn.execute(
            """
            SELECT finished_at
            FROM sync_run_history
            WHERE source_type = 'jira'
              AND scope_key = ?
              AND status = 'completed'
              AND finished_at IS NOT NULL
            ORDER BY datetime(finished_at) DESC, id DESC
            LIMIT 1
            """,
            (scope_key,),
        ).fetchone()
        if row is None:
            return None
        return row[0]
    finally:
        conn.close()


def _insert_sync_run(
    conn: sqlite3.Connection,
    *,
    scope_key: str,
    board_external_id: int | None,
    board_name: str | None,
    sync_mode: str,
    requested_since: str | None,
    started_at: str,
) -> int:
    cursor = conn.execute(
        """
        INSERT INTO sync_run_history (
          source_type,
          scope_key,
          board_external_id,
          board_name,
          sync_mode,
          requested_since,
          started_at,
          status
        ) VALUES ('jira', ?, ?, ?, ?, ?, ?, 'running')
        """,
        (scope_key, board_external_id, board_name, sync_mode, requested_since, started_at),
    )
    return int(cursor.lastrowid)


def _update_sync_run(
    conn: sqlite3.Connection,
    sync_run_id: int,
    *,
    board_name: str | None = None,
    boards_synced: int | None = None,
    sprints_synced: int | None = None,
    issues_synced: int | None = None,
    total_issues: int | None = None,
    status: str | None = None,
    finished_at: str | None = None,
    error_message: str | None = None,
) -> None:
    updates: list[str] = []
    params: list[Any] = []

    if board_name is not None:
        updates.append("board_name = ?")
        params.append(board_name)
    if boards_synced is not None:
        updates.append("boards_synced = ?")
        params.append(boards_synced)
    if sprints_synced is not None:
        updates.append("sprints_synced = ?")
        params.append(sprints_synced)
    if issues_synced is not None:
        updates.append("issues_synced = ?")
        params.append(issues_synced)
    if total_issues is not None:
        updates.append("total_issues = ?")
        params.append(total_issues)
    if status is not None:
        updates.append("status = ?")
        params.append(status)
    if finished_at is not None:
        updates.append("finished_at = ?")
        params.append(finished_at)
    if error_message is not None:
        updates.append("error_message = ?")
        params.append(error_message)

    if not updates:
        return

    params.append(sync_run_id)
    conn.execute(f"UPDATE sync_run_history SET {', '.join(updates)} WHERE id = ?", params)


def _read_sync_history(db_path: str, limit: int) -> list[dict[str, Any]]:
    conn = sqlite3.connect(db_path)
    try:
        _ensure_schema(conn)
        try:
            runtime = _load_runtime()
            fallback_project_key = runtime.project_key
        except Exception:  # noqa: BLE001
            fallback_project_key = None

        rows = conn.execute(
            """
            SELECT
              id,
              scope_key,
              board_external_id,
              board_name,
              boards_synced,
              sprints_synced,
              issues_synced,
              total_issues,
              sync_mode,
              requested_since,
              status,
              error_message,
              started_at,
              finished_at
            FROM sync_run_history
            WHERE source_type = 'jira'
            ORDER BY datetime(started_at) DESC, id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

        total_issue_count_row = conn.execute("SELECT COUNT(*) FROM issues").fetchone()
        total_issue_count = int(total_issue_count_row[0] or 0)

        board_issue_counts: dict[int, int] = {}
        for row in rows:
            board_external_id = row[2]
            if board_external_id is None:
                continue
            if board_external_id in board_issue_counts:
                continue

            board_project_row = conn.execute(
                """
                SELECT project_key
                FROM boards
                WHERE external_board_id = ?
                LIMIT 1
                """,
                (board_external_id,),
            ).fetchone()
            board_project_key = board_project_row[0] if board_project_row is not None else None
            if not board_project_key:
                board_project_key = fallback_project_key

            if board_project_key:
                project_count_row = conn.execute(
                    "SELECT COUNT(*) FROM issues WHERE project_key = ?",
                    (board_project_key,),
                ).fetchone()
                project_count = int(project_count_row[0] or 0)
            else:
                project_count = 0

            if project_count > 0:
                board_issue_counts[board_external_id] = project_count
                continue

            board_count_row = conn.execute(
                """
                SELECT COUNT(DISTINCT i.issue_key)
                FROM issues i
                LEFT JOIN sprints s ON s.external_sprint_id = i.sprint_external_id
                WHERE s.board_external_id = ?
                """,
                (board_external_id,),
            ).fetchone()
            board_issue_counts[board_external_id] = int(board_count_row[0] or 0)
    finally:
        conn.close()

    history: list[dict[str, Any]] = []
    for row in rows:
        board_external_id = row[2]
        issues_synced = int(row[6] or 0)
        total_issues = row[7]
        sync_mode_raw = row[8]
        requested_since = row[9]
        status = row[10]
        estimated_count = 0

        if board_external_id is not None:
            estimated_count = board_issue_counts.get(board_external_id, 0)
        if estimated_count <= 0:
            estimated_count = total_issue_count

        if issues_synced <= 0 and estimated_count > 0:
            issues_synced = estimated_count
            if total_issues is None:
                total_issues = estimated_count

        if status != "completed" and estimated_count > issues_synced:
            issues_synced = estimated_count
            if total_issues is None:
                total_issues = estimated_count

        history.append(
            {
                "id": row[0],
                "scopeKey": row[1],
                "boardId": board_external_id,
                "boardName": row[3],
                "boardsSynced": row[4],
                "sprintsSynced": row[5],
                "issuesSynced": issues_synced,
                "totalIssues": total_issues,
                "syncMode": (
                    SYNC_MODE_SINCE_DATE
                    if requested_since
                    else (
                        sync_mode_raw
                        if sync_mode_raw in {SYNC_MODE_FULL, SYNC_MODE_SINCE_LAST}
                        else SYNC_MODE_FULL
                    )
                ),
                "requestedSince": requested_since,
                "status": status,
                "error": row[11],
                "startedAt": row[12],
                "finishedAt": row[13],
            }
        )
    return history


def _read_latest_sync_run(db_path: str) -> dict[str, Any] | None:
    rows = _read_sync_history(db_path, limit=1)
    return rows[0] if rows else None


def _mark_stale_run_failed(db_path: str, run_id: int, scope_key: str, message: str) -> dict[str, Any] | None:
    conn = sqlite3.connect(db_path)
    try:
        _ensure_schema(conn)
        failed_at = _utc_iso_now()
        try:
            runtime = _load_runtime()
            fallback_project_key = runtime.project_key
        except Exception:  # noqa: BLE001
            fallback_project_key = None
        existing = conn.execute(
            """
            SELECT board_external_id, issues_synced, total_issues
            FROM sync_run_history
            WHERE id = ? AND source_type = 'jira'
            LIMIT 1
            """,
            (run_id,),
        ).fetchone()

        estimated_issues = None
        estimated_total = None
        if existing is not None:
            board_external_id = existing[0]
            issues_synced = int(existing[1] or 0)
            total_issues = existing[2]

            if issues_synced <= 0:
                if board_external_id is not None:
                    board_project_row = conn.execute(
                        """
                        SELECT project_key
                        FROM boards
                        WHERE external_board_id = ?
                        LIMIT 1
                        """,
                        (board_external_id,),
                    ).fetchone()
                    board_project_key = board_project_row[0] if board_project_row is not None else None
                    if not board_project_key:
                        board_project_key = fallback_project_key

                    if board_project_key:
                        issue_count_row = conn.execute(
                            "SELECT COUNT(*) FROM issues WHERE project_key = ?",
                            (board_project_key,),
                        ).fetchone()
                        issue_count = int(issue_count_row[0] or 0)
                    else:
                        issue_count = 0

                    if issue_count <= 0:
                        issue_count_row = conn.execute(
                            """
                            SELECT COUNT(DISTINCT i.issue_key)
                            FROM issues i
                            LEFT JOIN sprints s ON s.external_sprint_id = i.sprint_external_id
                            WHERE s.board_external_id = ?
                            """,
                            (board_external_id,),
                        ).fetchone()
                        issue_count = int(issue_count_row[0] or 0)
                else:
                    issue_count = 0

                if issue_count <= 0:
                    fallback_count_row = conn.execute("SELECT COUNT(*) FROM issues").fetchone()
                    issue_count = int(fallback_count_row[0] or 0)

                estimated_issues = issue_count
                if total_issues is None and issue_count > 0:
                    estimated_total = issue_count

        conn.execute(
            """
            UPDATE sync_run_history
            SET status = 'failed',
                finished_at = ?,
                error_message = ?,
                issues_synced = COALESCE(?, issues_synced),
                total_issues = COALESCE(?, total_issues)
            WHERE id = ? AND source_type = 'jira' AND status = 'running'
            """,
            (failed_at, message, estimated_issues, estimated_total, run_id),
        )
        conn.execute(
            """
            UPDATE sync_checkpoints
            SET status = 'failed',
                error_message = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE source_type = 'jira' AND scope_key = ? AND status = 'running'
            """,
            (message, scope_key),
        )
        conn.commit()
    finally:
        conn.close()
    return _read_latest_sync_run(db_path)


def _read_checkpoint(db_path: str, scope_key: str) -> dict[str, Any] | None:
    conn = sqlite3.connect(db_path)
    try:
        _ensure_schema(conn)
        row = conn.execute(
            """
            SELECT status, last_synced_at, error_message
            FROM sync_checkpoints
            WHERE source_type = 'jira' AND scope_key = ?
            LIMIT 1
            """,
            (scope_key,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return None
    return {"status": row[0], "lastSyncedAt": row[1], "error": row[2]}


def _upsert_board(conn: sqlite3.Connection, board: BoardRecord) -> None:
    conn.execute(
        """
        INSERT INTO boards (
          external_board_id,
          name,
          project_key,
          board_type,
          raw_json,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(external_board_id) DO UPDATE SET
          name = excluded.name,
          project_key = excluded.project_key,
          board_type = excluded.board_type,
          raw_json = excluded.raw_json,
          updated_at = CURRENT_TIMESTAMP
        """,
        (
            board.external_board_id,
            board.name,
            board.project_key,
            board.board_type,
            _to_json(board.raw),
        ),
    )


def _upsert_sprints(conn: sqlite3.Connection, sprints: list[SprintRecord]) -> None:
    for sprint in sprints:
        conn.execute(
            """
            INSERT INTO sprints (
              external_sprint_id,
              board_external_id,
              name,
              state,
              start_date,
              end_date,
              complete_date,
              goal,
              raw_json,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(external_sprint_id) DO UPDATE SET
              board_external_id = excluded.board_external_id,
              name = excluded.name,
              state = excluded.state,
              start_date = excluded.start_date,
              end_date = excluded.end_date,
              complete_date = excluded.complete_date,
              goal = excluded.goal,
              raw_json = excluded.raw_json,
              updated_at = CURRENT_TIMESTAMP
            """,
            (
                sprint.external_sprint_id,
                sprint.board_external_id,
                sprint.name,
                sprint.state,
                _to_iso(sprint.start_date),
                _to_iso(sprint.end_date),
                _to_iso(sprint.complete_date),
                sprint.goal,
                _to_json(sprint.raw),
            ),
        )


def _upsert_project_versions(conn: sqlite3.Connection, versions: list[JiraProjectVersionRecord]) -> None:
    for version in versions:
        conn.execute(
            """
            INSERT INTO jira_project_versions (
              project_key,
              version_id,
              name,
              description,
              archived,
              released,
              start_date,
              release_date,
              raw_json,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(project_key, version_id) DO UPDATE SET
              name = excluded.name,
              description = excluded.description,
              archived = excluded.archived,
              released = excluded.released,
              start_date = excluded.start_date,
              release_date = excluded.release_date,
              raw_json = excluded.raw_json,
              updated_at = CURRENT_TIMESTAMP
            """,
            (
                version.project_key,
                version.version_id,
                version.name,
                version.description,
                1 if version.archived else 0,
                1 if version.released else 0,
                _to_iso(version.start_date),
                _to_iso(version.release_date),
                _to_json(version.raw),
            ),
        )


def _replace_issue_release_links(conn: sqlite3.Connection, issue: IssueRecord) -> None:
    issue_key = str(issue.issue_key or "").strip()
    if not issue_key:
        return

    fix_versions = issue.fix_versions or _extract_fix_versions_from_raw_payload(issue.raw)
    conn.execute("DELETE FROM issue_release_links WHERE issue_key = ?", (issue_key,))
    for version in fix_versions:
        version_id = str(version.version_id or "").strip()
        version_name = str(version.name or "").strip()
        if not version_id or not version_name:
            continue
        conn.execute(
            """
            INSERT OR REPLACE INTO issue_release_links (
              issue_key,
              project_key,
              version_id,
              version_name,
              archived,
              released,
              release_date,
              raw_json,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (
                issue_key,
                issue.project_key,
                version_id,
                version_name,
                1 if version.archived else 0,
                1 if version.released else 0,
                _to_iso(version.release_date),
                _to_json(version.raw),
            ),
        )


def _backfill_issue_release_links_from_raw_json(conn: sqlite3.Connection) -> int:
    rows = conn.execute(
        """
        SELECT issue_key, project_key, raw_json
        FROM issues
        WHERE raw_json IS NOT NULL
          AND TRIM(raw_json) <> ''
        """
    ).fetchall()
    inserted = 0
    for issue_key_raw, project_key, raw_json in rows:
        issue_key = str(issue_key_raw or "").strip()
        if not issue_key:
            continue
        for version in _extract_fix_versions_from_raw_json(raw_json):
            version_id = str(version.version_id or "").strip()
            version_name = str(version.name or "").strip()
            if not version_id or not version_name:
                continue
            result = conn.execute(
                """
                INSERT OR IGNORE INTO issue_release_links (
                  issue_key,
                  project_key,
                  version_id,
                  version_name,
                  archived,
                  released,
                  release_date,
                  raw_json,
                  updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (
                    issue_key,
                    project_key,
                    version_id,
                    version_name,
                    1 if version.archived else 0,
                    1 if version.released else 0,
                    _to_iso(version.release_date),
                    _to_json(version.raw),
                ),
            )
            inserted += int(result.rowcount or 0)
    return inserted


def _upsert_issues(conn: sqlite3.Connection, issues: list[IssueRecord]) -> None:
    for issue in issues:
        conn.execute(
            """
            INSERT INTO issues (
              issue_key,
              issue_id,
              project_key,
              issue_type,
              summary,
              status_name,
              status_category,
              priority,
              assignee_account_id,
              reporter_account_id,
              story_points,
              sprint_external_id,
              epic_key,
              parent_issue_key,
              labels_json,
              components_json,
              created_at_source,
              updated_at_source,
              resolved_at_source,
              raw_json,
              synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(issue_key) DO UPDATE SET
              issue_id = excluded.issue_id,
              project_key = excluded.project_key,
              issue_type = excluded.issue_type,
              summary = excluded.summary,
              status_name = excluded.status_name,
              status_category = excluded.status_category,
              priority = excluded.priority,
              assignee_account_id = excluded.assignee_account_id,
              reporter_account_id = excluded.reporter_account_id,
              story_points = excluded.story_points,
              sprint_external_id = CASE
                WHEN ? = 1 THEN excluded.sprint_external_id
                ELSE issues.sprint_external_id
              END,
              epic_key = excluded.epic_key,
              parent_issue_key = excluded.parent_issue_key,
              labels_json = excluded.labels_json,
              components_json = excluded.components_json,
              created_at_source = excluded.created_at_source,
              updated_at_source = excluded.updated_at_source,
              resolved_at_source = excluded.resolved_at_source,
              raw_json = excluded.raw_json,
              synced_at = CURRENT_TIMESTAMP
            """,
            (
                issue.issue_key,
                issue.issue_id,
                issue.project_key,
                issue.issue_type,
                issue.summary,
                issue.status_name,
                issue.status_category,
                issue.priority,
                issue.assignee_account_id,
                issue.reporter_account_id,
                issue.story_points,
                issue.sprint_external_id,
                issue.epic_key,
                issue.parent_issue_key,
                _to_json(issue.labels),
                _to_json(issue.components),
                _to_iso(issue.created_at_source),
                _to_iso(issue.updated_at_source),
                _to_iso(issue.resolved_at_source),
                _to_json(issue.raw),
                1 if issue.sprint_field_present else 0,
            ),
        )
        _replace_issue_release_links(conn, issue)


def _active_sprint_ids(sprints: list[SprintRecord]) -> list[int]:
    active_ids: set[int] = set()
    for sprint in sprints:
        state = str(sprint.state or "").strip().lower()
        if state == "active":
            active_ids.add(int(sprint.external_sprint_id))
    return sorted(active_ids)


def _fetch_live_issues_for_sprint(
    connector: JiraRestConnector,
    sprint_id: int,
) -> list[IssueRecord]:
    live_issues: list[IssueRecord] = []
    seen_issue_keys: set[str] = set()
    start_at = 0
    max_results = 100
    jql = f"sprint = {sprint_id} ORDER BY updated ASC"

    while True:
        issues, batch = connector.search_issues(
            jql=jql,
            start_at=start_at,
            max_results=max_results,
        )
        for issue in issues:
            issue_key = str(issue.issue_key or "").strip()
            if not issue_key or issue_key in seen_issue_keys:
                continue
            # Sprint-scoped search guarantees membership even if sprint fields are missing.
            issue.issue_key = issue_key
            issue.sprint_external_id = sprint_id
            issue.sprint_field_present = True
            live_issues.append(issue)
            seen_issue_keys.add(issue_key)

        if not batch.has_more or batch.next_cursor is None:
            break
        try:
            start_at = int(batch.next_cursor)
        except (TypeError, ValueError):
            break

    return live_issues


def _fetch_live_issue_keys_for_sprint(
    connector: JiraRestConnector,
    sprint_id: int,
) -> set[str]:
    return {issue.issue_key for issue in _fetch_live_issues_for_sprint(connector, sprint_id)}


def _sync_active_sprint_issues(
    conn: sqlite3.Connection,
    connector: JiraRestConnector,
    active_sprint_ids: list[int],
) -> tuple[int, int, dict[int, set[str]]]:
    active_sprint_issues_hydrated = 0
    active_sprint_changelog_entries_synced = 0
    live_issue_keys_by_sprint: dict[int, set[str]] = {}

    for sprint_id in active_sprint_ids:
        live_issues = _fetch_live_issues_for_sprint(connector, sprint_id)
        live_issue_keys = {issue.issue_key for issue in live_issues if issue.issue_key}
        live_issue_keys_by_sprint[sprint_id] = live_issue_keys
        if not live_issue_keys:
            continue

        placeholders = ",".join("?" for _ in live_issue_keys)
        existing_rows = conn.execute(
            f"""
            SELECT issue_key, sprint_external_id
            FROM issues
            WHERE issue_key IN ({placeholders})
            """,
            tuple(live_issue_keys),
        ).fetchall()

        existing_sprint_external_ids: dict[str, int | None] = {}
        for issue_key_raw, sprint_external_id_raw in existing_rows:
            issue_key = str(issue_key_raw or "").strip()
            if not issue_key:
                continue
            if sprint_external_id_raw is None:
                existing_sprint_external_ids[issue_key] = None
                continue
            try:
                existing_sprint_external_ids[issue_key] = int(sprint_external_id_raw)
            except (TypeError, ValueError):
                existing_sprint_external_ids[issue_key] = None

        issues_to_hydrate: list[IssueRecord] = []
        for issue in live_issues:
            if existing_sprint_external_ids.get(issue.issue_key) == sprint_id:
                continue
            issues_to_hydrate.append(issue)

        if not issues_to_hydrate:
            continue

        _upsert_issues(conn, issues_to_hydrate)
        for issue in issues_to_hydrate:
            changelog_items = connector.get_issue_changelog(issue.issue_key)
            _replace_issue_changelog(conn, issue.issue_key, changelog_items)
            active_sprint_changelog_entries_synced += len(changelog_items)
        active_sprint_issues_hydrated += len(issues_to_hydrate)

    return (
        active_sprint_issues_hydrated,
        active_sprint_changelog_entries_synced,
        live_issue_keys_by_sprint,
    )


def _sanitize_raw_json_sprint_fields(
    raw_json: str | None,
    sprint_field_candidates: tuple[str, ...],
) -> str | None:
    if not raw_json:
        return raw_json
    try:
        payload = json.loads(raw_json)
    except (TypeError, ValueError):
        return raw_json
    if not isinstance(payload, dict):
        return raw_json

    fields = payload.get("fields")
    if not isinstance(fields, dict):
        return raw_json

    field_names: list[str] = []
    for candidate in sprint_field_candidates:
        trimmed = candidate.strip()
        if trimmed and trimmed not in field_names:
            field_names.append(trimmed)
    if "sprint" not in field_names:
        field_names.append("sprint")

    changed = False
    for field_name in field_names:
        if field_name in fields:
            fields.pop(field_name, None)
            changed = True
    if not changed:
        return raw_json
    try:
        return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    except (TypeError, ValueError):
        return raw_json


def _reconcile_active_sprint_membership(
    conn: sqlite3.Connection,
    connector: JiraRestConnector,
    active_sprint_ids: list[int],
    sprint_field_candidates: tuple[str, ...],
    live_issue_keys_by_sprint: dict[int, set[str]] | None = None,
) -> int:
    stale_links_cleared = 0

    for sprint_id in active_sprint_ids:
        if live_issue_keys_by_sprint is not None and sprint_id in live_issue_keys_by_sprint:
            live_issue_keys = set(live_issue_keys_by_sprint[sprint_id])
        else:
            live_issue_keys = _fetch_live_issue_keys_for_sprint(connector, sprint_id)
        rows = conn.execute(
            """
            SELECT issue_key, raw_json
            FROM issues
            WHERE sprint_external_id = ?
            """,
            (sprint_id,),
        ).fetchall()
        if not rows:
            continue

        local_issue_keys = {
            str(row[0]).strip()
            for row in rows
            if row[0] is not None and str(row[0]).strip()
        }
        stale_issue_keys = sorted(local_issue_keys - live_issue_keys)
        if not stale_issue_keys:
            continue

        raw_json_by_issue_key: dict[str, str | None] = {
            str(row[0]).strip(): row[1] if isinstance(row[1], str) else None
            for row in rows
            if row[0] is not None and str(row[0]).strip()
        }

        for issue_key in stale_issue_keys:
            current_raw_json = raw_json_by_issue_key.get(issue_key)
            sanitized_raw_json = _sanitize_raw_json_sprint_fields(current_raw_json, sprint_field_candidates)
            if sanitized_raw_json != current_raw_json:
                result = conn.execute(
                    """
                    UPDATE issues
                    SET sprint_external_id = NULL,
                        raw_json = ?,
                        synced_at = CURRENT_TIMESTAMP
                    WHERE issue_key = ?
                      AND sprint_external_id = ?
                    """,
                    (sanitized_raw_json, issue_key, sprint_id),
                )
            else:
                result = conn.execute(
                    """
                    UPDATE issues
                    SET sprint_external_id = NULL,
                        synced_at = CURRENT_TIMESTAMP
                    WHERE issue_key = ?
                      AND sprint_external_id = ?
                    """,
                    (issue_key, sprint_id),
                )
            stale_links_cleared += int(result.rowcount or 0)

    return stale_links_cleared


def _replace_issue_changelog(
    conn: sqlite3.Connection,
    issue_key: str,
    changelog_items: list[ChangelogItemRecord],
) -> None:
    conn.execute("DELETE FROM issue_changelog WHERE issue_key = ?", (issue_key,))
    for item in changelog_items:
        conn.execute(
            """
            INSERT INTO issue_changelog (
              issue_key,
              history_id,
              changed_at,
              author_account_id,
              field_name,
              from_value,
              to_value,
              raw_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item.issue_key,
                item.history_id,
                _to_iso(item.changed_at) or _utc_iso_now(),
                item.author_account_id,
                item.field_name,
                item.from_value,
                item.to_value,
                _to_json(item.raw),
            ),
        )


def _load_runtime() -> JiraRuntimeConfig:
    load_env_files()
    return JiraRuntimeConfig.from_env()


def _build_connector(runtime: JiraRuntimeConfig) -> JiraRestConnector:
    return JiraRestConnector(
        config=runtime.to_connector_config(),
        project_key=runtime.project_key,
        story_points_field=runtime.story_points_field,
        epic_link_field=runtime.epic_link_field,
        sprint_field_candidates=runtime.sprint_field_candidates,
    )


def run_jira_sync_once(
    progress_callback: ProgressCallback | None = None,
    db_path: str | None = None,
    runtime: JiraRuntimeConfig | None = None,
    connector: JiraRestConnector | None = None,
    sync_mode: SyncMode | str = SYNC_MODE_FULL,
    since_date: str | None = None,
) -> dict[str, Any]:
    runtime = runtime or _load_runtime()
    if runtime.board_id is None:
        raise ValueError("JIRA_BOARD_ID is required to sync JIRA data.")

    connector = connector or _build_connector(runtime)
    resolved_db_path = db_path or _resolve_db_path()
    scope = _scope_key(runtime.board_id)
    requested_mode = _normalize_sync_mode(sync_mode)
    effective_mode: SyncMode = requested_mode
    persisted_mode: str = requested_mode
    requested_since: str | None = None
    incremental_since_utc: datetime | None = None

    if requested_mode == SYNC_MODE_SINCE_DATE:
        parsed_requested_since = _parse_requested_since(since_date)
        if parsed_requested_since is None:
            raise ValueError(
                "sinceDate is required in YYYY-MM-DD or ISO-8601 format when mode is since_date."
            )
        if parsed_requested_since > datetime.now(timezone.utc):
            raise ValueError("sinceDate must be in the past.")
        incremental_since_utc = parsed_requested_since
        requested_since = parsed_requested_since.isoformat()
        # Keep persisted mode compatible with pre-existing DB CHECK constraint.
        persisted_mode = SYNC_MODE_SINCE_LAST
    elif requested_mode == SYNC_MODE_SINCE_LAST:
        last_synced_at = _read_last_synced_at(resolved_db_path, scope)
        parsed_last_synced_at = _parse_iso_datetime(last_synced_at)
        if parsed_last_synced_at is None:
            fallback_last_synced_at = _read_last_completed_sync_finished_at(resolved_db_path, scope)
            parsed_last_synced_at = _parse_iso_datetime(fallback_last_synced_at)
        if parsed_last_synced_at is not None:
            incremental_since_utc = parsed_last_synced_at
        else:
            effective_mode = SYNC_MODE_FULL

    def emit(update: dict[str, Any]) -> None:
        if progress_callback is None:
            return
        progress_callback(update)

    conn = sqlite3.connect(resolved_db_path)
    sync_run_id: int | None = None
    try:
        _ensure_schema(conn)
        _backfill_missing_sprint_external_ids(conn, runtime.sprint_field_candidates)
        _backfill_issue_release_links_from_raw_json(conn)
        started_at = _utc_iso_now()
        sync_run_id = _insert_sync_run(
            conn,
            scope_key=scope,
            board_external_id=runtime.board_id,
            board_name=None,
            sync_mode=persisted_mode if effective_mode != SYNC_MODE_FULL else SYNC_MODE_FULL,
            requested_since=requested_since,
            started_at=started_at,
        )
        _upsert_checkpoint(conn, scope, status="running", error_message=None)
        conn.commit()

        emit(
            {
                "phase": "board",
                "boardsSynced": 0,
                "sprintsSynced": 0,
                "downloadedIssues": 0,
                "totalIssues": None,
                "percent": None,
                "message": f"Syncing board {runtime.board_id} metadata.",
            }
        )
        board = connector.get_board(runtime.board_id)
        _upsert_board(conn, board)
        _update_sync_run(
            conn,
            sync_run_id,
            board_name=board.name,
            boards_synced=1,
        )
        conn.commit()
        emit(
            {
                "phase": "board",
                "boardsSynced": 1,
                "sprintsSynced": 0,
                "downloadedIssues": 0,
                "totalIssues": None,
                "percent": None,
                "message": f"Board {runtime.board_id} ({board.name}) synced.",
            }
        )

        release_versions_synced = 0
        project_key_for_versions = runtime.project_key or board.project_key
        version_fetcher = getattr(connector, "get_project_versions", None)
        if project_key_for_versions and callable(version_fetcher):
            emit(
                {
                    "phase": "releases",
                    "boardsSynced": 1,
                    "sprintsSynced": 0,
                    "downloadedIssues": 0,
                    "totalIssues": None,
                    "percent": None,
                    "message": f"Syncing releases for project {project_key_for_versions}.",
                }
            )
            versions = version_fetcher(project_key_for_versions)
            _upsert_project_versions(conn, versions)
            release_versions_synced = len(versions)
            conn.commit()
            emit(
                {
                    "phase": "releases",
                    "boardsSynced": 1,
                    "sprintsSynced": 0,
                    "downloadedIssues": 0,
                    "totalIssues": None,
                    "percent": None,
                    "message": f"{release_versions_synced} JIRA releases synced.",
                }
            )

        emit(
            {
                "phase": "sprints",
                "boardsSynced": 1,
                "sprintsSynced": 0,
                "downloadedIssues": 0,
                "totalIssues": None,
                "percent": None,
                "message": f"Syncing sprints for board {runtime.board_id}.",
            }
        )
        sprints = connector.get_sprints(runtime.board_id)
        _upsert_sprints(conn, sprints)
        _update_sync_run(conn, sync_run_id, sprints_synced=len(sprints))
        conn.commit()
        emit(
            {
                "phase": "sprints",
                "boardsSynced": 1,
                "sprintsSynced": len(sprints),
                "downloadedIssues": 0,
                "totalIssues": None,
                "percent": None,
                "message": f"{len(sprints)} sprints synced for board {runtime.board_id}.",
            }
        )

        emit(
            {
                "phase": "issues",
                "boardsSynced": 1,
                "sprintsSynced": len(sprints),
                "downloadedIssues": 0,
                "totalIssues": None,
                "percent": None,
                "message": (
                    "Syncing board issues."
                    if incremental_since_utc is None
                    else (
                        "Syncing issues updated since "
                        f"{incremental_since_utc.strftime('%Y-%m-%d %H:%M')} UTC."
                    )
                ),
            }
        )
        downloaded = 0
        changelog_entries_synced = 0
        total_issues: int | None = None
        stale_sprint_links_cleared = 0
        active_sprint_issues_hydrated = 0
        active_sprint_changelog_entries_synced = 0
        if incremental_since_utc is not None:
            count_incremental = getattr(connector, "count_incremental_issues", None)
            if callable(count_incremental):
                try:
                    counted_total = count_incremental(incremental_since_utc)
                    if isinstance(counted_total, int) and counted_total >= 0:
                        total_issues = counted_total
                except Exception:  # noqa: BLE001
                    # Keep sync running even if total pre-count fails.
                    total_issues = None
        start_at = 0
        while True:
            if incremental_since_utc is not None:
                issues, batch = connector.incremental_issues(
                    updated_since=incremental_since_utc,
                    start_at=start_at,
                    max_results=100,
                )
                page_total = None
            else:
                issues, batch, page_total = connector.get_board_issues(
                    runtime.board_id,
                    start_at=start_at,
                    max_results=100,
                )
            if total_issues is None and page_total is not None:
                total_issues = page_total

            _upsert_issues(conn, issues)
            for index, issue in enumerate(issues, start=1):
                changelog_items = connector.get_issue_changelog(issue.issue_key)
                _replace_issue_changelog(conn, issue.issue_key, changelog_items)
                changelog_entries_synced += len(changelog_items)
                current_downloaded = downloaded + index
                if index % 10 == 0 or index == len(issues):
                    _update_sync_run(
                        conn,
                        sync_run_id,
                        issues_synced=current_downloaded,
                        total_issues=total_issues,
                    )
                    conn.commit()
                    percent = _safe_percent(current_downloaded, total_issues)
                    emit(
                        {
                            "phase": "issues",
                            "boardsSynced": 1,
                            "sprintsSynced": len(sprints),
                            "downloadedIssues": current_downloaded,
                            "totalIssues": total_issues,
                            "percent": percent,
                            "message": (
                                f"{current_downloaded} of {total_issues} issues downloaded; "
                                f"{changelog_entries_synced} changelog events synced"
                                if total_issues is not None
                                else (
                                    f"{current_downloaded} issues downloaded; "
                                    f"{changelog_entries_synced} changelog events synced"
                                )
                            ),
                        }
                    )
            downloaded += len(issues)
            _update_sync_run(
                conn,
                sync_run_id,
                issues_synced=downloaded,
                total_issues=total_issues,
            )
            conn.commit()

            if not batch.has_more:
                break
            if batch.next_cursor is None:
                break
            start_at = int(batch.next_cursor)

        active_sprint_ids = _active_sprint_ids(sprints)
        live_issue_keys_by_sprint: dict[int, set[str]] | None = None
        if active_sprint_ids:
            (
                active_sprint_issues_hydrated,
                active_sprint_changelog_entries_synced,
                live_issue_keys_by_sprint,
            ) = _sync_active_sprint_issues(
                conn,
                connector,
                active_sprint_ids,
            )
            if active_sprint_issues_hydrated > 0:
                changelog_entries_synced += active_sprint_changelog_entries_synced
                _update_sync_run(
                    conn,
                    sync_run_id,
                    issues_synced=downloaded,
                    total_issues=total_issues,
                )
                conn.commit()
                emit(
                    {
                        "phase": "issues",
                        "boardsSynced": 1,
                        "sprintsSynced": len(sprints),
                        "downloadedIssues": downloaded,
                        "totalIssues": total_issues,
                        "percent": _safe_percent(downloaded, total_issues),
                        "message": (
                            f"Hydrated {active_sprint_issues_hydrated} active sprint issues; "
                            f"{changelog_entries_synced} changelog events synced"
                        ),
                    }
                )
            stale_sprint_links_cleared = _reconcile_active_sprint_membership(
                conn,
                connector,
                active_sprint_ids,
                runtime.sprint_field_candidates,
                live_issue_keys_by_sprint=live_issue_keys_by_sprint,
            )
            conn.commit()

        if total_issues is None:
            total_issues = downloaded

        completed_at = _utc_iso_now()
        _update_sync_run(
            conn,
            sync_run_id,
            issues_synced=downloaded,
            total_issues=total_issues,
            status="completed",
            finished_at=completed_at,
        )
        _upsert_checkpoint(
            conn,
            scope,
            status="idle",
            last_cursor=completed_at,
            last_synced_at=completed_at,
            error_message=None,
        )
        conn.commit()

        return {
            "source": "jira",
            "state": "completed",
            "phase": "done",
            "boardsSynced": 1,
            "sprintsSynced": len(sprints),
            "downloadedIssues": downloaded,
            "totalIssues": total_issues,
            "percent": _safe_percent(downloaded, total_issues),
            "finishedAt": completed_at,
            "lastSyncedAt": completed_at,
            "syncMode": effective_mode,
            "requestedSyncMode": requested_mode,
            "requestedSince": requested_since,
            "releaseVersionsSynced": release_versions_synced,
            "staleSprintLinksCleared": stale_sprint_links_cleared,
            "activeSprintIssuesHydrated": active_sprint_issues_hydrated,
            "activeSprintChangelogEntriesSynced": active_sprint_changelog_entries_synced,
            "error": None,
            "message": (
                "Sync complete."
                if active_sprint_issues_hydrated <= 0
                else f"Sync complete. Hydrated {active_sprint_issues_hydrated} active sprint issues."
            ),
        }
    except Exception as exc:  # noqa: BLE001
        try:
            if sync_run_id is not None:
                _update_sync_run(
                    conn,
                    sync_run_id,
                    status="failed",
                    finished_at=_utc_iso_now(),
                    error_message=str(exc),
                )
            _upsert_checkpoint(conn, scope, status="failed", error_message=str(exc))
            conn.commit()
        except Exception:  # noqa: BLE001
            pass
        raise
    finally:
        conn.close()


class JiraSyncManager:
    def __init__(
        self,
        *,
        db_path_provider: Callable[[], str] = _resolve_db_path,
        sync_runner: SyncRunner = run_jira_sync_once,
    ) -> None:
        self._db_path_provider = db_path_provider
        self._sync_runner = sync_runner
        self._lock = threading.Lock()
        self._state: dict[str, Any] = {
            "source": "jira",
            "state": "idle",
            "phase": "idle",
            "syncMode": SYNC_MODE_FULL,
            "requestedSince": None,
            "boardsSynced": 0,
            "sprintsSynced": 0,
            "downloadedIssues": 0,
            "totalIssues": None,
            "percent": None,
            "startedAt": None,
            "finishedAt": None,
            "lastSyncedAt": None,
            "error": None,
            "message": "Idle",
        }

    def _snapshot(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._state)

    def _update_progress(self, update: dict[str, Any]) -> None:
        with self._lock:
            self._state["state"] = "running"
            self._state["phase"] = update.get("phase", self._state["phase"])
            self._state["boardsSynced"] = update.get("boardsSynced", self._state["boardsSynced"])
            self._state["sprintsSynced"] = update.get("sprintsSynced", self._state["sprintsSynced"])
            self._state["downloadedIssues"] = update.get(
                "downloadedIssues", self._state["downloadedIssues"]
            )
            self._state["totalIssues"] = update.get("totalIssues", self._state["totalIssues"])
            self._state["percent"] = update.get("percent", self._state["percent"])
            self._state["message"] = update.get("message", self._state["message"])
            self._state["error"] = None

    def _resolve_runtime_scope(self) -> str | None:
        try:
            runtime = _load_runtime()
        except Exception:  # noqa: BLE001
            return None
        if runtime.board_id is None:
            return None
        return _scope_key(runtime.board_id)

    def _hydrate_from_persisted(self, state: dict[str, Any]) -> dict[str, Any]:
        if state.get("state") == "running":
            return state

        scope = self._resolve_runtime_scope()
        if not scope:
            return state

        db_path = self._db_path_provider()
        try:
            latest_run = _read_latest_sync_run(db_path)
            checkpoint = _read_checkpoint(db_path, scope)
        except Exception:  # noqa: BLE001
            return state

        if latest_run and latest_run.get("status") == "running":
            stale_message = "Previous sync was interrupted. Please run Sync Data again."
            latest_run = (
                _mark_stale_run_failed(db_path, int(latest_run["id"]), str(latest_run["scopeKey"]), stale_message)
                or latest_run
            )
            if checkpoint and checkpoint.get("status") == "running":
                checkpoint["status"] = "failed"
                checkpoint["error"] = stale_message

        if latest_run:
            mapped_status = str(latest_run.get("status") or "idle")
            mapped_state = mapped_status if mapped_status in {"running", "completed", "failed"} else "idle"
            phase = "issues" if mapped_state == "running" else ("done" if mapped_state == "completed" else "failed" if mapped_state == "failed" else "idle")
            message = "Sync complete." if mapped_state == "completed" else ("JIRA sync failed." if mapped_state == "failed" else "Idle")

            state.update(
                {
                    "state": mapped_state,
                    "phase": phase,
                    "syncMode": latest_run.get("syncMode", self._state.get("syncMode", SYNC_MODE_FULL)),
                    "requestedSince": latest_run.get("requestedSince"),
                    "boardsSynced": int(latest_run.get("boardsSynced") or 0),
                    "sprintsSynced": int(latest_run.get("sprintsSynced") or 0),
                    "downloadedIssues": int(latest_run.get("issuesSynced") or 0),
                    "totalIssues": latest_run.get("totalIssues"),
                    "percent": _safe_percent(
                        int(latest_run.get("issuesSynced") or 0),
                        int(latest_run["totalIssues"]) if latest_run.get("totalIssues") is not None else None,
                    ),
                    "startedAt": latest_run.get("startedAt"),
                    "finishedAt": latest_run.get("finishedAt"),
                    "error": latest_run.get("error"),
                    "message": message,
                }
            )

        if checkpoint and checkpoint.get("lastSyncedAt"):
            state["lastSyncedAt"] = checkpoint["lastSyncedAt"]

        with self._lock:
            if self._state.get("state") != "running":
                self._state.update(
                    {
                        "state": state.get("state", self._state["state"]),
                        "phase": state.get("phase", self._state["phase"]),
                        "syncMode": state.get("syncMode", self._state["syncMode"]),
                        "requestedSince": state.get("requestedSince", self._state["requestedSince"]),
                        "boardsSynced": state.get("boardsSynced", self._state["boardsSynced"]),
                        "sprintsSynced": state.get("sprintsSynced", self._state["sprintsSynced"]),
                        "downloadedIssues": state.get("downloadedIssues", self._state["downloadedIssues"]),
                        "totalIssues": state.get("totalIssues", self._state["totalIssues"]),
                        "percent": state.get("percent", self._state["percent"]),
                        "startedAt": state.get("startedAt", self._state["startedAt"]),
                        "finishedAt": state.get("finishedAt", self._state["finishedAt"]),
                        "lastSyncedAt": state.get("lastSyncedAt", self._state["lastSyncedAt"]),
                        "error": state.get("error", self._state["error"]),
                        "message": state.get("message", self._state["message"]),
                    }
                )
        return state

    def get_status(self) -> dict[str, Any]:
        state = self._snapshot()
        return self._hydrate_from_persisted(state)

    def get_history(self, limit: int = 20) -> list[dict[str, Any]]:
        safe_limit = max(1, min(int(limit), 200))
        state = self._snapshot()
        if state.get("state") != "running":
            # Reconcile stale persisted state before returning history.
            _ = self._hydrate_from_persisted(dict(state))
        return _read_sync_history(self._db_path_provider(), safe_limit)

    def start(self, mode: str | None = None, since_date: str | None = None) -> dict[str, Any]:
        normalized_mode = _normalize_sync_mode(mode)
        requested_since = _parse_requested_since(since_date) if normalized_mode == SYNC_MODE_SINCE_DATE else None
        if normalized_mode == SYNC_MODE_SINCE_DATE:
            if requested_since is None:
                raise ValueError(
                    "sinceDate is required in YYYY-MM-DD or ISO-8601 format when mode is since_date."
                )
            if requested_since > datetime.now(timezone.utc):
                raise ValueError("sinceDate must be in the past.")

        normalized_since = requested_since.isoformat() if requested_since is not None else None
        with self._lock:
            if self._state["state"] == "running":
                snapshot = dict(self._state)
                snapshot["started"] = False
                return snapshot

            started_at = _utc_iso_now()
            self._state.update(
                {
                    "state": "running",
                    "phase": "initializing",
                    "syncMode": normalized_mode,
                    "requestedSince": normalized_since,
                    "boardsSynced": 0,
                    "sprintsSynced": 0,
                    "downloadedIssues": 0,
                    "totalIssues": None,
                    "percent": None,
                    "startedAt": started_at,
                    "finishedAt": None,
                    "error": None,
                    "message": "Starting JIRA sync.",
                }
            )

        thread = threading.Thread(
            target=self._run_background,
            args=(normalized_mode, normalized_since),
            daemon=True,
        )
        thread.start()

        snapshot = self._snapshot()
        snapshot["started"] = True
        return snapshot

    def _run_background(self, sync_mode: SyncMode, since_date: str | None = None) -> None:
        try:
            result = self._sync_runner(
                progress_callback=self._update_progress,
                db_path=self._db_path_provider(),
                sync_mode=sync_mode,
                since_date=since_date,
            )
        except Exception as exc:  # noqa: BLE001
            failed_at = _utc_iso_now()
            with self._lock:
                self._state.update(
                    {
                        "state": "failed",
                        "phase": "failed",
                        "syncMode": sync_mode,
                        "requestedSince": since_date,
                        "boardsSynced": self._state.get("boardsSynced", 0),
                        "sprintsSynced": self._state.get("sprintsSynced", 0),
                        "finishedAt": failed_at,
                        "error": str(exc),
                        "message": "JIRA sync failed.",
                    }
                )
            return

        with self._lock:
            self._state.update(
                {
                    "state": result.get("state", "completed"),
                    "phase": result.get("phase", "done"),
                    "syncMode": result.get("syncMode", sync_mode),
                    "requestedSince": result.get("requestedSince", since_date),
                    "boardsSynced": result.get("boardsSynced", self._state.get("boardsSynced", 0)),
                    "sprintsSynced": result.get("sprintsSynced", self._state.get("sprintsSynced", 0)),
                    "downloadedIssues": result.get("downloadedIssues", 0),
                    "totalIssues": result.get("totalIssues"),
                    "percent": result.get("percent"),
                    "finishedAt": result.get("finishedAt"),
                    "lastSyncedAt": result.get("lastSyncedAt"),
                    "error": result.get("error"),
                    "message": result.get("message", "Sync complete."),
                }
            )


JIRA_SYNC_MANAGER = JiraSyncManager()


def get_jira_sync_status() -> dict[str, Any]:
    return JIRA_SYNC_MANAGER.get_status()


def start_jira_sync(mode: str | None = None, since_date: str | None = None) -> dict[str, Any]:
    return JIRA_SYNC_MANAGER.start(mode=mode, since_date=since_date)


def get_jira_sync_history(limit: int = 20) -> dict[str, Any]:
    history = JIRA_SYNC_MANAGER.get_history(limit=limit)
    return {"source": "jira", "history": history}
