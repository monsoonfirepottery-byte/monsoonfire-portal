#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const STUDIO_BRAIN_SESSION = "studio-brain";
const STUDIO_BRAIN_INGEST_SESSION = "studio-brain-ingest";
const MEMORY_GUARD_SESSION = "memory-guard";
const MEMORY_SUPERVISOR_SESSION = "memory-supervisor";
const STUDIO_BRAIN_WORKDIR = "/home/wuff/monsoonfire-portal/studio-brain";
const STUDIO_BRAIN_USER_SERVICE = "studio-brain.service";
const STUDIO_BRAIN_QUERY_PORT = 8787;
const STUDIO_BRAIN_INGEST_PORT = 8788;
const STUDIO_BRAIN_HOST = "192.168.1.226";
const GUARD_REPORT_PATH = resolve(process.cwd(), "output", "open-memory", "ingest-guard-live.json");
const SUPERVISOR_REPORT_PATH = resolve(process.cwd(), "output", "open-memory", "ops-supervisor-latest.json");
const DB_MAINTENANCE_REPORT_PATH = resolve(process.cwd(), "output", "open-memory", "db-maintenance-latest.json");
const QOS_SOAK_REPORT_PATH = resolve(process.cwd(), "output", "open-memory", "qos-soak-latest.json");
const DB_RUNTIME_OVERRIDES_PATH = resolve(process.cwd(), "output", "open-memory", "db-runtime-overrides.env");
const DB_AUDIT_PATH = resolve(process.cwd(), "output", "open-memory", "postgres-audit-latest.json");
const DB_EMBEDDING_NORMALIZE_REPORT_PATH = resolve(
  process.cwd(),
  "output",
  "open-memory",
  "postgres-embedding-normalize-latest.json"
);
const INGEST_GUARD_RUNTIME_OVERRIDES_PATH = resolve(
  process.cwd(),
  "output",
  "open-memory",
  "ingest-guard-runtime-overrides.env"
);

function run(cmd) {
  return spawnSync("bash", ["-lc", cmd], { encoding: "utf8" });
}

function tmuxHas(name) {
  const res = spawnSync("tmux", ["has-session", "-t", name], { encoding: "utf8" });
  return res.status === 0;
}

function tmuxStart(name, command) {
  return spawnSync("tmux", ["new-session", "-d", "-s", name, command], { encoding: "utf8" });
}

function tmuxKill(name) {
  return spawnSync("tmux", ["kill-session", "-t", name], { encoding: "utf8" });
}

function userServiceIsActive(name) {
  const res = spawnSync("systemctl", ["--user", "is-active", name], { encoding: "utf8" });
  return String(res.stdout || "").trim() === "active";
}

function userServiceIsEnabled(name) {
  const res = spawnSync("systemctl", ["--user", "is-enabled", name], { encoding: "utf8" });
  return res.status === 0 && String(res.stdout || "").trim() === "enabled";
}

function disableUserServiceNow(name) {
  const res = spawnSync("systemctl", ["--user", "disable", "--now", name], { encoding: "utf8" });
  const output = `${String(res.stdout || "").trim()} ${String(res.stderr || "").trim()}`.trim();
  return {
    ok: res.status === 0,
    output: output || null,
  };
}

function shellQuote(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf8");
    const env = {};
    for (const lineRaw of raw.split(/\r?\n/)) {
      const line = lineRaw.trim();
      if (!line || line.startsWith("#")) continue;
      const idx = line.indexOf("=");
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (!key) continue;
      env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

function parseJsonObjectFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (!(line.startsWith("{") || line.startsWith("["))) continue;
      try {
        return JSON.parse(line);
      } catch {
        // continue
      }
    }
    return null;
  }
}

function readIntFromEnvMap(env, key, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(env?.[key] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function readNumberFromEnvMap(env, key, fallback, { min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(env?.[key] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function buildStudioBrainEnvAssignments(role = "query") {
  const defaults = {
    STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_BACKFILL: 2,
    STUDIO_BRAIN_MAX_CONCURRENT_BACKFILLS: 1,
    STUDIO_BRAIN_BACKFILL_RETRY_AFTER_SECONDS: 30,
    STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_QUERY_DEGRADE: 3,
    STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_QUERY_SHED: 10,
    STUDIO_BRAIN_MAX_ACTIVE_SEARCH_REQUESTS: 26,
    STUDIO_BRAIN_MAX_ACTIVE_CONTEXT_REQUESTS: 16,
    STUDIO_BRAIN_MAX_ACTIVE_MEMORY_QUERY_REQUESTS: 36,
    STUDIO_BRAIN_MEMORY_QUERY_RETRY_AFTER_SECONDS: 4,
    STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_LIMIT_CAP: 9,
    STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_SCAN_LIMIT_CAP: 110,
    STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_MAX_ITEMS_CAP: 9,
    STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_MAX_CHARS_CAP: 5400,
    STUDIO_BRAIN_MEMORY_QUERY_ROUTE_TIMEOUT_MS: 16000,
    STUDIO_BRAIN_MEMORY_QUERY_ADAPTIVE_ENABLED: true,
    STUDIO_BRAIN_MEMORY_QUERY_LEXICAL_TIMEOUT_FALLBACK: true,
    STUDIO_BRAIN_MEMORY_QUERY_ADAPTIVE_P95_TARGET_MS: 1200,
    STUDIO_BRAIN_MEMORY_QUERY_ADAPTIVE_MIN_FACTOR: 0.45,
    STUDIO_BRAIN_MEMORY_QUERY_ADAPTIVE_MAX_FACTOR: 1.2,
    STUDIO_BRAIN_MEMORY_QUERY_ADAPTIVE_SAMPLE_WINDOW: 240,
    STUDIO_BRAIN_MEMORY_QUERY_QUEUE_ENABLED: true,
    STUDIO_BRAIN_MEMORY_QUERY_INTERACTIVE_QUEUE_WAIT_MS: 1200,
    STUDIO_BRAIN_MEMORY_QUERY_QUEUE_POLL_MS: 120,
    STUDIO_BRAIN_ENFORCE_SINGLE_RUNTIME: true,
    STUDIO_BRAIN_PROCESS_LOCK_PATH: "/home/wuff/monsoonfire-portal/studio-brain/.studio-brain.runtime.lock",
    STUDIO_BRAIN_PG_POOL_MAX: 8,
    STUDIO_BRAIN_PG_CONNECTION_TIMEOUT_MS: 10000,
    STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS: 20000,
    STUDIO_BRAIN_PG_STATEMENT_TIMEOUT_MS: 17000,
    STUDIO_BRAIN_PG_LOCK_TIMEOUT_MS: 4000,
    STUDIO_BRAIN_PG_IDLE_IN_TRANSACTION_TIMEOUT_MS: 15000,
    STUDIO_BRAIN_PG_APPLICATION_NAME: "studiobrain-ops-stack",
  };
  const overrides = parseEnvFile(DB_RUNTIME_OVERRIDES_PATH);
  const protectedOverrideKeys = new Set([
    "STUDIO_BRAIN_PORT",
    "STUDIO_BRAIN_PROCESS_LOCK_PATH",
    "STUDIO_BRAIN_PG_APPLICATION_NAME",
  ]);
  const safeOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([key]) => !protectedOverrideKeys.has(String(key)))
  );
  const normalizedRole = String(role || "query").trim().toLowerCase();
  const roleSpecific =
    normalizedRole === "ingest"
      ? {
          STUDIO_BRAIN_PORT: STUDIO_BRAIN_INGEST_PORT,
          STUDIO_BRAIN_PROCESS_LOCK_PATH: "/home/wuff/monsoonfire-portal/studio-brain/.studio-brain.ingest.runtime.lock",
          STUDIO_BRAIN_PG_APPLICATION_NAME: "studiobrain-ingest",
          STUDIO_BRAIN_PG_POOL_MAX: 6,
          STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS: 12000,
          STUDIO_BRAIN_PG_STATEMENT_TIMEOUT_MS: 12000,
          STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_QUERY_DEGRADE: 2,
          STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_QUERY_SHED: 6,
          STUDIO_BRAIN_MAX_ACTIVE_SEARCH_REQUESTS: 8,
          STUDIO_BRAIN_MAX_ACTIVE_CONTEXT_REQUESTS: 3,
          STUDIO_BRAIN_MAX_ACTIVE_MEMORY_QUERY_REQUESTS: 10,
          STUDIO_BRAIN_MEMORY_QUERY_ROUTE_TIMEOUT_MS: 16000,
          STUDIO_BRAIN_MEMORY_QUERY_ADAPTIVE_P95_TARGET_MS: 900,
          STUDIO_BRAIN_MEMORY_QUERY_ADAPTIVE_MIN_FACTOR: 0.3,
          STUDIO_BRAIN_MEMORY_QUERY_ADAPTIVE_MAX_FACTOR: 0.95,
          STUDIO_BRAIN_MEMORY_QUERY_INTERACTIVE_QUEUE_WAIT_MS: 600,
          STUDIO_BRAIN_MEMORY_QUERY_QUEUE_POLL_MS: 80,
        }
      : {
          STUDIO_BRAIN_PORT: STUDIO_BRAIN_QUERY_PORT,
          STUDIO_BRAIN_PROCESS_LOCK_PATH: "/home/wuff/monsoonfire-portal/studio-brain/.studio-brain.query.runtime.lock",
          STUDIO_BRAIN_PG_APPLICATION_NAME: "studiobrain-query",
          STUDIO_BRAIN_PG_POOL_MAX: 12,
          STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS: 26000,
          STUDIO_BRAIN_PG_STATEMENT_TIMEOUT_MS: 24000,
          STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_BACKFILL: 2,
          STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_QUERY_DEGRADE: 3,
          STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_QUERY_SHED: 4,
          STUDIO_BRAIN_MAX_ACTIVE_SEARCH_REQUESTS: 36,
          STUDIO_BRAIN_MAX_ACTIVE_CONTEXT_REQUESTS: 20,
          STUDIO_BRAIN_MAX_ACTIVE_MEMORY_QUERY_REQUESTS: 48,
          STUDIO_BRAIN_MEMORY_QUERY_ROUTE_TIMEOUT_MS: 24000,
          STUDIO_BRAIN_MEMORY_QUERY_STAGE_TIMEOUT_MS: 6500,
          STUDIO_BRAIN_MEMORY_QUERY_FALLBACK_STAGE_TIMEOUT_MS: 12000,
          STUDIO_BRAIN_MEMORY_QUERY_EMBED_TIMEOUT_MS: 2500,
          STUDIO_BRAIN_MEMORY_QUERY_ADAPTIVE_P95_TARGET_MS: 2200,
          STUDIO_BRAIN_MEMORY_QUERY_ADAPTIVE_MIN_FACTOR: 0.72,
          STUDIO_BRAIN_MEMORY_QUERY_ADAPTIVE_MAX_FACTOR: 1.6,
          STUDIO_BRAIN_MEMORY_QUERY_INTERACTIVE_QUEUE_WAIT_MS: 1500,
        };
  const merged = { ...defaults, ...safeOverrides, ...roleSpecific };
  return Object.entries(merged).map(([key, value]) => `${key}=${shellQuote(value)}`);
}

function ensureDbRuntimeOverrides() {
  if (!existsSync(DB_AUDIT_PATH)) {
    run("node ./scripts/open-memory-db-audit.mjs --json true >/dev/null 2>&1 || true");
  }
  const tuned = run("node ./scripts/open-memory-db-autotune.mjs --json true");
  return {
    ok: tuned.status === 0,
    output: String(tuned.stdout || "").trim().slice(0, 4000),
    error: String(tuned.stderr || "").trim().slice(0, 2000),
  };
}

function buildStudioBrainCommand(role = "query") {
  return [
    "cd /home/wuff/monsoonfire-portal/studio-brain",
    "&&",
    ...buildStudioBrainEnvAssignments(role),
    "node lib/index.js",
  ].join(" ");
}

function buildMemoryGuardCommand() {
  const overrides = parseEnvFile(INGEST_GUARD_RUNTIME_OVERRIDES_PATH);
  const limit = readIntFromEnvMap(overrides, "OPEN_MEMORY_GUARD_LIMIT", 1200, { min: 100, max: 20000 });
  const maxWrites = readIntFromEnvMap(overrides, "OPEN_MEMORY_GUARD_MAX_WRITES", 300, { min: 20, max: 10000 });
  const pressureDeferCooldownCycles = readIntFromEnvMap(overrides, "OPEN_MEMORY_GUARD_PRESSURE_DEFER_COOLDOWN_CYCLES", 2, {
    min: 0,
    max: 10000,
  });
  const experimentalSearchLimit = readIntFromEnvMap(overrides, "OPEN_MEMORY_GUARD_EXPERIMENTAL_SEARCH_LIMIT", 60, {
    min: 10,
    max: 500,
  });
  const experimentalSearchSeedLimit = readIntFromEnvMap(
    overrides,
    "OPEN_MEMORY_GUARD_EXPERIMENTAL_SEARCH_SEED_LIMIT",
    6,
    { min: 1, max: 100 }
  );
  const experimentalMaxSearchQueries = readIntFromEnvMap(
    overrides,
    "OPEN_MEMORY_GUARD_EXPERIMENTAL_MAX_SEARCH_QUERIES",
    4,
    { min: 1, max: 100 }
  );
  const experimentalRerankTopK = readIntFromEnvMap(overrides, "OPEN_MEMORY_GUARD_EXPERIMENTAL_RERANK_TOP_K", 240, {
    min: 10,
    max: 5000,
  });
  const experimentalFallbackMaxWrites = readIntFromEnvMap(
    overrides,
    "OPEN_MEMORY_GUARD_EXPERIMENTAL_FALLBACK_MAX_WRITES",
    4,
    { min: 1, max: 500 }
  );
  const experimentalProfileIngestFactor = readNumberFromEnvMap(
    overrides,
    "OPEN_MEMORY_GUARD_EXPERIMENTAL_PROFILE_INGEST_FACTOR",
    0.7,
    { min: 0.1, max: 2.5 }
  );
  return [
    "cd /home/wuff/monsoonfire-portal",
    "&&",
    `STUDIO_BRAIN_BASE_URL=http://${STUDIO_BRAIN_HOST}:${STUDIO_BRAIN_INGEST_PORT}`,
    "node ./scripts/open-memory-ingest-guard.mjs",
    "--cycles 0",
    "--phases email,mail-signal,global-signal,experimental-context",
    "--interval-ms 120000",
    "--limit",
    String(limit),
    "--max-writes",
    String(maxWrites),
    "--dry-run-max-waves 1",
    "--apply-max-waves 1",
    "--timeout-ms 30000",
    "--phase-run-timeout-ms 90000",
    "--phase-run-retries 0",
    "--phase-run-retry-delay-ms 10000",
    "--request-retries 1",
    "--retry-base-delay-ms 1500",
    "--retry-max-delay-ms 10000",
    "--retry-jitter-ms 300",
    "--max-consecutive-http-errors 3",
    "--cooldown-after-http-error-ms 5000",
    "--adaptive-downshift-on-http-error true",
    "--guard-downshift-factor 0.75",
    "--guard-recovery-factor 0.35",
    "--guard-min-limit 250",
    "--guard-min-max-writes 80",
    "--pause-after-failed-cycle-ms 120000",
    "--phase-failure-threshold 3",
    "--phase-cooldown-cycles 3",
    "--pressure-defer-cooldown-cycles",
    String(pressureDeferCooldownCycles),
    "--experimental-search-limit",
    String(experimentalSearchLimit),
    "--experimental-search-seed-limit",
    String(experimentalSearchSeedLimit),
    "--experimental-max-search-queries",
    String(experimentalMaxSearchQueries),
    "--experimental-rerank-top-k",
    String(experimentalRerankTopK),
    "--experimental-rerank-signal-weight 0.58",
    "--experimental-rerank-recency-weight 0.2",
    "--experimental-rerank-seed-overlap-weight 0.22",
    "--experimental-rerank-query-rank-weight 0.12",
    "--experimental-defer-on-pressure true",
    "--experimental-pressure-timeout-ms 5000",
    "--experimental-participant-noise-filter true",
    "--experimental-max-consecutive-search-failures 1",
    "--experimental-recent-retries 1",
    "--experimental-recent-retry-delay-ms 1000",
    "--experimental-fallback-max-writes",
    String(experimentalFallbackMaxWrites),
    "--experimental-fallback-timeout-ms 8000",
    "--experimental-adaptive-mode true",
    "--experimental-min-search-limit 20",
    "--experimental-min-search-seed-limit 3",
    "--experimental-min-max-search-queries 2",
    "--experimental-min-fallback-max-writes 2",
    "--experimental-min-rerank-top-k 80",
    "--experimental-profile-ingest-factor",
    String(Number(experimentalProfileIngestFactor.toFixed(4))),
    "--experimental-profile-catchup-factor 1.2",
    "--experimental-dedupe-window-days 14",
    "--experimental-novelty-weight 0.24",
    "--experimental-refresh-confidence-delta 0.08",
    "--experimental-adaptive-thresholds true",
    "--experimental-min-edge-confidence-floor 0.5",
    "--experimental-max-edge-confidence-ceiling 0.88",
    "--experimental-min-motif-score-floor 1.0",
    "--experimental-max-motif-score-ceiling 2.6",
    "--experimental-min-edge-support 2",
    "--experimental-min-edge-confidence 0.58",
    "--experimental-min-motif-score 1.2",
    "--experimental-max-motifs 24",
    "--experimental-max-edges 48",
    "--experimental-capture-source open-memory:experimental-context-index",
    "--forced-reindex-every 12",
    "--forced-reindex-writes 150",
    "--report output/open-memory/ingest-guard-live.json",
    ">> output/open-memory/ingest-guard-live.log 2>&1",
  ].join(" ");
}

function buildSupervisorCommand() {
  return [
    "cd /home/wuff/monsoonfire-portal",
    "&&",
    "node ./scripts/open-memory-ops-supervisor.mjs",
    "--watch true",
    "--interval-ms 10000",
    `--base-url http://${STUDIO_BRAIN_HOST}:${STUDIO_BRAIN_QUERY_PORT}`,
    `--ingest-base-url http://${STUDIO_BRAIN_HOST}:${STUDIO_BRAIN_INGEST_PORT}`,
    "--qos-remediation-enabled true",
    "--qos-remediation-cooldown-ms 900000",
    "--qos-warn-streak-for-remediation 3",
    "--qos-fail-streak-for-remediation 2",
    "--qos-guard-downshift-enabled true",
    "--qos-guard-downshift-warn-streak 2",
    "--qos-guard-downshift-fail-streak 1",
    "--qos-guard-profile-cooldown-ms 300000",
    "--qos-adaptive-thresholds-enabled true",
    "--qos-adaptive-target-p95-ms 2200",
    "--qos-adaptive-target-p99-ms 4800",
    "--qos-adaptive-min-deferred-warn-rate 0.08",
    "--qos-adaptive-max-deferred-warn-rate 0.30",
    "--qos-adaptive-tighten-step 0.02",
    "--qos-adaptive-relax-step 0.01",
    "--db-embedding-normalize-enabled true",
    "--db-embedding-normalize-apply false",
    "--db-embedding-normalize-cooldown-ms 21600000",
    ">> output/open-memory/ops-supervisor.log 2>&1",
  ].join(" ");
}

function guardReportAgeSeconds() {
  if (!existsSync(GUARD_REPORT_PATH)) return null;
  try {
    const raw = readFileSync(GUARD_REPORT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const updatedAt = Date.parse(String(parsed.updatedAt ?? ""));
    if (!Number.isFinite(updatedAt)) return null;
    return Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  } catch {
    return null;
  }
}

function supervisorReportAgeSeconds() {
  if (!existsSync(SUPERVISOR_REPORT_PATH)) return null;
  try {
    const raw = readFileSync(SUPERVISOR_REPORT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const generatedAt = Date.parse(String(parsed.generatedAt ?? ""));
    if (!Number.isFinite(generatedAt)) return null;
    return Math.max(0, Math.round((Date.now() - generatedAt) / 1000));
  } catch {
    return null;
  }
}

function supervisorLatestSummary() {
  if (!existsSync(SUPERVISOR_REPORT_PATH)) return null;
  try {
    const raw = readFileSync(SUPERVISOR_REPORT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : null,
      severity: String(parsed.severity ?? "ok"),
      actions: Array.isArray(parsed.actions) ? parsed.actions.map((value) => String(value)) : [],
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts.map((value) => String(value)) : [],
    };
  } catch {
    return null;
  }
}

function dbMaintenanceReportAgeSeconds() {
  if (!existsSync(DB_MAINTENANCE_REPORT_PATH)) return null;
  try {
    const raw = readFileSync(DB_MAINTENANCE_REPORT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const generatedAt = Date.parse(String(parsed.generatedAt ?? ""));
    if (!Number.isFinite(generatedAt)) return null;
    return Math.max(0, Math.round((Date.now() - generatedAt) / 1000));
  } catch {
    return null;
  }
}

function dbMaintenanceLatestSummary() {
  if (!existsSync(DB_MAINTENANCE_REPORT_PATH)) return null;
  try {
    const raw = readFileSync(DB_MAINTENANCE_REPORT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : null,
      status: String(parsed.status ?? "unknown"),
      failures: Array.isArray(parsed.failures) ? parsed.failures.map((value) => String(value)) : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map((value) => String(value)) : [],
      remediationAttempted: parsed?.remediation?.attempted === true,
      remediationOk: parsed?.remediation?.ok === true,
    };
  } catch {
    return null;
  }
}

function dbEmbeddingNormalizeReportAgeSeconds() {
  if (!existsSync(DB_EMBEDDING_NORMALIZE_REPORT_PATH)) return null;
  try {
    const raw = readFileSync(DB_EMBEDDING_NORMALIZE_REPORT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const generatedAt = Date.parse(String(parsed.generatedAt ?? ""));
    if (!Number.isFinite(generatedAt)) return null;
    return Math.max(0, Math.round((Date.now() - generatedAt) / 1000));
  } catch {
    return null;
  }
}

function dbEmbeddingNormalizeLatestSummary() {
  if (!existsSync(DB_EMBEDDING_NORMALIZE_REPORT_PATH)) return null;
  try {
    const raw = readFileSync(DB_EMBEDDING_NORMALIZE_REPORT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : null,
      status: String(parsed.status ?? "unknown"),
      mode: String(parsed.mode ?? "unknown"),
      selectedDimension: Number(parsed.selectedDimension ?? 0) || null,
      migratedRows: Number(parsed?.summary?.migratedRows ?? 0) || 0,
      pendingConvertibleRowsAfter: Number(parsed?.summary?.pendingConvertibleRowsAfter ?? 0) || 0,
    };
  } catch {
    return null;
  }
}

function guardRuntimeProfileSummary() {
  const env = parseEnvFile(INGEST_GUARD_RUNTIME_OVERRIDES_PATH);
  const profile = String(env.OPEN_MEMORY_GUARD_PROFILE || "baseline").trim().toLowerCase() || "baseline";
  return {
    profile,
    limit: readIntFromEnvMap(env, "OPEN_MEMORY_GUARD_LIMIT", 1200, { min: 1, max: 1_000_000 }),
    maxWrites: readIntFromEnvMap(env, "OPEN_MEMORY_GUARD_MAX_WRITES", 300, { min: 1, max: 1_000_000 }),
    searchLimit: readIntFromEnvMap(env, "OPEN_MEMORY_GUARD_EXPERIMENTAL_SEARCH_LIMIT", 60, { min: 1, max: 1_000_000 }),
    maxSearchQueries: readIntFromEnvMap(env, "OPEN_MEMORY_GUARD_EXPERIMENTAL_MAX_SEARCH_QUERIES", 4, {
      min: 1,
      max: 1_000_000,
    }),
  };
}

function processCount(pattern, { nodeOnly = true } = {}) {
  const res = run(`pgrep -af ${JSON.stringify(pattern)}`);
  const entries = String(res.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (!match) return null;
      return {
        pid: Number.parseInt(match[1], 10),
        command: String(match[2] || ""),
      };
    })
    .filter((entry) => entry && Number.isFinite(entry.pid) && entry.pid > 1)
    .filter((entry) => entry.pid !== process.pid)
    .filter((entry) => !/\bpgrep -af\b/.test(entry.command))
    .filter((entry) => !/open-memory-ops-stack\.mjs\b/.test(entry.command));
  if (nodeOnly) {
    return entries.filter((entry) => /^node\b/.test(entry.command)).length;
  }
  return entries.length;
}

function processCwd(pid) {
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return "";
  }
}

function processCountInCwd(pattern, cwd, { nodeOnly = false } = {}) {
  const res = run(`pgrep -af ${JSON.stringify(pattern)}`);
  const entries = String(res.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (!match) return null;
      return {
        pid: Number.parseInt(match[1], 10),
        command: String(match[2] || ""),
      };
    })
    .filter((entry) => entry && Number.isFinite(entry.pid) && entry.pid > 1)
    .filter((entry) => entry.pid !== process.pid)
    .filter((entry) => !/\bpgrep -af\b/.test(entry.command))
    .filter((entry) => !/open-memory-ops-stack\.mjs\b/.test(entry.command))
    .filter((entry) => processCwd(entry.pid) === cwd);
  if (nodeOnly) {
    return entries.filter((entry) => /^node\b/.test(entry.command)).length;
  }
  return entries.length;
}

function listenerCount(port) {
  const res = run(`ss -ltnp | rg ':${String(port)}' | wc -l`);
  const parsed = Number.parseInt(String(res.stdout || "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function healthz(baseUrl) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/healthz`);
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, status: 0, message: error instanceof Error ? error.message : String(error) };
  }
}

function parseAction(argv) {
  const action = String(argv[2] ?? "status").trim().toLowerCase();
  return action || "status";
}

async function main() {
  const action = parseAction(process.argv);
  const queryBaseUrl = `http://${STUDIO_BRAIN_HOST}:${STUDIO_BRAIN_QUERY_PORT}`;
  const ingestBaseUrl = `http://${STUDIO_BRAIN_HOST}:${STUDIO_BRAIN_INGEST_PORT}`;

  if (action === "up") {
    const events = [];
    const studioBrainServiceActive = userServiceIsActive(STUDIO_BRAIN_USER_SERVICE);
    const studioBrainServiceEnabled = userServiceIsEnabled(STUDIO_BRAIN_USER_SERVICE);
    if (studioBrainServiceActive || studioBrainServiceEnabled) {
      const serviceDisabled = disableUserServiceNow(STUDIO_BRAIN_USER_SERVICE);
      events.push({
        step: "studio-brain-user-service-disable",
        service: STUDIO_BRAIN_USER_SERVICE,
        attempted: true,
        ok: serviceDisabled.ok,
        output: serviceDisabled.output,
      });
    }
    const dbOverrides = ensureDbRuntimeOverrides();
    events.push({
      step: "db-runtime-overrides",
      ok: dbOverrides.ok,
      error: dbOverrides.error || null,
    });
    if (!tmuxHas(STUDIO_BRAIN_SESSION)) {
      const res = tmuxStart(STUDIO_BRAIN_SESSION, buildStudioBrainCommand("query"));
      events.push({ session: STUDIO_BRAIN_SESSION, started: res.status === 0, stderr: (res.stderr || "").trim() || null });
    }
    if (!tmuxHas(STUDIO_BRAIN_INGEST_SESSION)) {
      const res = tmuxStart(STUDIO_BRAIN_INGEST_SESSION, buildStudioBrainCommand("ingest"));
      events.push({
        session: STUDIO_BRAIN_INGEST_SESSION,
        started: res.status === 0,
        stderr: (res.stderr || "").trim() || null,
      });
    }
    if (!tmuxHas(MEMORY_GUARD_SESSION)) {
      const res = tmuxStart(MEMORY_GUARD_SESSION, buildMemoryGuardCommand());
      events.push({ session: MEMORY_GUARD_SESSION, started: res.status === 0, stderr: (res.stderr || "").trim() || null });
    }
    if (!tmuxHas(MEMORY_SUPERVISOR_SESSION)) {
      const res = tmuxStart(MEMORY_SUPERVISOR_SESSION, buildSupervisorCommand());
      events.push({ session: MEMORY_SUPERVISOR_SESSION, started: res.status === 0, stderr: (res.stderr || "").trim() || null });
    }
    process.stdout.write(`${JSON.stringify({ ok: true, action: "up", events }, null, 2)}\n`);
    return;
  }

  if (action === "down") {
    const events = [];
    if (tmuxHas(MEMORY_SUPERVISOR_SESSION)) {
      const res = tmuxKill(MEMORY_SUPERVISOR_SESSION);
      events.push({ session: MEMORY_SUPERVISOR_SESSION, stopped: res.status === 0 });
    }
    if (tmuxHas(MEMORY_GUARD_SESSION)) {
      const res = tmuxKill(MEMORY_GUARD_SESSION);
      events.push({ session: MEMORY_GUARD_SESSION, stopped: res.status === 0 });
    }
    if (tmuxHas(STUDIO_BRAIN_INGEST_SESSION)) {
      const res = tmuxKill(STUDIO_BRAIN_INGEST_SESSION);
      events.push({ session: STUDIO_BRAIN_INGEST_SESSION, stopped: res.status === 0 });
    }
    process.stdout.write(`${JSON.stringify({ ok: true, action: "down", events }, null, 2)}\n`);
    return;
  }

  if (action === "recycle" || action === "restart-all") {
    const events = [];
    const studioBrainServiceActive = userServiceIsActive(STUDIO_BRAIN_USER_SERVICE);
    const studioBrainServiceEnabled = userServiceIsEnabled(STUDIO_BRAIN_USER_SERVICE);
    if (studioBrainServiceActive || studioBrainServiceEnabled) {
      const serviceDisabled = disableUserServiceNow(STUDIO_BRAIN_USER_SERVICE);
      events.push({
        step: "studio-brain-user-service-disable",
        service: STUDIO_BRAIN_USER_SERVICE,
        attempted: true,
        ok: serviceDisabled.ok,
        output: serviceDisabled.output,
      });
    }
    for (const session of [MEMORY_SUPERVISOR_SESSION, MEMORY_GUARD_SESSION, STUDIO_BRAIN_INGEST_SESSION, STUDIO_BRAIN_SESSION]) {
      if (!tmuxHas(session)) continue;
      const res = tmuxKill(session);
      events.push({
        session,
        stopped: res.status === 0,
        stderr: String(res.stderr || "").trim() || null,
      });
    }
    const dbOverrides = ensureDbRuntimeOverrides();
    events.push({
      step: "db-runtime-overrides",
      ok: dbOverrides.ok,
      error: dbOverrides.error || null,
    });
    for (const [session, command] of [
      [STUDIO_BRAIN_SESSION, buildStudioBrainCommand("query")],
      [STUDIO_BRAIN_INGEST_SESSION, buildStudioBrainCommand("ingest")],
      [MEMORY_GUARD_SESSION, buildMemoryGuardCommand()],
      [MEMORY_SUPERVISOR_SESSION, buildSupervisorCommand()],
    ]) {
      const res = tmuxStart(session, command);
      events.push({
        session,
        started: res.status === 0,
        stderr: String(res.stderr || "").trim() || null,
      });
    }
    process.stdout.write(`${JSON.stringify({ ok: true, action: action === "restart-all" ? "restart-all" : "recycle", events }, null, 2)}\n`);
    return;
  }

  if (action === "chaos-guard") {
    if (tmuxHas(MEMORY_GUARD_SESSION)) {
      tmuxKill(MEMORY_GUARD_SESSION);
    }
    let restarted = false;
    for (let i = 0; i < 10; i += 1) {
      if (tmuxHas(MEMORY_GUARD_SESSION)) {
        restarted = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    process.stdout.write(`${JSON.stringify({ ok: restarted, action: "chaos-guard", restarted }, null, 2)}\n`);
    return;
  }

  if (action === "chaos-brain") {
    if (tmuxHas(STUDIO_BRAIN_SESSION)) {
      tmuxKill(STUDIO_BRAIN_SESSION);
    }
    let restarted = false;
    for (let i = 0; i < 15; i += 1) {
      if (tmuxHas(STUDIO_BRAIN_SESSION)) {
        const h = await healthz(queryBaseUrl);
        if (h.ok) {
          restarted = true;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    process.stdout.write(`${JSON.stringify({ ok: restarted, action: "chaos-brain", restarted }, null, 2)}\n`);
    return;
  }

  if (action === "qos-soak") {
    const command = [
      "node ./scripts/open-memory-query-qos-probe.mjs",
      "--base-url",
      shellQuote(queryBaseUrl),
      "--rounds 12",
      "--burst 4",
      "--between-round-ms 350",
      "--timeout-ms 30000",
      "--query",
      shellQuote("email ownership escalation"),
      "--json true",
    ].join(" ");
    const runResult = run(command);
    const parsed = parseJsonObjectFromText(runResult.stdout);
    if (parsed && typeof parsed === "object") {
      mkdirSync(dirname(QOS_SOAK_REPORT_PATH), { recursive: true });
      writeFileSync(QOS_SOAK_REPORT_PATH, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: runResult.status === 0,
          action: "qos-soak",
          command,
          exitCode: runResult.status,
          reportPath: QOS_SOAK_REPORT_PATH,
          aggregate: parsed?.aggregate || null,
          stderr: String(runResult.stderr || "").trim() || null,
        },
        null,
        2
      )}\n`
    );
    return;
  }

  if (
    action === "db-embedding-normalize"
    || action === "db-embedding-normalize-plan"
    || action === "db-embedding-normalize-apply"
    || action === "db-embedding-normalize-rollback"
  ) {
    const base = [
      "node ./scripts/open-memory-db-embedding-normalize.mjs",
      "--json true",
      "--out",
      shellQuote(DB_EMBEDDING_NORMALIZE_REPORT_PATH),
    ];
    if (action === "db-embedding-normalize-apply") {
      base.push("--apply true");
    } else if (action === "db-embedding-normalize-rollback") {
      base.push("--rollback true");
    }
    const command = base.join(" ");
    const runResult = run(command);
    const parsed = parseJsonObjectFromText(runResult.stdout);
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: runResult.status === 0,
          action,
          command,
          exitCode: runResult.status,
          reportPath: DB_EMBEDDING_NORMALIZE_REPORT_PATH,
          status: parsed?.status || null,
          mode: parsed?.mode || null,
          summary: parsed?.summary || null,
          warnings: Array.isArray(parsed?.warnings) ? parsed.warnings : [],
          errors: Array.isArray(parsed?.errors) ? parsed.errors : [],
          stderr: String(runResult.stderr || "").trim() || null,
        },
        null,
        2
      )}\n`
    );
    return;
  }

  const health = await healthz(queryBaseUrl);
  const ingestHealth = await healthz(ingestBaseUrl);
  const guardAge = guardReportAgeSeconds();
  const supervisorAge = supervisorReportAgeSeconds();
  const dbMaintenanceAge = dbMaintenanceReportAgeSeconds();
  const dbEmbeddingNormalizeAge = dbEmbeddingNormalizeReportAgeSeconds();
  const supervisorLatest = supervisorLatestSummary();
  const dbMaintenanceLatest = dbMaintenanceLatestSummary();
  const dbEmbeddingNormalizeLatest = dbEmbeddingNormalizeLatestSummary();
  const guardRuntimeProfile = guardRuntimeProfileSummary();
  const status = {
    ok: true,
    action: "status",
    sessions: {
      studioBrain: tmuxHas(STUDIO_BRAIN_SESSION),
      studioBrainIngest: tmuxHas(STUDIO_BRAIN_INGEST_SESSION),
      memoryGuard: tmuxHas(MEMORY_GUARD_SESSION),
      memorySupervisor: tmuxHas(MEMORY_SUPERVISOR_SESSION),
    },
    systemd: {
      studioBrainServiceActive: userServiceIsActive(STUDIO_BRAIN_USER_SERVICE),
      studioBrainServiceEnabled: userServiceIsEnabled(STUDIO_BRAIN_USER_SERVICE),
    },
    health,
    ingestHealth,
    processes: {
      guard: processCount("open-memory-ingest-guard.mjs --cycles 0"),
      supervisor: processCount("open-memory-ops-supervisor.mjs --watch true"),
      queryListeners: listenerCount(STUDIO_BRAIN_QUERY_PORT),
      ingestListeners: listenerCount(STUDIO_BRAIN_INGEST_PORT),
      converge: processCount("open-memory-backfill-converge.mjs"),
      contextIndexer: processCount("open-memory-context-experimental-index.mjs"),
      contextCapture: processCount("open-memory-context-experimental-capture.mjs"),
      imports: processCount("open-memory.mjs import"),
      competingStudioBrainDev: processCountInCwd("npm run dev", STUDIO_BRAIN_WORKDIR, { nodeOnly: false }),
      competingStudioBrainBuildRunner: processCountInCwd("npm run build && node lib/index.js", STUDIO_BRAIN_WORKDIR, {
        nodeOnly: false,
      }),
    },
    guardReportAgeSeconds: guardAge,
    supervisorReportAgeSeconds: supervisorAge,
    dbMaintenanceReportAgeSeconds: dbMaintenanceAge,
    dbEmbeddingNormalizeReportAgeSeconds: dbEmbeddingNormalizeAge,
    supervisorLatest,
    dbMaintenanceLatest,
    dbEmbeddingNormalizeLatest,
    guardRuntimeProfile,
  };

  if (action === "doctor") {
    const critical = [];
    if (!status.sessions.studioBrain) critical.push("studio-brain session missing");
    if (!status.sessions.studioBrainIngest) critical.push("studio-brain-ingest session missing");
    if (!status.sessions.memoryGuard) critical.push("memory-guard session missing");
    if (!status.sessions.memorySupervisor) critical.push("memory-supervisor session missing");
    if (status.systemd.studioBrainServiceActive) {
      critical.push("systemd user service studio-brain.service is active (competes with tmux runtime)");
    }
    if (!status.health.ok) critical.push("studio-brain healthz failing");
    if (!status.ingestHealth.ok) critical.push("studio-brain-ingest healthz failing");
    if ((status.processes.queryListeners ?? 0) <= 0) critical.push("studio-brain query listener missing");
    if ((status.processes.ingestListeners ?? 0) <= 0) critical.push("studio-brain ingest listener missing");
    if (typeof guardAge === "number" && guardAge > 420) critical.push(`guard report stale (${guardAge}s)`);
    if (typeof supervisorAge === "number" && supervisorAge > 120) critical.push(`supervisor report stale (${supervisorAge}s)`);
    if (typeof dbMaintenanceAge === "number" && dbMaintenanceAge > 5400) {
      critical.push(`db maintenance report stale (${dbMaintenanceAge}s)`);
    }
    if (typeof dbEmbeddingNormalizeAge === "number" && dbEmbeddingNormalizeAge > 172800) {
      critical.push(`db embedding normalize report stale (${dbEmbeddingNormalizeAge}s)`);
    }
    if (dbMaintenanceLatest?.status === "fail") {
      critical.push("db maintenance latest status is fail");
    }
    if (dbEmbeddingNormalizeLatest?.status === "fail") {
      critical.push("db embedding normalize latest status is fail");
    }
    const competingRunnerDetected =
      (status.processes.competingStudioBrainDev ?? 0) > 0 || (status.processes.competingStudioBrainBuildRunner ?? 0) > 0;
    const supervisorMitigatingCompetingRunners =
      Array.isArray(supervisorLatest?.actions)
      && supervisorLatest.actions.some((value) => /killed-competing-studio-brain-runners/i.test(value));
    const supervisorFresh = typeof supervisorAge === "number" && supervisorAge <= 30;
    const supervisorActivelyWatching = status.sessions.memorySupervisor && (status.processes.supervisor ?? 0) > 0;
    if (
      competingRunnerDetected
      && !supervisorMitigatingCompetingRunners
      && !(supervisorFresh && supervisorActivelyWatching)
    ) {
      critical.push("competing studio-brain dev/build runners detected (port/throughput contention risk)");
    }
    const activePlatformIssue =
      !status.sessions.studioBrain
      || !status.sessions.studioBrainIngest
      || !status.sessions.memoryGuard
      || !status.sessions.memorySupervisor
      || !status.health.ok
      || !status.ingestHealth.ok;
    if (supervisorLatest?.severity === "critical" && activePlatformIssue) {
      critical.push("supervisor latest severity is critical with active platform issue");
    }
    if (Array.isArray(supervisorLatest?.actions) && supervisorLatest.actions.some((value) => /failed-to-start/i.test(value))) {
      critical.push("supervisor reported failed starts");
    }
    if (
      Array.isArray(supervisorLatest?.actions)
      && supervisorLatest.actions.some((value) => /qos-remediation:failed/i.test(value))
    ) {
      critical.push("supervisor reported failed qos remediation restart action");
    }
    const result = {
      ...status,
      action: "doctor",
      critical,
      healthy: critical.length === 0,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (critical.length > 0) {
      process.exit(2);
    }
    return;
  }

  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`open-memory-ops-stack failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
