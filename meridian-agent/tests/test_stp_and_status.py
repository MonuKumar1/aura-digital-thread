from __future__ import annotations

from datetime import date, timedelta

from app.agents.change_release import is_stp_eligible
from app.models.enums import AgentStatus, InitiativeStatus
from app.models.schemas import AgentEvidence
from app.models.status import derive_initiative_status
from app.orchestrator.status import compute_overall_status, compute_stp
from tests.conftest import make_intake

TODAY = date(2026, 1, 15)


def ev(agent: str, status: AgentStatus, **derived: object) -> AgentEvidence:
    return AgentEvidence(agent_type=agent, status=status, derived_fields=dict(derived))


def test_release_stp_rules() -> None:
    assert is_stp_eligible(make_intake())
    assert is_stp_eligible(make_intake(backout_plan_summary=None, implementation_method="AUTOMATED_PIPELINE"))
    assert not is_stp_eligible(make_intake(backout_plan_summary=None, implementation_method="MANUAL"))
    assert not is_stp_eligible(make_intake(outage_expected=True))
    assert not is_stp_eligible(make_intake(customer_impacting=True))


def test_stp_requires_all_applicable_resolved_and_ignores_skipped() -> None:
    release = ev("release", AgentStatus.AUTO_APPROVED, stp_eligible=True)
    assert compute_stp([release, ev("security", AgentStatus.SKIPPED), ev("clarity", AgentStatus.REVIEWED)])
    assert not compute_stp([release, ev("security", AgentStatus.NEEDS_REVIEW)])
    assert not compute_stp([ev("release", AgentStatus.AUTO_APPROVED, stp_eligible=False)])


def test_overall_status_priority() -> None:
    assert compute_overall_status([ev("a", AgentStatus.FLAGGED), ev("b", AgentStatus.FAILED)]) == AgentStatus.FAILED
    assert compute_overall_status([ev("a", AgentStatus.NEEDS_REVIEW), ev("b", AgentStatus.FLAGGED)]) == AgentStatus.FLAGGED
    assert compute_overall_status([ev("a", AgentStatus.REVIEWED), ev("b", AgentStatus.AUTO_APPROVED)]) == AgentStatus.REVIEWED
    assert compute_overall_status([ev("a", AgentStatus.AUTO_APPROVED), ev("b", AgentStatus.SKIPPED)]) == AgentStatus.AUTO_APPROVED
    assert compute_overall_status([ev("a", AgentStatus.SKIPPED)]) == AgentStatus.PENDING


def test_status_derivation_precedence() -> None:
    open_ = ["NEEDS_REVIEW", "AUTO_APPROVED"]
    done = ["AUTO_APPROVED", "SKIPPED"]
    past, soon, far = TODAY - timedelta(days=1), TODAY + timedelta(days=2), TODAY + timedelta(days=30)
    assert derive_initiative_status("Production", open_, past, TODAY, 3) == InitiativeStatus.COMPLETED
    assert derive_initiative_status("Build", open_, past, TODAY, 3) == InitiativeStatus.REJECTED
    assert derive_initiative_status("Build", None, past, TODAY, 3) == InitiativeStatus.REJECTED
    assert derive_initiative_status("Build", done, past, TODAY, 3) == InitiativeStatus.ORCHESTRATING
    assert derive_initiative_status("Build", open_, soon, TODAY, 3) == InitiativeStatus.ORCHESTRATING
    assert derive_initiative_status("Build", open_, far, TODAY, 3) == InitiativeStatus.AWAITING_HUMAN_INPUT
    assert derive_initiative_status("Build", done, far, TODAY, 3) == InitiativeStatus.SUBMITTED
    assert derive_initiative_status("Build", done, None, TODAY, 3) == InitiativeStatus.SUBMITTED
