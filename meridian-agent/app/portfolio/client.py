from __future__ import annotations

from typing import Any, Optional, Protocol

from app.mocks.fixtures import fixtures
from app.mocks.provider import select_provider


class PortfolioClient(Protocol):
    def get_investment(self, identifier: str) -> Optional[dict[str, Any]]: ...


class MockPortfolioClient:
    def __init__(self) -> None:
        self._items = fixtures()["portfolio"]

    def get_investment(self, identifier: str) -> Optional[dict[str, Any]]:
        """Accepts a portfolio id (PF-xxxx) or an application CI id."""
        key = (identifier or "").strip().upper()
        for item in self._items:
            if key in (item["portfolio_id"], item["ci_id"]):
                return dict(item)
        return None


def get_portfolio_client() -> PortfolioClient:
    return select_provider("portfolio", MockPortfolioClient)
