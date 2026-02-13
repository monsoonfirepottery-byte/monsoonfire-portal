import test from "node:test";
import assert from "node:assert/strict";
import { computeScorecard } from "./scorecard";

test("computeScorecard marks critical when snapshot is stale", () => {
  const now = new Date("2026-02-13T12:00:00.000Z");
  const scorecard = computeScorecard({
    now,
    snapshotGeneratedAt: "2026-02-13T08:00:00.000Z",
    proposals: [],
    auditRows: [],
    connectors: [],
    lastBreachAt: null,
  });
  const freshness = scorecard.metrics.find((row) => row.key === "snapshot_freshness");
  assert.ok(freshness);
  assert.equal(freshness.status, "critical");
  assert.equal(scorecard.overallStatus, "critical");
});

test("computeScorecard marks connector health warning on partial outage", () => {
  const now = new Date("2026-02-13T12:00:00.000Z");
  const scorecard = computeScorecard({
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
  assert.ok(connector);
  assert.equal(connector.status, "warning");
  assert.equal(scorecard.lastBreachAt, "2026-02-13T11:00:00.000Z");
});

test("computeScorecard marks tenant context completeness warning when proposal audit rows miss tenantId", () => {
  const now = new Date("2026-02-13T12:00:00.000Z");
  const scorecard = computeScorecard({
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
  assert.ok(metric);
  assert.equal(metric.status, "critical");
});
