import type { AgentRuntimePartnerContext } from "../partner/contracts";

export type AgentRuntimeRiskLane = "interactive" | "background" | "high_risk";
export type AgentRuntimeStatus = "queued" | "running" | "blocked" | "verified" | "completed" | "failed";
export type AgentRuntimeEnvironment = "local" | "server";

export type RatholeSignal = {
  signalId: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  summary: string;
  recommendedAction: string;
  createdAt: string;
  blocking: boolean;
};

export type GoalMiss = {
  category:
    | "bad_grounding"
    | "tool_mismatch"
    | "verification_omission"
    | "hidden_repo_state"
    | "memory_drift"
    | "user_intent_miss";
  summary: string;
  createdAt: string;
};

export type RunLedgerEvent = {
  schema: "agent-run-ledger-event.v1";
  eventId: string;
  runId: string;
  missionId: string;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
};

export type AgentRuntimeSummary = {
  schema: "agent-runtime-summary.v1";
  generatedAt?: string;
  runId: string;
  missionId: string;
  hostId?: string | null;
  agentId?: string | null;
  environment?: AgentRuntimeEnvironment | null;
  status: AgentRuntimeStatus;
  riskLane: AgentRuntimeRiskLane;
  title: string;
  goal: string;
  groundingSources: string[];
  acceptance: {
    total: number;
    pending: number;
    completed: number;
    failed: number;
  };
  activeBlockers: string[];
  ratholeSignals: RatholeSignal[];
  memoriesInfluencingRun: string[];
  goalMisses: GoalMiss[];
  lastEventType: string | null;
  updatedAt: string;
  partner?: AgentRuntimePartnerContext;
  boardRow: {
    id: string;
    owner: string;
    task: string;
    state: string;
    blocker: string;
    next: string;
    last_update: string | null;
    runId?: string | null;
    contactReason?: string | null;
    verifiedContext?: string[];
    decisionNeeded?: string | null;
  };
};

export type AgentRuntimeTraceStepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "skipped"
  | "info";

export type AgentRuntimeTraceStep = {
  stepId: string;
  runId: string;
  title: string;
  kind: "mission" | "verification" | "tool" | "diagnostic" | "event";
  status: AgentRuntimeTraceStepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  summary: string;
  evidenceRefs: string[];
  rawEventIds: string[];
};

export type AgentRuntimeToolCall = {
  toolCallId: string;
  runId: string;
  toolName: string;
  status: "requested" | "streaming" | "completed" | "failed";
  requestedAt: string | null;
  completedAt: string | null;
  summary: string;
  sideEffectClass: "read" | "write" | "unknown";
};

export type AgentRuntimeArtifact = {
  artifactId: string;
  runId: string;
  label: string;
  kind: "json" | "ledger" | "text" | "file";
  path: string;
  sizeBytes: number | null;
  updatedAt: string | null;
  preview: string | null;
};

export type AgentRuntimeDiagnostic = {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  summary: string;
  recommendedAction: string | null;
};

export type AgentRuntimeRunDetail = {
  schema: "agent-runtime-run-detail.v1";
  generatedAt: string;
  runId: string;
  summary: AgentRuntimeSummary | null;
  events: RunLedgerEvent[];
  steps: AgentRuntimeTraceStep[];
  toolCalls: AgentRuntimeToolCall[];
  diagnostics: AgentRuntimeDiagnostic[];
  artifacts: AgentRuntimeArtifact[];
  whyStuck: string | null;
};
