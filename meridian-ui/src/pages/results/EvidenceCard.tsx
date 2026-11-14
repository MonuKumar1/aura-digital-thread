import { AGENT_STATUS_LABEL, AgentBadge, agentTone } from "../../components/StatusBadge";
import { SystemBadge } from "../../components/systemIcons";
import type { AgentEvidence, AgentType } from "../../types";
import { AGENT_LABELS } from "../../types";

export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "–";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length ? v.map(formatValue).join(", ") : "–";
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

export default function EvidenceCard({ ev, id, onReview }: { ev: AgentEvidence; id?: string; onReview?: () => void }) {
  const others = Array.from(new Set([...ev.source_systems_consulted, ...ev.control_refs.map((c) => c.system)])).filter((s) => s !== ev.review_system);
  const confidence = Math.round(ev.confidence * 100);
  return (
    <div className="card agent-card" id={id}>
      <div className="card-title">
        <h2>{AGENT_LABELS[ev.agent_type]}</h2>
        <div className="row">
          {!ev.not_applicable && (
            <span className="confidence" title="Agent confidence in this outcome">
              Confidence <span className="bar"><span style={{ width: `${confidence}%` }} /></span> <strong className="num">{confidence}%</strong>
            </span>
          )}
          <AgentBadge status={ev.status} />
        </div>
      </div>
      <p className="lead">{ev.rationale}</p>
      {!ev.not_applicable && (
        <>
          {ev.follow_up_questions.length > 0 && (
            <div className="warn-box block">
              <div className="row">
                <strong>{ev.follow_up_questions.length} follow-up question{ev.follow_up_questions.length > 1 ? "s" : ""}</strong>
                <span className="spacer" />
                {onReview && <button className="btn-sm" onClick={onReview}>Answer in Pending review</button>}
              </div>
              <ul>{ev.follow_up_questions.map((q) => <li key={q}>{q}</li>)}</ul>
            </div>
          )}
          {(ev.review_system || others.length > 0) && (
            <div className="block">
              <div className="section-label">Systems</div>
              <div className="row">
                {ev.review_system && <SystemBadge name={ev.review_system} primary />}
                {others.map((s) => <SystemBadge key={s} name={s} />)}
              </div>
            </div>
          )}
          {Object.keys(ev.derived_fields).length > 0 && (
            <div className="block">
              <div className="section-label">Derived fields (read-only)</div>
              <DerivedFields fields={ev.derived_fields} />
            </div>
          )}
          {ev.activities.length > 0 && (
            <div className="block">
              <div className="section-label">Activities</div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Activity</th><th>Description</th><th>Control</th><th>Ticket</th></tr></thead>
                  <tbody>
                    {ev.activities.map((a) => (
                      <tr key={a.title + a.source_ticket}><td className="cell-main">{a.title}</td><td>{a.description}</td><td className="mono nowrap">{a.control_ref ?? "–"}</td><td className="mono nowrap">{a.source_ticket ?? "–"}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {ev.control_refs.length > 0 && (
            <details className="block">
              <summary>Control references ({ev.control_refs.length})</summary>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Control</th><th>Description</th><th>Source</th><th>System</th></tr></thead>
                  <tbody>
                    {ev.control_refs.map((c) => (
                      <tr key={c.control + c.system}><td className="mono nowrap">{c.control}</td><td>{c.control_description}</td><td className="small muted">{c.control_source_document}</td><td><SystemBadge name={c.system} /></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

/** Master/detail view: pick an agent on the left, read its evidence on the right. */
export function EvidenceBrowser({ results, selected, onSelect, onReview }: {
  results: AgentEvidence[]; selected: AgentType; onSelect: (a: AgentType) => void; onReview: () => void;
}) {
  const current = results.find((r) => r.agent_type === selected) ?? results[0];
  if (!current) return null;
  return (
    <div className="md" id="evidence">
      <div className="card md-list" role="tablist" aria-label="Agents" aria-orientation="vertical">
        {results.map((r) => (
          <button key={r.agent_type} role="tab" aria-selected={r.agent_type === current.agent_type}
            className={`md-item ${r.agent_type === current.agent_type ? "active" : ""} ${r.not_applicable ? "na" : ""}`} onClick={() => onSelect(r.agent_type)}>
            <span className={`dot tone-${agentTone(r.status)}`} />
            <span className="md-text">
              <span className="md-name">{AGENT_LABELS[r.agent_type]}</span>
              <span className="md-sub">{AGENT_STATUS_LABEL[r.status]}</span>
            </span>
          </button>
        ))}
      </div>
      <EvidenceCard ev={current} onReview={onReview} />
    </div>
  );
}
