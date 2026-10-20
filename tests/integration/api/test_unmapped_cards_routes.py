import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import Mock
from urllib.error import HTTPError
from urllib.request import urlopen

from services.api.server import build_handler


class UnmappedCardsRoutesTests(unittest.TestCase):
    def setUp(self):
        self.payload = {"cards": [{"issueKey": "P-1"}], "count": 1, "projectKey": "P", "lastSyncedAt": None, "jiraBaseUrl": "https://jira.example.test"}
        self.provider = Mock(return_value=self.payload)
        self.server = ThreadingHTTPServer(("localhost", 0), build_handler(unmapped_cards_provider=self.provider))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.base = f"http://localhost:{self.server.server_port}"

    def test_inventory_and_documented_route(self):
        with urlopen(self.base + "/api/metadata/unmapped-cards") as response:
            self.assertEqual(json.load(response), self.payload)
        self.provider.assert_called_once_with()
        with urlopen(self.base + "/openapi.json") as response:
            self.assertIn("/api/metadata/unmapped-cards", json.load(response)["paths"])

    def test_inventory_failure_returns_retryable_error(self):
        self.provider.side_effect = RuntimeError("private database path")
        with self.assertRaises(HTTPError) as caught:
            urlopen(self.base + "/api/metadata/unmapped-cards")
        self.assertEqual(caught.exception.code, 500)
        self.assertEqual(json.load(caught.exception)["detail"], "Unable to load unmapped cards. Try again.")
