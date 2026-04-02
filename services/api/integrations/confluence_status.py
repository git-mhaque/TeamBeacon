from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from packages.connectors.confluence_config import ConfluenceRuntimeConfig
from packages.connectors.jira_config import load_env_files


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


def _build_space_query_url(base_url: str) -> str:
    return f"{base_url.rstrip('/')}/rest/api/space?limit=1"


def get_confluence_status() -> dict[str, Any]:
    load_env_files()
    base_payload: dict[str, Any] = {
        "source": "confluence",
        "connected": False,
        "checkedAt": _utc_iso_now(),
        "config": {},
        "checks": [],
        "metrics": {},
        "error": None,
    }

    try:
        runtime = ConfluenceRuntimeConfig.from_env()
    except ValueError as exc:
        base_payload["error"] = str(exc)
        base_payload["checks"].append(
            {
                "name": "configuration",
                "ok": False,
                "detail": "Required Confluence environment variables are missing.",
            }
        )
        return base_payload

    base_payload["config"] = {
        "baseUrl": runtime.base_url,
        "authMode": runtime.auth_mode,
        "timeoutSeconds": runtime.timeout_seconds,
    }

    url = _build_space_query_url(runtime.base_url)
    try:
        request = Request(
            url=url,
            headers={"Accept": "application/json", **_auth_headers(runtime)},
            method="GET",
        )
        with urlopen(request, timeout=runtime.timeout_seconds) as response:  # noqa: S310
            raw = response.read().decode("utf-8")
    except ValueError as exc:
        base_payload["error"] = str(exc)
        base_payload["checks"].append(
            {
                "name": "authentication",
                "ok": False,
                "detail": str(exc),
            }
        )
        return base_payload
    except HTTPError as exc:
        detail = f"Confluence request failed with HTTP {exc.code}."
        base_payload["error"] = detail
        base_payload["checks"].append(
            {
                "name": "space_query",
                "ok": False,
                "detail": detail,
            }
        )
        return base_payload
    except URLError as exc:
        detail = f"Confluence request failed: {exc.reason}"
        base_payload["error"] = detail
        base_payload["checks"].append(
            {
                "name": "space_query",
                "ok": False,
                "detail": detail,
            }
        )
        return base_payload
    except Exception as exc:  # noqa: BLE001
        detail = f"Unexpected Confluence request failure: {exc}"
        base_payload["error"] = detail
        base_payload["checks"].append(
            {
                "name": "space_query",
                "ok": False,
                "detail": detail,
            }
        )
        return base_payload

    payload: dict[str, Any] = {}
    if raw:
        try:
            decoded = json.loads(raw)
            if isinstance(decoded, dict):
                payload = decoded
        except json.JSONDecodeError:
            base_payload["checks"].append(
                {
                    "name": "space_query",
                    "ok": True,
                    "detail": "Confluence responded successfully with a non-JSON body.",
                }
            )
            base_payload["connected"] = True
            return base_payload

    spaces = payload.get("results")
    space_count = len(spaces) if isinstance(spaces, list) else 0
    base_payload["metrics"] = {"spaceCount": space_count}
    base_payload["checks"].append(
        {
            "name": "space_query",
            "ok": True,
            "detail": "Confluence space query succeeded.",
        }
    )
    base_payload["connected"] = True
    return base_payload
