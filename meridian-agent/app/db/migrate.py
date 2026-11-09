from __future__ import annotations

import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.models.enums import LEGACY_STAGE_ALIASES

logger = logging.getLogger(__name__)

# Columns added after the first release. Each entry is applied only if missing, so this is safe to re-run.
COLUMN_MIGRATIONS: list[tuple[str, str, str]] = [
    ("intake", "cmdb_snapshot", "TEXT"),
    ("intake", "si_design_evidence", "TEXT"),
    ("intake", "created_by", "VARCHAR(254)"),
    ("intake", "updated_at", "DATETIME"),
    ("intake", "training_data_contains_personal_data", "BOOLEAN NOT NULL DEFAULT 0"),
    ("intake", "secrets_management", "VARCHAR(16)"),
    ("intakeassessment", "manifest_json", "TEXT"),
    ("workitemlink", "parent_external_id", "VARCHAR(64)"),
    ("workitemlink", "title", "VARCHAR(300) NOT NULL DEFAULT ''"),
]


def apply_column_migrations(engine: Engine) -> list[str]:
    applied: list[str] = []
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table, column, ddl in COLUMN_MIGRATIONS:
            if table not in tables:
                continue
            existing = {c["name"] for c in inspector.get_columns(table)}
            if column not in existing:
                # Identifiers come from the constant list above, never from user input.
                conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {ddl}'))
                applied.append(f"{table}.{column}")
    if applied:
        logger.info("Applied column migrations: %s", ", ".join(applied))
    return applied


def normalize_legacy_stages(engine: Engine) -> int:
    changed = 0
    with engine.begin() as conn:
        for legacy, canonical in LEGACY_STAGE_ALIASES.items():
            for table, column in (("intake", "current_stage"), ("stagedeadline", "stage")):
                res = conn.execute(text(f'UPDATE "{table}" SET "{column}" = :new WHERE "{column}" = :old'),
                                   {"new": canonical, "old": legacy})
                changed += res.rowcount or 0
    return changed
