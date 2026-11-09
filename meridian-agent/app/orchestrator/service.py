from __future__ import annotations

import json
import logging
from typing import Iterable, Optional

from sqlmodel import Session, delete, select

from app.agents.base import Providers
from app.agents.registry import build_agents
from app.llm import LlmClient, get_llm_client
from app.models.enums import AgentStatus
from app.models.schemas import AgentEvidence, OrchestrationResult
from app.models.tables import AgentReviewAnswer, Intake, IntakeAssessment, utcnow
from app.orchestrator.coverage import get_coverage_service
from app.orchestrator.gate_rules import get_applicable_agents
from app.orchestrator.graph import ProgressCallback, build_graph
from app.orchestrator.lifecycle import ensure_deadlines, status_for
from app.orchestrator.status import compute_overall_status, compute_stp
from app.models.enums import AGENT_ORDER

logger = logging.getLogger(__name__)
REVIEWABLE = {AgentStatus.NEEDS_REVIEW, AgentStatus.FLAGGED}


def run_orchestration(
    session: Session,
    intake: Intake,
    on_progress: Optional[ProgressCallback] = None,
    llm: Optional[LlmClient] = None,
    providers: Optional[Providers] = None,
) -> OrchestrationResult:
    llm = llm or get_llm_client()
    agents = build_agents(llm, providers or Providers())
    applicable = get_applicable_agents(intake)
    graph = build_graph(agents, applicable, llm, on_progress)
    state = graph.invoke({"intake": intake, "results": {}, "notes": []})
    results: dict[str, AgentEvidence] = state["results"]
    ordered = [results[a] for a in AGENT_ORDER if a in results]

    # A re-run invalidates earlier human answers: the questions may have changed.
    session.exec(delete(AgentReviewAnswer).where(AgentReviewAnswer.intake_id == intake.id))  # type: ignore[call-overload]

    coverage = get_coverage_service().compute(intake, ordered)
    release = results.get("release")
    result = OrchestrationResult(
        intake_id=intake.id,  # type: ignore[arg-type]
        agent_results=ordered,
        overall_status=compute_overall_status(ordered),
        straight_through_eligible=compute_stp(ordered),
        questions_raw_count=coverage["total_questions"],
        questions_replaced_count=coverage["answered_questions"],
        systems_replaced_count=coverage["systems_replaced"],
        coverage_pct=coverage["coverage_pct"],
        notes=state.get("notes", []),
        work_item_id=release.derived_fields.get("tracker_task_id") if release else None,
        work_item_url=release.derived_fields.get("tracker_task_url") if release else None,
        generated_at=utcnow(),
    )
    save_result(session, intake, result, reset_manifest=True)
    return result


def load_result(session: Session, intake_id: int) -> Optional[OrchestrationResult]:
    row = session.exec(select(IntakeAssessment).where(IntakeAssessment.intake_id == intake_id)).first()
    return OrchestrationResult.model_validate_json(row.assessment_json) if row else None


def save_result(session: Session, intake: Intake, result: OrchestrationResult, reset_manifest: bool = False) -> IntakeAssessment:
    row = session.exec(select(IntakeAssessment).where(IntakeAssessment.intake_id == intake.id)).first()
    if row is None:
        row = IntakeAssessment(intake_id=intake.id, assessment_json="{}", overall_status=result.overall_status.value)  # type: ignore[arg-type]
    row.assessment_json = result.model_dump_json()
    row.overall_status = result.overall_status.value
    row.straight_through_eligible = result.straight_through_eligible
    row.updated_at = utcnow()
    if reset_manifest:
        row.manifest_json = None
    session.add(row)
    deadlines = {d.stage: d.due_date for d in ensure_deadlines(session, intake)}
    intake.status = status_for(intake, row, deadlines).value
    intake.updated_at = utcnow()
    session.add(intake)
    session.commit()
    session.refresh(row)
    return row


def reconcile_agent_review_statuses(result: OrchestrationResult, answers: Iterable[AgentReviewAnswer]) -> OrchestrationResult:
    """Flips NEEDS_REVIEW/FLAGGED agents to REVIEWED once every follow-up has a non-empty answer, then recomputes
    overall status and STP. Pure function: shared by the review-answers and cached-result endpoints."""
    answered: dict[str, set[str]] = {}
    for a in answers:
        if a.answer.strip():
            answered.setdefault(a.agent_type, set()).add(a.question.strip())
    updated: list[AgentEvidence] = []
    for ev in result.agent_results:
        ev = ev.model_copy(deep=True)
        questions = {q.strip() for q in ev.follow_up_questions}
        if ev.status in REVIEWABLE and questions and questions <= answered.get(ev.agent_type, set()):
            ev.status = AgentStatus.REVIEWED
        updated.append(ev)
    return result.model_copy(update={
        "agent_results": updated,
        "overall_status": compute_overall_status(updated),
        "straight_through_eligible": compute_stp(updated),
    })


def reconcile_and_persist(session: Session, intake: Intake) -> Optional[OrchestrationResult]:
    result = load_result(session, intake.id)  # type: ignore[arg-type]
    if result is None:
        return None
    answers = session.exec(select(AgentReviewAnswer).where(AgentReviewAnswer.intake_id == intake.id)).all()
    reconciled = reconcile_agent_review_statuses(result, answers)
    if reconciled.model_dump() != result.model_dump():
        save_result(session, intake, reconciled)
    return reconciled


def evidence_by_agent(result: OrchestrationResult) -> dict[str, AgentEvidence]:
    return {r.agent_type: r for r in result.agent_results}


def assessment_payload(result: OrchestrationResult) -> dict:
    return json.loads(result.model_dump_json())
