// Mirrors meridian-agent/app/models (enums.py, schemas.py, tables.py).

export type LifecycleStage = "Intake" | "Assessment" | "Approval" | "Build" | "Deploy" | "Production";
export const STAGES: LifecycleStage[] = ["Intake", "Assessment", "Approval", "Build", "Deploy", "Production"];

export type AgentStatus = "PENDING" | "AUTO_APPROVED" | "NEEDS_REVIEW" | "REVIEWED" | "FLAGGED" | "FAILED" | "SKIPPED";
export type InitiativeStatus = "SUBMITTED" | "ORCHESTRATING" | "AWAITING_HUMAN_INPUT" | "REJECTED" | "COMPLETED";
export const STATUS_LABELS: Record<InitiativeStatus, string> = {
  SUBMITTED: "On Track",
  ORCHESTRATING: "At Risk",
  AWAITING_HUMAN_INPUT: "Awaiting Input",
  REJECTED: "Blocked",
  COMPLETED: "Completed",
};

export type AgentType = "clarity" | "scoping" | "security" | "privacy" | "ai_ethics" | "architecture" | "resilience" | "release";
export const AGENT_ORDER: AgentType[] = ["clarity", "scoping", "security", "privacy", "ai_ethics", "architecture", "resilience", "release"];
export const AGENT_LABELS: Record<AgentType, string> = {
  clarity: "Portfolio Impact",
  scoping: "Scoping",
  security: "Security",
  privacy: "Privacy",
  ai_ethics: "AI Ethics",
  architecture: "Architecture",
  resilience: "Resilience",
  release: "Change & Release",
};

export type InitiativeType = "NEW_SERVICE" | "TECH_CHANGE" | "AI_INITIATIVE" | "CLOUD" | "REGULATORY";

export type FieldValue = string | number | boolean | null;

/** The 60 canonical intake fields; keys match canonical_fields.json. */
export interface IntakeFields {
  initiative_name: string;
  initiative_type: InitiativeType;
  sponsor_email: string;
  description?: string | null;
  application_ci_id?: string | null;
  target_go_live?: string | null;
  [field: string]: unknown;
}

export interface Intake extends IntakeFields {
  id: number;
  current_stage: LifecycleStage;
  status: InitiativeStatus;
  status_label: string;
  cmdb_snapshot: CmdbRecord | null;
  si_design_evidence: SiDesignEvidence | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  overall_status: AgentStatus | null;
  straight_through_eligible: boolean | null;
}

export interface IntakeListItem {
  id: number;
  initiative_name: string;
  initiative_type: InitiativeType;
  application_ci_id: string | null;
  sponsor_email: string;
  target_go_live: string | null;
  current_stage: LifecycleStage;
  status: InitiativeStatus;
  status_label: string;
  overall_status: AgentStatus | null;
  straight_through_eligible: boolean | null;
  current_stage_due: string | null;
  created_at: string;
}

export interface IntakePage {
  items: IntakeListItem[];
  total: number;
}

export interface IntakeQuery {
  page: number;
  page_size: number;
  sort_by: string;
  sort_dir: "asc" | "desc";
  status?: InitiativeStatus | "";
  sponsor_email?: string;
  q?: string;
  application_ci_id?: string;
  initiative_name?: string;
}

export interface IntakeSummary {
  total: number;
  by_status: Record<InitiativeStatus, number>;
  status_labels: Record<InitiativeStatus, string>;
  by_stage: Record<LifecycleStage, number>;
  by_type: Record<string, number>;
  stp_eligible: number;
  assessed: number;
}

export interface ControlRef {
  control: string;
  control_description: string;
  control_source_document: string;
  system: string;
}

export interface Activity {
  title: string;
  description: string;
  control_ref: string | null;
  source_ticket: string | null;
}

export interface AgentEvidence {
  agent_type: AgentType;
  status: AgentStatus;
  derived_fields: Record<string, unknown>;
  confidence: number;
  rationale: string;
  control_refs: ControlRef[];
  follow_up_questions: string[];
  activities: Activity[];
  source_systems_consulted: string[];
  review_system: string;
  not_applicable: boolean;
}

export interface OrchestrationResult {
  intake_id: number;
  agent_results: AgentEvidence[];
  overall_status: AgentStatus;
  straight_through_eligible: boolean;
  questions_raw_count: number;
  questions_replaced_count: number;
  systems_replaced_count: number;
  notes: string[];
  work_item_id: string | null;
  work_item_url: string | null;
  coverage_pct: number;
  generated_at: string | null;
}

export type ProgressEventType =
  | "run_started"
  | "agent_started"
  | "agent_completed"
  | "agent_skipped"
  | "synthesis_started"
  | "synthesis_completed"
  | "result"
  | "error";

export interface ProgressEvent {
  type: ProgressEventType;
  agent_type?: AgentType;
  status?: AgentStatus;
  notes?: string[];
  detail?: string;
  [key: string]: unknown;
}

export interface CoverageReport {
  total_questions: number;
  answered_questions: number;
  coverage_pct: number;
  systems_total: number;
  systems_replaced: number;
  per_agent: { agent_type: AgentType; total: number; answered: number; pct: number; ran: boolean }[];
  per_system: { system: string; total: number; answered: number }[];
}

export interface Metrics {
  total_intakes: number;
  assessed_intakes: number;
  by_stage: Record<LifecycleStage, number>;
  by_status: Record<InitiativeStatus, number>;
  by_overall_status: Partial<Record<AgentStatus, number>>;
  stp_eligible: number;
  stp_pct: number;
  avg_coverage_pct: number;
  questions_replaced_total: number;
  questions_master_total: number;
  estimated_hours_saved: number;
  agent_status_distribution: Record<AgentType, Record<AgentStatus, number>>;
  open_reviews: number;
}

export interface CmdbRecord {
  ci_id: string;
  app_name: string;
  owner: string;
  domain: string;
  sub_domain: string;
  ibs: boolean;
  rto_hours: number;
  rpo_hours: number;
  cloud_service_type: string;
  target_environment: string;
  architecture_pattern: string;
  entry_point_url: string;
  ip: string;
  risk_band: string;
  support_group: string;
}

export interface PortfolioRecord {
  portfolio_id: string;
  ci_id: string;
  investment_name: string;
  investment_stage: string;
  funding_approved: boolean;
  business_owner: string;
  budget_band: string;
  known_vendors: string[];
  regulatory_notification_required: boolean;
}

export interface SiDesignEvidence {
  architecture: { pattern?: string; components?: string[]; hosting?: string };
  data_flows: { name: string; source: string; destination: string; classification: string; cross_border: boolean }[];
  third_parties: string[];
  controls: string[];
  summary?: string;
  source_filename?: string;
  extracted_at?: string;
}

export interface ReviewAnswer {
  id?: number;
  agent_type: AgentType;
  question: string;
  answer: string;
  answered_by: string;
  created_at?: string;
}

export interface StageDeadline {
  stage: LifecycleStage;
  due_date: string;
}

export interface DeadlinesResponse {
  current_stage: LifecycleStage;
  deadlines: StageDeadline[];
}

export interface Transition {
  from_stage: LifecycleStage;
  to_stage: LifecycleStage;
  comment: string;
  approved_by: string;
  created_at: string;
}

export interface FieldChange {
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string;
  created_at: string;
}

export interface HistoryResponse {
  transitions: Transition[];
  field_changes: FieldChange[];
}

export interface AdvanceResponse {
  intake_id: number;
  from_stage: LifecycleStage;
  to_stage: LifecycleStage;
  status: InitiativeStatus;
  status_label: string;
}

export interface ManifestItem {
  kind: "epic" | "feature" | "task";
  title: string;
  description_html: string;
  agent_type?: AgentType;
  children?: ManifestItem[];
}

export interface WorkItemManifest {
  epic: ManifestItem;
  children: ManifestItem[];
  counts: { features: number; tasks: number };
}

export type WorkItemState = "New" | "Active" | "Resolved" | "Closed";

export interface WorkItemLink {
  kind: "epic" | "feature" | "task";
  external_id: string;
  parent_external_id: string | null;
  title: string;
  url: string;
  state: WorkItemState;
}

export interface DetectResult {
  initiative_type: InitiativeType;
  confidence: number;
  type_scores: Record<string, number>;
  flags: Record<string, boolean>;
  matched_keywords: Record<string, string[]>;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ToolTraceItem {
  tool: string;
  arguments: Record<string, unknown>;
  result_preview: string;
}

export interface ChatResponse {
  answer: string;
  tool_trace: ToolTraceItem[];
}

export interface CanonicalField {
  id: string;
  section: string;
  type: "text" | "textarea" | "email" | "date" | "select" | "boolean" | "number";
  label: string;
  help: string;
  required: boolean;
  options?: string[];
  autofill_source?: "cmdb" | "portfolio";
}

export interface User {
  name: string;
  email: string;
}
