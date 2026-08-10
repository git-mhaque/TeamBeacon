from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sqlite3
import tempfile
import unittest
from zoneinfo import ZoneInfo

from services.api.issues.initiative_deep_dive import get_initiative_deep_dive
from services.api.metadata.epic_config import add_epic_group, upsert_epic_metadata


class InitiativeDeepDiveServiceUnitTests(unittest.TestCase):
    def _seed_database(self, db_path: str) -> tuple[int, int]:
        platform = add_epic_group("Platform", db_path=db_path)
        operations = add_epic_group("Operations", db_path=db_path)
        conn = sqlite3.connect(db_path)
        try:
            for key, summary in (
                ("TB-100", "Platform foundations"),
                ("TB-200", "Platform experience"),
                ("TB-300", "Operations uplift"),
            ):
                conn.execute(
                    """
                    INSERT INTO issues (
                      issue_key, issue_id, issue_type, summary, status_name, status_category,
                      created_at_source, updated_at_source, synced_at
                    ) VALUES (?, ?, 'Epic', ?, 'In Progress', 'In Progress', ?, ?, ?)
                    """,
                    (key, f"id-{key}", summary, "2026-01-01T00:00:00+00:00", "2026-08-10T00:00:00+00:00", "2026-08-10T00:00:00+00:00"),
                )
            conn.commit()
        finally:
            conn.close()

        upsert_epic_metadata(
            epic_key="TB-100", success_criteria=[], group_ids=[platform["id"]], work_type_ids=[], db_path=db_path
        )
        upsert_epic_metadata(
            epic_key="TB-200", success_criteria=[], group_ids=[platform["id"]], work_type_ids=[], db_path=db_path
        )
        upsert_epic_metadata(
            epic_key="TB-300", success_criteria=[], group_ids=[operations["id"]], work_type_ids=[], db_path=db_path
        )

        conn = sqlite3.connect(db_path)
        try:
            self._insert_issue(
                conn,
                key="TB-1",
                epic_key="TB-100",
                status="Done",
                category="Done",
                created_at="2026-08-04T02:00:00+00:00",
                resolved_at="2026-08-09T03:00:00+00:00",
                story_points=5,
            )
            self._insert_issue(
                conn,
                key="TB-2",
                epic_key="TB-100",
                status="In Progress",
                category="In Progress",
                created_at="2026-07-20T02:00:00+00:00",
                resolved_at=None,
                story_points=3,
            )
            self._insert_status_change(
                conn,
                key="TB-2",
                changed_at="2026-08-05T01:00:00+00:00",
                from_value="To Do",
                to_value="In Progress",
            )
            self._insert_issue(
                conn,
                key="TB-3",
                epic_key="TB-200",
                status="To Do",
                category="To Do",
                created_at="2026-07-28T02:00:00+00:00",
                resolved_at=None,
            )
            self._insert_issue(
                conn,
                key="TB-4",
                epic_key="TB-200",
                status="Done",
                category="Done",
                created_at="2026-06-01T02:00:00+00:00",
                resolved_at="2026-07-30T02:00:00+00:00",
            )
            self._insert_issue(
                conn,
                key="TB-5",
                epic_key="TB-100",
                status="Release Ready",
                category="In Progress",
                created_at="2026-03-01T02:00:00+00:00",
                resolved_at=None,
            )
            self._insert_status_change(
                conn,
                key="TB-5",
                changed_at="2026-04-01T01:00:00+00:00",
                from_value="Open",
                to_value="In Progress",
            )
            self._insert_status_change(
                conn,
                key="TB-5",
                changed_at="2026-04-10T01:00:00+00:00",
                from_value="In Progress",
                to_value="Release Ready",
            )
            self._insert_issue(
                conn,
                key="TB-6",
                epic_key="TB-100",
                status="To Do",
                category="To Do",
                created_at="2026-01-01T02:00:00+00:00",
                resolved_at=None,
            )
            self._insert_resolution_change(
                conn,
                key="TB-6",
                changed_at="2026-08-06T01:00:00+00:00",
                from_value=None,
                to_value="Complete",
            )
            self._insert_resolution_change(
                conn,
                key="TB-6",
                changed_at="2026-08-07T01:00:00+00:00",
                from_value="Complete",
                to_value=None,
            )
            self._insert_issue(
                conn,
                key="TB-7",
                epic_key="TB-100",
                status="Done",
                category="Done",
                created_at="2026-01-01T02:00:00+00:00",
                resolved_at=None,
            )
            self._insert_resolution_change(
                conn,
                key="TB-7",
                changed_at="2026-08-08T01:00:00+00:00",
                from_value=None,
                to_value="Complete",
            )
            self._insert_issue(
                conn,
                key="TB-8",
                epic_key="TB-100",
                status="Done",
                category="Done",
                created_at="2026-08-05T02:00:00+00:00",
                resolved_at="2026-08-06T02:00:00+00:00",
                issue_type="Sub-task",
            )
            self._insert_issue(
                conn,
                key="TB-9",
                epic_key="TB-300",
                status="Done",
                category="Done",
                created_at="2026-08-05T02:00:00+00:00",
                resolved_at="2026-08-06T02:00:00+00:00",
            )
            conn.commit()
        finally:
            conn.close()
        return int(platform["id"]), int(operations["id"])

    @staticmethod
    def _insert_issue(
        conn: sqlite3.Connection,
        *,
        key: str,
        epic_key: str,
        status: str,
        category: str,
        created_at: str,
        resolved_at: str | None,
        story_points: float | None = None,
        issue_type: str = "Story",
    ) -> None:
        conn.execute(
            """
            INSERT INTO issues (
              issue_key, issue_id, issue_type, summary, status_name, status_category,
              story_points, epic_key, parent_issue_key, created_at_source,
              updated_at_source, resolved_at_source, synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                key,
                f"id-{key}",
                issue_type,
                f"Summary for {key}",
                status,
                category,
                story_points,
                epic_key,
                epic_key,
                created_at,
                "2026-08-10T00:00:00+00:00",
                resolved_at,
                "2026-08-10T00:00:00+00:00",
            ),
        )

    @staticmethod
    def _insert_status_change(
        conn: sqlite3.Connection,
        *,
        key: str,
        changed_at: str,
        from_value: str | None,
        to_value: str | None,
    ) -> None:
        conn.execute(
            """
            INSERT INTO issue_changelog (
              issue_key, changed_at, field_name, from_value, to_value
            ) VALUES (?, ?, 'status', ?, ?)
            """,
            (key, changed_at, from_value, to_value),
        )

    @staticmethod
    def _insert_resolution_change(
        conn: sqlite3.Connection,
        *,
        key: str,
        changed_at: str,
        from_value: str | None,
        to_value: str | None,
    ) -> None:
        conn.execute(
            """
            INSERT INTO issue_changelog (
              issue_key, changed_at, field_name, from_value, to_value
            ) VALUES (?, ?, 'resolution', ?, ?)
            """,
            (key, changed_at, from_value, to_value),
        )

    def test_builds_weekly_flow_periods_and_activity_rows(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = str(Path(tmp_dir) / "teambeacon.db")
            platform_id, _ = self._seed_database(db_path)

            payload = get_initiative_deep_dive(
                group_id=platform_id,
                table_window_weeks=2,
                timezone_name="Australia/Melbourne",
                db_path=db_path,
                now=datetime(2026, 8, 10, 12, 0, tzinfo=ZoneInfo("Australia/Melbourne")),
                jira_base_url="https://jira.example.test/",
            )

            self.assertEqual(payload["scope"], "initiative-deep-dive")
            self.assertEqual(payload["group"]["name"], "Platform")
            self.assertEqual(payload["group"]["epicCount"], 2)
            self.assertEqual(payload["selectionMode"], "all")
            self.assertEqual(payload["selectedEpicKeys"], [])
            self.assertEqual(len(payload["weekly"]), 12)
            self.assertEqual(
                payload["chartRange"],
                {"startDate": "2026-05-25", "endDate": "2026-08-10", "days": 78},
            )
            self.assertEqual(payload["weekly"][-1]["weekStart"], "2026-08-10")
            self.assertEqual(payload["weekly"][-2]["newCount"], 1)
            self.assertEqual(payload["weekly"][-2]["completedCount"], 2)

            period_two = next(period for period in payload["periods"] if period["weeks"] == 2)
            self.assertEqual(period_two["newCount"], 1)
            self.assertEqual(period_two["completedCount"], 2)
            self.assertEqual(period_two["netFlow"], -1)
            self.assertEqual([period["weeks"] for period in payload["periods"]], [1, 2, 4, 12, 26, 52])
            self.assertEqual(payload["currentWipCount"], 2)
            self.assertEqual(payload["tableCounts"], {"all": 3, "new": 1, "inProgress": 1, "completed": 2})

            cards_by_key = {card["issueKey"]: card for card in payload["cards"]}
            self.assertEqual(set(cards_by_key), {"TB-1", "TB-2", "TB-7"})
            self.assertEqual(cards_by_key["TB-1"]["activityTypes"], ["new", "completed"])
            self.assertEqual(cards_by_key["TB-1"]["issueUrl"], "https://jira.example.test/browse/TB-1")
            self.assertEqual(cards_by_key["TB-1"]["epicUrl"], "https://jira.example.test/browse/TB-100")
            self.assertEqual(cards_by_key["TB-2"]["activityTypes"], ["in_progress"])
            self.assertEqual(cards_by_key["TB-2"]["inProgressStartedAt"], "2026-08-05T01:00:00+00:00")
            self.assertEqual(cards_by_key["TB-7"]["completedAt"], "2026-08-08T01:00:00+00:00")
            self.assertNotIn("TB-6", cards_by_key, "A reopened card must not count as completed")
            self.assertNotIn("TB-8", cards_by_key, "Subtasks must not contribute to initiative flow")
            self.assertNotIn("TB-9", cards_by_key, "Cards from another group must be excluded")

    def test_supports_custom_chart_range_with_partial_week_buckets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = str(Path(tmp_dir) / "teambeacon.db")
            platform_id, _ = self._seed_database(db_path)

            payload = get_initiative_deep_dive(
                group_id=platform_id,
                chart_start="2026-08-01",
                chart_end="2026-08-09",
                timezone_name="Australia/Melbourne",
                db_path=db_path,
                now=datetime(2026, 8, 10, 12, 0, tzinfo=ZoneInfo("Australia/Melbourne")),
            )

            self.assertEqual(payload["chartRange"], {
                "startDate": "2026-08-01",
                "endDate": "2026-08-09",
                "days": 9,
            })
            self.assertEqual(payload["reportingPeriod"], payload["chartRange"])
            self.assertEqual(payload["selectedPeriod"], {
                "weeks": None,
                "startDate": "2026-08-01",
                "endDate": "2026-08-09",
                "days": 9,
            })
            self.assertEqual(payload["chartWeeks"], 2)
            self.assertEqual(
                [(bucket["weekStart"], bucket["weekEnd"]) for bucket in payload["weekly"]],
                [("2026-08-01", "2026-08-02"), ("2026-08-03", "2026-08-09")],
            )
            self.assertEqual(payload["weekly"][0]["newCount"], 0)
            self.assertEqual(payload["weekly"][1]["newCount"], 1)
            self.assertEqual(payload["weekly"][1]["completedCount"], 2)
            self.assertEqual(payload["tableCounts"], {"all": 3, "new": 1, "inProgress": 1, "completed": 2})
            self.assertEqual({card["issueKey"] for card in payload["cards"]}, {"TB-1", "TB-2", "TB-7"})

    def test_filters_selected_epics_activity_and_current_wip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = str(Path(tmp_dir) / "teambeacon.db")
            platform_id, _ = self._seed_database(db_path)
            now = datetime(2026, 8, 10, 12, 0, tzinfo=ZoneInfo("Australia/Melbourne"))

            selected = get_initiative_deep_dive(
                group_id=platform_id,
                epic_keys=["tb-200", "TB-200"],
                table_window_weeks=4,
                activity="new",
                timezone_name="Australia/Melbourne",
                db_path=db_path,
                now=now,
            )
            self.assertEqual(selected["selectedEpicKeys"], ["TB-200"])
            self.assertEqual(selected["selectionMode"], "selected")
            self.assertEqual([card["issueKey"] for card in selected["cards"]], ["TB-3"])

            current_wip = get_initiative_deep_dive(
                group_id=platform_id,
                table_window_weeks=1,
                activity="current_wip",
                timezone_name="Australia/Melbourne",
                db_path=db_path,
                now=now,
            )
            self.assertEqual({card["issueKey"] for card in current_wip["cards"]}, {"TB-2", "TB-5"})
            self.assertEqual(current_wip["count"], 2)
            old_wip = next(card for card in current_wip["cards"] if card["issueKey"] == "TB-5")
            self.assertEqual(old_wip["activityTypes"], ["in_progress"])
            self.assertEqual(old_wip["inProgressStartedAt"], "2026-04-01T01:00:00+00:00")

    def test_combines_multiple_groups_and_deduplicates_shared_epics(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = str(Path(tmp_dir) / "teambeacon.db")
            platform_id, operations_id = self._seed_database(db_path)
            conn = sqlite3.connect(db_path)
            try:
                conn.execute(
                    """
                    INSERT INTO epic_metadata_groups (epic_metadata_id, group_id)
                    SELECT id, ? FROM epic_metadata WHERE epic_key = 'TB-100'
                    """,
                    (operations_id,),
                )
                conn.commit()
            finally:
                conn.close()

            payload = get_initiative_deep_dive(
                group_ids=[platform_id, operations_id, platform_id],
                table_window_weeks=2,
                timezone_name="Australia/Melbourne",
                db_path=db_path,
                now=datetime(2026, 8, 10, 12, 0, tzinfo=ZoneInfo("Australia/Melbourne")),
            )

            self.assertIsNone(payload["group"])
            self.assertEqual(payload["selectedGroupIds"], [platform_id, operations_id])
            self.assertEqual([group["name"] for group in payload["groups"]], ["Platform", "Operations"])
            self.assertEqual(
                [epic["epicKey"] for epic in payload["epicOptions"]],
                ["TB-300", "TB-200", "TB-100"],
            )
            self.assertEqual(len(payload["epicOptions"]), len({epic["epicKey"] for epic in payload["epicOptions"]}))
            issue_keys = [card["issueKey"] for card in payload["cards"]]
            self.assertEqual(set(issue_keys), {"TB-1", "TB-2", "TB-7", "TB-9"})
            self.assertEqual(len(issue_keys), len(set(issue_keys)))

    def test_rejects_invalid_scope_and_query_values(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = str(Path(tmp_dir) / "teambeacon.db")
            platform_id, _ = self._seed_database(db_path)

            invalid_calls = (
                ({"group_ids": []}, "groupId"),
                ({"group_id": "not-a-number"}, "groupId"),
                ({"group_id": 0}, "groupId"),
                ({"group_id": 999}, "Unknown groupId"),
                ({"group_id": platform_id, "epic_keys": [7]}, "epicKey"),
                ({"group_id": platform_id, "epic_keys": ["TB-300"]}, "selected group"),
                ({"group_id": platform_id, "table_window_weeks": "invalid"}, "tableWindowWeeks"),
                ({"group_id": platform_id, "table_window_weeks": 3}, "tableWindowWeeks"),
                ({"group_id": platform_id, "chart_weeks": "invalid"}, "chartWeeks"),
                ({"group_id": platform_id, "chart_weeks": 0}, "chartWeeks"),
                ({"group_id": platform_id, "chart_start": "2026-08-01"}, "both be provided"),
                ({"group_id": platform_id, "chart_start": "not-a-date", "chart_end": "2026-08-01"}, "chartStart"),
                ({"group_id": platform_id, "chart_start": "2026-08-02", "chart_end": "2026-08-01"}, "cannot be after"),
                ({
                    "group_id": platform_id,
                    "chart_start": "2026-08-01",
                    "chart_end": "2026-08-11",
                    "now": datetime(2026, 8, 10, 12, 0, tzinfo=timezone.utc),
                }, "after today"),
                ({
                    "group_id": platform_id,
                    "chart_start": "2025-08-09",
                    "chart_end": "2026-08-10",
                    "now": datetime(2026, 8, 10, 12, 0, tzinfo=timezone.utc),
                }, "366 days"),
                ({"group_id": platform_id, "activity": "stale"}, "activity"),
                ({"group_id": platform_id, "timezone_name": "Mars/Olympus"}, "Unknown timezone"),
                ({"group_id": platform_id, "limit": "invalid"}, "limit"),
                ({"group_id": platform_id, "limit": 0}, "limit"),
            )
            for kwargs, expected_message in invalid_calls:
                with self.subTest(kwargs=kwargs):
                    with self.assertRaisesRegex(ValueError, expected_message):
                        get_initiative_deep_dive(db_path=db_path, **kwargs)

    def test_returns_zero_filled_windows_for_a_group_without_epics(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = str(Path(tmp_dir) / "teambeacon.db")
            self._seed_database(db_path)
            empty_group = add_epic_group("No configured epics", db_path=db_path)

            payload = get_initiative_deep_dive(
                group_id=empty_group["id"],
                epic_keys=["", "  "],
                chart_weeks=2,
                timezone_name=None,
                limit=5_000,
                db_path=db_path,
                now=datetime(2026, 8, 10, 12, 0),
            )

            self.assertEqual(payload["selectionMode"], "all")
            self.assertEqual(payload["selectedGroupIds"], [empty_group["id"]])
            self.assertEqual([group["name"] for group in payload["groups"]], ["No configured epics"])
            self.assertEqual(payload["epicOptions"], [])
            self.assertEqual(payload["chartWeeks"], 2)
            self.assertEqual(len(payload["weekly"]), 2)
            self.assertTrue(all(bucket["newCount"] == 0 for bucket in payload["weekly"]))
            self.assertEqual([period["weeks"] for period in payload["periods"]], [1, 2, 4, 12, 26, 52])
            self.assertEqual(payload["reportingPeriod"], {
                "startDate": "2026-08-03",
                "endDate": "2026-08-10",
                "days": 8,
            })
            self.assertEqual(payload["selectedPeriod"], {
                "weeks": None,
                "startDate": "2026-08-03",
                "endDate": "2026-08-10",
                "days": 8,
            })
            self.assertEqual(payload["limit"], 1_000)
            self.assertEqual(payload["cards"], [])


if __name__ == "__main__":
    unittest.main()
