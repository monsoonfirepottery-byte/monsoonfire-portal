import crypto from "node:crypto";
import type { EventStore, StateStore, StudioStateSnapshot } from "../stores/interfaces";
import { computeDiff, computeStudioState } from "../studioState/compute";
import { stableHashDeep } from "../stores/hash";

export type RebuildOptions = {
  stateStore: StateStore;
  eventStore?: EventStore;
  actorId: string;
  actorType?: "staff" | "system";
  projectId?: string;
  scanLimit?: number;
  correlationId?: string;
  compute?: (projectId?: string, scanLimit?: number) => Promise<StudioStateSnapshot>;
};

export type RebuildResult = {
  correlationId: string;
  snapshotDate: string;
  generatedAt: string;
  previousSnapshotDate: string | null;
  diffRecorded: boolean;
};

export async function runStudioStateRebuild(options: RebuildOptions): Promise<RebuildResult> {
  const {
    stateStore,
    eventStore,
    actorId,
    actorType = "staff",
    projectId,
    scanLimit,
    correlationId = crypto.randomUUID(),
    compute = computeStudioState,
  } = options;

  const safeActorId = actorId.trim() || "staff:unknown";
  const startAt = new Date().toISOString();
  await eventStore?.append({
    actorType,
    actorId: safeActorId,
    action: "studio_ops.rebuild_started",
    rationale: "Rebuild local StudioState snapshot from cloud sources.",
    target: "local",
    approvalState: "approved",
    inputHash: correlationId,
    outputHash: null,
    metadata: {
      correlationId,
      startedAt: startAt,
      projectId: projectId ?? null,
      scanLimit: typeof scanLimit === "number" ? scanLimit : null,
    },
  });

  try {
    const previous = await stateStore.getLatestStudioState();
    const snapshot = await compute(projectId, scanLimit);
    await stateStore.saveStudioState(snapshot);
    const diff = previous ? computeDiff(previous, snapshot) : null;
    if (diff) {
      await stateStore.saveStudioStateDiff(diff);
    }

    await eventStore?.append({
      actorType,
      actorId: safeActorId,
      action: "studio_ops.rebuild_completed",
      rationale: "Rebuild completed and snapshot saved.",
      target: "local",
      approvalState: "approved",
      inputHash: correlationId,
      outputHash: stableHashDeep({
        snapshotDate: snapshot.snapshotDate,
        sourceHashes: snapshot.sourceHashes,
      }),
      metadata: {
        correlationId,
        startedAt: startAt,
        completedAt: new Date().toISOString(),
        snapshotDate: snapshot.snapshotDate,
        generatedAt: snapshot.generatedAt,
        previousSnapshotDate: previous?.snapshotDate ?? null,
        cloudSync: snapshot.cloudSync,
        counts: snapshot.counts,
        ops: snapshot.ops,
        finance: snapshot.finance,
        diffRecorded: Boolean(diff),
      },
    });

    return {
      correlationId,
      snapshotDate: snapshot.snapshotDate,
      generatedAt: snapshot.generatedAt,
      previousSnapshotDate: previous?.snapshotDate ?? null,
      diffRecorded: Boolean(diff),
    };
  } catch (error) {
    await eventStore?.append({
      actorType,
      actorId: safeActorId,
      action: "studio_ops.rebuild_failed",
      rationale: "Rebuild failed before snapshot could be saved.",
      target: "local",
      approvalState: "approved",
      inputHash: correlationId,
      outputHash: null,
      metadata: {
        correlationId,
        startedAt: startAt,
        failedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
