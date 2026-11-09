from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app.models.schemas import DetectIn
from app.nlp.detect import detect_intent

router = APIRouter(tags=["detect"])


@router.post("/detect")
def detect(payload: DetectIn) -> dict[str, Any]:
    return detect_intent(payload.text)
