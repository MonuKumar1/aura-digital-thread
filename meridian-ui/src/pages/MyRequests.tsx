import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { getUser } from "../auth";
import { BarList, Donut, STATUS_COLORS } from "../components/Charts";
import Loading, { ErrorBox } from "../components/Loading";
import { AgentBadge, InitiativeBadge, StpBadge } from "../components/StatusBadge";
import type { InitiativeStatus, IntakePage, IntakeQuery, IntakeSummary } from "../types";
import { STAGES, STATUS_LABELS } from "../types";

const COLUMNS: { key: string; label: string; sortable?: boolean }[] = [
  { key: "id", label: "#", sortable: true },
  { key: "initiative_name", label: "Initiative", sortable: true },
  { key: "initiative_type", label: "Type", sortable: true },
  { key: "current_stage", label: "Stage", sortable: true },
  { key: "status", label: "Status", sortable: true },
  { key: "agents", label: "Agents" },
  { key: "stp", label: "STP" },
  { key: "target_go_live", label: "Go-live", sortable: true },
  { key: "due", label: "Stage due" },
];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function MyRequests() {
  const user = getUser();
  const [mineOnly, setMineOnly] = useState(false);
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const [query, setQuery] = useState<IntakeQuery>({ page: 1, page_size: 10, sort_by: "created_at", sort_dir: "desc", status: "" });
  const [data, setData] = useState<IntakePage | null>(null);
  const [summary, setSummary] = useState<IntakeSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const sponsor = mineOnly ? user?.email : undefined;

  useEffect(() => {
    setQuery((cur) => ({ ...cur, page: 1 }));
  }, [q, mineOnly]);

  useEffect(() => {
    let live = true;
    api.listIntakes({ ...query, q, sponsor_email: sponsor }).then((d) => live && setData(d)).catch((e) => live && setError(e));
    return () => { live = false; };
  }, [query, q, sponsor]);

  useEffect(() => {
    api.intakeSummary(sponsor).then(setSummary).catch(setError);
  }, [sponsor]);

  const pages = useMemo(() => Math.max(1, Math.ceil((data?.total ?? 0) / query.page_size)), [data, query.page_size]);
  const sort = (key: string) =>
    setQuery((cur) => ({ ...cur, sort_by: key, sort_dir: cur.sort_by === key && cur.sort_dir === "asc" ? "desc" : "asc" }));

  return (
    <>
      <div className="page-head">
        <div><h1>My requests</h1><p>Server-side paginated, sorted and filtered.</p></div>
        <Link className="btn btn-primary" to="/intake/new">+ New intake</Link>
      </div>
      {summary && (
        <div className="grid grid-2" style={{ marginBottom: 16 }}>
          <div className="card">
            <div className="card-title"><h2>By status</h2><span className="small muted">{summary.total} initiatives · {summary.stp_eligible} STP</span></div>
            <Donut size={130} data={(Object.keys(STATUS_LABELS) as InitiativeStatus[]).map((s) => ({ label: STATUS_LABELS[s], value: summary.by_status[s] ?? 0, color: STATUS_COLORS[s] }))} />
          </div>
          <div className="card">
            <div className="card-title"><h2>By stage</h2></div>
            <BarList data={STAGES.map((s) => ({ label: s, value: summary.by_stage[s] ?? 0 }))} />
          </div>
        </div>
      )}
      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <input style={{ maxWidth: 320 }} placeholder="Search name, sponsor, CI, description…" value={search} maxLength={200} onChange={(e) => setSearch(e.target.value)} />
          <select style={{ maxWidth: 200 }} value={query.status} onChange={(e) => setQuery({ ...query, page: 1, status: e.target.value as InitiativeStatus | "" })}>
            <option value="">All statuses</option>
            {(Object.keys(STATUS_LABELS) as InitiativeStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
          <label className="checkbox" style={{ padding: "6px 10px" }}>
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> Only mine ({user?.email})
          </label>
          <span className="spacer" />
          <select style={{ width: 110 }} value={query.page_size} onChange={(e) => setQuery({ ...query, page: 1, page_size: Number(e.target.value) })}>
            {[5, 10, 25, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
        </div>
        <ErrorBox error={error} />
        {!data ? <Loading /> : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {COLUMNS.map((c) => (
                      <th key={c.key} className={c.sortable ? "sortable" : ""} onClick={() => c.sortable && sort(c.key)}>
                        {c.label}{query.sort_by === c.key ? (query.sort_dir === "asc" ? " ▲" : " ▼") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((i) => (
                    <tr key={i.id}>
                      <td className="muted">{i.id}</td>
                      <td><Link to={`/results/${i.id}`}><strong>{i.initiative_name}</strong></Link><div className="small muted">{i.application_ci_id ?? "No CI"} · {i.sponsor_email}</div></td>
                      <td className="small">{i.initiative_type.replace("_", " ")}</td>
                      <td>{i.current_stage}</td>
                      <td><InitiativeBadge status={i.status} /></td>
                      <td>{i.overall_status ? <AgentBadge status={i.overall_status} /> : <span className="muted small">not run</span>}</td>
                      <td><StpBadge eligible={i.straight_through_eligible} /></td>
                      <td className="small">{i.target_go_live ?? "-"}</td>
                      <td className="small">{i.current_stage_due ?? "-"}</td>
                    </tr>
                  ))}
                  {!data.items.length && <tr><td colSpan={COLUMNS.length} className="muted" style={{ textAlign: "center", padding: 24 }}>No initiatives match.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <span className="small muted">{data.total} total · page {query.page} of {pages}</span>
              <button className="btn-sm" disabled={query.page <= 1} onClick={() => setQuery({ ...query, page: query.page - 1 })}>Prev</button>
              <button className="btn-sm" disabled={query.page >= pages} onClick={() => setQuery({ ...query, page: query.page + 1 })}>Next</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
