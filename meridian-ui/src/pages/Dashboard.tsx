import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { BarList, Donut, Funnel, Gauge, STATUS_COLORS } from "../components/Charts";
import Loading, { ErrorBox } from "../components/Loading";
import SystemFlowAnimation from "../components/SystemFlowAnimation";
import type { AgentStatus, Metrics } from "../types";
import { AGENT_LABELS, AGENT_ORDER, STAGES, STATUS_LABELS } from "../types";

const AGENT_COLS: AgentStatus[] = ["AUTO_APPROVED", "REVIEWED", "NEEDS_REVIEW", "FLAGGED", "SKIPPED"];
const CELL_TONE: Partial<Record<AgentStatus, string>> = { AUTO_APPROVED: "var(--ok)", REVIEWED: "var(--ok)", NEEDS_REVIEW: "var(--warn)", FLAGGED: "var(--bad)", SKIPPED: "var(--muted)" };

export default function Dashboard() {
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    api.metrics().then(setM).catch(setError);
  }, []);
  if (error) return <ErrorBox error={error} />;
  if (!m) return <Loading />;

  const kpis = [
    { label: "Initiatives", value: m.total_intakes, hint: `${m.assessed_intakes} assessed` },
    { label: "STP eligible", value: `${m.stp_pct}%`, hint: `${m.stp_eligible} straight-through` },
    { label: "Avg coverage", value: `${m.avg_coverage_pct}%`, hint: `of ${m.questions_master_total} legacy questions` },
    { label: "Questions replaced", value: m.questions_replaced_total, hint: `≈ ${m.estimated_hours_saved} hours saved` },
    { label: "Open reviews", value: m.open_reviews, hint: "agent follow-ups pending" },
  ];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Governance overview</h1>
          <p>One smart intake replaces ~{m.questions_master_total} questions spread across 11 systems.</p>
        </div>
        <Link className="btn btn-primary" to="/intake/new">+ New intake</Link>
      </div>
      <div className="grid grid-kpi">
        {kpis.map((k) => (
          <div className="card kpi" key={k.label}>
            <div className="label">{k.label}</div>
            <div className="value">{k.value}</div>
            <div className="hint">{k.hint}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-title"><h2>Stage funnel</h2></div>
          <Funnel data={STAGES.map((s) => ({ label: s, value: m.by_stage[s] ?? 0 }))} />
        </div>
        <div className="card">
          <div className="card-title"><h2>Status distribution</h2></div>
          <Donut data={(Object.keys(STATUS_LABELS) as (keyof typeof STATUS_LABELS)[]).map((s) => ({ label: STATUS_LABELS[s], value: m.by_status[s] ?? 0, color: STATUS_COLORS[s] }))} />
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div className="card-title"><h2>Question coverage</h2></div>
          <Gauge value={m.avg_coverage_pct} label="avg answered automatically" />
          <div className="small muted" style={{ marginTop: 8 }}>STP rate</div>
          <BarList data={[{ label: "Straight-through", value: m.stp_eligible, color: "var(--ok)" }, { label: "Manual path", value: m.assessed_intakes - m.stp_eligible, color: "var(--warn)" }]} max={Math.max(1, m.assessed_intakes)} />
        </div>
      </div>
      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-title"><h2>Agent outcomes</h2><span className="small muted">initiatives per status</span></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Agent</th>{AGENT_COLS.map((c) => <th key={c}>{c.replace("_", " ").toLowerCase()}</th>)}</tr></thead>
              <tbody>
                {AGENT_ORDER.map((a) => (
                  <tr key={a}>
                    <td>{AGENT_LABELS[a]}</td>
                    {AGENT_COLS.map((c) => {
                      const v = m.agent_status_distribution[a]?.[c] ?? 0;
                      return <td key={c} style={{ color: v ? CELL_TONE[c] : "var(--border)", fontWeight: v ? 700 : 400 }}>{v}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-title"><h2>Connected systems</h2><span className="small muted">all integrations mocked</span></div>
          <SystemFlowAnimation />
        </div>
      </div>
    </>
  );
}
