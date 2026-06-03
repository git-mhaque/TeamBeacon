from __future__ import annotations

from datetime import datetime, timedelta, timezone
import tempfile
import unittest
from pathlib import Path
import sqlite3

from services.api.metadata.epic_config import (
    add_epic_group,
    add_work_type,
    create_initiative_view,
    delete_epic_metadata,
    delete_epic_group,
    delete_initiative_view,
    delete_work_type,
    get_configured_epics_completed_cards,
    get_epic_completed_cards,
    get_configured_epic_summary,
    get_epic_lookup_config,
    get_epic_metadata,
    get_initiative_views,
    search_unconfigured_epics,
    update_epic_group,
    update_initiative_view,
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
            self.assertFalse(upserted["timelineEnabled"])
            self.assertIsNone(upserted["timelineStartDate"])
            self.assertIsNone(upserted["targetCompletionDate"])
            self.assertEqual(upserted["groupIds"], [group["id"]])
            self.assertEqual(upserted["workTypeIds"], [work_type["id"]])

            read_payload = get_epic_metadata(epic_key="CEGBUPOL-4482", db_path=db_path)
            self.assertEqual(len(read_payload["epics"]), 1)
            self.assertEqual(read_payload["epics"][0]["epicKey"], "CEGBUPOL-4482")
            self.assertEqual(read_payload["epics"][0]["epicTitle"], "Unified Engineering Pulse")
            self.assertFalse(read_payload["epics"][0]["timelineEnabled"])
            self.assertIsNone(read_payload["epics"][0]["timelineStartDate"])
            self.assertIsNone(read_payload["epics"][0]["targetCompletionDate"])

    def test_upsert_epic_metadata_persists_timeline_date(self) -> None:
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
                    INSERT INTO issues (issue_key, issue_id, summary, status_name)
                    VALUES (?, ?, ?, ?)
                    """,
                    ("CEGBUPOL-3553", "3553", "Domain Support Q4", "To Do"),
                )
                conn.commit()
            finally:
                conn.close()

            upserted = upsert_epic_metadata(
                epic_key="CEGBUPOL-3553",
                success_criteria=["Complete domain support cards"],
                timeline_enabled=True,
                timeline_start_date="2026-04-01",
                target_completion_date="2026-05-15",
                group_ids=[],
                work_type_ids=[],
                db_path=db_path,
            )
            self.assertTrue(upserted["timelineEnabled"])
            self.assertEqual(upserted["timelineStartDate"], "2026-04-01")
            self.assertEqual(upserted["targetCompletionDate"], "2026-05-15")

            payload = get_configured_epic_summary(limit=10, db_path=db_path)
            self.assertEqual(len(payload["epics"]), 1)
            self.assertTrue(payload["epics"][0]["timelineEnabled"])
            self.assertEqual(payload["epics"][0]["timelineStartDate"], "2026-04-01")
            self.assertEqual(payload["epics"][0]["targetCompletionDate"], "2026-05-15")

            updated = upsert_epic_metadata(
                epic_key="CEGBUPOL-3553",
                success_criteria=["Complete domain support cards"],
                timeline_enabled=False,
                timeline_start_date=None,
                target_completion_date=None,
                group_ids=[],
                work_type_ids=[],
                db_path=db_path,
            )
            self.assertFalse(updated["timelineEnabled"])
            self.assertIsNone(updated["timelineStartDate"])
            self.assertIsNone(updated["targetCompletionDate"])

    def test_upsert_timeline_rejects_missing_or_invalid_target_completion_date(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = str(Path(tmp_dir) / "teambeacon.db")
            with self.assertRaisesRegex(ValueError, "required when timelineEnabled is true"):
                upsert_epic_metadata(
                    epic_key="CEGBUPOL-3553",
                    success_criteria=["A"],
                    timeline_enabled=True,
                    target_completion_date=None,
                    group_ids=[],
                    work_type_ids=[],
                    db_path=db_path,
                )
            with self.assertRaisesRegex(ValueError, "valid ISO date"):
                upsert_epic_metadata(
                    epic_key="CEGBUPOL-3553",
                    success_criteria=["A"],
                    timeline_enabled=True,
                    target_completion_date="2026-99-99",
                    group_ids=[],
                    work_type_ids=[],
                    db_path=db_path,
                )
            with self.assertRaisesRegex(ValueError, "timelineStartDate must be a valid ISO date"):
                upsert_epic_metadata(
                    epic_key="CEGBUPOL-3553",
                    success_criteria=["A"],
                    timeline_enabled=True,
                    timeline_start_date="2026-14-01",
                    target_completion_date="2026-12-01",
                    group_ids=[],
                    work_type_ids=[],
                    db_path=db_path,
                )
            with self.assertRaisesRegex(ValueError, "cannot be after"):
                upsert_epic_metadata(
                    epic_key="CEGBUPOL-3553",
                    success_criteria=["A"],
                    timeline_enabled=True,
                    timeline_start_date="2026-12-02",
                    target_completion_date="2026-12-01",
                    group_ids=[],
                    work_type_ids=[],
                    db_path=db_path,
                )

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

    def test_upsert_rejects_multiple_group_or_work_type_ids(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = str(Path(tmp_dir) / "teambeacon.db")
            group_a = add_epic_group("Platform", db_path=db_path)
            group_b = add_epic_group("Security", db_path=db_path)
            type_a = add_work_type("Feature", db_path=db_path)
            type_b = add_work_type("Run", db_path=db_path)

            with self.assertRaisesRegex(ValueError, "groupIds can contain at most 1 id"):
                upsert_epic_metadata(
                    epic_key="CEGBUPOL-4482",
                    success_criteria=["A"],
                    group_ids=[group_a["id"], group_b["id"]],
                    work_type_ids=[type_a["id"]],
                    db_path=db_path,
                )
            with self.assertRaisesRegex(ValueError, "workTypeIds can contain at most 1 id"):
                upsert_epic_metadata(
                    epic_key="CEGBUPOL-4482",
                    success_criteria=["A"],
                    group_ids=[group_a["id"]],
                    work_type_ids=[type_a["id"], type_b["id"]],
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

    def test_delete_epic_metadata_removes_configuration(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = str(Path(tmp_dir) / "teambeacon.db")
            group = add_epic_group("Platform", db_path=db_path)
            work_type = add_work_type("Feature", db_path=db_path)
            conn = sqlite3.connect(db_path)
            try:
                conn.execute(
                    """
                    INSERT INTO issues (issue_key, issue_id, summary, issue_type, status_name)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    ("CEGBUPOL-4482", "10001", "Unified Engineering Pulse", "Epic", "To Do"),
                )
                conn.commit()
            finally:
                conn.close()

            upsert_epic_metadata(
                epic_key="CEGBUPOL-4482",
                success_criteria=["Zero blocker defects"],
                group_ids=[group["id"]],
                work_type_ids=[work_type["id"]],
                db_path=db_path,
            )

            deleted = delete_epic_metadata("cegbupol-4482", db_path=db_path)
            self.assertEqual(deleted["epicKey"], "CEGBUPOL-4482")
            self.assertTrue(deleted["deleted"])
            self.assertEqual(deleted["removedMetadataRows"], 1)

            read_payload = get_epic_metadata(epic_key="CEGBUPOL-4482", db_path=db_path)
            self.assertEqual(read_payload["epics"], [])

            with self.assertRaisesRegex(ValueError, "is not configured"):
                delete_epic_metadata("CEGBUPOL-4482", db_path=db_path)

    def test_initiative_views_scope_summary_and_completed_cards(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = str(Path(tmp_dir) / "teambeacon.db")
            add_epic_group("Platform", db_path=db_path)
            conn = sqlite3.connect(db_path)
            try:
                conn.executemany(
                    """
                    INSERT INTO issues (
                      issue_key, issue_id, issue_type, summary, status_name, status_category,
                      epic_key, resolved_at_source, updated_at_source
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        ("CEGBUPOL-100", "100", "Epic", "Q1 Platform", "In Progress", "In Progress", None, None, "2026-03-20T00:00:00+00:00"),
                        ("CEGBUPOL-200", "200", "Epic", "Shared Reliability", "In Progress", "In Progress", None, None, "2026-03-20T00:00:00+00:00"),
                        ("CEGBUPOL-300", "300", "Epic", "Q2 Search", "In Progress", "In Progress", None, None, "2026-03-20T00:00:00+00:00"),
                        ("CEGBUPOL-1001", "1001", "Story", "Q1 done card", "Done", "Done", "CEGBUPOL-100", "2026-03-24T00:00:00+00:00", "2026-03-24T00:00:00+00:00"),
                        ("CEGBUPOL-2001", "2001", "Story", "Shared done card", "Done", "Done", "CEGBUPOL-200", "2026-03-25T00:00:00+00:00", "2026-03-25T00:00:00+00:00"),
                        ("CEGBUPOL-3001", "3001", "Story", "Q2 done card", "Done", "Done", "CEGBUPOL-300", "2026-03-26T00:00:00+00:00", "2026-03-26T00:00:00+00:00"),
                    ],
                )
                conn.commit()
            finally:
                conn.close()

            for epic_key in ["CEGBUPOL-100", "CEGBUPOL-200", "CEGBUPOL-300"]:
                upsert_epic_metadata(
                    epic_key=epic_key,
                    success_criteria=[],
                    group_ids=[],
                    work_type_ids=[],
                    db_path=db_path,
                )

            q1_view = create_initiative_view(
                name="Q1 FY27",
                epic_keys=["CEGBUPOL-100", "CEGBUPOL-200"],
                db_path=db_path,
            )
            platform_view = create_initiative_view(
                name="Platform Portfolio",
                epic_keys=["CEGBUPOL-200", "CEGBUPOL-300"],
                description="Shared platform view",
                db_path=db_path,
            )

            views_payload = get_initiative_views(db_path=db_path)
            self.assertEqual(views_payload["views"][0]["id"], "all")
            self.assertEqual(views_payload["views"][0]["epicCount"], 3)
            self.assertEqual(q1_view["epicKeys"], ["CEGBUPOL-100", "CEGBUPOL-200"])
            self.assertEqual(platform_view["epicKeys"], ["CEGBUPOL-200", "CEGBUPOL-300"])
            self.assertEqual(platform_view["description"], "Shared platform view")

            scoped_summary = get_configured_epic_summary(
                limit=10,
                period_start="2026-03-23",
                period_end="2026-03-30",
                timezone_name="UTC",
                view_id=q1_view["id"],
                db_path=db_path,
            )
            self.assertEqual([epic["epicKey"] for epic in scoped_summary["epics"]], ["CEGBUPOL-100", "CEGBUPOL-200"])
            self.assertEqual(scoped_summary["view"]["name"], "Q1 FY27")
            self.assertEqual(scoped_summary["epics"][0]["completedInPeriod"], 1)

            completed_payload = get_configured_epics_completed_cards(
                period_start="2026-03-23",
                period_end="2026-03-30",
                timezone_name="UTC",
                view_id=q1_view["id"],
                db_path=db_path,
            )
            self.assertEqual(completed_payload["count"], 2)
            self.assertEqual(set(completed_payload["perEpicCounts"]), {"CEGBUPOL-100", "CEGBUPOL-200"})
            self.assertEqual(completed_payload["view"]["name"], "Q1 FY27")

            updated_view = update_initiative_view(
                view_id=q1_view["id"],
                name="Q1 FY27 Delivery",
                epic_keys=["CEGBUPOL-300", "CEGBUPOL-100"],
                db_path=db_path,
            )
            self.assertEqual(updated_view["epicKeys"], ["CEGBUPOL-300", "CEGBUPOL-100"])
            updated_summary = get_configured_epic_summary(
                limit=10,
                view_id=q1_view["id"],
                db_path=db_path,
            )
            self.assertEqual([epic["epicKey"] for epic in updated_summary["epics"]], ["CEGBUPOL-300", "CEGBUPOL-100"])

            deleted = delete_initiative_view(platform_view["id"], db_path=db_path)
            self.assertTrue(deleted["deleted"])
            self.assertEqual(deleted["removedMappings"], 2)

    def test_initiative_view_rejects_unconfigured_epic_keys_and_cleans_up_on_epic_delete(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = str(Path(tmp_dir) / "teambeacon.db")
            add_epic_group("Platform", db_path=db_path)

            for epic_key in ["CEGBUPOL-100", "CEGBUPOL-200"]:
                upsert_epic_metadata(
                    epic_key=epic_key,
                    success_criteria=[],
                    group_ids=[],
                    work_type_ids=[],
                    db_path=db_path,
                )

            with self.assertRaisesRegex(ValueError, "unconfigured epic keys"):
                create_initiative_view(
                    name="Invalid View",
                    epic_keys=["CEGBUPOL-999"],
                    db_path=db_path,
                )

            view = create_initiative_view(
                name="Cleanup View",
                epic_keys=["CEGBUPOL-100", "CEGBUPOL-200"],
                db_path=db_path,
            )
            deleted = delete_epic_metadata("CEGBUPOL-100", db_path=db_path)
            self.assertEqual(deleted["removedViewMappings"], 1)

            views_payload = get_initiative_views(db_path=db_path)
            cleanup_view = next(item for item in views_payload["views"] if item["id"] == view["id"])
            self.assertEqual(cleanup_view["epicKeys"], ["CEGBUPOL-200"])

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
            recent_done_at = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
            older_updated_at = (datetime.now(timezone.utc) - timedelta(days=15)).isoformat()
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
                    INSERT INTO issues (
                      issue_key, issue_id, issue_type, summary, status_name, status_category,
                      epic_key, updated_at_source, resolved_at_source
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "CEGBUPOL-101",
                        "101",
                        "Story",
                        "Story done",
                        "Done",
                        "Done",
                        "CEGBUPOL-4482",
                        recent_done_at,
                        recent_done_at,
                    ),
                )
                conn.execute(
                    """
                    INSERT INTO issues (
                      issue_key, issue_id, issue_type, summary, status_name, status_category,
                      epic_key, updated_at_source
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "CEGBUPOL-102",
                        "102",
                        "Story",
                        "Story in progress",
                        "In Progress",
                        "In Progress",
                        "CEGBUPOL-4482",
                        older_updated_at,
                    ),
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
            self.assertEqual(payload["epics"][0]["completedInPeriod"], 1)
            self.assertEqual(payload["epics"][0]["completedLastWeek"], 1)
            self.assertEqual(payload["epics"][0]["deltaPercentInPeriod"], 50.0)
            self.assertEqual(payload["epics"][0]["deltaPercent"], 50.0)
            self.assertEqual(payload["epics"][0]["successCriteria"], ["Keep blockers at zero"])
            self.assertEqual(payload["epics"][0]["groups"], [])
            self.assertEqual(payload["epics"][0]["workTypes"], [])
            self.assertEqual(payload["reportingPeriod"]["days"], 7)

    def test_configured_epic_summary_ignores_issue_rows_missing_from_latest_full_sync(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = str(Path(tmp_dir) / "teambeacon.db")
            upsert_epic_metadata(
                epic_key="CEGBUPOL-4484",
                success_criteria=["All cards complete"],
                group_ids=[],
                work_type_ids=[],
                db_path=db_path,
            )

            conn = sqlite3.connect(db_path)
            try:
                conn.execute(
                    """
                    INSERT INTO sync_run_history (
                      source_type, scope_key, sync_mode, started_at, finished_at,
                      status, issues_synced, total_issues
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "jira",
                        "board:27193",
                        "full",
                        "2026-06-03T02:12:47+00:00",
                        "2026-06-03T03:29:30+00:00",
                        "completed",
                        1,
                        1,
                    ),
                )
                conn.execute(
                    """
                    INSERT INTO issues (
                      issue_key, issue_id, issue_type, summary, status_name, status_category, synced_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "CEGBUPOL-4484",
                        "4484",
                        "Epic",
                        "NL Search - AIA Stack Integration",
                        "Closed",
                        "Done",
                        "2026-06-03 02:13:00",
                    ),
                )
                conn.executemany(
                    """
                    INSERT INTO issues (
                      issue_key, issue_id, issue_type, summary, status_name, status_category,
                      epic_key, parent_issue_key, updated_at_source, resolved_at_source, synced_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            "CEGBUPOL-9001",
                            "9001",
                            "Story",
                            "Current done card",
                            "Closed",
                            "Done",
                            "CEGBUPOL-4484",
                            "CEGBUPOL-4484",
                            "2026-06-03T02:13:00+00:00",
                            "2026-06-03T02:13:00+00:00",
                            "2026-06-03 02:13:00",
                        ),
                        (
                            "CEGBUPOL-9002",
                            "9002",
                            "Story",
                            "Stale open card",
                            "Open",
                            "To Do",
                            "CEGBUPOL-4484",
                            "CEGBUPOL-4484",
                            "2026-05-03T16:33:45-07:00",
                            None,
                            "2026-05-13 02:06:00",
                        ),
                        (
                            "CEGBUPOL-9003",
                            "9003",
                            "Story",
                            "Stale done card",
                            "Closed",
                            "Done",
                            "CEGBUPOL-4484",
                            "CEGBUPOL-4484",
                            "2026-06-02T02:13:00+00:00",
                            "2026-06-02T02:13:00+00:00",
                            "2026-05-13 02:06:00",
                        ),
                    ],
                )
                conn.commit()
            finally:
                conn.close()

            summary_payload = get_configured_epic_summary(limit=10, db_path=db_path)
            epic = summary_payload["epics"][0]
            self.assertEqual(epic["totalCards"], 1)
            self.assertEqual(epic["completedCards"], 1)
            self.assertEqual(epic["completionPercent"], 100.0)

            completed_payload = get_epic_completed_cards(
                epic_key="CEGBUPOL-4484",
                period_start="2026-06-01",
                period_end="2026-06-03",
                timezone_name="UTC",
                db_path=db_path,
            )
            self.assertEqual(completed_payload["count"], 1)
            self.assertEqual(completed_payload["completedCards"][0]["issueKey"], "CEGBUPOL-9001")

            configured_completed_payload = get_configured_epics_completed_cards(
                period_start="2026-06-01",
                period_end="2026-06-03",
                timezone_name="UTC",
                db_path=db_path,
            )
            self.assertEqual(configured_completed_payload["count"], 1)
            self.assertEqual(configured_completed_payload["perEpicCounts"], {"CEGBUPOL-4484": 1})

    def test_configured_epic_summary_respects_inclusive_period_and_timezone(self) -> None:
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
                conn.executemany(
                    """
                    INSERT INTO issues (
                      issue_key, issue_id, issue_type, summary, status_name, status_category,
                      epic_key, resolved_at_source, updated_at_source
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            "CEGBUPOL-101",
                            "101",
                            "Story",
                            "Before period in LA",
                            "Done",
                            "Done",
                            "CEGBUPOL-4482",
                            "2026-03-01T07:30:00+00:00",
                            "2026-03-01T07:30:00+00:00",
                        ),
                        (
                            "CEGBUPOL-102",
                            "102",
                            "Story",
                            "Period start inclusive in LA",
                            "Done",
                            "Done",
                            "CEGBUPOL-4482",
                            "2026-03-01T08:30:00+00:00",
                            "2026-03-01T08:30:00+00:00",
                        ),
                        (
                            "CEGBUPOL-103",
                            "103",
                            "Story",
                            "Period end inclusive in LA",
                            "Done",
                            "Done",
                            "CEGBUPOL-4482",
                            "2026-03-08T07:30:00+00:00",
                            "2026-03-08T07:30:00+00:00",
                        ),
                        (
                            "CEGBUPOL-104",
                            "104",
                            "Story",
                            "After period in LA",
                            "Done",
                            "Done",
                            "CEGBUPOL-4482",
                            "2026-03-08T08:30:00+00:00",
                            "2026-03-08T08:30:00+00:00",
                        ),
                    ],
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

            payload = get_configured_epic_summary(
                limit=10,
                period_start="2026-03-01",
                period_end="2026-03-07",
                timezone_name="America/Los_Angeles",
                db_path=db_path,
            )
            self.assertEqual(len(payload["epics"]), 1)
            self.assertEqual(payload["epics"][0]["totalCards"], 4)
            self.assertEqual(payload["epics"][0]["completedCards"], 4)
            self.assertEqual(payload["epics"][0]["completedInPeriod"], 2)
            self.assertEqual(payload["epics"][0]["completedLastWeek"], 2)
            self.assertEqual(payload["epics"][0]["deltaPercentInPeriod"], 50.0)
            self.assertEqual(payload["epics"][0]["deltaPercent"], 50.0)
            self.assertEqual(payload["reportingPeriod"]["startDate"], "2026-03-01")
            self.assertEqual(payload["reportingPeriod"]["endDate"], "2026-03-07")
            self.assertEqual(payload["reportingPeriod"]["days"], 7)
            self.assertEqual(payload["reportingPeriod"]["timezone"], "America/Los_Angeles")

    def test_get_epic_completed_cards_returns_done_cards_within_reporting_period(self) -> None:
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
                    INSERT INTO issues (issue_key, issue_id, issue_type, summary, status_name, status_category, updated_at_source)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "CEGBUPOL-4482",
                        "4482",
                        "Epic",
                        "Enable offline initiative scoring",
                        "In Progress",
                        "In Progress",
                        "2026-03-20T10:00:00+00:00",
                    ),
                )
                conn.executemany(
                    """
                    INSERT INTO issues (
                      issue_key, issue_id, issue_type, summary, status_name, status_category,
                      epic_key, story_points, assignee_account_id, updated_at_source, resolved_at_source
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            "CEGBUPOL-6001",
                            "6001",
                            "Story",
                            "Completed in period",
                            "Done",
                            "Done",
                            "CEGBUPOL-4482",
                            5.0,
                            "user-dev",
                            "2026-03-25T00:00:00+00:00",
                            "2026-03-25T00:00:00+00:00",
                        ),
                        (
                            "CEGBUPOL-6002",
                            "6002",
                            "Story",
                            "Done before period",
                            "Done",
                            "Done",
                            "CEGBUPOL-4482",
                            3.0,
                            "user-qa",
                            "2026-02-20T00:00:00+00:00",
                            "2026-02-20T00:00:00+00:00",
                        ),
                        (
                            "CEGBUPOL-6003",
                            "6003",
                            "Story",
                            "Not done in period",
                            "In Progress",
                            "In Progress",
                            "CEGBUPOL-4482",
                            2.0,
                            "user-dev",
                            "2026-03-26T00:00:00+00:00",
                            None,
                        ),
                    ],
                )
                conn.commit()
            finally:
                conn.close()

            payload = get_epic_completed_cards(
                epic_key="cegbupol-4482",
                period_start="2026-03-23",
                period_end="2026-03-30",
                timezone_name="UTC",
                db_path=db_path,
            )
            self.assertEqual(payload["epicKey"], "CEGBUPOL-4482")
            self.assertEqual(payload["count"], 1)
            self.assertFalse(payload["truncated"])
            self.assertEqual(payload["completedCards"][0]["issueKey"], "CEGBUPOL-6001")
            self.assertEqual(payload["completedCards"][0]["storyPoints"], 5.0)
            self.assertEqual(payload["completedCards"][0]["assigneeAccountId"], "user-dev")
            self.assertEqual(payload["reportingPeriod"]["startDate"], "2026-03-23")
            self.assertEqual(payload["reportingPeriod"]["endDate"], "2026-03-30")

    def test_get_configured_epics_completed_cards_aggregates_across_configured_epics(self) -> None:
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
                conn.executemany(
                    """
                    INSERT INTO issues (issue_key, issue_id, issue_type, summary, status_name, status_category, updated_at_source)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            "CEGBUPOL-4482",
                            "4482",
                            "Epic",
                            "Enable offline initiative scoring",
                            "In Progress",
                            "In Progress",
                            "2026-03-20T10:00:00+00:00",
                        ),
                        (
                            "CEGBUPOL-3553",
                            "3553",
                            "Epic",
                            "Domain Support Q4",
                            "In Progress",
                            "In Progress",
                            "2026-03-20T10:00:00+00:00",
                        ),
                    ],
                )
                conn.executemany(
                    """
                    INSERT INTO issues (
                      issue_key, issue_id, issue_type, summary, status_name, status_category,
                      epic_key, story_points, assignee_account_id, updated_at_source, resolved_at_source
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            "CEGBUPOL-7001",
                            "7001",
                            "Story",
                            "Harden notification retries",
                            "Done",
                            "Done",
                            "CEGBUPOL-4482",
                            5.0,
                            "user-dev",
                            "2026-03-24T00:00:00+00:00",
                            "2026-03-24T00:00:00+00:00",
                        ),
                        (
                            "CEGBUPOL-7002",
                            "7002",
                            "Story",
                            "Reduce flaky e2e checks",
                            "Closed",
                            "Done",
                            "CEGBUPOL-3553",
                            3.0,
                            "user-qa",
                            "2026-03-25T00:00:00+00:00",
                            "2026-03-25T00:00:00+00:00",
                        ),
                        (
                            "CEGBUPOL-7003",
                            "7003",
                            "Story",
                            "Out of period item",
                            "Done",
                            "Done",
                            "CEGBUPOL-3553",
                            2.0,
                            "user-dev",
                            "2026-02-10T00:00:00+00:00",
                            "2026-02-10T00:00:00+00:00",
                        ),
                    ],
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
            upsert_epic_metadata(
                epic_key="CEGBUPOL-3553",
                success_criteria=["Reduce incident intake"],
                group_ids=[],
                work_type_ids=[],
                db_path=db_path,
            )

            payload = get_configured_epics_completed_cards(
                period_start="2026-03-23",
                period_end="2026-03-30",
                timezone_name="UTC",
                db_path=db_path,
            )
            self.assertEqual(payload["scope"], "configured")
            self.assertEqual(payload["count"], 2)
            self.assertFalse(payload["truncated"])
            self.assertEqual(len(payload["completedCards"]), 2)
            self.assertEqual(payload["perEpicCounts"]["CEGBUPOL-4482"], 1)
            self.assertEqual(payload["perEpicCounts"]["CEGBUPOL-3553"], 1)
            self.assertEqual(payload["completedCards"][0]["epicKey"], "CEGBUPOL-3553")
            self.assertEqual(payload["completedCards"][1]["epicKey"], "CEGBUPOL-4482")

    def test_configured_epic_summary_rejects_invalid_period(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = str(Path(tmp_dir) / "teambeacon.db")
            with self.assertRaisesRegex(ValueError, "periodStart and periodEnd must both be provided"):
                get_configured_epic_summary(limit=10, period_start="2026-03-01", db_path=db_path)
            with self.assertRaisesRegex(ValueError, "periodStart cannot be after periodEnd"):
                get_configured_epic_summary(
                    limit=10,
                    period_start="2026-03-10",
                    period_end="2026-03-01",
                    db_path=db_path,
                )

    def test_epic_summary_uses_latest_synced_issue_name_when_metadata_name_is_stale(self) -> None:
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
                    INSERT INTO issues (issue_key, issue_id, issue_type, summary, status_name, status_category, updated_at_source)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "CEGBUPOL-3553",
                        "3553",
                        "Epic",
                        "CloudNative Migration for Email Notification Service",
                        "In Progress",
                        "In Progress",
                        "2026-03-25T06:00:00-07:00",
                    ),
                )
                conn.commit()
            finally:
                conn.close()

            upsert_epic_metadata(
                epic_key="CEGBUPOL-3553",
                success_criteria=["Keep throughput stable"],
                group_ids=[],
                work_type_ids=[],
                db_path=db_path,
            )

            conn = sqlite3.connect(db_path)
            try:
                conn.execute(
                    """
                    UPDATE issues
                    SET summary = ?, updated_at_source = ?
                    WHERE issue_key = ?
                    """,
                    (
                        "OCI Native Migration for Email Notification Service ",
                        "2026-03-25T06:22:38-07:00",
                        "CEGBUPOL-3553",
                    ),
                )
                conn.commit()
            finally:
                conn.close()

            summary_payload = get_configured_epic_summary(limit=20, db_path=db_path)
            self.assertEqual(len(summary_payload["epics"]), 1)
            self.assertEqual(
                summary_payload["epics"][0]["epicName"],
                "OCI Native Migration for Email Notification Service",
            )


if __name__ == "__main__":
    unittest.main()
