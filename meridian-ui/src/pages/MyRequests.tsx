import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { getUser } from "../auth";
import Icon from "../components/Icon";
import Loading, { ErrorBox } from "../components/Loading";
import { AgentBadge, InitiativeBadge } from "../components/StatusBadge";
import type { InitiativeStatus, IntakePage, IntakeQuery, IntakeSummary } from "../types";
import { fmtDate, humanize } from "../format";
import { STATUS_LABELS } from "../types";

const COLUMNS: { key: string; label: string; sortable?: boolean }[] = [
  { key: "initiative_name", label: "Initiative", sortable: true },
  { key: "initiative_type", label: "Type", sortable: true },
  { key: "current_stage", label: "Stage", sortable: true },
  { key: "status", label: "Status", sortable: true },
  { key: "agents", label: "Assessment" },
  { key: "target_go_live", label: "Go-live", sortable: true },
];

const STATUS_TONE: Record<InitiativeStatus, string> = { SUBMITTED: "ok", ORCHESTRATING: "warn", AWAITING_HUMAN_INPUT: "info", REJECTED: "bad", COMPLETED: "accent" };

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
  const navigate = useNavigate();
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

  const statuses = Object.keys(STATUS_LABELS) as InitiativeStatus[];
  const setStatus = (status: InitiativeStatus | "") => setQuery((cur) => ({ ...cur, page: 1, status }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My requests</h1>
          <p>{summary ? `${summary.total} initiatives · ${summary.assessed} assessed · ${summary.stp_eligible} straight-through eligible` : "Track every initiative from intake to production."}</p>
        </div>
        <Link className="btn btn-primary" to="/intake/new"><Icon name="plus" />New intake</Link>
      </div>

      <div className="chips" style={{ marginBottom: 16 }} role="group" aria-label="Filter by status">
        <button className={`chip ${query.status === "" ? "active" : ""}`} aria-pressed={query.status === ""} onClick={() => setStatus("")}>
          All {summary && <span className="count">{summary.total}</span>}
        </button>
        {statuses.map((s) => (
          <button key={s} className={`chip ${query.status === s ? "active" : ""}`} aria-pressed={query.status === s} onClick={() => setStatus(s)}>
            <span className={`dot tone-${STATUS_TONE[s]}`} />{STATUS_LABELS[s]} {summary && <span className="count">{summary.by_status[s] ?? 0}</span>}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 16 }}>
          <div className="search">
            <Icon name="search" />
            <input placeholder="Search name, sponsor, CI or description" aria-label="Search initiatives" value={search} maxLength={200} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <span className="spacer" />
          <label className="toggle-inline" title={user?.email}>
            <input type="checkbox" className="toggle" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> Only mine
          </label>
        </div>
        <ErrorBox error={error} />
        {!data ? <Loading /> : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {COLUMNS.map((c) => (
                      <th key={c.key} className={c.sortable ? "sortable" : ""} onClick={() => c.sortable && sort(c.key)}
                        aria-sort={query.sort_by === c.key ? (query.sort_dir === "asc" ? "ascending" : "descending") : undefined}>
                        {c.label}{query.sort_by === c.key ? (query.sort_dir === "asc" ? " ▲" : " ▼") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((i) => (
                    <tr key={i.id} className="clickable" onClick={() => navigate(`/results/${i.id}`)}>
                      <td>
                        <Link className="cell-main" to={`/results/${i.id}`} onClick={(e) => e.stopPropagation()}>{i.initiative_name}</Link>
                        <div className="cell-sub">#{i.id} · {i.application_ci_id ?? "No CI"} · {i.sponsor_email}</div>
                      </td>
                      <td className="nowrap">{humanize(i.initiative_type)}</td>
                      <td className="nowrap">
                        {i.current_stage}
                        {i.current_stage_due && <div className="cell-sub">due {fmtDate(i.current_stage_due)}</div>}
                      </td>
                      <td><InitiativeBadge status={i.status} /></td>
                      <td>
                        <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                          {i.overall_status ? <AgentBadge status={i.overall_status} /> : <span className="muted small">Not run</span>}
                          {i.straight_through_eligible && <span className="badge badge-ok" title="Straight-through processing eligible"><Icon name="bolt" size={11} />STP</span>}
                        </div>
                      </td>
                      <td className="nowrap">{fmtDate(i.target_go_live)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.items.length && (
              <div className="empty">
                <Icon name="inbox" size={28} />
                <div><strong>No initiatives match</strong></div>
                <div className="small">Try a different search or clear the status filter.</div>
              </div>
            )}
            <div className="pager">
              <span className="small muted">{data.total} total · page {query.page} of {pages}</span>
              <span className="spacer" />
              <select aria-label="Rows per page" value={query.page_size} onChange={(e) => setQuery({ ...query, page: 1, page_size: Number(e.target.value) })}>
                {[5, 10, 25, 50].map((n) => <option key={n} value={n}>{n} per page</option>)}
              </select>
              <button className="btn-sm" disabled={query.page <= 1} onClick={() => setQuery({ ...query, page: query.page - 1 })}><Icon name="arrowLeft" size={13} />Prev</button>
              <button className="btn-sm" disabled={query.page >= pages} onClick={() => setQuery({ ...query, page: query.page + 1 })}>Next<Icon name="arrowRight" size={13} /></button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
