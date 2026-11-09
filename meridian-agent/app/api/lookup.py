from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.cmdb import get_cmdb_client
from app.portfolio import get_portfolio_client

router = APIRouter(tags=["lookup"])


@router.get("/cmdb/lookup")
def cmdb_lookup(ci_id: str = Query(..., pattern=r"^[A-Za-z]{2}-\d{4}$")) -> dict[str, Any]:
    record = get_cmdb_client().get_record(ci_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"CI {ci_id} not found in CMDB")
    return record


@router.get("/cmdb/records")
def cmdb_records() -> list[dict[str, Any]]:
    return get_cmdb_client().list_records()


@router.get("/portfolio/lookup")
def portfolio_lookup(id: str = Query(..., pattern=r"^[A-Za-z]{2}-\d{4}$")) -> dict[str, Any]:  # noqa: A002 - matches the public query param
    item = get_portfolio_client().get_investment(id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"No portfolio investment for {id}")
    return item
