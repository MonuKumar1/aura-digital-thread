from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.api.deps import get_intake_or_404
from app.chat.agent import run_chat
from app.db import get_session
from app.models.schemas import ChatIn, ChatOut

router = APIRouter(tags=["chat"])


@router.post("/chat", response_model=ChatOut)
def chat(payload: ChatIn, session: Session = Depends(get_session)) -> ChatOut:
    intake = get_intake_or_404(session, payload.intake_id)
    return run_chat(session, intake, payload.message, payload.history)
