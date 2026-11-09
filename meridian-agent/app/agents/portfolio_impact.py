from __future__ import annotations

from app.agents.base import BaseAgent, intake_profile
from app.models.enums import AgentStatus
from app.models.schemas import AgentEvidence, ControlRef
from app.models.tables import Intake


class PortfolioImpactAgent(BaseAgent):
    agent_type = "clarity"
    review_system = "Portfolio"
    focus = "portfolio alignment, business impact and change risk"

    def assess(self, intake: Intake) -> AgentEvidence:
        cmdb = self.cmdb_record(intake)
        investment = self.providers.portfolio.get_investment(intake.portfolio_id or intake.application_ci_id or "") or {}
        risk = self.providers.itsm_risk.get_change_risk(intake.application_ci_id, intake_profile(intake))

        known_vendors = [v.lower() for v in investment.get("known_vendors", [])]
        new_vendor = bool(intake.third_party_vendor_involved and (intake.vendor_name or "").strip().lower() not in known_vendors)
        regulatory = bool(intake.regulatory_notification_required or investment.get("regulatory_notification_required"))
        material_ibs = bool((intake.important_business_service or cmdb.get("ibs", False)) and intake.customer_impacting)
        high_risk = risk.get("band") == "High"

        impact_answers = {
            "Is the work funded by an approved investment?": "Yes" if investment.get("funding_approved") else "No / unknown",
            "Which investment does this belong to?": investment.get("investment_name", "Not linked"),
            "Does the change require regulatory notification?": "Yes" if regulatory else "No",
            "Does it materially impact an important business service?": "Yes" if material_ibs else "No",
            "Does it introduce a new vendor?": "Yes" if new_vendor else "No",
            "What is the change risk band?": f"{risk.get('band', 'Unknown')} ({risk.get('score', 'n/a')})",
        }
        derived = {
            "investment_id": investment.get("portfolio_id"),
            "investment_name": investment.get("investment_name"),
            "investment_stage": investment.get("investment_stage"),
            "funding_approved": investment.get("funding_approved", False),
            "business_owner": investment.get("business_owner") or cmdb.get("owner"),
            "application_name": cmdb.get("app_name"),
            "regulatory_notification_required": regulatory,
            "material_ibs_impact": material_ibs,
            "new_vendor": new_vendor,
            "change_risk_score": risk.get("score"),
            "change_risk_band": risk.get("band"),
            "impact_answers": impact_answers,
        }

        reasons: list[str] = []
        follow_ups: list[str] = []
        if regulatory:
            reasons.append("regulatory notification is required")
            follow_ups.append("Who will own the regulatory notification and by what date will it be submitted?")
        if material_ibs:
            reasons.append("an important business service is materially impacted")
            follow_ups.append("Has the important business service owner accepted the customer impact?")
        if new_vendor:
            reasons.append(f"vendor '{intake.vendor_name or 'unnamed'}' is not on the investment's approved vendor list")
            follow_ups.append("Has the new vendor been onboarded through vendor risk due diligence?")
        if high_risk:
            reasons.append(f"ITSM change risk band is High ({risk.get('score')})")
            follow_ups.append("What additional mitigations reduce the High change-risk score?")

        status = AgentStatus.NEEDS_REVIEW if reasons else AgentStatus.AUTO_APPROVED
        rationale = (
            f"Portfolio impact needs review because {', '.join(reasons)}." if reasons
            else f"Linked to {investment.get('investment_name', 'no investment')} with {risk.get('band', 'unknown')} change risk; "
                 "no material portfolio impact detected."
        )
        return AgentEvidence(
            agent_type=self.agent_type,
            status=status,
            derived_fields=derived,
            confidence=0.9 if investment else 0.6,
            rationale=rationale,
            follow_up_questions=follow_ups,
            control_refs=[
                ControlRef(control="PF-01", control_description="Investment linkage and funding approval", control_source_document="Portfolio Governance Policy v2", system="Portfolio"),
                ControlRef(control="CHG-RISK", control_description="Change risk scoring from configuration and incident history", control_source_document="Change Risk Model v3", system="ITSM"),
            ],
            source_systems_consulted=["Portfolio", "ITSM"],
        )
