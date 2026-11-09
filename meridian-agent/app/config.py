from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MERIDIAN_", env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./meridian.db"
    data_dir: Path = REPO_ROOT / "data"
    log_level: str = "INFO"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080"
    seed_sample_data: bool = True

    llm_provider: str = "mock"
    llm_base_url: str = "http://localhost:11434/v1"
    llm_api_key: str = Field(default="", repr=False)
    llm_model: str = "gpt-4o-mini"
    llm_timeout_seconds: float = 30.0
    llm_log_full_io: bool = False

    tracker_enabled: bool = True
    at_risk_threshold_days: int = 3
    max_upload_bytes: int = 2 * 1024 * 1024
    stream_step_delay_ms: int = 250  # paces SSE events so the UI graph animation is visible with the instant mock LLM

    portfolio_provider: str = "mock"
    cmdb_provider: str = "mock"
    itsm_risk_provider: str = "mock"
    secportal_provider: str = "mock"
    dra_provider: str = "mock"
    archportal_provider: str = "mock"
    tracker_provider: str = "mock"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
