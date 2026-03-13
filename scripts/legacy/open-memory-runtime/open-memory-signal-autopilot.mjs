#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_REPORT_PATH = resolve(process.cwd(), "output", "open-memory", "signal-autopilot-latest.json");
const INGEST_GUARD_RUNTIME_OVERRIDES_PATH = resolve(
  process.cwd(),
  "output",
  "open-memory",
  "ingest-guard-runtime-overrides.env"
);

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] ?? "");
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).trim().toLowerCase();
    if (!key) continue;
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

function readString(flags, key, fallback = "") {
  const raw = String(flags[key] ?? "").trim();
  return raw || fallback;
}

function readInt(flags, key, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(flags[key] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function shellQuote(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:@,-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function parseJsonLoose(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {}
  const firstObjectIndex = raw.indexOf("{");
  const lastObjectIndex = raw.lastIndexOf("}");
  if (firstObjectIndex >= 0 && lastObjectIndex > firstObjectIndex) {
    const slice = raw.slice(firstObjectIndex, lastObjectIndex + 1);
    try {
      return JSON.parse(slice);
    } catch {}
  }
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!(line.startsWith("{") || line.startsWith("["))) continue;
    try {
      return JSON.parse(line);
    } catch {
      continue;
    }
  }
  return null;
}

function runCommand(command, { timeoutMs = 20 * 60 * 1000 } = {}) {
  const started = Date.now();
  const result = spawnSync("bash", ["-lc", command], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: Math.max(1000, timeoutMs),
    maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const payload = parseJsonLoose(stdout);
  return {
    ok: result.status === 0,
    timedOut: result.signal === "SIGTERM" || result.signal === "SIGKILL",
    exitCode: result.status ?? 1,
    signal: result.signal || null,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Math.max(0, Date.now() - started),
    command,
    stdout: stdout.trim().slice(0, 8000),
    stderr: stderr.trim().slice(0, 4000),
    payload,
  };
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

function writeGuardRuntimeOverrides(profile) {
  const values = buildGuardRuntimeProfile(profile);
  const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value)}`);
  mkdirSync(dirname(INGEST_GUARD_RUNTIME_OVERRIDES_PATH), { recursive: true });
  writeFileSync(INGEST_GUARD_RUNTIME_OVERRIDES_PATH, `${lines.join("\n")}\n`, "utf8");
  return {
    ok: true,
    profile: values.OPEN_MEMORY_GUARD_PROFILE,
    path: INGEST_GUARD_RUNTIME_OVERRIDES_PATH,
    values,
  };
}

function normalizeStatus(raw) {
  const value = String(raw || "").toLowerCase();
  if (value === "fail" || value === "warn" || value === "pass") return value;
  return "unknown";
}

function computeDesiredProfile(metrics) {
  const severeSignals = [
    metrics.contentionStatus === "fail",
    metrics.dbStatus === "fail",
    metrics.dbPlanStatus === "fail",
    metrics.qosInteractiveDeferredRate >= 0.4,
    metrics.qosInteractiveDegradedEmptyRate >= 0.35,
    metrics.qosInteractiveP95Ms >= 8000,
    metrics.qosDeferredRate >= 0.4,
    metrics.qosDegradedEmptyRate >= 0.35,
    metrics.qosP95Ms >= 8000,
    metrics.connectionUtilizationPct >= 88,
  ].filter(Boolean).length;

  if (severeSignals >= 1) return { profile: "severe", reason: "critical-pressure-or-contention" };

  const moderateSignals = [
    metrics.contentionStatus === "warn",
    metrics.dbStatus === "warn",
    metrics.dbPlanStatus === "warn",
    metrics.qosInteractiveDeferredRate >= 0.2,
    metrics.qosInteractiveDegradedEmptyRate >= 0.2,
    metrics.qosInteractiveP95Ms >= 4500,
    metrics.qosDeferredRate >= 0.18,
    metrics.qosDegradedEmptyRate >= 0.18,
    metrics.qosP95Ms >= 4500,
    metrics.connectionUtilizationPct >= 75,
  ].filter(Boolean).length;
  if (moderateSignals >= 1) return { profile: "moderate", reason: "elevated-pressure-or-latency" };
  return { profile: "baseline", reason: "stable" };
}

function clamp(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (readBool(flags, "help", false)) {
    process.stdout.write(
      [
        "Open Memory Signal Autopilot",
        "",
        "Usage:",
        "  node ./scripts/open-memory-signal-autopilot.mjs --json true",
        "",
        "Options:",
        "  --apply true|false                      Apply runtime profile + signal indexing actions (default: false)",
        "  --apply-recycle true|false              Recycle stack after profile write when applying (default: true)",
        "  --json true|false                       Emit JSON output (default: true)",
        "  --report <path|false>                   Optional report path",
        "  --base-url <url>                        Optional Studio Brain base URL for probes",
        "  --probe-query <text>                    QoS probe query (default: email ownership escalation)",
        "  --qos-rounds <n>                        QoS probe rounds (default: 3)",
        "  --qos-burst <n>                         QoS probe burst (default: 4)",
        "  --index-limit <n>                       Experimental index recent-window limit (default: 180)",
        "  --index-max-writes <n>                  Experimental index write budget on apply (default: 140)",
        "  --index-pressure-fallback-recent-limit <n> Pressure fallback /recent cap (default: 84)",
        "  --index-pressure-fallback-search-limit <n> Pressure fallback search limit (default: 12)",
        "  --index-pressure-fallback-search-seed-limit <n> Pressure fallback search seed cap (default: 3)",
        "  --index-pressure-fallback-max-search-queries <n> Pressure fallback max search queries (default: 1)",
        "  --index-pressure-fallback-rerank-top-k <n> Pressure fallback rerank cap (default: 96)",
        "  --index-pressure-fallback-max-motifs <n> Pressure fallback motif cap (default: 10)",
        "  --index-pressure-fallback-max-edges <n> Pressure fallback relationship cap (default: 18)",
        "  --index-pressure-fallback-max-writes <n> Pressure fallback write cap when applying (default: 8)",
        "  --index-pressure-fallback-hard-ratio <n> Disable fallback search above active/max import ratio (default: 1.6)",
        "  --index-capture-write-retries <n>         Per-capture write retries in index apply/probe (default: 3)",
        "  --index-capture-write-retry-delay-ms <n>  Base delay for index capture write retries (default: 900)",
        "  --index-capture-write-retry-backoff-factor <n> Backoff factor for index capture write retries (default: 1.8)",
        "  --index-capture-write-retry-max-delay-ms <n> Max delay for index capture retries (default: 8000)",
        "  --index-capture-failure-circuit-breaker-threshold <n> Consecutive write failures before breaker opens (default: 6)",
        "  --index-capture-failure-spool-path <path> Override capture failure spool path",
        "  --index-capture-spool-replay-max <n>      Max spool replayed each index run (default: 36)",
        "  --index-capture-spool-replay-ratio <n>    Fraction of write budget reserved for replay (default: 0.45)",
        "  --index-capture-spool-max-rows <n>        Max persisted capture spool rows (default: 1600)",
        "  --qos-watchdog-retune true|false         Retune watchdog import cap during severe QoS pressure (default: true)",
        "  --qos-watchdog-target-import-cap <n>     Target watchdog importer cap during QoS pressure (default: 2)",
        "  --contention-max-importers <n>          Contention cap for importer processes (default: 40)",
        "  --contention-max-watchdogs-per-root <n> Contention cap for watchdogs per run root (default: 1)",
        "  --contention-max-guards <n>             Contention cap for ingest guard processes (default: 1)",
        "  --contention-max-supervisors <n>        Contention cap for supervisor processes (default: 1)",
        "  --db-index-lifecycle-allow-drop-indexes <csv> Optional allowlist forwarded to index lifecycle apply",
        "  --strict true|false                     Exit non-zero if report status != pass (default: false)",
      ].join("\n") + "\n"
    );
    return;
  }

  const startedAt = new Date().toISOString();
  const apply = readBool(flags, "apply", false);
  const applyRecycle = readBool(flags, "apply-recycle", true);
  const outputJson = readBool(flags, "json", true);
  const strict = readBool(flags, "strict", false);
  const reportArg = readString(flags, "report", DEFAULT_REPORT_PATH);
  const reportEnabled = !["false", "0", "no", "off"].includes(String(reportArg).toLowerCase());
  const reportPath = reportEnabled ? resolve(process.cwd(), reportArg || DEFAULT_REPORT_PATH) : "";
  const baseUrl = readString(flags, "base-url", "");
  const probeQuery = readString(flags, "probe-query", "email ownership escalation");
  const qosRounds = readInt(flags, "qos-rounds", 3, { min: 1, max: 20 });
  const qosBurst = readInt(flags, "qos-burst", 4, { min: 1, max: 20 });
  const indexLimit = readInt(flags, "index-limit", 180, { min: 40, max: 1000 });
  const indexMaxWrites = readInt(flags, "index-max-writes", 140, { min: 20, max: 500 });
  const indexPressureFallbackRecentLimit = readInt(flags, "index-pressure-fallback-recent-limit", 84, { min: 20, max: 200 });
  const indexPressureFallbackSearchLimit = readInt(flags, "index-pressure-fallback-search-limit", 12, { min: 1, max: 100 });
  const indexPressureFallbackSearchSeedLimit = readInt(flags, "index-pressure-fallback-search-seed-limit", 3, {
    min: 1,
    max: 100,
  });
  const indexPressureFallbackMaxSearchQueries = readInt(
    flags,
    "index-pressure-fallback-max-search-queries",
    1,
    { min: 0, max: 100 }
  );
  const indexPressureFallbackRerankTopK = readInt(flags, "index-pressure-fallback-rerank-top-k", 96, { min: 20, max: 5000 });
  const indexPressureFallbackMaxMotifs = readInt(flags, "index-pressure-fallback-max-motifs", 10, { min: 1, max: 200 });
  const indexPressureFallbackMaxEdges = readInt(flags, "index-pressure-fallback-max-edges", 18, { min: 1, max: 400 });
  const indexPressureFallbackMaxWrites = readInt(flags, "index-pressure-fallback-max-writes", 8, { min: 1, max: 120 });
  const indexPressureFallbackHardRatio = clamp(Number(flags["index-pressure-fallback-hard-ratio"] ?? 1.6), 1, 12);
  const indexCaptureWriteRetries = readInt(flags, "index-capture-write-retries", 3, { min: 1, max: 12 });
  const indexCaptureWriteRetryDelayMs = readInt(flags, "index-capture-write-retry-delay-ms", 900, { min: 0, max: 120_000 });
  const indexCaptureWriteRetryBackoffFactor = clamp(Number(flags["index-capture-write-retry-backoff-factor"] ?? 1.8), 1, 6);
  const indexCaptureWriteRetryMaxDelayMs = readInt(flags, "index-capture-write-retry-max-delay-ms", 8000, {
    min: 50,
    max: 300_000,
  });
  const indexCaptureFailureCircuitBreakerThreshold = readInt(
    flags,
    "index-capture-failure-circuit-breaker-threshold",
    6,
    { min: 0, max: 120 }
  );
  const indexCaptureFailureSpoolPath = readString(flags, "index-capture-failure-spool-path", "");
  const indexCaptureSpoolReplayMax = readInt(flags, "index-capture-spool-replay-max", 36, { min: 0, max: 2000 });
  const indexCaptureSpoolReplayRatio = clamp(Number(flags["index-capture-spool-replay-ratio"] ?? 0.45), 0, 1);
  const indexCaptureSpoolMaxRows = readInt(flags, "index-capture-spool-max-rows", 1600, { min: 50, max: 20000 });
  const qosWatchdogRetune = readBool(flags, "qos-watchdog-retune", true);
  const qosWatchdogTargetImportCap = readInt(flags, "qos-watchdog-target-import-cap", 2, { min: 1, max: 16 });
  const contentionMaxImporters = readInt(flags, "contention-max-importers", 40, { min: 1, max: 200 });
  const contentionMaxWatchdogsPerRoot = readInt(flags, "contention-max-watchdogs-per-root", 1, { min: 1, max: 40 });
  const contentionMaxGuards = readInt(flags, "contention-max-guards", 1, { min: 1, max: 10 });
  const contentionMaxSupervisors = readInt(flags, "contention-max-supervisors", 1, { min: 1, max: 10 });
  const dbIndexLifecycleAllowDropIndexes = readString(flags, "db-index-lifecycle-allow-drop-indexes", "");

  const baseArg = baseUrl ? ` --base-url ${shellQuote(baseUrl)}` : "";
  const indexCaptureArgs = [
    `--capture-write-retries ${indexCaptureWriteRetries}`,
    `--capture-write-retry-delay-ms ${indexCaptureWriteRetryDelayMs}`,
    `--capture-write-retry-backoff-factor ${indexCaptureWriteRetryBackoffFactor}`,
    `--capture-write-retry-max-delay-ms ${indexCaptureWriteRetryMaxDelayMs}`,
    `--capture-failure-circuit-breaker-threshold ${indexCaptureFailureCircuitBreakerThreshold}`,
    `--capture-spool-replay-max ${indexCaptureSpoolReplayMax}`,
    `--capture-spool-replay-ratio ${indexCaptureSpoolReplayRatio}`,
    `--capture-spool-max-rows ${indexCaptureSpoolMaxRows}`,
    indexCaptureFailureSpoolPath ? `--capture-failure-spool-path ${shellQuote(indexCaptureFailureSpoolPath)}` : "",
  ].filter(Boolean);
  const executed = {};

  const contentionCommand = [
    "node ./scripts/open-memory-import-contention-audit.mjs",
    "--json true",
    "--report false",
    `--max-importers ${contentionMaxImporters}`,
    `--max-watchdogs-per-root ${contentionMaxWatchdogsPerRoot}`,
    `--max-guards ${contentionMaxGuards}`,
    `--max-supervisors ${contentionMaxSupervisors}`,
  ].join(" ");
  executed.contentionAudit = runCommand(contentionCommand, { timeoutMs: 90_000 });
  executed.dbAudit = runCommand("node ./scripts/open-memory-db-audit.mjs --json true --out false", {
    timeoutMs: 4 * 60 * 1000,
  });
  executed.dbQueryPlan = runCommand("node ./scripts/open-memory-db-query-plan-probe.mjs --json true --out false", {
    timeoutMs: 4 * 60 * 1000,
  });
  executed.qosProbe = runCommand(
    `node ./scripts/open-memory-query-qos-probe.mjs --json true --query ${shellQuote(probeQuery)} --rounds ${qosRounds} --burst ${qosBurst}${baseArg}`,
    { timeoutMs: 6 * 60 * 1000 }
  );
  executed.indexProbePrimary = runCommand(
    [
      "node ./scripts/open-memory-context-experimental-index.mjs",
      "--dry-run true",
      "--json true",
      `--limit ${indexLimit}`,
      "--search-limit 64",
      "--search-seed-limit 10",
      "--max-search-queries 6",
      "--rerank-top-k 280",
      "--min-edge-support 2",
      "--min-edge-confidence 0.58",
      "--min-motif-score 1.2",
      "--max-motifs 28",
      "--max-edges 56",
      `--max-writes ${Math.max(40, Math.min(200, indexMaxWrites))}`,
      "--novelty-weight 0.28",
      "--dedupe-window-days 12",
      "--pressure-fallback-mode minimal",
      `--pressure-fallback-recent-limit ${indexPressureFallbackRecentLimit}`,
      `--pressure-fallback-search-limit ${indexPressureFallbackSearchLimit}`,
      `--pressure-fallback-search-seed-limit ${indexPressureFallbackSearchSeedLimit}`,
      `--pressure-fallback-max-search-queries ${indexPressureFallbackMaxSearchQueries}`,
      `--pressure-fallback-rerank-top-k ${indexPressureFallbackRerankTopK}`,
      `--pressure-fallback-max-motifs ${indexPressureFallbackMaxMotifs}`,
      `--pressure-fallback-max-edges ${indexPressureFallbackMaxEdges}`,
      `--pressure-fallback-max-writes ${indexPressureFallbackMaxWrites}`,
      `--pressure-fallback-hard-ratio ${indexPressureFallbackHardRatio}`,
      ...indexCaptureArgs,
      baseArg.trim(),
    ]
      .filter(Boolean)
      .join(" "),
    { timeoutMs: 8 * 60 * 1000 }
  );

  const primaryPayload = executed.indexProbePrimary.payload || {};
  const primaryTotals = primaryPayload.totals && typeof primaryPayload.totals === "object" ? primaryPayload.totals : {};
  const primarySignal = Number(primaryTotals.motifsDetected ?? 0) + Number(primaryTotals.relationshipCandidates ?? 0);

  const secondaryProbeNeeded = primarySignal < 6 && primaryPayload?.pressure?.deferred !== true;
  if (secondaryProbeNeeded) {
    executed.indexProbePermissive = runCommand(
      [
        "node ./scripts/open-memory-context-experimental-index.mjs",
        "--dry-run true",
        "--json true",
        `--limit ${Math.min(360, indexLimit + 120)}`,
        "--search-limit 92",
        "--search-seed-limit 16",
        "--max-search-queries 10",
        "--rerank-top-k 380",
        "--min-edge-support 2",
        "--min-edge-confidence 0.5",
        "--min-motif-score 0.95",
        "--max-motifs 40",
        "--max-edges 80",
        `--max-writes ${Math.max(60, Math.min(240, indexMaxWrites + 40))}`,
        "--novelty-weight 0.34",
        "--dedupe-window-days 8",
        "--pressure-fallback-mode minimal",
        `--pressure-fallback-recent-limit ${Math.min(120, indexPressureFallbackRecentLimit + 20)}`,
        `--pressure-fallback-search-limit ${Math.min(24, indexPressureFallbackSearchLimit + 4)}`,
        `--pressure-fallback-search-seed-limit ${Math.min(6, indexPressureFallbackSearchSeedLimit + 1)}`,
        `--pressure-fallback-max-search-queries ${Math.min(2, indexPressureFallbackMaxSearchQueries + 1)}`,
        `--pressure-fallback-rerank-top-k ${Math.min(180, indexPressureFallbackRerankTopK + 40)}`,
        `--pressure-fallback-max-motifs ${Math.min(16, indexPressureFallbackMaxMotifs + 4)}`,
        `--pressure-fallback-max-edges ${Math.min(28, indexPressureFallbackMaxEdges + 6)}`,
        `--pressure-fallback-max-writes ${Math.min(16, indexPressureFallbackMaxWrites + 4)}`,
        `--pressure-fallback-hard-ratio ${indexPressureFallbackHardRatio}`,
        ...indexCaptureArgs,
        baseArg.trim(),
      ]
        .filter(Boolean)
        .join(" "),
      { timeoutMs: 8 * 60 * 1000 }
    );
  }

  const contentionStatus = normalizeStatus(executed.contentionAudit.payload?.status);
  const dbStatus = normalizeStatus(executed.dbAudit.payload?.status);
  const dbPlanStatus = normalizeStatus(executed.dbQueryPlan.payload?.status);
  const qosAggregate = executed.qosProbe.payload?.aggregate && typeof executed.qosProbe.payload.aggregate === "object"
    ? executed.qosProbe.payload.aggregate
    : {};
  const qosDeferredRate = clamp(qosAggregate.deferredRate ?? 0, 0, 1);
  const qosDegradedEmptyRate = clamp(qosAggregate.degradedEmptyRate ?? 0, 0, 1);
  const qosP95Ms = clamp(qosAggregate?.latency?.overall?.p95Ms ?? 0, 0, 120_000);
  const qosInteractiveDeferredRate = clamp(qosAggregate?.deferredInteractiveRate ?? 0, 0, 1);
  const qosInteractiveDegradedRate = clamp(qosAggregate?.degradedInteractiveRate ?? 0, 0, 1);
  const qosInteractiveDegradedEmptyRate = clamp(
    Number(qosAggregate?.byLane?.interactive?.degradedEmpty ?? 0) / Math.max(1, Number(qosAggregate?.byLane?.interactive?.total ?? 0)),
    0,
    1
  );
  const qosInteractiveP95Ms = clamp(qosAggregate?.latency?.byLane?.interactive?.p95Ms ?? qosP95Ms, 0, 120_000);
  const connectionUtilizationPct = clamp(executed.dbAudit.payload?.summary?.connectionUtilizationPct ?? 0, 0, 100);

  const primaryTotalsSafe = primaryTotals;
  const secondaryPayload = executed.indexProbePermissive?.payload || null;
  const secondaryTotals = secondaryPayload?.totals && typeof secondaryPayload.totals === "object" ? secondaryPayload.totals : {};
  const secondarySignal = Number(secondaryTotals.motifsDetected ?? 0) + Number(secondaryTotals.relationshipCandidates ?? 0);
  const bestProbe =
    secondarySignal > primarySignal
      ? {
          profile: "permissive",
          payload: secondaryPayload || {},
          signalCount: secondarySignal,
        }
      : {
          profile: "balanced",
          payload: primaryPayload || {},
          signalCount: primarySignal,
        };

  const bestTotals = bestProbe.payload?.totals && typeof bestProbe.payload.totals === "object" ? bestProbe.payload.totals : {};
  const pressureMode = String(
    bestProbe.payload?.pressure?.mode || (bestProbe.payload?.pressure?.deferred === true ? "deferred" : "normal")
  );
  const pressureDeferred = pressureMode === "deferred";
  const pressureFallbackActive = pressureMode === "fallback-minimal";
  const rerankAvgScore = clamp(bestTotals.rerankAvgScore ?? 0, 0, 2);
  const dedupedRows = clamp(bestProbe.payload?.telemetry?.dedupedRows ?? 0, 0, 1_000_000);
  const signalDensity = dedupedRows > 0
    ? Number(((Number(bestTotals.motifsDetected ?? 0) + Number(bestTotals.relationshipCandidates ?? 0)) / dedupedRows).toFixed(4))
    : 0;

  const metrics = {
    contentionStatus,
    dbStatus,
    dbPlanStatus,
    qosDeferredRate,
    qosDegradedEmptyRate,
    qosP95Ms,
    qosInteractiveDeferredRate,
    qosInteractiveDegradedRate,
    qosInteractiveDegradedEmptyRate,
    qosInteractiveP95Ms,
    connectionUtilizationPct,
    pressureMode,
    pressureFallbackActive,
    pressureDeferred,
    signalCount: Number(bestTotals.motifsDetected ?? 0) + Number(bestTotals.relationshipCandidates ?? 0),
    rerankAvgScore,
    signalDensity,
  };

  const desiredProfile = computeDesiredProfile(metrics);
  const runtimeGuardEnv = parseEnvFile(INGEST_GUARD_RUNTIME_OVERRIDES_PATH);
  const currentProfile = String(runtimeGuardEnv.OPEN_MEMORY_GUARD_PROFILE || "baseline").trim().toLowerCase() || "baseline";

  const actionPlan = [];
  if (desiredProfile.profile !== currentProfile) {
    actionPlan.push(`set-guard-profile:${currentProfile}->${desiredProfile.profile}`);
  } else {
    actionPlan.push(`keep-guard-profile:${currentProfile}`);
  }
  if (pressureDeferred) {
    actionPlan.push("skip-index-apply:pressure-deferred");
  } else if (pressureFallbackActive) {
    actionPlan.push("index-running-in-pressure-fallback-lane");
  } else if (metrics.signalCount > 0) {
    actionPlan.push(`index-apply:${bestProbe.profile}`);
  } else {
    actionPlan.push("index-apply-not-recommended:no-signal-candidates");
  }
  if (dbStatus === "fail" || dbStatus === "warn") {
    actionPlan.push("db-autotune-and-remediate");
  }
  if (dbPlanStatus === "fail" || dbPlanStatus === "warn") {
    actionPlan.push("db-index-lifecycle-maintenance");
    if (!dbIndexLifecycleAllowDropIndexes) {
      actionPlan.push("db-index-lifecycle-awaiting-allowlist");
    }
  }
  if (qosDeferredRate >= 0.12 || qosDegradedEmptyRate >= 0.12) {
    actionPlan.push("tighten-ingest-pressure-controls");
  }
  if (connectionUtilizationPct >= 75) {
    actionPlan.push("prioritize-db-capacity-and-query-paths");
  }
  const qosSaturationSignal =
    qosInteractiveDeferredRate >= 0.08
    || qosInteractiveDegradedEmptyRate >= 0.08
    || qosDeferredRate >= 0.12
    || qosDegradedEmptyRate >= 0.12;
  const severeQosPressure =
    qosInteractiveDeferredRate >= 0.28
    || qosInteractiveDegradedEmptyRate >= 0.28
    || qosDeferredRate >= 0.35
    || qosDegradedEmptyRate >= 0.35
    || ((qosInteractiveP95Ms >= 7000 || qosP95Ms >= 7000) && qosSaturationSignal);
  if (severeQosPressure) {
    actionPlan.push("db-remediate-aggressive-for-qos");
    if (qosWatchdogRetune) {
      actionPlan.push(`retune-watchdog-import-cap:${qosWatchdogTargetImportCap}`);
    }
  }

  const applyResults = {};
  if (apply) {
    let recycleRecommendedByApplyActions = false;

    if (dbStatus === "fail" || dbStatus === "warn") {
      applyResults.dbAutotune = runCommand("node ./scripts/open-memory-db-autotune.mjs --json true", {
        timeoutMs: 4 * 60 * 1000,
      });
      if (dbStatus === "fail" || severeQosPressure) {
        const remediateCommand = severeQosPressure
          ? [
              "node ./scripts/open-memory-db-remediate.mjs",
              "--apply true",
              "--json true",
              "--terminate-older-than-seconds 180",
              "--terminate-limit 120",
              "--vacuum-tables memory_loop_state,studio_state_daily,brain_job_runs,memory_loop_action_idempotency",
            ].join(" ")
          : "node ./scripts/open-memory-db-remediate.mjs --apply true --json true";
        applyResults.dbRemediate = runCommand(remediateCommand, {
          timeoutMs: 4 * 60 * 1000,
        });
      }
      recycleRecommendedByApplyActions = true;
    }

    if (qosWatchdogRetune && severeQosPressure) {
      const runRoot = String(executed.contentionAudit.payload?.watchdogByRoot?.[0]?.runRoot || "").trim();
      if (runRoot && runRoot !== "<unspecified>") {
        applyResults.watchdogRetune = runCommand(
          [
            "node ./scripts/mail-import-watchdog-retune.mjs",
            `--run-root ${shellQuote(runRoot)}`,
            `--import-concurrency-cap ${qosWatchdogTargetImportCap}`,
            "--json true",
          ].join(" "),
          { timeoutMs: 2 * 60 * 1000 }
        );
        recycleRecommendedByApplyActions = true;
      } else {
        applyResults.watchdogRetune = {
          ok: true,
          skipped: true,
          reason: "watchdog-run-root-not-found",
        };
      }
    }
    if (dbPlanStatus === "fail" || dbPlanStatus === "warn") {
      const lifecycleCommand = [
        "node ./scripts/open-memory-db-index-lifecycle.mjs",
        "--apply true",
        "--json true",
        dbIndexLifecycleAllowDropIndexes
          ? `--allow-drop-indexes ${shellQuote(dbIndexLifecycleAllowDropIndexes)}`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      applyResults.dbIndexLifecycle = runCommand(lifecycleCommand, {
        timeoutMs: 4 * 60 * 1000,
      });
      recycleRecommendedByApplyActions = true;
    }

    if (desiredProfile.profile !== currentProfile) {
      applyResults.guardProfileWrite = writeGuardRuntimeOverrides(desiredProfile.profile);
      if (applyRecycle) {
        applyResults.stackRecycle = runCommand("node ./scripts/open-memory-ops-stack.mjs recycle", {
          timeoutMs: 3 * 60 * 1000,
        });
      }
    } else {
      applyResults.guardProfileWrite = {
        ok: true,
        skipped: true,
        reason: "profile-already-matches",
        profile: currentProfile,
      };
    }

    if (applyRecycle && !applyResults.stackRecycle && recycleRecommendedByApplyActions) {
      applyResults.stackRecycle = runCommand("node ./scripts/open-memory-ops-stack.mjs recycle", {
        timeoutMs: 3 * 60 * 1000,
      });
    }

    if (!pressureDeferred && metrics.signalCount > 0) {
      const tunedCommand =
        bestProbe.profile === "permissive"
          ? [
              "node ./scripts/open-memory-context-experimental-index.mjs",
              "--json true",
              `--limit ${Math.min(360, indexLimit + 120)}`,
              "--search-limit 92",
              "--search-seed-limit 16",
              "--max-search-queries 10",
              "--rerank-top-k 380",
              "--min-edge-support 2",
              "--min-edge-confidence 0.5",
              "--min-motif-score 0.95",
              "--max-motifs 40",
              "--max-edges 80",
              `--max-writes ${Math.max(60, Math.min(260, indexMaxWrites + 60))}`,
              "--novelty-weight 0.34",
              "--dedupe-window-days 8",
              "--pressure-fallback-mode minimal",
              `--pressure-fallback-recent-limit ${Math.min(120, indexPressureFallbackRecentLimit + 20)}`,
              `--pressure-fallback-search-limit ${Math.min(24, indexPressureFallbackSearchLimit + 4)}`,
              `--pressure-fallback-search-seed-limit ${Math.min(6, indexPressureFallbackSearchSeedLimit + 1)}`,
              `--pressure-fallback-max-search-queries ${Math.min(2, indexPressureFallbackMaxSearchQueries + 1)}`,
              `--pressure-fallback-rerank-top-k ${Math.min(180, indexPressureFallbackRerankTopK + 40)}`,
              `--pressure-fallback-max-motifs ${Math.min(16, indexPressureFallbackMaxMotifs + 4)}`,
              `--pressure-fallback-max-edges ${Math.min(28, indexPressureFallbackMaxEdges + 6)}`,
              `--pressure-fallback-max-writes ${Math.min(16, indexPressureFallbackMaxWrites + 4)}`,
              `--pressure-fallback-hard-ratio ${indexPressureFallbackHardRatio}`,
              ...indexCaptureArgs,
              baseArg.trim(),
            ]
              .filter(Boolean)
              .join(" ")
          : [
              "node ./scripts/open-memory-context-experimental-index.mjs",
              "--json true",
              `--limit ${indexLimit}`,
              "--search-limit 64",
              "--search-seed-limit 10",
              "--max-search-queries 6",
              "--rerank-top-k 280",
              "--min-edge-support 2",
              "--min-edge-confidence 0.58",
              "--min-motif-score 1.2",
              "--max-motifs 28",
              "--max-edges 56",
              `--max-writes ${Math.max(40, Math.min(220, indexMaxWrites))}`,
              "--novelty-weight 0.28",
              "--dedupe-window-days 12",
              "--pressure-fallback-mode minimal",
              `--pressure-fallback-recent-limit ${indexPressureFallbackRecentLimit}`,
              `--pressure-fallback-search-limit ${indexPressureFallbackSearchLimit}`,
              `--pressure-fallback-search-seed-limit ${indexPressureFallbackSearchSeedLimit}`,
              `--pressure-fallback-max-search-queries ${indexPressureFallbackMaxSearchQueries}`,
              `--pressure-fallback-rerank-top-k ${indexPressureFallbackRerankTopK}`,
              `--pressure-fallback-max-motifs ${indexPressureFallbackMaxMotifs}`,
              `--pressure-fallback-max-edges ${indexPressureFallbackMaxEdges}`,
              `--pressure-fallback-max-writes ${indexPressureFallbackMaxWrites}`,
              `--pressure-fallback-hard-ratio ${indexPressureFallbackHardRatio}`,
              ...indexCaptureArgs,
              baseArg.trim(),
            ]
              .filter(Boolean)
              .join(" ");
      applyResults.indexApply = runCommand(tunedCommand, { timeoutMs: 10 * 60 * 1000 });
      const appliedOk = applyResults.indexApply.ok && applyResults.indexApply.payload?.ok !== false;
      if (!appliedOk) {
        const previewPath = String(bestProbe.payload?.telemetry?.previewPath || "").trim();
        if (previewPath) {
          applyResults.captureFallback = runCommand(
            [
              "node ./scripts/open-memory-context-experimental-capture.mjs",
              "--json true",
              "--request-retries 2",
              "--retry-delay-ms 1200",
              "--retry-backoff-factor 2",
              `--max-writes ${Math.max(12, Math.min(60, Math.floor(indexMaxWrites * 0.4)))}`,
              `--preview-path ${shellQuote(previewPath)}`,
              baseArg.trim(),
            ]
              .filter(Boolean)
              .join(" "),
            { timeoutMs: 8 * 60 * 1000 }
          );
        }
      }
    } else {
      applyResults.indexApply = {
        ok: true,
        skipped: true,
        reason: pressureDeferred ? "pressure-deferred" : "no-signal-candidates",
      };
    }
  }

  const scoreComponents = {
    contention: contentionStatus === "pass" ? 1 : contentionStatus === "warn" ? 0.55 : 0.15,
    db: dbStatus === "pass" ? 1 : dbStatus === "warn" ? 0.6 : 0.2,
    dbPlan: dbPlanStatus === "pass" ? 1 : dbPlanStatus === "warn" ? 0.62 : 0.2,
    qos: clamp(
      1
        - (qosInteractiveDeferredRate * 0.95 + qosDeferredRate * 0.45)
        - (qosInteractiveDegradedEmptyRate * 1.2 + qosDegradedEmptyRate * 0.8)
        - (
          qosInteractiveP95Ms >= 9000
            ? 0.28
            : qosInteractiveP95Ms >= 6000
              ? 0.18
              : qosInteractiveP95Ms >= 3500
                ? 0.1
                : 0
        ),
      0,
      1
    ),
    signal: clamp((metrics.signalCount / 20) * 0.55 + rerankAvgScore * 0.45, 0, 1),
  };
  const valueScore = Number(
    (
      scoreComponents.contention * 0.2
      + scoreComponents.db * 0.2
      + scoreComponents.dbPlan * 0.15
      + scoreComponents.qos * 0.2
      + scoreComponents.signal * 0.25
    ).toFixed(4)
  );

  const status = valueScore >= 0.78 ? "pass" : valueScore >= 0.52 ? "warn" : "fail";
  const report = {
    schemaVersion: "1",
    generatedAt: new Date().toISOString(),
    startedAt,
    finishedAt: new Date().toISOString(),
    status,
    apply,
    config: {
      baseUrl: baseUrl || null,
      probeQuery,
      qosRounds,
      qosBurst,
      indexLimit,
      indexMaxWrites,
      indexPressureFallbackRecentLimit,
      indexPressureFallbackSearchLimit,
      indexPressureFallbackSearchSeedLimit,
      indexPressureFallbackMaxSearchQueries,
      indexPressureFallbackRerankTopK,
      indexPressureFallbackMaxMotifs,
      indexPressureFallbackMaxEdges,
      indexPressureFallbackMaxWrites,
      indexPressureFallbackHardRatio,
      indexCaptureWriteRetries,
      indexCaptureWriteRetryDelayMs,
      indexCaptureWriteRetryBackoffFactor,
      indexCaptureWriteRetryMaxDelayMs,
      indexCaptureFailureCircuitBreakerThreshold,
      indexCaptureFailureSpoolPath: indexCaptureFailureSpoolPath || null,
      indexCaptureSpoolReplayMax,
      indexCaptureSpoolReplayRatio,
      indexCaptureSpoolMaxRows,
      qosWatchdogRetune,
      qosWatchdogTargetImportCap,
      contentionMaxImporters,
      contentionMaxWatchdogsPerRoot,
      contentionMaxGuards,
      contentionMaxSupervisors,
      dbIndexLifecycleAllowDropIndexes: dbIndexLifecycleAllowDropIndexes || null,
      applyRecycle,
    },
    metrics: {
      ...metrics,
      valueScore,
      scoreComponents,
    },
    guardProfile: {
      current: currentProfile,
      desired: desiredProfile.profile,
      reason: desiredProfile.reason,
      runtimeOverridesPath: INGEST_GUARD_RUNTIME_OVERRIDES_PATH,
    },
    probeSelection: {
      selectedProfile: bestProbe.profile,
      primarySignal,
      secondarySignal,
      usedSecondaryProbe: secondaryProbeNeeded,
      pressureDeferred,
    },
    actionPlan,
    executed,
    applyResults,
  };

  if (reportEnabled) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  if (outputJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const lines = [];
    lines.push("Open Memory Signal Autopilot");
    lines.push(`Generated: ${report.generatedAt}`);
    lines.push(`Status: ${report.status}`);
    lines.push(`Value score: ${report.metrics.valueScore}`);
    lines.push(`Guard profile: ${report.guardProfile.current} -> ${report.guardProfile.desired}`);
    lines.push(`Pressure deferred: ${String(report.metrics.pressureDeferred)}`);
    lines.push(`Signal count: ${report.metrics.signalCount} (density=${report.metrics.signalDensity})`);
    lines.push("Actions:");
    for (const step of report.actionPlan) {
      lines.push(`- ${step}`);
    }
    if (reportEnabled) {
      lines.push(`Report: ${reportPath}`);
    }
    process.stdout.write(`${lines.join("\n")}\n`);
  }

  if (strict && report.status !== "pass") {
    process.exit(1);
  }
}

main();
