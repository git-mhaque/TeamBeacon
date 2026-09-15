from __future__ import annotations

import unittest

from services.api.response_cache import ResponseCache


class ResponseCacheUnitTests(unittest.TestCase):
    def test_reuses_matching_data_version_and_returns_a_copy(self) -> None:
        cache = ResponseCache()
        calls = 0

        def load() -> dict[str, object]:
            nonlocal calls
            calls += 1
            return {"items": [calls]}

        first = cache.get_or_load("dashboard", data_version="sync-1", force_refresh=False, loader=load)
        first["items"].append(99)  # type: ignore[index]
        second = cache.get_or_load("dashboard", data_version="sync-1", force_refresh=False, loader=load)

        self.assertEqual(calls, 1)
        self.assertEqual(second, {"items": [1]})

    def test_bypasses_cache_when_forced_or_source_data_changes(self) -> None:
        cache = ResponseCache()
        calls = 0

        def load() -> dict[str, int]:
            nonlocal calls
            calls += 1
            return {"call": calls}

        cache.get_or_load("initiatives", data_version="sync-1", force_refresh=False, loader=load)
        forced = cache.get_or_load("initiatives", data_version="sync-1", force_refresh=True, loader=load)
        changed = cache.get_or_load("initiatives", data_version="sync-2", force_refresh=False, loader=load)

        self.assertEqual(forced, {"call": 2})
        self.assertEqual(changed, {"call": 3})

    def test_expires_entries_and_clear_removes_them(self) -> None:
        cache = ResponseCache(ttl_seconds=-1)
        calls = 0

        def load() -> dict[str, int]:
            nonlocal calls
            calls += 1
            return {"call": calls}

        cache.get_or_load("dashboard", data_version="sync-1", force_refresh=False, loader=load)
        cache.get_or_load("dashboard", data_version="sync-1", force_refresh=False, loader=load)
        cache.clear()
        cache.get_or_load("dashboard", data_version="sync-1", force_refresh=False, loader=load)

        self.assertEqual(calls, 3)
