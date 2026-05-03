export type MemoryOpsHealth = "healthy" | "degraded" | "critical" | "unknown";

export type MemoryOpsRecoveryPolicy = "safe_auto" | "approval_required" | "manual_only";

export type MemoryOpsActionStatus =
  | "proposed"
  | "approved"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export type MemoryOpsFinding = {
  id: string;
  code: string;
  area: "memory" | "postgres" | "docker" | "systemd" | "process" | "stuck-items";
  severity: "info" | "warning" | "critical";
  title: string;
  summary: string;
  evidence?: Record<string, unknown>;
};

export type MemoryOpsActionExecution =
  | { kind: "none" }
  | { kind: "http_get"; path: string }
  | { kind: "postgres_analyze"; tables: string[] }
  | { kind: "postgres_vacuum_analyze"; tables: string[] }
  | { kind: "systemctl_user"; verb: "restart" | "start" | "stop"; service: string }
  | { kind: "docker_compose"; verb: "restart"; service: "postgres" | "redis" | "minio" }
  | { kind: "process_kill"; pids: number[] };

export type MemoryOpsAction = {
  id: string;
  policy: MemoryOpsRecoveryPolicy;
  status: MemoryOpsActionStatus;
  title: string;
  summary: string;
  reason: string;
  findingIds: string[];
  execution: MemoryOpsActionExecution;
  firstSeenAt: string;
  lastSeenAt: string;
  approvedAt?: string | null;
  approvedBy?: string | null;
  executedAt?: string | null;
  executionSummary?: string | null;
};

export type MemoryOpsReceipt = {
  id: string;
  actionId: string;
  at: string;
  actor: string;
  status: "approved" | "executed" | "failed" | "skipped";
  summary: string;
  details?: Record<string, unknown>;
};

export type MemoryOpsServiceProbe = {
  id: string;
  label: string;
  kind: "http" | "docker" | "systemd" | "process";
  health: MemoryOpsHealth;
  status: string;
  summary: string;
  checkedAt: string;
  evidence?: Record<string, unknown>;
};

export type MemoryOpsPostgresSnapshot = {
  ok: boolean;
  checkedAt: string;
  latencyMs: number | null;
  error?: string | null;
  connectionSummary: {
    maxConnections: number | null;
    total: number;
    active: number;
    idle: number;
    idleInTransaction: number;
    waiting: number;
    utilization: number | null;
  };
  longRunningQueries: Array<{
    pid: number;
    applicationName: string;
    state: string;
    durationSeconds: number;
    waitEventType: string | null;
    query: string;
  }>;
  tableStats: Array<{
    tableName: string;
    liveRows: number;
    deadRows: number;
    deadPct: number | null;
    lastVacuum: string | null;
    lastAnalyze: string | null;
  }>;
  indexStats: Array<{
    tableName: string;
    indexName: string;
    scans: number;
    sizeBytes: number;
  }>;
  databaseStats: {
    tempFiles: number;
    tempBytes: number;
    deadlocks: number;
  };
  pgStatStatementsAvailable: boolean;
};

export type MemoryOpsMemorySnapshot = {
  checkedAt: string;
  pressure?: Record<string, unknown> | null;
  stats?: {
    total: number;
    reviewNow: number;
    resolveConflict: number;
    revalidate: number;
    retire: number;
    verificationFailures24h: number;
    openReviewCases: number;
    hardConflicts: number;
    retrievalShadowedRows: number;
    consolidationStatus: string | null;
    consolidationLastRunAt: string | null;
    consolidationStale: boolean;
  } | null;
  statsRollupAgeMinutes: number | null;
  statsError?: string | null;
};

export type MemoryOpsStuckItem = {
  id: string;
  kind:
    | "review-case"
    | "promotion-candidate"
    | "memory-conflict"
    | "verification-failure"
    | "consolidation";
  severity: "info" | "warning" | "critical";
  title: string;
  ageMinutes: number | null;
  summary: string;
  actionHint: string;
};

export type MemoryOpsSnapshot = {
  schema: "studio-brain.memory-ops.snapshot.v1";
  generatedAt: string;
  status: MemoryOpsHealth;
  summary: string;
  supervisor: {
    heartbeatAt: string;
    mode: "dry-run" | "supervised";
    version: string;
  };
  memory: MemoryOpsMemorySnapshot;
  postgres: MemoryOpsPostgresSnapshot | null;
  services: MemoryOpsServiceProbe[];
  findings: MemoryOpsFinding[];
  stuckItems: MemoryOpsStuckItem[];
  actions: MemoryOpsAction[];
  receipts: MemoryOpsReceipt[];
};

export type MemoryOpsEvent = {
  schema: "studio-brain.memory-ops.event.v1";
  id: string;
  at: string;
  kind: "snapshot" | "finding" | "action" | "receipt";
  severity: "info" | "warning" | "critical";
  title: string;
  summary: string;
  actionId?: string | null;
  payload?: Record<string, unknown>;
};
