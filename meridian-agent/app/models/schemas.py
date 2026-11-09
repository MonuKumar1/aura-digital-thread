from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, create_model

from app.models.enums import AgentStatus
from app.models.tables import IntakeBase


class ControlRef(BaseModel):
    control: str
    control_description: str
    control_source_document: str
    system: str


class Activity(BaseModel):
    title: str
    description: str
    control_ref: Optional[str] = None
    source_ticket: Optional[str] = None


class AgentEvidence(BaseModel):
    agent_type: str
    status: AgentStatus
    derived_fields: dict[str, Any] = Field(default_factory=dict)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    rationale: str = ""
    control_refs: list[ControlRef] = Field(default_factory=list)
    follow_up_questions: list[str] = Field(default_factory=list)
    activities: list[Activity] = Field(default_factory=list)
    source_systems_consulted: list[str] = Field(default_factory=list)
    review_system: str = ""
    not_applicable: bool = False


class OrchestrationResult(BaseModel):
    intake_id: int
    agent_results: list[AgentEvidence]
    overall_status: AgentStatus
    straight_through_eligible: bool
    questions_raw_count: int
    questions_replaced_count: int
    systems_replaced_count: int
    notes: list[str] = Field(default_factory=list)
    work_item_id: Optional[str] = None
    work_item_url: Optional[str] = None
    coverage_pct: float = 0.0
    generated_at: Optional[datetime] = None


class IntakeCreate(IntakeBase):
    current_stage: Optional[str] = None
    created_by: Optional[str] = Field(default=None, max_length=254)


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


# All-optional mirror of IntakeBase; PATCH merges it onto the row and re-validates through IntakeCreate.
IntakeUpdate: type[BaseModel] = create_model(  # type: ignore[call-overload]
    "IntakeUpdate",
    __base__=_StrictModel,
    **{name: (Optional[info.annotation], None) for name, info in IntakeBase.model_fields.items()},
    changed_by=(Optional[str], None),
)


class IntakeRead(IntakeBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    current_stage: str
    status: str
    status_label: str = ""
    cmdb_snapshot: Optional[dict[str, Any]] = None
    si_design_evidence: Optional[dict[str, Any]] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    overall_status: Optional[str] = None
    straight_through_eligible: Optional[bool] = None


class IntakeListItem(BaseModel):
    id: int
    initiative_name: str
    initiative_type: str
    application_ci_id: Optional[str]
    sponsor_email: str
    target_go_live: Optional[date]
    current_stage: str
    status: str
    status_label: str
    overall_status: Optional[str]
    straight_through_eligible: Optional[bool]
    current_stage_due: Optional[date]
    created_at: datetime


class IntakePage(BaseModel):
    items: list[IntakeListItem]
    total: int


class ReviewAnswerIn(BaseModel):
    agent_type: str = Field(min_length=2, max_length=32)
    question: str = Field(min_length=1, max_length=1000)
    answer: str = Field(min_length=1, max_length=4000)
    answered_by: str = Field(default="reviewer", min_length=1, max_length=254)


class ReviewAnswersIn(BaseModel):
    answers: list[ReviewAnswerIn] = Field(min_length=1, max_length=100)


class ReviewAnswerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    agent_type: str
    question: str
    answer: str
    answered_by: str
    created_at: datetime


class StageDeadlineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    stage: str
    due_date: date


class DeadlineUpdateIn(BaseModel):
    due_date: date


class AdvanceStageIn(BaseModel):
    comment: str = Field(default="", max_length=2000)
    approved_by: str = Field(default="approver", min_length=1, max_length=254)


class TransitionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    from_stage: str
    to_stage: str
    comment: str
    approved_by: str
    created_at: datetime


class WorkItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    kind: str
    external_id: str
    parent_external_id: Optional[str]
    title: str
    url: str
    state: str


class WorkItemStateIn(BaseModel):
    state: Literal["New", "Active", "Resolved", "Closed"]


class DetectIn(BaseModel):
    text: str = Field(min_length=3, max_length=8000)


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class ChatIn(BaseModel):
    intake_id: int
    message: str = Field(min_length=1, max_length=4000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=20)


class ToolTraceItem(BaseModel):
    tool: str
    arguments: dict[str, Any]
    result_preview: str


class ChatOut(BaseModel):
    answer: str
    tool_trace: list[ToolTraceItem]
