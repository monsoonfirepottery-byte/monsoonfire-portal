"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const reconciliation_1 = require("./reconciliation");
function baseSnapshot(overrides) {
    return {
        schemaVersion: "v3.0",
        snapshotDate: "2026-02-13",
        generatedAt: "2026-02-13T12:00:00.000Z",
        cloudSync: { firestoreReadAt: "2026-02-13T12:00:00.000Z", stripeReadAt: "2026-02-13T12:00:00.000Z" },
        counts: { batchesActive: 0, batchesClosed: 0, reservationsOpen: 0, firingsScheduled: 0, reportsOpen: 0 },
        ops: { agentRequestsPending: 0, highSeverityReports: 0 },
        finance: { pendingOrders: 0, unsettledPayments: 0 },
        sourceHashes: { firestore: "f", stripe: "s" },
        diagnostics: { completeness: "full", warnings: [] },
        ...overrides,
    };
}
(0, node_test_1.default)("detectFinanceReconciliation flags mismatch between pending orders and unsettled payments", () => {
    const snapshot = baseSnapshot({ finance: { pendingOrders: 4, unsettledPayments: 1 } });
    const summary = (0, reconciliation_1.detectFinanceReconciliation)(snapshot, null, {
        now: new Date("2026-02-13T12:30:00.000Z"),
        recentEvents: [],
    });
    strict_1.default.ok(summary.emitted.some((row) => row.ruleId === "pending_orders_unsettled_mismatch"));
});
(0, node_test_1.default)("detectFinanceReconciliation flags stale stripe read", () => {
    const snapshot = baseSnapshot({ cloudSync: { firestoreReadAt: "2026-02-13T12:00:00.000Z", stripeReadAt: null } });
    const summary = (0, reconciliation_1.detectFinanceReconciliation)(snapshot, null, {
        now: new Date("2026-02-14T13:00:00.000Z"),
        recentEvents: [],
    });
    strict_1.default.ok(summary.emitted.some((row) => row.ruleId === "stripe_read_stale"));
});
(0, node_test_1.default)("detectFinanceReconciliation suppresses recent duplicate draft", () => {
    const recentEvents = [
        {
            id: "e1",
            at: new Date("2026-02-13T12:00:00.000Z").toISOString(),
            actorType: "system",
            actorId: "studio-brain",
            action: "studio_finance.reconciliation_draft_created",
            rationale: "duplicate",
            target: "local",
            approvalState: "exempt",
            inputHash: "x",
            outputHash: null,
            metadata: { ruleId: "pending_orders_unsettled_mismatch" },
        },
    ];
    const snapshot = baseSnapshot({ finance: { pendingOrders: 3, unsettledPayments: 1 } });
    const summary = (0, reconciliation_1.detectFinanceReconciliation)(snapshot, null, {
        now: new Date("2026-02-13T12:10:00.000Z"),
        recentEvents,
        cooldownMinutes: 60,
    });
    strict_1.default.equal(summary.emitted.some((row) => row.ruleId === "pending_orders_unsettled_mismatch"), false);
    strict_1.default.equal(summary.suppressedCount, 1);
});
