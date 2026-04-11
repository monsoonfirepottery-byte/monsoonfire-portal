import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ACK_LOG_PATH,
  AGENT_META_DIR,
  DEFAULT_HOST_USER,
  DEFAULT_ROOT_SESSION,
  SERVICE_SPECS,
  clipText,
  createRunner,
  readJson,
  relativeOrSelf,
  repoPath,
  resolveControlTowerRepoRoot,
  type Runner,
} from "./collect";
import type { ControlTowerActionResult, ControlTowerRawState, ControlTowerRoomDetail } from "./types";

type ActionOptions = {
  repoRoot?: string;
  hostUser?: string;
  rootProcess?: boolean;
  runner?: Runner;
  sshHostAlias?: string;
};

type SpawnRoomInput = {
  name: string;
  cwd?: string;
  command?: string;
  tool?: string;
  group?: string;
  room?: string;
  summary?: string;
  objective?: string;
};

type SendRoomInstructionInput = {
  session: string;
  text: string;
  enter?: boolean;
};

type ServiceActionInput = {
  service: string;
  action: string;
};

type AppendAckInput = {
  note: string;
  runId?: string;
  actor?: string;
};

type AttachTargetInput = {
  sessionName: string;
};

const DEFAULT_SSH_HOST_ALIAS = process.env.STUDIO_BRAIN_SSH_HOST_ALIAS || "studiobrain";

function createActionRunner(options: ActionOptions): Runner {
  return options.runner || createRunner({ hostUser: options.hostUser || DEFAULT_HOST_USER, rootProcess: options.rootProcess });
}

function readOverseerRun(repoRoot: string): Record<string, unknown> | null {
  return readJson<Record<string, unknown> | null>(repoPath(repoRoot, "output", "overseer", "latest.json"), null);
}

function readFirstPaneId(runner: Runner, sessionName: string, hostUser: string): string | null {
  const paneLookup = runner("tmux", ["list-panes", "-t", sessionName, "-F", "#{pane_id}"], {
    asHostUser: true,
    allowMissing: true,
  });
  if (!paneLookup.ok) return null;
  const paneTarget = String(paneLookup.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return paneTarget || null;
}

function sessionExists(runner: Runner, sessionName: string, hostUser: string): boolean {
  const result = runner("tmux", ["has-session", "-t", sessionName], {
    asHostUser: true,
    allowMissing: true,
  });
  return result.ok;
}

export function spawnControlTowerSession(args: SpawnRoomInput, options: ActionOptions = {}): ControlTowerActionResult {
  const repoRoot = resolveControlTowerRepoRoot(options.repoRoot);
  const hostUser = String(options.hostUser || DEFAULT_HOST_USER).trim() || DEFAULT_HOST_USER;
  const runner = createActionRunner({ ...options, hostUser });
  const sessionName = String(args.name || "").trim();
  if (!sessionName) return { ok: false, message: "session name is required" };

  if (sessionExists(runner, sessionName, hostUser)) {
    return { ok: false, message: `session ${sessionName} already exists` };
  }

  const cwd = resolve(String(args.cwd || repoRoot));
  const command = String(args.command || "bash").trim() || "bash";
  const create = runner("tmux", ["new-session", "-d", "-s", sessionName, "-c", cwd, command], {
    asHostUser: true,
    allowMissing: true,
  });
  if (!create.ok) {
    return { ok: false, message: create.stderr || create.stdout || `failed to create ${sessionName}` };
  }

  const metadataPath = repoPath(repoRoot, ...AGENT_META_DIR, `${sessionName}.json`);
  mkdirSync(dirname(metadataPath), { recursive: true });
  const metadata = {
    sessionName,
    cwd,
    command,
    tool: String(args.tool || "custom").trim() || "custom",
    group: String(args.group || "").trim(),
    room: String(args.room || args.group || "").trim(),
    summary: clipText(String(args.summary || `${sessionName} session`).trim(), 100),
    objective: clipText(String(args.objective || args.summary || `${sessionName} session`).trim(), 160),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return {
    ok: true,
    sessionName,
    cwd,
    command,
    metadataPath: relativeOrSelf(repoRoot, metadataPath),
  };
}

export function sendControlTowerInstruction(args: SendRoomInstructionInput, options: ActionOptions = {}): ControlTowerActionResult {
  const hostUser = String(options.hostUser || DEFAULT_HOST_USER).trim() || DEFAULT_HOST_USER;
  const runner = createActionRunner({ ...options, hostUser });
  const sessionName = String(args.session || "").trim();
  const text = String(args.text || "").trim();
  const pressEnter = args.enter !== false;
  if (!sessionName || !text) return { ok: false, message: "session and text are required" };

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

  const repoRoot = resolveControlTowerRepoRoot(options.repoRoot);
  const metadataPath = repoPath(repoRoot, ...AGENT_META_DIR, `${sessionName}.json`);
  if (existsSync(metadataPath)) {
    const metadata = readJson<Record<string, unknown>>(metadataPath, {});
    writeFileSync(
      metadataPath,
      `${JSON.stringify({ ...metadata, updatedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
  }

  return { ok: true, sessionName, text, pressEnter };
}

export function runControlTowerServiceAction(args: ServiceActionInput, options: ActionOptions = {}): ControlTowerActionResult {
  const runner = createActionRunner(options);
  const service = String(args.service || "").trim();
  const action = String(args.action || "status").trim();
  const spec = SERVICE_SPECS.find((entry) => entry.key === service);
  if (!spec) return { ok: false, message: `service ${service} is not allowlisted` };
  if (!spec.verbs.includes(action as never)) return { ok: false, message: `${action} is not allowed for ${service}` };

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

export function appendControlTowerOverseerAck(args: AppendAckInput, options: ActionOptions = {}): ControlTowerActionResult {
  const repoRoot = resolveControlTowerRepoRoot(options.repoRoot);
  const overseer = readOverseerRun(repoRoot);
  const note = String(args.note || "").trim();
  if (!note) return { ok: false, message: "note is required" };
  const requestedRunId = String(args.runId || "").trim();
  const runId = requestedRunId || String(overseer?.runId || "latest-run-unavailable").trim();
  const entry = {
    recordedAt: new Date().toISOString(),
    runId,
    overallStatus: String(overseer?.overallStatus || "").trim() || null,
    note,
    source: "control-tower-api",
    actor: String(args.actor || options.hostUser || DEFAULT_HOST_USER),
  };
  const ackPath = repoPath(repoRoot, ...ACK_LOG_PATH);
  mkdirSync(dirname(ackPath), { recursive: true });
  appendFileSync(ackPath, `${JSON.stringify(entry)}\n`, "utf8");
  return {
    ok: true,
    runId,
    ackPath: relativeOrSelf(repoRoot, ackPath),
    entry,
  };
}

export function buildControlTowerAttachCommand(
  args: AttachTargetInput,
  options: ActionOptions = {},
): ControlTowerActionResult & NonNullable<ControlTowerRoomDetail["attach"]> {
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

export function resolvePrimarySessionForRoom(rawState: ControlTowerRawState, roomId: string): string | null {
  const room = rawState.rooms.find((entry) => entry.id === roomId);
  return room?.sessions[0]?.sessionName ?? null;
}

export function buildRootAttachCommand(options: ActionOptions = {}): ControlTowerActionResult {
  return buildControlTowerAttachCommand(
    { sessionName: String(options.hostUser ? DEFAULT_ROOT_SESSION : DEFAULT_ROOT_SESSION) },
    options,
  );
}
