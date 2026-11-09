from __future__ import annotations

from typing import Any, Optional

from app.agents.base import BaseAgent
from app.models.enums import AgentStatus
from app.models.schemas import AgentEvidence, ControlRef
from app.models.tables import Intake


def ibs_score(intake: Intake, ibs: bool, rto: Optional[float]) -> int:
    score = 40 if ibs else 0
    score += 25 if intake.customer_impacting else 0
    score += 15 if intake.disaster_recovery_required else 0
    score += 10 if rto is not None and rto <= 4 else 0
    score += 10 if (intake.peak_tps or 0) > 1000 else 0
    return score


class ResilienceAgent(BaseAgent):
    agent_type = "resilience"
    review_system = "Business Impact"
    focus = "important business services, recovery objectives and outage tolerance"

    def assess(self, intake: Intake) -> AgentEvidence:
        cmdb: dict[str, Any] = self.cmdb_record(intake)
        rto = intake.rto_hours if intake.rto_hours is not None else cmdb.get("rto_hours")
        rpo = intake.rpo_hours if intake.rpo_hours is not None else cmdb.get("rpo_hours")
        ibs = bool(intake.important_business_service or cmdb.get("ibs", False))
        score = ibs_score(intake, ibs, rto)

        follow_ups: list[str] = []
        if rto is None or rpo is None:
            follow_ups.append("State the RTO and RPO for the service.")
        if ibs and intake.disaster_recovery_required and rto is not None and rto > 24:
            follow_ups.append(f"An RTO of {rto:g}h is long for an important business service: is a tighter target needed?")
        flagged = ibs and intake.customer_impacting and intake.outage_expected
        if flagged:
            follow_ups.append("An outage on a customer-facing important business service is planned: what is the impact tolerance and communication plan?")
        elif score >= 60:
            follow_ups.append("Confirm the business impact assessment has been refreshed for this change.")

        status = AgentStatus.FLAGGED if flagged else AgentStatus.NEEDS_REVIEW if follow_ups else AgentStatus.AUTO_APPROVED
        return AgentEvidence(
            agent_type=self.agent_type, status=status, confidence=0.86, follow_up_questions=follow_ups,
            rationale=(f"Resilience impact score {score}/100" + (" with a planned outage on a customer-facing important business service." if flagged
                       else "; business impact assessment review needed." if follow_ups else "; recovery objectives are within tolerance.")),
            derived_fields={
                "important_business_service": ibs,
                "ibs_score": score,
                "rto_hours": rto,
                "rpo_hours": rpo,
                "rto_source": "intake" if intake.rto_hours is not None else "cmdb" if rto is not None else "missing",
                "dr_required": intake.disaster_recovery_required,
            },
            control_refs=[ControlRef(control="RES-BIA", control_description="Business impact assessment and impact tolerance", control_source_document="Operational Resilience Policy v2", system="Business Impact")],
            source_systems_consulted=["Business Impact", "ITSM"],
        )
