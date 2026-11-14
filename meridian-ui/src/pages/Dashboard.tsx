import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { BarList, Donut, Gauge, STATUS_COLORS } from "../components/Charts";
import Icon, { type IconName } from "../components/Icon";
import Loading, { ErrorBox } from "../components/Loading";
import { AGENT_STATUS_LABEL, agentTone } from "../components/StatusBadge";
import SystemFlowAnimation from "../components/SystemFlowAnimation";
import type { AgentStatus, Metrics } from "../types";
import { AGENT_LABELS, AGENT_ORDER, STAGES, STATUS_LABELS } from "../types";

// REVIEWED shares the "ok" tone with AUTO_APPROVED, so the two are drawn as one "Approved" segment.
const SEGMENTS: { label: string; tone: string; statuses: AgentStatus[] }[] = [
  { label: "Approved", tone: "ok", statuses: ["AUTO_APPROVED", "REVIEWED"] },
  { label: AGENT_STATUS_LABEL.NEEDS_REVIEW, tone: agentTone("NEEDS_REVIEW"), statuses: ["NEEDS_REVIEW"] },
  { label: AGENT_STATUS_LABEL.FLAGGED, tone: agentTone("FLAGGED"), statuses: ["FLAGGED", "FAILED"] },
  { label: AGENT_STATUS_LABEL.SKIPPED, tone: "neutral", statuses: ["SKIPPED"] },
];

export default function Dashboard() {
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    api.metrics().then(setM).catch(setError);
  }, []);
  if (error) return <ErrorBox error={error} />;
  if (!m) return <Loading />;

  const kpis: { label: string; value: string | number; hint: string; icon: IconName; tone?: string }[] = [
    { label: "Initiatives", value: m.total_intakes, hint: `${m.assessed_intakes} assessed`, icon: "layers" },
    { label: "Straight-through", value: `${m.stp_pct}%`, hint: `${m.stp_eligible} STP eligible`, icon: "bolt", tone: "ok" },
    { label: "Average coverage", value: `${m.avg_coverage_pct}%`, hint: `of ${m.questions_master_total} legacy questions`, icon: "shield", tone: "info" },
    { label: "Questions replaced", value: m.questions_replaced_total, hint: `about ${m.estimated_hours_saved} hours saved`, icon: "check" },
    { label: "Open reviews", value: m.open_reviews, hint: "agent follow-ups pending", icon: "inbox", tone: m.open_reviews ? "warn" : "ok" },
  ];
  const manual = m.assessed_intakes - m.stp_eligible;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Governance overview</h1>
          <p>One smart intake replaces about {m.questions_master_total} questions spread across 11 systems.</p>
        </div>
        <Link className="btn btn-primary" to="/intake/new"><Icon name="plus" />New intake</Link>
      </div>

      <div className="grid grid-kpi">
        {kpis.map((k) => (
          <div className="card kpi" key={k.label}>
            <span className={`kpi-icon ${k.tone ? `tone-${k.tone}` : ""}`}><Icon name={k.icon} size={18} /></span>
            <div>
              <div className="label">{k.label}</div>
              <div className="value">{k.value}</div>
              <div className="hint">{k.hint}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-3 section">
        <div className="card">
          <div className="card-title"><h2>Initiatives by stage</h2></div>
          <BarList data={STAGES.map((s) => ({ label: s, value: m.by_stage[s] ?? 0 }))} />
        </div>
        <div className="card">
          <div className="card-title"><h2>Delivery status</h2></div>
          <Donut data={(Object.keys(STATUS_LABELS) as (keyof typeof STATUS_LABELS)[]).map((s) => ({ label: STATUS_LABELS[s], value: m.by_status[s] ?? 0, color: STATUS_COLORS[s] }))} />
        </div>
        <div className="card">
          <div className="card-title"><h2>Question coverage</h2></div>
          <div style={{ textAlign: "center" }}><Gauge value={m.avg_coverage_pct} label="answered automatically" /></div>
          <BarList max={Math.max(1, m.assessed_intakes)} data={[
            { label: "Straight-through", value: m.stp_eligible, color: "var(--ok)" },
            { label: "Manual path", value: manual, color: "var(--warn)" },
          ]} />
        </div>
      </div>

      <div className="grid grid-2 section">
        <div className="card">
          <div className="card-title">
            <h2>Agent outcomes</h2>
            <div className="legend">
              {SEGMENTS.map((s) => <span key={s.label}><span className={`dot tone-${s.tone}`} />{s.label}</span>)}
            </div>
          </div>
          {AGENT_ORDER.map((a) => {
            const dist = m.agent_status_distribution[a] ?? {};
            const segs = SEGMENTS.map((s) => ({ ...s, value: s.statuses.reduce((n, st) => n + (dist[st] ?? 0), 0) })).filter((s) => s.value > 0);
            return (
              <div className="stack-row" key={a}>
                <span className="muted">{AGENT_LABELS[a]}</span>
                <div className="stack-bar" role="img" aria-label={`${AGENT_LABELS[a]}: ${segs.map((s) => `${s.value} ${s.label}`).join(", ") || "no results"}`}>
                  {segs.map((s) => (
                    <span key={s.label} className={`seg-${s.tone}`} style={{ flexGrow: s.value }} title={`${s.label}: ${s.value}`}>{s.value}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="card">
          <div className="card-title"><h2>Connected systems</h2><span className="small muted">all integrations mocked</span></div>
          <SystemFlowAnimation />
        </div>
      </div>
    </>
  );
}
