import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { getUser } from "../auth";
import { ErrorBox } from "../components/Loading";
import { SystemBadge } from "../components/systemIcons";
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

  return (
    <form onSubmit={submit}>
      <div className="page-head">
        <div><h1>New intake</h1><p>Answer once. Aura Digital Thread derives which assessments apply and fills the rest from connected systems.</p></div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title"><h2>Describe your change</h2><span className="small muted">keyword detection prefills type and risk flags</span></div>
        <textarea value={freeText} maxLength={8000} onChange={(e) => setFreeText(e.target.value)}
          placeholder="e.g. Launch a public web app that uses an ML model to score card payments for customers, hosted by a SaaS vendor in another region." />
        <div className="row" style={{ marginTop: 8 }}>
          <button type="button" onClick={analyse} disabled={freeText.trim().length < 3}>Analyse &amp; prefill</button>
          {detected && (
            <span className="small">
              Suggested <strong>{detected.initiative_type.replace("_", " ")}</strong> ({Math.round(detected.confidence * 100)}%) ·
              flags: {Object.keys(detected.flags).length ? Object.keys(detected.flags).join(", ") : "none"}
            </span>
          )}
        </div>
      </div>

      <div className="wizard">
        <div className="wizard-steps">
          {steps.map((s, i) => (
            <button type="button" key={s} className={i === step ? "active" : ""} onClick={() => setStep(i)}>
              <span className="num">{i + 1}</span>{s}
            </button>
          ))}
        </div>
        <div>
          <div className="card">
            {step < SECTIONS.length ? (
              <>
                <div className="card-title"><h2>{SECTIONS[step]}</h2></div>
                {SECTIONS[step] === "Basics" && (
                  <div className="info-box" style={{ marginBottom: 14 }}>
                    <div className="row">
                      <span>Have a CI ID? Autofill from CMDB &amp; Portfolio.</span>
                      <select style={{ maxWidth: 260 }} value="" onChange={(e) => e.target.value && set("application_ci_id", e.target.value)}>
                        <option value="">Pick a sample CI…</option>
                        {fixtures.cmdb.map((c) => <option key={c.ci_id} value={c.ci_id}>{c.ci_id} · {c.app_name}</option>)}
                      </select>
                      <button type="button" className="btn-sm" onClick={lookupCi}>Lookup</button>
                    </div>
                    {lookupMsg && <div className="small" style={{ marginTop: 6 }}>{lookupMsg}</div>}
                    {cmdb && (
                      <div className="small" style={{ marginTop: 6 }}>
                        {cmdb.app_name} · owner {cmdb.owner} · {cmdb.domain}/{cmdb.sub_domain} · {cmdb.entry_point_url} ({cmdb.ip}) · risk {cmdb.risk_band}
                      </div>
                    )}
                  </div>
                )}
                <div className="form-grid">
                  {sectionFields(SECTIONS[step]).map((f) => (
                    <FieldInput key={f.id} field={f} value={values[f.id]} source={autofilled[f.id]} onChange={(v) => set(f.id, v)}
                      onBlur={f.id === "application_ci_id" ? lookupCi : undefined} />
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="card-title"><h2>Review &amp; submit</h2></div>
                <div className="stack">
                  <div>
                    <strong>Agents that will run</strong>
                    <div className="row" style={{ marginTop: 6 }}>
                      {AGENT_ORDER.map((a) => (
                        <span key={a} className={`badge ${live.applicable[a] ? "badge-accent" : "badge-neutral"}`}>{AGENT_LABELS[a]}{live.applicable[a] ? "" : " (skipped)"}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <strong>Systems you no longer need to fill in</strong>
                    <div className="row" style={{ marginTop: 6 }}>
                      {live.report.per_system.filter((s) => s.answered > 0).map((s) => <SystemBadge key={s.system} name={s.system} />)}
                    </div>
                  </div>
                  <label className="field">
                    <span>Solution design document (optional)</span>
                    <input type="file" accept=".txt,.pdf,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                    <div className="field-help">.txt, .pdf or .docx up to 2 MB. Extracted data flows and third parties feed the security compound-risk check. Template: <a href={fixtures.wiki_design_template_url} target="_blank" rel="noreferrer">Wiki design template</a></div>
                  </label>
                  {Object.keys(autofilled).length > 0 && (
                    <div className="small muted">Auto-derived: {Object.entries(autofilled).map(([f, s]) => `${f} (${s})`).join(", ")}</div>
                  )}
                </div>
              </>
            )}
            <div className="row" style={{ marginTop: 18 }}>
              <button type="button" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
              <span className="spacer" />
              {step < steps.length - 1 ? (
                <button type="button" className="btn-primary" onClick={() => setStep(step + 1)}>Next</button>
              ) : (
                <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Submitting…" : "Submit & run agents"}</button>
              )}
            </div>
            <div style={{ marginTop: 10 }}><ErrorBox error={error} /></div>
          </div>
          <div className="counter" aria-live="polite">
            <span className="big">{live.report.answered_questions}</span>
            <span>of {live.report.total_questions} legacy questions replaced<br /><span className="small muted">across {live.report.systems_replaced} of {live.report.systems_total} systems</span></span>
            <span className="spacer" />
            <div style={{ width: 180 }}><div className="bar"><span style={{ width: `${live.report.coverage_pct}%` }} /></div></div>
            <strong>{live.report.coverage_pct}%</strong>
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
      <label className={`checkbox field ${source ? "autofilled" : ""}`} title={field.help}>
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        <span style={{ margin: 0 }}>{field.label}{tag}</span>
      </label>
    );
  }
  const common = { id: field.id, value: value === null || value === undefined ? "" : String(value), onBlur, required: field.required };
  return (
    <label className={`field ${source ? "autofilled" : ""} ${field.type === "textarea" ? "wide" : ""}`}>
      <span>{field.label}{field.required && " *"}{tag}</span>
      {field.type === "select" ? (
        <select {...common} onChange={(e) => onChange(e.target.value)}>
          {!field.required && <option value="">-</option>}
          {field.options?.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
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
