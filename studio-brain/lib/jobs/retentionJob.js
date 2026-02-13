"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeRetentionCutoff = computeRetentionCutoff;
exports.createRetentionJob = createRetentionJob;
const maintenance_1 = require("../db/maintenance");
function computeRetentionCutoff(now, retentionDays) {
    const cutoffMs = now.getTime() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
    return new Date(cutoffMs).toISOString();
}
function createRetentionJob(retentionDays) {
    return async (ctx) => {
        const cutoffIso = computeRetentionCutoff(new Date(), retentionDays);
        const result = await (0, maintenance_1.pruneOldRows)(retentionDays);
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
