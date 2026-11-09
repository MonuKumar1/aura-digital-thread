import type {
  AdvanceResponse, ChatResponse, ChatTurn, CmdbRecord, CoverageReport, DeadlinesResponse, DetectResult, HistoryResponse,
  Intake, IntakeFields, IntakePage, IntakeQuery, IntakeSummary, Metrics, OrchestrationResult, PortfolioRecord,
  ProgressEvent, ReviewAnswer, WorkItemLink, WorkItemManifest, WorkItemState,
} from "../types";

export interface MeridianApi {
  readonly mode: "mock" | "live";
  createIntake(data: Partial<IntakeFields>): Promise<Intake>;
  listIntakes(query: IntakeQuery): Promise<IntakePage>;
  intakeSummary(sponsorEmail?: string): Promise<IntakeSummary>;
  getIntake(id: number): Promise<Intake>;
  updateIntake(id: number, patch: Partial<IntakeFields> & { changed_by?: string }): Promise<Intake>;
  uploadDesignDocument(id: number, file: File): Promise<Intake>;
  listReviewAnswers(id: number): Promise<ReviewAnswer[]>;
  submitReviewAnswers(id: number, answers: ReviewAnswer[]): Promise<OrchestrationResult>;
  runOrchestration(id: number): Promise<OrchestrationResult>;
  /** Streams progress events; resolves with the final result. Returns via onEvent as it goes. */
  runOrchestrationStream(id: number, onEvent: (e: ProgressEvent) => void): Promise<OrchestrationResult>;
  getResult(id: number): Promise<OrchestrationResult | null>;
  cmdbLookup(ciId: string): Promise<CmdbRecord | null>;
  cmdbRecords(): Promise<CmdbRecord[]>;
  portfolioLookup(id: string): Promise<PortfolioRecord | null>;
  coverage(id: number): Promise<CoverageReport>;
  metrics(): Promise<Metrics>;
  detect(text: string): Promise<DetectResult>;
  stageDeadlines(id: number): Promise<DeadlinesResponse>;
  updateStageDeadline(id: number, stage: string, dueDate: string): Promise<DeadlinesResponse>;
  advanceStage(id: number, comment: string, approvedBy: string): Promise<AdvanceResponse>;
  history(id: number): Promise<HistoryResponse>;
  buildManifest(id: number): Promise<WorkItemManifest>;
  createWorkItems(id: number): Promise<WorkItemLink[]>;
  workItemLinks(id: number): Promise<WorkItemLink[]>;
  updateWorkItemState(externalId: string, state: WorkItemState): Promise<WorkItemLink>;
  chat(intakeId: number, message: string, history: ChatTurn[]): Promise<ChatResponse>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
