from __future__ import annotations

import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from services.api.server import build_handler


class LocalApiServerIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.sync_start_modes: list[str | None] = []

        def fake_status():
            return {
                "source": "jira",
                "connected": True,
                "checkedAt": "2026-03-25T00:00:00+00:00",
                "config": {"projectKey": "CEGBUPOL"},
                "checks": [],
                "metrics": {"boardCount": 1},
                "sampleIssueKey": "CEGBUPOL-1",
                "error": None,
            }

        def fake_sync_status():
            return {
                "source": "jira",
                "state": "idle",
                "phase": "idle",
                "syncMode": "full",
                "boardsSynced": 0,
                "sprintsSynced": 0,
                "downloadedIssues": 0,
                "totalIssues": None,
                "percent": None,
                "lastSyncedAt": "2026-03-25T00:00:00+00:00",
                "error": None,
            }

        def fake_sync_start(mode=None):  # noqa: ANN001
            if mode not in {None, "full", "since_last"}:
                raise ValueError("Unsupported sync mode. Allowed values: full, since_last.")
            self.sync_start_modes.append(mode)
            return {
                "source": "jira",
                "state": "running",
                "phase": "issues",
                "syncMode": mode or "full",
                "boardsSynced": 1,
                "sprintsSynced": 12,
                "downloadedIssues": 12,
                "totalIssues": 5000,
                "percent": 0.24,
                "started": True,
                "error": None,
            }

        def fake_sync_history(limit):  # noqa: ANN001
            _ = limit
            return {
                "source": "jira",
                "history": [
                    {
                        "id": 7,
                        "scopeKey": "board:27193",
                        "boardId": 27193,
                        "boardName": "CEGBU Polaris",
                        "syncMode": "since_last",
                        "boardsSynced": 1,
                        "sprintsSynced": 12,
                        "issuesSynced": 5000,
                        "totalIssues": 5000,
                        "status": "completed",
                        "error": None,
                        "startedAt": "2026-03-25T00:00:00+00:00",
                        "finishedAt": "2026-03-25T00:10:00+00:00",
                    }
                ],
            }

        handler_cls = build_handler(fake_status, fake_sync_status, fake_sync_start, fake_sync_history)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def test_health_endpoint(self) -> None:
        with urlopen(f"{self.base_url}/health", timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(body["status"], "ok")

    def test_jira_status_endpoint(self) -> None:
        with urlopen(f"{self.base_url}/api/integrations/jira/status", timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))
        self.assertTrue(body["connected"])
        self.assertEqual(body["sampleIssueKey"], "CEGBUPOL-1")
        self.assertEqual(body["metrics"]["boardCount"], 1)

    def test_jira_sync_status_endpoint(self) -> None:
        with urlopen(f"{self.base_url}/api/integrations/jira/sync/status", timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(body["state"], "idle")
        self.assertEqual(body["downloadedIssues"], 0)
        self.assertEqual(body["lastSyncedAt"], "2026-03-25T00:00:00+00:00")

    def test_jira_sync_start_endpoint(self) -> None:
        request = Request(
            f"{self.base_url}/api/integrations/jira/sync/start",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=json.dumps({"mode": "since_last"}).encode("utf-8"),
        )
        with urlopen(request, timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 202)
            body = json.loads(response.read().decode("utf-8"))
        self.assertTrue(body["started"])
        self.assertEqual(body["state"], "running")
        self.assertEqual(body["syncMode"], "since_last")
        self.assertEqual(body["downloadedIssues"], 12)
        self.assertEqual(body["totalIssues"], 5000)
        self.assertEqual(self.sync_start_modes[-1], "since_last")

    def test_jira_sync_start_endpoint_rejects_invalid_mode(self) -> None:
        request = Request(
            f"{self.base_url}/api/integrations/jira/sync/start",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=json.dumps({"mode": "invalid"}).encode("utf-8"),
        )
        with self.assertRaises(HTTPError) as exc_ctx:
            urlopen(request, timeout=5)  # noqa: S310
        self.assertEqual(exc_ctx.exception.code, 400)

    def test_jira_sync_history_endpoint(self) -> None:
        with urlopen(f"{self.base_url}/api/integrations/jira/sync/history?limit=10", timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(body["source"], "jira")
        self.assertEqual(len(body["history"]), 1)
        self.assertEqual(body["history"][0]["boardName"], "CEGBU Polaris")
        self.assertEqual(body["history"][0]["syncMode"], "since_last")
        self.assertEqual(body["history"][0]["issuesSynced"], 5000)


if __name__ == "__main__":
    unittest.main()
