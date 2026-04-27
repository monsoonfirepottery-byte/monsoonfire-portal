"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const policy_1 = require("./policy");
const state_1 = require("./state");
const NOW = "2026-04-27T12:00:00.000Z";
function pgSnapshot(overrides = {}) {
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
function snapshotForActions(actions) {
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
(0, node_test_1.default)("classifies DBA pressure and maps safe/approval/manual recovery boundaries", () => {
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
    const findings = (0, policy_1.classifyPostgresDbaFindings)(postgres);
    strict_1.default.ok(findings.some((entry) => entry.code === "connection_utilization_high"));
    strict_1.default.ok(findings.some((entry) => entry.code === "table_dead_tuple_pressure"));
    strict_1.default.ok(findings.some((entry) => entry.code === "table_analyze_stale"));
    strict_1.default.ok(findings.some((entry) => entry.code === "long_running_queries" && entry.severity === "critical"));
    const actions = (0, policy_1.deriveMemoryOpsActions)({
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
    strict_1.default.equal(actions.find((entry) => entry.title === "Analyze memory tables")?.policy, "safe_auto");
    strict_1.default.equal(actions.find((entry) => entry.title === "Run VACUUM ANALYZE on memory tables")?.policy, "approval_required");
    strict_1.default.equal(actions.find((entry) => entry.title === "Investigate long-running memory queries")?.policy, "manual_only");
    strict_1.default.equal(actions.find((entry) => entry.title === "Reduce memory import concurrency")?.policy, "manual_only");
});
(0, node_test_1.default)("maps memory backlog and duplicate processes without silently fixing truth", () => {
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
    const memoryFindings = (0, policy_1.classifyMemoryFindings)(memory);
    const duplicateService = {
        id: "duplicate-open-memory-import",
        label: "Open memory import companion",
        kind: "process",
        health: "degraded",
        status: "duplicate",
        summary: "Two import companions are running.",
        checkedAt: NOW,
        evidence: { serviceId: "duplicate-open-memory-import", pids: [101, 102] },
    };
    const actions = (0, policy_1.deriveMemoryOpsActions)({
        findings: memoryFindings.findings,
        services: [duplicateService],
        memory,
        postgres: null,
        nowIso: NOW,
    });
    strict_1.default.equal(actions.find((entry) => entry.title === "Refresh memory stats rollup")?.policy, "safe_auto");
    strict_1.default.equal(actions.find((entry) => entry.title === "Refresh memory review cases")?.policy, "safe_auto");
    const duplicateAction = actions.find((entry) => entry.title.includes("Open memory import companion"));
    strict_1.default.equal(duplicateAction?.policy, "approval_required");
    strict_1.default.deepEqual(duplicateAction?.execution, { kind: "process_kill", pids: [101, 102] });
    strict_1.default.equal(memoryFindings.stuckItems.length >= 3, true);
});
(0, node_test_1.default)("keeps action approval state idempotent across repeated supervisor loops", () => {
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
    const firstActions = (0, policy_1.deriveMemoryOpsActions)({
        findings: (0, policy_1.classifyPostgresDbaFindings)(postgres),
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
    const approved = firstActions.map((entry) => entry.policy === "approval_required"
        ? { ...entry, status: "approved", approvedAt: NOW, approvedBy: "staff:test" }
        : entry);
    const merged = (0, state_1.mergeMemoryOpsActions)(snapshotForActions(approved), firstActions, "2026-04-27T12:05:00.000Z");
    const vacuum = merged.find((entry) => entry.title === "Run VACUUM ANALYZE on memory tables");
    strict_1.default.equal(vacuum?.status, "approved");
    strict_1.default.equal(vacuum?.approvedBy, "staff:test");
    strict_1.default.equal(vacuum?.firstSeenAt, NOW);
    strict_1.default.equal(vacuum?.lastSeenAt, "2026-04-27T12:05:00.000Z");
});
