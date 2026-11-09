from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from functools import lru_cache
from typing import Any, Optional

from pydantic import field_validator
from sqlmodel import Field, SQLModel, UniqueConstraint

from app.config import get_settings
from app.models.enums import InitiativeStatus, LifecycleStage

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
CI_RE = re.compile(r"^CI-\d{4}$")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@lru_cache
def canonical_enums() -> dict[str, list[str]]:
    path = get_settings().data_dir / "canonical_fields.json"
    return json.loads(path.read_text(encoding="utf-8"))["enums"]


class IntakeBase(SQLModel):
    """The ~60 canonical intake fields. Validation runs on non-table subclasses (create/update payloads)."""

    # Basics
    initiative_name: str = Field(min_length=3, max_length=200)
    initiative_type: str = Field(max_length=32)
    description: Optional[str] = Field(default=None, max_length=4000)
    application_ci_id: Optional[str] = Field(default=None, max_length=16, index=True)
    portfolio_id: Optional[str] = Field(default=None, max_length=16)
    sponsor_name: Optional[str] = Field(default=None, max_length=120)
    sponsor_email: str = Field(max_length=254, index=True)
    business_unit: Optional[str] = Field(default=None, max_length=120)
    delivery_lead_email: Optional[str] = Field(default=None, max_length=254)
    target_go_live: Optional[date] = None
    budget_band: Optional[str] = Field(default=None, max_length=16)
    regulatory_notification_required: bool = False
    # Data & Privacy
    personal_data_processed: bool = False
    sensitive_personal_data_processed: bool = False
    cross_border_data_transfer: bool = False
    transfer_destinations: Optional[str] = Field(default=None, max_length=300)
    data_classification: Optional[str] = Field(default=None, max_length=16)
    lawful_basis: Optional[str] = Field(default=None, max_length=32)
    data_retention_months: Optional[int] = Field(default=None, ge=0, le=1200)
    data_subjects_band: Optional[str] = Field(default=None, max_length=16)
    data_minimisation_applied: bool = False
    # Security
    internet_facing: bool = False
    external_facing: bool = False
    handles_payment_data: bool = False
    authentication_method: Optional[str] = Field(default=None, max_length=16)
    privileged_access_required: bool = False
    encryption_at_rest: bool = False
    encryption_in_transit: bool = False
    third_party_vendor_involved: bool = False
    vendor_name: Optional[str] = Field(default=None, max_length=120)
    penetration_test_planned: bool = False
    secrets_management: Optional[str] = Field(default=None, max_length=16)
    # AI
    ai_ml_component_present: bool = False
    autonomy_level: Optional[str] = Field(default=None, max_length=32)
    biometric_data: bool = False
    ai_model_type: Optional[str] = Field(default=None, max_length=32)
    human_in_the_loop: bool = False
    ai_decision_impacts_customers: bool = False
    training_data_contains_personal_data: bool = False
    # Architecture
    new_pipeline_required: bool = False
    implementation_method: Optional[str] = Field(default=None, max_length=32)
    target_environment: Optional[str] = Field(default=None, max_length=32)
    cloud_service_type: Optional[str] = Field(default=None, max_length=16)
    architecture_pattern: Optional[str] = Field(default=None, max_length=32)
    user_growth_pct: Optional[float] = Field(default=None, ge=-100, le=10000)
    sla_specified: bool = False
    integration_count: Optional[int] = Field(default=None, ge=0, le=1000)
    new_technology_introduced: bool = False
    # Resilience
    important_business_service: bool = False
    disaster_recovery_required: bool = False
    rto_hours: Optional[float] = Field(default=None, ge=0, le=10000)
    rpo_hours: Optional[float] = Field(default=None, ge=0, le=10000)
    customer_impacting: bool = False
    peak_tps: Optional[float] = Field(default=None, ge=0, le=10_000_000)
    # Change
    outage_expected: bool = False
    outage_duration_minutes: Optional[int] = Field(default=None, ge=0, le=100_000)
    backout_plan_summary: Optional[str] = Field(default=None, max_length=4000)
    customers_impacted_count: Optional[int] = Field(default=None, ge=0)
    vendor_change_involved: bool = False
    change_window: Optional[str] = Field(default=None, max_length=32)

    @field_validator(
        "initiative_type", "budget_band", "data_classification", "lawful_basis", "data_subjects_band",
        "authentication_method", "secrets_management", "autonomy_level", "ai_model_type",
        "implementation_method", "target_environment", "cloud_service_type", "architecture_pattern", "change_window",
        check_fields=False,
    )
    @classmethod
    def _check_enum(cls, value: Optional[str], info: Any) -> Optional[str]:
        if value in (None, ""):
            if info.field_name == "initiative_type":
                raise ValueError("initiative_type is required")
            return None
        allowed = canonical_enums().get(info.field_name, [])
        if value not in allowed:
            raise ValueError(f"must be one of {allowed}")
        return value

    @field_validator("sponsor_email", "delivery_lead_email", check_fields=False)
    @classmethod
    def _check_email(cls, value: Optional[str], info: Any) -> Optional[str]:
        if value in (None, ""):
            if info.field_name == "sponsor_email":
                raise ValueError("sponsor_email is required")
            return None
        if not EMAIL_RE.match(value):
            raise ValueError("invalid email address")
        return value.strip().lower()

    @field_validator("application_ci_id", check_fields=False)
    @classmethod
    def _check_ci(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        value = value.strip().upper()
        if not CI_RE.match(value):
            raise ValueError("CI ID must look like CI-1234")
        return value


class Intake(IntakeBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    current_stage: str = Field(default=LifecycleStage.INTAKE.value, index=True)
    status: str = Field(default=InitiativeStatus.SUBMITTED.value, index=True)
    cmdb_snapshot: Optional[str] = None
    si_design_evidence: Optional[str] = None
    created_by: Optional[str] = Field(default=None, max_length=254)
    created_at: datetime = Field(default_factory=utcnow, index=True)
    updated_at: datetime = Field(default_factory=utcnow)


class IntakeAssessment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    intake_id: int = Field(foreign_key="intake.id", index=True, unique=True)
    assessment_json: str
    manifest_json: Optional[str] = None
    overall_status: str
    straight_through_eligible: bool = False
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class AgentReviewAnswer(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    intake_id: int = Field(foreign_key="intake.id", index=True)
    agent_type: str = Field(max_length=32)
    question: str = Field(max_length=1000)
    answer: str = Field(max_length=4000)
    answered_by: str = Field(max_length=254)
    created_at: datetime = Field(default_factory=utcnow)


class WorkItemLink(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    intake_id: int = Field(foreign_key="intake.id", index=True)
    kind: str = Field(max_length=16)
    external_id: str = Field(max_length=64, unique=True, index=True)
    parent_external_id: Optional[str] = Field(default=None, max_length=64)
    title: str = Field(default="", max_length=300)
    url: str = Field(max_length=500)
    state: str = Field(default="New", max_length=32)
    created_at: datetime = Field(default_factory=utcnow)


class StageDeadline(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("intake_id", "stage"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    intake_id: int = Field(foreign_key="intake.id", index=True)
    stage: str = Field(max_length=32)
    due_date: date


class StageTransitionLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    intake_id: int = Field(foreign_key="intake.id", index=True)
    from_stage: str
    to_stage: str
    comment: str = Field(max_length=2000)
    approved_by: str = Field(max_length=254)
    created_at: datetime = Field(default_factory=utcnow)


class FieldChangeLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    intake_id: int = Field(foreign_key="intake.id", index=True)
    field: str = Field(max_length=64)
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    changed_by: str = Field(default="system", max_length=254)
    created_at: datetime = Field(default_factory=utcnow)
