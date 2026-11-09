from __future__ import annotations

import logging

from sqlmodel import Session, SQLModel

import app.models  # noqa: F401 - registers tables on SQLModel.metadata
from app.config import get_settings
from app.db.migrate import apply_column_migrations, normalize_legacy_stages
from app.db.session import get_engine, get_session, reset_engine

logger = logging.getLogger(__name__)


def init_db() -> None:
    engine = get_engine()
    SQLModel.metadata.create_all(engine)
    apply_column_migrations(engine)
    normalized = normalize_legacy_stages(engine)
    if normalized:
        logger.info("Normalized %d legacy stage values", normalized)
    if get_settings().seed_sample_data:
        from app.db.seed import seed_sample_intakes

        with Session(engine) as session:
            seed_sample_intakes(session)


__all__ = ["init_db", "get_engine", "get_session", "reset_engine"]
