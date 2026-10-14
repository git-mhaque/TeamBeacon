from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from services.api import server


class ServerLifecycleTests(unittest.TestCase):
    def test_static_resolution_rejects_missing_roots_and_path_escape(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory).resolve()
            root = parent / "web"
            root.mkdir()
            outside = parent / "private.txt"
            outside.write_text("private", encoding="utf-8")
            self.assertIsNone(server._resolve_static_file(None, "/"))
            self.assertIsNone(server._resolve_static_file(parent / "missing", "/"))
            self.assertIsNone(server._resolve_static_file(outside, "/"))
            self.assertIsNone(server._resolve_static_file(root, "/route"))
            self.assertIsNone(server._resolve_static_file(root, "/missing.js"))
            self.assertIsNone(server._resolve_static_file(root, "/%2e%2e/private.txt"))
            (root / "index.html").symlink_to(outside)
            self.assertIsNone(server._resolve_static_file(root, "/route"))
            (root / "index.html").unlink()
            (root / "index.html").write_text("app", encoding="utf-8")
            self.assertEqual(
                server._resolve_static_file(root, "/route"), root / "index.html"
            )
            self.assertEqual(
                server._resolve_static_file(root, "/?query=1"), root / "index.html"
            )

    def test_server_closes_after_interrupt_and_reports_only_valid_published_ports(
        self,
    ) -> None:
        for port, published in (
            ("", False),
            ("8080", True),
            ("no", False),
            ("0", False),
            ("65536", False),
        ):
            with (
                self.subTest(port=port),
                patch.object(server, "ThreadingHTTPServer") as factory,
                patch.object(server, "build_handler", return_value=Mock()) as handler,
                patch.dict("os.environ", {"TEAMBEACON_HOST_PORT": port}),
                patch("builtins.print") as output,
            ):
                factory.return_value.serve_forever.side_effect = KeyboardInterrupt
                server.run_server("127.0.0.1", 8123, "/tmp/web")
                factory.assert_called_once_with(
                    ("127.0.0.1", 8123), handler.return_value
                )
                factory.return_value.server_close.assert_called_once()
                handler.assert_called_once_with(web_dir="/tmp/web")
                self.assertEqual(output.call_count, 2 if published else 1)
                if published:
                    self.assertIn("http://127.0.0.1:8080", output.call_args.args[0])

    def test_server_closes_after_unexpected_failure(self) -> None:
        with patch.object(server, "ThreadingHTTPServer") as factory:
            factory.return_value.serve_forever.side_effect = OSError("socket closed")
            with (
                self.assertRaisesRegex(OSError, "socket closed"),
                patch("builtins.print"),
            ):
                server.run_server()
            factory.return_value.server_close.assert_called_once()

    def test_cli_passes_host_port_and_static_directory(self) -> None:
        with (
            patch(
                "sys.argv",
                [
                    "server",
                    "--host",
                    "localhost",
                    "--port",
                    "8123",
                    "--web-dir",
                    "app/web",
                ],
            ),
            patch.object(server, "run_server") as run,
        ):
            server.main()
            run.assert_called_once_with(host="localhost", port=8123, web_dir="app/web")
