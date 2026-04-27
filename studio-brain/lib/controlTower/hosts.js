"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSafeControlTowerHostId = isSafeControlTowerHostId;
exports.normalizeControlTowerHostId = normalizeControlTowerHostId;
exports.writeControlTowerHostHeartbeat = writeControlTowerHostHeartbeat;
exports.listControlTowerHostHeartbeats = listControlTowerHostHeartbeats;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const DEFAULT_HOSTS_ROOT = ["output", "ops-cockpit", "hosts"];
const SAFE_CONTROL_TOWER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
function clean(value) {
    return typeof value === "string" ? value.trim() : "";
}
function hostRoots(repoRoot) {
    return (0, node_path_1.resolve)(repoRoot, ...DEFAULT_HOSTS_ROOT);
}
function isSafeControlTowerHostId(value) {
    const normalized = clean(value);
    return SAFE_CONTROL_TOWER_ID.test(normalized) && normalized !== "." && normalized !== "..";
}
function normalizeControlTowerHostId(value, fieldName = "hostId") {
    const normalized = clean(value);
    if (!isSafeControlTowerHostId(normalized)) {
        throw new Error(`${fieldName} must be a safe identifier using only letters, numbers, dot, underscore, or hyphen.`);
    }
    return normalized;
}
function normalizeReferencedRunId(value) {
    const normalized = clean(value);
    if (!normalized)
        return null;
    if (!SAFE_CONTROL_TOWER_ID.test(normalized) || normalized === "." || normalized === "..") {
        throw new Error("currentRunId must be a safe identifier using only letters, numbers, dot, underscore, or hyphen.");
    }
    return normalized;
}
function normalizeMetadata(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return {};
    const output = {};
    for (const [key, rawValue] of Object.entries(value).slice(0, 32)) {
        const normalizedKey = clean(key);
        if (!normalizedKey || rawValue === undefined)
            continue;
        output[normalizedKey] = rawValue;
    }
    return output;
}
function resolveContainedPath(root, ...segments) {
    const target = (0, node_path_1.resolve)(root, ...segments);
    const rel = (0, node_path_1.relative)(root, target);
    if (rel && (rel.startsWith("..") || (0, node_path_1.isAbsolute)(rel))) {
        throw new Error("Resolved host heartbeat path escaped the hosts root.");
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
function minutesSince(value, nowMs = Date.now()) {
    if (!value)
        return null;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed))
        return null;
    return Math.max(0, Math.floor((nowMs - parsed) / 60_000));
}
function deriveConnectivity(ageMinutes) {
    if (ageMinutes === null)
        return "offline";
    if (ageMinutes <= 2)
        return "online";
    if (ageMinutes <= 10)
        return "stale";
    return "offline";
}
function summaryForHeartbeat(heartbeat, connectivity) {
    const runLabel = clean(heartbeat.currentRunId);
    const agentCount = Math.max(0, Number(heartbeat.agentCount ?? 0));
    const metadata = normalizeMetadata(heartbeat.metadata);
    const activeCommand = clean(metadata.activeCommand);
    const verificationLane = clean(metadata.verificationLane);
    const presence = connectivity === "online"
        ? "fresh heartbeat"
        : connectivity === "stale"
            ? "heartbeat stale"
            : "heartbeat offline";
    const runSummary = runLabel ? `run ${runLabel}` : "no active run";
    const activitySummary = activeCommand || verificationLane;
    return `${presence} · ${runSummary} · ${agentCount} agent${agentCount === 1 ? "" : "s"}${activitySummary ? ` · ${activitySummary}` : ""}`;
}
function writeControlTowerHostHeartbeat(repoRoot, heartbeat) {
    (0, node_fs_1.mkdirSync)(hostRoots(repoRoot), { recursive: true });
    const hostId = normalizeControlTowerHostId(heartbeat.hostId);
    const normalized = {
        schema: "control-tower-host-heartbeat.v1",
        hostId,
        label: clean(heartbeat.label) || hostId,
        environment: heartbeat.environment === "server" ? "server" : "local",
        role: clean(heartbeat.role) || "operator-host",
        health: heartbeat.health,
        lastSeenAt: clean(heartbeat.lastSeenAt) || new Date().toISOString(),
        currentRunId: normalizeReferencedRunId(heartbeat.currentRunId),
        agentCount: Math.max(0, Number(heartbeat.agentCount ?? 0)),
        version: clean(heartbeat.version) || null,
        metadata: normalizeMetadata(heartbeat.metadata),
        metrics: {
            cpuPct: Number.isFinite(Number(heartbeat.metrics?.cpuPct)) ? Number(heartbeat.metrics?.cpuPct) : null,
            memoryPct: Number.isFinite(Number(heartbeat.metrics?.memoryPct)) ? Number(heartbeat.metrics?.memoryPct) : null,
            load1: Number.isFinite(Number(heartbeat.metrics?.load1)) ? Number(heartbeat.metrics?.load1) : null,
        },
    };
    (0, node_fs_1.writeFileSync)(resolveContainedPath(hostRoots(repoRoot), `${normalized.hostId}.json`), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}
function listControlTowerHostHeartbeats(repoRoot, nowMs = Date.now()) {
    const root = hostRoots(repoRoot);
    if (!(0, node_fs_1.existsSync)(root))
        return [];
    const hosts = [];
    for (const entry of (0, node_fs_1.readdirSync)(root, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json"))
            continue;
        if (!isSafeControlTowerHostId(entry.name.slice(0, -5)))
            continue;
        const heartbeat = readJsonFile((0, node_path_1.resolve)(root, entry.name));
        if (!heartbeat || !isSafeControlTowerHostId(heartbeat.hostId))
            continue;
        const ageMinutes = minutesSince(heartbeat.lastSeenAt, nowMs);
        const connectivity = deriveConnectivity(ageMinutes);
        hosts.push({
            hostId: heartbeat.hostId,
            label: heartbeat.label || heartbeat.hostId,
            environment: heartbeat.environment,
            role: heartbeat.role,
            connectivity,
            health: connectivity === "offline" && heartbeat.health !== "maintenance" ? "offline" : heartbeat.health,
            lastSeenAt: heartbeat.lastSeenAt,
            ageMinutes,
            currentRunId: clean(heartbeat.currentRunId) || null,
            agentCount: Math.max(0, Number(heartbeat.agentCount ?? 0)),
            version: clean(heartbeat.version) || null,
            metadata: normalizeMetadata(heartbeat.metadata),
            summary: summaryForHeartbeat(heartbeat, connectivity),
            metrics: {
                cpuPct: Number.isFinite(Number(heartbeat.metrics?.cpuPct)) ? Number(heartbeat.metrics?.cpuPct) : null,
                memoryPct: Number.isFinite(Number(heartbeat.metrics?.memoryPct)) ? Number(heartbeat.metrics?.memoryPct) : null,
                load1: Number.isFinite(Number(heartbeat.metrics?.load1)) ? Number(heartbeat.metrics?.load1) : null,
            },
        });
    }
    return hosts.sort((left, right) => String(right.lastSeenAt || "").localeCompare(String(left.lastSeenAt || "")));
}
