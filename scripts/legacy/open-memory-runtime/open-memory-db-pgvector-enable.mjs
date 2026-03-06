#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const STUDIO_BRAIN_ROOT = resolve(REPO_ROOT, "studio-brain");
const DEFAULT_COMPOSE_FILE = resolve(STUDIO_BRAIN_ROOT, "docker-compose.yml");
const DEFAULT_OUTPUT_PATH = resolve(REPO_ROOT, "output", "open-memory", "postgres-pgvector-enable-latest.json");

const flags = parseArgs(process.argv.slice(2));
if (toBool(flags.help, false)) {
  printHelp();
  process.exit(0);
}

const apply = toBool(flags.apply, false);
const jsonOut = toBool(flags.json, false);
const strict = toBool(flags.strict, false);
const image = String(flags.image || "pgvector/pgvector:pg16");
const composeFile = resolve(REPO_ROOT, String(flags["compose-file"] || DEFAULT_COMPOSE_FILE));
const postgresService = String(flags["postgres-service"] || "postgres");
const waitSeconds = clampInt(flags["wait-seconds"], 5, 300, 90);
const outputPath = resolve(REPO_ROOT, String(flags.out || DEFAULT_OUTPUT_PATH));
const user = String(flags.user || process.env.PGUSER || "postgres");
const database = String(flags.database || process.env.PGDATABASE || "monsoonfire_studio_os");

if (!existsSync(composeFile)) {
  const payload = {
    ok: false,
    status: "fail",
    generatedAt: new Date().toISOString(),
    message: `Compose file not found: ${composeFile}`,
  };
  emit(payload, jsonOut);
  process.exit(1);
}

const runtime = {
  composeFile,
  postgresService,
  image,
  user,
  database,
  waitSeconds,
};

if (!apply) {
  const payload = {
    ok: true,
    status: "dry-run",
    generatedAt: new Date().toISOString(),
    apply: false,
    runtime,
    plan: [
      `Restart postgres service with STUDIO_BRAIN_POSTGRES_IMAGE=${image}`,
      "Wait for readiness",
      "Check pg_available_extensions for vector",
      "Run CREATE EXTENSION IF NOT EXISTS vector",
    ],
  };
  emit(payload, jsonOut);
  process.exit(0);
}

const actions = [];
const errors = [];
const warnings = [];

const preAvailable = checkVectorAvailable({ composeFile, postgresService, user, database });
actions.push({
  step: "check-vector-available-before",
  ok: preAvailable.ok,
  available: preAvailable.available,
  output: truncate(preAvailable.output),
});

const upRes = runCompose(
  ["up", "-d", postgresService],
  {
    composeFile,
    env: { ...process.env, STUDIO_BRAIN_POSTGRES_IMAGE: image },
    allowFail: true,
  },
);
actions.push({
  step: "compose-up-postgres-with-image",
  ok: upRes.ok,
  output: truncate(upRes.output),
});
if (!upRes.ok) {
  errors.push("Unable to start postgres with requested pgvector image.");
}

if (errors.length === 0) {
  const ready = waitForReady({ composeFile, postgresService, user, database, waitSeconds });
  actions.push({
    step: "wait-ready",
    ok: ready.ok,
    attempts: ready.attempts,
    output: truncate(ready.output),
  });
  if (!ready.ok) {
    errors.push("Postgres did not become ready after image switch.");
  }
}

let postAvailable = { ok: false, available: false, output: "" };
if (errors.length === 0) {
  postAvailable = checkVectorAvailable({ composeFile, postgresService, user, database });
  actions.push({
    step: "check-vector-available-after",
    ok: postAvailable.ok,
    available: postAvailable.available,
    output: truncate(postAvailable.output),
  });
  if (!postAvailable.ok) {
    errors.push("Could not verify vector extension availability.");
  } else if (!postAvailable.available) {
    errors.push("Requested image started, but vector extension is still unavailable.");
  }
}

if (errors.length === 0 && postAvailable.available) {
  const createRes = runSql(
    "CREATE EXTENSION IF NOT EXISTS vector",
    { composeFile, postgresService, user, database, allowFail: true },
  );
  actions.push({
    step: "create-vector-extension",
    ok: createRes.ok,
    output: truncate(createRes.output),
  });
  if (!createRes.ok) {
    errors.push("Failed to install vector extension in database.");
  }
}

if (errors.length === 0 && postAvailable.available) {
  const installed = runSql(
    "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='vector')::text",
    { composeFile, postgresService, user, database, allowFail: true },
  );
  const installedOk = installed.ok && /\btrue\b/i.test(installed.output);
  actions.push({
    step: "verify-vector-installed",
    ok: installedOk,
    output: truncate(installed.output),
  });
  if (!installedOk) {
    errors.push("Vector extension verification failed after CREATE EXTENSION.");
  }
}

if (errors.length > 0 && /unavailable/i.test(errors.join(" "))) {
  warnings.push("This may happen if the requested pgvector image tag is unavailable on this host architecture.");
}

const status = errors.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass";
const payload = {
  ok: errors.length === 0,
  status,
  generatedAt: new Date().toISOString(),
  apply: true,
  runtime,
  actions,
  warnings,
  errors,
  outputPath,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

emit(payload, jsonOut);
if (strict && status !== "pass") {
  process.exit(1);
}

function waitForReady({ composeFile, postgresService, user, database, waitSeconds }) {
  const attempts = Math.max(1, Math.floor(waitSeconds / 2));
  let last = "";
  for (let index = 1; index <= attempts; index += 1) {
    const probe = runCompose(
      ["exec", "-T", postgresService, "pg_isready", "-U", user, "-d", database],
      { composeFile, env: process.env, allowFail: true },
    );
    last = probe.output || "";
    if (probe.ok) {
      return { ok: true, attempts: index, output: last };
    }
    sleepMs(2000);
  }
  return { ok: false, attempts, output: last };
}

function checkVectorAvailable({ composeFile, postgresService, user, database }) {
  const res = runSql(
    "SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector')::text",
    { composeFile, postgresService, user, database, allowFail: true },
  );
  return {
    ok: res.ok,
    available: res.ok && /\btrue\b/i.test(res.output),
    output: res.output,
  };
}

function runSql(sql, { composeFile, postgresService, user, database, allowFail }) {
  return runCompose(
    [
      "exec",
      "-T",
      postgresService,
      "psql",
      "-X",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      user,
      "-d",
      database,
      "-c",
      sql,
    ],
    { composeFile, env: process.env, allowFail },
  );
}

function runCompose(args, { composeFile, env, allowFail }) {
  return runProcess(
    "docker",
    ["compose", "-f", composeFile, ...args],
    { cwd: STUDIO_BRAIN_ROOT, env, allowFail },
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

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function sleepMs(ms) {
  const end = Date.now() + Math.max(0, ms);
  while (Date.now() < end) {}
}

function truncate(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 320);
}

function emit(payload, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  const lines = [];
  lines.push(`open-memory pgvector enable status: ${String(payload.status || "unknown").toUpperCase()}`);
  lines.push(`generatedAt: ${payload.generatedAt || "n/a"}`);
  if (payload.runtime) {
    lines.push(`image: ${payload.runtime.image}`);
    lines.push(`postgresService: ${payload.runtime.postgresService}`);
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    lines.push("errors:");
    payload.errors.forEach((entry) => lines.push(`  - ${entry}`));
  }
  if (Array.isArray(payload.warnings) && payload.warnings.length > 0) {
    lines.push("warnings:");
    payload.warnings.forEach((entry) => lines.push(`  - ${entry}`));
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

function printHelp() {
  process.stdout.write(
    [
      "Usage:",
      "  node ./scripts/open-memory-db-pgvector-enable.mjs [options]",
      "",
      "Options:",
      "  --apply true|false           Execute image switch + extension install (default: false)",
      "  --image <name:tag>           pgvector image (default: pgvector/pgvector:pg16)",
      "  --compose-file <path>        docker compose file",
      "  --postgres-service <name>    service name (default: postgres)",
      "  --user <name>                db user (default: postgres)",
      "  --database <name>            db name (default: monsoonfire_studio_os)",
      "  --wait-seconds <n>           readiness wait window (default: 90)",
      "  --out <path>                 report artifact path",
      "  --json true|false            print JSON output (default: false)",
      "  --strict true|false          exit non-zero when status != pass (default: false)",
      "  --help                       show help",
      "",
      "Examples:",
      "  npm run open-memory:ops:db:pgvector:plan",
      "  npm run open-memory:ops:db:pgvector:enable",
      "",
    ].join("\n"),
  );
}
