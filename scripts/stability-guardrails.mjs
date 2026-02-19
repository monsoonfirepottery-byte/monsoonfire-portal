#!/usr/bin/env node
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_COMPOSE_PATH = resolve(REPO_ROOT, "studio-brain/docker-compose.yml");
const DEFAULT_VOLUME_LIMIT_MB = Number(process.env.STABILITY_GUARDRAILS_VOLUME_LIMIT_MB || "3072");
const DEFAULT_VOLUME_LIMITS = {
  postgres_data: parseMegabytes(process.env.STABILITY_GUARDRAILS_VOLUME_LIMIT_MB_POSTGRES) || DEFAULT_VOLUME_LIMIT_MB,
  minio_data: parseMegabytes(process.env.STABILITY_GUARDRAILS_VOLUME_LIMIT_MB_MINIO) || DEFAULT_VOLUME_LIMIT_MB,
};
const DEFAULT_LOG_LIMIT_MB = parseMegabytes(process.env.STABILITY_GUARDRAILS_CONTAINER_LOG_LIMIT_MB) || 64;
const DEFAULT_OUTPUT_LIMIT_MB = parseMegabytes(process.env.STABILITY_GUARDRAILS_OUTPUT_LIMIT_MB) || 512;
const DEFAULT_CLEANUP_DAYS = Number(process.env.STABILITY_GUARDRAILS_CLEANUP_DAYS || "14");

const args = parseArgs(process.argv.slice(2));
const report = runGuardrails(args);

if (args.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  printTextReport(report);
}

if (report.status === "fail") {
  process.exitCode = 1;
}

function runGuardrails(options) {
  const composePath = resolve(String(options.compose || DEFAULT_COMPOSE_PATH));
  const checks = [];

  checks.push(checkComposeGuardrails(composePath));
  checks.push(checkDockerVolumes());
  checks.push(checkOutputArtifacts(options.outputDir || resolve(REPO_ROOT, "output"), options.outputLimitMb || DEFAULT_OUTPUT_LIMIT_MB));

  const dockerLogResult = checkDockerLogSize();
  if (dockerLogResult) {
    checks.push(dockerLogResult);
  }

  const cleanupSummary = maybeCleanupArtifacts(
    options.cleanupArtifacts,
    options.outputDir || resolve(REPO_ROOT, "output"),
    options.cleanupDays || DEFAULT_CLEANUP_DAYS,
  );
  if (cleanupSummary) {
    checks.push(cleanupSummary);
  }

  const hardFails = checks.filter((entry) => entry.severity === "critical" && !entry.ok);
  const warnings = checks.filter((entry) => entry.severity === "warning" && !entry.ok);
  const status =
    hardFails.length > 0 || (options.strict && warnings.length > 0) ? "fail" : warnings.length > 0 ? "warn" : "pass";

  return {
    status,
    timestamp: new Date().toISOString(),
    strict: options.strict,
    composePath: relativePath(composePath),
    checks,
    summary: {
      total: checks.length,
      passing: checks.filter((entry) => entry.ok).length,
      warning: warnings.length,
      critical: hardFails.length,
      strict: options.strict,
    },
    cleanup: cleanupSummary ? cleanupSummary.cleanup : null,
  };
}

function checkComposeGuardrails(composePath) {
  if (!existsSync(composePath)) {
    return buildCheck("compose-contract", "critical", false, `Compose file missing: ${relativePath(composePath)}`, {
      reason: "core service orchestration file missing",
      recommendation: "restore studio-brain/docker-compose.yml before starting services.",
    });
  }

  const composeText = readFileSync(composePath, "utf8");
  const lines = composeText.split(/\r?\n/);
  const services = ["postgres", "redis", "minio", "otel-collector"];
  const missing = [];

  for (const service of services) {
    const block = extractBlock(lines, service);
    if (!block) {
      missing.push(`${service} stanza`);
      continue;
    }

    if (!hasPattern(block, /^\s*restart:\s*unless-stopped$/m)) {
      missing.push(`${service} missing restart: unless-stopped`);
    }
    if (!hasPattern(block, /^\s*logging:\s*$/m) || !hasPattern(block, /^\s*max-size:\s*\S+/m)) {
      missing.push(`${service} missing json-file max-size`);
    }
    if (!hasPattern(block, /^\s*max-file:\s*\S+/m)) {
      missing.push(`${service} missing logging max-file`);
    }
    if (
      !hasPattern(block, /^\s*deploy:\s*$/m) ||
      !hasPattern(block, /^\s*resources:\s*$/m) ||
      !hasPattern(block, /^\s*limits:\s*$/m)
    ) {
      missing.push(`${service} missing deploy resource limits`);
    }
  }

  if (missing.length === 0) {
    return buildCheck(
      "compose-contract",
      "warning",
      true,
      "compose policy guards exist for core services",
      { detail: "restart/logging/deploy stanzas present." },
    );
  }

  return buildCheck(
    "compose-contract",
    "critical",
    false,
    "compose guardrails missing for one or more services",
    { missing },
  );
}

function checkDockerVolumes() {
  const docker = runCommand(["--version"]);
  if (!docker.ok) {
    return {
      name: "docker-volumes",
      severity: "warning",
      ok: true,
      status: "warn",
      message: "docker is not available; skipping volume and log checks",
      details: {
        reason: docker.error,
      },
    };
  }

  const volumes = Object.entries(DEFAULT_VOLUME_LIMITS).map(([name, limitMb]) => {
    const record = checkVolumeUsage(name, limitMb);
    return {
      name,
      ...record,
    };
  });

  const failed = volumes.filter((entry) => entry.ok === false);
  if (failed.length > 0) {
    return {
      name: "docker-volumes",
      severity: "critical",
      ok: false,
      status: "fail",
      message: `${failed.length} volume(s) exceed guardrail limits`,
      details: {
        limitMb: DEFAULT_VOLUME_LIMIT_MB,
        volumes,
      },
    };
  }

  return {
    name: "docker-volumes",
    severity: "warning",
    ok: true,
    status: "pass",
    message: "docker volumes are within guardrail limits",
    details: {
      limitMb: DEFAULT_VOLUME_LIMIT_MB,
      volumes,
    },
  };
}

function checkVolumeUsage(volumeName, limitMb) {
  const command = runCommand(["volume", "inspect", volumeName]);
  if (!command.ok) {
    return {
      volume: volumeName,
      ok: true,
      status: "warn",
      statusLabel: "missing",
      reason: `volume "${volumeName}" not present or inaccessible`,
      limitMb,
    };
  }

  let mountPoint;
  try {
    const parsed = JSON.parse(command.stdout || "[]");
    mountPoint = parsed?.[0]?.Mountpoint;
  } catch {
    return {
      volume: volumeName,
      ok: true,
      status: "warn",
      statusLabel: "parse-error",
      reason: "unable to parse docker volume inspect output",
      limitMb,
    };
  }

  if (!mountPoint || !existsSync(mountPoint)) {
    return {
      volume: volumeName,
      ok: true,
      status: "warn",
      statusLabel: "missing-mountpoint",
      reason: "volume mount point missing",
      limitMb,
    };
  }

  const usedBytes = directorySizeBytes(mountPoint);
  const limitBytes = Math.max(1, limitMb) * 1024 * 1024;
  const usageMb = roundOneDecimal(usedBytes / 1024 / 1024);
  const ok = usedBytes <= limitBytes;

  return {
    volume: volumeName,
    ok,
    status: ok ? "pass" : "fail",
    statusLabel: ok ? "within-limit" : "over-limit",
    usedBytes,
    usedMb: usageMb,
    limitMb,
    reason: ok ? null : `used=${usageMb} MB > limit=${limitMb} MB`,
  };
}

function checkDockerLogSize() {
  const docker = runCommand(["--version"]);
  if (!docker.ok) {
    return null;
  }

  const inspect = runCommand(["ps", "-a", "--format", "{{.Names}} {{.Status}}"]);
  if (!inspect.ok) {
    return {
      name: "docker-logs",
      severity: "warning",
      ok: true,
      status: "warn",
      message: "docker available but no container metadata could be read",
      details: { reason: inspect.error },
    };
  }

  const names = String(inspect.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.split(" ")[0].trim())
    .filter((name) => name.startsWith("studiobrain_"));

  const samples = names.map((container) => inspectContainerLog(container));
  const warningList = samples.filter((entry) => !entry.ok);
  if (warningList.length > 0) {
    return {
      name: "docker-logs",
      severity: "warning",
      ok: false,
      status: "warn",
      message: `one or more studiobrain container logs exceed ${DEFAULT_LOG_LIMIT_MB}MB`,
      details: { limitMb: DEFAULT_LOG_LIMIT_MB, samples },
    };
  }

  return {
    name: "docker-logs",
    severity: "warning",
    ok: true,
    status: "pass",
    message: "studiobrain docker log files are within guardrail bounds",
    details: { limitMb: DEFAULT_LOG_LIMIT_MB, samples },
  };
}

function inspectContainerLog(containerName) {
  const inspect = runCommand(["inspect", containerName, "--format", "{{.LogPath}}"]);
  if (!inspect.ok) {
    return {
      container: containerName,
      ok: true,
      status: "warn",
      statusLabel: "inspect-failed",
      reason: inspect.error,
      limitMb: DEFAULT_LOG_LIMIT_MB,
    };
  }
  const logPath = String(inspect.stdout || "").trim();
  if (!logPath || !existsSync(logPath)) {
    return {
      container: containerName,
      ok: true,
      status: "warn",
      statusLabel: "no-log",
      reason: "log file not found",
      limitMb: DEFAULT_LOG_LIMIT_MB,
    };
  }

  const usedBytes = fileSizeBytes(logPath);
  const limitBytes = Math.max(1, DEFAULT_LOG_LIMIT_MB) * 1024 * 1024;
  const ok = usedBytes <= limitBytes;
  return {
    container: containerName,
    ok,
    status: ok ? "pass" : "warn",
    statusLabel: ok ? "within-limit" : "over-limit",
    usedBytes,
    usedMb: roundOneDecimal(usedBytes / 1024 / 1024),
    limitMb: DEFAULT_LOG_LIMIT_MB,
    reason: ok ? null : `log usage=${roundOneDecimal(usedBytes / 1024 / 1024)}MB > ${DEFAULT_LOG_LIMIT_MB}MB`,
  };
}

function checkOutputArtifacts(outputDir, limitMb) {
  const usedBytes = directorySizeBytes(outputDir);
  const limitBytes = Math.max(1, limitMb) * 1024 * 1024;
  const ok = usedBytes <= limitBytes;

  return {
    name: "artifact-output",
    severity: "warning",
    ok,
    status: ok ? "pass" : "warn",
    message: ok
      ? "output artifacts are within size guardrails"
      : `output directory exceeds ${limitMb}MB output guardrail`,
    details: {
      outputDir: relativePath(outputDir),
      usedBytes,
      usedMb: roundOneDecimal(usedBytes / 1024 / 1024),
      limitMb,
      action: ok ? null : "run --cleanup to trim stale artifacts",
    },
  };
}

function maybeCleanupArtifacts(enabled, outputDir, cleanupDays) {
  if (!enabled) {
    return null;
  }

  const output = cleanupArtifacts(outputDir, cleanupDays);

  return {
    name: "artifact-cleanup",
    severity: "warning",
    ok: true,
    status: output.removedFiles > 0 ? "warn" : "pass",
    message:
      output.removedFiles > 0
        ? `cleaned ${output.removedFiles} stale artifacts`
        : "artifact cleanup completed with no removals",
    details: {
      cleanupDays,
      outputDir: relativePath(outputDir),
      removedFiles: output.removedFiles,
      removedBytes: output.removedBytes,
      removedPaths: output.removedPaths,
    },
    cleanup: {
      enabled,
      removedFiles: output.removedFiles,
      removedBytes: output.removedBytes,
    },
  };
}

function cleanupArtifacts(outputRoot, maxAgeDays) {
  if (!existsSync(outputRoot)) {
    return { removedFiles: 0, removedBytes: 0, removedPaths: [] };
  }

  const cutoff = Date.now() - Math.max(1, maxAgeDays) * 24 * 60 * 60 * 1000;
  let removedFiles = 0;
  let removedBytes = 0;
  const removedPaths = [];
  const targets = ["stability", "playwright", "cutover-gate", "pr-gate"];

  for (const target of targets) {
    const resolved = resolve(outputRoot, target);
    if (!existsSync(resolved)) {
      continue;
    }
    cleanupDirectory(resolved, cutoff, (path, bytes) => {
      removedFiles += 1;
      removedBytes += bytes;
      removedPaths.push(path);
    });
  }

  return { removedFiles, removedBytes, removedPaths };
}

function cleanupDirectory(path, cutoff, onRemove) {
  if (!existsSync(path)) {
    return;
  }

  const stat = lstatSync(path);
  if (!stat.isDirectory()) {
    maybeDelete(path, stat, cutoff, onRemove);
    return;
  }

  const children = readdirSync(path, { withFileTypes: true });
  for (const entry of children) {
    const full = resolve(path, entry.name);
    if (entry.isDirectory()) {
      cleanupDirectory(full, cutoff, onRemove);
      if (existsSync(full)) {
        const list = readdirSync(full, { withFileTypes: true });
        if (list.length === 0) {
          const finalStat = lstatSync(full);
          maybeDelete(full, finalStat, cutoff, onRemove);
        }
      }
      continue;
    }

    const fileStat = lstatSync(full);
    maybeDelete(full, fileStat, cutoff, onRemove);
  }
}

function maybeDelete(path, stat, cutoff, onRemove) {
  if (!stat.isFile() && !stat.isSymbolicLink()) {
    return;
  }
  if (stat.mtimeMs > cutoff) {
    return;
  }
  if (path.endsWith("README.md") || path.endsWith(".gitkeep")) {
    return;
  }
  rmSync(path, { force: true });
  onRemove(path, stat.size);
}

function directorySizeBytes(root) {
  if (!existsSync(root)) {
    return 0;
  }
  const stat = lstatSync(root);
  if (!stat.isDirectory()) {
    return stat.size;
  }

  let total = 0;
  const stack = [root];
  while (stack.length > 0) {
    const item = stack.pop();
    let currentStat;
    try {
      currentStat = lstatSync(item);
    } catch {
      continue;
    }

    if (!currentStat.isDirectory()) {
      total += currentStat.size;
      continue;
    }

    let children;
    try {
      children = readdirSync(item, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const child of children) {
      if (child.name === ".git") {
        continue;
      }
      stack.push(resolve(item, child.name));
    }
  }

  return total;
}

function fileSizeBytes(path) {
  try {
    return lstatSync(path).size;
  } catch {
    return 0;
  }
}

function runCommand(args, timeoutMs = 5_000) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    return {
      ok: false,
      error: result.error.message,
      stdout: "",
      stderr: "",
    };
  }

  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    error: result.status === 0 ? "" : stderr || stdout || "command failed",
  };
}

function extractBlock(lines, service) {
  const marker = new RegExp(`^  ${service}:\\s*$`);
  const start = lines.findIndex((line) => marker.test(line));
  if (start === -1) {
    return "";
  }
  const block = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    block.push(line);
    if (index > start && /^  \S/.test(line)) {
      break;
    }
  }
  return block.join("\n");
}

function hasPattern(block, pattern) {
  return pattern.test(block);
}

function buildCheck(name, severity, ok, message, details = {}) {
  return {
    name,
    severity,
    ok,
    status: ok ? "pass" : "fail",
    message,
    details,
  };
}

function parseMegabytes(raw, fallback = 0) {
  if (!raw && raw !== 0) return fallback;
  const value = Number(String(raw).trim());
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function roundOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function parseArgs(rawArgs) {
  const parsed = {
    json: false,
    strict: false,
    cleanupArtifacts: false,
    outputLimitMb: DEFAULT_OUTPUT_LIMIT_MB,
    cleanupDays: DEFAULT_CLEANUP_DAYS,
    compose: null,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }
    if (arg === "--cleanup") {
      parsed.cleanupArtifacts = true;
      continue;
    }
    if (arg === "--compose" && rawArgs[index + 1]) {
      parsed.compose = rawArgs[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--compose=")) {
      parsed.compose = arg.substring("--compose=".length);
      continue;
    }
    if (arg === "--output-dir" && rawArgs[index + 1]) {
      parsed.outputDir = resolve(REPO_ROOT, rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--output-limit-mb" && rawArgs[index + 1]) {
      parsed.outputLimitMb = Number(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--cleanup-days" && rawArgs[index + 1]) {
      parsed.cleanupDays = Number(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  return parsed;
}

function printUsage() {
  process.stdout.write("Usage: node ./scripts/stability-guardrails.mjs [options]\n");
  process.stdout.write("  --json                     emit JSON\n");
  process.stdout.write("  --strict                   treat warnings as failures\n");
  process.stdout.write("  --compose path             compose path override\n");
  process.stdout.write("  --output-dir path           output directory to guard (default: output)\n");
  process.stdout.write("  --output-limit-mb           max output size before warning\n");
  process.stdout.write("  --cleanup                  delete stale output artifacts older than threshold\n");
  process.stdout.write("  --cleanup-days days         cleanup age threshold in days\n");
}

function printTextReport(report) {
  process.stdout.write(`stability guardrails: ${report.status.toUpperCase()}\n`);
  process.stdout.write(`compose: ${report.composePath}\n`);
  process.stdout.write(`checks: pass=${report.summary.passing}/${report.summary.total}\n`);
  report.checks.forEach((check) => {
    const tag = check.ok ? "PASS" : check.status.toUpperCase();
    process.stdout.write(`  [${tag}:${check.severity}] ${check.name} - ${check.message}\n`);
    if (check.details && !check.ok) {
      process.stdout.write(`    details: ${JSON.stringify(check.details)}\n`);
    }
  });
}

function relativePath(path) {
  return path.startsWith(`${REPO_ROOT}/`) ? `.${path.substring(REPO_ROOT.length)}` : path;
}

export { runGuardrails };
