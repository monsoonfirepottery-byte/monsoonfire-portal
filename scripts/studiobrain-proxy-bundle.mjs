#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolveStudioBrainNetworkProfile } from "./studio-network-profile.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const STUDIO_BRAIN_ROOT = resolve(REPO_ROOT, "studio-brain");
const COMPOSE_FILES = [
  resolve(STUDIO_BRAIN_ROOT, "docker-compose.yml"),
  resolve(STUDIO_BRAIN_ROOT, "docker-compose.proxy.yml"),
];

const args = process.argv.slice(2);
const command = args[0] || "status";
const jsonMode = args.includes("--json");
const envSource = resolveEnvSource();
const network = resolveStudioBrainNetworkProfile();
const envValues = envSource.path ? parseEnvFile(envSource.path) : {};
const proxyPort = normalizePort(process.env.STUDIO_PROXY_PORT || envValues.STUDIO_PROXY_PORT, 8788);

if (command === "up") {
  runUp();
} else if (command === "down") {
  runDown();
} else if (command === "status") {
  runStatus();
} else if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
} else {
  process.stderr.write(`Unknown proxy command: ${command}\n`);
  printHelp();
  process.exit(1);
}

function runUp() {
  const result = runCompose(["--profile", "proxy", "up", "-d", "studiobrain-proxy"]);
  output({
    status: result.ok ? "pass" : "fail",
    command: "up",
    envSource: envSource.label,
    proxyPort,
    proxyUrl: `http://${network.host}:${proxyPort}`,
    routeMap: routeMap(),
    compose: summarize(result),
  }, result.ok ? 0 : 1);
}

function runDown() {
  const stop = runCompose(["--profile", "proxy", "stop", "studiobrain-proxy"], { allowFail: true });
  const remove = runCompose(["--profile", "proxy", "rm", "-f", "studiobrain-proxy"], { allowFail: true });
  const ok = stop.ok || remove.ok;
  output({
    status: ok ? "pass" : "warn",
    command: "down",
    envSource: envSource.label,
    proxyPort,
    stop: summarize(stop),
    remove: summarize(remove),
  }, ok ? 0 : 1);
}

function runStatus() {
  const ps = runCompose(["--profile", "proxy", "ps", "--services", "--filter", "status=running"], { allowFail: true });
  const runningServices = String(ps.output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const proxyRunning = runningServices.includes("studiobrain-proxy");
  output({
    status: ps.ok ? "pass" : "warn",
    command: "status",
    envSource: envSource.label,
    proxyRunning,
    proxyPort,
    proxyUrl: `http://${network.host}:${proxyPort}`,
    routeMap: routeMap(),
    runningServices,
    compose: summarize(ps),
  }, ps.ok ? 0 : 1);
}

function runCompose(composeArgs, options = {}) {
  const commandParts = ["compose"];
  if (envSource.path) {
    commandParts.push("--env-file", envSource.path);
  }
  for (const file of COMPOSE_FILES) {
    commandParts.push("-f", file);
  }
  commandParts.push(...composeArgs);

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

function routeMap() {
  return {
    studio: "/studio/* -> host.docker.internal:8787",
    functions: "/functions/* -> host.docker.internal:5001",
    portal: "/portal/* -> host.docker.internal:5173",
    health: "/healthz -> 200",
  };
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

function parseEnvFile(path) {
  const values = {};
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx < 0) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    if (!key) {
      continue;
    }
    values[key] = line.slice(idx + 1).trim();
  }
  return values;
}

function normalizePort(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }
  return fallback;
}

function truncateOutput(value, max) {
  const text = String(value || "");
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...`;
}

function output(payload, exitCode) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`proxy bundle ${payload.command}: ${String(payload.status).toUpperCase()}\n`);
    process.stdout.write(`  env source: ${payload.envSource}\n`);
    if (payload.proxyUrl) {
      process.stdout.write(`  proxy url: ${payload.proxyUrl}\n`);
    }
    if (payload.proxyRunning !== undefined) {
      process.stdout.write(`  running: ${payload.proxyRunning ? "yes" : "no"}\n`);
    }
  }
  process.exit(exitCode);
}

function printHelp() {
  process.stdout.write("Usage: node ./scripts/studiobrain-proxy-bundle.mjs <up|down|status> [flags]\n");
  process.stdout.write("Flags:\n");
  process.stdout.write("  --json\n");
  process.stdout.write("Examples:\n");
  process.stdout.write("  node ./scripts/studiobrain-proxy-bundle.mjs up\n");
  process.stdout.write("  node ./scripts/studiobrain-proxy-bundle.mjs status --json\n");
  process.stdout.write("  node ./scripts/studiobrain-proxy-bundle.mjs down\n");
}
