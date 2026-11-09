from __future__ import annotations

import threading
import uuid
from typing import Any, Optional, Protocol

from app.mocks.provider import select_provider

TRACKER_BASE_URL = "https://tracker.example.com/items"


class TrackerClient(Protocol):
    def create_item(self, kind: str, title: str, description_html: str, parent_id: Optional[str] = None) -> dict[str, Any]: ...
    def update_state(self, external_id: str, state: str) -> dict[str, Any]: ...


class MockTrackerClient:
    """In-memory work tracker. IDs are random so they never collide with ones persisted by earlier runs."""

    _lock = threading.Lock()
    _items: dict[str, dict[str, Any]] = {}

    def create_item(self, kind: str, title: str, description_html: str, parent_id: Optional[str] = None) -> dict[str, Any]:
        prefix = {"epic": "EP", "feature": "FE", "task": "TK"}.get(kind, "WI")
        ext_id = f"{prefix}-{uuid.uuid4().hex[:8].upper()}"
        item = {"external_id": ext_id, "kind": kind, "title": title, "parent_id": parent_id,
                "state": "New", "url": f"{TRACKER_BASE_URL}/{ext_id}", "description_html": description_html}
        with self._lock:
            self._items[ext_id] = item
        return dict(item)

    def update_state(self, external_id: str, state: str) -> dict[str, Any]:
        with self._lock:
            item = self._items.setdefault(external_id, {"external_id": external_id, "url": f"{TRACKER_BASE_URL}/{external_id}"})
            item["state"] = state
            return dict(item)


def get_tracker_client() -> TrackerClient:
    return select_provider("tracker", MockTrackerClient)
