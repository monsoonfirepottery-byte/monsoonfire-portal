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
const DEFAULT_OUTPUT_PATH = resolve(REPO_ROOT, "output", "open-memory", "postgres-query-plan-latest.json");

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

function runProcess(cmd, argv, { cwd = REPO_ROOT, allowFail = false } = {}) {
  const result = spawnSync(cmd, argv, {
    cwd,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 20 * 1024 * 1024,
  });
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const output = `${stdout}${stderr}`.trim();
  const ok = result.status === 0;
  if (!ok && !allowFail) {
    throw new Error(`${cmd} ${argv.join(" ")} failed (${result.status ?? "unknown"}): ${output || "no output"}`);
  }
  return {
    ok,
    status: result.status ?? 1,
    output,
    error: ok ? "" : output,
  };
}

function runCompose(argv, { runtime, allowFail = false } = {}) {
  return runProcess("docker", ["compose", "-f", runtime.composeFile, ...argv], {
    cwd: STUDIO_BRAIN_ROOT,
    allowFail,
  });
}

function runSql(sql, { runtime, allowFail = false } = {}) {
  const statement = String(sql || "").trim();
  if (!statement) return { ok: false, output: "", error: "missing sql" };
  if (runtime.transport === "docker") {
    return runCompose(
      [
        "exec",
        "-T",
        runtime.postgresService,
        "psql",
        "-X",
        "-A",
        "-t",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        runtime.user,
        "-d",
        runtime.database,
        "-c",
        statement,
      ],
      { runtime, allowFail }
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
      runtime.host,
      "-p",
      String(runtime.port),
      "-U",
      runtime.user,
      "-d",
      runtime.database,
      "-c",
      statement,
    ],
    { cwd: REPO_ROOT, allowFail }
  );
}

function parseLastJsonLine(output) {
  const trimmed = String(output || "").trim();
  if (!trimmed) return { ok: false, error: "empty output" };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {}

  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    const bracketSlice = trimmed.slice(firstBracket, lastBracket + 1);
    try {
      return { ok: true, value: JSON.parse(bracketSlice) };
    } catch {}
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    try {
      return { ok: true, value: JSON.parse(line) };
    } catch {
      continue;
    }
  }
  return { ok: false, error: "no parseable JSON line in output" };
}

function parseJsonObject(sql, label, runtime, errors) {
  const out = runSql(sql, { runtime, allowFail: true });
  if (!out.ok) {
    errors.push(`${label}: ${String(out.error || out.output || "query-failed").slice(0, 300)}`);
    return null;
  }
  const parsed = parseLastJsonLine(out.output);
  if (!parsed.ok) {
    errors.push(`${label}: ${parsed.error}`);
    return null;
  }
  return parsed.value;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function collectPlanNodes(node, depth = 0, acc = []) {
  if (!node || typeof node !== "object") return acc;
  const nodeType = String(node["Node Type"] || "Unknown");
  const relationName = String(node["Relation Name"] || "");
  const indexName = String(node["Index Name"] || "");
  const actualRows = toNumber(node["Actual Rows"], 0);
  const actualTime = toNumber(node["Actual Total Time"], 0);
  const planRows = toNumber(node["Plan Rows"], 0);
  const loops = toNumber(node["Actual Loops"], 1);
  const sharedHitBlocks = toNumber(node["Shared Hit Blocks"], 0);
  const sharedReadBlocks = toNumber(node["Shared Read Blocks"], 0);
  const tempReadBlocks = toNumber(node["Temp Read Blocks"], 0);
  const tempWrittenBlocks = toNumber(node["Temp Written Blocks"], 0);
  acc.push({
    depth,
    nodeType,
    relationName,
    indexName,
    actualRows,
    planRows,
    actualTimeMs: actualTime,
    loops,
    sharedHitBlocks,
    sharedReadBlocks,
    tempReadBlocks,
    tempWrittenBlocks,
  });
  const plans = Array.isArray(node.Plans) ? node.Plans : [];
  for (const child of plans) {
    collectPlanNodes(child, depth + 1, acc);
  }
  return acc;
}

function explainQuery(query, runtime, errors) {
  const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`;
  const out = runSql(explainSql, { runtime, allowFail: true });
  if (!out.ok) {
    const error = String(out.error || out.output || "explain-failed");
    errors.push(`${query.name}: ${error.slice(0, 320)}`);
    return {
      name: query.name,
      ok: false,
      skipped: false,
      error: error.slice(0, 2000),
    };
  }
  const parsed = parseLastJsonLine(out.output);
  if (!parsed.ok) {
    errors.push(`${query.name}: ${parsed.error}`);
    return {
      name: query.name,
      ok: false,
      skipped: false,
      error: parsed.error,
    };
  }
  const payload = Array.isArray(parsed.value) ? parsed.value[0] : parsed.value;
  const root = payload?.Plan && typeof payload.Plan === "object" ? payload.Plan : null;
  if (!root) {
    errors.push(`${query.name}: missing root plan`);
    return {
      name: query.name,
      ok: false,
      skipped: false,
      error: "missing-root-plan",
    };
  }
  const nodes = collectPlanNodes(root);
  const seqScans = nodes
    .filter((node) => node.nodeType.toLowerCase().includes("seq scan"))
    .map((node) => ({
      relationName: node.relationName || null,
      actualRows: Math.round(node.actualRows),
      planRows: Math.round(node.planRows),
      actualTimeMs: Number(node.actualTimeMs.toFixed(2)),
      loops: node.loops,
    }));
  const indexScans = nodes
    .filter((node) => node.nodeType.toLowerCase().includes("index"))
    .map((node) => ({
      nodeType: node.nodeType,
      relationName: node.relationName || null,
      indexName: node.indexName || null,
      actualRows: Math.round(node.actualRows),
      planRows: Math.round(node.planRows),
      actualTimeMs: Number(node.actualTimeMs.toFixed(2)),
      loops: node.loops,
    }));
  const buffers = nodes.reduce(
    (acc, node) => {
      acc.sharedHitBlocks += node.sharedHitBlocks;
      acc.sharedReadBlocks += node.sharedReadBlocks;
      acc.tempReadBlocks += node.tempReadBlocks;
      acc.tempWrittenBlocks += node.tempWrittenBlocks;
      return acc;
    },
    {
      sharedHitBlocks: 0,
      sharedReadBlocks: 0,
      tempReadBlocks: 0,
      tempWrittenBlocks: 0,
    }
  );
  const executionTimeMs = toNumber(payload["Execution Time"], 0);
  const planningTimeMs = toNumber(payload["Planning Time"], 0);
  const slowNodes = [...nodes]
    .sort((left, right) => right.actualTimeMs - left.actualTimeMs)
    .slice(0, 5)
    .map((node) => ({
      nodeType: node.nodeType,
      relationName: node.relationName || null,
      indexName: node.indexName || null,
      actualTimeMs: Number(node.actualTimeMs.toFixed(2)),
      actualRows: Math.round(node.actualRows),
      loops: node.loops,
    }));
  return {
    name: query.name,
    ok: true,
    skipped: false,
    description: query.description,
    executionTimeMs: Number(executionTimeMs.toFixed(2)),
    planningTimeMs: Number(planningTimeMs.toFixed(2)),
    nodeCount: nodes.length,
    seqScans,
    indexScans,
    buffers,
    slowNodes,
  };
}

function severityRank(severity) {
  if (severity === "critical") return 3;
  if (severity === "warn") return 2;
  return 1;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (readBool(flags, "help", false)) {
    process.stdout.write(
      [
        "Open Memory DB Query Plan Probe",
        "",
        "Usage:",
        "  node ./scripts/open-memory-db-query-plan-probe.mjs --json true",
        "",
        "Options:",
        "  --transport docker|host                Query transport (default: docker)",
        "  --compose-file <path>                  Compose file path for docker transport",
        "  --postgres-service <name>              Postgres service name (default: postgres)",
        "  --host <host>                          Host for host transport",
        "  --port <port>                          Port for host transport",
        "  --user <user>                          DB user (default: postgres)",
        "  --database <name>                      Database name (default: monsoonfire_studio_os)",
        "  --warn-exec-ms <n>                     Warning threshold for query execution time (default: 120)",
        "  --critical-exec-ms <n>                 Critical threshold for query execution time (default: 350)",
        "  --seq-scan-rows-warn <n>               Warning threshold for seq-scan rows (default: 5000)",
        "  --out <path|false>                     Report output path (false disables write)",
        "  --json true|false                      Emit JSON output (default: true)",
        "  --strict true|false                    Exit non-zero when status != pass (default: false)",
      ].join("\n") + "\n"
    );
    return;
  }

  const errors = [];
  const strict = readBool(flags, "strict", false);
  const outputJson = readBool(flags, "json", true);
  const warnExecMs = readInt(flags, "warn-exec-ms", 120, { min: 20, max: 10_000 });
  const criticalExecMs = readInt(flags, "critical-exec-ms", 350, { min: 40, max: 20_000 });
  const seqScanRowsWarn = readInt(flags, "seq-scan-rows-warn", 5000, { min: 100, max: 20_000_000 });
  const outputArg = readString(flags, "out", DEFAULT_OUTPUT_PATH);
  const outputEnabled = !["false", "0", "no", "off"].includes(String(outputArg).toLowerCase());
  const outputPath = resolve(REPO_ROOT, outputArg || DEFAULT_OUTPUT_PATH);

  const runtime = {
    transport: readString(flags, "transport", "docker").toLowerCase(),
    composeFile: resolve(REPO_ROOT, readString(flags, "compose-file", DEFAULT_COMPOSE_FILE)),
    postgresService: readString(flags, "postgres-service", "postgres"),
    host: readString(flags, "host", process.env.PGHOST || "127.0.0.1"),
    port: readInt(flags, "port", Number.parseInt(process.env.PGPORT || "5433", 10), { min: 1, max: 65535 }),
    user: readString(flags, "user", process.env.PGUSER || "postgres"),
    database: readString(flags, "database", process.env.PGDATABASE || "monsoonfire_studio_os"),
  };

  const startupIssues = [];
  if (runtime.transport !== "docker" && runtime.transport !== "host") {
    startupIssues.push({
      severity: "critical",
      code: "invalid_transport",
      message: `Unsupported transport "${runtime.transport}".`,
      action: "Use --transport docker or --transport host.",
    });
  }
  if (runtime.transport === "docker" && !existsSync(runtime.composeFile)) {
    startupIssues.push({
      severity: "critical",
      code: "compose_missing",
      message: `Compose file not found: ${runtime.composeFile}`,
      action: "Provide --compose-file with the studio-brain compose file path.",
    });
  }

  const dataset = parseJsonObject(
    `
SELECT json_build_object(
  'swarmMemoryEstimatedRows',
  COALESCE((SELECT reltuples::bigint FROM pg_class WHERE relname = 'swarm_memory' LIMIT 1), 0),
  'swarmMemoryApproxBytes',
  COALESCE((SELECT pg_total_relation_size('swarm_memory')), 0),
  'loopStateEstimatedRows',
  COALESCE((SELECT reltuples::bigint FROM pg_class WHERE relname = 'memory_loop_state' LIMIT 1), 0)
)::text
`,
    "dataset",
    runtime,
    errors
  );

  const tablePresence = parseJsonObject(
    `
SELECT json_build_object(
  'swarm_memory', to_regclass('public.swarm_memory') IS NOT NULL,
  'memory_loop_state', to_regclass('public.memory_loop_state') IS NOT NULL
)::text
`,
    "table_presence",
    runtime,
    errors
  ) || { swarm_memory: false, memory_loop_state: false };

  const queries = [
    {
      name: "recent_global",
      description: "Recent memories ordered by occurred/created timestamp.",
      requires: "swarm_memory",
      sql: `
SELECT memory_id, tenant_id, run_id, created_at, occurred_at
FROM swarm_memory
ORDER BY COALESCE(occurred_at, created_at) DESC
LIMIT 32
`,
    },
    {
      name: "recent_tenant",
      description: "Tenant-scoped recent memories query shape.",
      requires: "swarm_memory",
      sql: `
WITH sample_tenant AS (
  SELECT tenant_id
  FROM swarm_memory
  WHERE tenant_id IS NOT NULL
  LIMIT 1
)
SELECT memory_id, tenant_id, run_id, created_at, occurred_at
FROM swarm_memory
WHERE tenant_id = (SELECT tenant_id FROM sample_tenant)
ORDER BY COALESCE(occurred_at, created_at) DESC
LIMIT 32
`,
    },
    {
      name: "run_scope_recent",
      description: "Run-scoped retrieval path used in continuity calls.",
      requires: "swarm_memory",
      sql: `
WITH sample_run AS (
  SELECT run_id
  FROM swarm_memory
  WHERE run_id IS NOT NULL
  LIMIT 1
)
SELECT memory_id, run_id, agent_id, created_at
FROM swarm_memory
WHERE run_id = (SELECT run_id FROM sample_run)
ORDER BY created_at DESC
LIMIT 64
`,
    },
    {
      name: "agent_run_scope_recent",
      description: "Agent+run scoped retrieval path.",
      requires: "swarm_memory",
      sql: `
WITH sample_pair AS (
  SELECT agent_id, run_id
  FROM swarm_memory
  WHERE agent_id IS NOT NULL
    AND run_id IS NOT NULL
  LIMIT 1
)
SELECT memory_id, agent_id, run_id, created_at
FROM swarm_memory
WHERE agent_id = (SELECT agent_id FROM sample_pair)
  AND run_id = (SELECT run_id FROM sample_pair)
ORDER BY created_at DESC
LIMIT 64
`,
    },
    {
      name: "lexical_escalation_probe",
      description: "Lexical fallback pattern used under load.",
      requires: "swarm_memory",
      sql: `
SELECT memory_id, created_at
FROM swarm_memory
WHERE content ILIKE '%escalation%'
LIMIT 24
`,
    },
    {
      name: "loop_state_recent",
      description: "Loop-state table recent update scan.",
      requires: "memory_loop_state",
      sql: `
SELECT loop_key, current_state, updated_at
FROM memory_loop_state
ORDER BY updated_at DESC
LIMIT 40
`,
    },
  ];

  const queryReports = [];
  for (const query of queries) {
    if (!tablePresence?.[query.requires]) {
      queryReports.push({
        name: query.name,
        ok: true,
        skipped: true,
        description: query.description,
        reason: `missing-table:${query.requires}`,
      });
      continue;
    }
    queryReports.push(explainQuery(query, runtime, errors));
  }

  const findings = [...startupIssues];
  for (const report of queryReports) {
    if (!report.ok) {
      findings.push({
        severity: "warn",
        code: "query_probe_failed",
        message: `${report.name} probe failed: ${String(report.error || "unknown error")}`,
        action: "Inspect DB connectivity/timeouts and rerun probe.",
      });
      continue;
    }
    if (report.skipped) continue;
    if (report.executionTimeMs >= criticalExecMs) {
      findings.push({
        severity: "critical",
        code: "query_exec_critical",
        message: `${report.name} execution time is ${report.executionTimeMs}ms (>= ${criticalExecMs}ms).`,
        action: "Capture this plan and optimize indexes or throttle ingest pressure immediately.",
      });
    } else if (report.executionTimeMs >= warnExecMs) {
      findings.push({
        severity: "warn",
        code: "query_exec_warn",
        message: `${report.name} execution time is ${report.executionTimeMs}ms (>= ${warnExecMs}ms).`,
        action: "Watch this query under load and consider additional index support.",
      });
    }
    const seqRows = report.seqScans.reduce((maxRows, row) => Math.max(maxRows, Number(row.actualRows || 0)), 0);
    const seqOnMemory = report.seqScans.some((row) => String(row.relationName || "").toLowerCase() === "swarm_memory");
    if (seqOnMemory && seqRows >= seqScanRowsWarn) {
      const severity = report.name.includes("run_scope") || report.name.includes("tenant") ? "warn" : "info";
      findings.push({
        severity,
        code: "seq_scan_hotspot",
        message: `${report.name} uses seq scan on swarm_memory with up to ${seqRows} actual rows.`,
        action:
          "Validate composite indexes for run/tenant/time paths and verify planner picks index scans under ingest-heavy conditions.",
      });
    }
    if (
      report.name === "lexical_escalation_probe"
      && report.seqScans.length > 0
      && report.executionTimeMs >= warnExecMs
    ) {
      findings.push({
        severity: "info",
        code: "lexical_probe_seqscan",
        message: "Lexical probe relies on seq scan for ILIKE search patterns.",
        action: "Consider trigram index strategy for heavy lexical fallback workloads.",
      });
    }
  }

  const recommendations = [];
  const hasCritical = findings.some((finding) => finding.severity === "critical");
  const hasWarn = findings.some((finding) => finding.severity === "warn");
  if (hasCritical) {
    recommendations.push("Prioritize DB pressure reduction and index-path fixes before increasing importer throughput.");
  }
  if (hasWarn) {
    recommendations.push("Re-run this probe during active ingest and compare execution-time drift by query name.");
  }
  const runScopeReports = queryReports.filter(
    (report) => report.ok && !report.skipped && (report.name === "run_scope_recent" || report.name === "agent_run_scope_recent")
  );
  if (runScopeReports.some((report) => report.indexScans.length === 0)) {
    recommendations.push("Ensure run-scoped retrieval has explicit index support to avoid fallback-heavy continuity paths.");
  }
  if (recommendations.length === 0) {
    recommendations.push("No major query-shape risks detected in this sample.");
  }

  const counts = {
    critical: findings.filter((finding) => finding.severity === "critical").length,
    warn: findings.filter((finding) => finding.severity === "warn").length,
    info: findings.filter((finding) => finding.severity === "info").length,
  };

  const status = counts.critical > 0 ? "fail" : counts.warn > 0 ? "warn" : "pass";
  const topSlowQueries = queryReports
    .filter((report) => report.ok && !report.skipped)
    .sort((left, right) => Number(right.executionTimeMs || 0) - Number(left.executionTimeMs || 0))
    .slice(0, 5)
    .map((report) => ({
      name: report.name,
      executionTimeMs: report.executionTimeMs,
      planningTimeMs: report.planningTimeMs,
      seqScans: report.seqScans.length,
      indexScans: report.indexScans.length,
    }));

  const report = {
    schemaVersion: "1",
    generatedAt: new Date().toISOString(),
    status,
    runtime,
    thresholds: {
      warnExecMs,
      criticalExecMs,
      seqScanRowsWarn,
    },
    dataset: dataset && typeof dataset === "object" ? dataset : {},
    tablePresence,
    counts,
    findings,
    recommendations,
    topSlowQueries,
    queryReports,
    errors,
    outputPath: outputEnabled ? outputPath : null,
  };

  if (outputEnabled) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  if (outputJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const lines = [];
    lines.push("Open Memory DB Query Plan Probe");
    lines.push(`Generated: ${report.generatedAt}`);
    lines.push(`Status: ${report.status}`);
    lines.push("Top slow queries:");
    for (const query of report.topSlowQueries) {
      lines.push(`- ${query.name}: ${query.executionTimeMs}ms (seqScans=${query.seqScans}, indexScans=${query.indexScans})`);
    }
    if (report.findings.length > 0) {
      lines.push("Findings:");
      for (const finding of report.findings) {
        lines.push(`- [${String(finding.severity).toUpperCase()}] ${finding.message}`);
      }
    }
    lines.push("Recommendations:");
    for (const recommendation of report.recommendations) {
      lines.push(`- ${recommendation}`);
    }
    if (report.outputPath) {
      lines.push(`Report: ${report.outputPath}`);
    }
    process.stdout.write(`${lines.join("\n")}\n`);
  }

  if (strict && report.status !== "pass") {
    process.exit(1);
  }
}

main();
