from __future__ import annotations

from typing import Iterable

from app.models.enums import AgentStatus, RESOLVED_STATUSES
from app.models.schemas import AgentEvidence

_PRIORITY = [AgentStatus.FAILED, AgentStatus.FLAGGED, AgentStatus.NEEDS_REVIEW]


def compute_overall_status(results: Iterable[AgentEvidence]) -> AgentStatus:
    """FAILED > FLAGGED > NEEDS_REVIEW > REVIEWED/AUTO_APPROVED > PENDING; skipped agents are ignored."""
    statuses = {r.status for r in results if r.status != AgentStatus.SKIPPED}
    for s in _PRIORITY:
        if s in statuses:
            return s
    if AgentStatus.PENDING in statuses or not statuses:
        return AgentStatus.PENDING
    return AgentStatus.REVIEWED if AgentStatus.REVIEWED in statuses else AgentStatus.AUTO_APPROVED


def compute_stp(results: Iterable[AgentEvidence]) -> bool:
    """STP iff the release agent says eligible and every applicable agent is resolved."""
    items = list(results)
    release = next((r for r in items if r.agent_type == "release"), None)
    if release is None or not release.derived_fields.get("stp_eligible"):
        return False
    return all(r.status in RESOLVED_STATUSES for r in items if r.status != AgentStatus.SKIPPED)
