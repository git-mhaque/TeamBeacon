from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from packages.connectors.jira_config import JiraRuntimeConfig, load_env_files


class JiraConfigUnitTests(unittest.TestCase):
    def test_load_env_files_parses_key_values(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            env_path = Path(tmpdir) / ".env"
            env_path.write_text(
                "\n".join(
                    [
                        "JIRA_BASE_URL=https://jira.example.com",
                        "JIRA_PAT=token-abc",
                        "JIRA_PROJECT_KEY=TEST",
                        "JIRA_BOARD_ID=123",
                        "JIRA_STORY_POINTS_FIELD=customfield_10004",
                        "JIRA_EPIC_LINK_FIELD=customfield_10902",
                        "JIRA_SPRINT_FIELDS=customfield_10901,sprint",
                    ]
                ),
                encoding="utf-8",
            )

            # Ensure isolated behavior.
            for key in (
                "JIRA_BASE_URL",
                "JIRA_PAT",
                "JIRA_PROJECT_KEY",
                "JIRA_BOARD_ID",
                "JIRA_STORY_POINTS_FIELD",
                "JIRA_EPIC_LINK_FIELD",
                "JIRA_SPRINT_FIELDS",
            ):
                os.environ.pop(key, None)

            load_env_files(paths=[env_path], override=True)
            runtime = JiraRuntimeConfig.from_env()

            self.assertEqual(runtime.base_url, "https://jira.example.com")
            self.assertEqual(runtime.project_key, "TEST")
            self.assertEqual(runtime.board_id, 123)
            self.assertEqual(runtime.story_points_field, "customfield_10004")
            self.assertEqual(runtime.epic_link_field, "customfield_10902")
            self.assertEqual(runtime.sprint_field_candidates, ("customfield_10901", "sprint"))

    def test_from_env_requires_base_url_and_pat(self) -> None:
        with self.assertRaises(ValueError):
            JiraRuntimeConfig.from_env(env={})


if __name__ == "__main__":
    unittest.main()
