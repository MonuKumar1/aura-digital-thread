const PALETTE = ["#4f46e5", "#16a34a", "#d97706", "#dc2626", "#0891b2", "#9333ea", "#64748b"];

export function BarList({ data, max }: { data: { label: string; value: number; color?: string }[]; max?: number }) {
  const top = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="bar-list">
      {data.map((d) => (
        <div className="bar-row" key={d.label}>
          <span className="muted">{d.label}</span>
          <div className="bar">
            <span style={{ width: `${(100 * d.value) / top}%`, background: d.color }} />
          </div>
          <strong>{d.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function Donut({ data, size = 150 }: { data: { label: string; value: number; color?: string }[]; size?: number }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="row" style={{ alignItems: "center", gap: 24, justifyContent: "center" }}>
      <svg width={size} height={size} viewBox="0 0 140 140" role="img" aria-label="distribution chart">
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--neutral-soft)" strokeWidth="16" />
        {total > 0 && data.map((d, i) => {
          const len = (c * d.value) / total;
          const el = (
            <circle key={d.label} cx="70" cy="70" r={r} fill="none" stroke={d.color ?? PALETTE[i % PALETTE.length]} strokeWidth="16"
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)" />
          );
          offset += len;
          return el;
        })}
        <text x="70" y="68" textAnchor="middle" fontSize="24" fontWeight="700" fill="var(--text)">{total}</text>
        <text x="70" y="86" textAnchor="middle" fontSize="11" fill="var(--muted)">total</text>
      </svg>
      <div className="stack" style={{ fontSize: 13, minWidth: 150 }}>
        {data.map((d, i) => (
          <div key={d.label} className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
            <span className="dot" style={{ background: d.color ?? PALETTE[i % PALETTE.length] }} />
            <span className="muted" style={{ flex: 1 }}>{d.label}</span>
            <strong className="num">{d.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Gauge({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const r = 60;
  const half = Math.PI * r;
  return (
    <svg viewBox="0 0 160 112" width="100%" style={{ maxWidth: 240 }} role="img" aria-label={`${label} ${pct}%`}>
      <path d="M20 85 A60 60 0 0 1 140 85" fill="none" stroke="var(--neutral-soft)" strokeWidth="14" strokeLinecap="round" />
      <path d="M20 85 A60 60 0 0 1 140 85" fill="none" stroke="var(--accent)" strokeWidth="14" strokeLinecap="round"
        strokeDasharray={`${(half * pct) / 100} ${half}`} style={{ transition: "stroke-dasharray 0.6s" }} />
      <text x="80" y="76" textAnchor="middle" fontSize="24" fontWeight="700" fill="var(--text)">{pct.toFixed(1)}%</text>
      <text x="80" y="108" textAnchor="middle" fontSize="10" fill="var(--muted)">{label}</text>
    </svg>
  );
}

export const STATUS_COLORS: Record<string, string> = {
  SUBMITTED: "var(--ok)",
  ORCHESTRATING: "var(--warn)",
  AWAITING_HUMAN_INPUT: "var(--info)",
  REJECTED: "var(--bad)",
  COMPLETED: "var(--accent)",
};
