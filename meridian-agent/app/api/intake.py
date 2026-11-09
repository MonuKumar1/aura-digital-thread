from __future__ import annotations

import io
import json
import logging
import re
import zipfile
from collections import Counter
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import ValidationError
from sqlmodel import Session, col, func, or_, select

from app.api.deps import get_intake_or_404, to_read
from app.cmdb import apply_cmdb_autofill
from app.config import get_settings
from app.db import get_session
from app.llm import get_llm_client
from app.llm.si_design import extract_si_design
from app.models.enums import STAGE_ORDER, STATUS_LABELS, InitiativeStatus
from app.models.schemas import (
    IntakeCreate, IntakeListItem, IntakePage, IntakeRead, IntakeUpdate, OrchestrationResult,
    ReviewAnswerOut, ReviewAnswersIn,
)
from app.models.tables import AgentReviewAnswer, FieldChangeLog, Intake, IntakeAssessment, IntakeBase, utcnow
from app.orchestrator.lifecycle import assessments_by_intake, deadlines_by_intake, ensure_deadlines, refresh_statuses, status_for, status_label
from app.orchestrator.service import reconcile_and_persist

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/intake", tags=["intake"])

SORTABLE = {"id", "created_at", "initiative_name", "initiative_type", "target_go_live", "status", "current_stage", "sponsor_email"}
ALLOWED_UPLOADS = {
    ".txt": {"text/plain", "application/octet-stream"},
    ".pdf": {"application/pdf", "application/octet-stream"},
    ".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/octet-stream", "application/zip"},
}
@router.post("", response_model=IntakeRead, status_code=201)
def create_intake(payload: IntakeCreate, session: Session = Depends(get_session)) -> IntakeRead:
    intake = Intake(**payload.model_dump(exclude={"current_stage"}))
    if payload.current_stage and payload.current_stage in {s.value for s in STAGE_ORDER}:
        intake.current_stage = payload.current_stage
    apply_cmdb_autofill(intake)
    session.add(intake)
    session.flush()
    deadlines = {d.stage: d.due_date for d in ensure_deadlines(session, intake)}
    intake.status = status_for(intake, None, deadlines).value
    session.commit()
    session.refresh(intake)
    return to_read(intake)


@router.get("", response_model=IntakePage)
def list_intakes(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    sort_by: str = Query("created_at"),
    sort_dir: Literal["asc", "desc"] = Query("desc"),
    status: Optional[InitiativeStatus] = None,
    sponsor_email: Optional[str] = Query(None, max_length=254),
    q: Optional[str] = Query(None, max_length=200),
    application_ci_id: Optional[str] = Query(None, max_length=16),
    initiative_name: Optional[str] = Query(None, max_length=200),
    session: Session = Depends(get_session),
) -> IntakePage:
    if sort_by not in SORTABLE:
        raise HTTPException(status_code=422, detail=f"sort_by must be one of {sorted(SORTABLE)}")
    refresh_statuses(session)

    filters: list[Any] = []
    if status:
        filters.append(Intake.status == status.value)
    if sponsor_email:
        filters.append(func.lower(Intake.sponsor_email) == sponsor_email.strip().lower())
    if application_ci_id:
        filters.append(Intake.application_ci_id == application_ci_id.strip().upper())
    if initiative_name:
        filters.append(col(Intake.initiative_name).ilike(f"%{initiative_name.strip()}%"))
    if q:
        like = f"%{q.strip()}%"
        filters.append(or_(col(Intake.initiative_name).ilike(like), col(Intake.sponsor_email).ilike(like),
                           col(Intake.application_ci_id).ilike(like), col(Intake.description).ilike(like)))

    total = session.exec(select(func.count()).select_from(Intake).where(*filters)).one()
    order_col = getattr(Intake, sort_by)
    stmt = (select(Intake).where(*filters)
            .order_by(order_col.asc() if sort_dir == "asc" else order_col.desc(), col(Intake.id).desc())
            .offset((page - 1) * page_size).limit(page_size))
    rows = session.exec(stmt).all()
    ids = [r.id for r in rows]
    deadlines = deadlines_by_intake(session, ids)  # type: ignore[arg-type]
    assessments = assessments_by_intake(session, ids)  # type: ignore[arg-type]
    items = [IntakeListItem(
        id=r.id, initiative_name=r.initiative_name, initiative_type=r.initiative_type, application_ci_id=r.application_ci_id,  # type: ignore[arg-type]
        sponsor_email=r.sponsor_email, target_go_live=r.target_go_live, current_stage=r.current_stage, status=r.status,
        status_label=status_label(r.status),
        overall_status=assessments[r.id].overall_status if r.id in assessments else None,
        straight_through_eligible=assessments[r.id].straight_through_eligible if r.id in assessments else None,
        current_stage_due=deadlines.get(r.id, {}).get(r.current_stage),  # type: ignore[arg-type]
        created_at=r.created_at,
    ) for r in rows]
    return IntakePage(items=items, total=total)


# Declared before /{intake_id} so "summary" is never parsed as an id.
@router.get("/summary")
def intake_summary(sponsor_email: Optional[str] = Query(None, max_length=254), session: Session = Depends(get_session)) -> dict[str, Any]:
    refresh_statuses(session)
    stmt = select(Intake)
    if sponsor_email:
        stmt = stmt.where(func.lower(Intake.sponsor_email) == sponsor_email.strip().lower())
    rows = session.exec(stmt).all()
    assessments = assessments_by_intake(session, [r.id for r in rows])  # type: ignore[misc]
    by_status = Counter(r.status for r in rows)
    return {
        "total": len(rows),
        "by_status": {s.value: by_status.get(s.value, 0) for s in InitiativeStatus},
        "status_labels": {s.value: label for s, label in STATUS_LABELS.items()},
        "by_stage": {s.value: sum(1 for r in rows if r.current_stage == s.value) for s in STAGE_ORDER},
        "by_type": dict(Counter(r.initiative_type for r in rows)),
        "stp_eligible": sum(1 for a in assessments.values() if a.straight_through_eligible),
        "assessed": len(assessments),
    }


@router.get("/{intake_id}", response_model=IntakeRead)
def get_intake(intake_id: int, session: Session = Depends(get_session)) -> IntakeRead:
    intake = get_intake_or_404(session, intake_id)
    assessment = session.exec(select(IntakeAssessment).where(IntakeAssessment.intake_id == intake_id)).first()
    return to_read(intake, assessment)


@router.patch("/{intake_id}", response_model=IntakeRead)
def update_intake(intake_id: int, payload: IntakeUpdate, session: Session = Depends(get_session)) -> IntakeRead:  # type: ignore[valid-type]
    intake = get_intake_or_404(session, intake_id)
    changes = payload.model_dump(exclude_unset=True)  # type: ignore[attr-defined]
    changed_by = changes.pop("changed_by", None) or "system"
    merged = {name: getattr(intake, name) for name in IntakeBase.model_fields} | changes
    try:
        validated = IntakeCreate(**merged)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_url=False, include_context=False)) from exc
    logs = []
    for field in changes:
        old, new = getattr(intake, field), getattr(validated, field)
        if old != new:
            logs.append(FieldChangeLog(intake_id=intake_id, field=field, old_value=None if old is None else str(old),
                                       new_value=None if new is None else str(new), changed_by=changed_by))
            setattr(intake, field, new)
    if any(log.field == "application_ci_id" for log in logs):
        apply_cmdb_autofill(intake)
    intake.updated_at = utcnow()
    session.add_all([intake, *logs])
    session.commit()
    session.refresh(intake)
    assessment = session.exec(select(IntakeAssessment).where(IntakeAssessment.intake_id == intake_id)).first()
    return to_read(intake, assessment)


def _extract_text(name: str, content: bytes, max_bytes: int) -> str:
    ext = name[name.rfind("."):].lower()
    if ext == ".txt":
        return content.decode("utf-8", errors="replace")
    if ext == ".docx":
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                info = zf.getinfo("word/document.xml")
                if info.file_size > max_bytes * 10:  # guard against zip bombs
                    raise HTTPException(status_code=413, detail="Document content too large")
                xml = zf.read(info).decode("utf-8", errors="replace")
        except (zipfile.BadZipFile, KeyError) as exc:
            raise HTTPException(status_code=422, detail="Not a valid .docx file") from exc
        return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", xml)).strip()
    if not content.startswith(b"%PDF"):
        raise HTTPException(status_code=422, detail="Not a valid PDF file")
    # Best-effort literal-string extraction; enough for mock design ingestion without a PDF dependency.
    strings = re.findall(rb"\(([^()\\]{2,})\)", content)
    return " ".join(s.decode("latin-1", errors="replace") for s in strings)[:50_000]


@router.post("/{intake_id}/si-design-document", response_model=IntakeRead)
async def upload_si_design(intake_id: int, file: UploadFile = File(...), session: Session = Depends(get_session)) -> IntakeRead:
    intake = get_intake_or_404(session, intake_id)
    settings = get_settings()
    name = re.sub(r"[^A-Za-z0-9._-]", "_", (file.filename or "upload").split("/")[-1].split("\\")[-1])[:120]
    ext = name[name.rfind("."):].lower() if "." in name else ""
    if ext not in ALLOWED_UPLOADS:
        raise HTTPException(status_code=415, detail="Only .txt, .pdf and .docx files are accepted")
    if file.content_type and file.content_type not in ALLOWED_UPLOADS[ext]:
        raise HTTPException(status_code=415, detail=f"Unexpected content type {file.content_type} for {ext}")
    content = await file.read(settings.max_upload_bytes + 1)
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_bytes} bytes")
    if not content:
        raise HTTPException(status_code=422, detail="File is empty")
    text = _extract_text(name, content, settings.max_upload_bytes)
    try:
        evidence = extract_si_design(text, get_llm_client())
    except Exception as exc:  # noqa: BLE001
        logger.warning("SI design extraction failed for intake %s: %s", intake_id, exc)
        raise HTTPException(status_code=502, detail="Design extraction failed") from exc
    evidence["source_filename"] = name
    evidence["extracted_at"] = utcnow().isoformat()
    intake.si_design_evidence = json.dumps(evidence)
    intake.updated_at = utcnow()
    session.add(intake)
    session.add(FieldChangeLog(intake_id=intake_id, field="si_design_evidence", old_value=None, new_value=name, changed_by="upload"))
    session.commit()
    session.refresh(intake)
    return to_read(intake)


@router.get("/{intake_id}/review-answers", response_model=list[ReviewAnswerOut])
def list_review_answers(intake_id: int, session: Session = Depends(get_session)) -> list[AgentReviewAnswer]:
    get_intake_or_404(session, intake_id)
    return list(session.exec(select(AgentReviewAnswer).where(AgentReviewAnswer.intake_id == intake_id).order_by(col(AgentReviewAnswer.id))).all())


@router.post("/{intake_id}/review-answers", response_model=OrchestrationResult)
def submit_review_answers(intake_id: int, payload: ReviewAnswersIn, session: Session = Depends(get_session)) -> OrchestrationResult:
    intake = get_intake_or_404(session, intake_id)
    existing = session.exec(select(AgentReviewAnswer).where(AgentReviewAnswer.intake_id == intake_id)).all()
    by_key = {(a.agent_type, a.question.strip()): a for a in existing}
    for item in payload.answers:
        key = (item.agent_type, item.question.strip())
        row = by_key.get(key) or AgentReviewAnswer(intake_id=intake_id, agent_type=item.agent_type, question=item.question.strip(),
                                                    answer="", answered_by=item.answered_by)
        row.answer = item.answer.strip()
        row.answered_by = item.answered_by
        row.created_at = utcnow()
        session.add(row)
    session.commit()
    result = reconcile_and_persist(session, intake)
    if result is None:
        raise HTTPException(status_code=409, detail="Run orchestration before submitting review answers")
    return result
