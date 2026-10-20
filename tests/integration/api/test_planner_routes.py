import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from services.api.planner import get_planner, save_plan
from services.api.server import build_handler


class PlannerRoutesTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = str(Path(self.tmp.name) / "planner.db")
        self.fail = False

        def inventory():
            if self.fail:
                raise RuntimeError("private database details")
            return get_planner(self.db)

        def save(payload):
            if self.fail:
                raise RuntimeError("private database details")
            return save_plan(payload, self.db)

        self.server = ThreadingHTTPServer(("localhost", 0), build_handler(
            planner_provider=inventory, planner_save_provider=save, jira_data_as_of_provider=lambda: None,
        ))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.base = f"http://localhost:{self.server.server_port}"

    def request(self, path="/api/planner", body=None, raw=None):
        request = Request(self.base + path, data=raw if raw is not None else (json.dumps(body).encode() if body is not None else None),
                          headers={"Content-Type": "application/json"})
        try:
            with urlopen(request) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, json.load(error)

    def test_persistent_roundtrip_versions_and_openapi(self):
        self.assertEqual(self.request()[1]["plans"], [])
        status, plan = self.request("/api/planner/save", {"name": "Launch"})
        self.assertEqual(status, 200)
        self.assertEqual(self.request()[1]["plans"][0]["name"], "Launch")
        self.assertEqual(self.request("/api/planner/save", {**plan, "name": "Updated"})[0], 200)
        self.assertEqual(self.request("/api/planner/save", plan)[0], 409)
        spec = self.request("/openapi.json")[1]
        self.assertIn("/api/planner", spec["paths"])
        self.assertIn("409", spec["paths"]["/api/planner/save"]["post"]["responses"])

    def test_bad_input_and_storage_errors_have_safe_responses(self):
        for body in [[], {}, {"name": "Plan", "epics": [{"epicKey": "UNKNOWN"}]}]:
            self.assertEqual(self.request("/api/planner/save", body)[0], 400)
        self.assertEqual(self.request("/api/planner/save", raw=b"{")[0], 400)
        self.fail = True
        for path, body in [("/api/planner", None), ("/api/planner/save", {"name": "Plan"})]:
            status, result = self.request(path, body)
            self.assertEqual(status, 503)
            self.assertNotIn("private", json.dumps(result))
