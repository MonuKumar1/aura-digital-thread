from __future__ import annotations

import logging
from typing import Any, Callable, Optional, TypedDict

from langgraph.graph import END, StateGraph

from app.agents.base import BaseAgent, skipped_evidence
from app.agents.registry import REVIEW_SYSTEMS
from app.llm.base import LlmClient
from app.models.enums import AGENT_LABELS, AGENT_ORDER, AgentStatus
from app.models.schemas import AgentEvidence
from app.models.tables import Intake
from app.orchestrator.synthesis import synthesize

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str, dict[str, Any]], None]
NODE_NAMES: dict[str, str] = {a: ("portfolio_agent" if a == "clarity" else f"{a}_agent") for a in AGENT_ORDER}


class GraphState(TypedDict, total=False):
    intake: Intake
    results: dict[str, AgentEvidence]
    notes: list[str]


def _noop(_event: str, _payload: dict[str, Any]) -> None:
    return None


def build_graph(
    agents: dict[str, BaseAgent],
    applicable: dict[str, bool],
    llm: LlmClient,
    on_progress: Optional[ProgressCallback] = None,
) -> Any:
    """Linear StateGraph: portfolio -> scoping -> security -> privacy -> ai_ethics -> architecture -> resilience -> release -> synthesis.
    Built fresh per request so callbacks and applicability are request-scoped."""
    emit = on_progress or _noop

    def make_node(agent_type: str) -> Callable[[GraphState], GraphState]:
        def node(state: GraphState) -> GraphState:
            intake = state["intake"]
            payload = {"agent_type": agent_type, "label": AGENT_LABELS[agent_type], "node": NODE_NAMES[agent_type]}
            if not applicable.get(agent_type, False):
                evidence = skipped_evidence(agent_type, REVIEW_SYSTEMS.get(agent_type, ""))
                emit("agent_skipped", {**payload, "status": evidence.status.value})
            else:
                emit("agent_started", payload)
                try:
                    evidence = agents[agent_type].evaluate(intake)
                except Exception as exc:  # noqa: BLE001 - one agent failing must not abort the graph
                    logger.exception("Agent %s failed for intake %s", agent_type, intake.id)
                    evidence = AgentEvidence(agent_type=agent_type, status=AgentStatus.FAILED, rationale=f"Agent error: {exc}",
                                             review_system=REVIEW_SYSTEMS.get(agent_type, ""))
                emit("agent_completed", {**payload, "status": evidence.status.value})
            return {"results": {**state.get("results", {}), agent_type: evidence}}

        return node

    def synthesis_node(state: GraphState) -> GraphState:
        emit("synthesis_started", {"node": "synthesis"})
        notes = synthesize(llm, state["intake"], state.get("results", {}))
        emit("synthesis_completed", {"node": "synthesis", "notes": notes})
        return {"notes": notes}

    graph = StateGraph(GraphState)
    for agent_type in AGENT_ORDER:
        graph.add_node(NODE_NAMES[agent_type], make_node(agent_type))
    graph.add_node("synthesis", synthesis_node)
    graph.set_entry_point(NODE_NAMES[AGENT_ORDER[0]])
    for current, nxt in zip(AGENT_ORDER, AGENT_ORDER[1:]):
        graph.add_edge(NODE_NAMES[current], NODE_NAMES[nxt])
    graph.add_edge(NODE_NAMES[AGENT_ORDER[-1]], "synthesis")
    graph.add_edge("synthesis", END)
    return graph.compile()
