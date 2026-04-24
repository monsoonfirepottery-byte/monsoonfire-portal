#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compareSemver, resolveCodexCliCandidates } from "./lib/codex-cli-utils.mjs";
import { loadCodexAutomationEnv } from "./lib/codex-automation-env.mjs";
import {
  buildOperatorDragMetrics,
  summarizeRetryGovernorSignals,
  summarizeToolcallDrag,
} from "./lib/codex-toolcall-governance.mjs";
import { isTrustedStartupGroundingAuthority } from "./lib/codex-startup-reliability.mjs";
import { hydrateStudioBrainAuthFromPortal } from "./lib/studio-brain-startup-auth.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const DEFAULT_ARTIFACT = "output/codex-doctor/latest.json";
const DEFAULT_TOOLCALL_WINDOW_HOURS = 168;
const DEFAULT_CHILD_SCRIPT_TIMEOUT_MS = 30_000;
const CHILD_SCRIPT_TIMEOUTS_MS = {
  "scripts/open-memory.mjs": 15_000,
  "scripts/codex-startup-preflight.mjs": 45_000,
  "scripts/codex-app-doctor.mjs": 15_000,
};

function clean(value) {
  return String(value ?? "").trim();
}

function parseArgs(argv) {
  const parsed = {
    json: false,
    strict: false,
    artifact: DEFAULT_ARTIFACT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (!arg) continue;

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }

    if (arg === "--artifact" && argv[index + 1]) {
      parsed.artifact = String(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--artifact=")) {
      parsed.artifact = arg.slice("--artifact=".length);
      continue;
    }
  }

  return parsed;
}

function readPackageMetadata(repoRoot = REPO_ROOT) {
  const packageJsonPath = resolve(repoRoot, "package.json");
  const packageLockPath = resolve(repoRoot, "package-lock.json");

  let dependencyRange = null;
  let lockVersion = null;

  if (existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    dependencyRange =
      packageJson?.dependencies?.["@openai/codex"] || packageJson?.devDependencies?.["@openai/codex"] || null;
  }

  if (existsSync(packageLockPath)) {
    const packageLock = JSON.parse(readFileSync(packageLockPath, "utf8"));
    lockVersion = packageLock?.packages?.["node_modules/@openai/codex"]?.version || null;
  }

  return {
    dependencyRange,
    lockVersion,
    packageJsonPath,
    packageLockPath,
  };
}

function parseVersionParts(version) {
  const match = String(version || "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function rangeLikelyCompatible(range, version) {
  const rawRange = String(range || "").trim();
  const parsedVersion = parseVersionParts(version);
  if (!rawRange || !parsedVersion) return true;

  const modifier = rawRange[0];
  const normalized = rawRange.replace(/^[~^]/, "");
  const parsedMin = parseVersionParts(normalized);
  if (!parsedMin) return true;

  if (modifier === "^") {
    if (parsedVersion.major !== parsedMin.major) return false;
    return compareSemver(version, normalized) >= 0;
  }

  if (modifier === "~") {
    if (parsedVersion.major !== parsedMin.major) return false;
    if (parsedVersion.minor !== parsedMin.minor) return false;
    return compareSemver(version, normalized) >= 0;
  }

  return compareSemver(version, normalized) === 0;
}

function parseJsonOutput(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace < firstBrace) return null;
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

function readJsonFile(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readNdjson(path) {
  if (!path || !existsSync(path)) return [];
  return String(readFileSync(path, "utf8") || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function toMs(value) {
  if (!value) return null;
  const parsed = new Date(value);
  const millis = parsed.getTime();
  return Number.isFinite(millis) ? millis : null;
}

function resolveChildScriptTimeoutMs(relativePath) {
  return Number(CHILD_SCRIPT_TIMEOUTS_MS[relativePath] || DEFAULT_CHILD_SCRIPT_TIMEOUT_MS);
}

function buildScriptRunDetails(run, { includeStdout = false, includeStderr = false } = {}) {
  const details = {
    command: run.command,
    durationMs: Number.isFinite(run.durationMs) ? run.durationMs : null,
    timeoutMs: Number.isFinite(run.timeoutMs) ? run.timeoutMs : null,
    timedOut: run.timedOut === true,
  };

  if (run.exitCode !== undefined) details.exitCode = run.exitCode;
  if (clean(run.signal)) details.signal = clean(run.signal);
  if (clean(run.error)) details.error = clean(run.error);
  if (includeStdout) details.stdout = run.stdout;
  if (includeStderr) details.stderr = run.stderr;
  return details;
}

function readCurrentToolcallWindow(repoRoot, windowHours = DEFAULT_TOOLCALL_WINDOW_HOURS) {
  const toolcallPath = resolve(repoRoot, ".codex", "toolcalls.ndjson");
  const cutoffMs = Date.now() - windowHours * 60 * 60 * 1000;
  const entries = readNdjson(toolcallPath).filter((entry) => {
    const tsMs = toMs(entry?.tsIso);
    return tsMs != null && tsMs >= cutoffMs;
  });
  return {
    toolcallPath,
    entries,
    windowHours,
  };
}

function summarizeDoctorChanges(previousReport, currentReport) {
  if (!previousReport || typeof previousReport !== "object") {
    return ["No previous doctor artifact was available for comparison."];
  }
  const changes = [];
  if (String(previousReport.status || "") !== String(currentReport.status || "")) {
    changes.push(`Overall status changed from \`${previousReport.status || "unknown"}\` to \`${currentReport.status || "unknown"}\`.`);
  }
  if (Number(previousReport.summary?.warnings || 0) !== Number(currentReport.summary?.warnings || 0)) {
    changes.push(
      `Warning count changed from ${Number(previousReport.summary?.warnings || 0)} to ${Number(currentReport.summary?.warnings || 0)}.`
    );
  }
  if (Number(previousReport.summary?.errors || 0) !== Number(currentReport.summary?.errors || 0)) {
    changes.push(
      `Error count changed from ${Number(previousReport.summary?.errors || 0)} to ${Number(currentReport.summary?.errors || 0)}.`
    );
  }
  if (
    Number(previousReport.drag?.operatorMetrics?.liveStartupEntries || 0) !==
    Number(currentReport.drag?.operatorMetrics?.liveStartupEntries || 0)
  ) {
    changes.push(
      `Live startup coverage changed from ${Number(previousReport.drag?.operatorMetrics?.liveStartupEntries || 0)} to ${Number(currentReport.drag?.operatorMetrics?.liveStartupEntries || 0)}.`
    );
  }
  if (
    Number(previousReport.drag?.operatorMetrics?.startupArtifactRepairEntries || 0) !==
    Number(currentReport.drag?.operatorMetrics?.startupArtifactRepairEntries || 0)
  ) {
    changes.push(
      `Startup artifact repairs changed from ${Number(previousReport.drag?.operatorMetrics?.startupArtifactRepairEntries || 0)} to ${Number(currentReport.drag?.operatorMetrics?.startupArtifactRepairEntries || 0)}.`
    );
  }
  const previousTop = String(previousReport.drag?.topSources?.[0]?.signature || "").trim();
  const currentTop = String(currentReport.drag?.topSources?.[0]?.signature || "").trim();
  if (previousTop !== currentTop) {
    changes.push(`Top drag source changed from \`${previousTop || "none"}\` to \`${currentTop || "none"}\`.`);
  }
  return changes.length > 0 ? changes.slice(0, 5) : ["No material doctor drift was detected since the last artifact."];
}

function runNodeScript(relativePath, extraArgs = [], { repoRoot = REPO_ROOT, env = process.env } = {}) {
  const absolutePath = resolve(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    return {
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: `Missing script: ${relativePath}`,
      json: null,
      command: `node ${relativePath}`,
    };
  }

  const timeoutMs = resolveChildScriptTimeoutMs(relativePath);
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [absolutePath, ...extraArgs], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 12,
    env,
    timeout: timeoutMs,
  });
  const durationMs = Date.now() - startedAt;
  const timedOut = result.error instanceof Error && result.error.code === "ETIMEDOUT";
  const errorMessage = result.error instanceof Error ? clean(result.error.message) : "";
  const stderrParts = [];
  const rawStderr = clean(result.stderr || "");
  if (rawStderr) stderrParts.push(rawStderr);
  if (timedOut) {
    stderrParts.push(`Timed out after ${timeoutMs}ms while running ${relativePath}.`);
  } else if (errorMessage && !stderrParts.includes(errorMessage)) {
    stderrParts.push(errorMessage);
  }
  const stdout = String(result.stdout || "");
  const stderr = stderrParts.join("\n");

  return {
    ok: result.status === 0 && !timedOut,
    exitCode: result.status ?? null,
    stdout,
    stderr,
    json: parseJsonOutput(stdout),
    command: `node ${relativePath} ${extraArgs.join(" ")}`.trim(),
    durationMs,
    timeoutMs,
    timedOut,
    signal: clean(result.signal),
    error: errorMessage,
  };
}

function createCheckCollector() {
  const checks = [];

  const push = (id, severity, ok, message, details = null) => {
    checks.push({
      id,
      severity,
      ok,
      status: ok ? "pass" : "fail",
      message,
      details,
    });
  };

  const summarize = () => {
    let errors = 0;
    let warnings = 0;
    let infos = 0;

    for (const check of checks) {
      if (check.ok) {
        infos += 1;
        continue;
      }
      if (check.severity === "error") errors += 1;
      if (check.severity === "warning") warnings += 1;
      if (check.severity === "info") infos += 1;
    }

    return {
      checks: checks.length,
      errors,
      warnings,
      infos,
    };
  };

  return {
    checks,
    push,
    summarize,
  };
}

function printSummary(report) {
  process.stdout.write("Codex doctor\n");
  process.stdout.write(`  status: ${report.status}\n`);
  process.stdout.write(`  strict mode: ${report.strict ? "on" : "off"}\n`);
  process.stdout.write(`  codex binary: ${report.codexCli.preferred?.path || "(unresolved)"}\n`);
  process.stdout.write(`  codex version: ${report.codexCli.preferred?.version || "unknown"}\n`);
  process.stdout.write(`  checks: ${report.summary.checks}\n`);
  process.stdout.write(`  errors: ${report.summary.errors}\n`);
  process.stdout.write(`  warnings: ${report.summary.warnings}\n`);
  process.stdout.write(`  artifact: ${report.artifactPath}\n`);
}

export async function runCodexDoctor({
  strict = false,
  artifact = DEFAULT_ARTIFACT,
  repoRoot = REPO_ROOT,
  env = process.env,
  codexCli = resolveCodexCliCandidates(repoRoot, env),
  packageMeta = readPackageMetadata(repoRoot),
  codexConfigPath = resolve(homedir(), ".codex", "config.toml"),
  runNodeScriptImpl = runNodeScript,
  loadCodexAutomationEnvFn = loadCodexAutomationEnv,
  hydrateStudioBrainAuthFromPortalFn = hydrateStudioBrainAuthFromPortal,
} = {}) {
  const artifactPath = resolve(repoRoot, artifact);
  const previousArtifact = readJsonFile(artifactPath);

  const checkCollector = createCheckCollector();

  loadCodexAutomationEnvFn({ repoRoot, env });
  const authHydration = await hydrateStudioBrainAuthFromPortalFn({ repoRoot, env }).catch(() => ({
    ok: false,
    hydrated: false,
    reason: "auth_hydration_failed",
    source: "codex-doctor",
    tokenFreshness: null,
  }));

  if (!codexCli.preferred?.path) {
    checkCollector.push(
      "codex-cli-resolution",
      "error",
      false,
      "No usable Codex CLI binary was found. Install dependencies with `npm ci` or add `codex` to PATH.",
      {
        candidates: codexCli.candidates,
      },
    );
  } else {
    checkCollector.push("codex-cli-resolution", "info", true, "Resolved Codex CLI binary.", {
      preferred: codexCli.preferred,
      candidates: codexCli.candidates,
    });
  }

  if (codexCli.hasVersionAmbiguity) {
    checkCollector.push(
      "codex-cli-ambiguity",
      "warning",
      false,
      `Multiple Codex CLI versions detected (${codexCli.versionSet.join(", ")}). Ensure PATH resolves to your intended global Codex binary.`,
      {
        preferred: codexCli.preferred,
        candidates: codexCli.candidates,
      },
    );
  } else {
    checkCollector.push("codex-cli-ambiguity", "info", true, "No Codex CLI version ambiguity detected in PATH.");
  }

  if (packageMeta.dependencyRange && codexCli.preferred?.version) {
    const compatible = rangeLikelyCompatible(packageMeta.dependencyRange, codexCli.preferred.version);
    checkCollector.push(
      "codex-package-range",
      compatible ? "info" : "warning",
      compatible,
      compatible
        ? "Resolved Codex CLI version is compatible with package.json dependency range."
        : `Resolved Codex CLI version (${codexCli.preferred.version}) may not match package.json range (${packageMeta.dependencyRange}).`,
      {
        dependencyRange: packageMeta.dependencyRange,
        resolvedVersion: codexCli.preferred.version,
      },
    );
  }

  if (packageMeta.lockVersion && codexCli.preferred?.version) {
    const matchesLock = compareSemver(packageMeta.lockVersion, codexCli.preferred.version) === 0;
    checkCollector.push(
      "codex-package-lock",
      matchesLock ? "info" : "warning",
      matchesLock,
      matchesLock
        ? "Resolved Codex CLI version matches package-lock pinned version."
        : `Resolved Codex CLI version (${codexCli.preferred.version}) differs from package-lock (${packageMeta.lockVersion}).`,
      {
        lockVersion: packageMeta.lockVersion,
        resolvedVersion: codexCli.preferred.version,
      },
    );
  }

  const codexAppDoctorRun = runNodeScriptImpl("scripts/codex-app-doctor.mjs", ["--json"], { repoRoot, env });
  const codexAppDoctorPayload = codexAppDoctorRun.json;
  if (!codexAppDoctorPayload) {
    checkCollector.push(
      "codex-app-doctor",
      "warning",
      false,
      codexAppDoctorRun.timedOut === true
        ? `Codex app doctor timed out after ${codexAppDoctorRun.timeoutMs}ms.`
        : "Unable to parse Codex app doctor output.",
      {
        ...buildScriptRunDetails(codexAppDoctorRun, { includeStdout: true, includeStderr: true }),
        command: codexAppDoctorRun.command,
      },
    );
  } else {
    checkCollector.push(
      "codex-app-doctor",
      "info",
      codexAppDoctorPayload.status !== "fail",
      codexAppDoctorPayload.status === "pass"
        ? "Codex app doctor passed."
        : codexAppDoctorPayload.status === "warn"
          ? "Codex app doctor reported advisory warnings."
          : "Codex app doctor reported blocking errors.",
      {
        ...buildScriptRunDetails(codexAppDoctorRun),
        command: codexAppDoctorRun.command,
        status: codexAppDoctorPayload.status,
        summary: codexAppDoctorPayload.summary,
        appVersion: codexAppDoctorPayload.app?.package?.version || null,
        cliVersion: codexAppDoctorPayload.codexCli?.preferred?.version || null,
        browserUseAvailable: codexAppDoctorPayload.capabilities?.browserUse?.available === true,
        studioBrainMemoryMcp: codexAppDoctorPayload.config?.hasStudioBrainMemory === true,
        artifactPath: codexAppDoctorPayload.artifactPath,
      },
    );
  }

  const docsDriftRun = runNodeScriptImpl("scripts/codex-docs-drift-check.mjs", ["--json"], { repoRoot, env });
  const docsDriftPayload = docsDriftRun.json;
  if (!docsDriftPayload) {
    checkCollector.push(
      "codex-docs-drift",
      "warning",
      false,
      "Unable to parse codex docs drift output. Inspect script output manually.",
      {
        ...buildScriptRunDetails(docsDriftRun, { includeStderr: true }),
        command: docsDriftRun.command,
        exitCode: docsDriftRun.exitCode,
        stderr: docsDriftRun.stderr,
      },
    );
  } else if (docsDriftPayload.summary?.errors > 0) {
    checkCollector.push("codex-docs-drift", "error", false, "Codex docs drift check reported hard errors.", {
      ...buildScriptRunDetails(docsDriftRun),
      command: docsDriftRun.command,
      status: docsDriftPayload.status,
      summary: docsDriftPayload.summary,
      artifactPath: docsDriftPayload.artifactPath,
    });
  } else if (docsDriftPayload.summary?.warnings > 0) {
    checkCollector.push("codex-docs-drift", "warning", false, "Codex docs drift check reported warnings.", {
      ...buildScriptRunDetails(docsDriftRun),
      command: docsDriftRun.command,
      status: docsDriftPayload.status,
      summary: docsDriftPayload.summary,
      artifactPath: docsDriftPayload.artifactPath,
    });
  } else {
    checkCollector.push("codex-docs-drift", "info", true, "Codex docs drift check passed.", {
      ...buildScriptRunDetails(docsDriftRun),
      command: docsDriftRun.command,
      status: docsDriftPayload.status,
      artifactPath: docsDriftPayload.artifactPath,
    });
  }

  if (!existsSync(codexConfigPath)) {
    checkCollector.push(
      "codex-mcp-audit",
      "warning",
      false,
      "~/.codex/config.toml not found; skipped MCP audit.",
      {
        configPath: codexConfigPath,
      },
    );
  } else {
    const mcpAuditRun = runNodeScriptImpl("scripts/audit-codex-mcp.mjs", [], { repoRoot, env });
    if (mcpAuditRun.ok) {
      checkCollector.push("codex-mcp-audit", "info", true, "Codex MCP audit passed.", {
        ...buildScriptRunDetails(mcpAuditRun, { includeStderr: true }),
        command: mcpAuditRun.command,
        configPath: codexConfigPath,
      });
    } else {
      checkCollector.push("codex-mcp-audit", "error", false, "Codex MCP audit failed.", {
        ...buildScriptRunDetails(mcpAuditRun, { includeStdout: true, includeStderr: true }),
        command: mcpAuditRun.command,
        exitCode: mcpAuditRun.exitCode,
        stdout: mcpAuditRun.stdout,
        stderr: mcpAuditRun.stderr,
        configPath: codexConfigPath,
      });
    }
  }

  const openMemoryAuthConfigured = Boolean(
    String(env.STUDIO_BRAIN_AUTH_TOKEN || env.STUDIO_BRAIN_ID_TOKEN || env.STUDIO_BRAIN_MCP_ID_TOKEN || "").trim(),
  );
  let openMemoryHealthy = false;
  if (!openMemoryAuthConfigured) {
    checkCollector.push(
      "codex-open-memory",
      "info",
      true,
      "Open Memory auth token not configured after auth hydration; skipping live memory stats check.",
      {
        authHydration,
        expectedEnvVars: ["STUDIO_BRAIN_AUTH_TOKEN", "STUDIO_BRAIN_ID_TOKEN"],
      },
    );
  } else {
    const openMemoryRun = runNodeScriptImpl("scripts/open-memory.mjs", ["stats"], { repoRoot, env });
    const openMemoryPayload = openMemoryRun.json;
    if (openMemoryRun.ok && openMemoryPayload?.stats) {
      openMemoryHealthy = true;
      checkCollector.push("codex-open-memory", "info", true, "Open Memory stats check passed.", {
        ...buildScriptRunDetails(openMemoryRun),
        command: openMemoryRun.command,
        total: openMemoryPayload.stats.total ?? null,
        bySource: Array.isArray(openMemoryPayload.stats.bySource) ? openMemoryPayload.stats.bySource.slice(0, 8) : [],
      });
    } else {
      checkCollector.push(
        "codex-open-memory",
        "warning",
        false,
        openMemoryRun.timedOut === true
          ? `Open Memory stats check timed out after ${openMemoryRun.timeoutMs}ms; falling back to local memory layout check.`
          : "Open Memory stats check failed; falling back to local memory layout check.",
        {
          authHydration,
          ...buildScriptRunDetails(openMemoryRun, { includeStdout: true, includeStderr: true }),
          command: openMemoryRun.command,
          exitCode: openMemoryRun.exitCode,
          stderr: openMemoryRun.stderr,
          stdout: openMemoryRun.stdout,
        },
      );
    }
  }

  const startupPreflightRun = runNodeScriptImpl(
    "scripts/codex-startup-preflight.mjs",
    ["--json", "--run-id", "codex-doctor"],
    { repoRoot, env }
  );
  const startupPreflightPayload = startupPreflightRun.json;
  if (!startupPreflightPayload) {
      checkCollector.push(
        "codex-startup-preflight",
        "warning",
        false,
        startupPreflightRun.timedOut === true
          ? `Codex startup preflight timed out after ${startupPreflightRun.timeoutMs}ms.`
          : "Unable to parse Codex startup preflight output.",
        {
          ...buildScriptRunDetails(startupPreflightRun, { includeStderr: true }),
          command: startupPreflightRun.command,
          exitCode: startupPreflightRun.exitCode,
          stderr: startupPreflightRun.stderr,
      },
    );
  } else {
    const startupReasonCode = startupPreflightPayload.checks?.startupContext?.reasonCode || "startup_unavailable";
    const startupLatencyState = startupPreflightPayload.checks?.startupContext?.latency?.state || "unknown";
    const tokenState = startupPreflightPayload.checks?.tokenFreshness?.state || "missing";
    const mcpBridgeOk = startupPreflightPayload.checks?.mcpBridge?.ok !== false;
    const startupContext =
      startupPreflightPayload.checks?.startupContext && typeof startupPreflightPayload.checks.startupContext === "object"
        ? startupPreflightPayload.checks.startupContext
        : {};
    const startupStage = clean(startupContext.startupContextStage || startupContext.startupPacket?.startupContextStage);
    const startupCache =
      startupContext.startupCache && typeof startupContext.startupCache === "object"
        ? startupContext.startupCache
        : startupContext.startupPacket?.startupCache && typeof startupContext.startupPacket.startupCache === "object"
          ? startupContext.startupPacket.startupCache
          : {};
    const trustMismatchDetected =
      startupContext.trustMismatchDetected === true || startupContext.startupPacket?.trustMismatchDetected === true;
    const groundingAuthority = clean(startupContext.groundingAuthority);
    const advisory =
      startupContext.advisory && typeof startupContext.advisory === "object" ? startupContext.advisory : {};
    const repoContext =
      startupPreflightPayload.checks?.repoContext && typeof startupPreflightPayload.checks.repoContext === "object"
        ? startupPreflightPayload.checks.repoContext
        : {};
    const repoStatus =
      repoContext.repoStatus && typeof repoContext.repoStatus === "object" ? repoContext.repoStatus : {};
    const startupGuidance =
      repoContext.startupGuidance && typeof repoContext.startupGuidance === "object"
        ? repoContext.startupGuidance
        : {};
    const advisoryLeakDetected =
      startupContext.publishTrustedGrounding !== true &&
      Boolean(
        clean(startupContext.dominantGoal || startupContext.topBlocker || startupContext.nextRecommendedAction)
      );
    const readyWithoutTrustedGrounding =
      clean(startupContext.continuityState).toLowerCase() === "ready" &&
      !isTrustedStartupGroundingAuthority(groundingAuthority);
    const preflightHealthy =
      startupPreflightPayload.status === "pass" &&
      !["missing_token", "expired_token", "transport_unreachable", "timeout"].includes(startupReasonCode) &&
      tokenState !== "expired" &&
      mcpBridgeOk;
    checkCollector.push(
      "codex-startup-preflight",
      preflightHealthy ? "info" : "warning",
      preflightHealthy,
      preflightHealthy
        ? "Codex startup preflight passed."
        : `Codex startup preflight requires attention (${startupReasonCode}, token=${tokenState}, latency=${startupLatencyState}).`,
      {
        ...buildScriptRunDetails(startupPreflightRun, { includeStderr: true }),
        command: startupPreflightRun.command,
        checks: startupPreflightPayload.checks,
      },
    );
    const fastPathHealthy =
      startupCache.shortCircuitLocal === true ||
      startupCache.cacheHit === true ||
      !/fallback/i.test(startupStage);
    const fastPathMessage =
      startupCache.shortCircuitLocal === true
        ? "Startup is using the validated-local fast path."
        : startupCache.cacheHit === true
          ? `Startup reused a fresh startup cache entry (${clean(startupCache.hitType) || "cache-hit"}).`
          : startupStage
            ? `Startup resolved via ${startupStage}.`
            : "Startup fast-path stage was not reported.";
    checkCollector.push(
      "codex-startup-fast-path",
      fastPathHealthy ? "info" : "warning",
      fastPathHealthy,
      fastPathMessage,
      {
        startupContextStage: startupStage,
        startupCache,
        groundingAuthority,
        continuityState: clean(startupContext.continuityState),
      },
    );
    const groundingTrustHealthy = !trustMismatchDetected && !advisoryLeakDetected && !readyWithoutTrustedGrounding;
    checkCollector.push(
      "codex-startup-grounding-trust",
      groundingTrustHealthy ? "info" : "warning",
      groundingTrustHealthy,
      groundingTrustHealthy
        ? "Startup grounding trust is aligned with the published goal/blocker fields."
        : readyWithoutTrustedGrounding
          ? `Startup reported ready continuity with untrusted grounding authority (${groundingAuthority || "unknown"}).`
          : advisoryLeakDetected
            ? "Startup is publishing goal/blocker fields from advisory-only context."
            : "Startup grounding trust signals are inconsistent.",
      {
        continuityState: clean(startupContext.continuityState),
        groundingAuthority,
        publishTrustedGrounding: startupContext.publishTrustedGrounding === true,
        trustMismatchDetected,
        advisoryLeakDetected,
        advisory,
      },
    );
    const repoTargetingHealthy = repoContext.targetedFollowupRecommended !== true && repoContext.laneMismatchDetected !== true;
    checkCollector.push(
      "codex-startup-repo-targeting",
      repoTargetingHealthy ? "info" : "warning",
      repoTargetingHealthy,
      repoTargetingHealthy
        ? "Startup context is already targeted to the current repo lane."
        : repoContext.laneMismatchDetected === true
          ? `Startup context lane (${clean(repoContext.startupPresentationLane) || "unknown"}) does not match repo lane (${clean(repoContext.repoProjectLane) || "unknown"}); run repo-targeted memory searches before broad repo reads.`
          : "Startup context still needs repo-targeted narrowing before broad repo reads.",
      {
        repoProjectLane: clean(repoContext.repoProjectLane),
        startupPresentationLane: clean(repoContext.startupPresentationLane),
        laneMismatchDetected: repoContext.laneMismatchDetected === true,
        targetedFollowupRecommended: repoContext.targetedFollowupRecommended === true,
        followupQueries: Array.isArray(repoContext.followupQueries) ? repoContext.followupQueries : [],
      },
    );
    const repoBranch = clean(repoStatus.branch);
    const repoWorktreeAdvisory =
      repoStatus.error
        ? false
        : repoStatus.dirty === true && repoStatus.detached !== true && /^codex\//i.test(repoBranch);
    const repoWorktreeHealthy = repoStatus.error ? false : repoStatus.dirty !== true || repoWorktreeAdvisory;
    checkCollector.push(
      "codex-repo-worktree",
      repoWorktreeHealthy ? "info" : "warning",
      repoWorktreeHealthy,
      repoWorktreeHealthy
        ? repoWorktreeAdvisory
          ? `Repo worktree has local changes on ${repoBranch || "unknown"} (${Number(repoStatus.dirtyCount || 0)} changed path(s)); advisory only for an active Codex branch.`
          : `Repo worktree is clean on ${repoBranch || "unknown"}.`
        : repoStatus.error
          ? `Unable to inspect repo worktree state (${repoStatus.error}).`
          : `Repo worktree is dirty on ${repoBranch || "unknown"} (${Number(repoStatus.dirtyCount || 0)} changed path(s)); fresh git status should override older cleanliness memories.`,
      {
        branch: repoBranch,
        detached: repoStatus.detached === true,
        dirty: repoStatus.dirty === true,
        dirtyCount: Number(repoStatus.dirtyCount || 0),
        error: clean(repoStatus.error),
        advisoryOnly: repoWorktreeAdvisory,
      },
    );
    const startupGuidanceHealthy = startupGuidance.aligned === true;
    checkCollector.push(
      "codex-startup-guidance-alignment",
      startupGuidanceHealthy ? "info" : "warning",
      startupGuidanceHealthy,
      startupGuidanceHealthy
        ? "Repo AGENTS startup guidance is aligned with memory-first startup and repo verification."
        : startupGuidance.mismatchDetected === true
          ? "Repo AGENTS still describes Studio Brain memory as optional without an explicit startup-first repo clause."
          : "Repo AGENTS startup guidance is incomplete; add explicit startup, narrowing, and git-status verification steps.",
      {
        agentsPath: clean(startupGuidance.agentsPath),
        hasAgentsFile: startupGuidance.hasAgentsFile === true,
        startupMemoryFirst: startupGuidance.startupMemoryFirst === true,
        optionalMemoryAdapter: startupGuidance.optionalMemoryAdapter === true,
        repoTruthGuard: startupGuidance.repoTruthGuard === true,
        targetedSearchGuidance: startupGuidance.targetedSearchGuidance === true,
        state: clean(startupGuidance.state),
      },
    );
  }

  const rememberHelperPath = resolve(repoRoot, "scripts", "lib", "studio-brain-memory-write.mjs");
  const studioBrainMcpServerPath = resolve(repoRoot, "studio-brain-mcp", "server.mjs");
  const rememberToolRegistered =
    existsSync(rememberHelperPath) &&
    existsSync(studioBrainMcpServerPath) &&
    readFileSync(studioBrainMcpServerPath, "utf8").includes('"studio_brain_remember"');
  checkCollector.push(
    "codex-studio-brain-remember-surface",
    rememberToolRegistered ? "info" : "warning",
    rememberToolRegistered,
    rememberToolRegistered
      ? "Studio Brain remember write surface is registered in the MCP server."
      : "Studio Brain remember write surface is not registered in the MCP server.",
    {
      mcpServerPath: studioBrainMcpServerPath,
      rememberHelperPath,
    },
  );

  const consolidateToolRegistered =
    existsSync(studioBrainMcpServerPath) &&
    readFileSync(studioBrainMcpServerPath, "utf8").includes('"studio_brain_memory_consolidate"');
  checkCollector.push(
    "codex-studio-brain-consolidate-surface",
    consolidateToolRegistered ? "info" : "warning",
    consolidateToolRegistered,
    consolidateToolRegistered
      ? "Studio Brain memory consolidation is registered in the MCP server and can execute on the host control plane."
      : "Studio Brain memory consolidation is not registered in the MCP server.",
    {
      mcpServerPath: studioBrainMcpServerPath,
    },
  );

  const toolcallWindow = readCurrentToolcallWindow(repoRoot);
  const retryGovernorSignals = summarizeRetryGovernorSignals(toolcallWindow.entries);
  const operatorDragMetrics = buildOperatorDragMetrics(toolcallWindow.entries);
  const topDragSources = summarizeToolcallDrag(toolcallWindow.entries, { limit: 3 });

  checkCollector.push(
    "codex-startup-live-coverage",
    operatorDragMetrics.liveStartupEntries >= 5 ? "info" : "warning",
    operatorDragMetrics.liveStartupEntries >= 1,
    operatorDragMetrics.liveStartupEntries >= 5
      ? `Deduped live startup coverage meets the minimum trust threshold (${operatorDragMetrics.liveStartupEntries} unique observation(s) from ${operatorDragMetrics.liveRawRows} raw row(s)).`
      : operatorDragMetrics.liveStartupEntries > 0
        ? `Deduped live startup coverage exists but is still thin (${operatorDragMetrics.liveStartupEntries}/5 unique observation(s) from ${operatorDragMetrics.liveRawRows} raw row(s)).`
        : "No live launcher startup coverage is present yet.",
    {
      liveStartupEntries: operatorDragMetrics.liveStartupEntries,
      syntheticStartupEntries: operatorDragMetrics.syntheticStartupEntries,
      liveRawRows: operatorDragMetrics.liveRawRows,
      syntheticRawRows: operatorDragMetrics.syntheticRawRows,
      liveUniqueObservations: operatorDragMetrics.liveUniqueObservations,
      syntheticUniqueObservations: operatorDragMetrics.syntheticUniqueObservations,
      duplicateObservationCount: operatorDragMetrics.duplicateObservationCount,
      windowHours: toolcallWindow.windowHours,
      toolcallsPath: toolcallWindow.toolcallPath,
    },
  );

  const duplicateObservationAdvisory =
    operatorDragMetrics.duplicateObservationCount > 0 && operatorDragMetrics.liveStartupEntries >= 5;
  checkCollector.push(
    "codex-startup-duplicate-observations",
    duplicateObservationAdvisory || operatorDragMetrics.duplicateObservationCount === 0 ? "info" : "warning",
    duplicateObservationAdvisory || operatorDragMetrics.duplicateObservationCount === 0,
    operatorDragMetrics.duplicateObservationCount > 0
      ? duplicateObservationAdvisory
        ? `Startup telemetry contains ${operatorDragMetrics.duplicateObservationCount} duplicate observation row(s), but deduped live coverage remains trustworthy.`
        : `Startup telemetry contains ${operatorDragMetrics.duplicateObservationCount} duplicate observation row(s); coverage is being deduped by observation identity.`
      : "Startup telemetry shows no duplicate observation rows in the current window.",
    {
      duplicateObservationCount: operatorDragMetrics.duplicateObservationCount,
      liveRawRows: operatorDragMetrics.liveRawRows,
      liveUniqueObservations: operatorDragMetrics.liveUniqueObservations,
      syntheticRawRows: operatorDragMetrics.syntheticRawRows,
      syntheticUniqueObservations: operatorDragMetrics.syntheticUniqueObservations,
      toolcallsPath: toolcallWindow.toolcallPath,
      advisoryOnly: duplicateObservationAdvisory,
    },
  );

  checkCollector.push(
    "codex-retry-governor",
    retryGovernorSignals.triggeredEntries > 0 ? "warning" : "info",
    retryGovernorSignals.triggeredEntries === 0,
    retryGovernorSignals.triggeredEntries > 0
      ? `Retry governor triggered on ${retryGovernorSignals.triggeredEntries} call(s) across ${retryGovernorSignals.triggeredUniqueSignatures} signature(s).`
      : "Retry governor shows no active bursts in the current window.",
    retryGovernorSignals,
  );

  checkCollector.push(
    "codex-command-shape-guard",
    operatorDragMetrics.repeatedCommandShapeFailures > 0 ? "warning" : "info",
    operatorDragMetrics.repeatedCommandShapeFailures === 0,
    operatorDragMetrics.repeatedCommandShapeFailures > 0
      ? `Command-shape failures are recurring (${operatorDragMetrics.repeatedCommandShapeFailures} in the current window).`
      : "No recurring Windows command-shape failures were detected in the current window.",
    operatorDragMetrics,
  );

  const memoryRun = runNodeScriptImpl("scripts/codex-memory-pipeline.mjs", ["status", "--json"], { repoRoot, env });
  const memoryPayload = memoryRun.json;
  if (!memoryPayload || !memoryPayload.memory) {
    checkCollector.push(
      "codex-memory-fallback-layout",
      openMemoryHealthy ? "info" : "warning",
      openMemoryHealthy,
      openMemoryHealthy
        ? "Local memory fallback status unavailable (Open Memory is healthy)."
        : "Unable to inspect local memory layout fallback. Run `npm run codex:memory:init` to initialize.",
      {
        ...buildScriptRunDetails(memoryRun),
        command: memoryRun.command,
        exitCode: memoryRun.exitCode,
      },
    );
  } else if (!memoryPayload.memory.layoutReady) {
    checkCollector.push(
      "codex-memory-fallback-layout",
      openMemoryHealthy ? "info" : "warning",
      openMemoryHealthy,
      openMemoryHealthy
        ? "Local memory fallback is not initialized (Open Memory is healthy)."
        : "Local memory workspace is not initialized. Run `npm run codex:memory:init`.",
      {
        memoryRoot: memoryPayload.memory.memoryRoot,
      },
    );
  } else {
    checkCollector.push("codex-memory-fallback-layout", "info", true, "Local memory fallback workspace is initialized.", {
      ...buildScriptRunDetails(memoryRun),
      memoryRoot: memoryPayload.memory.memoryRoot,
      proposedCount: memoryPayload.memory.proposedCount,
      acceptedCount: memoryPayload.memory.acceptedCount,
    });
  }

  const ephemeralGuardRun = runNodeScriptImpl("scripts/check-ephemeral-artifact-tracking.mjs", ["--json"], { repoRoot, env });
  const ephemeralPayload = ephemeralGuardRun.json;
  if (!ephemeralPayload) {
    checkCollector.push(
      "ephemeral-artifact-guard",
      "error",
      false,
      "Unable to parse ephemeral artifact guard output.",
      {
        ...buildScriptRunDetails(ephemeralGuardRun, { includeStderr: true }),
        command: ephemeralGuardRun.command,
        exitCode: ephemeralGuardRun.exitCode,
        stderr: ephemeralGuardRun.stderr,
      },
    );
  } else if (ephemeralPayload.status !== "pass") {
    checkCollector.push("ephemeral-artifact-guard", "error", false, "Ephemeral artifact guard found tracked disallowed paths.", {
      ...buildScriptRunDetails(ephemeralGuardRun),
      command: ephemeralGuardRun.command,
      summary: ephemeralPayload.summary,
      trackedPaths: ephemeralPayload.findings?.trackedPaths || [],
      stagedPaths: ephemeralPayload.findings?.stagedPaths || [],
      artifactPath: ephemeralPayload.artifactPath,
    });
  } else {
    checkCollector.push("ephemeral-artifact-guard", "info", true, "Ephemeral artifact guard passed.", {
      ...buildScriptRunDetails(ephemeralGuardRun),
      command: ephemeralGuardRun.command,
      artifactPath: ephemeralPayload.artifactPath,
    });
  }

  const wrapperAuditRun = runNodeScriptImpl("scripts/audit-cross-platform-wrappers.mjs", [], { repoRoot, env });
  const wrapperAuditPayload = wrapperAuditRun.json;
  if (!wrapperAuditPayload) {
    checkCollector.push(
      "codex-cross-platform-wrapper-audit",
      "warning",
      false,
      "Unable to parse cross-platform wrapper audit output.",
      {
        ...buildScriptRunDetails(wrapperAuditRun, { includeStderr: true }),
        command: wrapperAuditRun.command,
        exitCode: wrapperAuditRun.exitCode,
        stderr: wrapperAuditRun.stderr,
      },
    );
  } else if (wrapperAuditPayload.status !== "pass") {
    checkCollector.push(
      "codex-cross-platform-wrapper-audit",
      "error",
      false,
      "Cross-platform wrapper audit found unsafe spawn/path patterns in hot-path scripts.",
      {
        ...buildScriptRunDetails(wrapperAuditRun),
        command: wrapperAuditRun.command,
        findings: wrapperAuditPayload.findings,
      },
    );
  } else {
    checkCollector.push("codex-cross-platform-wrapper-audit", "info", true, "Cross-platform wrapper audit passed.", {
      ...buildScriptRunDetails(wrapperAuditRun),
      command: wrapperAuditRun.command,
      targetFiles: wrapperAuditPayload.targetFiles,
    });
  }

  const summary = checkCollector.summarize();
  let report = {
    schema: "codex-doctor-v1",
    generatedAt: new Date().toISOString(),
    strict,
    status: summary.errors > 0 || (strict && summary.warnings > 0) ? "fail" : "pass",
    artifactPath,
    codexCli,
    package: packageMeta,
    summary,
    checks: checkCollector.checks,
    startupContract:
      startupPreflightPayload?.checks?.startupContext && typeof startupPreflightPayload.checks.startupContext === "object"
        ? {
            status: startupPreflightPayload.status,
            reasonCode: startupPreflightPayload.checks.startupContext.reasonCode,
            continuityState: startupPreflightPayload.checks.startupContext.continuityState,
            recoveryStep: startupPreflightPayload.checks.startupContext.recoveryStep,
            presentationProjectLane: startupPreflightPayload.checks.startupContext.presentationProjectLane,
            threadScopedItemCount: startupPreflightPayload.checks.startupContext.threadScopedItemCount,
            transcriptOrderingProven: startupPreflightPayload.checks.startupContext.transcriptOrderingProven === true,
            degradationBuckets: startupPreflightPayload.checks.startupContext.degradationBuckets || [],
            missingStartupIngredients: startupPreflightPayload.checks.startupContext.missingStartupIngredients || [],
            dominantGoal: startupPreflightPayload.checks.startupContext.dominantGoal || "",
            topBlocker: startupPreflightPayload.checks.startupContext.topBlocker || "",
            nextRecommendedAction: startupPreflightPayload.checks.startupContext.nextRecommendedAction || "",
            startupContextStage: startupPreflightPayload.checks.startupContext.startupContextStage || "",
            startupCache:
              startupPreflightPayload.checks.startupContext.startupCache && typeof startupPreflightPayload.checks.startupContext.startupCache === "object"
                ? startupPreflightPayload.checks.startupContext.startupCache
                : {},
            groundingAuthority: startupPreflightPayload.checks.startupContext.groundingAuthority || "",
            trustMismatchDetected: startupPreflightPayload.checks.startupContext.trustMismatchDetected === true,
            localArtifactRepair: startupPreflightPayload.checks.startupContext.localArtifactRepair || null,
            repoContext:
              startupPreflightPayload.checks.repoContext && typeof startupPreflightPayload.checks.repoContext === "object"
                ? startupPreflightPayload.checks.repoContext
                : null,
          }
        : null,
    drag: {
      windowHours: toolcallWindow.windowHours,
      toolcallsPath: toolcallWindow.toolcallPath,
      operatorMetrics: operatorDragMetrics,
      retryGovernor: retryGovernorSignals,
      topSources: topDragSources,
    },
    remediation: {
      appDoctor: "npm run codex:app:doctor",
      docsDrift: "npm run codex:docs:drift",
      mcpAudit: "npm run audit:codex-mcp",
      openMemoryStats: "npm run open-memory -- stats",
      startupPreflight: "node ./scripts/codex-startup-preflight.mjs --json",
      memoryFallbackInit: "npm run codex:memory:init",
      wrapperAudit: "node ./scripts/audit-cross-platform-wrappers.mjs",
      commandShapeAudit: "node ./scripts/codex-command-shape-audit.mjs --command <command>",
      ephemeralGuard: "npm run guard:ephemeral:artifacts",
      recoveryRunbook: "docs/runbooks/CODEX_RECOVERY.md",
    },
  };
  report = {
    ...report,
    changedSinceLastRun: summarizeDoctorChanges(previousArtifact, report),
  };

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runCodexDoctor({
    strict: args.strict,
    artifact: args.artifact,
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printSummary(report);
  }

  if (report.status !== "pass") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    process.stderr.write(`codex-doctor failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
