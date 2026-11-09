// Deterministic TypeScript port of the backend rules (gate rules, agents, status, coverage, synthesis,
// manifest, chat, detect). Keep in step with meridian-agent/app/{agents,orchestrator,nlp,chat}.
import type {
  Activity, AgentEvidence, AgentStatus, AgentType, ControlRef, CoverageReport, DetectResult, InitiativeStatus, Intake,
  OrchestrationResult, ToolTraceItem, WorkItemManifest,
} from "../types";
import { AGENT_LABELS, AGENT_ORDER } from "../types";
import { coverageQuestions, fixtures, masterQuestions } from "./data";

type AnyIntake = Intake | (Partial<Intake> & Record<string, unknown>);
const b = (i: AnyIntake, k: string): boolean => Boolean((i as Record<string, unknown>)[k]);
const s = (i: AnyIntake, k: string): string | null => {
  const v = (i as Record<string, unknown>)[k];
  return v === undefined || v === null || v === "" ? null : String(v);
};
const n = (i: AnyIntake, k: string): number | null => {
  const v = (i as Record<string, unknown>)[k];
  return v === undefined || v === null || v === "" ? null : Number(v);
};

export function hash6(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).toUpperCase().padStart(8, "0").slice(0, 6);
}

export function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(16).slice(2, 10).toUpperCase().padEnd(8, "0")}`;
}

// ---------- mocked systems ----------
export const cmdbGet = (ciId: string | null) => fixtures.cmdb.find((r) => r.ci_id === (ciId ?? "").trim().toUpperCase()) ?? null;
export const portfolioGet = (id: string | null) => {
  const key = (id ?? "").trim().toUpperCase();
  return fixtures.portfolio.find((p) => p.portfolio_id === key || p.ci_id === key) ?? null;
};
const riskBand = (score: number) => (score >= 70 ? "High" : score >= 40 ? "Medium" : "Low");
function changeRisk(i: AnyIntake) {
  const ci = (s(i, "application_ci_id") ?? "").toUpperCase();
  const base = fixtures.itsm_risk[ci] ?? { base_score: 30, open_incidents: 0, failed_changes_90d: 0 };
  let score = base.base_score + (b(i, "outage_expected") ? 15 : 0) + (b(i, "customer_impacting") ? 10 : 0);
  score -= s(i, "implementation_method") === "AUTOMATED_PIPELINE" ? 10 : 0;
  score = Math.max(0, Math.min(100, score));
  return { score, band: riskBand(score), ...base };
}
export function cmdbForIntake(i: AnyIntake) {
  const snap = (i as Intake).cmdb_snapshot;
  if (snap && typeof snap === "object" && Object.keys(snap).length) return snap;
  return cmdbGet(s(i, "application_ci_id"));
}

// ---------- gate rules ----------
export function applicableAgents(i: AnyIntake): Record<AgentType, boolean> {
  const t = s(i, "initiative_type");
  const techOrNew = t === "TECH_CHANGE" || t === "NEW_SERVICE";
  return {
    clarity: true,
    scoping: true,
    release: true,
    security: techOrNew || b(i, "internet_facing") || b(i, "handles_payment_data"),
    privacy: b(i, "personal_data_processed") || b(i, "sensitive_personal_data_processed") || b(i, "cross_border_data_transfer"),
    ai_ethics: b(i, "ai_ml_component_present"),
    architecture: techOrNew || b(i, "external_facing") || b(i, "third_party_vendor_involved") || b(i, "new_pipeline_required"),
    resilience: b(i, "important_business_service") || b(i, "disaster_recovery_required") || b(i, "customer_impacting") || t === "NEW_SERVICE",
  };
}

const REVIEW_SYSTEMS: Record<AgentType, string> = {
  clarity: "Portfolio", scoping: "Change Mgmt", security: "Security Portal", privacy: "DRA",
  ai_ethics: "DRA", architecture: "Architecture Portal", resilience: "Business Impact", release: "Change Mgmt",
};
const ref = (control: string, control_description: string, control_source_document: string, system: string): ControlRef =>
  ({ control, control_description, control_source_document, system });

function evidence(agent: AgentType, status: AgentStatus, partial: Partial<AgentEvidence>): AgentEvidence {
  return {
    agent_type: agent, status, derived_fields: {}, confidence: 0.8, rationale: "", control_refs: [], follow_up_questions: [],
    activities: [], source_systems_consulted: [], review_system: REVIEW_SYSTEMS[agent], not_applicable: false, ...partial,
  };
}

// ---------- agents ----------
function clarityAgent(i: AnyIntake): AgentEvidence {
  const cmdb = cmdbForIntake(i);
  const inv = portfolioGet(s(i, "portfolio_id") ?? s(i, "application_ci_id"));
  const risk = changeRisk(i);
  const known = (inv?.known_vendors ?? []).map((v) => v.toLowerCase());
  const newVendor = b(i, "third_party_vendor_involved") && !known.includes((s(i, "vendor_name") ?? "").trim().toLowerCase());
  const regulatory = b(i, "regulatory_notification_required") || Boolean(inv?.regulatory_notification_required);
  const materialIbs = (b(i, "important_business_service") || Boolean(cmdb?.ibs)) && b(i, "customer_impacting");
  const reasons: string[] = [];
  const fu: string[] = [];
  if (regulatory) {
    reasons.push("regulatory notification is required");
    fu.push("Who will own the regulatory notification and by what date will it be submitted?");
  }
  if (materialIbs) {
    reasons.push("an important business service is materially impacted");
    fu.push("Has the important business service owner accepted the customer impact?");
  }
  if (newVendor) {
    reasons.push(`vendor '${s(i, "vendor_name") ?? "unnamed"}' is not on the investment's approved vendor list`);
    fu.push("Has the new vendor been onboarded through vendor risk due diligence?");
  }
  if (risk.band === "High") {
    reasons.push(`ITSM change risk band is High (${risk.score})`);
    fu.push("What additional mitigations reduce the High change-risk score?");
  }
  return evidence("clarity", reasons.length ? "NEEDS_REVIEW" : "AUTO_APPROVED", {
    confidence: inv ? 0.9 : 0.6,
    rationale: reasons.length
      ? `Portfolio impact needs review because ${reasons.join(", ")}.`
      : `Linked to ${inv?.investment_name ?? "no investment"} with ${risk.band} change risk; no material portfolio impact detected.`,
    follow_up_questions: fu,
    derived_fields: {
      investment_id: inv?.portfolio_id ?? null, investment_name: inv?.investment_name ?? null, investment_stage: inv?.investment_stage ?? null,
      funding_approved: inv?.funding_approved ?? false, business_owner: inv?.business_owner ?? cmdb?.owner ?? null,
      application_name: cmdb?.app_name ?? null, regulatory_notification_required: regulatory, material_ibs_impact: materialIbs,
      new_vendor: newVendor, change_risk_score: risk.score, change_risk_band: risk.band,
      impact_answers: {
        "Is the work funded by an approved investment?": inv?.funding_approved ? "Yes" : "No / unknown",
        "Which investment does this belong to?": inv?.investment_name ?? "Not linked",
        "Does the change require regulatory notification?": regulatory ? "Yes" : "No",
        "Does it materially impact an important business service?": materialIbs ? "Yes" : "No",
        "Does it introduce a new vendor?": newVendor ? "Yes" : "No",
        "What is the change risk band?": `${risk.band} (${risk.score})`,
      },
    },
    control_refs: [
      ref("PF-01", "Investment linkage and funding approval", "Portfolio Governance Policy v2", "Portfolio"),
      ref("CHG-RISK", "Change risk scoring from configuration and incident history", "Change Risk Model v3", "ITSM"),
    ],
    source_systems_consulted: ["Portfolio", "ITSM"],
  });
}

function scopingAgent(i: AnyIntake): AgentEvidence {
  const app = applicableAgents(i);
  const mapping: [AgentType, string][] = [["security", "SEC-BASE"], ["privacy", "PRIV-DPIA"], ["ai_ethics", "AI-RISK"], ["architecture", "ARCH-REVIEW"], ["resilience", "RES-BIA"]];
  const scope = ["CHG-STD", ...mapping.filter(([a]) => app[a]).map(([, c]) => c)];
  const isCloud = ["PUBLIC_CLOUD", "HYBRID"].includes(s(i, "target_environment") ?? "") || s(i, "initiative_type") === "CLOUD";
  if (isCloud) scope.push("CLOUD-ONBOARD");
  const enhanced = b(i, "regulatory_notification_required") || b(i, "biometric_data") || s(i, "autonomy_level") === "FULLY_AUTONOMOUS"
    || (b(i, "important_business_service") && b(i, "customer_impacting"));
  const specialists = mapping.filter(([a]) => app[a]).length;
  const track = enhanced ? "ENHANCED" : specialists <= 2 && s(i, "budget_band") !== "HIGH" ? "FAST_TRACK" : "STANDARD";
  const fu: string[] = [];
  if ((s(i, "description") ?? "").trim().length < 20) fu.push("Provide a fuller description of the change and its business outcome (at least one sentence).");
  if (!s(i, "target_go_live")) fu.push("What is the target go-live date?");
  const refs = [ref("CHG-STD", "Standard change governance", "Change Management Standard v4", "Change Mgmt")];
  if (isCloud) refs.push(ref("CLOUD-ONBOARD", "Cloud service onboarding checklist", "Cloud Onboarding Guide v2", "Cloud Onboarding"));
  const title = track.replace("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return evidence("scoping", fu.length ? "NEEDS_REVIEW" : "AUTO_APPROVED", {
    confidence: 0.95,
    rationale: `${title} governance track with ${scope.length} control families in scope: ${scope.join(", ")}.` + (fu.length ? " Scoping inputs are incomplete." : ""),
    follow_up_questions: fu,
    derived_fields: { governance_track: track, control_scope: scope, specialist_agents_in_scope: mapping.filter(([a]) => app[a]).map(([a]) => a), cloud_onboarding_required: isCloud },
    control_refs: refs,
    source_systems_consulted: ["Change Mgmt", ...(isCloud ? ["Cloud Onboarding"] : [])],
  });
}

export function compoundRisks(i: AnyIntake): string[] {
  const design = (i as Intake).si_design_evidence;
  if (!design) return [];
  const risks: string[] = [];
  for (const flow of design.data_flows ?? []) {
    if (flow.cross_border && ["CONFIDENTIAL", "RESTRICTED"].includes(String(flow.classification).toUpperCase())) {
      risks.push(`Design flow '${flow.name}' moves ${flow.classification} data across borders.`);
      if (!b(i, "cross_border_data_transfer")) risks.push("Intake states no cross-border transfer but the design shows one.");
    }
  }
  const vendors = design.third_parties ?? [];
  const vendor = s(i, "vendor_name");
  if (vendors.length && !b(i, "third_party_vendor_involved")) {
    risks.push(`Design names third parties (${vendors.join(", ")}) but intake declares no vendor involvement.`);
  } else if (vendors.length && vendor && vendors.every((v) => v.toLowerCase() !== vendor.toLowerCase())) {
    risks.push(`Intake vendor '${vendor}' does not match design third parties (${vendors.join(", ")}).`);
  }
  return risks;
}

function securityAgent(i: AnyIntake): AgentEvidence {
  const auth = s(i, "authentication_method");
  const weak = auth === null || auth === "PASSWORD" || auth === "NONE";
  const highRisk = b(i, "internet_facing") || b(i, "handles_payment_data") || weak || s(i, "data_classification") === "RESTRICTED";
  const compound = compoundRisks(i);
  const derived: Record<string, unknown> = {
    internet_exposure: b(i, "internet_facing") ? "Public" : b(i, "external_facing") ? "Partner" : "Internal",
    payment_data_in_scope: b(i, "handles_payment_data"), authentication_method: auth ?? "Not stated",
    weak_authentication: weak, high_risk: highRisk, compound_risks: compound,
  };
  const activities: Activity[] = [];
  const refs: ControlRef[] = [];
  const fu: string[] = [];
  const systems = ["Security Portal"];
  if (highRisk) {
    const digest = hash6(`${(i as Intake).id}|${s(i, "application_ci_id")}|${s(i, "initiative_name")}`);
    const triggers = new Set<string>();
    if (b(i, "internet_facing")) triggers.add("internet_facing");
    if (b(i, "handles_payment_data")) triggers.add("handles_payment_data");
    if (auth === null || ["PASSWORD", "NONE", "API_KEY"].includes(auth)) triggers.add("weak_auth");
    if (!b(i, "encryption_in_transit")) triggers.add("no_tls");
    if (b(i, "third_party_vendor_involved")) triggers.add("third_party");
    if (!b(i, "penetration_test_planned")) triggers.add("pen_test");
    if (b(i, "privileged_access_required")) triggers.add("privileged");
    const required = fixtures.security_controls.filter((c) => triggers.has(c.trigger));
    Object.assign(derived, {
      security_assessment_id: `SA-${digest}`, security_ticket_ref: `SECT-${digest}`,
      security_portal_outcome: required.length ? "CONDITIONAL" : "APPROVED",
      security_portal_url: `https://secportal.example.com/assessments/SA-${digest}`,
    });
    required.forEach((c, idx) => {
      const ticket = `SECT-${digest}-${String(idx + 1).padStart(2, "0")}`;
      refs.push(ref(c.control, c.description, c.source_document, "Security Portal"));
      activities.push({ title: `Implement ${c.control}`, description: c.description, control_ref: c.control, source_ticket: ticket });
    });
    fu.push(`Confirm owners and dates for the ${activities.length} required security controls in assessment SA-${digest}.`);
  }
  if (b(i, "handles_payment_data") && weak) fu.push("Payment data is handled without strong authentication: what compensating control applies?");
  if (b(i, "internet_facing") && !b(i, "encryption_in_transit")) fu.push("Public endpoints must use TLS: when will encryption in transit be enabled?");
  compound.forEach((r) => fu.push(`Explain or correct: ${r}`));
  if (b(i, "third_party_vendor_involved")) systems.push("Vendor Risk");
  const flagged = (b(i, "handles_payment_data") && weak) || (b(i, "internet_facing") && !b(i, "encryption_in_transit"));
  const status: AgentStatus = flagged ? "FLAGGED" : highRisk || compound.length ? "NEEDS_REVIEW" : "AUTO_APPROVED";
  const drivers = ([["public internet exposure", b(i, "internet_facing")], ["payment data", b(i, "handles_payment_data")], ["weak authentication", weak],
    ["restricted data", s(i, "data_classification") === "RESTRICTED"], ["design compound risks", compound.length > 0]] as [string, boolean][])
    .filter(([, on]) => on).map(([d]) => d);
  return evidence("security", status, {
    confidence: 0.85, derived_fields: derived, follow_up_questions: fu, control_refs: refs, activities, source_systems_consulted: systems,
    rationale: status === "AUTO_APPROVED"
      ? "Internal-only service with strong authentication and no payment data; baseline security controls suffice."
      : `Security review required due to ${drivers.join(", ")}.` + (activities.length ? ` Security Portal returned ${activities.length} required controls.` : ""),
  });
}

function privacyAgent(i: AnyIntake): AgentEvidence {
  const digest = hash6(`${(i as Intake).id}|${s(i, "initiative_name")}`);
  const noBasis = !s(i, "lawful_basis") || s(i, "lawful_basis") === "NONE";
  const fu: string[] = [];
  const reasons: string[] = [];
  if (b(i, "personal_data_processed") && noBasis) {
    reasons.push("no lawful basis is recorded");
    fu.push("What is the lawful basis for processing personal data?");
  }
  if (b(i, "sensitive_personal_data_processed")) {
    reasons.push("sensitive personal data is processed");
    fu.push("What additional safeguards protect the sensitive personal data?");
  }
  if (b(i, "cross_border_data_transfer")) {
    reasons.push(`data is transferred cross-border (${s(i, "transfer_destinations") ?? "destinations not stated"})`);
    fu.push("Which transfer mechanism (e.g. contractual clauses) covers the cross-border transfer?");
  }
  if (b(i, "personal_data_processed") && n(i, "data_retention_months") === null) fu.push("How long will personal data be retained?");
  const flagged = b(i, "sensitive_personal_data_processed") && b(i, "cross_border_data_transfer") && noBasis;
  const high = b(i, "sensitive_personal_data_processed") || b(i, "cross_border_data_transfer");
  const refs = [ref("PRIV-DPIA", "Data protection impact assessment", "Privacy Standard v3", "DRA")];
  if (b(i, "cross_border_data_transfer")) refs.push(ref("PRIV-XBT", "International transfer safeguards", "Privacy Standard v3", "DRA"));
  return evidence("privacy", flagged ? "FLAGGED" : fu.length ? "NEEDS_REVIEW" : "AUTO_APPROVED", {
    confidence: 0.88, follow_up_questions: fu, control_refs: refs, source_systems_consulted: ["DRA"],
    rationale: reasons.length ? `Privacy review required because ${reasons.join(", ")}.`
      : !fu.length ? "Personal data use is covered by a recorded lawful basis without sensitive or cross-border processing." : "Privacy inputs are incomplete.",
    derived_fields: {
      lawful_basis: s(i, "lawful_basis") ?? "NONE", dra_id: `DRA-${digest}`,
      dra_residual_risk: high ? "High" : b(i, "personal_data_processed") ? "Medium" : "Low",
      dra_prefilled_answers: {
        "DRA-Q1 Personal data in scope": b(i, "personal_data_processed") ? "Yes" : "No",
        "DRA-Q2 Special category data": b(i, "sensitive_personal_data_processed") ? "Yes" : "No",
        "DRA-Q3 Lawful basis": s(i, "lawful_basis") ?? "Not stated",
        "DRA-Q4 International transfer": b(i, "cross_border_data_transfer") ? "Yes" : "No",
        "DRA-Q5 Transfer destinations": s(i, "transfer_destinations") ?? "None",
        "DRA-Q6 Retention period (months)": String(n(i, "data_retention_months") ?? "Not stated"),
        "DRA-Q7 Data minimisation": b(i, "data_minimisation_applied") ? "Yes" : "No",
      },
      dra_url: `https://dra.example.com/assessments/DRA-${digest}`,
      cross_border: b(i, "cross_border_data_transfer"), sensitive_data: b(i, "sensitive_personal_data_processed"),
    },
  });
}

function aiEthicsAgent(i: AnyIntake): AgentEvidence {
  const autonomy = s(i, "autonomy_level");
  const risk = autonomy === "FULLY_AUTONOMOUS" || b(i, "biometric_data") || (b(i, "ai_decision_impacts_customers") && !b(i, "human_in_the_loop"))
    ? "HIGH" : autonomy === "SEMI_AUTONOMOUS" || b(i, "ai_decision_impacts_customers") ? "MEDIUM" : "LOW";
  const regScope = b(i, "biometric_data") || (b(i, "ai_decision_impacts_customers") && b(i, "personal_data_processed"));
  const explain = risk !== "LOW" || b(i, "ai_decision_impacts_customers");
  let fu: string[] = [];
  if (risk !== "LOW") fu.push("How will model outputs be monitored for bias and drift after release?");
  if (explain) fu.push("How are AI decisions explained to affected customers or reviewers?");
  if (b(i, "biometric_data")) fu.push("How is explicit consent captured for biometric processing, and what is the non-biometric alternative?");
  if (!b(i, "human_in_the_loop") && (autonomy === "SEMI_AUTONOMOUS" || autonomy === "FULLY_AUTONOMOUS")) fu.push("What human override or kill-switch exists for autonomous decisions?");
  if (b(i, "training_data_contains_personal_data")) fu.push("Has personal data in the training set been minimised or pseudonymised?");
  const flagged = b(i, "biometric_data") && autonomy === "FULLY_AUTONOMOUS";
  const status: AgentStatus = flagged ? "FLAGGED" : risk !== "LOW" ? "NEEDS_REVIEW" : "AUTO_APPROVED";
  if (status === "AUTO_APPROVED") fu = [];
  const rationale = {
    HIGH: "High model-risk class: autonomy, biometric data or unsupervised customer-impacting decisions require AI review board sign-off.",
    MEDIUM: "Medium model-risk class: decisions affect customers or act semi-autonomously, so monitoring and explainability evidence is required.",
    LOW: "Low model-risk class: assistive use with a human in the loop and no customer-impacting decisions.",
  }[risk];
  return evidence("ai_ethics", status, {
    confidence: 0.82, rationale, follow_up_questions: fu, source_systems_consulted: ["DRA"],
    derived_fields: { autonomy_level: autonomy ?? "NONE", model_type: s(i, "ai_model_type") ?? "NONE", biometric: b(i, "biometric_data"),
      regulatory_scope_flag: regScope, model_risk_class: risk, explainability_required: explain },
    control_refs: [ref("AI-RISK", "Model risk classification and validation", "Responsible AI Standard v1", "DRA"),
      ref("AI-XAI", "Explainability and human oversight", "Responsible AI Standard v1", "DRA")],
  });
}

function architectureAgent(i: AnyIntake): AgentEvidence {
  const cmdb = cmdbForIntake(i);
  const key = (s(i, "application_ci_id") ?? "").toUpperCase();
  const base = fixtures.archportal[key] ?? { capabilities: ["Unmapped Capability"], impact_level: "Medium", dependencies: [] };
  const newCap = s(i, "initiative_type") === "NEW_SERVICE";
  const impact = newCap && base.impact_level === "Medium" ? "High" : base.impact_level;
  const growth = n(i, "user_growth_pct") ?? 0;
  const fu: string[] = [];
  const reasons: string[] = [];
  if (growth > 25) {
    reasons.push(`user growth of ${growth}% exceeds 25%`);
    fu.push("Provide capacity and load-test evidence for the expected user growth.");
  }
  if (b(i, "sla_specified")) {
    reasons.push("a formal SLA is specified");
    fu.push("How is the SLA measured and which dependencies underpin it?");
  }
  if (b(i, "new_technology_introduced")) {
    reasons.push("new technology is introduced to the estate");
    fu.push("Has the new technology been approved through the technology radar process?");
  }
  const env = s(i, "target_environment") ?? cmdb?.target_environment ?? null;
  const isCloud = env === "PUBLIC_CLOUD" || env === "HYBRID";
  const refs = [ref("ARCH-REVIEW", "Capability impact and architecture principles review", fixtures.architecture_document, "Architecture Portal")];
  if (isCloud) refs.push(ref("CLOUD-PATTERN", "Approved cloud reference pattern", "Cloud Onboarding Guide v2", "Cloud Onboarding"));
  const reportId = `CIR-${key || "NEW"}`;
  return evidence("architecture", reasons.length ? "NEEDS_REVIEW" : "AUTO_APPROVED", {
    confidence: 0.8, follow_up_questions: fu, control_refs: refs,
    rationale: reasons.length ? `Architecture review required because ${reasons.join(", ")}.`
      : `Capability impact is ${impact} on ${base.capabilities.join(", ")}; within approved patterns.`,
    derived_fields: {
      capability_report_id: reportId, capabilities_impacted: base.capabilities, impact_level: impact, dependencies: base.dependencies,
      architecture_pattern: s(i, "architecture_pattern") ?? cmdb?.architecture_pattern ?? null, target_environment: env,
      cloud_service_type: s(i, "cloud_service_type") ?? cmdb?.cloud_service_type ?? null, user_growth_pct: growth,
      sla_specified: b(i, "sla_specified"), report_url: `https://archportal.example.com/reports/${reportId}`,
    },
    source_systems_consulted: ["Architecture Portal", "ITSM", ...(isCloud ? ["Cloud Onboarding"] : [])],
  });
}

function resilienceAgent(i: AnyIntake): AgentEvidence {
  const cmdb = cmdbForIntake(i);
  const rto = n(i, "rto_hours") ?? cmdb?.rto_hours ?? null;
  const rpo = n(i, "rpo_hours") ?? cmdb?.rpo_hours ?? null;
  const ibs = b(i, "important_business_service") || Boolean(cmdb?.ibs);
  const score = (ibs ? 40 : 0) + (b(i, "customer_impacting") ? 25 : 0) + (b(i, "disaster_recovery_required") ? 15 : 0)
    + (rto !== null && rto <= 4 ? 10 : 0) + ((n(i, "peak_tps") ?? 0) > 1000 ? 10 : 0);
  const fu: string[] = [];
  if (rto === null || rpo === null) fu.push("State the RTO and RPO for the service.");
  if (ibs && b(i, "disaster_recovery_required") && rto !== null && rto > 24) fu.push(`An RTO of ${rto}h is long for an important business service: is a tighter target needed?`);
  const flagged = ibs && b(i, "customer_impacting") && b(i, "outage_expected");
  if (flagged) fu.push("An outage on a customer-facing important business service is planned: what is the impact tolerance and communication plan?");
  else if (score >= 60) fu.push("Confirm the business impact assessment has been refreshed for this change.");
  const status: AgentStatus = flagged ? "FLAGGED" : fu.length ? "NEEDS_REVIEW" : "AUTO_APPROVED";
  return evidence("resilience", status, {
    confidence: 0.86, follow_up_questions: fu, source_systems_consulted: ["Business Impact", "ITSM"],
    rationale: `Resilience impact score ${score}/100` + (flagged ? " with a planned outage on a customer-facing important business service."
      : fu.length ? "; business impact assessment review needed." : "; recovery objectives are within tolerance."),
    derived_fields: { important_business_service: ibs, ibs_score: score, rto_hours: rto, rpo_hours: rpo,
      rto_source: n(i, "rto_hours") !== null ? "intake" : rto !== null ? "cmdb" : "missing", dr_required: b(i, "disaster_recovery_required") },
    control_refs: [ref("RES-BIA", "Business impact assessment and impact tolerance", "Operational Resilience Policy v2", "Business Impact")],
  });
}

export const isStpEligible = (i: AnyIntake): boolean =>
  !b(i, "outage_expected") && !b(i, "customer_impacting") && (Boolean((s(i, "backout_plan_summary") ?? "").trim()) || s(i, "implementation_method") === "AUTOMATED_PIPELINE");

function releaseAgent(i: AnyIntake, trackerEnabled: boolean): AgentEvidence {
  const hasBackout = Boolean((s(i, "backout_plan_summary") ?? "").trim());
  const stp = isStpEligible(i);
  const derived: Record<string, unknown> = {
    stp_eligible: stp, change_window: s(i, "change_window"),
    change_answers: {
      "Is a backout plan documented?": hasBackout ? "Yes" : "No",
      "Is an outage expected?": b(i, "outage_expected") ? `Yes (${n(i, "outage_duration_minutes") ?? "?"} min)` : "No",
      "Are customers impacted?": b(i, "customer_impacting") ? `Yes (${n(i, "customers_impacted_count") ?? "unknown"})` : "No",
      "Does the vendor perform part of the change?": b(i, "vendor_change_involved") ? "Yes" : "No",
      "Implementation method": s(i, "implementation_method") ?? "Not stated",
    },
  };
  const fu: string[] = [];
  if (!stp) {
    if (b(i, "outage_expected")) fu.push("Confirm the outage window has been agreed with impacted service owners.");
    if (b(i, "customer_impacting")) fu.push("How will impacted customers be notified before the change?");
    if (!hasBackout && s(i, "implementation_method") !== "AUTOMATED_PIPELINE") fu.push("Document the backout plan for this change.");
  }
  if (stp && trackerEnabled) {
    const id = randomId("TK");
    derived.tracker_task_id = id;
    derived.tracker_task_url = `https://tracker.example.com/items/${id}`;
  }
  const flagged = b(i, "outage_expected") && !hasBackout;
  return evidence("release", flagged ? "FLAGGED" : stp ? "AUTO_APPROVED" : "NEEDS_REVIEW", {
    confidence: 0.92, derived_fields: derived, follow_up_questions: fu, source_systems_consulted: ["Change Mgmt", "ITSM"],
    rationale: stp ? "Eligible for straight-through processing: no outage, no customer impact and a backout path exists."
      : "Not eligible for straight-through processing; change advisory review is required.",
    control_refs: [ref("CHG-STP", "Straight-through processing criteria", "Change Management Standard v4", "Change Mgmt")],
  });
}

// Mirrors MockLlmClient.KEYWORD_SENTENCES: the mock "LLM rephrase" appends one sentence for a relevant truthy flag.
const KEYWORD_SENTENCES: [string, AgentType[], string][] = [
  ["handles_payment_data", ["security", "clarity"], "Payment data in scope brings card-data segmentation obligations."],
  ["cross_border_data_transfer", ["privacy", "security"], "Cross-border flows require transfer safeguards to be evidenced."],
  ["biometric_data", ["ai_ethics", "privacy"], "Biometric processing is treated as high-risk by default."],
  ["outage_expected", ["resilience", "release"], "A planned outage removes eligibility for straight-through processing."],
  ["internet_facing", ["security", "architecture"], "Public exposure widens the attack surface."],
];

function rephrase(i: AnyIntake, ev: AgentEvidence): AgentEvidence {
  const extra = KEYWORD_SENTENCES.find(([flag, agents]) => b(i, flag) && agents.includes(ev.agent_type));
  return { ...ev, rationale: [ev.rationale, extra?.[2]].filter(Boolean).join(" ").trim() };
}

export function skippedEvidence(agent: AgentType): AgentEvidence {
  return evidence(agent, "SKIPPED", { confidence: 1, not_applicable: true,
    rationale: `${AGENT_LABELS[agent]} assessment is not applicable to this intake profile.` });
}

const AGENTS: Record<AgentType, (i: AnyIntake, trackerEnabled: boolean) => AgentEvidence> = {
  clarity: clarityAgent, scoping: scopingAgent, security: securityAgent, privacy: privacyAgent,
  ai_ethics: aiEthicsAgent, architecture: architectureAgent, resilience: resilienceAgent, release: releaseAgent,
};

export function evaluateAgent(agent: AgentType, i: AnyIntake, trackerEnabled = true): AgentEvidence {
  return rephrase(i, AGENTS[agent](i, trackerEnabled));
}

// ---------- aggregation ----------
const RESOLVED: AgentStatus[] = ["AUTO_APPROVED", "REVIEWED"];

export function overallStatus(results: AgentEvidence[]): AgentStatus {
  const st = new Set(results.filter((r) => r.status !== "SKIPPED").map((r) => r.status));
  for (const p of ["FAILED", "FLAGGED", "NEEDS_REVIEW"] as AgentStatus[]) if (st.has(p)) return p;
  if (st.has("PENDING") || st.size === 0) return "PENDING";
  return st.has("REVIEWED") ? "REVIEWED" : "AUTO_APPROVED";
}

export function computeStp(results: AgentEvidence[]): boolean {
  const release = results.find((r) => r.agent_type === "release");
  if (!release?.derived_fields.stp_eligible) return false;
  return results.filter((r) => r.status !== "SKIPPED").every((r) => RESOLVED.includes(r.status));
}

export function synthesisNotes(i: AnyIntake, byAgent: Partial<Record<AgentType, AgentEvidence>>): string[] {
  const open = (r?: AgentEvidence) => r && (r.status === "NEEDS_REVIEW" || r.status === "FLAGGED");
  const { security: sec, privacy: priv, resilience: res, release: rel, ai_ethics: ai, architecture: arch } = byAgent;
  const notes: string[] = [];
  if (rel?.derived_fields.stp_eligible && [sec, priv, res, ai, arch].some(open))
    notes.push("Conflict: the change qualifies for straight-through release, but open specialist reviews block STP until resolved.");
  if (sec && priv && (sec.derived_fields.compound_risks as string[] | undefined)?.length && priv.derived_fields.cross_border)
    notes.push("Correlation: security compound risks and privacy cross-border transfer concern the same data flows; review jointly.");
  if (res?.status === "FLAGGED" && rel && !rel.derived_fields.stp_eligible)
    notes.push("Correlation: planned outage drives both the resilience flag and the release review.");
  if (ai?.derived_fields.regulatory_scope_flag && (!priv || priv.not_applicable))
    notes.push("Gap: AI use is in regulatory scope but no privacy assessment ran; confirm personal-data flags.");
  if (arch && Number(arch.derived_fields.user_growth_pct ?? 0) > 25 && res?.derived_fields.important_business_service)
    notes.push("Correlation: high user growth on an important business service; align capacity tests with impact tolerance.");
  if (b(i, "third_party_vendor_involved") && sec && !sec.source_systems_consulted.includes("Vendor Risk"))
    notes.push("Gap: vendor involvement declared but vendor risk was not consulted.");
  return notes.length ? notes : ["No cross-agent conflicts or correlations detected."];
}

const filled = (v: unknown) => v !== undefined && v !== null && !(typeof v === "string" && !v.trim());
const systemOf = Object.fromEntries(masterQuestions.map((q) => [q.id, q.system])) as Record<string, string>;

export function coverage(i: AnyIntake, results?: AgentEvidence[] | null): CoverageReport {
  const ran = new Set((results ?? []).filter((r) => r.status !== "SKIPPED" && r.status !== "FAILED").map((r) => r.agent_type));
  const answered = new Set<string>();
  Object.entries(coverageQuestions).forEach(([qid, e]) => {
    if (e.fields.some((f) => filled((i as Record<string, unknown>)[f])) || ran.has(e.owner_agent)) answered.add(qid);
  });
  const total = Object.keys(coverageQuestions).length;
  const systems = Array.from(new Set(Object.values(systemOf))).sort();
  return {
    total_questions: total,
    answered_questions: answered.size,
    coverage_pct: total ? Math.round((1000 * answered.size) / total) / 10 : 0,
    systems_total: systems.length,
    systems_replaced: new Set(Array.from(answered).map((q) => systemOf[q])).size,
    per_agent: AGENT_ORDER.map((a) => {
      const qids = Object.entries(coverageQuestions).filter(([, e]) => e.owner_agent === a).map(([q]) => q);
      const done = qids.filter((q) => answered.has(q)).length;
      return { agent_type: a, total: qids.length, answered: done, pct: qids.length ? Math.round((1000 * done) / qids.length) / 10 : 0, ran: ran.has(a) };
    }),
    per_system: systems.map((system) => {
      const qids = Object.keys(systemOf).filter((q) => systemOf[q] === system);
      return { system, total: qids.length, answered: qids.filter((q) => answered.has(q)).length };
    }),
  };
}

export function orchestrate(i: Intake, trackerEnabled = true, onStep?: (event: string, agent: AgentType | null, status?: AgentStatus) => void): OrchestrationResult {
  const app = applicableAgents(i);
  const results: AgentEvidence[] = [];
  for (const agent of AGENT_ORDER) {
    if (!app[agent]) {
      const ev = skippedEvidence(agent);
      results.push(ev);
      onStep?.("agent_skipped", agent, ev.status);
      continue;
    }
    onStep?.("agent_started", agent);
    const ev = evaluateAgent(agent, i, trackerEnabled);
    results.push(ev);
    onStep?.("agent_completed", agent, ev.status);
  }
  const byAgent = Object.fromEntries(results.map((r) => [r.agent_type, r])) as Record<AgentType, AgentEvidence>;
  onStep?.("synthesis_started", null);
  const notes = synthesisNotes(i, byAgent);
  const cov = coverage(i, results);
  const release = byAgent.release;
  return {
    intake_id: i.id, agent_results: results, overall_status: overallStatus(results), straight_through_eligible: computeStp(results),
    questions_raw_count: cov.total_questions, questions_replaced_count: cov.answered_questions, systems_replaced_count: cov.systems_replaced,
    coverage_pct: cov.coverage_pct, notes, generated_at: new Date().toISOString(),
    work_item_id: (release?.derived_fields.tracker_task_id as string) ?? null, work_item_url: (release?.derived_fields.tracker_task_url as string) ?? null,
  };
}

export function reconcile(result: OrchestrationResult, answers: { agent_type: string; question: string; answer: string }[]): OrchestrationResult {
  const answered = new Map<string, Set<string>>();
  answers.filter((a) => a.answer.trim()).forEach((a) => {
    if (!answered.has(a.agent_type)) answered.set(a.agent_type, new Set());
    answered.get(a.agent_type)!.add(a.question.trim());
  });
  const updated = result.agent_results.map((ev) => {
    const qs = ev.follow_up_questions.map((q) => q.trim());
    const done = answered.get(ev.agent_type) ?? new Set();
    if ((ev.status === "NEEDS_REVIEW" || ev.status === "FLAGGED") && qs.length && qs.every((q) => done.has(q))) return { ...ev, status: "REVIEWED" as AgentStatus };
    return ev;
  });
  return { ...result, agent_results: updated, overall_status: overallStatus(updated), straight_through_eligible: computeStp(updated) };
}

// ---------- lifecycle ----------
const DAY = 86_400_000;
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, days: number) => isoDate(new Date(Date.parse(iso) + days * DAY));
export const todayIso = () => isoDate(new Date());

export function computeDeadlines(createdIso: string, goLive: string | null): Record<string, string> {
  const start = createdIso.slice(0, 10);
  const end = goLive && goLive > start ? goLive : addDays(start, 90);
  const span = Math.round((Date.parse(end) - Date.parse(start)) / DAY);
  const stages = ["Intake", "Assessment", "Approval", "Build", "Deploy", "Production"];
  return Object.fromEntries(stages.map((st, idx) => [st, addDays(start, Math.round((span * (idx + 1)) / stages.length))]));
}

export function deriveStatus(stage: string, statuses: AgentStatus[] | null, due: string | null, today: string, threshold: number): InitiativeStatus {
  if (stage === "Production") return "COMPLETED";
  const active = (statuses ?? []).filter((x) => x !== "SKIPPED");
  const unresolved = statuses === null || active.some((x) => !RESOLVED.includes(x));
  const awaiting = active.some((x) => x === "NEEDS_REVIEW" || x === "FLAGGED" || x === "FAILED");
  const overdue = due !== null && due < today;
  const daysLeft = due !== null ? Math.round((Date.parse(due) - Date.parse(today)) / DAY) : null;
  const soon = daysLeft !== null && daysLeft >= 0 && daysLeft <= threshold;
  if (overdue && unresolved) return "REJECTED";
  if (overdue || soon) return "ORCHESTRATING";
  if (awaiting) return "AWAITING_HUMAN_INPUT";
  return "SUBMITTED";
}

// ---------- manifest ----------
export const escapeHtml = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

function derivedList(fields: Record<string, unknown>): string {
  const items = Object.entries(fields).map(([k, v]) => {
    const val = Array.isArray(v) ? v.join(", ") || "-" : v && typeof v === "object" ? Object.entries(v).map(([a, c]) => `${a}: ${c}`).join("; ") : v;
    return `<li><strong>${escapeHtml(k)}</strong>: ${escapeHtml(val)}</li>`;
  });
  return items.length ? `<ul>${items.join("")}</ul>` : "<p>None</p>";
}

export function buildManifest(i: Intake, r: OrchestrationResult): WorkItemManifest {
  const e = escapeHtml;
  const active = r.agent_results.filter((x) => x.status !== "SKIPPED");
  const rows = r.agent_results.map((x) => `<tr><td>${e(AGENT_LABELS[x.agent_type])}</td><td>${e(x.status)}</td><td>${e(x.review_system)}</td></tr>`).join("");
  const epicHtml = `<h2>${e(i.initiative_name)}</h2><table><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>`
    + `<tr><td>Type</td><td>${e(i.initiative_type)}</td></tr><tr><td>Application</td><td>${e(i.application_ci_id)}</td></tr>`
    + `<tr><td>Sponsor</td><td>${e(i.sponsor_email)}</td></tr><tr><td>Target go-live</td><td>${e(i.target_go_live)}</td></tr>`
    + `<tr><td>Overall status</td><td>${e(r.overall_status)}</td></tr><tr><td>STP eligible</td><td>${r.straight_through_eligible ? "Yes" : "No"}</td></tr>`
    + `<tr><td>Coverage</td><td>${e(r.coverage_pct)}% (${r.questions_replaced_count}/${r.questions_raw_count} questions)</td></tr></tbody></table>`
    + `<h3>Rationale</h3><p>${e(i.description)}</p><h3>Agent summary</h3><table><thead><tr><th>Agent</th><th>Status</th><th>Review system</th></tr></thead><tbody>${rows}</tbody></table>`
    + (r.notes.length ? `<h3>Synthesis notes</h3><ul>${r.notes.map((x) => `<li>${e(x)}</li>`).join("")}</ul>` : "");
  const children = active.map((ev) => {
    const controls = ev.control_refs.map((c) => `<li>${e(c.control)} - ${e(c.control_description)} <em>(${e(c.system)})</em></li>`).join("");
    const acts = ev.activities.map((a) => `<li>${e(a.title)}: ${e(a.description)}${a.source_ticket ? ` [${e(a.source_ticket)}]` : ""}</li>`).join("");
    const follow = ev.follow_up_questions.map((q) => `<li>${e(q)}</li>`).join("");
    const open = ev.status === "NEEDS_REVIEW" || ev.status === "FLAGGED";
    return {
      kind: "feature" as const, agent_type: ev.agent_type, title: `${AGENT_LABELS[ev.agent_type]} governance`,
      description_html: `<h3>${e(AGENT_LABELS[ev.agent_type])} - ${e(ev.status)}</h3><p>${e(ev.rationale)}</p><p><strong>Review system:</strong> ${e(ev.review_system)}</p>`
        + `<h4>Controls</h4><ul>${controls || "<li>None</li>"}</ul><h4>Activities</h4><ul>${acts || "<li>None</li>"}</ul>`
        + (follow ? `<h4>Open follow-ups</h4><ul>${follow}</ul>` : "") + `<h4>Derived fields (read-only)</h4>${derivedList(ev.derived_fields)}`,
      children: [
        ...ev.activities.map((a) => ({ kind: "task" as const, title: a.title,
          description_html: `<p>${e(a.description)}</p>` + (a.control_ref || a.source_ticket ? `<p>Control: ${e(a.control_ref)} | Ticket: ${e(a.source_ticket)}</p>` : "") })),
        ...(open ? ev.follow_up_questions.map((q) => ({ kind: "task" as const, title: `Answer: ${q.slice(0, 120)}`, description_html: `<p>${e(q)}</p>` })) : []),
      ],
    };
  });
  return { epic: { kind: "epic", title: `[Aura] ${i.initiative_name}`, description_html: epicHtml }, children,
    counts: { features: children.length, tasks: children.reduce((acc, c) => acc + c.children.length, 0) } };
}

// ---------- design-document extraction (mirrors MockLlmClient._si_design) ----------
export function extractSiDesign(text: string) {
  const low = text.toLowerCase();
  const cross = ["cross-border", "overseas", "offshore", "eu region", "us region", "international"].some((k) => low.includes(k));
  let vendors = ["AnalyticsCloud Inc", "TokenVault Ltd", "IdentityCo", "ModelHost Corp"].filter((v) => low.includes(v.toLowerCase()));
  if (!vendors.length && ["vendor", "third party", "third-party"].some((k) => low.includes(k))) vendors = ["Unnamed SaaS Provider"];
  const cls = low.includes("restricted") ? "RESTRICTED" : low.includes("confidential") || low.includes("customer") ? "CONFIDENTIAL" : "INTERNAL";
  return {
    architecture: { pattern: low.includes("event") ? "EVENT_DRIVEN" : "MICROSERVICES",
      components: ["API Gateway", "Service Layer", "Data Store", ...(low.includes("event") ? ["Message Bus"] : [])],
      hosting: low.includes("cloud") ? "PUBLIC_CLOUD" : "ON_PREM" },
    data_flows: [
      { name: "Customer records sync", source: "Service Layer", destination: "Analytics Store", classification: cls, cross_border: cross },
      { name: "Audit log export", source: "Service Layer", destination: "Log Archive", classification: "INTERNAL", cross_border: false },
    ],
    third_parties: vendors,
    controls: ["TLS 1.2+", "Role-based access control", ...(low.includes("encrypt") ? ["Field-level encryption"] : [])],
    summary: `Extracted ${text.split(/\s+/).filter(Boolean).length} words of design content.`,
  };
}

// ---------- detect (mirrors app/nlp/detect.py) ----------
const TYPE_KEYWORDS: Record<string, string[]> = {
  AI_INITIATIVE: ["ai", "ml", "machine learning", "model", "llm", "copilot", "chatbot", "classifier", "computer vision", "genai"],
  CLOUD: ["cloud", "saas", "migrate to", "migration", "kubernetes", "serverless", "aws", "azure", "gcp"],
  REGULATORY: ["regulator", "regulatory", "compliance", "mandate", "reporting requirement", "legislation"],
  NEW_SERVICE: ["new service", "launch", "new product", "new journey", "greenfield", "new app"],
  TECH_CHANGE: ["upgrade", "patch", "refactor", "replace", "migrate", "tls", "library", "infrastructure", "change"],
};
const FLAG_KEYWORDS: Record<string, string[]> = {
  internet_facing: ["public", "internet", "website", "customer portal", "public api", "web app"],
  external_facing: ["partner", "external", "third-party api", "open api"],
  handles_payment_data: ["payment", "card", "pci", "checkout", "pan"],
  personal_data_processed: ["personal data", "pii", "customer data", "employee data", "customer records", "email address"],
  sensitive_personal_data_processed: ["health", "biometric", "ethnicity", "religion", "sensitive data", "medical"],
  cross_border_data_transfer: ["cross-border", "cross border", "overseas", "offshore", "international transfer", "another region"],
  ai_ml_component_present: ["ai", "ml", "machine learning", "model", "llm", "neural", "classifier"],
  biometric_data: ["biometric", "face recognition", "facial", "fingerprint", "voiceprint"],
  third_party_vendor_involved: ["vendor", "third party", "third-party", "supplier", "saas provider"],
  new_pipeline_required: ["new pipeline", "ci/cd", "build pipeline", "deployment pipeline"],
  outage_expected: ["outage", "downtime", "maintenance window", "service interruption"],
  customer_impacting: ["customers", "customer-facing", "customer impact", "end users"],
  important_business_service: ["critical service", "important business service", "core banking", "payments"],
  disaster_recovery_required: ["disaster recovery", "failover", "dr test", "dr "],
};
const escRe = (k: string) => k.trim().replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const matches = (text: string, kws: string[]) => kws.filter((k) => new RegExp(`(?<![a-z0-9])${escRe(k)}(?![a-z0-9])`).test(text));

export function detect(text: string): DetectResult {
  const low = text.toLowerCase();
  const types = Object.keys(TYPE_KEYWORDS);
  const scores = Object.fromEntries(types.map((t) => [t, matches(low, TYPE_KEYWORDS[t]).length])) as Record<string, number>;
  const best = types.reduce((a, t) => (scores[t] > scores[a] ? t : a), types[0]);
  const total = Object.values(scores).reduce((a, c) => a + c, 0);
  const flags: Record<string, boolean> = {};
  const matched: Record<string, string[]> = {};
  Object.entries(FLAG_KEYWORDS).forEach(([field, kws]) => {
    const hits = matches(low, kws);
    if (hits.length) {
      flags[field] = true;
      matched[field] = hits;
    }
  });
  return { initiative_type: (scores[best] > 0 ? best : "TECH_CHANGE") as DetectResult["initiative_type"],
    confidence: total ? Math.round((100 * scores[best]) / total) / 100 : 0.2, type_scores: scores, flags, matched_keywords: matched };
}

// ---------- chat routing (mirrors MockLlmClient.chat_with_tools) ----------
const CHAT_ROUTES: [string[], string][] = [
  [["follow", "pending", "question", "answer", "todo", "outstanding"], "list_follow_ups"],
  [["cmdb", "ci ", "rto", "rpo", "config item", "application"], "get_cmdb_record"],
  [["coverage", "replaced", "how many questions"], "get_coverage"],
  [["deadline", "due", "late", "overdue", "date", "when"], "get_stage_deadlines"],
  [["why", "status", "blocked", "risk", "stp", "straight"], "explain_status"],
];
const AGENT_KEYWORDS: [AgentType, string[]][] = [
  ["security", ["security", "secur", "pen test", "auth"]], ["privacy", ["privacy", "personal data", "gdpr", "dra"]],
  ["ai_ethics", ["ai", "ethic", "model", "biometric"]], ["architecture", ["architecture", "capability", "sla", "growth"]],
  ["resilience", ["resilience", "ibs", "disaster", "recovery"]], ["release", ["release", "change", "backout", "outage"]],
  ["clarity", ["portfolio", "impact", "investment"]], ["scoping", ["scope", "scoping", "track"]],
];

export function planChatTools(message: string): { tool: string; args: Record<string, unknown> }[] {
  const q = `${message.toLowerCase()} `;
  const plan: { tool: string; args: Record<string, unknown> }[] = [];
  const agent = AGENT_KEYWORDS.find(([, kws]) => kws.some((k) => new RegExp(`\\b${escRe(k)}`).test(q)))?.[0];
  if (agent) plan.push({ tool: "get_agent_result", args: { agent_type: agent } });
  CHAT_ROUTES.forEach(([kws, tool]) => {
    if (kws.some((k) => q.includes(k)) && !plan.some((p) => p.tool === tool)) plan.push({ tool, args: {} });
  });
  return plan.length ? plan : [{ tool: "explain_status", args: {} }];
}

export function summariseTool(tool: string, data: Record<string, unknown>): string {
  if ("error" in data) return `- ${tool}: ${data.error}`;
  switch (tool) {
    case "get_agent_result": {
      const fu = (data.follow_up_questions as string[]) ?? [];
      return `- ${data.agent_label} agent is ${data.status}: ${data.rationale}` + (fu.length ? ` (${fu.length} follow-up question(s) outstanding)` : "");
    }
    case "list_follow_ups": {
      const items = (data.open as { agent_type: string; question: string }[]) ?? [];
      if (!items.length) return "- There are no outstanding follow-up questions.";
      return [`- ${items.length} follow-up question(s) awaiting an answer:`, ...items.slice(0, 8).map((x) => `  - [${x.agent_type}] ${x.question}`)].join("\n");
    }
    case "get_cmdb_record": {
      const r = data.record as Record<string, unknown> | null;
      if (!r) return "- No CMDB record is linked to this initiative.";
      return `- CMDB: ${r.ci_id} ${r.app_name} (owner ${r.owner}), IBS=${r.ibs ? "True" : "False"}, RTO ${r.rto_hours}h / RPO ${r.rpo_hours}h, risk band ${r.risk_band}.`;
    }
    case "get_coverage":
      return `- Coverage is ${data.coverage_pct}%: ${data.answered_questions} of ${data.total_questions} legacy questions answered across ${data.systems_replaced} systems.`;
    case "explain_status":
      return `- Status is ${data.status_label} (${data.status}). ${((data.reasons as string[]) ?? []).join(" ")}`;
    case "get_stage_deadlines": {
      const rows = (data.deadlines as { stage: string; due_date: string }[]) ?? [];
      const due = rows.find((r) => r.stage === data.current_stage)?.due_date;
      return `- Current stage ${data.current_stage} is due ${due}. ${rows.map((r) => `${r.stage}: ${r.due_date}`).join(", ")}`;
    }
    default:
      return `- ${tool}: ${JSON.stringify(data).slice(0, 200)}`;
  }
}

export type ChatToolRunner = (tool: string, args: Record<string, unknown>) => Record<string, unknown>;

export function runChat(message: string, runTool: ChatToolRunner): { answer: string; tool_trace: ToolTraceItem[] } {
  const trace: ToolTraceItem[] = [];
  const parts = planChatTools(message).map(({ tool, args }) => {
    const data = runTool(tool, args);
    const content = JSON.stringify(data);
    trace.push({ tool, arguments: args, result_preview: content.slice(0, 300) });
    return summariseTool(tool, data);
  });
  return { answer: parts.join("\n"), tool_trace: trace };
}
