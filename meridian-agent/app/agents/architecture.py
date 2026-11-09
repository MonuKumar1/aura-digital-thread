from __future__ import annotations

from app.agents.base import BaseAgent
from app.models.enums import AgentStatus
from app.models.schemas import AgentEvidence, ControlRef
from app.models.tables import Intake

GROWTH_THRESHOLD_PCT = 25


class ArchitectureAgent(BaseAgent):
    agent_type = "architecture"
    review_system = "Architecture Portal"
    focus = "capability impact, scalability and service levels"

    def assess(self, intake: Intake) -> AgentEvidence:
        cmdb = self.cmdb_record(intake)
        report = self.providers.archportal.get_capability_impact(intake.application_ci_id, {"initiative_type": intake.initiative_type})
        growth = intake.user_growth_pct or 0
        follow_ups: list[str] = []
        reasons: list[str] = []
        if growth > GROWTH_THRESHOLD_PCT:
            reasons.append(f"user growth of {growth:g}% exceeds {GROWTH_THRESHOLD_PCT}%")
            follow_ups.append("Provide capacity and load-test evidence for the expected user growth.")
        if intake.sla_specified:
            reasons.append("a formal SLA is specified")
            follow_ups.append("How is the SLA measured and which dependencies underpin it?")
        if intake.new_technology_introduced:
            reasons.append("new technology is introduced to the estate")
            follow_ups.append("Has the new technology been approved through the technology radar process?")

        is_cloud = (intake.target_environment or cmdb.get("target_environment")) in ("PUBLIC_CLOUD", "HYBRID")
        refs = [ControlRef(control="ARCH-REVIEW", control_description="Capability impact and architecture principles review", control_source_document=report["source_document"], system="Architecture Portal")]
        if is_cloud:
            refs.append(ControlRef(control="CLOUD-PATTERN", control_description="Approved cloud reference pattern", control_source_document="Cloud Onboarding Guide v2", system="Cloud Onboarding"))
        return AgentEvidence(
            agent_type=self.agent_type,
            status=AgentStatus.NEEDS_REVIEW if reasons else AgentStatus.AUTO_APPROVED,
            confidence=0.8,
            rationale=(f"Architecture review required because {', '.join(reasons)}." if reasons
                       else f"Capability impact is {report['impact_level']} on {', '.join(report['capabilities_impacted'])}; within approved patterns."),
            follow_up_questions=follow_ups,
            derived_fields={
                "capability_report_id": report["report_id"],
                "capabilities_impacted": report["capabilities_impacted"],
                "impact_level": report["impact_level"],
                "dependencies": report["dependencies"],
                "architecture_pattern": intake.architecture_pattern or cmdb.get("architecture_pattern"),
                "target_environment": intake.target_environment or cmdb.get("target_environment"),
                "cloud_service_type": intake.cloud_service_type or cmdb.get("cloud_service_type"),
                "user_growth_pct": growth,
                "sla_specified": intake.sla_specified,
                "report_url": report["portal_url"],
            },
            control_refs=refs,
            source_systems_consulted=["Architecture Portal", "ITSM"] + (["Cloud Onboarding"] if is_cloud else []),
        )
