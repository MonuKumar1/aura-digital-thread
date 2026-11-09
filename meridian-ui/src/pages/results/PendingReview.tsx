import { useEffect, useState } from "react";
import { api } from "../../api";
import { getUser } from "../../auth";
import { ErrorBox } from "../../components/Loading";
import { AgentBadge } from "../../components/StatusBadge";
import { SystemBadge } from "../../components/systemIcons";
import type { OrchestrationResult, ReviewAnswer } from "../../types";
import { AGENT_LABELS } from "../../types";

const key = (agent: string, q: string) => `${agent}::${q.trim()}`;

export default function PendingReview({ result, onUpdated }: { result: OrchestrationResult; onUpdated: (r: OrchestrationResult) => void }) {
  const user = getUser();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, ReviewAnswer>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.listReviewAnswers(result.intake_id).then((rows) => {
      setSaved(Object.fromEntries(rows.map((r) => [key(r.agent_type, r.question), r])));
    }).catch(setError);
  }, [result.intake_id, result.generated_at]);

  const reviewable = result.agent_results.filter((r) => r.follow_up_questions.length && ["NEEDS_REVIEW", "FLAGGED", "REVIEWED"].includes(r.status));

  async function submit() {
    const answers: ReviewAnswer[] = [];
    reviewable.forEach((ev) => ev.follow_up_questions.forEach((q) => {
      const text = drafts[key(ev.agent_type, q)]?.trim();
      if (text) answers.push({ agent_type: ev.agent_type, question: q, answer: text, answered_by: user?.email ?? "reviewer" });
    }));
    if (!answers.length) return setMsg("Type at least one answer first.");
    setBusy(true);
    setError(null);
    try {
      const before = result.agent_results.filter((r) => r.status === "REVIEWED").length;
      const updated = await api.submitReviewAnswers(result.intake_id, answers);
      const after = updated.agent_results.filter((r) => r.status === "REVIEWED").length;
      setSaved((s) => ({ ...s, ...Object.fromEntries(answers.map((a) => [key(a.agent_type, a.question), a])) }));
      setDrafts({});
      setMsg(`Saved ${answers.length} answer(s).` + (after > before ? ` ${after - before} agent(s) moved to Reviewed.` : ""));
      onUpdated(updated);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!reviewable.length) return <div className="ok-box">No follow-up questions: every applicable agent auto-approved.</div>;
  return (
    <div className="stack">
      <div className="info-box">Answer every follow-up for an agent and it flips to <strong>Reviewed</strong> automatically. Re-running the agents clears these answers.</div>
      {reviewable.map((ev) => (
        <div className="card" key={ev.agent_type}>
          <div className="card-title">
            <h3>{AGENT_LABELS[ev.agent_type]}</h3>
            <div className="row"><SystemBadge name={ev.review_system} primary /><AgentBadge status={ev.status} /></div>
          </div>
          <div className="stack">
            {ev.follow_up_questions.map((q) => {
              const k = key(ev.agent_type, q);
              const existing = saved[k];
              return (
                <label className="field" key={k}>
                  <span>{q}</span>
                  {existing && !(k in drafts) ? (
                    <div className="readonly-field small">
                      {existing.answer} <span className="muted">— {existing.answered_by}</span>
                      <button className="btn-sm btn-ghost" type="button" onClick={() => setDrafts((d) => ({ ...d, [k]: existing.answer }))}>Edit</button>
                    </div>
                  ) : (
                    <textarea value={drafts[k] ?? ""} maxLength={4000} onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value }))} placeholder="Your answer / evidence reference" />
                  )}
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <div className="row">
        <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Submit answers"}</button>
        {msg && <span className="small">{msg}</span>}
      </div>
      <ErrorBox error={error} />
    </div>
  );
}
