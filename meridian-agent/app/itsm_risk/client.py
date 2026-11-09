from __future__ import annotations

from typing import Any, Optional, Protocol

from app.mocks.fixtures import fixtures
from app.mocks.provider import select_provider


def risk_band(score: int) -> str:
    return "High" if score >= 70 else "Medium" if score >= 40 else "Low"


class ItsmRiskClient(Protocol):
    def get_change_risk(self, ci_id: Optional[str], change_profile: dict[str, Any]) -> dict[str, Any]: ...


class MockItsmRiskClient:
    def __init__(self) -> None:
        self._base = fixtures()["itsm_risk"]

    def get_change_risk(self, ci_id: Optional[str], change_profile: dict[str, Any]) -> dict[str, Any]:
        base = self._base.get((ci_id or "").upper(), {"base_score": 30, "open_incidents": 0, "failed_changes_90d": 0})
        score = int(base["base_score"])
        score += 15 if change_profile.get("outage_expected") else 0
        score += 10 if change_profile.get("customer_impacting") else 0
        score -= 10 if change_profile.get("implementation_method") == "AUTOMATED_PIPELINE" else 0
        score = max(0, min(100, score))
        return {
            "ci_id": ci_id,
            "score": score,
            "band": risk_band(score),
            "open_incidents": base["open_incidents"],
            "failed_changes_90d": base["failed_changes_90d"],
        }


def get_itsm_risk_client() -> ItsmRiskClient:
    return select_provider("itsm_risk", MockItsmRiskClient)
