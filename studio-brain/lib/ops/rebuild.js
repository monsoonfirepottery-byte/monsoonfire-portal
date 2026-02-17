"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runStudioStateRebuild = runStudioStateRebuild;
const node_crypto_1 = __importDefault(require("node:crypto"));
const compute_1 = require("../studioState/compute");
const hash_1 = require("../stores/hash");
async function runStudioStateRebuild(options) {
    const { stateStore, eventStore, actorId, actorType = "staff", projectId, scanLimit, correlationId = node_crypto_1.default.randomUUID(), compute = compute_1.computeStudioState, } = options;
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
        const diff = previous ? (0, compute_1.computeDiff)(previous, snapshot) : null;
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
            outputHash: (0, hash_1.stableHashDeep)({
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
    }
    catch (error) {
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
