"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const anomalyDetector_1 = require("./anomalyDetector");
function snapshot(partial) {
    return {
        schemaVersion: "v3.0",
        snapshotDate: "2026-02-13",
        generatedAt: "2026-02-13T00:00:00.000Z",
        cloudSync: { firestoreReadAt: "2026-02-13T00:00:00.000Z", stripeReadAt: null },
        counts: {
            batchesActive: 10,
            batchesClosed: 20,
            reservationsOpen: 10,
            firingsScheduled: 5,
            reportsOpen: 4,
        },
        ops: {
            agentRequestsPending: 4,
            highSeverityReports: 0,
        },
        finance: {
            pendingOrders: 1,
            unsettledPayments: 0,
        },
        sourceHashes: {
            firestore: "hash-1",
            stripe: null,
        },
        ...partial,
    };
}
(0, node_test_1.default)("detectOpsRecommendations emits baseline anomalies", () => {
    const current = snapshot({
        counts: { batchesActive: 30, batchesClosed: 20, reservationsOpen: 35, firingsScheduled: 1, reportsOpen: 4 },
        ops: { agentRequestsPending: 22, highSeverityReports: 0 },
    });
    const prev = snapshot({
        snapshotDate: "2026-02-12",
        counts: { batchesActive: 24, batchesClosed: 18, reservationsOpen: 28, firingsScheduled: 3, reportsOpen: 3 },
        ops: { agentRequestsPending: 10, highSeverityReports: 0 },
    });
    const result = (0, anomalyDetector_1.detectOpsRecommendations)(current, prev, {
        now: new Date("2026-02-13T00:05:00.000Z"),
        recentEvents: [],
    });
    strict_1.default.equal(result.emitted.length, 3);
    strict_1.default.equal(result.ruleHits.stalled_batches, 1);
    strict_1.default.equal(result.ruleHits.queue_spike, 1);
    strict_1.default.equal(result.ruleHits.overdue_reservations, 1);
});
(0, node_test_1.default)("detectOpsRecommendations throttles recently emitted rules", () => {
    const current = snapshot({
        counts: { batchesActive: 30, batchesClosed: 20, reservationsOpen: 10, firingsScheduled: 1, reportsOpen: 4 },
    });
    const result = (0, anomalyDetector_1.detectOpsRecommendations)(current, null, {
        now: new Date("2026-02-13T00:05:00.000Z"),
        recentEvents: [
            {
                id: "evt-1",
                at: "2026-02-13T00:00:00.000Z",
                actorType: "system",
                actorId: "studio-brain",
                action: "studio_ops.recommendation_draft_created",
                rationale: "recent",
                target: "local",
                approvalState: "exempt",
                inputHash: "a",
                outputHash: "b",
                metadata: { ruleId: "stalled_batches" },
            },
        ],
    });
    strict_1.default.equal(result.emitted.length, 0);
    strict_1.default.equal(result.suppressedCount, 1);
});
(0, node_test_1.default)("detectOpsRecommendations suppresses false positives when queue stable", () => {
    const current = snapshot({
        ops: { agentRequestsPending: 9, highSeverityReports: 0 },
    });
    const prev = snapshot({
        snapshotDate: "2026-02-12",
        ops: { agentRequestsPending: 8, highSeverityReports: 0 },
    });
    const result = (0, anomalyDetector_1.detectOpsRecommendations)(current, prev, {
        now: new Date("2026-02-13T00:05:00.000Z"),
        recentEvents: [],
    });
    strict_1.default.equal(result.emitted.length, 0);
    strict_1.default.equal(result.ruleHits.queue_spike, 0);
});
