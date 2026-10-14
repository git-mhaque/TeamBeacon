"""Bounded public dashboard contracts; extra upstream fields are discarded."""

from __future__ import annotations

from typing import Annotated, Literal
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator


def valid_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError("timezone must be an IANA timezone, such as Australia/Melbourne") from exc
    return value


class PublicModel(BaseModel):
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)


class DashboardQuery(PublicModel):
    flow_weeks: Literal[1, 4, 12] = 4
    recent_limit: Annotated[int, Field(strict=True, ge=1, le=20)] = 5
    timezone: str = "Australia/Melbourne"
    cycle_time_status_keys: Annotated[list[str], Field(max_length=50)] | None = None

    _timezone = field_validator("timezone")(valid_timezone)

    @field_validator("cycle_time_status_keys")
    @classmethod
    def clean_statuses(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        if any(not key.strip() or len(key) > 100 for key in value):
            raise ValueError("Status keys must contain 1–100 characters")
        return list(dict.fromkeys(key.strip().lower() for key in value))


class FlowPeriod(PublicModel):
    weeks: Literal[1, 4, 12]
    startDate: str | None = None
    endDate: str | None = None


class WorkStream(PublicModel):
    id: int
    name: str
    epicCount: int
    newCount: int
    completedCount: int
    netFlow: int
    currentWipCount: int
    totalCards: int
    totalCompletedCards: int
    completionPercent: float
    error: str | None = None


class Release(PublicModel):
    name: str | None = None
    releaseDate: str | None = None
    cycleTimeDays: float | None = None


class SprintCycleTime(PublicModel):
    latestSprintName: str | None = None
    latestAverageDays: float
    previousSprintName: str | None = None
    previousAverageDays: float | None = None
    deltaDays: float | None = None
    deltaPercent: float | None = None
    direction: Literal["up", "down", "flat"]


class Issue(PublicModel):
    issueKey: str
    summary: str
    issueUrl: str | None = None
    status: str | None = None
    completedAt: str | None = None
    workStreamName: str | None = None

    @field_validator("issueUrl")
    @classmethod
    def safe_url(cls, value: str | None) -> str | None:
        if not value:
            return None
        try:
            url = urlsplit(value)
            if url.scheme in {"https", "http"} and url.hostname and not url.username and not url.password:
                return value
        except ValueError:
            pass
        return None


class IssueList(PublicModel):
    count: int
    items: list[Issue]
    sprintName: str | None = None
    windowDays: int | None = None


class Dashboard(PublicModel):
    source: Literal["local"]
    generatedAt: str
    dataAsOf: str | None = None
    timezone: str
    flowPeriod: FlowPeriod
    workStreams: list[WorkStream]
    latestRelease: Release | None = None
    sprintCycleTime: SprintCycleTime | None = None
    blockedItems: IssueList
    recentlyCompleted: IssueList
    errors: dict[str, str]


class DashboardResult(PublicModel):
    schemaVersion: Literal["1"] = "1"
    appliedFilters: DashboardQuery
    uiUrl: str
    warnings: list[str]
    dashboard: Dashboard
