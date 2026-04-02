from __future__ import annotations

import time
import unittest

from packages.connectors.confluence_config import ConfluenceRuntimeConfig
from services.api.integrations.release_refresh import ReleaseRefreshManager, _release_text_to_html


class _ChatStub:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def __call__(self, *, message: str, **_: object) -> dict[str, object]:
        self.calls.append(message)
        if len(self.calls) <= 2:
            return {"response": {"text": f"Source summary {len(self.calls)}"}}
        return {
            "response": {
                "text": (
                    "Summary:\nRelease momentum remained stable.\n\n"
                    "Highlights:\n- Two milestones were delivered.\n"
                    "- Risk burn-down improved.\n\n"
                    "Risks:\n- One dependency remains open.\n\n"
                    "Dependencies:\n- Shared platform rollout.\n\n"
                    "Recommended Actions:\n- Track unresolved dependency daily."
                )
            }
        }


def _wait_until_finished(manager: ReleaseRefreshManager, timeout_seconds: float = 3.0) -> dict[str, object]:
    deadline = time.time() + timeout_seconds
    status = manager.get_status()
    while status.get("state") == "running" and time.time() < deadline:
        time.sleep(0.02)
        status = manager.get_status()
    return status


class ReleaseRefreshServiceUnitTests(unittest.TestCase):
    def _runtime(self) -> ConfluenceRuntimeConfig:
        return ConfluenceRuntimeConfig(
            base_url="https://gbuconfluence.oraclecorp.com",
            pat_token="token-123",
            auth_mode="pat_bearer",
        )

    def test_release_refresh_manager_completes_and_generates_html_output(self) -> None:
        chat_stub = _ChatStub()

        def page_fetcher(url: str, runtime: ConfluenceRuntimeConfig) -> dict[str, str]:
            self.assertEqual(runtime.base_url, "https://gbuconfluence.oraclecorp.com")
            return {
                "title": "Release Notes",
                "content": f"Content for {url}",
                "resolvedUrl": url,
            }

        manager = ReleaseRefreshManager(
            chat_provider=chat_stub,
            runtime_loader=self._runtime,
            page_fetcher=page_fetcher,
        )

        started = manager.start(
            sources=[
                {
                    "confluenceUrl": "https://gbuconfluence.oraclecorp.com/display/SEN/Release+One",
                    "prompt": "Summarize key release outcomes.",
                },
                {
                    "confluenceUrl": "https://gbuconfluence.oraclecorp.com/display/SEN/Release+Two",
                    "prompt": "Summarize risks and dependencies.",
                },
            ],
            overall_prompt="Build consolidated release insights for engineering leaders.",
        )
        self.assertTrue(started["started"])

        status = _wait_until_finished(manager)
        self.assertEqual(status["state"], "completed")
        self.assertEqual(status["phase"], "done")
        self.assertEqual(len(status["sources"]), 2)

        result = manager.get_result()
        self.assertEqual(result["state"], "completed")
        self.assertIsInstance(result["html"], str)
        self.assertIn("<h4>Summary</h4>", str(result["html"]))
        self.assertEqual(len(result["sources"]), 2)
        self.assertEqual(len(chat_stub.calls), 3)

    def test_release_refresh_manager_completes_with_partial_source_failure(self) -> None:
        chat_stub = _ChatStub()

        def page_fetcher(url: str, runtime: ConfluenceRuntimeConfig) -> dict[str, str]:
            _ = runtime
            if "Broken" in url:
                raise RuntimeError("Unable to read page.")
            return {
                "title": "Release Notes",
                "content": "Usable content",
                "resolvedUrl": url,
            }

        manager = ReleaseRefreshManager(
            chat_provider=chat_stub,
            runtime_loader=self._runtime,
            page_fetcher=page_fetcher,
        )

        manager.start(
            sources=[
                {
                    "confluenceUrl": "https://gbuconfluence.oraclecorp.com/display/SEN/Broken+Source",
                    "prompt": "Summarize the source.",
                },
                {
                    "confluenceUrl": "https://gbuconfluence.oraclecorp.com/display/SEN/Working+Source",
                    "prompt": "Summarize the source.",
                },
            ],
            overall_prompt="Build consolidated release insights for engineering leaders.",
        )

        status = _wait_until_finished(manager)
        self.assertEqual(status["state"], "completed")
        self.assertIn("failure", str(status["message"]).lower())

        result = manager.get_result()
        self.assertEqual(result["state"], "completed")
        failed_rows = [row for row in result["sources"] if row.get("state") == "failed"]
        success_rows = [row for row in result["sources"] if row.get("state") == "completed"]
        self.assertEqual(len(failed_rows), 1)
        self.assertEqual(len(success_rows), 1)

    def test_release_refresh_manager_fails_when_all_sources_fail(self) -> None:
        def page_fetcher(url: str, runtime: ConfluenceRuntimeConfig) -> dict[str, str]:
            _ = url
            _ = runtime
            raise RuntimeError("Confluence source unavailable.")

        manager = ReleaseRefreshManager(
            chat_provider=_ChatStub(),
            runtime_loader=self._runtime,
            page_fetcher=page_fetcher,
        )

        manager.start(
            sources=[
                {
                    "confluenceUrl": "https://gbuconfluence.oraclecorp.com/display/SEN/Broken+One",
                    "prompt": "Summarize source.",
                }
            ],
            overall_prompt="Overall prompt",
        )

        status = _wait_until_finished(manager)
        self.assertEqual(status["state"], "failed")

        result = manager.get_result()
        self.assertEqual(result["state"], "failed")
        self.assertIn("all configured sources failed", str(result["error"]).lower())

    def test_release_refresh_manager_rejects_empty_sources(self) -> None:
        manager = ReleaseRefreshManager(
            chat_provider=_ChatStub(),
            runtime_loader=self._runtime,
            page_fetcher=lambda _url, _runtime: {
                "title": "Release Notes",
                "content": "content",
                "resolvedUrl": "https://gbuconfluence.oraclecorp.com/display/SEN/Release+Notes",
            },
        )

        with self.assertRaises(ValueError):
            manager.start(sources=[], overall_prompt="Overall prompt")

    def test_release_text_to_html_builds_headings_and_lists(self) -> None:
        html_output = _release_text_to_html(
            "Summary:\nShort summary.\n\nHighlights:\n- Item one\n- Item two\n\nRecommended Actions:\n1. Action one"
        )
        self.assertIn("<h4>Summary</h4>", html_output)
        self.assertIn("<ul>", html_output)
        self.assertIn("Action one", html_output)

