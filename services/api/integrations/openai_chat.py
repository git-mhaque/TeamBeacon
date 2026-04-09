from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from packages.connectors.jira_config import load_env_files
from packages.connectors.openai_config import OpenAiRuntimeConfig


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _request_timeout_seconds(runtime: OpenAiRuntimeConfig) -> int:
    return max(runtime.connect_timeout_seconds, runtime.read_timeout_seconds)


def _auth_headers(runtime: OpenAiRuntimeConfig) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {runtime.api_key}",
        "Accept": "application/json",
    }


def _http_json_request(
    *,
    runtime: OpenAiRuntimeConfig,
    path: str,
    method: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    request_headers = _auth_headers(runtime)
    request_body: bytes | None = None
    if payload is not None:
        request_headers["Content-Type"] = "application/json"
        request_body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

    request = Request(
        url=f"{runtime.normalized_base_url}/{path.lstrip('/')}",
        data=request_body,
        headers=request_headers,
        method=method,
    )

    try:
        with urlopen(request, timeout=_request_timeout_seconds(runtime)) as response:  # noqa: S310
            raw = response.read().decode("utf-8")
    except HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", errors="replace").strip()
        except Exception:  # noqa: BLE001
            detail = ""
        detail_suffix = f": {detail[:500]}" if detail else ""
        raise RuntimeError(f"OpenAI request failed with HTTP {exc.code}{detail_suffix}") from exc
    except URLError as exc:
        raise RuntimeError(f"OpenAI request failed: {exc.reason}") from exc
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"OpenAI request failed: {exc}") from exc

    if not raw.strip():
        return {}
    try:
        decoded = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("OpenAI response was not valid JSON.") from exc
    if not isinstance(decoded, dict):
        raise RuntimeError("OpenAI response payload must be a JSON object.")
    return decoded


def _extract_model_ids(payload: dict[str, Any]) -> set[str]:
    model_ids: set[str] = set()
    rows = payload.get("data")
    if not isinstance(rows, list):
        return model_ids
    for row in rows:
        if not isinstance(row, dict):
            continue
        model_id = row.get("id")
        if isinstance(model_id, str) and model_id.strip():
            model_ids.add(model_id.strip())
    return model_ids


def _extract_chat_text(payload: dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""

    message = first.get("message")
    if isinstance(message, dict):
        content = message.get("content")
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            chunks: list[str] = []
            for item in content:
                if not isinstance(item, dict):
                    continue
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    chunks.append(text.strip())
            return "\n".join(chunks).strip()
    return ""


def get_openai_status() -> dict[str, Any]:
    load_env_files()
    base_payload: dict[str, Any] = {
        "source": "openai",
        "connected": False,
        "checkedAt": _utc_iso_now(),
        "config": {},
        "checks": [],
        "error": None,
    }

    try:
        runtime = OpenAiRuntimeConfig.from_env()
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
        models_payload = _http_json_request(runtime=runtime, path="/models", method="GET")
    except RuntimeError as exc:
        base_payload["error"] = str(exc)
        base_payload["checks"].append(
            {
                "name": "openai_api",
                "ok": False,
                "detail": str(exc),
            }
        )
        return base_payload

    base_payload["checks"].append(
        {
            "name": "openai_api",
            "ok": True,
            "detail": "OpenAI API is reachable.",
        }
    )

    model_ids = _extract_model_ids(models_payload)
    if runtime.model_id in model_ids:
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
            "detail": f"Configured model {runtime.model_id} was not returned by /models.",
        }
    )
    base_payload["error"] = f"Configured OPENAI_MODEL {runtime.model_id} was not found in /models."
    return base_payload


def chat_with_openai(
    *,
    message: str,
    model_id: str | None = None,
    max_tokens: int | None = None,
    temperature: float | None = None,
    top_p: float | None = None,
    top_k: int | None = None,
    frequency_penalty: float | None = None,
) -> dict[str, Any]:
    _ = top_k
    prompt = message.strip()
    if not prompt:
        raise ValueError("message is required.")

    load_env_files()
    runtime = OpenAiRuntimeConfig.from_env()

    selected_model_id = model_id.strip() if isinstance(model_id, str) and model_id.strip() else runtime.model_id
    selected_max_tokens = max_tokens if max_tokens is not None else runtime.max_tokens
    selected_temperature = temperature if temperature is not None else runtime.temperature
    selected_top_p = top_p if top_p is not None else runtime.top_p
    selected_frequency_penalty = (
        frequency_penalty if frequency_penalty is not None else runtime.frequency_penalty
    )

    payload: dict[str, Any] = {
        "model": selected_model_id,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": selected_max_tokens,
        "temperature": selected_temperature,
        "top_p": selected_top_p,
        "frequency_penalty": selected_frequency_penalty,
    }

    response_payload = _http_json_request(
        runtime=runtime,
        path="/chat/completions",
        method="POST",
        payload=payload,
    )

    response_error = response_payload.get("error")
    if isinstance(response_error, dict):
        message_payload = response_error.get("message")
        if isinstance(message_payload, str) and message_payload.strip():
            raise RuntimeError(f"OpenAI chat request failed: {message_payload.strip()}")

    response_text = _extract_chat_text(response_payload)
    if not response_text:
        raise RuntimeError("OpenAI returned an empty response.")

    return {
        "source": "openai",
        "modelId": selected_model_id,
        "response": {"text": response_text},
        "request": {
            "message": prompt,
            "maxTokens": selected_max_tokens,
            "temperature": selected_temperature,
            "topP": selected_top_p,
            "topK": 0,
            "frequencyPenalty": selected_frequency_penalty,
        },
        "error": None,
    }
