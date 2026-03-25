from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from services.api.integrations.jira_sync import _ensure_schema
from services.api.issues.query import search_synced_issues


class IssueQueryServiceUnitTests(unittest.TestCase):
    def _init_db(self, db_path: Path) -> None:
        conn = sqlite3.connect(str(db_path))
        try:
            _ensure_schema(conn)
            conn.commit()
        finally:
            conn.close()

    def test_search_by_epic_includes_epic_children_and_subtasks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"
            self._init_db(db_path)

            conn = sqlite3.connect(str(db_path))
            try:
                conn.execute(
                    """
                    INSERT INTO issues (
                      issue_key, issue_id, project_key, issue_type, summary, status_name, epic_key, updated_at_source
                    ) VALUES ('CEGBUPOL-4482', '1', 'CEGBUPOL', 'Epic', 'Epic root', 'In Progress', NULL, '2026-03-25T00:00:00+00:00')
                    """
                )
                conn.execute(
                    """
                    INSERT INTO issues (
                      issue_key, issue_id, project_key, issue_type, summary, status_name, epic_key, updated_at_source
                    ) VALUES ('CEGBUPOL-5000', '2', 'CEGBUPOL', 'Story', 'Story under epic', 'In Progress', 'CEGBUPOL-4482', '2026-03-25T01:00:00+00:00')
                    """
                )
                conn.execute(
                    """
                    INSERT INTO issues (
                      issue_key, issue_id, project_key, issue_type, summary, status_name, parent_issue_key, updated_at_source
                    ) VALUES ('CEGBUPOL-5001', '3', 'CEGBUPOL', 'Sub-task', 'Subtask under story', 'To Do', 'CEGBUPOL-5000', '2026-03-25T02:00:00+00:00')
                    """
                )
                conn.execute(
                    """
                    INSERT INTO issues (
                      issue_key, issue_id, project_key, issue_type, summary, status_name, epic_key, updated_at_source
                    ) VALUES ('CEGBUPOL-9000', '4', 'CEGBUPOL', 'Story', 'Unrelated story', 'To Do', 'CEGBUPOL-9999', '2026-03-25T03:00:00+00:00')
                    """
                )
                conn.commit()
            finally:
                conn.close()

            payload = search_synced_issues(
                epic_key="CEGBUPOL-4482",
                limit=50,
                db_path=str(db_path),
            )
            keys = {issue["issueKey"] for issue in payload["issues"]}
            self.assertEqual(payload["count"], 3)
            self.assertIn("CEGBUPOL-4482", keys)
            self.assertIn("CEGBUPOL-5000", keys)
            self.assertIn("CEGBUPOL-5001", keys)
            self.assertNotIn("CEGBUPOL-9000", keys)

    def test_worked_by_returns_same_issue_for_multiple_contributors(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"
            self._init_db(db_path)

            conn = sqlite3.connect(str(db_path))
            try:
                conn.execute(
                    """
                    INSERT INTO issues (
                      issue_key, issue_id, project_key, issue_type, summary, status_name, assignee_account_id, reporter_account_id, updated_at_source
                    ) VALUES ('CEGBUPOL-7000', '10', 'CEGBUPOL', 'Task', 'Shared work item', 'Done', 'user-dev', 'user-manager', '2026-03-25T00:00:00+00:00')
                    """
                )
                conn.executemany(
                    """
                    INSERT INTO issue_changelog (
                      issue_key, history_id, changed_at, author_account_id, field_name, from_value, to_value, raw_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            "CEGBUPOL-7000",
                            "h1",
                            "2026-03-25T01:00:00+00:00",
                            "user-dev",
                            "status",
                            "To Do",
                            "In Progress",
                            "{}",
                        ),
                        (
                            "CEGBUPOL-7000",
                            "h2",
                            "2026-03-25T02:00:00+00:00",
                            "user-qa",
                            "status",
                            "In Progress",
                            "Done",
                            "{}",
                        ),
                    ],
                )
                conn.commit()
            finally:
                conn.close()

            dev_payload = search_synced_issues(worked_by="user-dev", db_path=str(db_path))
            qa_payload = search_synced_issues(worked_by="user-qa", db_path=str(db_path))

            self.assertEqual(dev_payload["count"], 1)
            self.assertEqual(qa_payload["count"], 1)
            self.assertEqual(dev_payload["issues"][0]["issueKey"], "CEGBUPOL-7000")
            self.assertEqual(qa_payload["issues"][0]["issueKey"], "CEGBUPOL-7000")
            self.assertEqual(
                qa_payload["issues"][0]["contributors"],
                ["user-dev", "user-qa"],
            )


if __name__ == "__main__":
    unittest.main()

