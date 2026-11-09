from __future__ import annotations

from app.agents.ai_ethics import AiEthicsAgent
from app.agents.architecture import ArchitectureAgent
from app.agents.base import BaseAgent, Providers
from app.agents.change_release import ChangeReleaseAgent
from app.agents.portfolio_impact import PortfolioImpactAgent
from app.agents.privacy import PrivacyAgent
from app.agents.resilience import ResilienceAgent
from app.agents.scoping import ScopingAgent
from app.agents.security import SecurityAgent
from app.llm.base import LlmClient

AGENT_CLASSES: list[type[BaseAgent]] = [
    PortfolioImpactAgent, ScopingAgent, SecurityAgent, PrivacyAgent,
    AiEthicsAgent, ArchitectureAgent, ResilienceAgent, ChangeReleaseAgent,
]
REVIEW_SYSTEMS: dict[str, str] = {cls.agent_type: cls.review_system for cls in AGENT_CLASSES}


def build_agents(llm: LlmClient, providers: Providers) -> dict[str, BaseAgent]:
    return {cls.agent_type: cls(llm, providers) for cls in AGENT_CLASSES}
