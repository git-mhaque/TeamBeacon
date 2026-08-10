from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from services.api.issues.current_sprint_changes import get_current_sprint_changes
from services.api.issues.initiative_deep_dive import get_initiative_deep_dive
from services.api.issues.release_insights import get_release_insights
from services.api.issues.team_insights import get_team_insights
from services.api.metadata.epic_config import get_configured_epic_summary, get_epic_lookup_config


_ALLOWED_FLOW_WEEKS = {1, 4, 12}
_RECENT_COMPLETION_DAYS = 7


def _normalize_flow_weeks(value: int | str) -> int:
    try:
        normalized = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("flowWeeks must be an integer.") from exc
    if normalized not in _ALLOWED_FLOW_WEEKS:
        raise ValueError("flowWeeks must be one of 1, 4, or 12.")
    return normalized


def _normalize_recent_limit(value: int | str) -> int:
    try:
        normalized = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("recentLimit must be an integer.") from exc
    if normalized < 1:
        raise ValueError("recentLimit must be a positive integer.")
    return min(normalized, 20)


def _parse_datetime(value: Any) -> datetime | None:
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


def _safe_call(
    section: str,
    errors: dict[str, str],
    provider: Callable[..., dict[str, Any]],
    **kwargs: Any,
) -> dict[str, Any]:
    try:
        payload = provider(**kwargs)
    except Exception as exc:  # noqa: BLE001 - dashboard sections must fail independently
        errors[section] = str(exc) or exc.__class__.__name__
        return {}
    payload_error = payload.get("error")
    if isinstance(payload_error, str) and payload_error.strip():
        errors[section] = payload_error.strip()
    return payload


def _cycle_time_comparison(team_insights: dict[str, Any]) -> dict[str, Any] | None:
    trend = team_insights.get("trend")
    if not isinstance(trend, list):
        return None
    completed_points: list[dict[str, Any]] = []
    for point in trend:
        if not isinstance(point, dict):
            continue
        state = str(point.get("state") or "").strip().lower()
        value = point.get("avgCycleTimeDays")
        if state not in {"closed", "complete", "completed"} or not isinstance(value, (int, float)):
            continue
        completed_points.append(point)
    if not completed_points:
        return None

    latest = completed_points[-1]
    previous = completed_points[-2] if len(completed_points) > 1 else None
    latest_value = float(latest["avgCycleTimeDays"])
    previous_value = float(previous["avgCycleTimeDays"]) if previous is not None else None
    delta_days = round(latest_value - previous_value, 1) if previous_value is not None else None
    delta_percent = (
        round((delta_days / previous_value) * 100.0, 1)
        if delta_days is not None and previous_value not in {None, 0.0}
        else None
    )
    direction = "flat"
    if delta_days is not None and delta_days > 0:
        direction = "up"
    elif delta_days is not None and delta_days < 0:
        direction = "down"

    return {
        "latestSprintId": latest.get("sprintId"),
        "latestSprintName": latest.get("sprintName"),
        "latestAverageDays": round(latest_value, 1),
        "previousSprintId": previous.get("sprintId") if previous is not None else None,
        "previousSprintName": previous.get("sprintName") if previous is not None else None,
        "previousAverageDays": round(previous_value, 1) if previous_value is not None else None,
        "deltaDays": delta_days,
        "deltaPercent": delta_percent,
        "direction": direction,
    }


def get_team_dashboard(
    *,
    flow_weeks: int | str = 4,
    recent_limit: int | str = 5,
    timezone_name: str | None = None,
    db_path: str | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    normalized_flow_weeks = _normalize_flow_weeks(flow_weeks)
    normalized_recent_limit = _normalize_recent_limit(recent_limit)
    generated_at = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    recent_cutoff = generated_at - timedelta(days=_RECENT_COMPLETION_DAYS)
    errors: dict[str, str] = {}

    lookup = _safe_call(
        "workStreams",
        errors,
        get_epic_lookup_config,
        db_path=db_path,
    )
    work_streams = lookup.get("groups") if isinstance(lookup.get("groups"), list) else []

    epic_summary = _safe_call(
        "progress",
        errors,
        get_configured_epic_summary,
        limit=200,
        timezone_name=timezone_name,
        db_path=db_path,
    )
    epics = epic_summary.get("epics") if isinstance(epic_summary.get("epics"), list) else []
    progress_by_group: dict[int, dict[str, int]] = {}
    for epic in epics:
        if not isinstance(epic, dict):
            continue
        groups = epic.get("groups") if isinstance(epic.get("groups"), list) else []
        for group in groups:
            if not isinstance(group, dict) or not isinstance(group.get("id"), int):
                continue
            group_id = int(group["id"])
            progress = progress_by_group.setdefault(group_id, {"total": 0, "completed": 0, "epics": 0})
            progress["total"] += max(0, int(epic.get("totalCards") or 0))
            progress["completed"] += max(0, int(epic.get("completedCards") or 0))
            progress["epics"] += 1

    dashboard_work_streams: list[dict[str, Any]] = []
    recent_cards_by_key: dict[str, dict[str, Any]] = {}
    flow_period: dict[str, Any] = {
        "weeks": normalized_flow_weeks,
        "startDate": None,
        "endDate": None,
    }
    for work_stream in work_streams:
        if not isinstance(work_stream, dict) or not isinstance(work_stream.get("id"), int):
            continue
        group_id = int(work_stream["id"])
        group_name = str(work_stream.get("name") or f"Work Stream {group_id}").strip()
        deep_dive = _safe_call(
            f"workStreams.{group_id}",
            errors,
            get_initiative_deep_dive,
            group_ids=[group_id],
            chart_weeks=normalized_flow_weeks,
            activity="all",
            timezone_name=timezone_name,
            limit=1000,
            db_path=db_path,
        )
        weekly = deep_dive.get("weekly") if isinstance(deep_dive.get("weekly"), list) else []
        new_count = sum(int(bucket.get("newCount") or 0) for bucket in weekly if isinstance(bucket, dict))
        completed_in_period = sum(
            int(bucket.get("completedCount") or 0) for bucket in weekly if isinstance(bucket, dict)
        )
        chart_range = deep_dive.get("chartRange")
        if isinstance(chart_range, dict) and flow_period["startDate"] is None:
            flow_period["startDate"] = chart_range.get("startDate")
            flow_period["endDate"] = chart_range.get("endDate")

        progress = progress_by_group.get(group_id, {"total": 0, "completed": 0, "epics": 0})
        total_cards = progress["total"]
        total_completed_cards = progress["completed"]
        completion_percent = round((total_completed_cards / total_cards) * 100.0, 1) if total_cards > 0 else 0.0
        dashboard_work_streams.append(
            {
                "id": group_id,
                "name": group_name,
                "epicCount": progress["epics"],
                "newCount": new_count,
                "completedCount": completed_in_period,
                "netFlow": new_count - completed_in_period,
                "currentWipCount": max(0, int(deep_dive.get("currentWipCount") or 0)),
                "totalCards": total_cards,
                "totalCompletedCards": total_completed_cards,
                "completionPercent": completion_percent,
                "error": errors.get(f"workStreams.{group_id}"),
            }
        )

        cards = deep_dive.get("cards") if isinstance(deep_dive.get("cards"), list) else []
        for card in cards:
            if not isinstance(card, dict):
                continue
            issue_key = str(card.get("issueKey") or "").strip()
            completed_at = _parse_datetime(card.get("completedAt"))
            if not issue_key or completed_at is None or completed_at < recent_cutoff:
                continue
            existing = recent_cards_by_key.get(issue_key)
            existing_completed_at = _parse_datetime(existing.get("completedAt")) if existing else None
            if existing_completed_at is not None and existing_completed_at >= completed_at:
                continue
            recent_cards_by_key[issue_key] = {
                "issueKey": issue_key,
                "issueUrl": card.get("issueUrl"),
                "summary": card.get("summary") or "",
                "epicKey": card.get("epicKey"),
                "epicName": card.get("epicName"),
                "workStreamId": group_id,
                "workStreamName": group_name,
                "completedAt": card.get("completedAt"),
            }

    dashboard_work_streams.sort(key=lambda item: str(item["name"]).lower())
    recent_cards = sorted(
        recent_cards_by_key.values(),
        key=lambda item: _parse_datetime(item.get("completedAt")) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )

    release_insights = _safe_call(
        "release",
        errors,
        get_release_insights,
        release_limit=max(3, normalized_recent_limit),
        db_path=db_path,
    )
    recent_releases = (
        release_insights.get("recentReleases")
        if isinstance(release_insights.get("recentReleases"), list)
        else []
    )
    latest_release = None
    if recent_releases and isinstance(recent_releases[0], dict):
        release = recent_releases[0]
        latest_release = {
            "versionId": release.get("versionId"),
            "name": release.get("name"),
            "releaseDate": release.get("releaseDate"),
            "cycleTimeDays": release.get("cycleTimeDays"),
        }

    team_insights = _safe_call(
        "sprintCycleTime",
        errors,
        get_team_insights,
        sprint_limit=12,
        db_path=db_path,
    )
    sprint_cycle_time = _cycle_time_comparison(team_insights)

    sprint_changes = _safe_call(
        "blockedItems",
        errors,
        get_current_sprint_changes,
        db_path=db_path,
    )
    sprint = sprint_changes.get("sprint") if isinstance(sprint_changes.get("sprint"), dict) else None
    changes = sprint_changes.get("changes") if isinstance(sprint_changes.get("changes"), dict) else {}
    blocked = changes.get("blockedCards") if isinstance(changes.get("blockedCards"), dict) else {}
    blocked_items = blocked.get("issueCards") if isinstance(blocked.get("issueCards"), list) else []

    return {
        "source": "local",
        "generatedAt": generated_at.isoformat(),
        "timezone": timezone_name or "UTC",
        "flowPeriod": flow_period,
        "workStreams": dashboard_work_streams,
        "latestRelease": latest_release,
        "sprintCycleTime": sprint_cycle_time,
        "blockedItems": {
            "sprintId": sprint.get("id") if sprint else None,
            "sprintName": sprint.get("name") if sprint else None,
            "count": max(0, int(blocked.get("count") or 0)),
            "storyPointsTotal": blocked.get("storyPointsTotal") or 0,
            "items": blocked_items[:normalized_recent_limit],
        },
        "recentlyCompleted": {
            "windowDays": _RECENT_COMPLETION_DAYS,
            "count": len(recent_cards),
            "items": recent_cards[:normalized_recent_limit],
        },
        "errors": errors,
    }
