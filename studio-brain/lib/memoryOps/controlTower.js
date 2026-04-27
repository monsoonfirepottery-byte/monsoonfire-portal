"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizeMemoryOpsForControlTower = summarizeMemoryOpsForControlTower;
exports.buildMemoryOpsServiceCards = buildMemoryOpsServiceCards;
exports.buildMemoryOpsAttention = buildMemoryOpsAttention;
exports.buildMemoryOpsNextMoves = buildMemoryOpsNextMoves;
exports.buildMemoryOpsEvents = buildMemoryOpsEvents;
function clip(value, max = 180) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!text)
        return "";
    return text.length > max ? `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...` : text;
}
function healthToCardHealth(health) {
    if (health === "critical")
        return "error";
    if (health === "degraded" || health === "unknown")
        return "waiting";
    return "healthy";
}
function actionLabel(policy) {
    if (policy === "safe_auto")
        return "Auto repair";
    if (policy === "approval_required")
        return "Approve recovery";
    return "Open runbook";
}
function summarizeMemoryOpsForControlTower(snapshot) {
    if (!snapshot)
        return null;
    return {
        status: snapshot.status,
        summary: snapshot.summary,
        heartbeatAt: snapshot.supervisor.heartbeatAt,
        findingCount: snapshot.findings.length,
        criticalFindingCount: snapshot.findings.filter((entry) => entry.severity === "critical").length,
        warningFindingCount: snapshot.findings.filter((entry) => entry.severity === "warning").length,
        pendingApprovalCount: snapshot.actions.filter((entry) => entry.policy === "approval_required" && entry.status === "proposed").length,
        stuckItemCount: snapshot.stuckItems.length,
        services: snapshot.services.map((service) => ({
            id: service.id,
            label: service.label,
            health: service.health,
            summary: service.summary,
        })),
    };
}
function buildMemoryOpsServiceCards(snapshot) {
    if (!snapshot) {
        return [
            {
                id: "memory-ops-sidecar",
                label: "Memory Ops Sidecar",
                health: "waiting",
                impact: "Memory self-healing visibility is unavailable until the sidecar writes its first heartbeat.",
                recentChanges: "No sidecar snapshot found.",
                changedAt: null,
                summary: "Memory ops sidecar has not reported yet.",
                actions: [{ id: "memory-ops-sidecar:status", label: "Refresh status", verb: "status", requiresConfirmation: false }],
            },
        ];
    }
    const dbaCritical = snapshot.findings.some((entry) => entry.area === "postgres" && entry.severity === "critical");
    const dbaWarnings = snapshot.findings.some((entry) => entry.area === "postgres" && entry.severity === "warning");
    const dockerCritical = snapshot.services.some((entry) => entry.kind === "docker" && entry.health === "critical");
    const dockerWarnings = snapshot.services.some((entry) => entry.kind === "docker" && (entry.health === "degraded" || entry.health === "unknown"));
    const approvalCount = snapshot.actions.filter((entry) => entry.policy === "approval_required" && entry.status === "proposed").length;
    return [
        {
            id: "memory-responsiveness",
            label: "Memory Responsiveness",
            health: healthToCardHealth(snapshot.status),
            impact: snapshot.status === "critical" ? "Interactive memory recall may fail or shed traffic." : "Memory recall has current sidecar coverage.",
            recentChanges: snapshot.summary,
            changedAt: snapshot.generatedAt,
            summary: snapshot.summary,
            actions: [{ id: "memory-responsiveness:status", label: "Refresh status", verb: "status", requiresConfirmation: false }],
        },
        {
            id: "memory-dba",
            label: "Memory DBA",
            health: dbaCritical ? "error" : dbaWarnings ? "waiting" : "healthy",
            impact: dbaCritical ? "Postgres pressure may block memory writes or queries." : "Postgres memory-table posture is being watched.",
            recentChanges: snapshot.postgres?.error || `${snapshot.postgres?.connectionSummary.total ?? 0} Postgres client connection(s) observed.`,
            changedAt: snapshot.postgres?.checkedAt ?? snapshot.generatedAt,
            summary: dbaCritical || dbaWarnings ? "DBA findings are active." : "No active DBA findings.",
            actions: [{ id: "memory-dba:status", label: "Refresh status", verb: "status", requiresConfirmation: false }],
        },
        {
            id: "memory-docker",
            label: "Memory Docker Health",
            health: dockerCritical ? "error" : dockerWarnings ? "waiting" : "healthy",
            impact: dockerCritical ? "One or more memory dependencies are down." : "Docker dependency state is visible.",
            recentChanges: snapshot.services.filter((entry) => entry.kind === "docker" && entry.health !== "healthy")[0]?.summary || "Docker dependencies are nominal.",
            changedAt: snapshot.generatedAt,
            summary: `${snapshot.services.filter((entry) => entry.kind === "docker").length} Docker service probe(s) recorded.`,
            actions: [{ id: "memory-docker:status", label: "Refresh status", verb: "status", requiresConfirmation: false }],
        },
        {
            id: "memory-stuck-items",
            label: "Memory Stuck Items",
            health: snapshot.stuckItems.some((entry) => entry.severity === "critical") ? "error" : snapshot.stuckItems.length > 0 ? "waiting" : "healthy",
            impact: snapshot.stuckItems.length > 0 ? "Some memories may stay unresolved until review work is refreshed." : "No stuck memory work is reported.",
            recentChanges: snapshot.stuckItems[0]?.summary || "No stuck memory buckets.",
            changedAt: snapshot.generatedAt,
            summary: `${snapshot.stuckItems.length} stuck memory bucket(s).`,
            actions: [{ id: "memory-stuck-items:status", label: "Refresh status", verb: "status", requiresConfirmation: false }],
        },
        {
            id: "memory-ops-approvals",
            label: "Memory Recovery Approvals",
            health: approvalCount > 0 ? "waiting" : "healthy",
            impact: approvalCount > 0 ? "Recovery is waiting for supervised approval." : "No risky recovery action is pending.",
            recentChanges: `${approvalCount} approval-required action(s) waiting.`,
            changedAt: snapshot.generatedAt,
            summary: `${approvalCount} pending approval(s).`,
            actions: [{ id: "memory-ops-approvals:status", label: "Refresh status", verb: "status", requiresConfirmation: false }],
        },
    ];
}
function buildMemoryOpsAttention(snapshot) {
    if (!snapshot) {
        return [{
                id: "attention:memory-ops:missing",
                title: "Memory ops sidecar has no heartbeat",
                why: "The Control Tower cannot see memory DBA/sysadmin posture yet.",
                ageMinutes: null,
                severity: "warning",
                actionLabel: "Inspect memory ops",
                target: { type: "ops", action: "memory-ops" },
            }];
    }
    const items = [];
    if (snapshot.status !== "healthy") {
        items.push({
            id: "attention:memory-ops:posture",
            title: snapshot.status === "critical" ? "Memory ops is critical" : "Memory ops is degraded",
            why: clip(snapshot.summary),
            ageMinutes: null,
            severity: snapshot.status === "critical" ? "critical" : "warning",
            actionLabel: "Inspect memory ops",
            target: { type: "ops", action: "memory-ops" },
        });
    }
    for (const action of snapshot.actions.filter((entry) => entry.policy === "approval_required" && entry.status === "proposed").slice(0, 2)) {
        items.push({
            id: `attention:memory-ops:approval:${action.id}`,
            title: action.title,
            why: clip(action.summary),
            ageMinutes: null,
            severity: "warning",
            actionLabel: actionLabel(action.policy),
            target: { type: "ops", action: "memory-ops" },
        });
    }
    return items.slice(0, 3);
}
function buildMemoryOpsNextMoves(snapshot) {
    if (!snapshot) {
        return [{
                id: "memory-ops:start-sidecar",
                title: "Start the memory ops sidecar",
                why: "Control Tower has no memory ops heartbeat yet.",
                ageMinutes: null,
                actionLabel: "Inspect memory ops",
                target: { type: "ops", action: "memory-ops" },
            }];
    }
    return snapshot.actions
        .filter((entry) => entry.status === "proposed" || entry.status === "approved")
        .slice(0, 4)
        .map((entry) => ({
        id: `memory-ops-action:${entry.id}`,
        title: entry.title,
        why: clip(entry.summary),
        ageMinutes: null,
        actionLabel: actionLabel(entry.policy),
        target: { type: "ops", action: "memory-ops" },
    }));
}
function buildMemoryOpsEvents(snapshot) {
    if (!snapshot)
        return [];
    const events = [{
            id: `memory-ops:${snapshot.generatedAt}`,
            at: snapshot.generatedAt,
            kind: "operator",
            type: snapshot.status === "critical" ? "incident.raised" : "health.changed",
            runId: null,
            agentId: "memory-ops-sidecar",
            channel: "ops",
            occurredAt: snapshot.generatedAt,
            severity: snapshot.status === "critical" ? "critical" : snapshot.status === "degraded" ? "warning" : "info",
            title: "Memory ops sidecar heartbeat",
            summary: clip(snapshot.summary, 220),
            actor: "memory-ops-sidecar",
            roomId: null,
            serviceId: "memory-responsiveness",
            actionLabel: "Inspect memory ops",
            sourceAction: "control_tower.memory_ops",
            payload: {
                status: snapshot.status,
                findings: snapshot.findings.length,
                stuckItems: snapshot.stuckItems.length,
                actions: snapshot.actions.length,
            },
        }];
    snapshot.receipts.slice(0, 4).forEach((receipt) => {
        events.push({
            id: `memory-ops-receipt:${receipt.id}`,
            at: receipt.at,
            kind: "operator",
            type: "task.updated",
            runId: receipt.actionId,
            agentId: receipt.actor,
            channel: "ops",
            occurredAt: receipt.at,
            severity: receipt.status === "failed" ? "critical" : receipt.status === "approved" ? "warning" : "info",
            title: "Memory ops recovery receipt",
            summary: clip(receipt.summary, 220),
            actor: receipt.actor,
            roomId: null,
            serviceId: "memory-ops-approvals",
            actionLabel: "Inspect memory ops",
            sourceAction: "control_tower.memory_ops_receipt",
            payload: {
                actionId: receipt.actionId,
                status: receipt.status,
                details: receipt.details ?? null,
            },
        });
    });
    return events;
}
