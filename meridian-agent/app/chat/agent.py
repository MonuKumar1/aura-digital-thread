from __future__ import annotations

import json
import logging
from typing import Any, Optional

from sqlmodel import Session

from app.chat.tools import TOOL_SPECS, ChatTools
from app.llm import LlmClient, get_llm_client
from app.models.schemas import ChatOut, ChatTurn, ToolTraceItem
from app.models.tables import Intake

logger = logging.getLogger(__name__)
MAX_STEPS = 6
SYSTEM_PROMPT = (
    "You are Ask Aura, a governance assistant scoped to one initiative. Use the tools to look up facts "
    "before answering; never invent statuses or dates. Answer concisely in plain language."
)


def run_chat(session: Session, intake: Intake, message: str, history: list[ChatTurn], llm: Optional[LlmClient] = None) -> ChatOut:
    llm = llm or get_llm_client()
    tools = ChatTools(session, intake)
    messages: list[dict[str, Any]] = [{"role": "system", "content": f"{SYSTEM_PROMPT}\nInitiative: #{intake.id} {intake.initiative_name}"}]
    messages += [{"role": t.role, "content": t.content} for t in history[-10:]]
    messages.append({"role": "user", "content": message})
    trace: list[ToolTraceItem] = []

    for _ in range(MAX_STEPS):
        reply = llm.chat_with_tools(messages, TOOL_SPECS)
        calls = reply.get("tool_calls") or []
        if not calls:
            return ChatOut(answer=str(reply.get("content") or "").strip() or "I don't have an answer for that.", tool_trace=trace)
        messages.append({"role": "assistant", "content": None, "tool_calls": calls})
        for call in calls:
            args = call.get("arguments") or {}
            result = tools.call(call["name"], args)
            content = json.dumps(result, default=str)
            trace.append(ToolTraceItem(tool=call["name"], arguments=args, result_preview=content[:300]))
            messages.append({"role": "tool", "tool_call_id": call["id"], "name": call["name"], "content": content})
    logger.warning("Chat for intake %s hit the %d-step limit", intake.id, MAX_STEPS)
    return ChatOut(answer="I gathered the information below but reached my step limit before summarising it.", tool_trace=trace)
