import test from "node:test";
import assert from "node:assert/strict";
import type { MemoryOpsPostgresSnapshot, MemoryOpsServiceProbe, MemoryOpsSnapshot } from "./contracts";
import {
  classifyMemoryFindings,
  classifyPostgresDbaFindings,
  deriveMemoryOpsActions,
} from "./policy";
import { mergeMemoryOpsActions } from "./state";

const NOW = "2026-04-27T12:00:00.000Z";

function pgSnapshot(overrides: Partial<MemoryOpsPostgresSnapshot> = {}): MemoryOpsPostgresSnapshot {
  return {
    ok: true,
    checkedAt: NOW,
    latencyMs: 12,
    connectionSummary: {
      maxConnections: 100,
      total: 88,
      active: 34,
      idle: 50,
      idleInTransaction: 2,
      waiting: 1,
      utilization: 0.88,
    },
    longRunningQueries: [],
    tableStats: [],
    indexStats: [],
    databaseStats: {
      tempFiles: 0,
      tempBytes: 0,
      deadlocks: 0,
    },
    pgStatStatementsAvailable: true,
    ...overrides,
  };
}

function snapshotForActions(actions: MemoryOpsSnapshot["actions"]): MemoryOpsSnapshot {
  return {
    schema: "studio-brain.memory-ops.snapshot.v1",
    generatedAt: NOW,
    status: "degraded",
    summary: "test",
    supervisor: {
      heartbeatAt: NOW,
      mode: "supervised",
      version: "test",
    },
    memory: {
      checkedAt: NOW,
      pressure: null,
      stats: null,
      statsRollupAgeMinutes: null,
    },
    postgres: null,
    services: [],
    findings: [],
    stuckItems: [],
    actions,
    receipts: [],
  };
}

test("classifies DBA pressure and maps safe/approval/manual recovery boundaries", () => {
  const postgres = pgSnapshot({
    tableStats: [
      {
        tableName: "swarm_memory",
        liveRows: 80_000,
        deadRows: 28_000,
        deadPct: 35,
        lastVacuum: "2026-04-24T00:00:00.000Z",
        lastAnalyze: "2026-04-24T00:00:00.000Z",
      },
    ],
    longRunningQueries: [
      {
        pid: 42,
        applicationName: "studio-brain",
        state: "active",
        durationSeconds: 930,
        waitEventType: null,
        query: "select * from swarm_memory",
      },
    ],
  });
  const findings = classifyPostgresDbaFindings(postgres);
  assert.ok(findings.some((entry) => entry.code === "connection_utilization_high"));
  assert.ok(findings.some((entry) => entry.code === "table_dead_tuple_pressure"));
  assert.ok(findings.some((entry) => entry.code === "table_analyze_stale"));
  assert.ok(findings.some((entry) => entry.code === "long_running_queries" && entry.severity === "critical"));

  const actions = deriveMemoryOpsActions({
    findings,
    services: [],
    memory: {
      checkedAt: NOW,
      pressure: null,
      stats: null,
      statsRollupAgeMinutes: null,
    },
    postgres,
    nowIso: NOW,
  });

  assert.equal(actions.find((entry) => entry.title === "Analyze memory tables")?.policy, "safe_auto");
  assert.equal(actions.find((entry) => entry.title === "Run VACUUM ANALYZE on memory tables")?.policy, "approval_required");
  assert.equal(actions.find((entry) => entry.title === "Investigate long-running memory queries")?.policy, "manual_only");
  assert.equal(actions.find((entry) => entry.title === "Reduce memory import concurrency")?.policy, "manual_only");
});

test("maps memory backlog and duplicate processes without silently fixing truth", () => {
  const memory = {
    checkedAt: NOW,
    pressure: null,
    stats: {
      total: 100,
      reviewNow: 12,
      resolveConflict: 4,
      revalidate: 2,
      retire: 1,
      verificationFailures24h: 3,
      openReviewCases: 5,
      hardConflicts: 1,
      retrievalShadowedRows: 0,
      consolidationStatus: "failed",
      consolidationLastRunAt: "2026-04-26T00:00:00.000Z",
      consolidationStale: true,
    },
    statsRollupAgeMinutes: 25,
  };
  const memoryFindings = classifyMemoryFindings(memory);
  const duplicateService: MemoryOpsServiceProbe = {
    id: "duplicate-open-memory-import",
    label: "Open memory import companion",
    kind: "process",
    health: "degraded",
    status: "duplicate",
    summary: "Two import companions are running.",
    checkedAt: NOW,
    evidence: { serviceId: "duplicate-open-memory-import", pids: [101, 102] },
  };
  const actions = deriveMemoryOpsActions({
    findings: memoryFindings.findings,
    services: [duplicateService],
    memory,
    postgres: null,
    nowIso: NOW,
  });

  assert.equal(actions.find((entry) => entry.title === "Refresh memory stats rollup")?.policy, "safe_auto");
  assert.equal(actions.find((entry) => entry.title === "Refresh memory review cases")?.policy, "safe_auto");
  const duplicateAction = actions.find((entry) => entry.title.includes("Open memory import companion"));
  assert.equal(duplicateAction?.policy, "approval_required");
  assert.deepEqual(duplicateAction?.execution, { kind: "process_kill", pids: [101, 102] });
  assert.equal(memoryFindings.stuckItems.length >= 3, true);
});

test("keeps action approval state idempotent across repeated supervisor loops", () => {
  const postgres = pgSnapshot({
    tableStats: [
      {
        tableName: "swarm_memory",
        liveRows: 80_000,
        deadRows: 28_000,
        deadPct: 35,
        lastVacuum: null,
        lastAnalyze: null,
      },
    ],
  });
  const firstActions = deriveMemoryOpsActions({
    findings: classifyPostgresDbaFindings(postgres),
    services: [],
    memory: {
      checkedAt: NOW,
      pressure: null,
      stats: null,
      statsRollupAgeMinutes: null,
    },
    postgres,
    nowIso: NOW,
  });
  const approved = firstActions.map((entry) =>
    entry.policy === "approval_required"
      ? { ...entry, status: "approved" as const, approvedAt: NOW, approvedBy: "staff:test" }
      : entry,
  );
  const merged = mergeMemoryOpsActions(snapshotForActions(approved), firstActions, "2026-04-27T12:05:00.000Z");
  const vacuum = merged.find((entry) => entry.title === "Run VACUUM ANALYZE on memory tables");
  assert.equal(vacuum?.status, "approved");
  assert.equal(vacuum?.approvedBy, "staff:test");
  assert.equal(vacuum?.firstSeenAt, NOW);
  assert.equal(vacuum?.lastSeenAt, "2026-04-27T12:05:00.000Z");
});
