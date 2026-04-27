"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSafeAgentRuntimeId = isSafeAgentRuntimeId;
exports.normalizeAgentRuntimeRunId = normalizeAgentRuntimeRunId;
exports.agentRuntimeRunsRoot = agentRuntimeRunsRoot;
exports.agentRuntimeRunRoot = agentRuntimeRunRoot;
exports.listAgentRuntimeSummaries = listAgentRuntimeSummaries;
exports.readAgentRuntimeSummary = readAgentRuntimeSummary;
exports.readLatestAgentRuntimeSummary = readLatestAgentRuntimeSummary;
exports.readAgentRuntimeEvents = readAgentRuntimeEvents;
exports.appendAgentRuntimeEvent = appendAgentRuntimeEvent;
exports.writeAgentRuntimeSummary = writeAgentRuntimeSummary;
exports.listAgentRuntimeArtifacts = listAgentRuntimeArtifacts;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const DEFAULT_RUNS_ROOT = ["output", "agent-runs"];
const SAFE_AGENT_RUNTIME_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
function clean(value) {
    return typeof value === "string" ? value.trim() : "";
}
function isSafeAgentRuntimeId(value) {
    const normalized = clean(value);
    return SAFE_AGENT_RUNTIME_ID.test(normalized) && normalized !== "." && normalized !== "..";
}
function normalizeAgentRuntimeRunId(value, fieldName = "runId") {
    const normalized = clean(value);
    if (!isSafeAgentRuntimeId(normalized)) {
        throw new Error(`${fieldName} must be a safe identifier using only letters, numbers, dot, underscore, or hyphen.`);
    }
    return normalized;
}
function resolveContainedPath(root, ...segments) {
    const target = (0, node_path_1.resolve)(root, ...segments);
    const rel = (0, node_path_1.relative)(root, target);
    if (rel && (rel.startsWith("..") || (0, node_path_1.isAbsolute)(rel))) {
        throw new Error("Resolved runtime path escaped the agent runs root.");
    }
    return target;
}
function readJsonFile(path) {
    if (!(0, node_fs_1.existsSync)(path))
        return null;
    try {
        return JSON.parse((0, node_fs_1.readFileSync)(path, "utf8"));
    }
    catch {
        return null;
    }
}
function isPreviewableArtifact(path) {
    const extension = (0, node_path_1.extname)(path).toLowerCase();
    return [".json", ".jsonl", ".log", ".md", ".txt", ".yaml", ".yml"].includes(extension);
}
function artifactKind(path) {
    const extension = (0, node_path_1.extname)(path).toLowerCase();
    if (extension === ".json")
        return "json";
    if (extension === ".jsonl" || extension === ".log")
        return "ledger";
    if ([".md", ".txt", ".yaml", ".yml"].includes(extension))
        return "text";
    return "file";
}
function agentRuntimeRunsRoot(repoRoot) {
    return (0, node_path_1.resolve)(repoRoot, ...DEFAULT_RUNS_ROOT);
}
function agentRuntimeRunRoot(repoRoot, runId) {
    const runsRoot = agentRuntimeRunsRoot(repoRoot);
    return resolveContainedPath(runsRoot, normalizeAgentRuntimeRunId(runId));
}
function listAgentRuntimeSummaries(repoRoot, limit = 12) {
    const runsRoot = agentRuntimeRunsRoot(repoRoot);
    if (!(0, node_fs_1.existsSync)(runsRoot))
        return [];
    const summaries = [];
    for (const entry of (0, node_fs_1.readdirSync)(runsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory())
            continue;
        if (!isSafeAgentRuntimeId(entry.name))
            continue;
        const summary = readJsonFile((0, node_path_1.resolve)(runsRoot, entry.name, "summary.json"));
        if (!summary)
            continue;
        summaries.push(summary);
    }
    return summaries
        .sort((left, right) => clean(right.updatedAt).localeCompare(clean(left.updatedAt)))
        .slice(0, Math.max(1, limit));
}
function readAgentRuntimeSummary(repoRoot, runId) {
    return readJsonFile((0, node_path_1.resolve)(agentRuntimeRunRoot(repoRoot, runId), "summary.json"));
}
function readLatestAgentRuntimeSummary(repoRoot) {
    const pointer = readJsonFile((0, node_path_1.resolve)(agentRuntimeRunsRoot(repoRoot), "latest.json"));
    const pointerRunId = clean(pointer?.runId);
    if (pointerRunId) {
        const summary = readAgentRuntimeSummary(repoRoot, pointerRunId);
        if (summary)
            return summary;
    }
    return listAgentRuntimeSummaries(repoRoot, 1)[0] ?? null;
}
function readAgentRuntimeEvents(repoRoot, runId, limit = 50) {
    const ledgerPath = (0, node_path_1.resolve)(agentRuntimeRunRoot(repoRoot, runId), "run-ledger.jsonl");
    if (!(0, node_fs_1.existsSync)(ledgerPath))
        return [];
    const events = [];
    for (const line of (0, node_fs_1.readFileSync)(ledgerPath, "utf8").split(/\r?\n/)) {
        if (!line.trim())
            continue;
        try {
            events.push(JSON.parse(line));
        }
        catch {
            continue;
        }
    }
    return events.slice(-Math.max(1, limit));
}
function appendAgentRuntimeEvent(repoRoot, event) {
    const runId = normalizeAgentRuntimeRunId(event.runId);
    const runRoot = agentRuntimeRunRoot(repoRoot, runId);
    (0, node_fs_1.mkdirSync)(runRoot, { recursive: true });
    (0, node_fs_1.appendFileSync)((0, node_path_1.resolve)(runRoot, "run-ledger.jsonl"), `${JSON.stringify({ ...event, runId })}\n`, "utf8");
}
function writeAgentRuntimeSummary(repoRoot, summary) {
    const runId = normalizeAgentRuntimeRunId(summary.runId);
    const normalized = { ...summary, runId };
    const runRoot = agentRuntimeRunRoot(repoRoot, runId);
    (0, node_fs_1.mkdirSync)(runRoot, { recursive: true });
    (0, node_fs_1.writeFileSync)((0, node_path_1.resolve)(runRoot, "summary.json"), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    (0, node_fs_1.writeFileSync)((0, node_path_1.resolve)(agentRuntimeRunsRoot(repoRoot), "latest.json"), `${JSON.stringify({ schema: "agent-runtime-pointer.v1", runId, updatedAt: summary.updatedAt }, null, 2)}\n`, "utf8");
}
function listAgentRuntimeArtifacts(repoRoot, runId, limit = 18) {
    const runRoot = agentRuntimeRunRoot(repoRoot, runId);
    if (!(0, node_fs_1.existsSync)(runRoot))
        return [];
    const queue = [runRoot];
    const artifacts = [];
    while (queue.length && artifacts.length < Math.max(1, limit)) {
        const current = queue.shift();
        for (const entry of (0, node_fs_1.readdirSync)(current, { withFileTypes: true })) {
            if (artifacts.length >= Math.max(1, limit))
                break;
            const absolutePath = (0, node_path_1.resolve)(current, entry.name);
            if (entry.isDirectory()) {
                if ((0, node_path_1.relative)(runRoot, absolutePath).split(/[\\/]/).length <= 2) {
                    queue.push(absolutePath);
                }
                continue;
            }
            if (!entry.isFile())
                continue;
            const stats = (0, node_fs_1.statSync)(absolutePath);
            const preview = isPreviewableArtifact(absolutePath) && stats.size <= 128_000
                ? (0, node_fs_1.readFileSync)(absolutePath, "utf8").slice(0, 1_200)
                : null;
            artifacts.push({
                artifactId: (0, node_path_1.relative)(runRoot, absolutePath).replaceAll("\\", "/"),
                runId,
                label: entry.name,
                kind: artifactKind(absolutePath),
                path: (0, node_path_1.relative)(repoRoot, absolutePath).replaceAll("\\", "/"),
                sizeBytes: stats.size,
                updatedAt: Number.isFinite(stats.mtimeMs) ? new Date(stats.mtimeMs).toISOString() : null,
                preview,
            });
        }
    }
    return artifacts.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
}
