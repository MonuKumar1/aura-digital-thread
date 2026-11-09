from __future__ import annotations

from enum import Enum


class LifecycleStage(str, Enum):
    INTAKE = "Intake"
    ASSESSMENT = "Assessment"
    APPROVAL = "Approval"
    BUILD = "Build"
    DEPLOY = "Deploy"
    PRODUCTION = "Production"


STAGE_ORDER: list[LifecycleStage] = list(LifecycleStage)

# Older records used these spellings; normalized at startup.
LEGACY_STAGE_ALIASES: dict[str, str] = {
    "Submitted": "Intake",
    "INTAKE": "Intake",
    "Assess": "Assessment",
    "ASSESSMENT": "Assessment",
    "Approve": "Approval",
    "APPROVAL": "Approval",
    "Development": "Build",
    "BUILD": "Build",
    "Release": "Deploy",
    "DEPLOY": "Deploy",
    "Live": "Production",
    "PRODUCTION": "Production",
}


class AgentStatus(str, Enum):
    PENDING = "PENDING"
    AUTO_APPROVED = "AUTO_APPROVED"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    REVIEWED = "REVIEWED"
    FLAGGED = "FLAGGED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"


RESOLVED_STATUSES = {AgentStatus.AUTO_APPROVED, AgentStatus.REVIEWED}


class InitiativeStatus(str, Enum):
    SUBMITTED = "SUBMITTED"
    ORCHESTRATING = "ORCHESTRATING"
    AWAITING_HUMAN_INPUT = "AWAITING_HUMAN_INPUT"
    REJECTED = "REJECTED"
    COMPLETED = "COMPLETED"


STATUS_LABELS: dict[InitiativeStatus, str] = {
    InitiativeStatus.SUBMITTED: "On Track",
    InitiativeStatus.ORCHESTRATING: "At Risk",
    InitiativeStatus.AWAITING_HUMAN_INPUT: "Awaiting Input",
    InitiativeStatus.REJECTED: "Blocked",
    InitiativeStatus.COMPLETED: "Completed",
}

AGENT_ORDER: list[str] = ["clarity", "scoping", "security", "privacy", "ai_ethics", "architecture", "resilience", "release"]

AGENT_LABELS: dict[str, str] = {
    "clarity": "Portfolio Impact",
    "scoping": "Scoping",
    "security": "Security",
    "privacy": "Privacy",
    "ai_ethics": "AI Ethics",
    "architecture": "Architecture",
    "resilience": "Resilience",
    "release": "Change & Release",
}
