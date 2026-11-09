import { apiBaseUrl } from "../runtimeEnv";
import type { IntakeQuery, OrchestrationResult, ProgressEvent } from "../types";
import { ApiError, type MeridianApi } from "./types";

function detailMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail.map((d) => (d && typeof d === "object" && "msg" in d ? `${(d.loc ?? []).slice(1).join(".")}: ${d.msg}` : String(d))).join("; ");
    }
  }
  return fallback;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = init.body instanceof FormData ? undefined : { "Content-Type": "application/json" };
  const resp = await fetch(`${apiBaseUrl()}/api${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const text = await resp.text();
  const body = text ? JSON.parse(text) : null;
  if (!resp.ok) throw new ApiError(resp.status, detailMessage(body, `${resp.status} ${resp.statusText}`));
  return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export const httpApi: MeridianApi = {
  mode: "live",
  createIntake: (data) => request("/intake", json("POST", data)),
  listIntakes: (q: IntakeQuery) => request(`/intake${qs({ ...q })}`),
  intakeSummary: (sponsorEmail) => request(`/intake/summary${qs({ sponsor_email: sponsorEmail })}`),
  getIntake: (id) => request(`/intake/${id}`),
  updateIntake: (id, patch) => request(`/intake/${id}`, json("PATCH", patch)),
  uploadDesignDocument: (id, file) => {
    const form = new FormData();
    form.append("file", file);
    return request(`/intake/${id}/si-design-document`, { method: "POST", body: form });
  },
  listReviewAnswers: (id) => request(`/intake/${id}/review-answers`),
  submitReviewAnswers: (id, answers) => request(`/intake/${id}/review-answers`, json("POST", { answers })),
  runOrchestration: (id) => request(`/orchestration/${id}/run`, json("POST")),
  runOrchestrationStream: (id, onEvent) =>
    new Promise<OrchestrationResult>((resolve, reject) => {
      const source = new EventSource(`${apiBaseUrl()}/api/orchestration/${id}/run-stream`);
      source.onmessage = (msg) => {
        const event = JSON.parse(msg.data) as ProgressEvent;
        onEvent(event);
        if (event.type === "result") {
          source.close();
          const { type: _type, ...result } = event;
          resolve(result as unknown as OrchestrationResult);
        } else if (event.type === "error") {
          source.close();
          reject(new ApiError(500, event.detail ?? "Orchestration failed"));
        }
      };
      source.onerror = () => {
        source.close();
        reject(new ApiError(0, "Lost connection to the orchestration stream"));
      };
    }),
  getResult: (id) => orNull(request(`/orchestration/${id}/result`)),
  cmdbLookup: (ciId) => orNull(request(`/cmdb/lookup${qs({ ci_id: ciId })}`)),
  cmdbRecords: () => request("/cmdb/records"),
  portfolioLookup: (id) => orNull(request(`/portfolio/lookup${qs({ id })}`)),
  coverage: (id) => request(`/coverage/${id}`),
  metrics: () => request("/metrics"),
  detect: (text) => request("/detect", json("POST", { text })),
  stageDeadlines: (id) => request(`/lifecycle/${id}/stage-deadlines`),
  updateStageDeadline: (id, stage, dueDate) => request(`/lifecycle/${id}/stage-deadlines/${encodeURIComponent(stage)}`, json("PATCH", { due_date: dueDate })),
  advanceStage: (id, comment, approvedBy) => request(`/lifecycle/${id}/advance-stage`, json("POST", { comment, approved_by: approvedBy })),
  history: (id) => request(`/lifecycle/${id}/history`),
  buildManifest: (id) => request(`/tracker/${id}/manifest`, json("POST")),
  createWorkItems: (id) => request(`/tracker/${id}/create`, json("POST")),
  workItemLinks: (id) => request(`/tracker/${id}/links`),
  updateWorkItemState: (externalId, state) => request(`/tracker/work-items/${encodeURIComponent(externalId)}/state`, json("PATCH", { state })),
  chat: (intakeId, message, history) => request("/chat", json("POST", { intake_id: intakeId, message, history })),
};
