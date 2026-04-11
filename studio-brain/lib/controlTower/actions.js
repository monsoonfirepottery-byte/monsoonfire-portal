"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.spawnControlTowerSession = spawnControlTowerSession;
exports.sendControlTowerInstruction = sendControlTowerInstruction;
exports.runControlTowerServiceAction = runControlTowerServiceAction;
exports.appendControlTowerOverseerAck = appendControlTowerOverseerAck;
exports.buildControlTowerAttachCommand = buildControlTowerAttachCommand;
exports.resolvePrimarySessionForRoom = resolvePrimarySessionForRoom;
exports.buildRootAttachCommand = buildRootAttachCommand;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const collect_1 = require("./collect");
const DEFAULT_SSH_HOST_ALIAS = process.env.STUDIO_BRAIN_SSH_HOST_ALIAS || "studiobrain";
function createActionRunner(options) {
    return options.runner || (0, collect_1.createRunner)({ hostUser: options.hostUser || collect_1.DEFAULT_HOST_USER, rootProcess: options.rootProcess });
}
function readOverseerRun(repoRoot) {
    return (0, collect_1.readJson)((0, collect_1.repoPath)(repoRoot, "output", "overseer", "latest.json"), null);
}
function readFirstPaneId(runner, sessionName, hostUser) {
    const paneLookup = runner("tmux", ["list-panes", "-t", sessionName, "-F", "#{pane_id}"], {
        asHostUser: true,
        allowMissing: true,
    });
    if (!paneLookup.ok)
        return null;
    const paneTarget = String(paneLookup.stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
    return paneTarget || null;
}
function sessionExists(runner, sessionName, hostUser) {
    const result = runner("tmux", ["has-session", "-t", sessionName], {
        asHostUser: true,
        allowMissing: true,
    });
    return result.ok;
}
function spawnControlTowerSession(args, options = {}) {
    const repoRoot = (0, collect_1.resolveControlTowerRepoRoot)(options.repoRoot);
    const hostUser = String(options.hostUser || collect_1.DEFAULT_HOST_USER).trim() || collect_1.DEFAULT_HOST_USER;
    const runner = createActionRunner({ ...options, hostUser });
    const sessionName = String(args.name || "").trim();
    if (!sessionName)
        return { ok: false, message: "session name is required" };
    if (sessionExists(runner, sessionName, hostUser)) {
        return { ok: false, message: `session ${sessionName} already exists` };
    }
    const cwd = (0, node_path_1.resolve)(String(args.cwd || repoRoot));
    const command = String(args.command || "bash").trim() || "bash";
    const create = runner("tmux", ["new-session", "-d", "-s", sessionName, "-c", cwd, command], {
        asHostUser: true,
        allowMissing: true,
    });
    if (!create.ok) {
        return { ok: false, message: create.stderr || create.stdout || `failed to create ${sessionName}` };
    }
    const metadataPath = (0, collect_1.repoPath)(repoRoot, ...collect_1.AGENT_META_DIR, `${sessionName}.json`);
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(metadataPath), { recursive: true });
    const metadata = {
        sessionName,
        cwd,
        command,
        tool: String(args.tool || "custom").trim() || "custom",
        group: String(args.group || "").trim(),
        room: String(args.room || args.group || "").trim(),
        summary: (0, collect_1.clipText)(String(args.summary || `${sessionName} session`).trim(), 100),
        objective: (0, collect_1.clipText)(String(args.objective || args.summary || `${sessionName} session`).trim(), 160),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    (0, node_fs_1.writeFileSync)(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    return {
        ok: true,
        sessionName,
        cwd,
        command,
        metadataPath: (0, collect_1.relativeOrSelf)(repoRoot, metadataPath),
    };
}
function sendControlTowerInstruction(args, options = {}) {
    const hostUser = String(options.hostUser || collect_1.DEFAULT_HOST_USER).trim() || collect_1.DEFAULT_HOST_USER;
    const runner = createActionRunner({ ...options, hostUser });
    const sessionName = String(args.session || "").trim();
    const text = String(args.text || "").trim();
    const pressEnter = args.enter !== false;
    if (!sessionName || !text)
        return { ok: false, message: "session and text are required" };
    const paneTarget = readFirstPaneId(runner, sessionName, hostUser);
    if (!paneTarget) {
        return { ok: false, message: `can't find pane: ${sessionName}` };
    }
    const result = runner("tmux", ["send-keys", "-t", paneTarget, "-l", text], {
        asHostUser: true,
        allowMissing: true,
    });
    if (!result.ok) {
        return { ok: false, message: result.stderr || result.stdout || `failed to send to ${sessionName}` };
    }
    if (pressEnter) {
        const enterResult = runner("tmux", ["send-keys", "-t", paneTarget, "Enter"], {
            asHostUser: true,
            allowMissing: true,
        });
        if (!enterResult.ok) {
            return { ok: false, message: enterResult.stderr || enterResult.stdout || `failed to submit ${sessionName}` };
        }
    }
    const repoRoot = (0, collect_1.resolveControlTowerRepoRoot)(options.repoRoot);
    const metadataPath = (0, collect_1.repoPath)(repoRoot, ...collect_1.AGENT_META_DIR, `${sessionName}.json`);
    if ((0, node_fs_1.existsSync)(metadataPath)) {
        const metadata = (0, collect_1.readJson)(metadataPath, {});
        (0, node_fs_1.writeFileSync)(metadataPath, `${JSON.stringify({ ...metadata, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
    }
    return { ok: true, sessionName, text, pressEnter };
}
function runControlTowerServiceAction(args, options = {}) {
    const runner = createActionRunner(options);
    const service = String(args.service || "").trim();
    const action = String(args.action || "status").trim();
    const spec = collect_1.SERVICE_SPECS.find((entry) => entry.key === service);
    if (!spec)
        return { ok: false, message: `service ${service} is not allowlisted` };
    if (!spec.verbs.includes(action))
        return { ok: false, message: `${action} is not allowed for ${service}` };
    const commandArgs = action === "status" ? ["show", service, "-p", "ActiveState", "-p", "SubState", "-p", "UnitFileState"] : [action, service];
    const result = runner("systemctl", commandArgs, { allowMissing: true });
    return {
        ok: result.ok,
        service,
        action,
        stdout: result.stdout,
        stderr: result.stderr,
        rc: result.rc,
        message: result.ok ? `${service} ${action} completed` : result.stderr || result.stdout || `${service} ${action} failed`,
    };
}
function appendControlTowerOverseerAck(args, options = {}) {
    const repoRoot = (0, collect_1.resolveControlTowerRepoRoot)(options.repoRoot);
    const overseer = readOverseerRun(repoRoot);
    const note = String(args.note || "").trim();
    if (!note)
        return { ok: false, message: "note is required" };
    const requestedRunId = String(args.runId || "").trim();
    const runId = requestedRunId || String(overseer?.runId || "latest-run-unavailable").trim();
    const entry = {
        recordedAt: new Date().toISOString(),
        runId,
        overallStatus: String(overseer?.overallStatus || "").trim() || null,
        note,
        source: "control-tower-api",
        actor: String(args.actor || options.hostUser || collect_1.DEFAULT_HOST_USER),
    };
    const ackPath = (0, collect_1.repoPath)(repoRoot, ...collect_1.ACK_LOG_PATH);
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(ackPath), { recursive: true });
    (0, node_fs_1.appendFileSync)(ackPath, `${JSON.stringify(entry)}\n`, "utf8");
    return {
        ok: true,
        runId,
        ackPath: (0, collect_1.relativeOrSelf)(repoRoot, ackPath),
        entry,
    };
}
function buildControlTowerAttachCommand(args, options = {}) {
    const sessionName = String(args.sessionName || "").trim();
    if (!sessionName) {
        return {
            ok: false,
            message: "sessionName is required",
            sessionName: "",
            remoteCommand: "",
            sshCommand: "",
        };
    }
    const sshHostAlias = String(options.sshHostAlias || DEFAULT_SSH_HOST_ALIAS).trim() || DEFAULT_SSH_HOST_ALIAS;
    const remoteCommand = `tmux attach -t ${sessionName}`;
    return {
        ok: true,
        sessionName,
        remoteCommand,
        sshCommand: `ssh -t ${sshHostAlias} "${remoteCommand}"`,
    };
}
function resolvePrimarySessionForRoom(rawState, roomId) {
    const room = rawState.rooms.find((entry) => entry.id === roomId);
    return room?.sessions[0]?.sessionName ?? null;
}
function buildRootAttachCommand(options = {}) {
    return buildControlTowerAttachCommand({ sessionName: String(options.hostUser ? collect_1.DEFAULT_ROOT_SESSION : collect_1.DEFAULT_ROOT_SESSION) }, options);
}
