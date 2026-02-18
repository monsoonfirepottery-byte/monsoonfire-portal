import test from "node:test";
import assert from "node:assert/strict";
import { buildStudioState, computeDiff } from "./compute";

test("buildStudioState maps read models into v3 snapshot", () => {
  const snapshot = buildStudioState({
    firestore: {
      readAt: "2026-02-12T00:00:00.000Z",
      counts: {
        batchesActive: 3,
        batchesClosed: 7,
        reservationsOpen: 2,
        firingsScheduled: 4,
        reportsOpen: 1,
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

    assert.equal(snapshot.schemaVersion, "v3.0");
    assert.equal(snapshot.counts.batchesActive, 3);
    assert.equal(snapshot.finance.unsettledPayments, 9);
    assert.ok(snapshot.sourceHashes.firestore.length > 0);
});

test("computeDiff returns null when no tracked field changed", () => {
  const base = buildStudioState({
    firestore: {
      readAt: "2026-02-12T00:00:00.000Z",
      counts: {
        batchesActive: 1,
        batchesClosed: 1,
        reservationsOpen: 1,
        firingsScheduled: 1,
        reportsOpen: 1,
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
  const diff = computeDiff(base, current);
  assert.equal(diff, null);
});

test("computeDiff returns changed keys", () => {
  const previous = buildStudioState({
    firestore: {
      readAt: "2026-02-12T00:00:00.000Z",
      counts: {
        batchesActive: 1,
        batchesClosed: 1,
        reservationsOpen: 1,
        firingsScheduled: 1,
        reportsOpen: 1,
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
    ops: { ...previous.ops, agentRequestsPending: 1 },
    finance: { ...previous.finance, unsettledPayments: 2 },
    generatedAt: "2026-02-12T02:00:00.000Z",
  };

  const diff = computeDiff(previous, current);
  assert.ok(diff);
  assert.equal(diff?.changes["counts.batchesActive"]?.to, 4);
  assert.equal(diff?.changes["finance.unsettledPayments"]?.to, 2);
});
