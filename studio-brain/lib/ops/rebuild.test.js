"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const memoryStores_1 = require("../stores/memoryStores");
const rebuild_1 = require("./rebuild");
const sampleSnapshot = {
    schemaVersion: "v3.0",
    snapshotDate: "2026-02-13",
    generatedAt: "2026-02-13T00:00:00.000Z",
    cloudSync: {
        firestoreReadAt: "2026-02-13T00:00:00.000Z",
        stripeReadAt: "2026-02-13T00:00:00.000Z",
    },
    counts: {
        batchesActive: 3,
        batchesClosed: 10,
        reservationsOpen: 2,
        firingsScheduled: 1,
        reportsOpen: 0,
    },
    ops: {
        agentRequestsPending: 1,
        highSeverityReports: 0,
    },
    finance: {
        pendingOrders: 2,
        unsettledPayments: 1,
    },
    sourceHashes: {
        firestore: "hash-firestore",
        stripe: "hash-stripe",
    },
    diagnostics: {
        completeness: "full",
        warnings: [],
        sourceSample: {
            batchesScanned: 0,
            reservationsScanned: 0,
            firingsScanned: 0,
            reportsScanned: 0,
        },
        durationsMs: {
            firestoreRead: 12,
            stripeRead: 8,
        },
    },
};
(0, node_test_1.default)("runStudioStateRebuild hydrates snapshot from empty state store", async () => {
    const stateStore = new memoryStores_1.MemoryStateStore();
    const eventStore = new memoryStores_1.MemoryEventStore();
    const result = await (0, rebuild_1.runStudioStateRebuild)({
        stateStore,
        eventStore,
        actorId: "staff-001",
        compute: async () => sampleSnapshot,
        correlationId: "corr-1",
    });
    const latest = await stateStore.getLatestStudioState();
    strict_1.default.ok(latest);
    strict_1.default.equal(latest.snapshotDate, "2026-02-13");
    strict_1.default.equal(result.snapshotDate, "2026-02-13");
    strict_1.default.equal(result.previousSnapshotDate, null);
    const events = await eventStore.listRecent(10);
    strict_1.default.ok(events.some((row) => row.action === "studio_ops.rebuild_started"));
    strict_1.default.ok(events.some((row) => row.action === "studio_ops.rebuild_completed"));
});
(0, node_test_1.default)("runStudioStateRebuild records failure events on error", async () => {
    const stateStore = new memoryStores_1.MemoryStateStore();
    const eventStore = new memoryStores_1.MemoryEventStore();
    await strict_1.default.rejects((0, rebuild_1.runStudioStateRebuild)({
        stateStore,
        eventStore,
        actorId: "staff-002",
        compute: async () => {
            throw new Error("boom");
        },
        correlationId: "corr-2",
    }));
    const events = await eventStore.listRecent(10);
    strict_1.default.ok(events.some((row) => row.action === "studio_ops.rebuild_failed"));
});
