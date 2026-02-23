import { existsSync } from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { printValidationReport, validateEnvContract } from "./env-contract-validator.mjs";
import { isStudioBrainHostAllowed, resolveStudioBrainNetworkProfile } from "../../scripts/studio-network-profile.mjs";
import { runGuardrails } from "../../scripts/stability-guardrails.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STUDIO_BRAIN_ROOT = resolve(__dirname, "..");
const warningPrefix = "[network-profile]";
const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_MINIO_API_PORT = 9010;
const NETWORK_PROFILE_ENV_KEYS = [
  "STUDIO_BRAIN_NETWORK_PROFILE",
  "STUDIO_BRAIN_LOCAL_HOST",
  "STUDIO_BRAIN_LAN_HOST",
  "STUDIO_BRAIN_DHCP_HOST",
  "STUDIO_BRAIN_STATIC_IP",
  "STUDIO_BRAIN_HOST",
  "STUDIO_BRAIN_ALLOWED_HOSTS",
];

const preExistingEnvKeys = new Set(Object.keys(process.env));

const envSource = resolvePreflightEnvSource();
if (envSource.path) {
  dotenv.config({ path: envSource.path });
  if (envSource.source === "fallback") {
    clearFallbackNetworkProfileOverrides(preExistingEnvKeys);
    hydrateFallbackNetworkHost();
  }
}

function resolvePreflightEnvSource() {
  const explicit = process.env.STUDIO_BRAIN_ENV_FILE;
  if (explicit) {
    const explicitPath = resolve(STUDIO_BRAIN_ROOT, explicit);
    return {
      path: existsSync(explicitPath) ? explicitPath : null,
      label: formatPathForOutput(explicitPath),
      source: "explicit",
    };
  }

  const preferredPath = resolve(STUDIO_BRAIN_ROOT, ".env");
  if (existsSync(preferredPath)) {
    return { path: preferredPath, label: ".env", source: "default" };
  }

  const fallbackPath = resolve(STUDIO_BRAIN_ROOT, ".env.example");
  if (existsSync(fallbackPath)) {
    return { path: fallbackPath, label: ".env.example", source: "fallback" };
  }

  return { path: null, label: "(process-env-only)", source: "process-env-only" };
}

function formatPathForOutput(path) {
  if (!path) return "(none)";
  return path.startsWith(`${STUDIO_BRAIN_ROOT}/`) ? path.slice(STUDIO_BRAIN_ROOT.length + 1) : path;
}

function composeCommand(args) {
  if (!envSource.path) {
    return `docker compose ${args}`;
  }
  return `docker compose --env-file ${envSource.label} ${args}`;
}

function checkTcp({ host, port, timeoutMs }) {
  return new Promise((resolvePromise) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (ok, message) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolvePromise({ ok, message });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true, `Connected to ${host}:${port}`));
    socket.once("timeout", () => done(false, `Timed out connecting to ${host}:${port}`));
    socket.once("error", (err) => done(false, `Connection failed: ${err.message}`));
    socket.connect(port, host);
  });
}

function checkRedisPing({ host, port, timeoutMs }) {
  return new Promise((resolvePromise) => {
    const socket = new net.Socket();
    let settled = false;
    let response = "";

    const done = (ok, message) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolvePromise({ ok, message });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.write("*1\r\n$4\r\nPING\r\n");
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.includes("+PONG")) {
        done(true, `Redis PING succeeded at ${host}:${port}`);
        return;
      }
      if (response.includes("\r\n")) {
        const preview = response.trim().slice(0, 120);
        done(false, `Unexpected Redis response from ${host}:${port}: ${preview}`);
      }
    });
    socket.once("timeout", () => done(false, `Timed out waiting for Redis PING response from ${host}:${port}`));
    socket.once("error", (err) => done(false, `Connection failed: ${err.message}`));
    socket.connect(port, host);
  });
}

async function checkHttpHealth({ url, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json,text/plain,*/*",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const server = response.headers.get("server");
      const serverHint = server ? ` (server: ${server})` : "";
      return {
        ok: false,
        message: `HTTP ${response.status} ${response.statusText || "error"} from ${url}${serverHint}`,
      };
    }

    return {
      ok: true,
      message: `HTTP ${response.status} from ${url}`,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, message: `Timed out requesting ${url}` };
    }
    return {
      ok: false,
      message: `Request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function clearFallbackNetworkProfileOverrides(preloadKeys) {
  for (const key of NETWORK_PROFILE_ENV_KEYS) {
    if (!preloadKeys.has(key)) {
      delete process.env[key];
    }
  }
}

function hydrateFallbackNetworkHost() {
  const existingHost = String(process.env.STUDIO_BRAIN_HOST || "").trim();
  if (existingHost.length > 0) {
    return;
  }
  const profile = resolveStudioBrainNetworkProfile({ env: process.env });
  if (profile.host) {
    process.env.STUDIO_BRAIN_HOST = profile.host;
  }
}

function resolveMinioHealthUrl(endpointValue) {
  try {
    const endpoint = new URL(endpointValue);
    const health = new URL(endpoint.origin);
    health.pathname = "/minio/health/live";
    return { ok: true, url: health.toString() };
  } catch {
    return {
      ok: false,
      url: "",
      message: `Invalid STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT: ${endpointValue}`,
    };
  }
}

function printCheckLine(name, result) {
  const status = result.ok ? "PASS" : "FAIL";
  process.stdout.write(`  [${status}] ${name} - ${result.message}\n`);
}

function printRemediation(service, context) {
  const composeUpPostgres = composeCommand("up -d postgres");
  const composeUpRedis = composeCommand("up -d redis");
  const composeUpMinio = composeCommand("up -d minio");
  const composeLogsPostgres = composeCommand("logs --tail=120 postgres");
  const composeLogsRedis = composeCommand("logs --tail=120 redis");
  const composeLogsMinio = composeCommand("logs --tail=120 minio");
  const composeReset = `${composeCommand("down -v --remove-orphans")} && ${composeCommand("up -d")}`;

  const hintsByService = {
    postgres: [
      `Start dependency: ${composeUpPostgres}`,
      `Verify PGHOST/PGPORT/PGUSER/PGPASSWORD in ${context.envLabel}.`,
      `Inspect container logs: ${composeLogsPostgres}`,
      `If credentials or state drifted, reset local volumes: ${composeReset}`,
      "If host port 5433 is occupied, update both docker-compose host mapping and PGPORT together.",
    ],
    redis: [
      `Start dependency: ${composeUpRedis}`,
      `Verify REDIS_HOST/REDIS_PORT in ${context.envLabel}.`,
      `Inspect container logs: ${composeLogsRedis}`,
      "If host port 6379 is occupied, update docker-compose host mapping and REDIS_PORT together.",
    ],
    minio: [
      `Start dependency: ${composeUpMinio}`,
      `Verify STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT and MinIO credentials in ${context.envLabel}.`,
      `Inspect container logs: ${composeLogsMinio}`,
      "If endpoint host/port changed, update STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT to match the compose mapping.",
      "If MinIO credentials drifted, align STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY/SECRET_KEY with compose values.",
    ],
    env: [
      "Create runtime env file: cp .env.example .env",
      "Run preflight again after environment values are in place.",
    ],
    unknown: [
      "Verify dependency containers are running and healthy.",
      "Retry preflight after resolving host/port conflicts and credential mismatches.",
    ],
  };

  const hints = hintsByService[service] || hintsByService.unknown;
  process.stdout.write(`Remediation (${service}):\n`);
  hints.forEach((entry, index) => process.stdout.write(`  ${index + 1}. ${entry}\n`));
}

async function main() {
  process.stdout.write("studio-brain preflight\n");
  process.stdout.write(`Environment source: ${envSource.label} (${envSource.source})\n`);

  const report = validateEnvContract({ strict: false });
  if (!report.ok) {
    printValidationReport(report);
    if (!envSource.path) {
      printRemediation("env", { envLabel: ".env" });
    }
    process.exit(1);
  }
  if (report.warnings.length > 0) {
    process.stdout.write("WARNING: env contract checks had cautions.\n");
    report.warnings.forEach((warning) => process.stdout.write(` - ${warning}\n`));
  }

  const network = resolveStudioBrainNetworkProfile();
  process.stdout.write(
    `Network profile: ${network.requestedProfile} -> ${network.profile} (${network.networkTargetMode}) -> ${network.host}\n`,
  );
  process.stdout.write(`Network host source: ${network.hostSource}\n`);
  process.stdout.write(`Network profile source: ${network.profileSource}\n`);
  process.stdout.write(`Profile static target enabled: ${network.staticIpEnabled ? "yes" : "no"}\n`);
  process.stdout.write(`Host state file: ${network.hostStateFile || "(not configured)"}\n`);
  if (network.warnings.length > 0) {
    process.stdout.write(`${warningPrefix} profile warnings:\n`);
    network.warnings.forEach((warning) => process.stdout.write(` - ${warning}\n`));
  }

  if (network.networkTargetMode === "static" && !network.staticIpEnabled) {
    process.stdout.write(`${warningPrefix} static-profile selected but no STUDIO_BRAIN_STATIC_IP is configured.\n`);
  }

  if (network.networkTargetMode === "dhcp" && network.hostSource.includes("STUDIO_BRAIN_STATIC_IP")) {
    process.stdout.write(
      `${warningPrefix} STUDIO_BRAIN_STATIC_IP is set while using DHCP profile; keep for static-target override only.\n`,
    );
  }

  if (process.env.STUDIO_BRAIN_BASE_URL) {
    try {
      const base = new URL(process.env.STUDIO_BRAIN_BASE_URL);
      if (!isStudioBrainHostAllowed(base.hostname, network)) {
        process.stdout.write(`${warningPrefix} STUDIO_BRAIN_BASE_URL host is outside profile allowlist: ${base.hostname}\n`);
        process.stdout.write(`allowed hosts: ${network.allowedStudioBrainHosts.join(", ")}\n`);
      }
    } catch {
      process.stdout.write(`${warningPrefix} STUDIO_BRAIN_BASE_URL is not a valid URL, default checks will apply.\n`);
    }
  }

  const timeoutMs = Number(process.env.PREFLIGHT_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS));
  const postgresHost = process.env.PGHOST || network.host;
  const postgresPort = Number(process.env.PGPORT ?? "5433");
  const redisHost = process.env.REDIS_HOST || network.host;
  const redisPort = Number(process.env.REDIS_PORT ?? "6379");
  const artifactStoreEndpoint =
    process.env.STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT || `http://${network.host}:${DEFAULT_MINIO_API_PORT}`;
  const minioHealth = resolveMinioHealthUrl(artifactStoreEndpoint);

  const dependencyChecks = [];
  dependencyChecks.push({
    service: "postgres",
    ...(await checkTcp({ host: postgresHost, port: postgresPort, timeoutMs })),
  });
  dependencyChecks.push({
    service: "redis",
    ...(await checkRedisPing({ host: redisHost, port: redisPort, timeoutMs })),
  });
  if (minioHealth.ok) {
    dependencyChecks.push({
      service: "minio",
      ...(await checkHttpHealth({ url: minioHealth.url, timeoutMs })),
    });
  } else {
    dependencyChecks.push({
      service: "minio",
      ok: false,
      message: minioHealth.message,
    });
  }

  process.stdout.write("Dependency probes:\n");
  dependencyChecks.forEach((entry) => printCheckLine(entry.service, entry));

  const failures = dependencyChecks.filter((entry) => !entry.ok);
  if (failures.length > 0) {
    process.stdout.write(`Failed dependencies (${failures.length}): ${failures.map((entry) => entry.service).join(", ")}\n`);
    failures.forEach((entry) => {
      printRemediation(entry.service, { envLabel: envSource.label });
    });
    process.exit(1);
  }

  const guardrails = runGuardrails({ strict: false });
  process.stdout.write(`stability guardrails: ${guardrails.status.toUpperCase()}\n`);
  if (guardrails.status !== "pass") {
    process.stdout.write("Guardrails reported warnings; run cleanup guidance before merge.\n");
  }
}

void main().catch((error) => {
  process.stderr.write(`preflight crashed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
