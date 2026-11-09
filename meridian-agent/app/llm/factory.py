from __future__ import annotations

import json
import logging
from typing import Any

from app.config import get_settings
from app.llm.base import LlmClient
from app.llm.mock import MockLlmClient
from app.llm.openai_compat import OpenAICompatibleLlmClient

logger = logging.getLogger("app.llm")


class LoggingLlmClient:
    """Logs every call; full prompts/responses only when MERIDIAN_LLM_LOG_FULL_IO=true."""

    def __init__(self, inner: LlmClient, full_io: bool) -> None:
        self._inner = inner
        self._full = full_io

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        out = self._inner.complete(system_prompt, user_prompt)
        if self._full:
            logger.info("LLM complete\n--- system ---\n%s\n--- user ---\n%s\n--- output ---\n%s", system_prompt, user_prompt, out)
        else:
            logger.debug("LLM complete: in=%d chars, out=%d chars", len(system_prompt) + len(user_prompt), len(out))
        return out

    def chat_with_tools(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> dict[str, Any]:
        out = self._inner.chat_with_tools(messages, tools)
        if self._full:
            logger.info("LLM chat_with_tools messages=%s output=%s", json.dumps(messages)[:20000], json.dumps(out))
        return out


def get_llm_client() -> LlmClient:
    s = get_settings()
    provider = s.llm_provider.lower()
    inner: LlmClient
    if provider == "mock":
        inner = MockLlmClient()
    elif provider == "openai-compatible":
        inner = OpenAICompatibleLlmClient(s.llm_base_url, s.llm_api_key, s.llm_model, s.llm_timeout_seconds)
    else:
        raise NotImplementedError(f"LLM provider '{provider}' is not supported (use mock or openai-compatible)")
    return LoggingLlmClient(inner, s.llm_log_full_io)
