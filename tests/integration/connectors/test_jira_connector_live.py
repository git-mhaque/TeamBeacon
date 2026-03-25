from __future__ import annotations

import os
import unittest

from packages.connectors.jira_config import JiraRuntimeConfig, load_env_files
from packages.connectors.jira_rest_stub import JiraAPIError, JiraRestConnector


def _load_runtime_config_or_skip() -> JiraRuntimeConfig:
    load_env_files()
    if os.getenv("RUN_LIVE_JIRA_TESTS") != "1":
        raise unittest.SkipTest("set RUN_LIVE_JIRA_TESTS=1 to run live JIRA integration tests")
    try:
        return JiraRuntimeConfig.from_env()
    except ValueError as exc:
        raise unittest.SkipTest(f"missing JIRA integration configuration: {exc}") from exc


class JiraConnectorLiveIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.runtime = _load_runtime_config_or_skip()
        cls.connector = JiraRestConnector(
            config=cls.runtime.to_connector_config(),
            project_key=cls.runtime.project_key,
            story_points_field=cls.runtime.story_points_field,
            epic_link_field=cls.runtime.epic_link_field,
        )

    def test_search_issues_for_project(self) -> None:
        if not self.runtime.project_key:
            self.skipTest("JIRA_PROJECT_KEY not configured")
        jql = f"project = {self.runtime.project_key} ORDER BY updated DESC"
        try:
            issues, batch = self.connector.search_issues(jql=jql, max_results=5)
        except JiraAPIError as exc:
            self.fail(f"search_issues failed: {exc}")

        self.assertLessEqual(len(issues), 5)
        self.assertIn(batch.has_more, (True, False))
        if issues:
            self.assertTrue(issues[0].issue_key.startswith(f"{self.runtime.project_key}-"))

    def test_get_boards_includes_configured_board(self) -> None:
        if self.runtime.board_id is None:
            self.skipTest("JIRA_BOARD_ID not configured")
        try:
            boards = self.connector.get_boards()
        except JiraAPIError as exc:
            self.fail(f"get_boards failed: {exc}")

        board_ids = {board.external_board_id for board in boards}
        self.assertIn(self.runtime.board_id, board_ids)

    def test_get_sprints_for_configured_board(self) -> None:
        if self.runtime.board_id is None:
            self.skipTest("JIRA_BOARD_ID not configured")
        try:
            sprints = self.connector.get_sprints(self.runtime.board_id)
        except JiraAPIError as exc:
            self.fail(f"get_sprints failed: {exc}")

        self.assertIsInstance(sprints, list)
        for sprint in sprints[:3]:
            self.assertEqual(sprint.board_external_id, self.runtime.board_id)
            self.assertTrue(sprint.external_sprint_id > 0)

    def test_get_issue_changelog_for_latest_issue(self) -> None:
        if not self.runtime.project_key:
            self.skipTest("JIRA_PROJECT_KEY not configured")
        jql = f"project = {self.runtime.project_key} ORDER BY updated DESC"
        try:
            issues, _ = self.connector.search_issues(jql=jql, max_results=1)
        except JiraAPIError as exc:
            self.fail(f"search_issues for changelog setup failed: {exc}")
            return

        if not issues:
            self.skipTest("no issues found for project")

        issue_key = issues[0].issue_key
        try:
            changelog = self.connector.get_issue_changelog(issue_key)
        except JiraAPIError as exc:
            self.fail(f"get_issue_changelog failed: {exc}")
            return
        self.assertIsInstance(changelog, list)


if __name__ == "__main__":
    unittest.main()
