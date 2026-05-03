"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMemoryOpsSupervisorTick = runMemoryOpsSupervisorTick;
const postgres_1 = require("../db/postgres");
const env_1 = require("../config/env");
const policy_1 = require("./policy");
const diagnostics_1 = require("./diagnostics");
const state_1 = require("./state");
const SAFE_ANALYZE_TABLES = new Set(["swarm_memory", "memory_lattice_projection", "memory_review_case", "memory_verification_run"]);
function authHeadersFromEnv() {
    const token = String(process.env.STUDIO_BRAIN_MCP_ID_TOKEN || process.env.STUDIO_BRAIN_MEMORY_OPS_ID_TOKEN || "").trim();
    const adminToken = String(process.env.STUDIO_BRAIN_ADMIN_TOKEN || process.env.STUDIO_BRAIN_MEMORY_OPS_ADMIN_TOKEN || "").trim();
    return {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(adminToken ? { "x-studio-brain-admin-token": adminToken } : {}),
    };
}
function toReceipt(action, status, summary, details) {
    return {
        id: `memory-ops-receipt:${action.id}:${status}:${Date.now()}`,
        actionId: action.id,
        at: new Date().toISOString(),
        actor: "memory-ops-sidecar",
        status,
        summary,
        details,
    };
}
async function executeAction(input) {
    const { action, runner, dryRun } = input;
    if (action.execution.kind === "none") {
        return toReceipt(action, "skipped", "No executable recovery step is attached to this action.");
    }
    if (dryRun) {
        return toReceipt(action, "skipped", `Dry run: would execute ${action.execution.kind}.`, { execution: action.execution });
    }
    if (action.execution.kind === "http_get") {
        const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}${action.execution.path}`, {
            headers: authHeadersFromEnv(),
        });
        if (!response.ok)
            throw new Error(`HTTP recovery probe failed with ${response.status}`);
        return toReceipt(action, "executed", `Fetched ${action.execution.path}.`);
    }
    if (action.execution.kind === "postgres_analyze" || action.execution.kind === "postgres_vacuum_analyze") {
        const unsafe = action.execution.tables.find((table) => !SAFE_ANALYZE_TABLES.has(table));
        if (unsafe)
            throw new Error(`Refusing to analyze non-allowlisted table ${unsafe}`);
        const pool = (0, postgres_1.getPgPool)();
        for (const table of action.execution.tables) {
            if (action.execution.kind === "postgres_analyze") {
                await pool.query(`ANALYZE ${table}`);
            }
            else {
                await pool.query(`VACUUM (ANALYZE) ${table}`);
            }
        }
        return toReceipt(action, "executed", `${action.execution.kind === "postgres_analyze" ? "Analyzed" : "Vacuum analyzed"} ${action.execution.tables.length} table(s).`);
    }
    if (action.execution.kind === "systemctl_user") {
        const result = runner("systemctl", ["--user", action.execution.verb, action.execution.service], {});
        if (!result.ok)
            throw new Error(result.stderr || result.stdout || "systemctl action failed");
        return toReceipt(action, "executed", `${action.execution.verb} ${action.execution.service} completed.`, { command: result.command });
    }
    if (action.execution.kind === "docker_compose") {
        const result = runner("docker", ["compose", "restart", action.execution.service], {});
        if (!result.ok)
            throw new Error(result.stderr || result.stdout || "docker compose action failed");
        return toReceipt(action, "executed", `Docker ${action.execution.service} restart completed.`, { command: result.command });
    }
    if (action.execution.kind === "process_kill") {
        const killed = [];
        for (const pid of action.execution.pids) {
            const result = runner("kill", [String(pid)], {});
            if (result.ok)
                killed.push(pid);
        }
        return toReceipt(action, "executed", `Stopped ${killed.length} process(es).`, { killed });
    }
    return toReceipt(action, "skipped", "Unsupported action execution kind.");
}
async function executeEligibleActions(input) {
    const receipts = [...input.snapshot.receipts];
    const actions = [];
    for (const action of input.snapshot.actions) {
        const safeReady = input.executeSafe && action.policy === "safe_auto" && action.status === "proposed";
        const approvalReady = input.executeApproved && action.policy === "approval_required" && action.status === "approved";
        if (!safeReady && !approvalReady) {
            actions.push(action);
            continue;
        }
        try {
            const receipt = await executeAction({ action, repoRoot: input.repoRoot, baseUrl: input.baseUrl, runner: input.runner, dryRun: input.dryRun });
            receipts.unshift(receipt);
            (0, state_1.appendMemoryOpsEvent)({
                kind: "receipt",
                severity: receipt.status === "failed" ? "critical" : "info",
                title: "Memory ops recovery receipt",
                summary: receipt.summary,
                actionId: action.id,
                payload: receipt.details,
            }, input.repoRoot);
            actions.push({
                ...action,
                status: receipt.status === "executed" ? "succeeded" : receipt.status === "failed" ? "failed" : "skipped",
                executedAt: receipt.at,
                executionSummary: receipt.summary,
            });
        }
        catch (error) {
            const receipt = toReceipt(action, "failed", error instanceof Error ? error.message : String(error));
            receipts.unshift(receipt);
            input.logger?.warn("memory_ops_action_failed", { actionId: action.id, message: receipt.summary });
            actions.push({ ...action, status: "failed", executedAt: receipt.at, executionSummary: receipt.summary });
        }
    }
    return { ...input.snapshot, actions, receipts: receipts.slice(0, 80) };
}
async function runMemoryOpsSupervisorTick(input = {}) {
    const env = (0, env_1.readEnv)();
    const nowIso = new Date().toISOString();
    const runner = input.runner ?? (0, diagnostics_1.createMemoryOpsRunner)();
    const baseUrl = input.baseUrl || `http://${env.STUDIO_BRAIN_HOST}:${env.STUDIO_BRAIN_PORT}`;
    const previous = (0, state_1.readMemoryOpsSnapshot)(input.repoRoot);
    const [memoryHttp, postgres, systemd, docker, processes] = await Promise.all([
        (0, diagnostics_1.collectMemoryHttpSnapshot)({ baseUrl, headers: authHeadersFromEnv(), timeoutMs: 5_000 }),
        (0, diagnostics_1.collectPostgresDbaSnapshot)(),
        Promise.resolve((0, diagnostics_1.collectSystemdServiceProbes)({ runner })),
        Promise.resolve((0, diagnostics_1.collectDockerServiceProbes)({ runner, repoRoot: input.repoRoot })),
        Promise.resolve((0, diagnostics_1.collectProcessProbes)({ runner })),
    ]);
    const memoryClassification = (0, policy_1.classifyMemoryFindings)(memoryHttp.memory);
    const services = [...memoryHttp.services, ...systemd, ...docker, ...processes];
    const findings = [
        ...memoryClassification.findings,
        ...(0, policy_1.classifyPostgresDbaFindings)(postgres),
        ...(0, policy_1.classifyServiceFindings)(services),
    ];
    const actions = (0, state_1.mergeMemoryOpsActions)(previous, (0, policy_1.deriveMemoryOpsActions)({
        findings,
        services,
        memory: memoryHttp.memory,
        postgres,
        nowIso,
    }), nowIso);
    const health = (0, policy_1.summarizeMemoryOpsHealth)(findings);
    let snapshot = {
        schema: "studio-brain.memory-ops.snapshot.v1",
        generatedAt: nowIso,
        status: health.health,
        summary: health.summary,
        supervisor: {
            heartbeatAt: nowIso,
            mode: input.dryRun ? "dry-run" : "supervised",
            version: "memory-ops-sidecar.v1",
        },
        memory: memoryHttp.memory,
        postgres,
        services,
        findings,
        stuckItems: memoryClassification.stuckItems,
        actions,
        receipts: previous?.receipts ?? [],
    };
    snapshot = await executeEligibleActions({
        snapshot,
        repoRoot: input.repoRoot,
        baseUrl,
        runner,
        executeSafe: input.executeSafe === true,
        executeApproved: input.executeApproved === true,
        dryRun: input.dryRun === true,
        logger: input.logger,
    });
    (0, state_1.writeMemoryOpsSnapshot)(snapshot, input.repoRoot);
    (0, state_1.appendMemoryOpsEvent)({
        kind: "snapshot",
        severity: snapshot.status === "critical" ? "critical" : snapshot.status === "degraded" ? "warning" : "info",
        title: "Memory ops sidecar tick",
        summary: snapshot.summary,
        payload: {
            findings: snapshot.findings.length,
            actions: snapshot.actions.length,
            stuckItems: snapshot.stuckItems.length,
        },
    }, input.repoRoot);
    return snapshot;
}
