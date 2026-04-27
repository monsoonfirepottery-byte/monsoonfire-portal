"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAgentRuntimeRunDetail = buildAgentRuntimeRunDetail;
const files_1 = require("./files");
function clean(value) {
    return typeof value === "string" ? value.trim() : "";
}
function clipText(value, max = 180) {
    const normalized = value.trim();
    if (!normalized)
        return "";
    return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}
function toRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function stepTitleForEvent(event) {
    const payload = toRecord(event.payload);
    const command = clean(payload.command);
    const summary = clean(payload.summary);
    if (command)
        return command;
    if (summary)
        return summary;
    return event.type.replaceAll(".", " ");
}
function stepSummaryForEvent(event) {
    const payload = toRecord(event.payload);
    const summary = clean(payload.summary);
    const reason = clean(payload.reason);
    const blocker = clean(payload.blocker);
    const next = clean(payload.next);
    const status = clean(payload.status);
    return (summary ||
        blocker ||
        next ||
        reason ||
        status ||
        clipText(JSON.stringify(payload), 200) ||
        event.type);
}
function stepKindForEvent(event) {
    if (event.type.startsWith("verification."))
        return "verification";
    if (event.type.startsWith("tool.") || clean(toRecord(event.payload).toolName))
        return "tool";
    if (event.type.startsWith("rathole.") || event.type.startsWith("goal."))
        return "diagnostic";
    if (event.type.startsWith("mission."))
        return "mission";
    return "event";
}
function stepStatusForTerminalEvent(event) {
    const payload = toRecord(event.payload);
    const eventStatus = clean(payload.status).toLowerCase();
    if (event.type.endsWith(".started"))
        return "running";
    if (event.type.endsWith(".completed")) {
        if (eventStatus === "failed" || eventStatus === "error")
            return "failed";
        if (eventStatus === "skipped")
            return "skipped";
        return "succeeded";
    }
    if (event.type === "mission.completed")
        return "succeeded";
    if (event.type === "mission.failed")
        return "failed";
    if (event.type === "rathole.detected")
        return clean(payload.blocking).toLowerCase() === "true" ? "blocked" : "info";
    if (event.type === "mission.state.changed") {
        if (eventStatus === "blocked")
            return "blocked";
        if (eventStatus === "failed")
            return "failed";
        if (eventStatus === "running")
            return "running";
        if (eventStatus === "verified" || eventStatus === "completed")
            return "succeeded";
    }
    return "info";
}
function stepCorrelationKey(event) {
    const payload = toRecord(event.payload);
    const baseType = event.type.replace(/\.(started|completed)$/u, "");
    const command = clean(payload.command);
    const signalId = clean(payload.signalId);
    const index = Number.isFinite(Number(payload.index)) ? String(payload.index) : "";
    return [baseType, command, signalId, index].filter(Boolean).join("|") || `${baseType}|${event.eventId}`;
}
function projectSteps(events) {
    const pending = new Map();
    const output = [];
    for (const event of events) {
        const key = stepCorrelationKey(event);
        if (event.type.endsWith(".started")) {
            pending.set(key, {
                stepId: key,
                runId: event.runId,
                title: stepTitleForEvent(event),
                kind: stepKindForEvent(event),
                status: "running",
                startedAt: event.occurredAt,
                finishedAt: null,
                summary: stepSummaryForEvent(event),
                evidenceRefs: [],
                rawEventIds: [event.eventId],
            });
            continue;
        }
        const prior = pending.get(key);
        const payload = toRecord(event.payload);
        const evidenceRefs = [];
        const command = clean(payload.command);
        const signalId = clean(payload.signalId);
        if (command)
            evidenceRefs.push(command);
        if (signalId)
            evidenceRefs.push(signalId);
        const step = {
            stepId: prior?.stepId || key,
            runId: event.runId,
            title: prior?.title || stepTitleForEvent(event),
            kind: prior?.kind || stepKindForEvent(event),
            status: stepStatusForTerminalEvent(event),
            startedAt: prior?.startedAt || event.occurredAt,
            finishedAt: event.type.endsWith(".started") ? null : event.occurredAt,
            summary: stepSummaryForEvent(event),
            evidenceRefs,
            rawEventIds: [...(prior?.rawEventIds ?? []), event.eventId],
        };
        output.push(step);
        pending.delete(key);
    }
    for (const step of pending.values()) {
        output.push(step);
    }
    return output
        .sort((left, right) => String(right.startedAt || right.finishedAt || "").localeCompare(String(left.startedAt || left.finishedAt || "")))
        .slice(0, 18);
}
function projectToolCalls(events) {
    return events
        .filter((event) => event.type.startsWith("tool.") || clean(toRecord(event.payload).toolName))
        .map((event) => {
        const payload = toRecord(event.payload);
        const toolName = clean(payload.toolName) || clean(payload.command) || event.type.replaceAll(".", " ");
        const eventStatus = clean(payload.status).toLowerCase();
        const status = event.type.endsWith(".started")
            ? "requested"
            : eventStatus === "failed" || event.type.endsWith(".failed")
                ? "failed"
                : eventStatus === "running"
                    ? "streaming"
                    : "completed";
        const sideEffectClass = clean(payload.sideEffectClass) === "write"
            ? "write"
            : clean(payload.sideEffectClass) === "read"
                ? "read"
                : "unknown";
        return {
            toolCallId: event.eventId,
            runId: event.runId,
            toolName,
            status,
            requestedAt: event.type.endsWith(".started") ? event.occurredAt : null,
            completedAt: event.type.endsWith(".started") ? null : event.occurredAt,
            summary: stepSummaryForEvent(event),
            sideEffectClass,
        };
    })
        .slice(0, 18);
}
function buildDiagnostics(runId, detail) {
    if (!detail)
        return [];
    const diagnostics = [];
    detail.activeBlockers.forEach((blocker, index) => {
        diagnostics.push({
            id: `blocker:${index}`,
            severity: detail.status === "failed" ? "critical" : "warning",
            title: "Active blocker",
            summary: blocker,
            recommendedAction: detail.boardRow?.next || null,
        });
    });
    detail.ratholeSignals.forEach((signal) => {
        diagnostics.push({
            id: signal.signalId,
            severity: signal.severity,
            title: signal.kind.replaceAll("_", " "),
            summary: signal.summary,
            recommendedAction: signal.recommendedAction,
        });
    });
    detail.goalMisses.forEach((goalMiss, index) => {
        diagnostics.push({
            id: `goal-miss:${index}`,
            severity: "warning",
            title: goalMiss.category.replaceAll("_", " "),
            summary: goalMiss.summary,
            recommendedAction: detail.boardRow?.next || null,
        });
    });
    return diagnostics.slice(0, 12);
}
function buildAgentRuntimeRunDetail(repoRoot, runId) {
    const summary = (0, files_1.readAgentRuntimeSummary)(repoRoot, runId);
    const events = (0, files_1.readAgentRuntimeEvents)(repoRoot, runId, 120);
    return {
        schema: "agent-runtime-run-detail.v1",
        generatedAt: new Date().toISOString(),
        runId,
        summary,
        events,
        steps: projectSteps(events),
        toolCalls: projectToolCalls(events),
        diagnostics: buildDiagnostics(runId, summary),
        artifacts: (0, files_1.listAgentRuntimeArtifacts)(repoRoot, runId, 18),
        whyStuck: summary?.activeBlockers[0] ||
            summary?.ratholeSignals[0]?.summary ||
            summary?.goalMisses[0]?.summary ||
            null,
    };
}
