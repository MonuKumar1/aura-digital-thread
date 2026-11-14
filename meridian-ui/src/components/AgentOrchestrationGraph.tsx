import type { AgentStatus, AgentType } from "../types";
import { AGENT_LABELS, AGENT_ORDER } from "../types";
import { AGENT_STATUS_LABEL } from "./StatusBadge";

export type NodeState = "pending" | "running" | "done" | "review" | "flagged" | "skipped";

export function nodeStateFor(status: AgentStatus | undefined): NodeState {
  switch (status) {
    case "AUTO_APPROVED":
    case "REVIEWED":
      return "done";
    case "NEEDS_REVIEW":
      return "review";
    case "FLAGGED":
    case "FAILED":
      return "flagged";
    case "SKIPPED":
      return "skipped";
    default:
      return "pending";
  }
}

interface Props {
  states: Partial<Record<AgentType | "synthesis", NodeState>>;
  statuses?: Partial<Record<AgentType, AgentStatus>>;
  onSelect?: (agent: AgentType) => void;
  selected?: AgentType | null;
}

const W = 140;
const H = 52;
const GAP = 18;
type NodeId = "start" | AgentType | "synthesis";
const NODES: NodeId[] = ["start", ...AGENT_ORDER, "synthesis"];
const PER_ROW = 5;

function position(index: number): { x: number; y: number } {
  const row = Math.floor(index / PER_ROW);
  const col = index % PER_ROW;
  const x = row % 2 === 0 ? col : PER_ROW - 1 - col; // snake layout
  return { x: 10 + x * (W + GAP), y: 14 + row * (H + 46) };
}

export default function AgentOrchestrationGraph({ states, statuses = {}, onSelect, selected }: Props) {
  const width = 20 + PER_ROW * W + (PER_ROW - 1) * GAP;
  const height = 28 + 2 * H + 46;
  const stateOf = (id: NodeId): NodeState => (id === "start" ? "done" : states[id] ?? "pending");
  return (
    <div className="graph" aria-label="Agent orchestration graph">
      <svg viewBox={`0 0 ${width} ${height}`}>
        {NODES.slice(1).map((id, i) => {
          const a = position(i);
          const b = position(i + 1);
          const sameRow = a.y === b.y;
          const d = sameRow
            ? `M${Math.min(a.x, b.x) + W} ${a.y + H / 2} L${Math.max(a.x, b.x)} ${b.y + H / 2}`
            : `M${a.x + W / 2} ${a.y + H} L${b.x + W / 2} ${b.y}`;
          const target = stateOf(id);
          const cls = target === "running" ? "active" : target === "pending" ? "" : "done";
          return <path key={`e-${id}`} d={d} className={`g-edge ${cls}`} />;
        })}
        {NODES.map((id, i) => {
          const { x, y } = position(i);
          const st = stateOf(id);
          const label = id === "start" ? "Intake" : id === "synthesis" ? "Synthesis" : AGENT_LABELS[id];
          const sub = id === "start" ? "submitted" : id === "synthesis" ? (st === "done" ? "complete" : st) :
            statuses[id] ? AGENT_STATUS_LABEL[statuses[id]!] : st === "running" ? "running…" : "pending";
          const clickable = onSelect && id !== "start" && id !== "synthesis";
          return (
            <g key={id} className={`g-node ${st} ${id === selected ? "selected" : ""}`} transform={`translate(${x} ${y})`} style={{ cursor: clickable ? "pointer" : "default" }}
              onClick={() => clickable && onSelect!(id as AgentType)}>
              <rect width={W} height={H} rx="10" />
              <text x={W / 2} y={22} textAnchor="middle">{label}</text>
              <text x={W / 2} y={39} textAnchor="middle" className="sub">{sub}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
