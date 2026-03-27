from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from services.api.integrations.jira_sync import _ensure_schema
from services.api.issues.current_sprint_changes import get_current_sprint_changes


class CurrentSprintChangesServiceUnitTests(unittest.TestCase):
    def _init_db(self, db_path: Path) -> None:
        conn = sqlite3.connect(str(db_path))
        try:
            _ensure_schema(conn)
            conn.commit()
        finally:
            conn.close()

    def test_get_current_sprint_changes_returns_added_removed_and_blocked_groups(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"
            self._init_db(db_path)

            conn = sqlite3.connect(str(db_path))
            try:
                conn.execute(
                    """
                    INSERT INTO sprints (
                      external_sprint_id,
                      board_external_id,
                      name,
                      state,
                      start_date,
                      end_date
                    ) VALUES (77001, 27193, 'Current Sprint 45', 'active', '2026-03-20T00:00:00+00:00', '2026-03-31T00:00:00+00:00')
                    """
                )
                conn.execute(
                    """
                    INSERT INTO issues (
                      issue_key,
                      issue_id,
                      project_key,
                      issue_type,
                      summary,
                      status_name,
                      status_category
                    ) VALUES ('CEGBUPOL-9000', '9000', 'CEGBUPOL', 'Epic', 'Domain Support Q4', 'In Progress', 'In Progress')
                    """
                )
                conn.executemany(
                    """
                    INSERT INTO issues (
                      issue_key,
                      issue_id,
                      project_key,
                      issue_type,
                      summary,
                      status_name,
                      status_category,
                      story_points,
                      epic_key,
                      sprint_external_id
                    ) VALUES (?, ?, 'CEGBUPOL', 'Story', ?, ?, ?, ?, ?, 77001)
                    """,
                    [
                        ("CEGBUPOL-7001", "7001", "Blocked by dependency", "Blocked", "In Progress", 8, "CEGBUPOL-9000"),
                        ("CEGBUPOL-7002", "7002", "Waiting validation", "In Progress", "Blocked", 5, "CEGBUPOL-9000"),
                        ("CEGBUPOL-7003", "7003", "Happy path", "Done", "Done", 3, "CEGBUPOL-9000"),
                    ],
                )
                conn.executemany(
                    """
                    INSERT INTO issue_changelog (
                      issue_key,
                      history_id,
                      changed_at,
                      author_account_id,
                      field_name,
                      from_value,
                      to_value
                    ) VALUES (?, ?, ?, ?, 'sprint', ?, ?)
                    """,
                    [
                        ("CEGBUPOL-7001", "h1", "2026-03-21T10:00:00+00:00", "u1", "", "Current Sprint 45"),
                        ("CEGBUPOL-7004", "h2", "2026-03-22T10:00:00+00:00", "u1", "Current Sprint 45", "Next Sprint"),
                        ("CEGBUPOL-7005", "h3", "2026-03-19T10:00:00+00:00", "u1", "", "Current Sprint 45"),
                        (
                            "CEGBUPOL-7006",
                            "h4",
                            "2026-03-23T10:00:00+00:00",
                            "u1",
                            "Previous Sprint",
                            "Current Sprint 45, Previous Sprint",
                        ),
                        (
                            "CEGBUPOL-7007",
                            "h5",
                            "2026-03-24T10:00:00+00:00",
                            "u1",
                            "Current Sprint 45, Previous Sprint",
                            "Previous Sprint",
                        ),
                    ],
                )
                conn.commit()
            finally:
                conn.close()

            payload = get_current_sprint_changes(db_path=str(db_path))

            self.assertEqual(payload["source"], "local")
            self.assertIsNone(payload["error"])
            self.assertEqual(payload["sprint"]["id"], 77001)
            self.assertEqual(payload["changes"]["addedAfterStart"]["count"], 2)
            self.assertEqual(payload["changes"]["addedAfterStart"]["storyPointsTotal"], 8.0)
            self.assertEqual(payload["changes"]["addedAfterStart"]["issueKeys"], ["CEGBUPOL-7001", "CEGBUPOL-7006"])
            self.assertEqual(len(payload["changes"]["addedAfterStart"]["issueCards"]), 2)
            self.assertEqual(payload["changes"]["addedAfterStart"]["issueCards"][0]["issueKey"], "CEGBUPOL-7001")
            self.assertEqual(payload["changes"]["addedAfterStart"]["issueCards"][0]["summary"], "Blocked by dependency")
            self.assertEqual(payload["changes"]["addedAfterStart"]["issueCards"][0]["epicName"], "Domain Support Q4")
            self.assertEqual(payload["changes"]["addedAfterStart"]["issueCards"][0]["storyPoints"], 8.0)
            self.assertEqual(payload["changes"]["addedAfterStart"]["issueCards"][0]["status"], "Blocked")
            self.assertEqual(payload["changes"]["addedAfterStart"]["issueCards"][0]["statusCategory"], "In Progress")
            self.assertEqual(payload["changes"]["addedAfterStart"]["issueCards"][1]["issueKey"], "CEGBUPOL-7006")
            self.assertEqual(payload["changes"]["addedAfterStart"]["issueCards"][1]["summary"], "-")
            self.assertIsNone(payload["changes"]["addedAfterStart"]["issueCards"][1]["epicName"])
            self.assertIsNone(payload["changes"]["addedAfterStart"]["issueCards"][1]["storyPoints"])
            self.assertIsNone(payload["changes"]["addedAfterStart"]["issueCards"][1]["status"])
            self.assertIsNone(payload["changes"]["addedAfterStart"]["issueCards"][1]["statusCategory"])
            self.assertEqual(payload["changes"]["removedAfterStart"]["count"], 2)
            self.assertEqual(payload["changes"]["removedAfterStart"]["storyPointsTotal"], 0.0)
            self.assertEqual(payload["changes"]["removedAfterStart"]["issueKeys"], ["CEGBUPOL-7004", "CEGBUPOL-7007"])
            self.assertEqual(len(payload["changes"]["removedAfterStart"]["issueCards"]), 2)
            self.assertEqual(payload["changes"]["blockedCards"]["count"], 2)
            self.assertEqual(payload["changes"]["blockedCards"]["storyPointsTotal"], 13.0)
            self.assertEqual(payload["changes"]["blockedCards"]["issueKeys"], ["CEGBUPOL-7001", "CEGBUPOL-7002"])
            self.assertEqual(len(payload["changes"]["blockedCards"]["issueCards"]), 2)
            self.assertEqual(payload["changes"]["blockedCards"]["issueCards"][0]["issueKey"], "CEGBUPOL-7001")
            self.assertEqual(payload["changes"]["blockedCards"]["issueCards"][0]["summary"], "Blocked by dependency")
            self.assertEqual(payload["changes"]["blockedCards"]["issueCards"][0]["epicName"], "Domain Support Q4")
            self.assertEqual(payload["changes"]["blockedCards"]["issueCards"][0]["storyPoints"], 8.0)
            self.assertEqual(payload["changes"]["blockedCards"]["issueCards"][0]["status"], "Blocked")
            self.assertEqual(payload["changes"]["blockedCards"]["issueCards"][0]["statusCategory"], "In Progress")
            self.assertEqual(payload["changes"]["blockedCards"]["issueCards"][1]["issueKey"], "CEGBUPOL-7002")
            self.assertEqual(payload["changes"]["blockedCards"]["issueCards"][1]["summary"], "Waiting validation")
            self.assertEqual(payload["changes"]["blockedCards"]["issueCards"][1]["epicName"], "Domain Support Q4")
            self.assertEqual(payload["changes"]["blockedCards"]["issueCards"][1]["storyPoints"], 5.0)
            self.assertEqual(payload["changes"]["blockedCards"]["issueCards"][1]["status"], "In Progress")
            self.assertEqual(payload["changes"]["blockedCards"]["issueCards"][1]["statusCategory"], "Blocked")

            for group_key in ("addedAfterStart", "removedAfterStart", "blockedCards"):
                for card in payload["changes"][group_key]["issueCards"]:
                    self.assertIn("issueUrl", card)
                    issue_url = card["issueUrl"]
                    if issue_url is not None:
                        self.assertIn(card["issueKey"], issue_url)

    def test_get_current_sprint_changes_returns_empty_when_no_active_sprint(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"
            self._init_db(db_path)

            payload = get_current_sprint_changes(db_path=str(db_path))

            self.assertEqual(payload["source"], "local")
            self.assertIsNone(payload["sprint"])
            self.assertEqual(payload["changes"]["addedAfterStart"]["count"], 0)
            self.assertEqual(payload["changes"]["addedAfterStart"]["storyPointsTotal"], 0)
            self.assertEqual(payload["changes"]["addedAfterStart"]["issueKeys"], [])
            self.assertEqual(payload["changes"]["addedAfterStart"]["issueCards"], [])
            self.assertEqual(payload["changes"]["removedAfterStart"]["count"], 0)
            self.assertEqual(payload["changes"]["removedAfterStart"]["storyPointsTotal"], 0)
            self.assertEqual(payload["changes"]["removedAfterStart"]["issueKeys"], [])
            self.assertEqual(payload["changes"]["removedAfterStart"]["issueCards"], [])
            self.assertEqual(payload["changes"]["blockedCards"]["count"], 0)
            self.assertEqual(payload["changes"]["blockedCards"]["storyPointsTotal"], 0)
            self.assertEqual(payload["changes"]["blockedCards"]["issueKeys"], [])
            self.assertEqual(payload["changes"]["blockedCards"]["issueCards"], [])
            self.assertEqual(payload["error"], "No active sprint found in local data.")


if __name__ == "__main__":
    unittest.main()
