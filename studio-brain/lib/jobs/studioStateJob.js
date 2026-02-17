"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeStudioStateJob = void 0;
const compute_1 = require("../studioState/compute");
const env_1 = require("../config/env");
const hash_1 = require("../stores/hash");
const drift_1 = require("../studioState/drift");
const anomalyDetector_1 = require("../swarm/ops/anomalyDetector");
const draftPipeline_1 = require("../swarm/marketing/draftPipeline");
const reconciliation_1 = require("../swarm/finance/reconciliation");
const computeStudioStateJob = async (ctx) => {
    const env = (0, env_1.readEnv)();
    const current = await (0, compute_1.computeStudioState)(process.env.FIREBASE_PROJECT_ID, env.STUDIO_BRAIN_SCAN_LIMIT);
    const latest = await ctx.stateStore.getLatestStudioState();
    const previous = await ctx.stateStore.getPreviousStudioState(current.snapshotDate);
    const diff = (0, compute_1.computeDiff)(previous, current);
    const drift = (0, drift_1.detectSnapshotDrift)(latest, current, {
        absolute: env.STUDIO_BRAIN_DRIFT_ABSOLUTE_THRESHOLD,
        ratio: env.STUDIO_BRAIN_DRIFT_RATIO_THRESHOLD,
    });
    if (drift.length > 0) {
        const warnings = [...(current.diagnostics?.warnings ?? [])];
        for (const row of drift.slice(0, 10)) {
            warnings.push(`drift:${row.metric}: expected=${row.expected} observed=${row.observed} delta=${row.delta} ratio=${row.deltaRatio.toFixed(3)}`);
        }
        current.diagnostics = {
            ...(current.diagnostics ?? { completeness: "full", warnings: [] }),
            warnings,
            completeness: "partial",
        };
    }
    const recentEvents = await ctx.eventStore.listRecent(250);
    const recommendations = (0, anomalyDetector_1.detectOpsRecommendations)(current, previous, {
        now: new Date(),
        recentEvents,
    });
    for (const draft of recommendations.emitted) {
        await ctx.eventStore.append({
            actorType: "system",
            actorId: "studio-brain",
            action: "studio_ops.recommendation_draft_created",
            rationale: draft.rationale,
            target: "local",
            approvalState: "exempt",
            inputHash: (0, hash_1.stableHashDeep)({
                ruleId: draft.ruleId,
                snapshotDate: draft.snapshotDate,
            }),
            outputHash: (0, hash_1.stableHashDeep)(draft),
            metadata: draft,
        });
    }
    await ctx.eventStore.append({
        actorType: "system",
        actorId: "studio-brain",
        action: "studio_ops.detector_ran",
        rationale: "Ops anomaly detector evaluated snapshot and emitted draft recommendations.",
        target: "local",
        approvalState: "exempt",
        inputHash: (0, hash_1.stableHashDeep)({
            snapshotDate: current.snapshotDate,
            previousSnapshotDate: previous?.snapshotDate ?? null,
        }),
        outputHash: (0, hash_1.stableHashDeep)(recommendations),
        metadata: {
            emittedCount: recommendations.emitted.length,
            suppressedCount: recommendations.suppressedCount,
            ruleHits: recommendations.ruleHits,
        },
    });
    const financeReconciliation = (0, reconciliation_1.detectFinanceReconciliation)(current, previous, {
        now: new Date(),
        recentEvents,
    });
    for (const draft of financeReconciliation.emitted) {
        await ctx.eventStore.append({
            actorType: "system",
            actorId: "studio-brain",
            action: "studio_finance.reconciliation_draft_created",
            rationale: draft.rationale,
            target: "local",
            approvalState: "exempt",
            inputHash: (0, hash_1.stableHashDeep)({
                ruleId: draft.ruleId,
                snapshotDate: draft.snapshotDate,
            }),
            outputHash: (0, hash_1.stableHashDeep)(draft),
            metadata: draft,
        });
    }
    await ctx.eventStore.append({
        actorType: "system",
        actorId: "studio-brain",
        action: "studio_finance.reconciliation_ran",
        rationale: "Finance reconciliation evaluated snapshot and emitted draft flags.",
        target: "local",
        approvalState: "exempt",
        inputHash: (0, hash_1.stableHashDeep)({
            snapshotDate: current.snapshotDate,
            previousSnapshotDate: previous?.snapshotDate ?? null,
        }),
        outputHash: (0, hash_1.stableHashDeep)(financeReconciliation),
        metadata: {
            emittedCount: financeReconciliation.emitted.length,
            suppressedCount: financeReconciliation.suppressedCount,
            ruleHits: financeReconciliation.ruleHits,
        },
    });
    if (!(0, draftPipeline_1.hasRecentMarketingDraft)(recentEvents, current.snapshotDate, 360, new Date())) {
        const drafts = (0, draftPipeline_1.buildMarketingDrafts)(current);
        for (const draft of drafts) {
            await ctx.eventStore.append({
                actorType: "system",
                actorId: "studio-brain",
                action: "studio_marketing.draft_created",
                rationale: `Generated ${draft.channel} draft from StudioState snapshot.`,
                target: "local",
                approvalState: "exempt",
                inputHash: (0, hash_1.stableHashDeep)({
                    snapshotDate: current.snapshotDate,
                    templateVersion: draft.templateVersion,
                }),
                outputHash: (0, hash_1.stableHashDeep)(draft),
                metadata: draft,
            });
        }
    }
    await ctx.stateStore.saveStudioState(current);
    if (diff) {
        await ctx.stateStore.saveStudioStateDiff(diff);
    }
    if (drift.length > 0) {
        await ctx.eventStore.append({
            actorType: "system",
            actorId: "studio-brain",
            action: "studio_state.drift_detected",
            rationale: "Drift threshold exceeded between latest persisted snapshot and fresh cloud-derived snapshot.",
            target: "local",
            approvalState: "exempt",
            inputHash: (0, hash_1.stableHashDeep)({
                previousSnapshotDate: latest?.snapshotDate ?? null,
                currentSnapshotDate: current.snapshotDate,
            }),
            outputHash: (0, hash_1.stableHashDeep)(drift),
            metadata: {
                threshold: {
                    absolute: env.STUDIO_BRAIN_DRIFT_ABSOLUTE_THRESHOLD,
                    ratio: env.STUDIO_BRAIN_DRIFT_RATIO_THRESHOLD,
                },
                driftCount: drift.length,
                rows: drift,
            },
        });
    }
    await ctx.eventStore.append({
        actorType: "system",
        actorId: "studio-brain",
        action: "studio_state.computed",
        rationale: "Compute local StudioState from cloud-authoritative reads.",
        target: "local",
        approvalState: "exempt",
        inputHash: current.sourceHashes.firestore,
        outputHash: (0, hash_1.stableHashDeep)(current),
        metadata: {
            snapshotDate: current.snapshotDate,
            hasDiff: Boolean(diff),
            driftCount: drift.length,
            generatedAt: current.generatedAt,
            completeness: current.diagnostics?.completeness ?? "full",
            warningCount: current.diagnostics?.warnings.length ?? 0,
            durationMs: current.diagnostics?.durationsMs ?? null,
        },
    });
    return {
        summary: `snapshot=${current.snapshotDate} diff=${diff ? "yes" : "no"} recs=${recommendations.emitted.length} finance=${financeReconciliation.emitted.length}`,
    };
};
exports.computeStudioStateJob = computeStudioStateJob;
