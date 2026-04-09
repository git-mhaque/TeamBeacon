from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping

SUPPORTED_INTELLIGENCE_PROVIDERS: tuple[str, ...] = ("oci", "ollama", "openai")
DEFAULT_INTELLIGENCE_PROVIDER = "oci"

_PROVIDER_ALIASES: dict[str, str] = {
    "oci": "oci",
    "oci_genai": "oci",
    "oci-genai": "oci",
    "ollama": "ollama",
    "openai": "openai",
}


def normalize_intelligence_provider(value: str) -> str:
    normalized = value.strip().lower()
    mapped = _PROVIDER_ALIASES.get(normalized)
    if mapped:
        return mapped
    supported_csv = ", ".join(SUPPORTED_INTELLIGENCE_PROVIDERS)
    raise ValueError(
        f"unsupported intelligence provider: {value!r}. Supported providers: {supported_csv}."
    )


def list_supported_intelligence_providers() -> tuple[str, ...]:
    return SUPPORTED_INTELLIGENCE_PROVIDERS


@dataclass
class IntelligenceRuntimeConfig:
    provider: str = DEFAULT_INTELLIGENCE_PROVIDER

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> IntelligenceRuntimeConfig:
        source = dict(os.environ if env is None else env)
        raw_provider = source.get("INTELLIGENCE_PROVIDER", source.get("AI_PROVIDER", DEFAULT_INTELLIGENCE_PROVIDER))
        provider = normalize_intelligence_provider(raw_provider or DEFAULT_INTELLIGENCE_PROVIDER)
        return cls(provider=provider)
