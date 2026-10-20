import copy
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from services.api.metadata.epic_config import get_epic_metadata, upsert_epic_metadata
from services.api.planner import PlanConflict, get_planner, save_plan


class PlannerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = str(Path(self.tmp.name) / "planner.db")
        for key in ("P-1", "P-2", "P-3"):
            upsert_epic_metadata(epic_key=key, success_criteria=["Keep"], group_ids=[], work_type_ids=[],
                                 timeline_enabled=True, timeline_start_date="2026-10-01",
                                 target_completion_date="2026-11-01", db_path=self.db)
            self.issue(key, kind="Epic")
        self.issue("P-10", epic="P-1", status="done")
        self.issue("P-11", epic="P-1")
        self.issue("P-12", epic="P-1", kind="Sub-task", status="done")
        self.issue("P-20", parent="P-2", status="done")

    def issue(self, key, *, kind="Story", epic=None, parent=None, status="new"):
        with sqlite3.connect(self.db) as conn:
            conn.execute(
                """INSERT INTO issues(issue_key,issue_id,summary,status_name,status_category,issue_type,epic_key,parent_issue_key)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (key, key, f"Title {key}", "Done" if status == "done" else "Open", status, kind, epic, parent),
            )

    def placement(self, key="P-1", **changes):
        return {"epicKey": key, "trackId": "default", "startDate": "2026-10-01",
                "endDate": "2026-10-10", "dependsOn": [], "notes": "", **changes}

    def payload(self, **changes):
        return {"name": "Launch", "tracks": [{"id": "default", "name": "Default"}],
                "epics": [self.placement()], **changes}

    def test_create_update_isolated_plans_and_epic_metadata(self):
        metadata = get_epic_metadata(db_path=self.db)
        first = save_plan(self.payload(), self.db)
        second = save_plan(self.payload(name="Other"), self.db)
        self.assertNotEqual(first["id"], second["id"])
        changed = save_plan({**first, "name": "Revised", "epics": [self.placement(endDate="2026-10-20")]}, self.db)
        self.assertEqual(changed["version"], 2)
        self.assertEqual(changed["metrics"]["completionPercent"], 50)
        self.assertEqual(changed["metrics"]["totalCards"], 2)
        self.assertEqual(get_epic_metadata(db_path=self.db), metadata)
        plans = get_planner(self.db)["plans"]
        self.assertEqual(plans[0]["name"], "Revised")
        self.assertEqual(plans[1]["epics"][0]["endDate"], "2026-10-10")

    def test_progress_uses_unique_cards_and_current_status(self):
        self.issue("P-30", epic="P-1", parent="P-2", status="done")
        self.issue("P-31", parent="P-30")
        self.issue("P-32", parent="P-31")
        self.issue("P-40", parent="P-41")
        self.issue("P-41", parent="P-40")
        self.issue("P-42", parent="MISSING")
        plan = save_plan(self.payload(epics=[self.placement(), self.placement("P-2")]), self.db)
        self.assertEqual(plan["metrics"]["totalCards"], 6)
        self.assertEqual(plan["metrics"]["completedCards"], 3)
        with sqlite3.connect(self.db) as conn:
            conn.execute("UPDATE issues SET status_category='new',status_name='Reopened',resolved_at_source='2026-10-01' WHERE issue_key='P-10'")
        self.assertEqual(get_planner(self.db)["plans"][0]["metrics"]["completedCards"], 2)

    def test_baseline_is_immutable_and_tracks_added_removed_scope(self):
        active = save_plan(self.payload(status="active", targetDate="2026-11-01"), self.db)
        original = copy.deepcopy(active["baseline"])
        self.assertEqual(original["issueKeys"], ["P-10", "P-11"])
        self.issue("P-13", epic="P-1")
        with sqlite3.connect(self.db) as conn:
            conn.execute("UPDATE issues SET epic_key=NULL,parent_issue_key=NULL WHERE issue_key='P-11'")
        edited = save_plan({**active, "epics": [self.placement(endDate="2026-10-30")], "baseline": {"forged": True}}, self.db)
        self.assertEqual(edited["baseline"], original)
        self.assertEqual(edited["scopeChange"], {"added": 1, "removed": 1})
        draft = save_plan({**edited, "status": "draft"}, self.db)
        self.assertEqual(save_plan({**draft, "status": "active"}, self.db)["baseline"], original)

    def test_conflicts_and_invalid_updates_do_not_overwrite(self):
        original = save_plan(self.payload(), self.db)
        save_plan({**original, "owner": "Manager"}, self.db)
        for payload in [{**original, "name": "Overwrite"}, {**original, "id": 999}]:
            with self.assertRaises(PlanConflict):
                save_plan(payload, self.db)
        with self.assertRaises(ValueError):
            save_plan({**original, "epics": [self.placement(dependsOn=["P-1"])]}, self.db)
        self.assertEqual(get_planner(self.db)["plans"][0]["owner"], "Manager")

    def test_validation_rejects_bad_documents_atomically(self):
        invalid = [
            None, [], {}, {"name": 4}, {"name": " "}, {"name": "a" * 161},
            self.payload(status="other"), self.payload(targetDate=5), self.payload(targetDate="bad"),
            self.payload(targetDate="20261001"), self.payload(targetDate="2026-02-30"),
            self.payload(tracks=None), self.payload(tracks=[{}] * 51), self.payload(tracks=[]),
            self.payload(tracks=[None]), self.payload(tracks=[{"id": "x", "name": ""}]),
            self.payload(tracks=[{"id": "x", "name": "A"}, {"id": "x", "name": "B"}]),
            self.payload(tracks=[{"id": "x", "name": "A"}, {"id": "y", "name": "a"}]),
            self.payload(epics=None), self.payload(epics=[{}] * 201), self.payload(epics=[None]),
            self.payload(epics=[{}]), self.payload(epics=[self.placement(), self.placement()]),
            self.payload(epics=[self.placement(trackId="missing")]),
            self.payload(epics=[self.placement(endDate="2026-01-01")]),
            self.payload(epics=[self.placement(dependsOn=["P-2", "P-2"])]),
            self.payload(epics=[self.placement(dependsOn=["missing"])]),
            self.payload(epics=[self.placement(dependsOn=[1])]),
            self.payload(epics=[self.placement(dependsOn=["P-1"])]),
            self.payload(epics=[self.placement("UNKNOWN")]),
            self.payload(epics=[self.placement(dependsOn=["P-2"]), self.placement("P-2", dependsOn=["P-1"])]),
            self.payload(id=True, version=1), self.payload(id=1, version=True),
            self.payload(id=0, version=1), self.payload(id=1, version=0),
            self.payload(id=1), self.payload(status="active", epics=[]),
            self.payload(objective=None), self.payload(owner=5),
        ]
        for payload in invalid:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                save_plan(payload, self.db)
        self.assertEqual(get_planner(self.db)["plans"], [])

    def test_defaults_normalization_archiving_and_empty_progress(self):
        plan = save_plan({"name": " Empty ", "targetDate": ""}, self.db)
        self.assertEqual(plan["tracks"], [{"id": "default", "name": "Default"}])
        self.assertEqual(plan["name"], "Empty")
        self.assertIsNone(plan["metrics"]["completionPercent"])
        plan = save_plan({**plan, "status": "archived"}, self.db)
        self.assertEqual(plan["status"], "archived")
        plan = save_plan(self.payload(epics=[{"epicKey": "p-3"}], status="completed"), self.db)
        self.assertIsNone(plan["metrics"]["completionPercent"])
        self.assertEqual(plan["epics"][0]["epicKey"], "P-3")
        self.assertIsNone(plan["baseline"])

    def test_dependency_and_target_warnings_with_multiple_tracks(self):
        plan = save_plan(self.payload(
            targetDate="2026-10-09",
            tracks=[{"id": "default", "name": "API"}, {"id": "web", "name": "Web"}],
            epics=[self.placement(), self.placement("P-2", trackId="web", startDate="2026-10-10", dependsOn=["P-1"])],
        ), self.db)
        self.assertTrue(any("successor must start" in warning for warning in plan["warnings"]))
        self.assertTrue(any("after the plan target" in warning for warning in plan["warnings"]))
        plan["epics"][1].update(startDate="2026-10-11", endDate="2026-10-15")
        valid = save_plan({**plan, "targetDate": "2026-11-01"}, self.db)
        self.assertEqual(valid["warnings"], [])
        valid["epics"][0].update(startDate=None, endDate=None)
        missing = save_plan(valid, self.db)
        self.assertTrue(any("dates are needed" in warning for warning in missing["warnings"]))
        self.assertTrue(any("schedule is incomplete" in warning for warning in missing["warnings"]))

    def test_missing_or_unconfigured_epics_remain_in_saved_plans(self):
        plan = save_plan(self.payload(status="active"), self.db)
        with sqlite3.connect(self.db) as conn:
            conn.execute("DELETE FROM issues WHERE issue_key='P-1'")
            conn.execute("UPDATE epic_metadata SET epic_name='Saved title', timeline_enabled=0 WHERE epic_key='P-1'")
        inventory = get_planner(self.db)
        source = next(epic for epic in inventory["epics"] if epic["epicKey"] == "P-1")
        self.assertEqual(source["title"], "Saved title")
        self.assertFalse(source["available"])
        self.assertIsNone(source["startDate"])
        self.assertIsNone(inventory["plans"][0]["metrics"]["completionPercent"])
        with sqlite3.connect(self.db) as conn:
            conn.execute("DELETE FROM epic_metadata WHERE epic_key='P-1'")
        retained = save_plan({**plan, "owner": "Still editable"}, self.db)
        self.assertFalse(retained["metrics"]["available"])
        self.assertTrue(any("unavailable" in warning for warning in retained["warnings"]))

    def test_schema_is_additive_and_activation_after_draft(self):
        plan = save_plan(self.payload(), self.db)
        active = save_plan({**plan, "status": "active"}, self.db)
        self.assertIsNotNone(active["baseline"])
        with sqlite3.connect(self.db) as conn:
            migration = Path("services/api/db/migrations/0002_planner.sql").read_text()
            conn.executescript(migration)
            conn.executescript(migration)
            self.assertEqual(conn.execute("SELECT count(*) FROM delivery_plans").fetchone()[0], 1)
            stored = json.loads(conn.execute("SELECT document_json FROM delivery_plans").fetchone()[0])
            self.assertEqual(stored["status"], "active")
