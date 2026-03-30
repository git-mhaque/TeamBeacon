from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from packages.connectors.jira_config import load_env_files
from packages.connectors.oci_genai_config import OciGenAiRuntimeConfig


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_oci_module() -> Any:
    try:
        import oci  # type: ignore
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "OCI Python SDK is not installed. Run `python3 -m pip install oci` before using OCI GenAI endpoints."
        ) from exc
    return oci


def _read_property(payload: Any, field: str) -> Any:
    if isinstance(payload, dict):
        return payload.get(field)
    return getattr(payload, field, None)


def _extract_chat_text(chat_api_response: Any) -> str:
    response_data = _read_property(chat_api_response, "data")
    chat_response = _read_property(response_data, "chat_response")
    text = _read_property(chat_response, "text")
    if isinstance(text, str):
        return text.strip()
    return ""


def _load_oci_profile(oci_module: Any, runtime: OciGenAiRuntimeConfig) -> dict[str, Any]:
    try:
        return oci_module.config.from_file(
            runtime.expanded_config_file_path,
            runtime.config_profile,
        )
    except Exception as exc:  # noqa: BLE001
        raise ValueError(
            "Failed to load OCI config profile "
            f"{runtime.config_profile} from {runtime.config_file_path}: {exc}"
        ) from exc


def get_oci_genai_status() -> dict[str, Any]:
    load_env_files()
    base_payload: dict[str, Any] = {
        "source": "oci_genai",
        "connected": False,
        "checkedAt": _utc_iso_now(),
        "config": {},
        "checks": [],
        "error": None,
    }

    try:
        runtime = OciGenAiRuntimeConfig.from_env()
    except ValueError as exc:
        base_payload["error"] = str(exc)
        base_payload["checks"].append(
            {
                "name": "configuration",
                "ok": False,
                "detail": "Required OCI GenAI environment variables are missing.",
            }
        )
        return base_payload

    base_payload["config"] = {
        "compartmentId": runtime.compartment_id,
        "endpoint": runtime.endpoint,
        "modelId": runtime.model_id,
        "configProfile": runtime.config_profile,
        "configFile": runtime.config_file_path,
        "timeoutSeconds": {
            "connect": runtime.connect_timeout_seconds,
            "read": runtime.read_timeout_seconds,
        },
    }

    try:
        oci_module = _load_oci_module()
    except RuntimeError as exc:
        base_payload["error"] = str(exc)
        base_payload["checks"].append(
            {
                "name": "oci_sdk",
                "ok": False,
                "detail": str(exc),
            }
        )
        return base_payload

    base_payload["checks"].append(
        {
            "name": "oci_sdk",
            "ok": True,
            "detail": "OCI Python SDK is available.",
        }
    )

    try:
        _load_oci_profile(oci_module, runtime)
    except ValueError as exc:
        base_payload["error"] = str(exc)
        base_payload["checks"].append(
            {
                "name": "oci_profile",
                "ok": False,
                "detail": str(exc),
            }
        )
        return base_payload

    base_payload["checks"].append(
        {
            "name": "oci_profile",
            "ok": True,
            "detail": f"Profile {runtime.config_profile} loaded from {runtime.config_file_path}.",
        }
    )
    base_payload["connected"] = True
    return base_payload


def chat_with_oci_genai(
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
    runtime = OciGenAiRuntimeConfig.from_env()
    oci_module = _load_oci_module()
    oci_config = _load_oci_profile(oci_module, runtime)

    selected_model_id = model_id.strip() if isinstance(model_id, str) and model_id.strip() else runtime.model_id
    selected_max_tokens = max_tokens if max_tokens is not None else runtime.max_tokens
    selected_temperature = temperature if temperature is not None else runtime.temperature
    selected_top_p = top_p if top_p is not None else runtime.top_p
    selected_top_k = top_k if top_k is not None else runtime.top_k
    selected_frequency_penalty = frequency_penalty if frequency_penalty is not None else runtime.frequency_penalty

    client = oci_module.generative_ai_inference.GenerativeAiInferenceClient(
        config=oci_config,
        service_endpoint=runtime.endpoint,
        retry_strategy=oci_module.retry.NoneRetryStrategy(),
        timeout=(runtime.connect_timeout_seconds, runtime.read_timeout_seconds),
    )

    chat_detail = oci_module.generative_ai_inference.models.ChatDetails()
    chat_request = oci_module.generative_ai_inference.models.CohereChatRequest()
    chat_request.message = prompt
    chat_request.max_tokens = selected_max_tokens
    chat_request.temperature = selected_temperature
    chat_request.frequency_penalty = selected_frequency_penalty
    chat_request.top_p = selected_top_p
    chat_request.top_k = selected_top_k

    chat_detail.serving_mode = oci_module.generative_ai_inference.models.OnDemandServingMode(
        model_id=selected_model_id
    )
    chat_detail.chat_request = chat_request
    chat_detail.compartment_id = runtime.compartment_id

    try:
        chat_response = client.chat(chat_detail)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"OCI GenAI chat request failed: {exc}") from exc

    response_text = _extract_chat_text(chat_response)
    if not response_text:
        raise RuntimeError("OCI GenAI returned an empty response.")

    return {
        "source": "oci_genai",
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
