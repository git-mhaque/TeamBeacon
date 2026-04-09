from __future__ import annotations

import unittest

from packages.connectors.openai_config import OpenAiRuntimeConfig


class OpenAiConfigUnitTests(unittest.TestCase):
    def test_from_env_reads_required_and_optional_values(self) -> None:
        runtime = OpenAiRuntimeConfig.from_env(
            env={
                "OPENAI_API_KEY": "sk-test",
                "OPENAI_BASE_URL": "https://api.openai.com/v1",
                "OPENAI_MODEL": "gpt-4o-mini",
                "OPENAI_MAX_TOKENS": "750",
                "OPENAI_TEMPERATURE": "0.3",
                "OPENAI_TOP_P": "0.9",
                "OPENAI_FREQUENCY_PENALTY": "0.2",
                "OPENAI_CONNECT_TIMEOUT_SECONDS": "12",
                "OPENAI_READ_TIMEOUT_SECONDS": "181",
            }
        )

        self.assertEqual(runtime.api_key, "sk-test")
        self.assertEqual(runtime.base_url, "https://api.openai.com/v1")
        self.assertEqual(runtime.model_id, "gpt-4o-mini")
        self.assertEqual(runtime.max_tokens, 750)
        self.assertEqual(runtime.temperature, 0.3)
        self.assertEqual(runtime.top_p, 0.9)
        self.assertEqual(runtime.frequency_penalty, 0.2)
        self.assertEqual(runtime.connect_timeout_seconds, 12)
        self.assertEqual(runtime.read_timeout_seconds, 181)

    def test_from_env_requires_api_key(self) -> None:
        with self.assertRaises(ValueError):
            OpenAiRuntimeConfig.from_env(env={})


if __name__ == "__main__":
    unittest.main()
