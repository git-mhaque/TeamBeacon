"""Sprint data access and analytics for TeamBeacon."""

from __future__ import annotations

import logging
from statistics import mean
from typing import Iterable

from dateutil import parser

from .config import JiraRuntimeConfig
from .io_utils import write_dataset_to_csv, write_dataset_to_json
from .jira_client import JiraService, fetch_closed_sprints


IN_PROGRESS_STATUSES = ["Analysis", "Kickoff", "In Progress"]
DONE_STATUSES = ["Closed", "Release Ready"]


def get_project_data(project) -> dict:
    if not project:
        return {}
    return {
        "key": getattr(project, "key", None),
        "name": getattr(project, "name", None),
        "description": getattr(project, "description", None),
        "lead": getattr(getattr(project, "lead", None), "displayName", None),
        "url": getattr(project, "self", None),
    }


def get_sprint_data(sprint) -> dict:
    return {
        "id": getattr(sprint, "id", None),
        "name": getattr(sprint, "name", None),
        "state": getattr(sprint, "state", None),
        "startDate": getattr(sprint, "startDate", None),
        "endDate": getattr(sprint, "endDate", None),
        "completeDate": getattr(sprint, "completeDate", None),
    }


def get_issue_data(issue, sp_field_id: str) -> dict:
    fields = getattr(issue, "fields", None)
    return {
        "key": getattr(issue, "key", None),
        "summary": getattr(fields, "summary", None) if fields else None,
        "status": getattr(getattr(fields, "status", None), "name", None) if fields else None,
        "assignee": getattr(getattr(fields, "assignee", None), "displayName", None) if fields else None,
        "reporter": getattr(getattr(fields, "reporter", None), "displayName", None) if fields else None,
        "created": getattr(fields, "created", None) if fields else None,
        "updated": getattr(fields, "updated", None) if fields else None,
        "resolution": getattr(getattr(fields, "resolution", None), "name", None) if fields else None,
        "story_points": getattr(fields, sp_field_id, None) if fields else None,
    }


def compute_cycle_time(issue) -> float | None:
    logging.info("Computing cycle time for issue %s...", getattr(issue, "key", "unknown"))
    changelog = getattr(issue, "changelog", None)
    history_entries = getattr(changelog, "histories", [])

    start_date = None
    end_date = None

    for history in history_entries:
        for item in getattr(history, "items", []):
            if item.field != "status":
                continue
            if item.toString in IN_PROGRESS_STATUSES and start_date is None:
                start_date = parser.parse(history.created)
            if item.toString in DONE_STATUSES:
                end_date = parser.parse(history.created)

    if start_date and end_date:
        delta = end_date - start_date
        return max(0, delta.total_seconds() / 86400)
    return None


def get_sprint_dataset(service: JiraService, sprints, story_points_field: str) -> list[dict]:
    results = []
    for sprint in sprints:
        sprint_id = getattr(sprint, "id", None)
        jql = f"sprint = {sprint_id} AND statusCategory = Done"
        issues = service.search_issues(jql, maxResults=1000, expand="changelog")

        total_story_points = 0.0
        cycle_times = []
        for issue in issues:
            points = getattr(getattr(issue, "fields", None), story_points_field, 0) or 0
            try:
                total_story_points += float(points)
            except Exception:
                logging.warning("Could not convert story points '%s' on issue %s", points, getattr(issue, "key", ""))

            cycle_days = compute_cycle_time(issue)
            if cycle_days is not None and cycle_days >= 0:
                cycle_times.append(cycle_days)

        avg_cycle_time = mean(cycle_times) if cycle_times else "N/A"

        results.append(
            {
                "Name": getattr(sprint, "name", "N/A"),
                "StartDate": getattr(sprint, "startDate", "N/A"),
                "EndDate": getattr(sprint, "endDate", "N/A"),
                "CompletedDate": getattr(sprint, "completeDate", "N/A"),
                "CompletedStoryPoints": total_story_points,
                "AverageCycleTime": avg_cycle_time,
            }
        )

    return results


def get_sprint_insights_with_creep(service: JiraService, board_id: int, sp_field_id: str):
    sprints = service.sprints(board_id, state="active")
    if not sprints:
        return "No active sprint found."

    active_sprint = sprints[0]
    sprint_id = active_sprint.id
    sprint_start_dt = parser.parse(active_sprint.startDate)

    issues = service.search_issues(f"sprint = {sprint_id}", expand="changelog", maxResults=False)

    dataset = {
        "sprint_info": {
            "name": active_sprint.name,
            "start": active_sprint.startDate,
            "end": getattr(active_sprint, "endDate", None),
        },
        "metrics": {
            "total_issues": len(issues),
            "scope_creep_count": 0,
            "creep_points": 0,
        },
        "stages": {"To Do": 0, "In Progress": 0, "Done": 0},
        "points": {"total": 0.0, "completed": 0.0, "remaining": 0.0},
        "issue_collection": [],
        "creep_issues": [],
    }

    for issue in issues:
        is_creep = False
        added_date = None
        histories = getattr(issue.changelog, "histories", [])
        for history in histories:
            for item in getattr(history, "items", []):
                if item.field.lower() == "sprint" and str(sprint_id) in str(item.to):
                    added_date = parser.parse(history.created)
                    if added_date > sprint_start_dt:
                        is_creep = True
                    break

        category = issue.fields.status.statusCategory.name
        if category in dataset["stages"]:
            dataset["stages"][category] += 1

        points = getattr(issue.fields, sp_field_id, 0) or 0
        dataset["points"]["total"] += points
        if category == "Done":
            dataset["points"]["completed"] += points
        else:
            dataset["points"]["remaining"] += points

        issue_data = {
            "key": issue.key,
            "title": issue.fields.summary,
            "assignee": str(issue.fields.assignee) if issue.fields.assignee else "Unassigned",
            "status": issue.fields.status.name,
            "category": category,
            "points": points,
            "is_creep": is_creep,
        }
        dataset["issue_collection"].append(issue_data)

        if is_creep:
            dataset["metrics"]["scope_creep_count"] += 1
            dataset["metrics"]["creep_points"] += points
            dataset["creep_issues"].append(
                {
                    "key": issue.key,
                    "added_at": added_date.strftime("%Y-%m-%d %H:%M") if added_date else None,
                    "points": points,
                }
            )

    return dataset
