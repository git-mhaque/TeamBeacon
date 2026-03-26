from __future__ import annotations

import math
import sqlite3
from datetime import datetime, timezone
from typing import Any

from services.api.integrations.jira_sync import _ensure_schema, _resolve_db_path


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


def _remaining_days(end_date: datetime | None, now_utc: datetime) -> int | None:
    if end_date is None:
        return None
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)
    now_utc = now_utc.astimezone(timezone.utc)
    delta_seconds = (end_date - now_utc).total_seconds()
    return max(0, int(math.ceil(delta_seconds / 86400)))


def get_current_sprint(
    *,
    db_path: str | None = None,
    now_utc: datetime | None = None,
) -> dict[str, Any]:
    resolved_db_path = db_path or _resolve_db_path()
    current_time = now_utc or datetime.now(timezone.utc)

    conn = sqlite3.connect(resolved_db_path)
    conn.row_factory = sqlite3.Row
    try:
        _ensure_schema(conn)
        row = conn.execute(
            """
            SELECT
              external_sprint_id,
              board_external_id,
              name,
              state,
              start_date,
              end_date
            FROM sprints
            WHERE lower(state) = 'active'
            ORDER BY
              CASE WHEN start_date IS NULL THEN 1 ELSE 0 END ASC,
              datetime(start_date) DESC,
              datetime(updated_at) DESC,
              external_sprint_id DESC
            LIMIT 1
            """
        ).fetchone()
    finally:
        conn.close()

    if row is None:
        return {
            "source": "local",
            "sprint": None,
            "error": "No active sprint found in local data.",
        }

    end_date = _parse_iso_datetime(row["end_date"])
    return {
        "source": "local",
        "sprint": {
            "id": row["external_sprint_id"],
            "boardId": row["board_external_id"],
            "name": row["name"],
            "state": row["state"],
            "startDate": row["start_date"],
            "endDate": row["end_date"],
            "remainingDays": _remaining_days(end_date, current_time),
        },
        "error": None,
    }
