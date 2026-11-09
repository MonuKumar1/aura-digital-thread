from __future__ import annotations

from typing import Callable, TypeVar

from app.config import get_settings

T = TypeVar("T")


def select_provider(system: str, mock_factory: Callable[[], T]) -> T:
    """Picks the client for MERIDIAN_<SYSTEM>_PROVIDER. Only `mock` is implemented."""
    provider = str(getattr(get_settings(), f"{system}_provider", "mock")).lower()
    if provider == "mock":
        return mock_factory()
    raise NotImplementedError(f"Provider '{provider}' for system '{system}' is not implemented; use 'mock'.")
