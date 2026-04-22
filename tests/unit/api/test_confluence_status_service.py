from __future__ import annotations

import json
import unittest
from urllib.error import HTTPError
from unittest.mock import patch

from services.api.integrations.confluence_status import get_confluence_status


class _RuntimeStub:
    base_url = "https://confluence.example.com"
    pat_token = "pat-token"
    auth_mode = "pat_bearer"
    username = None
    timeout_seconds = 30


class _ResponseStub:
    def __init__(self, body: str) -> None:
        self._body = body

    def read(self) -> bytes:
        return self._body.encode("utf-8")

    def __enter__(self) -> _ResponseStub:
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> bool:  # noqa: ANN001, ANN201
        _ = exc_type, exc_val, exc_tb
        return False


class ConfluenceStatusServiceUnitTests(unittest.TestCase):
    def test_returns_configuration_error_when_env_missing(self) -> None:
        with patch("services.api.integrations.confluence_status.load_env_files"), patch(
            "services.api.integrations.confluence_status.ConfluenceRuntimeConfig.from_env",
            side_effect=ValueError("missing required environment variables: CONFLUENCE_BASE_URL, CONFLUENCE_PAT"),
        ):
            payload = get_confluence_status()

        self.assertFalse(payload["connected"])
        self.assertEqual(payload["source"], "confluence")
        self.assertIn("missing required environment variables", payload["error"])
        self.assertTrue(payload["checks"])

    def test_returns_connected_payload_when_current_user_and_space_query_succeed(self) -> None:
        current_user_payload = json.dumps({"username": "teambeacon-bot", "displayName": "TeamBeacon Bot"})
        space_payload = json.dumps({"results": [{"key": "ENG"}]})

        with patch("services.api.integrations.confluence_status.load_env_files"), patch(
            "services.api.integrations.confluence_status.ConfluenceRuntimeConfig.from_env",
            return_value=_RuntimeStub(),
        ), patch(
            "services.api.integrations.confluence_status.urlopen",
            side_effect=[_ResponseStub(current_user_payload), _ResponseStub(space_payload)],
        ):
            payload = get_confluence_status()

        self.assertTrue(payload["connected"])
        self.assertEqual(payload["config"]["baseUrl"], "https://confluence.example.com")
        self.assertEqual(payload["checks"][0]["name"], "current_user")
        self.assertTrue(payload["checks"][0]["ok"])
        self.assertEqual(payload["checks"][1]["name"], "space_query")
        self.assertTrue(payload["checks"][1]["ok"])
        self.assertEqual(payload["metrics"]["spaceCount"], 1)
        self.assertEqual(payload["metrics"]["authenticatedUser"], "teambeacon-bot")
        self.assertIsNone(payload["error"])

    def test_returns_error_when_current_user_is_anonymous(self) -> None:
        current_user_payload = json.dumps({"type": "anonymous", "username": "anonymous"})
        forced_auth_unauthorized = HTTPError(
            url="https://confluence.example.com/rest/api/user/current?os_authType=basic",
            code=401,
            msg="Unauthorized",
            hdrs=None,
            fp=None,
        )

        with patch("services.api.integrations.confluence_status.load_env_files"), patch(
            "services.api.integrations.confluence_status.ConfluenceRuntimeConfig.from_env",
            return_value=_RuntimeStub(),
        ), patch(
            "services.api.integrations.confluence_status.urlopen",
            side_effect=[_ResponseStub(current_user_payload), forced_auth_unauthorized],
        ) as open_call:
            payload = get_confluence_status()

        self.assertFalse(payload["connected"])
        self.assertEqual(open_call.call_count, 2)
        self.assertEqual(payload["checks"][0]["name"], "current_user")
        self.assertFalse(payload["checks"][0]["ok"])
        self.assertIn("credentials were rejected", str(payload["error"]).lower())

    def test_returns_error_when_current_user_request_is_unauthorized(self) -> None:
        unauthorized = HTTPError(
            url="https://confluence.example.com/rest/api/user/current",
            code=401,
            msg="Unauthorized",
            hdrs=None,
            fp=None,
        )
        with patch("services.api.integrations.confluence_status.load_env_files"), patch(
            "services.api.integrations.confluence_status.ConfluenceRuntimeConfig.from_env",
            return_value=_RuntimeStub(),
        ), patch(
            "services.api.integrations.confluence_status.urlopen",
            side_effect=unauthorized,
        ):
            payload = get_confluence_status()

        self.assertFalse(payload["connected"])
        self.assertEqual(payload["checks"][0]["name"], "current_user")
        self.assertFalse(payload["checks"][0]["ok"])
        self.assertIn("401", str(payload["error"]))


if __name__ == "__main__":
    unittest.main()
