import type { AgentStatus, InitiativeStatus } from "../types";
import { STATUS_LABELS } from "../types";

const INITIATIVE_TONE: Record<InitiativeStatus, string> = {
  SUBMITTED: "badge-ok",
  ORCHESTRATING: "badge-warn",
  AWAITING_HUMAN_INPUT: "badge-info",
  REJECTED: "badge-bad",
  COMPLETED: "badge-accent",
};

const AGENT_TONE: Record<AgentStatus, string> = {
  PENDING: "badge-neutral",
  AUTO_APPROVED: "badge-ok",
  REVIEWED: "badge-ok",
  NEEDS_REVIEW: "badge-warn",
  FLAGGED: "badge-bad",
  FAILED: "badge-bad",
  SKIPPED: "badge-neutral",
};

/** Semantic tone ("ok" | "warn" | "bad" | "neutral") used for status dots and bar segments. */
export function agentTone(status: AgentStatus): string {
  return AGENT_TONE[status].replace("badge-", "");
}

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  PENDING: "Pending",
  AUTO_APPROVED: "Auto-approved",
  REVIEWED: "Reviewed",
  NEEDS_REVIEW: "Needs review",
  FLAGGED: "Flagged",
  FAILED: "Failed",
  SKIPPED: "Not applicable",
};

export function InitiativeBadge({ status }: { status: InitiativeStatus }) {
  return <span className={`badge ${INITIATIVE_TONE[status]}`}>{STATUS_LABELS[status]}</span>;
}

export function AgentBadge({ status }: { status: AgentStatus }) {
  return <span className={`badge ${AGENT_TONE[status]}`}>{AGENT_STATUS_LABEL[status]}</span>;
}

export function StpBadge({ eligible }: { eligible: boolean | null | undefined }) {
  if (eligible === null || eligible === undefined) return <span className="badge badge-neutral">Not assessed</span>;
  return eligible ? <span className="badge badge-ok">STP eligible</span> : <span className="badge badge-neutral">Manual path</span>;
}
