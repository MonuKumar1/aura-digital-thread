import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import AgentOrchestrationGraph, { nodeStateFor, type NodeState } from "../components/AgentOrchestrationGraph";
import Loading, { ErrorBox } from "../components/Loading";
import { AgentBadge, InitiativeBadge, StpBadge } from "../components/StatusBadge";
import SystemFlowAnimation from "../components/SystemFlowAnimation";
import type { AgentStatus, AgentType, Intake, OrchestrationResult, ProgressEvent } from "../types";
import { AGENT_ORDER } from "../types";
import CoveragePanel from "./results/CoveragePanel";
import EvidenceCard from "./results/EvidenceCard";
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

  const pending = result?.agent_results.filter((r) => r.status === "NEEDS_REVIEW" || r.status === "FLAGGED").length ?? 0;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "evidence", label: "Evidence" },
    { id: "review", label: "Pending review", count: pending },
    { id: "coverage", label: "Coverage & synthesis" },
    { id: "lifecycle", label: "Lifecycle" },
    { id: "tracker", label: "Work Tracker" },
    { id: "security", label: "Security & design" },
  ];
  const selectAgent = (a: AgentType) => {
    setTab("evidence");
    setTimeout(() => document.getElementById(`agent-${a}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="small muted"><Link to="/requests">My requests</Link> / #{intake.id}</div>
          <h1>{intake.initiative_name}</h1>
          <div className="row">
            <InitiativeBadge status={intake.status} />
            {result && <AgentBadge status={result.overall_status} />}
            <StpBadge eligible={result?.straight_through_eligible} />
            <span className="badge badge-neutral">{intake.initiative_type.replace("_", " ")}</span>
            <span className="badge badge-neutral">Stage: {intake.current_stage}</span>
            {intake.application_ci_id && <span className="badge badge-neutral">{intake.application_ci_id}</span>}
          </div>
        </div>
        <div className="row">
          {result && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{result.questions_replaced_count}/{result.questions_raw_count}</div>
              <div className="small muted">questions replaced · {result.systems_replaced_count} systems</div>
            </div>
          )}
          <button className="btn-primary" onClick={() => {
            if (!result || window.confirm("Re-running the agents clears any review answers already submitted. Continue?")) void run();
          }} disabled={running}>
            {running ? "Running agents…" : result ? "Re-run agents" : "Run agents"}
          </button>
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", marginBottom: 16 }}>
        <div className="card">
          <div className="card-title"><h2>Agent orchestration</h2><span className="small muted">{running ? "streaming live…" : "click a node for its evidence"}</span></div>
          <AgentOrchestrationGraph states={graph.states} statuses={graph.statuses} onSelect={selectAgent} />
        </div>
        <div className="card">
          <div className="card-title"><h2>Systems</h2><span className="small muted">{running ? "querying" : "idle"}</span></div>
          <SystemFlowAnimation active={running ? activeSystems : []} compact />
        </div>
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
          {tab === "evidence" && result && (
            <div className="grid grid-2">
              {AGENT_ORDER.map((a) => result.agent_results.find((r) => r.agent_type === a)).filter(Boolean).map((ev) => (
                <EvidenceCard key={ev!.agent_type} ev={ev!} id={`agent-${ev!.agent_type}`} />
              ))}
            </div>
          )}
          {tab === "review" && result && <PendingReview result={result} onUpdated={onReviewUpdated} />}
          {tab === "coverage" && result && <CoveragePanel result={result} />}
          {tab === "lifecycle" && <LifecyclePanel intake={intake} result={result} onChanged={() => { void refreshIntake(); }} />}
          {tab === "tracker" && result && <TrackerPanel result={result} />}
          {tab === "security" && <SecurityDesignPanel intake={intake} result={result} onIntake={setIntake} />}
        </>
      )}
    </>
  );
}
