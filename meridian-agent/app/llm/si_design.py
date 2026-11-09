from __future__ import annotations

import logging
from typing import Any

from app.llm.base import TASK_SI_DESIGN, LlmClient, extract_json

logger = logging.getLogger(__name__)
MAX_CHARS = 30_000

SYSTEM_PROMPT = f"""{TASK_SI_DESIGN}
You extract solution-design evidence from a design document.
Reply with JSON only: {{"architecture": {{"pattern": str, "components": [str], "hosting": str}},
"data_flows": [{{"name": str, "source": str, "destination": str, "classification": str, "cross_border": bool}}],
"third_parties": [str], "controls": [str], "summary": str}}"""


def extract_si_design(text: str, llm: LlmClient) -> dict[str, Any]:
    raw = llm.complete(SYSTEM_PROMPT, text[:MAX_CHARS])
    data = extract_json(raw)
    if not isinstance(data, dict):
        raise ValueError("SI design extraction did not return an object")
    data.setdefault("data_flows", [])
    data.setdefault("third_parties", [])
    data.setdefault("controls", [])
    data.setdefault("architecture", {})
    return data
