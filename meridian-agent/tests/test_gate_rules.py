from __future__ import annotations

from app.orchestrator.gate_rules import get_applicable_agents
from tests.conftest import make_intake


def test_core_agents_always_run() -> None:
    applicable = get_applicable_agents(make_intake())
    assert applicable["clarity"] and applicable["scoping"] and applicable["release"]
    assert not any(applicable[a] for a in ("security", "privacy", "ai_ethics", "architecture", "resilience"))


def test_security_triggers() -> None:
    assert get_applicable_agents(make_intake(initiative_type="TECH_CHANGE"))["security"]
    assert get_applicable_agents(make_intake(internet_facing=True))["security"]
    assert get_applicable_agents(make_intake(handles_payment_data=True))["security"]


def test_privacy_triggers() -> None:
    for flag in ("personal_data_processed", "sensitive_personal_data_processed", "cross_border_data_transfer"):
        assert get_applicable_agents(make_intake(**{flag: True}))["privacy"], flag


def test_ai_architecture_resilience_triggers() -> None:
    assert get_applicable_agents(make_intake(ai_ml_component_present=True))["ai_ethics"]
    for flag in ("external_facing", "third_party_vendor_involved", "new_pipeline_required"):
        assert get_applicable_agents(make_intake(**{flag: True}))["architecture"], flag
    for flag in ("important_business_service", "disaster_recovery_required", "customer_impacting"):
        assert get_applicable_agents(make_intake(**{flag: True}))["resilience"], flag
    new_service = get_applicable_agents(make_intake(initiative_type="NEW_SERVICE"))
    assert new_service["resilience"] and new_service["architecture"] and new_service["security"]
