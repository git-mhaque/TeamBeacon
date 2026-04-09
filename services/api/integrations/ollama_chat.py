from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from packages.connectors.jira_config import load_env_files
from packages.connectors.ollama_config import OllamaRuntimeConfig


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _request_timeout_seconds(runtime: OllamaRuntimeConfig) -> int:
    return max(runtime.connect_timeout_seconds, runtime.read_timeout_seconds)


def _http_json_request(
    *,
    url: str,
    method: str,
    payload: dict[str, Any] | None = None,
    timeout_seconds: int,
) -> dict[str, Any]:
    request_headers = {"Accept": "application/json"}
    request_body: bytes | None = None
    if payload is not None:
        request_headers["Content-Type"] = "application/json"
        request_body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

    request = Request(
        url=url,
        data=request_body,
        headers=request_headers,
        method=method,
    )

    try:
        with urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310
            raw = response.read().decode("utf-8")
    except HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", errors="replace").strip()
        except Exception:  # noqa: BLE001
            detail = ""
        detail_suffix = f": {detail[:500]}" if detail else ""
        raise RuntimeError(f"Ollama request failed with HTTP {exc.code}{detail_suffix}") from exc
    except URLError as exc:
        raise RuntimeError(f"Ollama request failed: {exc.reason}") from exc
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Ollama request failed: {exc}") from exc

    if not raw.strip():
        return {}
    try:
        decoded = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Ollama response was not valid JSON.") from exc
    if not isinstance(decoded, dict):
        raise RuntimeError("Ollama response payload must be a JSON object.")
    return decoded


def _extract_model_names(tags_payload: dict[str, Any]) -> set[str]:
    names: set[str] = set()
    rows = tags_payload.get("models")
    if not isinstance(rows, list):
        return names
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = row.get("name")
        if isinstance(name, str) and name.strip():
            names.add(name.strip())
        model = row.get("model")
        if isinstance(model, str) and model.strip():
            names.add(model.strip())
    return names


def _extract_chat_text(response_payload: dict[str, Any]) -> str:
    response_text_raw = response_payload.get("response")
    if isinstance(response_text_raw, str):
        response_text = response_text_raw.strip()
        if response_text:
            return response_text

    message_payload = response_payload.get("message")
    if isinstance(message_payload, dict):
        content_raw = message_payload.get("content")
        if isinstance(content_raw, str):
            content_text = content_raw.strip()
            if content_text:
                return content_text

    return ""


def get_ollama_status() -> dict[str, Any]:
    load_env_files()
    base_payload: dict[str, Any] = {
        "source": "ollama",
        "connected": False,
        "checkedAt": _utc_iso_now(),
        "config": {},
        "checks": [],
        "error": None,
    }

    try:
        runtime = OllamaRuntimeConfig.from_env()
    except ValueError as exc:
        base_payload["error"] = str(exc)
        base_payload["checks"].append(
            {
                "name": "configuration",
                "ok": False,
                "detail": str(exc),
            }
        )
        return base_payload

    base_payload["config"] = {
        "baseUrl": runtime.base_url,
        "modelId": runtime.model_id,
        "timeoutSeconds": {
            "connect": runtime.connect_timeout_seconds,
            "read": runtime.read_timeout_seconds,
        },
    }

    try:
        tags_payload = _http_json_request(
            url=f"{runtime.normalized_base_url}/api/tags",
            method="GET",
            timeout_seconds=_request_timeout_seconds(runtime),
        )
    except RuntimeError as exc:
        base_payload["error"] = str(exc)
        base_payload["checks"].append(
            {
                "name": "ollama_api",
                "ok": False,
                "detail": str(exc),
            }
        )
        return base_payload

    base_payload["checks"].append(
        {
            "name": "ollama_api",
            "ok": True,
            "detail": "Ollama API is reachable.",
        }
    )

    available_models = _extract_model_names(tags_payload)
    if runtime.model_id in available_models:
        base_payload["checks"].append(
            {
                "name": "configured_model",
                "ok": True,
                "detail": f"Configured model {runtime.model_id} is available.",
            }
        )
        base_payload["connected"] = True
        return base_payload

    base_payload["checks"].append(
        {
            "name": "configured_model",
            "ok": False,
            "detail": f"Configured model {runtime.model_id} was not found in local Ollama tags.",
        }
    )
    base_payload["error"] = (
        f"Configured OLLAMA_MODEL {runtime.model_id} was not found. Pull it first with `ollama pull {runtime.model_id}`."
    )
    return base_payload


def chat_with_ollama(
    *,
    message: str,
    model_id: str | None = None,
    max_tokens: int | None = None,
    temperature: float | None = None,
    top_p: float | None = None,
    top_k: int | None = None,
    frequency_penalty: float | None = None,
) -> dict[str, Any]:
    prompt = message.strip()
    if not prompt:
        raise ValueError("message is required.")

    load_env_files()
    runtime = OllamaRuntimeConfig.from_env()

    selected_model_id = model_id.strip() if isinstance(model_id, str) and model_id.strip() else runtime.model_id
    selected_max_tokens = max_tokens if max_tokens is not None else runtime.max_tokens
    selected_temperature = temperature if temperature is not None else runtime.temperature
    selected_top_p = top_p if top_p is not None else runtime.top_p
    selected_top_k = top_k if top_k is not None else runtime.top_k
    selected_repeat_penalty = (
        max(0.0, 1.0 + frequency_penalty) if frequency_penalty is not None else runtime.repeat_penalty
    )
    selected_frequency_penalty = max(0.0, selected_repeat_penalty - 1.0)
    request_options = {
        "num_ctx": runtime.num_ctx,
        "num_predict": selected_max_tokens,
        "temperature": selected_temperature,
        "top_p": selected_top_p,
        "top_k": selected_top_k,
        "repeat_penalty": selected_repeat_penalty,
    }

    response_payload = _http_json_request(
        url=f"{runtime.normalized_base_url}/api/chat",
        method="POST",
        payload={
            "model": selected_model_id,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "options": request_options,
        },
        timeout_seconds=_request_timeout_seconds(runtime),
    )

    upstream_error = response_payload.get("error")
    if isinstance(upstream_error, str) and upstream_error.strip():
        raise RuntimeError(f"Ollama chat request failed: {upstream_error.strip()}")

    response_text = _extract_chat_text(response_payload)
    if not response_text:
        fallback_payload = _http_json_request(
            url=f"{runtime.normalized_base_url}/api/generate",
            method="POST",
            payload={
                "model": selected_model_id,
                "prompt": prompt,
                "stream": False,
                "options": request_options,
            },
            timeout_seconds=_request_timeout_seconds(runtime),
        )
        fallback_error = fallback_payload.get("error")
        if isinstance(fallback_error, str) and fallback_error.strip():
            raise RuntimeError(f"Ollama chat request failed: {fallback_error.strip()}")
        response_text = _extract_chat_text(fallback_payload)

    if not response_text:
        raise RuntimeError("Ollama returned an empty response. Try increasing OLLAMA_NUM_CTX or OLLAMA_MAX_TOKENS.")

    return {
        "source": "ollama",
        "modelId": selected_model_id,
        "response": {"text": response_text},
        "request": {
            "message": prompt,
            "maxTokens": selected_max_tokens,
            "temperature": selected_temperature,
            "topP": selected_top_p,
            "topK": selected_top_k,
            "frequencyPenalty": selected_frequency_penalty,
        },
        "error": None,
    }
