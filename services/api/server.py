from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Optional
from urllib.parse import parse_qs, urlparse

from services.api.integrations.jira_status import get_jira_status
from services.api.integrations.jira_sync import (
    get_jira_sync_history,
    get_jira_sync_status,
    start_jira_sync,
)


StatusProvider = Callable[[], dict[str, Any]]
StartProvider = Callable[[Optional[str]], dict[str, Any]]
HistoryProvider = Callable[[int], dict[str, Any]]


def _json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def build_handler(
    jira_status_provider: StatusProvider = get_jira_status,
    jira_sync_status_provider: StatusProvider = get_jira_sync_status,
    jira_sync_start_provider: StartProvider = start_jira_sync,
    jira_sync_history_provider: HistoryProvider = get_jira_sync_history,
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
                if isinstance(body_payload, dict):
                    mode_raw = body_payload.get("mode")
                    mode = mode_raw if isinstance(mode_raw, str) else None
                try:
                    payload = jira_sync_start_provider(mode)
                except ValueError as exc:
                    self._set_json_headers(400)
                    self.wfile.write(_json_bytes({"error": "bad_request", "detail": str(exc)}))
                    return
                status_code = 202 if payload.get("started") else 200
                self._set_json_headers(status_code)
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
