from __future__ import annotations

from typing import Any

from packages.connectors.intelligence_config import (
    IntelligenceRuntimeConfig,
    list_supported_intelligence_providers,
    normalize_intelligence_provider,
)
from packages.connectors.jira_config import load_env_files
from services.api.integrations.oci_genai_chat import chat_with_oci_genai, get_oci_genai_status
from services.api.integrations.ollama_chat import chat_with_ollama, get_ollama_status
from services.api.integrations.openai_chat import chat_with_openai, get_openai_status


def _configured_provider() -> str:
    load_env_files()
    runtime = IntelligenceRuntimeConfig.from_env()
    return runtime.provider


def _resolve_provider(provider: str | None = None) -> str:
    if provider is not None and provider.strip():
        return normalize_intelligence_provider(provider)
    return _configured_provider()


def get_intelligence_status(*, provider: str | None = None) -> dict[str, Any]:
    configured_provider = _configured_provider()
    selected_provider = _resolve_provider(provider)

    if selected_provider == "oci":
        payload = get_oci_genai_status()
    elif selected_provider == "ollama":
        payload = get_ollama_status()
    else:
        payload = get_openai_status()

    payload["provider"] = selected_provider
    payload["configuredProvider"] = configured_provider
    payload["supportedProviders"] = list(list_supported_intelligence_providers())
    return payload


def chat_with_intelligence(
    *,
    message: str,
    provider: str | None = None,
    model_id: str | None = None,
    max_tokens: int | None = None,
    temperature: float | None = None,
    top_p: float | None = None,
    top_k: int | None = None,
    frequency_penalty: float | None = None,
) -> dict[str, Any]:
    configured_provider = _configured_provider()
    selected_provider = _resolve_provider(provider)

    if selected_provider == "oci":
        payload = chat_with_oci_genai(
            message=message,
            model_id=model_id,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            top_k=top_k,
            frequency_penalty=frequency_penalty,
        )
    elif selected_provider == "ollama":
        payload = chat_with_ollama(
            message=message,
            model_id=model_id,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            top_k=top_k,
            frequency_penalty=frequency_penalty,
        )
    else:
        payload = chat_with_openai(
            message=message,
            model_id=model_id,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            top_k=top_k,
            frequency_penalty=frequency_penalty,
        )

    payload["provider"] = selected_provider
    payload["configuredProvider"] = configured_provider
    return payload
