from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from services.api.integrations.jira_sync import _ensure_schema
from services.api.issues.team_insights import get_team_insights


class TeamInsightsServiceUnitTests(unittest.TestCase):
    def _init_db(self, db_path: Path) -> None:
        conn = sqlite3.connect(str(db_path))
        try:
            _ensure_schema(conn)
            conn.commit()
        finally:
            conn.close()

    def test_get_team_insights_aggregates_trend_metrics_and_work_mix(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"
            self._init_db(db_path)

            conn = sqlite3.connect(str(db_path))
            try:
                conn.executemany(
                    """
                    INSERT INTO sprints (
                      external_sprint_id,
                      board_external_id,
                      name,
                      state,
                      start_date,
                      end_date
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            2001,
                            27193,
                            "Sprint 01",
                            "closed",
                            "2026-03-01T00:00:00+00:00",
                            "2026-03-14T00:00:00+00:00",
                        ),
                        (
                            2002,
                            27193,
                            "Sprint 02",
                            "closed",
                            "2026-03-15T00:00:00+00:00",
                            "2026-03-28T00:00:00+00:00",
                        ),
                        (
                            2003,
                            27193,
                            "Sprint 03",
                            "active",
                            "2026-03-29T00:00:00+00:00",
                            "2026-04-11T00:00:00+00:00",
                        ),
                    ],
                )

                conn.executemany(
                    """
                    INSERT INTO epic_metadata (id, epic_key, epic_name)
                    VALUES (?, ?, ?)
                    """,
                    [
                        (1, "EPIC-1", "Platform Improvements"),
                        (2, "EPIC-2", "Operational Hardening"),
                    ],
                )
                conn.executemany(
                    """
                    INSERT INTO work_types (id, name)
                    VALUES (?, ?)
                    """,
                    [
                        (10, "Feature"),
                        (11, "Ops"),
                    ],
                )
                conn.executemany(
                    """
                    INSERT INTO epic_metadata_work_types (epic_metadata_id, work_type_id)
                    VALUES (?, ?)
                    """,
                    [
                        (1, 10),
                        (2, 11),
                    ],
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
                      sprint_external_id,
                      epic_key,
                      created_at_source,
                      resolved_at_source
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            "TEAM-1",
                            "1",
                            "TEAM",
                            "Story",
                            "Build ingestion pipeline",
                            "Done",
                            "Done",
                            8.0,
                            2001,
                            "EPIC-1",
                            "2026-03-01T00:00:00+00:00",
                            "2026-03-05T00:00:00+00:00",
                        ),
                        (
                            "TEAM-2",
                            "2",
                            "TEAM",
                            "Story",
                            "Add observability checks",
                            "In Progress",
                            "In Progress",
                            5.0,
                            2001,
                            "EPIC-1",
                            "2026-03-02T00:00:00+00:00",
                            None,
                        ),
                        (
                            "TEAM-3",
                            "3",
                            "TEAM",
                            "Story",
                            "Reduce flake rate",
                            "Done",
                            "Done",
                            3.0,
                            2002,
                            "EPIC-2",
                            "2026-03-15T00:00:00+00:00",
                            "2026-03-17T00:00:00+00:00",
                        ),
                        (
                            "TEAM-4",
                            "4",
                            "TEAM",
                            "Story",
                            "Release guardrails",
                            "Closed",
                            "Done",
                            5.0,
                            2002,
                            "EPIC-2",
                            "2026-03-16T00:00:00+00:00",
                            "2026-03-21T00:00:00+00:00",
                        ),
                        (
                            "TEAM-5",
                            "5",
                            "TEAM",
                            "Story",
                            "Security baseline updates",
                            "Done",
                            "Done",
                            8.0,
                            2003,
                            "EPIC-1",
                            "2026-03-29T00:00:00+00:00",
                            "2026-03-30T00:00:00+00:00",
                        ),
                        (
                            "TEAM-6",
                            "6",
                            "TEAM",
                            "Story",
                            "On-call automation",
                            "To Do",
                            "To Do",
                            8.0,
                            2003,
                            "EPIC-2",
                            "2026-03-30T00:00:00+00:00",
                            None,
                        ),
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
                      to_value,
                      raw_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            "TEAM-1",
                            "h1",
                            "2026-03-01T00:00:00+00:00",
                            None,
                            "status",
                            "Open",
                            "In Progress",
                            "{}",
                        ),
                        (
                            "TEAM-3",
                            "h2",
                            "2026-03-15T00:00:00+00:00",
                            None,
                            "status",
                            "Open",
                            "In Progress",
                            "{}",
                        ),
                        (
                            "TEAM-4",
                            "h3",
                            "2026-03-16T00:00:00+00:00",
                            None,
                            "status",
                            "Open",
                            "In Progress",
                            "{}",
                        ),
                        (
                            "TEAM-5",
                            "h4",
                            "2026-03-29T00:00:00+00:00",
                            None,
                            "status",
                            "Open",
                            "In Progress",
                            "{}",
                        ),
                    ],
                )
                conn.commit()
            finally:
                conn.close()

            payload = get_team_insights(
                db_path=str(db_path),
                board_id=27193,
                sprint_limit=6,
            )

            self.assertEqual(payload["source"], "local")
            self.assertIsNone(payload["error"])
            self.assertEqual(payload["windowSize"], 3)
            self.assertEqual(len(payload["trend"]), 3)
            self.assertEqual(payload["trend"][0]["sprintId"], 2001)
            self.assertEqual(payload["trend"][-1]["sprintId"], 2003)
            self.assertAlmostEqual(payload["trend"][0]["avgCycleTimeDays"], 4.0, places=2)
            self.assertAlmostEqual(payload["trend"][1]["avgCycleTimeDays"], 3.5, places=2)
            self.assertAlmostEqual(payload["trend"][2]["avgCycleTimeDays"], 1.0, places=2)

            metrics = payload["metrics"]
            self.assertAlmostEqual(metrics["avgCommittedStoryPoints"], 12.33, places=2)
            self.assertAlmostEqual(metrics["avgCompletedStoryPoints"], 8.0, places=2)
            self.assertAlmostEqual(metrics["completionRatioPercent"], 64.86, places=2)
            self.assertAlmostEqual(metrics["carryoverPercent"], 35.14, places=2)
            self.assertAlmostEqual(metrics["avgCycleTimeDays"], 3.0, places=2)
            self.assertAlmostEqual(metrics["cycleTimeStdDevDays"], 1.58, places=2)
            self.assertAlmostEqual(metrics["medianCycleTimeDays"], 3.0, places=2)

            status_cycle = payload["statusCycleTime"]
            self.assertEqual(status_cycle["trackedIssues"], 4)
            self.assertAlmostEqual(status_cycle["totalDays"], 12.0, places=2)
            self.assertEqual(len(status_cycle["rows"]), 1)
            self.assertEqual(status_cycle["rows"][0]["status"], "In Progress")
            self.assertEqual(status_cycle["rows"][0]["issueCount"], 4)
            self.assertAlmostEqual(status_cycle["rows"][0]["avgDays"], 3.0, places=2)
            self.assertAlmostEqual(status_cycle["rows"][0]["medianDays"], 3.0, places=2)
            self.assertAlmostEqual(status_cycle["rows"][0]["p85Days"], 5.0, places=2)
            self.assertAlmostEqual(status_cycle["rows"][0]["maxDays"], 5.0, places=2)
            self.assertAlmostEqual(status_cycle["rows"][0]["totalDays"], 12.0, places=2)
            self.assertAlmostEqual(status_cycle["rows"][0]["percentOfCycleTime"], 100.0, places=2)

            work_mix = payload["workMix"]
            self.assertEqual(work_mix["sprintId"], 2003)
            self.assertEqual(work_mix["sprintName"], "Sprint 03")
            self.assertEqual(work_mix["totalIssues"], 2)
            self.assertEqual(work_mix["slices"][0]["label"], "Feature")
            self.assertEqual(work_mix["slices"][0]["count"], 1)
            self.assertEqual(work_mix["slices"][0]["percent"], 50.0)
            self.assertEqual(work_mix["slices"][1]["label"], "Ops")
            self.assertEqual(work_mix["slices"][1]["count"], 1)
            self.assertEqual(work_mix["slices"][1]["percent"], 50.0)
            self.assertIn("Feature 50%", payload["summary"])
            self.assertIn("Ops 50%", payload["summary"])

    def test_get_team_insights_returns_empty_payload_when_no_sprints_exist(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"
            self._init_db(db_path)

            payload = get_team_insights(db_path=str(db_path), board_id=27193)

            self.assertEqual(payload["source"], "local")
            self.assertEqual(payload["windowSize"], 0)
            self.assertEqual(payload["trend"], [])
            self.assertEqual(payload["statusCycleTime"]["trackedIssues"], 0)
            self.assertEqual(payload["statusCycleTime"]["rows"], [])
            self.assertEqual(payload["workMix"]["totalIssues"], 0)
            self.assertEqual(payload["summary"], "Work mix will appear once sprint data is synced.")
            self.assertEqual(payload["error"], "No sprint history found in local data.")

    def test_get_team_insights_excludes_epics_from_cycle_time_metrics(self) -> None:
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
                    ) VALUES (3001, 27193, 'Sprint Epic Filter', 'closed', '2026-03-01T00:00:00+00:00', '2026-03-14T00:00:00+00:00')
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
                      sprint_external_id,
                      created_at_source,
                      resolved_at_source
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            "TEAM-100",
                            "100",
                            "TEAM",
                            "Story",
                            "Short cycle story",
                            "Done",
                            "Done",
                            3.0,
                            3001,
                            "2026-03-01T00:00:00+00:00",
                            "2026-03-03T00:00:00+00:00",
                        ),
                        (
                            "TEAM-EPIC-1",
                            "101",
                            "TEAM",
                            "Epic",
                            "Long cycle epic",
                            "Done",
                            "Done",
                            8.0,
                            3001,
                            "2026-01-01T00:00:00+00:00",
                            "2026-03-12T00:00:00+00:00",
                        ),
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
                      to_value,
                      raw_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            "TEAM-100",
                            "eh1",
                            "2026-03-01T00:00:00+00:00",
                            None,
                            "status",
                            "Open",
                            "In Progress",
                            "{}",
                        ),
                        (
                            "TEAM-EPIC-1",
                            "eh2",
                            "2026-01-01T00:00:00+00:00",
                            None,
                            "status",
                            "Open",
                            "In Progress",
                            "{}",
                        ),
                    ],
                )
                conn.commit()
            finally:
                conn.close()

            payload = get_team_insights(db_path=str(db_path), board_id=27193, sprint_limit=6)

            metrics = payload["metrics"]
            self.assertAlmostEqual(metrics["avgCycleTimeDays"], 2.0, places=2)
            self.assertAlmostEqual(metrics["cycleTimeStdDevDays"], 0.0, places=2)
            self.assertAlmostEqual(metrics["medianCycleTimeDays"], 2.0, places=2)
            self.assertEqual(payload["statusCycleTime"]["trackedIssues"], 1)
            self.assertEqual(payload["statusCycleTime"]["rows"][0]["status"], "In Progress")
            self.assertAlmostEqual(payload["statusCycleTime"]["rows"][0]["totalDays"], 2.0, places=2)


if __name__ == "__main__":
    unittest.main()
