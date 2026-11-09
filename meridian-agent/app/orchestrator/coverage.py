from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Optional

from app.config import get_settings
from app.models.enums import AGENT_ORDER, AgentStatus
from app.models.schemas import AgentEvidence


def _filled(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True  # booleans and numbers (including False / 0) are explicit answers


class CoverageService:
    def __init__(self, data_dir: Path) -> None:
        coverage = json.loads((data_dir / "question_coverage_map.json").read_text(encoding="utf-8"))
        master = json.loads((data_dir / "questions_master.json").read_text(encoding="utf-8"))
        self.map: dict[str, dict[str, Any]] = coverage["questions"]
        self.systems: dict[str, str] = {q["id"]: q["system"] for q in master["questions"]}

    @property
    def total(self) -> int:
        return len(self.map)

    def compute(self, intake: Any, agent_results: Optional[Iterable[AgentEvidence]] = None) -> dict[str, Any]:
        ran = {r.agent_type for r in agent_results or [] if r.status not in (AgentStatus.SKIPPED, AgentStatus.FAILED)}
        answered: set[str] = set()
        for qid, entry in self.map.items():
            by_field = any(_filled(getattr(intake, f, None)) for f in entry["fields"])
            if by_field or entry["owner_agent"] in ran:
                answered.add(qid)

        per_agent = []
        for agent in AGENT_ORDER:
            qids = [q for q, e in self.map.items() if e["owner_agent"] == agent]
            done = sum(1 for q in qids if q in answered)
            per_agent.append({"agent_type": agent, "total": len(qids), "answered": done,
                              "pct": round(100 * done / len(qids), 1) if qids else 0.0, "ran": agent in ran})

        all_systems = sorted(set(self.systems.values()))
        per_system = []
        for system in all_systems:
            qids = [q for q, s in self.systems.items() if s == system]
            done = sum(1 for q in qids if q in answered)
            per_system.append({"system": system, "total": len(qids), "answered": done})
        return {
            "total_questions": self.total,
            "answered_questions": len(answered),
            "coverage_pct": round(100 * len(answered) / self.total, 1) if self.total else 0.0,
            "systems_total": len(all_systems),
            "systems_replaced": len({self.systems[q] for q in answered}),
            "per_agent": per_agent,
            "per_system": per_system,
        }


@lru_cache
def get_coverage_service() -> CoverageService:
    return CoverageService(get_settings().data_dir)
