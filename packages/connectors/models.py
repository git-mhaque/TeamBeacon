from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class BoardRecord:
    external_board_id: int
    name: str
    project_key: str | None = None
    board_type: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class SprintRecord:
    external_sprint_id: int
    board_external_id: int | None
    name: str
    state: str
    start_date: datetime | None = None
    end_date: datetime | None = None
    complete_date: datetime | None = None
    goal: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class IssueRecord:
    issue_key: str
    issue_id: str
    project_key: str | None
    issue_type: str | None
    summary: str
    status_name: str
    status_category: str | None
    priority: str | None
    assignee_account_id: str | None
    reporter_account_id: str | None
    story_points: float | None
    sprint_external_id: int | None
    epic_key: str | None
    labels: list[str] = field(default_factory=list)
    components: list[str] = field(default_factory=list)
    created_at_source: datetime | None = None
    updated_at_source: datetime | None = None
    resolved_at_source: datetime | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class ChangelogItemRecord:
    issue_key: str
    history_id: str | None
    changed_at: datetime
    author_account_id: str | None
    field_name: str
    from_value: str | None
    to_value: str | None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class ConfluencePageRecord:
    page_id: str
    title: str
    space_key: str | None
    version_number: int | None
    version_when: datetime | None
    body_storage: str | None = None
    body_view: str | None = None
    labels: list[str] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class SyncBatch:
    next_cursor: str | None
    has_more: bool
