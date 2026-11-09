from __future__ import annotations

from typing import Any, Optional, Protocol

from app.mocks.fixtures import fixtures
from app.mocks.provider import select_provider


class ArchPortalClient(Protocol):
    def get_capability_impact(self, ci_id: Optional[str], context: dict[str, Any]) -> dict[str, Any]: ...


class MockArchPortalClient:
    def __init__(self) -> None:
        fx = fixtures()
        self._reports = fx["archportal"]
        self._doc = fx["architecture_document"]

    def get_capability_impact(self, ci_id: Optional[str], context: dict[str, Any]) -> dict[str, Any]:
        key = (ci_id or "").upper()
        base = self._reports.get(key, {"capabilities": ["Unmapped Capability"], "impact_level": "Medium", "dependencies": []})
        new_capability = context.get("initiative_type") == "NEW_SERVICE"
        return {
            "report_id": f"CIR-{key or 'NEW'}",
            "capabilities_impacted": base["capabilities"],
            "impact_level": "High" if new_capability and base["impact_level"] == "Medium" else base["impact_level"],
            "dependencies": base["dependencies"],
            "new_capability": new_capability,
            "source_document": self._doc,
            "portal_url": f"https://archportal.example.com/reports/CIR-{key or 'NEW'}",
        }


def get_archportal_client() -> ArchPortalClient:
    return select_provider("archportal", MockArchPortalClient)
