from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from services.api.integrations.jira_sync import _ensure_schema
from services.api.issues.release_insights import get_release_insights


class ReleaseInsightsServiceUnitTests(unittest.TestCase):
    def _init_db(self, db_path: Path) -> None:
        conn = sqlite3.connect(str(db_path))
        try:
            _ensure_schema(conn)
            conn.commit()
        finally:
            conn.close()

    def test_get_release_insights_aggregates_versions_and_fixversion_scope(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"
            self._init_db(db_path)

            conn = sqlite3.connect(str(db_path))
            try:
                conn.execute(
                    """
                    INSERT INTO integration_configs (
                      source_type,
                      name,
                      base_url,
                      token_keychain_ref
                    ) VALUES ('jira', 'primary', 'https://jira.example.com', 'mock://jira-pat')
                    """
                )
                conn.executemany(
                    """
                    INSERT INTO jira_project_versions (
                      project_key,
                      version_id,
                      name,
                      archived,
                      released,
                      start_date,
                      release_date
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        ("TEAM", "26000", "Search 26.3", 0, 1, "2026-03-01T00:00:00+00:00", "2026-03-31T00:00:00+00:00"),
                        ("TEAM", "26001", "Search 26.4", 0, 1, "2026-04-01T00:00:00+00:00", "2026-04-21T00:00:00+00:00"),
                        ("TEAM", "26002", "Q4 FY26 - Tech", 0, 0, "2019-01-01T00:00:00+00:00", "2019-01-31T00:00:00+00:00"),
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
                      priority,
                      story_points,
                      raw_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        ("TEAM-1", "1", "TEAM", "Story", "Release platform search", "Done", "Done", "Medium", 8.0, "{}"),
                        ("TEAM-2", "2", "TEAM", "Story", "Tune query ranking", "Done", "Done", "Medium", 5.0, "{}"),
                        ("TEAM-3", "3", "TEAM", "Bug", "Repair release guardrail", "Done", "Done", "High", 3.0, "{}"),
                        ("TEAM-4", "4", "TEAM", "Story", "Complete tech release", "In Progress", "In Progress", "High", 8.0, "{}"),
                        ("TEAM-5", "5", "TEAM", "Task", "Document rollout", "To Do", "To Do", "Medium", 5.0, "{}"),
                    ],
                )
                conn.executemany(
                    """
                    INSERT INTO issue_release_links (
                      issue_key,
                      project_key,
                      version_id,
                      version_name
                    ) VALUES (?, ?, ?, ?)
                    """,
                    [
                        ("TEAM-1", "TEAM", "26000", "Search 26.3"),
                        ("TEAM-2", "TEAM", "26000", "Search 26.3"),
                        ("TEAM-3", "TEAM", "26001", "Search 26.4"),
                        ("TEAM-4", "TEAM", "26002", "Q4 FY26 - Tech"),
                        ("TEAM-5", "TEAM", "26002", "Q4 FY26 - Tech"),
                    ],
                )
                conn.commit()
            finally:
                conn.close()

            payload = get_release_insights(db_path=str(db_path), project_key="TEAM", release_limit=12)

            self.assertEqual(payload["source"], "local")
            self.assertIsNone(payload["error"])
            self.assertEqual(payload["projectKey"], "TEAM")
            metrics = payload["metrics"]
            self.assertEqual(metrics["totalReleases"], 3)
            self.assertEqual(metrics["releasedCount"], 2)
            self.assertEqual(metrics["ongoingCount"], 1)
            self.assertEqual(metrics["overdueCount"], 1)
            self.assertAlmostEqual(metrics["avgCycleTimeDays"], 25.0, places=2)
            self.assertAlmostEqual(metrics["medianCycleTimeDays"], 25.0, places=2)
            self.assertAlmostEqual(metrics["p85CycleTimeDays"], 30.0, places=2)
            self.assertAlmostEqual(metrics["deliveredStoryPoints"], 16.0, places=2)

            self.assertEqual([point["name"] for point in payload["cycleTimeTrend"]], ["Search 26.3", "Search 26.4"])
            self.assertAlmostEqual(payload["cycleTimeTrend"][0]["cycleTimeDays"], 30.0, places=2)
            self.assertAlmostEqual(payload["cycleTimeTrend"][1]["cycleTimeDays"], 20.0, places=2)

            ongoing = payload["ongoingReleases"]
            self.assertEqual(len(ongoing), 1)
            self.assertEqual(ongoing[0]["name"], "Q4 FY26 - Tech")
            self.assertEqual(ongoing[0]["issueCount"], 2)
            self.assertEqual(ongoing[0]["criticalOpenIssueCount"], 1)
            self.assertEqual(ongoing[0]["riskLevel"], "red")
            self.assertIn("Overdue", ongoing[0]["riskSummary"])
            self.assertTrue(payload["riskSignals"])

            recent = payload["recentReleases"]
            self.assertEqual(recent[0]["name"], "Search 26.4")
            self.assertEqual(recent[1]["name"], "Search 26.3")
            self.assertEqual(recent[1]["doneIssueCount"], 2)
            self.assertEqual(recent[1]["riskLevel"], "green")

    def test_get_release_insights_returns_empty_payload_without_versions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"
            self._init_db(db_path)

            payload = get_release_insights(db_path=str(db_path), project_key="TEAM")

            self.assertEqual(payload["source"], "local")
            self.assertEqual(payload["metrics"]["totalReleases"], 0)
            self.assertEqual(payload["cycleTimeTrend"], [])
            self.assertEqual(payload["ongoingReleases"], [])
            self.assertIn("No JIRA releases found", payload["error"])


if __name__ == "__main__":
    unittest.main()
