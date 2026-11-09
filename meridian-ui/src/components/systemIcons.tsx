const SYSTEMS: Record<string, { short: string; color: string }> = {
  Portfolio: { short: "PF", color: "#7c3aed" },
  ITSM: { short: "IT", color: "#0891b2" },
  CMDB: { short: "CM", color: "#0e7490" },
  "Security Portal": { short: "SP", color: "#dc2626" },
  DRA: { short: "DR", color: "#db2777" },
  "Architecture Portal": { short: "AP", color: "#2563eb" },
  "Change Mgmt": { short: "CH", color: "#ea580c" },
  "Cloud Onboarding": { short: "CO", color: "#0284c7" },
  "Business Impact": { short: "BI", color: "#16a34a" },
  "Vendor Risk": { short: "VR", color: "#ca8a04" },
  "AI Review Board": { short: "AI", color: "#9333ea" },
  Wiki: { short: "WK", color: "#64748b" },
  "Work Tracker": { short: "WT", color: "#4f46e5" },
};

export function systemMeta(name: string): { short: string; color: string } {
  return SYSTEMS[name] ?? { short: name.slice(0, 2).toUpperCase(), color: "#64748b" };
}

export function SystemIcon({ name, size = 20 }: { name: string; size?: number }) {
  const meta = systemMeta(name);
  return (
    <span className="sys-icon" style={{ background: meta.color, width: size, height: size, fontSize: size * 0.45 }} aria-hidden>
      {meta.short}
    </span>
  );
}

export function SystemBadge({ name, primary = false }: { name: string; primary?: boolean }) {
  return (
    <span className={`sys-badge ${primary ? "primary" : ""}`} title={primary ? `${name}: human review happens here` : `${name}: consulted`}>
      <SystemIcon name={name} />
      {name}
      {primary && " · review"}
    </span>
  );
}
