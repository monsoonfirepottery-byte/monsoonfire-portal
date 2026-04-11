#!/usr/bin/env node

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

function loadModule(modulePath) {
  try {
    return require(modulePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Studio Brain Control Tower runtime is not built yet (${modulePath}). Run "npm --prefix studio-brain run build" and retry. ${message}`,
    );
  }
}

const collectLib = loadModule(resolve(REPO_ROOT, "studio-brain", "lib", "controlTower", "collect.js"));
const deriveLib = loadModule(resolve(REPO_ROOT, "studio-brain", "lib", "controlTower", "derive.js"));
const actionsLib = loadModule(resolve(REPO_ROOT, "studio-brain", "lib", "controlTower", "actions.js"));

export const DEFAULT_ROOT_SESSION = collectLib.DEFAULT_ROOT_SESSION;
export const DEFAULT_HOST_USER = collectLib.DEFAULT_HOST_USER;
export const DEFAULT_THEME_NAME = collectLib.DEFAULT_THEME_NAME;
export const THEMES = collectLib.THEMES;

function isRootProcess() {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

function parseBoolean(value, fallback = true) {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseCli(argv) {
  const command = String(argv[0] || "state").trim().toLowerCase();
  const flags = {};
  for (let index = 1; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current) continue;
    if (current === "--json") {
      flags.json = true;
      continue;
    }
    if (!current.startsWith("--")) {
      if (!flags._) flags._ = [];
      flags._.push(current);
      continue;
    }
    const trimmed = current.slice(2);
    if (!trimmed) continue;
    const [key, inlineValue] = trimmed.split("=", 2);
    if (inlineValue !== undefined) {
      flags[key] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !String(next).startsWith("--")) {
      flags[key] = next;
      index += 1;
      continue;
    }
    flags[key] = true;
  }
  return { command, flags };
}

function renderJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function resolveRepoRoot(flagValue) {
  return collectLib.resolveControlTowerRepoRoot(flagValue || REPO_ROOT);
}

function collectStateBundle(options = {}) {
  const repoRoot = resolveRepoRoot(options.repoRoot);
  const rawState = collectLib.collectControlTowerRawState({
    repoRoot,
    theme: options.theme || DEFAULT_THEME_NAME,
    rootSession: options.rootSession || DEFAULT_ROOT_SESSION,
    hostUser: options.hostUser || DEFAULT_HOST_USER,
    runner: options.runner,
    rootProcess: options.rootProcess,
  });
  if (options.write !== false) {
    collectLib.writeControlTowerState(rawState, repoRoot);
  }
  const audits = Array.isArray(options.audits) ? options.audits : [];
  const state = deriveLib.deriveControlTowerState(rawState, audits);
  return { repoRoot, rawState, state };
}

export function collectCockpitState(options = {}) {
  return collectStateBundle({
    ...options,
    rootProcess: options.rootProcess ?? isRootProcess(),
  }).state;
}

export function spawnSession(args = {}, options = {}) {
  return actionsLib.spawnControlTowerSession(args, {
    repoRoot: resolveRepoRoot(options.repoRoot),
    hostUser: options.hostUser || DEFAULT_HOST_USER,
    rootProcess: options.rootProcess ?? isRootProcess(),
    runner: options.runner,
  });
}

export function sendToSession(args = {}, options = {}) {
  return actionsLib.sendControlTowerInstruction(args, {
    repoRoot: resolveRepoRoot(options.repoRoot),
    hostUser: options.hostUser || DEFAULT_HOST_USER,
    rootProcess: options.rootProcess ?? isRootProcess(),
    runner: options.runner,
  });
}

export function runServiceAction(args = {}, options = {}) {
  return actionsLib.runControlTowerServiceAction(args, {
    hostUser: options.hostUser || DEFAULT_HOST_USER,
    rootProcess: options.rootProcess ?? isRootProcess(),
    runner: options.runner,
  });
}

export function appendOverseerAck(args = {}, options = {}) {
  return actionsLib.appendControlTowerOverseerAck(args, {
    repoRoot: resolveRepoRoot(options.repoRoot),
    hostUser: options.hostUser || DEFAULT_HOST_USER,
    rootProcess: options.rootProcess ?? isRootProcess(),
  });
}

function bulletList(items = [], fallback) {
  if (!items.length) return [fallback];
  return items.map((item) => `- ${item}`);
}

function defaultControlTowerUrl(explicitUrl) {
  const direct = String(explicitUrl || process.env.STUDIO_BRAIN_CONTROL_TOWER_URL || "").trim();
  if (direct) return direct;
  const portalBase = String(process.env.MONSOONFIRE_PORTAL_URL || "https://portal.monsoonfire.com").trim().replace(/\/+$/, "");
  return `${portalBase}/staff/cockpit/control-tower`;
}

export function renderRecoveryPanel(state, options = {}) {
  const controlTowerUrl = defaultControlTowerUrl(options.url);
  const degradedServices = state.services.filter((service) => service.health !== "healthy");
  const topRoom = state.rooms[0] ?? null;
  const topSession = topRoom?.sessionNames?.[0] ?? null;
  const nextActions = state.actions.slice(0, 3).map((action) => `${action.title} -> ${action.actionLabel}`);
  const pinned = state.pinnedItems.slice(0, 4).map((item) => `${item.title}: ${item.detail}`);
  const lines = [
    "Studio Brain Control Tower v2",
    "Browser-first operator bridge",
    `Primary route: ${controlTowerUrl}`,
    "",
    "Use tmux here only for recovery:",
    ...bulletList(
      [
        "attach to an already-running room lane",
        "inspect host shells and logs",
        "recover a stuck long-running session",
      ],
      "- No recovery actions listed.",
    ),
    "",
    "Current picture:",
    ...bulletList(
      [
        `${state.counts.needsAttention} need attention`,
        `${state.overview.activeRooms.length} active room${state.overview.activeRooms.length === 1 ? "" : "s"}`,
        `${degradedServices.length} degraded service${degradedServices.length === 1 ? "" : "s"}`,
        `${state.counts.escalated} escalated item${state.counts.escalated === 1 ? "" : "s"}`,
      ],
      "- No current state available.",
    ),
    "",
    "Pinned blockers:",
    ...bulletList(pinned, "- No pinned blockers right now."),
    "",
    "Good next moves:",
    ...bulletList(nextActions, "- Open the browser Control Tower for guided actions."),
    "",
    "Recovery windows:",
    ...bulletList(
      [
        "control -> this recovery guide",
        "brain -> studio-brain shell",
        "scripts -> repo scripts shell",
        "logs -> repo/log investigation shell",
      ],
      "- No recovery windows available.",
    ),
  ];

  if (topSession) {
    lines.push("");
    lines.push(`Fast attach: tmux attach -t ${topSession}`);
  }

  return `${lines.join("\n")}\n`;
}

function renderSessionList(state) {
  if (!state.rooms.length) {
    return [
      "No active rooms yet.",
      "Spawn a room from the browser Control Tower or use `session-spawn` from this wrapper.",
    ].join("\n");
  }

  return state.rooms
    .map((room) => {
      const sessions = room.sessionNames.length
        ? room.sessionNames.map((sessionName) => `  - ${sessionName} · ${room.tool || "agent"} · ${room.status}`).join("\n")
        : "  - No live tmux sessions detected.";
      return [
        `${room.name} [${room.status}]`,
        `  project: ${room.project}`,
        `  objective: ${room.objective || "No objective recorded yet."}`,
        `  last activity: ${room.ageMinutes === null ? "unknown" : `${room.ageMinutes}m ago`}`,
        sessions,
      ].join("\n");
    })
    .join("\n\n");
}

function printHelp() {
  process.stdout.write("Usage: node ./scripts/studiobrain-cockpit.mjs <command> [flags]\n");
  process.stdout.write("Commands:\n");
  process.stdout.write("  state --json [--write true|false]\n");
  process.stdout.write("  recovery [--url https://portal.monsoonfire.com/staff/cockpit/control-tower]\n");
  process.stdout.write("  session-list --json\n");
  process.stdout.write("  session-spawn --name sb-codex --cwd /path --command bash --tool codex --group portal\n");
  process.stdout.write("  session-send --session sb-codex --text \"status?\"\n");
  process.stdout.write("  service-action --service studio-brain-discord-relay --action status\n");
  process.stdout.write("  overseer-ack --note \"reviewed and queued\"\n");
  process.stdout.write("\n");
  process.stdout.write("Browser UI is primary. tmux is retained only for recovery and long-running session hosting.\n");
}

export async function runCli(argv = process.argv.slice(2)) {
  const parsed = parseCli(argv);
  const repoRoot = resolveRepoRoot(parsed.flags["repo-root"]);
  const theme = collectLib.normalizeThemeName(parsed.flags.theme);
  const hostUser = String(parsed.flags["host-user"] || DEFAULT_HOST_USER).trim() || DEFAULT_HOST_USER;
  const rootSession = String(parsed.flags["root-session"] || DEFAULT_ROOT_SESSION).trim() || DEFAULT_ROOT_SESSION;
  const asJson = Boolean(parsed.flags.json);

  if (["help", "--help", "-h"].includes(parsed.command)) {
    printHelp();
    return 0;
  }

  if (parsed.command === "state" || parsed.command === "recovery" || parsed.command === "session-list") {
    const bundle = collectStateBundle({
      repoRoot,
      theme,
      rootSession,
      hostUser,
      rootProcess: isRootProcess(),
      write: parseBoolean(parsed.flags.write, true),
    });
    if (parsed.command === "session-list") {
      const payload = { ok: true, sessions: bundle.rawState.agents, rooms: bundle.state.rooms };
      if (asJson) renderJson(payload);
      else process.stdout.write(`${renderSessionList(bundle.state)}\n`);
      return 0;
    }
    if (parsed.command === "state") {
      const payload = { ok: true, state: bundle.state };
      if (asJson) renderJson(payload);
      else process.stdout.write(renderRecoveryPanel(bundle.state, { url: parsed.flags.url }));
      return 0;
    }
    if (asJson) {
      renderJson({ ok: true, panel: renderRecoveryPanel(bundle.state, { url: parsed.flags.url }), state: bundle.state });
    } else {
      process.stdout.write(renderRecoveryPanel(bundle.state, { url: parsed.flags.url }));
    }
    return 0;
  }

  if (parsed.command === "session-spawn") {
    const result = spawnSession(
      {
        name: parsed.flags.name,
        cwd: parsed.flags.cwd,
        command: parsed.flags.command,
        tool: parsed.flags.tool,
        group: parsed.flags.group,
        room: parsed.flags.room,
        summary: parsed.flags.summary,
        objective: parsed.flags.objective,
      },
      {
        repoRoot,
        hostUser,
        rootProcess: isRootProcess(),
      },
    );
    if (asJson) renderJson(result);
    else process.stdout.write(`${result.ok ? "created" : "failed"}: ${result.message || result.sessionName}\n`);
    return result.ok ? 0 : 1;
  }

  if (parsed.command === "session-send") {
    const result = sendToSession(
      {
        session: parsed.flags.session,
        text: parsed.flags.text,
        enter: parseBoolean(parsed.flags.enter, true),
      },
      {
        repoRoot,
        hostUser,
        rootProcess: isRootProcess(),
      },
    );
    if (asJson) renderJson(result);
    else process.stdout.write(`${result.ok ? "sent" : "failed"}: ${result.message || result.sessionName}\n`);
    return result.ok ? 0 : 1;
  }

  if (parsed.command === "service-action") {
    const result = runServiceAction(
      {
        service: parsed.flags.service,
        action: parsed.flags.action,
      },
      {
        hostUser,
        rootProcess: isRootProcess(),
      },
    );
    if (asJson) renderJson(result);
    else process.stdout.write(`${result.ok ? "ok" : "failed"}: ${result.message}\n`);
    return result.ok ? 0 : 1;
  }

  if (parsed.command === "overseer-ack") {
    const result = appendOverseerAck(
      {
        runId: parsed.flags["run-id"],
        note: parsed.flags.note,
        actor: parsed.flags.actor || hostUser,
      },
      {
        repoRoot,
        hostUser,
        rootProcess: isRootProcess(),
      },
    );
    if (asJson) renderJson(result);
    else process.stdout.write(`${result.ok ? "logged" : "failed"}: ${result.ok ? result.ackPath : result.message}\n`);
    return result.ok ? 0 : 1;
  }

  printHelp();
  return 1;
}

if (resolve(process.argv[1] || "") === __filename) {
  const code = await runCli();
  process.exit(code);
}
