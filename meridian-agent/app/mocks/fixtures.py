from __future__ import annotations

import copy
import json
from functools import lru_cache
from typing import Any

from app.config import get_settings


@lru_cache
def _load() -> dict[str, Any]:
    path = get_settings().data_dir / "mock_fixtures.json"
    return json.loads(path.read_text(encoding="utf-8"))


def fixtures() -> dict[str, Any]:
    """Deep copy so callers can't mutate the shared fixture set (same file the UI mock imports)."""
    return copy.deepcopy(_load())
