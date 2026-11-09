from __future__ import annotations

import json
import logging

from app.llm.base import TASK_SYNTHESIS, LlmClient, extract_json
from app.models.enums import AgentStatus
from app.models.schemas import AgentEvidence
from app.models.tables import Intake

logger = logging.getLogger(__name__)
OPEN = {AgentStatus.NEEDS_REVIEW, AgentStatus.FLAGGED}

SYSTEM_PROMPT = f"""{TASK_SYNTHESIS}
You review the outputs of several governance agents for one initiative and surface conflicts and correlations
between them. Reply with JSON only: {{"notes": [str]}} with at most 6 short notes."""


def draft_notes(intake: Intake, results: dict[str, AgentEvidence]) -> list[str]:
    get = results.get
    notes: list[str] = []
    sec, priv, res, rel, ai, arch = (get(k) for k in ("security", "privacy", "resilience", "release", "ai_ethics", "architecture"))
    if rel and rel.derived_fields.get("stp_eligible") and any(r and r.status in OPEN for r in (sec, priv, res, ai, arch)):
        notes.append("Conflict: the change qualifies for straight-through release, but open specialist reviews block STP until resolved.")
    if sec and priv and sec.derived_fields.get("compound_risks") and priv.derived_fields.get("cross_border"):
        notes.append("Correlation: security compound risks and privacy cross-border transfer concern the same data flows; review jointly.")
    if res and res.status == AgentStatus.FLAGGED and rel and not rel.derived_fields.get("stp_eligible"):
        notes.append("Correlation: planned outage drives both the resilience flag and the release review.")
    if ai and ai.derived_fields.get("regulatory_scope_flag") and (priv is None or priv.not_applicable):
        notes.append("Gap: AI use is in regulatory scope but no privacy assessment ran; confirm personal-data flags.")
    if arch and arch.derived_fields.get("user_growth_pct", 0) > 25 and res and res.derived_fields.get("important_business_service"):
        notes.append("Correlation: high user growth on an important business service; align capacity tests with impact tolerance.")
    if intake.third_party_vendor_involved and sec and "Vendor Risk" not in sec.source_systems_consulted:
        notes.append("Gap: vendor involvement declared but vendor risk was not consulted.")
    return notes


def synthesize(llm: LlmClient, intake: Intake, results: dict[str, AgentEvidence]) -> list[str]:
    drafts = draft_notes(intake, results)
    summary = [{"agent": r.agent_type, "status": r.status.value, "rationale": r.rationale,
                "derived": {k: v for k, v in r.derived_fields.items() if not isinstance(v, (dict, list))}}
               for r in results.values() if not r.not_applicable]
    try:
        data = extract_json(llm.complete(SYSTEM_PROMPT, json.dumps({"agents": summary, "draft_notes": drafts}, default=str)))
        notes = [str(n).strip() for n in data.get("notes", []) if str(n).strip()]
        return notes[:6] or drafts
    except Exception as exc:  # noqa: BLE001
        logger.warning("Synthesis LLM call failed for intake %s: %s", intake.id, exc)
        return drafts or ["No cross-agent conflicts or correlations detected."]
