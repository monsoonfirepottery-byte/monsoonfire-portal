"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentRuntimeRunsRoot = agentRuntimeRunsRoot;
exports.agentRuntimeRunRoot = agentRuntimeRunRoot;
exports.listAgentRuntimeSummaries = listAgentRuntimeSummaries;
exports.readLatestAgentRuntimeSummary = readLatestAgentRuntimeSummary;
exports.readAgentRuntimeEvents = readAgentRuntimeEvents;
exports.appendAgentRuntimeEvent = appendAgentRuntimeEvent;
exports.writeAgentRuntimeSummary = writeAgentRuntimeSummary;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const DEFAULT_RUNS_ROOT = ["output", "agent-runs"];
function clean(value) {
    return typeof value === "string" ? value.trim() : "";
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
function agentRuntimeRunsRoot(repoRoot) {
    return (0, node_path_1.resolve)(repoRoot, ...DEFAULT_RUNS_ROOT);
}
function agentRuntimeRunRoot(repoRoot, runId) {
    return (0, node_path_1.resolve)(agentRuntimeRunsRoot(repoRoot), clean(runId));
}
function listAgentRuntimeSummaries(repoRoot, limit = 12) {
    const runsRoot = agentRuntimeRunsRoot(repoRoot);
    if (!(0, node_fs_1.existsSync)(runsRoot))
        return [];
    const summaries = [];
    for (const entry of (0, node_fs_1.readdirSync)(runsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory())
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
function readLatestAgentRuntimeSummary(repoRoot) {
    const pointer = readJsonFile((0, node_path_1.resolve)(agentRuntimeRunsRoot(repoRoot), "latest.json"));
    const pointerRunId = clean(pointer?.runId);
    if (pointerRunId) {
        const summary = readJsonFile((0, node_path_1.resolve)(agentRuntimeRunRoot(repoRoot, pointerRunId), "summary.json"));
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
    const runRoot = agentRuntimeRunRoot(repoRoot, event.runId);
    (0, node_fs_1.mkdirSync)(runRoot, { recursive: true });
    (0, node_fs_1.appendFileSync)((0, node_path_1.resolve)(runRoot, "run-ledger.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
}
function writeAgentRuntimeSummary(repoRoot, summary) {
    const runRoot = agentRuntimeRunRoot(repoRoot, summary.runId);
    (0, node_fs_1.mkdirSync)(runRoot, { recursive: true });
    (0, node_fs_1.writeFileSync)((0, node_path_1.resolve)(runRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    (0, node_fs_1.writeFileSync)((0, node_path_1.resolve)(agentRuntimeRunsRoot(repoRoot), "latest.json"), `${JSON.stringify({ schema: "agent-runtime-pointer.v1", runId: summary.runId, updatedAt: summary.updatedAt }, null, 2)}\n`, "utf8");
}
