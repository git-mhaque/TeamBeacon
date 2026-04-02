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
        self.sync_start_calls: list[tuple[str | None, str | None]] = []
        self.issue_search_calls: list[dict[str, object]] = []
        self.current_sprint_calls: list[bool] = []
        self.current_sprint_changes_calls: list[bool] = []
        self.current_sprint_work_calls: list[bool] = []
        self.group_create_calls: list[str] = []
        self.work_type_create_calls: list[str] = []
        self.group_update_calls: list[tuple[int, str]] = []
        self.work_type_update_calls: list[tuple[int, str]] = []
        self.group_delete_calls: list[int] = []
        self.work_type_delete_calls: list[int] = []
        self.epic_upsert_calls: list[dict[str, object]] = []
        self.epic_delete_calls: list[str] = []
        self.epic_candidate_calls: list[tuple[str | None, int]] = []
        self.epic_summary_calls: list[tuple[int, str | None, str | None, str | None]] = []
        self.oci_chat_calls: list[dict[str, object]] = []

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

        def fake_sync_start(mode=None, since_date=None):  # noqa: ANN001
            if mode not in {None, "full", "since_last", "since_date"}:
                raise ValueError("Unsupported sync mode. Allowed values: full, since_last, since_date.")
            if mode == "since_date" and not since_date:
                raise ValueError("sinceDate is required in YYYY-MM-DD or ISO-8601 format when mode is since_date.")
            self.sync_start_calls.append((mode, since_date))
            return {
                "source": "jira",
                "state": "running",
                "phase": "issues",
                "syncMode": mode or "full",
                "requestedSince": since_date,
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

        def fake_oci_status():
            return {
                "source": "oci_genai",
                "connected": True,
                "checkedAt": "2026-03-25T00:00:00+00:00",
                "config": {
                    "endpoint": "https://inference.generativeai.us-chicago-1.oci.oraclecloud.com",
                    "modelId": "cohere.command-r-08-2024",
                },
                "checks": [
                    {"name": "oci_sdk", "ok": True, "detail": "OCI Python SDK is available."},
                    {"name": "oci_profile", "ok": True, "detail": "Profile DEFAULT loaded."},
                ],
                "error": None,
            }

        def fake_confluence_status():
            return {
                "source": "confluence",
                "connected": True,
                "checkedAt": "2026-03-25T00:00:00+00:00",
                "config": {
                    "baseUrl": "https://gbuconfluence.oraclecorp.com",
                    "authMode": "pat_bearer",
                    "timeoutSeconds": 30,
                },
                "checks": [
                    {"name": "space_query", "ok": True, "detail": "Confluence space query succeeded."},
                ],
                "metrics": {"spaceCount": 1},
                "error": None,
            }

        def fake_oci_chat(
            *,
            message,  # noqa: ANN001
            model_id=None,  # noqa: ANN001
            max_tokens=None,  # noqa: ANN001
            temperature=None,  # noqa: ANN001
            top_p=None,  # noqa: ANN001
            top_k=None,  # noqa: ANN001
            frequency_penalty=None,  # noqa: ANN001
        ):
            self.oci_chat_calls.append(
                {
                    "message": message,
                    "model_id": model_id,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "top_p": top_p,
                    "top_k": top_k,
                    "frequency_penalty": frequency_penalty,
                }
            )
            return {
                "source": "oci_genai",
                "modelId": model_id or "cohere.command-r-08-2024",
                "response": {"text": "TeamBeacon can summarize sprint risk weekly."},
                "request": {
                    "message": message,
                    "maxTokens": max_tokens if max_tokens is not None else 600,
                    "temperature": temperature if temperature is not None else 1.0,
                    "topP": top_p if top_p is not None else 0.75,
                    "topK": top_k if top_k is not None else 0,
                    "frequencyPenalty": frequency_penalty if frequency_penalty is not None else 0.0,
                },
                "error": None,
            }

        def fake_issue_search(**kwargs):  # noqa: ANN003
            self.issue_search_calls.append(kwargs)
            return {
                "source": "local",
                "filters": {
                    "epicKey": kwargs.get("epic_key"),
                    "workedBy": kwargs.get("worked_by"),
                },
                "count": 1,
                "issues": [
                    {
                        "issueKey": "CEGBUPOL-101",
                        "summary": "Sample",
                        "contributors": ["user-dev", "user-qa"],
                    }
                ],
            }

        def fake_current_sprint():
            self.current_sprint_calls.append(True)
            return {
                "source": "local",
                "sprint": {
                    "id": 55421,
                    "boardId": 27193,
                    "name": "CEGBU Polaris Sprint 45",
                    "state": "active",
                    "startDate": "2026-03-20T00:00:00+00:00",
                    "endDate": "2026-03-31T00:00:00+00:00",
                    "remainingDays": 5,
                },
                "error": None,
            }

        def fake_current_sprint_work():
            self.current_sprint_work_calls.append(True)
            return {
                "source": "local",
                "sprint": {
                    "id": 55421,
                    "boardId": 27193,
                    "name": "CEGBU Polaris Sprint 45",
                    "state": "active",
                    "startDate": "2026-03-20T00:00:00+00:00",
                    "endDate": "2026-03-31T00:00:00+00:00",
                    "remainingDays": 5,
                },
                "work": {
                    "done": [
                        {
                            "issueKey": "CEGBUPOL-6001",
                            "summary": "Completed migration",
                            "status": "Done",
                            "statusCategory": "Done",
                            "storyPoints": 8.0,
                            "epicKey": "CEGBUPOL-5000",
                            "epicName": "Platform Reliability Epic",
                            "issueUrl": "https://gbujira.oraclecorp.com/browse/CEGBUPOL-6001",
                        },
                    ],
                    "inProgress": [
                        {
                            "issueKey": "CEGBUPOL-6002",
                            "summary": "Deploy validation",
                            "status": "In Progress",
                            "statusCategory": "In Progress",
                            "storyPoints": 5.0,
                            "epicKey": "CEGBUPOL-5000",
                            "epicName": "Platform Reliability Epic",
                            "issueUrl": "https://gbujira.oraclecorp.com/browse/CEGBUPOL-6002",
                        },
                    ],
                    "planned": [
                        {
                            "issueKey": "CEGBUPOL-6003",
                            "summary": "Canary extension",
                            "status": "To Do",
                            "statusCategory": "To Do",
                            "storyPoints": 3.0,
                            "epicKey": "CEGBUPOL-5000",
                            "epicName": "Platform Reliability Epic",
                            "issueUrl": "https://gbujira.oraclecorp.com/browse/CEGBUPOL-6003",
                        },
                    ],
                    "totals": {
                        "done": 1,
                        "inProgress": 1,
                        "planned": 1,
                        "total": 3,
                        "storyPoints": {"done": 8.0, "inProgress": 5.0, "planned": 3.0, "total": 16.0},
                    },
                },
                "error": None,
            }

        def fake_current_sprint_changes():
            self.current_sprint_changes_calls.append(True)
            return {
                "source": "local",
                "sprint": {
                    "id": 55421,
                    "boardId": 27193,
                    "name": "CEGBU Polaris Sprint 45",
                    "state": "active",
                    "startDate": "2026-03-20T00:00:00+00:00",
                    "endDate": "2026-03-31T00:00:00+00:00",
                    "remainingDays": 5,
                },
                "changes": {
                    "addedAfterStart": {
                        "count": 4,
                        "storyPointsTotal": 11.0,
                        "issueKeys": ["CEGBUPOL-6101", "CEGBUPOL-6102"],
                        "issueCards": [
                            {
                                "issueKey": "CEGBUPOL-6101",
                                "summary": "Added card 1",
                                "issueUrl": "https://gbujira.oraclecorp.com/browse/CEGBUPOL-6101",
                                "epicName": "Domain Support Q4",
                                "epicUrl": "https://gbujira.oraclecorp.com/browse/CEGBUPOL-3553",
                                "storyPoints": 2.0,
                                "status": "In Progress",
                                "statusCategory": "In Progress",
                            },
                            {
                                "issueKey": "CEGBUPOL-6102",
                                "summary": "Added card 2",
                                "issueUrl": "https://gbujira.oraclecorp.com/browse/CEGBUPOL-6102",
                                "epicName": "Domain Support Q4",
                                "epicUrl": "https://gbujira.oraclecorp.com/browse/CEGBUPOL-3553",
                                "storyPoints": 9.0,
                                "status": "To Do",
                                "statusCategory": "To Do",
                            },
                        ],
                    },
                    "removedAfterStart": {
                        "count": 1,
                        "storyPointsTotal": 3.0,
                        "issueKeys": ["CEGBUPOL-6103"],
                        "issueCards": [
                            {
                                "issueKey": "CEGBUPOL-6103",
                                "summary": "Removed card",
                                "issueUrl": "https://gbujira.oraclecorp.com/browse/CEGBUPOL-6103",
                                "epicName": "Domain Support Q4",
                                "epicUrl": "https://gbujira.oraclecorp.com/browse/CEGBUPOL-3553",
                                "storyPoints": 3.0,
                                "status": "Done",
                                "statusCategory": "Done",
                            }
                        ],
                    },
                    "blockedCards": {
                        "count": 2,
                        "storyPointsTotal": 8.0,
                        "issueKeys": ["CEGBUPOL-6104", "CEGBUPOL-6105"],
                        "issueCards": [
                            {
                                "issueKey": "CEGBUPOL-6104",
                                "summary": "Blocked card 1",
                                "issueUrl": "https://gbujira.oraclecorp.com/browse/CEGBUPOL-6104",
                                "epicName": "Domain Support Q4",
                                "epicUrl": "https://gbujira.oraclecorp.com/browse/CEGBUPOL-3553",
                                "storyPoints": 5.0,
                                "status": "Blocked",
                                "statusCategory": "In Progress",
                            },
                            {
                                "issueKey": "CEGBUPOL-6105",
                                "summary": "Blocked card 2",
                                "issueUrl": "https://gbujira.oraclecorp.com/browse/CEGBUPOL-6105",
                                "epicName": "Domain Support Q4",
                                "epicUrl": "https://gbujira.oraclecorp.com/browse/CEGBUPOL-3553",
                                "storyPoints": 3.0,
                                "status": "In Progress",
                                "statusCategory": "Blocked",
                            },
                        ],
                    },
                },
                "error": None,
            }

        def fake_metadata_lookup():
            return {
                "groups": [{"id": 1, "name": "Platform"}],
                "workTypes": [{"id": 10, "name": "Feature"}],
            }

        def fake_add_group(name):  # noqa: ANN001
            self.group_create_calls.append(name)
            return {"id": 2, "name": name}

        def fake_add_work_type(name):  # noqa: ANN001
            self.work_type_create_calls.append(name)
            return {"id": 11, "name": name}

        def fake_update_group(lookup_id, name):  # noqa: ANN001
            self.group_update_calls.append((lookup_id, name))
            return {"id": lookup_id, "name": name}

        def fake_update_work_type(lookup_id, name):  # noqa: ANN001
            self.work_type_update_calls.append((lookup_id, name))
            return {"id": lookup_id, "name": name}

        def fake_delete_group(lookup_id):  # noqa: ANN001
            self.group_delete_calls.append(lookup_id)
            return {"id": lookup_id, "deleted": True, "removedMappings": 1, "removedLookupRows": 1}

        def fake_delete_work_type(lookup_id):  # noqa: ANN001
            self.work_type_delete_calls.append(lookup_id)
            return {"id": lookup_id, "deleted": True, "removedMappings": 1, "removedLookupRows": 1}

        def fake_read_epics(epic_key=None, limit=50):  # noqa: ANN001
            _ = limit
            if epic_key:
                return {
                    "epics": [
                        {
                            "epicKey": epic_key,
                            "epicTitle": "Enable offline initiative scoring",
                            "successCriteria": ["Zero blocker defects"],
                            "timelineEnabled": False,
                            "timelineStartDate": None,
                            "targetCompletionDate": None,
                            "groupIds": [1],
                            "groups": [{"id": 1, "name": "Platform"}],
                            "workTypeIds": [10],
                            "workTypes": [{"id": 10, "name": "Feature"}],
                            "updatedAt": "2026-03-25T00:00:00+00:00",
                        }
                    ]
                }
            return {"epics": []}

        def fake_search_epics(query=None, limit=20):  # noqa: ANN001
            self.epic_candidate_calls.append((query, limit))
            return {
                "epics": [
                    {
                        "epicKey": "CEGBUPOL-5000",
                        "epicName": "Unified Engineering Pulse",
                    }
                ]
            }

        def fake_epic_summary(limit=50, period_start=None, period_end=None, timezone_name=None):  # noqa: ANN001
            self.epic_summary_calls.append((limit, period_start, period_end, timezone_name))
            return {
                "epics": [
                    {
                        "epicKey": "CEGBUPOL-4482",
                        "epicName": "Enable offline initiative scoring",
                        "completedCards": 8,
                        "totalCards": 10,
                        "completionPercent": 80.0,
                        "completedInPeriod": 2,
                        "completedLastWeek": 2,
                        "deltaPercentInPeriod": 20.0,
                        "deltaPercent": 20.0,
                        "groups": [{"id": 1, "name": "Platform"}],
                        "workTypes": [{"id": 10, "name": "Feature"}],
                        "successCriteria": ["Zero blocker defects"],
                        "timelineEnabled": True,
                        "timelineStartDate": "2026-04-01",
                        "targetCompletionDate": "2026-04-15",
                        "ragScore": None,
                        "insightComment": None,
                        "updatedAt": "2026-03-25T00:00:00+00:00",
                    }
                ]
                ,
                "reportingPeriod": {
                    "startDate": "2026-03-01",
                    "endDate": "2026-03-30",
                    "days": 30,
                    "timezone": "Australia/Melbourne",
                },
            }

        def fake_upsert_epic(**kwargs):  # noqa: ANN003
            self.epic_upsert_calls.append(kwargs)
            return {
                "epicKey": kwargs["epic_key"],
                "successCriteria": kwargs.get("success_criteria") or [],
                "timelineEnabled": bool(kwargs.get("timeline_enabled")),
                "timelineStartDate": kwargs.get("timeline_start_date"),
                "targetCompletionDate": kwargs.get("target_completion_date"),
                "groupIds": kwargs.get("group_ids") or [],
                "groups": [{"id": 1, "name": "Platform"}],
                "workTypeIds": kwargs.get("work_type_ids") or [],
                "workTypes": [{"id": 10, "name": "Feature"}],
                "updatedAt": "2026-03-25T00:00:00+00:00",
            }

        def fake_delete_epic(epic_key):  # noqa: ANN001
            self.epic_delete_calls.append(epic_key)
            return {
                "epicKey": epic_key,
                "deleted": True,
                "removedGroupMappings": 1,
                "removedWorkTypeMappings": 1,
                "removedMetadataRows": 1,
            }

        handler_cls = build_handler(
            jira_status_provider=fake_status,
            jira_sync_status_provider=fake_sync_status,
            jira_sync_start_provider=fake_sync_start,
            jira_sync_history_provider=fake_sync_history,
            issue_search_provider=fake_issue_search,
            current_sprint_provider=fake_current_sprint,
            current_sprint_changes_provider=fake_current_sprint_changes,
            current_sprint_work_provider=fake_current_sprint_work,
            metadata_lookup_provider=fake_metadata_lookup,
            metadata_add_group_provider=fake_add_group,
            metadata_add_work_type_provider=fake_add_work_type,
            metadata_update_group_provider=fake_update_group,
            metadata_delete_group_provider=fake_delete_group,
            metadata_update_work_type_provider=fake_update_work_type,
            metadata_delete_work_type_provider=fake_delete_work_type,
            metadata_read_epics_provider=fake_read_epics,
            metadata_summary_provider=fake_epic_summary,
            metadata_search_epics_provider=fake_search_epics,
            metadata_upsert_epic_provider=fake_upsert_epic,
            metadata_delete_epic_provider=fake_delete_epic,
            confluence_status_provider=fake_confluence_status,
            oci_genai_status_provider=fake_oci_status,
            oci_genai_chat_provider=fake_oci_chat,
        )
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

    def test_openapi_endpoint(self) -> None:
        with urlopen(f"{self.base_url}/openapi.json", timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            self.assertIn("application/json", response.headers.get("Content-Type", ""))
            body = json.loads(response.read().decode("utf-8"))

        self.assertEqual(body["openapi"], "3.0.3")
        self.assertEqual(body["info"]["title"], "TeamBeacon Local API")
        self.assertIn("/api/ai/chat", body["paths"])
        self.assertIn("/api/integrations/confluence/status", body["paths"])
        self.assertIn("/api/metadata/epics/summary", body["paths"])
        self.assertEqual(body["servers"][0]["url"], self.base_url)

    def test_docs_endpoint(self) -> None:
        with urlopen(f"{self.base_url}/docs", timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            self.assertIn("text/html", response.headers.get("Content-Type", ""))
            body = response.read().decode("utf-8")

        self.assertIn("TeamBeacon Local API - Swagger UI", body)
        self.assertIn("SwaggerUIBundle", body)
        self.assertIn("/openapi.json", body)

    def test_docs_alias_endpoint(self) -> None:
        with urlopen(f"{self.base_url}/api/docs", timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            self.assertIn("text/html", response.headers.get("Content-Type", ""))

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
        self.assertEqual(self.sync_start_calls[-1], ("since_last", None))

    def test_jira_sync_start_endpoint_since_date_mode(self) -> None:
        request = Request(
            f"{self.base_url}/api/integrations/jira/sync/start",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=json.dumps({"mode": "since_date", "sinceDate": "2026-03-01"}).encode("utf-8"),
        )
        with urlopen(request, timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 202)
            body = json.loads(response.read().decode("utf-8"))
        self.assertTrue(body["started"])
        self.assertEqual(body["syncMode"], "since_date")
        self.assertEqual(body["requestedSince"], "2026-03-01")
        self.assertEqual(self.sync_start_calls[-1], ("since_date", "2026-03-01"))

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

    def test_oci_genai_status_endpoint(self) -> None:
        with urlopen(f"{self.base_url}/api/integrations/oci-genai/status", timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(body["source"], "oci_genai")
        self.assertTrue(body["connected"])
        self.assertEqual(body["config"]["modelId"], "cohere.command-r-08-2024")
        self.assertEqual(len(body["checks"]), 2)

    def test_confluence_status_endpoint(self) -> None:
        with urlopen(f"{self.base_url}/api/integrations/confluence/status", timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(body["source"], "confluence")
        self.assertTrue(body["connected"])
        self.assertEqual(body["config"]["baseUrl"], "https://gbuconfluence.oraclecorp.com")
        self.assertEqual(body["metrics"]["spaceCount"], 1)

    def test_oci_genai_chat_endpoint(self) -> None:
        request = Request(
            f"{self.base_url}/api/ai/chat",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=json.dumps(
                {
                    "message": "Summarize blockers from this sprint.",
                    "maxTokens": 300,
                    "temperature": 0.3,
                    "topP": 0.8,
                    "topK": 5,
                    "frequencyPenalty": 0.2,
                }
            ).encode("utf-8"),
        )
        with urlopen(request, timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))

        self.assertEqual(body["source"], "oci_genai")
        self.assertIn("TeamBeacon", body["response"]["text"])
        self.assertEqual(self.oci_chat_calls[-1]["message"], "Summarize blockers from this sprint.")
        self.assertEqual(self.oci_chat_calls[-1]["max_tokens"], 300)
        self.assertEqual(self.oci_chat_calls[-1]["temperature"], 0.3)
        self.assertEqual(self.oci_chat_calls[-1]["top_p"], 0.8)
        self.assertEqual(self.oci_chat_calls[-1]["top_k"], 5)
        self.assertEqual(self.oci_chat_calls[-1]["frequency_penalty"], 0.2)

    def test_oci_genai_chat_endpoint_rejects_non_numeric_temperature(self) -> None:
        request = Request(
            f"{self.base_url}/api/ai/chat",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=json.dumps(
                {
                    "message": "Summarize blockers from this sprint.",
                    "temperature": "hot",
                }
            ).encode("utf-8"),
        )
        with self.assertRaises(HTTPError) as exc_ctx:
            urlopen(request, timeout=5)  # noqa: S310
        self.assertEqual(exc_ctx.exception.code, 400)

    def test_issue_search_endpoint(self) -> None:
        with urlopen(
            f"{self.base_url}/api/issues/search?epicKey=CEGBUPOL-4482&workedBy=user-qa&limit=25",
            timeout=5,
        ) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))

        self.assertEqual(body["source"], "local")
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["issues"][0]["issueKey"], "CEGBUPOL-101")
        self.assertEqual(body["issues"][0]["contributors"], ["user-dev", "user-qa"])

        self.assertEqual(len(self.issue_search_calls), 1)
        call = self.issue_search_calls[0]
        self.assertEqual(call["epic_key"], "CEGBUPOL-4482")
        self.assertEqual(call["worked_by"], "user-qa")
        self.assertEqual(call["limit"], 25)

    def test_current_sprint_endpoint(self) -> None:
        with urlopen(f"{self.base_url}/api/sprints/current", timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))

        self.assertEqual(body["source"], "local")
        self.assertEqual(body["sprint"]["id"], 55421)
        self.assertEqual(body["sprint"]["boardId"], 27193)
        self.assertEqual(body["sprint"]["name"], "CEGBU Polaris Sprint 45")
        self.assertEqual(body["sprint"]["state"], "active")
        self.assertEqual(body["sprint"]["remainingDays"], 5)
        self.assertEqual(len(self.current_sprint_calls), 1)

    def test_current_sprint_work_endpoint(self) -> None:
        with urlopen(f"{self.base_url}/api/sprints/current/work", timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))

        self.assertEqual(body["source"], "local")
        self.assertEqual(body["sprint"]["id"], 55421)
        self.assertEqual(body["work"]["totals"]["done"], 1)
        self.assertEqual(body["work"]["totals"]["inProgress"], 1)
        self.assertEqual(body["work"]["totals"]["planned"], 1)
        self.assertEqual(body["work"]["totals"]["total"], 3)
        self.assertEqual(body["work"]["totals"]["storyPoints"]["done"], 8.0)
        self.assertEqual(body["work"]["totals"]["storyPoints"]["inProgress"], 5.0)
        self.assertEqual(body["work"]["totals"]["storyPoints"]["planned"], 3.0)
        self.assertEqual(body["work"]["totals"]["storyPoints"]["total"], 16.0)
        self.assertEqual(body["work"]["done"][0]["issueKey"], "CEGBUPOL-6001")
        self.assertEqual(body["work"]["done"][0]["storyPoints"], 8.0)
        self.assertEqual(body["work"]["done"][0]["epicName"], "Platform Reliability Epic")
        self.assertEqual(body["work"]["inProgress"][0]["issueKey"], "CEGBUPOL-6002")
        self.assertEqual(body["work"]["inProgress"][0]["storyPoints"], 5.0)
        self.assertEqual(body["work"]["inProgress"][0]["epicName"], "Platform Reliability Epic")
        self.assertEqual(body["work"]["planned"][0]["issueKey"], "CEGBUPOL-6003")
        self.assertEqual(body["work"]["planned"][0]["storyPoints"], 3.0)
        self.assertEqual(body["work"]["planned"][0]["epicName"], "Platform Reliability Epic")
        self.assertEqual(len(self.current_sprint_work_calls), 1)

    def test_current_sprint_changes_endpoint(self) -> None:
        with urlopen(f"{self.base_url}/api/sprints/current/changes", timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))

        self.assertEqual(body["source"], "local")
        self.assertEqual(body["sprint"]["id"], 55421)
        self.assertEqual(body["changes"]["addedAfterStart"]["count"], 4)
        self.assertEqual(body["changes"]["addedAfterStart"]["storyPointsTotal"], 11.0)
        self.assertEqual(body["changes"]["addedAfterStart"]["issueKeys"], ["CEGBUPOL-6101", "CEGBUPOL-6102"])
        self.assertEqual(body["changes"]["addedAfterStart"]["issueCards"][0]["issueKey"], "CEGBUPOL-6101")
        self.assertEqual(body["changes"]["addedAfterStart"]["issueCards"][0]["summary"], "Added card 1")
        self.assertEqual(body["changes"]["addedAfterStart"]["issueCards"][0]["epicName"], "Domain Support Q4")
        self.assertEqual(body["changes"]["addedAfterStart"]["issueCards"][0]["storyPoints"], 2.0)
        self.assertEqual(body["changes"]["addedAfterStart"]["issueCards"][0]["status"], "In Progress")
        self.assertEqual(body["changes"]["addedAfterStart"]["issueCards"][0]["statusCategory"], "In Progress")
        self.assertEqual(body["changes"]["removedAfterStart"]["count"], 1)
        self.assertEqual(body["changes"]["removedAfterStart"]["storyPointsTotal"], 3.0)
        self.assertEqual(body["changes"]["removedAfterStart"]["issueKeys"], ["CEGBUPOL-6103"])
        self.assertEqual(body["changes"]["removedAfterStart"]["issueCards"][0]["issueKey"], "CEGBUPOL-6103")
        self.assertEqual(body["changes"]["removedAfterStart"]["issueCards"][0]["epicName"], "Domain Support Q4")
        self.assertEqual(body["changes"]["removedAfterStart"]["issueCards"][0]["storyPoints"], 3.0)
        self.assertEqual(body["changes"]["removedAfterStart"]["issueCards"][0]["status"], "Done")
        self.assertEqual(body["changes"]["blockedCards"]["count"], 2)
        self.assertEqual(body["changes"]["blockedCards"]["storyPointsTotal"], 8.0)
        self.assertEqual(body["changes"]["blockedCards"]["issueKeys"], ["CEGBUPOL-6104", "CEGBUPOL-6105"])
        self.assertEqual(body["changes"]["blockedCards"]["issueCards"][0]["issueKey"], "CEGBUPOL-6104")
        self.assertEqual(body["changes"]["blockedCards"]["issueCards"][0]["epicName"], "Domain Support Q4")
        self.assertEqual(body["changes"]["blockedCards"]["issueCards"][0]["storyPoints"], 5.0)
        self.assertEqual(body["changes"]["blockedCards"]["issueCards"][0]["status"], "Blocked")
        self.assertEqual(body["changes"]["blockedCards"]["issueCards"][0]["statusCategory"], "In Progress")
        self.assertEqual(len(self.current_sprint_changes_calls), 1)

    def test_metadata_lookup_endpoint(self) -> None:
        with urlopen(f"{self.base_url}/api/metadata/lookup", timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(body["groups"][0]["name"], "Platform")
        self.assertEqual(body["workTypes"][0]["name"], "Feature")

    def test_metadata_add_group_endpoint(self) -> None:
        request = Request(
            f"{self.base_url}/api/metadata/lookup/groups",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=json.dumps({"name": "Operations"}).encode("utf-8"),
        )
        with urlopen(request, timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(body["name"], "Operations")
        self.assertEqual(self.group_create_calls[-1], "Operations")

    def test_metadata_add_work_type_endpoint(self) -> None:
        request = Request(
            f"{self.base_url}/api/metadata/lookup/work-types",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=json.dumps({"name": "Run"}).encode("utf-8"),
        )
        with urlopen(request, timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(body["name"], "Run")
        self.assertEqual(self.work_type_create_calls[-1], "Run")

    def test_metadata_update_group_endpoint(self) -> None:
        request = Request(
            f"{self.base_url}/api/metadata/lookup/groups/update",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=json.dumps({"id": 1, "name": "Platform Core"}).encode("utf-8"),
        )
        with urlopen(request, timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(body["id"], 1)
        self.assertEqual(body["name"], "Platform Core")
        self.assertEqual(self.group_update_calls[-1], (1, "Platform Core"))

    def test_metadata_delete_group_endpoint(self) -> None:
        request = Request(
            f"{self.base_url}/api/metadata/lookup/groups/delete",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=json.dumps({"id": 1}).encode("utf-8"),
        )
        with urlopen(request, timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(body["id"], 1)
        self.assertTrue(body["deleted"])
        self.assertEqual(self.group_delete_calls[-1], 1)

    def test_metadata_update_work_type_endpoint(self) -> None:
        request = Request(
            f"{self.base_url}/api/metadata/lookup/work-types/update",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=json.dumps({"id": 10, "name": "Feature+Run"}).encode("utf-8"),
        )
        with urlopen(request, timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(body["id"], 10)
        self.assertEqual(body["name"], "Feature+Run")
        self.assertEqual(self.work_type_update_calls[-1], (10, "Feature+Run"))

    def test_metadata_delete_work_type_endpoint(self) -> None:
        request = Request(
            f"{self.base_url}/api/metadata/lookup/work-types/delete",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=json.dumps({"id": 10}).encode("utf-8"),
        )
        with urlopen(request, timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(body["id"], 10)
        self.assertTrue(body["deleted"])
        self.assertEqual(self.work_type_delete_calls[-1], 10)

    def test_metadata_upsert_epic_endpoint(self) -> None:
        request = Request(
            f"{self.base_url}/api/metadata/epics",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=json.dumps(
                {
                    "epicKey": "CEGBUPOL-4482",
                    "successCriteria": ["Zero blocker defects"],
                    "timelineEnabled": True,
                    "timelineStartDate": "2026-04-01",
                    "targetCompletionDate": "2026-04-15",
                    "groupIds": [1],
                    "workTypeIds": [10],
                }
            ).encode("utf-8"),
        )
        with urlopen(request, timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(body["epicKey"], "CEGBUPOL-4482")
        self.assertTrue(body["timelineEnabled"])
        self.assertEqual(body["timelineStartDate"], "2026-04-01")
        self.assertEqual(body["targetCompletionDate"], "2026-04-15")
        self.assertEqual(body["groupIds"], [1])
        self.assertEqual(body["workTypeIds"], [10])
        self.assertEqual(self.epic_upsert_calls[-1]["epic_key"], "CEGBUPOL-4482")
        self.assertTrue(self.epic_upsert_calls[-1]["timeline_enabled"])
        self.assertEqual(self.epic_upsert_calls[-1]["timeline_start_date"], "2026-04-01")
        self.assertEqual(self.epic_upsert_calls[-1]["target_completion_date"], "2026-04-15")

    def test_metadata_upsert_epic_endpoint_rejects_non_boolean_timeline_flag(self) -> None:
        request = Request(
            f"{self.base_url}/api/metadata/epics",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=json.dumps(
                {
                    "epicKey": "CEGBUPOL-4482",
                    "successCriteria": ["Zero blocker defects"],
                    "timelineEnabled": "yes",
                    "groupIds": [1],
                    "workTypeIds": [10],
                }
            ).encode("utf-8"),
        )
        with self.assertRaises(HTTPError) as exc_ctx:
            urlopen(request, timeout=5)  # noqa: S310
        self.assertEqual(exc_ctx.exception.code, 400)

    def test_metadata_upsert_epic_endpoint_rejects_non_string_timeline_start_date(self) -> None:
        request = Request(
            f"{self.base_url}/api/metadata/epics",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=json.dumps(
                {
                    "epicKey": "CEGBUPOL-4482",
                    "successCriteria": ["Zero blocker defects"],
                    "timelineEnabled": True,
                    "timelineStartDate": 20260401,
                    "targetCompletionDate": "2026-04-15",
                    "groupIds": [1],
                    "workTypeIds": [10],
                }
            ).encode("utf-8"),
        )
        with self.assertRaises(HTTPError) as exc_ctx:
            urlopen(request, timeout=5)  # noqa: S310
        self.assertEqual(exc_ctx.exception.code, 400)

    def test_metadata_upsert_epic_endpoint_rejects_multiple_groups(self) -> None:
        request = Request(
            f"{self.base_url}/api/metadata/epics",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=json.dumps(
                {
                    "epicKey": "CEGBUPOL-4482",
                    "successCriteria": ["Zero blocker defects"],
                    "groupIds": [1, 2],
                    "workTypeIds": [10],
                }
            ).encode("utf-8"),
        )
        with self.assertRaises(HTTPError) as exc_ctx:
            urlopen(request, timeout=5)  # noqa: S310
        self.assertEqual(exc_ctx.exception.code, 400)

    def test_metadata_upsert_epic_endpoint_rejects_multiple_work_types(self) -> None:
        request = Request(
            f"{self.base_url}/api/metadata/epics",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=json.dumps(
                {
                    "epicKey": "CEGBUPOL-4482",
                    "successCriteria": ["Zero blocker defects"],
                    "groupIds": [1],
                    "workTypeIds": [10, 11],
                }
            ).encode("utf-8"),
        )
        with self.assertRaises(HTTPError) as exc_ctx:
            urlopen(request, timeout=5)  # noqa: S310
        self.assertEqual(exc_ctx.exception.code, 400)

    def test_metadata_delete_epic_endpoint(self) -> None:
        request = Request(
            f"{self.base_url}/api/metadata/epics/delete",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=json.dumps({"epicKey": "CEGBUPOL-4482"}).encode("utf-8"),
        )
        with urlopen(request, timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(body["epicKey"], "CEGBUPOL-4482")
        self.assertTrue(body["deleted"])
        self.assertEqual(body["removedMetadataRows"], 1)
        self.assertEqual(self.epic_delete_calls[-1], "CEGBUPOL-4482")

    def test_metadata_read_epic_endpoint(self) -> None:
        with urlopen(f"{self.base_url}/api/metadata/epics?epicKey=CEGBUPOL-4482", timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(len(body["epics"]), 1)
        self.assertEqual(body["epics"][0]["epicKey"], "CEGBUPOL-4482")
        self.assertEqual(body["epics"][0]["epicTitle"], "Enable offline initiative scoring")
        self.assertFalse(body["epics"][0]["timelineEnabled"])
        self.assertIsNone(body["epics"][0]["timelineStartDate"])
        self.assertIsNone(body["epics"][0]["targetCompletionDate"])

    def test_metadata_search_epic_candidates_endpoint(self) -> None:
        with urlopen(f"{self.base_url}/api/metadata/epics/candidates?q=pulse&limit=12", timeout=5) as response:  # noqa: S310
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(len(body["epics"]), 1)
        self.assertEqual(body["epics"][0]["epicKey"], "CEGBUPOL-5000")
        self.assertEqual(body["epics"][0]["epicName"], "Unified Engineering Pulse")
        self.assertEqual(self.epic_candidate_calls[-1], ("pulse", 12))

    def test_metadata_epic_summary_endpoint(self) -> None:
        with urlopen(  # noqa: S310
            f"{self.base_url}/api/metadata/epics/summary?limit=30&periodStart=2026-03-01&periodEnd=2026-03-30&timezone=Australia%2FMelbourne",
            timeout=5,
        ) as response:
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(len(body["epics"]), 1)
        self.assertEqual(body["epics"][0]["epicKey"], "CEGBUPOL-4482")
        self.assertEqual(body["epics"][0]["completionPercent"], 80.0)
        self.assertEqual(body["epics"][0]["groups"][0]["name"], "Platform")
        self.assertEqual(body["epics"][0]["workTypes"][0]["name"], "Feature")
        self.assertEqual(body["epics"][0]["successCriteria"][0], "Zero blocker defects")
        self.assertTrue(body["epics"][0]["timelineEnabled"])
        self.assertEqual(body["epics"][0]["timelineStartDate"], "2026-04-01")
        self.assertEqual(body["epics"][0]["targetCompletionDate"], "2026-04-15")
        self.assertEqual(body["epics"][0]["completedInPeriod"], 2)
        self.assertEqual(body["epics"][0]["completedLastWeek"], 2)
        self.assertEqual(body["epics"][0]["deltaPercentInPeriod"], 20.0)
        self.assertEqual(body["epics"][0]["deltaPercent"], 20.0)
        self.assertEqual(body["reportingPeriod"]["startDate"], "2026-03-01")
        self.assertEqual(body["reportingPeriod"]["endDate"], "2026-03-30")
        self.assertEqual(body["reportingPeriod"]["timezone"], "Australia/Melbourne")
        self.assertIsNone(body["epics"][0]["ragScore"])
        self.assertEqual(
            self.epic_summary_calls[-1],
            (30, "2026-03-01", "2026-03-30", "Australia/Melbourne"),
        )


if __name__ == "__main__":
    unittest.main()
