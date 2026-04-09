from __future__ import annotations

import unittest
from unittest.mock import patch

from services.api.integrations.intelligence_chat import chat_with_intelligence, get_intelligence_status


class IntelligenceChatServiceUnitTests(unittest.TestCase):
    def test_status_uses_configured_provider_when_override_missing(self) -> None:
        with patch(
            "services.api.integrations.intelligence_chat._configured_provider",
            return_value="ollama",
        ), patch(
            "services.api.integrations.intelligence_chat.get_ollama_status",
            return_value={"source": "ollama", "connected": True, "checks": [], "config": {}, "error": None},
        ):
            payload = get_intelligence_status()

        self.assertEqual(payload["source"], "ollama")
        self.assertEqual(payload["provider"], "ollama")
        self.assertEqual(payload["configuredProvider"], "ollama")
        self.assertIn("openai", payload["supportedProviders"])

    def test_chat_routes_to_oci_with_alias_override(self) -> None:
        with patch(
            "services.api.integrations.intelligence_chat._configured_provider",
            return_value="ollama",
        ), patch(
            "services.api.integrations.intelligence_chat.chat_with_oci_genai",
            return_value={
                "source": "oci_genai",
                "modelId": "cohere.command-r-08-2024",
                "response": {"text": "OCI response"},
                "error": None,
            },
        ) as oci_call:
            payload = chat_with_intelligence(message="hello", provider="oci_genai")

        self.assertTrue(oci_call.called)
        self.assertEqual(payload["source"], "oci_genai")
        self.assertEqual(payload["provider"], "oci")
        self.assertEqual(payload["configuredProvider"], "ollama")

    def test_chat_routes_to_configured_openai_when_override_missing(self) -> None:
        with patch(
            "services.api.integrations.intelligence_chat._configured_provider",
            return_value="openai",
        ), patch(
            "services.api.integrations.intelligence_chat.chat_with_openai",
            return_value={
                "source": "openai",
                "modelId": "gpt-4o-mini",
                "response": {"text": "OpenAI response"},
                "error": None,
            },
        ) as openai_call:
            payload = chat_with_intelligence(message="hello")

        self.assertTrue(openai_call.called)
        self.assertEqual(payload["source"], "openai")
        self.assertEqual(payload["provider"], "openai")
        self.assertEqual(payload["configuredProvider"], "openai")


if __name__ == "__main__":
    unittest.main()
