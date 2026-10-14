import sqlite3
import tempfile
import unittest
from pathlib import Path

from services.api.metadata.epic_config import (
    add_epic_group,
    add_work_type,
    create_initiative_view,
    get_epic_metadata,
    get_initiative_views,
    upsert_epic_metadata,
)
from services.api.metadata.epic_mapping import (
    MappingConflict,
    get_epic_mapping_inventory,
    save_epic_mappings,
)


class EpicMappingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = str(Path(self.tmp.name) / "mapping.db")
        self.group = add_epic_group("Platform", db_path=self.db)["id"]
        self.other = add_epic_group("Delivery", db_path=self.db)["id"]
        self.work_type = add_work_type("Tech", db_path=self.db)["id"]
        with sqlite3.connect(self.db) as conn:
            for key, kind in [("P-1", "Epic"), ("P-2", "epic"), ("P-3", "Story")]:
                conn.execute(
                    "INSERT INTO issues(issue_key, issue_id, summary, status_name, issue_type) VALUES (?, ?, ?, ?, ?)",
                    (key, key, "Title " + key, "Open", kind),
                )
            conn.execute(
                "INSERT INTO sync_run_history(source_type,scope_key,started_at,finished_at,status) VALUES ('jira','P','2026-10-14','2026-10-14T10:00:00Z','completed')"
            )

    def change(self, key="P-1", target=None, expected=None):
        return {
            "epicKey": key,
            "workStreamId": target,
            "expectedWorkStreamId": expected,
        }

    def test_inventory_includes_configured_unmapped_and_only_synced_epics(self):
        upsert_epic_metadata(
            epic_key="P-1",
            success_criteria=["Preserve"],
            group_ids=[],
            work_type_ids=[],
            db_path=self.db,
        )
        inventory = get_epic_mapping_inventory(self.db)
        self.assertEqual(len(inventory["epics"]), 2)
        self.assertEqual(
            inventory["epics"][0],
            {
                "epicKey": "P-1",
                "title": "Title P-1",
                "status": "Open",
                "workStreamId": None,
            },
        )
        self.assertEqual(inventory["lastSyncedAt"], "2026-10-14T10:00:00Z")
        save_epic_mappings([self.change(target=self.group)], self.db)
        self.assertEqual(
            get_epic_mapping_inventory(self.db)["epics"][0]["workStreamId"], self.group
        )

    def test_reassignment_preserves_metadata_and_view_membership(self):
        before = upsert_epic_metadata(
            epic_key="P-1",
            success_criteria=["Keep"],
            group_ids=[self.group],
            work_type_ids=[self.work_type],
            timeline_enabled=True,
            target_completion_date="2027-01-01",
            db_path=self.db,
        )
        create_initiative_view(name="View", epic_keys=["P-1"], db_path=self.db)
        views = get_initiative_views(db_path=self.db)
        save_epic_mappings(
            [
                self.change(target=self.other, expected=self.group),
                self.change("P-2", self.group),
            ],
            self.db,
        )
        after = get_epic_metadata(epic_key="P-1", db_path=self.db)["epics"][0]
        for field in [
            "successCriteria",
            "workTypeIds",
            "timelineEnabled",
            "targetCompletionDate",
            "timelineStartDate",
        ]:
            self.assertEqual(before[field], after[field])
        self.assertEqual(after["groupIds"], [self.other])
        self.assertEqual(
            views["views"][1], get_initiative_views(db_path=self.db)["views"][1]
        )
        save_epic_mappings([self.change(expected=self.other)], self.db)
        self.assertEqual(
            get_epic_metadata(epic_key="P-1", db_path=self.db)["epics"][0]["groupIds"],
            [],
        )

    def test_invalid_batches_save_nothing(self):
        invalids = [
            None,
            [],
            [None],
            [{}],
            [{"epicKey": 1}],
            [self.change("")],
            [self.change(), self.change()],
            [self.change(target=True)],
            [self.change(target=-1)],
            [{"epicKey": "P-1", "workStreamId": None}],
            [self.change("P-3")],
            [self.change("P-404")],
            [self.change(target=999)],
            [self.change()] * 1001,
        ]
        for invalid in invalids:
            with (
                self.subTest(invalid=str(invalid)[:100]),
                self.assertRaises(ValueError),
            ):
                save_epic_mappings(invalid, self.db)
        with self.assertRaises(ValueError):
            save_epic_mappings(
                [self.change(target=self.group), self.change("P-2", 999)], self.db
            )
        self.assertEqual(get_epic_metadata(db_path=self.db)["epics"], [])

    def test_stale_assignments_conflict_and_rollback(self):
        save_epic_mappings([self.change("P-2", self.group)], self.db)
        with self.assertRaisesRegex(MappingConflict, "P-2"):
            save_epic_mappings(
                [self.change(target=self.group), self.change("P-2", self.other)],
                self.db,
            )
        self.assertIsNone(
            get_epic_mapping_inventory(self.db)["epics"][0]["workStreamId"]
        )

    def test_database_failure_rolls_back_prior_writes(self):
        with sqlite3.connect(self.db) as conn:
            conn.execute(
                "CREATE TRIGGER reject_second BEFORE INSERT ON epic_metadata WHEN NEW.epic_key = 'P-2' BEGIN SELECT RAISE(ABORT, 'failure'); END"
            )
        with self.assertRaises(sqlite3.IntegrityError):
            save_epic_mappings(
                [self.change(target=self.group), self.change("P-2", self.group)],
                self.db,
            )
        self.assertEqual(get_epic_metadata(db_path=self.db)["epics"], [])
