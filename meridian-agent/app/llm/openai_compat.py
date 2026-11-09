from __future__ import annotations

import json
import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)
BACKOFF_SECONDS = (2.0, 4.0)


class OpenAICompatibleLlmClient:
    """Minimal client for any /chat/completions-compatible endpoint. Key comes from MERIDIAN_LLM_API_KEY."""

    def __init__(self, base_url: str, api_key: str, model: str, timeout: float) -> None:
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._headers = {"Content-Type": "application/json"}
        if api_key:
            self._headers["Authorization"] = f"Bearer {api_key}"
        self._model = model
        self._timeout = timeout

    def _post(self, body: dict[str, Any]) -> dict[str, Any]:
        last_exc: Exception | None = None
        for attempt in range(len(BACKOFF_SECONDS) + 1):
            try:
                with httpx.Client(timeout=self._timeout) as client:
                    resp = client.post(self._url, headers=self._headers, json=body)
                if resp.status_code == 429 or resp.status_code >= 500:
                    raise httpx.HTTPStatusError(f"retryable status {resp.status_code}", request=resp.request, response=resp)
                resp.raise_for_status()
                return resp.json()
            except (httpx.TransportError, httpx.HTTPStatusError) as exc:
                last_exc = exc
                retryable = not isinstance(exc, httpx.HTTPStatusError) or exc.response.status_code in (429,) or exc.response.status_code >= 500
                if not retryable or attempt == len(BACKOFF_SECONDS):
                    break
                logger.warning("LLM call failed (attempt %d): %s; retrying in %.0fs", attempt + 1, exc, BACKOFF_SECONDS[attempt])
                time.sleep(BACKOFF_SECONDS[attempt])
        raise RuntimeError(f"LLM request failed after retries: {last_exc}")

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        data = self._post({
            "model": self._model,
            "temperature": 0,
            "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
        })
        return data["choices"][0]["message"].get("content") or ""

    def chat_with_tools(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> dict[str, Any]:
        wire: list[dict[str, Any]] = []
        for m in messages:
            if m["role"] == "tool":
                wire.append({"role": "tool", "tool_call_id": m["tool_call_id"], "content": m["content"]})
            elif m.get("tool_calls"):
                wire.append({"role": "assistant", "content": None, "tool_calls": [
                    {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": json.dumps(c["arguments"])}}
                    for c in m["tool_calls"]]})
            else:
                wire.append({"role": m["role"], "content": m["content"]})
        data = self._post({"model": self._model, "temperature": 0, "messages": wire, "tools": tools})
        msg = data["choices"][0]["message"]
        if msg.get("tool_calls"):
            return {"tool_calls": [
                {"id": c["id"], "name": c["function"]["name"], "arguments": json.loads(c["function"].get("arguments") or "{}")}
                for c in msg["tool_calls"]]}
        return {"content": msg.get("content") or ""}
