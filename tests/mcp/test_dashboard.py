from __future__ import annotations

import copy
import json
import os
import runpy
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from pydantic import ValidationError

from services.mcp.api_client import (
    DashboardClient,
    DashboardError,
    Settings,
    loopback_url,
)
from services.mcp.contracts import DashboardQuery, Issue
from services.mcp.server import UI_URI, create_server

FIXTURE = json.loads(Path("tests/fixtures/mcp_dashboard.json").read_text())


class ContractTests(unittest.TestCase):
    def test_only_loopback_origins_and_valid_timezones(self):
        self.assertEqual(loopback_url("http://localhost:8000/"), "http://127.0.0.1:8000")
        self.assertEqual(loopback_url("http://[::1]:8000"), "http://[::1]:8000")
        self.assertEqual(loopback_url("http://127.0.0.1"), "http://127.0.0.1")
        for url in [
            "https://example.com",
            "http://127.0.0.1/a",
            "http://user@localhost",
            "http://localhost?token=x",
            "http://localhost#x",
            "http://localhost:bad",
        ]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                Settings(api_url=url)
        with self.assertRaises(ValueError):
            Settings(timezone="bad/timezone")
        with self.assertRaises(ValueError):
            Settings(timezone="../etc/passwd")
        with patch.dict(os.environ, {"TEAMBEACON_TIMEZONE": "UTC"}):
            self.assertEqual(Settings.from_env().timezone, "UTC")

    def test_query_bounds_and_status_normalization(self):
        query = DashboardQuery(cycle_time_status_keys=[" In Progress ", "in progress", "QA"])
        self.assertEqual(query.cycle_time_status_keys, ["in progress", "qa"])
        self.assertEqual(DashboardQuery(cycle_time_status_keys=[]).cycle_time_status_keys, [])
        for kwargs in [
            {"flow_weeks": 2},
            {"recent_limit": 21},
            {"recent_limit": True},
            {"timezone": ""},
            {"cycle_time_status_keys": [""]},
            {"cycle_time_status_keys": ["a" * 101]},
            {"cycle_time_status_keys": ["x"] * 51},
        ]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValidationError):
                DashboardQuery(**kwargs)

    def test_issue_links_are_safe(self):
        for url in [
            None,
            "",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "https://user:token@example.com",
            "https://[bad",
        ]:
            self.assertIsNone(Issue(issueKey="A-1", summary="text", issueUrl=url).issueUrl)
        self.assertEqual(
            Issue(issueKey="A-1", summary="text", issueUrl="https://jira.test/A-1").issueUrl,
            "https://jira.test/A-1",
        )


class DashboardTests(unittest.IsolatedAsyncioTestCase):
    def client(self, payload=None, status=200):
        def response(request):
            self.assertEqual(request.method, "GET")
            self.assertEqual(request.url.path, "/api/team/dashboard")
            self.request = request
            return httpx.Response(status, json=FIXTURE if payload is None else payload)

        return DashboardClient(Settings(), httpx.MockTransport(response))

    async def test_success_and_repeated_status_query(self):
        result = await self.client().read(DashboardQuery(cycle_time_status_keys=["in progress", "qa"]))
        self.assertEqual(result.dashboard.workStreams[0].completionPercent, 65)
        self.assertEqual(result.warnings, [])
        self.assertEqual(self.request.url.params.get_list("cycleTimeStatus"), ["in progress", "qa"])
        self.assertEqual(self.request.url.params["cycleTimeStatusMode"], "custom")
        self.assertEqual(self.request.url.params["timezone"], "Australia/Melbourne")
        await self.client().read(DashboardQuery())
        self.assertNotIn("cycleTimeStatusMode", self.request.url.params)

    async def test_partial_data_sanitization_limits_and_unknown_freshness(self):
        data = copy.deepcopy(FIXTURE)
        data.pop("dataAsOf")
        data["errors"] = {"release": "secret-token /Users/private"}
        data["workStreams"][0]["error"] = "private upstream stack"
        data["workStreams"] *= 30
        data["recentlyCompleted"]["count"] = 20
        data["recentlyCompleted"]["items"] *= 10
        data["secret"] = "private-token"
        result = await self.client(data).read(DashboardQuery(recent_limit=2))
        self.assertEqual(len(result.dashboard.workStreams), 50)
        self.assertEqual(len(result.dashboard.recentlyCompleted.items), 2)
        self.assertEqual(result.dashboard.recentlyCompleted.count, 20)
        self.assertEqual(len(result.warnings), 4)
        self.assertNotIn("private", result.model_dump_json())
        self.assertNotIn("secret-token", result.model_dump_json())

    async def test_http_and_payload_errors_are_sanitized(self):
        for status in [302, 401, 500]:
            with self.assertRaisesRegex(DashboardError, "UPSTREAM_ERROR"):
                await self.client({"error": "secret"}, status).read(DashboardQuery())
        for payload in [{"error": "secret"}, [], {"workStreams": "broken"}]:
            with self.assertRaises(DashboardError) as raised:
                await self.client(payload).read(DashboardQuery())
            self.assertNotIn("secret", str(raised.exception))

    async def test_transport_malformed_and_oversized_errors(self):
        def offline(request):
            raise httpx.ConnectError("secret", request=request)

        with self.assertRaisesRegex(DashboardError, "API_UNAVAILABLE"):
            await DashboardClient(Settings(), httpx.MockTransport(offline)).read(DashboardQuery())
        for content, message in [(b"<html>", "INVALID_RESPONSE"), (b"a" * 512_001, "RESPONSE_TOO_LARGE")]:
            transport = httpx.MockTransport(lambda _: httpx.Response(200, content=content))
            with self.assertRaisesRegex(DashboardError, message):
                await DashboardClient(Settings(), transport).read(DashboardQuery())

    async def test_tool_registration_and_data_parity(self):
        server = create_server(client=self.client())
        tools = await server.list_tools()
        self.assertEqual({tool.name for tool in tools}, {"get_team_dashboard", "show_teambeacon_dashboard"})
        for tool in tools:
            self.assertTrue(tool.annotations.readOnlyHint)
            self.assertFalse(tool.annotations.destructiveHint)
            self.assertTrue(tool.outputSchema)
        self.assertEqual(tools[1].meta["ui"]["resourceUri"], UI_URI)
        _, data = await server.call_tool("get_team_dashboard", {"timezone": "UTC"})
        _, visual = await server.call_tool("show_teambeacon_dashboard", {"timezone": "UTC"})
        self.assertEqual(data, visual)
        self.assertEqual(data["appliedFilters"]["timezone"], "UTC")
        with self.assertRaises(Exception):
            await server.call_tool("start_jira_sync", {})
        with self.assertRaises(Exception):
            await server.call_tool("get_team_dashboard", {"recent_limit": 0})

    async def test_resources_and_missing_build(self):
        server = create_server()
        resources = await server.list_resources()
        self.assertEqual(len(resources), 3)
        for uri, snippet in [
            ("teambeacon://workspace", "readOnly"),
            ("teambeacon://metric-definitions", "Shared epics"),
        ]:
            content = list(await server.read_resource(uri))[0]
            self.assertIn(snippet, content.content)
        with patch("services.mcp.server.UI_PATH", Path("/does/not/exist")):
            with self.assertRaisesRegex(Exception, "build:mcp"):
                await server.read_resource(UI_URI)
        content = list(await server.read_resource(UI_URI))[0]
        self.assertEqual(content.mime_type, "text/html;profile=mcp-app")
        self.assertIn("<html", content.content)

    def test_entrypoint(self):
        from services.mcp.__main__ import main

        with patch("services.mcp.__main__.create_server") as factory:
            main()
            factory.return_value.run.assert_called_once_with(transport="stdio")
        with patch("services.mcp.server.create_server") as factory:
            runpy.run_module("services.mcp", run_name="__main__")
            factory.return_value.run.assert_called_once_with(transport="stdio")
