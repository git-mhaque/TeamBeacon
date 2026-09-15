from __future__ import annotations

from collections import OrderedDict
from copy import deepcopy
from dataclasses import dataclass
from threading import RLock
from time import monotonic
from typing import Any, Callable


@dataclass(frozen=True)
class _CacheEntry:
    created_at: float
    data_version: str
    payload: dict[str, Any]


class ResponseCache:
    """A bounded in-memory cache for computed API responses."""

    def __init__(self, *, ttl_seconds: float = 24 * 60 * 60, max_entries: int = 64) -> None:
        self._ttl_seconds = ttl_seconds
        self._max_entries = max_entries
        self._entries: OrderedDict[str, _CacheEntry] = OrderedDict()
        self._lock = RLock()

    def get_or_load(
        self,
        key: str,
        *,
        data_version: str,
        force_refresh: bool,
        loader: Callable[[], dict[str, Any]],
    ) -> dict[str, Any]:
        now = monotonic()
        with self._lock:
            entry = self._entries.get(key)
            if (
                not force_refresh
                and entry is not None
                and entry.data_version == data_version
                and now - entry.created_at < self._ttl_seconds
            ):
                self._entries.move_to_end(key)
                return deepcopy(entry.payload)

        payload = loader()
        with self._lock:
            self._entries[key] = _CacheEntry(now, data_version, deepcopy(payload))
            self._entries.move_to_end(key)
            while len(self._entries) > self._max_entries:
                self._entries.popitem(last=False)
        return payload

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
