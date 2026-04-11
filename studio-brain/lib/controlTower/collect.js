"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVICE_SPECS = exports.ACK_LOG_PATH = exports.OVERSEER_DISCORD_PATH = exports.OVERSEER_PATH = exports.HEARTBEAT_PATH = exports.EXISTING_OPS_LATEST_PATH = exports.EXISTING_OPS_STATE_PATH = exports.AGENT_STATUS_DIR = exports.AGENT_META_DIR = exports.STATUS_PATH = exports.THEMES = exports.DEFAULT_THEME_NAME = exports.DEFAULT_HOST_USER = exports.DEFAULT_ROOT_SESSION = void 0;
exports.normalizeThemeName = normalizeThemeName;
exports.resolveControlTowerRepoRoot = resolveControlTowerRepoRoot;
exports.repoPath = repoPath;
exports.readJson = readJson;
exports.readJsonLines = readJsonLines;
exports.clipText = clipText;
exports.relativeOrSelf = relativeOrSelf;
exports.createRunner = createRunner;
exports.collectControlTowerRawState = collectControlTowerRawState;
exports.writeControlTowerState = writeControlTowerState;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_child_process_1 = require("node:child_process");
exports.DEFAULT_ROOT_SESSION = process.env.STUDIO_BRAIN_TMUX_SESSION_NAME || "studiobrain";
exports.DEFAULT_HOST_USER = process.env.STUDIO_BRAIN_DEPLOY_USER || process.env.USER || process.env.LOGNAME || "wuff";
exports.DEFAULT_THEME_NAME = "desert-night";
exports.THEMES = {
    "desert-night": {
        name: "desert-night",
        label: "Desert Night",
        colorMode: "dark",
        motionLevel: "calm",
        highContrast: false,
        refreshMode: "diff-only",
    },
    "paper-day": {
        name: "paper-day",
        label: "Paper Day",
        colorMode: "light",
        motionLevel: "calm",
        highContrast: false,
        refreshMode: "diff-only",
    },
};
exports.STATUS_PATH = ["output", "ops-cockpit", "operator-state.json"];
exports.AGENT_META_DIR = ["output", "ops-cockpit", "agents"];
exports.AGENT_STATUS_DIR = ["output", "ops-cockpit", "agent-status"];
exports.EXISTING_OPS_STATE_PATH = ["output", "ops-cockpit", "state.json"];
exports.EXISTING_OPS_LATEST_PATH = ["output", "ops-cockpit", "latest-status.json"];
exports.HEARTBEAT_PATH = ["output", "stability", "heartbeat-summary.json"];
exports.OVERSEER_PATH = ["output", "overseer", "latest.json"];
exports.OVERSEER_DISCORD_PATH = ["output", "overseer", "discord", "latest.json"];
exports.ACK_LOG_PATH = ["output", "overseer", "discord", "acks.jsonl"];
exports.SERVICE_SPECS = [
    { key: "studio-brain-discord-relay", label: "Discord Relay", verbs: ["status", "restart", "start", "stop"] },
];
function normalizeThemeName(raw) {
    const key = String(raw || "").trim().toLowerCase();
    return (key in exports.THEMES ? key : exports.DEFAULT_THEME_NAME);
}
function resolveControlTowerRepoRoot(raw) {
    if (raw) {
        return (0, node_path_1.resolve)(raw);
    }
    const cwd = (0, node_path_1.resolve)(process.cwd());
    if ((0, node_fs_1.existsSync)((0, node_path_1.resolve)(cwd, "studio-brain")) && (0, node_fs_1.existsSync)((0, node_path_1.resolve)(cwd, "web"))) {
        return cwd;
    }
    if ((0, node_path_1.basename)(cwd) === "studio-brain" && (0, node_fs_1.existsSync)((0, node_path_1.resolve)(cwd, "..", "web"))) {
        return (0, node_path_1.resolve)(cwd, "..");
    }
    return cwd;
}
function repoPath(repoRoot, ...parts) {
    return (0, node_path_1.resolve)(repoRoot, ...parts);
}
function isRootProcess() {
    return typeof process.getuid === "function" && process.getuid() === 0;
}
function readJson(filePath, fallback) {
    if (!(0, node_fs_1.existsSync)(filePath))
        return fallback;
    try {
        return JSON.parse((0, node_fs_1.readFileSync)(filePath, "utf8"));
    }
    catch {
        return fallback;
    }
}
function readJsonLines(filePath, limit = 20) {
    if (!(0, node_fs_1.existsSync)(filePath))
        return [];
    try {
        const rows = (0, node_fs_1.readFileSync)(filePath, "utf8")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(-limit);
        return rows
            .map((line) => {
            try {
                return JSON.parse(line);
            }
            catch {
                return null;
            }
        })
            .filter((entry) => entry !== null);
    }
    catch {
        return [];
    }
}
function parseTmuxLines(stdout) {
    return String(stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split(/\u001f|\\037|\\x1f/g));
}
function clipText(value, max = 140) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text)
        return "";
    return text.length > max ? `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...` : text;
}
function relativeOrSelf(repoRoot, value) {
    const text = String(value || "").trim();
    if (!text)
        return "";
    try {
        const relativeValue = (0, node_path_1.relative)(repoRoot, text);
        return relativeValue && !relativeValue.startsWith("..") ? relativeValue : text;
    }
    catch {
        return text;
    }
}
function parseMetadataDirectory(dirPath) {
    if (!(0, node_fs_1.existsSync)(dirPath))
        return new Map();
    const output = new Map();
    for (const entry of (0, node_fs_1.readdirSync)(dirPath)) {
        if (!entry.endsWith(".json"))
            continue;
        const payload = readJson((0, node_path_1.resolve)(dirPath, entry), null);
        if (!payload || typeof payload !== "object")
            continue;
        const sessionName = String(payload.sessionName || entry.replace(/\.json$/i, "")).trim();
        if (sessionName)
            output.set(sessionName, payload);
    }
    return output;
}
function detectTool(sessionName, metadata = {}, panes = []) {
    const explicit = String(metadata.tool || "").trim().toLowerCase();
    if (explicit)
        return explicit;
    const sessionLower = String(sessionName || "").toLowerCase();
    if (sessionLower.includes("codex"))
        return "codex";
    if (sessionLower.includes("claude"))
        return "claude";
    if (sessionLower.includes("agent"))
        return "agent";
    const commands = panes.map((pane) => String(pane.currentCommand || "").toLowerCase());
    if (commands.some((value) => value.includes("codex")))
        return "codex";
    if (commands.some((value) => value.includes("claude")))
        return "claude";
    return "custom";
}
function inferRoomName(repoRoot, metadata = {}, panes = []) {
    const room = String(metadata.room || metadata.group || "").trim();
    if (room)
        return room;
    const candidates = [metadata.cwd, ...panes.map((pane) => pane.cwd)];
    for (const candidate of candidates) {
        const value = String(candidate || "").trim();
        if (!value)
            continue;
        const relativePath = relativeOrSelf(repoRoot, value);
        if (relativePath && !relativePath.startsWith("/") && !relativePath.startsWith("\\")) {
            const first = relativePath.split(/[\\/]/).filter(Boolean)[0];
            if (first)
                return first;
        }
        const base = (0, node_path_1.basename)(value);
        if (base)
            return base;
    }
    return "general";
}
function humanStateLabel(state) {
    switch (state) {
        case "working":
            return "WORK";
        case "waiting":
            return "WAIT";
        case "idle":
            return "IDLE";
        case "parked":
            return "PARK";
        case "error":
            return "ERR";
        case "pinned":
            return "PIN";
        case "healthy":
            return "OK";
        default:
            return "INFO";
    }
}
function inferAgentStatus(sessionName, metadata, statusOverride, panes, rootSession) {
    if (sessionName === rootSession)
        return "working";
    const explicit = String(statusOverride.state || metadata.state || "").trim().toLowerCase();
    if (explicit === "working" || explicit === "waiting" || explicit === "idle" || explicit === "parked" || explicit === "error") {
        return explicit;
    }
    if (panes.some((pane) => pane.paneDead))
        return "error";
    if (panes.some((pane) => /codex|claude|python|node/i.test(String(pane.currentCommand || "")))) {
        return panes.some((pane) => pane.paneActive) ? "working" : "waiting";
    }
    if (panes.some((pane) => /bash|zsh|fish|sh|pwsh|powershell/i.test(String(pane.currentCommand || "")))) {
        return panes.some((pane) => pane.paneActive) ? "waiting" : "idle";
    }
    return "idle";
}
function collectTmuxState(runner, hostUser) {
    const format = [
        "#{session_name}",
        "#{window_name}",
        "#{window_index}",
        "#{window_active}",
        "#{pane_index}",
        "#{pane_active}",
        "#{pane_current_command}",
        "#{pane_current_path}",
        "#{pane_title}",
        "#{pane_dead}",
        "#{pane_id}",
        "#{session_attached}",
        "#{session_activity}",
        "#{window_id}",
    ].join("\u001f");
    const result = runner("tmux", ["list-panes", "-a", "-F", format], { asHostUser: true, allowMissing: true });
    if (!result.ok) {
        return { ok: false, panes: [], sessions: [], hostUser };
    }
    const sessions = new Map();
    for (const columns of parseTmuxLines(result.stdout)) {
        const [sessionName, windowName, windowIndex, windowActive, paneIndex, paneActive, currentCommand, currentPath, paneTitle, paneDead, paneId, sessionAttached, sessionActivity, windowId,] = columns;
        const pane = {
            sessionName,
            windowName,
            windowIndex: Number(windowIndex || "0"),
            windowActive: windowActive === "1",
            paneIndex: Number(paneIndex || "0"),
            paneActive: paneActive === "1",
            currentCommand: currentCommand || "",
            cwd: currentPath || "",
            paneTitle: paneTitle || "",
            paneDead: paneDead === "1",
            paneId: paneId || "",
            sessionAttached: sessionAttached === "1",
            sessionActivity: Number(sessionActivity || "0"),
            windowId: windowId || "",
        };
        if (!sessions.has(sessionName)) {
            sessions.set(sessionName, { sessionName, attached: pane.sessionAttached, lastActivity: pane.sessionActivity, panes: [] });
        }
        const session = sessions.get(sessionName);
        session.attached = session.attached || pane.sessionAttached;
        session.lastActivity = Math.max(session.lastActivity || 0, pane.sessionActivity || 0);
        session.panes.push(pane);
    }
    return {
        ok: true,
        panes: Array.from(sessions.values()).flatMap((entry) => entry.panes),
        sessions: Array.from(sessions.values()),
        hostUser,
    };
}
function createRunner({ hostUser = exports.DEFAULT_HOST_USER, rootProcess = isRootProcess(), } = {}) {
    return (command, args = [], options = {}) => {
        const { cwd = process.cwd(), asHostUser = false, allowMissing = false } = options;
        let finalCommand = command;
        let finalArgs = Array.isArray(args) ? args : [];
        if (asHostUser && rootProcess && process.platform !== "win32") {
            finalCommand = "runuser";
            finalArgs = ["-u", hostUser, "--", command, ...finalArgs];
        }
        const result = (0, node_child_process_1.spawnSync)(finalCommand, finalArgs, {
            cwd,
            encoding: "utf8",
            stdio: "pipe",
            shell: false,
        });
        if (!allowMissing && result.error) {
            throw result.error;
        }
        return {
            ok: (result.status ?? 1) === 0,
            rc: result.status ?? 1,
            stdout: (result.stdout || "").trimEnd(),
            stderr: (result.stderr || "").trimEnd(),
            command: [finalCommand, ...finalArgs].join(" "),
        };
    };
}
function summarizeOps(input) {
    const heartbeatStatus = clipText(input.heartbeat?.status || input.latestOps?.heartbeatStatus || "unknown", 20).toLowerCase();
    const postureStatus = clipText(input.latestOps?.postureStatus || input.latestOps?.status || "unknown", 20).toLowerCase();
    const overseerStatus = clipText(input.overseer?.overallStatus || "unknown", 20).toLowerCase();
    const summary = input.overseer
        ? clipText(input.overseer.delivery?.cli?.summary || input.overseer.delivery?.discord?.summary || "", 160)
        : "No overseer run is available yet.";
    let overallStatus = "healthy";
    if (overseerStatus === "critical" || heartbeatStatus === "fail")
        overallStatus = "error";
    else if (overseerStatus === "warning" || postureStatus === "warn")
        overallStatus = "waiting";
    return {
        overallStatus,
        heartbeatStatus,
        postureStatus,
        overseerStatus,
        summary,
        ackEntries: input.ackEntries,
        latestRunId: String(input.overseer?.runId || "").trim(),
        existingOpsEnabled: Boolean(input.existingOps?.enabled),
        heartbeat: input.heartbeat,
        latestStatus: input.latestOps,
        existingState: input.existingOps,
        overseer: input.overseer,
        overseerDiscord: null,
    };
}
function loadServices(runner) {
    const services = [];
    for (const spec of exports.SERVICE_SPECS) {
        const result = runner("systemctl", ["show", spec.key, "-p", "ActiveState", "-p", "SubState", "-p", "UnitFileState"], {
            allowMissing: true,
        });
        const payload = {
            id: spec.key,
            label: spec.label,
            allowedActions: [...spec.verbs],
            activeState: "unknown",
            subState: "unknown",
            unitFileState: "unknown",
            status: "neutral",
            summary: "Service status unavailable.",
            changedAt: null,
        };
        if (result.ok) {
            for (const line of String(result.stdout || "").split(/\r?\n/)) {
                const [key, rawValue] = line.split("=", 2);
                const value = String(rawValue || "").trim();
                if (key === "ActiveState")
                    payload.activeState = value || "unknown";
                if (key === "SubState")
                    payload.subState = value || "unknown";
                if (key === "UnitFileState")
                    payload.unitFileState = value || "unknown";
            }
            if (payload.activeState === "active") {
                payload.status = "healthy";
                payload.summary = `${spec.label} is active (${payload.subState}).`;
            }
            else if (payload.activeState === "inactive" || payload.activeState === "failed") {
                payload.status = "error";
                payload.summary = `${spec.label} is ${payload.activeState}.`;
            }
            else {
                payload.status = "waiting";
                payload.summary = `${spec.label} is ${payload.activeState}.`;
            }
        }
        else {
            payload.status = "neutral";
            payload.summary = clipText(result.stderr || result.stdout || `${spec.label} is not installed.`);
        }
        services.push(payload);
    }
    return {
        services,
    };
}
function buildRooms(repoRoot, agents) {
    const rooms = new Map();
    for (const agent of agents) {
        const key = agent.room || "general";
        if (!rooms.has(key)) {
            rooms.set(key, {
                id: key,
                label: key,
                repo: agent.repo || "",
                mood: "quiet",
                sessions: [],
                summary: "",
            });
        }
        rooms.get(key).sessions.push(agent);
    }
    for (const room of rooms.values()) {
        room.sessions.sort((left, right) => left.sessionName.localeCompare(right.sessionName));
        if (room.sessions.some((entry) => entry.status === "error"))
            room.mood = "blocked";
        else if (room.sessions.some((entry) => entry.status === "waiting"))
            room.mood = "waiting";
        else if (room.sessions.some((entry) => entry.status === "working"))
            room.mood = "active";
        else
            room.mood = "quiet";
        room.summary = `${room.sessions.length} session${room.sessions.length === 1 ? "" : "s"} in ${clipText(room.label, 40)}.`;
        room.repo =
            room.repo ||
                inferRoomName(repoRoot, { room: room.label }, room.sessions.map((entry) => ({ cwd: entry.cwd })));
    }
    return Array.from(rooms.values()).sort((left, right) => left.label.localeCompare(right.label));
}
function buildAlerts(services, overseer, heartbeat) {
    const alerts = [];
    for (const service of services) {
        if (service.status === "error") {
            alerts.push({
                id: `service:${service.id}`,
                level: "critical",
                title: `${service.label} needs attention`,
                summary: service.summary,
                serviceId: service.id,
            });
        }
    }
    const signalGaps = Array.isArray(overseer?.signalGaps) ? overseer.signalGaps : [];
    for (const gap of signalGaps.slice(0, 4)) {
        alerts.push({
            id: String(gap.dedupeId || gap.id || `gap-${alerts.length + 1}`),
            level: gap.severity,
            title: clipText(gap.title || "Signal gap", 96),
            summary: clipText(gap.summary || gap.recommendation || "", 180),
        });
    }
    const heartbeatStatus = String(heartbeat?.status || "").trim().toLowerCase();
    if (heartbeatStatus === "fail") {
        alerts.push({
            id: "heartbeat",
            level: "critical",
            title: "Reliability heartbeat is red",
            summary: "The latest heartbeat artifact reports a failed state.",
        });
    }
    return alerts;
}
function buildPinnedItems(input) {
    const pinnedItems = [];
    for (const service of input.services) {
        if (service.status === "error") {
            pinnedItems.push({
                id: service.id,
                title: `${service.label} is down`,
                detail: service.summary,
                status: "pinned",
                actionHint: `Check ${service.label} status and restart if safe.`,
            });
        }
    }
    return pinnedItems;
}
function toIsoOrNull(epochSeconds) {
    if (!Number.isFinite(epochSeconds) || epochSeconds <= 0)
        return null;
    const epochMs = epochSeconds > 10_000_000_000 ? epochSeconds : epochSeconds * 1000;
    return new Date(epochMs).toISOString();
}
function collectControlTowerRawState(options = {}) {
    const repoRoot = resolveControlTowerRepoRoot(options.repoRoot);
    const rootSession = String(options.rootSession || exports.DEFAULT_ROOT_SESSION).trim() || exports.DEFAULT_ROOT_SESSION;
    const hostUser = String(options.hostUser || exports.DEFAULT_HOST_USER).trim() || exports.DEFAULT_HOST_USER;
    const theme = exports.THEMES[normalizeThemeName(options.theme)];
    const runner = options.runner || createRunner({ hostUser, rootProcess: options.rootProcess });
    (0, node_fs_1.mkdirSync)(repoPath(repoRoot, ...exports.AGENT_META_DIR), { recursive: true });
    (0, node_fs_1.mkdirSync)(repoPath(repoRoot, ...exports.AGENT_STATUS_DIR), { recursive: true });
    const tmux = collectTmuxState(runner, hostUser);
    const serviceState = loadServices(runner);
    const metadataMap = parseMetadataDirectory(repoPath(repoRoot, ...exports.AGENT_META_DIR));
    const statusMap = parseMetadataDirectory(repoPath(repoRoot, ...exports.AGENT_STATUS_DIR));
    const sessions = tmux.sessions.map((session) => {
        const metadata = metadataMap.get(session.sessionName) || {};
        const statusOverride = statusMap.get(session.sessionName) || {};
        const tool = detectTool(session.sessionName, metadata, session.panes);
        const room = inferRoomName(repoRoot, metadata, session.panes);
        const cwd = String(metadata.cwd || session.panes.find((pane) => pane.cwd)?.cwd || "").trim();
        const status = inferAgentStatus(session.sessionName, metadata, statusOverride, session.panes, rootSession);
        const summary = clipText(metadata.summary ||
            statusOverride.summary ||
            `${tool.toUpperCase()} session with ${session.panes.length} pane${session.panes.length === 1 ? "" : "s"}.`, 120);
        const objective = clipText(metadata.objective || metadata.summary || statusOverride.objective || summary, 180);
        const lastActivityEpochMs = Number(session.lastActivity || 0) > 0 ? Number(session.lastActivity || 0) * 1000 : 0;
        return {
            sessionName: session.sessionName,
            rootSession: session.sessionName === rootSession,
            attached: Boolean(session.attached),
            lastActivityAt: toIsoOrNull(session.lastActivity),
            lastActivityEpochMs,
            paneCount: session.panes.length,
            windowCount: new Set(session.panes.map((pane) => `${pane.windowId}:${pane.windowName}`)).size,
            cwd,
            repo: relativeOrSelf(repoRoot, cwd),
            tool,
            room,
            status,
            statusLabel: humanStateLabel(status),
            objective,
            summary,
            metadata,
            panes: session.panes.map((pane) => ({
                windowName: pane.windowName,
                currentCommand: pane.currentCommand,
                cwd: pane.cwd,
                paneActive: pane.paneActive,
            })),
        };
    });
    const agents = sessions.filter((session) => !session.rootSession);
    const rooms = buildRooms(repoRoot, agents);
    const heartbeat = readJson(repoPath(repoRoot, ...exports.HEARTBEAT_PATH), null);
    const existingOps = readJson(repoPath(repoRoot, ...exports.EXISTING_OPS_STATE_PATH), null);
    const latestOps = readJson(repoPath(repoRoot, ...exports.EXISTING_OPS_LATEST_PATH), null);
    const overseerFromFile = readJson(repoPath(repoRoot, ...exports.OVERSEER_PATH), null);
    const overseer = options.overseerRun ?? overseerFromFile;
    const overseerDiscord = readJson(repoPath(repoRoot, ...exports.OVERSEER_DISCORD_PATH), null);
    const ackEntries = readJsonLines(repoPath(repoRoot, ...exports.ACK_LOG_PATH), 12);
    const pinnedItems = buildPinnedItems({
        services: serviceState.services,
    });
    const ops = summarizeOps({ heartbeat, existingOps, latestOps, overseer, ackEntries });
    ops.overseerDiscord = overseerDiscord;
    const alerts = buildAlerts(serviceState.services, overseer, heartbeat);
    return {
        generatedAt: new Date().toISOString(),
        repoRoot,
        rootSession,
        hostUser,
        theme,
        services: serviceState.services,
        ops,
        sessions,
        agents,
        rooms,
        alerts,
        pinnedItems,
        counts: {
            needsAttention: agents.filter((agent) => agent.status === "waiting" || agent.status === "error").length +
                alerts.filter((alert) => alert.level === "critical").length,
            working: agents.filter((agent) => agent.status === "working").length,
            waiting: agents.filter((agent) => agent.status === "waiting" || agent.status === "idle" || agent.status === "parked").length,
            blocked: agents.filter((agent) => agent.status === "error").length +
                serviceState.services.filter((service) => service.status === "error").length,
            escalated: pinnedItems.length,
        },
        sources: {
            operatorStatePath: relativeOrSelf(repoRoot, repoPath(repoRoot, ...exports.STATUS_PATH)),
            heartbeatPath: relativeOrSelf(repoRoot, repoPath(repoRoot, ...exports.HEARTBEAT_PATH)),
            overseerPath: relativeOrSelf(repoRoot, repoPath(repoRoot, ...exports.OVERSEER_PATH)),
            ackLogPath: relativeOrSelf(repoRoot, repoPath(repoRoot, ...exports.ACK_LOG_PATH)),
        },
    };
}
function writeControlTowerState(state, repoRoot = resolveControlTowerRepoRoot()) {
    const targetPath = repoPath(repoRoot, ...exports.STATUS_PATH);
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(targetPath), { recursive: true });
    (0, node_fs_1.writeFileSync)(targetPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    return targetPath;
}
