import test from "node:test";
import assert from "node:assert/strict";
import { MemoryEventStore, MemoryStateStore } from "../stores/memoryStores";
import type { StudioStateSnapshot } from "../stores/interfaces";
import { runStudioStateRebuild } from "./rebuild";

const sampleSnapshot: StudioStateSnapshot = {
  schemaVersion: "v3.0" as const,
  snapshotDate: "2026-02-13",
  generatedAt: "2026-02-13T00:00:00.000Z",
  cloudSync: {
    firestoreReadAt: "2026-02-13T00:00:00.000Z",
    stripeReadAt: "2026-02-13T00:00:00.000Z",
  },
  counts: {
    batchesActive: 3,
    batchesClosed: 10,
    reservationsOpen: 2,
    firingsScheduled: 1,
    reportsOpen: 0,
  },
  ops: {
    agentRequestsPending: 1,
    highSeverityReports: 0,
  },
  finance: {
    pendingOrders: 2,
    unsettledPayments: 1,
  },
  sourceHashes: {
    firestore: "hash-firestore",
    stripe: "hash-stripe",
  },
  diagnostics: {
    completeness: "full" as const,
    warnings: [],
    sourceSample: {
      batchesScanned: 0,
      reservationsScanned: 0,
      firingsScanned: 0,
      reportsScanned: 0,
    },
    durationsMs: {
      firestoreRead: 12,
      stripeRead: 8,
    },
  },
};

test("runStudioStateRebuild hydrates snapshot from empty state store", async () => {
  const stateStore = new MemoryStateStore();
  const eventStore = new MemoryEventStore();

  const result = await runStudioStateRebuild({
    stateStore,
    eventStore,
    actorId: "staff-001",
    compute: async () => sampleSnapshot,
    correlationId: "corr-1",
  });

  const latest = await stateStore.getLatestStudioState();
  assert.ok(latest);
  assert.equal(latest.snapshotDate, "2026-02-13");
  assert.equal(result.snapshotDate, "2026-02-13");
  assert.equal(result.previousSnapshotDate, null);

  const events = await eventStore.listRecent(10);
  assert.ok(events.some((row) => row.action === "studio_ops.rebuild_started"));
  assert.ok(events.some((row) => row.action === "studio_ops.rebuild_completed"));
});

test("runStudioStateRebuild records failure events on error", async () => {
  const stateStore = new MemoryStateStore();
  const eventStore = new MemoryEventStore();

  await assert.rejects(
    runStudioStateRebuild({
      stateStore,
      eventStore,
      actorId: "staff-002",
      compute: async () => {
        throw new Error("boom");
      },
      correlationId: "corr-2",
    })
  );

  const events = await eventStore.listRecent(10);
  assert.ok(events.some((row) => row.action === "studio_ops.rebuild_failed"));
});
