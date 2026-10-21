"""Regression coverage for complete configured-epic analytics above 200 rows."""

from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from services.api.issues.team_dashboard import get_team_dashboard
from services.api.metadata.epic_config import (
    add_epic_group,
    create_initiative_view,
    get_configured_epic_summary,
)


class CompleteEpicSummaryTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.db = str(Path(directory.name) / "summary.db")
        self.first = add_epic_group("First 200", db_path=self.db)["id"]
        self.last = add_epic_group("Last 45", db_path=self.db)["id"]
        self.keys = [f"P-{index:03}" for index in range(245)]
        with sqlite3.connect(self.db) as conn:
            for index, key in enumerate(self.keys):
                metadata = conn.execute(
                    "INSERT INTO epic_metadata(epic_key) VALUES (?)", (key,)
                ).lastrowid
                conn.execute(
                    "INSERT INTO epic_metadata_groups VALUES (?, ?)",
                    (metadata, self.first if index < 200 else self.last),
                )
                conn.execute(
                    "INSERT INTO issues(issue_key,issue_id,issue_type,summary,status_name) VALUES (?,?,'Epic',?,'Open')",
                    (key, key, key),
                )
                done = index < 200
                conn.execute(
                    """INSERT INTO issues(issue_key,issue_id,issue_type,summary,status_name,status_category,epic_key)
                                VALUES (?,?,'Story',?,?,?,?)""",
                    (
                        f"C-{index}",
                        f"C-{index}",
                        "Child",
                        "Done" if done else "Open",
                        "Done" if done else "To Do",
                        key,
                    ),
                )

    def test_epic_completion_uses_own_status_and_matches_dashboard_drilldowns(self) -> None:
        from services.api.issues.initiative_deep_dive import get_initiative_deep_dive
        with sqlite3.connect(self.db) as conn:
            conn.execute("UPDATE issues SET status_name='Released',status_category='Done' WHERE issue_key=?", (self.keys[0],))
            conn.execute("UPDATE issues SET status_name='Closed',status_category=NULL WHERE issue_key=?", (self.keys[1],))
            conn.execute("UPDATE issues SET status_name='Closed',status_category='In Progress',resolved_at_source='2026-01-01' WHERE issue_key=?", (self.keys[2],))
            conn.execute("DELETE FROM issues WHERE issue_key=?", (self.keys[3],))
            # Completed epic without any child cards still counts by its own status.
            conn.execute("UPDATE issues SET status_name='Done',status_category='Done' WHERE issue_key=?", (self.keys[-1],))
            conn.execute("DELETE FROM issues WHERE epic_key=?", (self.keys[-1],))
        summary = get_configured_epic_summary(limit=None, db_path=self.db)
        statuses = {epic["epicKey"]: epic["status"] for epic in summary["epics"]}
        self.assertEqual(statuses[self.keys[0]], "Released")
        self.assertEqual(statuses[self.keys[1]], "Closed")
        self.assertEqual(statuses[self.keys[2]], "Closed")
        self.assertIsNone(statuses[self.keys[3]])
        from services.api.metadata.epic_mapping import get_epic_mapping_inventory
        with patch("services.api.metadata.epic_mapping.os.getenv", return_value=None):
            inventory = get_epic_mapping_inventory(db_path=self.db)
        self.assertEqual(len(inventory["epics"]), len(self.keys) - 1)
        for epic in inventory["epics"]:
            self.assertEqual(statuses[epic["epicKey"]], epic["status"])
        completed = {epic["epicKey"] for epic in summary["epics"] if epic["isCompleted"]}
        self.assertEqual(completed, {self.keys[0], self.keys[1], self.keys[-1]})
        view = create_initiative_view(name="Status view", epic_keys=self.keys[:4], db_path=self.db)
        view_summary = get_configured_epic_summary(view_id=view["id"], limit=None, db_path=self.db)
        self.assertEqual(sum(epic["isCompleted"] for epic in view_summary["epics"]), 2)
        with patch("services.api.issues.team_dashboard.get_release_insights", return_value={}), \
             patch("services.api.issues.team_dashboard.get_team_insights", return_value={}), \
             patch("services.api.issues.team_dashboard.get_current_sprint_changes", return_value={}):
            dashboard = get_team_dashboard(db_path=self.db)
        self.assertEqual(sum(row["completedEpicCount"] for row in dashboard["workStreams"]), 3)
        for stream in dashboard["workStreams"]:
            drilldown = get_initiative_deep_dive(group_ids=[stream["id"]], work_stream_scope="primary", db_path=self.db)
            self.assertEqual(sum(epic["isCompleted"] for epic in drilldown["epicOptions"]), stream["completedEpicCount"])

    def test_complete_summary_includes_late_epics_and_metrics(self) -> None:
        result = get_configured_epic_summary(limit=None, db_path=self.db)
        self.assertEqual(result["view"]["epicCount"], 245)
        self.assertEqual(len(result["epics"]), 245)
        self.assertEqual(sum(epic["totalCards"] for epic in result["epics"]), 245)
        self.assertEqual(sum(epic["completedCards"] for epic in result["epics"]), 200)
        self.assertEqual(result["epics"][-1]["epicKey"], self.keys[-1])
        self.assertEqual(result["epics"][-1]["completionPercent"], 0)
        self.assertEqual(
            len(get_configured_epic_summary(limit=999, db_path=self.db)["epics"]), 200
        )
        self.assertEqual(len(get_configured_epic_summary(db_path=self.db)["epics"]), 50)

    def test_complete_named_view_preserves_membership_and_order(self) -> None:
        view = create_initiative_view(
            name="All 245", epic_keys=list(reversed(self.keys)), db_path=self.db
        )
        result = get_configured_epic_summary(
            limit=None, view_id=view["id"], db_path=self.db
        )
        self.assertEqual(
            [epic["epicKey"] for epic in result["epics"]], list(reversed(self.keys))
        )
        with self.assertRaises(ValueError):
            get_configured_epic_summary(limit=None, view_id=99999, db_path=self.db)

    def test_dashboard_progress_uses_every_configured_epic(self) -> None:
        with (
            patch(
                "services.api.issues.team_dashboard.get_initiative_deep_dive",
                return_value={},
            ),
            patch(
                "services.api.issues.team_dashboard.get_release_insights",
                return_value={},
            ),
            patch(
                "services.api.issues.team_dashboard.get_team_insights", return_value={}
            ),
            patch(
                "services.api.issues.team_dashboard.get_current_sprint_changes",
                return_value={},
            ),
        ):
            result = get_team_dashboard(db_path=self.db)
        streams = {stream["id"]: stream for stream in result["workStreams"]}
        self.assertEqual(streams[self.first]["epicCount"], 200)
        self.assertEqual(streams[self.last]["epicCount"], 45)
        self.assertEqual(streams[self.last]["totalCards"], 45)
        self.assertEqual(streams[self.last]["totalCompletedCards"], 0)
        self.assertEqual(sum(stream["epicCount"] for stream in streams.values()), 245)
