from __future__ import annotations

from typing import Any, Callable

from sqlmodel import Session, select

from app.cmdb import get_cmdb_record_for_intake
from app.models.enums import AGENT_LABELS, AGENT_ORDER, AgentStatus
from app.models.tables import AgentReviewAnswer, Intake
from app.orchestrator.coverage import get_coverage_service
from app.orchestrator.lifecycle import ensure_deadlines, status_label
from app.orchestrator.service import reconcile_and_persist


def _fn(name: str, description: str, properties: dict[str, Any] | None = None, required: list[str] | None = None) -> dict[str, Any]:
    return {"type": "function", "function": {"name": name, "description": description,
            "parameters": {"type": "object", "properties": properties or {}, "required": required or []}}}


TOOL_SPECS: list[dict[str, Any]] = [
    _fn("get_agent_result", "Get one agent's evidence for this initiative.",
        {"agent_type": {"type": "string", "enum": AGENT_ORDER}}, ["agent_type"]),
    _fn("list_follow_ups", "List follow-up questions that still need a human answer."),
    _fn("get_cmdb_record", "Get the CMDB configuration item linked to this initiative."),
    _fn("get_coverage", "Get legacy-question coverage for this initiative."),
    _fn("explain_status", "Explain the initiative's current status, overall agent status and STP eligibility."),
    _fn("get_stage_deadlines", "Get lifecycle stage deadlines and the current stage."),
]


class ChatTools:
    """Tool implementations, all scoped to a single intake."""

    def __init__(self, session: Session, intake: Intake) -> None:
        self.session = session
        self.intake = intake
        self._result = reconcile_and_persist(session, intake)
        self.handlers: dict[str, Callable[..., dict[str, Any]]] = {
            "get_agent_result": self.get_agent_result, "list_follow_ups": self.list_follow_ups,
            "get_cmdb_record": self.get_cmdb_record, "get_coverage": self.get_coverage,
            "explain_status": self.explain_status, "get_stage_deadlines": self.get_stage_deadlines,
        }

    def call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        handler = self.handlers.get(name)
        if handler is None:
            return {"error": f"unknown tool {name}"}
        try:
            return handler(**arguments)
        except TypeError as exc:
            return {"error": f"bad arguments for {name}: {exc}"}

    def get_agent_result(self, agent_type: str) -> dict[str, Any]:
        if self._result is None:
            return {"error": "Orchestration has not been run for this initiative yet."}
        ev = next((r for r in self._result.agent_results if r.agent_type == agent_type), None)
        if ev is None:
            return {"error": f"No result for agent '{agent_type}'."}
        return {"agent_label": AGENT_LABELS.get(agent_type, agent_type), **ev.model_dump(mode="json")}

    def list_follow_ups(self) -> dict[str, Any]:
        if self._result is None:
            return {"error": "Orchestration has not been run for this initiative yet."}
        answers = self.session.exec(select(AgentReviewAnswer).where(AgentReviewAnswer.intake_id == self.intake.id)).all()
        done = {(a.agent_type, a.question.strip()) for a in answers}
        open_items = [{"agent_type": r.agent_type, "question": q}
                      for r in self._result.agent_results if r.status in (AgentStatus.NEEDS_REVIEW, AgentStatus.FLAGGED)
                      for q in r.follow_up_questions if (r.agent_type, q.strip()) not in done]
        return {"open": open_items, "answered": len(done)}

    def get_cmdb_record(self) -> dict[str, Any]:
        return {"record": get_cmdb_record_for_intake(self.intake)}

    def get_coverage(self) -> dict[str, Any]:
        return get_coverage_service().compute(self.intake, self._result.agent_results if self._result else None)

    def explain_status(self) -> dict[str, Any]:
        reasons: list[str] = []
        if self._result is None:
            reasons.append("No assessment has been run yet.")
        else:
            open_agents = [AGENT_LABELS[r.agent_type] for r in self._result.agent_results if r.status in (AgentStatus.NEEDS_REVIEW, AgentStatus.FLAGGED, AgentStatus.FAILED)]
            if open_agents:
                reasons.append(f"Open reviews: {', '.join(open_agents)}.")
            reasons.append("Eligible for straight-through processing." if self._result.straight_through_eligible
                           else "Not eligible for straight-through processing.")
        due = {d.stage: d.due_date for d in ensure_deadlines(self.session, self.intake)}.get(self.intake.current_stage)
        if due:
            reasons.append(f"Current stage {self.intake.current_stage} is due {due.isoformat()}.")
        return {"status": self.intake.status, "status_label": status_label(self.intake.status), "current_stage": self.intake.current_stage,
                "overall_agent_status": self._result.overall_status.value if self._result else None, "reasons": reasons}

    def get_stage_deadlines(self) -> dict[str, Any]:
        rows = ensure_deadlines(self.session, self.intake)
        self.session.commit()
        return {"current_stage": self.intake.current_stage, "deadlines": [{"stage": r.stage, "due_date": r.due_date.isoformat()} for r in rows]}
