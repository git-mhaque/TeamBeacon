"""Regression coverage for incomplete JIRA payloads and recoverable sync failures."""

from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from packages.connectors.models import BoardRecord, IssueRecord, SprintRecord, SyncBatch
from services.api.integrations import jira_sync as sync


def issue(key: str = "TEST-1", updated: datetime | None = None) -> IssueRecord:
    return IssueRecord(
        issue_key=key,
        issue_id=key,
        project_key="TEST",
        issue_type="Story",
        summary="Example",
        status_name="Open",
        status_category="To Do",
        priority=None,
        assignee_account_id=None,
        reporter_account_id=None,
        story_points=None,
        sprint_external_id=None,
        epic_key=None,
        updated_at_source=updated,
    )


class JiraPayloadBoundaryTests(unittest.TestCase):
    def test_dates_accept_source_formats_and_normalize_to_utc(self) -> None:
        expected = datetime(2026, 4, 1, tzinfo=timezone.utc)
        for raw in (
            "2026-04-01",
            "2026-04-01T00:00:00Z",
            "2026-04-01T10:00:00+10:00",
            "2026-04-01T00:00:00",
            " 2026-04-01 ",
        ):
            for parse in (
                sync._parse_jira_date,
                sync._parse_iso_datetime,
                sync._parse_requested_since,
            ):
                with self.subTest(raw=raw, parser=parse.__name__):
                    self.assertEqual(parse(raw), expected)
        for raw in (None, "", "  ", "not-a-date", "2026-02-30"):
            for parse in (
                sync._parse_jira_date,
                sync._parse_iso_datetime,
                sync._parse_requested_since,
            ):
                with self.subTest(raw=raw, parser=parse.__name__):
                    self.assertIsNone(parse(raw))

    def test_release_payload_skips_invalid_entries_and_preserves_valid_metadata(
        self,
    ) -> None:
        payload = {
            "fields": {
                "fixVersions": [
                    None,
                    "invalid",
                    {},
                    {"name": " "},
                    {"name": 123},
                    {
                        "name": " Release A ",
                        "released": True,
                        "releaseDate": "2026-04-01",
                    },
                    {"id": " ", "name": "Release B", "archived": True},
                    {"id": 42, "name": "Release C"},
                ]
            }
        }
        versions = sync._extract_fix_versions_from_raw_json(json.dumps(payload))
        self.assertEqual(
            [(v.version_id, v.name) for v in versions],
            [
                ("Release A", "Release A"),
                ("Release B", "Release B"),
                ("42", "Release C"),
            ],
        )
        self.assertTrue(versions[0].released)
        self.assertEqual(
            versions[0].release_date, datetime(2026, 4, 1, tzinfo=timezone.utc)
        )
        self.assertTrue(versions[1].archived)
        for raw in (None, "", "{", "[]", "{}", '{"fields": null}'):
            with self.subTest(raw=raw):
                self.assertEqual(sync._extract_fix_versions_from_raw_json(raw), [])

    def test_sprint_payloads_support_modern_and_legacy_formats(self) -> None:
        cases = (
            (None, None),
            ({"id": 12}, 12),
            ({"id": "13"}, 13),
            ({"id": "bad"}, None),
            ([{"id": 1}, {"id": 14}], 14),
            ([{"id": "15"}], 15),
            (["Sprint[id=16,name=Current]"], 16),
            ("Sprint[id=17]", 17),
            ("invalid", None),
            (23, None),
            ([], None),
            ([None, "invalid", {"id": "bad"}], None),
        )
        for value, expected in cases:
            with self.subTest(value=value):
                raw = json.dumps({"fields": {"sprint": value}})
                self.assertEqual(
                    sync._extract_sprint_id_from_raw_json(
                        raw, ("customfield_1", "sprint")
                    ),
                    expected,
                )
        for raw in (None, "", "{", "[]", "{}", '{"fields": []}', '{"fields": {}}'):
            with self.subTest(raw=raw):
                self.assertIsNone(
                    sync._extract_sprint_id_from_raw_json(raw, ("sprint",))
                )
        # An explicit empty current field must not revive an older sprint field.
        self.assertIsNone(
            sync._extract_sprint_id_from_fields(
                {"current": None, "sprint": {"id": 9}}, ("current", "sprint")
            )
        )

    def test_incremental_boundaries_preserve_unknown_dates_and_honor_inclusive_mode(
        self,
    ) -> None:
        cursor = datetime(2026, 4, 1)
        older = issue("TEST-1", cursor - timedelta(seconds=1))
        same = issue("TEST-2", cursor.replace(tzinfo=timezone.utc))
        newer = issue("TEST-3", cursor + timedelta(seconds=1))
        unknown = issue("TEST-4")
        records = [older, same, newer, unknown]
        self.assertEqual(
            sync._filter_incremental_issues(records, cursor, inclusive=True),
            [same, newer, unknown],
        )
        self.assertEqual(
            sync._filter_incremental_issues(records, cursor, inclusive=False),
            [newer, unknown],
        )
        self.assertIs(
            sync._filter_incremental_issues(records, None, inclusive=False), records
        )

    def test_sprint_search_deduplicates_and_stops_on_invalid_page_cursor(self) -> None:
        for cursor in ("not-a-number", {}):
            with self.subTest(cursor=cursor):
                connector = Mock()
                connector.search_issues.return_value = (
                    [issue(" TEST-1 "), issue("TEST-1"), issue(" ")],
                    SyncBatch(cursor, True),
                )
                records = sync._fetch_live_issues_for_sprint(connector, 20)
                self.assertEqual([record.issue_key for record in records], ["TEST-1"])
                self.assertEqual(records[0].sprint_external_id, 20)
                self.assertTrue(records[0].sprint_field_present)
                connector.search_issues.assert_called_once_with(
                    jql="sprint = 20 ORDER BY updated ASC",
                    start_at=0,
                    max_results=100,
                )
        connector = Mock()
        connector.search_issues.side_effect = [
            ([issue("TEST-1")], SyncBatch("100", True)),
            ([issue("TEST-2")], SyncBatch(None, False)),
        ]
        self.assertEqual(
            sync._fetch_live_issue_keys_for_sprint(connector, 20), {"TEST-1", "TEST-2"}
        )
        self.assertEqual(connector.search_issues.call_args.kwargs["start_at"], 100)

    def test_active_sprints_are_unique_and_closed_sprints_are_ignored(self) -> None:
        records = [
            SprintRecord(2, 1, "Current", " active "),
            SprintRecord(2, 1, "Current", "active"),
            SprintRecord(1, 1, "Previous", "closed"),
            SprintRecord(3, 1, "Next", "future"),
        ]
        self.assertEqual(sync._active_sprint_ids(records), [2])

    def test_sprint_sanitization_preserves_other_fields_and_unparseable_data(
        self,
    ) -> None:
        for raw in (
            None,
            "",
            "{",
            "[]",
            "{}",
            '{"fields": null}',
            '{"fields": {"summary": "Keep"}}',
        ):
            with self.subTest(raw=raw):
                self.assertEqual(
                    sync._sanitize_raw_json_sprint_fields(raw, ("sprint",)), raw
                )
        raw = json.dumps(
            {
                "fields": {"sprint": [1], "customfield_1": [2], "summary": "Keep"},
                "key": "TEST-1",
            }
        )
        cleaned = sync._sanitize_raw_json_sprint_fields(
            raw, (" customfield_1 ", "", "customfield_1")
        )
        self.assertEqual(
            json.loads(cleaned), {"fields": {"summary": "Keep"}, "key": "TEST-1"}
        )
        self.assertEqual(
            sync._sanitize_raw_json_sprint_fields(cleaned, ("sprint",)), cleaned
        )

    def test_sync_mode_normalization_rejects_unknown_modes(self) -> None:
        self.assertEqual(sync._normalize_sync_mode(None), "full")
        for mode in ("full", "since_last", "since_date"):
            self.assertEqual(sync._normalize_sync_mode(f" {mode.upper()} "), mode)
        with self.assertRaisesRegex(ValueError, "Unsupported sync mode"):
            sync._normalize_sync_mode("surprise")


class JiraManagerFailureTests(unittest.TestCase):
    def test_status_handles_unconfigured_and_unavailable_storage(self) -> None:
        manager = sync.JiraSyncManager(db_path_provider=lambda: "unused.db")
        with (
            patch.object(
                sync, "_load_runtime", side_effect=ValueError("not configured")
            ),
            patch.object(sync, "_read_latest_sync_run") as read,
        ):
            self.assertEqual(manager.get_status()["state"], "idle")
            read.assert_not_called()
        with (
            patch.object(
                sync, "_load_runtime", return_value=SimpleNamespace(board_id=None)
            ),
            patch.object(sync, "_read_latest_sync_run") as read,
        ):
            self.assertEqual(manager.get_status()["state"], "idle")
            read.assert_not_called()
        with (
            patch.object(
                sync, "_load_runtime", return_value=SimpleNamespace(board_id=1)
            ),
            patch.object(sync, "_read_latest_sync_run", side_effect=OSError("locked")),
        ):
            self.assertEqual(manager.get_status()["state"], "idle")

    def test_running_sync_is_not_restarted_or_reconciled(self) -> None:
        manager = sync.JiraSyncManager(db_path_provider=lambda: "unused.db")
        with (
            patch.object(sync.threading, "Thread") as thread,
            patch.object(sync, "_load_runtime") as runtime,
            patch.object(sync, "_read_sync_history", return_value=[]) as history,
        ):
            self.assertTrue(manager.start()["started"])
            self.assertFalse(manager.start()["started"])
            self.assertEqual(manager.get_status()["state"], "running")
            self.assertEqual(manager.get_history(500), [])
            history.assert_called_once_with("unused.db", 200)
            runtime.assert_not_called()
            thread.return_value.start.assert_called_once()

    def test_invalid_since_date_is_rejected_before_starting_worker(self) -> None:
        manager = sync.JiraSyncManager()
        for raw in (None, "invalid", "2999-01-01"):
            with (
                self.subTest(raw=raw),
                patch.object(sync.threading, "Thread") as thread,
            ):
                with self.assertRaises(ValueError):
                    manager.start(mode="since_date", since_date=raw)
                thread.assert_not_called()
                self.assertEqual(manager._snapshot()["state"], "idle")

    def test_worker_failure_preserves_progress_and_records_terminal_state(self) -> None:
        runner = Mock(side_effect=OSError("network disconnected"))
        manager = sync.JiraSyncManager(
            db_path_provider=lambda: "unused.db", sync_runner=runner
        )
        manager._update_progress({"boardsSynced": 1, "downloadedIssues": 4})
        manager._run_background("since_date", "2026-04-01", False)
        state = manager._snapshot()
        self.assertEqual(state["state"], "failed")
        self.assertEqual(state["phase"], "failed")
        self.assertEqual(state["boardsSynced"], 1)
        self.assertEqual(state["downloadedIssues"], 4)
        self.assertEqual(state["requestedSince"], "2026-04-01")
        self.assertEqual(state["error"], "network disconnected")
        self.assertIsNotNone(state["finishedAt"])
        self.assertFalse(runner.call_args.kwargs["reconcile_deleted_issues"])

    def test_public_functions_forward_parameters_and_results(self) -> None:
        with patch.object(sync, "JIRA_SYNC_MANAGER") as manager:
            manager.get_status.return_value = {"state": "idle"}
            manager.start.return_value = {"started": True}
            manager.get_history.return_value = [{"id": 1}]
            self.assertEqual(sync.get_jira_sync_status(), {"state": "idle"})
            self.assertEqual(
                sync.start_jira_sync("since_date", "2026-04-01", False),
                {"started": True},
            )
            manager.start.assert_called_once_with(
                mode="since_date",
                since_date="2026-04-01",
                reconcile_deleted_issues=False,
            )
            self.assertEqual(
                sync.get_jira_sync_history(5),
                {"source": "jira", "history": [{"id": 1}]},
            )
            manager.get_history.assert_called_once_with(limit=5)

    def test_default_paths_and_failed_logging_do_not_abort_sync(self) -> None:
        with (
            patch.dict("os.environ", {}, clear=True),
            patch.object(sync, "load_env_files"),
        ):
            root = Path(sync.__file__).resolve().parents[3]
            self.assertEqual(sync._resolve_db_path(), str(root / "teambeacon.db"))
            self.assertEqual(sync._resolve_log_dir(), root / "logs")
        with tempfile.TemporaryDirectory() as directory:
            # A regular file cannot also be a log directory.
            parent = Path(directory) / "file"
            parent.write_text("occupied", encoding="utf-8")
            self.assertIsNone(sync._write_sync_log("progress", {}, parent / "sync.log"))
            self.assertEqual(parent.read_text(encoding="utf-8"), "occupied")


class JiraCheckpointRecoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.db_path = str(Path(directory.name) / "sync.db")
        self.conn = sqlite3.connect(self.db_path)
        self.addCleanup(self.conn.close)
        sync._ensure_schema(self.conn)
        self.conn.commit()
        runtime = patch.object(
            sync,
            "_load_runtime",
            return_value=SimpleNamespace(board_id=1, project_key=None),
        )
        runtime.start()
        self.addCleanup(runtime.stop)

    def insert_run(self, board_id: int | None = 1, scope: str = "board:1") -> int:
        return sync._insert_sync_run(
            self.conn,
            scope_key=scope,
            board_external_id=board_id,
            board_name="Example",
            sync_mode="full",
            requested_since=None,
            started_at="2026-04-01T00:00:00+00:00",
        )

    def test_cursor_fallback_order_prefers_source_data_over_checkpoint_and_run_clock(
        self,
    ) -> None:
        scope = "board:1"
        self.assertIsNone(sync._read_since_last_cursor(self.db_path, scope))
        run_id = self.insert_run()
        sync._update_sync_run(
            self.conn, run_id, status="completed", finished_at="2026-04-04T00:00:00Z"
        )
        self.conn.commit()
        self.assertEqual(
            sync._read_since_last_cursor(self.db_path, scope),
            datetime(2026, 4, 4, tzinfo=timezone.utc),
        )
        sync._upsert_checkpoint(
            self.conn, scope, status="completed", last_synced_at="2026-04-03T00:00:00Z"
        )
        self.conn.commit()
        self.assertEqual(
            sync._read_since_last_cursor(self.db_path, scope),
            datetime(2026, 4, 3, tzinfo=timezone.utc),
        )
        sync._upsert_checkpoint(
            self.conn, scope, status="completed", last_cursor="2026-04-02T00:00:00Z"
        )
        self.conn.commit()
        self.assertEqual(
            sync._read_since_last_cursor(self.db_path, scope),
            datetime(2026, 4, 2, tzinfo=timezone.utc),
        )
        sync._upsert_issues(
            self.conn, [issue(updated=datetime(2026, 4, 1, tzinfo=timezone.utc))]
        )
        self.conn.commit()
        self.assertEqual(
            sync._read_since_last_cursor(self.db_path, scope),
            datetime(2026, 4, 1, tzinfo=timezone.utc),
        )

    def test_freshness_read_leaves_interrupted_run_and_checkpoint_untouched(
        self,
    ) -> None:
        run_id = self.insert_run()
        sync._upsert_checkpoint(
            self.conn,
            "board:1",
            status="running",
            last_synced_at="2026-03-31T00:00:00Z",
        )
        self.conn.commit()
        with patch.object(sync, "_resolve_db_path", return_value=self.db_path):
            self.assertEqual(sync.get_jira_data_as_of(), "2026-03-31T00:00:00Z")
        self.assertEqual(
            self.conn.execute(
                "SELECT status FROM sync_run_history WHERE id = ?", (run_id,)
            ).fetchone(),
            ("running",),
        )
        self.assertEqual(
            sync._read_checkpoint(self.db_path, "board:1")["status"], "running"
        )

    def test_stale_run_recovery_estimates_counts_and_is_idempotent(self) -> None:
        # Cover each supported estimate: project, sprint membership, and total
        # database count when a run has no matching board or usable configuration.
        cases = (
            (1, "TEST", None, False),
            (1, None, 20, False),
            (1, "OTHER", None, False),
            (None, None, None, True),
            (1, None, None, True),
        )
        for board_id, project_key, sprint_id, unavailable_config in cases:
            with self.subTest(
                board_id=board_id,
                project=project_key,
                sprint=sprint_id,
                no_config=unavailable_config,
            ):
                self.conn.execute("DELETE FROM sync_run_history")
                self.conn.execute("DELETE FROM sync_checkpoints")
                self.conn.execute("DELETE FROM issues")
                self.conn.execute("DELETE FROM sprints")
                self.conn.execute("DELETE FROM boards")
                if board_id is not None:
                    sync._upsert_board(
                        self.conn, BoardRecord(board_id, "Example", project_key)
                    )
                if sprint_id is not None:
                    sync._upsert_sprints(
                        self.conn,
                        [SprintRecord(sprint_id, board_id, "Current", "active")],
                    )
                record = issue()
                record.sprint_external_id = sprint_id
                sync._upsert_issues(self.conn, [record])
                run_id = self.insert_run(board_id)
                sync._upsert_checkpoint(self.conn, "board:1", status="running")
                self.conn.commit()
                with patch.object(
                    sync,
                    "_load_runtime",
                    side_effect=ValueError("missing") if unavailable_config else None,
                    return_value=SimpleNamespace(project_key=None),
                ):
                    recovered = sync._mark_stale_run_failed(
                        self.db_path, run_id, "board:1", "Interrupted"
                    )
                    self.assertEqual(recovered["status"], "failed")
                    self.assertEqual(recovered["issuesSynced"], 1)
                    self.assertEqual(recovered["totalIssues"], 1)
                    self.assertEqual(recovered["error"], "Interrupted")
                    self.assertIsNotNone(recovered["finishedAt"])
                    self.assertEqual(
                        sync._read_checkpoint(self.db_path, "board:1")["status"],
                        "failed",
                    )
                    self.assertEqual(
                        sync._mark_stale_run_failed(
                            self.db_path, run_id, "board:1", "Again"
                        ),
                        recovered,
                    )

    def test_history_estimates_incomplete_runs_but_keeps_completed_counts(self) -> None:
        sync._upsert_board(self.conn, BoardRecord(1, "Example", "TEST"))
        sync._upsert_issues(self.conn, [issue()])
        completed_id = self.insert_run()
        sync._update_sync_run(
            self.conn, completed_id, status="completed", issues_synced=0
        )
        failed_id = self.insert_run()
        sync._update_sync_run(self.conn, failed_id, status="failed")
        unknown_board_id = self.insert_run(None, "unknown")
        self.conn.commit()
        with patch.object(sync, "_load_runtime", side_effect=ValueError("missing")):
            history = {
                run["id"]: run for run in sync._read_sync_history(self.db_path, 20)
            }
        self.assertEqual(history[completed_id]["issuesSynced"], 0)
        self.assertEqual(history[failed_id]["issuesSynced"], 1)
        self.assertEqual(history[failed_id]["totalIssues"], 1)
        self.assertEqual(history[unknown_board_id]["issuesSynced"], 1)

    def test_missing_run_and_empty_update_preserve_existing_history(self) -> None:
        self.assertIsNone(
            sync._mark_stale_run_failed(self.db_path, 999, "missing", "Interrupted")
        )
        run_id = self.insert_run()
        sync._update_sync_run(self.conn, run_id)
        self.conn.commit()
        self.assertEqual(sync._read_latest_sync_run(self.db_path)["status"], "running")
