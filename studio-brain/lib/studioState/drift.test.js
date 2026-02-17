"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const compute_1 = require("./compute");
const drift_1 = require("./drift");
(0, node_test_1.default)("detectSnapshotDrift returns empty when prior snapshot missing", () => {
    const current = (0, compute_1.buildStudioState)({
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
    strict_1.default.deepEqual((0, drift_1.detectSnapshotDrift)(null, current, { absolute: 10, ratio: 0.5 }), []);
});
(0, node_test_1.default)("detectSnapshotDrift flags over-threshold metric deltas", () => {
    const previous = (0, compute_1.buildStudioState)({
        firestore: {
            readAt: "2026-02-12T00:00:00.000Z",
            counts: {
                batchesActive: 2,
                batchesClosed: 2,
                reservationsOpen: 2,
                firingsScheduled: 2,
                reportsOpen: 2,
                blockedTickets: 2,
                agentRequestsPending: 2,
                highSeverityReports: 2,
                pendingOrders: 2,
            },
            sourceSample: {
                batchesScanned: 2,
                reservationsScanned: 2,
                firingsScanned: 2,
                reportsScanned: 2,
            },
        },
        stripe: {
            readAt: "2026-02-12T00:00:00.000Z",
            unsettledPayments: 2,
        },
    });
    const current = {
        ...previous,
        counts: { ...previous.counts, batchesActive: 30 },
    };
    const rows = (0, drift_1.detectSnapshotDrift)(previous, current, { absolute: 10, ratio: 0.5 });
    strict_1.default.ok(rows.some((row) => row.metric === "counts.batchesActive"));
});
