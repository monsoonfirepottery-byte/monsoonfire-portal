import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { OverseerRunRecord } from "../stores/interfaces";
import type {
  ControlTowerAgentStatus,
  ControlTowerHealth,
  ControlTowerPinnedItem,
  ControlTowerRawAlert,
  ControlTowerRawRoom,
  ControlTowerRawService,
  ControlTowerRawState,
  ControlTowerSession,
  ControlTowerTheme,
} from "./types";

export const DEFAULT_ROOT_SESSION = process.env.STUDIO_BRAIN_TMUX_SESSION_NAME || "studiobrain";
export const DEFAULT_HOST_USER =
  process.env.STUDIO_BRAIN_DEPLOY_USER || process.env.USER || process.env.LOGNAME || "wuff";
export const DEFAULT_THEME_NAME = "desert-night";
export const THEMES: Record<string, ControlTowerTheme> = {
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

export const STATUS_PATH = ["output", "ops-cockpit", "operator-state.json"] as const;
export const AGENT_META_DIR = ["output", "ops-cockpit", "agents"] as const;
export const AGENT_STATUS_DIR = ["output", "ops-cockpit", "agent-status"] as const;
export const EXISTING_OPS_STATE_PATH = ["output", "ops-cockpit", "state.json"] as const;
export const EXISTING_OPS_LATEST_PATH = ["output", "ops-cockpit", "latest-status.json"] as const;
export const HEARTBEAT_PATH = ["output", "stability", "heartbeat-summary.json"] as const;
export const OVERSEER_PATH = ["output", "overseer", "latest.json"] as const;
export const OVERSEER_DISCORD_PATH = ["output", "overseer", "discord", "latest.json"] as const;
export const ACK_LOG_PATH = ["output", "overseer", "discord", "acks.jsonl"] as const;
export const SERVICE_SPECS = [
  { key: "studio-brain-discord-relay", label: "Discord Relay", verbs: ["status", "restart", "start", "stop"] },
] as const;

export type RunnerResult = {
  ok: boolean;
  rc: number;
  stdout: string;
  stderr: string;
  command: string;
};

export type Runner = (
  command: string,
  args?: string[],
  options?: { cwd?: string; asHostUser?: boolean; allowMissing?: boolean }
) => RunnerResult;

type TmuxPaneRecord = {
  sessionName: string;
  windowName: string;
  windowIndex: number;
  windowActive: boolean;
  paneIndex: number;
  paneActive: boolean;
  currentCommand: string;
  cwd: string;
  paneTitle: string;
  paneDead: boolean;
  paneId: string;
  sessionAttached: boolean;
  sessionActivity: number;
  windowId: string;
};

type CollectOptions = {
  repoRoot?: string;
  rootSession?: string;
  hostUser?: string;
  runner?: Runner;
  theme?: string;
  rootProcess?: boolean;
  overseerRun?: OverseerRunRecord | null;
};

export function normalizeThemeName(raw: string | undefined): keyof typeof THEMES {
  const key = String(raw || "").trim().toLowerCase();
  return (key in THEMES ? key : DEFAULT_THEME_NAME) as keyof typeof THEMES;
}

export function resolveControlTowerRepoRoot(raw?: string): string {
  if (raw) {
    return resolve(raw);
  }
  const cwd = resolve(process.cwd());
  if (existsSync(resolve(cwd, "studio-brain")) && existsSync(resolve(cwd, "web"))) {
    return cwd;
  }
  if (basename(cwd) === "studio-brain" && existsSync(resolve(cwd, "..", "web"))) {
    return resolve(cwd, "..");
  }
  return cwd;
}

export function repoPath(repoRoot: string, ...parts: readonly string[]): string {
  return resolve(repoRoot, ...parts);
}

function isRootProcess(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

export function readJson<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function readJsonLines<T>(filePath: string, limit = 20): T[] {
  if (!existsSync(filePath)) return [];
  try {
    const rows = readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-limit);
    return rows
      .map((line) => {
        try {
          return JSON.parse(line) as T;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is T => entry !== null);
  } catch {
    return [];
  }
}

function parseTmuxLines(stdout: string): string[][] {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\u001f|\\037|\\x1f/g));
}

export function clipText(value: unknown, max = 140): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...` : text;
}

export function relativeOrSelf(repoRoot: string, value: unknown): string {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const relativeValue = relative(repoRoot, text);
    return relativeValue && !relativeValue.startsWith("..") ? relativeValue : text;
  } catch {
    return text;
  }
}

function parseMetadataDirectory(dirPath: string): Map<string, Record<string, unknown>> {
  if (!existsSync(dirPath)) return new Map();
  const output = new Map<string, Record<string, unknown>>();
  for (const entry of readdirSync(dirPath)) {
    if (!entry.endsWith(".json")) continue;
    const payload = readJson<Record<string, unknown> | null>(resolve(dirPath, entry), null);
    if (!payload || typeof payload !== "object") continue;
    const sessionName = String(payload.sessionName || entry.replace(/\.json$/i, "")).trim();
    if (sessionName) output.set(sessionName, payload);
  }
  return output;
}

function detectTool(sessionName: string, metadata: Record<string, unknown> = {}, panes: TmuxPaneRecord[] = []): string {
  const explicit = String(metadata.tool || "").trim().toLowerCase();
  if (explicit) return explicit;
  const sessionLower = String(sessionName || "").toLowerCase();
  if (sessionLower.includes("codex")) return "codex";
  if (sessionLower.includes("claude")) return "claude";
  if (sessionLower.includes("agent")) return "agent";
  const commands = panes.map((pane) => String(pane.currentCommand || "").toLowerCase());
  if (commands.some((value) => value.includes("codex"))) return "codex";
  if (commands.some((value) => value.includes("claude"))) return "claude";
  return "custom";
}

function inferRoomName(repoRoot: string, metadata: Record<string, unknown> = {}, panes: Array<{ cwd?: string }> = []): string {
  const room = String(metadata.room || metadata.group || "").trim();
  if (room) return room;
  const candidates = [metadata.cwd, ...panes.map((pane) => pane.cwd)];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (!value) continue;
    const relativePath = relativeOrSelf(repoRoot, value);
    if (relativePath && !relativePath.startsWith("/") && !relativePath.startsWith("\\")) {
      const first = relativePath.split(/[\\/]/).filter(Boolean)[0];
      if (first) return first;
    }
    const base = basename(value);
    if (base) return base;
  }
  return "general";
}

function humanStateLabel(state: ControlTowerAgentStatus | "pinned" | "healthy" | "neutral" | "waiting"): string {
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

function inferAgentStatus(
  sessionName: string,
  metadata: Record<string, unknown>,
  statusOverride: Record<string, unknown>,
  panes: TmuxPaneRecord[],
  rootSession: string,
): ControlTowerAgentStatus {
  if (sessionName === rootSession) return "working";
  const explicit = String(statusOverride.state || metadata.state || "").trim().toLowerCase();
  if (explicit === "working" || explicit === "waiting" || explicit === "idle" || explicit === "parked" || explicit === "error") {
    return explicit;
  }
  if (panes.some((pane) => pane.paneDead)) return "error";
  if (panes.some((pane) => /codex|claude|python|node/i.test(String(pane.currentCommand || "")))) {
    return panes.some((pane) => pane.paneActive) ? "working" : "waiting";
  }
  if (panes.some((pane) => /bash|zsh|fish|sh|pwsh|powershell/i.test(String(pane.currentCommand || "")))) {
    return panes.some((pane) => pane.paneActive) ? "waiting" : "idle";
  }
  return "idle";
}

function collectTmuxState(runner: Runner, hostUser: string) {
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
    return { ok: false, panes: [] as TmuxPaneRecord[], sessions: [] as Array<{ sessionName: string; attached: boolean; lastActivity: number; panes: TmuxPaneRecord[] }>, hostUser };
  }
  const sessions = new Map<string, { sessionName: string; attached: boolean; lastActivity: number; panes: TmuxPaneRecord[] }>();
  for (const columns of parseTmuxLines(result.stdout)) {
    const [
      sessionName,
      windowName,
      windowIndex,
      windowActive,
      paneIndex,
      paneActive,
      currentCommand,
      currentPath,
      paneTitle,
      paneDead,
      paneId,
      sessionAttached,
      sessionActivity,
      windowId,
    ] = columns;
    const pane: TmuxPaneRecord = {
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
    const session = sessions.get(sessionName)!;
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

export function createRunner({
  hostUser = DEFAULT_HOST_USER,
  rootProcess = isRootProcess(),
}: {
  hostUser?: string;
  rootProcess?: boolean;
} = {}): Runner {
  return (command, args = [], options = {}) => {
    const { cwd = process.cwd(), asHostUser = false, allowMissing = false } = options;
    let finalCommand = command;
    let finalArgs = Array.isArray(args) ? args : [];
    if (asHostUser && rootProcess && process.platform !== "win32") {
      finalCommand = "runuser";
      finalArgs = ["-u", hostUser, "--", command, ...finalArgs];
    }
    const result = spawnSync(finalCommand, finalArgs, {
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

function summarizeOps(input: {
  heartbeat: Record<string, unknown> | null;
  existingOps: Record<string, unknown> | null;
  latestOps: Record<string, unknown> | null;
  overseer: OverseerRunRecord | null;
  ackEntries: Array<Record<string, unknown>>;
}) {
  const heartbeatStatus = clipText(input.heartbeat?.status || input.latestOps?.heartbeatStatus || "unknown", 20).toLowerCase();
  const postureStatus = clipText(input.latestOps?.postureStatus || input.latestOps?.status || "unknown", 20).toLowerCase();
  const overseerStatus = clipText(input.overseer?.overallStatus || "unknown", 20).toLowerCase();
  const summary = input.overseer
    ? clipText(input.overseer.delivery?.cli?.summary || input.overseer.delivery?.discord?.summary || "", 160)
    : "No overseer run is available yet.";
  let overallStatus: ControlTowerHealth = "healthy";
  if (overseerStatus === "critical" || heartbeatStatus === "fail") overallStatus = "error";
  else if (overseerStatus === "warning" || postureStatus === "warn") overallStatus = "waiting";
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
    overseerDiscord: null as Record<string, unknown> | null,
  };
}

function loadServices(runner: Runner): {
  services: ControlTowerRawService[];
} {
  const services: ControlTowerRawService[] = [];
  for (const spec of SERVICE_SPECS) {
    const result = runner("systemctl", ["show", spec.key, "-p", "ActiveState", "-p", "SubState", "-p", "UnitFileState"], {
      allowMissing: true,
    });
    const payload: ControlTowerRawService = {
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
        if (key === "ActiveState") payload.activeState = value || "unknown";
        if (key === "SubState") payload.subState = value || "unknown";
        if (key === "UnitFileState") payload.unitFileState = value || "unknown";
      }
      if (payload.activeState === "active") {
        payload.status = "healthy";
        payload.summary = `${spec.label} is active (${payload.subState}).`;
      } else if (payload.activeState === "inactive" || payload.activeState === "failed") {
        payload.status = "error";
        payload.summary = `${spec.label} is ${payload.activeState}.`;
      } else {
        payload.status = "waiting";
        payload.summary = `${spec.label} is ${payload.activeState}.`;
      }
    } else {
      payload.status = "neutral";
      payload.summary = clipText(result.stderr || result.stdout || `${spec.label} is not installed.`);
    }
    services.push(payload);
  }

  return {
    services,
  };
}

function buildRooms(repoRoot: string, agents: ControlTowerSession[]): ControlTowerRawRoom[] {
  const rooms = new Map<string, ControlTowerRawRoom>();
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
    rooms.get(key)!.sessions.push(agent);
  }
  for (const room of rooms.values()) {
    room.sessions.sort((left, right) => left.sessionName.localeCompare(right.sessionName));
    if (room.sessions.some((entry) => entry.status === "error")) room.mood = "blocked";
    else if (room.sessions.some((entry) => entry.status === "waiting")) room.mood = "waiting";
    else if (room.sessions.some((entry) => entry.status === "working")) room.mood = "active";
    else room.mood = "quiet";
    room.summary = `${room.sessions.length} session${room.sessions.length === 1 ? "" : "s"} in ${clipText(room.label, 40)}.`;
    room.repo =
      room.repo ||
      inferRoomName(repoRoot, { room: room.label }, room.sessions.map((entry) => ({ cwd: entry.cwd })));
  }
  return Array.from(rooms.values()).sort((left, right) => left.label.localeCompare(right.label));
}

function buildAlerts(
  services: ControlTowerRawService[],
  overseer: OverseerRunRecord | null,
  heartbeat: Record<string, unknown> | null,
): ControlTowerRawAlert[] {
  const alerts: ControlTowerRawAlert[] = [];
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

function buildPinnedItems(input: {
  services: ControlTowerRawService[];
}): ControlTowerPinnedItem[] {
  const pinnedItems: ControlTowerPinnedItem[] = [];
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

function toIsoOrNull(epochSeconds: number): string | null {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return null;
  const epochMs = epochSeconds > 10_000_000_000 ? epochSeconds : epochSeconds * 1000;
  return new Date(epochMs).toISOString();
}

export function collectControlTowerRawState(options: CollectOptions = {}): ControlTowerRawState {
  const repoRoot = resolveControlTowerRepoRoot(options.repoRoot);
  const rootSession = String(options.rootSession || DEFAULT_ROOT_SESSION).trim() || DEFAULT_ROOT_SESSION;
  const hostUser = String(options.hostUser || DEFAULT_HOST_USER).trim() || DEFAULT_HOST_USER;
  const theme = THEMES[normalizeThemeName(options.theme)];
  const runner = options.runner || createRunner({ hostUser, rootProcess: options.rootProcess });

  mkdirSync(repoPath(repoRoot, ...AGENT_META_DIR), { recursive: true });
  mkdirSync(repoPath(repoRoot, ...AGENT_STATUS_DIR), { recursive: true });

  const tmux = collectTmuxState(runner, hostUser);
  const serviceState = loadServices(runner);
  const metadataMap = parseMetadataDirectory(repoPath(repoRoot, ...AGENT_META_DIR));
  const statusMap = parseMetadataDirectory(repoPath(repoRoot, ...AGENT_STATUS_DIR));

  const sessions: ControlTowerSession[] = tmux.sessions.map((session) => {
    const metadata = metadataMap.get(session.sessionName) || {};
    const statusOverride = statusMap.get(session.sessionName) || {};
    const tool = detectTool(session.sessionName, metadata, session.panes);
    const room = inferRoomName(repoRoot, metadata, session.panes);
    const cwd = String(metadata.cwd || session.panes.find((pane) => pane.cwd)?.cwd || "").trim();
    const status = inferAgentStatus(session.sessionName, metadata, statusOverride, session.panes, rootSession);
    const summary = clipText(
      metadata.summary ||
        statusOverride.summary ||
        `${tool.toUpperCase()} session with ${session.panes.length} pane${session.panes.length === 1 ? "" : "s"}.`,
      120,
    );
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
  const heartbeat = readJson<Record<string, unknown> | null>(repoPath(repoRoot, ...HEARTBEAT_PATH), null);
  const existingOps = readJson<Record<string, unknown> | null>(repoPath(repoRoot, ...EXISTING_OPS_STATE_PATH), null);
  const latestOps = readJson<Record<string, unknown> | null>(repoPath(repoRoot, ...EXISTING_OPS_LATEST_PATH), null);
  const overseerFromFile = readJson<OverseerRunRecord | null>(repoPath(repoRoot, ...OVERSEER_PATH), null);
  const overseer = options.overseerRun ?? overseerFromFile;
  const overseerDiscord = readJson<Record<string, unknown> | null>(repoPath(repoRoot, ...OVERSEER_DISCORD_PATH), null);
  const ackEntries = readJsonLines<Record<string, unknown>>(repoPath(repoRoot, ...ACK_LOG_PATH), 12);
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
      needsAttention:
        agents.filter((agent) => agent.status === "waiting" || agent.status === "error").length +
        alerts.filter((alert) => alert.level === "critical").length,
      working: agents.filter((agent) => agent.status === "working").length,
      waiting: agents.filter((agent) => agent.status === "waiting" || agent.status === "idle" || agent.status === "parked").length,
      blocked:
        agents.filter((agent) => agent.status === "error").length +
        serviceState.services.filter((service) => service.status === "error").length,
      escalated: pinnedItems.length,
    },
    sources: {
      operatorStatePath: relativeOrSelf(repoRoot, repoPath(repoRoot, ...STATUS_PATH)),
      heartbeatPath: relativeOrSelf(repoRoot, repoPath(repoRoot, ...HEARTBEAT_PATH)),
      overseerPath: relativeOrSelf(repoRoot, repoPath(repoRoot, ...OVERSEER_PATH)),
      ackLogPath: relativeOrSelf(repoRoot, repoPath(repoRoot, ...ACK_LOG_PATH)),
    },
  };
}

export function writeControlTowerState(state: ControlTowerRawState, repoRoot = resolveControlTowerRepoRoot()): string {
  const targetPath = repoPath(repoRoot, ...STATUS_PATH);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return targetPath;
}
