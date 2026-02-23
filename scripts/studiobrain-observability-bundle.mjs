#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const STUDIO_BRAIN_ROOT = resolve(REPO_ROOT, "studio-brain");
const COMPOSE_FILE = resolve(STUDIO_BRAIN_ROOT, "docker-compose.yml");
const OTEL_OUTPUT_DIR = resolve(REPO_ROOT, "output", "otel");
const HEARTBEAT_SUMMARY_PATH = resolve(REPO_ROOT, "output", "stability", "heartbeat-summary.json");
const AUDIT_LOG_PATH = resolve(REPO_ROOT, "output", "ops-audit", "destructive-actions.log");
const RESET_TARGETS = [
  resolve(REPO_ROOT, "output", "stability"),
  resolve(REPO_ROOT, "output", "incidents"),
  resolve(REPO_ROOT, "output", "ops-cockpit"),
  OTEL_OUTPUT_DIR,
];

const args = process.argv.slice(2);
const command = args[0] || "status";
const jsonMode = args.includes("--json");
const skipHeartbeat = args.includes("--no-heartbeat");
const confirmDestructive = args.includes("--yes-i-know");
const destructiveReason = readArgValue(args, "--reason");
const envSource = resolveEnvSource();

if (command === "up") {
  runUp();
} else if (command === "down") {
  runDown();
} else if (command === "status") {
  runStatus();
} else if (command === "reset") {
  runReset();
} else if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
} else {
  process.stderr.write(`Unknown observability command: ${command}\n`);
  printHelp();
  process.exit(1);
}

function runUp() {
  mkdirSync(OTEL_OUTPUT_DIR, { recursive: true });

  const compose = runCompose(["--profile", "observability", "up", "-d", "otel-collector"]);
  if (!compose.ok) {
    outputAndExit({
      status: "fail",
      command: "up",
      envSource: envSource.label,
      compose: summarizeCommandResult(compose),
    }, 1);
    return;
  }

  let heartbeat = null;
  if (!skipHeartbeat) {
    heartbeat = runNode(["./scripts/reliability-hub.mjs", "once", "--json"]);
  }

  const statusCode = heartbeat && !heartbeat.ok ? 1 : 0;
  const status = heartbeat && !heartbeat.ok ? "warn" : "pass";

  outputAndExit({
    status,
    command: "up",
    envSource: envSource.label,
    compose: summarizeCommandResult(compose),
    heartbeat: heartbeat ? summarizeCommandResult(heartbeat) : { skipped: true },
    artifacts: {
      heartbeatSummaryPath: relativePath(HEARTBEAT_SUMMARY_PATH),
      otelOutputDir: relativePath(OTEL_OUTPUT_DIR),
    },
  }, statusCode);
}

function runDown() {
  const stop = runCompose(["--profile", "observability", "stop", "otel-collector"], { allowFail: true });
  const remove = runCompose(["--profile", "observability", "rm", "-f", "otel-collector"], { allowFail: true });
  const hasHardFailure = !stop.success && !remove.success;

  recordDestructiveAudit({
    action: "observability-down",
    classification: "restart-only",
    status: hasHardFailure ? "warn" : "pass",
    reason: destructiveReason || "operator-request",
    details: {
      stopOk: Boolean(stop.success),
      removeOk: Boolean(remove.success),
    },
  });

  outputAndExit({
    status: hasHardFailure ? "warn" : "pass",
    command: "down",
    envSource: envSource.label,
    stop: summarizeCommandResult(stop),
    remove: summarizeCommandResult(remove),
  }, hasHardFailure ? 1 : 0);
}

function runStatus() {
  const ps = runCompose(["--profile", "observability", "ps", "--services", "--filter", "status=running"], { allowFail: true });
  const runningServices = (ps.output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const otelCollectorRunning = runningServices.includes("otel-collector");
  const heartbeat = readJsonIfExists(HEARTBEAT_SUMMARY_PATH);

  const status = ps.success ? "pass" : "warn";
  outputAndExit({
    status,
    command: "status",
    envSource: envSource.label,
    otelCollectorRunning,
    runningServices,
    heartbeatStatus: heartbeat?.status || "unknown",
    heartbeatSummaryPath: relativePath(HEARTBEAT_SUMMARY_PATH),
    otelOutputDir: relativePath(OTEL_OUTPUT_DIR),
    compose: summarizeCommandResult(ps),
  }, status === "pass" ? 0 : 1);
}

function runReset() {
  if (!confirmDestructive) {
    const message = "reset is data-destructive. Re-run with --yes-i-know and optional --reason <text>.";
    recordDestructiveAudit({
      action: "observability-reset",
      classification: "data-destructive",
      status: "blocked",
      reason: destructiveReason || "missing-confirmation",
      details: { command, args: args.slice(1) },
    });
    outputAndExit({
      status: "fail",
      command: "reset",
      envSource: envSource.label,
      message,
      rollbackHint: "Use `npm run studio:observability:up` to restore observability services.",
    }, 1);
    return;
  }

  const stop = runCompose(["--profile", "observability", "stop", "otel-collector"], { allowFail: true });
  const remove = runCompose(["--profile", "observability", "rm", "-f", "otel-collector"], { allowFail: true });
  const removed = [];
  for (const target of RESET_TARGETS) {
    if (!existsSync(target)) {
      continue;
    }
    rmSync(target, { recursive: true, force: true });
    removed.push(relativePath(target));
  }

  recordDestructiveAudit({
    action: "observability-reset",
    classification: "data-destructive",
    status: "pass",
    reason: destructiveReason || "operator-request",
    details: { removed },
  });

  outputAndExit({
    status: "pass",
    command: "reset",
    envSource: envSource.label,
    stop: summarizeCommandResult(stop),
    remove: summarizeCommandResult(remove),
    removed,
    rollbackHint: "Run `npm run studio:observability:up` after reset to rehydrate baseline telemetry.",
  }, 0);
}

function runCompose(composeArgs, options = {}) {
  const command = ["compose"];
  if (envSource.path) {
    command.push("--env-file", envSource.path);
  }
  command.push("-f", COMPOSE_FILE, ...composeArgs);
  const result = spawnSync("docker", command, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 120_000,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  const allowFail = Boolean(options.allowFail);
  const success = result.status === 0;
  const ok = allowFail ? true : success;
  return {
    ok,
    success,
    statusCode: result.status ?? 1,
    command: `docker ${command.join(" ")}`,
    output,
  };
}

function runNode(nodeArgs) {
  const result = spawnSync("node", nodeArgs, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 180_000,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  return {
    ok: result.status === 0,
    statusCode: result.status ?? 1,
    command: `node ${nodeArgs.join(" ")}`,
    output,
  };
}

function resolveEnvSource() {
  const explicit = String(process.env.STUDIO_BRAIN_ENV_FILE || "").trim();
  if (explicit) {
    const absolute = resolve(STUDIO_BRAIN_ROOT, explicit);
    return {
      path: existsSync(absolute) ? absolute : null,
      label: explicit,
      source: "explicit",
    };
  }

  const preferred = resolve(STUDIO_BRAIN_ROOT, ".env");
  if (existsSync(preferred)) {
    return { path: preferred, label: "studio-brain/.env", source: "default" };
  }

  const fallback = resolve(STUDIO_BRAIN_ROOT, ".env.example");
  if (existsSync(fallback)) {
    return { path: fallback, label: "studio-brain/.env.example", source: "fallback" };
  }

  return { path: null, label: "(process-env-only)", source: "process-env-only" };
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function summarizeCommandResult(result) {
  return {
    ok: result.ok,
    success: result.success,
    statusCode: result.statusCode,
    command: result.command,
    output: truncateOutput(result.output, 2000),
  };
}

function truncateOutput(value, max) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function relativePath(absPath) {
  if (!absPath) return "";
  return absPath.startsWith(`${REPO_ROOT}/`) ? absPath.slice(REPO_ROOT.length + 1) : absPath;
}

function outputAndExit(payload, code) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`observability bundle ${payload.command}: ${String(payload.status).toUpperCase()}\n`);
    process.stdout.write(`  env source: ${payload.envSource}\n`);
    if (payload.otelCollectorRunning !== undefined) {
      process.stdout.write(`  otel collector running: ${payload.otelCollectorRunning ? "yes" : "no"}\n`);
    }
    if (payload.heartbeatStatus) {
      process.stdout.write(`  heartbeat: ${payload.heartbeatStatus}\n`);
    }
    if (Array.isArray(payload.removed) && payload.removed.length > 0) {
      process.stdout.write(`  removed: ${payload.removed.join(", ")}\n`);
    }
    if (payload.compose?.command) {
      process.stdout.write(`  compose: ${payload.compose.command}\n`);
    }
    if (payload.message) {
      process.stdout.write(`  message: ${payload.message}\n`);
    }
    if (payload.rollbackHint) {
      process.stdout.write(`  rollback: ${payload.rollbackHint}\n`);
    }
  }
  process.exit(code);
}

function printHelp() {
  process.stdout.write("Usage: node ./scripts/studiobrain-observability-bundle.mjs <up|down|status|reset> [flags]\n");
  process.stdout.write("Flags:\n");
  process.stdout.write("  --json          machine-readable output\n");
  process.stdout.write("  --no-heartbeat  skip reliability heartbeat after `up`\n");
  process.stdout.write("  --yes-i-know    required for `reset`\n");
  process.stdout.write("  --reason <text> optional audit reason for destructive actions\n");
  process.stdout.write("\n");
  process.stdout.write("Examples:\n");
  process.stdout.write("  node ./scripts/studiobrain-observability-bundle.mjs up\n");
  process.stdout.write("  node ./scripts/studiobrain-observability-bundle.mjs status --json\n");
  process.stdout.write("  node ./scripts/studiobrain-observability-bundle.mjs reset --yes-i-know --reason \"clean-state\"\n");
}

function readArgValue(argv, key) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === key) {
      return argv[index + 1] || "";
    }
    if (arg.startsWith(`${key}=`)) {
      return arg.slice(`${key}=`.length);
    }
  }
  return "";
}

function recordDestructiveAudit(entry) {
  const payload = {
    timestamp: new Date().toISOString(),
    command: `studiobrain-observability-bundle ${command}`,
    classification: entry.classification,
    action: entry.action,
    status: entry.status,
    reason: entry.reason || "",
    args: args.slice(1),
    details: entry.details || {},
  };
  mkdirSync(dirname(AUDIT_LOG_PATH), { recursive: true });
  appendFileSync(AUDIT_LOG_PATH, `${JSON.stringify(payload)}\n`, "utf8");
}
