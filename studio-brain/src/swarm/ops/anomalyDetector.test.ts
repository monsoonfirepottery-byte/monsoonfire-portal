import assert from "node:assert/strict";
import test from "node:test";
import { detectOpsRecommendations } from "./anomalyDetector";
import type { StudioStateSnapshot } from "../../stores/interfaces";

function snapshot(partial?: Partial<StudioStateSnapshot>): StudioStateSnapshot {
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
      blockedTickets: 1,
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

test("detectOpsRecommendations emits baseline anomalies", () => {
  const current = snapshot({
    counts: { batchesActive: 30, batchesClosed: 20, reservationsOpen: 35, firingsScheduled: 1, reportsOpen: 4 },
    ops: { blockedTickets: 1, agentRequestsPending: 22, highSeverityReports: 0 },
  });
  const prev = snapshot({
    snapshotDate: "2026-02-12",
    counts: { batchesActive: 24, batchesClosed: 18, reservationsOpen: 28, firingsScheduled: 3, reportsOpen: 3 },
    ops: { blockedTickets: 1, agentRequestsPending: 10, highSeverityReports: 0 },
  });

  const result = detectOpsRecommendations(current, prev, {
    now: new Date("2026-02-13T00:05:00.000Z"),
    recentEvents: [],
  });

  assert.equal(result.emitted.length, 3);
  assert.equal(result.ruleHits.stalled_batches, 1);
  assert.equal(result.ruleHits.queue_spike, 1);
  assert.equal(result.ruleHits.overdue_reservations, 1);
});

test("detectOpsRecommendations throttles recently emitted rules", () => {
  const current = snapshot({
    counts: { batchesActive: 30, batchesClosed: 20, reservationsOpen: 10, firingsScheduled: 1, reportsOpen: 4 },
  });

  const result = detectOpsRecommendations(current, null, {
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

  assert.equal(result.emitted.length, 0);
  assert.equal(result.suppressedCount, 1);
});

test("detectOpsRecommendations suppresses false positives when queue stable", () => {
  const current = snapshot({
    ops: { blockedTickets: 1, agentRequestsPending: 9, highSeverityReports: 0 },
  });
  const prev = snapshot({
    snapshotDate: "2026-02-12",
    ops: { blockedTickets: 1, agentRequestsPending: 8, highSeverityReports: 0 },
  });

  const result = detectOpsRecommendations(current, prev, {
    now: new Date("2026-02-13T00:05:00.000Z"),
    recentEvents: [],
  });

  assert.equal(result.emitted.length, 0);
  assert.equal(result.ruleHits.queue_spike, 0);
});
