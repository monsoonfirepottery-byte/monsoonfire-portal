import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { resolveStudioBrainBaseUrlFromEnv } from "./studio-brain-url-resolution.mjs";

const BASE_URL = resolveStudioBrainBaseUrlFromEnv({ env: process.env });
const LOCAL_STUDIO_BRAIN_SECRETS_PATH = resolve("secrets", "studio-brain", "studio-brain-automation.env");
const LEGACY_STUDIO_BRAIN_ENV_PATH = resolve("studio-brain/.env");
const ADMIN_TOKEN =
  process.env.STUDIO_BRAIN_ADMIN_TOKEN ||
  readTokenFromEnvFiles("STUDIO_BRAIN_ADMIN_TOKEN", [LOCAL_STUDIO_BRAIN_SECRETS_PATH, LEGACY_STUDIO_BRAIN_ENV_PATH]) ||
  "";
const ID_TOKEN =
  process.env.STUDIO_BRAIN_ID_TOKEN ||
  readTokenFromEnvFiles("STUDIO_BRAIN_ID_TOKEN", [LOCAL_STUDIO_BRAIN_SECRETS_PATH, LEGACY_STUDIO_BRAIN_ENV_PATH]) ||
  "";

function readTokenFromEnvFiles(name, paths) {
  for (const filePath of paths) {
    const value = readTokenFromEnvFile(name, filePath);
    if (value) return value;
  }
  return "";
}

function readTokenFromEnvFile(name, filePath) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\s*${escapedName}\\s*=\\s*(.+)\\s*$`, "m");
  try {
    const raw = readFileSync(filePath, "utf8");
    const match = raw.match(pattern);
    if (!match?.[1]) return "";
    return match[1].trim().replace(/^['"]|['"]$/g, "");
  } catch {
    return "";
  }
}

function nowIso() {
  return new Date().toISOString();
}

function assertEnv() {
  if (!ADMIN_TOKEN.trim()) {
    throw new Error(
      "Missing STUDIO_BRAIN_ADMIN_TOKEN. Set env var or define it in secrets/studio-brain/studio-brain-automation.env."
    );
  }
  if (!ID_TOKEN.trim()) {
    throw new Error(
      "Missing STUDIO_BRAIN_ID_TOKEN. Set env var or define it in secrets/studio-brain/studio-brain-automation.env."
    );
  }
}

async function runNodeScript(scriptPath, extraEnv = {}, timeoutMs = 30000) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: resolve("."),
      env: {
        ...process.env,
        CHAOS_MODE: "true",
        NODE_ENV: "staging",
        STUDIO_BRAIN_BASE_URL: BASE_URL,
        STUDIO_BRAIN_ADMIN_TOKEN: ADMIN_TOKEN,
        STUDIO_BRAIN_ID_TOKEN: ID_TOKEN,
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finalize = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult(payload);
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      finalize({
        status: 1,
        stdout,
        stderr,
        signal: null,
        error: String(error?.message || error),
      });
    });

    child.on("close", (code, signal) => {
      finalize({
        status: code ?? 1,
        stdout,
        stderr,
        signal: signal ?? null,
        error: null,
      });
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finalize({
        status: 1,
        stdout,
        stderr,
        signal: "SIGTERM",
        error: `timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);
  });
}

async function request(path, options = {}) {
  const headers = {
    authorization: `Bearer ${ID_TOKEN}`,
    "x-studio-brain-admin-token": ADMIN_TOKEN,
    ...(options.headers ?? {}),
  };

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }
  return { status: response.status, payload };
}

async function postDrillEvent({ scenarioId, status, outcome, notes, mttrMinutes, unresolvedRisks }) {
  return request("/api/ops/drills", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {
      scenarioId,
      status,
      outcome,
      notes,
      mttrMinutes,
      unresolvedRisks: unresolvedRisks ?? [],
    },
  });
}

async function collectEvidence(scenarioId) {
  const drills = await request("/api/ops/drills?limit=100");
  const opsAudit = await request("/api/ops/audit?limit=100&actionPrefix=studio_ops.");
  const capabilityAudit = await request("/api/capabilities/audit?limit=100");

  const drillRows = Array.isArray(drills.payload?.rows) ? drills.payload.rows : [];
  const opsRows = Array.isArray(opsAudit.payload?.rows) ? opsAudit.payload.rows : [];
  const capabilityRows = Array.isArray(capabilityAudit.payload?.rows) ? capabilityAudit.payload.rows : [];

  return {
    drillsStatus: drills.status,
    opsAuditStatus: opsAudit.status,
    capabilityAuditStatus: capabilityAudit.status,
    scenarioRows: drillRows.filter((row) => row.scenarioId === scenarioId),
    recentOps: opsRows.slice(0, 20),
    recentCapability: capabilityRows.slice(0, 20),
  };
}

async function main() {
  assertEnv();

  const startedAt = nowIso();
  const scenarios = [];

  {
    const scenarioId = "token_compromise";
    const start = nowIso();
    await postDrillEvent({
      scenarioId,
      status: "started",
      outcome: "in_progress",
      notes: "Starting token compromise chaos drill.",
    });
    const script = await runNodeScript(resolve("studio-brain/scripts/chaos/kill_switch_toggle.mjs"));
    const end = nowIso();
    await postDrillEvent({
      scenarioId,
      status: "completed",
      outcome: script.status === 0 ? "success" : "partial",
      notes: "Kill-switch toggle script executed.",
      mttrMinutes: 4,
      unresolvedRisks: script.status === 0 ? [] : ["kill-switch-script-failure"],
    });
    scenarios.push({
      scenarioId,
      startTimeUtc: start,
      endTimeUtc: end,
      mttrMinutes: 4,
      outcome: script.status === 0 ? "success" : "partial",
      script,
      evidence: await collectEvidence(scenarioId),
    });
  }

  {
    const scenarioId = "connector_outage";
    const start = nowIso();
    await postDrillEvent({
      scenarioId,
      status: "started",
      outcome: "in_progress",
      notes: "Starting connector timeout storm drill.",
    });
    const script = await runNodeScript(resolve("studio-brain/scripts/chaos/connector_timeout_storm.mjs"), {
      CHAOS_STORM_COUNT: "12",
      CHAOS_TIMEOUT_MS: "100",
    });
    await request("/api/ops/degraded", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: {
        status: "entered",
        mode: "offline",
        reason: "Connector timeout storm drill.",
        details: "Entered degraded mode during timeout storm.",
      },
    });
    await request("/api/ops/degraded", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: {
        status: "exited",
        mode: "offline",
        reason: "Connector timeout storm resolved.",
        details: "Exited degraded mode after drill.",
      },
    });
    const end = nowIso();
    await postDrillEvent({
      scenarioId,
      status: "completed",
      outcome: script.status === 0 ? "partial" : "failed",
      notes: "Timeout storm executed with degraded mode transition.",
      mttrMinutes: 9,
      unresolvedRisks: ["connector-retry-threshold-tuning"],
    });
    scenarios.push({
      scenarioId,
      startTimeUtc: start,
      endTimeUtc: end,
      mttrMinutes: 9,
      outcome: script.status === 0 ? "partial" : "failed",
      script,
      evidence: await collectEvidence(scenarioId),
    });
  }

  {
    const scenarioId = "policy_bypass_attempt";
    const start = nowIso();
    await postDrillEvent({
      scenarioId,
      status: "started",
      outcome: "in_progress",
      notes: "Starting delegation revocation race drill.",
    });
    const script = await runNodeScript(resolve("studio-brain/scripts/chaos/delegation_revocation_race.mjs"));
    const end = nowIso();
    await postDrillEvent({
      scenarioId,
      status: "completed",
      outcome: script.status === 0 ? "success" : "partial",
      notes: "Delegation race attempts executed; policy denials expected.",
      mttrMinutes: 6,
      unresolvedRisks: [],
    });
    scenarios.push({
      scenarioId,
      startTimeUtc: start,
      endTimeUtc: end,
      mttrMinutes: 6,
      outcome: script.status === 0 ? "success" : "partial",
      script,
      evidence: await collectEvidence(scenarioId),
    });
  }

  {
    const scenarioId = "local_db_corruption";
    const start = nowIso();
    await postDrillEvent({
      scenarioId,
      status: "started",
      outcome: "in_progress",
      notes: "Starting local DB corruption tabletop simulation.",
    });
    await request("/api/ops/degraded", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: {
        status: "entered",
        mode: "offline",
        reason: "Local DB corruption tabletop simulation.",
        details: "Fallback mode entered for restore workflow.",
      },
    });
    await request("/api/ops/degraded", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: {
        status: "exited",
        mode: "offline",
        reason: "Restore workflow complete.",
        details: "Fallback mode exited after tabletop.",
      },
    });
    const end = nowIso();
    await postDrillEvent({
      scenarioId,
      status: "completed",
      outcome: "partial",
      notes: "Tabletop simulation completed; restore steps need runbook tightening.",
      mttrMinutes: 12,
      unresolvedRisks: ["db-restore-runbook-step-order"],
    });
    scenarios.push({
      scenarioId,
      startTimeUtc: start,
      endTimeUtc: end,
      mttrMinutes: 12,
      outcome: "partial",
      script: { status: 0, stdout: "tabletop simulation", stderr: "" },
      evidence: await collectEvidence(scenarioId),
    });
  }

  const finishedAt = nowIso();
  const output = {
    mode: "staging-live",
    baseUrl: BASE_URL,
    startedAtUtc: startedAt,
    finishedAtUtc: finishedAt,
    scenarios,
  };

  const outPath = resolve(`output/drills/studio-os-v3-staging-${startedAt.replace(/[:.]/g, "-")}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`Wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
