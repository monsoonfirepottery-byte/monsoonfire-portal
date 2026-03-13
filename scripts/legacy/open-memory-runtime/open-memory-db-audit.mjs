#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const STUDIO_BRAIN_ROOT = resolve(REPO_ROOT, "studio-brain");
const DEFAULT_COMPOSE_FILE = resolve(STUDIO_BRAIN_ROOT, "docker-compose.yml");
const DEFAULT_OUTPUT_PATH = resolve(REPO_ROOT, "output", "open-memory", "postgres-audit-latest.json");

const args = parseArgs(process.argv.slice(2));

if (toBool(args.help, false)) {
  printHelp();
  process.exit(0);
}

const startedAt = new Date().toISOString();
const sampleQueryLimit = clampInt(getArg(args, ["sample-query-limit", "sampleQueryLimit"]), 3, 40, 10);
const strict = toBool(getArg(args, ["strict"]), false);
const jsonOut = toBool(getArg(args, ["json"]), false);
const outputArg = getArg(args, ["out"], "");
const outputDisabled = ["false", "0", "no", "off"].includes(String(outputArg).trim().toLowerCase());
const outputPath = resolve(REPO_ROOT, outputArg && !outputDisabled ? String(outputArg) : DEFAULT_OUTPUT_PATH);

const runtime = {
  transport: String(getArg(args, ["transport"], "docker")).toLowerCase(),
  composeFile: resolve(REPO_ROOT, getArg(args, ["compose-file", "composeFile"], DEFAULT_COMPOSE_FILE)),
  postgresService: String(getArg(args, ["postgres-service", "postgresService"], "postgres")),
  host: String(getArg(args, ["host"], process.env.PGHOST || "127.0.0.1")),
  port: Number.parseInt(String(getArg(args, ["port"], process.env.PGPORT || "5433")), 10),
  user: String(getArg(args, ["user"], process.env.PGUSER || "postgres")),
  database: String(getArg(args, ["database"], process.env.PGDATABASE || "monsoonfire_studio_os")),
  outputPath,
  outputEnabled: !outputDisabled,
};

const issues = [];
const warnings = [];
const diagnostics = {
  settings: null,
  connectionSummary: null,
  connectionBreakdown: [],
  databaseStats: null,
  tableStats: [],
  unusedIndexes: [],
  longRunningQueries: [],
  extensions: [],
  vectorExtensionAvailable: null,
  embeddingColumnType: null,
  topStatements: [],
  errors: [],
};

if (runtime.transport !== "docker" && runtime.transport !== "host") {
  issues.push({
    severity: "critical",
    code: "invalid_transport",
    message: `Unsupported transport "${runtime.transport}" (expected docker|host).`,
    action: "Re-run with --transport docker or --transport host.",
  });
}

if (runtime.transport === "docker" && !existsSync(runtime.composeFile)) {
  issues.push({
    severity: "critical",
    code: "compose_missing",
    message: `Compose file not found: ${runtime.composeFile}`,
    action: "Pass --compose-file <path> pointing at studio-brain/docker-compose.yml.",
  });
}

if (issues.length === 0 && runtime.transport === "docker") {
  const composeState = runCompose(["ps", "--status", "running", "--services"], { allowFail: true, runtime });
  if (!composeState.ok) {
    issues.push({
      severity: "critical",
      code: "compose_unreachable",
      message: "Unable to query docker compose service state.",
      action: "Start Docker and verify `docker compose` can access the studio-brain stack.",
    });
    diagnostics.errors.push(trimError(composeState.error || composeState.output || "compose ps failed"));
  } else {
    const services = composeState.output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!services.includes(runtime.postgresService)) {
      issues.push({
        severity: "critical",
        code: "postgres_not_running",
        message: `Postgres service "${runtime.postgresService}" is not running in compose.`,
        action: "Run `npm run open-memory:ops:stack:up` or `docker compose -f studio-brain/docker-compose.yml up -d postgres`.",
      });
    }
  }
}

if (issues.length === 0) {
  diagnostics.settings = queryJsonValue(
    `
SELECT json_build_object(
  'max_connections', current_setting('max_connections'),
  'shared_buffers', current_setting('shared_buffers'),
  'work_mem', current_setting('work_mem'),
  'maintenance_work_mem', current_setting('maintenance_work_mem'),
  'effective_cache_size', current_setting('effective_cache_size'),
  'wal_buffers', current_setting('wal_buffers'),
  'checkpoint_timeout', current_setting('checkpoint_timeout'),
  'checkpoint_completion_target', current_setting('checkpoint_completion_target'),
  'autovacuum', current_setting('autovacuum'),
  'autovacuum_naptime', current_setting('autovacuum_naptime'),
  'autovacuum_vacuum_scale_factor', current_setting('autovacuum_vacuum_scale_factor'),
  'autovacuum_analyze_scale_factor', current_setting('autovacuum_analyze_scale_factor')
)::text
`,
    "settings",
    diagnostics,
    runtime,
  );

  diagnostics.connectionSummary = queryJsonValue(
    `
SELECT json_build_object(
  'total', count(*)::int,
  'active', count(*) FILTER (WHERE state = 'active')::int,
  'idle', count(*) FILTER (WHERE state = 'idle')::int,
  'idle_in_transaction', count(*) FILTER (WHERE state = 'idle in transaction')::int,
  'waiting', count(*) FILTER (WHERE wait_event_type IS NOT NULL AND state = 'active')::int,
  'distinct_apps', count(DISTINCT COALESCE(NULLIF(application_name, ''), '<unset>'))::int
)::text
FROM pg_stat_activity
WHERE backend_type = 'client backend'
`,
    "connection_summary",
    diagnostics,
    runtime,
  );

  diagnostics.connectionBreakdown = queryJsonArray(
    `
SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)::text
FROM (
  SELECT
    COALESCE(NULLIF(application_name, ''), '<unset>') AS application_name,
    COALESCE(state, '<none>') AS state,
    count(*)::int AS count
  FROM pg_stat_activity
  WHERE backend_type = 'client backend'
  GROUP BY 1, 2
  ORDER BY count DESC
  LIMIT 24
) t
`,
    "connection_breakdown",
    diagnostics,
    runtime,
  );

  diagnostics.databaseStats = queryJsonValue(
    `
SELECT json_build_object(
  'xact_commit', xact_commit,
  'xact_rollback', xact_rollback,
  'blks_read', blks_read,
  'blks_hit', blks_hit,
  'temp_files', temp_files,
  'temp_bytes', temp_bytes,
  'deadlocks', deadlocks,
  'tup_returned', tup_returned,
  'tup_fetched', tup_fetched,
  'tup_inserted', tup_inserted,
  'tup_updated', tup_updated,
  'tup_deleted', tup_deleted
)::text
FROM pg_stat_database
WHERE datname = current_database()
`,
    "database_stats",
    diagnostics,
    runtime,
  );

  diagnostics.tableStats = queryJsonArray(
    `
SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)::text
FROM (
  SELECT
    relname AS table_name,
    seq_scan,
    idx_scan,
    n_live_tup,
    n_dead_tup,
    CASE
      WHEN n_live_tup > 0 THEN round((n_dead_tup::numeric / n_live_tup::numeric) * 100, 2)
      ELSE NULL
    END AS dead_pct,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze
  FROM pg_stat_user_tables
  ORDER BY n_dead_tup DESC NULLS LAST
  LIMIT 30
) t
`,
    "table_stats",
    diagnostics,
    runtime,
  );

  diagnostics.unusedIndexes = queryJsonArray(
    `
SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)::text
FROM (
  SELECT
    s.relname AS table_name,
    s.indexrelname AS index_name,
    s.idx_scan,
    pg_relation_size(s.indexrelid) AS index_bytes
  FROM pg_stat_user_indexes s
  WHERE s.idx_scan = 0
  ORDER BY pg_relation_size(s.indexrelid) DESC
  LIMIT 25
) t
`,
    "unused_indexes",
    diagnostics,
    runtime,
  );

  diagnostics.longRunningQueries = queryJsonArray(
    `
SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)::text
FROM (
  SELECT
    pid,
    EXTRACT(EPOCH FROM (now() - query_start))::int AS duration_seconds,
    COALESCE(state, '<none>') AS state,
    COALESCE(wait_event_type, '') AS wait_event_type,
    regexp_replace(left(query, 240), E'[\\n\\r\\t]+', ' ', 'g') AS query
  FROM pg_stat_activity
  WHERE query_start IS NOT NULL
    AND pid <> pg_backend_pid()
    AND backend_type = 'client backend'
    AND COALESCE(state, '') <> 'idle'
  ORDER BY (now() - query_start) DESC
  LIMIT 20
) t
`,
    "long_running_queries",
    diagnostics,
    runtime,
  );

  diagnostics.extensions = queryJsonArray(
    "SELECT COALESCE(json_agg(extname ORDER BY extname), '[]'::json)::text FROM pg_extension",
    "extensions",
    diagnostics,
    runtime,
  ).map((value) => String(value));

  diagnostics.vectorExtensionAvailable = queryJsonValue(
    "SELECT json_build_object('vector', EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector'))::text",
    "vector_extension_available",
    diagnostics,
    runtime,
  );
  diagnostics.embeddingColumnType = queryJsonValue(
    `
SELECT json_build_object(
  'type',
  (
    SELECT format_type(a.atttypid, a.atttypmod)
      FROM pg_attribute a
      JOIN pg_class c
        ON c.oid = a.attrelid
      JOIN pg_namespace n
        ON n.oid = c.relnamespace
     WHERE c.relname = 'swarm_memory'
       AND a.attname = 'embedding'
       AND a.attnum > 0
       AND NOT a.attisdropped
     ORDER BY (n.nspname = 'public') DESC, n.nspname ASC
     LIMIT 1
  )
)::text
`,
    "embedding_column_type",
    diagnostics,
    runtime,
  );

  if (diagnostics.extensions.includes("pg_stat_statements")) {
    diagnostics.topStatements = queryJsonArray(
      `
SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)::text
FROM (
  SELECT
    round(total_exec_time::numeric, 2) AS total_ms,
    calls::bigint,
    round(mean_exec_time::numeric, 2) AS mean_ms,
    rows::bigint,
    shared_blks_hit::bigint,
    shared_blks_read::bigint,
    temp_blks_written::bigint,
    regexp_replace(left(query, 240), E'[\\n\\r\\t]+', ' ', 'g') AS query
  FROM pg_stat_statements
  ORDER BY total_exec_time DESC
  LIMIT ${sampleQueryLimit}
) t
`,
      "top_statements",
      diagnostics,
      runtime,
    );
  }
}

const recommendations = buildRecommendations(diagnostics, warnings, runtime);
issues.push(...warnings);

const counts = {
  critical: recommendations.filter((item) => item.severity === "critical").length,
  warn: recommendations.filter((item) => item.severity === "warn").length,
  info: recommendations.filter((item) => item.severity === "info").length,
};

const status =
  counts.critical > 0 || issues.some((item) => item.severity === "critical")
    ? "fail"
    : counts.warn > 0 || issues.length > 0
      ? "warn"
      : "pass";

const summary = summarize(diagnostics, runtime);
const envSnippet = buildEnvSnippet(diagnostics);
const now = new Date().toISOString();

const report = {
  schemaVersion: "2",
  generatedAt: now,
  startedAt,
  status,
  runtime,
  summary,
  counts,
  issues,
  recommendations,
  envSnippet,
  diagnostics,
};

if (runtime.outputEnabled) {
  const parent = dirname(runtime.outputPath);
  mkdirSync(parent, { recursive: true });
  writeFileSync(runtime.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

if (jsonOut) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  printHumanReport(report);
}

if (strict && status !== "pass") {
  process.exit(1);
}

function summarize(diagnosticsPayload, runtimePayload) {
  const settings = diagnosticsPayload.settings || {};
  const conn = diagnosticsPayload.connectionSummary || {};
  const breakdownTotals = summarizeConnectionBreakdown(diagnosticsPayload.connectionBreakdown || []);
  const db = diagnosticsPayload.databaseStats || {};

  const maxConnections = toInt(settings.max_connections, 0);
  const totalConnections = toInt(conn.total, breakdownTotals.total);
  const utilization = maxConnections > 0 ? round2((totalConnections / maxConnections) * 100) : null;
  const hitRatio = calcHitRatio(db.blks_hit, db.blks_read);
  const worstDead =
    [...(diagnosticsPayload.tableStats || [])]
      .filter((row) => typeof row?.dead_pct === "number")
      .sort((a, b) => Number(b.dead_pct) - Number(a.dead_pct))[0] || null;
  const longestQuerySeconds =
    [...(diagnosticsPayload.longRunningQueries || [])].map((row) => toInt(row.duration_seconds, 0)).sort((a, b) => b - a)[0] || 0;
  const settingsError = diagnosticsPayload.errors.some((entry) => String(entry).startsWith("settings:"));
  const connSummaryError = diagnosticsPayload.errors.some((entry) => String(entry).startsWith("connection_summary:"));

  return {
    transport: runtimePayload.transport,
    maxConnections,
    totalConnections,
    activeConnections: toInt(conn.active, breakdownTotals.active),
    connectionUtilizationPct: utilization,
    waitingConnections: toInt(conn.waiting, 0),
    idleInTransaction: toInt(conn.idle_in_transaction, 0),
    bufferCacheHitRatioPct: hitRatio,
    tempBytes: toInt(db.temp_bytes, 0),
    deadlocks: toInt(db.deadlocks, 0),
    longestQuerySeconds,
    worstDeadTupleTable: worstDead
      ? {
          table: String(worstDead.table_name || ""),
          deadPct: Number(worstDead.dead_pct || 0),
          deadTuples: toInt(worstDead.n_dead_tup, 0),
        }
      : null,
    hasPgStatStatements: diagnosticsPayload.extensions.includes("pg_stat_statements"),
    hasVectorExtension: diagnosticsPayload.extensions.includes("vector"),
    vectorExtensionAvailable: diagnosticsPayload.vectorExtensionAvailable?.vector === true,
    embeddingColumnType: String(diagnosticsPayload.embeddingColumnType?.type || "").trim() || null,
    settingsQueryBlocked: settingsError,
    connectionSummaryQueryBlocked: connSummaryError,
  };
}

function buildRecommendations(diagnosticsPayload, collector, runtimePayload) {
  const recs = [];
  const settings = diagnosticsPayload.settings || {};
  const conn = diagnosticsPayload.connectionSummary || {};
  const db = diagnosticsPayload.databaseStats || {};
  const tableStats = diagnosticsPayload.tableStats || [];
  const longRunning = diagnosticsPayload.longRunningQueries || [];
  const topStatements = diagnosticsPayload.topStatements || [];
  const unusedIndexes = diagnosticsPayload.unusedIndexes || [];
  const breakdownTotals = summarizeConnectionBreakdown(diagnosticsPayload.connectionBreakdown || []);

  const maxConnections = toInt(settings.max_connections, 0);
  const totalConnections = toInt(conn.total, breakdownTotals.total);
  const activeConnections = toInt(conn.active, breakdownTotals.active);
  const waiting = toInt(conn.waiting, 0);
  const idleInTx = toInt(conn.idle_in_transaction, 0);
  const connRatio = maxConnections > 0 ? totalConnections / maxConnections : 0;
  const hitRatio = calcHitRatio(db.blks_hit, db.blks_read);
  const sharedBuffersBytes = parsePgMemoryToBytes(settings.shared_buffers);
  const checkpointTarget = Number.parseFloat(String(settings.checkpoint_completion_target || "0"));
  const autovacuumValue = typeof settings.autovacuum === "string" ? String(settings.autovacuum).toLowerCase() : "";
  const tempBytes = toInt(db.temp_bytes, 0);
  const longest = [...longRunning].map((row) => toInt(row.duration_seconds, 0)).sort((a, b) => b - a)[0] || 0;
  const tempSpillHot = topStatements.some((row) => toInt(row?.temp_blks_written, 0) > 0);
  const totalUnusedIndexBytes = unusedIndexes.reduce((total, row) => total + toInt(row?.index_bytes, 0), 0);
  const largestUnusedIndex = [...unusedIndexes].sort((a, b) => toInt(b?.index_bytes, 0) - toInt(a?.index_bytes, 0))[0] || null;
  const hasSettings = settings && Object.keys(settings).length > 0;
  const settingsBlocked = diagnosticsPayload.errors.some((entry) => String(entry).startsWith("settings:"));
  const summaryBlocked = diagnosticsPayload.errors.some((entry) => String(entry).startsWith("connection_summary:"));
  const tooManyClientsObserved = diagnosticsPayload.errors.some((entry) => /too many clients already/i.test(String(entry)));
  const embeddingColumnType = String(diagnosticsPayload.embeddingColumnType?.type || "").trim().toLowerCase();

  if (maxConnections > 0 && connRatio >= 0.9) {
    recs.push({
      severity: "critical",
      code: "connections_saturated",
      message: `Connection utilization is ${round2(connRatio * 100)}% (${totalConnections}/${maxConnections}).`,
      action: "Reduce concurrent import workers immediately and lower per-process PG pool caps until utilization stays under 70%.",
    });
  } else if (maxConnections > 0 && connRatio >= 0.75) {
    recs.push({
      severity: "warn",
      code: "connections_high",
      message: `Connection utilization is high at ${round2(connRatio * 100)}% (${totalConnections}/${maxConnections}).`,
      action: "Keep import concurrency capped and tune STUDIO_BRAIN_PG_POOL_MAX downward for ingest-heavy sessions.",
    });
  }

  if (maxConnections <= 0 && activeConnections >= 80) {
    recs.push({
      severity: "critical",
      code: "connections_saturated_inferred",
      message: `At least ${activeConnections} active connections observed, and max_connections could not be read.`,
      action: "Treat DB as saturated now: throttle import concurrency to 1 and run DB remediation before resuming heavy ingest.",
    });
  }

  if (waiting > 0) {
    recs.push({
      severity: waiting >= 3 ? "critical" : "warn",
      code: "connection_waits",
      message: `${waiting} backend connections are waiting on locks/events.`,
      action: "Inspect long-running queries + lock contention and pause restart storms from ingest watchdogs while queue clears.",
    });
  }

  if (idleInTx > 0) {
    recs.push({
      severity: idleInTx >= 2 ? "warn" : "info",
      code: "idle_in_transaction",
      message: `${idleInTx} session(s) are idle in transaction.`,
      action: "Audit worker transaction boundaries; idle-in-tx sessions block vacuum and increase bloat risk.",
    });
  }

  if (hasSettings && autovacuumValue && autovacuumValue !== "on") {
    recs.push({
      severity: "critical",
      code: "autovacuum_disabled",
      message: "Autovacuum is disabled.",
      action: "Enable autovacuum and restart Postgres; without it, write-heavy memory ingestion will degrade rapidly.",
    });
  } else if (!hasSettings && settingsBlocked) {
    recs.push({
      severity: "warn",
      code: "settings_unreadable_under_pressure",
      message: "Could not read key Postgres settings during pressure.",
      action: "Re-run audit after immediate pressure relief to confirm autovacuum/checkpoint configuration.",
    });
  }

  if (sharedBuffersBytes > 0 && sharedBuffersBytes < 128 * 1024 * 1024) {
    recs.push({
      severity: "warn",
      code: "shared_buffers_low",
      message: `shared_buffers is ${settings.shared_buffers}, which is low for current write/read pressure.`,
      action: "Raise shared_buffers (for example 256MB-512MB) with matching container memory headroom.",
    });
  }

  if (Number.isFinite(hitRatio) && hitRatio < 95) {
    recs.push({
      severity: "warn",
      code: "cache_hit_low",
      message: `Buffer cache hit ratio is ${round2(hitRatio)}%.`,
      action: "Increase memory headroom (shared_buffers/effective_cache_size), then re-check hit ratio after steady load.",
    });
  }

  if (Number.isFinite(checkpointTarget) && checkpointTarget > 0 && checkpointTarget < 0.9) {
    recs.push({
      severity: "info",
      code: "checkpoint_target_suboptimal",
      message: `checkpoint_completion_target is ${checkpointTarget}.`,
      action: "Set checkpoint_completion_target near 0.9 for smoother write bursts during imports.",
    });
  }

  if (tempBytes >= 512 * 1024 * 1024 && (tempSpillHot || longest >= 60)) {
    recs.push({
      severity: "warn",
      code: "temp_spill_high",
      message: `Temporary file spill is ${formatBytes(tempBytes)}.`,
      action: "Review expensive sort/hash queries and consider a modest work_mem increase after verifying memory budget.",
    });
  } else if (tempBytes >= 512 * 1024 * 1024) {
    recs.push({
      severity: "info",
      code: "temp_spill_historical",
      message: `Historical temp spill is ${formatBytes(tempBytes)}, but no active spill-heavy statements were detected.`,
      action: "Track temp spill deltas over time; intervene only if temp-heavy statements reappear.",
    });
  }

  if (longest >= 900) {
    recs.push({
      severity: "critical",
      code: "runaway_queries_detected",
      message: `Runaway active query duration detected (${longest}s).`,
      action: "Run `npm run open-memory:ops:db:remediate:apply` to terminate known runaway memory queries and apply DB safety timeouts.",
    });
  } else if (longest >= 60) {
    recs.push({
      severity: "warn",
      code: "long_running_queries",
      message: `Longest active query is ${longest}s.`,
      action: "Capture EXPLAIN ANALYZE for top long-running statements and add indexes or stricter server-side statement timeouts.",
    });
  }

  const deadTupleHotspots = tableStats
    .filter((row) => {
      const deadPct = Number(row?.dead_pct || 0);
      const dead = toInt(row?.n_dead_tup, 0);
      return deadPct >= 20 && dead >= 25_000;
    })
    .slice(0, 3);
  for (const row of deadTupleHotspots) {
    recs.push({
      severity: Number(row.dead_pct) >= 35 ? "warn" : "info",
      code: "table_dead_tuple_hotspot",
      message: `${row.table_name} has ${toInt(row.n_dead_tup, 0)} dead tuples (${row.dead_pct}% dead/live).`,
      action: `Run targeted VACUUM (ANALYZE) on ${row.table_name} and check autovacuum cadence for this table.`,
    });
  }

  const seqHeavyNoIndex = tableStats
    .filter((row) => toInt(row.seq_scan, 0) >= 1500 && toInt(row.idx_scan, 0) === 0 && toInt(row.n_live_tup, 0) >= 5_000)
    .slice(0, 3);
  for (const row of seqHeavyNoIndex) {
    recs.push({
      severity: "warn",
      code: "seq_scan_hotspot",
      message: `${row.table_name} has high seq_scan (${row.seq_scan}) with idx_scan=0.`,
      action: `Review frequent predicates on ${row.table_name} and add targeted indexes for top query patterns.`,
    });
  }

  if (totalUnusedIndexBytes >= 1024 * 1024 * 1024) {
    recs.push({
      severity: "warn",
      code: "unused_index_storage_high",
      message: `Unused index storage footprint is ${formatBytes(totalUnusedIndexBytes)}.`,
      action:
        "Run `npm run open-memory:ops:db:index:lifecycle` to collect lifecycle evidence and `open-memory:ops:db:index:lifecycle:apply` with allowlist after gates are met.",
    });
  }

  if (largestUnusedIndex && toInt(largestUnusedIndex.index_bytes, 0) >= 1024 * 1024 * 1024) {
    recs.push({
      severity: "info",
      code: "largest_unused_index_candidate",
      message: `Largest unused index candidate is ${largestUnusedIndex.index_name} (${formatBytes(toInt(largestUnusedIndex.index_bytes, 0))}).`,
      action: "Track this index across lifecycle snapshots before dropping it in a controlled maintenance window.",
    });
  }

  if (!diagnosticsPayload.extensions.includes("pg_stat_statements")) {
    recs.push({
      severity: "warn",
      code: "missing_pg_stat_statements",
      message: "pg_stat_statements extension is not enabled.",
      action: "Enable pg_stat_statements via remediation tooling, then rerun audit to unlock query-level performance visibility.",
    });
  } else if (topStatements.length > 0) {
    const recentOrderHotspot = topStatements.some((row) => {
      const query = String(row?.query || "").toLowerCase();
      return query.includes("from swarm_memory") && query.includes("order by coalesce(occurred_at, created_at) desc");
    });
    if (recentOrderHotspot) {
      recs.push({
        severity: "warn",
        code: "swarm_memory_recent_order_hotspot",
        message: "Top statements include heavy swarm_memory recent-order scans.",
        action:
          "Apply migration 017_memory_recent_query_acceleration.sql (or restart Studio Brain to run pending migrations), then rerun QoS + DB audit.",
      });
    }
    const expensive = topStatements
      .filter((row) => Number(row?.mean_ms || 0) >= 80 && toInt(row?.calls, 0) >= 25)
      .slice(0, 3);
    for (const row of expensive) {
      recs.push({
        severity: "info",
        code: "expensive_statement",
        message: `High-cost statement mean=${row.mean_ms}ms calls=${row.calls}.`,
        action: `Run EXPLAIN (ANALYZE, BUFFERS) on: ${String(row.query || "").slice(0, 120)}...`,
      });
    }
  }

  if (diagnosticsPayload.extensions.includes("vector") && embeddingColumnType.includes("double precision[]")) {
    recs.push({
      severity: "warn",
      code: "embedding_column_legacy_array_type",
      message: "swarm_memory.embedding is double precision[] while pgvector is enabled.",
      action:
        "Keep vector-store compatibility mode enabled immediately, then run `npm run open-memory:ops:db:embedding:normalize` (plan) and `...:apply` in a maintenance window.",
    });
  }

  if (!diagnosticsPayload.extensions.includes("vector")) {
    if (diagnosticsPayload.vectorExtensionAvailable?.vector === true) {
      recs.push({
        severity: "info",
        code: "vector_extension_missing",
        message: "pgvector extension is not installed.",
        action: "Install pgvector (`CREATE EXTENSION vector`) if semantic retrieval quality/latency is a priority.",
      });
    } else {
      recs.push({
        severity: "info",
        code: "vector_extension_unavailable",
        message: "pgvector extension is not available in this Postgres runtime.",
        action: "Use a Postgres image/build that includes pgvector, then run `CREATE EXTENSION vector`.",
      });
    }
  }

  if (tooManyClientsObserved || summaryBlocked) {
    recs.push({
      severity: "critical",
      code: "too_many_clients_observed",
      message: "Audit observed `too many clients already` while sampling.",
      action: "Run `npm run open-memory:ops:db:autotune` and `npm run open-memory:ops:db:remediate:apply`, then recycle Studio Brain sessions.",
    });
  }

  if (diagnosticsPayload.errors.length > 0) {
    collector.push({
      severity: "warn",
      code: "partial_diagnostics",
      message: `${diagnosticsPayload.errors.length} diagnostics query/parse operation(s) failed.`,
      action: "Review diagnostics.errors in the JSON output and rerun after restoring DB stability.",
    });
  }

  if (recs.length === 0) {
    recs.push({
      severity: "info",
      code: "healthy_baseline",
      message: "No obvious bottleneck flags detected in this sample.",
      action: "Keep periodic audits running during heavy ingest windows and compare trend deltas.",
    });
  }

  recs.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  recs.unshift({
    severity: "info",
    code: "transport_context",
    message: `Audit completed via ${runtimePayload.transport} transport against ${runtimePayload.database}.`,
    action: "Use --transport host only when docker compose is unavailable.",
  });
  return recs;
}

function buildEnvSnippet(diagnosticsPayload) {
  const settings = diagnosticsPayload.settings || {};
  const conn = diagnosticsPayload.connectionSummary || {};
  const breakdownTotals = summarizeConnectionBreakdown(diagnosticsPayload.connectionBreakdown || []);
  const maxConnections = toInt(settings.max_connections, 100);
  const totalConnections = toInt(conn.total, breakdownTotals.total);
  const waiting = toInt(conn.waiting, 0);
  const connRatio = maxConnections > 0 ? totalConnections / maxConnections : 0;

  let poolMax = 8;
  if (maxConnections <= 40) poolMax = 4;
  else if (maxConnections <= 80) poolMax = 6;
  else if (maxConnections >= 140) poolMax = 10;
  if (connRatio >= 0.85 || waiting > 0 || totalConnections >= 90) {
    poolMax = Math.max(4, Math.min(poolMax, Math.floor(maxConnections * 0.08) || 6));
  }

  const importConcurrencyCap = connRatio >= 0.8 || waiting > 0 || totalConnections >= 90 ? 1 : 2;
  const restartCooldown = importConcurrencyCap === 1 ? 180 : 90;
  const statementTimeout = connRatio >= 0.8 || totalConnections >= 90 ? 16_000 : 14_000;
  const queryTimeout = statementTimeout + 2_000;
  const routeTimeout = queryTimeout + 2_000;
  const maxActiveQuery = connRatio >= 0.8 || totalConnections >= 90 ? 24 : 32;
  const maxActiveSearch = connRatio >= 0.8 || totalConnections >= 90 ? 18 : 26;
  const maxActiveContext = connRatio >= 0.8 || totalConnections >= 90 ? 10 : 16;

  return [
    "# Suggested ingest-storm tuning overrides",
    `STUDIO_BRAIN_PG_POOL_MAX=${poolMax}`,
    "STUDIO_BRAIN_PG_CONNECTION_TIMEOUT_MS=10000",
    `STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS=${queryTimeout}`,
    `STUDIO_BRAIN_PG_STATEMENT_TIMEOUT_MS=${statementTimeout}`,
    "STUDIO_BRAIN_PG_LOCK_TIMEOUT_MS=4000",
    "STUDIO_BRAIN_PG_IDLE_IN_TRANSACTION_TIMEOUT_MS=15000",
    `STUDIO_BRAIN_MAX_ACTIVE_SEARCH_REQUESTS=${maxActiveSearch}`,
    `STUDIO_BRAIN_MAX_ACTIVE_CONTEXT_REQUESTS=${maxActiveContext}`,
    `STUDIO_BRAIN_MAX_ACTIVE_MEMORY_QUERY_REQUESTS=${maxActiveQuery}`,
    `STUDIO_BRAIN_MEMORY_QUERY_ROUTE_TIMEOUT_MS=${routeTimeout}`,
    "STUDIO_BRAIN_MEMORY_QUERY_LEXICAL_TIMEOUT_FALLBACK=true",
    `STUDIO_BRAIN_IMPORT_CONCURRENCY_CAP=${importConcurrencyCap}`,
    `MAIL_IMPORT_IMPORT_CONCURRENCY_CAP=${importConcurrencyCap}`,
    `MAIL_IMPORT_BACKEND_SATURATION_COOLDOWN_SECONDS=${restartCooldown}`,
  ].join("\n");
}

function summarizeConnectionBreakdown(rows) {
  const totals = { total: 0, active: 0 };
  for (const row of rows) {
    const count = toInt(row?.count, 0);
    const state = String(row?.state || "").toLowerCase();
    totals.total += count;
    if (state === "active") totals.active += count;
  }
  return totals;
}

function printHumanReport(report) {
  const lines = [];
  lines.push(`open-memory db audit status: ${String(report.status).toUpperCase()}`);
  lines.push(`generatedAt: ${report.generatedAt}`);
  lines.push(`target: ${report.runtime.transport} db=${report.runtime.database} user=${report.runtime.user}`);
  lines.push("");
  lines.push("summary:");
  lines.push(`  max_connections: ${report.summary.maxConnections}`);
  lines.push(`  total_connections: ${report.summary.totalConnections}`);
  lines.push(`  active_connections: ${report.summary.activeConnections}`);
  lines.push(`  utilization_pct: ${report.summary.connectionUtilizationPct ?? "n/a"}`);
  lines.push(`  waiting_connections: ${report.summary.waitingConnections}`);
  lines.push(`  idle_in_transaction: ${report.summary.idleInTransaction}`);
  lines.push(`  buffer_cache_hit_ratio_pct: ${report.summary.bufferCacheHitRatioPct ?? "n/a"}`);
  lines.push(`  temp_bytes: ${formatBytes(report.summary.tempBytes)}`);
  lines.push(`  longest_query_seconds: ${report.summary.longestQuerySeconds}`);
  lines.push(`  pg_stat_statements: ${report.summary.hasPgStatStatements ? "enabled" : "missing"}`);
  lines.push(`  vector_extension: ${report.summary.hasVectorExtension ? "enabled" : "missing"}`);
  lines.push(`  embedding_column_type: ${report.summary.embeddingColumnType || "unknown"}`);
  lines.push("");
  lines.push("recommendations:");
  report.recommendations.forEach((item, index) => {
    lines.push(`  ${index + 1}. [${String(item.severity).toUpperCase()}] ${item.message}`);
    lines.push(`     action: ${item.action}`);
  });
  if (report.issues.length > 0) {
    lines.push("");
    lines.push("issues:");
    report.issues.forEach((item, index) => {
      lines.push(`  ${index + 1}. [${String(item.severity).toUpperCase()}] ${item.message}`);
      lines.push(`     action: ${item.action}`);
    });
  }
  lines.push("");
  lines.push("suggested_env_snippet:");
  lines.push(report.envSnippet);
  lines.push("");
  lines.push(`report_path: ${report.runtime.outputPath}`);
  process.stdout.write(`${lines.join("\n")}\n`);
}

function queryJsonValue(sql, label, diagnosticsPayload, runtimePayload) {
  const out = runSql(sql, { allowFail: true, runtime: runtimePayload });
  if (!out.ok) {
    diagnosticsPayload.errors.push(`${label}: ${trimError(out.error || out.output || "query failed")}`);
    return null;
  }
  const parsed = parseLastJsonLine(out.output);
  if (!parsed.ok) {
    diagnosticsPayload.errors.push(`${label}: ${parsed.error}`);
    return null;
  }
  if (parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)) {
    return parsed.value;
  }
  diagnosticsPayload.errors.push(`${label}: expected JSON object result`);
  return null;
}

function queryJsonArray(sql, label, diagnosticsPayload, runtimePayload) {
  const out = runSql(sql, { allowFail: true, runtime: runtimePayload });
  if (!out.ok) {
    diagnosticsPayload.errors.push(`${label}: ${trimError(out.error || out.output || "query failed")}`);
    return [];
  }
  const parsed = parseLastJsonLine(out.output);
  if (!parsed.ok) {
    diagnosticsPayload.errors.push(`${label}: ${parsed.error}`);
    return [];
  }
  if (Array.isArray(parsed.value)) return parsed.value;
  diagnosticsPayload.errors.push(`${label}: expected JSON array result`);
  return [];
}

function parseLastJsonLine(output) {
  const trimmed = String(output || "").trim();
  if (!trimmed) return { ok: false, error: "empty output" };
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return { ok: true, value: JSON.parse(lines[index]) };
    } catch {
      continue;
    }
  }
  return { ok: false, error: "no parseable JSON line in output" };
}

function runSql(sql, options) {
  const runtimePayload = options.runtime;
  const sqlText = String(sql || "").trim();
  if (!sqlText) return { ok: false, output: "", error: "missing sql" };

  if (runtimePayload.transport === "docker") {
    return runCompose(
      [
        "exec",
        "-T",
        runtimePayload.postgresService,
        "psql",
        "-X",
        "-A",
        "-t",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        runtimePayload.user,
        "-d",
        runtimePayload.database,
        "-c",
        sqlText,
      ],
      { allowFail: options.allowFail, runtime: runtimePayload },
    );
  }

  return runProcess(
    "psql",
    [
      "-X",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-h",
      runtimePayload.host,
      "-p",
      String(runtimePayload.port),
      "-U",
      runtimePayload.user,
      "-d",
      runtimePayload.database,
      "-c",
      sqlText,
    ],
    { allowFail: options.allowFail, cwd: REPO_ROOT },
  );
}

function runCompose(argsLocal, options) {
  return runProcess("docker", ["compose", "-f", options.runtime.composeFile, ...argsLocal], {
    allowFail: options.allowFail,
    cwd: STUDIO_BRAIN_ROOT,
  });
}

function runProcess(cmd, argvList, options = {}) {
  const result = spawnSync(cmd, argvList, {
    cwd: options.cwd || REPO_ROOT,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const output = `${stdout}${stderr}`.trim();
  const ok = result.status === 0;
  if (!ok && !options.allowFail) {
    throw new Error(`${cmd} ${argvList.join(" ")} failed (${result.status ?? "unknown"}): ${output || "no output"}`);
  }
  return {
    ok,
    status: result.status ?? 1,
    output,
    error: ok ? "" : output,
  };
}

function calcHitRatio(blksHit, blksRead) {
  const hit = toInt(blksHit, 0);
  const read = toInt(blksRead, 0);
  const total = hit + read;
  if (total <= 0) return null;
  return round2((hit / total) * 100);
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePgMemoryToBytes(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)?$/);
  if (!match) return 0;
  const num = Number.parseFloat(match[1]);
  if (!Number.isFinite(num)) return 0;
  const unit = String(match[2] || "B").toLowerCase();
  const factors = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
  const factor = factors[unit] || 1;
  return Math.round(num * factor);
}

function formatBytes(bytes) {
  const value = Math.max(0, toInt(bytes, 0));
  if (value === 0) return "0B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let idx = 0;
  while (amount >= 1024 && idx < units.length - 1) {
    amount /= 1024;
    idx += 1;
  }
  return `${round2(amount)}${units[idx]}`;
}

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!String(token).startsWith("--")) continue;
    const rawKey = String(token).slice(2).trim();
    const key = rawKey.toLowerCase();
    const next = argv[index + 1];
    if (!next || String(next).startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = String(next);
    index += 1;
  }
  return flags;
}

function getArg(flags, keys, fallback = "") {
  for (const key of keys) {
    const value = flags[String(key).toLowerCase()];
    if (value !== undefined) return value;
  }
  return fallback;
}

function toBool(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function severityRank(severity) {
  if (severity === "critical") return 0;
  if (severity === "warn") return 1;
  return 2;
}

function round2(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

function trimError(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 280);
}

function printHelp() {
  process.stdout.write(
    [
      "Usage:",
      "  node ./scripts/open-memory-db-audit.mjs [options]",
      "",
      "Options:",
      "  --json true|false              Emit JSON to stdout (default: false)",
      "  --strict true|false            Exit non-zero when status != pass (default: false)",
      "  --out <path|false>             Write report artifact (default: output/open-memory/postgres-audit-latest.json)",
      "  --sample-query-limit <n>       Number of pg_stat_statements rows (default: 10)",
      "  --transport docker|host        Query via docker compose exec or host psql (default: docker)",
      "  --compose-file <path>          Compose file for docker transport",
      "  --postgres-service <name>      Compose postgres service name (default: postgres)",
      "  --host <value>                 Host psql target (host transport only)",
      "  --port <value>                 Port psql target (host transport only)",
      "  --database <value>             Database name",
      "  --user <value>                 Database user",
      "  --help                         Show this help",
      "",
      "Examples:",
      "  npm run open-memory:ops:db:audit",
      "  node ./scripts/open-memory-db-audit.mjs --transport host --json true --strict true",
      "",
    ].join("\n"),
  );
}
