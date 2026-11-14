/** "2026-03-01" -> "1 Mar 2026". Returns the fallback for empty or unparseable values. */
export function fmtDate(value: string | null | undefined, fallback = "–"): string {
  if (!value) return fallback;
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const ACRONYMS: Record<string, string> = {
  ai: "AI", api: "API", ci: "CI", iaas: "IaaS", id: "ID", llm: "LLM", mfa: "MFA", ml: "ML", paas: "PaaS",
  rpo: "RPO", rto: "RTO", saas: "SaaS", sla: "SLA", sso: "SSO", tps: "TPS",
};

/** "TECH_CHANGE" -> "Tech change", "AI_INITIATIVE" -> "AI initiative". */
export function humanize(value: string): string {
  const words = value.toLowerCase().split(/[_\s]+/).filter(Boolean).map((w) => ACRONYMS[w] ?? w);
  if (words[0] && !ACRONYMS[words[0].toLowerCase()]) words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.join(" ");
}

export function initials(name: string | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
