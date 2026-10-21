import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from services.api.metadata.epic_mapping import MappingConflict
from services.api.server import build_handler


class MappingRoutesTests(unittest.TestCase):
    def setUp(self):
        self.received = []
        def save(changes):
            if changes == "conflict":
                raise MappingConflict("P-1 changed")
            if not isinstance(changes, list):
                raise ValueError("Invalid changes")  # noqa: TRY004 - API validation contract
            self.received.append(changes)
            return {"savedCount": len(changes)}

        self.server = ThreadingHTTPServer(
            ("localhost", 0),
            build_handler(
                metadata_mapping_inventory_provider=lambda: {
                    "epics": [],
                    "lastSyncedAt": None,
                },
                metadata_mapping_save_provider=save,
            ),
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.url = (
            f"http://localhost:{self.server.server_port}/api/metadata/epic-mappings"
        )

    def request(self, body=None):
        req = Request(
            self.url,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
        )
        try:
            with urlopen(req) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, json.load(error)

    def test_inventory_and_save(self):
        self.assertEqual(self.request(), (200, {"epics": [], "lastSyncedAt": None}))
        self.assertEqual(self.request({"changes": [{}]}), (200, {"savedCount": 1}))

    def test_invalid_and_conflicting_batches(self):
        for body in [[], {}, {"changes": None}]:
            self.assertEqual(self.request(body)[0], 400)
        self.assertEqual(self.request({"changes": "conflict"})[0], 409)

    def test_work_type_and_combined_changes_reach_the_save_provider(self):
        changes = [
            {"epicKey": "P-1", "workTypeId": 10, "expectedWorkTypeId": None},
            {"epicKey": "P-2", "workStreamId": 1, "expectedWorkStreamId": None,
             "workTypeId": None, "expectedWorkTypeId": 10},
        ]
        self.assertEqual(self.request({"changes": changes}), (200, {"savedCount": 2}))
        self.assertEqual(self.received, [changes])
