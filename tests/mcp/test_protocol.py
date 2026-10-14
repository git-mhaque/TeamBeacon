from __future__ import annotations

import copy
import json
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

import jsonschema
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from services.api.server import build_handler

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = json.loads((ROOT / "tests/fixtures/mcp_dashboard.json").read_text())


class ProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_stdio_to_existing_http_api_and_resources(self):
        calls = []

        def dashboard(**kwargs):
            calls.append(kwargs)
            value = copy.deepcopy(FIXTURE)
            value["flowPeriod"]["weeks"] = int(kwargs["flow_weeks"])
            return value

        api = ThreadingHTTPServer(("127.0.0.1", 0), build_handler(
            team_dashboard_provider=dashboard,
            jira_data_as_of_provider=lambda: FIXTURE["dataAsOf"],
            jira_sync_status_provider=lambda: self.fail("Dashboard must not invoke sync-state recovery"),
        ))
        thread = threading.Thread(target=api.serve_forever, daemon=True)
        thread.start()
        try:
            params = StdioServerParameters(
                command=sys.executable,
                args=["-m", "services.mcp"],
                cwd=str(ROOT),
                env={"TEAMBEACON_API_URL": f"http://127.0.0.1:{api.server_port}"},
            )
            with tempfile.TemporaryFile(mode="w+") as stderr:
                async with stdio_client(params, errlog=stderr) as (reader, writer):
                    async with ClientSession(reader, writer) as session:
                        initialized = await session.initialize()
                        self.assertEqual(initialized.serverInfo.name, "TeamBeacon")
                        tools = (await session.list_tools()).tools
                        self.assertEqual(len(tools), 2)
                        data = await session.call_tool("get_team_dashboard", {"flow_weeks": 12})
                        self.assertFalse(data.isError, data.content)
                        self.assertEqual(data.structuredContent["dashboard"]["flowPeriod"]["weeks"], 12)
                        jsonschema.validate(data.structuredContent, tools[0].outputSchema)
                        visual = await session.call_tool("show_teambeacon_dashboard", {"flow_weeks": 12})
                        self.assertEqual(data.structuredContent, visual.structuredContent)
                        invalid = await session.call_tool("get_team_dashboard", {"flow_weeks": 2})
                        self.assertTrue(invalid.isError)
                        forbidden = await session.call_tool("start_jira_sync", {})
                        self.assertTrue(forbidden.isError)
                        self.assertTrue(calls)
                        self.assertTrue(all(int(call["flow_weeks"]) == 12 for call in calls))
                        resources = (await session.list_resources()).resources
                        self.assertEqual(len(resources), 3)
                        ui = await session.read_resource("ui://teambeacon/dashboard/v1.html")
                        self.assertEqual(ui.contents[0].mimeType, "text/html;profile=mcp-app")
                        self.assertIn("TeamBeacon dashboard", ui.contents[0].text)
                        self.assertEqual(ui.contents[0].meta["ui"]["csp"]["connectDomains"], [])
                        self.assertEqual((await session.list_resource_templates()).resourceTemplates, [])
        finally:
            api.shutdown()
            api.server_close()
            thread.join()
