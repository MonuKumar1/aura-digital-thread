from __future__ import annotations

from typing import Any

from app.models.enums import AGENT_ORDER


def get_applicable_agents(intake: Any) -> dict[str, bool]:
    """Which specialist agents run for this intake. Suppressed agents are SKIPPED and excluded from STP."""
    itype = getattr(intake, "initiative_type", None)
    flag = lambda name: bool(getattr(intake, name, False))  # noqa: E731
    tech_or_new = itype in ("TECH_CHANGE", "NEW_SERVICE")
    rules = {
        "clarity": True,
        "scoping": True,
        "release": True,
        "security": tech_or_new or flag("internet_facing") or flag("handles_payment_data"),
        "privacy": flag("personal_data_processed") or flag("sensitive_personal_data_processed") or flag("cross_border_data_transfer"),
        "ai_ethics": flag("ai_ml_component_present"),
        "architecture": tech_or_new or flag("external_facing") or flag("third_party_vendor_involved") or flag("new_pipeline_required"),
        "resilience": flag("important_business_service") or flag("disaster_recovery_required") or flag("customer_impacting") or itype == "NEW_SERVICE",
    }
    return {agent: rules[agent] for agent in AGENT_ORDER}
