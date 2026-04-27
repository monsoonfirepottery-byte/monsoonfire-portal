"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildKilnOverview = buildKilnOverview;
exports.buildKilnDetail = buildKilnDetail;
exports.buildFiringRunDetail = buildFiringRunDetail;
const fingerprint_1 = require("../domain/fingerprint");
const analytics_1 = require("./analytics");
function latestTelemetryPoint(points) {
    return points.length ? points[points.length - 1] : null;
}
function connectivityState(lastSeenAt) {
    if (!lastSeenAt)
        return "unknown";
    const ageMs = Date.now() - Date.parse(lastSeenAt);
    if (!Number.isFinite(ageMs))
        return "unknown";
    if (ageMs <= 15 * 60_000)
        return "online";
    return "stale";
}
function timeRunningSec(run) {
    if (!run?.startTime)
        return null;
    const startedAt = Date.parse(run.startTime);
    if (!Number.isFinite(startedAt))
        return null;
    const endedAt = run.endTime ? Date.parse(run.endTime) : Date.now();
    if (!Number.isFinite(endedAt) || endedAt < startedAt)
        return null;
    return Math.round((endedAt - startedAt) / 1000);
}
function buildRequiredAction(run) {
    return {
        id: `required_${run.id}`,
        kilnId: run.kilnId,
        firingRunId: run.id,
        actionType: run.queueState === "ready_for_start" ? "pressed_start" : "manual_note",
        requestedBy: "studio-brain",
        confirmedBy: null,
        requestedAt: new Date().toISOString(),
        completedAt: null,
        checklistJson: {},
        notes: run.queueState === "ready_for_start"
            ? "Operator must confirm local load and press Start on the controller."
            : "Operator follow-up required.",
    };
}
function deriveRequiredActions(currentRun, persistedActions) {
    const required = [...persistedActions];
    if (currentRun && (currentRun.queueState === "ready_for_start" || currentRun.queueState === "ready_for_unload")) {
        required.push(buildRequiredAction(currentRun));
    }
    return required;
}
async function buildKilnOverview(store, input) {
    const kilns = await store.listKilns();
    const cards = [];
    const requiredOperatorActions = [];
    const maintenanceFlags = [];
    for (const kiln of kilns) {
        const [capabilityDocument, currentRun, healthSnapshot, pendingActions] = await Promise.all([
            store.getLatestCapabilityDocument(kiln.id),
            store.findCurrentRunForKiln(kiln.id),
            store.getLatestHealthSnapshot(kiln.id),
            store.listOperatorActions({ kilnId: kiln.id, incompleteOnly: true, limit: 20 }),
        ]);
        const recentRuns = await store.listFiringRuns({ kilnId: kiln.id, limit: 5 });
        const nextQueuedRun = recentRuns.find((entry) => entry.id !== currentRun?.id && (entry.status === "queued" || entry.status === "armed")) ?? null;
        const telemetry = currentRun ? await store.listTelemetryPoints(currentRun.id, 200) : [];
        const latestPoint = latestTelemetryPoint(telemetry);
        const spread = latestPoint && [latestPoint.tempZone1, latestPoint.tempZone2, latestPoint.tempZone3].filter((value) => typeof value === "number").length >= 2
            ? Math.max(...[latestPoint.tempZone1, latestPoint.tempZone2, latestPoint.tempZone3].filter((value) => typeof value === "number"))
                - Math.min(...[latestPoint.tempZone1, latestPoint.tempZone2, latestPoint.tempZone3].filter((value) => typeof value === "number"))
            : null;
        cards.push({
            kilnId: kiln.id,
            kilnName: kiln.displayName,
            connectivityState: connectivityState(kiln.lastSeenAt),
            currentTemp: latestPoint?.tempPrimary ?? null,
            setPoint: latestPoint?.setPoint ?? currentRun?.finalSetPoint ?? null,
            segment: latestPoint?.segment ?? currentRun?.currentSegment ?? null,
            inferredPhase: currentRun ? (0, analytics_1.inferRunPhase)(currentRun) : "Idle",
            zoneSpread: spread,
            currentProgram: currentRun?.programName ?? null,
            timeRunningSec: timeRunningSec(currentRun),
            lastImportTime: kiln.lastSeenAt,
            lastHumanAcknowledgement: currentRun?.operatorConfirmationAt ?? null,
            controlPosture: (0, fingerprint_1.deriveKilnControlPosture)({
                capabilityDocument,
                operatorConfirmationAt: currentRun?.operatorConfirmationAt ?? null,
                enableSupportedWrites: input.enableSupportedWrites,
            }),
            currentRunId: currentRun?.id ?? null,
            nextQueuedRunId: nextQueuedRun?.id ?? null,
            healthWarnings: healthSnapshot?.warnings ?? [],
            maintenanceFlags: healthSnapshot?.confidenceNotes ?? [],
        });
        if (healthSnapshot?.warnings.length || healthSnapshot?.confidenceNotes.length) {
            maintenanceFlags.push({
                kilnId: kiln.id,
                warnings: healthSnapshot?.warnings ?? [],
                confidenceNotes: healthSnapshot?.confidenceNotes ?? [],
            });
        }
        requiredOperatorActions.push(...pendingActions);
        if (currentRun && (currentRun.queueState === "ready_for_start" || currentRun.queueState === "ready_for_unload")) {
            requiredOperatorActions.push(buildRequiredAction(currentRun));
        }
    }
    const recentFirings = await store.listFiringRuns({ limit: 12 });
    return {
        generatedAt: new Date().toISOString(),
        fleet: {
            kilnCount: cards.length,
            activeRuns: cards.filter((entry) => entry.currentRunId).length,
            attentionCount: requiredOperatorActions.length + maintenanceFlags.reduce((sum, entry) => sum + entry.warnings.length, 0),
        },
        kilns: cards,
        requiredOperatorActions: requiredOperatorActions.slice(0, 20),
        recentFirings,
        maintenanceFlags,
    };
}
async function buildKilnDetail(store, kilnId) {
    const kiln = await store.getKiln(kilnId);
    const [capabilityDocument, currentRun, recentRuns, recentArtifacts, recentOperatorActions, persistedRequiredActions, healthSnapshot] = await Promise.all([
        store.getLatestCapabilityDocument(kilnId),
        store.findCurrentRunForKiln(kilnId),
        store.listFiringRuns({ kilnId, limit: 10 }),
        store.listArtifactsForKiln(kilnId, 10),
        store.listOperatorActions({ kilnId, limit: 20 }),
        store.listOperatorActions({ kilnId, incompleteOnly: true, limit: 20 }),
        store.getLatestHealthSnapshot(kilnId),
    ]);
    const [currentRunEvents, currentRunTelemetry] = currentRun
        ? await Promise.all([
            store.listFiringEvents(currentRun.id, 12),
            store.listTelemetryPoints(currentRun.id, 12),
        ])
        : [[], []];
    return {
        kiln,
        capabilityDocument,
        currentRun,
        recentRuns,
        recentArtifacts,
        requiredActions: deriveRequiredActions(currentRun, persistedRequiredActions),
        recentOperatorActions,
        healthSnapshot,
        currentRunEvents,
        currentRunTelemetry,
    };
}
async function buildFiringRunDetail(store, runId) {
    const run = await store.getFiringRun(runId);
    if (!run) {
        return { run: null, events: [], telemetry: [] };
    }
    const [events, telemetry] = await Promise.all([
        store.listFiringEvents(runId, 200),
        store.listTelemetryPoints(runId, 500),
    ]);
    return { run, events, telemetry };
}
