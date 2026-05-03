import test from "node:test";
import assert from "node:assert/strict";
import type { MemoryOpsSnapshot } from "./contracts";
import {
  buildMemoryOpsAttention,
  buildMemoryOpsEvents,
  buildMemoryOpsNextMoves,
  buildMemoryOpsServiceCards,
  summarizeMemoryOpsForControlTower,
} from "./controlTower";

const NOW = "2026-04-27T12:00:00.000Z";

function snapshot(overrides: Partial<MemoryOpsSnapshot> = {}): MemoryOpsSnapshot {
  return {
    schema: "studio-brain.memory-ops.snapshot.v1",
    generatedAt: NOW,
    status: "degraded",
    summary: "Memory ops has 0 critical finding(s) and 2 warning finding(s).",
    supervisor: {
      heartbeatAt: NOW,
      mode: "supervised",
      version: "test",
    },
    memory: {
      checkedAt: NOW,
      pressure: null,
      stats: null,
      statsRollupAgeMinutes: 25,
    },
    postgres: {
      ok: true,
      checkedAt: NOW,
      latencyMs: 20,
      connectionSummary: {
        maxConnections: 100,
        total: 12,
        active: 2,
        idle: 10,
        idleInTransaction: 0,
        waiting: 0,
        utilization: 0.12,
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
    },
    services: [
      {
        id: "postgres",
        label: "Postgres",
        kind: "docker",
        health: "healthy",
        status: "running",
        summary: "Postgres is running.",
        checkedAt: NOW,
      },
      {
        id: "redis",
        label: "Redis",
        kind: "docker",
        health: "critical",
        status: "down",
        summary: "Redis is not running.",
        checkedAt: NOW,
      },
    ],
    findings: [
      {
        id: "finding:stale-stats",
        area: "memory",
        code: "stats_rollup_stale",
        severity: "warning",
        title: "Memory stats rollup is stale",
        summary: "The memory stats rollup is 25 minutes old.",
      },
      {
        id: "finding:redis",
        area: "docker",
        code: "docker_service_critical",
        severity: "critical",
        title: "Redis needs attention",
        summary: "Redis is not running.",
      },
    ],
    stuckItems: [
      {
        id: "stuck:review",
        kind: "review-case",
        severity: "warning",
        title: "Memory review cases are open",
        ageMinutes: null,
        summary: "5 memory review case(s) are open or in progress.",
        actionHint: "Prioritize stale open review cases.",
      },
    ],
    actions: [
      {
        id: "action:refresh",
        policy: "safe_auto",
        status: "proposed",
        title: "Refresh memory stats rollup",
        summary: "Re-run lightweight stats.",
        reason: "stats-rollup-stale",
        findingIds: ["finding:stale-stats"],
        execution: { kind: "http_get", path: "/api/memory/stats" },
        firstSeenAt: NOW,
        lastSeenAt: NOW,
      },
      {
        id: "action:redis-restart",
        policy: "approval_required",
        status: "proposed",
        title: "Restart Docker Redis",
        summary: "Redis is not healthy according to the sidecar probe.",
        reason: "docker-service-critical:redis",
        findingIds: ["finding:redis"],
        execution: { kind: "docker_compose", verb: "restart", service: "redis" },
        firstSeenAt: NOW,
        lastSeenAt: NOW,
      },
    ],
    receipts: [
      {
        id: "receipt:refresh",
        actionId: "action:refresh",
        at: NOW,
        actor: "memory-ops-sidecar",
        status: "executed",
        summary: "Executed Refresh memory stats rollup.",
      },
    ],
    ...overrides,
  };
}

test("builds Control Tower cards for responsiveness, DBA, Docker, stuck items, and approvals", () => {
  const cards = buildMemoryOpsServiceCards(snapshot());
  assert.deepEqual(cards.map((card) => card.id), [
    "memory-responsiveness",
    "memory-dba",
    "memory-docker",
    "memory-stuck-items",
    "memory-ops-approvals",
  ]);
  assert.equal(cards.find((card) => card.id === "memory-docker")?.health, "error");
  assert.equal(cards.find((card) => card.id === "memory-ops-approvals")?.health, "waiting");
});

test("summarizes pending approvals, stuck work, next moves, and receipts", () => {
  const current = snapshot();
  const summary = summarizeMemoryOpsForControlTower(current);
  assert.equal(summary?.pendingApprovalCount, 1);
  assert.equal(summary?.stuckItemCount, 1);

  const attention = buildMemoryOpsAttention(current);
  assert.ok(attention.some((entry) => /Restart Docker Redis/.test(entry.title)));

  const nextMoves = buildMemoryOpsNextMoves(current);
  assert.ok(nextMoves.some((entry) => /Refresh memory stats rollup/.test(entry.title)));

  const events = buildMemoryOpsEvents(current);
  assert.ok(events.some((entry) => entry.sourceAction === "control_tower.memory_ops"));
  assert.ok(events.some((entry) => entry.sourceAction === "control_tower.memory_ops_receipt"));
});

test("shows a sidecar heartbeat warning before the first snapshot exists", () => {
  const cards = buildMemoryOpsServiceCards(null);
  assert.equal(cards[0]?.id, "memory-ops-sidecar");
  assert.equal(cards[0]?.health, "waiting");
  assert.equal(buildMemoryOpsAttention(null)[0]?.title, "Memory ops sidecar has no heartbeat");
});
