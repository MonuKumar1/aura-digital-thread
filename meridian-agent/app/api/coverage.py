from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.api.deps import get_intake_or_404
from app.db import get_session
from app.models.enums import AGENT_ORDER, STAGE_ORDER, AgentStatus, InitiativeStatus
from app.models.schemas import OrchestrationResult
from app.models.tables import Intake, IntakeAssessment
from app.orchestrator.coverage import get_coverage_service
from app.orchestrator.lifecycle import refresh_statuses
from app.orchestrator.service import load_result

router = APIRouter(tags=["coverage"])
MINUTES_PER_QUESTION = 4


@router.get("/coverage/{intake_id}")
def coverage(intake_id: int, session: Session = Depends(get_session)) -> dict[str, Any]:
    intake = get_intake_or_404(session, intake_id)
    result = load_result(session, intake_id)
    return get_coverage_service().compute(intake, result.agent_results if result else None)


@router.get("/metrics")
def metrics(session: Session = Depends(get_session)) -> dict[str, Any]:
    refresh_statuses(session)
    intakes = session.exec(select(Intake)).all()
    results = [OrchestrationResult.model_validate_json(a.assessment_json) for a in session.exec(select(IntakeAssessment)).all()]
    agent_dist: dict[str, Counter[str]] = defaultdict(Counter)
    for r in results:
        for ev in r.agent_results:
            agent_dist[ev.agent_type][ev.status.value] += 1
    assessed = len(results)
    replaced = sum(r.questions_replaced_count for r in results)
    stp = sum(1 for r in results if r.straight_through_eligible)
    return {
        "total_intakes": len(intakes),
        "assessed_intakes": assessed,
        "by_stage": {s.value: sum(1 for i in intakes if i.current_stage == s.value) for s in STAGE_ORDER},
        "by_status": {s.value: sum(1 for i in intakes if i.status == s.value) for s in InitiativeStatus},
        "by_overall_status": dict(Counter(r.overall_status.value for r in results)),
        "stp_eligible": stp,
        "stp_pct": round(100 * stp / assessed, 1) if assessed else 0.0,
        "avg_coverage_pct": round(sum(r.coverage_pct for r in results) / assessed, 1) if assessed else 0.0,
        "questions_replaced_total": replaced,
        "questions_master_total": get_coverage_service().total,
        "estimated_hours_saved": round(replaced * MINUTES_PER_QUESTION / 60, 1),
        "agent_status_distribution": {a: {s.value: agent_dist[a].get(s.value, 0) for s in AgentStatus} for a in AGENT_ORDER},
        "open_reviews": sum(1 for r in results for ev in r.agent_results if ev.status in (AgentStatus.NEEDS_REVIEW, AgentStatus.FLAGGED)),
    }
