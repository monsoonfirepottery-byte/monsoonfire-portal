import { readFirestoreModel } from "../cloud/firestoreReader";
import { readStripeModel } from "../cloud/stripeReader";
import type { StudioStateDiff, StudioStateSnapshot } from "../stores/interfaces";
import { stableHashDeep } from "../stores/hash";

export type ComputeInputs = {
  firestore: Awaited<ReturnType<typeof readFirestoreModel>>;
  stripe: Awaited<ReturnType<typeof readStripeModel>>;
};

export async function computeStudioState(projectId?: string, scanLimit?: number): Promise<StudioStateSnapshot> {
  const [firestore, stripe] = await Promise.all([readFirestoreModel(projectId, scanLimit), readStripeModel()]);
  return buildStudioState({ firestore, stripe });
}

export function buildStudioState(inputs: ComputeInputs): StudioStateSnapshot {
  const now = new Date();
  const snapshotDate = now.toISOString().slice(0, 10);
  const firestoreHash = stableHashDeep(inputs.firestore);
  const stripeHash = stableHashDeep(inputs.stripe);

  return {
    schemaVersion: "v3.0",
    snapshotDate,
    generatedAt: now.toISOString(),
    cloudSync: {
      firestoreReadAt: inputs.firestore.readAt,
      stripeReadAt: inputs.stripe.readAt,
    },
    counts: {
      batchesActive: inputs.firestore.counts.batchesActive,
      batchesClosed: inputs.firestore.counts.batchesClosed,
      reservationsOpen: inputs.firestore.counts.reservationsOpen,
      firingsScheduled: inputs.firestore.counts.firingsScheduled,
      reportsOpen: inputs.firestore.counts.reportsOpen,
    },
    ops: {
      agentRequestsPending: inputs.firestore.counts.agentRequestsPending,
      highSeverityReports: inputs.firestore.counts.highSeverityReports,
    },
    finance: {
      pendingOrders: inputs.firestore.counts.pendingOrders,
      unsettledPayments: inputs.stripe.unsettledPayments,
    },
    sourceHashes: {
      firestore: firestoreHash,
      stripe: stripeHash,
    },
    diagnostics: {
      completeness: inputs.firestore.completeness ?? "full",
      warnings: [...(inputs.firestore.warnings ?? []), ...(inputs.stripe.warnings ?? [])],
      sourceSample: inputs.firestore.sourceSample,
      durationsMs: {
        firestoreRead: inputs.firestore.durationMs ?? 0,
        stripeRead: inputs.stripe.durationMs ?? 0,
      },
    },
  };
}

export function computeDiff(previous: StudioStateSnapshot | null, current: StudioStateSnapshot): StudioStateDiff | null {
  if (!previous) return null;

  const changes: StudioStateDiff["changes"] = {};
  const compareEntries: Array<{ key: string; from: number; to: number }> = [
    { key: "counts.batchesActive", from: previous.counts.batchesActive, to: current.counts.batchesActive },
    { key: "counts.batchesClosed", from: previous.counts.batchesClosed, to: current.counts.batchesClosed },
    { key: "counts.reservationsOpen", from: previous.counts.reservationsOpen, to: current.counts.reservationsOpen },
    { key: "counts.firingsScheduled", from: previous.counts.firingsScheduled, to: current.counts.firingsScheduled },
    { key: "counts.reportsOpen", from: previous.counts.reportsOpen, to: current.counts.reportsOpen },
    { key: "ops.agentRequestsPending", from: previous.ops.agentRequestsPending, to: current.ops.agentRequestsPending },
    { key: "ops.highSeverityReports", from: previous.ops.highSeverityReports, to: current.ops.highSeverityReports },
    { key: "finance.pendingOrders", from: previous.finance.pendingOrders, to: current.finance.pendingOrders },
    { key: "finance.unsettledPayments", from: previous.finance.unsettledPayments, to: current.finance.unsettledPayments },
  ];

  for (const item of compareEntries) {
    if (item.from !== item.to) {
      changes[item.key] = { from: item.from, to: item.to };
    }
  }

  if (Object.keys(changes).length === 0) return null;

  return {
    fromSnapshotDate: previous.snapshotDate,
    toSnapshotDate: current.snapshotDate,
    changes,
  };
}
