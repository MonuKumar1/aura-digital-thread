from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, ClassVar

from app.archportal import ArchPortalClient, get_archportal_client
from app.cmdb import CmdbClient, get_cmdb_client, get_cmdb_record_for_intake
from app.config import Settings, get_settings
from app.dra import DraClient, get_dra_client
from app.itsm_risk import ItsmRiskClient, get_itsm_risk_client
from app.llm.base import TASK_REPHRASE, LlmClient, extract_json
from app.models.enums import AGENT_LABELS, AgentStatus
from app.models.schemas import AgentEvidence
from app.models.tables import Intake, IntakeBase
from app.portfolio import PortfolioClient, get_portfolio_client
from app.secportal import SecPortalClient, get_secportal_client
from app.tracker import TrackerClient, get_tracker_client

logger = logging.getLogger(__name__)


@dataclass
class Providers:
    cmdb: CmdbClient = field(default_factory=get_cmdb_client)
    portfolio: PortfolioClient = field(default_factory=get_portfolio_client)
    itsm_risk: ItsmRiskClient = field(default_factory=get_itsm_risk_client)
    secportal: SecPortalClient = field(default_factory=get_secportal_client)
    dra: DraClient = field(default_factory=get_dra_client)
    archportal: ArchPortalClient = field(default_factory=get_archportal_client)
    tracker: TrackerClient = field(default_factory=get_tracker_client)


def intake_profile(intake: Intake) -> dict[str, Any]:
    """Plain dict of the canonical fields (dates as ISO strings) for passing to mocked systems and prompts."""
    out: dict[str, Any] = {"intake_id": intake.id}
    for name in IntakeBase.model_fields:
        val = getattr(intake, name, None)
        out[name] = val.isoformat() if hasattr(val, "isoformat") else val
    return out


def skipped_evidence(agent_type: str, review_system: str = "") -> AgentEvidence:
    return AgentEvidence(
        agent_type=agent_type,
        status=AgentStatus.SKIPPED,
        confidence=1.0,
        rationale=f"{AGENT_LABELS.get(agent_type, agent_type)} assessment is not applicable to this intake profile.",
        review_system=review_system,
        not_applicable=True,
    )


class BaseAgent(ABC):
    agent_type: ClassVar[str]
    review_system: ClassVar[str]
    focus: ClassVar[str]

    def __init__(self, llm: LlmClient, providers: Providers, settings: Settings | None = None) -> None:
        self.llm = llm
        self.providers = providers
        self.settings = settings or get_settings()

    def evaluate(self, intake: Intake) -> AgentEvidence:
        evidence = self.assess(intake)
        evidence.agent_type = self.agent_type
        evidence.review_system = evidence.review_system or self.review_system
        evidence.rationale, evidence.follow_up_questions = self._rephrase(intake, evidence)
        return evidence

    @abstractmethod
    def assess(self, intake: Intake) -> AgentEvidence:
        """Deterministic rules: status, derived fields, fallback rationale and follow-ups."""

    def cmdb_record(self, intake: Intake) -> dict[str, Any]:
        return get_cmdb_record_for_intake(intake, self.providers.cmdb)

    def _rephrase(self, intake: Intake, ev: AgentEvidence) -> tuple[str, list[str]]:
        system_prompt = (
            f"{TASK_REPHRASE}\nYou are the {AGENT_LABELS[self.agent_type]} governance agent. Focus: {self.focus}.\n"
            "Rewrite the draft rationale as 2-3 clear sentences for a delivery engineer and keep each follow-up "
            "question's meaning. Reply with JSON only: {\"rationale\": str, \"follow_up_questions\": [str]}."
        )
        user_prompt = json.dumps({
            "agent_type": self.agent_type,
            "status": ev.status.value,
            "draft_rationale": ev.rationale,
            "draft_follow_ups": ev.follow_up_questions,
            "derived_fields": ev.derived_fields,
            "initiative": {k: v for k, v in intake_profile(intake).items() if v not in (None, False, "")},
        }, default=str)
        try:
            data = extract_json(self.llm.complete(system_prompt, user_prompt))
            rationale = str(data.get("rationale") or "").strip() or ev.rationale
            follow_ups = [str(q).strip() for q in data.get("follow_up_questions") or [] if str(q).strip()]
            # Review answers are matched to these strings, so a changed count means the rewrite isn't trustworthy.
            if len(follow_ups) != len(ev.follow_up_questions):
                follow_ups = ev.follow_up_questions
            return rationale, follow_ups
        except Exception as exc:  # noqa: BLE001 - any LLM failure must degrade to deterministic output
            logger.warning("LLM rephrase failed for %s agent (intake %s): %s", self.agent_type, intake.id, exc)
            return ev.rationale, ev.follow_up_questions
