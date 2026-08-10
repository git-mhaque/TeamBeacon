from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from services.api.issues.team_dashboard import get_team_dashboard


class TeamDashboardServiceUnitTests(unittest.TestCase):
    @patch("services.api.issues.team_dashboard.get_current_sprint_changes")
    @patch("services.api.issues.team_dashboard.get_team_insights")
    @patch("services.api.issues.team_dashboard.get_release_insights")
    @patch("services.api.issues.team_dashboard.get_initiative_deep_dive")
    @patch("services.api.issues.team_dashboard.get_configured_epic_summary")
    @patch("services.api.issues.team_dashboard.get_epic_lookup_config")
    def test_builds_operational_dashboard_snapshot(
        self,
        lookup_mock,
        summary_mock,
        deep_dive_mock,
        release_mock,
        team_mock,
        changes_mock,
    ) -> None:
        lookup_mock.return_value = {
            "groups": [{"id": 1, "name": "Platform"}, {"id": 2, "name": "Operations"}],
            "workTypes": [],
        }
        summary_mock.return_value = {
            "epics": [
                {
                    "epicKey": "TB-100",
                    "totalCards": 10,
                    "completedCards": 6,
                    "groups": [{"id": 1, "name": "Platform"}],
                },
                {
                    "epicKey": "TB-200",
                    "totalCards": 4,
                    "completedCards": 4,
                    "groups": [{"id": 2, "name": "Operations"}],
                },
            ]
        }

        def deep_dive_side_effect(**kwargs):  # noqa: ANN003
            group_id = int(kwargs["group_ids"][0])
            if group_id == 1:
                return {
                    "chartRange": {"startDate": "2026-07-20", "endDate": "2026-08-11"},
                    "weekly": [
                        {"newCount": 3, "completedCount": 1},
                        {"newCount": 2, "completedCount": 4},
                    ],
                    "currentWipCount": 3,
                    "cards": [
                        {
                            "issueKey": "TB-123",
                            "issueUrl": "https://jira.example/browse/TB-123",
                            "summary": "Ship dashboard service",
                            "epicKey": "TB-100",
                            "epicName": "Platform delivery",
                            "completedAt": "2026-08-10T04:00:00+00:00",
                        },
                        {"issueKey": "TB-OLD", "completedAt": "2026-07-01T04:00:00+00:00"},
                        {"issueKey": "TB-BAD", "completedAt": "not-a-date"},
                    ],
                    "error": None,
                }
            return {
                "chartRange": {"startDate": "2026-07-20", "endDate": "2026-08-11"},
                "weekly": [{"newCount": 1, "completedCount": 2}],
                "currentWipCount": 0,
                "cards": [
                    {
                        "issueKey": "TB-456",
                        "summary": "Complete release automation",
                        "epicKey": "TB-200",
                        "epicName": "Operations delivery",
                        "completedAt": "2026-08-09T04:00:00Z",
                    }
                ],
                "error": None,
            }

        deep_dive_mock.side_effect = deep_dive_side_effect
        release_mock.return_value = {
            "recentReleases": [
                {
                    "versionId": "9",
                    "name": "August Release",
                    "releaseDate": "2026-08-08T00:00:00+00:00",
                    "cycleTimeDays": 18.0,
                }
            ],
            "error": None,
        }
        team_mock.return_value = {
            "trend": [
                {"sprintId": 10, "sprintName": "Sprint 10", "state": "closed", "avgCycleTimeDays": 6.0},
                {"sprintId": 11, "sprintName": "Sprint 11", "state": "closed", "avgCycleTimeDays": 4.5},
                {"sprintId": 12, "sprintName": "Sprint 12", "state": "active", "avgCycleTimeDays": 2.0},
            ],
            "error": None,
        }
        changes_mock.return_value = {
            "sprint": {"id": 12, "name": "Sprint 12"},
            "changes": {
                "blockedCards": {
                    "count": 2,
                    "storyPointsTotal": 8,
                    "issueCards": [
                        {"issueKey": "TB-77", "summary": "Blocked delivery"},
                        {"issueKey": "TB-78", "summary": "Blocked integration"},
                    ],
                }
            },
            "error": None,
        }

        payload = get_team_dashboard(
            flow_weeks=4,
            recent_limit=1,
            timezone_name="Australia/Melbourne",
            db_path="/tmp/test.db",
            now=datetime(2026, 8, 11, 0, 0, tzinfo=timezone.utc),
        )

        self.assertEqual(payload["flowPeriod"]["startDate"], "2026-07-20")
        self.assertEqual([row["name"] for row in payload["workStreams"]], ["Operations", "Platform"])
        platform = payload["workStreams"][1]
        self.assertEqual(platform["newCount"], 5)
        self.assertEqual(platform["completedCount"], 5)
        self.assertEqual(platform["completionPercent"], 60.0)
        self.assertEqual(payload["latestRelease"]["name"], "August Release")
        self.assertEqual(payload["sprintCycleTime"]["latestSprintName"], "Sprint 11")
        self.assertEqual(payload["sprintCycleTime"]["deltaDays"], -1.5)
        self.assertEqual(payload["sprintCycleTime"]["direction"], "down")
        self.assertEqual(payload["blockedItems"]["count"], 2)
        self.assertEqual(len(payload["blockedItems"]["items"]), 1)
        self.assertEqual(payload["recentlyCompleted"]["count"], 2)
        self.assertEqual(payload["recentlyCompleted"]["items"][0]["issueKey"], "TB-123")
        self.assertEqual(payload["errors"], {})

    @patch("services.api.issues.team_dashboard.get_current_sprint_changes")
    @patch("services.api.issues.team_dashboard.get_team_insights")
    @patch("services.api.issues.team_dashboard.get_release_insights")
    @patch("services.api.issues.team_dashboard.get_initiative_deep_dive")
    @patch("services.api.issues.team_dashboard.get_configured_epic_summary")
    @patch("services.api.issues.team_dashboard.get_epic_lookup_config")
    def test_isolates_section_failures_and_handles_missing_comparisons(
        self,
        lookup_mock,
        summary_mock,
        deep_dive_mock,
        release_mock,
        team_mock,
        changes_mock,
    ) -> None:
        lookup_mock.return_value = {"groups": [{"id": 4, "name": "Security"}]}
        summary_mock.side_effect = RuntimeError("progress unavailable")
        deep_dive_mock.side_effect = RuntimeError("flow unavailable")
        release_mock.return_value = {"recentReleases": [], "error": "release unavailable"}
        team_mock.return_value = {
            "trend": [{"sprintId": 3, "state": "active", "avgCycleTimeDays": 2.0}],
            "error": None,
        }
        changes_mock.return_value = {"sprint": None, "changes": {}, "error": None}

        payload = get_team_dashboard(now=datetime(2026, 8, 11, tzinfo=timezone.utc))

        self.assertEqual(payload["workStreams"][0]["completionPercent"], 0.0)
        self.assertEqual(payload["workStreams"][0]["error"], "flow unavailable")
        self.assertIsNone(payload["latestRelease"])
        self.assertIsNone(payload["sprintCycleTime"])
        self.assertEqual(payload["blockedItems"]["items"], [])
        self.assertEqual(payload["recentlyCompleted"]["items"], [])
        self.assertEqual(payload["errors"]["progress"], "progress unavailable")
        self.assertEqual(payload["errors"]["release"], "release unavailable")

    def test_validates_dashboard_query_controls(self) -> None:
        for kwargs, expected in (
            ({"flow_weeks": "bad"}, "flowWeeks"),
            ({"flow_weeks": 2}, "flowWeeks"),
            ({"recent_limit": "bad"}, "recentLimit"),
            ({"recent_limit": 0}, "recentLimit"),
        ):
            with self.subTest(kwargs=kwargs):
                with self.assertRaisesRegex(ValueError, expected):
                    get_team_dashboard(**kwargs)


if __name__ == "__main__":
    unittest.main()
