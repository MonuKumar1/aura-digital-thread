# Meridian

Meridian is an agentic SDLC governance orchestrator. It replaces about **120 governance questions spread across 11 separate systems** with **one smart intake form** and **8 specialist AI agents** wired together in a LangGraph `StateGraph`.

A delivery engineer submits an intake. Meridian then:

1. derives which assessments apply,
2. runs only the relevant agents,
3. returns a structured evidence package, including whether the change qualifies for **Straight-Through Processing (STP)**.

Meridian also handles reviewer answers, cached results, mock work-item creation, a lifecycle with approval gates, and an agentic chat called "Ask Meridian".

Every external integration is mocked. The app runs with **no credentials and no network access**.

```mermaid
flowchart LR
    UI[meridian-ui<br/>React + Vite] -- REST / SSE --> API[FastAPI /api]
    UI -. "Mock data" switch .-> MOCK[(In-browser mock API<br/>same fixtures + rules)]
    API --> ORCH[Orchestrator<br/>gate rules + LangGraph]
    ORCH --> AGENTS[8 agents<br/>rules → 1 LLM rephrase]
    AGENTS --> SYS[Mock clients:<br/>Portfolio · CMDB · ITSM risk ·<br/>Security Portal · DRA ·<br/>Architecture Portal · Work Tracker]
    AGENTS --> LLM[LlmClient<br/>mock | openai-compatible]
    ORCH --> SYN[Cross-agent synthesis]
    API --> DB[(SQLite via SQLModel)]
    DATA[/data/*.json/] --> API
    DATA --> MOCK
```

See [docs/architecture.md](docs/architecture.md) for the graph, the sequence and the data model.

## Repository layout

```
meridian/
  meridian-agent/   Python 3.11 · FastAPI · LangGraph · SQLModel (SQLite default) · pytest
  meridian-ui/      React 18 · TypeScript · Vite · react-router (hand-written CSS)
  data/             canonical_fields.json (60) · questions_master.json (120) ·
                    question_coverage_map.json · mock_fixtures.json (CMDB, portfolio, samples…)
  scripts/          generate_data.py: regenerates everything in data/ deterministically
  docs/             architecture with mermaid diagrams
  docker-compose.yml, .env.example
```

`data/` is the **single source of truth**. The backend loads it at runtime, and the UI imports the same files through the `@data` alias. The mock and live modes therefore show identical fixtures and produce identical agent outcomes.

## Run locally

Requirements: Python 3.11+, Node 18+.

```bash
# Backend: http://localhost:8000 (OpenAPI docs at /docs)
cd meridian-agent
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

```bash
# Frontend: http://localhost:5173
cd meridian-ui
npm i && npm run dev
```

- On first start the backend creates `meridian.db` and seeds 10 sample intakes, including one STP-eligible, one Blocked, one At Risk and one Completed. It then runs orchestration on each so the dashboard has data immediately.
- The UI starts in **Mock data** mode, an in-browser API with no backend needed. Use the switch at the bottom of the sidebar to move to **Live data**, which reaches the backend through Vite's `/api` proxy. In mock mode, **Reset** restores the seed data.
- Login is mock SSO: any name and email work.

### Troubleshooting

- **`uvicorn: command not found`, or `pip: bad interpreter ... no such file or directory`**: the virtualenv was created at a different path, for example before the project folder was moved or renamed. A `.venv` hard-codes its original location and cannot be relocated. Leave the old environment and rebuild it:

  ```bash
  deactivate                      # leave the stale venv if it is still active
  cd meridian-agent
  rm -rf .venv
  python3.11 -m venv .venv && source .venv/bin/activate
  pip install -r requirements.txt
  uvicorn app.main:app --reload
  ```

  Running `python3.11 -m venv .venv && source .venv/bin/activate` without removing the old `.venv` first does not help, because the broken one stays in place.

## Run with Docker

```bash
docker compose up --build
# UI  http://localhost:8080   (nginx serves the SPA and proxies /api, SSE-safe)
# API http://localhost:8000
```

The UI image writes `env-config.js` at container start from `API_BASE_URL` and `USE_MOCK`, so one image works in any environment. SQLite lives in the `meridian-state` volume.

## Tests and checks

```bash
cd meridian-agent && .venv/bin/python -m pytest      # 21 tests
cd meridian-ui && npm run typecheck && npm run build
```

The tests cover:

- gate rules
- STP logic and overall-status priority
- initiative-status derivation precedence
- review reconciliation
- `/intake/summary` route ordering
- validation, pagination, sorting and filtering
- the full review → approval-gate → advance flow, including re-run clearing answers
- tracker idempotency
- HTML escaping in manifests
- design-document upload and the compound-risk check
- SSE event sequence
- the provider factory raising `NotImplementedError`

## Environment variables

Backend settings use the `MERIDIAN_` prefix. They are read from the environment, or from `meridian-agent/.env` (copy it from [.env.example](.env.example)).

| Variable | Default | Purpose |
|---|---|---|
| `MERIDIAN_DATABASE_URL` | `sqlite:///./meridian.db` | SQLModel database URL |
| `MERIDIAN_DATA_DIR` | `<repo>/data` | Location of the shared JSON data |
| `MERIDIAN_SEED_SAMPLE_DATA` | `true` | Seed the 10 sample intakes into an empty DB |
| `MERIDIAN_CORS_ORIGINS` | `http://localhost:5173,…:8080` | Comma-separated allowed UI origins |
| `MERIDIAN_LLM_PROVIDER` | `mock` | `mock` (deterministic, offline) or `openai-compatible` |
| `MERIDIAN_LLM_BASE_URL` | `http://localhost:11434/v1` | Base URL for the OpenAI-compatible endpoint |
| `MERIDIAN_LLM_API_KEY` | *(empty)* | Bearer key for that endpoint (never hard-coded) |
| `MERIDIAN_LLM_MODEL` | `gpt-4o-mini` | Model name sent to the endpoint |
| `MERIDIAN_LLM_TIMEOUT_SECONDS` | `30` | Per-request timeout (3 attempts, 2s/4s backoff) |
| `MERIDIAN_LLM_LOG_FULL_IO` | `false` | Log full prompts and responses (otherwise sizes only, at DEBUG) |
| `MERIDIAN_TRACKER_ENABLED` | `true` | Release agent auto-creates a mock tracker task for STP changes |
| `MERIDIAN_AT_RISK_THRESHOLD_DAYS` | `3` | Days before a stage deadline at which an initiative turns "At Risk" |
| `MERIDIAN_MAX_UPLOAD_BYTES` | `2097152` | Design-document size limit |
| `MERIDIAN_STREAM_STEP_DELAY_MS` | `250` | Pacing between SSE events so the graph animation is visible |
| `MERIDIAN_LOG_LEVEL` | `INFO` | Python log level |
| `MERIDIAN_<SYSTEM>_PROVIDER` | `mock` | One per system: `PORTFOLIO`, `CMDB`, `ITSM_RISK`, `SECPORTAL`, `DRA`, `ARCHPORTAL`, `TRACKER`. Any non-`mock` value raises `NotImplementedError` |

The frontend reads its settings at runtime from `public/env-config.js` (`window.__ENV__`), with build-time variables as fallback.

| Variable | Default | Purpose |
|---|---|---|
| `USE_MOCK` (container) / `VITE_USE_MOCK` (dev) | mock | Start in mock or live mode. The sidebar switch overrides it per browser |
| `API_BASE_URL` (container) / `VITE_API_BASE_URL` (dev) | *(same origin)* | Backend origin, if it isn't proxied under `/api` |
| `VITE_PROXY_TARGET` | `http://localhost:8000` | Dev-server proxy target for `/api` |

## Mocked systems

Each system has a `Protocol` interface, a deterministic `Mock*Client` and a factory that reads `MERIDIAN_<SYSTEM>_PROVIDER`.

| System | Package | Mock behaviour |
|---|---|---|
| Portfolio System | `app/portfolio` | 8 investments (PF-2001…2008) linked to CIs, with known vendors and regulatory flags |
| ITSM & CMDB | `app/cmdb`, `app/itsm_risk` | 8 CIs (CI-1001…1008): owner, domain, IBS flag, RTO/RPO, cloud model, `*.example.com` URLs, RFC 5737 IPs, risk band. The change-risk score adjusts for outage, customer impact and automation |
| Security Assessment Portal | `app/secportal` | `submit_assessment()` returns an assessment ID, required controls (from 7 triggers) and ticket refs |
| Data Risk Assessment Portal | `app/dra` | Prefills 7 DRA answers and a residual-risk rating |
| Architecture Portal | `app/archportal` | Capability impact report per CI |
| Work Tracker | `app/tracker` | In-memory epics, features and tasks; state updates |
| Wiki | static link | Design template link in `mock_fixtures.json` |

## API (all under `/api`)

| Area | Endpoints |
|---|---|
| Intake | `POST /intake` · `GET /intake?page&page_size&sort_by&sort_dir&status&sponsor_email&q&application_ci_id&initiative_name` · `GET /intake/summary` · `GET/PATCH /intake/{id}` · `POST /intake/{id}/si-design-document` · `GET/POST /intake/{id}/review-answers` |
| Orchestration | `POST /orchestration/{id}/run` · `GET /orchestration/{id}/run-stream` (SSE) · `GET /orchestration/{id}/result` |
| Lookups | `GET /cmdb/lookup?ci_id=` · `GET /cmdb/records` · `GET /portfolio/lookup?id=` |
| Insight | `GET /coverage/{id}` · `GET /metrics` · `POST /detect` |
| Lifecycle | `GET /lifecycle/{id}/stage-deadlines` · `PATCH /lifecycle/{id}/stage-deadlines/{stage}` · `POST /lifecycle/{id}/advance-stage` · `GET /lifecycle/{id}/history` |
| Tracker | `POST /tracker/{id}/manifest` · `POST /tracker/{id}/create` · `GET /tracker/{id}/links` · `PATCH /tracker/work-items/{ext_id}/state` |
| Chat | `POST /chat` returns `{answer, tool_trace}` |
| Meta | `GET /health` · `GET /config` |

## Editing the canonical data

Edit [scripts/generate_data.py](scripts/generate_data.py), then run `python3 scripts/generate_data.py`. Both the backend and the UI pick up the change. Business rules are implemented twice: in Python (`meridian-agent/app/agents`, `orchestrator`) and in TypeScript for the offline mock (`meridian-ui/src/mocks/engine.ts`). Change them together.
