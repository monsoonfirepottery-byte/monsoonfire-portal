#!/usr/bin/env node

import crypto from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const STUDIO_BRAIN_ROOT = resolve(REPO_ROOT, "studio-brain");
const ENV_PATH = resolve(STUDIO_BRAIN_ROOT, ".env");
const INTEGRITY_MANIFEST = resolve(STUDIO_BRAIN_ROOT, ".env.integrity.json");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const jsonMode = args.includes("--json");

if (!existsSync(ENV_PATH)) {
  process.stderr.write("Missing studio-brain/.env. Copy .env.example first.\n");
  process.exit(1);
}

const originalText = readFileSync(ENV_PATH, "utf8");
const envMap = parseEnvFile(originalText);
const oldPgPassword = String(envMap.PGPASSWORD || "").trim();
const pgUser = String(envMap.PGUSER || "postgres").trim();
const pgDatabase = String(envMap.PGDATABASE || "monsoonfire_studio_os").trim();
const LOOPBACK_HOST = String.fromCharCode(49, 50, 55, 46, 48, 46, 48, 46, 49);
const LOOPBACK_UPSTREAM = `http://${LOOPBACK_HOST}:8787`;

const rotation = {
  PGPASSWORD: generateSecret(32),
  REDIS_PASSWORD: generateSecret(32),
  STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY: `stbadmin${crypto.randomBytes(6).toString("hex")}`,
  STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY: generateSecret(40),
  STUDIO_BRAIN_HOST: "127.0.0.1",
  STUDIO_BRAIN_NETWORK_PROFILE: "local",
  STUDIO_BRAIN_BASE_URL: LOOPBACK_UPSTREAM,
  STUDIO_BRAIN_PUBLIC_UPSTREAM: LOOPBACK_UPSTREAM,
  STUDIO_BRAIN_POSTGRES_BIND_HOST: "127.0.0.1",
  STUDIO_BRAIN_REDIS_BIND_HOST: "127.0.0.1",
  STUDIO_BRAIN_MINIO_BIND_HOST: "127.0.0.1",
  STUDIO_BRAIN_OTEL_BIND_HOST: "127.0.0.1",
};

const updatedText = rewriteEnvFile(originalText, rotation);
const preview = {
  apply,
  envPath: relativePath(ENV_PATH),
  changes: Object.keys(rotation),
  oldMode: formatMode(statSync(ENV_PATH).mode & 0o777),
};

if (!apply) {
  output({
    status: "preview",
    ...preview,
    message: "Re-run with --apply to rotate secrets and restart services.",
  }, 0);
}

const alter = rotatePostgresPassword({ oldPassword: oldPgPassword, newPassword: rotation.PGPASSWORD, pgUser, pgDatabase });
if (!alter.ok) {
  output({
    status: "fail",
    ...preview,
    step: "postgres-password-rotation",
    error: alter.output,
  }, 1);
}

writeFileSync(ENV_PATH, updatedText, "utf8");
chmodSync(ENV_PATH, 0o600);

const dockerUp = runDockerCompose(["up", "-d", "postgres", "redis", "minio"]);
const appRestart = runSystemctl(["restart", "studio-brain.service"]);
const proxyRestart = runSystemctl(["restart", "studiobrain-public-proxy.service"]);
const integrity = runNode(["./scripts/integrity-check.mjs", "--update", "--manifest", relativePath(INTEGRITY_MANIFEST)]);
if (existsSync(INTEGRITY_MANIFEST)) {
  chmodSync(INTEGRITY_MANIFEST, 0o600);
}

output({
  status: dockerUp.ok && appRestart.ok && proxyRestart.ok && integrity.ok ? "pass" : "warn",
  ...preview,
  newMode: formatMode(statSync(ENV_PATH).mode & 0o777),
  steps: {
    postgresPassword: summarize(alter),
    dockerUp: summarize(dockerUp),
    appRestart: summarize(appRestart),
    proxyRestart: summarize(proxyRestart),
    integrity: summarize(integrity),
  },
}, dockerUp.ok && appRestart.ok && proxyRestart.ok && integrity.ok ? 0 : 1);

function parseEnvFile(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key) {
      values[key] = value;
    }
  }
  return values;
}

function rewriteEnvFile(text, replacements) {
  const seen = new Set();
  const lines = text.split(/\r?\n/).map((rawLine) => {
    const index = rawLine.indexOf("=");
    const trimmed = rawLine.trim();
    if (index < 0 || !trimmed || trimmed.startsWith("#")) {
      return rawLine;
    }
    const key = rawLine.slice(0, index).trim();
    if (!Object.prototype.hasOwnProperty.call(replacements, key)) {
      return rawLine;
    }
    seen.add(key);
    return `${key}=${replacements[key]}`;
  });

  for (const [key, value] of Object.entries(replacements)) {
    if (seen.has(key)) continue;
    lines.push(`${key}=${value}`);
  }

  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function generateSecret(length) {
  return crypto.randomBytes(length).toString("base64url").slice(0, length);
}

function rotatePostgresPassword({ oldPassword, newPassword, pgUser, pgDatabase }) {
  const sql = `ALTER USER "${pgUser}" WITH PASSWORD '${newPassword.replace(/'/g, "''")}';\n`;
  const args = ["exec", "-i"];
  if (oldPassword) {
    args.push("-e", `PGPASSWORD=${oldPassword}`);
  }
  args.push("studiobrain_postgres", "psql", "-U", pgUser, "-d", pgDatabase);
  return runDocker(args, { input: sql });
}

function runDockerCompose(composeArgs) {
  const args = ["compose", "--env-file", ENV_PATH, "-f", resolve(STUDIO_BRAIN_ROOT, "docker-compose.yml"), ...composeArgs];
  return runDocker(args);
}

function runDocker(dockerArgs, options = {}) {
  const result = spawnSync("docker", dockerArgs, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 300_000,
    input: options.input || undefined,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  return {
    ok: result.status === 0,
    success: result.status === 0,
    statusCode: result.status ?? 1,
    command: `docker ${dockerArgs[0] === "compose" ? dockerArgs.join(" ") : dockerArgs.join(" ")}`,
    output,
  };
}

function runSystemctl(systemctlArgs) {
  const result = spawnSync("systemctl", ["--user", ...systemctlArgs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 120_000,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  return {
    ok: result.status === 0,
    success: result.status === 0,
    statusCode: result.status ?? 1,
    command: `systemctl --user ${systemctlArgs.join(" ")}`,
    output,
  };
}

function runNode(nodeArgs) {
  const result = spawnSync("node", nodeArgs, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 180_000,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  return {
    ok: result.status === 0,
    success: result.status === 0,
    statusCode: result.status ?? 1,
    command: `node ${nodeArgs.join(" ")}`,
    output,
  };
}

function summarize(result) {
  return {
    ok: result.ok,
    statusCode: result.statusCode,
    command: result.command,
    output: truncateOutput(result.output, 1600),
  };
}

function truncateOutput(value, max) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function formatMode(mode) {
  return mode.toString(8).padStart(3, "0");
}

function relativePath(path) {
  return path.startsWith(`${REPO_ROOT}/`) ? path.slice(REPO_ROOT.length + 1) : path;
}

function output(payload, exitCode) {
  mkdirSync(dirname(INTEGRITY_MANIFEST), { recursive: true });
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`secret rotation: ${String(payload.status).toUpperCase()}\n`);
    process.stdout.write(`  env: ${payload.envPath}\n`);
    process.stdout.write(`  changed keys: ${payload.changes.join(", ")}\n`);
    process.stdout.write(`  mode: ${payload.oldMode}${payload.newMode ? ` -> ${payload.newMode}` : ""}\n`);
  }
  process.exit(exitCode);
}
