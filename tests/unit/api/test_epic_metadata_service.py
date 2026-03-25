from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
import sqlite3

from services.api.metadata.epic_config import (
    add_epic_group,
    add_work_type,
    delete_epic_group,
    delete_work_type,
    get_configured_epic_summary,
    get_epic_lookup_config,
    get_epic_metadata,
    search_unconfigured_epics,
    update_epic_group,
    update_work_type,
    upsert_epic_metadata,
)


class EpicMetadataServiceUnitTests(unittest.TestCase):
    def test_lookup_config_persists_groups_and_work_types(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = str(Path(tmp_dir) / "teambeacon.db")
            group = add_epic_group("Platform", db_path=db_path)
            work_type = add_work_type("Feature", db_path=db_path)

            self.assertGreater(group["id"], 0)
            self.assertGreater(work_type["id"], 0)

            payload = get_epic_lookup_config(db_path=db_path)
            self.assertEqual(payload["groups"], [group])
            self.assertEqual(payload["workTypes"], [work_type])

    def test_upsert_epic_metadata_persists_criteria_and_refs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = str(Path(tmp_dir) / "teambeacon.db")
            group = add_epic_group("Platform", db_path=db_path)
            work_type = add_work_type("Feature", db_path=db_path)
            conn = sqlite3.connect(db_path)
            try:
                conn.execute(
                    """
                    INSERT INTO issues (issue_key, issue_id, summary, status_name)
                    VALUES (?, ?, ?, ?)
                    """,
                    ("CEGBUPOL-4482", "10001", "Unified Engineering Pulse", "To Do"),
                )
                conn.commit()
            finally:
                conn.close()

            upserted = upsert_epic_metadata(
                epic_key="cegbupol-4482",
                success_criteria=["Zero blocker defects", "No open Sev1 incidents"],
                group_ids=[group["id"]],
                work_type_ids=[work_type["id"]],
                db_path=db_path,
            )

            self.assertEqual(upserted["epicKey"], "CEGBUPOL-4482")
            self.assertIn("epicTitle", upserted)
            self.assertEqual(upserted["epicTitle"], "Unified Engineering Pulse")
            self.assertEqual(len(upserted["successCriteria"]), 2)
            self.assertEqual(upserted["groupIds"], [group["id"]])
            self.assertEqual(upserted["workTypeIds"], [work_type["id"]])

            read_payload = get_epic_metadata(epic_key="CEGBUPOL-4482", db_path=db_path)
            self.assertEqual(len(read_payload["epics"]), 1)
            self.assertEqual(read_payload["epics"][0]["epicKey"], "CEGBUPOL-4482")
            self.assertEqual(read_payload["epics"][0]["epicTitle"], "Unified Engineering Pulse")

    def test_upsert_rejects_unknown_lookup_ids(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = str(Path(tmp_dir) / "teambeacon.db")
            with self.assertRaisesRegex(ValueError, "Unknown group ids"):
                upsert_epic_metadata(
                    epic_key="CEGBUPOL-4482",
                    success_criteria=["A"],
                    group_ids=[999],
                    work_type_ids=[],
                    db_path=db_path,
                )

    def test_update_and_delete_group_and_work_type(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = str(Path(tmp_dir) / "teambeacon.db")
            group = add_epic_group("Platform", db_path=db_path)
            work_type = add_work_type("Feature", db_path=db_path)

            updated_group = update_epic_group(group["id"], "Platform Core", db_path=db_path)
            updated_work_type = update_work_type(work_type["id"], "Run", db_path=db_path)
            self.assertEqual(updated_group["name"], "Platform Core")
            self.assertEqual(updated_work_type["name"], "Run")

            group_delete = delete_epic_group(group["id"], db_path=db_path)
            work_type_delete = delete_work_type(work_type["id"], db_path=db_path)
            self.assertTrue(group_delete["deleted"])
            self.assertTrue(work_type_delete["deleted"])

            lookup = get_epic_lookup_config(db_path=db_path)
            self.assertEqual(lookup["groups"], [])
            self.assertEqual(lookup["workTypes"], [])

    def test_search_unconfigured_epics_by_key_or_name(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = str(Path(tmp_dir) / "teambeacon.db")
            conn = sqlite3.connect(db_path)
            try:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS issues (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      issue_key TEXT NOT NULL UNIQUE,
                      issue_id TEXT NOT NULL,
                      project_key TEXT,
                      issue_type TEXT,
                      summary TEXT NOT NULL,
                      status_name TEXT NOT NULL,
                      status_category TEXT,
                      priority TEXT,
                      assignee_account_id TEXT,
                      reporter_account_id TEXT,
                      story_points REAL,
                      sprint_external_id INTEGER,
                      epic_key TEXT,
                      parent_issue_key TEXT,
                      labels_json TEXT NOT NULL DEFAULT '[]',
                      components_json TEXT NOT NULL DEFAULT '[]',
                      created_at_source TEXT,
                      updated_at_source TEXT,
                      resolved_at_source TEXT,
                      raw_json TEXT NOT NULL DEFAULT '{}',
                      synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
                conn.execute(
                    """
                    INSERT INTO issues (issue_key, issue_id, issue_type, summary, status_name, updated_at_source)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    ("CEGBUPOL-5000", "5000", "Epic", "Unified Engineering Pulse", "To Do", "2026-03-25T10:00:00+00:00"),
                )
                conn.execute(
                    """
                    INSERT INTO issues (issue_key, issue_id, issue_type, summary, status_name, updated_at_source)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    ("CEGBUPOL-5001", "5001", "Epic", "Reliability Hardening", "To Do", "2026-03-25T10:00:00+00:00"),
                )
                conn.execute(
                    """
                    INSERT INTO issues (issue_key, issue_id, issue_type, summary, status_name, updated_at_source)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    ("CEGBUPOL-1234", "1234", "Story", "Non epic issue", "To Do", "2026-03-25T10:00:00+00:00"),
                )
                conn.commit()
            finally:
                conn.close()

            upsert_epic_metadata(
                epic_key="CEGBUPOL-5001",
                success_criteria=["Done"],
                group_ids=[],
                work_type_ids=[],
                db_path=db_path,
            )

            by_name = search_unconfigured_epics(query="pulse", limit=20, db_path=db_path)
            self.assertEqual(len(by_name["epics"]), 1)
            self.assertEqual(by_name["epics"][0]["epicKey"], "CEGBUPOL-5000")

            by_key = search_unconfigured_epics(query="5000", limit=20, db_path=db_path)
            self.assertEqual(len(by_key["epics"]), 1)
            self.assertEqual(by_key["epics"][0]["epicName"], "Unified Engineering Pulse")

    def test_configured_epic_summary_returns_completion_percent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = str(Path(tmp_dir) / "teambeacon.db")
            conn = sqlite3.connect(db_path)
            try:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS issues (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      issue_key TEXT NOT NULL UNIQUE,
                      issue_id TEXT NOT NULL,
                      project_key TEXT,
                      issue_type TEXT,
                      summary TEXT NOT NULL,
                      status_name TEXT NOT NULL,
                      status_category TEXT,
                      priority TEXT,
                      assignee_account_id TEXT,
                      reporter_account_id TEXT,
                      story_points REAL,
                      sprint_external_id INTEGER,
                      epic_key TEXT,
                      parent_issue_key TEXT,
                      labels_json TEXT NOT NULL DEFAULT '[]',
                      components_json TEXT NOT NULL DEFAULT '[]',
                      created_at_source TEXT,
                      updated_at_source TEXT,
                      resolved_at_source TEXT,
                      raw_json TEXT NOT NULL DEFAULT '{}',
                      synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
                conn.execute(
                    """
                    INSERT INTO issues (issue_key, issue_id, issue_type, summary, status_name, status_category)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    ("CEGBUPOL-4482", "4482", "Epic", "Enable offline initiative scoring", "In Progress", "In Progress"),
                )
                conn.execute(
                    """
                    INSERT INTO issues (issue_key, issue_id, issue_type, summary, status_name, status_category, epic_key)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    ("CEGBUPOL-101", "101", "Story", "Story done", "Done", "Done", "CEGBUPOL-4482"),
                )
                conn.execute(
                    """
                    INSERT INTO issues (issue_key, issue_id, issue_type, summary, status_name, status_category, epic_key)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    ("CEGBUPOL-102", "102", "Story", "Story in progress", "In Progress", "In Progress", "CEGBUPOL-4482"),
                )
                conn.commit()
            finally:
                conn.close()

            upsert_epic_metadata(
                epic_key="CEGBUPOL-4482",
                success_criteria=["Keep blockers at zero"],
                group_ids=[],
                work_type_ids=[],
                db_path=db_path,
            )

            payload = get_configured_epic_summary(limit=10, db_path=db_path)
            self.assertEqual(len(payload["epics"]), 1)
            self.assertEqual(payload["epics"][0]["epicKey"], "CEGBUPOL-4482")
            self.assertEqual(payload["epics"][0]["epicName"], "Enable offline initiative scoring")
            self.assertEqual(payload["epics"][0]["totalCards"], 2)
            self.assertEqual(payload["epics"][0]["completedCards"], 1)
            self.assertEqual(payload["epics"][0]["completionPercent"], 50.0)
            self.assertEqual(payload["epics"][0]["successCriteria"], ["Keep blockers at zero"])
            self.assertEqual(payload["epics"][0]["groups"], [])
            self.assertEqual(payload["epics"][0]["workTypes"], [])


if __name__ == "__main__":
    unittest.main()
