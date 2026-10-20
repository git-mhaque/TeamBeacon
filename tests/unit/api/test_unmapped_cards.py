import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from services.api.integrations.jira_sync import _ensure_schema
from services.api.issues.unmapped_cards import _creator_name, get_unmapped_cards


class UnmappedCardsTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.db = str(Path(tmp.name) / "cards.db")
        with sqlite3.connect(self.db) as conn:
            _ensure_schema(conn)
        self.env = patch.dict(os.environ, {"JIRA_PROJECT_KEY": "P", "JIRA_BASE_URL": "https://jira.example.test/"})
        self.env.start()
        self.addCleanup(self.env.stop)
        patcher = patch("services.api.issues.unmapped_cards.load_env_files")
        patcher.start()
        self.addCleanup(patcher.stop)
        url_patcher = patch("services.api.issues.unmapped_cards._resolve_jira_base_url", return_value="https://jira.example.test")
        url_patcher.start()
        self.addCleanup(url_patcher.stop)

    def seed(self, key, kind="Story", epic=None, parent=None, project="P", status="Open"):
        with sqlite3.connect(self.db) as conn:
            conn.execute("""INSERT INTO issues(issue_key,issue_id,project_key,issue_type,summary,status_name,epic_key,parent_issue_key,updated_at_source)
                VALUES (?,?,?,?,?,?,?,?,?)""", (key, key, project, kind, "Summary " + key, status, epic, parent, "2026-10-20T01:00:00Z"))

    def test_excludes_any_direct_or_inherited_epic_including_unconfigured_epics(self):
        self.seed("P-1", "Epic")
        self.seed("P-2", epic="P-NOT-SYNCED")
        self.seed("P-3", parent="P-1")
        self.seed("P-4", "Sub-task", parent="P-2")
        self.seed("P-5", "Sub-task", parent="P-3")
        self.seed("P-6", "Sub-task", parent="P-5")
        self.seed("P-7", status="Closed")
        self.seed("P-8", "Sub-task", parent="P-7")
        self.seed("P-9", epic=" ")
        self.seed("P-10", parent="P-UNKNOWN")
        self.seed("Q-1", project="Q")
        with sqlite3.connect(self.db) as conn:
            conn.execute("UPDATE issues SET created_at_source='2026-09-04T01:00:00Z' WHERE issue_key='P-10'")
        result = get_unmapped_cards(self.db)
        self.assertEqual({card["issueKey"] for card in result["cards"]}, {"P-7", "P-8", "P-9", "P-10"})
        self.assertEqual(result["count"], 4)
        self.assertEqual(result["projectKey"], "P")
        self.assertEqual(result["jiraBaseUrl"], "https://jira.example.test")
        missing = next(card for card in result["cards"] if card["issueKey"] == "P-10")
        self.assertTrue(missing["parentMissing"])
        self.assertEqual(missing["createdAt"], "2026-09-04T01:00:00Z")
        self.assertNotIn("updatedAt", missing)
        child = next(card for card in result["cards"] if card["issueKey"] == "P-8")
        self.assertEqual(child["parentIssueKey"], "P-7")
        self.assertFalse(child["parentMissing"])
        self.assertIsNone(child["createdAt"])
        self.assertEqual(get_unmapped_cards(self.db, project_key="Q")["count"], 1)

    def test_returns_complete_inventory_with_names_freshness_and_safe_cycles(self):
        for index in range(510):
            self.seed(f"P-{index}")
        with sqlite3.connect(self.db) as conn:
            conn.execute("UPDATE issues SET assignee_account_id='bob',reporter_account_id='charlie',parent_issue_key='P-1',raw_json=? WHERE issue_key='P-0'", (json.dumps({"fields": {"creator": {"displayName": "Alice", "name": "alice"}, "reporter": {"displayName": "Charlie"}, "assignee": {"displayName": "Bob"}}}),))
            conn.execute("UPDATE issues SET parent_issue_key='P-0',raw_json=? WHERE issue_key='P-1'", (json.dumps({"fields": {"creator": {"name": "outside-team"}}}),))
            conn.execute("INSERT INTO sync_run_history(source_type,scope_key,started_at,finished_at,status) VALUES ('jira','P','2026-10-20','2026-10-20T02:00:00Z','completed')")
        with patch("services.api.issues.unmapped_cards._resolve_db_path", return_value=self.db):
            result = get_unmapped_cards()
        self.assertEqual(result["count"], 510)
        self.assertEqual(result["lastSyncedAt"], "2026-10-20T02:00:00Z")
        by_key = {card["issueKey"]: card for card in result["cards"]}
        self.assertEqual(by_key["P-0"]["createdBy"], "Alice")
        self.assertEqual(by_key["P-1"]["createdBy"], "outside-team")
        self.assertIsNone(by_key["P-2"]["createdBy"])
        self.assertNotIn("assignee", by_key["P-0"])
        self.assertNotIn("raw_json", by_key["P-0"])

    def test_creator_uses_jira_identity_fallbacks_without_substituting_reporter(self):
        for creator, expected in [
            ({"displayName": " Alice ", "name": "alice", "accountId": "123"}, "Alice"),
            ({"displayName": " ", "name": "alice"}, "alice"),
            ({"displayName": 123, "accountId": "123"}, "123"),
            ({}, None), (None, None), ("Alice", None),
        ]:
            with self.subTest(creator=creator):
                self.assertEqual(_creator_name(json.dumps({"fields": {"creator": creator, "reporter": {"displayName": "Bob"}}})), expected)
        for raw in ('{', 'null', '[]', '{}', '{"fields": []}', '{"fields": {"reporter": {"displayName": "Bob"}}}'):
            with self.subTest(raw=raw):
                self.assertIsNone(_creator_name(raw))

    def test_empty_data_and_unconfigured_url(self):
        with patch("services.api.issues.unmapped_cards._resolve_jira_base_url", return_value=None):
            result = get_unmapped_cards(self.db)
        self.assertEqual(result["cards"], [])
        self.assertIsNone(result["lastSyncedAt"])
        self.assertIsNone(result["jiraBaseUrl"])

    def test_unavailable_database_raises_without_creating_an_inventory(self):
        with self.assertRaises(sqlite3.OperationalError):
            get_unmapped_cards(str(Path(self.db) / "missing.db"))
