from __future__ import annotations

import json
import re
from typing import Any

from app.llm.base import TASK_REPHRASE, TASK_SI_DESIGN, TASK_SYNTHESIS

# Ordered keyword -> tool routing used by the deterministic chat loop.
CHAT_ROUTES: list[tuple[tuple[str, ...], str]] = [
    (("follow", "pending", "question", "answer", "todo", "outstanding"), "list_follow_ups"),
    (("cmdb", "ci ", "rto", "rpo", "config item", "application"), "get_cmdb_record"),
    (("coverage", "replaced", "how many questions"), "get_coverage"),
    (("deadline", "due", "late", "overdue", "date", "when"), "get_stage_deadlines"),
    (("why", "status", "blocked", "risk", "stp", "straight"), "explain_status"),
]
AGENT_KEYWORDS: dict[str, tuple[str, ...]] = {
    "security": ("security", "secur", "pen test", "auth"),
    "privacy": ("privacy", "personal data", "gdpr", "dra"),
    "ai_ethics": ("ai", "ethic", "model", "biometric"),
    "architecture": ("architecture", "capability", "sla", "growth"),
    "resilience": ("resilience", "ibs", "disaster", "recovery"),
    "release": ("release", "change", "backout", "outage"),
    "clarity": ("portfolio", "impact", "investment"),
    "scoping": ("scope", "scoping", "track"),
}
# Truthy intake flag -> (agents it is relevant to, sentence the "LLM" adds to the rationale).
KEYWORD_SENTENCES: dict[str, tuple[tuple[str, ...], str]] = {
    "handles_payment_data": (("security", "clarity"), "Payment data in scope brings card-data segmentation obligations."),
    "cross_border_data_transfer": (("privacy", "security"), "Cross-border flows require transfer safeguards to be evidenced."),
    "biometric_data": (("ai_ethics", "privacy"), "Biometric processing is treated as high-risk by default."),
    "outage_expected": (("resilience", "release"), "A planned outage removes eligibility for straight-through processing."),
    "internet_facing": (("security", "architecture"), "Public exposure widens the attack surface."),
}


class MockLlmClient:
    """Deterministic stand-in for an LLM: no network, same output for the same input."""

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        if TASK_SI_DESIGN in system_prompt:
            return json.dumps(self._si_design(user_prompt))
        payload = _safe_json(user_prompt)
        if TASK_SYNTHESIS in system_prompt:
            notes = payload.get("draft_notes") or ["No cross-agent conflicts or correlations detected."]
            return json.dumps({"notes": notes})
        if TASK_REPHRASE in system_prompt:
            draft = str(payload.get("draft_rationale", "")).strip()
            initiative = payload.get("initiative") or {}
            agent = payload.get("agent_type")
            extra = [sentence for flag, (agents, sentence) in KEYWORD_SENTENCES.items() if initiative.get(flag) and agent in agents]
            rationale = " ".join([draft, *extra[:1]]).strip()
            return json.dumps({"rationale": rationale, "follow_up_questions": payload.get("draft_follow_ups", [])})
        return json.dumps({"rationale": "No specific guidance.", "follow_up_questions": []})

    def chat_with_tools(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> dict[str, Any]:
        last_user_idx = max(i for i, m in enumerate(messages) if m["role"] == "user")
        question = str(messages[last_user_idx]["content"]).lower() + " "
        called = [m for m in messages[last_user_idx + 1:] if m["role"] == "tool"]
        called_names = {m["name"] for m in called}
        available = {t["function"]["name"] for t in tools}

        wanted: list[tuple[str, dict[str, Any]]] = []
        agent = next((a for a, kws in AGENT_KEYWORDS.items() if any(re.search(rf"\b{re.escape(k)}", question) for k in kws)), None)
        if agent:
            wanted.append(("get_agent_result", {"agent_type": agent}))
        for kws, tool in CHAT_ROUTES:
            if any(k in question for k in kws):
                wanted.append((tool, {}))
        if not wanted:
            wanted.append(("explain_status", {}))

        for idx, (name, args) in enumerate(wanted):
            if name in available and name not in called_names:
                return {"tool_calls": [{"id": f"call_{len(called) + idx}", "name": name, "arguments": args}]}
        return {"content": _compose_answer(called)}

    @staticmethod
    def _si_design(text: str) -> dict[str, Any]:
        low = text.lower()
        cross = any(k in low for k in ("cross-border", "overseas", "offshore", "eu region", "us region", "international"))
        vendors = [v for v in ("AnalyticsCloud Inc", "TokenVault Ltd", "IdentityCo", "ModelHost Corp") if v.lower() in low]
        if not vendors and ("vendor" in low or "third party" in low or "third-party" in low):
            vendors = ["Unnamed SaaS Provider"]
        classification = "RESTRICTED" if "restricted" in low else "CONFIDENTIAL" if ("confidential" in low or "customer" in low) else "INTERNAL"
        return {
            "architecture": {
                "pattern": "EVENT_DRIVEN" if "event" in low else "MICROSERVICES",
                "components": ["API Gateway", "Service Layer", "Data Store"] + (["Message Bus"] if "event" in low else []),
                "hosting": "PUBLIC_CLOUD" if "cloud" in low else "ON_PREM",
            },
            "data_flows": [
                {"name": "Customer records sync", "source": "Service Layer", "destination": "Analytics Store",
                 "classification": classification, "cross_border": cross},
                {"name": "Audit log export", "source": "Service Layer", "destination": "Log Archive",
                 "classification": "INTERNAL", "cross_border": False},
            ],
            "third_parties": vendors,
            "controls": ["TLS 1.2+", "Role-based access control"] + (["Field-level encryption"] if "encrypt" in low else []),
            "summary": f"Extracted {len(text.split())} words of design content.",
        }


def _safe_json(text: str) -> dict[str, Any]:
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else {}
    except ValueError:
        return {}


def _compose_answer(tool_messages: list[dict[str, Any]]) -> str:
    if not tool_messages:
        return "I could not find anything relevant for this initiative."
    parts = []
    for m in tool_messages:
        data = _safe_json(m["content"])
        parts.append(_summarise(m["name"], data))
    return "\n".join(p for p in parts if p)


def _summarise(tool: str, data: dict[str, Any]) -> str:
    if "error" in data:
        return f"- {tool}: {data['error']}"
    if tool == "get_agent_result":
        fu = data.get("follow_up_questions") or []
        return (f"- {data.get('agent_label', data.get('agent_type'))} agent is {data.get('status')}: {data.get('rationale', '')}"
                + (f" ({len(fu)} follow-up question(s) outstanding)" if fu else ""))
    if tool == "list_follow_ups":
        items = data.get("open", [])
        if not items:
            return "- There are no outstanding follow-up questions."
        lines = [f"- {len(items)} follow-up question(s) awaiting an answer:"]
        lines += [f"  - [{i['agent_type']}] {i['question']}" for i in items[:8]]
        return "\n".join(lines)
    if tool == "get_cmdb_record":
        rec = data.get("record") or {}
        if not rec:
            return "- No CMDB record is linked to this initiative."
        return (f"- CMDB: {rec.get('ci_id')} {rec.get('app_name')} (owner {rec.get('owner')}), IBS={rec.get('ibs')}, "
                f"RTO {rec.get('rto_hours')}h / RPO {rec.get('rpo_hours')}h, risk band {rec.get('risk_band')}.")
    if tool == "get_coverage":
        return (f"- Coverage is {data.get('coverage_pct')}%: {data.get('answered_questions')} of {data.get('total_questions')} "
                f"legacy questions answered across {data.get('systems_replaced')} systems.")
    if tool == "explain_status":
        reasons = data.get("reasons") or []
        return f"- Status is {data.get('status_label')} ({data.get('status')}). " + " ".join(reasons)
    if tool == "get_stage_deadlines":
        rows = data.get("deadlines", [])
        cur = data.get("current_stage")
        due = next((r["due_date"] for r in rows if r["stage"] == cur), None)
        return f"- Current stage {cur} is due {due}. " + ", ".join(f"{r['stage']}: {r['due_date']}" for r in rows)
    return f"- {tool}: {json.dumps(data)[:200]}"
