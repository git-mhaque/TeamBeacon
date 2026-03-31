from __future__ import annotations

import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from services.api.integrations.jira_sync import _ensure_schema
from services.api.issues.current_sprint import get_current_sprint


class CurrentSprintServiceUnitTests(unittest.TestCase):
    def _init_db(self, db_path: Path) -> None:
        conn = sqlite3.connect(str(db_path))
        try:
            _ensure_schema(conn)
            conn.commit()
        finally:
            conn.close()

    def test_get_current_sprint_returns_latest_active_sprint_with_remaining_days(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"
            self._init_db(db_path)

            conn = sqlite3.connect(str(db_path))
            try:
                conn.executemany(
                    """
                    INSERT INTO sprints (
                      external_sprint_id,
                      board_external_id,
                      name,
                      state,
                      start_date,
                      end_date
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            11001,
                            27193,
                            "Legacy Active Sprint",
                            "active",
                            "2026-03-01T00:00:00+00:00",
                            "2026-03-10T00:00:00+00:00",
                        ),
                        (
                            11002,
                            27193,
                            "Current Platform Sprint",
                            "active",
                            "2026-03-20T00:00:00+00:00",
                            "2026-03-30T00:00:00+00:00",
                        ),
                        (
                            11003,
                            27193,
                            "Future Sprint",
                            "future",
                            "2026-04-01T00:00:00+00:00",
                            "2026-04-14T00:00:00+00:00",
                        ),
                    ],
                )
                conn.commit()
            finally:
                conn.close()

            payload = get_current_sprint(
                db_path=str(db_path),
                now_utc=datetime(2026, 3, 26, 0, 0, 0, tzinfo=timezone.utc),
            )
            sprint = payload["sprint"]

            self.assertEqual(payload["source"], "local")
            self.assertIsNone(payload["error"])
            self.assertIsNotNone(sprint)
            self.assertEqual(sprint["id"], 11002)
            self.assertEqual(sprint["boardId"], 27193)
            self.assertEqual(sprint["name"], "Current Platform Sprint")
            self.assertEqual(sprint["startDate"], "2026-03-20T00:00:00+00:00")
            self.assertEqual(sprint["endDate"], "2026-03-30T00:00:00+00:00")
            self.assertEqual(sprint["remainingDays"], 4)

    def test_get_current_sprint_returns_empty_when_no_active_sprint_exists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"
            self._init_db(db_path)

            conn = sqlite3.connect(str(db_path))
            try:
                conn.execute(
                    """
                    INSERT INTO sprints (
                      external_sprint_id,
                      board_external_id,
                      name,
                      state,
                      start_date,
                      end_date
                    ) VALUES (12001, 27193, 'Recently Closed Sprint', 'closed', '2026-03-10T00:00:00+00:00', '2026-03-24T00:00:00+00:00')
                    """
                )
                conn.commit()
            finally:
                conn.close()

            payload = get_current_sprint(db_path=str(db_path))
            self.assertEqual(payload["source"], "local")
            self.assertIsNone(payload["sprint"])
            self.assertEqual(payload["error"], "No active sprint found in local data.")

    def test_get_current_sprint_includes_board_url(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"
            self._init_db(db_path)

            conn = sqlite3.connect(str(db_path))
            try:
                conn.execute(
                    """
                    INSERT INTO sprints (
                      external_sprint_id,
                      board_external_id,
                      name,
                      state,
                      start_date,
                      end_date
                    ) VALUES (14001, 27193, 'Current Sprint', 'active', '2026-03-20T00:00:00+00:00', '2026-04-02T00:00:00+00:00')
                    """
                )
                conn.commit()
            finally:
                conn.close()

            with patch.dict(
                "os.environ",
                {
                    "JIRA_BASE_URL": "https://gbujira.oraclecorp.com",
                    "JIRA_PAT": "token-123",
                    "JIRA_BOARD_ID": "27193",
                },
                clear=False,
            ):
                payload = get_current_sprint(db_path=str(db_path))

            sprint = payload["sprint"]
            self.assertIsNotNone(sprint)
            self.assertEqual(
                sprint["sprintUrl"],
                "https://gbujira.oraclecorp.com/secure/RapidBoard.jspa?rapidView=27193",
            )

    def test_get_current_sprint_scopes_to_configured_board(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "teambeacon.db"
            self._init_db(db_path)

            conn = sqlite3.connect(str(db_path))
            try:
                conn.executemany(
                    """
                    INSERT INTO sprints (
                      external_sprint_id,
                      board_external_id,
                      name,
                      state,
                      start_date,
                      end_date
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            13001,
                            99999,
                            "Other Board Active Sprint",
                            "active",
                            "2026-03-22T00:00:00+00:00",
                            "2026-04-04T00:00:00+00:00",
                        ),
                        (
                            13002,
                            27193,
                            "Configured Board Active Sprint",
                            "active",
                            "2026-03-20T00:00:00+00:00",
                            "2026-04-02T00:00:00+00:00",
                        ),
                    ],
                )
                conn.commit()
            finally:
                conn.close()

            with patch.dict(
                "os.environ",
                {
                    "JIRA_BASE_URL": "https://jira.example.com",
                    "JIRA_PAT": "token-123",
                    "JIRA_BOARD_ID": "27193",
                },
                clear=False,
            ):
                payload = get_current_sprint(
                    db_path=str(db_path),
                    now_utc=datetime(2026, 3, 26, 0, 0, 0, tzinfo=timezone.utc),
                )

            sprint = payload["sprint"]
            self.assertIsNotNone(sprint)
            self.assertEqual(sprint["id"], 13002)
            self.assertEqual(sprint["boardId"], 27193)


if __name__ == "__main__":
    unittest.main()
