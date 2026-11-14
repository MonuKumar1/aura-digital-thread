import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { getUser } from "../auth";
import Icon from "../components/Icon";
import { ErrorBox } from "../components/Loading";
import { SystemBadge } from "../components/systemIcons";
import { humanize } from "../format";
import { SECTIONS, canonicalFields, fixtures } from "../mocks/data";
import { applicableAgents, coverage, skippedEvidence } from "../mocks/engine";
import type { AgentEvidence, CanonicalField, CmdbRecord, DetectResult, FieldValue, IntakeFields, PortfolioRecord } from "../types";
import { AGENT_LABELS, AGENT_ORDER } from "../types";

type Values = Record<string, FieldValue>;

// Smart form: dependent fields only appear when their parent answer makes them relevant.
const SHOW_WHEN: Record<string, (v: Values) => boolean> = {
  transfer_destinations: (v) => Boolean(v.cross_border_data_transfer),
  vendor_name: (v) => Boolean(v.third_party_vendor_involved),
  outage_duration_minutes: (v) => Boolean(v.outage_expected),
  customers_impacted_count: (v) => Boolean(v.customer_impacting),
  lawful_basis: (v) => Boolean(v.personal_data_processed || v.sensitive_personal_data_processed),
  data_retention_months: (v) => Boolean(v.personal_data_processed || v.sensitive_personal_data_processed),
  data_subjects_band: (v) => Boolean(v.personal_data_processed || v.sensitive_personal_data_processed),
  ...Object.fromEntries(canonicalFields.filter((f) => f.section === "AI" && f.id !== "ai_ml_component_present").map((f) => [f.id, (v: Values) => Boolean(v.ai_ml_component_present)])),
};

const CMDB_MAP: Record<string, keyof CmdbRecord> = {
  rto_hours: "rto_hours", rpo_hours: "rpo_hours", cloud_service_type: "cloud_service_type", target_environment: "target_environment",
  architecture_pattern: "architecture_pattern", business_unit: "domain", important_business_service: "ibs",
};
const PORTFOLIO_MAP: Record<string, keyof PortfolioRecord> = {
  portfolio_id: "portfolio_id", budget_band: "budget_band", regulatory_notification_required: "regulatory_notification_required",
};

function initialValues(email: string): Values {
  const v: Values = Object.fromEntries(canonicalFields.map((f) => [f.id, f.type === "boolean" ? false : ""]));
  return { ...v, initiative_type: "TECH_CHANGE", sponsor_email: email, implementation_method: "AUTOMATED_PIPELINE", authentication_method: "SSO", encryption_in_transit: true, encryption_at_rest: true };
}

function toPayload(values: Values): Partial<IntakeFields> {
  const out: Record<string, FieldValue> = {};
  for (const f of canonicalFields) {
    const raw = values[f.id];
    if (f.type === "boolean") out[f.id] = Boolean(raw);
    else if (raw === "" || raw === null || raw === undefined) out[f.id] = null;
    else if (f.type === "number") out[f.id] = Number(raw);
    else out[f.id] = typeof raw === "string" ? raw.trim() : raw;
  }
  return out as Partial<IntakeFields>;
}

export default function IntakeForm() {
  const navigate = useNavigate();
  const user = getUser();
  const [values, setValues] = useState<Values>(() => initialValues(user?.email ?? ""));
  const [step, setStep] = useState(0);
  const [autofilled, setAutofilled] = useState<Record<string, string>>({});
  const [cmdb, setCmdb] = useState<CmdbRecord | null>(null);
  const [lookupMsg, setLookupMsg] = useState("");
  const [freeText, setFreeText] = useState("");
  const [detected, setDetected] = useState<DetectResult | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const steps = [...SECTIONS, "Review"];

  const set = (id: string, value: FieldValue) => {
    setValues((v) => ({ ...v, [id]: value }));
    setAutofilled((a) => {
      if (!(id in a)) return a;
      const { [id]: _drop, ...rest } = a;
      return rest;
    });
  };

  // Live counter: same coverage rule as the backend, assuming every applicable agent runs.
  const live = useMemo(() => {
    const payload = toPayload(values);
    const applicable = applicableAgents(payload);
    const projected = AGENT_ORDER.map((a): AgentEvidence => (applicable[a] ? { ...skippedEvidence(a), status: "PENDING", not_applicable: false } : skippedEvidence(a)));
    return { report: coverage(payload, projected), applicable };
  }, [values]);

  async function lookupCi() {
    const ci = String(values.application_ci_id ?? "").trim().toUpperCase();
    if (!/^CI-\d{4}$/.test(ci)) return setLookupMsg("Enter a CI ID like CI-1001.");
    setLookupMsg("Looking up CMDB and Portfolio…");
    try {
      const [rec, inv] = await Promise.all([api.cmdbLookup(ci), api.portfolioLookup(ci)]);
      if (!rec) {
        setCmdb(null);
        return setLookupMsg(`${ci} was not found in the CMDB.`);
      }
      const filled: Record<string, string> = {};
      const next: Values = { ...values, application_ci_id: ci };
      const apply = (field: string, value: unknown, source: string) => {
        if (value === undefined || value === null) return;
        const current = next[field];
        if (current === "" || current === null || current === false) {
          next[field] = value as FieldValue;
          filled[field] = source;
        }
      };
      Object.entries(CMDB_MAP).forEach(([f, src]) => apply(f, rec[src], "CMDB"));
      if (inv) Object.entries(PORTFOLIO_MAP).forEach(([f, src]) => apply(f, inv[src], "Portfolio"));
      setValues(next);
      setAutofilled((a) => ({ ...a, ...filled }));
      setCmdb(rec);
      setLookupMsg(`Auto-derived ${Object.keys(filled).length} field(s) from ${rec.app_name}.`);
    } catch (e) {
      setLookupMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function analyse() {
    if (freeText.trim().length < 3) return;
    try {
      const res = await api.detect(freeText);
      setDetected(res);
      const filled: Record<string, string> = { initiative_type: "Detected" };
      setValues((v) => {
        const next: Values = { ...v, initiative_type: res.initiative_type };
        Object.keys(res.flags).forEach((f) => {
          next[f] = true;
          filled[f] = "Detected";
        });
        if (!String(v.description ?? "").trim()) next.description = freeText.trim().slice(0, 4000);
        return next;
      });
      setAutofilled((a) => ({ ...a, ...filled }));
    } catch (e) {
      setError(e);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (String(values.initiative_name ?? "").trim().length < 3) {
      setStep(0);
      return setError(new Error("Initiative name must be at least 3 characters."));
    }
    setBusy(true);
    try {
      const created = await api.createIntake({ ...toPayload(values), created_by: user?.email ?? null } as Partial<IntakeFields>);
      if (file) await api.uploadDesignDocument(created.id, file);
      navigate(`/results/${created.id}?run=1`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const sectionFields = (section: string) => canonicalFields.filter((f) => f.section === section && (SHOW_WHEN[f.id]?.(values) ?? true));
  const section = SECTIONS[step];
  const fields = section ? sectionFields(section) : [];
  const inputs = fields.filter((f) => f.type !== "boolean");
  const toggles = fields.filter((f) => f.type === "boolean");
  // Sections that are mostly yes/no lead with the switches, because switching one on reveals the detail fields below.
  const all = canonicalFields.filter((f) => f.section === section);
  const togglesFirst = all.filter((f) => f.type === "boolean").length >= all.length / 2;
  const renderField = (f: CanonicalField) => (
    <FieldInput key={f.id} field={f} value={values[f.id]} source={autofilled[f.id]} onChange={(v) => set(f.id, v)}
      onBlur={f.id === "application_ci_id" ? lookupCi : undefined} />
  );
  const toggleBlock = toggles.length > 0 && (
    <div className="form-block" key="toggles">
      <div className="section-label">Yes / no</div>
      <div className="toggle-grid">{toggles.map(renderField)}</div>
    </div>
  );
  const inputBlock = inputs.length > 0 && (
    <div className="form-block" key="inputs">
      {toggles.length > 0 && <div className="section-label">Details</div>}
      <div className="form-grid">{inputs.map(renderField)}</div>
    </div>
  );
  const flags = detected ? Object.keys(detected.flags) : [];

  return (
    <form onSubmit={submit}>
      <div className="page-head">
        <div><h1>New intake</h1><p>Answer once. Aura Digital Thread derives which assessments apply and fills the rest from connected systems.</p></div>
      </div>

      <div className="card assist" style={{ marginBottom: 24 }}>
        <span className="kpi-icon"><Icon name="sparkle" size={18} /></span>
        <div className="assist-body">
          <h2>Describe your change</h2>
          <p className="muted">Optional. A sentence or two lets Aura suggest the initiative type and switch on the relevant risk flags for you.</p>
          <textarea value={freeText} maxLength={8000} onChange={(e) => setFreeText(e.target.value)} aria-label="Describe your change"
            placeholder="e.g. Launch a public web app that uses an ML model to score card payments for customers, hosted by a SaaS vendor in another region." />
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" onClick={analyse} disabled={freeText.trim().length < 3}>Analyse and prefill</button>
            {detected && (
              <>
                <span className="badge badge-accent">{humanize(detected.initiative_type)} · {Math.round(detected.confidence * 100)}%</span>
                {flags.map((f) => <span key={f} className="badge badge-info">{humanize(f)}</span>)}
                {!flags.length && <span className="small muted">No risk flags detected</span>}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="wizard">
        <div className="wizard-side">
          <div className="wizard-steps">
            {steps.map((s, i) => (
              <button type="button" key={s} className={i === step ? "active" : i < step ? "done" : ""} aria-current={i === step ? "step" : undefined} onClick={() => setStep(i)}>
                <span className="step-num">{i < step ? <Icon name="check" size={13} /> : i + 1}</span>{s}
              </button>
            ))}
          </div>
          <div className="card coverage-card" aria-live="polite">
            <div className="section-label">Legacy questions replaced</div>
            <div className="big">{live.report.answered_questions} <span>of {live.report.total_questions}</span></div>
            <div className="bar"><span style={{ width: `${live.report.coverage_pct}%` }} /></div>
            <div className="small muted">{live.report.coverage_pct}% coverage · {live.report.systems_replaced} of {live.report.systems_total} systems</div>
          </div>
        </div>

        <div className="card">
          {section ? (
            <>
              <div className="card-title"><h2>{section}</h2><span className="small muted">Step {step + 1} of {steps.length}</span></div>
              {section === "Basics" && (
                <div className="info-box" style={{ marginBottom: 20 }}>
                  <div className="row">
                    <strong>Have a CI ID?</strong><span>Autofill from CMDB and Portfolio.</span>
                    <span className="spacer" />
                    <select style={{ maxWidth: 240 }} value="" aria-label="Sample CI" onChange={(e) => e.target.value && set("application_ci_id", e.target.value)}>
                      <option value="">Pick a sample CI…</option>
                      {fixtures.cmdb.map((c) => <option key={c.ci_id} value={c.ci_id}>{c.ci_id} · {c.app_name}</option>)}
                    </select>
                    <button type="button" onClick={lookupCi}>Look up</button>
                  </div>
                  {lookupMsg && <div className="small" style={{ marginTop: 8 }}>{lookupMsg}</div>}
                  {cmdb && (
                    <div className="small" style={{ marginTop: 4 }}>
                      {cmdb.app_name} · owner {cmdb.owner} · {cmdb.domain}/{cmdb.sub_domain} · {cmdb.entry_point_url} ({cmdb.ip}) · risk {cmdb.risk_band}
                    </div>
                  )}
                </div>
              )}
              {togglesFirst ? [toggleBlock, inputBlock] : [inputBlock, toggleBlock]}
            </>
          ) : (
            <>
              <div className="card-title"><h2>Review and submit</h2><span className="small muted">Step {step + 1} of {steps.length}</span></div>
              <div className="form-block">
                <div className="section-label">Agents that will run</div>
                <div className="row">
                  {AGENT_ORDER.map((a) => (
                    <span key={a} className={`badge ${live.applicable[a] ? "badge-accent" : "badge-neutral"}`}>{AGENT_LABELS[a]}{live.applicable[a] ? "" : " · skipped"}</span>
                  ))}
                </div>
              </div>
              <div className="form-block">
                <div className="section-label">Systems you no longer need to fill in</div>
                <div className="row">
                  {live.report.per_system.filter((s) => s.answered > 0).map((s) => <SystemBadge key={s.system} name={s.system} />)}
                </div>
              </div>
              {Object.keys(autofilled).length > 0 && (
                <div className="form-block">
                  <div className="section-label">Filled in for you</div>
                  <div className="row">
                    {Object.entries(autofilled).map(([f, s]) => <span key={f} className="badge badge-info" title={`Source: ${s}`}>{humanize(f)}</span>)}
                  </div>
                </div>
              )}
              <div className="form-block">
                <label className="field">
                  <span>Solution design document (optional)</span>
                  <input type="file" accept=".txt,.pdf,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  <div className="field-help">.txt, .pdf or .docx up to 2 MB. Extracted data flows and third parties feed the security compound-risk check. Template: <a href={fixtures.wiki_design_template_url} target="_blank" rel="noreferrer">Wiki design template</a></div>
                </label>
              </div>
            </>
          )}
          {error ? <div style={{ marginTop: 16 }}><ErrorBox error={error} /></div> : null}
          <div className="wizard-actions">
            <button type="button" disabled={step === 0} onClick={() => setStep(step - 1)}><Icon name="arrowLeft" />Back</button>
            <span className="spacer" />
            {step < steps.length - 1 ? (
              <button type="button" className="btn-primary" onClick={() => setStep(step + 1)}>Next<Icon name="arrowRight" /></button>
            ) : (
              <button type="submit" className="btn-primary" disabled={busy}><Icon name="bolt" />{busy ? "Submitting…" : "Submit and run agents"}</button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

function FieldInput({ field, value, source, onChange, onBlur }: {
  field: CanonicalField; value: FieldValue; source?: string; onChange: (v: FieldValue) => void; onBlur?: () => void;
}) {
  const tag = source ? <span className="badge badge-info" style={{ marginLeft: 6 }}>{source}</span> : null;
  if (field.type === "boolean") {
    return (
      <label className={`toggle-row ${value ? "on" : ""} ${source ? "autofilled" : ""}`}>
        <span className="t-text">
          <span className="t-label">{field.label}{tag}</span>
          {field.help && <div className="field-help">{field.help}</div>}
        </span>
        <input type="checkbox" className="toggle" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
      </label>
    );
  }
  const common = { id: field.id, value: value === null || value === undefined ? "" : String(value), onBlur, required: field.required };
  return (
    <label className={`field ${source ? "autofilled" : ""} ${field.type === "textarea" ? "wide" : ""}`}>
      <span>{field.label}{field.required && " *"}{tag}</span>
      {field.type === "select" ? (
        <select {...common} onChange={(e) => onChange(e.target.value)}>
          {!field.required && <option value="">Select…</option>}
          {field.options?.map((o) => <option key={o} value={o}>{humanize(o)}</option>)}
        </select>
      ) : field.type === "textarea" ? (
        <textarea {...common} maxLength={4000} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} type={field.type === "number" ? "number" : field.type} maxLength={field.type === "text" || field.type === "email" ? 254 : undefined}
          min={field.type === "number" ? 0 : undefined} step={field.type === "number" ? "any" : undefined} onChange={(e) => onChange(e.target.value)} />
      )}
      <div className="field-help">{field.help}</div>
    </label>
  );
}
