from __future__ import annotations

from app.agents.base import BaseAgent, intake_profile
from app.models.enums import AgentStatus
from app.models.schemas import AgentEvidence, ControlRef
from app.models.tables import Intake


class PrivacyAgent(BaseAgent):
    agent_type = "privacy"
    review_system = "DRA"
    focus = "lawful basis, sensitive data and cross-border transfers"

    def assess(self, intake: Intake) -> AgentEvidence:
        dra = self.providers.dra.prefill_assessment(intake_profile(intake))
        no_basis = intake.lawful_basis in (None, "", "NONE")
        follow_ups: list[str] = []
        reasons: list[str] = []
        if intake.personal_data_processed and no_basis:
            reasons.append("no lawful basis is recorded")
            follow_ups.append("What is the lawful basis for processing personal data?")
        if intake.sensitive_personal_data_processed:
            reasons.append("sensitive personal data is processed")
            follow_ups.append("What additional safeguards protect the sensitive personal data?")
        if intake.cross_border_data_transfer:
            reasons.append(f"data is transferred cross-border ({intake.transfer_destinations or 'destinations not stated'})")
            follow_ups.append("Which transfer mechanism (e.g. contractual clauses) covers the cross-border transfer?")
        if intake.personal_data_processed and intake.data_retention_months is None:
            follow_ups.append("How long will personal data be retained?")

        flagged = intake.sensitive_personal_data_processed and intake.cross_border_data_transfer and no_basis
        status = AgentStatus.FLAGGED if flagged else AgentStatus.NEEDS_REVIEW if follow_ups else AgentStatus.AUTO_APPROVED
        rationale = (f"Privacy review required because {', '.join(reasons)}." if reasons
                     else "Personal data use is covered by a recorded lawful basis without sensitive or cross-border processing."
                     if not follow_ups else "Privacy inputs are incomplete.")
        refs = [ControlRef(control="PRIV-DPIA", control_description="Data protection impact assessment", control_source_document="Privacy Standard v3", system="DRA")]
        if intake.cross_border_data_transfer:
            refs.append(ControlRef(control="PRIV-XBT", control_description="International transfer safeguards", control_source_document="Privacy Standard v3", system="DRA"))
        return AgentEvidence(
            agent_type=self.agent_type, status=status, confidence=0.88, rationale=rationale, follow_up_questions=follow_ups,
            derived_fields={
                "lawful_basis": intake.lawful_basis or "NONE",
                "dra_id": dra["dra_id"],
                "dra_residual_risk": dra["residual_risk"],
                "dra_prefilled_answers": dra["answers"],
                "dra_url": dra["portal_url"],
                "cross_border": intake.cross_border_data_transfer,
                "sensitive_data": intake.sensitive_personal_data_processed,
            },
            control_refs=refs, source_systems_consulted=["DRA"],
        )
