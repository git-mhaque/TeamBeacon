from __future__ import annotations

import sqlite3
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
import re

from packages.connectors.jira_config import JiraRuntimeConfig
from packages.connectors.models import ChangelogItemRecord, BoardRecord, IssueRecord, SprintRecord, SyncBatch
from services.api.integrations.jira_sync import (
    JiraSyncManager,
    _backfill_missing_sprint_external_ids,
    _ensure_schema,
    _upsert_issues,
    run_jira_sync_once,
)


class _SuccessfulConnectorStub:
    def __init__(self) -> None:
        self.incremental_cursor: datetime | None = None
        self.issue_1 = IssueRecord(
            issue_key="CEGBUPOL-1",
            issue_id="1",
            project_key="CEGBUPOL",
            issue_type="Story",
            summary="First issue",
            status_name="Done",
            status_category="Done",
            priority="Medium",
            assignee_account_id="u1",
            reporter_account_id="u2",
            story_points=3.0,
            sprint_external_id=901,
            epic_key="CEGBUPOL-EPIC-1",
            labels=["ops"],
            components=["api"],
            created_at_source=datetime(2026, 3, 20, 10, 0, tzinfo=timezone.utc),
            updated_at_source=datetime(2026, 3, 21, 10, 0, tzinfo=timezone.utc),
            resolved_at_source=datetime(2026, 3, 22, 10, 0, tzinfo=timezone.utc),
            raw={"id": "1", "key": "CEGBUPOL-1"},
        )
        self.issue_2 = IssueRecord(
            issue_key="CEGBUPOL-2",
            issue_id="2",
            project_key="CEGBUPOL",
            issue_type="Bug",
            summary="Second issue",
            status_name="In Progress",
            status_category="In Progress",
            priority="High",
            assignee_account_id="u3",
            reporter_account_id="u4",
            story_points=5.0,
            sprint_external_id=901,
            epic_key="CEGBUPOL-EPIC-1",
            labels=["bug"],
            components=["ui"],
            created_at_source=datetime(2026, 3, 21, 10, 0, tzinfo=timezone.utc),
            updated_at_source=datetime(2026, 3, 22, 10, 0, tzinfo=timezone.utc),
            resolved_at_source=None,
            raw={"id": "2", "key": "CEGBUPOL-2"},
        )
        self.issues_by_key: dict[str, IssueRecord] = {
            self.issue_1.issue_key: self.issue_1,
            self.issue_2.issue_key: self.issue_2,
        }
        self.live_sprint_issue_keys: dict[int, list[str]] = {
            901: ["CEGBUPOL-1", "CEGBUPOL-2"],
        }

    def search_issues(
        self,
        jql: str,
        start_at: int = 0,
        max_results: int = 100,
    ) -> tuple[list[IssueRecord], SyncBatch]:
        sprint_match = re.search(r"sprint\s*=\s*(\d+)", jql, flags=re.IGNORECASE)
        if sprint_match is None:
            return [], SyncBatch(next_cursor=None, has_more=False)
        sprint_id = int(sprint_match.group(1))
        all_issue_keys = self.live_sprint_issue_keys.get(sprint_id, [])
        if start_at >= len(all_issue_keys):
            return [], SyncBatch(next_cursor=None, has_more=False)

        batch_issue_keys = all_issue_keys[start_at:start_at + max_results]
        batch_issues = [
            self.issues_by_key[issue_key]
            for issue_key in batch_issue_keys
            if issue_key in self.issues_by_key
        ]
        next_cursor = start_at + len(batch_issue_keys)
        has_more = next_cursor < len(all_issue_keys)
        return batch_issues, SyncBatch(next_cursor=str(next_cursor) if has_more else None, has_more=has_more)

    def get_board(self, board_id: int) -> BoardRecord:
        return BoardRecord(
            external_board_id=board_id,
            name="CEGBU Polaris",
            project_key="CEGBUPOL",
            board_type="scrum",
            raw={"id": board_id, "name": "CEGBU Polaris"},
        )

    def get_sprints(self, board_id: int) -> list[SprintRecord]:
        return [
            SprintRecord(
                external_sprint_id=901,
                board_external_id=board_id,
                name="Sprint 901",
                state="active",
                start_date=datetime(2026, 3, 20, 0, 0, tzinfo=timezone.utc),
                end_date=datetime(2026, 4, 2, 0, 0, tzinfo=timezone.utc),
                complete_date=None,
                goal="Reduce blocker age",
                raw={"id": 901},
            )
        ]

    def get_board_issues(
        self,
        board_id: int,
        start_at: int = 0,
        max_results: int = 100,
        jql: str | None = None,
    ) -> tuple[list[IssueRecord], SyncBatch, int | None]:
        _ = board_id
        _ = max_results
        _ = jql
        if start_at == 0:
            return [self.issue_1], SyncBatch(next_cursor="1", has_more=True), 2
        if start_at == 1:
            return [self.issue_2], SyncBatch(next_cursor=None, has_more=False), 2
        return [], SyncBatch(next_cursor=None, has_more=False), 2

    def incremental_issues(
        self,
        updated_since: datetime | None,
        start_at: int = 0,
        max_results: int = 100,
    ) -> tuple[list[IssueRecord], SyncBatch]:
        _ = max_results
        self.incremental_cursor = updated_since
        if start_at == 0:
            return [self.issue_1], SyncBatch(next_cursor="1", has_more=True)
        if start_at == 1:
            return [self.issue_2], SyncBatch(next_cursor=None, has_more=False)
        return [], SyncBatch(next_cursor=None, has_more=False)

    def get_issue_changelog(self, issue_key: str) -> list[ChangelogItemRecord]:
        return [
            ChangelogItemRecord(
                issue_key=issue_key,
                history_id=f"{issue_key}-1",
                changed_at=datetime(2026, 3, 22, 12, 0, tzinfo=timezone.utc),
                author_account_id="user-dev",
                field_name="status",
                from_value="To Do",
                to_value="In Progress",
                raw={"issue": issue_key},
            ),
            ChangelogItemRecord(
                issue_key=issue_key,
                history_id=f"{issue_key}-2",
                changed_at=datetime(2026, 3, 23, 12, 0, tzinfo=timezone.utc),
                author_account_id="user-qa",
                field_name="status",
                from_value="In Progress",
                to_value="Done",
                raw={"issue": issue_key},
            ),
        ]


class _FailingConnectorStub:
    def get_board(self, board_id: int) -> BoardRecord:
        raise RuntimeError(f"board {board_id} failed")

    def get_sprints(self, board_id: int) -> list[SprintRecord]:
        _ = board_id
        return []

    def get_board_issues(
        self,
        board_id: int,
        start_at: int = 0,
        max_results: int = 100,
        jql: str | None = None,
    ) -> tuple[list[IssueRecord], SyncBatch, int | None]:
        _ = board_id
        _ = start_at
        _ = max_results
        _ = jql
        return [], SyncBatch(next_cursor=None, has_more=False), 0

    def incremental_issues(
        self,
        updated_since: datetime | None,
        start_at: int = 0,
        max_results: int = 100,
    ) -> tuple[list[IssueRecord], SyncBatch]:
        _ = updated_since
        _ = start_at
        _ = max_results
        return [], SyncBatch(next_cursor=None, has_more=False)

    def get_issue_changelog(self, issue_key: str) -> list[ChangelogItemRecord]:
        _ = issue_key
        return []


class _IncrementalMissingActiveIssueConnectorStub(_SuccessfulConnectorStub):
    def incremental_issues(
        self,
        updated_since: datetime | None,
        start_at: int = 0,
        max_results: int = 100,
    ) -> tuple[list[IssueRecord], SyncBatch]:
        _ = max_results
        self.incremental_cursor = updated_since
        if start_at == 0:
            return [self.issue_1], SyncBatch(next_cursor=None, has_more=False)
        return [], SyncBatch(next_cursor=None, has_more=False)


class JiraSyncServiceUnitTests(unittest.TestCase):
    def _runtime(self) -> JiraRuntimeConfig:
        return JiraRuntimeConfig(
            base_url="https://jira.example.com",
            pat_token="token-123",
            project_key="CEGBUPOL",
            board_id=27193,
            story_points_field="customfield_10004",
            auth_mode="pat_bearer",
        )

    def _issue(
        self,
        *,
        issue_key: str,
        sprint_external_id: int | None,
        sprint_field_present: bool,
        raw: dict[str, object],
    ) -> IssueRecord:
        return IssueRecord(
            issue_key=issue_key,
            issue_id=issue_key,
            project_key="CEGBUPOL",
            issue_type="Story",
            summary=f"Summary {issue_key}",
            status_name="In Progress",
            status_category="In Progress",
            priority="Medium",
            assignee_account_id="user-1",
            reporter_account_id="user-2",
            story_points=3.0,
            sprint_external_id=sprint_external_id,
            epic_key="CEGBUPOL-EPIC-1",
            sprint_field_present=sprint_field_present,
            raw=raw,
        )

    def test_run_sync_persists_entities_and_checkpoint(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"
            progress_events: list[dict[str, object]] = []

            summary = run_jira_sync_once(
                progress_callback=progress_events.append,
                db_path=str(db_path),
                runtime=self._runtime(),
                connector=_SuccessfulConnectorStub(),
            )

            self.assertEqual(summary["state"], "completed")
            self.assertEqual(summary["downloadedIssues"], 2)
            self.assertEqual(summary["totalIssues"], 2)
            self.assertIsNotNone(summary["lastSyncedAt"])
            self.assertTrue(any(event.get("phase") == "issues" for event in progress_events))
            self.assertTrue(any("issues downloaded" in str(event.get("message")) for event in progress_events))

            conn = sqlite3.connect(str(db_path))
            try:
                boards_count = conn.execute("SELECT COUNT(*) FROM boards").fetchone()[0]
                sprints_count = conn.execute("SELECT COUNT(*) FROM sprints").fetchone()[0]
                issues_count = conn.execute("SELECT COUNT(*) FROM issues").fetchone()[0]
                changelog_count = conn.execute("SELECT COUNT(*) FROM issue_changelog").fetchone()[0]
                checkpoint = conn.execute(
                    """
                    SELECT status, last_synced_at, error_message
                    FROM sync_checkpoints
                    WHERE source_type = 'jira' AND scope_key = 'board:27193'
                    """
                ).fetchone()
                run_history = conn.execute(
                    """
                    SELECT board_external_id, board_name, sync_mode, boards_synced, sprints_synced, issues_synced, status
                    FROM sync_run_history
                    WHERE source_type = 'jira'
                    ORDER BY id DESC
                    LIMIT 1
                    """
                ).fetchone()
            finally:
                conn.close()

            self.assertEqual(boards_count, 1)
            self.assertEqual(sprints_count, 1)
            self.assertEqual(issues_count, 2)
            self.assertEqual(changelog_count, 4)
            self.assertIsNotNone(checkpoint)
            self.assertEqual(checkpoint[0], "idle")
            self.assertIsNotNone(checkpoint[1])
            self.assertIsNone(checkpoint[2])
            self.assertIsNotNone(run_history)
            self.assertEqual(run_history[0], 27193)
            self.assertEqual(run_history[1], "CEGBU Polaris")
            self.assertEqual(run_history[2], "full")
            self.assertEqual(run_history[3], 1)
            self.assertEqual(run_history[4], 1)
            self.assertEqual(run_history[5], 2)
            self.assertEqual(run_history[6], "completed")

    def test_run_sync_reconciles_active_sprint_membership_without_hard_delete(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"
            connector = _SuccessfulConnectorStub()
            connector.live_sprint_issue_keys = {901: ["CEGBUPOL-1"]}

            summary = run_jira_sync_once(
                db_path=str(db_path),
                runtime=self._runtime(),
                connector=connector,
            )

            self.assertEqual(summary["state"], "completed")
            self.assertEqual(summary["staleSprintLinksCleared"], 1)

            conn = sqlite3.connect(str(db_path))
            try:
                issue_1 = conn.execute(
                    """
                    SELECT issue_key, sprint_external_id
                    FROM issues
                    WHERE issue_key = 'CEGBUPOL-1'
                    """
                ).fetchone()
                issue_2 = conn.execute(
                    """
                    SELECT issue_key, sprint_external_id
                    FROM issues
                    WHERE issue_key = 'CEGBUPOL-2'
                    """
                ).fetchone()
                issue_count = conn.execute("SELECT COUNT(*) FROM issues").fetchone()[0]
            finally:
                conn.close()

            self.assertEqual(issue_count, 2)
            self.assertEqual(issue_1[0], "CEGBUPOL-1")
            self.assertEqual(issue_1[1], 901)
            self.assertEqual(issue_2[0], "CEGBUPOL-2")
            self.assertIsNone(issue_2[1])

    def test_run_sync_since_last_uses_last_synced_cursor_without_overlap(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"
            runtime = self._runtime()

            run_jira_sync_once(
                db_path=str(db_path),
                runtime=runtime,
                connector=_SuccessfulConnectorStub(),
            )

            conn = sqlite3.connect(str(db_path))
            try:
                conn.execute(
                    """
                    UPDATE sync_checkpoints
                    SET last_synced_at = '2026-03-25T12:00:00+00:00', status = 'idle', error_message = NULL
                    WHERE source_type = 'jira' AND scope_key = 'board:27193'
                    """
                )
                conn.commit()
            finally:
                conn.close()

            connector = _SuccessfulConnectorStub()
            run_jira_sync_once(
                db_path=str(db_path),
                runtime=runtime,
                connector=connector,
                sync_mode="since_last",
            )

            self.assertIsNotNone(connector.incremental_cursor)
            self.assertEqual(
                connector.incremental_cursor,
                datetime(2026, 3, 25, 12, 0, tzinfo=timezone.utc),
            )

            conn = sqlite3.connect(str(db_path))
            try:
                sync_mode = conn.execute(
                    """
                    SELECT sync_mode
                    FROM sync_run_history
                    WHERE source_type = 'jira'
                    ORDER BY id DESC
                    LIMIT 1
                    """
                ).fetchone()
            finally:
                conn.close()
            self.assertIsNotNone(sync_mode)
            self.assertEqual(sync_mode[0], "since_last")

    def test_run_sync_since_last_uses_latest_completed_run_when_checkpoint_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"
            runtime = self._runtime()

            first_summary = run_jira_sync_once(
                db_path=str(db_path),
                runtime=runtime,
                connector=_SuccessfulConnectorStub(),
            )
            finished_at_raw = first_summary.get("finishedAt")
            self.assertIsInstance(finished_at_raw, str)
            finished_at = datetime.fromisoformat(finished_at_raw)
            expected_cursor = finished_at

            conn = sqlite3.connect(str(db_path))
            try:
                conn.execute(
                    """
                    DELETE FROM sync_checkpoints
                    WHERE source_type = 'jira' AND scope_key = 'board:27193'
                    """
                )
                conn.commit()
            finally:
                conn.close()

            connector = _SuccessfulConnectorStub()
            run_jira_sync_once(
                db_path=str(db_path),
                runtime=runtime,
                connector=connector,
                sync_mode="since_last",
            )

            self.assertEqual(connector.incremental_cursor, expected_cursor)

            conn = sqlite3.connect(str(db_path))
            try:
                sync_mode = conn.execute(
                    """
                    SELECT sync_mode
                    FROM sync_run_history
                    WHERE source_type = 'jira'
                    ORDER BY id DESC
                    LIMIT 1
                    """
                ).fetchone()
            finally:
                conn.close()
            self.assertIsNotNone(sync_mode)
            self.assertEqual(sync_mode[0], "since_last")

    def test_run_sync_since_last_backfills_missing_active_sprint_issues(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"
            runtime = self._runtime()

            run_jira_sync_once(
                db_path=str(db_path),
                runtime=runtime,
                connector=_SuccessfulConnectorStub(),
            )

            conn = sqlite3.connect(str(db_path))
            try:
                conn.execute("DELETE FROM issues WHERE issue_key = 'CEGBUPOL-2'")
                conn.execute("DELETE FROM issue_changelog WHERE issue_key = 'CEGBUPOL-2'")
                conn.execute(
                    """
                    UPDATE sync_checkpoints
                    SET last_synced_at = '2026-03-25T12:00:00+00:00', status = 'idle', error_message = NULL
                    WHERE source_type = 'jira' AND scope_key = 'board:27193'
                    """
                )
                conn.commit()
            finally:
                conn.close()

            connector = _IncrementalMissingActiveIssueConnectorStub()
            summary = run_jira_sync_once(
                db_path=str(db_path),
                runtime=runtime,
                connector=connector,
                sync_mode="since_last",
            )

            self.assertEqual(summary["state"], "completed")
            self.assertEqual(summary["activeSprintIssuesHydrated"], 1)

            conn = sqlite3.connect(str(db_path))
            try:
                issue_row = conn.execute(
                    """
                    SELECT issue_key, sprint_external_id
                    FROM issues
                    WHERE issue_key = 'CEGBUPOL-2'
                    """
                ).fetchone()
                changelog_count = conn.execute(
                    """
                    SELECT COUNT(*)
                    FROM issue_changelog
                    WHERE issue_key = 'CEGBUPOL-2'
                    """
                ).fetchone()[0]
            finally:
                conn.close()

            self.assertIsNotNone(issue_row)
            self.assertEqual(issue_row[0], "CEGBUPOL-2")
            self.assertEqual(issue_row[1], 901)
            self.assertEqual(changelog_count, 2)

    def test_run_sync_since_date_uses_explicit_cursor(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"
            runtime = self._runtime()

            connector = _SuccessfulConnectorStub()
            run_jira_sync_once(
                db_path=str(db_path),
                runtime=runtime,
                connector=connector,
                sync_mode="since_date",
                since_date="2026-03-10",
            )

            self.assertEqual(
                connector.incremental_cursor,
                datetime(2026, 3, 10, 0, 0, tzinfo=timezone.utc),
            )

            conn = sqlite3.connect(str(db_path))
            try:
                row = conn.execute(
                    """
                    SELECT sync_mode, requested_since
                    FROM sync_run_history
                    WHERE source_type = 'jira'
                    ORDER BY id DESC
                    LIMIT 1
                    """
                ).fetchone()
            finally:
                conn.close()
            self.assertIsNotNone(row)
            self.assertEqual(row[0], "since_last")
            self.assertTrue(str(row[1]).startswith("2026-03-10T00:00:00"))

    def test_run_sync_marks_checkpoint_failed_on_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"

            with self.assertRaisesRegex(RuntimeError, "board 27193 failed"):
                run_jira_sync_once(
                    db_path=str(db_path),
                    runtime=self._runtime(),
                    connector=_FailingConnectorStub(),
                )

            conn = sqlite3.connect(str(db_path))
            try:
                checkpoint = conn.execute(
                    """
                    SELECT status, error_message
                    FROM sync_checkpoints
                    WHERE source_type = 'jira' AND scope_key = 'board:27193'
                    """
                ).fetchone()
                run_history = conn.execute(
                    """
                    SELECT status, error_message
                    FROM sync_run_history
                    WHERE source_type = 'jira'
                    ORDER BY id DESC
                    LIMIT 1
                    """
                ).fetchone()
            finally:
                conn.close()

            self.assertIsNotNone(checkpoint)
            self.assertEqual(checkpoint[0], "failed")
            self.assertIn("board 27193 failed", checkpoint[1])
            self.assertIsNotNone(run_history)
            self.assertEqual(run_history[0], "failed")
            self.assertIn("board 27193 failed", run_history[1])

    def test_upsert_issues_preserves_or_clears_sprint_based_on_field_presence(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"
            conn = sqlite3.connect(str(db_path))
            try:
                _ensure_schema(conn)
                _upsert_issues(
                    conn,
                    [
                        self._issue(
                            issue_key="CEGBUPOL-9991",
                            sprint_external_id=44001,
                            sprint_field_present=True,
                            raw={"fields": {"customfield_10901": ["id=44001"]}},
                        )
                    ],
                )
                conn.commit()

                _upsert_issues(
                    conn,
                    [
                        self._issue(
                            issue_key="CEGBUPOL-9991",
                            sprint_external_id=None,
                            sprint_field_present=False,
                            raw={"fields": {}},
                        )
                    ],
                )
                conn.commit()

                preserved = conn.execute(
                    "SELECT sprint_external_id FROM issues WHERE issue_key = 'CEGBUPOL-9991'"
                ).fetchone()
                self.assertIsNotNone(preserved)
                self.assertEqual(preserved[0], 44001)

                _upsert_issues(
                    conn,
                    [
                        self._issue(
                            issue_key="CEGBUPOL-9991",
                            sprint_external_id=None,
                            sprint_field_present=True,
                            raw={"fields": {"customfield_10901": []}},
                        )
                    ],
                )
                conn.commit()

                cleared = conn.execute(
                    "SELECT sprint_external_id FROM issues WHERE issue_key = 'CEGBUPOL-9991'"
                ).fetchone()
                self.assertIsNotNone(cleared)
                self.assertIsNone(cleared[0])
            finally:
                conn.close()

    def test_backfill_missing_sprint_external_ids_from_raw_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"
            conn = sqlite3.connect(str(db_path))
            try:
                _ensure_schema(conn)
                conn.execute(
                    """
                    INSERT INTO issues (
                      issue_key,
                      issue_id,
                      project_key,
                      issue_type,
                      summary,
                      status_name,
                      status_category,
                      sprint_external_id,
                      raw_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "CEGBUPOL-9992",
                        "9992",
                        "CEGBUPOL",
                        "Story",
                        "Repair sprint id",
                        "In Progress",
                        "In Progress",
                        None,
                        '{"fields":{"customfield_10901":["com.atlassian.greenhopper.service.sprint.Sprint@abcd[id=55001,rapidViewId=27193]"]}}',
                    ),
                )
                conn.commit()

                updated = _backfill_missing_sprint_external_ids(
                    conn, ("customfield_10901", "sprint", "customfield_10020")
                )
                conn.commit()

                row = conn.execute(
                    "SELECT sprint_external_id FROM issues WHERE issue_key = 'CEGBUPOL-9992'"
                ).fetchone()
                self.assertEqual(updated, 1)
                self.assertIsNotNone(row)
                self.assertEqual(row[0], 55001)
            finally:
                conn.close()

    def test_manager_start_runs_sync_runner_and_updates_state(self) -> None:
        finished_at = "2026-03-25T01:40:00+00:00"

        captured_modes: list[str] = []

        def fake_sync_runner(progress_callback, db_path, sync_mode, since_date=None):  # noqa: ANN001
            _ = db_path
            _ = since_date
            captured_modes.append(sync_mode)
            progress_callback(
                {
                    "phase": "issues",
                    "boardsSynced": 1,
                    "sprintsSynced": 23,
                    "downloadedIssues": 12,
                    "totalIssues": 5000,
                    "percent": 0.24,
                    "message": "12 of 5000 issues downloaded",
                }
            )
            return {
                "source": "jira",
                "state": "completed",
                "phase": "done",
                "boardsSynced": 1,
                "sprintsSynced": 23,
                "downloadedIssues": 5000,
                "totalIssues": 5000,
                "percent": 100.0,
                "finishedAt": finished_at,
                "lastSyncedAt": finished_at,
                "syncMode": sync_mode,
                "error": None,
                "message": "Sync complete.",
            }

        manager = JiraSyncManager(
            db_path_provider=lambda: "/tmp/teambeacon-test.db",
            sync_runner=fake_sync_runner,
        )

        start_payload = manager.start(mode="since_last")
        self.assertTrue(start_payload["started"])
        self.assertEqual(start_payload["syncMode"], "since_last")

        status = manager.get_status()
        for _ in range(50):
            if status.get("state") == "completed":
                break
            time.sleep(0.01)
            status = manager.get_status()

        self.assertEqual(status["state"], "completed")
        self.assertEqual(status["downloadedIssues"], 5000)
        self.assertEqual(status["totalIssues"], 5000)
        self.assertEqual(status["lastSyncedAt"], finished_at)
        self.assertEqual(status["syncMode"], "since_last")
        self.assertEqual(status["boardsSynced"], 1)
        self.assertEqual(status["sprintsSynced"], 23)
        self.assertEqual(captured_modes, ["since_last"])

    def test_manager_start_since_date_sets_requested_since(self) -> None:
        captured: list[tuple[str, str | None]] = []

        def fake_sync_runner(progress_callback, db_path, sync_mode, since_date=None):  # noqa: ANN001
            _ = progress_callback
            _ = db_path
            captured.append((sync_mode, since_date))
            return {
                "source": "jira",
                "state": "completed",
                "phase": "done",
                "syncMode": sync_mode,
                "requestedSince": since_date,
                "boardsSynced": 0,
                "sprintsSynced": 0,
                "downloadedIssues": 0,
                "totalIssues": 0,
                "percent": 100.0,
                "finishedAt": "2026-03-25T00:00:00+00:00",
                "lastSyncedAt": "2026-03-25T00:00:00+00:00",
                "error": None,
                "message": "Sync complete.",
            }

        manager = JiraSyncManager(
            db_path_provider=lambda: "/tmp/teambeacon-test.db",
            sync_runner=fake_sync_runner,
        )

        start_payload = manager.start(mode="since_date", since_date="2026-03-01")
        self.assertTrue(start_payload["started"])
        self.assertEqual(start_payload["syncMode"], "since_date")
        self.assertTrue(str(start_payload["requestedSince"]).startswith("2026-03-01T00:00:00"))

        status = manager.get_status()
        for _ in range(50):
            if status.get("state") == "completed":
                break
            time.sleep(0.01)
            status = manager.get_status()

        self.assertEqual(status["state"], "completed")
        self.assertEqual(status["syncMode"], "since_date")
        self.assertTrue(str(status["requestedSince"]).startswith("2026-03-01T00:00:00"))
        self.assertEqual(len(captured), 1)
        self.assertEqual(captured[0][0], "since_date")
        self.assertTrue(str(captured[0][1]).startswith("2026-03-01T00:00:00"))

    def test_manager_reconciles_stale_running_sync_from_db(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"

            runtime = self._runtime()
            run_jira_sync_once(
                db_path=str(db_path),
                runtime=runtime,
                connector=_SuccessfulConnectorStub(),
            )

            conn = sqlite3.connect(str(db_path))
            try:
                conn.execute(
                    """
                    INSERT INTO sync_run_history (
                      source_type,
                      scope_key,
                      board_external_id,
                      board_name,
                      started_at,
                      status,
                      boards_synced,
                      sprints_synced,
                      issues_synced
                    ) VALUES ('jira', 'board:27193', 27193, 'CEGBU Polaris', '2099-03-25T02:00:00+00:00', 'running', 1, 140, 4000)
                    """
                )
                conn.execute(
                    """
                    UPDATE sync_checkpoints
                    SET status = 'running', error_message = NULL
                    WHERE source_type = 'jira' AND scope_key = 'board:27193'
                    """
                )
                conn.commit()
            finally:
                conn.close()

            manager = JiraSyncManager(
                db_path_provider=lambda: str(db_path),
                sync_runner=lambda **_: {},  # noqa: ARG005
            )
            manager._resolve_runtime_scope = lambda: "board:27193"  # type: ignore[method-assign]

            status = manager.get_status()
            self.assertEqual(status["state"], "failed")
            self.assertIn("interrupted", str(status["error"]).lower())

            conn = sqlite3.connect(str(db_path))
            try:
                row = conn.execute(
                    """
                    SELECT status, error_message, issues_synced
                    FROM sync_run_history
                    ORDER BY id DESC
                    LIMIT 1
                    """
                ).fetchone()
            finally:
                conn.close()

            self.assertIsNotNone(row)
            self.assertEqual(row[0], "failed")
            self.assertIn("interrupted", row[1].lower())
            self.assertGreaterEqual(int(row[2]), 2)


if __name__ == "__main__":
    unittest.main()
