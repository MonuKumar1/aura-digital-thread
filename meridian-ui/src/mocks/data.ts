// Same JSON files the backend loads (meridian/data), so mock and live data are identical.
import canonical from "@data/canonical_fields.json";
import coverageMap from "@data/question_coverage_map.json";
import fixturesJson from "@data/mock_fixtures.json";
import master from "@data/questions_master.json";
import type { AgentType, CanonicalField, CmdbRecord, PortfolioRecord } from "../types";

export interface SecurityControl {
  control: string;
  description: string;
  source_document: string;
  trigger: string;
}

export interface Fixtures {
  cmdb: CmdbRecord[];
  portfolio: PortfolioRecord[];
  itsm_risk: Record<string, { base_score: number; open_incidents: number; failed_changes_90d: number }>;
  archportal: Record<string, { capabilities: string[]; impact_level: string; dependencies: string[] }>;
  architecture_document: string;
  security_controls: SecurityControl[];
  sample_intakes: Record<string, string | number | boolean>[];
  wiki_design_template_url: string;
}

export const fixtures = fixturesJson as unknown as Fixtures;
export const canonicalFields = canonical.fields as CanonicalField[];
export const canonicalEnums = canonical.enums as Record<string, string[]>;
export const coverageQuestions = coverageMap.questions as Record<string, { fields: string[]; owner_agent: AgentType }>;
export const masterQuestions = master.questions as { id: string; system: string; section: string; text: string }[];
export const SECTIONS = Array.from(new Set(canonicalFields.map((f) => f.section)));
