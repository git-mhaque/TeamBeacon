from __future__ import annotations

import base64
import html
import json
import re
import threading
from datetime import datetime, timezone
from typing import Any, Callable, Literal
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urlparse
from urllib.request import Request, urlopen

from packages.connectors.confluence_config import ConfluenceRuntimeConfig
from packages.connectors.jira_config import load_env_files
from services.api.integrations.oci_genai_chat import chat_with_oci_genai

ReleaseRefreshState = Literal["idle", "running", "completed", "failed"]
ReleaseSourceState = Literal["queued", "fetching", "processing", "completed", "failed"]
ChatProvider = Callable[..., dict[str, Any]]
RuntimeLoader = Callable[[], ConfluenceRuntimeConfig]
PageFetcher = Callable[[str, ConfluenceRuntimeConfig], dict[str, str]]

_MAX_SOURCE_CONTENT_CHARS = 18000
_MAX_SOURCE_SUMMARY_CHARS = 4500


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _auth_headers(runtime: ConfluenceRuntimeConfig) -> dict[str, str]:
    if runtime.auth_mode == "pat_bearer":
        return {"Authorization": f"Bearer {runtime.pat_token}"}
    if runtime.auth_mode == "basic":
        if not runtime.username:
            raise ValueError("CONFLUENCE_USERNAME is required for basic auth mode.")
        auth_blob = f"{runtime.username}:{runtime.pat_token}".encode("utf-8")
        encoded = base64.b64encode(auth_blob).decode("ascii")
        return {"Authorization": f"Basic {encoded}"}
    raise ValueError(f"unsupported CONFLUENCE_AUTH_MODE: {runtime.auth_mode}")


def _load_confluence_runtime() -> ConfluenceRuntimeConfig:
    load_env_files()
    return ConfluenceRuntimeConfig.from_env()


def _http_json_get(url: str, runtime: ConfluenceRuntimeConfig) -> dict[str, Any]:
    request = Request(
        url=url,
        headers={"Accept": "application/json", **_auth_headers(runtime)},
        method="GET",
    )
    try:
        with urlopen(request, timeout=runtime.timeout_seconds) as response:  # noqa: S310
            raw = response.read().decode("utf-8")
    except HTTPError as exc:
        raise RuntimeError(f"Confluence request failed with HTTP {exc.code}.") from exc
    except URLError as exc:
        raise RuntimeError(f"Confluence request failed: {exc.reason}") from exc
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Confluence request failed: {exc}") from exc

    if not raw.strip():
        return {}
    try:
        decoded = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Confluence response was not valid JSON.") from exc
    if not isinstance(decoded, dict):
        raise RuntimeError("Confluence response payload must be a JSON object.")
    return decoded


def _extract_page_id(parsed_url: Any) -> str | None:
    query = parse_qs(parsed_url.query)
    page_id_raw = query.get("pageId", [None])[0]
    if isinstance(page_id_raw, str):
        page_id = page_id_raw.strip()
        if page_id.isdigit():
            return page_id

    page_match = re.search(r"/pages/(\d+)(?:/|$)", parsed_url.path)
    if page_match:
        return page_match.group(1)

    return None


def _extract_display_path(parsed_url: Any) -> tuple[str, str] | None:
    parts = [segment for segment in parsed_url.path.split("/") if segment]
    if len(parts) < 3:
        return None
    if parts[0] != "display":
        return None

    space_key = parts[1].strip()
    if not space_key:
        return None

    raw_title = "/".join(parts[2:])
    decoded_title = unquote(raw_title).replace("+", " ").strip()
    if not decoded_title:
        return None
    return (space_key, decoded_title)


def _extract_storage_html(payload: dict[str, Any]) -> str:
    body = payload.get("body")
    if not isinstance(body, dict):
        return ""
    storage = body.get("storage")
    if not isinstance(storage, dict):
        return ""
    value = storage.get("value")
    if isinstance(value, str):
        return value
    return ""


def _confluence_html_to_text(raw_html: str) -> str:
    if not raw_html.strip():
        return ""
    cleaned = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw_html)
    cleaned = re.sub(r"(?i)<br\s*/?>", "\n", cleaned)
    cleaned = re.sub(r"(?i)</(p|div|h[1-6]|li|tr|td|th)>", "\n", cleaned)
    cleaned = re.sub(r"(?is)<[^>]+>", " ", cleaned)
    cleaned = html.unescape(cleaned)
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    return cleaned.strip()


def _normalize_text(value: str, limit: int) -> str:
    trimmed = value.strip()
    if len(trimmed) <= limit:
        return trimmed
    return f"{trimmed[:limit].rstrip()}\n\n[truncated]"


def _extract_response_text(payload: dict[str, Any]) -> str:
    response = payload.get("response")
    if not isinstance(response, dict):
        raise RuntimeError("OCI GenAI response payload is missing response data.")
    text = response.get("text")
    if not isinstance(text, str) or not text.strip():
        raise RuntimeError("OCI GenAI returned an empty response.")
    return text.strip()


def _source_summary_prompt(source: dict[str, str], page_payload: dict[str, str]) -> str:
    source_prompt = source.get("prompt", "").strip()
    user_goal = source_prompt or "Extract the most relevant release insights from this source."
    page_content = _normalize_text(page_payload.get("content", ""), _MAX_SOURCE_CONTENT_CHARS)
    return "\n".join(
        [
            "You are preparing source-level release insights for TeamBeacon.",
            "Focus on factual updates, shipped outcomes, risks, and dependencies from the page content.",
            "Return concise plain text in at most 8 short bullets.",
            "",
            f"Source URL: {page_payload.get('resolvedUrl', source.get('confluenceUrl', ''))}",
            f"Source title: {page_payload.get('title', 'Untitled')}",
            f"Extraction goal: {user_goal}",
            "",
            "Confluence page content:",
            page_content,
        ]
    ).strip()


def _overall_summary_prompt(
    source_rows: list[dict[str, Any]],
    overall_prompt: str,
) -> str:
    prompt_goal = overall_prompt.strip() or "Create a crisp release insights dashboard update for engineering leaders."
    source_lines: list[str] = []
    for index, row in enumerate(source_rows, start=1):
        summary = _normalize_text(str(row.get("summary", "")), _MAX_SOURCE_SUMMARY_CHARS)
        source_lines.extend(
            [
                f"Source {index} title: {row.get('title', f'Source {index}')}",
                f"Source {index} URL: {row.get('confluenceUrl', '')}",
                f"Source {index} summary:",
                summary,
                "",
            ]
        )

    return "\n".join(
        [
            "You are producing a release-insights dashboard narrative from multiple source summaries.",
            "Use only the provided source summaries.",
            "Return plain text only with exactly these sections:",
            "Summary:",
            "Highlights:",
            "Risks:",
            "Dependencies:",
            "Recommended Actions:",
            "Each section should be concise and useful for engineering leadership review.",
            "",
            f"Overall objective: {prompt_goal}",
            "",
            "Source summaries:",
            *source_lines,
        ]
    ).strip()


def _release_text_to_html(plain_text: str) -> str:
    if not plain_text.strip():
        return "<p>No release insights generated.</p>"

    parts: list[str] = []
    paragraph_lines: list[str] = []
    list_items: list[str] = []

    def flush_paragraph() -> None:
        if not paragraph_lines:
            return
        escaped = html.escape(" ".join(paragraph_lines).strip())
        if escaped:
            parts.append(f"<p>{escaped}</p>")
        paragraph_lines.clear()

    def flush_list() -> None:
        if not list_items:
            return
        items_html = "".join(f"<li>{item}</li>" for item in list_items)
        parts.append(f"<ul>{items_html}</ul>")
        list_items.clear()

    heading_pattern = re.compile(r"^([A-Za-z][A-Za-z0-9 /&()\-]{1,90}):$")
    bullet_pattern = re.compile(r"^(?:[-*]|\d+\.)\s+(.*)$")

    for raw_line in plain_text.splitlines():
        line = raw_line.strip()
        if not line:
            flush_paragraph()
            flush_list()
            continue

        heading_match = heading_pattern.match(line)
        if heading_match:
            flush_paragraph()
            flush_list()
            heading_text = html.escape(heading_match.group(1).strip())
            parts.append(f"<h4>{heading_text}</h4>")
            continue

        bullet_match = bullet_pattern.match(line)
        if bullet_match:
            flush_paragraph()
            bullet_text = html.escape(bullet_match.group(1).strip())
            if bullet_text:
                list_items.append(bullet_text)
            continue

        flush_list()
        paragraph_lines.append(line)

    flush_paragraph()
    flush_list()

    if not parts:
        escaped = html.escape(plain_text.strip())
        return f"<p>{escaped}</p>"

    return "".join(parts)


def _validate_confluence_url_host(source_url: str, runtime: ConfluenceRuntimeConfig) -> None:
    parsed_source = urlparse(source_url)
    parsed_base = urlparse(runtime.base_url)
    if not parsed_source.netloc:
        raise ValueError("Confluence source URL must include a hostname.")
    if parsed_base.netloc and parsed_source.netloc.lower() != parsed_base.netloc.lower():
        raise ValueError(
            f"Confluence URL host mismatch. Expected {parsed_base.netloc}, received {parsed_source.netloc}."
        )


def _resolve_page_by_id(page_id: str, runtime: ConfluenceRuntimeConfig) -> dict[str, Any]:
    url = f"{runtime.base_url.rstrip('/')}/rest/api/content/{quote(page_id)}?expand=body.storage,_links"
    payload = _http_json_get(url, runtime)
    if not payload:
        raise RuntimeError(f"Confluence page {page_id} returned an empty payload.")
    return payload


def _resolve_page_by_display(space_key: str, title: str, runtime: ConfluenceRuntimeConfig) -> dict[str, Any]:
    query_url = (
        f"{runtime.base_url.rstrip('/')}/rest/api/content"
        f"?spaceKey={quote(space_key)}"
        f"&title={quote(title)}"
        "&expand=body.storage,_links"
        "&limit=1"
    )
    payload = _http_json_get(query_url, runtime)
    results = payload.get("results")
    if not isinstance(results, list) or not results:
        raise RuntimeError("Confluence page could not be resolved from display URL.")
    first = results[0]
    if not isinstance(first, dict):
        raise RuntimeError("Confluence page response format was unexpected.")
    return first


def fetch_release_source_page(url: str, runtime: ConfluenceRuntimeConfig) -> dict[str, str]:
    source_url = url.strip()
    if not source_url:
        raise ValueError("Confluence source URL is required.")

    _validate_confluence_url_host(source_url, runtime)
    parsed = urlparse(source_url)
    page_id = _extract_page_id(parsed)
    payload: dict[str, Any]
    if page_id:
        payload = _resolve_page_by_id(page_id, runtime)
    else:
        display_ref = _extract_display_path(parsed)
        if display_ref is None:
            raise ValueError(
                "Unsupported Confluence URL format. Use URLs containing pageId=..., /pages/<id>/..., or /display/<SPACE>/<Title>."
            )
        payload = _resolve_page_by_display(display_ref[0], display_ref[1], runtime)

    title_raw = payload.get("title")
    title = title_raw.strip() if isinstance(title_raw, str) and title_raw.strip() else "Untitled Confluence page"

    storage_html = _extract_storage_html(payload)
    text_content = _confluence_html_to_text(storage_html)
    if not text_content:
        raise RuntimeError(f"No readable content found for page {title}.")

    links = payload.get("_links")
    web_path = ""
    base_path = ""
    if isinstance(links, dict):
        web_path_raw = links.get("webui")
        if isinstance(web_path_raw, str):
            web_path = web_path_raw.strip()
        base_path_raw = links.get("base")
        if isinstance(base_path_raw, str):
            base_path = base_path_raw.strip()

    resolved_url = source_url
    if base_path and web_path:
        resolved_url = f"{base_path.rstrip('/')}/{web_path.lstrip('/')}"
    elif web_path:
        resolved_url = f"{runtime.base_url.rstrip('/')}/{web_path.lstrip('/')}"

    return {
        "title": title,
        "content": text_content,
        "resolvedUrl": resolved_url,
    }


class ReleaseRefreshManager:
    def __init__(
        self,
        *,
        chat_provider: ChatProvider = chat_with_oci_genai,
        runtime_loader: RuntimeLoader = _load_confluence_runtime,
        page_fetcher: PageFetcher = fetch_release_source_page,
    ) -> None:
        self._chat_provider = chat_provider
        self._runtime_loader = runtime_loader
        self._page_fetcher = page_fetcher
        self._lock = threading.Lock()
        self._state: dict[str, Any] = self._new_idle_state()
        self._result: dict[str, Any] = self._new_idle_result()

    def _new_idle_state(self) -> dict[str, Any]:
        return {
            "source": "releases",
            "state": "idle",
            "phase": "idle",
            "percent": None,
            "message": "Idle",
            "startedAt": None,
            "finishedAt": None,
            "generatedAt": None,
            "error": None,
            "sources": [],
        }

    def _new_idle_result(self) -> dict[str, Any]:
        return {
            "source": "releases",
            "state": "idle",
            "generatedAt": None,
            "html": None,
            "text": None,
            "sources": [],
            "error": None,
        }

    def _snapshot_state(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._state)

    def _snapshot_result(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._result)

    def _set_source_state(
        self,
        source_id: int,
        *,
        state: ReleaseSourceState,
        message: str,
        percent: float,
        error: str | None = None,
    ) -> None:
        with self._lock:
            rows = self._state.get("sources")
            if not isinstance(rows, list):
                return
            for row in rows:
                if not isinstance(row, dict):
                    continue
                if int(row.get("id", -1)) != source_id:
                    continue
                row["state"] = state
                row["message"] = message
                row["percent"] = percent
                row["error"] = error
                break

    def _set_progress(self, *, phase: str, percent: float | None, message: str) -> None:
        with self._lock:
            self._state["phase"] = phase
            self._state["percent"] = percent
            self._state["message"] = message
            self._state["state"] = "running"
            self._state["error"] = None

    def _complete(self, state: ReleaseRefreshState, *, message: str, error: str | None = None) -> None:
        finished_at = _utc_iso_now()
        with self._lock:
            self._state["state"] = state
            self._state["phase"] = "done" if state == "completed" else "failed"
            self._state["percent"] = 100.0 if state == "completed" else self._state.get("percent")
            self._state["message"] = message
            self._state["finishedAt"] = finished_at
            self._state["generatedAt"] = finished_at if state == "completed" else None
            self._state["error"] = error

    def _normalize_sources(self, sources: list[dict[str, Any]] | None) -> list[dict[str, str | int]]:
        if not isinstance(sources, list):
            raise ValueError("sources must be an array.")

        normalized: list[dict[str, str | int]] = []
        for index, item in enumerate(sources, start=1):
            if not isinstance(item, dict):
                raise ValueError("Each source must be an object.")

            confluence_url_raw = item.get("confluenceUrl", item.get("url"))
            prompt_raw = item.get("prompt")
            confluence_url = confluence_url_raw.strip() if isinstance(confluence_url_raw, str) else ""
            prompt = prompt_raw.strip() if isinstance(prompt_raw, str) else ""

            if not confluence_url:
                continue
            normalized.append(
                {
                    "id": index,
                    "confluenceUrl": confluence_url,
                    "prompt": prompt,
                }
            )

        if not normalized:
            raise ValueError("At least one source with confluenceUrl is required.")
        return normalized

    def get_status(self) -> dict[str, Any]:
        return self._snapshot_state()

    def get_result(self) -> dict[str, Any]:
        return self._snapshot_result()

    def start(
        self,
        *,
        sources: list[dict[str, Any]] | None,
        overall_prompt: str | None = None,
    ) -> dict[str, Any]:
        normalized_sources = self._normalize_sources(sources)
        normalized_overall_prompt = overall_prompt.strip() if isinstance(overall_prompt, str) else ""

        with self._lock:
            if self._state.get("state") == "running":
                snapshot = dict(self._state)
                snapshot["started"] = False
                return snapshot

            started_at = _utc_iso_now()
            source_rows = [
                {
                    "id": int(source["id"]),
                    "confluenceUrl": str(source["confluenceUrl"]),
                    "prompt": str(source["prompt"]),
                    "state": "queued",
                    "percent": 0.0,
                    "message": "Queued",
                    "error": None,
                }
                for source in normalized_sources
            ]
            self._state = {
                "source": "releases",
                "state": "running",
                "phase": "initializing",
                "percent": 0.0,
                "message": "Starting release refresh.",
                "startedAt": started_at,
                "finishedAt": None,
                "generatedAt": None,
                "error": None,
                "sources": source_rows,
            }
            self._result = {
                "source": "releases",
                "state": "running",
                "generatedAt": None,
                "html": None,
                "text": None,
                "sources": source_rows,
                "error": None,
            }

        thread = threading.Thread(
            target=self._run_background,
            args=(normalized_sources, normalized_overall_prompt),
            daemon=True,
        )
        thread.start()

        snapshot = self._snapshot_state()
        snapshot["started"] = True
        return snapshot

    def _run_background(
        self,
        sources: list[dict[str, str | int]],
        overall_prompt: str,
    ) -> None:
        total_steps = (len(sources) * 2) + 1
        completed_steps = 0
        source_results: list[dict[str, Any]] = []
        failed_sources = 0

        def update_overall(phase: str, message: str) -> None:
            percent = round((completed_steps / total_steps) * 100, 2) if total_steps > 0 else None
            self._set_progress(phase=phase, percent=percent, message=message)

        try:
            runtime = self._runtime_loader()
            update_overall("initializing", "Release refresh is running.")

            for index, source in enumerate(sources, start=1):
                source_id = int(source["id"])
                source_url = str(source["confluenceUrl"])
                source_prompt = str(source.get("prompt", ""))

                self._set_source_state(
                    source_id,
                    state="fetching",
                    message=f"Fetching source {index}.",
                    percent=15.0,
                )
                update_overall("fetching_sources", f"Fetching source {index} of {len(sources)}.")

                try:
                    page_payload = self._page_fetcher(source_url, runtime)
                    completed_steps += 1
                    update_overall("processing_sources", f"Processing source {index} of {len(sources)}.")
                    self._set_source_state(
                        source_id,
                        state="processing",
                        message=f"Generating summary for source {index}.",
                        percent=60.0,
                    )

                    source_prompt_payload = _source_summary_prompt(
                        {"confluenceUrl": source_url, "prompt": source_prompt},
                        page_payload,
                    )
                    source_summary_response = self._chat_provider(message=source_prompt_payload)
                    source_summary_text = _extract_response_text(source_summary_response)
                    completed_steps += 1

                    source_row = {
                        "id": source_id,
                        "confluenceUrl": source_url,
                        "title": page_payload.get("title"),
                        "resolvedUrl": page_payload.get("resolvedUrl"),
                        "summary": source_summary_text,
                        "state": "completed",
                        "error": None,
                    }
                    source_results.append(source_row)
                    self._set_source_state(
                        source_id,
                        state="completed",
                        message="Completed.",
                        percent=100.0,
                    )
                    update_overall("processing_sources", f"Processed source {index} of {len(sources)}.")
                except Exception as source_exc:  # noqa: BLE001
                    failed_sources += 1
                    source_results.append(
                        {
                            "id": source_id,
                            "confluenceUrl": source_url,
                            "title": None,
                            "resolvedUrl": source_url,
                            "summary": None,
                            "state": "failed",
                            "error": str(source_exc),
                        }
                    )
                    self._set_source_state(
                        source_id,
                        state="failed",
                        message="Source failed.",
                        percent=100.0,
                        error=str(source_exc),
                    )
                    completed_steps += 2
                    update_overall(
                        "processing_sources",
                        f"Source {index} failed. Continuing with remaining sources.",
                    )

            completed_source_rows = [row for row in source_results if row.get("state") == "completed"]
            if not completed_source_rows:
                raise RuntimeError("Unable to generate release insights because all configured sources failed.")

            update_overall("combining", "Generating final release insights output.")
            overall_prompt_payload = _overall_summary_prompt(completed_source_rows, overall_prompt)
            final_response = self._chat_provider(message=overall_prompt_payload)
            final_text = _extract_response_text(final_response)
            final_html = _release_text_to_html(final_text)
            completed_steps += 1
            completed_at = _utc_iso_now()

            state_message = "Release refresh complete."
            if failed_sources > 0:
                state_message = f"Release refresh complete with {failed_sources} source failure(s)."

            with self._lock:
                self._result = {
                    "source": "releases",
                    "state": "completed",
                    "generatedAt": completed_at,
                    "html": final_html,
                    "text": final_text,
                    "sources": source_results,
                    "error": None,
                }

            self._complete("completed", message=state_message)
            with self._lock:
                self._state["generatedAt"] = completed_at
                self._state["percent"] = 100.0
        except Exception as exc:  # noqa: BLE001
            with self._lock:
                self._result = {
                    "source": "releases",
                    "state": "failed",
                    "generatedAt": None,
                    "html": None,
                    "text": None,
                    "sources": source_results,
                    "error": str(exc),
                }
            self._complete("failed", message="Release refresh failed.", error=str(exc))


RELEASE_REFRESH_MANAGER = ReleaseRefreshManager()


def get_release_refresh_status() -> dict[str, Any]:
    return RELEASE_REFRESH_MANAGER.get_status()


def get_release_refresh_result() -> dict[str, Any]:
    return RELEASE_REFRESH_MANAGER.get_result()


def start_release_refresh(
    sources: list[dict[str, Any]] | None = None,
    overall_prompt: str | None = None,
) -> dict[str, Any]:
    return RELEASE_REFRESH_MANAGER.start(sources=sources, overall_prompt=overall_prompt)
