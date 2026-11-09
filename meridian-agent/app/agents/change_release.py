from __future__ import annotations

from app.agents.base import BaseAgent
from app.models.enums import AgentStatus
from app.models.schemas import AgentEvidence, ControlRef
from app.models.tables import Intake


def is_stp_eligible(intake: Intake) -> bool:
    has_backout = bool((intake.backout_plan_summary or "").strip()) or intake.implementation_method == "AUTOMATED_PIPELINE"
    return (not intake.outage_expected) and (not intake.customer_impacting) and has_backout


class ChangeReleaseAgent(BaseAgent):
    agent_type = "release"
    review_system = "Change Mgmt"
    focus = "change risk, backout and straight-through processing eligibility"

    def assess(self, intake: Intake) -> AgentEvidence:
        has_backout = bool((intake.backout_plan_summary or "").strip())
        stp = is_stp_eligible(intake)
        answers = {
            "Is a backout plan documented?": "Yes" if has_backout else "No",
            "Is an outage expected?": f"Yes ({intake.outage_duration_minutes or '?'} min)" if intake.outage_expected else "No",
            "Are customers impacted?": f"Yes ({intake.customers_impacted_count or 'unknown'})" if intake.customer_impacting else "No",
            "Does the vendor perform part of the change?": "Yes" if intake.vendor_change_involved else "No",
            "Implementation method": intake.implementation_method or "Not stated",
        }
        derived: dict[str, object] = {"stp_eligible": stp, "change_answers": answers, "change_window": intake.change_window}
        follow_ups: list[str] = []
        if not stp:
            if intake.outage_expected:
                follow_ups.append("Confirm the outage window has been agreed with impacted service owners.")
            if intake.customer_impacting:
                follow_ups.append("How will impacted customers be notified before the change?")
            if not has_backout and intake.implementation_method != "AUTOMATED_PIPELINE":
                follow_ups.append("Document the backout plan for this change.")

        if stp and self.settings.tracker_enabled:
            task = self.providers.tracker.create_item(
                "task", f"STP change: {intake.initiative_name}",
                "<p>Straight-through change auto-approved by Aura Digital Thread.</p>",
            )
            derived["tracker_task_id"] = task["external_id"]
            derived["tracker_task_url"] = task["url"]

        flagged = intake.outage_expected and not has_backout
        status = AgentStatus.FLAGGED if flagged else AgentStatus.AUTO_APPROVED if stp else AgentStatus.NEEDS_REVIEW
        return AgentEvidence(
            agent_type=self.agent_type, status=status, confidence=0.92, derived_fields=derived, follow_up_questions=follow_ups,
            rationale=("Eligible for straight-through processing: no outage, no customer impact and a backout path exists." if stp
                       else "Not eligible for straight-through processing; change advisory review is required."),
            control_refs=[ControlRef(control="CHG-STP", control_description="Straight-through processing criteria", control_source_document="Change Management Standard v4", system="Change Mgmt")],
            source_systems_consulted=["Change Mgmt", "ITSM"],
        )
