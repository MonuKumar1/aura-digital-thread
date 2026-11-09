from __future__ import annotations

from app.models.enums import AgentStatus
from app.models.schemas import AgentEvidence, OrchestrationResult
from app.models.tables import AgentReviewAnswer
from app.orchestrator.service import reconcile_agent_review_statuses


def _result() -> OrchestrationResult:
    return OrchestrationResult(
        intake_id=1,
        agent_results=[
            AgentEvidence(agent_type="security", status=AgentStatus.NEEDS_REVIEW, follow_up_questions=["Q1?", "Q2?"]),
            AgentEvidence(agent_type="privacy", status=AgentStatus.SKIPPED, not_applicable=True),
            AgentEvidence(agent_type="release", status=AgentStatus.AUTO_APPROVED, derived_fields={"stp_eligible": True}),
        ],
        overall_status=AgentStatus.NEEDS_REVIEW, straight_through_eligible=False,
        questions_raw_count=120, questions_replaced_count=80, systems_replaced_count=9,
    )


def _answer(question: str, text: str = "Done") -> AgentReviewAnswer:
    return AgentReviewAnswer(intake_id=1, agent_type="security", question=question, answer=text, answered_by="t")


def test_partial_answers_keep_needs_review() -> None:
    out = reconcile_agent_review_statuses(_result(), [_answer("Q1?")])
    assert out.agent_results[0].status == AgentStatus.NEEDS_REVIEW
    assert out.overall_status == AgentStatus.NEEDS_REVIEW and not out.straight_through_eligible


def test_all_answers_flip_to_reviewed_and_enable_stp() -> None:
    out = reconcile_agent_review_statuses(_result(), [_answer("Q1?"), _answer(" Q2? ")])
    assert out.agent_results[0].status == AgentStatus.REVIEWED
    assert out.overall_status == AgentStatus.REVIEWED
    assert out.straight_through_eligible


def test_blank_answers_do_not_count() -> None:
    out = reconcile_agent_review_statuses(_result(), [_answer("Q1?"), _answer("Q2?", "   ")])
    assert out.agent_results[0].status == AgentStatus.NEEDS_REVIEW
