import type { AgentRuntimePartnerContext } from "../partner/contracts";

export type AgentRuntimeRiskLane = "interactive" | "background" | "high_risk";
export type AgentRuntimeStatus = "queued" | "running" | "blocked" | "verified" | "completed" | "failed";

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
    contactReason?: string | null;
    verifiedContext?: string[];
    decisionNeeded?: string | null;
  };
};
