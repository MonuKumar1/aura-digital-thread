import { useEffect, useState } from "react";
import { systemMeta } from "./systemIcons";

const SYSTEMS = ["Portfolio", "CMDB", "ITSM", "Security Portal", "DRA", "Architecture Portal", "Work Tracker", "Wiki"];

/** Animated hub-and-spoke view of data flowing between Aura Digital Thread and the mocked systems. */
export default function SystemFlowAnimation({ active, compact = false }: { active?: string[]; compact?: boolean }) {
  const [tick, setTick] = useState(0);
  const auto = !active;
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setTick((v) => v + 1), 1400);
    return () => clearInterval(t);
  }, [auto]);
  const highlighted = new Set(active ?? [SYSTEMS[tick % SYSTEMS.length], SYSTEMS[(tick + 3) % SYSTEMS.length]]);
  const cx = 260;
  const cy = compact ? 120 : 150;
  const r = compact ? 95 : 118;
  return (
    <div className="flow">
      <svg viewBox={`0 0 520 ${cy * 2 + 18}`} role="img" aria-label="Data flow between Aura Digital Thread and connected systems">
        {SYSTEMS.map((name, i) => {
          const angle = (2 * Math.PI * i) / SYSTEMS.length - Math.PI / 2;
          const x = cx + Math.cos(angle) * r * 1.6;
          const y = cy + Math.sin(angle) * r;
          const on = highlighted.has(name);
          const path = `M${cx} ${cy} L${x} ${y}`;
          return (
            <g key={name}>
              <path d={path} className="link" style={on ? { stroke: systemMeta(name).color } : undefined} />
              {on && (
                <>
                  <circle r="4" className="packet" style={{ fill: systemMeta(name).color }}>
                    <animateMotion dur="1.2s" repeatCount="indefinite" path={path} />
                  </circle>
                  <circle r="3" className="packet" opacity="0.6">
                    <animateMotion dur="1.2s" begin="0.6s" repeatCount="indefinite" keyPoints="1;0" keyTimes="0;1" calcMode="linear" path={path} />
                  </circle>
                </>
              )}
              <g className={`sat ${on ? "active" : ""}`} transform={`translate(${x} ${y})`}>
                <circle r="22" style={on ? { stroke: systemMeta(name).color } : undefined} />
                <text textAnchor="middle" y="4" style={{ fill: systemMeta(name).color }}>{systemMeta(name).short}</text>
                <text textAnchor="middle" y="38" className="small" style={{ fontSize: 10 }}>{name}</text>
              </g>
            </g>
          );
        })}
        <circle cx={cx} cy={cy} r="34" className="hub" />
        <text x={cx} y={cy - 2} textAnchor="middle" fill="#fff" fontWeight="700" fontSize="11">Aura</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fill="#fff" fontWeight="700" fontSize="8">Digital Thread</text>
      </svg>
    </div>
  );
}
