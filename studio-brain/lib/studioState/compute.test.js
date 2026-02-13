"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const compute_1 = require("./compute");
(0, node_test_1.default)("buildStudioState maps read models into v3 snapshot", () => {
    const snapshot = (0, compute_1.buildStudioState)({
        firestore: {
            readAt: "2026-02-12T00:00:00.000Z",
            counts: {
                batchesActive: 3,
                batchesClosed: 7,
                reservationsOpen: 2,
                firingsScheduled: 4,
                reportsOpen: 1,
                blockedTickets: 2,
                agentRequestsPending: 5,
                highSeverityReports: 1,
                pendingOrders: 6,
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
            unsettledPayments: 9,
        },
    });
    strict_1.default.equal(snapshot.schemaVersion, "v3.0");
    strict_1.default.equal(snapshot.counts.batchesActive, 3);
    strict_1.default.equal(snapshot.ops.blockedTickets, 2);
    strict_1.default.equal(snapshot.finance.unsettledPayments, 9);
    strict_1.default.ok(snapshot.sourceHashes.firestore.length > 0);
});
(0, node_test_1.default)("computeDiff returns null when no tracked field changed", () => {
    const base = (0, compute_1.buildStudioState)({
        firestore: {
            readAt: "2026-02-12T00:00:00.000Z",
            counts: {
                batchesActive: 1,
                batchesClosed: 1,
                reservationsOpen: 1,
                firingsScheduled: 1,
                reportsOpen: 1,
                blockedTickets: 1,
                agentRequestsPending: 1,
                highSeverityReports: 1,
                pendingOrders: 1,
            },
            sourceSample: {
                batchesScanned: 1,
                reservationsScanned: 1,
                firingsScanned: 1,
                reportsScanned: 1,
            },
        },
        stripe: {
            readAt: "2026-02-12T00:00:00.000Z",
            unsettledPayments: 1,
        },
    });
    const current = { ...base, generatedAt: "2026-02-12T01:00:00.000Z" };
    const diff = (0, compute_1.computeDiff)(base, current);
    strict_1.default.equal(diff, null);
});
(0, node_test_1.default)("computeDiff returns changed keys", () => {
    const previous = (0, compute_1.buildStudioState)({
        firestore: {
            readAt: "2026-02-12T00:00:00.000Z",
            counts: {
                batchesActive: 1,
                batchesClosed: 1,
                reservationsOpen: 1,
                firingsScheduled: 1,
                reportsOpen: 1,
                blockedTickets: 1,
                agentRequestsPending: 1,
                highSeverityReports: 1,
                pendingOrders: 1,
            },
            sourceSample: {
                batchesScanned: 1,
                reservationsScanned: 1,
                firingsScanned: 1,
                reportsScanned: 1,
            },
        },
        stripe: {
            readAt: "2026-02-12T00:00:00.000Z",
            unsettledPayments: 1,
        },
    });
    const current = {
        ...previous,
        counts: { ...previous.counts, batchesActive: 4 },
        ops: { ...previous.ops, blockedTickets: 3 },
        finance: { ...previous.finance, unsettledPayments: 2 },
        generatedAt: "2026-02-12T02:00:00.000Z",
    };
    const diff = (0, compute_1.computeDiff)(previous, current);
    strict_1.default.ok(diff);
    strict_1.default.equal(diff?.changes["counts.batchesActive"]?.to, 4);
    strict_1.default.equal(diff?.changes["ops.blockedTickets"]?.to, 3);
    strict_1.default.equal(diff?.changes["finance.unsettledPayments"]?.to, 2);
});
