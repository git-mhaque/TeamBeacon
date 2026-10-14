"""Fixed-origin, GET-only dashboard client. No connector credentials or DB access."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx
from pydantic import ValidationError

from services.mcp.contracts import (
    Dashboard,
    DashboardQuery,
    DashboardResult,
    valid_timezone,
)

MAX_RESPONSE_BYTES = 512_000


def loopback_url(value: str) -> str:
    url = urlsplit(value)
    if (
        url.scheme != "http"
        or url.hostname not in {"localhost", "127.0.0.1", "::1"}
        or url.username
        or url.password
        or url.path not in {"", "/"}
        or url.query
        or url.fragment
    ):
        raise ValueError("TeamBeacon URLs must be HTTP loopback origins without credentials or paths")
    port = url.port  # validates malformed ports
    host = "[::1]" if url.hostname == "::1" else "127.0.0.1"
    return f"http://{host}" + (f":{port}" if port is not None else "")


@dataclass(frozen=True)
class Settings:
    api_url: str = "http://127.0.0.1:8000"
    ui_url: str = "http://127.0.0.1:5174"
    timezone: str = "Australia/Melbourne"

    def __post_init__(self) -> None:
        object.__setattr__(self, "api_url", loopback_url(self.api_url))
        object.__setattr__(self, "ui_url", loopback_url(self.ui_url))
        valid_timezone(self.timezone)

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            api_url=os.getenv("TEAMBEACON_API_URL", cls.api_url),
            ui_url=os.getenv("TEAMBEACON_UI_URL", cls.ui_url),
            timezone=os.getenv("TEAMBEACON_TIMEZONE", cls.timezone),
        )


class DashboardError(Exception):
    """Sanitized operational error safe to return to an MCP client."""


class DashboardClient:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self.transport = transport

    async def read(self, query: DashboardQuery) -> DashboardResult:
        params = [
            ("flowWeeks", str(query.flow_weeks)),
            ("recentLimit", str(query.recent_limit)),
            ("timezone", query.timezone),
        ]
        if query.cycle_time_status_keys is not None:
            params.append(("cycleTimeStatusMode", "custom"))
            params.extend(("cycleTimeStatus", key) for key in query.cycle_time_status_keys)
        try:
            async with httpx.AsyncClient(
                timeout=30,
                follow_redirects=False,
                trust_env=False,
                transport=self.transport,
            ) as client:
                async with client.stream(
                    "GET",
                    self.settings.api_url + "/api/team/dashboard",
                    params=params,
                    headers={"Accept": "application/json"},
                ) as response:
                    if response.status_code != 200:
                        raise DashboardError(
                            f"UPSTREAM_ERROR: TeamBeacon returned HTTP {response.status_code}."
                        )
                    raw = bytearray()
                    async for chunk in response.aiter_bytes():
                        raw.extend(chunk)
                        if len(raw) > MAX_RESPONSE_BYTES:
                            raise DashboardError(
                                "RESPONSE_TOO_LARGE: Dashboard exceeded the response budget."
                            )
            payload = json.loads(raw)
            if not isinstance(payload, dict) or payload.get("error"):
                raise DashboardError("UPSTREAM_ERROR: TeamBeacon could not produce a dashboard.")
            dashboard = Dashboard.model_validate(payload)
        except httpx.RequestError as exc:
            raise DashboardError(
                "API_UNAVAILABLE: Start TeamBeacon's API on the configured local port, then try again."
            ) from exc
        except (ValueError, ValidationError) as exc:
            raise DashboardError("INVALID_RESPONSE: TeamBeacon returned an invalid dashboard.") from exc

        warnings = []
        if dashboard.errors:
            warnings.append("Some dashboard sections are unavailable; do not interpret their values as zero.")
            dashboard.errors = {key: "Section unavailable" for key in dashboard.errors}
        for stream in dashboard.workStreams:
            if stream.error:
                stream.error = "Work-stream flow unavailable"
        if dashboard.dataAsOf is None:
            warnings.append(
                "Source freshness is unknown. generatedAt is the calculation time, not a sync time."
            )
        for items in (dashboard.blockedItems, dashboard.recentlyCompleted):
            items.items = items.items[: query.recent_limit]
            if items.count > len(items.items):
                warnings.append(f"Showing {len(items.items)} of {items.count} items in a dashboard list.")
        if len(dashboard.workStreams) > 50:
            dashboard.workStreams = dashboard.workStreams[:50]
            warnings.append("Showing only the first 50 work streams.")
        return DashboardResult(
            appliedFilters=query,
            uiUrl=self.settings.ui_url,
            dashboard=dashboard,
            warnings=warnings,
        )
