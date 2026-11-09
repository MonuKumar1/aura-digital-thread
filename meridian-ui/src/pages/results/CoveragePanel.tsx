import { useEffect, useState } from "react";
import { api } from "../../api";
import { BarList, Gauge } from "../../components/Charts";
import Loading, { ErrorBox } from "../../components/Loading";
import type { CoverageReport, OrchestrationResult } from "../../types";
import { AGENT_LABELS } from "../../types";

export default function CoveragePanel({ result }: { result: OrchestrationResult }) {
  const [cov, setCov] = useState<CoverageReport | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    api.coverage(result.intake_id).then(setCov).catch(setError);
  }, [result.intake_id, result.generated_at]);
  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-title"><h2>Coverage</h2></div>
        <ErrorBox error={error} />
        {!cov ? <Loading /> : (
          <>
            <div style={{ textAlign: "center" }}><Gauge value={cov.coverage_pct} label={`${cov.answered_questions}/${cov.total_questions} questions answered`} /></div>
            <p className="small muted">Replaces input in {cov.systems_replaced} of {cov.systems_total} legacy systems.</p>
            <h3>Per agent</h3>
            <BarList max={100} data={cov.per_agent.map((a) => ({ label: `${AGENT_LABELS[a.agent_type]}${a.ran ? "" : " (skipped)"}`, value: a.pct, color: a.ran ? undefined : "var(--muted)" }))} />
            <h3 style={{ marginTop: 12 }}>Per system</h3>
            <BarList data={cov.per_system.map((s) => ({ label: s.system, value: s.answered }))} max={Math.max(...cov.per_system.map((s) => s.total))} />
          </>
        )}
      </div>
      <div className="card">
        <div className="card-title"><h2>Cross-agent synthesis</h2></div>
        <p className="small muted">One LLM pass across all agent outputs surfaces conflicts and correlations.</p>
        <ul className="stack" style={{ paddingLeft: 18 }}>
          {result.notes.map((n) => (
            <li key={n}>
              {n.startsWith("Conflict") && <span className="badge badge-bad">Conflict</span>}{" "}
              {n.startsWith("Correlation") && <span className="badge badge-info">Correlation</span>}{" "}
              {n.startsWith("Gap") && <span className="badge badge-warn">Gap</span>}{" "}
              {n.replace(/^(Conflict|Correlation|Gap):\s*/, "")}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
