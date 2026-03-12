#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const STUDIO_BRAIN_ROOT = resolve(REPO_ROOT, "studio-brain");
const SECURITY_COMPOSE_FILE = resolve(STUDIO_BRAIN_ROOT, "docker-compose.security.yml");
const OUTPUT_DIR = resolve(REPO_ROOT, "output", "security", "studiobrain");
const SUMMARY_PATH = resolve(OUTPUT_DIR, "latest-summary.json");
const TRIVY_CACHE_DIR = resolve(REPO_ROOT, ".cache", "trivy");
const TRIVY_IMAGE = process.env.STUDIO_BRAIN_TRIVY_IMAGE || "aquasec/trivy:latest";

const args = process.argv.slice(2);
const command = args[0] || "status";
const jsonMode = args.includes("--json");
const envSource = resolveEnvSource();
const envValues = envSource.path ? parseEnvFile(envSource.path) : {};

if (command === "up") {
  runUp();
} else if (command === "down") {
  runDown();
} else if (command === "status") {
  runStatus();
} else if (command === "scan") {
  runScan();
} else if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
} else {
  process.stderr.write(`Unknown security command: ${command}\n`);
  printHelp();
  process.exit(1);
}

function runUp() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const proxy = runNode(["./scripts/studiobrain-public-proxy-bundle.mjs", "up", "--json"]);
  const crowdsec = runCompose(["--profile", "security", "up", "-d", "crowdsec"]);
  const statusCode = proxy.ok && crowdsec.ok ? 0 : 1;
  const payload = {
    status: statusCode === 0 ? "pass" : "warn",
    command: "up",
    envSource: envSource.label,
    proxy: summarize(proxy),
    crowdsec: summarize(crowdsec),
  };
  writeSummary(payload);
  output(payload, statusCode);
}

function runDown() {
  const stop = runCompose(["--profile", "security", "stop", "crowdsec"], { allowFail: true });
  const remove = runCompose(["--profile", "security", "rm", "-f", "crowdsec"], { allowFail: true });
  const payload = {
    status: stop.success || remove.success ? "pass" : "warn",
    command: "down",
    envSource: envSource.label,
    stop: summarize(stop),
    remove: summarize(remove),
  };
  writeSummary(payload);
  output(payload, payload.status === "pass" ? 0 : 1);
}

function runStatus() {
  const ps = runCompose(["--profile", "security", "ps", "--services", "--filter", "status=running"], { allowFail: true });
  const runningServices = String(ps.output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const crowdsecCollections = runningServices.includes("crowdsec")
    ? runDocker(["exec", "studiobrain_crowdsec", "cscli", "collections", "list"], { allowFail: true })
    : null;
  const payload = {
    status: ps.ok ? "pass" : "warn",
    command: "status",
    envSource: envSource.label,
    runningServices,
    crowdsecRunning: runningServices.includes("crowdsec"),
    crowdsecCollections: crowdsecCollections ? summarize(crowdsecCollections) : { skipped: true },
    latestSummary: readSummary(),
  };
  output(payload, ps.ok ? 0 : 1);
}

function runScan() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(TRIVY_CACHE_DIR, { recursive: true });
  const publicSurfacePath = resolve(OUTPUT_DIR, "public-surface-scan.json");
  const historyPath = resolve(OUTPUT_DIR, "history-secret-scan.json");
  const statusPath = resolve(OUTPUT_DIR, "studiobrain-status.json");
  const fsPath = resolve(OUTPUT_DIR, "trivy-fs.json");

  const surface = runNode([
    "./scripts/studiobrain-public-surface-scan.mjs",
    "--json",
    "--report-path",
    publicSurfacePath,
    "--public-host",
    envValues.STUDIO_BRAIN_PUBLIC_HOST || process.env.STUDIO_BRAIN_PUBLIC_IP || "",
    "--lan-host",
    envValues.STUDIO_BRAIN_STATIC_IP || envValues.STUDIO_BRAIN_LAN_HOST || envValues.STUDIO_BRAIN_HOST || "",
  ]);
  const history = runNode([
    "./scripts/security-history-scan.mjs",
    "--json",
    "--report-path",
    historyPath,
    "--max-per-pattern",
    "15",
  ]);
  const status = runNode(["./scripts/studiobrain-status.mjs", "--json"]);
  writeCommandOutput(statusPath, status.output);

  const images = resolveLiveImages();
  const imageReports = images.map((image) => runTrivyImageScan(image));
  const fsScan = runTrivyFsScan(fsPath);

  const payload = {
    status: [surface, history, status, fsScan, ...imageReports].every((entry) => entry.ok) ? "pass" : "warn",
    command: "scan",
    envSource: envSource.label,
    artifacts: {
      publicSurfacePath: relativePath(publicSurfacePath),
      historyPath: relativePath(historyPath),
      statusPath: relativePath(statusPath),
      fsPath: relativePath(fsPath),
      imageReports: imageReports.map((entry) => relativePath(entry.artifactPath)),
    },
    surface: summarize(surface),
    history: summarize(history),
    statusCheck: summarize(status),
    fsScan: summarize(fsScan),
    imageScans: imageReports.map((entry) => ({
      image: entry.image,
      artifactPath: relativePath(entry.artifactPath),
      ok: entry.ok,
      statusCode: entry.statusCode,
      output: truncateOutput(entry.output, 1200),
    })),
  };
  writeSummary(payload);
  output(payload, payload.status === "pass" ? 0 : 1);
}

function runCompose(composeArgs, options = {}) {
  const commandParts = ["compose"];
  if (envSource.path) {
    commandParts.push("--env-file", envSource.path);
  }
  commandParts.push("-f", SECURITY_COMPOSE_FILE, ...composeArgs);
  return runDocker(commandParts, options);
}

function runDocker(dockerArgs, options = {}) {
  const result = spawnSync("docker", dockerArgs, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe",
    timeout: options.timeoutMs || 300_000,
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

function runNode(nodeArgs) {
  const result = spawnSync("node", nodeArgs, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 300_000,
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

function runTrivyImageScan(image) {
  const artifactPath = resolve(OUTPUT_DIR, sanitizeFileName(`trivy-image-${image}.json`));
  const args = [
    "run",
    "--rm",
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock",
    "-v",
    `${TRIVY_CACHE_DIR}:/root/.cache/`,
    TRIVY_IMAGE,
    "image",
    "--scanners",
    "vuln,misconfig,secret",
    "--severity",
    "HIGH,CRITICAL",
    "--ignore-unfixed",
    "--format",
    "json",
    image,
  ];
  const result = runDocker(args);
  writeCommandOutput(artifactPath, result.output || "{}");
  return {
    ...result,
    image,
    artifactPath,
  };
}

function runTrivyFsScan(artifactPath) {
  const args = [
    "run",
    "--rm",
    "-v",
    `${REPO_ROOT}:/scan:ro`,
    "-v",
    `${TRIVY_CACHE_DIR}:/root/.cache/`,
    TRIVY_IMAGE,
    "fs",
    "--scanners",
    "vuln,misconfig,secret",
    "--severity",
    "HIGH,CRITICAL",
    "--ignore-unfixed",
    "--format",
    "json",
    "/scan/studio-brain",
  ];
  const result = runDocker(args);
  writeCommandOutput(artifactPath, result.output || "{}");
  return result;
}

function resolveLiveImages() {
  const result = runDocker([
    "ps",
    "--format",
    "{{.Image}}",
    "--filter",
    "name=studiobrain_",
    "--filter",
    "name=monitoring-proxy",
    "--filter",
    "name=netdata",
    "--filter",
    "name=uptime-kuma",
  ], { allowFail: true });
  return [...new Set(String(result.output || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
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
    const index = line.indexOf("=");
    if (index < 0) {
      continue;
    }
    const key = line.slice(0, index).trim();
    if (!key) {
      continue;
    }
    values[key] = line.slice(index + 1).trim();
  }
  return values;
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

function writeCommandOutput(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${String(content || "").trim()}\n`, "utf8");
}

function writeSummary(payload) {
  mkdirSync(dirname(SUMMARY_PATH), { recursive: true });
  writeFileSync(SUMMARY_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readSummary() {
  if (!existsSync(SUMMARY_PATH)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(SUMMARY_PATH, "utf8"));
  } catch {
    return null;
  }
}

function sanitizeFileName(value) {
  return value.replace(/[^a-z0-9._-]+/gi, "-");
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
    process.stdout.write(`security bundle ${payload.command}: ${String(payload.status).toUpperCase()}\n`);
    process.stdout.write(`  env source: ${payload.envSource}\n`);
    if (payload.artifacts) {
      process.stdout.write(`  artifacts: ${relativePath(OUTPUT_DIR)}\n`);
    }
    if (payload.runningServices) {
      process.stdout.write(`  running services: ${payload.runningServices.join(", ") || "(none)"}\n`);
    }
  }
  process.exit(exitCode);
}

function printHelp() {
  process.stdout.write("Usage: node ./scripts/studiobrain-security-bundle.mjs <up|down|status|scan> [--json]\n");
}
