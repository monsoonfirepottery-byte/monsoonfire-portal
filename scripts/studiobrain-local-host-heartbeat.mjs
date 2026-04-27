#!/usr/bin/env node

import os from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const BUFFER_PATH = resolve(REPO_ROOT, "output", "ops-cockpit", "host-heartbeat-buffer.json");

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseArgs(argv) {
  const parsed = {
    baseUrl:
      clean(process.env.STUDIO_BRAIN_HOST_HEARTBEAT_URL) ||
      clean(process.env.STUDIO_BRAIN_URL) ||
      clean(process.env.STUDIO_BRAIN_BASE_URL),
    adminToken: clean(process.env.STUDIO_BRAIN_ADMIN_TOKEN),
    hostId: clean(process.env.STUDIO_BRAIN_HOST_ID) || clean(os.hostname()) || "local-host",
    label: clean(process.env.STUDIO_BRAIN_HOST_LABEL) || clean(os.hostname()) || "Local Host",
    role: clean(process.env.STUDIO_BRAIN_HOST_ROLE) || "operator-laptop",
    environment: "local",
    health: clean(process.env.STUDIO_BRAIN_HOST_HEALTH) || "healthy",
    version: clean(process.env.STUDIO_BRAIN_HOST_VERSION) || null,
    codexAppVersion: clean(process.env.CODEX_APP_VERSION) || clean(process.env.STUDIO_BRAIN_CODEX_APP_VERSION),
    codexCliVersion: clean(process.env.CODEX_CLI_VERSION) || clean(process.env.STUDIO_BRAIN_CODEX_CLI_VERSION),
    activeCommand: clean(process.env.STUDIO_BRAIN_ACTIVE_COMMAND),
    verificationLane: clean(process.env.STUDIO_BRAIN_VERIFICATION_LANE),
    latestArtifactPath: clean(process.env.STUDIO_BRAIN_LATEST_ARTIFACT_PATH),
    watch: false,
    intervalMs: 30_000,
    currentRunId: clean(process.env.STUDIO_BRAIN_CURRENT_RUN_ID),
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;
    if (arg === "--watch") {
      parsed.watch = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--base-url" && argv[index + 1]) {
      parsed.baseUrl = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--base-url=")) {
      parsed.baseUrl = clean(arg.slice("--base-url=".length));
      continue;
    }
    if (arg === "--admin-token" && argv[index + 1]) {
      parsed.adminToken = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--admin-token=")) {
      parsed.adminToken = clean(arg.slice("--admin-token=".length));
      continue;
    }
    if (arg === "--host-id" && argv[index + 1]) {
      parsed.hostId = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--host-id=")) {
      parsed.hostId = clean(arg.slice("--host-id=".length));
      continue;
    }
    if (arg === "--label" && argv[index + 1]) {
      parsed.label = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--label=")) {
      parsed.label = clean(arg.slice("--label=".length));
      continue;
    }
    if (arg === "--role" && argv[index + 1]) {
      parsed.role = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--role=")) {
      parsed.role = clean(arg.slice("--role=".length));
      continue;
    }
    if (arg === "--health" && argv[index + 1]) {
      parsed.health = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--health=")) {
      parsed.health = clean(arg.slice("--health=".length));
      continue;
    }
    if (arg === "--interval-ms" && argv[index + 1]) {
      parsed.intervalMs = Number.parseInt(clean(argv[index + 1]), 10) || parsed.intervalMs;
      index += 1;
      continue;
    }
    if (arg.startsWith("--interval-ms=")) {
      parsed.intervalMs = Number.parseInt(clean(arg.slice("--interval-ms=".length)), 10) || parsed.intervalMs;
      continue;
    }
    if (arg === "--current-run-id" && argv[index + 1]) {
      parsed.currentRunId = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--current-run-id=")) {
      parsed.currentRunId = clean(arg.slice("--current-run-id=".length));
      continue;
    }
    if (arg === "--codex-app-version" && argv[index + 1]) {
      parsed.codexAppVersion = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--codex-app-version=")) {
      parsed.codexAppVersion = clean(arg.slice("--codex-app-version=".length));
      continue;
    }
    if (arg === "--codex-cli-version" && argv[index + 1]) {
      parsed.codexCliVersion = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--codex-cli-version=")) {
      parsed.codexCliVersion = clean(arg.slice("--codex-cli-version=".length));
      continue;
    }
    if (arg === "--active-command" && argv[index + 1]) {
      parsed.activeCommand = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--active-command=")) {
      parsed.activeCommand = clean(arg.slice("--active-command=".length));
      continue;
    }
    if (arg === "--verification-lane" && argv[index + 1]) {
      parsed.verificationLane = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--verification-lane=")) {
      parsed.verificationLane = clean(arg.slice("--verification-lane=".length));
      continue;
    }
    if (arg === "--latest-artifact-path" && argv[index + 1]) {
      parsed.latestArtifactPath = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--latest-artifact-path=")) {
      parsed.latestArtifactPath = clean(arg.slice("--latest-artifact-path=".length));
    }
  }

  return parsed;
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function resolveLatestRun(explicitRunId) {
  const pointerPath = resolve(REPO_ROOT, "output", "agent-runs", "latest.json");
  const pointer = readJsonIfExists(pointerPath);
  const runId = clean(explicitRunId) || clean(pointer?.runId) || null;
  const summaryPath =
    runId && pointer?.runId === runId && clean(pointer?.summaryPath)
      ? resolve(REPO_ROOT, clean(pointer.summaryPath))
      : runId
        ? resolve(REPO_ROOT, "output", "agent-runs", runId, "summary.json")
        : null;
  const summary = readJsonIfExists(summaryPath);
  return {
    runId,
    pointerPath,
    summaryPath,
    summary,
  };
}

function readCodexCliVersion() {
  const result = spawnSync("codex", ["--version"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 2500,
    windowsHide: true,
  });
  if (result.status !== 0) return "";
  return clean(result.stdout).replace(/^codex-cli\s+/i, "");
}

function buildHeartbeat(config) {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memoryPct = totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : null;
  const load1 = os.loadavg()[0] || 0;
  const latestRun = resolveLatestRun(config.currentRunId);
  const latestSummary = latestRun.summary || {};
  const currentRunId = latestRun.runId;
  const codexCliVersion = clean(config.codexCliVersion) || readCodexCliVersion();
  const codexAppVersion = clean(config.codexAppVersion);
  const versionParts = [
    clean(config.version),
    codexCliVersion ? `codex-cli ${codexCliVersion}` : "",
    codexAppVersion ? `codex-app ${codexAppVersion}` : "",
  ].filter(Boolean);
  return {
    schema: "control-tower-host-heartbeat.v1",
    hostId: config.hostId,
    label: config.label,
    environment: config.environment,
    role: config.role,
    health:
      config.health === "maintenance"
        ? "maintenance"
        : config.health === "offline"
          ? "offline"
          : config.health === "degraded"
            ? "degraded"
            : "healthy",
    lastSeenAt: new Date().toISOString(),
    currentRunId,
    agentCount: currentRunId ? 1 : 0,
    version: versionParts.join(" / ") || null,
    metadata: {
      codexAppVersion: codexAppVersion || null,
      codexCliVersion: codexCliVersion || null,
      activeCommand: clean(config.activeCommand || latestSummary.lastEventType || latestSummary.boardRow?.task) || null,
      verificationLane: clean(config.verificationLane || latestSummary.riskLane) || null,
      latestArtifactPath: clean(config.latestArtifactPath || latestRun.summaryPath) || null,
      latestRunStatus: clean(latestSummary.status) || null,
      latestRunTitle: clean(latestSummary.title) || null,
    },
    metrics: {
      cpuPct: null,
      memoryPct,
      load1: Number.isFinite(load1) ? Number(load1.toFixed(2)) : null,
    },
  };
}

async function postHeartbeat(baseUrl, adminToken, heartbeat) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/control-tower/hosts/heartbeat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-studio-brain-admin-token": adminToken,
    },
    body: JSON.stringify(heartbeat),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || `Heartbeat failed (${response.status}).`);
  }
  return payload;
}

function persistBuffer(heartbeat) {
  mkdirSync(resolve(REPO_ROOT, "output", "ops-cockpit"), { recursive: true });
  writeFileSync(BUFFER_PATH, `${JSON.stringify(heartbeat, null, 2)}\n`, "utf8");
}

async function flushBufferedHeartbeat(baseUrl, adminToken) {
  const buffered = readJsonIfExists(BUFFER_PATH);
  if (!buffered) return false;
  await postHeartbeat(baseUrl, adminToken, buffered);
  unlinkSync(BUFFER_PATH);
  return true;
}

async function sendOnce(config) {
  if (!config.baseUrl) {
    throw new Error("Missing Studio Brain base URL. Set STUDIO_BRAIN_URL or pass --base-url.");
  }
  if (!config.adminToken) {
    throw new Error("Missing Studio Brain admin token. Set STUDIO_BRAIN_ADMIN_TOKEN or pass --admin-token.");
  }
  const heartbeat = buildHeartbeat(config);
  try {
    await flushBufferedHeartbeat(config.baseUrl, config.adminToken);
    const payload = await postHeartbeat(config.baseUrl, config.adminToken, heartbeat);
    if (config.json) {
      process.stdout.write(`${JSON.stringify({ ok: true, heartbeat, payload }, null, 2)}\n`);
    } else {
      process.stdout.write(`heartbeat ok: ${heartbeat.hostId} -> ${config.baseUrl}\n`);
    }
    if (existsSync(BUFFER_PATH)) unlinkSync(BUFFER_PATH);
  } catch (error) {
    persistBuffer(heartbeat);
    if (config.json) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, buffered: true, message: error instanceof Error ? error.message : String(error), heartbeat }, null, 2)}\n`,
      );
      return;
    }
    process.stderr.write(`heartbeat buffered: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  if (!config.watch) {
    await sendOnce(config);
    return;
  }
  await sendOnce(config);
  const intervalMs = Math.max(5_000, config.intervalMs);
  setInterval(() => {
    void sendOnce(config);
  }, intervalMs);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
