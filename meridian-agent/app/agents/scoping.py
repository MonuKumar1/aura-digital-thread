from __future__ import annotations

from app.agents.base import BaseAgent
from app.models.enums import AgentStatus
from app.models.schemas import AgentEvidence, ControlRef
from app.models.tables import Intake
from app.orchestrator.gate_rules import get_applicable_agents


class ScopingAgent(BaseAgent):
    agent_type = "scoping"
    review_system = "Change Mgmt"
    focus = "which governance controls and track apply"

    def assess(self, intake: Intake) -> AgentEvidence:
        applicable = get_applicable_agents(intake)
        scope = ["CHG-STD"]
        mapping = {"security": "SEC-BASE", "privacy": "PRIV-DPIA", "ai_ethics": "AI-RISK", "architecture": "ARCH-REVIEW", "resilience": "RES-BIA"}
        scope += [code for agent, code in mapping.items() if applicable.get(agent)]
        is_cloud = intake.target_environment in ("PUBLIC_CLOUD", "HYBRID") or intake.initiative_type == "CLOUD"
        if is_cloud:
            scope.append("CLOUD-ONBOARD")

        enhanced = intake.regulatory_notification_required or intake.biometric_data or intake.autonomy_level == "FULLY_AUTONOMOUS" \
            or (intake.important_business_service and intake.customer_impacting)
        specialist_count = sum(1 for a in mapping if applicable.get(a))
        track = "ENHANCED" if enhanced else "FAST_TRACK" if specialist_count <= 2 and intake.budget_band != "HIGH" else "STANDARD"

        follow_ups: list[str] = []
        if len((intake.description or "").strip()) < 20:
            follow_ups.append("Provide a fuller description of the change and its business outcome (at least one sentence).")
        if intake.target_go_live is None:
            follow_ups.append("What is the target go-live date?")

        refs = [ControlRef(control="CHG-STD", control_description="Standard change governance", control_source_document="Change Management Standard v4", system="Change Mgmt")]
        if is_cloud:
            refs.append(ControlRef(control="CLOUD-ONBOARD", control_description="Cloud service onboarding checklist", control_source_document="Cloud Onboarding Guide v2", system="Cloud Onboarding"))

        return AgentEvidence(
            agent_type=self.agent_type,
            status=AgentStatus.NEEDS_REVIEW if follow_ups else AgentStatus.AUTO_APPROVED,
            derived_fields={
                "governance_track": track,
                "control_scope": scope,
                "specialist_agents_in_scope": [a for a in mapping if applicable.get(a)],
                "cloud_onboarding_required": is_cloud,
            },
            confidence=0.95,
            rationale=f"{track.replace('_', ' ').title()} governance track with {len(scope)} control families in scope: {', '.join(scope)}."
            + (" Scoping inputs are incomplete." if follow_ups else ""),
            follow_up_questions=follow_ups,
            control_refs=refs,
            source_systems_consulted=["Change Mgmt"] + (["Cloud Onboarding"] if is_cloud else []),
        )
