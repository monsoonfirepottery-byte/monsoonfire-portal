import test from "node:test";
import assert from "node:assert/strict";
import { MemoryEventStore, MemoryStateStore } from "../stores/memoryStores";
import { renderDashboard } from "./dashboard";
import { buildStudioState } from "../studioState/compute";

test("renderDashboard marks stale snapshots", async () => {
  const stateStore = new MemoryStateStore();
  const eventStore = new MemoryEventStore();
  const snapshot = buildStudioState({
    firestore: {
      readAt: "2026-02-12T00:00:00.000Z",
      counts: {
        batchesActive: 1,
        batchesClosed: 2,
        reservationsOpen: 3,
        firingsScheduled: 4,
        reportsOpen: 5,
        agentRequestsPending: 0,
        highSeverityReports: 0,
        pendingOrders: 0,
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
      unsettledPayments: 0,
    },
  });
  snapshot.generatedAt = "2000-01-01T00:00:00.000Z";
  await stateStore.saveStudioState(snapshot);

  const html = await renderDashboard(stateStore, eventStore, { staleThresholdMinutes: 10 });
  assert.ok(html.includes("Snapshot freshness"));
  assert.ok(html.includes("STALE"));
  assert.ok(html.includes("Derived from cloud"));
});
