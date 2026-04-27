"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEMORY_OPS_EVENTS_FILE = exports.MEMORY_OPS_STATE_FILE = exports.MEMORY_OPS_LATEST_FILE = exports.MEMORY_OPS_RELATIVE_DIR = void 0;
exports.resolveMemoryOpsDir = resolveMemoryOpsDir;
exports.readMemoryOpsSnapshot = readMemoryOpsSnapshot;
exports.writeMemoryOpsSnapshot = writeMemoryOpsSnapshot;
exports.appendMemoryOpsEvent = appendMemoryOpsEvent;
exports.mergeMemoryOpsActions = mergeMemoryOpsActions;
exports.approveMemoryOpsAction = approveMemoryOpsAction;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_crypto_1 = __importDefault(require("node:crypto"));
const collect_1 = require("../controlTower/collect");
exports.MEMORY_OPS_RELATIVE_DIR = ["output", "studio-brain", "memory-ops"];
exports.MEMORY_OPS_LATEST_FILE = "latest.json";
exports.MEMORY_OPS_STATE_FILE = "state.json";
exports.MEMORY_OPS_EVENTS_FILE = "events.jsonl";
function resolveMemoryOpsDir(repoRoot) {
    return (0, node_path_1.resolve)((0, collect_1.resolveControlTowerRepoRoot)(repoRoot), ...exports.MEMORY_OPS_RELATIVE_DIR);
}
function readJson(path) {
    if (!(0, node_fs_1.existsSync)(path))
        return null;
    try {
        return JSON.parse((0, node_fs_1.readFileSync)(path, "utf8"));
    }
    catch {
        return null;
    }
}
function writeJsonAtomic(path, value) {
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(path), { recursive: true });
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    (0, node_fs_1.writeFileSync)(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    (0, node_fs_1.renameSync)(tempPath, path);
}
function isSnapshot(value) {
    return Boolean(value && typeof value === "object" && value.schema === "studio-brain.memory-ops.snapshot.v1");
}
function readMemoryOpsSnapshot(repoRoot) {
    const dir = resolveMemoryOpsDir(repoRoot);
    const latest = readJson((0, node_path_1.resolve)(dir, exports.MEMORY_OPS_LATEST_FILE));
    if (isSnapshot(latest))
        return latest;
    const state = readJson((0, node_path_1.resolve)(dir, exports.MEMORY_OPS_STATE_FILE));
    return isSnapshot(state) ? state : null;
}
function writeMemoryOpsSnapshot(snapshot, repoRoot) {
    const dir = resolveMemoryOpsDir(repoRoot);
    writeJsonAtomic((0, node_path_1.resolve)(dir, exports.MEMORY_OPS_STATE_FILE), snapshot);
    writeJsonAtomic((0, node_path_1.resolve)(dir, exports.MEMORY_OPS_LATEST_FILE), snapshot);
}
function appendMemoryOpsEvent(event, repoRoot) {
    const created = {
        schema: "studio-brain.memory-ops.event.v1",
        id: event.id || `memory-ops-event:${node_crypto_1.default.randomUUID()}`,
        at: event.at || new Date().toISOString(),
        kind: event.kind,
        severity: event.severity,
        title: event.title,
        summary: event.summary,
        actionId: event.actionId ?? null,
        payload: event.payload,
    };
    const path = (0, node_path_1.resolve)(resolveMemoryOpsDir(repoRoot), exports.MEMORY_OPS_EVENTS_FILE);
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(path), { recursive: true });
    (0, node_fs_1.appendFileSync)(path, `${JSON.stringify(created)}\n`, "utf8");
    return created;
}
function mergeMemoryOpsActions(previous, nextActions, nowIso) {
    const previousById = new Map((previous?.actions ?? []).map((action) => [action.id, action]));
    return nextActions.map((action) => {
        const existing = previousById.get(action.id);
        if (!existing)
            return action;
        const keepStatus = existing.status === "approved" ||
            existing.status === "running" ||
            existing.status === "succeeded" ||
            existing.status === "failed";
        return {
            ...action,
            status: keepStatus ? existing.status : action.status,
            firstSeenAt: existing.firstSeenAt || action.firstSeenAt,
            lastSeenAt: nowIso,
            approvedAt: existing.approvedAt ?? action.approvedAt ?? null,
            approvedBy: existing.approvedBy ?? action.approvedBy ?? null,
            executedAt: existing.executedAt ?? action.executedAt ?? null,
            executionSummary: existing.executionSummary ?? action.executionSummary ?? null,
        };
    });
}
function approveMemoryOpsAction(input) {
    const snapshot = readMemoryOpsSnapshot(input.repoRoot);
    if (!snapshot) {
        return { ok: false, statusCode: 404, message: "Memory ops sidecar state is not available yet." };
    }
    const actionIndex = snapshot.actions.findIndex((action) => action.id === input.actionId);
    if (actionIndex < 0) {
        return { ok: false, statusCode: 404, message: "Memory ops action not found." };
    }
    const action = snapshot.actions[actionIndex];
    if (action.policy !== "approval_required") {
        return { ok: false, statusCode: 400, message: "Only approval-required memory ops actions can be approved." };
    }
    const nowIso = new Date().toISOString();
    const receipt = {
        id: `memory-ops-receipt:${node_crypto_1.default.createHash("sha256").update(`${action.id}:${input.actor}:approved`).digest("hex").slice(0, 24)}`,
        actionId: action.id,
        at: nowIso,
        actor: input.actor,
        status: "approved",
        summary: input.rationale?.trim() || `Approved ${action.title}.`,
        details: {
            policy: action.policy,
            executionKind: action.execution.kind,
        },
    };
    const receipts = [
        receipt,
        ...snapshot.receipts.filter((entry) => !(entry.actionId === action.id && entry.status === "approved" && entry.actor === input.actor)),
    ].slice(0, 80);
    const nextAction = {
        ...action,
        status: "approved",
        approvedAt: nowIso,
        approvedBy: input.actor,
    };
    const nextSnapshot = {
        ...snapshot,
        generatedAt: nowIso,
        actions: snapshot.actions.map((entry, index) => (index === actionIndex ? nextAction : entry)),
        receipts,
    };
    writeMemoryOpsSnapshot(nextSnapshot, input.repoRoot);
    appendMemoryOpsEvent({
        kind: "receipt",
        severity: "warning",
        title: "Memory ops action approved",
        summary: receipt.summary,
        actionId: action.id,
        payload: receipt.details,
    }, input.repoRoot);
    return { ok: true, snapshot: nextSnapshot, action: nextAction, receipt };
}
