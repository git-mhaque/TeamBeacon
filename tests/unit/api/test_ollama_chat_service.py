from __future__ import annotations

import unittest
from unittest.mock import patch

from packages.connectors.ollama_config import OllamaRuntimeConfig
from services.api.integrations.ollama_chat import chat_with_ollama, get_ollama_status


class OllamaChatServiceUnitTests(unittest.TestCase):
    def _runtime(self) -> OllamaRuntimeConfig:
        return OllamaRuntimeConfig(
            model_id="gemma4:e2b",
            base_url="http://127.0.0.1:11434",
            max_tokens=600,
            temperature=1.0,
            top_p=0.75,
            top_k=0,
            repeat_penalty=1.0,
            connect_timeout_seconds=10,
            read_timeout_seconds=240,
        )

    def test_status_returns_configuration_error_when_env_missing(self) -> None:
        with patch("services.api.integrations.ollama_chat.load_env_files"), patch(
            "services.api.integrations.ollama_chat.OllamaRuntimeConfig.from_env",
            side_effect=ValueError("missing required environment variable: OLLAMA_MODEL (or OLLAMA_MODEL_ID)"),
        ):
            payload = get_ollama_status()

        self.assertFalse(payload["connected"])
        self.assertEqual(payload["source"], "ollama")
        self.assertIn("OLLAMA_MODEL", payload["error"])
        self.assertTrue(payload["checks"])

    def test_status_returns_connected_when_model_is_available(self) -> None:
        with patch("services.api.integrations.ollama_chat.load_env_files"), patch(
            "services.api.integrations.ollama_chat.OllamaRuntimeConfig.from_env",
            return_value=self._runtime(),
        ), patch(
            "services.api.integrations.ollama_chat._http_json_request",
            return_value={"models": [{"name": "gemma4:e2b"}]},
        ):
            payload = get_ollama_status()

        self.assertTrue(payload["connected"])
        self.assertEqual(payload["config"]["modelId"], "gemma4:e2b")
        self.assertEqual(payload["checks"][0]["name"], "ollama_api")
        self.assertEqual(payload["checks"][1]["name"], "configured_model")
        self.assertIsNone(payload["error"])

    def test_status_returns_error_when_configured_model_missing(self) -> None:
        with patch("services.api.integrations.ollama_chat.load_env_files"), patch(
            "services.api.integrations.ollama_chat.OllamaRuntimeConfig.from_env",
            return_value=self._runtime(),
        ), patch(
            "services.api.integrations.ollama_chat._http_json_request",
            return_value={"models": [{"name": "llama3.2:3b"}]},
        ):
            payload = get_ollama_status()

        self.assertFalse(payload["connected"])
        self.assertIn("not found", str(payload["error"]).lower())

    def test_chat_calls_ollama_and_returns_text_response(self) -> None:
        runtime = self._runtime()
        with patch("services.api.integrations.ollama_chat.load_env_files"), patch(
            "services.api.integrations.ollama_chat.OllamaRuntimeConfig.from_env",
            return_value=runtime,
        ), patch(
            "services.api.integrations.ollama_chat._http_json_request",
            return_value={"response": "TeamBeacon local summary from Ollama."},
        ) as http_call:
            payload = chat_with_ollama(
                message="Summarize delivery risks for this sprint.",
                max_tokens=256,
                temperature=0.4,
                top_p=0.9,
                top_k=10,
                frequency_penalty=0.1,
            )

        self.assertEqual(payload["source"], "ollama")
        self.assertEqual(payload["modelId"], "gemma4:e2b")
        self.assertIn("TeamBeacon", payload["response"]["text"])
        self.assertEqual(payload["request"]["maxTokens"], 256)
        self.assertEqual(payload["request"]["temperature"], 0.4)
        self.assertEqual(payload["request"]["topP"], 0.9)
        self.assertEqual(payload["request"]["topK"], 10)
        self.assertAlmostEqual(payload["request"]["frequencyPenalty"], 0.1)
        self.assertTrue(http_call.called)

    def test_chat_accepts_message_content_shape(self) -> None:
        runtime = self._runtime()
        with patch("services.api.integrations.ollama_chat.load_env_files"), patch(
            "services.api.integrations.ollama_chat.OllamaRuntimeConfig.from_env",
            return_value=runtime,
        ), patch(
            "services.api.integrations.ollama_chat._http_json_request",
            return_value={"message": {"role": "assistant", "content": "Summary from chat endpoint."}},
        ):
            payload = chat_with_ollama(message="Summarize this sprint.")

        self.assertEqual(payload["response"]["text"], "Summary from chat endpoint.")

    def test_chat_retries_generate_when_chat_response_empty(self) -> None:
        runtime = self._runtime()
        with patch("services.api.integrations.ollama_chat.load_env_files"), patch(
            "services.api.integrations.ollama_chat.OllamaRuntimeConfig.from_env",
            return_value=runtime,
        ), patch(
            "services.api.integrations.ollama_chat._http_json_request",
            side_effect=[{"message": {"role": "assistant", "content": "   "}}, {"response": "Fallback response"}],
        ) as http_call:
            payload = chat_with_ollama(message="Summarize this sprint.")

        self.assertEqual(payload["response"]["text"], "Fallback response")
        self.assertEqual(http_call.call_count, 2)

    def test_chat_requires_non_empty_message(self) -> None:
        with self.assertRaises(ValueError):
            chat_with_ollama(message="   ")


if __name__ == "__main__":
    unittest.main()
