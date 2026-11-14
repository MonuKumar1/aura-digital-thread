import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import AgentOrchestrationGraph, { nodeStateFor, type NodeState } from "../components/AgentOrchestrationGraph";
import Icon from "../components/Icon";
import Loading, { ErrorBox } from "../components/Loading";
import Modal from "../components/Modal";
import { AgentBadge, InitiativeBadge, StpBadge } from "../components/StatusBadge";
import SystemFlowAnimation from "../components/SystemFlowAnimation";
import { fmtDate, humanize } from "../format";
import type { AgentEvidence, AgentStatus, AgentType, Intake, OrchestrationResult, ProgressEvent } from "../types";
import { AGENT_ORDER } from "../types";
import CoveragePanel from "./results/CoveragePanel";
import { EvidenceBrowser } from "./results/EvidenceCard";
import LifecyclePanel from "./results/LifecyclePanel";
import PendingReview from "./results/PendingReview";
import SecurityDesignPanel from "./results/SecurityDesignPanel";
import TrackerPanel from "./results/TrackerPanel";

type Tab = "evidence" | "review" | "coverage" | "lifecycle" | "tracker" | "security";
type GraphStates = Partial<Record<AgentType | "synthesis", NodeState>>;

const AGENT_SYSTEMS: Record<AgentType, string[]> = {
  clarity: ["Portfolio", "CMDB", "ITSM"], scoping: ["Wiki"], security: ["Security Portal", "CMDB"], privacy: ["DRA"],
  ai_ethics: ["DRA"], architecture: ["Architecture Portal", "CMDB"], resilience: ["CMDB", "ITSM"], release: ["ITSM", "Work Tracker"],
};

function statesFrom(result: OrchestrationResult): { states: GraphStates; statuses: Partial<Record<AgentType, AgentStatus>> } {
  const states: GraphStates = { synthesis: "done" };
  const statuses: Partial<Record<AgentType, AgentStatus>> = {};
  result.agent_results.forEach((r) => {
    states[r.agent_type] = nodeStateFor(r.status);
    statuses[r.agent_type] = r.status;
  });
  return { states, statuses };
}

export default function Results() {
  const id = Number(useParams().id);
  const [params, setParams] = useSearchParams();
  const [intake, setIntake] = useState<Intake | null>(null);
  const [result, setResult] = useState<OrchestrationResult | null>(null);
  const [graph, setGraph] = useState<{ states: GraphStates; statuses: Partial<Record<AgentType, AgentStatus>> }>({ states: {}, statuses: {} });
  const [running, setRunning] = useState(false);
  const [activeSystems, setActiveSystems] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>("evidence");
  const [selected, setSelected] = useState<AgentType | null>(null);
  const [confirmRun, setConfirmRun] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loaded, setLoaded] = useState(false);
  const started = useRef(false);

  const applyResult = useCallback((r: OrchestrationResult | null) => {
    setResult(r);
    if (r) setGraph(statesFrom(r));
  }, []);

  const refreshIntake = useCallback(() => api.getIntake(id).then(setIntake).catch(setError), [id]);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setGraph({ states: {}, statuses: {} });
    const onEvent = (e: ProgressEvent) => {
      const agent = e.agent_type;
      if (e.type === "agent_started" && agent) {
        setGraph((g) => ({ ...g, states: { ...g.states, [agent]: "running" } }));
        setActiveSystems(AGENT_SYSTEMS[agent]);
      } else if ((e.type === "agent_completed" || e.type === "agent_skipped") && agent && e.status) {
        setGraph((g) => ({ states: { ...g.states, [agent]: nodeStateFor(e.status) }, statuses: { ...g.statuses, [agent]: e.status } }));
      } else if (e.type === "synthesis_started") {
        setGraph((g) => ({ ...g, states: { ...g.states, synthesis: "running" } }));
        setActiveSystems([]);
      } else if (e.type === "synthesis_completed") {
        setGraph((g) => ({ ...g, states: { ...g.states, synthesis: "done" } }));
      }
    };
    try {
      applyResult(await api.runOrchestrationStream(id, onEvent));
      await refreshIntake();
    } catch (e) {
      setError(e);
    } finally {
      setRunning(false);
      setActiveSystems([]);
    }
  }, [id, applyResult, refreshIntake]);

  useEffect(() => {
    let live = true; // a late, superseded load must not overwrite a graph that is already streaming
    started.current = false;
    setLoaded(false);
    setSelected(null);
    Promise.all([api.getIntake(id), api.getResult(id)])
      .then(([i, r]) => {
        if (!live) return;
        setIntake(i);
        applyResult(r);
        setLoaded(true);
      })
      .catch((e) => { if (live) { setError(e); setLoaded(true); } });
    return () => { live = false; };
  }, [id, applyResult]);

  useEffect(() => {
    if (!loaded || started.current || !intake) return;
    if (params.get("run") === "1" || !result) {
      started.current = true;
      if (params.has("run")) setParams({}, { replace: true });
      void run();
    }
  }, [loaded, intake, result, params, setParams, run]);

  const onReviewUpdated = (r: OrchestrationResult) => {
    applyResult(r);
    void refreshIntake();
  };

  if (!loaded) return <Loading />;
  if (!intake) return <ErrorBox error={error ?? "Intake not found"} />;

  const ordered = result ? AGENT_ORDER.map((a) => result.agent_results.find((r) => r.agent_type === a)).filter((r): r is AgentEvidence => Boolean(r)) : [];
  const pending = ordered.filter((r) => r.status === "NEEDS_REVIEW" || r.status === "FLAGGED").length;
  // Open on the agent that most needs attention, unless the user picked one.
  const current = selected ?? (ordered.find((r) => r.status === "FLAGGED" || r.status === "FAILED") ?? ordered.find((r) => r.status === "NEEDS_REVIEW") ?? ordered.find((r) => !r.not_applicable) ?? ordered[0])?.agent_type ?? null;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "evidence", label: "Evidence" },
    { id: "review", label: "Pending review", count: pending },
    { id: "coverage", label: "Coverage & synthesis" },
    { id: "lifecycle", label: "Lifecycle" },
    { id: "tracker", label: "Work Tracker" },
    { id: "security", label: "Security & design" },
  ];
  const selectAgent = (a: AgentType) => {
    setSelected(a);
    setTab("evidence");
    setTimeout(() => document.getElementById("evidence")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  };
  const requestRun = () => (result ? setConfirmRun(true) : void run());

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link to="/requests">My requests</Link> / #{intake.id}</div>
          <h1>{intake.initiative_name}</h1>
          <div className="row" style={{ marginTop: 8 }}>
            <InitiativeBadge status={intake.status} />
            <span className="badge badge-neutral">{humanize(intake.initiative_type)}</span>
            {intake.application_ci_id && <span className="badge badge-neutral">{intake.application_ci_id}</span>}
            {intake.target_go_live && <span className="small muted">Go-live {fmtDate(intake.target_go_live)}</span>}
          </div>
        </div>
        <button className="btn-primary" onClick={requestRun} disabled={running}>
          <Icon name={result ? "refresh" : "bolt"} />{running ? "Running agents…" : result ? "Re-run agents" : "Run agents"}
        </button>
      </div>
      <ErrorBox error={error} />

      <div className="card stat-strip">
        <div className="stat">
          <div className="label">Assessment</div>
          <div className="value">{result ? <AgentBadge status={result.overall_status} /> : <span className="badge badge-neutral">{running ? "Running" : "Not run"}</span>}</div>
        </div>
        <div className="stat">
          <div className="label">Processing path</div>
          <div className="value"><StpBadge eligible={result?.straight_through_eligible} /></div>
        </div>
        <div className="stat">
          <div className="label">Lifecycle stage</div>
          <div className="value">{intake.current_stage}</div>
        </div>
        <div className="stat">
          <div className="label">Questions replaced</div>
          <div className="value">{result ? <>{result.questions_replaced_count}<small>of {result.questions_raw_count} · {result.systems_replaced_count} systems</small></> : "–"}</div>
        </div>
        <div className="stat">
          <div className="label">Open reviews</div>
          <div className="value">{result ? pending : "–"}{pending > 0 && <button className="btn-sm" onClick={() => setTab("review")}>Review</button>}</div>
        </div>
      </div>

      <div className="grid section" style={{ gridTemplateColumns: running ? "minmax(0, 2fr) minmax(0, 1fr)" : "minmax(0, 1fr)" }}>
        <div className="card">
          <div className="card-title"><h2>Agent orchestration</h2><span className="small muted">{running ? "Streaming live…" : "Select a node to see its evidence"}</span></div>
          <AgentOrchestrationGraph states={graph.states} statuses={graph.statuses} onSelect={selectAgent} selected={tab === "evidence" ? current : null} />
        </div>
        {running && (
          <div className="card">
            <div className="card-title"><h2>Systems</h2><span className="small muted">querying</span></div>
            <SystemFlowAnimation active={activeSystems} compact />
          </div>
        )}
      </div>

      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
            {t.label}{t.count ? <span className="tab-count">{t.count}</span> : null}
          </button>
        ))}
      </div>

      {!result && tab !== "lifecycle" && tab !== "security" ? (
        running ? <Loading label="Agents are evaluating…" /> : <div className="info-box">No assessment yet. Run the agents to build the evidence package.</div>
      ) : (
        <>
          {tab === "evidence" && result && current && (
            <EvidenceBrowser results={ordered} selected={current} onSelect={setSelected} onReview={() => setTab("review")} />
          )}
          {tab === "review" && result && <PendingReview result={result} onUpdated={onReviewUpdated} />}
          {tab === "coverage" && result && <CoveragePanel result={result} />}
          {tab === "lifecycle" && <LifecyclePanel intake={intake} result={result} onChanged={() => { void refreshIntake(); }} />}
          {tab === "tracker" && result && <TrackerPanel result={result} />}
          {tab === "security" && <SecurityDesignPanel intake={intake} result={result} onIntake={setIntake} />}
        </>
      )}

      {confirmRun && (
        <Modal title="Re-run the agents?" onClose={() => setConfirmRun(false)}>
          <p className="muted">Re-running rebuilds the evidence package and clears any review answers already submitted for this initiative.</p>
          <div className="modal-actions">
            <button onClick={() => setConfirmRun(false)}>Cancel</button>
            <button className="btn-primary" autoFocus onClick={() => { setConfirmRun(false); void run(); }}>Re-run agents</button>
          </div>
        </Modal>
      )}
    </>
  );
}
