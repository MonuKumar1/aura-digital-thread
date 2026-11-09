import { ApiError, type MeridianApi } from "../api/types";
import type {
  AgentStatus, CmdbRecord, DeadlinesResponse, FieldChange, Intake, IntakeListItem, IntakeQuery,
  LifecycleStage, OrchestrationResult, ProgressEvent, ReviewAnswer, Transition, WorkItemLink, WorkItemManifest,
} from "../types";
import { AGENT_LABELS, STAGES, STATUS_LABELS } from "../types";
import { canonicalEnums, canonicalFields, fixtures } from "./data";
import * as engine from "./engine";

const STORE_KEY = "meridian.mockdb.v1";
const AT_RISK_THRESHOLD_DAYS = 3;
const STEP_DELAY_MS = 280;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

interface Store {
  nextId: number;
  intakes: Intake[];
  results: Record<number, OrchestrationResult>;
  manifests: Record<number, WorkItemManifest>;
  answers: (ReviewAnswer & { intake_id: number })[];
  deadlines: Record<number, Record<string, string>>;
  transitions: (Transition & { intake_id: number })[];
  fieldChanges: (FieldChange & { intake_id: number })[];
  links: (WorkItemLink & { intake_id: number })[];
}

let memory: Store | null = null;

function save(store: Store): void {
  memory = store;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* quota or private mode: keep in memory only */
  }
}

function load(): Store {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return (memory = JSON.parse(raw) as Store);
  } catch {
    /* fall through to a fresh seed */
  }
  const store = seed();
  save(store);
  return store;
}

export function resetMockStore(): void {
  memory = null;
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

const now = () => new Date().toISOString();
const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

function blankIntake(): Record<string, unknown> {
  return Object.fromEntries(canonicalFields.map((f) => [f.id, f.type === "boolean" ? false : null]));
}

function validate(data: Record<string, unknown>): Record<string, unknown> {
  const errors: string[] = [];
  const name = String(data.initiative_name ?? "").trim();
  if (name.length < 3) errors.push("initiative_name: must be at least 3 characters");
  const email = String(data.sponsor_email ?? "").trim();
  if (!EMAIL_RE.test(email)) errors.push("sponsor_email: invalid email address");
  const lead = data.delivery_lead_email;
  if (lead && !EMAIL_RE.test(String(lead))) errors.push("delivery_lead_email: invalid email address");
  if (data.application_ci_id && !/^CI-\d{4}$/i.test(String(data.application_ci_id))) errors.push("application_ci_id: CI ID must look like CI-1234");
  for (const [field, allowed] of Object.entries(canonicalEnums)) {
    const v = data[field];
    if (v !== null && v !== undefined && v !== "" && !allowed.includes(String(v))) errors.push(`${field}: must be one of ${allowed.join(", ")}`);
  }
  if (!data.initiative_type) errors.push("initiative_type: is required");
  if (errors.length) throw new ApiError(422, errors.join("; "));
  return {
    ...data,
    initiative_name: name,
    sponsor_email: email.toLowerCase(),
    application_ci_id: data.application_ci_id ? String(data.application_ci_id).toUpperCase() : null,
  };
}

const CMDB_AUTOFILL: Record<string, keyof CmdbRecord> = {
  rto_hours: "rto_hours", rpo_hours: "rpo_hours", cloud_service_type: "cloud_service_type",
  target_environment: "target_environment", architecture_pattern: "architecture_pattern", business_unit: "domain",
};

function applySnapshot(intake: Intake): void {
  const record = engine.cmdbGet(intake.application_ci_id as string | null);
  intake.cmdb_snapshot = record ? { ...record } : null;
  if (!record) return;
  for (const [field, src] of Object.entries(CMDB_AUTOFILL)) {
    if (intake[field] === null || intake[field] === undefined || intake[field] === "") intake[field] = record[src] as string | number;
  }
  if (record.ibs) intake.important_business_service = true;
}

function ensureDeadlines(store: Store, intake: Intake): Record<string, string> {
  if (!store.deadlines[intake.id]) store.deadlines[intake.id] = engine.computeDeadlines(intake.created_at, (intake.target_go_live as string) ?? null);
  return store.deadlines[intake.id];
}

function refreshStatus(store: Store, intake: Intake): void {
  const result = store.results[intake.id];
  const deadlines = ensureDeadlines(store, intake);
  intake.status = engine.deriveStatus(intake.current_stage, result ? result.agent_results.map((r) => r.status) : null,
    deadlines[intake.current_stage] ?? null, engine.todayIso(), AT_RISK_THRESHOLD_DAYS);
  intake.status_label = STATUS_LABELS[intake.status];
  intake.overall_status = result?.overall_status ?? null;
  intake.straight_through_eligible = result?.straight_through_eligible ?? null;
}

function persistResult(store: Store, intake: Intake, result: OrchestrationResult, resetManifest = false): void {
  store.results[intake.id] = result;
  if (resetManifest) delete store.manifests[intake.id];
  intake.updated_at = now();
  refreshStatus(store, intake);
}

function runFor(store: Store, intake: Intake, onStep?: Parameters<typeof engine.orchestrate>[2]): OrchestrationResult {
  const result = engine.orchestrate(intake, true, onStep);
  store.answers = store.answers.filter((a) => a.intake_id !== intake.id); // re-run invalidates review answers
  persistResult(store, intake, result, true);
  return result;
}

function seed(): Store {
  const store: Store = { nextId: 1, intakes: [], results: {}, manifests: {}, answers: [], deadlines: {}, transitions: [], fieldChanges: [], links: [] };
  for (const raw of fixtures.sample_intakes) {
    const { created_days_ago, go_live_in_days, current_stage, ...fields } = raw as Record<string, string | number | boolean>;
    const created = new Date(Date.now() - Number(created_days_ago) * 86_400_000).toISOString();
    const data = validate({ ...blankIntake(), ...fields, target_go_live: engine.addDays(engine.todayIso(), Number(go_live_in_days)) });
    const intake = {
      ...data, id: store.nextId++, current_stage: current_stage as LifecycleStage, status: "SUBMITTED", status_label: "On Track",
      cmdb_snapshot: null, si_design_evidence: null, created_by: "seed@example.com", created_at: created, updated_at: created,
      overall_status: null, straight_through_eligible: null,
    } as unknown as Intake;
    applySnapshot(intake);
    store.intakes.push(intake);
    runFor(store, intake);
  }
  return store;
}

function find(store: Store, id: number): Intake {
  const intake = store.intakes.find((i) => i.id === id);
  if (!intake) throw new ApiError(404, `Intake ${id} not found`);
  return intake;
}

function reconciled(store: Store, intake: Intake): OrchestrationResult | null {
  const result = store.results[intake.id];
  if (!result) return null;
  const next = engine.reconcile(result, store.answers.filter((a) => a.intake_id === intake.id));
  if (JSON.stringify(next) !== JSON.stringify(result)) persistResult(store, intake, next);
  return next;
}

function toListItem(store: Store, i: Intake): IntakeListItem {
  return {
    id: i.id, initiative_name: i.initiative_name, initiative_type: i.initiative_type, application_ci_id: (i.application_ci_id as string) ?? null,
    sponsor_email: i.sponsor_email, target_go_live: (i.target_go_live as string) ?? null, current_stage: i.current_stage, status: i.status,
    status_label: STATUS_LABELS[i.status], overall_status: store.results[i.id]?.overall_status ?? null,
    straight_through_eligible: store.results[i.id]?.straight_through_eligible ?? null,
    current_stage_due: store.deadlines[i.id]?.[i.current_stage] ?? null, created_at: i.created_at,
  };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function deadlinesPayload(store: Store, intake: Intake): DeadlinesResponse {
  const d = ensureDeadlines(store, intake);
  return { current_stage: intake.current_stage, deadlines: STAGES.map((stage) => ({ stage, due_date: d[stage] })) };
}

async function readFileText(file: File): Promise<string> {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (ext === ".txt") return file.text();
  // .pdf / .docx: the mock only needs keywords, so read printable characters from the raw bytes.
  const bytes = new Uint8Array(await file.arrayBuffer());
  return Array.from(bytes, (c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : " ")).join("").replace(/\s+/g, " ");
}

export const mockApi: MeridianApi = {
  mode: "mock",

  async createIntake(data) {
    await delay();
    const store = load();
    const valid = validate({ ...blankIntake(), ...data });
    const intake = {
      ...valid, id: store.nextId++, current_stage: "Intake", status: "SUBMITTED", status_label: "On Track", cmdb_snapshot: null,
      si_design_evidence: null, created_by: (data.created_by as string) ?? null, created_at: now(), updated_at: now(),
      overall_status: null, straight_through_eligible: null,
    } as unknown as Intake;
    applySnapshot(intake);
    store.intakes.push(intake);
    refreshStatus(store, intake);
    save(store);
    return clone(intake);
  },

  async listIntakes(q: IntakeQuery) {
    await delay();
    const store = load();
    store.intakes.forEach((i) => refreshStatus(store, i));
    save(store);
    const like = (v: unknown, needle?: string) => !needle || String(v ?? "").toLowerCase().includes(needle.trim().toLowerCase());
    let rows = store.intakes.filter((i) =>
      (!q.status || i.status === q.status)
      && (!q.sponsor_email || i.sponsor_email === q.sponsor_email.trim().toLowerCase())
      && (!q.application_ci_id || i.application_ci_id === q.application_ci_id.trim().toUpperCase())
      && like(i.initiative_name, q.initiative_name)
      && (!q.q || [i.initiative_name, i.sponsor_email, i.application_ci_id, i.description].some((v) => like(v, q.q))));
    const dir = q.sort_dir === "asc" ? 1 : -1;
    rows = rows.sort((a, b) => {
      const av = String(a[q.sort_by] ?? ""), bv = String(b[q.sort_by] ?? "");
      return (q.sort_by === "id" ? (a.id - b.id) : av.localeCompare(bv)) * dir || b.id - a.id;
    });
    const start = (q.page - 1) * q.page_size;
    return { total: rows.length, items: rows.slice(start, start + q.page_size).map((i) => toListItem(store, i)) };
  },

  async intakeSummary(sponsorEmail) {
    await delay();
    const store = load();
    store.intakes.forEach((i) => refreshStatus(store, i));
    const rows = store.intakes.filter((i) => !sponsorEmail || i.sponsor_email === sponsorEmail.toLowerCase());
    const count = <K extends string>(keys: readonly K[], pick: (i: Intake) => string) =>
      Object.fromEntries(keys.map((k) => [k, rows.filter((i) => pick(i) === k).length])) as Record<K, number>;
    const byType: Record<string, number> = {};
    rows.forEach((i) => (byType[i.initiative_type] = (byType[i.initiative_type] ?? 0) + 1));
    return {
      total: rows.length,
      by_status: count(Object.keys(STATUS_LABELS) as (keyof typeof STATUS_LABELS)[], (i) => i.status),
      status_labels: STATUS_LABELS,
      by_stage: count(STAGES, (i) => i.current_stage),
      by_type: byType,
      stp_eligible: rows.filter((i) => store.results[i.id]?.straight_through_eligible).length,
      assessed: rows.filter((i) => store.results[i.id]).length,
    };
  },

  async getIntake(id) {
    await delay(60);
    const store = load();
    const intake = find(store, id);
    refreshStatus(store, intake);
    return clone(intake);
  },

  async updateIntake(id, patch) {
    await delay();
    const store = load();
    const intake = find(store, id);
    const { changed_by, ...changes } = patch;
    const merged = validate({ ...intake, ...changes });
    for (const field of Object.keys(changes)) {
      if (intake[field] !== merged[field]) {
        store.fieldChanges.push({ intake_id: id, field, old_value: intake[field] == null ? null : String(intake[field]),
          new_value: merged[field] == null ? null : String(merged[field]), changed_by: changed_by ?? "system", created_at: now() });
        intake[field] = merged[field] as Intake[string];
      }
    }
    if ("application_ci_id" in changes) applySnapshot(intake);
    intake.updated_at = now();
    refreshStatus(store, intake);
    save(store);
    return clone(intake);
  },

  async uploadDesignDocument(id, file) {
    await delay(300);
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (![".txt", ".pdf", ".docx"].includes(ext)) throw new ApiError(415, "Only .txt, .pdf and .docx files are accepted");
    if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, `File exceeds ${MAX_UPLOAD_BYTES} bytes`);
    if (!file.size) throw new ApiError(422, "File is empty");
    const store = load();
    const intake = find(store, id);
    const name = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
    intake.si_design_evidence = { ...engine.extractSiDesign(await readFileText(file)), source_filename: name, extracted_at: now() };
    store.fieldChanges.push({ intake_id: id, field: "si_design_evidence", old_value: null, new_value: name, changed_by: "upload", created_at: now() });
    save(store);
    return clone(intake);
  },

  async listReviewAnswers(id) {
    await delay(60);
    return clone(load().answers.filter((a) => a.intake_id === id));
  },

  async submitReviewAnswers(id, answers) {
    await delay();
    const store = load();
    const intake = find(store, id);
    if (!store.results[id]) throw new ApiError(409, "Run orchestration before submitting review answers");
    for (const a of answers) {
      if (!a.answer.trim()) continue;
      const existing = store.answers.find((x) => x.intake_id === id && x.agent_type === a.agent_type && x.question.trim() === a.question.trim());
      if (existing) Object.assign(existing, { answer: a.answer.trim(), answered_by: a.answered_by, created_at: now() });
      else store.answers.push({ ...a, intake_id: id, question: a.question.trim(), answer: a.answer.trim(), created_at: now(), id: store.answers.length + 1 });
    }
    const result = reconciled(store, intake)!;
    save(store);
    return clone(result);
  },

  async runOrchestration(id) {
    await delay(400);
    const store = load();
    const result = runFor(store, find(store, id));
    save(store);
    return clone(result);
  },

  async runOrchestrationStream(id, onEvent) {
    const store = load();
    const intake = find(store, id);
    const events: ProgressEvent[] = [{ type: "run_started", intake_id: id }];
    const result = runFor(store, intake, (event, agent, status) => {
      events.push({ type: event as ProgressEvent["type"], ...(agent ? { agent_type: agent, label: AGENT_LABELS[agent] } : {}), ...(status ? { status } : {}) });
    });
    events.push({ type: "synthesis_completed", notes: result.notes });
    save(store);
    for (const e of events) {
      onEvent(e);
      if (e.type !== "agent_started" && e.type !== "run_started") await delay(STEP_DELAY_MS);
    }
    onEvent({ type: "result", ...(clone(result) as unknown as Record<string, unknown>) });
    return clone(result);
  },

  async getResult(id) {
    await delay(60);
    const store = load();
    const result = reconciled(store, find(store, id));
    save(store);
    return result ? clone(result) : null;
  },

  async cmdbLookup(ciId) {
    await delay(150);
    return engine.cmdbGet(ciId);
  },
  async cmdbRecords() {
    return clone(fixtures.cmdb);
  },
  async portfolioLookup(id) {
    await delay(100);
    return engine.portfolioGet(id);
  },

  async coverage(id) {
    const store = load();
    const intake = find(store, id);
    return engine.coverage(intake, store.results[id]?.agent_results ?? null);
  },

  async metrics() {
    await delay();
    const store = load();
    store.intakes.forEach((i) => refreshStatus(store, i));
    const results = Object.values(store.results);
    const assessed = results.length;
    const stp = results.filter((r) => r.straight_through_eligible).length;
    const replaced = results.reduce((a, r) => a + r.questions_replaced_count, 0);
    const statuses: AgentStatus[] = ["PENDING", "AUTO_APPROVED", "NEEDS_REVIEW", "REVIEWED", "FLAGGED", "FAILED", "SKIPPED"];
    const byOverall: Partial<Record<AgentStatus, number>> = {};
    results.forEach((r) => (byOverall[r.overall_status] = (byOverall[r.overall_status] ?? 0) + 1));
    const dist = Object.fromEntries(Object.keys(AGENT_LABELS).map((agent) => [agent, Object.fromEntries(statuses.map((s) =>
      [s, results.filter((r) => r.agent_results.some((e) => e.agent_type === agent && e.status === s)).length]))]));
    return {
      total_intakes: store.intakes.length, assessed_intakes: assessed,
      by_stage: Object.fromEntries(STAGES.map((s) => [s, store.intakes.filter((i) => i.current_stage === s).length])) as Record<LifecycleStage, number>,
      by_status: Object.fromEntries(Object.keys(STATUS_LABELS).map((s) => [s, store.intakes.filter((i) => i.status === s).length])) as Record<keyof typeof STATUS_LABELS, number>,
      by_overall_status: byOverall, stp_eligible: stp, stp_pct: assessed ? Math.round((1000 * stp) / assessed) / 10 : 0,
      avg_coverage_pct: assessed ? Math.round((10 * results.reduce((a, r) => a + r.coverage_pct, 0)) / assessed) / 10 : 0,
      questions_replaced_total: replaced, questions_master_total: 120, estimated_hours_saved: Math.round((replaced * 4 * 10) / 60) / 10,
      agent_status_distribution: dist as never,
      open_reviews: results.reduce((a, r) => a + r.agent_results.filter((e) => e.status === "NEEDS_REVIEW" || e.status === "FLAGGED").length, 0),
    };
  },

  async detect(text) {
    await delay(200);
    return engine.detect(text);
  },

  async stageDeadlines(id) {
    const store = load();
    const payload = deadlinesPayload(store, find(store, id));
    save(store);
    return payload;
  },

  async updateStageDeadline(id, stage, dueDate) {
    await delay();
    const store = load();
    const intake = find(store, id);
    const d = ensureDeadlines(store, intake);
    store.fieldChanges.push({ intake_id: id, field: `deadline:${stage}`, old_value: d[stage], new_value: dueDate, changed_by: "user", created_at: now() });
    d[stage] = dueDate;
    refreshStatus(store, intake);
    save(store);
    return deadlinesPayload(store, intake);
  },

  async advanceStage(id, comment, approvedBy) {
    await delay();
    const store = load();
    const intake = find(store, id);
    if (!comment.trim()) throw new ApiError(422, "An approval comment is required to advance the stage");
    if (intake.current_stage === "Production") throw new ApiError(422, "Initiative is already in Production");
    const result = reconciled(store, intake);
    if (!result) throw new ApiError(422, "Run orchestration before advancing the stage");
    const blocking = result.agent_results.filter((r) => r.status !== "SKIPPED" && r.status !== "AUTO_APPROVED" && r.status !== "REVIEWED");
    if (blocking.length) throw new ApiError(422, `Unresolved agents must be approved or reviewed first: ${blocking.map((r) => AGENT_LABELS[r.agent_type]).join(", ")}`);
    const from = intake.current_stage;
    const to = STAGES[STAGES.indexOf(from) + 1];
    intake.current_stage = to;
    store.transitions.push({ intake_id: id, from_stage: from, to_stage: to, comment: comment.trim(), approved_by: approvedBy, created_at: now() });
    refreshStatus(store, intake);
    save(store);
    return { intake_id: id, from_stage: from, to_stage: to, status: intake.status, status_label: STATUS_LABELS[intake.status] };
  },

  async history(id) {
    const store = load();
    find(store, id);
    const byDate = <T extends { created_at: string }>(a: T, b: T) => b.created_at.localeCompare(a.created_at);
    return {
      transitions: store.transitions.filter((t) => t.intake_id === id).sort(byDate),
      field_changes: store.fieldChanges.filter((c) => c.intake_id === id).sort(byDate).slice(0, 100),
    };
  },

  async buildManifest(id) {
    await delay();
    const store = load();
    const intake = find(store, id);
    const result = reconciled(store, intake);
    if (!result) throw new ApiError(409, "Run orchestration before building a work-item manifest");
    store.manifests[id] = engine.buildManifest(intake, result);
    save(store);
    return clone(store.manifests[id]);
  },

  async createWorkItems(id) {
    await delay(400);
    const store = load();
    const intake = find(store, id);
    const existing = store.links.filter((l) => l.intake_id === id);
    if (existing.some((l) => l.kind === "epic")) return clone(existing);
    const result = reconciled(store, intake);
    if (!result) throw new ApiError(409, "Run orchestration before building a work-item manifest");
    const manifest = store.manifests[id] ?? (store.manifests[id] = engine.buildManifest(intake, result));
    const url = (x: string) => `https://tracker.example.com/items/${x}`;
    const epicId = engine.randomId("EP");
    store.links.push({ intake_id: id, kind: "epic", external_id: epicId, parent_external_id: null, title: manifest.epic.title, url: url(epicId), state: "New" });
    for (const feature of manifest.children) {
      const fid = engine.randomId("FE");
      store.links.push({ intake_id: id, kind: "feature", external_id: fid, parent_external_id: epicId, title: feature.title, url: url(fid), state: "New" });
      for (const task of feature.children ?? []) {
        const tid = engine.randomId("TK");
        store.links.push({ intake_id: id, kind: "task", external_id: tid, parent_external_id: fid, title: task.title.slice(0, 300), url: url(tid), state: "New" });
      }
    }
    save(store);
    return clone(store.links.filter((l) => l.intake_id === id));
  },

  async workItemLinks(id) {
    return clone(load().links.filter((l) => l.intake_id === id));
  },

  async updateWorkItemState(externalId, state) {
    await delay();
    const store = load();
    const link = store.links.find((l) => l.external_id === externalId);
    if (!link) throw new ApiError(404, `Work item ${externalId} not found`);
    link.state = state;
    save(store);
    return clone(link);
  },

  async chat(intakeId, message) {
    await delay(500);
    const store = load();
    const intake = find(store, intakeId);
    const result = reconciled(store, intake);
    const answers = store.answers.filter((a) => a.intake_id === intakeId);
    const out = engine.runChat(message, (tool, args) => {
      switch (tool) {
        case "get_agent_result": {
          if (!result) return { error: "Orchestration has not been run for this initiative yet." };
          const ev = result.agent_results.find((r) => r.agent_type === args.agent_type);
          return ev ? { agent_label: AGENT_LABELS[ev.agent_type], ...ev } : { error: `No result for agent '${args.agent_type}'.` };
        }
        case "list_follow_ups": {
          if (!result) return { error: "Orchestration has not been run for this initiative yet." };
          const done = new Set(answers.map((a) => `${a.agent_type}|${a.question.trim()}`));
          return { answered: done.size, open: result.agent_results.filter((r) => r.status === "NEEDS_REVIEW" || r.status === "FLAGGED")
            .flatMap((r) => r.follow_up_questions.filter((q) => !done.has(`${r.agent_type}|${q.trim()}`)).map((q) => ({ agent_type: r.agent_type, question: q }))) };
        }
        case "get_cmdb_record":
          return { record: engine.cmdbForIntake(intake) };
        case "get_coverage":
          return engine.coverage(intake, result?.agent_results ?? null) as unknown as Record<string, unknown>;
        case "explain_status": {
          const reasons: string[] = [];
          if (!result) reasons.push("No assessment has been run yet.");
          else {
            const open = result.agent_results.filter((r) => ["NEEDS_REVIEW", "FLAGGED", "FAILED"].includes(r.status)).map((r) => AGENT_LABELS[r.agent_type]);
            if (open.length) reasons.push(`Open reviews: ${open.join(", ")}.`);
            reasons.push(result.straight_through_eligible ? "Eligible for straight-through processing." : "Not eligible for straight-through processing.");
          }
          const due = ensureDeadlines(store, intake)[intake.current_stage];
          if (due) reasons.push(`Current stage ${intake.current_stage} is due ${due}.`);
          return { status: intake.status, status_label: STATUS_LABELS[intake.status], current_stage: intake.current_stage,
            overall_agent_status: result?.overall_status ?? null, reasons };
        }
        case "get_stage_deadlines":
          return deadlinesPayload(store, intake) as unknown as Record<string, unknown>;
        default:
          return { error: `unknown tool ${tool}` };
      }
    });
    save(store);
    return out;
  },
};

