from __future__ import annotations

import unittest

from packages.connectors.intelligence_config import (
    IntelligenceRuntimeConfig,
    list_supported_intelligence_providers,
    normalize_intelligence_provider,
)


class IntelligenceConfigUnitTests(unittest.TestCase):
    def test_from_env_defaults_to_oci(self) -> None:
        runtime = IntelligenceRuntimeConfig.from_env(env={})
        self.assertEqual(runtime.provider, "oci")

    def test_from_env_reads_provider_and_aliases(self) -> None:
        runtime = IntelligenceRuntimeConfig.from_env(env={"INTELLIGENCE_PROVIDER": "ollama"})
        self.assertEqual(runtime.provider, "ollama")

        alias_runtime = IntelligenceRuntimeConfig.from_env(env={"AI_PROVIDER": "oci_genai"})
        self.assertEqual(alias_runtime.provider, "oci")

    def test_normalize_rejects_unknown_provider(self) -> None:
        with self.assertRaises(ValueError):
            normalize_intelligence_provider("unknown")

    def test_supported_provider_list(self) -> None:
        providers = list_supported_intelligence_providers()
        self.assertIn("oci", providers)
        self.assertIn("ollama", providers)
        self.assertIn("openai", providers)


if __name__ == "__main__":
    unittest.main()
