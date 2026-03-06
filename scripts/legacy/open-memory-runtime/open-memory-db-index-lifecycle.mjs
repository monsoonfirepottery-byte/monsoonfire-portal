#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const STUDIO_BRAIN_ROOT = resolve(REPO_ROOT, "studio-brain");
const DEFAULT_COMPOSE_FILE = resolve(STUDIO_BRAIN_ROOT, "docker-compose.yml");
const DEFAULT_SNAPSHOT_PATH = resolve(REPO_ROOT, "output", "open-memory", "index-usage-snapshot-latest.json");
const DEFAULT_HISTORY_PATH = resolve(REPO_ROOT, "output", "open-memory", "index-usage-history.jsonl");
const DEFAULT_REPORT_PATH = resolve(REPO_ROOT, "output", "open-memory", "index-lifecycle-latest.json");

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

const jsonOut = toBool(flags.json, false);
const strict = toBool(flags.strict, false);
const apply = toBool(flags.apply, false);
const allowDropSet = new Set(parseCsv(flags["allow-drop-indexes"]));
const minBytes = clampInt(flags["min-bytes"], 1024 * 1024, 20 * 1024 * 1024 * 1024, 64 * 1024 * 1024);
const minConsecutiveZero = clampInt(flags["min-consecutive-zero"], 1, 50, 3);
const minAgeHours = clampInt(flags["min-age-hours"], 0, 24 * 365, 24);
const maxHistory = clampInt(flags["max-history-rows"], 10, 2000, 400);
const maxDropPerRun = clampInt(flags["max-drop-per-run"], 1, 200, 6);

const snapshotPath = resolve(REPO_ROOT, String(flags.snapshot || DEFAULT_SNAPSHOT_PATH));
const historyPath = resolve(REPO_ROOT, String(flags.history || DEFAULT_HISTORY_PATH));
const reportPath = resolve(REPO_ROOT, String(flags.out || DEFAULT_REPORT_PATH));

if (runtime.transport !== "docker" && runtime.transport !== "host") {
  const payload = failPayload(`Unsupported transport "${runtime.transport}". Use docker|host.`);
  emit(payload, jsonOut);
  process.exit(2);
}

const rows = fetchCurrentIndexStats(runtime);
if (!rows.ok) {
  const payload = failPayload(`Unable to query index stats: ${rows.error}`);
  emit(payload, jsonOut);
  process.exit(1);
}

const now = new Date();
const nowIso = now.toISOString();
const current = rows.rows;
const snapshot = {
  schemaVersion: "1",
  generatedAt: nowIso,
  runtime,
  count: current.length,
  indexes: current,
};

mkdirSync(dirname(snapshotPath), { recursive: true });
writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

const compactEntry = {
  generatedAt: nowIso,
  indexes: current.map((row) => ({
    schema: row.schema,
    table: row.table_name,
    index: row.index_name,
    idx_scan: row.idx_scan,
    index_bytes: row.index_bytes,
    is_primary: row.is_primary,
    is_unique: row.is_unique,
    is_valid: row.is_valid,
  })),
};
mkdirSync(dirname(historyPath), { recursive: true });
appendFileSync(historyPath, `${JSON.stringify(compactEntry)}\n`, "utf8");
trimHistory(historyPath, maxHistory);

const history = loadHistory(historyPath);
const lifecycle = buildLifecycle(current, history, now, { minConsecutiveZero, minAgeHours });
const candidates = lifecycle.candidates;
const eligible = lifecycle.eligible;

const actions = [];
const errors = [];
const warnings = [];

if (apply) {
  if (eligible.length === 0) {
    warnings.push("No eligible indexes met lifecycle drop gates.");
  }
  if (allowDropSet.size === 0) {
    warnings.push("Apply requested without --allow-drop-indexes; no DROP INDEX statements executed.");
  }

  let dropped = 0;
  for (const row of eligible) {
    if (dropped >= maxDropPerRun) break;
    if (!allowDropSet.has(row.index_name) && !allowDropSet.has(`${row.schema}.${row.index_name}`)) {
      continue;
    }
    const sql = `DROP INDEX CONCURRENTLY IF EXISTS ${quoteIdent(row.schema)}.${quoteIdent(row.index_name)}`;
    const res = runSql(sql, { runtime, allowFail: true });
    const ok = res.ok;
    actions.push({
      step: "drop-index",
      index: `${row.schema}.${row.index_name}`,
      ok,
      output: truncate(res.output),
    });
    if (!ok) {
      errors.push(`Failed to drop index ${row.schema}.${row.index_name}`);
    } else {
      dropped += 1;
    }
  }
}

const status = errors.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass";
const report = {
  schemaVersion: "1",
  generatedAt: nowIso,
  status,
  runtime,
  apply,
  config: {
    minBytes,
    minConsecutiveZero,
    minAgeHours,
    maxHistory,
    maxDropPerRun,
    allowDropIndexes: [...allowDropSet],
  },
  summary: {
    totalIndexes: current.length,
    zeroScanLargeCandidates: candidates.length,
    eligibleForDrop: eligible.length,
    totalUnusedBytesCandidates: sumBytes(candidates),
    totalUnusedBytesEligible: sumBytes(eligible),
  },
  candidates,
  eligible,
  actions,
  warnings,
  errors,
  snapshotPath,
  historyPath,
};

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

emit({ ...report, reportPath }, jsonOut);
if (strict && status !== "pass") {
  process.exit(1);
}

function buildLifecycle(currentRows, historyRows, nowDate, { minConsecutiveZero, minAgeHours }) {
  const byIndex = new Map();
  for (const row of historyRows) {
    const ts = Date.parse(String(row.generatedAt || ""));
    if (!Number.isFinite(ts)) continue;
    for (const item of Array.isArray(row.indexes) ? row.indexes : []) {
      const key = `${String(item.schema || "public")}.${String(item.index || "")}`;
      if (!key.endsWith(".")) {
        if (!byIndex.has(key)) byIndex.set(key, []);
        byIndex.get(key).push({
          ts,
          idx_scan: toInt(item.idx_scan, 0),
          index_bytes: toInt(item.index_bytes, 0),
        });
      }
    }
  }

  const candidates = [];
  const eligible = [];
  for (const row of currentRows) {
    const key = `${row.schema}.${row.index_name}`;
    const history = byIndex.get(key) || [];
    history.sort((a, b) => b.ts - a.ts);
    let streak = 0;
    let oldestInStreakTs = 0;
    for (const entry of history) {
      if (entry.idx_scan === 0) {
        streak += 1;
        oldestInStreakTs = entry.ts;
      } else {
        break;
      }
    }
    const ageHours =
      oldestInStreakTs > 0 ? Math.max(0, (nowDate.getTime() - oldestInStreakTs) / (1000 * 60 * 60)) : 0;
    const largeZeroScan =
      row.idx_scan === 0
      && row.index_bytes >= minBytes
      && !row.is_primary
      && !row.is_unique
      && row.is_valid;
    if (!largeZeroScan) continue;
    const candidate = {
      schema: row.schema,
      table_name: row.table_name,
      index_name: row.index_name,
      idx_scan: row.idx_scan,
      index_bytes: row.index_bytes,
      index_size_mb: round2(row.index_bytes / (1024 * 1024)),
      consecutiveZeroSnapshots: streak,
      zeroStreakAgeHours: round2(ageHours),
      gateMinConsecutiveZero: minConsecutiveZero,
      gateMinAgeHours: minAgeHours,
    };
    candidates.push(candidate);
    if (streak >= minConsecutiveZero && ageHours >= minAgeHours) {
      eligible.push(candidate);
    }
  }

  candidates.sort((a, b) => b.index_bytes - a.index_bytes);
  eligible.sort((a, b) => b.index_bytes - a.index_bytes);
  return { candidates, eligible };
}

function fetchCurrentIndexStats(runtimeConfig) {
  const sql = `
SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)::text
FROM (
  SELECT
    s.schemaname AS schema,
    s.relname AS table_name,
    s.indexrelname AS index_name,
    s.idx_scan::bigint AS idx_scan,
    pg_relation_size(s.indexrelid)::bigint AS index_bytes,
    i.indisprimary AS is_primary,
    i.indisunique AS is_unique,
    i.indisvalid AS is_valid
  FROM pg_stat_user_indexes s
  JOIN pg_index i ON i.indexrelid = s.indexrelid
  ORDER BY pg_relation_size(s.indexrelid) DESC
) t
`;
  const res = runSql(sql, { runtime: runtimeConfig, allowFail: true });
  if (!res.ok) {
    return { ok: false, error: res.output, rows: [] };
  }
  const parsed = parseLastJsonLine(res.output);
  if (!parsed.ok || !Array.isArray(parsed.value)) {
    return { ok: false, error: parsed.error || "invalid json", rows: [] };
  }
  const rows = parsed.value.map((row) => ({
    schema: String(row.schema || "public"),
    table_name: String(row.table_name || ""),
    index_name: String(row.index_name || ""),
    idx_scan: toInt(row.idx_scan, 0),
    index_bytes: toInt(row.index_bytes, 0),
    is_primary: Boolean(row.is_primary),
    is_unique: Boolean(row.is_unique),
    is_valid: Boolean(row.is_valid),
  }));
  return { ok: true, error: "", rows };
}

function loadHistory(path) {
  if (!existsSync(path)) return [];
  const rows = [];
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {}
  }
  return rows;
}

function trimHistory(path, maxRows) {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= maxRows) return;
  const kept = lines.slice(lines.length - maxRows);
  writeFileSync(path, `${kept.join("\n")}\n`, "utf8");
}

function runSql(sql, { runtime, allowFail }) {
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
        sql,
      ],
      { runtime, allowFail },
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
      sql,
    ],
    { cwd: REPO_ROOT, env: process.env, allowFail },
  );
}

function runCompose(args, { runtime, allowFail }) {
  return runProcess(
    "docker",
    ["compose", "-f", runtime.composeFile, ...args],
    { cwd: STUDIO_BRAIN_ROOT, env: process.env, allowFail },
  );
}

function runProcess(cmd, argv, { cwd, env, allowFail }) {
  const result = spawnSync(cmd, argv, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${String(result.stdout || "")}${String(result.stderr || "")}`.trim();
  const ok = result.status === 0;
  if (!ok && !allowFail) {
    throw new Error(`${cmd} ${argv.join(" ")} failed (${result.status ?? "unknown"}): ${output || "no output"}`);
  }
  return {
    ok,
    status: result.status ?? 1,
    output,
  };
}

function parseLastJsonLine(output) {
  const lines = String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return { ok: true, value: JSON.parse(lines[index]), error: "" };
    } catch {
      continue;
    }
  }
  return { ok: false, value: null, error: "no json line found" };
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

function parseCsv(raw) {
  return String(raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
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

function sumBytes(rows) {
  return rows.reduce((total, row) => total + toInt(row.index_bytes, 0), 0);
}

function round2(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

function truncate(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 320);
}

function quoteIdent(name) {
  return `"${String(name || "").replace(/"/g, "\"\"")}"`;
}

function failPayload(message) {
  return {
    schemaVersion: "1",
    generatedAt: new Date().toISOString(),
    status: "fail",
    message,
  };
}

function emit(payload, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  const lines = [];
  lines.push(`open-memory index lifecycle status: ${String(payload.status || "unknown").toUpperCase()}`);
  lines.push(`generatedAt: ${payload.generatedAt || "n/a"}`);
  if (payload.summary) {
    lines.push(`totalIndexes: ${payload.summary.totalIndexes}`);
    lines.push(`zeroScanLargeCandidates: ${payload.summary.zeroScanLargeCandidates}`);
    lines.push(`eligibleForDrop: ${payload.summary.eligibleForDrop}`);
  }
  if (Array.isArray(payload.warnings) && payload.warnings.length > 0) {
    lines.push("warnings:");
    payload.warnings.forEach((entry) => lines.push(`  - ${entry}`));
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    lines.push("errors:");
    payload.errors.forEach((entry) => lines.push(`  - ${entry}`));
  }
  if (payload.reportPath) lines.push(`reportPath: ${payload.reportPath}`);
  process.stdout.write(`${lines.join("\n")}\n`);
}

function printHelp() {
  process.stdout.write(
    [
      "Usage:",
      "  node ./scripts/open-memory-db-index-lifecycle.mjs [options]",
      "",
      "Options:",
      "  --apply true|false                 Apply eligible DROP INDEX actions (default: false)",
      "  --allow-drop-indexes <csv>         Allowed index names/schema.index names for drop in this run",
      "  --min-bytes <n>                    Minimum index bytes for lifecycle candidate (default: 67108864)",
      "  --min-consecutive-zero <n>         Required consecutive zero-scan snapshots (default: 3)",
      "  --min-age-hours <n>                Required zero-scan streak age in hours (default: 24)",
      "  --max-drop-per-run <n>             Limit dropped indexes per run (default: 6)",
      "  --max-history-rows <n>             Retained history rows (default: 400)",
      "  --snapshot <path>                  Snapshot artifact path",
      "  --history <path>                   History jsonl path",
      "  --out <path>                       Report artifact path",
      "  --transport docker|host            DB transport (default: docker)",
      "  --compose-file <path>              docker compose file",
      "  --postgres-service <name>          service name (default: postgres)",
      "  --host <value>                     host transport target",
      "  --port <value>                     host transport port",
      "  --user <value>                     db user",
      "  --database <value>                 db name",
      "  --json true|false                  print JSON output (default: false)",
      "  --strict true|false                exit non-zero when status != pass (default: false)",
      "  --help                             show help",
      "",
      "Examples:",
      "  npm run open-memory:ops:db:index:lifecycle",
      "  npm run open-memory:ops:db:index:lifecycle:apply -- --allow-drop-indexes idx_swarm_memory_contextualized_trgm",
      "",
    ].join("\n"),
  );
}
