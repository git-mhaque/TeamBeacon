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
