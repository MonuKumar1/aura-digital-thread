from __future__ import annotations

import hashlib
from typing import Any, Protocol

from app.mocks.fixtures import fixtures
from app.mocks.provider import select_provider


class SecPortalClient(Protocol):
    def submit_assessment(self, payload: dict[str, Any]) -> dict[str, Any]: ...


def _triggers(p: dict[str, Any]) -> set[str]:
    t: set[str] = set()
    if p.get("internet_facing"):
        t.add("internet_facing")
    if p.get("handles_payment_data"):
        t.add("handles_payment_data")
    if p.get("authentication_method") in (None, "PASSWORD", "NONE", "API_KEY"):
        t.add("weak_auth")
    if not p.get("encryption_in_transit"):
        t.add("no_tls")
    if p.get("third_party_vendor_involved"):
        t.add("third_party")
    if not p.get("penetration_test_planned"):
        t.add("pen_test")
    if p.get("privileged_access_required"):
        t.add("privileged")
    return t


class MockSecPortalClient:
    def __init__(self) -> None:
        self._controls = fixtures()["security_controls"]

    def submit_assessment(self, payload: dict[str, Any]) -> dict[str, Any]:
        seed = f"{payload.get('intake_id')}|{payload.get('application_ci_id')}|{payload.get('initiative_name')}"
        digest = hashlib.sha1(seed.encode()).hexdigest()[:6].upper()
        triggers = _triggers(payload)
        required = [
            {**c, "ticket_ref": f"SECT-{digest}-{i + 1:02d}"}
            for i, c in enumerate(c for c in self._controls if c["trigger"] in triggers)
        ]
        return {
            "assessment_id": f"SA-{digest}",
            "ticket_ref": f"SECT-{digest}",
            "outcome": "CONDITIONAL" if required else "APPROVED",
            "required_controls": required,
            "portal_url": f"https://secportal.example.com/assessments/SA-{digest}",
        }


def get_secportal_client() -> SecPortalClient:
    return select_provider("secportal", MockSecPortalClient)
