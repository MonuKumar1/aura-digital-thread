from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, col, select

from app.api.deps import get_intake_or_404
from app.db import get_session
from app.models.enums import AGENT_LABELS, STAGE_ORDER, AgentStatus, LifecycleStage, RESOLVED_STATUSES
from app.models.schemas import AdvanceStageIn, DeadlineUpdateIn, StageDeadlineOut, TransitionOut
from app.models.tables import FieldChangeLog, IntakeAssessment, StageDeadline, StageTransitionLog, utcnow
from app.orchestrator.lifecycle import ensure_deadlines, status_for, status_label
from app.orchestrator.service import reconcile_and_persist

router = APIRouter(prefix="/lifecycle", tags=["lifecycle"])
STAGE_VALUES = [s.value for s in STAGE_ORDER]


def _deadlines_payload(intake_stage: str, rows: list[StageDeadline]) -> dict[str, Any]:
    return {"current_stage": intake_stage, "deadlines": [StageDeadlineOut.model_validate(r).model_dump(mode="json") for r in rows]}


@router.get("/{intake_id}/stage-deadlines")
def get_stage_deadlines(intake_id: int, session: Session = Depends(get_session)) -> dict[str, Any]:
    intake = get_intake_or_404(session, intake_id)
    rows = ensure_deadlines(session, intake)  # lazy seed
    session.commit()
    return _deadlines_payload(intake.current_stage, rows)


@router.patch("/{intake_id}/stage-deadlines/{stage}")
def update_stage_deadline(intake_id: int, stage: LifecycleStage, payload: DeadlineUpdateIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    intake = get_intake_or_404(session, intake_id)
    rows = ensure_deadlines(session, intake)
    row = next(r for r in rows if r.stage == stage.value)
    old = row.due_date
    row.due_date = payload.due_date
    session.add(row)
    session.add(FieldChangeLog(intake_id=intake_id, field=f"deadline:{stage.value}", old_value=old.isoformat(),
                               new_value=payload.due_date.isoformat(), changed_by="user"))
    assessment = session.exec(select(IntakeAssessment).where(IntakeAssessment.intake_id == intake_id)).first()
    intake.status = status_for(intake, assessment, {r.stage: r.due_date for r in rows}).value
    session.add(intake)
    session.commit()
    return _deadlines_payload(intake.current_stage, rows)


@router.post("/{intake_id}/advance-stage")
def advance_stage(intake_id: int, payload: AdvanceStageIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    intake = get_intake_or_404(session, intake_id)
    if not payload.comment.strip():
        raise HTTPException(status_code=422, detail="An approval comment is required to advance the stage")
    if intake.current_stage == LifecycleStage.PRODUCTION.value:
        raise HTTPException(status_code=422, detail="Initiative is already in Production")
    result = reconcile_and_persist(session, intake)
    if result is None:
        raise HTTPException(status_code=422, detail="Run orchestration before advancing the stage")
    blocking = [AGENT_LABELS.get(r.agent_type, r.agent_type) for r in result.agent_results
                if r.status != AgentStatus.SKIPPED and r.status not in RESOLVED_STATUSES]
    if blocking:
        raise HTTPException(status_code=422, detail=f"Unresolved agents must be approved or reviewed first: {', '.join(blocking)}")

    from_stage = intake.current_stage
    to_stage = STAGE_VALUES[STAGE_VALUES.index(from_stage) + 1]
    intake.current_stage = to_stage
    intake.updated_at = utcnow()
    session.add(StageTransitionLog(intake_id=intake_id, from_stage=from_stage, to_stage=to_stage,
                                   comment=payload.comment.strip(), approved_by=payload.approved_by))
    rows = ensure_deadlines(session, intake)
    assessment = session.exec(select(IntakeAssessment).where(IntakeAssessment.intake_id == intake_id)).first()
    intake.status = status_for(intake, assessment, {r.stage: r.due_date for r in rows}).value
    session.add(intake)
    session.commit()
    return {"intake_id": intake_id, "from_stage": from_stage, "to_stage": to_stage,
            "status": intake.status, "status_label": status_label(intake.status)}


@router.get("/{intake_id}/history")
def history(intake_id: int, session: Session = Depends(get_session)) -> dict[str, Any]:
    get_intake_or_404(session, intake_id)
    transitions = session.exec(select(StageTransitionLog).where(StageTransitionLog.intake_id == intake_id)
                               .order_by(col(StageTransitionLog.created_at).desc())).all()
    changes = session.exec(select(FieldChangeLog).where(FieldChangeLog.intake_id == intake_id)
                           .order_by(col(FieldChangeLog.created_at).desc()).limit(100)).all()
    return {
        "transitions": [TransitionOut.model_validate(t).model_dump(mode="json") for t in transitions],
        "field_changes": [{"field": c.field, "old_value": c.old_value, "new_value": c.new_value,
                           "changed_by": c.changed_by, "created_at": c.created_at.isoformat()} for c in changes],
    }
