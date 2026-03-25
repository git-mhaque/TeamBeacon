from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Optional
from urllib.parse import parse_qs, urlparse

from services.api.issues.query import search_synced_issues
from services.api.integrations.jira_status import get_jira_status
from services.api.integrations.jira_sync import (
    get_jira_sync_history,
    get_jira_sync_status,
    start_jira_sync,
)
from services.api.metadata.epic_config import (
    add_epic_group,
    add_work_type,
    delete_epic_group,
    delete_work_type,
    get_configured_epic_summary,
    get_epic_lookup_config,
    get_epic_metadata,
    search_unconfigured_epics,
    update_epic_group,
    update_work_type,
    upsert_epic_metadata,
)


StatusProvider = Callable[[], dict[str, Any]]
StartProvider = Callable[[Optional[str], Optional[str]], dict[str, Any]]
HistoryProvider = Callable[[int], dict[str, Any]]
IssueSearchProvider = Callable[..., dict[str, Any]]
MetadataLookupProvider = Callable[[], dict[str, Any]]
MetadataCreateProvider = Callable[[str], dict[str, Any]]
MetadataUpdateProvider = Callable[[int, str], dict[str, Any]]
MetadataDeleteProvider = Callable[[int], dict[str, Any]]
MetadataEpicReadProvider = Callable[..., dict[str, Any]]
MetadataEpicSummaryProvider = Callable[..., dict[str, Any]]
MetadataEpicSearchProvider = Callable[..., dict[str, Any]]
MetadataEpicUpsertProvider = Callable[..., dict[str, Any]]


def _json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def build_handler(
    jira_status_provider: StatusProvider = get_jira_status,
    jira_sync_status_provider: StatusProvider = get_jira_sync_status,
    jira_sync_start_provider: StartProvider = start_jira_sync,
    jira_sync_history_provider: HistoryProvider = get_jira_sync_history,
    issue_search_provider: IssueSearchProvider = search_synced_issues,
    metadata_lookup_provider: MetadataLookupProvider = get_epic_lookup_config,
    metadata_add_group_provider: MetadataCreateProvider = add_epic_group,
    metadata_add_work_type_provider: MetadataCreateProvider = add_work_type,
    metadata_update_group_provider: MetadataUpdateProvider = update_epic_group,
    metadata_delete_group_provider: MetadataDeleteProvider = delete_epic_group,
    metadata_update_work_type_provider: MetadataUpdateProvider = update_work_type,
    metadata_delete_work_type_provider: MetadataDeleteProvider = delete_work_type,
    metadata_read_epics_provider: MetadataEpicReadProvider = get_epic_metadata,
    metadata_summary_provider: MetadataEpicSummaryProvider = get_configured_epic_summary,
    metadata_search_epics_provider: MetadataEpicSearchProvider = search_unconfigured_epics,
    metadata_upsert_epic_provider: MetadataEpicUpsertProvider = upsert_epic_metadata,
) -> type[BaseHTTPRequestHandler]:
    class TeamBeaconHandler(BaseHTTPRequestHandler):
        def _set_json_headers(self, status_code: int = 200) -> None:
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_OPTIONS(self) -> None:  # noqa: N802
            self._set_json_headers(204)
            self.wfile.write(b"")

        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            path = parsed.path

            if path == "/health":
                self._set_json_headers(200)
                self.wfile.write(_json_bytes({"status": "ok"}))
                return

            if path == "/api/integrations/jira/status":
                payload = jira_status_provider()
                self._set_json_headers(200)
                self.wfile.write(_json_bytes(payload))
                return

            if path == "/api/integrations/jira/sync/status":
                payload = jira_sync_status_provider()
                self._set_json_headers(200)
                self.wfile.write(_json_bytes(payload))
                return

            if path == "/api/integrations/jira/sync/history":
                query = parse_qs(parsed.query)
                limit_raw = query.get("limit", ["20"])[0]
                try:
                    limit = int(limit_raw)
                except ValueError:
                    limit = 20
                payload = jira_sync_history_provider(limit)
                self._set_json_headers(200)
                self.wfile.write(_json_bytes(payload))
                return

            if path == "/api/issues/search":
                query = parse_qs(parsed.query)

                def _param(name: str) -> str | None:
                    value = query.get(name, [None])[0]
                    if isinstance(value, str):
                        value = value.strip()
                        return value or None
                    return None

                limit_raw = _param("limit") or "100"
                try:
                    limit = int(limit_raw)
                except ValueError:
                    limit = 100

                payload = issue_search_provider(
                    epic_key=_param("epicKey"),
                    assignee=_param("assignee"),
                    reporter=_param("reporter"),
                    worked_by=_param("workedBy"),
                    issue_type=_param("issueType"),
                    status=_param("status"),
                    updated_since=_param("updatedSince"),
                    updated_until=_param("updatedUntil"),
                    limit=limit,
                )
                self._set_json_headers(200)
                self.wfile.write(_json_bytes(payload))
                return

            if path == "/api/metadata/lookup":
                payload = metadata_lookup_provider()
                self._set_json_headers(200)
                self.wfile.write(_json_bytes(payload))
                return

            if path == "/api/metadata/epics":
                query = parse_qs(parsed.query)
                epic_key_raw = query.get("epicKey", [None])[0]
                epic_key = epic_key_raw.strip() if isinstance(epic_key_raw, str) else None
                limit_raw = query.get("limit", ["50"])[0]
                try:
                    limit = int(limit_raw)
                except ValueError:
                    limit = 50
                payload = metadata_read_epics_provider(epic_key=epic_key, limit=limit)
                self._set_json_headers(200)
                self.wfile.write(_json_bytes(payload))
                return

            if path == "/api/metadata/epics/summary":
                query = parse_qs(parsed.query)
                limit_raw = query.get("limit", ["50"])[0]
                try:
                    limit = int(limit_raw)
                except ValueError:
                    limit = 50
                payload = metadata_summary_provider(limit=limit)
                self._set_json_headers(200)
                self.wfile.write(_json_bytes(payload))
                return

            if path == "/api/metadata/epics/candidates":
                query = parse_qs(parsed.query)
                query_raw = query.get("q", [None])[0]
                candidate_query = query_raw.strip() if isinstance(query_raw, str) else None
                limit_raw = query.get("limit", ["20"])[0]
                try:
                    limit = int(limit_raw)
                except ValueError:
                    limit = 20
                payload = metadata_search_epics_provider(query=candidate_query, limit=limit)
                self._set_json_headers(200)
                self.wfile.write(_json_bytes(payload))
                return

            self._set_json_headers(404)
            self.wfile.write(_json_bytes({"error": "not_found"}))

        def do_POST(self) -> None:  # noqa: N802
            body_payload: Any = {}
            content_length = int(self.headers.get("Content-Length", "0") or 0)
            if content_length > 0:
                raw_body = self.rfile.read(content_length)
                try:
                    decoded = raw_body.decode("utf-8")
                    body_payload = json.loads(decoded) if decoded else {}
                except (UnicodeDecodeError, json.JSONDecodeError):
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": "Invalid JSON payload."}))
                    return

            parsed = urlparse(self.path)
            path = parsed.path

            if path == "/api/integrations/jira/sync/start":
                mode = None
                since_date = None
                if isinstance(body_payload, dict):
                    mode_raw = body_payload.get("mode")
                    mode = mode_raw if isinstance(mode_raw, str) else None
                    since_date_raw = body_payload.get("sinceDate")
                    since_date = since_date_raw if isinstance(since_date_raw, str) else None
                try:
                    payload = jira_sync_start_provider(mode, since_date)
                except ValueError as exc:
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": str(exc)}))
                    return
                status_code = 202 if payload.get("started") else 200
                self._set_json_headers(status_code)
                self.wfile.write(_json_bytes(payload))
                return

            if path == "/api/metadata/lookup/groups":
                if not isinstance(body_payload, dict):
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": "JSON object payload is required."}))
                    return
                name_raw = body_payload.get("name")
                if not isinstance(name_raw, str):
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": "name is required."}))
                    return
                try:
                    payload = metadata_add_group_provider(name_raw)
                except ValueError as exc:
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": str(exc)}))
                    return
                self._set_json_headers(200)
                self.wfile.write(_json_bytes(payload))
                return

            if path == "/api/metadata/lookup/work-types":
                if not isinstance(body_payload, dict):
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": "JSON object payload is required."}))
                    return
                name_raw = body_payload.get("name")
                if not isinstance(name_raw, str):
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": "name is required."}))
                    return
                try:
                    payload = metadata_add_work_type_provider(name_raw)
                except ValueError as exc:
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": str(exc)}))
                    return
                self._set_json_headers(200)
                self.wfile.write(_json_bytes(payload))
                return

            if path == "/api/metadata/lookup/groups/update":
                if not isinstance(body_payload, dict):
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": "JSON object payload is required."}))
                    return
                id_raw = body_payload.get("id")
                name_raw = body_payload.get("name")
                if not isinstance(id_raw, int):
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": "id is required as integer."}))
                    return
                if not isinstance(name_raw, str):
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": "name is required."}))
                    return
                try:
                    payload = metadata_update_group_provider(id_raw, name_raw)
                except ValueError as exc:
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": str(exc)}))
                    return
                self._set_json_headers(200)
                self.wfile.write(_json_bytes(payload))
                return

            if path == "/api/metadata/lookup/groups/delete":
                if not isinstance(body_payload, dict):
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": "JSON object payload is required."}))
                    return
                id_raw = body_payload.get("id")
                if not isinstance(id_raw, int):
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": "id is required as integer."}))
                    return
                try:
                    payload = metadata_delete_group_provider(id_raw)
                except ValueError as exc:
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": str(exc)}))
                    return
                self._set_json_headers(200)
                self.wfile.write(_json_bytes(payload))
                return

            if path == "/api/metadata/lookup/work-types/update":
                if not isinstance(body_payload, dict):
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": "JSON object payload is required."}))
                    return
                id_raw = body_payload.get("id")
                name_raw = body_payload.get("name")
                if not isinstance(id_raw, int):
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": "id is required as integer."}))
                    return
                if not isinstance(name_raw, str):
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": "name is required."}))
                    return
                try:
                    payload = metadata_update_work_type_provider(id_raw, name_raw)
                except ValueError as exc:
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": str(exc)}))
                    return
                self._set_json_headers(200)
                self.wfile.write(_json_bytes(payload))
                return

            if path == "/api/metadata/lookup/work-types/delete":
                if not isinstance(body_payload, dict):
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": "JSON object payload is required."}))
                    return
                id_raw = body_payload.get("id")
                if not isinstance(id_raw, int):
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": "id is required as integer."}))
                    return
                try:
                    payload = metadata_delete_work_type_provider(id_raw)
                except ValueError as exc:
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": str(exc)}))
                    return
                self._set_json_headers(200)
                self.wfile.write(_json_bytes(payload))
                return

            if path == "/api/metadata/epics":
                if not isinstance(body_payload, dict):
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": "JSON object payload is required."}))
                    return
                epic_key_raw = body_payload.get("epicKey")
                if not isinstance(epic_key_raw, str):
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": "epicKey is required."}))
                    return

                success_criteria_raw = body_payload.get("successCriteria")
                if success_criteria_raw is not None and not isinstance(success_criteria_raw, list):
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": "successCriteria must be a list of strings."}))
                    return
                group_ids_raw = body_payload.get("groupIds")
                if group_ids_raw is not None and not isinstance(group_ids_raw, list):
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": "groupIds must be a list of integers."}))
                    return
                work_type_ids_raw = body_payload.get("workTypeIds")
                if work_type_ids_raw is not None and not isinstance(work_type_ids_raw, list):
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": "workTypeIds must be a list of integers."}))
                    return

                try:
                    payload = metadata_upsert_epic_provider(
                        epic_key=epic_key_raw,
                        success_criteria=success_criteria_raw,
                        group_ids=group_ids_raw,
                        work_type_ids=work_type_ids_raw,
                    )
                except ValueError as exc:
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": str(exc)}))
                    return
                self._set_json_headers(200)
                self.wfile.write(_json_bytes(payload))
                return

            self._set_json_headers(404)
            self.wfile.write(_json_bytes({"error": "not_found"}))

        def log_message(self, fmt: str, *args: object) -> None:  # noqa: A003
            # Keep local API output quiet during normal development.
            return

    return TeamBeaconHandler


def run_server(host: str = "127.0.0.1", port: int = 8000) -> None:
    handler = build_handler()
    server = ThreadingHTTPServer((host, port), handler)
    print(f"TeamBeacon API listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run TeamBeacon local API server.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    run_server(host=args.host, port=args.port)


if __name__ == "__main__":
    main()
