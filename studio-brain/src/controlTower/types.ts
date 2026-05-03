import type { AuditEvent, OverseerRunRecord } from "../stores/interfaces";
import type { AgentRuntimeSummary } from "../agentRuntime/contracts";
import type { PartnerBrief } from "../partner/contracts";
import type { MemoryOpsControlTowerSummary } from "../memoryOps/controlTower";

export type ControlTowerAgentStatus = "working" | "waiting" | "idle" | "parked" | "error";
export type ControlTowerHealth = "healthy" | "waiting" | "error" | "neutral";
export type ControlTowerRoomMood = "active" | "waiting" | "blocked" | "quiet";
export type ControlTowerSeverity = "info" | "warning" | "critical";
export type ControlTowerEventKind =
  | "alert"
  | "service"
  | "room"
  | "overseer"
  | "operator"
  | "ack"
  | "session";
export type ControlTowerEventType =
  | "run.status"
  | "task.updated"
  | "approval.requested"
  | "incident.raised"
  | "memory.promoted"
  | "channel.bound"
  | "health.changed";
export type ControlTowerContinuityState = "ready" | "continuity_degraded" | "missing";
export type ControlTowerMemoryConsolidationMode = "idle" | "scheduled" | "running" | "repair" | "unavailable";
export type ControlTowerHostEnvironment = "local" | "server";
export type ControlTowerHostHealth = "healthy" | "degraded" | "offline" | "maintenance";
export type ControlTowerHostConnectivity = "online" | "stale" | "offline";

export type ControlTowerTheme = {
  name: "desert-night" | "paper-day";
  label: string;
  colorMode: "dark" | "light";
  motionLevel: "calm";
  highContrast: boolean;
  refreshMode: "diff-only";
};

export type ControlTowerPane = {
  windowName: string;
  currentCommand: string;
  cwd: string;
  paneActive: boolean;
};

export type ControlTowerSession = {
  sessionName: string;
  rootSession: boolean;
  attached: boolean;
  lastActivityAt: string | null;
  lastActivityEpochMs: number;
  paneCount: number;
  windowCount: number;
  cwd: string;
  repo: string;
  tool: string;
  room: string;
  status: ControlTowerAgentStatus;
  statusLabel: string;
  objective: string;
  summary: string;
  metadata: Record<string, unknown>;
  panes: ControlTowerPane[];
};

export type ControlTowerRawRoom = {
  id: string;
  label: string;
  repo: string;
  mood: ControlTowerRoomMood;
  summary: string;
  sessions: ControlTowerSession[];
};

export type ControlTowerRawService = {
  id: string;
  label: string;
  allowedActions: string[];
  activeState: string;
  subState: string;
  unitFileState: string;
  status: ControlTowerHealth;
  summary: string;
  changedAt: string | null;
};

export type ControlTowerPinnedItem = {
  id: string;
  title: string;
  detail: string;
  status: "pinned";
  actionHint: string;
};

export type ControlTowerRawAlert = {
  id: string;
  level: ControlTowerSeverity;
  title: string;
  summary: string;
  roomId?: string | null;
  serviceId?: string | null;
};

export type ControlTowerRawState = {
  generatedAt: string;
  repoRoot: string;
  rootSession: string;
  hostUser: string;
  theme: ControlTowerTheme;
  services: ControlTowerRawService[];
  ops: {
    overallStatus: ControlTowerHealth;
    heartbeatStatus: string;
    postureStatus: string;
    overseerStatus: string;
    summary: string;
    ackEntries: Array<Record<string, unknown>>;
    latestRunId: string;
    existingOpsEnabled: boolean;
    heartbeat: Record<string, unknown> | null;
    latestStatus: Record<string, unknown> | null;
    existingState: Record<string, unknown> | null;
    overseer: OverseerRunRecord | null;
    overseerDiscord: Record<string, unknown> | null;
  };
  sessions: ControlTowerSession[];
  agents: ControlTowerSession[];
  rooms: ControlTowerRawRoom[];
  alerts: ControlTowerRawAlert[];
  pinnedItems: ControlTowerPinnedItem[];
  counts: {
    needsAttention: number;
    working: number;
    waiting: number;
    blocked: number;
    escalated: number;
  };
  sources: {
    operatorStatePath: string;
    heartbeatPath: string;
    overseerPath: string;
    ackLogPath: string;
  };
};

export type ControlTowerActionTarget =
  | { type: "room"; roomId: string }
  | { type: "session"; sessionName: string }
  | { type: "service"; serviceId: string }
  | { type: "ops"; action: string };

export type ControlTowerNextAction = {
  id: string;
  title: string;
  why: string;
  ageMinutes: number | null;
  actionLabel: string;
  target: ControlTowerActionTarget;
};

export type ControlTowerEvent = {
  id: string;
  at: string;
  kind: ControlTowerEventKind;
  type: ControlTowerEventType;
  runId: string | null;
  agentId: string | null;
  channel: string | null;
  occurredAt: string;
  severity: ControlTowerSeverity;
  title: string;
  summary: string;
  actor: string;
  roomId: string | null;
  serviceId: string | null;
  actionLabel: string | null;
  sourceAction: string | null;
  payload: Record<string, unknown>;
};

export type ControlTowerBoardRow = {
  id: string;
  owner: string;
  task: string;
  state: string;
  blocker: string;
  next: string;
  last_update: string | null;
  runId?: string | null;
  roomId: string | null;
  sessionName: string | null;
  contactReason?: string | null;
  verifiedContext?: string[];
  decisionNeeded?: string | null;
};

export type ControlTowerChannelSummary = {
  id: string;
  label: string;
  channel: "codex" | "discord" | "planning" | "ops" | "service" | "unknown";
  owner: string;
  state: string;
  objective: string;
  blocker: string;
  next: string;
  lastUpdate: string | null;
  roomId: string | null;
  sessionName: string | null;
};

export type ControlTowerApprovalItem = {
  id: string;
  capabilityId: string;
  summary: string;
  requestedBy: string;
  status: "draft" | "pending_approval" | "approved" | "rejected" | "executed";
  createdAt: string;
  owner: string;
  approvalMode: "required" | "exempt";
  risk: "low" | "medium" | "high" | "critical";
  previewInput?: Record<string, unknown>;
  expectedEffects?: string[];
  target: ControlTowerActionTarget;
};

export type ControlTowerHostCard = {
  hostId: string;
  label: string;
  environment: ControlTowerHostEnvironment;
  role: string;
  connectivity: ControlTowerHostConnectivity;
  health: ControlTowerHostHealth;
  lastSeenAt: string | null;
  ageMinutes: number | null;
  currentRunId: string | null;
  agentCount: number;
  version: string | null;
  metadata?: Record<string, unknown>;
  summary: string;
  metrics: {
    cpuPct: number | null;
    memoryPct: number | null;
    load1: number | null;
  };
};

export type ControlTowerMemoryConsolidation = {
  mode: ControlTowerMemoryConsolidationMode;
  status?: string | null;
  summary: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  focusAreas: string[];
  maintenanceActions: string[];
  outputs: string[];
  counts?: {
    promotions: number;
    archives: number;
    quarantines: number;
    repairedLinks: number;
  };
  mixQuality?: string | null;
  dominanceWarnings?: string[];
  secondPassQueriesUsed?: number | null;
  promotionCandidatesPending?: number | null;
  promotionCandidatesConfirmed?: number | null;
  stalledCandidateCount?: number | null;
  actionabilityStatus?: string | null;
  actionableInsightCount?: number | null;
  suppressedConnectionNoteCount?: number | null;
  suppressedPseudoDecisionCount?: number | null;
  topActions?: string[];
  lastError?: string | null;
};

export type ControlTowerMemoryBrief = {
  schema: "studio-brain.memory-brief.v1";
  generatedAt: string;
  continuityState: ControlTowerContinuityState;
  summary: string;
  goal: string;
  blockers: string[];
  recentDecisions: string[];
  recommendedNextActions: string[];
  fallbackSources: string[];
  sourcePath: string | null;
  layers: {
    coreBlocks: string[];
    workingMemory: string[];
    episodicMemory: string[];
    canonicalMemory: string[];
  };
  consolidation: ControlTowerMemoryConsolidation;
};

export type ControlTowerStartupScorecard = {
  schema: string;
  sourcePath: string | null;
  generatedAtIso: string;
  latest: {
    sample: {
      status: string;
      reasonCode: string;
      continuityState: string;
      latencyMs: number | null;
    };
  };
  metrics: {
    readyRate: number | null;
    groundingReadyRate: number | null;
    blockedContinuityRate: number | null;
    p95LatencyMs: number | null;
  };
  supportingSignals: {
    toolcalls: {
      startupEntries: number;
      startupFailures: number;
      startupFailureRate: number | null;
      groundingObservedEntries: number;
      groundingLineComplianceRate: number | null;
      preStartupRepoReadObservedEntries: number;
      averagePreStartupRepoReads: number | null;
      preStartupRepoReadFreeRate: number | null;
      telemetryCoverageRate: number | null;
      repeatFailureBursts: number;
    };
  };
  coverage: {
    gaps: string[];
  };
  launcherCoverage: {
    liveStartupSamples: number;
    requiredLiveStartupSamples: number;
    trustworthy: boolean;
  };
  rubric: {
    overallScore: number | null;
    grade: string;
  };
  recommendations: string[];
};

export type ControlTowerMemoryHealth = {
  severity: ControlTowerSeverity;
  summary: string;
  highlights: string[];
  coverage: {
    rowsWithLattice: number;
    totalRows: number;
    ratio: number | null;
  };
  reviewBacklog: {
    reviewNow: number;
    revalidate: number;
    resolveConflict: number;
    retire: number;
    folkloreRiskHigh: number;
  };
  openReviewCases: number;
  verificationFailures24h: number;
  emberPromotionBacklog: number;
  conflictBacklog: {
    contestedRows: number;
    hardConflicts: number;
    quarantinedRows: number;
    conflictRecords: number;
    retrievalShadowedRows: number;
  };
  startupReadiness: {
    startupEligibleRows: number;
    trustedStartupRows: number;
    handoffRows: number;
    checkpointRows: number;
    fallbackRiskRows: number;
  };
  secretExposureFindings: {
    totalRows: number;
    redactedRows: number;
    requiresReviewRows: number;
    canonicalBlockedRows: number;
    quarantinedRows: number;
  };
  shadowMcpFindings: {
    totalRows: number;
    governedRows: number;
    ungovernedRows: number;
    reviewRows: number;
    highRiskRows: number;
  };
};

export type ControlTowerRoomSummary = {
  id: string;
  name: string;
  project: string;
  cwd: string;
  tool: string;
  status: ControlTowerAgentStatus | "blocked" | "quiet";
  objective: string;
  lastActivityAt: string | null;
  ageMinutes: number | null;
  isEscalated: boolean;
  nextActions: ControlTowerNextAction[];
  sessionNames: string[];
  summary: string;
  contactReason?: string | null;
  verifiedContext?: string[];
  decisionNeeded?: string | null;
};

export type ControlTowerRoomDetail = ControlTowerRoomSummary & {
  room: ControlTowerRawRoom;
  sessions: ControlTowerSession[];
  recentEvents: ControlTowerEvent[];
  attach: {
    sessionName: string;
    sshCommand: string;
    remoteCommand: string;
  } | null;
};

export type ControlTowerServiceCard = {
  id: string;
  label: string;
  health: ControlTowerHealth;
  impact: string;
  recentChanges: string;
  changedAt: string | null;
  summary: string;
  actions: Array<{
    id: string;
    label: string;
    verb: string;
    requiresConfirmation: boolean;
  }>;
};

export type ControlTowerAttentionItem = {
  id: string;
  title: string;
  why: string;
  ageMinutes: number | null;
  severity: ControlTowerSeverity;
  actionLabel: string;
  target: ControlTowerActionTarget;
};

export type ControlTowerOverview = {
  needsAttention: ControlTowerAttentionItem[];
  activeRooms: ControlTowerRoomSummary[];
  goodNextMoves: ControlTowerNextAction[];
  recentEvents: ControlTowerEvent[];
};

export type ControlTowerState = {
  generatedAt: string;
  theme: ControlTowerTheme;
  ops: ControlTowerRawState["ops"];
  alerts: ControlTowerRawAlert[];
  pinnedItems: ControlTowerPinnedItem[];
  services: ControlTowerServiceCard[];
  rooms: ControlTowerRoomSummary[];
  board: ControlTowerBoardRow[];
  channels: ControlTowerChannelSummary[];
  approvals: ControlTowerApprovalItem[];
  memoryBrief: ControlTowerMemoryBrief;
  startupScorecard: ControlTowerStartupScorecard | null;
  memoryHealth: ControlTowerMemoryHealth | null;
  memoryOps: MemoryOpsControlTowerSummary | null;
  agentRuntime: AgentRuntimeSummary | null;
  hosts: ControlTowerHostCard[];
  partner: PartnerBrief | null;
  events: ControlTowerEvent[];
  recentChanges: ControlTowerEvent[];
  actions: ControlTowerNextAction[];
  overview: ControlTowerOverview;
  eventStream: {
    endpoint: string;
    transport: "sse";
    heartbeatMs: number;
  };
  controlPlanes: {
    mcp: string;
    agentBus: string;
    operatorUi: string;
  };
  counts: ControlTowerRawState["counts"];
  sources: ControlTowerRawState["sources"];
};

export type ControlTowerActionResult = {
  ok: boolean;
  message?: string;
  [key: string]: unknown;
};

export type ControlTowerActionAuditInput = {
  actorId: string;
  rationale: string;
  metadata?: Record<string, unknown>;
};

export type ControlTowerRecentAudit = AuditEvent;
