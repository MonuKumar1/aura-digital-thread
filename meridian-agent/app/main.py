from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import chat, coverage, detect, intake, lifecycle, lookup, orchestration, tracker
from app.config import get_settings
from app.db import init_db
from app.mocks.fixtures import fixtures


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    init_db()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    app = FastAPI(title="Aura Digital Thread", version="1.0.0", description="Agentic SDLC governance orchestrator", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
    api = APIRouter(prefix="/api")
    for module in (intake, orchestration, lookup, coverage, detect, lifecycle, tracker, chat):
        api.include_router(module.router)

    @api.get("/health", tags=["meta"])
    def health() -> dict[str, str]:
        return {"status": "ok", "llm_provider": settings.llm_provider}

    @api.get("/config", tags=["meta"])
    def public_config() -> dict[str, object]:
        return {"tracker_enabled": settings.tracker_enabled, "at_risk_threshold_days": settings.at_risk_threshold_days,
                "wiki_design_template_url": fixtures()["wiki_design_template_url"], "llm_provider": settings.llm_provider}

    app.include_router(api)
    return app


app = create_app()
