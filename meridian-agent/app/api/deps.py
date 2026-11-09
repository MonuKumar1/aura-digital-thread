from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import HTTPException
from sqlmodel import Session

from app.models.schemas import IntakeRead
from app.models.tables import Intake, IntakeAssessment
from app.orchestrator.lifecycle import status_label


def get_intake_or_404(session: Session, intake_id: int) -> Intake:
    intake = session.get(Intake, intake_id)
    if intake is None:
        raise HTTPException(status_code=404, detail=f"Intake {intake_id} not found")
    return intake


def _json_or_none(raw: Optional[str]) -> Optional[dict[str, Any]]:
    if not raw:
        return None
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except ValueError:
        return None


def to_read(intake: Intake, assessment: Optional[IntakeAssessment] = None) -> IntakeRead:
    data = intake.model_dump()
    data.update(
        cmdb_snapshot=_json_or_none(intake.cmdb_snapshot),
        si_design_evidence=_json_or_none(intake.si_design_evidence),
        status_label=status_label(intake.status),
        overall_status=assessment.overall_status if assessment else None,
        straight_through_eligible=assessment.straight_through_eligible if assessment else None,
    )
    return IntakeRead.model_validate(data)
