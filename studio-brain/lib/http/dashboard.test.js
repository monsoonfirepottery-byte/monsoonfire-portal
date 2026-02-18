"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const memoryStores_1 = require("../stores/memoryStores");
const dashboard_1 = require("./dashboard");
const compute_1 = require("../studioState/compute");
(0, node_test_1.default)("renderDashboard marks stale snapshots", async () => {
    const stateStore = new memoryStores_1.MemoryStateStore();
    const eventStore = new memoryStores_1.MemoryEventStore();
    const snapshot = (0, compute_1.buildStudioState)({
        firestore: {
            readAt: "2026-02-12T00:00:00.000Z",
            counts: {
                batchesActive: 1,
                batchesClosed: 2,
                reservationsOpen: 3,
                firingsScheduled: 4,
                reportsOpen: 5,
                agentRequestsPending: 0,
                highSeverityReports: 0,
                pendingOrders: 0,
            },
            sourceSample: {
                batchesScanned: 10,
                reservationsScanned: 10,
                firingsScanned: 10,
                reportsScanned: 10,
            },
        },
        stripe: {
            readAt: "2026-02-12T00:00:00.000Z",
            unsettledPayments: 0,
        },
    });
    snapshot.generatedAt = "2000-01-01T00:00:00.000Z";
    await stateStore.saveStudioState(snapshot);
    const html = await (0, dashboard_1.renderDashboard)(stateStore, eventStore, { staleThresholdMinutes: 10 });
    strict_1.default.ok(html.includes("Snapshot freshness"));
    strict_1.default.ok(html.includes("STALE"));
    strict_1.default.ok(html.includes("Derived from cloud"));
});
