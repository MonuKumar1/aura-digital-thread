from __future__ import annotations

import json

from fastapi.testclient import TestClient

from app.api.intake import router as intake_router
from tests.conftest import VALID_PAYLOAD


def test_summary_route_declared_before_id_route(client: TestClient) -> None:
    paths = [r.path for r in intake_router.routes]  # type: ignore[attr-defined]
    assert paths.index("/intake/summary") < paths.index("/intake/{intake_id}")
    resp = client.get("/api/intake/summary")
    assert resp.status_code == 200
    assert {"total", "by_status", "by_stage"} <= resp.json().keys()


def test_seeded_dashboard_profiles(client: TestClient) -> None:
    labels = {i["initiative_name"]: i["status_label"] for i in client.get("/api/intake?page_size=50").json()["items"]}
    assert labels["Mobile Onboarding Revamp"] == "Blocked"
    assert labels["Fraud Model Retraining"] == "At Risk"
    assert labels["Payments DR Failover Test"] == "Completed"
    metrics = client.get("/api/metrics").json()
    assert metrics["stp_eligible"] >= 1 and metrics["total_intakes"] >= 10


def test_create_validates_and_autofills(client: TestClient) -> None:
    bad = client.post("/api/intake", json={**VALID_PAYLOAD, "initiative_type": "NOPE"})
    assert bad.status_code == 422
    bad_email = client.post("/api/intake", json={**VALID_PAYLOAD, "sponsor_email": "not-an-email"})
    assert bad_email.status_code == 422
    resp = client.post("/api/intake", json=VALID_PAYLOAD)
    assert resp.status_code == 201
    body = resp.json()
    assert body["application_ci_id"] == "CI-1003" and body["sponsor_email"] == "tester@example.com"
    assert body["rto_hours"] == 48 and body["cmdb_snapshot"]["app_name"] == "HR Analytics"


def test_pagination_sort_filter(client: TestClient) -> None:
    page = client.get("/api/intake", params={"page": 1, "page_size": 3, "sort_by": "initiative_name", "sort_dir": "asc"}).json()
    names = [i["initiative_name"] for i in page["items"]]
    assert len(names) == 3 and names == sorted(names) and page["total"] >= 10
    assert client.get("/api/intake", params={"sort_by": "drop table"}).status_code == 422
    filtered = client.get("/api/intake", params={"q": "tokenisation"}).json()
    assert filtered["total"] == 1
    blocked = client.get("/api/intake", params={"status": "REJECTED"}).json()
    assert all(i["status"] == "REJECTED" for i in blocked["items"])


def test_full_review_and_lifecycle_flow(client: TestClient) -> None:
    intake_id = client.post("/api/intake", json={**VALID_PAYLOAD, "initiative_name": "Flow test", "user_growth_pct": 60}).json()["id"]
    result = client.post(f"/api/orchestration/{intake_id}/run").json()
    arch = next(r for r in result["agent_results"] if r["agent_type"] == "architecture")
    assert arch["status"] == "NEEDS_REVIEW" and arch["follow_up_questions"]

    denied = client.post(f"/api/lifecycle/{intake_id}/advance-stage", json={"comment": "ok", "approved_by": "me"})
    assert denied.status_code == 422

    pending = [(r["agent_type"], q) for r in result["agent_results"] if r["status"] in ("NEEDS_REVIEW", "FLAGGED") for q in r["follow_up_questions"]]
    answers = [{"agent_type": a, "question": q, "answer": "Evidence attached", "answered_by": "reviewer@example.com"} for a, q in pending]
    reconciled = client.post(f"/api/intake/{intake_id}/review-answers", json={"answers": answers}).json()
    assert all(r["status"] in ("AUTO_APPROVED", "REVIEWED", "SKIPPED") for r in reconciled["agent_results"])
    assert reconciled["straight_through_eligible"] is True

    no_comment = client.post(f"/api/lifecycle/{intake_id}/advance-stage", json={"comment": "  ", "approved_by": "me"})
    assert no_comment.status_code == 422
    adv = client.post(f"/api/lifecycle/{intake_id}/advance-stage", json={"comment": "Approved at CAB", "approved_by": "me"})
    assert adv.status_code == 200 and adv.json()["to_stage"] == "Assessment"
    assert client.get(f"/api/lifecycle/{intake_id}/history").json()["transitions"][0]["comment"] == "Approved at CAB"

    # Re-running deletes persisted review answers.
    client.post(f"/api/orchestration/{intake_id}/run")
    assert client.get(f"/api/intake/{intake_id}/review-answers").json() == []


def test_deadlines_tracker_chat_detect(client: TestClient) -> None:
    deadlines = client.get("/api/lifecycle/1/stage-deadlines").json()["deadlines"]
    assert [d["stage"] for d in deadlines] == ["Intake", "Assessment", "Approval", "Build", "Deploy", "Production"]
    upd = client.patch("/api/lifecycle/1/stage-deadlines/Build", json={"due_date": "2030-01-01"})
    assert upd.status_code == 200

    manifest = client.post("/api/tracker/1/manifest").json()
    assert manifest["epic"]["title"].startswith("[Aura]") and manifest["children"]
    links = client.post("/api/tracker/1/create").json()
    assert links[0]["kind"] == "epic"
    assert client.post("/api/tracker/1/create").json() == links  # idempotent
    state = client.patch(f"/api/tracker/work-items/{links[0]['external_id']}/state", json={"state": "Active"})
    assert state.json()["state"] == "Active"

    chat = client.post("/api/chat", json={"intake_id": 1, "message": "What security follow-up questions are pending?"}).json()
    tools = [t["tool"] for t in chat["tool_trace"]]
    assert "get_agent_result" in tools and "list_follow_ups" in tools and chat["answer"]

    detect = client.post("/api/detect", json={"text": "Launch an ML model that scores card payments for customers"}).json()
    assert detect["flags"]["handles_payment_data"] and detect["flags"]["ai_ml_component_present"]


def test_manifest_escapes_user_html(client: TestClient) -> None:
    payload = {**VALID_PAYLOAD, "initiative_name": "<script>alert(1)</script>", "description": "<img src=x onerror=alert(1)>"}
    intake_id = client.post("/api/intake", json=payload).json()["id"]
    client.post(f"/api/orchestration/{intake_id}/run")
    manifest = client.post(f"/api/tracker/{intake_id}/manifest").json()
    # Titles are plain text; only description_html is rendered as HTML.
    html = manifest["epic"]["description_html"] + "".join(c["description_html"] for c in manifest["children"])
    assert "<script>" not in html and "&lt;script&gt;" in html and "<img" not in html


def test_si_design_upload_and_compound_risk(client: TestClient) -> None:
    intake_id = client.post("/api/intake", json={**VALID_PAYLOAD, "initiative_name": "Upload test"}).json()["id"]
    rejected = client.post(f"/api/intake/{intake_id}/si-design-document", files={"file": ("x.exe", b"MZ", "application/octet-stream")})
    assert rejected.status_code == 415
    doc = b"Customer data is replicated to an overseas region via third-party vendor AnalyticsCloud Inc."
    ok = client.post(f"/api/intake/{intake_id}/si-design-document", files={"file": ("design.txt", doc, "text/plain")})
    assert ok.status_code == 200 and ok.json()["si_design_evidence"]["third_parties"] == ["AnalyticsCloud Inc"]
    result = client.post(f"/api/orchestration/{intake_id}/run").json()
    sec = next(r for r in result["agent_results"] if r["agent_type"] == "security")
    assert sec["derived_fields"]["compound_risks"] and sec["status"] == "NEEDS_REVIEW"


def test_sse_stream_emits_progress(client: TestClient) -> None:
    with client.stream("GET", "/api/orchestration/2/run-stream") as resp:
        events = [json.loads(line[6:]) for line in resp.iter_lines() if line.startswith("data: ")]
    types = [e["type"] for e in events]
    assert types[0] == "run_started" and types[-1] == "result"
    assert "agent_started" in types and "agent_skipped" in types and "synthesis_completed" in types


def test_unknown_provider_raises() -> None:
    import pytest

    from app.config import get_settings
    from app.mocks.provider import select_provider

    settings = get_settings()
    original = settings.cmdb_provider
    settings.cmdb_provider = "real"
    try:
        with pytest.raises(NotImplementedError):
            select_provider("cmdb", lambda: None)
    finally:
        settings.cmdb_provider = original
