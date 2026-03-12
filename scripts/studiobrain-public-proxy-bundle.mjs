#!/usr/bin/env node

import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const STUDIO_BRAIN_ROOT = resolve(REPO_ROOT, "studio-brain");
const COMPOSE_FILE = resolve(STUDIO_BRAIN_ROOT, "docker-compose.public-proxy.yml");
const LOG_DIR = resolve(REPO_ROOT, "output", "security", "public-proxy");

const args = process.argv.slice(2);
const command = args[0] || "status";
const jsonMode = args.includes("--json");
const envSource = resolveEnvSource();

if (command === "up") {
  runUp();
} else if (command === "down") {
  runDown();
} else if (command === "status") {
  runStatus();
} else if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
} else {
  process.stderr.write(`Unknown public proxy command: ${command}\n`);
  printHelp();
  process.exit(1);
}

function runUp() {
  mkdirSync(LOG_DIR, { recursive: true });
  const result = runCompose(["up", "-d", "studiobrain-public-proxy"]);
  const logPrep = result.ok
    ? runDocker(["exec", "studiobrain_public_proxy", "sh", "-c", "mkdir -p /var/log/caddy && touch /var/log/caddy/access.log && chmod 0640 /var/log/caddy/access.log"], { allowFail: true })
    : null;
  output({
    status: result.ok ? "pass" : "fail",
    command: "up",
    envSource: envSource.label,
    compose: summarize(result),
    logPrep: logPrep ? summarize(logPrep) : { skipped: true },
    logDir: relativePath(LOG_DIR),
  }, result.ok ? 0 : 1);
}

function runDown() {
  const stop = runCompose(["stop", "studiobrain-public-proxy"], { allowFail: true });
  const remove = runCompose(["rm", "-f", "studiobrain-public-proxy"], { allowFail: true });
  const ok = stop.success || remove.success;
  output({
    status: ok ? "pass" : "warn",
    command: "down",
    envSource: envSource.label,
    stop: summarize(stop),
    remove: summarize(remove),
  }, ok ? 0 : 1);
}

function runStatus() {
  const ps = runCompose(["ps", "--services", "--filter", "status=running"], { allowFail: true });
  const runningServices = String(ps.output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  output({
    status: ps.ok ? "pass" : "warn",
    command: "status",
    envSource: envSource.label,
    publicProxyRunning: runningServices.includes("studiobrain-public-proxy"),
    runningServices,
    logDir: relativePath(LOG_DIR),
    compose: summarize(ps),
  }, ps.ok ? 0 : 1);
}

function runCompose(composeArgs, options = {}) {
  const commandParts = ["compose"];
  if (envSource.path) {
    commandParts.push("--env-file", envSource.path);
  }
  commandParts.push("-f", COMPOSE_FILE, ...composeArgs);
  const result = spawnSync("docker", commandParts, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 120_000,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  const success = result.status === 0;
  return {
    ok: options.allowFail ? true : success,
    success,
    statusCode: result.status ?? 1,
    command: `docker ${commandParts.join(" ")}`,
    output,
  };
}

function runDocker(dockerArgs, options = {}) {
  const result = spawnSync("docker", dockerArgs, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe",
    timeout: options.timeoutMs || 120_000,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  const success = result.status === 0;
  return {
    ok: options.allowFail ? true : success,
    success,
    statusCode: result.status ?? 1,
    command: `docker ${dockerArgs.join(" ")}`,
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

function summarize(result) {
  return {
    ok: result.ok,
    success: result.success,
    statusCode: result.statusCode,
    command: result.command,
    output: truncateOutput(result.output, 2000),
  };
}

function truncateOutput(value, max) {
  const text = String(value || "");
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...`;
}

function relativePath(path) {
  return path.startsWith(`${REPO_ROOT}/`) ? path.slice(REPO_ROOT.length + 1) : path;
}

function output(payload, exitCode) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`public proxy bundle ${payload.command}: ${String(payload.status).toUpperCase()}\n`);
    process.stdout.write(`  env source: ${payload.envSource}\n`);
    if (payload.publicProxyRunning !== undefined) {
      process.stdout.write(`  running: ${payload.publicProxyRunning ? "yes" : "no"}\n`);
    }
    if (payload.logDir) {
      process.stdout.write(`  log dir: ${payload.logDir}\n`);
    }
  }
  process.exit(exitCode);
}

function printHelp() {
  process.stdout.write("Usage: node ./scripts/studiobrain-public-proxy-bundle.mjs <up|down|status> [--json]\n");
}
