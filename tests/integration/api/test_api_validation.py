"""HTTP boundary tests: reject invalid input before any provider can mutate state."""

from __future__ import annotations

import inspect
import json
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from unittest.mock import Mock

from services.api.server import build_handler

# Explicit contracts keep the test independent of the handler's routing logic.
WRITE_ROUTES = (
    ("/api/releases/refresh/start", "release_refresh_start_provider", {"sources": []}),
    ("/api/ai/chat", "ai_chat_provider", {"message": "Hello"}),
    (
        "/api/metadata/lookup/groups",
        "metadata_add_group_provider",
        {"name": "Platform"},
    ),
    (
        "/api/metadata/lookup/work-types",
        "metadata_add_work_type_provider",
        {"name": "Feature"},
    ),
    (
        "/api/metadata/lookup/groups/update",
        "metadata_update_group_provider",
        {"id": 1, "name": "Platform"},
    ),
    ("/api/metadata/lookup/groups/delete", "metadata_delete_group_provider", {"id": 1}),
    (
        "/api/metadata/lookup/work-types/update",
        "metadata_update_work_type_provider",
        {"id": 1, "name": "Feature"},
    ),
    (
        "/api/metadata/lookup/work-types/delete",
        "metadata_delete_work_type_provider",
        {"id": 1},
    ),
    (
        "/api/metadata/initiative-views",
        "metadata_create_initiative_view_provider",
        {"name": "Delivery"},
    ),
    (
        "/api/metadata/initiative-views/update",
        "metadata_update_initiative_view_provider",
        {"id": 1, "name": "Delivery"},
    ),
    (
        "/api/metadata/initiative-views/delete",
        "metadata_delete_initiative_view_provider",
        {"id": 1},
    ),
    ("/api/metadata/epics", "metadata_upsert_epic_provider", {"epicKey": "TEST-1"}),
    (
        "/api/metadata/epics/delete",
        "metadata_delete_epic_provider",
        {"epicKey": "TEST-1"},
    ),
)


class ApiValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        # Replace every provider, including future additions, so these tests cannot
        # reach the developer's database, credentials, AI service, or sync manager.
        self.providers = {
            name: Mock(name=name, return_value={"ok": True})
            for name in inspect.signature(build_handler).parameters
            if name.endswith("_provider")
        }
        self.providers["jira_data_as_of_provider"].return_value = None
        self.server = ThreadingHTTPServer(
            ("127.0.0.1", 0), build_handler(**self.providers)
        )
        self.thread = threading.Thread(
            target=self.server.serve_forever, kwargs={"poll_interval": 0.01}
        )
        self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.assertFalse(self.thread.is_alive())

    def request(
        self, method: str, path: str, body: bytes | None = None
    ) -> tuple[int, dict, object]:
        connection = HTTPConnection(*self.server.server_address, timeout=5)
        try:
            connection.request(
                method, path, body=body, headers={"Content-Type": "application/json"}
            )
            response = connection.getresponse()
            raw = response.read()
            return (
                response.status,
                dict(response.getheaders()),
                json.loads(raw) if raw else None,
            )
        finally:
            connection.close()

    def post(self, path: str, payload: object) -> tuple[int, dict, object]:
        return self.request("POST", path, json.dumps(payload).encode())

    def assert_bad_request(self, response: tuple, detail: str) -> None:
        self.assertEqual(response[0], 400)
        self.assertEqual(response[2], {"error": "bad_request", "detail": detail})

    def test_write_routes_require_objects_and_required_fields(self) -> None:
        for path, provider_name, valid in WRITE_ROUTES:
            with self.subTest(path=path):
                provider = self.providers[provider_name]
                self.assert_bad_request(
                    self.post(path, []), "JSON object payload is required."
                )
                for field in valid:
                    invalid = {
                        key: value for key, value in valid.items() if key != field
                    }
                    detail = (
                        "id is required as integer."
                        if field == "id"
                        else f"{field} is required."
                    )
                    self.assert_bad_request(self.post(path, invalid), detail)
                provider.assert_not_called()

    def test_write_provider_validation_errors_are_returned_to_the_client(self) -> None:
        for path, provider_name, valid in WRITE_ROUTES:
            with self.subTest(path=path):
                provider = self.providers[provider_name]
                provider.side_effect = ValueError("Invalid reference.")
                self.assert_bad_request(self.post(path, valid), "Invalid reference.")
                provider.assert_called_once()

    def test_optional_fields_reject_wrong_types_without_calling_providers(self) -> None:
        cases = [
            (
                "/api/releases/refresh/start",
                {"sources": "jira"},
                "sources must be an array.",
            ),
            (
                "/api/releases/refresh/start",
                {"sources": [], "overallPrompt": 1},
                "overallPrompt must be a string.",
            ),
        ]
        for field, expected in (
            ("provider", "a string"),
            ("modelId", "a string"),
            ("maxTokens", "an integer"),
            ("temperature", "a number"),
            ("topP", "a number"),
            ("topK", "an integer"),
            ("frequencyPenalty", "a number"),
        ):
            cases.append(
                (
                    "/api/ai/chat",
                    {"message": "Hello", field: []},
                    f"{field} must be {expected}.",
                )
            )
        for path in (
            "/api/metadata/initiative-views",
            "/api/metadata/initiative-views/update",
        ):
            for field, expected in (
                ("description", "a string"),
                ("epicKeys", "a list of strings"),
            ):
                cases.append(
                    (
                        path,
                        {"id": 1, "name": "Delivery", field: 1},
                        f"{field} must be {expected}.",
                    )
                )
        for field, expected in (
            ("successCriteria", "a list of strings"),
            ("groupIds", "a list of integers"),
            ("workTypeIds", "a list of integers"),
            ("timelineEnabled", "a boolean"),
            ("timelineStartDate", "a string date"),
            ("targetCompletionDate", "a string date"),
        ):
            cases.append(
                (
                    "/api/metadata/epics",
                    {"epicKey": "TEST-1", field: 1},
                    f"{field} must be {expected}.",
                )
            )
        for field, label in (("groupIds", "group"), ("workTypeIds", "work type")):
            cases.append(
                (
                    "/api/metadata/epics",
                    {"epicKey": "TEST-1", field: [1, 2]},
                    f"Only one {label} can be configured per epic.",
                )
            )
        for path, payload, detail in cases:
            with self.subTest(path=path, payload=payload):
                self.assert_bad_request(self.post(path, payload), detail)
        for provider in self.providers.values():
            provider.assert_not_called()

    def test_invalid_json_unknown_routes_and_preflight(self) -> None:
        for body in (b"{", b"\xff"):
            self.assert_bad_request(
                self.request("POST", "/api/ai/chat", body), "Invalid JSON payload."
            )
        for method in ("GET", "POST"):
            status, _, payload = self.request(method, "/api/does-not-exist")
            self.assertEqual((status, payload), (404, {"error": "not_found"}))
        status, headers, payload = self.request("OPTIONS", "/api/team/dashboard")
        self.assertEqual(status, 204)
        self.assertIn("GET", headers["Access-Control-Allow-Methods"])
        self.assertIsNone(payload)

    def test_read_provider_validation_errors(self) -> None:
        cases = (
            ("/api/integrations/ai/status", "ai_status_provider"),
            ("/api/team/dashboard", "team_dashboard_provider"),
            ("/api/initiative-deep-dive?groupId=1", "initiative_deep_dive_provider"),
            ("/api/metadata/epics/summary", "metadata_summary_provider"),
            (
                "/api/metadata/epics/completed-cards?epicKey=TEST-1",
                "metadata_completed_cards_provider",
            ),
            (
                "/api/metadata/epics/completed-cards/configured",
                "metadata_configured_completed_cards_provider",
            ),
        )
        for path, provider_name in cases:
            with self.subTest(path=path):
                provider = self.providers[provider_name]
                provider.side_effect = ValueError("Invalid filter.")
                self.assert_bad_request(self.request("GET", path), "Invalid filter.")
                provider.assert_called_once()

    def test_invalid_numeric_query_values_use_documented_defaults(self) -> None:
        cases = (
            (
                "/api/integrations/jira/sync/history?limit=oops",
                "jira_sync_history_provider",
                None,
                20,
            ),
            (
                "/api/releases/insights?releaseLimit=oops",
                "release_insights_provider",
                "release_limit",
                12,
            ),
            ("/api/issues/search?limit=oops", "issue_search_provider", "limit", 100),
            (
                "/api/team/insights?sprintLimit=oops",
                "team_insights_provider",
                "sprint_limit",
                6,
            ),
            (
                "/api/metadata/epics?limit=oops",
                "metadata_read_epics_provider",
                "limit",
                50,
            ),
            (
                "/api/metadata/epics/summary?limit=oops",
                "metadata_summary_provider",
                "limit",
                50,
            ),
            (
                "/api/metadata/epics/completed-cards?epicKey=TEST-1&limit=oops",
                "metadata_completed_cards_provider",
                "limit",
                200,
            ),
            (
                "/api/metadata/epics/completed-cards/configured?limit=oops",
                "metadata_configured_completed_cards_provider",
                "limit",
                300,
            ),
            (
                "/api/metadata/epics/candidates?limit=oops",
                "metadata_search_epics_provider",
                "limit",
                20,
            ),
        )
        for path, provider_name, argument, expected in cases:
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path)[0], 200)
                call = self.providers[provider_name].call_args
                self.assertEqual(
                    call.kwargs[argument] if argument else call.args[0], expected
                )

    def test_ai_upstream_failure_is_distinct_from_bad_input(self) -> None:
        self.providers["ai_chat_provider"].side_effect = RuntimeError(
            "Service unavailable."
        )
        status, _, payload = self.post("/api/ai/chat", {"message": "Hello"})
        self.assertEqual(status, 502)
        self.assertEqual(
            payload, {"error": "upstream_error", "detail": "Service unavailable."}
        )

    def test_unknown_freshness_still_serves_and_caches_dashboard(self) -> None:
        freshness = self.providers["jira_data_as_of_provider"]
        freshness.side_effect = OSError("checkpoint unavailable")
        for _ in range(2):
            status, _, payload = self.request("GET", "/api/team/dashboard")
            self.assertEqual(status, 200)
            self.assertTrue(payload["ok"])
            self.assertNotIn("dataAsOf", payload)
        self.providers["team_dashboard_provider"].assert_called_once()
        self.providers["jira_sync_status_provider"].assert_not_called()

    def test_post_and_source_timestamp_invalidate_cached_dashboard(self) -> None:
        dashboard = self.providers["team_dashboard_provider"]
        dashboard.return_value = {"version": 1}
        self.providers["jira_data_as_of_provider"].return_value = "2026-10-01T00:00:00Z"
        self.assertEqual(self.request("GET", "/api/team/dashboard")[2]["version"], 1)
        dashboard.return_value = {"version": 2}
        self.assertEqual(self.request("GET", "/api/team/dashboard")[2]["version"], 1)
        self.assertEqual(
            self.post("/api/metadata/lookup/groups", {"name": "Platform"})[0], 200
        )
        self.assertEqual(self.request("GET", "/api/team/dashboard")[2]["version"], 2)
        dashboard.return_value = {"version": 3}
        self.providers["jira_data_as_of_provider"].return_value = "2026-10-02T00:00:00Z"
        payload = self.request("GET", "/api/team/dashboard")[2]
        self.assertEqual(payload["version"], 3)
        self.assertEqual(payload["dataAsOf"], "2026-10-02T00:00:00Z")
        self.assertEqual(dashboard.call_count, 3)
