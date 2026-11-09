from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.api.deps import get_intake_or_404
from app.config import get_settings
from app.db import get_engine, get_session
from app.models.schemas import OrchestrationResult
from app.models.tables import Intake
from app.orchestrator.service import reconcile_and_persist, run_orchestration

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/orchestration", tags=["orchestration"])
TERMINAL = {"result", "error"}


@router.post("/{intake_id}/run", response_model=OrchestrationResult)
def run(intake_id: int, session: Session = Depends(get_session)) -> OrchestrationResult:
    return run_orchestration(session, get_intake_or_404(session, intake_id))


@router.get("/{intake_id}/run-stream")
async def run_stream(intake_id: int, session: Session = Depends(get_session)) -> StreamingResponse:
    get_intake_or_404(session, intake_id)
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[tuple[str, dict[str, Any]]] = asyncio.Queue()
    delay = get_settings().stream_step_delay_ms / 1000

    def emit(event: str, payload: dict[str, Any]) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, (event, payload))
        if delay and event in ("agent_completed", "agent_skipped", "synthesis_completed"):
            time.sleep(delay)

    def work() -> None:
        try:
            with Session(get_engine()) as worker_session:
                intake = worker_session.get(Intake, intake_id)
                if intake is None:
                    emit("error", {"detail": "Intake not found"})
                    return
                result = run_orchestration(worker_session, intake, on_progress=emit)
                emit("result", json.loads(result.model_dump_json()))
        except Exception as exc:  # noqa: BLE001
            logger.exception("Streaming orchestration failed for intake %s", intake_id)
            emit("error", {"detail": str(exc)})

    async def events() -> AsyncIterator[str]:
        future = loop.run_in_executor(None, work)
        yield f"data: {json.dumps({'type': 'run_started', 'intake_id': intake_id})}\n\n"
        while True:
            event, payload = await queue.get()
            yield f"data: {json.dumps({'type': event, **payload}, default=str)}\n\n"
            if event in TERMINAL:
                break
        await future

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/{intake_id}/result", response_model=OrchestrationResult)
def get_result(intake_id: int, session: Session = Depends(get_session)) -> OrchestrationResult:
    result = reconcile_and_persist(session, get_intake_or_404(session, intake_id))
    if result is None:
        raise HTTPException(status_code=404, detail="No orchestration result yet; run orchestration first")
    return result
