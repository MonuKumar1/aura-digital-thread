import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { getUser } from "../../auth";
import Loading, { ErrorBox } from "../../components/Loading";
import Modal from "../../components/Modal";
import type { DeadlinesResponse, HistoryResponse, Intake, OrchestrationResult } from "../../types";
import { fmtDate } from "../../format";
import { AGENT_LABELS, STAGES } from "../../types";

export default function LifecyclePanel({ intake, result, onChanged }: { intake: Intake; result: OrchestrationResult | null; onChanged: () => void }) {
  const user = getUser();
  const [deadlines, setDeadlines] = useState<DeadlinesResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [modal, setModal] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    Promise.all([api.stageDeadlines(intake.id), api.history(intake.id)]).then(([d, h]) => { setDeadlines(d); setHistory(h); }).catch(setError);
  }, [intake.id]);
  useEffect(reload, [reload, intake.current_stage]);

  const blocking = (result?.agent_results ?? []).filter((r) => r.status !== "SKIPPED" && r.status !== "AUTO_APPROVED" && r.status !== "REVIEWED");
  const idx = STAGES.indexOf(intake.current_stage);
  const next = STAGES[idx + 1];
  const canAdvance = Boolean(result) && !blocking.length && Boolean(next);

  async function advance() {
    if (!comment.trim()) return setError(new Error("An approval comment is required."));
    setBusy(true);
    setError(null);
    try {
      await api.advanceStage(intake.id, comment.trim(), user?.email ?? "approver");
      setModal(false);
      setComment("");
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function saveDeadline(stage: string, date: string) {
    if (!date) return;
    try {
      setDeadlines(await api.updateStageDeadline(intake.id, stage, date));
      reload();
      onChanged();
    } catch (e) {
      setError(e);
    }
  }

  if (!deadlines || !history) return <Loading />;
  const due = Object.fromEntries(deadlines.deadlines.map((d) => [d.stage, d.due_date]));
  return (
    <div className="stack">
      <div className="card">
        <div className="card-title">
          <h2>Lifecycle</h2>
          <button className="btn-primary" disabled={!canAdvance} onClick={() => { setError(null); setModal(true); }}
            title={blocking.length ? "Resolve all agent reviews first" : !next ? "Already in Production" : ""}>
            {next ? `Approve → ${next}` : "In Production"}
          </button>
        </div>
        <div className="stepper">
          {STAGES.map((s, i) => (
            <div key={s} className={`step ${i < idx ? "done" : i === idx ? "current" : ""}`}>
              <span className="dot">{i < idx ? "✓" : i + 1}</span>
              <span className="name">{s}</span>
              <span className="due">due {fmtDate(due[s])}</span>
            </div>
          ))}
        </div>
        {!result && <div className="info-box small">Run the agents before this initiative can be approved.</div>}
        {blocking.length > 0 && (
          <div className="info-box small">Approval gate: {blocking.map((r) => AGENT_LABELS[r.agent_type]).join(", ")} must be auto-approved or reviewed.</div>
        )}
        <ErrorBox error={!modal ? error : null} />
      </div>
      <div className="grid grid-2">
        <div className="card">
          <div className="card-title"><h2>Stage deadlines</h2><span className="small muted">auto-split to go-live; editable</span></div>
          <table className="table">
            <tbody>
              {deadlines.deadlines.map((d) => (
                <tr key={d.stage}>
                  <td style={{ width: 120 }}><strong>{d.stage}</strong>{d.stage === intake.current_stage && <span className="badge badge-accent" style={{ marginLeft: 6 }}>current</span>}</td>
                  <td><input type="date" defaultValue={d.due_date} key={d.due_date} onBlur={(e) => e.target.value !== d.due_date && saveDeadline(d.stage, e.target.value)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="card-title"><h2>History</h2></div>
          {!history.transitions.length && !history.field_changes.length && <p className="muted">No changes yet.</p>}
          <ul className="timeline">
            {history.transitions.map((t) => (
              <li key={t.created_at + t.to_stage}>
                <strong>{t.from_stage} → {t.to_stage}</strong> <span className="small muted">by {t.approved_by} · {new Date(t.created_at).toLocaleString()}</span>
                <div className="small">“{t.comment}”</div>
              </li>
            ))}
            {history.field_changes.slice(0, 15).map((c, i) => (
              <li key={c.created_at + c.field + i}>
                <span className="small"><strong>{c.field}</strong>: {c.old_value ?? "∅"} → {c.new_value ?? "∅"}</span>
                <div className="small muted">{c.changed_by} · {new Date(c.created_at).toLocaleString()}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {modal && (
        <Modal title={`Approve move to ${next}`} onClose={() => setModal(false)}>
          <p className="muted small">All applicable agents are resolved. Record the approval rationale; it is stored in the transition log.</p>
          <label className="field"><span>Approval comment *</span>
            <textarea autoFocus value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)} placeholder="e.g. Approved at CAB on …" />
          </label>
          <ErrorBox error={error} />
          <div className="modal-actions">
            <button onClick={() => setModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={advance} disabled={busy || !comment.trim()}>{busy ? "Approving…" : "Approve"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
