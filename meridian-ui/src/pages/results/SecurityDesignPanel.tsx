import { useState } from "react";
import { api } from "../../api";
import { ErrorBox } from "../../components/Loading";
import { AgentBadge } from "../../components/StatusBadge";
import { SystemBadge } from "../../components/systemIcons";
import type { Intake, OrchestrationResult } from "../../types";
import { DerivedFields } from "./EvidenceCard";

export default function SecurityDesignPanel({ intake, result, onIntake }: { intake: Intake; result: OrchestrationResult | null; onIntake: (i: Intake) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const sec = result?.agent_results.find((r) => r.agent_type === "security");
  const design = intake.si_design_evidence;
  const d = sec?.derived_fields ?? {};
  const compound = (d.compound_risks as string[] | undefined) ?? [];

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onIntake(await api.uploadDesignDocument(intake.id, file));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-title"><h2>Security Portal outcome</h2>{sec && <AgentBadge status={sec.status} />}</div>
        {!sec ? <p className="muted">Run the agents to see the Security Portal outcome.</p> : sec.not_applicable ? (
          <p className="muted">Security assessment is not applicable to this intake profile.</p>
        ) : (
          <div className="stack">
            <div className="row">
              <SystemBadge name="Security Portal" primary />
              {d.security_assessment_id ? (
                <>
                  <span className="badge badge-info">{String(d.security_assessment_id)}</span>
                  <span className={`badge ${d.security_portal_outcome === "APPROVED" ? "badge-ok" : "badge-warn"}`}>{String(d.security_portal_outcome)}</span>
                  <a className="small" href={String(d.security_portal_url)} target="_blank" rel="noreferrer">Open in portal</a>
                </>
              ) : <span className="small muted">No portal submission (low risk)</span>}
            </div>
            {sec.activities.length > 0 && (
              <table className="table">
                <thead><tr><th>Required control</th><th>Ticket</th></tr></thead>
                <tbody>{sec.activities.map((a) => <tr key={a.title}><td>{a.description}</td><td className="mono">{a.source_ticket}</td></tr>)}</tbody>
              </table>
            )}
            {compound.length > 0 && (
              <div className="error-box small"><strong>Compound risks from design evidence</strong><ul style={{ margin: "4px 0 0" }}>{compound.map((c) => <li key={c}>{c}</li>)}</ul></div>
            )}
            <details><summary>All security fields</summary><DerivedFields fields={d} /></details>
          </div>
        )}
      </div>
      <div className="card">
        <div className="card-title">
          <h2>SI design evidence</h2>
          <label className="btn btn-sm" style={{ cursor: "pointer" }}>
            {busy ? "Uploading…" : design ? "Replace document" : "Upload document"}
            <input type="file" accept=".txt,.pdf,.docx" hidden onChange={(e) => upload(e.target.files?.[0])} />
          </label>
        </div>
        <ErrorBox error={error} />
        {!design ? <p className="muted">Upload a solution design (.txt, .pdf, .docx ≤ 2 MB). Aura Digital Thread extracts data flows, third parties and controls, then re-run the agents to apply the compound-risk check.</p> : (
          <div className="stack small">
            <div className="muted">{design.source_filename} · {design.summary}</div>
            <div><strong>Architecture:</strong> {design.architecture.pattern} on {design.architecture.hosting} — {(design.architecture.components ?? []).join(", ")}</div>
            <table className="table">
              <thead><tr><th>Data flow</th><th>Route</th><th>Class</th><th>Cross-border</th></tr></thead>
              <tbody>
                {design.data_flows.map((f) => (
                  <tr key={f.name}><td>{f.name}</td><td>{f.source} → {f.destination}</td><td>{f.classification}</td><td>{f.cross_border ? <span className="badge badge-warn">Yes</span> : "No"}</td></tr>
                ))}
              </tbody>
            </table>
            <div><strong>Third parties:</strong> {design.third_parties.length ? design.third_parties.join(", ") : "none"}</div>
            <div><strong>Controls:</strong> {design.controls.join(", ")}</div>
            <div className="info-box">Re-run the agents to include this evidence in the security assessment.</div>
          </div>
        )}
      </div>
    </div>
  );
}
