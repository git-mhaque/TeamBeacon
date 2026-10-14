from __future__ import annotations

import unittest
from unittest.mock import patch

from services.api.integrations.jira_sync import get_jira_data_as_of


class DashboardFreshnessTests(unittest.TestCase):
    def test_reads_checkpoint_without_sync_recovery(self):
        with (
            patch("services.api.integrations.jira_sync.JIRA_SYNC_MANAGER") as manager,
            patch("services.api.integrations.jira_sync._read_checkpoint") as checkpoint,
            patch("services.api.integrations.jira_sync._resolve_db_path", return_value="test.db"),
        ):
            manager._resolve_runtime_scope.return_value = "board:1"
            checkpoint.return_value = {"status": "running", "lastSyncedAt": "2026-10-08T00:00:00Z"}
            self.assertEqual(get_jira_data_as_of(), "2026-10-08T00:00:00Z")
            checkpoint.assert_called_with("test.db", "board:1")
            manager.get_status.assert_not_called()
            manager._hydrate_from_persisted.assert_not_called()

    def test_missing_scope_checkpoint_timestamp_or_read_failure(self):
        with (
            patch("services.api.integrations.jira_sync.JIRA_SYNC_MANAGER") as manager,
            patch("services.api.integrations.jira_sync._read_checkpoint") as checkpoint,
        ):
            manager._resolve_runtime_scope.return_value = None
            self.assertIsNone(get_jira_data_as_of())
            checkpoint.assert_not_called()
            manager._resolve_runtime_scope.return_value = "board:1"
            for value in [None, {}, {"lastSyncedAt": ""}, {"lastSyncedAt": 0}]:
                checkpoint.return_value = value
                self.assertIsNone(get_jira_data_as_of())
            checkpoint.side_effect = RuntimeError("unavailable")
            self.assertIsNone(get_jira_data_as_of())
