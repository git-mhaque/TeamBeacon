from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from services.api.integrations.jira_sync import _ensure_schema
from services.api.issues.current_sprint_work import get_current_sprint_work


class CurrentSprintWorkServiceUnitTests(unittest.TestCase):
    def _init_db(self, db_path: Path) -> None:
        conn = sqlite3.connect(str(db_path))
        try:
            _ensure_schema(conn)
            conn.commit()
        finally:
            conn.close()

    def test_get_current_sprint_work_groups_items_by_done_in_progress_planned(self) -> None:
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
                    ) VALUES (33001, 27193, 'Current Sprint', 'active', '2026-03-20T00:00:00+00:00', '2026-03-31T00:00:00+00:00')
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
                    ) VALUES ('CEGBUPOL-9000', '9000', 'CEGBUPOL', 'Epic', 'Sprint Reliability Epic', 'In Progress', 'In Progress')
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
                    ) VALUES (?, ?, 'CEGBUPOL', 'Story', ?, ?, ?, ?, ?, 33001)
                    """,
                    [
                        ("CEGBUPOL-1001", "1001", "Implement retry policy", "Done", "Done", 8, "CEGBUPOL-9000"),
                        ("CEGBUPOL-1002", "1002", "Stabilize deployment job", "In Progress", "In Progress", 5, "CEGBUPOL-9000"),
                        ("CEGBUPOL-1003", "1003", "Finalize rollout checklist", "To Do", "To Do", 3, "CEGBUPOL-9000"),
                    ],
                )
                conn.commit()
            finally:
                conn.close()

            payload = get_current_sprint_work(db_path=str(db_path))

            self.assertEqual(payload["source"], "local")
            self.assertIsNone(payload["error"])
            self.assertEqual(payload["sprint"]["id"], 33001)
            self.assertEqual(payload["work"]["totals"]["done"], 1)
            self.assertEqual(payload["work"]["totals"]["inProgress"], 1)
            self.assertEqual(payload["work"]["totals"]["planned"], 1)
            self.assertEqual(payload["work"]["totals"]["total"], 3)
            self.assertEqual(payload["work"]["totals"]["storyPoints"]["done"], 8.0)
            self.assertEqual(payload["work"]["totals"]["storyPoints"]["inProgress"], 5.0)
            self.assertEqual(payload["work"]["totals"]["storyPoints"]["planned"], 3.0)
            self.assertEqual(payload["work"]["totals"]["storyPoints"]["total"], 16.0)
            self.assertEqual(payload["work"]["done"][0]["issueKey"], "CEGBUPOL-1001")
            self.assertEqual(payload["work"]["inProgress"][0]["issueKey"], "CEGBUPOL-1002")
            self.assertEqual(payload["work"]["planned"][0]["issueKey"], "CEGBUPOL-1003")
            self.assertEqual(payload["work"]["done"][0]["storyPoints"], 8.0)
            self.assertEqual(payload["work"]["inProgress"][0]["storyPoints"], 5.0)
            self.assertEqual(payload["work"]["planned"][0]["storyPoints"], 3.0)
            self.assertEqual(payload["work"]["done"][0]["epicKey"], "CEGBUPOL-9000")
            self.assertEqual(payload["work"]["done"][0]["epicName"], "Sprint Reliability Epic")

    def test_get_current_sprint_work_returns_empty_if_no_active_sprint(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"
            self._init_db(db_path)

            payload = get_current_sprint_work(db_path=str(db_path))
            self.assertEqual(payload["source"], "local")
            self.assertIsNone(payload["sprint"])
            self.assertEqual(payload["work"]["totals"]["total"], 0)
            self.assertEqual(payload["work"]["totals"]["storyPoints"]["total"], 0)
            self.assertEqual(payload["work"]["done"], [])
            self.assertEqual(payload["work"]["inProgress"], [])
            self.assertEqual(payload["work"]["planned"], [])
            self.assertEqual(payload["error"], "No active sprint found in local data.")

    def test_get_current_sprint_work_falls_back_to_raw_json_sprint_field(self) -> None:
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
                    ) VALUES (44001, 27193, 'Current Sprint', 'active', '2026-03-20T00:00:00+00:00', '2026-03-31T00:00:00+00:00')
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
                    ) VALUES ('CEGBUPOL-9001', '9001', 'CEGBUPOL', 'Epic', 'Fallback Epic', 'In Progress', 'In Progress')
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
                      status_category,
                      sprint_external_id,
                      story_points,
                      epic_key,
                      raw_json
                    ) VALUES (?, ?, 'CEGBUPOL', 'Story', ?, ?, ?, NULL, ?, ?, ?)
                    """,
                    (
                        "CEGBUPOL-2001",
                        "2001",
                        "Mapped from raw",
                        "In Progress",
                        "In Progress",
                        2,
                        "CEGBUPOL-9001",
                        '{"fields":{"customfield_10901":["com.atlassian.greenhopper.service.sprint.Sprint@abcd[id=44001,rapidViewId=27193,state=ACTIVE,name=Sprint 2]"]}}',
                    ),
                )
                conn.commit()
            finally:
                conn.close()

            payload = get_current_sprint_work(db_path=str(db_path))
            self.assertEqual(payload["source"], "local")
            self.assertIsNone(payload["error"])
            self.assertEqual(payload["work"]["totals"]["inProgress"], 1)
            self.assertEqual(payload["work"]["totals"]["storyPoints"]["inProgress"], 2.0)
            self.assertEqual(payload["work"]["inProgress"][0]["issueKey"], "CEGBUPOL-2001")
            self.assertEqual(payload["work"]["inProgress"][0]["storyPoints"], 2.0)
            self.assertEqual(payload["work"]["inProgress"][0]["epicKey"], "CEGBUPOL-9001")
            self.assertEqual(payload["work"]["inProgress"][0]["epicName"], "Fallback Epic")

    def test_get_current_sprint_work_orders_items_by_status_category(self) -> None:
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
                    ) VALUES (55001, 27193, 'Ordering Sprint', 'active', '2026-03-20T00:00:00+00:00', '2026-03-31T00:00:00+00:00')
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
                      sprint_external_id
                    ) VALUES (?, ?, 'CEGBUPOL', 'Task', ?, ?, ?, 55001)
                    """,
                    [
                        ("CEGBUPOL-3003", "3003", "No category", "Open", None),
                        ("CEGBUPOL-3001", "3001", "New category", "Open", "New"),
                        ("CEGBUPOL-3002", "3002", "Todo category", "Open", "To Do"),
                    ],
                )
                conn.commit()
            finally:
                conn.close()

            payload = get_current_sprint_work(db_path=str(db_path))
            planned_keys = [item["issueKey"] for item in payload["work"]["planned"]]
            self.assertEqual(planned_keys, ["CEGBUPOL-3001", "CEGBUPOL-3002", "CEGBUPOL-3003"])


if __name__ == "__main__":
    unittest.main()
