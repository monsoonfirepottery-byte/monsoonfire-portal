import type { JobHandler } from "./runner";
import { pruneOldRows } from "../db/maintenance";

export function computeRetentionCutoff(now: Date, retentionDays: number): string {
  const cutoffMs = now.getTime() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
  return new Date(cutoffMs).toISOString();
}

export function createRetentionJob(retentionDays: number): JobHandler {
  return async (ctx) => {
    const cutoffIso = computeRetentionCutoff(new Date(), retentionDays);
    const result = await pruneOldRows(retentionDays);
    await ctx.eventStore.append({
      actorType: "system",
      actorId: "studio-brain",
      action: "studio_ops.retention_prune_executed",
      rationale: "Pruned local retention-managed artifacts.",
      target: "local",
      approvalState: "exempt",
      inputHash: `${retentionDays}`,
      outputHash: null,
      metadata: {
        cutoffIso,
        ...result,
        reasonCode: "RETENTION_POLICY_WINDOW_APPLIED",
      },
    });
    return {
      summary: `retentionDays=${retentionDays} cutoff=${cutoffIso} eventsPruned=${result.deletedEventRows} jobsPruned=${result.deletedJobRows} diffsPruned=${result.deletedDiffRows}`,
    };
  };
}
