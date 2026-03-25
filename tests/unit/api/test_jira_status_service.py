from __future__ import annotations

import unittest
from unittest.mock import patch

from services.api.integrations.jira_status import get_jira_status


class JiraStatusServiceUnitTests(unittest.TestCase):
    def test_returns_configuration_error_when_env_missing(self) -> None:
        with patch("services.api.integrations.jira_status.load_env_files"), patch(
            "services.api.integrations.jira_status.JiraRuntimeConfig.from_env",
            side_effect=ValueError("missing required environment variables: JIRA_BASE_URL, JIRA_PAT"),
        ):
            payload = get_jira_status()

        self.assertFalse(payload["connected"])
        self.assertIn("missing required environment variables", payload["error"])
        self.assertEqual(payload["source"], "jira")
        self.assertTrue(payload["checks"])

    def test_returns_connected_payload_when_checks_succeed(self) -> None:
        class RuntimeStub:
            base_url = "https://jira.example.com"
            project_key = "CEGBUPOL"
            board_id = 27193
            story_points_field = "customfield_10004"
            auth_mode = "pat_bearer"

            def to_connector_config(self):  # noqa: D401
                return object()

        class ConnectorStub:
            def __init__(self, *args, **kwargs):  # noqa: ANN002, ANN003
                pass

            def get_boards(self):
                Board = type("Board", (), {})
                board = Board()
                board.external_board_id = 27193
                return [board]

            def search_issues(self, jql, max_results):  # noqa: ANN001
                Issue = type("Issue", (), {})
                issue = Issue()
                issue.issue_key = "CEGBUPOL-123"
                return [issue], None

        with patch("services.api.integrations.jira_status.load_env_files"), patch(
            "services.api.integrations.jira_status.JiraRuntimeConfig.from_env",
            return_value=RuntimeStub(),
        ), patch(
            "services.api.integrations.jira_status.JiraRestConnector",
            ConnectorStub,
        ):
            payload = get_jira_status()

        self.assertTrue(payload["connected"])
        self.assertEqual(payload["sampleIssueKey"], "CEGBUPOL-123")
        self.assertEqual(payload["metrics"]["boardCount"], 1)
        self.assertEqual(payload["config"]["projectKey"], "CEGBUPOL")


if __name__ == "__main__":
    unittest.main()

