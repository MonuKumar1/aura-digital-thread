from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from sqlmodel import Session, func, select

from app.agents.base import Providers
from app.cmdb import apply_cmdb_autofill, get_cmdb_client
from app.models.schemas import IntakeCreate
from app.models.tables import Intake, utcnow
from app.mocks.fixtures import fixtures
from app.orchestrator.lifecycle import ensure_deadlines
from app.orchestrator.service import run_orchestration

logger = logging.getLogger(__name__)
RELATIVE_KEYS = {"created_days_ago", "go_live_in_days", "current_stage"}


def seed_sample_intakes(session: Session) -> int:
    """Inserts the shared sample intakes (dates relative to today) and runs orchestration so the dashboard is populated."""
    if session.exec(select(func.count()).select_from(Intake)).one() > 0:
        return 0
    cmdb = get_cmdb_client()
    providers = Providers()
    count = 0
    for raw in fixtures()["sample_intakes"]:
        payload: dict[str, Any] = {k: v for k, v in raw.items() if k not in RELATIVE_KEYS}
        payload["target_go_live"] = date.today() + timedelta(days=raw["go_live_in_days"])
        data = IntakeCreate(**payload)
        intake = Intake(**data.model_dump(exclude={"current_stage", "created_by"}))
        intake.current_stage = raw["current_stage"]
        intake.created_at = utcnow() - timedelta(days=raw["created_days_ago"])
        intake.created_by = "seed@example.com"
        apply_cmdb_autofill(intake, cmdb)
        session.add(intake)
        session.flush()
        ensure_deadlines(session, intake)
        run_orchestration(session, intake, providers=providers)
        count += 1
    logger.info("Seeded %d sample intakes", count)
    return count
