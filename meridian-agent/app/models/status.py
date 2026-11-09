from __future__ import annotations

from datetime import date
from typing import Iterable, Optional

from app.models.enums import AgentStatus, InitiativeStatus, LifecycleStage, RESOLVED_STATUSES


def derive_initiative_status(
    current_stage: str,
    agent_statuses: Optional[Iterable[str]],
    current_stage_due: Optional[date],
    today: date,
    at_risk_threshold_days: int,
) -> InitiativeStatus:
    """Precedence: COMPLETED -> REJECTED -> ORCHESTRATING -> AWAITING_HUMAN_INPUT -> SUBMITTED.

    `agent_statuses` is None when no assessment has run yet; that counts as unresolved.
    """
    if current_stage == LifecycleStage.PRODUCTION.value:
        return InitiativeStatus.COMPLETED

    statuses = [AgentStatus(s) for s in agent_statuses] if agent_statuses is not None else None
    active = [s for s in statuses or [] if s != AgentStatus.SKIPPED]
    unresolved = statuses is None or any(s not in RESOLVED_STATUSES for s in active)
    awaiting_human = any(s in (AgentStatus.NEEDS_REVIEW, AgentStatus.FLAGGED, AgentStatus.FAILED) for s in active)

    overdue = current_stage_due is not None and current_stage_due < today
    due_soon = current_stage_due is not None and 0 <= (current_stage_due - today).days <= at_risk_threshold_days

    if overdue and unresolved:
        return InitiativeStatus.REJECTED
    if overdue or due_soon:
        return InitiativeStatus.ORCHESTRATING
    if awaiting_human:
        return InitiativeStatus.AWAITING_HUMAN_INPUT
    return InitiativeStatus.SUBMITTED
