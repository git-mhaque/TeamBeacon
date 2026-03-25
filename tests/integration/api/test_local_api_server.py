from __future__ import annotations

import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.request import urlopen

from services.api.server import build_handler


class LocalApiServerIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
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

        handler_cls = build_handler(fake_status)
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


if __name__ == "__main__":
    unittest.main()

