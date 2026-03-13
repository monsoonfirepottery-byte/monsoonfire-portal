#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_GUARD_REPORT = resolve(process.cwd(), "output", "open-memory", "ingest-guard-live.json");
const DEFAULT_STATE_FILE = resolve(process.cwd(), "output", "open-memory", "ops-supervisor-state.json");
const DEFAULT_REPORT_FILE = resolve(process.cwd(), "output", "open-memory", "ops-supervisor-latest.json");
const DEFAULT_EVENT_LOG_FILE = resolve(process.cwd(), "output", "open-memory", "ops-supervisor-events.jsonl");
const DEFAULT_DB_MAINTENANCE_REPORT = resolve(process.cwd(), "output", "open-memory", "db-maintenance-latest.json");
const DEFAULT_DB_EMBEDDING_NORMALIZE_REPORT = resolve(
  process.cwd(),
  "output",
  "open-memory",
  "postgres-embedding-normalize-latest.json"
);
const DEFAULT_QOS_MAINTENANCE_REPORT = resolve(process.cwd(), "output", "open-memory", "qos-supervisor-latest.json");
const DB_RUNTIME_OVERRIDES_PATH = resolve(process.cwd(), "output", "open-memory", "db-runtime-overrides.env");
const DB_AUDIT_PATH = resolve(process.cwd(), "output", "open-memory", "postgres-audit-latest.json");
const INGEST_GUARD_RUNTIME_OVERRIDES_PATH = resolve(
  process.cwd(),
  "output",
  "open-memory",
  "ingest-guard-runtime-overrides.env"
);
const STUDIO_BRAIN_WORKDIR = "/home/wuff/monsoonfire-portal/studio-brain";
const STUDIO_BRAIN_QUERY_SESSION = "studio-brain";
const STUDIO_BRAIN_INGEST_SESSION = "studio-brain-ingest";
const STUDIO_BRAIN_QUERY_PORT = 8787;
const STUDIO_BRAIN_INGEST_PORT = 8788;
const STUDIO_BRAIN_HOST = "192.168.1.226";
const MEMORY_GUARD_SESSION = "memory-guard";
const DB_REMEDIATE_TRIGGER_CODES = new Set([
  "connection_utilization_high",
  "connections_waiting",
  "idle_in_transaction_detected",
  "long_running_queries",
  "long_running_query_detected",
  "temp_spill_active",
  "table_dead_tuple_pressure",
  "work_mem_too_low",
  "statement_timeout_missing",
  "lock_timeout_missing",
  "idle_transaction_timeout_missing",
  "autovacuum_disabled",
  "track_io_timing_disabled",
  "checkpoint_target_too_low",
  "pg_stat_statements_missing",
]);
const DB_REMEDIATE_TRIGGER_TERMS = [
  "connection",
  "waiting",
  "idle in transaction",
  "long-running",
  "long running",
  "dead tuple",
  "autovacuum",
  "statement timeout",
  "lock timeout",
  "pg_stat_statements",
  "temp spill",
];

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] ?? "");
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).trim().toLowerCase();
    if (key.includes("=")) {
      const [rawKey, ...rest] = key.split("=");
      flags[rawKey.trim().toLowerCase()] = rest.join("=");
      continue;
    }
    const next = argv[i + 1];
    if (next && !String(next).startsWith("--")) {
      flags[key] = String(next);
      i += 1;
    } else {
      flags[key] = "true";
    }
  }
  return flags;
}

function readBool(flags, key, fallback = false) {
  const raw = String(flags[key] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function readInt(flags, key, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(flags[key] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function readString(flags, key, fallback = "") {
  const raw = String(flags[key] ?? "").trim();
  return raw || fallback;
}

function readFloat(flags, key, fallback, { min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(flags[key] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function clampRate(value, fallback = 0.15, { min = 0, max = 1 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(min, Math.min(max, fallback));
  return Math.max(min, Math.min(max, parsed));
}

function roundNumber(value, decimals = 4) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(Math.max(0, Math.min(6, Math.trunc(decimals)))));
}

function truncateText(text, max = 1500) {
  const value = String(text || "").trim();
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function run(cmd) {
  return spawnSync("bash", ["-lc", cmd], { encoding: "utf8" });
}

function parsePgrepLines(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (!match) return null;
      return { pid: Number.parseInt(match[1], 10), command: match[2] };
    })
    .filter((entry) => entry && Number.isFinite(entry.pid) && entry.pid > 1);
}

function processCwd(pid) {
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return "";
  }
}

function listCompetingStudioBrainRunners() {
  const matches = [];
  const dev = run("pgrep -af 'npm run dev'");
  const builders = run("pgrep -af 'npm run build && node lib/index.js'");
  for (const entry of [...parsePgrepLines(dev.stdout), ...parsePgrepLines(builders.stdout)]) {
    const command = String(entry.command || "");
    if (!(command.includes("npm run dev") || command.includes("npm run build && node lib/index.js"))) continue;
    const cwd = processCwd(entry.pid);
    if (!cwd || cwd !== STUDIO_BRAIN_WORKDIR) continue;
    matches.push({
      pid: entry.pid,
      command,
      cwd,
    });
  }
  const deduped = new Map();
  for (const entry of matches) {
    deduped.set(entry.pid, entry);
  }
  return Array.from(deduped.values());
}

function killPid(pid, dryRun) {
  if (dryRun) return { ok: true, dryRun: true };
  const res = spawnSync("kill", [String(pid)], { encoding: "utf8" });
  const stderr = String(res.stderr || "").trim();
  if (res.status !== 0 && /no such process/i.test(stderr)) {
    return {
      ok: true,
      dryRun: false,
      alreadyGone: true,
      stderr: null,
    };
  }
  return {
    ok: res.status === 0,
    dryRun: false,
    stderr: stderr || null,
  };
}

function enforceSingleStudioBrainRuntime(dryRun) {
  const competing = listCompetingStudioBrainRunners();
  const killed = [];
  const errors = [];
  for (const entry of competing) {
    const result = killPid(entry.pid, dryRun);
    if (result.ok) {
      killed.push({
        pid: entry.pid,
        command: entry.command,
      });
    } else {
      errors.push({
        pid: entry.pid,
        command: entry.command,
        error: result.stderr || "kill-failed",
      });
    }
  }
  return {
    found: competing.length,
    killed,
    errors,
  };
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
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i];
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

function readJsonFileSafe(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function tmuxHasSession(name) {
  const res = spawnSync("tmux", ["has-session", "-t", name], { encoding: "utf8" });
  return res.status === 0;
}

function tmuxKillSession(name, dryRun) {
  if (dryRun) {
    return { killed: false, dryRun: true };
  }
  const res = spawnSync("tmux", ["kill-session", "-t", name], { encoding: "utf8" });
  return {
    killed: res.status === 0,
    dryRun: false,
    stderr: (res.stderr || "").trim() || null,
  };
}

function tmuxStartSession(name, command, dryRun) {
  if (dryRun) {
    return { started: false, dryRun: true, command };
  }
  const res = spawnSync("tmux", ["new-session", "-d", "-s", name, command], { encoding: "utf8" });
  return {
    started: res.status === 0,
    dryRun: false,
    command,
    stderr: (res.stderr || "").trim() || null,
  };
}

function tmuxRestartSession(name, command, dryRun) {
  const kill = tmuxHasSession(name) ? tmuxKillSession(name, dryRun) : { skipped: true };
  const start = tmuxStartSession(name, command, dryRun);
  return {
    restarted: Boolean(start.started || start.dryRun),
    kill,
    start,
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

function buildGuardRuntimeProfile(profile) {
  const normalized = String(profile || "baseline").trim().toLowerCase();
  if (normalized === "severe") {
    return {
      OPEN_MEMORY_GUARD_PROFILE: "severe",
      OPEN_MEMORY_GUARD_LIMIT: 420,
      OPEN_MEMORY_GUARD_MAX_WRITES: 90,
      OPEN_MEMORY_GUARD_EXPERIMENTAL_SEARCH_LIMIT: 28,
      OPEN_MEMORY_GUARD_EXPERIMENTAL_SEARCH_SEED_LIMIT: 3,
      OPEN_MEMORY_GUARD_EXPERIMENTAL_MAX_SEARCH_QUERIES: 2,
      OPEN_MEMORY_GUARD_EXPERIMENTAL_RERANK_TOP_K: 96,
      OPEN_MEMORY_GUARD_EXPERIMENTAL_FALLBACK_MAX_WRITES: 1,
      OPEN_MEMORY_GUARD_EXPERIMENTAL_PROFILE_INGEST_FACTOR: 0.45,
      OPEN_MEMORY_GUARD_PRESSURE_DEFER_COOLDOWN_CYCLES: 4,
    };
  }
  if (normalized === "moderate") {
    return {
      OPEN_MEMORY_GUARD_PROFILE: "moderate",
      OPEN_MEMORY_GUARD_LIMIT: 760,
      OPEN_MEMORY_GUARD_MAX_WRITES: 180,
      OPEN_MEMORY_GUARD_EXPERIMENTAL_SEARCH_LIMIT: 40,
      OPEN_MEMORY_GUARD_EXPERIMENTAL_SEARCH_SEED_LIMIT: 4,
      OPEN_MEMORY_GUARD_EXPERIMENTAL_MAX_SEARCH_QUERIES: 3,
      OPEN_MEMORY_GUARD_EXPERIMENTAL_RERANK_TOP_K: 132,
      OPEN_MEMORY_GUARD_EXPERIMENTAL_FALLBACK_MAX_WRITES: 2,
      OPEN_MEMORY_GUARD_EXPERIMENTAL_PROFILE_INGEST_FACTOR: 0.58,
      OPEN_MEMORY_GUARD_PRESSURE_DEFER_COOLDOWN_CYCLES: 3,
    };
  }
  return {
    OPEN_MEMORY_GUARD_PROFILE: "baseline",
    OPEN_MEMORY_GUARD_LIMIT: 1200,
    OPEN_MEMORY_GUARD_MAX_WRITES: 300,
    OPEN_MEMORY_GUARD_EXPERIMENTAL_SEARCH_LIMIT: 60,
    OPEN_MEMORY_GUARD_EXPERIMENTAL_SEARCH_SEED_LIMIT: 6,
    OPEN_MEMORY_GUARD_EXPERIMENTAL_MAX_SEARCH_QUERIES: 4,
    OPEN_MEMORY_GUARD_EXPERIMENTAL_RERANK_TOP_K: 240,
    OPEN_MEMORY_GUARD_EXPERIMENTAL_FALLBACK_MAX_WRITES: 4,
    OPEN_MEMORY_GUARD_EXPERIMENTAL_PROFILE_INGEST_FACTOR: 0.7,
    OPEN_MEMORY_GUARD_PRESSURE_DEFER_COOLDOWN_CYCLES: 2,
  };
}

function writeGuardRuntimeOverrides(profile, dryRun) {
  const values = buildGuardRuntimeProfile(profile);
  const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value)}`);
  const payload = `${lines.join("\n")}\n`;
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      profile: values.OPEN_MEMORY_GUARD_PROFILE,
      path: INGEST_GUARD_RUNTIME_OVERRIDES_PATH,
      values,
    };
  }
  try {
    mkdirSync(dirname(INGEST_GUARD_RUNTIME_OVERRIDES_PATH), { recursive: true });
    writeFileSync(INGEST_GUARD_RUNTIME_OVERRIDES_PATH, payload, "utf8");
    return {
      ok: true,
      dryRun: false,
      profile: values.OPEN_MEMORY_GUARD_PROFILE,
      path: INGEST_GUARD_RUNTIME_OVERRIDES_PATH,
      values,
    };
  } catch (error) {
    return {
      ok: false,
      dryRun: false,
      profile: values.OPEN_MEMORY_GUARD_PROFILE,
      path: INGEST_GUARD_RUNTIME_OVERRIDES_PATH,
      values,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
    STUDIO_BRAIN_PG_APPLICATION_NAME: "studiobrain-ops-supervisor",
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
    output: String(tuned.stdout || "").trim().slice(0, 2000),
    error: String(tuned.stderr || "").trim().slice(0, 1000),
  };
}

function shouldRunDbRemediation(auditReport, remediateOnWarn) {
  if (!auditReport || typeof auditReport !== "object") {
    return {
      shouldRun: false,
      reason: "audit-report-unavailable",
      status: "unknown",
      triggerCode: null,
    };
  }
  const recommendations = Array.isArray(auditReport.recommendations) ? auditReport.recommendations : [];
  const status = String(auditReport.status || "unknown").toLowerCase();
  const critical = recommendations.find((rec) => String(rec?.severity || "").toLowerCase() === "critical");
  if (critical) {
    return {
      shouldRun: true,
      reason: "critical-recommendation",
      status,
      triggerCode: String(critical.code || ""),
    };
  }
  if (!remediateOnWarn) {
    return {
      shouldRun: false,
      reason: "warn-remediation-disabled",
      status,
      triggerCode: null,
    };
  }
  for (const rec of recommendations) {
    const severity = String(rec?.severity || "").toLowerCase();
    if (severity !== "warn") continue;
    const code = String(rec?.code || "").trim().toLowerCase();
    const message = `${String(rec?.message || "")} ${String(rec?.action || "")}`.toLowerCase();
    if (code && DB_REMEDIATE_TRIGGER_CODES.has(code)) {
      return {
        shouldRun: true,
        reason: "warn-trigger-code",
        status,
        triggerCode: code,
      };
    }
    if (DB_REMEDIATE_TRIGGER_TERMS.some((term) => message.includes(term))) {
      return {
        shouldRun: true,
        reason: "warn-trigger-text",
        status,
        triggerCode: code || null,
      };
    }
  }
  return {
    shouldRun: false,
    reason: "no-remediation-trigger",
    status,
    triggerCode: null,
  };
}

function shouldRunEmbeddingNormalizationPlan(auditReport) {
  if (!auditReport || typeof auditReport !== "object") {
    return {
      shouldRun: false,
      reason: "audit-report-unavailable",
    };
  }
  const recommendations = Array.isArray(auditReport.recommendations) ? auditReport.recommendations : [];
  for (const rec of recommendations) {
    const code = String(rec?.code || "").trim().toLowerCase();
    if (code === "embedding_column_legacy_array_type") {
      return {
        shouldRun: true,
        reason: "legacy-embedding-column-detected",
      };
    }
  }
  return {
    shouldRun: false,
    reason: "no-legacy-embedding-signal",
  };
}

function buildIndexLifecycleCommand({ apply, allowDropIndexes }) {
  const parts = ["node ./scripts/open-memory-db-index-lifecycle.mjs", "--json true"];
  if (apply) {
    parts.push("--apply true");
  }
  if (Array.isArray(allowDropIndexes) && allowDropIndexes.length > 0) {
    parts.push("--allow-drop-indexes", shellQuote(allowDropIndexes.join(",")));
  }
  return parts.join(" ");
}

function runDbMaintenanceCycle({
  reportPath,
  allowRemediation,
  remediateOnWarn,
  remediateCooldownActive,
  lifecycleApply,
  lifecycleAllowDropIndexes,
  embeddingNormalizeEnabled,
  embeddingNormalizeApply,
  embeddingNormalizeCooldownActive,
  embeddingNormalizeReportPath,
}) {
  const startedAt = new Date().toISOString();
  const auditRun = run("node ./scripts/open-memory-db-audit.mjs --json true");
  const autotuneRun = run("node ./scripts/open-memory-db-autotune.mjs --json true");
  const lifecycleCommand = buildIndexLifecycleCommand({
    apply: lifecycleApply,
    allowDropIndexes: lifecycleAllowDropIndexes,
  });
  const lifecycleRun = run(lifecycleCommand);
  const auditReport = readJsonFileSafe(DB_AUDIT_PATH);
  const remediateDecision = shouldRunDbRemediation(auditReport, remediateOnWarn);
  const remediation = {
    attempted: false,
    ok: true,
    reason: "not-requested",
    trigger: remediateDecision,
    command: null,
    output: "",
    error: "",
  };
  const embeddingDecision = shouldRunEmbeddingNormalizationPlan(auditReport);
  const embeddingNormalization = {
    enabled: embeddingNormalizeEnabled,
    attempted: false,
    apply: embeddingNormalizeApply,
    ok: true,
    reason: "not-requested",
    trigger: embeddingDecision,
    command: null,
    status: null,
    summary: null,
    output: "",
    error: "",
  };

  if (allowRemediation && remediateDecision.shouldRun && !remediateCooldownActive) {
    remediation.attempted = true;
    remediation.reason = "triggered";
    remediation.command = "node ./scripts/open-memory-db-remediate.mjs --apply true --json true";
    const remediateRun = run(remediation.command);
    remediation.ok = remediateRun.status === 0;
    remediation.output = truncateText(remediateRun.stdout);
    remediation.error = truncateText(remediateRun.stderr);
  } else if (remediateCooldownActive && remediateDecision.shouldRun) {
    remediation.reason = "cooldown-active";
  } else {
    remediation.reason = allowRemediation ? "no-trigger" : "remediation-disabled";
  }

  if (embeddingNormalizeEnabled && embeddingDecision.shouldRun && !embeddingNormalizeCooldownActive) {
    embeddingNormalization.attempted = true;
    embeddingNormalization.reason = "triggered";
    embeddingNormalization.command = [
      "node ./scripts/open-memory-db-embedding-normalize.mjs",
      "--json true",
      "--out",
      shellQuote(String(embeddingNormalizeReportPath || DEFAULT_DB_EMBEDDING_NORMALIZE_REPORT)),
      embeddingNormalizeApply ? "--apply true" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const normalizeRun = run(embeddingNormalization.command);
    const normalizeParsed = parseJsonObjectFromText(normalizeRun.stdout);
    embeddingNormalization.ok =
      normalizeRun.status === 0 && normalizeParsed?.ok !== false && String(normalizeParsed?.status || "") !== "fail";
    embeddingNormalization.status = String(normalizeParsed?.status || "").trim() || null;
    embeddingNormalization.summary = normalizeParsed?.summary || null;
    embeddingNormalization.output = truncateText(normalizeRun.stdout);
    embeddingNormalization.error = truncateText(normalizeRun.stderr);
  } else if (embeddingNormalizeCooldownActive && embeddingDecision.shouldRun) {
    embeddingNormalization.reason = "cooldown-active";
  } else {
    embeddingNormalization.reason = embeddingNormalizeEnabled ? "no-trigger" : "embedding-normalize-disabled";
  }

  const steps = {
    audit: {
      ok: auditRun.status === 0,
      exitCode: auditRun.status,
      stdout: truncateText(auditRun.stdout),
      stderr: truncateText(auditRun.stderr),
    },
    autotune: {
      ok: autotuneRun.status === 0,
      exitCode: autotuneRun.status,
      stdout: truncateText(autotuneRun.stdout),
      stderr: truncateText(autotuneRun.stderr),
    },
    lifecycle: {
      ok: lifecycleRun.status === 0,
      exitCode: lifecycleRun.status,
      command: lifecycleCommand,
      stdout: truncateText(lifecycleRun.stdout),
      stderr: truncateText(lifecycleRun.stderr),
    },
  };

  const failures = [];
  if (!steps.audit.ok) failures.push("audit");
  if (!steps.autotune.ok) failures.push("autotune");
  if (!steps.lifecycle.ok) failures.push("lifecycle");
  if (remediation.attempted && !remediation.ok) failures.push("remediation");
  if (embeddingNormalization.attempted && !embeddingNormalization.ok) failures.push("embedding-normalization");
  const warnings = [];
  if (remediation.reason === "cooldown-active") warnings.push("remediation-cooldown-active");
  if (embeddingNormalization.reason === "cooldown-active") warnings.push("embedding-normalization-cooldown-active");
  if (embeddingNormalization.attempted && embeddingNormalization.ok && !embeddingNormalization.apply) {
    warnings.push("embedding-normalization-plan-generated");
  }
  const lifecycleSummary = parseJsonObjectFromText(steps.lifecycle.stdout);
  if (lifecycleSummary?.summary && Number(lifecycleSummary.summary.eligibleForDrop ?? 0) > 0 && !lifecycleApply) {
    warnings.push("eligible-indexes-waiting-for-allowlist-apply");
  }

  const status = failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass";
  const result = {
    schemaVersion: "1",
    generatedAt: new Date().toISOString(),
    startedAt,
    status,
    failures,
    warnings,
    remediation,
    embeddingNormalization,
    lifecycle: {
      apply: lifecycleApply,
      allowDropIndexes: lifecycleAllowDropIndexes,
      summary: lifecycleSummary?.summary || null,
    },
    auditStatus: String(auditReport?.status || "unknown"),
    auditCounts: auditReport?.counts || null,
    steps,
  };

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

function runQosProbeCycle({
  reportPath,
  rounds,
  burst,
  deferredWarnRate,
  baseUrl,
}) {
  const command = [
    "node ./scripts/open-memory-query-qos-probe.mjs",
    "--base-url",
    shellQuote(String(baseUrl || `http://${STUDIO_BRAIN_HOST}:${STUDIO_BRAIN_QUERY_PORT}`)),
    "--rounds",
    String(Math.max(1, rounds)),
    "--burst",
    String(Math.max(1, burst)),
    "--query",
    shellQuote("email ownership escalation"),
  ].join(" ");
  const runResult = run(command);
  const parsed = parseJsonObjectFromText(runResult.stdout);
  const aggregate = parsed?.aggregate && typeof parsed.aggregate === "object" ? parsed.aggregate : null;
  const deferredRate = Number(aggregate?.deferredRate ?? 0);
  const failed = Number(aggregate?.failed ?? 0);
  const degradedEmptyRate = Number(aggregate?.degradedEmptyRate ?? 0);
  const interactiveDegradedEmptyRate = Number(aggregate?.byLane?.interactive?.degradedEmpty ?? 0)
    / Math.max(1, Number(aggregate?.byLane?.interactive?.total ?? 0));
  const bulkDegradedEmptyRate = Number(aggregate?.byLane?.bulk?.degradedEmpty ?? 0)
    / Math.max(1, Number(aggregate?.byLane?.bulk?.total ?? 0));
  const interactiveDeferredRate = Number(aggregate?.byLane?.interactive?.deferred ?? 0)
    / Math.max(1, Number(aggregate?.byLane?.interactive?.total ?? 0));
  const bulkDeferredRate = Number(aggregate?.byLane?.bulk?.deferred ?? 0)
    / Math.max(1, Number(aggregate?.byLane?.bulk?.total ?? 0));
  const latencyP95Ms = Number(aggregate?.latency?.overall?.p95Ms ?? 0);
  const latencyP99Ms = Number(aggregate?.latency?.overall?.p99Ms ?? 0);
  const staleCacheFallbackRate =
    Number(aggregate?.staleCacheFallbackRate ?? 0) + Number(aggregate?.contextStaleCacheFallbackRate ?? 0);
  const lexicalTimeoutFallbackRate = Number(aggregate?.lexicalTimeoutFallbackRate ?? 0);
  const rescueFallbackRate = staleCacheFallbackRate + lexicalTimeoutFallbackRate;
  const degradedEmptyWarnRate = Math.max(0.2, Number(deferredWarnRate) * 1.15);
  const degradedEmptyCriticalRate = Math.max(0.5, degradedEmptyWarnRate * 1.8);
  const highLatencyWarn = latencyP95Ms >= 2500 || latencyP99Ms >= 5000;
  const bulkOnlyProtectiveShed =
    bulkDeferredRate >= 0.25
    && interactiveDeferredRate < 0.05
    && bulkDegradedEmptyRate >= 0.25
    && interactiveDegradedEmptyRate < 0.05;
  const degradedEmptyUnrescued =
    degradedEmptyRate >= degradedEmptyCriticalRate
    && interactiveDegradedEmptyRate >= degradedEmptyCriticalRate
    && rescueFallbackRate < 0.1
    && !bulkOnlyProtectiveShed;
  const status = runResult.status !== 0
    ? "fail"
    : degradedEmptyUnrescued
      ? "fail"
    : failed > 0
      ? "warn"
      : deferredRate >= deferredWarnRate || degradedEmptyRate >= degradedEmptyWarnRate || highLatencyWarn
        ? "warn"
        : "pass";
  const warnings = [];
  const failures = [];
  if (runResult.status !== 0) failures.push("qos-probe-command-failed");
  if (degradedEmptyUnrescued) failures.push(`qos-degraded-empty-unrescued:${Number(degradedEmptyRate.toFixed(4))}`);
  if (failed > 0) warnings.push(`qos-probe-failures:${failed}`);
  if (deferredRate >= deferredWarnRate) {
    warnings.push(`qos-deferred-rate-high:${Number(deferredRate.toFixed(4))}`);
  }
  if (degradedEmptyRate >= degradedEmptyWarnRate) {
    warnings.push(`qos-degraded-empty-rate-high:${Number(degradedEmptyRate.toFixed(4))}`);
  }
  if (bulkOnlyProtectiveShed) {
    warnings.push(
      `qos-bulk-protective-shed:bulkDeferred=${Number(bulkDeferredRate.toFixed(4))}:interactiveDeferred=${Number(
        interactiveDeferredRate.toFixed(4)
      )}`
    );
  }
  if (highLatencyWarn) {
    warnings.push(`qos-latency-high:p95=${Number(latencyP95Ms.toFixed(2))}:p99=${Number(latencyP99Ms.toFixed(2))}`);
  }
  if (rescueFallbackRate > 0) {
    warnings.push(`qos-rescue-fallback-rate:${Number(rescueFallbackRate.toFixed(4))}`);
  }
  const result = {
    schemaVersion: "1",
    generatedAt: new Date().toISOString(),
    status,
    rounds: Math.max(1, rounds),
    burst: Math.max(1, burst),
    deferredWarnRate,
    aggregate,
    failures,
    warnings,
    command,
    commandExitCode: runResult.status,
    stdout: truncateText(runResult.stdout, 3000),
    stderr: truncateText(runResult.stderr, 1500),
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

function adaptQosDeferredWarnRate({
  currentRate,
  aggregate,
  minRate,
  maxRate,
  targetP95Ms,
  targetP99Ms,
  tightenStep,
  relaxStep,
}) {
  const safeCurrent = clampRate(currentRate, 0.15, { min: minRate, max: maxRate });
  const p95 = Number(aggregate?.latency?.overall?.p95Ms ?? 0);
  const p99 = Number(aggregate?.latency?.overall?.p99Ms ?? 0);
  const deferredRate = Number(aggregate?.deferredRate ?? 0);
  const degradedEmptyRate = Number(aggregate?.degradedEmptyRate ?? 0);
  const failed = Number(aggregate?.failed ?? 0);

  const stressByLatency =
    (targetP95Ms > 0 && p95 > targetP95Ms)
    || (targetP99Ms > 0 && p99 > targetP99Ms);
  const stressByErrors = failed > 0 || degradedEmptyRate >= Math.max(0.22, safeCurrent * 1.15);
  const stress = stressByLatency || stressByErrors;

  const healthyLatency =
    (targetP95Ms <= 0 || (p95 > 0 && p95 < targetP95Ms * 0.75))
    && (targetP99Ms <= 0 || (p99 > 0 && p99 < targetP99Ms * 0.75));
  const healthySignals =
    failed === 0
    && degradedEmptyRate < Math.max(0.08, safeCurrent * 0.55)
    && deferredRate < Math.max(0.06, safeCurrent * 0.6);
  const healthy = !stress && healthyLatency && healthySignals;

  let nextRate = safeCurrent;
  let reason = "hold";
  if (stress) {
    nextRate = clampRate(safeCurrent - Math.max(0.001, tightenStep), safeCurrent, {
      min: minRate,
      max: maxRate,
    });
    reason = "tighten";
  } else if (healthy) {
    nextRate = clampRate(safeCurrent + Math.max(0.001, relaxStep), safeCurrent, {
      min: minRate,
      max: maxRate,
    });
    reason = "relax";
  }

  return {
    changed: Math.abs(nextRate - safeCurrent) >= 0.0001,
    reason,
    currentRate: roundNumber(safeCurrent, 4),
    nextRate: roundNumber(nextRate, 4),
    minRate: roundNumber(minRate, 4),
    maxRate: roundNumber(maxRate, 4),
    targetP95Ms: Number(targetP95Ms),
    targetP99Ms: Number(targetP99Ms),
    observedP95Ms: roundNumber(p95, 2),
    observedP99Ms: roundNumber(p99, 2),
    observedDeferredRate: roundNumber(deferredRate, 4),
    observedDegradedEmptyRate: roundNumber(degradedEmptyRate, 4),
    observedFailed: Number(failed),
    stress,
    healthy,
  };
}

async function fetchHealth(baseUrl, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/healthz`, {
      method: "GET",
      signal: controller.signal,
    });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: `health-request-failed:${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, Math.max(0, ms));
  });
}

async function postWebhook(url, payload, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: text,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
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

function snapshotProcesses() {
  const guardRes = run("pgrep -af 'open-memory-ingest-guard.mjs --cycles 0'");
  const queryRes = run(`ss -ltnp | rg ':${STUDIO_BRAIN_QUERY_PORT}' | wc -l`);
  const ingestRes = run(`ss -ltnp | rg ':${STUDIO_BRAIN_INGEST_PORT}' | wc -l`);
  const guardCount = String(guardRes.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^\d+\s+node\b/.test(line)).length;
  const queryCount = Number.parseInt(String(queryRes.stdout || "").trim(), 10);
  const ingestCount = Number.parseInt(String(ingestRes.stdout || "").trim(), 10);
  return {
    guardCount: Number.isFinite(guardCount) ? guardCount : 0,
    studioBrainQueryListenerCount: Number.isFinite(queryCount) ? queryCount : 0,
    studioBrainIngestListenerCount: Number.isFinite(ingestCount) ? ingestCount : 0,
    studioBrainListenerCount: Number.isFinite(queryCount) ? queryCount : 0,
  };
}

function readGuardSnapshot(reportPath) {
  if (!existsSync(reportPath)) {
    return {
      exists: false,
      reportPath,
      stale: true,
      staleSeconds: null,
      updatedAt: null,
      cycle: null,
      parseError: null,
    };
  }
  try {
    const raw = readFileSync(reportPath, "utf8");
    const report = JSON.parse(raw);
    const updatedAtRaw = typeof report.updatedAt === "string" ? report.updatedAt : "";
    const updatedAtMs = Date.parse(updatedAtRaw);
    const staleSeconds = Number.isFinite(updatedAtMs) ? Math.max(0, Math.round((Date.now() - updatedAtMs) / 1000)) : null;
    return {
      exists: true,
      reportPath,
      stale: false,
      staleSeconds,
      updatedAt: Number.isFinite(updatedAtMs) ? new Date(updatedAtMs).toISOString() : null,
      cycle: Number(report?.latest?.cycle ?? 0) || null,
      parseError: null,
    };
  } catch (error) {
    return {
      exists: true,
      reportPath,
      stale: true,
      staleSeconds: null,
      updatedAt: null,
      cycle: null,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function defaultState() {
  return {
    brainConsecutiveHealthFailures: 0,
    ingestConsecutiveHealthFailures: 0,
    guardConsecutiveStale: 0,
    lastBrainRestartAtMs: 0,
    lastIngestRestartAtMs: 0,
    lastGuardRestartAtMs: 0,
    totalBrainRestarts: 0,
    totalIngestRestarts: 0,
    totalGuardRestarts: 0,
    totalBrainRecoveries: 0,
    totalIngestRecoveries: 0,
    totalGuardRecoveries: 0,
    lastAlertAtMs: 0,
    totalAlerts: 0,
    lastAlertReason: "",
    lastDbMaintenanceAtMs: 0,
    totalDbMaintenanceRuns: 0,
    lastDbRemediateAtMs: 0,
    totalDbRemediations: 0,
    lastDbEmbeddingNormalizeAtMs: 0,
    totalDbEmbeddingNormalizeRuns: 0,
    lastDbEmbeddingNormalizeApplyAtMs: 0,
    totalDbEmbeddingNormalizeApplyRuns: 0,
    lastQosRunAtMs: 0,
    totalQosRuns: 0,
    qosConsecutiveWarn: 0,
    qosConsecutiveFail: 0,
    qosAdaptiveDeferredWarnRate: 0,
    qosAdaptiveLastP95Ms: 0,
    qosAdaptiveLastP99Ms: 0,
    qosAdaptiveLastUpdatedAtMs: 0,
    lastQosRemediationAtMs: 0,
    totalQosRemediations: 0,
    guardRuntimeProfile: "baseline",
    lastGuardProfileChangeAtMs: 0,
    totalGuardProfileChanges: 0,
  };
}

function loadState(statePath) {
  if (!existsSync(statePath)) return defaultState();
  try {
    const raw = readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      brainConsecutiveHealthFailures: Number(parsed.brainConsecutiveHealthFailures ?? 0) || 0,
      ingestConsecutiveHealthFailures: Number(parsed.ingestConsecutiveHealthFailures ?? 0) || 0,
      guardConsecutiveStale: Number(parsed.guardConsecutiveStale ?? 0) || 0,
      lastBrainRestartAtMs: Number(parsed.lastBrainRestartAtMs ?? 0) || 0,
      lastIngestRestartAtMs: Number(parsed.lastIngestRestartAtMs ?? 0) || 0,
      lastGuardRestartAtMs: Number(parsed.lastGuardRestartAtMs ?? 0) || 0,
      totalBrainRestarts: Number(parsed.totalBrainRestarts ?? 0) || 0,
      totalIngestRestarts: Number(parsed.totalIngestRestarts ?? 0) || 0,
      totalGuardRestarts: Number(parsed.totalGuardRestarts ?? 0) || 0,
      totalBrainRecoveries: Number(parsed.totalBrainRecoveries ?? 0) || 0,
      totalIngestRecoveries: Number(parsed.totalIngestRecoveries ?? 0) || 0,
      totalGuardRecoveries: Number(parsed.totalGuardRecoveries ?? 0) || 0,
      lastAlertAtMs: Number(parsed.lastAlertAtMs ?? 0) || 0,
      totalAlerts: Number(parsed.totalAlerts ?? 0) || 0,
      lastAlertReason: String(parsed.lastAlertReason ?? ""),
      lastDbMaintenanceAtMs: Number(parsed.lastDbMaintenanceAtMs ?? 0) || 0,
      totalDbMaintenanceRuns: Number(parsed.totalDbMaintenanceRuns ?? 0) || 0,
      lastDbRemediateAtMs: Number(parsed.lastDbRemediateAtMs ?? 0) || 0,
      totalDbRemediations: Number(parsed.totalDbRemediations ?? 0) || 0,
      lastDbEmbeddingNormalizeAtMs: Number(parsed.lastDbEmbeddingNormalizeAtMs ?? 0) || 0,
      totalDbEmbeddingNormalizeRuns: Number(parsed.totalDbEmbeddingNormalizeRuns ?? 0) || 0,
      lastDbEmbeddingNormalizeApplyAtMs: Number(parsed.lastDbEmbeddingNormalizeApplyAtMs ?? 0) || 0,
      totalDbEmbeddingNormalizeApplyRuns: Number(parsed.totalDbEmbeddingNormalizeApplyRuns ?? 0) || 0,
      lastQosRunAtMs: Number(parsed.lastQosRunAtMs ?? 0) || 0,
      totalQosRuns: Number(parsed.totalQosRuns ?? 0) || 0,
      qosConsecutiveWarn: Number(parsed.qosConsecutiveWarn ?? 0) || 0,
      qosConsecutiveFail: Number(parsed.qosConsecutiveFail ?? 0) || 0,
      qosAdaptiveDeferredWarnRate: Number(parsed.qosAdaptiveDeferredWarnRate ?? 0) || 0,
      qosAdaptiveLastP95Ms: Number(parsed.qosAdaptiveLastP95Ms ?? 0) || 0,
      qosAdaptiveLastP99Ms: Number(parsed.qosAdaptiveLastP99Ms ?? 0) || 0,
      qosAdaptiveLastUpdatedAtMs: Number(parsed.qosAdaptiveLastUpdatedAtMs ?? 0) || 0,
      lastQosRemediationAtMs: Number(parsed.lastQosRemediationAtMs ?? 0) || 0,
      totalQosRemediations: Number(parsed.totalQosRemediations ?? 0) || 0,
      guardRuntimeProfile: String(parsed.guardRuntimeProfile ?? "baseline") || "baseline",
      lastGuardProfileChangeAtMs: Number(parsed.lastGuardProfileChangeAtMs ?? 0) || 0,
      totalGuardProfileChanges: Number(parsed.totalGuardProfileChanges ?? 0) || 0,
    };
  } catch {
    return defaultState();
  }
}

function saveState(statePath, state) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function saveReport(reportPath, report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function appendEvent(eventLogPath, event) {
  mkdirSync(dirname(eventLogPath), { recursive: true });
  appendFileSync(eventLogPath, `${JSON.stringify(event)}\n`, "utf8");
}

function pruneEventLog(eventLogPath, maxLines) {
  if (!existsSync(eventLogPath)) return;
  const boundedMax = Math.max(100, maxLines);
  try {
    const raw = readFileSync(eventLogPath, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length <= boundedMax) return;
    const kept = lines.slice(lines.length - boundedMax);
    writeFileSync(eventLogPath, `${kept.join("\n")}\n`, "utf8");
  } catch {}
}

function withinCooldown(nowMs, lastMs, cooldownMs) {
  return nowMs - Math.max(0, lastMs) < Math.max(0, cooldownMs);
}

function printHuman(result) {
  const lines = [];
  lines.push("Open Memory Ops Supervisor");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Severity: ${result.severity}`);
  lines.push(`Studio Brain query session present: ${String(result.studioBrain.sessionPresent)}`);
  lines.push(`Studio Brain ingest session present: ${String(result.studioBrainIngest?.sessionPresent)}`);
  lines.push(`Memory Guard session present: ${String(result.memoryGuard.sessionPresent)}`);
  lines.push(
    `Query health: ok=${String(result.health.ok)} status=${result.health.status} | Ingest health: ok=${String(
      result.healthIngest?.ok
    )} status=${result.healthIngest?.status ?? 0}`
  );
  lines.push(
    `Guard report: exists=${String(result.guardReport.exists)} stale=${String(result.guardReport.stale)} staleSeconds=${
      result.guardReport.staleSeconds ?? "n/a"
    }`
  );
  lines.push(
    `Process snapshot: queryListeners=${result.processes.studioBrainQueryListenerCount}, ingestListeners=${result.processes.studioBrainIngestListenerCount}, guardProcesses=${result.processes.guardCount}`
  );
  if (result.actions.length > 0) {
    lines.push("Actions:");
    for (const action of result.actions) {
      lines.push(`- ${action}`);
    }
  }
  if (result.dbMaintenance) {
    lines.push(
      `DB maintenance: status=${result.dbMaintenance.status} failures=${result.dbMaintenance.failures.length} warnings=${result.dbMaintenance.warnings.length}`
    );
    if (result.dbMaintenance.remediation?.attempted) {
      lines.push(`DB remediation attempted: ${String(result.dbMaintenance.remediation.ok)}`);
    }
    if (result.dbMaintenance.embeddingNormalization?.attempted) {
      lines.push(
        `DB embedding normalization attempted: ${String(result.dbMaintenance.embeddingNormalization.ok)} apply=${String(
          result.dbMaintenance.embeddingNormalization.apply
        )}`
      );
    }
  }
  if (result.qosMaintenance) {
    lines.push(
      `QoS maintenance: status=${result.qosMaintenance.status} failures=${result.qosMaintenance.failures.length} warnings=${result.qosMaintenance.warnings.length}`
    );
    lines.push(
      `QoS aggregate: deferredRate=${Number(result.qosMaintenance?.aggregate?.deferredRate ?? 0)}, degradedEmptyRate=${Number(
        result.qosMaintenance?.aggregate?.degradedEmptyRate ?? 0
      )}, staleCacheFallbackRate=${Number(
        result.qosMaintenance?.aggregate?.staleCacheFallbackRate ?? 0
      )}, contextStaleCacheFallbackRate=${Number(
        result.qosMaintenance?.aggregate?.contextStaleCacheFallbackRate ?? 0
      )}, lexicalTimeoutFallbackRate=${Number(result.qosMaintenance?.aggregate?.lexicalTimeoutFallbackRate ?? 0)}`
    );
    lines.push(
      `QoS latency: p95=${Number(result.qosMaintenance?.aggregate?.latency?.overall?.p95Ms ?? 0)}ms p99=${Number(
        result.qosMaintenance?.aggregate?.latency?.overall?.p99Ms ?? 0
      )}ms`
    );
  }
  if (result.qosAdaptive) {
    lines.push(
      `QoS adaptive deferred-warn-rate: configured=${Number(result.qosAdaptive.configuredRate ?? 0)} effective=${Number(
        result.qosAdaptive.effectiveRate ?? 0
      )} next=${Number(result.qosAdaptive.nextRate ?? 0)} reason=${String(result.qosAdaptive.reason || "hold")}`
    );
  }
  if (result.qosRemediation) {
    lines.push(
      `QoS remediation: attempted=${String(result.qosRemediation.attempted)} trigger=${
        result.qosRemediation.triggerReason || "none"
      } brainRestarted=${String(result.qosRemediation.studioBrainRestarted)} guardRestarted=${String(
        result.qosRemediation.memoryGuardRestarted
      )}`
    );
  }
  lines.push(
    `Guard runtime profile: ${String(result.state?.guardRuntimeProfile || "baseline")} (changes=${
      Number(result.state?.totalGuardProfileChanges ?? 0) || 0
    })`
  );
  if (result.alerts.length > 0) {
    lines.push("Alerts:");
    for (const alert of result.alerts) {
      lines.push(`- ${alert}`);
    }
  }
  if (result.webhook?.requested) {
    lines.push(
      `Webhook: requested=true sent=${String(result.webhook.sent)} skip=${result.webhook.skippedReason || "none"}`
    );
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function runOnce({
  dryRun,
  timeoutMs,
  selfHeal,
  restartCooldownMs,
  brainFailureThreshold,
  guardStaleThreshold,
  maxGuardStaleSeconds,
  baseUrl,
  ingestBaseUrl,
  guardReportPath,
  statePath,
  alertWebhookUrl,
  alertCooldownMs,
  alertOnWarn,
  webhookTimeoutMs,
  dbMaintenanceEnabled,
  dbMaintenanceIntervalMs,
  dbRemediateCooldownMs,
  dbRemediateOnWarn,
  dbMaintenanceReportPath,
  dbEmbeddingNormalizeEnabled,
  dbEmbeddingNormalizeApply,
  dbEmbeddingNormalizeCooldownMs,
  dbEmbeddingNormalizeReportPath,
  dbIndexLifecycleApply,
  dbIndexLifecycleAllowDrop,
  killCompetingDevRunners,
  qosMonitoringEnabled,
  qosIntervalMs,
  qosDeferredWarnRate,
  qosAdaptiveThresholdsEnabled,
  qosAdaptiveTargetP95Ms,
  qosAdaptiveTargetP99Ms,
  qosAdaptiveMinDeferredWarnRate,
  qosAdaptiveMaxDeferredWarnRate,
  qosAdaptiveTightenStep,
  qosAdaptiveRelaxStep,
  qosRounds,
  qosBurst,
  qosReportPath,
  qosRemediationEnabled,
  qosRemediationCooldownMs,
  qosWarnStreakForRemediation,
  qosFailStreakForRemediation,
  qosGuardDownshiftEnabled,
  qosGuardDownshiftWarnStreak,
  qosGuardDownshiftFailStreak,
  qosGuardProfileCooldownMs,
}) {
  const nowMs = Date.now();
  const actions = [];
  const alerts = [];
  let severity = "ok";
  const state = loadState(statePath);
  const studioBrainSessionBefore = tmuxHasSession(STUDIO_BRAIN_QUERY_SESSION);
  const studioBrainIngestSessionBefore = tmuxHasSession(STUDIO_BRAIN_INGEST_SESSION);
  const memoryGuardSessionBefore = tmuxHasSession(MEMORY_GUARD_SESSION);
  let studioBrainSessionAfter = studioBrainSessionBefore;
  let studioBrainIngestSessionAfter = studioBrainIngestSessionBefore;
  let memoryGuardSessionAfter = memoryGuardSessionBefore;
  let studioBrainStart = null;
  let studioBrainIngestStart = null;
  let memoryGuardStart = null;
  let dbRuntimeOverrides = null;
  let dbMaintenance = null;
  let qosMaintenance = null;
  let qosRemediation = null;
  let qosAdaptive = null;
  let guardProfileUpdate = null;
  let competingRuntime = null;

  if (killCompetingDevRunners) {
    competingRuntime = enforceSingleStudioBrainRuntime(dryRun);
    if ((competingRuntime?.killed?.length ?? 0) > 0) {
      actions.push(`killed-competing-studio-brain-runners:${competingRuntime.killed.length}`);
      if (severity !== "critical") severity = "warn";
      alerts.push("competing studio-brain dev/build runners were terminated");
    }
    if ((competingRuntime?.errors?.length ?? 0) > 0) {
      actions.push(`failed-kill-competing-studio-brain-runners:${competingRuntime.errors.length}`);
      alerts.push("failed to terminate one or more competing studio-brain dev/build runners");
      severity = "critical";
    }
  }

  if (!studioBrainSessionBefore) {
    dbRuntimeOverrides = ensureDbRuntimeOverrides();
    actions.push(dbRuntimeOverrides.ok ? "refreshed-db-runtime-overrides" : "failed-db-runtime-overrides-refresh");
    studioBrainStart = tmuxStartSession(STUDIO_BRAIN_QUERY_SESSION, buildStudioBrainCommand("query"), dryRun);
    if (studioBrainStart.started || studioBrainStart.dryRun) {
      actions.push("started-studio-brain-query-session");
      if (severity !== "critical") severity = "warn";
      alerts.push("studio-brain query session was down and has been recovered");
    } else {
      actions.push("failed-to-start-studio-brain-query-session");
      alerts.push("unable to start studio-brain query session");
      severity = "critical";
    }
    if (studioBrainStart.started || studioBrainStart.dryRun) {
      state.lastBrainRestartAtMs = nowMs;
      state.totalBrainRecoveries += 1;
    }
  }
  if (!studioBrainIngestSessionBefore) {
    studioBrainIngestStart = tmuxStartSession(STUDIO_BRAIN_INGEST_SESSION, buildStudioBrainCommand("ingest"), dryRun);
    if (studioBrainIngestStart.started || studioBrainIngestStart.dryRun) {
      actions.push("started-studio-brain-ingest-session");
      if (severity !== "critical") severity = "warn";
      alerts.push("studio-brain ingest session was down and has been recovered");
    } else {
      actions.push("failed-to-start-studio-brain-ingest-session");
      alerts.push("unable to start studio-brain ingest session");
      severity = "critical";
    }
    if (studioBrainIngestStart.started || studioBrainIngestStart.dryRun) {
      state.lastIngestRestartAtMs = nowMs;
      state.totalIngestRecoveries += 1;
    }
  }
  if (!memoryGuardSessionBefore) {
    memoryGuardStart = tmuxStartSession(MEMORY_GUARD_SESSION, buildMemoryGuardCommand(), dryRun);
    if (memoryGuardStart.started || memoryGuardStart.dryRun) {
      actions.push("started-memory-guard-session");
      if (severity !== "critical") severity = "warn";
      alerts.push("memory-guard session was down and has been recovered");
    } else {
      actions.push("failed-to-start-memory-guard-session");
      alerts.push("unable to start memory-guard session");
      severity = "critical";
    }
    if (memoryGuardStart.started || memoryGuardStart.dryRun) {
      state.lastGuardRestartAtMs = nowMs;
      state.totalGuardRecoveries += 1;
    }
  }
  studioBrainSessionAfter = tmuxHasSession(STUDIO_BRAIN_QUERY_SESSION);
  studioBrainIngestSessionAfter = tmuxHasSession(STUDIO_BRAIN_INGEST_SESSION);
  memoryGuardSessionAfter = tmuxHasSession(MEMORY_GUARD_SESSION);

  const dbMaintenanceDue =
    dbMaintenanceEnabled && !withinCooldown(nowMs, state.lastDbMaintenanceAtMs, dbMaintenanceIntervalMs);
  if (dbMaintenanceDue) {
    const remediateCooldownActive = withinCooldown(nowMs, state.lastDbRemediateAtMs, dbRemediateCooldownMs);
    const embeddingNormalizeCooldownActive = withinCooldown(
      nowMs,
      state.lastDbEmbeddingNormalizeAtMs,
      dbEmbeddingNormalizeCooldownMs
    );
    dbMaintenance = runDbMaintenanceCycle({
      reportPath: dbMaintenanceReportPath,
      allowRemediation: true,
      remediateOnWarn: dbRemediateOnWarn,
      remediateCooldownActive,
      embeddingNormalizeEnabled: dbEmbeddingNormalizeEnabled,
      embeddingNormalizeApply: dbEmbeddingNormalizeApply,
      embeddingNormalizeCooldownActive,
      embeddingNormalizeReportPath: dbEmbeddingNormalizeReportPath,
      lifecycleApply: dbIndexLifecycleApply,
      lifecycleAllowDropIndexes: dbIndexLifecycleAllowDrop,
    });
    state.lastDbMaintenanceAtMs = nowMs;
    state.totalDbMaintenanceRuns += 1;
    actions.push(`db-maintenance:${dbMaintenance.status}`);
    if (dbMaintenance.remediation?.attempted && dbMaintenance.remediation?.ok) {
      state.lastDbRemediateAtMs = nowMs;
      state.totalDbRemediations += 1;
      actions.push("db-remediation:applied");
    } else if (dbMaintenance.remediation?.attempted && !dbMaintenance.remediation?.ok) {
      actions.push("db-remediation:failed");
      alerts.push("database remediation attempted but failed");
      severity = "critical";
    }
    if (dbMaintenance.embeddingNormalization?.attempted && dbMaintenance.embeddingNormalization?.ok) {
      state.lastDbEmbeddingNormalizeAtMs = nowMs;
      state.totalDbEmbeddingNormalizeRuns += 1;
      actions.push(
        dbMaintenance.embeddingNormalization.apply ? "db-embedding-normalization:applied" : "db-embedding-normalization:planned"
      );
      if (dbMaintenance.embeddingNormalization.apply) {
        state.lastDbEmbeddingNormalizeApplyAtMs = nowMs;
        state.totalDbEmbeddingNormalizeApplyRuns += 1;
      }
    } else if (dbMaintenance.embeddingNormalization?.attempted && !dbMaintenance.embeddingNormalization?.ok) {
      actions.push("db-embedding-normalization:failed");
      alerts.push("embedding normalization attempted but failed");
      severity = "critical";
    }
    if (dbMaintenance.status === "fail") {
      alerts.push("database maintenance cycle failed");
      severity = "critical";
    } else if (dbMaintenance.status === "warn" && severity !== "critical") {
      alerts.push("database maintenance cycle produced warnings");
      severity = "warn";
    }
  }

  const configuredQosDeferredWarnRate = clampRate(qosDeferredWarnRate, 0.15, { min: 0, max: 1 });
  const priorAdaptiveRate = clampRate(state.qosAdaptiveDeferredWarnRate, configuredQosDeferredWarnRate, {
    min: qosAdaptiveMinDeferredWarnRate,
    max: qosAdaptiveMaxDeferredWarnRate,
  });
  const effectiveQosDeferredWarnRate = qosAdaptiveThresholdsEnabled
    ? priorAdaptiveRate
    : configuredQosDeferredWarnRate;
  const qosDue = qosMonitoringEnabled && !withinCooldown(nowMs, state.lastQosRunAtMs, qosIntervalMs);
  if (qosDue) {
    qosMaintenance = runQosProbeCycle({
      reportPath: qosReportPath,
      rounds: qosRounds,
      burst: qosBurst,
      deferredWarnRate: effectiveQosDeferredWarnRate,
      baseUrl,
    });
    state.lastQosRunAtMs = nowMs;
    state.totalQosRuns += 1;
    actions.push(`qos-maintenance:${qosMaintenance.status}`);
    if (qosMaintenance.status === "pass") {
      state.qosConsecutiveWarn = 0;
      state.qosConsecutiveFail = 0;
    } else if (qosMaintenance.status === "warn") {
      state.qosConsecutiveWarn += 1;
      state.qosConsecutiveFail = 0;
    } else if (qosMaintenance.status === "fail") {
      state.qosConsecutiveWarn += 1;
      state.qosConsecutiveFail += 1;
    }
    if (qosMaintenance.status === "fail") {
      alerts.push("qos maintenance probe failed");
      severity = "critical";
    } else if (qosMaintenance.status === "warn" && severity !== "critical") {
      alerts.push("qos maintenance indicates elevated defer/degraded-empty pressure");
      severity = "warn";
    }

    if (qosAdaptiveThresholdsEnabled) {
      const adjustment = adaptQosDeferredWarnRate({
        currentRate: effectiveQosDeferredWarnRate,
        aggregate: qosMaintenance.aggregate,
        minRate: qosAdaptiveMinDeferredWarnRate,
        maxRate: qosAdaptiveMaxDeferredWarnRate,
        targetP95Ms: qosAdaptiveTargetP95Ms,
        targetP99Ms: qosAdaptiveTargetP99Ms,
        tightenStep: qosAdaptiveTightenStep,
        relaxStep: qosAdaptiveRelaxStep,
      });
      qosAdaptive = {
        enabled: true,
        configuredRate: roundNumber(configuredQosDeferredWarnRate, 4),
        effectiveRate: roundNumber(effectiveQosDeferredWarnRate, 4),
        ...adjustment,
      };
      if (adjustment.changed) {
        actions.push(
          `qos-adaptive-deferred-warn-rate:${roundNumber(adjustment.currentRate, 4)}->${roundNumber(adjustment.nextRate, 4)}`
        );
      }
      if (!dryRun) {
        state.qosAdaptiveDeferredWarnRate = adjustment.nextRate;
        state.qosAdaptiveLastP95Ms = adjustment.observedP95Ms;
        state.qosAdaptiveLastP99Ms = adjustment.observedP99Ms;
        state.qosAdaptiveLastUpdatedAtMs = nowMs;
      }
    } else {
      qosAdaptive = {
        enabled: false,
        configuredRate: roundNumber(configuredQosDeferredWarnRate, 4),
        effectiveRate: roundNumber(configuredQosDeferredWarnRate, 4),
        nextRate: roundNumber(configuredQosDeferredWarnRate, 4),
        reason: "disabled",
      };
      if (!dryRun) {
        state.qosAdaptiveDeferredWarnRate = configuredQosDeferredWarnRate;
      }
    }
  }
  if (!qosAdaptive) {
    qosAdaptive = {
      enabled: qosAdaptiveThresholdsEnabled,
      configuredRate: roundNumber(configuredQosDeferredWarnRate, 4),
      effectiveRate: roundNumber(effectiveQosDeferredWarnRate, 4),
      nextRate: roundNumber(
        qosAdaptiveThresholdsEnabled ? state.qosAdaptiveDeferredWarnRate || effectiveQosDeferredWarnRate : configuredQosDeferredWarnRate,
        4
      ),
      reason: qosDue ? "hold" : "idle",
      changed: false,
      observedP95Ms: roundNumber(state.qosAdaptiveLastP95Ms || 0, 2),
      observedP99Ms: roundNumber(state.qosAdaptiveLastP99Ms || 0, 2),
    };
  }

  const runtimeGuardEnv = parseEnvFile(INGEST_GUARD_RUNTIME_OVERRIDES_PATH);
  const runtimeGuardProfile = String(runtimeGuardEnv.OPEN_MEMORY_GUARD_PROFILE || "").trim().toLowerCase();
  const currentGuardProfile =
    runtimeGuardProfile || String(state.guardRuntimeProfile || "baseline").trim().toLowerCase() || "baseline";
  state.guardRuntimeProfile = currentGuardProfile;
  if (qosMonitoringEnabled && qosMaintenance && qosGuardDownshiftEnabled) {
    const warnStreak = Number(state.qosConsecutiveWarn ?? 0);
    const failStreak = Number(state.qosConsecutiveFail ?? 0);
    const qosFailedRequests = Number(qosMaintenance?.aggregate?.failed ?? 0);
    const qosDeferredRate = Number(qosMaintenance?.aggregate?.deferredRate ?? 0);
    const qosDegradedEmptyRate = Number(qosMaintenance?.aggregate?.degradedEmptyRate ?? 0);
    const guardDeferredWarnRate =
      Number(qosMaintenance?.deferredWarnRate ?? qosAdaptive?.nextRate ?? effectiveQosDeferredWarnRate);
    const severeDeferredRateThreshold = Math.max(0.35, Number(guardDeferredWarnRate) * 1.8);
    const severeDegradedEmptyRateThreshold = Math.max(0.5, Number(guardDeferredWarnRate) * 2.2);
    let desiredGuardProfile = currentGuardProfile;
    if (
      failStreak >= qosGuardDownshiftFailStreak
      || qosFailedRequests > 0
      || qosDeferredRate >= severeDeferredRateThreshold
      || qosDegradedEmptyRate >= severeDegradedEmptyRateThreshold
    ) {
      desiredGuardProfile = "severe";
    } else if (warnStreak >= qosGuardDownshiftWarnStreak) {
      desiredGuardProfile = "moderate";
    } else if (qosMaintenance.status === "pass") {
      desiredGuardProfile = "baseline";
    }
    if (desiredGuardProfile !== currentGuardProfile) {
      const rank = { baseline: 0, moderate: 1, severe: 2 };
      const escalating =
        Number(rank[desiredGuardProfile] ?? 0) > Number(rank[currentGuardProfile] ?? 0);
      const cooldownActive = !escalating && withinCooldown(nowMs, state.lastGuardProfileChangeAtMs, qosGuardProfileCooldownMs);
      guardProfileUpdate = {
        attempted: false,
        from: currentGuardProfile,
        to: desiredGuardProfile,
        escalating,
        cooldownActive,
        applied: false,
        restart: null,
        writeResult: null,
      };
      if (!cooldownActive) {
        guardProfileUpdate.attempted = true;
        const writeResult = writeGuardRuntimeOverrides(desiredGuardProfile, dryRun);
        guardProfileUpdate.writeResult = writeResult;
        if (writeResult.ok) {
          if (!dryRun) {
            state.guardRuntimeProfile = desiredGuardProfile;
            state.lastGuardProfileChangeAtMs = nowMs;
            state.totalGuardProfileChanges += 1;
          }
          actions.push(`guard-runtime-profile:${currentGuardProfile}->${desiredGuardProfile}`);
          const restart = tmuxRestartSession(MEMORY_GUARD_SESSION, buildMemoryGuardCommand(), dryRun);
          guardProfileUpdate.restart = restart;
          if (restart.restarted) {
            guardProfileUpdate.applied = true;
            actions.push("guard-runtime-profile:restarted-memory-guard");
            if (!dryRun) {
              state.lastGuardRestartAtMs = nowMs;
              state.totalGuardRestarts += 1;
              state.totalGuardRecoveries += 1;
              state.guardConsecutiveStale = 0;
            }
            memoryGuardSessionAfter = tmuxHasSession(MEMORY_GUARD_SESSION);
            if (severity !== "critical") severity = "warn";
            alerts.push(`memory-guard runtime profile shifted to ${desiredGuardProfile}`);
          } else {
            actions.push("guard-runtime-profile:failed-restart-memory-guard");
            alerts.push("failed to restart memory-guard after runtime profile update");
            severity = "critical";
          }
        } else {
          actions.push("guard-runtime-profile:failed-write");
          alerts.push("failed to persist memory-guard runtime profile overrides");
          severity = "critical";
        }
      } else {
        actions.push(`guard-runtime-profile:cooldown:${currentGuardProfile}->${desiredGuardProfile}`);
      }
    }
  }

  if (qosMonitoringEnabled && qosMaintenance && qosRemediationEnabled) {
    const warnStreak = Number(state.qosConsecutiveWarn ?? 0);
    const failStreak = Number(state.qosConsecutiveFail ?? 0);
    const triggerReason =
      failStreak >= qosFailStreakForRemediation
        ? "fail-streak-threshold"
        : warnStreak >= qosWarnStreakForRemediation
          ? "warn-streak-threshold"
          : "";
    const cooldownActive = Boolean(
      triggerReason && withinCooldown(nowMs, state.lastQosRemediationAtMs, qosRemediationCooldownMs)
    );
    qosRemediation = {
      attempted: false,
      triggerReason: triggerReason || null,
      warnStreak,
      failStreak,
      cooldownActive,
      studioBrainRestarted: false,
      studioBrainIngestRestarted: false,
      memoryGuardRestarted: false,
      runtimeOverrides: null,
      error: null,
    };
    if (triggerReason && !cooldownActive) {
      qosRemediation.attempted = true;
      dbRuntimeOverrides = ensureDbRuntimeOverrides();
      qosRemediation.runtimeOverrides = {
        ok: dbRuntimeOverrides.ok,
        output: dbRuntimeOverrides.output,
        error: dbRuntimeOverrides.error,
      };
      actions.push(
        dbRuntimeOverrides.ok
          ? "qos-remediation:refreshed-db-runtime-overrides"
          : "qos-remediation:failed-db-runtime-overrides-refresh"
      );
      const brainRestart = tmuxRestartSession(STUDIO_BRAIN_QUERY_SESSION, buildStudioBrainCommand("query"), dryRun);
      if (brainRestart.restarted) {
        qosRemediation.studioBrainRestarted = true;
        actions.push("qos-remediation:restarted-studio-brain-query");
        state.lastBrainRestartAtMs = nowMs;
        state.totalBrainRestarts += 1;
        state.totalBrainRecoveries += 1;
        state.brainConsecutiveHealthFailures = 0;
      } else {
        qosRemediation.error = "failed-to-restart-studio-brain";
        actions.push("qos-remediation:failed-restart-studio-brain-query");
        alerts.push("qos remediation failed to restart studio-brain query");
        severity = "critical";
      }
      const ingestRestart = tmuxRestartSession(STUDIO_BRAIN_INGEST_SESSION, buildStudioBrainCommand("ingest"), dryRun);
      if (ingestRestart.restarted) {
        qosRemediation.studioBrainIngestRestarted = true;
        actions.push("qos-remediation:restarted-studio-brain-ingest");
        state.lastIngestRestartAtMs = nowMs;
        state.totalIngestRestarts += 1;
        state.totalIngestRecoveries += 1;
        state.ingestConsecutiveHealthFailures = 0;
      } else {
        qosRemediation.error = "failed-to-restart-studio-brain-ingest";
        actions.push("qos-remediation:failed-restart-studio-brain-ingest");
        alerts.push("qos remediation failed to restart studio-brain ingest");
        severity = "critical";
      }
      const guardRestartNeeded =
        failStreak >= qosFailStreakForRemediation && guardProfileUpdate?.applied !== true;
      if (guardRestartNeeded) {
        const guardRestart = tmuxRestartSession(MEMORY_GUARD_SESSION, buildMemoryGuardCommand(), dryRun);
        if (guardRestart.restarted) {
          qosRemediation.memoryGuardRestarted = true;
          actions.push("qos-remediation:restarted-memory-guard");
          state.lastGuardRestartAtMs = nowMs;
          state.totalGuardRestarts += 1;
          state.totalGuardRecoveries += 1;
          state.guardConsecutiveStale = 0;
        } else {
          qosRemediation.error = "failed-to-restart-memory-guard";
          actions.push("qos-remediation:failed-restart-memory-guard");
          alerts.push("qos remediation failed to restart memory-guard");
          severity = "critical";
        }
      }
      if (
        qosRemediation.studioBrainRestarted
        || qosRemediation.studioBrainIngestRestarted
        || qosRemediation.memoryGuardRestarted
      ) {
        state.lastQosRemediationAtMs = nowMs;
        state.totalQosRemediations += 1;
        state.qosConsecutiveWarn = 0;
        state.qosConsecutiveFail = 0;
        if (severity !== "critical") severity = "warn";
        alerts.push(`qos remediation executed (${triggerReason})`);
      }
      studioBrainSessionAfter = tmuxHasSession(STUDIO_BRAIN_QUERY_SESSION);
      studioBrainIngestSessionAfter = tmuxHasSession(STUDIO_BRAIN_INGEST_SESSION);
      memoryGuardSessionAfter = tmuxHasSession(MEMORY_GUARD_SESSION);
    }
  }

  const health = await fetchHealth(baseUrl, timeoutMs);
  const healthIngest = await fetchHealth(ingestBaseUrl, timeoutMs);
  const processes = snapshotProcesses();
  const guardReport = readGuardSnapshot(guardReportPath);
  guardReport.stale = !guardReport.exists || guardReport.parseError !== null || (guardReport.staleSeconds ?? Number.MAX_SAFE_INTEGER) > maxGuardStaleSeconds;

  if (!health.ok || processes.studioBrainQueryListenerCount <= 0) {
    state.brainConsecutiveHealthFailures += 1;
    alerts.push("studio-brain query health check failing");
    severity = "critical";
  } else {
    state.brainConsecutiveHealthFailures = 0;
  }

  if (!healthIngest.ok || processes.studioBrainIngestListenerCount <= 0) {
    state.ingestConsecutiveHealthFailures += 1;
    alerts.push("studio-brain ingest health check failing");
    severity = "critical";
  } else {
    state.ingestConsecutiveHealthFailures = 0;
  }

  if (guardReport.stale || processes.guardCount <= 0) {
    state.guardConsecutiveStale += 1;
    if (severity !== "critical") {
      severity = "warn";
    }
    alerts.push("memory-guard appears stale or absent");
  } else {
    state.guardConsecutiveStale = 0;
  }

  let studioBrainRestart = null;
  let studioBrainIngestRestart = null;
  let memoryGuardRestart = null;

  const brainEligibleForRestart =
    selfHeal &&
    state.brainConsecutiveHealthFailures >= brainFailureThreshold &&
    !withinCooldown(nowMs, state.lastBrainRestartAtMs, restartCooldownMs);
  if (brainEligibleForRestart) {
    dbRuntimeOverrides = ensureDbRuntimeOverrides();
    actions.push(dbRuntimeOverrides.ok ? "refreshed-db-runtime-overrides" : "failed-db-runtime-overrides-refresh");
    studioBrainRestart = tmuxRestartSession(STUDIO_BRAIN_QUERY_SESSION, buildStudioBrainCommand("query"), dryRun);
    actions.push("restarted-studio-brain-query");
    if (studioBrainRestart.restarted) {
      state.lastBrainRestartAtMs = nowMs;
      state.brainConsecutiveHealthFailures = 0;
      state.totalBrainRestarts += 1;
      state.totalBrainRecoveries += 1;
    }
    if (severity !== "critical") severity = "warn";
    studioBrainSessionAfter = tmuxHasSession(STUDIO_BRAIN_QUERY_SESSION);
  }

  const ingestEligibleForRestart =
    selfHeal &&
    state.ingestConsecutiveHealthFailures >= brainFailureThreshold &&
    !withinCooldown(nowMs, state.lastIngestRestartAtMs, restartCooldownMs);
  if (ingestEligibleForRestart) {
    studioBrainIngestRestart = tmuxRestartSession(STUDIO_BRAIN_INGEST_SESSION, buildStudioBrainCommand("ingest"), dryRun);
    actions.push("restarted-studio-brain-ingest");
    if (studioBrainIngestRestart.restarted) {
      state.lastIngestRestartAtMs = nowMs;
      state.ingestConsecutiveHealthFailures = 0;
      state.totalIngestRestarts += 1;
      state.totalIngestRecoveries += 1;
    }
    if (severity !== "critical") severity = "warn";
    studioBrainIngestSessionAfter = tmuxHasSession(STUDIO_BRAIN_INGEST_SESSION);
  }

  const guardEligibleForRestart =
    selfHeal &&
    state.guardConsecutiveStale >= guardStaleThreshold &&
    !withinCooldown(nowMs, state.lastGuardRestartAtMs, restartCooldownMs);
  if (guardEligibleForRestart) {
    memoryGuardRestart = tmuxRestartSession(MEMORY_GUARD_SESSION, buildMemoryGuardCommand(), dryRun);
    actions.push("restarted-memory-guard");
    if (memoryGuardRestart.restarted) {
      state.lastGuardRestartAtMs = nowMs;
      state.guardConsecutiveStale = 0;
      state.totalGuardRestarts += 1;
      state.totalGuardRecoveries += 1;
    }
    if (severity !== "critical") severity = "warn";
    memoryGuardSessionAfter = tmuxHasSession(MEMORY_GUARD_SESSION);
  }

  const actionDrivenAlert = actions.some((action) => /failed-to-start|restarted-/.test(action));
  const shouldAlertBySeverity = severity === "critical" || (alertOnWarn && severity === "warn");
  const webhookRequested = Boolean(alertWebhookUrl) && (actionDrivenAlert || shouldAlertBySeverity);
  let webhook = {
    requested: webhookRequested,
    sent: false,
    skippedReason: "",
    result: null,
  };
  if (webhookRequested) {
    if (withinCooldown(nowMs, state.lastAlertAtMs, alertCooldownMs)) {
      webhook.skippedReason = "cooldown";
    } else if (dryRun) {
      webhook.sent = false;
      webhook.skippedReason = "dry-run";
    } else {
      const payload = {
        generatedAt: new Date().toISOString(),
        severity,
        alerts,
        actions,
        health,
        healthIngest,
        processes,
        guardReport: {
          stale: guardReport.stale,
          staleSeconds: guardReport.staleSeconds,
          cycle: guardReport.cycle,
        },
        state: {
          brainConsecutiveHealthFailures: state.brainConsecutiveHealthFailures,
          guardConsecutiveStale: state.guardConsecutiveStale,
          totalBrainRestarts: state.totalBrainRestarts,
          totalGuardRestarts: state.totalGuardRestarts,
        },
      };
      const dispatch = await postWebhook(alertWebhookUrl, payload, webhookTimeoutMs);
      webhook.sent = dispatch.ok;
      webhook.result = dispatch;
      state.lastAlertAtMs = nowMs;
      state.totalAlerts += 1;
      state.lastAlertReason = alerts[0] || actions[0] || severity;
    }
  }

  saveState(statePath, state);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    config: {
      baseUrl,
      ingestBaseUrl,
      guardReportPath,
      statePath,
      selfHeal,
      restartCooldownMs,
      brainFailureThreshold,
      guardStaleThreshold,
      maxGuardStaleSeconds,
      alertCooldownMs,
      alertOnWarn,
      alertWebhookConfigured: Boolean(alertWebhookUrl),
      dbMaintenanceEnabled,
      dbMaintenanceIntervalMs,
      dbRemediateCooldownMs,
      dbRemediateOnWarn,
      dbMaintenanceReportPath,
      dbEmbeddingNormalizeEnabled,
      dbEmbeddingNormalizeApply,
      dbEmbeddingNormalizeCooldownMs,
      dbEmbeddingNormalizeReportPath,
      dbIndexLifecycleApply,
      dbIndexLifecycleAllowDrop,
      killCompetingDevRunners,
      qosMonitoringEnabled,
      qosIntervalMs,
      qosDeferredWarnRateConfigured: configuredQosDeferredWarnRate,
      qosDeferredWarnRateEffective: effectiveQosDeferredWarnRate,
      qosAdaptiveThresholdsEnabled,
      qosAdaptiveTargetP95Ms,
      qosAdaptiveTargetP99Ms,
      qosAdaptiveMinDeferredWarnRate,
      qosAdaptiveMaxDeferredWarnRate,
      qosAdaptiveTightenStep,
      qosAdaptiveRelaxStep,
      qosRounds,
      qosBurst,
      qosReportPath,
      qosRemediationEnabled,
      qosRemediationCooldownMs,
      qosWarnStreakForRemediation,
      qosFailStreakForRemediation,
      qosGuardDownshiftEnabled,
      qosGuardDownshiftWarnStreak,
      qosGuardDownshiftFailStreak,
      qosGuardProfileCooldownMs,
    },
    actions,
    alerts,
    severity,
    studioBrain: {
      sessionPresent: studioBrainSessionAfter,
      sessionPresentBefore: studioBrainSessionBefore,
      started: studioBrainStart,
      restarted: studioBrainRestart,
    },
    studioBrainIngest: {
      sessionPresent: studioBrainIngestSessionAfter,
      sessionPresentBefore: studioBrainIngestSessionBefore,
      started: studioBrainIngestStart,
      restarted: studioBrainIngestRestart,
    },
    memoryGuard: {
      sessionPresent: memoryGuardSessionAfter,
      sessionPresentBefore: memoryGuardSessionBefore,
      started: memoryGuardStart,
      restarted: memoryGuardRestart,
    },
    health,
    healthIngest,
    guardReport,
    webhook,
    processes,
    dbMaintenance,
    qosMaintenance,
    qosAdaptive,
    qosRemediation,
    guardProfileUpdate,
    competingRuntime,
    dbRuntimeOverrides,
    state,
  };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const json = readBool(flags, "json", false);
  const watch = readBool(flags, "watch", false);
  const dryRun = readBool(flags, "dry-run", false);
  const selfHeal = readBool(flags, "self-heal", true);
  const timeoutMs = readInt(flags, "timeout-ms", 5000, { min: 1000, max: 120000 });
  const intervalMs = readInt(flags, "interval-ms", 30000, { min: 1000, max: 3_600_000 });
  const iterations = readInt(flags, "iterations", 0, { min: 0, max: 1_000_000 });
  const restartCooldownMs = readInt(flags, "restart-cooldown-ms", 120000, { min: 1000, max: 86_400_000 });
  const brainFailureThreshold = readInt(flags, "brain-failure-threshold", 2, { min: 1, max: 100 });
  const guardStaleThreshold = readInt(flags, "guard-stale-threshold", 2, { min: 1, max: 100 });
  const maxGuardStaleSeconds = readInt(flags, "max-guard-stale-seconds", 420, { min: 30, max: 86_400 });
  const alertCooldownMs = readInt(flags, "alert-cooldown-ms", 120000, { min: 1000, max: 86_400_000 });
  const alertOnWarn = readBool(flags, "alert-on-warn", false);
  const webhookTimeoutMs = readInt(flags, "webhook-timeout-ms", 8000, { min: 1000, max: 120000 });
  const alertWebhookUrl = readString(flags, "alert-webhook", String(process.env.STUDIO_BRAIN_OPS_ALERT_WEBHOOK || ""));
  const dbMaintenanceEnabled = readBool(flags, "db-maintenance-enabled", true);
  const dbMaintenanceIntervalMs = readInt(flags, "db-maintenance-interval-ms", 15 * 60 * 1000, {
    min: 10 * 1000,
    max: 24 * 60 * 60 * 1000,
  });
  const dbRemediateCooldownMs = readInt(flags, "db-remediate-cooldown-ms", 45 * 60 * 1000, {
    min: 60 * 1000,
    max: 24 * 60 * 60 * 1000,
  });
  const dbRemediateOnWarn = readBool(flags, "db-remediate-on-warn", true);
  const dbMaintenanceReportPath = readString(flags, "db-maintenance-report", DEFAULT_DB_MAINTENANCE_REPORT);
  const dbEmbeddingNormalizeEnabled = readBool(flags, "db-embedding-normalize-enabled", true);
  const dbEmbeddingNormalizeApply = readBool(flags, "db-embedding-normalize-apply", false);
  const dbEmbeddingNormalizeCooldownMs = readInt(flags, "db-embedding-normalize-cooldown-ms", 6 * 60 * 60 * 1000, {
    min: 60 * 1000,
    max: 7 * 24 * 60 * 60 * 1000,
  });
  const dbEmbeddingNormalizeReportPath = readString(
    flags,
    "db-embedding-normalize-report",
    DEFAULT_DB_EMBEDDING_NORMALIZE_REPORT
  );
  const dbIndexLifecycleApply = readBool(flags, "db-index-lifecycle-apply", false);
  const killCompetingDevRunners = readBool(flags, "kill-competing-dev-runners", true);
  const qosMonitoringEnabled = readBool(flags, "qos-monitoring-enabled", true);
  const qosIntervalMs = readInt(flags, "qos-interval-ms", 5 * 60 * 1000, {
    min: 10 * 1000,
    max: 24 * 60 * 60 * 1000,
  });
  const qosDeferredWarnRate = Number.parseFloat(
    String(flags["qos-deferred-warn-rate"] ?? process.env.STUDIO_BRAIN_QOS_DEFERRED_WARN_RATE ?? "0.15")
  );
  const boundedQosDeferredWarnRate = Number.isFinite(qosDeferredWarnRate)
    ? Math.max(0, Math.min(1, qosDeferredWarnRate))
    : 0.15;
  const qosAdaptiveThresholdsEnabled = readBool(flags, "qos-adaptive-thresholds-enabled", true);
  const qosAdaptiveTargetP95Ms = readInt(flags, "qos-adaptive-target-p95-ms", 2200, { min: 100, max: 120000 });
  const qosAdaptiveTargetP99Ms = readInt(flags, "qos-adaptive-target-p99-ms", 4800, { min: 200, max: 240000 });
  const qosAdaptiveMinDeferredWarnRate = readFloat(flags, "qos-adaptive-min-deferred-warn-rate", 0.08, {
    min: 0.01,
    max: 0.95,
  });
  const qosAdaptiveMaxDeferredWarnRate = readFloat(flags, "qos-adaptive-max-deferred-warn-rate", 0.3, {
    min: 0.02,
    max: 0.99,
  });
  const qosAdaptiveTightenStep = readFloat(flags, "qos-adaptive-tighten-step", 0.02, {
    min: 0.001,
    max: 0.2,
  });
  const qosAdaptiveRelaxStep = readFloat(flags, "qos-adaptive-relax-step", 0.01, {
    min: 0.001,
    max: 0.2,
  });
  const normalizedQosAdaptiveMinDeferredWarnRate = Math.min(
    qosAdaptiveMinDeferredWarnRate,
    qosAdaptiveMaxDeferredWarnRate
  );
  const normalizedQosAdaptiveMaxDeferredWarnRate = Math.max(
    qosAdaptiveMinDeferredWarnRate,
    qosAdaptiveMaxDeferredWarnRate
  );
  const qosRounds = readInt(flags, "qos-rounds", 1, { min: 1, max: 10 });
  const qosBurst = readInt(flags, "qos-burst", 3, { min: 1, max: 16 });
  const qosReportPath = readString(flags, "qos-report", DEFAULT_QOS_MAINTENANCE_REPORT);
  const qosRemediationEnabled = readBool(flags, "qos-remediation-enabled", true);
  const qosRemediationCooldownMs = readInt(flags, "qos-remediation-cooldown-ms", 15 * 60 * 1000, {
    min: 60 * 1000,
    max: 24 * 60 * 60 * 1000,
  });
  const qosWarnStreakForRemediation = readInt(flags, "qos-warn-streak-for-remediation", 3, { min: 1, max: 100 });
  const qosFailStreakForRemediation = readInt(flags, "qos-fail-streak-for-remediation", 2, { min: 1, max: 100 });
  const qosGuardDownshiftEnabled = readBool(flags, "qos-guard-downshift-enabled", true);
  const qosGuardDownshiftWarnStreak = readInt(flags, "qos-guard-downshift-warn-streak", 2, { min: 1, max: 100 });
  const qosGuardDownshiftFailStreak = readInt(flags, "qos-guard-downshift-fail-streak", 1, { min: 1, max: 100 });
  const qosGuardProfileCooldownMs = readInt(flags, "qos-guard-profile-cooldown-ms", 5 * 60 * 1000, {
    min: 30 * 1000,
    max: 24 * 60 * 60 * 1000,
  });
  const dbIndexLifecycleAllowDrop = readString(
    flags,
    "db-index-lifecycle-allow-drop",
    String(process.env.STUDIO_BRAIN_DB_INDEX_LIFECYCLE_ALLOW_DROP || "")
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const baseUrl = readString(flags, "base-url", `http://${STUDIO_BRAIN_HOST}:${STUDIO_BRAIN_QUERY_PORT}`);
  const ingestBaseUrl = readString(flags, "ingest-base-url", `http://${STUDIO_BRAIN_HOST}:${STUDIO_BRAIN_INGEST_PORT}`);
  const guardReportPath = readString(flags, "guard-report", DEFAULT_GUARD_REPORT);
  const statePath = readString(flags, "state-file", DEFAULT_STATE_FILE);
  const reportPath = readString(flags, "report", DEFAULT_REPORT_FILE);
  const eventLogPath = readString(flags, "event-log", DEFAULT_EVENT_LOG_FILE);
  const maxEventLogLines = readInt(flags, "max-event-log-lines", 5000, { min: 100, max: 500000 });

  let remaining = iterations;
  let first = true;
  while (true) {
    if (watch && !first) {
      await sleep(intervalMs);
    }
    first = false;
    const result = await runOnce({
      dryRun,
      timeoutMs,
      selfHeal,
      restartCooldownMs,
      brainFailureThreshold,
      guardStaleThreshold,
      maxGuardStaleSeconds,
      baseUrl,
      ingestBaseUrl,
      guardReportPath,
      statePath,
      alertWebhookUrl,
      alertCooldownMs,
      alertOnWarn,
      webhookTimeoutMs,
      dbMaintenanceEnabled,
      dbMaintenanceIntervalMs,
      dbRemediateCooldownMs,
      dbRemediateOnWarn,
      dbMaintenanceReportPath,
      dbEmbeddingNormalizeEnabled,
      dbEmbeddingNormalizeApply,
      dbEmbeddingNormalizeCooldownMs,
      dbEmbeddingNormalizeReportPath,
      dbIndexLifecycleApply,
      dbIndexLifecycleAllowDrop,
      killCompetingDevRunners,
      qosMonitoringEnabled,
      qosIntervalMs,
      qosDeferredWarnRate: boundedQosDeferredWarnRate,
      qosAdaptiveThresholdsEnabled,
      qosAdaptiveTargetP95Ms,
      qosAdaptiveTargetP99Ms,
      qosAdaptiveMinDeferredWarnRate: normalizedQosAdaptiveMinDeferredWarnRate,
      qosAdaptiveMaxDeferredWarnRate: normalizedQosAdaptiveMaxDeferredWarnRate,
      qosAdaptiveTightenStep,
      qosAdaptiveRelaxStep,
      qosRounds,
      qosBurst,
      qosReportPath,
      qosRemediationEnabled,
      qosRemediationCooldownMs,
      qosWarnStreakForRemediation,
      qosFailStreakForRemediation,
      qosGuardDownshiftEnabled,
      qosGuardDownshiftWarnStreak,
      qosGuardDownshiftFailStreak,
      qosGuardProfileCooldownMs,
    });
    saveReport(reportPath, result);
    appendEvent(eventLogPath, {
      generatedAt: result.generatedAt,
      severity: result.severity,
      actions: result.actions,
      alerts: result.alerts,
      healthOk: result.health?.ok === true,
      healthStatus: result.health?.status ?? 0,
      guardStale: result.guardReport?.stale === true,
      guardStaleSeconds: result.guardReport?.staleSeconds ?? null,
      guardCycle: result.guardReport?.cycle ?? null,
      dbMaintenance: result.dbMaintenance
        ? {
            status: result.dbMaintenance.status,
            failures: result.dbMaintenance.failures,
            warnings: result.dbMaintenance.warnings,
            remediationAttempted: result.dbMaintenance.remediation?.attempted === true,
            remediationOk: result.dbMaintenance.remediation?.ok === true,
            embeddingNormalizationAttempted: result.dbMaintenance.embeddingNormalization?.attempted === true,
            embeddingNormalizationOk: result.dbMaintenance.embeddingNormalization?.ok === true,
            embeddingNormalizationApply: result.dbMaintenance.embeddingNormalization?.apply === true,
          }
        : null,
      qosMaintenance: result.qosMaintenance
        ? {
            status: result.qosMaintenance.status,
            failures: result.qosMaintenance.failures,
            warnings: result.qosMaintenance.warnings,
            deferredRate: Number(result.qosMaintenance?.aggregate?.deferredRate ?? 0),
            degradedEmptyRate: Number(result.qosMaintenance?.aggregate?.degradedEmptyRate ?? 0),
            latencyP95Ms: Number(result.qosMaintenance?.aggregate?.latency?.overall?.p95Ms ?? 0),
            latencyP99Ms: Number(result.qosMaintenance?.aggregate?.latency?.overall?.p99Ms ?? 0),
            staleCacheFallbackRate: Number(
              result.qosMaintenance?.aggregate?.staleCacheFallbackRate ?? 0
            ) + Number(result.qosMaintenance?.aggregate?.contextStaleCacheFallbackRate ?? 0),
            lexicalTimeoutFallbackRate: Number(result.qosMaintenance?.aggregate?.lexicalTimeoutFallbackRate ?? 0),
            failed: Number(result.qosMaintenance?.aggregate?.failed ?? 0),
          }
        : null,
      qosAdaptive: result.qosAdaptive
        ? {
            enabled: result.qosAdaptive.enabled !== false,
            configuredRate: Number(result.qosAdaptive.configuredRate ?? 0),
            effectiveRate: Number(result.qosAdaptive.effectiveRate ?? 0),
            nextRate: Number(result.qosAdaptive.nextRate ?? 0),
            reason: String(result.qosAdaptive.reason || "hold"),
            changed: result.qosAdaptive.changed === true,
            observedP95Ms: Number(result.qosAdaptive.observedP95Ms ?? 0),
            observedP99Ms: Number(result.qosAdaptive.observedP99Ms ?? 0),
          }
        : null,
      qosRemediation: result.qosRemediation
        ? {
            attempted: result.qosRemediation.attempted === true,
            triggerReason: result.qosRemediation.triggerReason || null,
            studioBrainRestarted: result.qosRemediation.studioBrainRestarted === true,
            studioBrainIngestRestarted: result.qosRemediation.studioBrainIngestRestarted === true,
            memoryGuardRestarted: result.qosRemediation.memoryGuardRestarted === true,
            cooldownActive: result.qosRemediation.cooldownActive === true,
            error: result.qosRemediation.error || null,
          }
        : null,
      guardProfileUpdate: result.guardProfileUpdate
        ? {
            attempted: result.guardProfileUpdate.attempted === true,
            from: result.guardProfileUpdate.from || null,
            to: result.guardProfileUpdate.to || null,
            cooldownActive: result.guardProfileUpdate.cooldownActive === true,
            applied: result.guardProfileUpdate.applied === true,
          }
        : null,
      competingRuntime: result.competingRuntime
        ? {
            found: result.competingRuntime.found ?? 0,
            killed: Array.isArray(result.competingRuntime.killed) ? result.competingRuntime.killed.length : 0,
            errors: Array.isArray(result.competingRuntime.errors) ? result.competingRuntime.errors.length : 0,
          }
        : null,
      webhook: result.webhook ?? null,
      state: {
        brainConsecutiveHealthFailures: result.state?.brainConsecutiveHealthFailures ?? 0,
        ingestConsecutiveHealthFailures: result.state?.ingestConsecutiveHealthFailures ?? 0,
        guardConsecutiveStale: result.state?.guardConsecutiveStale ?? 0,
        totalBrainRestarts: result.state?.totalBrainRestarts ?? 0,
        totalIngestRestarts: result.state?.totalIngestRestarts ?? 0,
        totalGuardRestarts: result.state?.totalGuardRestarts ?? 0,
        totalBrainRecoveries: result.state?.totalBrainRecoveries ?? 0,
        totalIngestRecoveries: result.state?.totalIngestRecoveries ?? 0,
        totalGuardRecoveries: result.state?.totalGuardRecoveries ?? 0,
        totalAlerts: result.state?.totalAlerts ?? 0,
        totalDbMaintenanceRuns: result.state?.totalDbMaintenanceRuns ?? 0,
        totalDbRemediations: result.state?.totalDbRemediations ?? 0,
        totalDbEmbeddingNormalizeRuns: result.state?.totalDbEmbeddingNormalizeRuns ?? 0,
        totalDbEmbeddingNormalizeApplyRuns: result.state?.totalDbEmbeddingNormalizeApplyRuns ?? 0,
        totalQosRuns: result.state?.totalQosRuns ?? 0,
        totalQosRemediations: result.state?.totalQosRemediations ?? 0,
        qosConsecutiveWarn: result.state?.qosConsecutiveWarn ?? 0,
        qosConsecutiveFail: result.state?.qosConsecutiveFail ?? 0,
        qosAdaptiveDeferredWarnRate: result.state?.qosAdaptiveDeferredWarnRate ?? 0,
        qosAdaptiveLastP95Ms: result.state?.qosAdaptiveLastP95Ms ?? 0,
        qosAdaptiveLastP99Ms: result.state?.qosAdaptiveLastP99Ms ?? 0,
        qosAdaptiveLastUpdatedAtMs: result.state?.qosAdaptiveLastUpdatedAtMs ?? 0,
        guardRuntimeProfile: result.state?.guardRuntimeProfile ?? "baseline",
        totalGuardProfileChanges: result.state?.totalGuardProfileChanges ?? 0,
      },
    });
    pruneEventLog(eventLogPath, maxEventLogLines);
    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      printHuman(result);
      if (watch) {
        process.stdout.write("\n");
      }
    }
    if (!watch) break;
    if (remaining > 0) {
      remaining -= 1;
      if (remaining <= 0) break;
    }
  }
}

main().catch((error) => {
  process.stderr.write(`open-memory-ops-supervisor failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
