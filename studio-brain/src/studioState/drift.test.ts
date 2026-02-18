import test from "node:test";
import assert from "node:assert/strict";
import { buildStudioState } from "./compute";
import { detectSnapshotDrift } from "./drift";

test("detectSnapshotDrift returns empty when prior snapshot missing", () => {
  const current = buildStudioState({
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

  assert.deepEqual(detectSnapshotDrift(null, current, { absolute: 10, ratio: 0.5 }), []);
});

test("detectSnapshotDrift flags over-threshold metric deltas", () => {
  const previous = buildStudioState({
    firestore: {
      readAt: "2026-02-12T00:00:00.000Z",
      counts: {
        batchesActive: 2,
        batchesClosed: 2,
        reservationsOpen: 2,
        firingsScheduled: 2,
        reportsOpen: 2,
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

  const rows = detectSnapshotDrift(previous, current, { absolute: 10, ratio: 0.5 });
  assert.ok(rows.some((row) => row.metric === "counts.batchesActive"));
});
