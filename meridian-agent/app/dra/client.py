from __future__ import annotations

import hashlib
from typing import Any, Protocol

from app.mocks.provider import select_provider


class DraClient(Protocol):
    def prefill_assessment(self, payload: dict[str, Any]) -> dict[str, Any]: ...


class MockDraClient:
    def prefill_assessment(self, payload: dict[str, Any]) -> dict[str, Any]:
        digest = hashlib.sha1(f"{payload.get('intake_id')}|{payload.get('initiative_name')}".encode()).hexdigest()[:6].upper()
        answers = {
            "DRA-Q1 Personal data in scope": "Yes" if payload.get("personal_data_processed") else "No",
            "DRA-Q2 Special category data": "Yes" if payload.get("sensitive_personal_data_processed") else "No",
            "DRA-Q3 Lawful basis": payload.get("lawful_basis") or "Not stated",
            "DRA-Q4 International transfer": "Yes" if payload.get("cross_border_data_transfer") else "No",
            "DRA-Q5 Transfer destinations": payload.get("transfer_destinations") or "None",
            "DRA-Q6 Retention period (months)": str(payload.get("data_retention_months") or "Not stated"),
            "DRA-Q7 Data minimisation": "Yes" if payload.get("data_minimisation_applied") else "No",
        }
        high = payload.get("sensitive_personal_data_processed") or payload.get("cross_border_data_transfer")
        return {
            "dra_id": f"DRA-{digest}",
            "answers": answers,
            "residual_risk": "High" if high else "Medium" if payload.get("personal_data_processed") else "Low",
            "portal_url": f"https://dra.example.com/assessments/DRA-{digest}",
        }


def get_dra_client() -> DraClient:
    return select_provider("dra", MockDraClient)
