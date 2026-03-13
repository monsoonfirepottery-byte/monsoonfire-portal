#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const STUDIO_BRAIN_ROOT = resolve(REPO_ROOT, "studio-brain");
const DEFAULT_COMPOSE_FILE = resolve(STUDIO_BRAIN_ROOT, "docker-compose.yml");
const DEFAULT_OUTPUT_PATH = resolve(REPO_ROOT, "output", "open-memory", "postgres-remediate-latest.json");

const flags = parseArgs(process.argv.slice(2));
if (toBool(flags.help, false)) {
  printHelp();
  process.exit(0);
}

const runtime = {
  transport: String(flags.transport || "docker").toLowerCase(),
  composeFile: resolve(REPO_ROOT, String(flags["compose-file"] || DEFAULT_COMPOSE_FILE)),
  postgresService: String(flags["postgres-service"] || "postgres"),
  host: String(flags.host || process.env.PGHOST || "127.0.0.1"),
  port: toInt(flags.port, Number.parseInt(String(process.env.PGPORT || "5433"), 10)),
  user: String(flags.user || process.env.PGUSER || "postgres"),
  database: String(flags.database || process.env.PGDATABASE || "monsoonfire_studio_os"),
};

if (runtime.transport !== "docker" && runtime.transport !== "host") {
  process.stderr.write(`Unsupported transport "${runtime.transport}". Use docker|host.\n`);
  process.exit(2);
}

const apply = toBool(flags.apply, false);
const jsonOut = toBool(flags.json, false);
const strict = toBool(flags.strict, false);
const restartPostgres = toBool(flags["restart-postgres"], runtime.transport === "docker");
const restartWaitSeconds = clampInt(flags["restart-wait-seconds"], 1, 180, 60);
const terminateOlderThanSeconds = clampInt(flags["terminate-older-than-seconds"], 30, 86400, 900);
const terminateLimit = clampInt(flags["terminate-limit"], 1, 500, 48);
const enablePgStatStatements = toBool(flags["enable-pg-stat-statements"], true);
const outputPath = resolve(REPO_ROOT, String(flags.out || DEFAULT_OUTPUT_PATH));

const vacuumTables = parseVacuumTables(flags["vacuum-tables"]);
const actions = [];
const errors = [];
const warnings = [];
const generatedAt = new Date().toISOString();

const preRestartAlterSystemStatements = [
  "ALTER SYSTEM SET statement_timeout = '16s'",
  "ALTER SYSTEM SET lock_timeout = '4s'",
  "ALTER SYSTEM SET idle_in_transaction_session_timeout = '15s'",
  "ALTER SYSTEM SET checkpoint_completion_target = '0.9'",
  "ALTER SYSTEM SET track_io_timing = 'on'",
  "ALTER SYSTEM SET autovacuum = 'on'",
  "ALTER SYSTEM SET work_mem = '8MB'",
];
const postRestartAlterSystemStatements = [];
if (enablePgStatStatements) {
  preRestartAlterSystemStatements.push("ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements'");
  postRestartAlterSystemStatements.push("ALTER SYSTEM SET pg_stat_statements.track = 'all'");
  postRestartAlterSystemStatements.push("ALTER SYSTEM SET pg_stat_statements.max = '10000'");
}

if (!apply) {
  const payload = {
    ok: true,
    status: "dry-run",
    generatedAt,
    runtime,
    apply: false,
    plan: {
      preRestartAlterSystemStatements,
      postRestartAlterSystemStatements,
      restartPostgres,
      restartWaitSeconds,
      terminateOlderThanSeconds,
      terminateLimit,
      vacuumTables,
      enablePgStatStatements,
    },
    nextStep: "Re-run with --apply true to execute remediation.",
  };
  emit(payload, jsonOut);
  process.exit(0);
}

for (const sql of preRestartAlterSystemStatements) {
  const result = runSql(sql, { runtime, allowFail: true });
  actions.push({ step: "alter-system", sql, ok: result.ok, output: truncate(result.output) });
  if (!result.ok) {
    errors.push(`alter-system failed: ${sql}`);
  }
}

const reloadRes = runSql("SELECT pg_reload_conf()", { runtime, allowFail: true });
actions.push({ step: "reload-conf", ok: reloadRes.ok, output: truncate(reloadRes.output) });
if (!reloadRes.ok) {
  warnings.push("pg_reload_conf failed; some settings may not be applied until restart.");
}

if (restartPostgres) {
  if (runtime.transport !== "docker") {
    warnings.push("restart-postgres requested but transport=host; skipping container restart.");
  } else {
    const restartRes = runCompose(["restart", runtime.postgresService], { runtime, allowFail: true });
    actions.push({ step: "restart-postgres", ok: restartRes.ok, output: truncate(restartRes.output) });
    if (!restartRes.ok) {
      errors.push("postgres restart failed");
    } else {
      const ready = waitForReady(runtime, restartWaitSeconds);
      actions.push({ step: "wait-ready", ok: ready.ok, attempts: ready.attempts, output: truncate(ready.output) });
      if (!ready.ok) {
        errors.push("postgres not ready after restart window");
      }
    }
  }
}

for (const sql of postRestartAlterSystemStatements) {
  const result = runSql(sql, { runtime, allowFail: true });
  actions.push({ step: "alter-system-post-restart", sql, ok: result.ok, output: truncate(result.output) });
  if (!result.ok) {
    errors.push(`alter-system-post-restart failed: ${sql}`);
  }
}

if (postRestartAlterSystemStatements.length > 0) {
  const postReloadRes = runSql("SELECT pg_reload_conf()", { runtime, allowFail: true });
  actions.push({ step: "reload-conf-post-restart", ok: postReloadRes.ok, output: truncate(postReloadRes.output) });
  if (!postReloadRes.ok) {
    warnings.push("pg_reload_conf after post-restart ALTER SYSTEM failed.");
  }
}

if (enablePgStatStatements) {
  const extensionRes = runSql("CREATE EXTENSION IF NOT EXISTS pg_stat_statements", {
    runtime,
    allowFail: true,
  });
  actions.push({ step: "enable-pg-stat-statements", ok: extensionRes.ok, output: truncate(extensionRes.output) });
  if (!extensionRes.ok) {
    warnings.push("Unable to create pg_stat_statements extension after restart.");
  }
}

const terminateSql = `
WITH victims AS (
  SELECT pid
  FROM pg_stat_activity
  WHERE pid <> pg_backend_pid()
    AND state = 'active'
    AND query_start IS NOT NULL
    AND (now() - query_start) > interval '${terminateOlderThanSeconds} seconds'
    AND query ILIKE '%SELECT%'
    AND query ILIKE '%memory_id%'
    AND query ILIKE '%tenant_id%'
    AND query ILIKE '%run_id%'
    AND query ILIKE '%content%'
  ORDER BY query_start ASC
  LIMIT ${terminateLimit}
)
SELECT json_build_object(
  'count', count(*)::int,
  'pids', COALESCE(json_agg(pid), '[]'::json),
  'terminated', COALESCE(bool_and(pg_terminate_backend(pid)), true)
)::text
FROM victims
`;

const terminateRes = runSql(terminateSql, { runtime, allowFail: true });
const terminateParsed = parseLastJsonLine(terminateRes.output);
actions.push({
  step: "terminate-runaway-queries",
  ok: terminateRes.ok,
  output: terminateParsed.ok ? terminateParsed.value : truncate(terminateRes.output),
});
if (!terminateRes.ok) {
  warnings.push("Failed to terminate runaway query candidates.");
}

for (const table of vacuumTables) {
  const vacuumRes = runSql(`VACUUM (ANALYZE) ${table}`, { runtime, allowFail: true });
  actions.push({ step: "vacuum-analyze", table, ok: vacuumRes.ok, output: truncate(vacuumRes.output) });
  if (!vacuumRes.ok) {
    warnings.push(`VACUUM (ANALYZE) failed for ${table}`);
  }
}

const status = errors.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass";
const payload = {
  ok: errors.length === 0,
  status,
  generatedAt,
  runtime,
  apply: true,
  parameters: {
    restartPostgres,
    restartWaitSeconds,
    terminateOlderThanSeconds,
    terminateLimit,
    vacuumTables,
    enablePgStatStatements,
  },
  actions,
  warnings,
  errors,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

emit({ ...payload, outputPath }, jsonOut);

if (strict && status !== "pass") {
  process.exit(1);
}

function waitForReady(runtimeConfig, waitSeconds) {
  const attempts = Math.max(1, Math.floor(waitSeconds / 2));
  let lastOutput = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const res = runSql("SELECT 1", { runtime: runtimeConfig, allowFail: true });
    lastOutput = res.output || "";
    if (res.ok) {
      return { ok: true, attempts: attempt, output: lastOutput };
    }
    sleepMs(2000);
  }
  return { ok: false, attempts, output: lastOutput };
}

function runSql(sql, options) {
  const runtimeConfig = options.runtime;
  const sqlText = String(sql || "").trim();
  if (!sqlText) return { ok: false, output: "missing sql", status: 1 };

  if (runtimeConfig.transport === "docker") {
    return runCompose(
      [
        "exec",
        "-T",
        runtimeConfig.postgresService,
        "psql",
        "-X",
        "-A",
        "-t",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        runtimeConfig.user,
        "-d",
        runtimeConfig.database,
        "-c",
        sqlText,
      ],
      { runtime: runtimeConfig, allowFail: options.allowFail },
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
      runtimeConfig.host,
      "-p",
      String(runtimeConfig.port),
      "-U",
      runtimeConfig.user,
      "-d",
      runtimeConfig.database,
      "-c",
      sqlText,
    ],
    { allowFail: options.allowFail, cwd: REPO_ROOT },
  );
}

function runCompose(args, options) {
  return runProcess("docker", ["compose", "-f", options.runtime.composeFile, ...args], {
    allowFail: options.allowFail,
    cwd: STUDIO_BRAIN_ROOT,
  });
}

function runProcess(cmd, argv, options = {}) {
  const result = spawnSync(cmd, argv, {
    cwd: options.cwd || REPO_ROOT,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${String(result.stdout || "")}${String(result.stderr || "")}`.trim();
  const ok = result.status === 0;
  if (!ok && !options.allowFail) {
    throw new Error(`${cmd} ${argv.join(" ")} failed (${result.status ?? "unknown"}): ${output || "no output"}`);
  }
  return {
    ok,
    status: result.status ?? 1,
    output,
  };
}

function parseVacuumTables(raw) {
  const value = String(raw || "memory_loop_state,studio_state_daily,brain_job_runs").trim();
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(entry));
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "");
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).trim().toLowerCase();
    const next = argv[index + 1];
    if (!next || String(next).startsWith("--")) {
      out[key] = "true";
      continue;
    }
    out[key] = String(next);
    index += 1;
  }
  return out;
}

function toBool(value, fallback) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampInt(value, min, max, fallback) {
  const parsed = toInt(value, fallback);
  return Math.max(min, Math.min(max, parsed));
}

function parseLastJsonLine(output) {
  const lines = String(output || "")
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
  return { ok: false, value: null };
}

function truncate(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.slice(0, 320);
}

function sleepMs(ms) {
  const end = Date.now() + Math.max(0, ms);
  while (Date.now() < end) {}
}

function emit(payload, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  const lines = [];
  lines.push(`open-memory db remediate status: ${String(payload.status || "unknown").toUpperCase()}`);
  lines.push(`generatedAt: ${payload.generatedAt || "n/a"}`);
  if (payload.apply === false) {
    lines.push("mode: dry-run");
  }
  if (payload.outputPath) {
    lines.push(`outputPath: ${payload.outputPath}`);
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    lines.push("errors:");
    payload.errors.forEach((entry) => lines.push(`  - ${entry}`));
  }
  if (Array.isArray(payload.warnings) && payload.warnings.length > 0) {
    lines.push("warnings:");
    payload.warnings.forEach((entry) => lines.push(`  - ${entry}`));
  }
  if (Array.isArray(payload.actions) && payload.actions.length > 0) {
    lines.push("actions:");
    payload.actions.forEach((entry, index) => lines.push(`  ${index + 1}. ${entry.step} ok=${String(entry.ok)}`));
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

function printHelp() {
  process.stdout.write(
    [
      "Usage:",
      "  node ./scripts/open-memory-db-remediate.mjs [options]",
      "",
      "Options:",
      "  --apply true|false                    Execute remediation (default: false)",
      "  --json true|false                     Emit JSON output (default: false)",
      "  --strict true|false                   Exit non-zero when status != pass (default: false)",
      "  --transport docker|host               Connection transport (default: docker)",
      "  --compose-file <path>                 docker compose path (docker transport)",
      "  --postgres-service <name>             postgres service name (default: postgres)",
      "  --host <value>                        host target (host transport)",
      "  --port <value>                        port target (host transport)",
      "  --database <value>                    database name",
      "  --user <value>                        database user",
      "  --restart-postgres true|false         restart postgres service after ALTER SYSTEM (default: true for docker)",
      "  --restart-wait-seconds <n>            readiness wait window (default: 60)",
      "  --terminate-older-than-seconds <n>    terminate matching active queries older than n seconds (default: 900)",
      "  --terminate-limit <n>                 max terminated queries per run (default: 48)",
      "  --vacuum-tables <csv>                 VACUUM (ANALYZE) targets (default: memory_loop_state,studio_state_daily,brain_job_runs)",
      "  --enable-pg-stat-statements true|false enable pg_stat_statements settings (default: true)",
      "  --out <path>                          report output path",
      "  --help                                show this help",
      "",
      "Examples:",
      "  npm run open-memory:ops:db:remediate",
      "  npm run open-memory:ops:db:remediate:apply",
      "",
    ].join("\n"),
  );
}
