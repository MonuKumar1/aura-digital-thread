import { useEffect, useState } from "react";
import { api } from "../../api";
import { ErrorBox } from "../../components/Loading";
import { sanitizeHtml } from "../../sanitize";
import type { ManifestItem, OrchestrationResult, WorkItemLink, WorkItemManifest, WorkItemState } from "../../types";

const STATES: WorkItemState[] = ["New", "Active", "Resolved", "Closed"];

export function ManifestTree({ manifest }: { manifest: WorkItemManifest }) {
  const Item = ({ item }: { item: ManifestItem }) => (
    <li>
      <details>
        <summary><span className="badge badge-neutral">{item.kind}</span> {item.title}</summary>
        <div className="html-preview" dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.description_html) }} />
      </details>
      {item.children && item.children.length > 0 && <ul className="tree">{item.children.map((c, i) => <Item key={i} item={c} />)}</ul>}
    </li>
  );
  return (
    <ul className="tree" style={{ paddingLeft: 0 }}>
      <li>
        <details open>
          <summary><span className="badge badge-accent">epic</span> <strong>{manifest.epic.title}</strong></summary>
          <div className="html-preview" dangerouslySetInnerHTML={{ __html: sanitizeHtml(manifest.epic.description_html) }} />
        </details>
        <ul className="tree">{manifest.children.map((c, i) => <Item key={i} item={c} />)}</ul>
      </li>
    </ul>
  );
}

export default function TrackerPanel({ result }: { result: OrchestrationResult }) {
  const id = result.intake_id;
  const [manifest, setManifest] = useState<WorkItemManifest | null>(null);
  const [links, setLinks] = useState<WorkItemLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.workItemLinks(id).then(setLinks).catch(setError);
  }, [id]);

  async function preview() {
    setBusy(true);
    setError(null);
    try {
      setManifest(await api.buildManifest(id));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      setLinks(await api.createWorkItems(id));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function setState(link: WorkItemLink, state: WorkItemState) {
    try {
      const updated = await api.updateWorkItemState(link.external_id, state);
      setLinks((ls) => ls.map((l) => (l.external_id === updated.external_id ? updated : l)));
    } catch (e) {
      setError(e);
    }
  }

  const hasEpic = links.some((l) => l.kind === "epic");
  return (
    <div className="stack">
      {result.work_item_id && (
        <div className="ok-box small">STP task auto-created by the Change &amp; Release agent: <a href={result.work_item_url ?? "#"} target="_blank" rel="noreferrer">{result.work_item_id}</a></div>
      )}
      <div className="card">
        <div className="card-title">
          <h2>Work Tracker manifest</h2>
          <div className="row">
            <button onClick={preview} disabled={busy}>Preview manifest</button>
            <button className="btn-primary" onClick={create} disabled={busy || hasEpic}>{hasEpic ? "Work items created" : "Create work items"}</button>
          </div>
        </div>
        <ErrorBox error={error} />
        {manifest ? (
          <>
            <p className="small muted">1 epic · {manifest.counts.features} features · {manifest.counts.tasks} tasks. All user text is HTML-escaped server-side.</p>
            <ManifestTree manifest={manifest} />
          </>
        ) : <p className="muted">Preview the epic with one feature per applicable agent and a task per control activity or open follow-up.</p>}
      </div>
      {links.length > 0 && (
        <div className="card">
          <div className="card-title"><h2>Linked work items</h2><span className="small muted">{links.length} items</span></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Kind</th><th>ID</th><th>Title</th><th>Parent</th><th>State</th></tr></thead>
              <tbody>
                {links.map((l) => (
                  <tr key={l.external_id}>
                    <td><span className={`badge ${l.kind === "epic" ? "badge-accent" : "badge-neutral"}`}>{l.kind}</span></td>
                    <td className="mono"><a href={l.url} target="_blank" rel="noreferrer">{l.external_id}</a></td>
                    <td style={{ paddingLeft: l.kind === "task" ? 28 : l.kind === "feature" ? 16 : 10 }}>{l.title}</td>
                    <td className="mono small muted">{l.parent_external_id ?? "-"}</td>
                    <td>
                      <select value={l.state} style={{ width: 120 }} onChange={(e) => setState(l, e.target.value as WorkItemState)}>
                        {STATES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
