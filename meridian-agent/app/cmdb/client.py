from __future__ import annotations

import json
import logging
from typing import Any, Optional, Protocol

from app.mocks.fixtures import fixtures
from app.mocks.provider import select_provider

logger = logging.getLogger(__name__)


class CmdbClient(Protocol):
    def get_record(self, ci_id: str) -> Optional[dict[str, Any]]: ...
    def list_records(self) -> list[dict[str, Any]]: ...


class MockCmdbClient:
    def __init__(self) -> None:
        self._records = {r["ci_id"]: r for r in fixtures()["cmdb"]}

    def get_record(self, ci_id: str) -> Optional[dict[str, Any]]:
        rec = self._records.get((ci_id or "").strip().upper())
        return dict(rec) if rec else None

    def list_records(self) -> list[dict[str, Any]]:
        return [dict(r) for r in self._records.values()]


def get_cmdb_client() -> CmdbClient:
    return select_provider("cmdb", MockCmdbClient)


# Intake field -> CMDB attribute used to fill blanks at autofill time.
CMDB_AUTOFILL: dict[str, str] = {
    "rto_hours": "rto_hours", "rpo_hours": "rpo_hours", "cloud_service_type": "cloud_service_type",
    "target_environment": "target_environment", "architecture_pattern": "architecture_pattern", "business_unit": "domain",
}


def apply_cmdb_autofill(intake: Any, client: Optional[CmdbClient] = None) -> Optional[dict[str, Any]]:
    """Captures the CMDB snapshot once (persisted on the intake) and fills blank fields from it."""
    ci_id = getattr(intake, "application_ci_id", None)
    record = (client or get_cmdb_client()).get_record(ci_id) if ci_id else None
    intake.cmdb_snapshot = json.dumps(record) if record else None
    if not record:
        return None
    for field, source in CMDB_AUTOFILL.items():
        if getattr(intake, field) in (None, "") and record.get(source) is not None:
            setattr(intake, field, record[source])
    if record.get("ibs"):
        intake.important_business_service = True
    return record


def get_cmdb_record_for_intake(intake: Any, client: Optional[CmdbClient] = None) -> dict[str, Any]:
    """Prefer the snapshot captured at intake autofill; fall back to a live (mock) lookup."""
    raw = getattr(intake, "cmdb_snapshot", None)
    if raw:
        try:
            snap = json.loads(raw) if isinstance(raw, str) else dict(raw)
            if isinstance(snap, dict) and snap:
                return snap
        except (ValueError, TypeError):
            logger.warning("Invalid cmdb_snapshot on intake %s; falling back to live lookup", getattr(intake, "id", "?"))
    ci_id = getattr(intake, "application_ci_id", None)
    if not ci_id:
        return {}
    return (client or get_cmdb_client()).get_record(ci_id) or {}
