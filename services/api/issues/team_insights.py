from __future__ import annotations

import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from statistics import median
from typing import Any

from packages.connectors.jira_config import JiraRuntimeConfig, load_env_files
from services.api.integrations.jira_sync import _ensure_schema, _resolve_db_path


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


def _resolve_configured_board_id() -> int | None:
    try:
        load_env_files()
        runtime = JiraRuntimeConfig.from_env()
        return runtime.board_id
    except Exception:  # noqa: BLE001
        return None


def _is_done_status(status_category: str | None, status_name: str | None) -> bool:
    category = _normalize(status_category)
    status = _normalize(status_name)
    if category == "done":
        return True
    return status in {"done", "closed", "resolved", "complete", "completed"}


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
            "maxCycleTimeDays": None,
            "medianCycleTimeDays": None,
        },
        "trend": [],
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
                  sprint_external_id,
                  issue_key,
                  issue_type,
                  status_name,
                  status_category,
                  story_points,
                  resolved_at_source
                FROM issues
                WHERE sprint_external_id IN ({placeholders})
                """,
                tuple(sprint_ids),
            ).fetchall()

        first_in_progress_by_issue_key: dict[str, datetime] = {}
        issue_keys = sorted({str(row["issue_key"]).strip() for row in issue_rows if row["issue_key"] is not None})
        if issue_keys:
            issue_placeholders = ",".join("?" for _ in issue_keys)
            changelog_rows = conn.execute(
                f"""
                SELECT
                  issue_key,
                  changed_at,
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
                if not issue_key or issue_key in first_in_progress_by_issue_key:
                    continue
                if not _is_in_progress_status(changelog_row["to_value"]):
                    continue
                changed_at = _parse_iso_datetime(changelog_row["changed_at"])
                if changed_at is None:
                    continue
                first_in_progress_by_issue_key[issue_key] = changed_at

        issues_by_sprint: dict[int, list[sqlite3.Row]] = defaultdict(list)
        for row in issue_rows:
            sprint_external_id = row["sprint_external_id"]
            if sprint_external_id is None:
                continue
            issues_by_sprint[int(sprint_external_id)].append(row)

        trend: list[dict[str, Any]] = []
        cycle_time_days: list[float] = []
        total_committed_story_points = 0.0
        total_completed_story_points = 0.0
        total_committed_cards = 0
        total_completed_cards = 0

        # Present oldest->newest so trend bars progress left-to-right in time order.
        for sprint_row in reversed(sprint_rows):
            sprint_external_id = int(sprint_row["external_sprint_id"])
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

                if _is_done_status(issue_row["status_category"], issue_row["status_name"]):
                    completed_cards += 1
                    if story_points is not None:
                        completed_story_points += story_points

                    # Exclude epics from cycle-time metrics.
                    issue_type = _normalize(issue_row["issue_type"])
                    if issue_type == "epic":
                        continue

                    issue_key = str(issue_row["issue_key"]).strip()
                    in_progress_at = first_in_progress_by_issue_key.get(issue_key)
                    resolved_at = _parse_iso_datetime(issue_row["resolved_at_source"])
                    if in_progress_at is not None and resolved_at is not None and resolved_at >= in_progress_at:
                        duration_days = (resolved_at - in_progress_at).total_seconds() / 86400.0
                        cycle_time_days.append(duration_days)
                        sprint_cycle_time_days.append(duration_days)

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
        max_cycle_time_days = _round_metric(max(cycle_time_days)) if cycle_time_days else None
        median_cycle_time_days = _round_metric(float(median(cycle_time_days))) if cycle_time_days else None

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
            "maxCycleTimeDays": max_cycle_time_days,
            "medianCycleTimeDays": median_cycle_time_days,
        },
        "trend": trend,
        "workMix": {
            "sprintId": work_mix_sprint_id,
            "sprintName": work_mix_sprint["name"],
            "totalIssues": total_mix_issues,
            "slices": mix_slices,
        },
        "summary": summary,
        "error": None,
    }
