from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, col, select

from app.api.deps import get_intake_or_404
from app.db import get_session
from app.models.schemas import WorkItemOut, WorkItemStateIn
from app.models.tables import Intake, IntakeAssessment, WorkItemLink
from app.orchestrator.service import reconcile_and_persist
from app.tracker import get_tracker_client
from app.tracker.manifest import build_manifest

router = APIRouter(prefix="/tracker", tags=["tracker"])


def _manifest(session: Session, intake: Intake, rebuild: bool) -> dict[str, Any]:
    result = reconcile_and_persist(session, intake)
    if result is None:
        raise HTTPException(status_code=409, detail="Run orchestration before building a work-item manifest")
    row = session.exec(select(IntakeAssessment).where(IntakeAssessment.intake_id == intake.id)).one()
    if row.manifest_json and not rebuild:
        return json.loads(row.manifest_json)
    manifest = build_manifest(intake, result)
    row.manifest_json = json.dumps(manifest)
    session.add(row)
    session.commit()
    return manifest


def _links(session: Session, intake_id: int) -> list[WorkItemLink]:
    return list(session.exec(select(WorkItemLink).where(WorkItemLink.intake_id == intake_id).order_by(col(WorkItemLink.id))).all())


@router.post("/{intake_id}/manifest")
def manifest(intake_id: int, session: Session = Depends(get_session)) -> dict[str, Any]:
    return _manifest(session, get_intake_or_404(session, intake_id), rebuild=True)


@router.post("/{intake_id}/create", response_model=list[WorkItemOut])
def create_work_items(intake_id: int, session: Session = Depends(get_session)) -> list[WorkItemLink]:
    intake = get_intake_or_404(session, intake_id)
    existing = _links(session, intake_id)
    if any(link.kind == "epic" for link in existing):
        return existing  # idempotent: one epic per intake
    data = _manifest(session, intake, rebuild=False)
    tracker = get_tracker_client()
    epic = tracker.create_item("epic", data["epic"]["title"], data["epic"]["description_html"])
    links = [WorkItemLink(intake_id=intake_id, kind="epic", external_id=epic["external_id"], title=data["epic"]["title"], url=epic["url"])]
    for feature in data["children"]:
        fe = tracker.create_item("feature", feature["title"], feature["description_html"], epic["external_id"])
        links.append(WorkItemLink(intake_id=intake_id, kind="feature", external_id=fe["external_id"], parent_external_id=epic["external_id"],
                                  title=feature["title"], url=fe["url"]))
        for task in feature["children"]:
            tk = tracker.create_item("task", task["title"], task["description_html"], fe["external_id"])
            links.append(WorkItemLink(intake_id=intake_id, kind="task", external_id=tk["external_id"], parent_external_id=fe["external_id"],
                                      title=task["title"][:300], url=tk["url"]))
    session.add_all(links)
    session.commit()
    return _links(session, intake_id)


@router.get("/{intake_id}/links", response_model=list[WorkItemOut])
def list_links(intake_id: int, session: Session = Depends(get_session)) -> list[WorkItemLink]:
    get_intake_or_404(session, intake_id)
    return _links(session, intake_id)


@router.patch("/work-items/{external_id}/state", response_model=WorkItemOut)
def update_state(external_id: str, payload: WorkItemStateIn, session: Session = Depends(get_session)) -> WorkItemLink:
    link = session.exec(select(WorkItemLink).where(WorkItemLink.external_id == external_id)).first()
    if link is None:
        raise HTTPException(status_code=404, detail=f"Work item {external_id} not found")
    get_tracker_client().update_state(external_id, payload.state)
    link.state = payload.state
    session.add(link)
    session.commit()
    session.refresh(link)
    return link
