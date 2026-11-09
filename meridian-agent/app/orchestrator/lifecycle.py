from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Iterable, Optional

from sqlmodel import Session, col, select

from app.config import get_settings
from app.models.enums import STAGE_ORDER, STATUS_LABELS, InitiativeStatus, LifecycleStage
from app.models.status import derive_initiative_status
from app.models.tables import Intake, IntakeAssessment, StageDeadline

FALLBACK_SPAN_DAYS = 90


def compute_stage_deadlines(start: date, target_go_live: Optional[date]) -> dict[str, date]:
    """Evenly split submission -> go-live across the six stages (90-day window when go-live is missing or past)."""
    end = target_go_live if target_go_live and target_go_live > start else start + timedelta(days=FALLBACK_SPAN_DAYS)
    span = (end - start).days
    n = len(STAGE_ORDER)
    return {stage.value: start + timedelta(days=round(span * (i + 1) / n)) for i, stage in enumerate(STAGE_ORDER)}


def ensure_deadlines(session: Session, intake: Intake) -> list[StageDeadline]:
    rows = session.exec(select(StageDeadline).where(StageDeadline.intake_id == intake.id)).all()
    if rows:
        return sorted(rows, key=lambda r: [s.value for s in STAGE_ORDER].index(r.stage))
    created = [StageDeadline(intake_id=intake.id, stage=stage, due_date=due)  # type: ignore[arg-type]
               for stage, due in compute_stage_deadlines(intake.created_at.date(), intake.target_go_live).items()]
    session.add_all(created)
    session.flush()
    return created


def deadlines_by_intake(session: Session, intake_ids: Iterable[int]) -> dict[int, dict[str, date]]:
    """One query for all deadlines of a page of intakes (avoids N+1)."""
    ids = list(intake_ids)
    out: dict[int, dict[str, date]] = {i: {} for i in ids}
    if not ids:
        return out
    for row in session.exec(select(StageDeadline).where(col(StageDeadline.intake_id).in_(ids))).all():
        out[row.intake_id][row.stage] = row.due_date
    return out


def assessments_by_intake(session: Session, intake_ids: Iterable[int]) -> dict[int, IntakeAssessment]:
    ids = list(intake_ids)
    if not ids:
        return {}
    rows = session.exec(select(IntakeAssessment).where(col(IntakeAssessment.intake_id).in_(ids))).all()
    return {r.intake_id: r for r in rows}


def agent_statuses_from(assessment: Optional[IntakeAssessment]) -> Optional[list[str]]:
    if assessment is None:
        return None
    data = json.loads(assessment.assessment_json)
    return [r["status"] for r in data.get("agent_results", [])]


def status_for(intake: Intake, assessment: Optional[IntakeAssessment], deadlines: dict[str, date], today: Optional[date] = None) -> InitiativeStatus:
    return derive_initiative_status(
        intake.current_stage,
        agent_statuses_from(assessment),
        deadlines.get(intake.current_stage),
        today or date.today(),
        get_settings().at_risk_threshold_days,
    )


def refresh_statuses(session: Session, intakes: Optional[list[Intake]] = None) -> None:
    """Recomputes time-dependent statuses in bulk (3 queries + 1 commit) so SQL filters/sorts see current values."""
    if intakes is None:
        intakes = list(session.exec(select(Intake).where(Intake.current_stage != LifecycleStage.PRODUCTION.value)).all())
    ids = [i.id for i in intakes if i.id is not None]
    deadlines = deadlines_by_intake(session, ids)
    assessments = assessments_by_intake(session, ids)
    changed = False
    for intake in intakes:
        new = status_for(intake, assessments.get(intake.id), deadlines.get(intake.id, {})).value  # type: ignore[arg-type]
        if intake.status != new:
            intake.status = new
            session.add(intake)
            changed = True
    if changed:
        session.commit()


def status_label(status: str) -> str:
    try:
        return STATUS_LABELS[InitiativeStatus(status)]
    except ValueError:
        return status
