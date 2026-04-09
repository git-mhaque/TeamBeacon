from __future__ import annotations

import unittest

from packages.connectors.ollama_config import OllamaRuntimeConfig


class OllamaConfigUnitTests(unittest.TestCase):
    def test_from_env_reads_required_and_optional_values(self) -> None:
        runtime = OllamaRuntimeConfig.from_env(
            env={
                "OLLAMA_BASE_URL": "http://127.0.0.1:11434",
                "OLLAMA_MODEL": "gemma4:e2b",
                "OLLAMA_NUM_CTX": "16384",
                "OLLAMA_MAX_TOKENS": "700",
                "OLLAMA_TEMPERATURE": "0.5",
                "OLLAMA_TOP_P": "0.8",
                "OLLAMA_TOP_K": "12",
                "OLLAMA_REPEAT_PENALTY": "1.2",
                "OLLAMA_CONNECT_TIMEOUT_SECONDS": "11",
                "OLLAMA_READ_TIMEOUT_SECONDS": "180",
            }
        )

        self.assertEqual(runtime.base_url, "http://127.0.0.1:11434")
        self.assertEqual(runtime.model_id, "gemma4:e2b")
        self.assertEqual(runtime.num_ctx, 16384)
        self.assertEqual(runtime.max_tokens, 700)
        self.assertEqual(runtime.temperature, 0.5)
        self.assertEqual(runtime.top_p, 0.8)
        self.assertEqual(runtime.top_k, 12)
        self.assertEqual(runtime.repeat_penalty, 1.2)
        self.assertEqual(runtime.connect_timeout_seconds, 11)
        self.assertEqual(runtime.read_timeout_seconds, 180)

    def test_from_env_requires_model(self) -> None:
        with self.assertRaises(ValueError):
            OllamaRuntimeConfig.from_env(env={})


if __name__ == "__main__":
    unittest.main()
