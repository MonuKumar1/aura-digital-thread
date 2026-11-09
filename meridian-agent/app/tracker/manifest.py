from __future__ import annotations

from html import escape
from typing import Any

from app.models.enums import AGENT_LABELS, AgentStatus
from app.models.schemas import AgentEvidence, OrchestrationResult
from app.models.tables import Intake


def _e(value: Any) -> str:
    return escape("" if value is None else str(value), quote=True)


def _derived_list(fields: dict[str, Any]) -> str:
    items = []
    for key, value in fields.items():
        if isinstance(value, dict):
            value = "; ".join(f"{k}: {v}" for k, v in value.items())
        elif isinstance(value, list):
            value = ", ".join(str(v) for v in value) or "-"
        items.append(f"<li><strong>{_e(key)}</strong>: {_e(value)}</li>")
    return "<ul>" + "".join(items) + "</ul>" if items else "<p>None</p>"


def _feature_html(ev: AgentEvidence) -> str:
    controls = "".join(f"<li>{_e(c.control)} - {_e(c.control_description)} <em>({_e(c.system)})</em></li>" for c in ev.control_refs)
    activities = "".join(f"<li>{_e(a.title)}: {_e(a.description)}" + (f" [{_e(a.source_ticket)}]" if a.source_ticket else "") + "</li>"
                         for a in ev.activities)
    follow = "".join(f"<li>{_e(q)}</li>" for q in ev.follow_up_questions)
    return (f"<h3>{_e(AGENT_LABELS.get(ev.agent_type, ev.agent_type))} - {_e(ev.status.value)}</h3>"
            f"<p>{_e(ev.rationale)}</p><p><strong>Review system:</strong> {_e(ev.review_system)}</p>"
            f"<h4>Controls</h4><ul>{controls or '<li>None</li>'}</ul>"
            f"<h4>Activities</h4><ul>{activities or '<li>None</li>'}</ul>"
            + (f"<h4>Open follow-ups</h4><ul>{follow}</ul>" if follow else "")
            + f"<h4>Derived fields (read-only)</h4>{_derived_list(ev.derived_fields)}")


def build_manifest(intake: Intake, result: OrchestrationResult) -> dict[str, Any]:
    """Epic + child Feature/Task manifest. All user-supplied text is HTML-escaped."""
    active = [r for r in result.agent_results if r.status != AgentStatus.SKIPPED]
    rows = "".join(
        f"<tr><td>{_e(AGENT_LABELS.get(r.agent_type, r.agent_type))}</td><td>{_e(r.status.value)}</td><td>{_e(r.review_system)}</td></tr>"
        for r in result.agent_results)
    epic_html = (
        f"<h2>{_e(intake.initiative_name)}</h2>"
        f"<table><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>"
        f"<tr><td>Type</td><td>{_e(intake.initiative_type)}</td></tr>"
        f"<tr><td>Application</td><td>{_e(intake.application_ci_id)}</td></tr>"
        f"<tr><td>Sponsor</td><td>{_e(intake.sponsor_email)}</td></tr>"
        f"<tr><td>Target go-live</td><td>{_e(intake.target_go_live)}</td></tr>"
        f"<tr><td>Overall status</td><td>{_e(result.overall_status.value)}</td></tr>"
        f"<tr><td>STP eligible</td><td>{'Yes' if result.straight_through_eligible else 'No'}</td></tr>"
        f"<tr><td>Coverage</td><td>{_e(result.coverage_pct)}% ({result.questions_replaced_count}/{result.questions_raw_count} questions)</td></tr>"
        f"</tbody></table>"
        f"<h3>Rationale</h3><p>{_e(intake.description)}</p>"
        f"<h3>Agent summary</h3><table><thead><tr><th>Agent</th><th>Status</th><th>Review system</th></tr></thead><tbody>{rows}</tbody></table>"
        + ("<h3>Synthesis notes</h3><ul>" + "".join(f"<li>{_e(n)}</li>" for n in result.notes) + "</ul>" if result.notes else "")
    )
    children: list[dict[str, Any]] = []
    for ev in active:
        tasks = [{"kind": "task", "title": a.title, "description_html": f"<p>{_e(a.description)}</p>"
                  + (f"<p>Control: {_e(a.control_ref)} | Ticket: {_e(a.source_ticket)}</p>" if a.control_ref or a.source_ticket else "")}
                 for a in ev.activities]
        tasks += [{"kind": "task", "title": f"Answer: {q[:120]}", "description_html": f"<p>{_e(q)}</p>"} for q in ev.follow_up_questions
                  if ev.status in (AgentStatus.NEEDS_REVIEW, AgentStatus.FLAGGED)]
        children.append({"kind": "feature", "agent_type": ev.agent_type,
                         "title": f"{AGENT_LABELS.get(ev.agent_type, ev.agent_type)} governance",
                         "description_html": _feature_html(ev), "children": tasks})
    return {
        "epic": {"kind": "epic", "title": f"[Aura] {intake.initiative_name}", "description_html": epic_html},
        "children": children,
        "counts": {"features": len(children), "tasks": sum(len(c["children"]) for c in children)},
    }
