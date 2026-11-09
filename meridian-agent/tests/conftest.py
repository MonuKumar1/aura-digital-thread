from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any, Iterator

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="meridian-test-"))
os.environ["MERIDIAN_DATABASE_URL"] = f"sqlite:///{_TMP / 'test.db'}"
os.environ["MERIDIAN_STREAM_STEP_DELAY_MS"] = "0"
os.environ["MERIDIAN_LLM_PROVIDER"] = "mock"

from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import reset_engine  # noqa: E402
from app.models.tables import Intake  # noqa: E402

get_settings.cache_clear()


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    reset_engine()
    from app.main import app

    with TestClient(app) as c:
        yield c


def make_intake(**overrides: Any) -> Intake:
    """Minimal in-memory intake for pure rule tests."""
    base: dict[str, Any] = {"id": 999, "initiative_name": "Test change", "initiative_type": "CLOUD", "sponsor_email": "a@example.com",
                            "description": "A sufficiently long description of the change.", "backout_plan_summary": "Roll back",
                            "authentication_method": "SSO", "encryption_in_transit": True}
    base.update(overrides)
    return Intake(**base)


VALID_PAYLOAD: dict[str, Any] = {
    "initiative_name": "Pytest Intake",
    "initiative_type": "TECH_CHANGE",
    "sponsor_email": "Tester@Example.com",
    "application_ci_id": "ci-1003",
    "description": "Upgrade the analytics batch runtime with automated rollback.",
    "authentication_method": "SSO",
    "encryption_in_transit": True,
    "implementation_method": "AUTOMATED_PIPELINE",
    "backout_plan_summary": "Pipeline rollback",
}
