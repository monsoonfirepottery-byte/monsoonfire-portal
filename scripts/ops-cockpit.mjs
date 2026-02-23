#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
const command = args[0] || "status";
const asJson = args.includes("--json");

const OPS_DIR = resolve(REPO_ROOT, "output", "ops-cockpit");
const STATE_PATH = resolve(OPS_DIR, "state.json");
const STATUS_PATH = resolve(OPS_DIR, "latest-status.json");
const HEARTBEAT_SUMMARY_PATH = resolve(REPO_ROOT, "output", "stability", "heartbeat-summary.json");

mkdirSync(OPS_DIR, { recursive: true });

if (command === "start") {
  runStart();
} else if (command === "status") {
  runStatus();
} else if (command === "stop") {
  runStop();
} else if (command === "bundle") {
  runBundle();
} else if (command === "reset") {
  runReset();
} else if (command === "--help" || command === "-h" || command === "help") {
  printHelp();
} else {
  process.stderr.write(`Unknown ops-cockpit command: ${command}\n`);
  printHelp();
  process.exit(1);
}

function runStart() {
  const now = new Date().toISOString();
  const state = readState();
  const reliability = runCommand("node", ["./scripts/reliability-hub.mjs", "once", "--json"]);
  const heartbeat = readJsonIfExists(HEARTBEAT_SUMMARY_PATH);

  const nextState = {
    enabled: true,
    startedAt: state.startedAt || now,
    lastStartedAt: now,
    lastStoppedAt: state.lastStoppedAt || "",
    lastStatus: heartbeat?.status || (reliability.ok ? "pass" : "fail"),
    heartbeatSummaryPath: relativePath(HEARTBEAT_SUMMARY_PATH),
    lastBundlePath: state.lastBundlePath || "",
  };
  writeJson(STATE_PATH, nextState);

  const latest = {
    updatedAt: now,
    command: "start",
    reliability,
    heartbeatStatus: heartbeat?.status || "unknown",
  };
  writeJson(STATUS_PATH, latest);

  output({
    status: reliability.ok ? "pass" : "warn",
    command: "start",
    state: nextState,
    heartbeatStatus: heartbeat?.status || "unknown",
    reliabilityOk: reliability.ok,
  });
}

function runStatus() {
  const state = readState();
  const heartbeat = readJsonIfExists(HEARTBEAT_SUMMARY_PATH);
  const latest = readJsonIfExists(STATUS_PATH);

  const status = heartbeat?.status || state.lastStatus || "unknown";
  output({
    status,
    statusColor: status === "pass" ? "green" : status === "warn" ? "yellow" : status === "fail" ? "red" : "gray",
    command: "status",
    state,
    heartbeatSummaryPath: relativePath(HEARTBEAT_SUMMARY_PATH),
    heartbeat,
    latest,
  });
}

function runStop() {
  const now = new Date().toISOString();
  const state = readState();
  const nextState = {
    ...state,
    enabled: false,
    lastStoppedAt: now,
  };
  writeJson(STATE_PATH, nextState);
  writeJson(STATUS_PATH, {
    updatedAt: now,
    command: "stop",
    status: "pass",
  });
  output({
    status: "pass",
    command: "stop",
    state: nextState,
  });
}

function runBundle() {
  const now = new Date().toISOString();
  const extraArgs = args.slice(1).filter((arg) => arg !== "--json");
  const bundle = runCommand(
    "node",
    ["./scripts/studiobrain-incident-bundle.mjs", "--json", ...extraArgs],
  );
  const state = readState();
  const parsed = bundle.parsed || {};
  const nextState = {
    ...state,
    lastBundlePath: typeof parsed.bundlePath === "string" ? parsed.bundlePath : state.lastBundlePath || "",
  };
  writeJson(STATE_PATH, nextState);
  writeJson(STATUS_PATH, {
    updatedAt: now,
    command: "bundle",
    status: bundle.ok ? "pass" : "warn",
    bundle: parsed,
  });
  output({
    status: bundle.ok ? "pass" : "warn",
    command: "bundle",
    bundle: parsed,
    state: nextState,
  });
}

function runReset() {
  if (existsSync(STATE_PATH)) rmSync(STATE_PATH, { force: true });
  if (existsSync(STATUS_PATH)) rmSync(STATUS_PATH, { force: true });
  output({
    status: "pass",
    command: "reset",
    message: "ops-cockpit state reset",
  });
}

function readState() {
  const parsed = readJsonIfExists(STATE_PATH);
  if (parsed && typeof parsed === "object") {
    return parsed;
  }
  return {
    enabled: false,
    startedAt: "",
    lastStartedAt: "",
    lastStoppedAt: "",
    lastStatus: "unknown",
    heartbeatSummaryPath: relativePath(HEARTBEAT_SUMMARY_PATH),
    lastBundlePath: "",
  };
}

function runCommand(commandName, commandArgs) {
  const result = spawnSync(commandName, commandArgs, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe",
  });
  const text = `${result.stdout || ""}${result.stderr || ""}`.trim();
  const parsed = extractJsonObject(text);
  return {
    ok: result.status === 0,
    exitCode: result.status ?? 1,
    command: `${commandName} ${commandArgs.join(" ")}`.trim(),
    parsed,
    output: text.slice(0, 3000),
  };
}

function extractJsonObject(text) {
  if (!text) return null;
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function writeJson(path, payload) {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function relativePath(absPath) {
  return absPath.startsWith(`${REPO_ROOT}/`)
    ? absPath.slice(REPO_ROOT.length + 1)
    : absPath;
}

function output(payload) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(`ops-cockpit ${payload.command}: ${String(payload.status || "unknown").toUpperCase()}\n`);
  if (payload.statusColor) {
    process.stdout.write(`  color: ${payload.statusColor}\n`);
  }
  if (payload.heartbeatStatus) {
    process.stdout.write(`  heartbeat: ${payload.heartbeatStatus}\n`);
  }
  if (payload.bundle?.bundlePath) {
    process.stdout.write(`  bundle: ${payload.bundle.bundlePath}\n`);
  }
  if (payload.message) {
    process.stdout.write(`  ${payload.message}\n`);
  }
}

function printHelp() {
  process.stdout.write("Usage: node ./scripts/ops-cockpit.mjs <start|status|stop|bundle|reset> [flags]\n");
  process.stdout.write("Flags:\n");
  process.stdout.write("  --json\n");
  process.stdout.write("Examples:\n");
  process.stdout.write("  node ./scripts/ops-cockpit.mjs start\n");
  process.stdout.write("  node ./scripts/ops-cockpit.mjs status --json\n");
  process.stdout.write("  node ./scripts/ops-cockpit.mjs bundle\n");
}
