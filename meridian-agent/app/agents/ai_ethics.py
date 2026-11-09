from __future__ import annotations

from app.agents.base import BaseAgent
from app.models.enums import AgentStatus
from app.models.schemas import AgentEvidence, ControlRef
from app.models.tables import Intake


def model_risk_class(intake: Intake) -> str:
    if intake.autonomy_level == "FULLY_AUTONOMOUS" or intake.biometric_data or (intake.ai_decision_impacts_customers and not intake.human_in_the_loop):
        return "HIGH"
    if intake.autonomy_level == "SEMI_AUTONOMOUS" or intake.ai_decision_impacts_customers:
        return "MEDIUM"
    return "LOW"


class AiEthicsAgent(BaseAgent):
    agent_type = "ai_ethics"
    review_system = "DRA"
    focus = "AI autonomy, biometric use, regulatory scope, model risk and explainability"

    def assess(self, intake: Intake) -> AgentEvidence:
        risk = model_risk_class(intake)
        regulatory_scope = bool(intake.biometric_data or (intake.ai_decision_impacts_customers and intake.personal_data_processed))
        explainability = risk != "LOW" or intake.ai_decision_impacts_customers
        follow_ups: list[str] = []
        if risk != "LOW":
            follow_ups.append("How will model outputs be monitored for bias and drift after release?")
        if explainability:
            follow_ups.append("How are AI decisions explained to affected customers or reviewers?")
        if intake.biometric_data:
            follow_ups.append("How is explicit consent captured for biometric processing, and what is the non-biometric alternative?")
        if not intake.human_in_the_loop and intake.autonomy_level in ("SEMI_AUTONOMOUS", "FULLY_AUTONOMOUS"):
            follow_ups.append("What human override or kill-switch exists for autonomous decisions?")
        if intake.training_data_contains_personal_data:
            follow_ups.append("Has personal data in the training set been minimised or pseudonymised?")

        flagged = intake.biometric_data and intake.autonomy_level == "FULLY_AUTONOMOUS"
        status = AgentStatus.FLAGGED if flagged else AgentStatus.NEEDS_REVIEW if risk != "LOW" else AgentStatus.AUTO_APPROVED
        rationale = {
            "HIGH": "High model-risk class: autonomy, biometric data or unsupervised customer-impacting decisions require AI review board sign-off.",
            "MEDIUM": "Medium model-risk class: decisions affect customers or act semi-autonomously, so monitoring and explainability evidence is required.",
            "LOW": "Low model-risk class: assistive use with a human in the loop and no customer-impacting decisions.",
        }[risk]
        if status == AgentStatus.AUTO_APPROVED:
            follow_ups = []
        return AgentEvidence(
            agent_type=self.agent_type, status=status, confidence=0.82, rationale=rationale, follow_up_questions=follow_ups,
            derived_fields={
                "autonomy_level": intake.autonomy_level or "NONE",
                "model_type": intake.ai_model_type or "NONE",
                "biometric": intake.biometric_data,
                "regulatory_scope_flag": regulatory_scope,
                "model_risk_class": risk,
                "explainability_required": explainability,
            },
            control_refs=[
                ControlRef(control="AI-RISK", control_description="Model risk classification and validation", control_source_document="Responsible AI Standard v1", system="DRA"),
                ControlRef(control="AI-XAI", control_description="Explainability and human oversight", control_source_document="Responsible AI Standard v1", system="DRA"),
            ],
            source_systems_consulted=["DRA"],
        )
