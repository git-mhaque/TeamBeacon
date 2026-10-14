"""Shared eligibility rules for project epic sync and mapping."""

from __future__ import annotations

import json


def eligible_epic_jql(project_key: str) -> str:
    return (
        f"project = {json.dumps(project_key)} AND issuetype = Epic "
        "AND (labels is EMPTY OR labels not in (Triad)) ORDER BY key ASC"
    )


def is_eligible_epic(issue_type: str | None, labels: list[str]) -> bool:
    return (issue_type or "").casefold() == "epic" and "Triad" not in labels
