#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const STUDIO_BRAIN_ROOT = resolve(REPO_ROOT, "studio-brain");
const COMPOSE_FILE = resolve(STUDIO_BRAIN_ROOT, "docker-compose.yml");

const DEFAULT_OUTPUT_DIR = "output/backups";
const DEFAULT_FRESHNESS_MINUTES = 24 * 60;

const argv = process.argv.slice(2);
const parsed = parseArgs(argv);
const envSource = resolveEnvSource();
const env = loadResolvedEnv();

if (parsed.help || parsed.command === "help") {
  printHelp();
  process.exit(0);
}

if (parsed.command !== "verify" && parsed.command !== "restore-drill") {
  process.stderr.write(`Unknown backup command "${parsed.command}".\n`);
  printHelp();
  process.exit(1);
}

const outputRoot = resolve(REPO_ROOT, parsed.outputDir);
const latestPath = resolve(outputRoot, "latest.json");

const thresholds = {
  postgres: readThreshold(parsed.maxAgeMinutesPostgres, "STUDIO_BRAIN_BACKUP_MAX_AGE_MINUTES_POSTGRES"),
  redis: readThreshold(parsed.maxAgeMinutesRedis, "STUDIO_BRAIN_BACKUP_MAX_AGE_MINUTES_REDIS"),
  minio: readThreshold(parsed.maxAgeMinutesMinio, "STUDIO_BRAIN_BACKUP_MAX_AGE_MINUTES_MINIO"),
};

if (parsed.command === "verify") {
  const report = await runVerify();
  emit(report);
  process.exit(shouldFail(report.status) ? 1 : 0);
}

const restoreReport = await runRestoreDrill();
emit(restoreReport);
process.exit(shouldFail(restoreReport.status) ? 1 : 0);

async function runVerify() {
  const now = new Date();
  const generatedAt = now.toISOString();
  const latest = readLatestManifest();
  const freshness = evaluateFreshness(latest.manifest, now);
  const serviceChecks = parsed.freshnessOnly ? [] : await runServiceChecks();
  const serviceFailures = serviceChecks.filter((entry) => entry.status === "fail");

  let status = "pass";
  if (serviceFailures.length > 0) {
    status = "fail";
  } else if (freshness.status !== "pass") {
    status = "warn";
  }

  const payload = {
    schemaVersion: "1",
    command: "verify",
    generatedAt,
    envSource: envSource.label,
    outputDir: relativePath(outputRoot),
    freshnessOnly: parsed.freshnessOnly,
    thresholdsMinutes: thresholds,
    freshness,
    serviceChecks,
    latestManifestPath: latest.path ? relativePath(latest.path) : "",
    status,
  };

  if (!parsed.freshnessOnly) {
    const artifact = writeManifestArtifact(payload, generatedAt);
    payload.artifact = artifact;
  }

  return payload;
}

async function runRestoreDrill() {
  const now = new Date();
  const generatedAt = now.toISOString();
  const latest = readLatestManifest();

  if (!latest.manifest) {
    return {
      schemaVersion: "1",
      command: "restore-drill",
      generatedAt,
      envSource: envSource.label,
      outputDir: relativePath(outputRoot),
      status: "fail",
      message: "No backup manifest found. Run `npm run backup:verify` first.",
      latestManifestPath: "",
    };
  }

  const serviceChecks = await runServiceChecks();
  const serviceFailures = serviceChecks.filter((entry) => entry.status === "fail");
  const freshness = evaluateFreshness(latest.manifest, now);
  const steps = [
    {
      name: "latest-manifest",
      status: "pass",
      message: `Loaded ${relativePath(latest.path)}`,
    },
    {
      name: "service-health",
      status: serviceFailures.length > 0 ? "fail" : "pass",
      message: serviceFailures.length > 0
        ? `${serviceFailures.length} service health checks failed.`
        : "Postgres, Redis, and MinIO checks passed.",
    },
    {
      name: "freshness-evaluation",
      status: freshness.status === "pass" ? "pass" : "warn",
      message: freshness.summary,
    },
  ];

  let status = serviceFailures.length > 0 ? "fail" : freshness.status === "pass" ? "pass" : "warn";

  const payload = {
    schemaVersion: "1",
    command: "restore-drill",
    generatedAt,
    envSource: envSource.label,
    outputDir: relativePath(outputRoot),
    latestManifestPath: relativePath(latest.path),
    latestManifestGeneratedAt: latest.manifest.generatedAt || "",
    status,
    steps,
    freshness,
    serviceChecks,
    message:
      status === "pass"
        ? "Restore drill prerequisites are healthy."
        : status === "warn"
          ? "Restore drill completed with warnings. Review freshness details."
          : "Restore drill failed. Resolve service readiness before relying on backups.",
  };

  const artifact = writeRestoreArtifact(payload, generatedAt);
  payload.artifact = artifact;
  return payload;
}

function shouldFail(status) {
  if (status === "fail") {
    return true;
  }
  return parsed.strict && status !== "pass";
}

function readThreshold(cliValue, envKey) {
  const raw = cliValue ?? process.env[envKey];
  const parsedMinutes = Number.parseInt(String(raw ?? ""), 10);
  if (Number.isInteger(parsedMinutes) && parsedMinutes > 0) {
    return parsedMinutes;
  }
  return DEFAULT_FRESHNESS_MINUTES;
}

async function runServiceChecks() {
  const checks = [];
  checks.push(runPostgresCheck());
  checks.push(runRedisCheck());
  checks.push(await runMinioCheck());
  return checks;
}

function runPostgresCheck() {
  const running = checkServiceRunning("postgres");
  if (!running.ok) {
    return {
      service: "postgres",
      status: "fail",
      summary: "Postgres container is not running.",
      checks: [running],
    };
  }

  const pgUser = shellQuote(env.PGUSER || "postgres");
  const pgDatabase = shellQuote(env.PGDATABASE || "monsoonfire_studio_os");
  const ready = runCompose(
    [
      "exec",
      "-T",
      "postgres",
      "sh",
      "-lc",
      `pg_isready -U ${pgUser} -d ${pgDatabase}`,
    ],
    { allowFail: true },
  );
  const hasDumpTool = runCompose(
    ["exec", "-T", "postgres", "sh", "-lc", "pg_dump --version"],
    { allowFail: true },
  );
  const status = ready.ok && hasDumpTool.ok ? "pass" : "fail";

  return {
    service: "postgres",
    status,
    summary: status === "pass" ? "Postgres ready and pg_dump available." : "Postgres readiness or pg_dump probe failed.",
    checks: [running, summarizeResult("pg_isready", ready), summarizeResult("pg_dump", hasDumpTool)],
  };
}

function runRedisCheck() {
  const running = checkServiceRunning("redis");
  if (!running.ok) {
    return {
      service: "redis",
      status: "fail",
      summary: "Redis container is not running.",
      checks: [running],
    };
  }

  const ping = runCompose(
    ["exec", "-T", "redis", "redis-cli", "ping"],
    { allowFail: true },
  );
  const status = ping.ok && /PONG/i.test(ping.output) ? "pass" : "fail";

  return {
    service: "redis",
    status,
    summary: status === "pass" ? "Redis ping passed." : "Redis ping failed.",
    checks: [running, summarizeResult("redis-cli ping", ping)],
  };
}

async function runMinioCheck() {
  const running = checkServiceRunning("minio");
  if (!running.ok) {
    return {
      service: "minio",
      status: "fail",
      summary: "MinIO container is not running.",
      checks: [running],
    };
  }

  const endpoint = resolveMinioEndpoint();
  const url = new URL("/minio/health/live", endpoint).toString();
  const health = await checkHttp(url, 8_000);
  const status = health.ok ? "pass" : "fail";

  return {
    service: "minio",
    status,
    summary: status === "pass" ? "MinIO health endpoint passed." : "MinIO health endpoint failed.",
    checks: [running, { name: "http /minio/health/live", ...health }],
  };
}

function checkServiceRunning(service) {
  const running = runCompose(["ps", "--services", "--filter", "status=running", service], { allowFail: true });
  const services = String(running.output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const ok = running.ok && services.includes(service);
  return {
    name: `${service} running`,
    status: ok ? "pass" : "fail",
    ok,
    command: running.command,
    output: truncate(running.output, 800),
    message: ok ? `${service} is running.` : `${service} is not running.`,
  };
}

function evaluateFreshness(manifest, now) {
  if (!manifest?.generatedAt) {
    return {
      status: "warn",
      summary: "No prior backup manifest found.",
      ageMinutes: null,
      services: {
        postgres: buildFreshnessEntry("warn", "Missing prior manifest."),
        redis: buildFreshnessEntry("warn", "Missing prior manifest."),
        minio: buildFreshnessEntry("warn", "Missing prior manifest."),
      },
    };
  }

  const generated = new Date(manifest.generatedAt);
  const validDate = Number.isFinite(generated.getTime());
  if (!validDate) {
    return {
      status: "warn",
      summary: "Latest manifest has invalid timestamp.",
      ageMinutes: null,
      services: {
        postgres: buildFreshnessEntry("warn", "Invalid manifest timestamp."),
        redis: buildFreshnessEntry("warn", "Invalid manifest timestamp."),
        minio: buildFreshnessEntry("warn", "Invalid manifest timestamp."),
      },
    };
  }

  const ageMinutes = Math.max(0, Math.round((now.getTime() - generated.getTime()) / 60_000));
  const checksByService = Object.fromEntries(
    (Array.isArray(manifest.serviceChecks) ? manifest.serviceChecks : []).map((entry) => [entry.service, entry]),
  );

  const services = {};
  let overall = "pass";
  for (const service of ["postgres", "redis", "minio"]) {
    const threshold = thresholds[service];
    const check = checksByService[service];
    if (!check || check.status !== "pass") {
      services[service] = buildFreshnessEntry("warn", "Previous manifest has failing or missing service check.");
      overall = "warn";
      continue;
    }
    if (ageMinutes > threshold) {
      services[service] = buildFreshnessEntry(
        "warn",
        `Last verified backup is stale (${ageMinutes}m > ${threshold}m).`,
      );
      overall = "warn";
      continue;
    }
    services[service] = buildFreshnessEntry(
      "pass",
      `Fresh within threshold (${ageMinutes}m <= ${threshold}m).`,
    );
  }

  return {
    status: overall,
    summary: overall === "pass" ? "Backup freshness is within configured thresholds." : "Backup freshness warnings detected.",
    ageMinutes,
    services,
  };
}

function buildFreshnessEntry(status, message) {
  return { status, message };
}

function resolveMinioEndpoint() {
  const envValue = String(env.STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT || "").trim();
  if (envValue) {
    try {
      return new URL(envValue).toString();
    } catch {
      // fall through to derived endpoint
    }
  }
  const port = Number.parseInt(String(env.MINIO_API_PORT || "9010"), 10);
  const safePort = Number.isInteger(port) && port > 0 ? port : 9010;
  return `http://127.0.0.1:${safePort}`;
}

async function checkHttp(url, timeoutMs) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    const ok = response.ok;
    return {
      ok,
      status: ok ? "pass" : "fail",
      statusCode: response.status,
      message: ok ? `HTTP ${response.status}` : `HTTP ${response.status}`,
      output: truncate(text, 400),
      url,
    };
  } catch (error) {
    return {
      ok: false,
      status: "fail",
      statusCode: 0,
      message: error instanceof Error ? error.message : String(error),
      output: "",
      url,
    };
  }
}

function writeManifestArtifact(payload, generatedAt) {
  const bundleDir = resolve(outputRoot, generatedAt.replace(/[:.]/g, "-"));
  mkdirSync(bundleDir, { recursive: true });

  const manifestPath = resolve(bundleDir, "manifest.json");
  const checksumPath = resolve(bundleDir, "manifest.sha256");
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  const checksum = createHash("sha256").update(serialized).digest("hex");

  writeFileSync(manifestPath, serialized, "utf8");
  writeFileSync(checksumPath, `${checksum}  manifest.json\n`, "utf8");
  writeFileSync(
    latestPath,
    `${JSON.stringify(
      {
        generatedAt: payload.generatedAt,
        manifestPath: relativePath(manifestPath),
        checksumPath: relativePath(checksumPath),
        checksumSha256: checksum,
        status: payload.status,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    manifestPath: relativePath(manifestPath),
    checksumPath: relativePath(checksumPath),
    checksumSha256: checksum,
  };
}

function writeRestoreArtifact(payload, generatedAt) {
  const bundleDir = resolve(outputRoot, generatedAt.replace(/[:.]/g, "-"));
  mkdirSync(bundleDir, { recursive: true });

  const summaryPath = resolve(bundleDir, "restore-drill-summary.json");
  const checksumPath = resolve(bundleDir, "restore-drill-summary.sha256");
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  const checksum = createHash("sha256").update(serialized).digest("hex");
  writeFileSync(summaryPath, serialized, "utf8");
  writeFileSync(checksumPath, `${checksum}  restore-drill-summary.json\n`, "utf8");

  return {
    summaryPath: relativePath(summaryPath),
    checksumPath: relativePath(checksumPath),
    checksumSha256: checksum,
  };
}

function readLatestManifest() {
  if (!existsSync(latestPath)) {
    return { path: "", manifest: null };
  }
  try {
    const latest = JSON.parse(readFileSync(latestPath, "utf8"));
    const manifestPath = latest?.manifestPath
      ? resolve(REPO_ROOT, latest.manifestPath)
      : "";
    if (!manifestPath || !existsSync(manifestPath)) {
      return { path: "", manifest: null };
    }
    return {
      path: manifestPath,
      manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
    };
  } catch {
    return { path: "", manifest: null };
  }
}

function summarizeResult(name, result) {
  return {
    name,
    status: result.ok ? "pass" : "fail",
    ok: result.ok,
    command: result.command,
    output: truncate(result.output, 800),
    message: result.ok ? `${name} passed.` : `${name} failed.`,
  };
}

function runCompose(composeArgs, options = {}) {
  const command = ["compose"];
  if (envSource.path) {
    command.push("--env-file", envSource.path);
  }
  command.push("-f", COMPOSE_FILE, ...composeArgs);
  const result = spawnSync("docker", command, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe",
    timeout: options.timeoutMs || 20_000,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  const ok = result.status === 0;
  return {
    ok,
    statusCode: result.status ?? 1,
    command: `docker ${command.join(" ")}`,
    output,
  };
}

function resolveEnvSource() {
  const explicit = String(process.env.STUDIO_BRAIN_ENV_FILE || "").trim();
  if (explicit) {
    const explicitPath = resolve(STUDIO_BRAIN_ROOT, explicit);
    return {
      path: existsSync(explicitPath) ? explicitPath : null,
      label: existsSync(explicitPath) ? `studio-brain/${explicit}` : `missing:${explicit}`,
    };
  }

  const local = resolve(STUDIO_BRAIN_ROOT, ".env");
  if (existsSync(local)) {
    return { path: local, label: "studio-brain/.env" };
  }

  const fallback = resolve(STUDIO_BRAIN_ROOT, ".env.example");
  if (existsSync(fallback)) {
    return { path: fallback, label: "studio-brain/.env.example" };
  }

  return { path: null, label: "(process-env-only)" };
}

function loadResolvedEnv() {
  const fileEnv = envSource.path ? parseEnvFile(envSource.path) : {};
  return { ...fileEnv, ...process.env };
}

function parseEnvFile(path) {
  const values = {};
  if (!path || !existsSync(path)) {
    return values;
  }
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const index = line.indexOf("=");
    if (index < 0) {
      continue;
    }
    const key = line.slice(0, index).trim();
    if (!key) {
      continue;
    }
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function parseArgs(rawArgs) {
  const parsedArgs = {
    command: "verify",
    json: false,
    strict: false,
    freshnessOnly: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    maxAgeMinutesPostgres: null,
    maxAgeMinutesRedis: null,
    maxAgeMinutesMinio: null,
    help: false,
  };

  const args = [...rawArgs];
  if (args[0] && !args[0].startsWith("-")) {
    parsedArgs.command = args.shift();
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json") {
      parsedArgs.json = true;
      continue;
    }
    if (arg === "--strict") {
      parsedArgs.strict = true;
      continue;
    }
    if (arg === "--freshness-only") {
      parsedArgs.freshnessOnly = true;
      continue;
    }
    if (arg === "--output-dir" && args[i + 1]) {
      parsedArgs.outputDir = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--max-age-minutes-postgres" && args[i + 1]) {
      parsedArgs.maxAgeMinutesPostgres = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--max-age-minutes-redis" && args[i + 1]) {
      parsedArgs.maxAgeMinutesRedis = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--max-age-minutes-minio" && args[i + 1]) {
      parsedArgs.maxAgeMinutesMinio = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      parsedArgs.help = true;
      continue;
    }
  }

  return parsedArgs;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\"'\"'")}'`;
}

function relativePath(absPath) {
  if (!absPath) return "";
  return absPath.startsWith(`${REPO_ROOT}/`) ? absPath.slice(REPO_ROOT.length + 1) : absPath;
}

function truncate(text, max) {
  const normalized = String(text || "");
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max)}...`;
}

function emit(payload) {
  const body = parsed.json
    ? JSON.stringify(payload, null, 2)
    : [
        `backup drill ${payload.command}: ${String(payload.status || "unknown").toUpperCase()}`,
        payload.message ? `  message: ${payload.message}` : "",
        payload.artifact?.manifestPath ? `  manifest: ${payload.artifact.manifestPath}` : "",
        payload.artifact?.summaryPath ? `  restore summary: ${payload.artifact.summaryPath}` : "",
        payload.freshness?.summary ? `  freshness: ${payload.freshness.summary}` : "",
      ].filter(Boolean).join("\n");
  process.stdout.write(`${body}\n`);
}

function printHelp() {
  process.stdout.write("Usage: node ./scripts/studiobrain-backup-drill.mjs <verify|restore-drill> [flags]\n");
  process.stdout.write("Flags:\n");
  process.stdout.write("  --json\n");
  process.stdout.write("  --strict\n");
  process.stdout.write("  --freshness-only (verify only)\n");
  process.stdout.write("  --output-dir <path>\n");
  process.stdout.write("  --max-age-minutes-postgres <minutes>\n");
  process.stdout.write("  --max-age-minutes-redis <minutes>\n");
  process.stdout.write("  --max-age-minutes-minio <minutes>\n");
}
