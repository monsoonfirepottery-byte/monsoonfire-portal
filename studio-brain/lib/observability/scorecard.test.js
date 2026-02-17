"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const scorecard_1 = require("./scorecard");
(0, node_test_1.default)("computeScorecard marks critical when snapshot is stale", () => {
    const now = new Date("2026-02-13T12:00:00.000Z");
    const scorecard = (0, scorecard_1.computeScorecard)({
        now,
        snapshotGeneratedAt: "2026-02-13T08:00:00.000Z",
        proposals: [],
        auditRows: [],
        connectors: [],
        lastBreachAt: null,
    });
    const freshness = scorecard.metrics.find((row) => row.key === "snapshot_freshness");
    strict_1.default.ok(freshness);
    strict_1.default.equal(freshness.status, "critical");
    strict_1.default.equal(scorecard.overallStatus, "critical");
});
(0, node_test_1.default)("computeScorecard marks connector health warning on partial outage", () => {
    const now = new Date("2026-02-13T12:00:00.000Z");
    const scorecard = (0, scorecard_1.computeScorecard)({
        now,
        snapshotGeneratedAt: "2026-02-13T11:55:00.000Z",
        proposals: [],
        auditRows: [],
        connectors: [
            { id: "hubitat-1", ok: true, latencyMs: 15 },
            { id: "hubitat-2", ok: true, latencyMs: 15 },
            { id: "hubitat-3", ok: true, latencyMs: 15 },
            { id: "hubitat-4", ok: true, latencyMs: 15 },
            { id: "hubitat-5", ok: true, latencyMs: 15 },
            { id: "hubitat-6", ok: true, latencyMs: 15 },
            { id: "hubitat-7", ok: true, latencyMs: 15 },
            { id: "hubitat-8", ok: true, latencyMs: 15 },
            { id: "hubitat-9", ok: true, latencyMs: 15 },
            { id: "roborock-1", ok: false, latencyMs: 25 },
        ],
        lastBreachAt: "2026-02-13T11:00:00.000Z",
    });
    const connector = scorecard.metrics.find((row) => row.key === "connector_health");
    strict_1.default.ok(connector);
    strict_1.default.equal(connector.status, "warning");
    strict_1.default.equal(scorecard.lastBreachAt, "2026-02-13T11:00:00.000Z");
});
(0, node_test_1.default)("computeScorecard marks tenant context completeness warning when proposal audit rows miss tenantId", () => {
    const now = new Date("2026-02-13T12:00:00.000Z");
    const scorecard = (0, scorecard_1.computeScorecard)({
        now,
        snapshotGeneratedAt: "2026-02-13T11:55:00.000Z",
        proposals: [
            {
                id: "p-1",
                createdAt: "2026-02-13T11:00:00.000Z",
                requestedBy: "staff-1",
                tenantId: "studio-a",
                capabilityId: "firestore.batch.close",
                rationale: "test",
                inputHash: "h1",
                preview: { summary: "s", input: {}, expectedEffects: [] },
                status: "approved",
                approvedBy: "staff-2",
                approvedAt: "2026-02-13T11:02:00.000Z",
            },
        ],
        auditRows: [
            {
                id: "a-1",
                at: "2026-02-13T11:03:00.000Z",
                actorType: "staff",
                actorId: "staff-2",
                action: "capability.firestore.batch.close.proposal_approved",
                rationale: "approved",
                target: "local",
                approvalState: "approved",
                inputHash: "h1",
                outputHash: null,
                metadata: { proposalId: "p-1" },
            },
        ],
        connectors: [{ id: "hubitat-1", ok: true, latencyMs: 15 }],
        lastBreachAt: null,
    });
    const metric = scorecard.metrics.find((row) => row.key === "tenant_context_completeness");
    strict_1.default.ok(metric);
    strict_1.default.equal(metric.status, "critical");
});
