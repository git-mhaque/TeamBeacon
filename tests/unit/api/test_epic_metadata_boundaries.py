"""Public metadata validation and damaged-source regression coverage."""

from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from services.api.metadata import epic_config as metadata


class EpicMetadataBoundaryTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.db = str(Path(directory.name) / "metadata.db")
        self.group = metadata.add_epic_group("Platform", db_path=self.db)["id"]

    def test_rejects_invalid_lookup_and_view_requests_without_writes(self) -> None:
        actions = [
            lambda: metadata.add_epic_group(" ", db_path=self.db),
            lambda: metadata.update_epic_group("bad", "Name", db_path=self.db),
            lambda: metadata.update_epic_group(0, "Name", db_path=self.db),
            lambda: metadata.update_epic_group(999, "Name", db_path=self.db),
            lambda: metadata.delete_epic_group(999, db_path=self.db),
            lambda: metadata.update_initiative_view(
                view_id="bad", name="Name", db_path=self.db
            ),
            lambda: metadata.update_initiative_view(
                view_id=0, name="Name", db_path=self.db
            ),
            lambda: metadata.update_initiative_view(
                view_id=999, name="Name", db_path=self.db
            ),
            lambda: metadata.delete_initiative_view(999, db_path=self.db),
            lambda: metadata.create_initiative_view(
                name="Name", description=42, db_path=self.db
            ),
            lambda: metadata.create_initiative_view(
                name="Name", epic_keys=[42], db_path=self.db
            ),
        ]
        for action in actions:
            with self.subTest(action=action), self.assertRaises(ValueError):
                action()
        other = metadata.add_epic_group("Other", db_path=self.db)["id"]
        with self.assertRaisesRegex(ValueError, "already exists"):
            metadata.update_epic_group(other, "Platform", db_path=self.db)
        view = metadata.create_initiative_view(name="View", db_path=self.db)
        second = metadata.create_initiative_view(name="Second", db_path=self.db)
        with self.assertRaisesRegex(ValueError, "already exists"):
            metadata.create_initiative_view(name="View", db_path=self.db)
        with self.assertRaisesRegex(ValueError, "already exists"):
            metadata.update_initiative_view(
                view_id=second["id"], name="View", db_path=self.db
            )
        self.assertEqual(view["epicKeys"], [])

    def test_summary_rejects_invalid_periods_and_configuration(self) -> None:
        for options in [
            dict(timezone_name="Invalid/Zone"),
            dict(period_start="2026-03-01"),
            dict(period_start="2026-03-02", period_end="2026-03-01"),
            dict(period_start="invalid", period_end="2026-03-01"),
        ]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                metadata.get_configured_epic_summary(
                    limit=None, db_path=self.db, **options
                )
        for changes in [
            dict(epic_key=" "),
            dict(group_ids=["bad"]),
            dict(group_ids=[0]),
            dict(timeline_enabled=1),
            dict(timeline_start_date=42),
            dict(target_completion_date="invalid"),
        ]:
            args = dict(
                epic_key="P-1",
                success_criteria=[],
                group_ids=[],
                work_type_ids=[],
                db_path=self.db,
            )
            args.update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                metadata.upsert_epic_metadata(**args)
        result = metadata.upsert_epic_metadata(
            epic_key="P-1",
            success_criteria=["Keep", "keep"],
            group_ids=[self.group, self.group],
            work_type_ids=[],
            timeline_start_date="2026-03-01T12:00:00Z",
            target_completion_date=" ",
            db_path=self.db,
        )
        self.assertEqual(result["successCriteria"], ["Keep"])
        self.assertIsNone(result["timelineStartDate"])
        self.assertEqual(result["groupIds"], [self.group])

    def test_summary_handles_damaged_criteria_and_unparseable_completion_dates(
        self,
    ) -> None:
        metadata.upsert_epic_metadata(
            epic_key="P-1",
            success_criteria=[],
            group_ids=[],
            work_type_ids=[],
            db_path=self.db,
        )
        with sqlite3.connect(self.db) as conn:
            conn.execute(
                "INSERT INTO issues(issue_key,issue_id,summary,status_name,status_category,issue_type,epic_key,resolved_at_source) VALUES('P-2','2','Child','Done','Done','Story','P-1','not-a-date')"
            )
        for criteria in ["{broken", '{"unexpected":"object"}']:
            with sqlite3.connect(self.db) as conn:
                conn.execute(
                    "UPDATE epic_metadata SET success_criteria_json=? WHERE epic_key='P-1'",
                    (criteria,),
                )
            result = metadata.get_configured_epic_summary(limit=None, db_path=self.db)[
                "epics"
            ][0]
            self.assertEqual(result["successCriteria"], [])
            self.assertEqual(result["completedCards"], 1)
            self.assertEqual(result["completedInPeriod"], 0)


class EpicSummaryDatabasePerformanceTests(unittest.TestCase):
    def test_bulk_metrics_preserve_direct_parent_and_subtask_membership(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            db = str(Path(directory) / "report.db")
            for key in ["E-1", "E-2", "E-3", "S-1"]:
                metadata.upsert_epic_metadata(epic_key=key, success_criteria=[], group_ids=[], work_type_ids=[], db_path=db)
            with sqlite3.connect(db) as conn:
                conn.executemany(
                    "INSERT INTO issues(issue_key,issue_id,summary,issue_type,epic_key,parent_issue_key,status_name,status_category,resolved_at_source) VALUES(?,?,'Fixture',?,?,?,?,?,?)",
                    [
                        ("E-1", "e1", "Epic", None, None, "Done", "Done", "2026-03-10T00:00:00Z"),
                        ("E-2", "e2", "Epic", None, None, "Done", "Done", "2026-03-10T00:00:00Z"),
                        ("S-1", "s1", "Story", "E-1", "E-1", "Done", "Done", "2026-03-10T00:00:00Z"),
                        ("S-2", "s2", "Sub-task", "E-2", "S-1", "Closed", None, "2026-03-10T00:00:00Z"),
                        ("S-3", "s3", "Sub-task", None, "S-1", "Done", "Done", "2026-02-28T23:30:00Z"),
                        ("S-4", "s4", "Story", None, "E-2", "In progress", "In Progress", None),
                        ("X-1", "x1", "Story", None, None, "Done", "Done", "2026-03-10T00:00:00Z"),
                    ],
                )
            queries: list[str] = []
            original_connect = metadata._connect

            def traced_connect(path: str) -> sqlite3.Connection:
                connection = original_connect(path)
                connection.set_trace_callback(queries.append)
                return connection

            with patch.object(metadata, "_connect", side_effect=traced_connect), patch.dict(os.environ, {"JIRA_BASE_URL": "https://jira.example.com/", "JIRA_PAT": ""}):
                payload = metadata.get_configured_epic_summary(limit=None, period_start="2026-03-01", period_end="2026-03-31", timezone_name="Australia/Melbourne", db_path=db)
            metrics = {row["epicKey"]: (row["totalCards"], row["completedCards"], row["completedInPeriod"]) for row in payload["epics"]}
            self.assertEqual(metrics, {"E-1": (3, 3, 3), "E-2": (2, 1, 1), "E-3": (0, 0, 0), "S-1": (2, 2, 2)})
            self.assertEqual(payload["jiraBaseUrl"], "https://jira.example.com")
            scans = [query for query in queries if "p.epic_key AS parent_epic_key" in query]
            self.assertEqual(len(scans), 1)

    def test_empty_report_works_without_jira_configuration(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"JIRA_BASE_URL": "", "JIRA_PAT": ""}):
            payload = metadata.get_configured_epic_summary(limit=None, db_path=str(Path(directory) / "empty.db"))
            self.assertEqual(payload["epics"], [])
            self.assertIsNone(payload["jiraBaseUrl"])
