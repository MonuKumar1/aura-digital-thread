from __future__ import annotations

import json
import re
from typing import Any, Protocol

TASK_REPHRASE = "TASK=REPHRASE"
TASK_SYNTHESIS = "TASK=SYNTHESIS"
TASK_SI_DESIGN = "TASK=SI_DESIGN"


class LlmClient(Protocol):
    def complete(self, system_prompt: str, user_prompt: str) -> str: ...

    def chat_with_tools(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> dict[str, Any]:
        """Returns {"tool_calls": [{"id", "name", "arguments"}]} or {"content": str}."""
        ...


_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


def extract_json(text: str) -> Any:
    """Parses JSON from a model reply, tolerating code fences and leading prose."""
    match = _FENCE.search(text)
    candidate = match.group(1) if match else text
    start = min((i for i in (candidate.find("{"), candidate.find("[")) if i >= 0), default=-1)
    if start < 0:
        raise ValueError("no JSON object in LLM output")
    return json.loads(candidate[start:])
