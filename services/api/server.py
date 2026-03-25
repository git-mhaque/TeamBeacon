from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable

from services.api.integrations.jira_status import get_jira_status


StatusProvider = Callable[[], dict[str, Any]]


def _json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def build_handler(jira_status_provider: StatusProvider = get_jira_status) -> type[BaseHTTPRequestHandler]:
    class TeamBeaconHandler(BaseHTTPRequestHandler):
        def _set_json_headers(self, status_code: int = 200) -> None:
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_OPTIONS(self) -> None:  # noqa: N802
            self._set_json_headers(204)
            self.wfile.write(b"")

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/health":
                self._set_json_headers(200)
                self.wfile.write(_json_bytes({"status": "ok"}))
                return

            if self.path == "/api/integrations/jira/status":
                payload = jira_status_provider()
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

