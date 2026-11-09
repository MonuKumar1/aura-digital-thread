from __future__ import annotations

import json
from typing import Any

from app.agents.base import BaseAgent, intake_profile
from app.models.enums import AgentStatus
from app.models.schemas import Activity, AgentEvidence, ControlRef
from app.models.tables import Intake

SENSITIVE_CLASSES = {"CONFIDENTIAL", "RESTRICTED"}


def compound_risks(intake: Intake) -> list[str]:
    """Cross-checks the uploaded solution design against intake answers."""
    if not intake.si_design_evidence:
        return []
    try:
        design: dict[str, Any] = json.loads(intake.si_design_evidence)
    except ValueError:
        return []
    risks: list[str] = []
    for flow in design.get("data_flows", []):
        if flow.get("cross_border") and str(flow.get("classification", "")).upper() in SENSITIVE_CLASSES:
            risks.append(f"Design flow '{flow.get('name')}' moves {flow.get('classification')} data across borders.")
            if not intake.cross_border_data_transfer:
                risks.append("Intake states no cross-border transfer but the design shows one.")
    vendors = [str(v) for v in design.get("third_parties", [])]
    if vendors and not intake.third_party_vendor_involved:
        risks.append(f"Design names third parties ({', '.join(vendors)}) but intake declares no vendor involvement.")
    elif vendors and intake.vendor_name and all(intake.vendor_name.lower() != v.lower() for v in vendors):
        risks.append(f"Intake vendor '{intake.vendor_name}' does not match design third parties ({', '.join(vendors)}).")
    return risks


class SecurityAgent(BaseAgent):
    agent_type = "security"
    review_system = "Security Portal"
    focus = "internet exposure, payment data, authentication and design-level compound risk"

    def assess(self, intake: Intake) -> AgentEvidence:
        weak_auth = intake.authentication_method in (None, "PASSWORD", "NONE")
        high_risk = intake.internet_facing or intake.handles_payment_data or weak_auth or intake.data_classification == "RESTRICTED"
        compound = compound_risks(intake)
        derived: dict[str, Any] = {
            "internet_exposure": "Public" if intake.internet_facing else "Partner" if intake.external_facing else "Internal",
            "payment_data_in_scope": intake.handles_payment_data,
            "authentication_method": intake.authentication_method or "Not stated",
            "weak_authentication": weak_auth,
            "high_risk": high_risk,
            "compound_risks": compound,
        }
        activities: list[Activity] = []
        refs: list[ControlRef] = []
        systems = ["Security Portal"]
        follow_ups: list[str] = []

        if high_risk:
            result = self.providers.secportal.submit_assessment(intake_profile(intake))
            derived.update({
                "security_assessment_id": result["assessment_id"],
                "security_ticket_ref": result["ticket_ref"],
                "security_portal_outcome": result["outcome"],
                "security_portal_url": result["portal_url"],
            })
            for c in result["required_controls"]:
                refs.append(ControlRef(control=c["control"], control_description=c["description"], control_source_document=c["source_document"], system="Security Portal"))
                activities.append(Activity(title=f"Implement {c['control']}", description=c["description"], control_ref=c["control"], source_ticket=c["ticket_ref"]))
            follow_ups.append(f"Confirm owners and dates for the {len(activities)} required security controls in assessment {result['assessment_id']}.")
        if intake.handles_payment_data and weak_auth:
            follow_ups.append("Payment data is handled without strong authentication: what compensating control applies?")
        if intake.internet_facing and not intake.encryption_in_transit:
            follow_ups.append("Public endpoints must use TLS: when will encryption in transit be enabled?")
        follow_ups += [f"Explain or correct: {r}" for r in compound]
        if intake.third_party_vendor_involved:
            systems.append("Vendor Risk")

        flagged = (intake.handles_payment_data and weak_auth) or (intake.internet_facing and not intake.encryption_in_transit)
        status = AgentStatus.FLAGGED if flagged else AgentStatus.NEEDS_REVIEW if (high_risk or compound) else AgentStatus.AUTO_APPROVED
        if status == AgentStatus.AUTO_APPROVED:
            rationale = "Internal-only service with strong authentication and no payment data; baseline security controls suffice."
        else:
            drivers = [d for d, on in (("public internet exposure", intake.internet_facing), ("payment data", intake.handles_payment_data),
                                        ("weak authentication", weak_auth), ("restricted data", intake.data_classification == "RESTRICTED"),
                                        ("design compound risks", bool(compound))) if on]
            rationale = f"Security review required due to {', '.join(drivers)}." + (f" Security Portal returned {len(activities)} required controls." if activities else "")
        return AgentEvidence(
            agent_type=self.agent_type, status=status, derived_fields=derived, confidence=0.85, rationale=rationale,
            follow_up_questions=follow_ups, control_refs=refs, activities=activities, source_systems_consulted=systems,
        )
