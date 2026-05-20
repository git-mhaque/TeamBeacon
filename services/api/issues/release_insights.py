from __future__ import annotations

import os
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from math import ceil
from statistics import median
from typing import Any
from urllib.parse import quote

from packages.connectors.jira_config import JiraRuntimeConfig, load_env_files
from services.api.integrations.jira_sync import (
    _backfill_issue_release_links_from_raw_json,
    _ensure_schema,
    _resolve_db_path,
)


def _normalize(value: str | None) -> str:
    if value is None:
        return ""
    return value.strip().lower()


def _round_metric(value: float) -> float:
    return round(value, 2)


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


def _coerce_story_points(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def _days_between(start: datetime | None, end: datetime | None) -> float | None:
    if start is None or end is None:
        return None
    if end < start:
        return 0.0
    return _round_metric((end - start).total_seconds() / 86400.0)


def _percent(numerator: float, denominator: float) -> float:
    if denominator <= 0:
        return 0.0
    return _round_metric((numerator / denominator) * 100.0)


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    sorted_values = sorted(values)
    rank = max(1, int(ceil(percentile * len(sorted_values))))
    return _round_metric(sorted_values[min(rank - 1, len(sorted_values) - 1)])


def _resolve_configured_project_key() -> str | None:
    try:
        load_env_files()
        runtime = JiraRuntimeConfig.from_env()
        return runtime.project_key
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
    return base_url.rstrip("/") if base_url else None


def _resolve_project_key_from_db(conn: sqlite3.Connection) -> str | None:
    row = conn.execute(
        """
        SELECT project_key
        FROM jira_project_versions
        WHERE project_key IS NOT NULL
          AND TRIM(project_key) <> ''
        GROUP BY project_key
        ORDER BY COUNT(*) DESC, project_key ASC
        LIMIT 1
        """
    ).fetchone()
    if row is None:
        return None
    project_key = str(row["project_key"]).strip() if row["project_key"] is not None else ""
    return project_key or None


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
    return status in {"to do", "todo", "backlog", "open", "new", "ready for development"}


def _issue_url(jira_base_url: str | None, issue_key: str | None) -> str | None:
    if not jira_base_url or not issue_key:
        return None
    return f"{jira_base_url}/browse/{quote(issue_key)}"


def _empty_response(error: str | None = None) -> dict[str, Any]:
    return {
        "source": "local",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "projectKey": None,
        "metrics": {
            "totalReleases": 0,
            "releasedCount": 0,
            "ongoingCount": 0,
            "archivedCount": 0,
            "overdueCount": 0,
            "dueSoonCount": 0,
            "avgCycleTimeDays": None,
            "medianCycleTimeDays": None,
            "p85CycleTimeDays": None,
            "avgCadenceDays": None,
            "deliveredStoryPoints": 0.0,
        },
        "cycleTimeTrend": [],
        "ongoingReleases": [],
        "recentReleases": [],
        "riskSignals": [],
        "summary": "Release insights will appear once release data is synced.",
        "error": error,
    }


def _issue_mix_summary(issue_type_counts: Counter[str]) -> list[dict[str, Any]]:
    total = sum(issue_type_counts.values())
    return [
        {
            "label": label,
            "count": count,
            "percent": _percent(float(count), float(total)),
        }
        for label, count in sorted(issue_type_counts.items(), key=lambda item: (-item[1], item[0].lower()))
    ]


def _release_risk(
    *,
    released: bool,
    archived: bool,
    total_issues: int,
    readiness_percent: float,
    start_date: datetime | None,
    release_date: datetime | None,
    due_in_days: float | None,
    overdue_days: float | None,
    critical_open_count: int,
) -> tuple[str, str]:
    if archived:
        return "neutral", "Archived release."
    if total_issues == 0:
        return "amber", "No linked release scope yet."
    if released:
        if readiness_percent < 100:
            return "amber", "Released with unresolved linked scope."
        return "green", "Released with linked scope complete."
    if overdue_days is not None and overdue_days > 0:
        return "red", f"Overdue by {overdue_days:.0f} days with {100 - readiness_percent:.0f}% remaining."
    if critical_open_count > 0:
        return "red", f"{critical_open_count} high-priority linked issue(s) still open."
    if release_date is not None and due_in_days is not None and due_in_days <= 14 and readiness_percent < 80:
        return "amber", f"Due in {max(0, due_in_days):.0f} days at {readiness_percent:.0f}% readiness."
    if start_date is None or release_date is None:
        return "amber", "Missing start or target release date."
    return "green", "On track based on linked scope and target date."


def get_release_insights(
    *,
    release_limit: int = 12,
    db_path: str | None = None,
    project_key: str | None = None,
) -> dict[str, Any]:
    safe_release_limit = max(3, min(int(release_limit), 100))
    resolved_db_path = db_path or _resolve_db_path()
    configured_project_key = project_key or _resolve_configured_project_key()

    conn = sqlite3.connect(resolved_db_path)
    conn.row_factory = sqlite3.Row
    try:
        _ensure_schema(conn)
        link_count_row = conn.execute("SELECT COUNT(*) FROM issue_release_links").fetchone()
        if int(link_count_row[0] or 0) == 0:
            _backfill_issue_release_links_from_raw_json(conn)
            conn.commit()

        scoped_project_key = configured_project_key or _resolve_project_key_from_db(conn)
        jira_base_url = _resolve_jira_base_url() or _resolve_jira_base_url_from_db(conn)
        version_rows = conn.execute(
            """
            SELECT
              version_id,
              project_key,
              name,
              description,
              archived,
              released,
              start_date,
              release_date,
              updated_at
            FROM jira_project_versions
            WHERE (? IS NULL OR project_key = ?)
            ORDER BY
              archived ASC,
              released ASC,
              datetime(COALESCE(release_date, start_date, updated_at)) DESC,
              name ASC
            """,
            (scoped_project_key, scoped_project_key),
        ).fetchall()

        if not version_rows:
            return _empty_response("No releases found in local data. Run Sync Data after configuring release sync.")

        version_ids = [str(row["version_id"]) for row in version_rows]
        issue_rows_by_version_id: dict[str, list[sqlite3.Row]] = defaultdict(list)
        if version_ids:
            placeholders = ",".join("?" for _ in version_ids)
            issue_rows = conn.execute(
                f"""
                SELECT
                  l.version_id,
                  i.issue_key,
                  i.project_key,
                  i.issue_type,
                  i.summary,
                  i.status_name,
                  i.status_category,
                  i.priority,
                  i.story_points,
                  i.created_at_source,
                  i.resolved_at_source
                FROM issue_release_links l
                JOIN issues i ON i.issue_key = l.issue_key
                WHERE l.version_id IN ({placeholders})
                  AND (? IS NULL OR COALESCE(i.project_key, l.project_key) = ?)
                ORDER BY i.issue_key ASC
                """,
                tuple(version_ids) + (scoped_project_key, scoped_project_key),
            ).fetchall()
            for row in issue_rows:
                issue_rows_by_version_id[str(row["version_id"])].append(row)
    finally:
        conn.close()

    now = datetime.now(timezone.utc)
    release_rows: list[dict[str, Any]] = []
    released_cycle_times: list[float] = []
    released_dates: list[datetime] = []
    delivered_story_points = 0.0

    for version_row in version_rows:
        version_id = str(version_row["version_id"])
        start_date = _parse_iso_datetime(version_row["start_date"])
        release_date = _parse_iso_datetime(version_row["release_date"])
        released = bool(version_row["released"])
        archived = bool(version_row["archived"])
        linked_issues = issue_rows_by_version_id.get(version_id, [])

        total_story_points = 0.0
        done_story_points = 0.0
        done_issues = 0
        todo_issues = 0
        in_progress_issues = 0
        critical_open_count = 0
        issue_type_counts: Counter[str] = Counter()
        sample_open_issues: list[dict[str, Any]] = []

        for issue_row in linked_issues:
            story_points = _coerce_story_points(issue_row["story_points"])
            if story_points is not None:
                total_story_points += story_points
            status_name = issue_row["status_name"]
            status_category = issue_row["status_category"]
            is_done = _is_done_status(status_category, status_name)
            is_todo = _is_todo_status(status_category, status_name)
            if is_done:
                done_issues += 1
                if story_points is not None:
                    done_story_points += story_points
            elif is_todo:
                todo_issues += 1
            else:
                in_progress_issues += 1

            priority = _normalize(issue_row["priority"])
            if not is_done and priority in {"blocker", "critical", "highest", "high"}:
                critical_open_count += 1

            issue_type = (
                str(issue_row["issue_type"]).strip()
                if issue_row["issue_type"] is not None and str(issue_row["issue_type"]).strip()
                else "Unspecified"
            )
            issue_type_counts[issue_type] += 1

            if not is_done and len(sample_open_issues) < 5:
                issue_key = str(issue_row["issue_key"]).strip() if issue_row["issue_key"] is not None else ""
                sample_open_issues.append(
                    {
                        "issueKey": issue_key,
                        "issueUrl": _issue_url(jira_base_url, issue_key),
                        "summary": issue_row["summary"] or "",
                        "status": status_name or "Unknown",
                        "priority": issue_row["priority"],
                        "storyPoints": _round_metric(story_points) if story_points is not None else None,
                    }
                )

        total_issues = len(linked_issues)
        readiness_percent = (
            _percent(done_story_points, total_story_points)
            if total_story_points > 0
            else _percent(float(done_issues), float(total_issues))
        )
        cycle_time_days = _days_between(start_date, release_date) if released else None
        age_days = _days_between(start_date, release_date if released else now)
        due_in_days = _days_between(now, release_date) if release_date is not None and release_date >= now else None
        overdue_days = _days_between(release_date, now) if not released and release_date is not None and release_date < now else None
        risk_level, risk_summary = _release_risk(
            released=released,
            archived=archived,
            total_issues=total_issues,
            readiness_percent=readiness_percent,
            start_date=start_date,
            release_date=release_date,
            due_in_days=due_in_days,
            overdue_days=overdue_days,
            critical_open_count=critical_open_count,
        )

        if released and cycle_time_days is not None:
            released_cycle_times.append(cycle_time_days)
        if released and release_date is not None:
            released_dates.append(release_date)
            delivered_story_points += done_story_points

        release_rows.append(
            {
                "versionId": version_id,
                "projectKey": version_row["project_key"],
                "name": version_row["name"],
                "description": version_row["description"],
                "archived": archived,
                "released": released,
                "startDate": start_date.isoformat() if start_date is not None else None,
                "releaseDate": release_date.isoformat() if release_date is not None else None,
                "cycleTimeDays": cycle_time_days,
                "ageDays": age_days,
                "dueInDays": due_in_days,
                "overdueDays": overdue_days,
                "issueCount": total_issues,
                "doneIssueCount": done_issues,
                "inProgressIssueCount": in_progress_issues,
                "todoIssueCount": todo_issues,
                "storyPoints": _round_metric(total_story_points),
                "doneStoryPoints": _round_metric(done_story_points),
                "readinessPercent": readiness_percent,
                "criticalOpenIssueCount": critical_open_count,
                "issueTypeMix": _issue_mix_summary(issue_type_counts),
                "sampleOpenIssues": sample_open_issues,
                "riskLevel": risk_level,
                "riskSummary": risk_summary,
            }
        )

    released_dates.sort()
    cadence_days = [
        _days_between(left, right)
        for left, right in zip(released_dates, released_dates[1:])
    ]
    cadence_days = [value for value in cadence_days if value is not None]

    ongoing_releases = [
        row for row in release_rows
        if not row["released"] and not row["archived"]
    ]
    ongoing_releases.sort(
        key=lambda row: (
            row["releaseDate"] is None,
            row["releaseDate"] or "",
            -float(row["storyPoints"] or 0),
            row["name"].lower(),
        )
    )
    recent_releases = [
        row for row in release_rows
        if row["released"] and not row["archived"]
    ]
    recent_releases.sort(
        key=lambda row: (
            row["releaseDate"] or "",
            row["name"].lower(),
        ),
        reverse=True,
    )

    trend_source = [
        row for row in recent_releases
        if row["cycleTimeDays"] is not None and row["releaseDate"] is not None
    ][:safe_release_limit]
    trend_source.reverse()
    cycle_time_trend = [
        {
            "versionId": row["versionId"],
            "name": row["name"],
            "releaseDate": row["releaseDate"],
            "cycleTimeDays": row["cycleTimeDays"],
            "storyPoints": row["doneStoryPoints"],
            "issueCount": row["doneIssueCount"],
        }
        for row in trend_source
    ]

    overdue_count = sum(1 for row in ongoing_releases if (row["overdueDays"] or 0) > 0)
    due_soon_count = sum(
        1
        for row in ongoing_releases
        if row["dueInDays"] is not None and float(row["dueInDays"]) <= 14
    )
    archived_count = sum(1 for row in release_rows if row["archived"])
    released_count = sum(1 for row in release_rows if row["released"] and not row["archived"])

    risk_signals: list[dict[str, Any]] = []
    for row in ongoing_releases:
        if row["riskLevel"] in {"red", "amber"}:
            risk_signals.append(
                {
                    "level": row["riskLevel"],
                    "title": row["name"],
                    "detail": row["riskSummary"],
                }
            )
    missing_date_count = sum(
        1
        for row in release_rows
        if not row["archived"] and (row["startDate"] is None or row["releaseDate"] is None)
    )
    if missing_date_count > 0:
        risk_signals.append(
            {
                "level": "amber",
                "title": "Release date hygiene",
                "detail": f"{missing_date_count} active release(s) are missing start or release dates.",
            }
        )
    no_scope_count = sum(
        1 for row in release_rows if not row["archived"] and int(row["issueCount"]) == 0
    )
    if no_scope_count > 0:
        risk_signals.append(
            {
                "level": "amber",
                "title": "Scope linkage",
                "detail": f"{no_scope_count} active release(s) have no linked release scope.",
            }
        )

    avg_cycle_time_days = (
        _round_metric(sum(released_cycle_times) / len(released_cycle_times))
        if released_cycle_times
        else None
    )
    median_cycle_time_days = _round_metric(float(median(released_cycle_times))) if released_cycle_times else None
    p85_cycle_time_days = _percentile(released_cycle_times, 0.85)
    avg_cadence_days = _round_metric(sum(cadence_days) / len(cadence_days)) if cadence_days else None

    if ongoing_releases:
        summary = (
            f"{len(ongoing_releases)} ongoing release(s), {overdue_count} overdue, "
            f"and {due_soon_count} due within 14 days."
        )
    elif recent_releases:
        summary = (
            f"{len(recent_releases)} completed release(s) available. "
            "No ongoing releases are currently synced."
        )
    else:
        summary = "Release data is synced, but no active or recent release scope is available yet."

    return {
        "source": "local",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "projectKey": scoped_project_key,
        "metrics": {
            "totalReleases": len(release_rows),
            "releasedCount": released_count,
            "ongoingCount": len(ongoing_releases),
            "archivedCount": archived_count,
            "overdueCount": overdue_count,
            "dueSoonCount": due_soon_count,
            "avgCycleTimeDays": avg_cycle_time_days,
            "medianCycleTimeDays": median_cycle_time_days,
            "p85CycleTimeDays": p85_cycle_time_days,
            "avgCadenceDays": avg_cadence_days,
            "deliveredStoryPoints": _round_metric(delivered_story_points),
        },
        "cycleTimeTrend": cycle_time_trend,
        "ongoingReleases": ongoing_releases[:safe_release_limit],
        "recentReleases": recent_releases[:safe_release_limit],
        "riskSignals": risk_signals[:8],
        "summary": summary,
        "error": None,
    }
