import { AgentBadge } from "../../components/StatusBadge";
import { SystemBadge } from "../../components/systemIcons";
import type { AgentEvidence } from "../../types";
import { AGENT_LABELS } from "../../types";

export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "-";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length ? v.map(formatValue).join(", ") : "-";
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${formatValue(x)}`).join(" · ");
  return String(v);
}

const isUrl = (v: unknown) => typeof v === "string" && /^https:\/\/[a-z0-9.-]+\.example\.com\//i.test(v);

/** Derived fields are computed by the agent from intake + mocked systems and are intentionally read-only. */
export function DerivedFields({ fields }: { fields: Record<string, unknown> }) {
  const flat = Object.entries(fields).filter(([, v]) => !(v && typeof v === "object" && !Array.isArray(v)));
  const nested = Object.entries(fields).filter(([, v]) => v && typeof v === "object" && !Array.isArray(v));
  return (
    <div className="readonly-field" aria-readonly="true">
      <dl className="kv">
        {flat.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{k.replace(/_/g, " ")}</dt>
            <dd>{isUrl(v) ? <a href={String(v)} target="_blank" rel="noreferrer">{String(v)}</a> : formatValue(v)}</dd>
          </div>
        ))}
      </dl>
      {nested.map(([k, v]) => (
        <details key={k}>
          <summary>{k.replace(/_/g, " ")}</summary>
          <dl className="kv">
            {Object.entries(v as Record<string, unknown>).map(([q, a]) => (
              <div key={q} style={{ display: "contents" }}><dt>{q}</dt><dd>{formatValue(a)}</dd></div>
            ))}
          </dl>
        </details>
      ))}
    </div>
  );
}

export default function EvidenceCard({ ev, id }: { ev: AgentEvidence; id?: string }) {
  const others = Array.from(new Set([...ev.source_systems_consulted, ...ev.control_refs.map((c) => c.system)])).filter((s) => s !== ev.review_system);
  return (
    <div className={`card agent-card st-${ev.status}`} id={id}>
      <div className="card-title">
        <h3>{AGENT_LABELS[ev.agent_type]}</h3>
        <div className="row">
          {!ev.not_applicable && <span className="small muted">confidence {Math.round(ev.confidence * 100)}%</span>}
          <AgentBadge status={ev.status} />
        </div>
      </div>
      <p style={{ marginTop: 0 }}>{ev.rationale}</p>
      {!ev.not_applicable && (
        <div className="stack">
          <div className="row">
            {ev.review_system && <SystemBadge name={ev.review_system} primary />}
            {others.map((s) => <SystemBadge key={s} name={s} />)}
          </div>
          {Object.keys(ev.derived_fields).length > 0 && (
            <details open>
              <summary>Derived fields (read-only)</summary>
              <DerivedFields fields={ev.derived_fields} />
            </details>
          )}
          {ev.control_refs.length > 0 && (
            <details>
              <summary>Control references ({ev.control_refs.length})</summary>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Control</th><th>Description</th><th>Source</th><th>System</th></tr></thead>
                  <tbody>
                    {ev.control_refs.map((c) => (
                      <tr key={c.control + c.system}><td className="mono">{c.control}</td><td>{c.control_description}</td><td className="small muted">{c.control_source_document}</td><td><SystemBadge name={c.system} /></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          {ev.activities.length > 0 && (
            <div>
              <strong>Activities</strong>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Activity</th><th>Description</th><th>Control</th><th>Ticket</th></tr></thead>
                  <tbody>
                    {ev.activities.map((a) => (
                      <tr key={a.title + a.source_ticket}><td>{a.title}</td><td>{a.description}</td><td className="mono">{a.control_ref ?? "-"}</td><td className="mono">{a.source_ticket ?? "-"}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {ev.follow_up_questions.length > 0 && (
            <div>
              <strong>Follow-up questions</strong>
              <ul style={{ margin: "4px 0 0" }}>{ev.follow_up_questions.map((q) => <li key={q}>{q}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
