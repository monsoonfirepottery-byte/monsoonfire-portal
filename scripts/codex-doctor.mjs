#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compareSemver, resolveCodexCliCandidates } from "./lib/codex-cli-utils.mjs";
import { loadCodexAutomationEnv } from "./lib/codex-automation-env.mjs";
import { hydrateStudioBrainAuthFromPortal } from "./lib/studio-brain-startup-auth.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const DEFAULT_ARTIFACT = "output/codex-doctor/latest.json";

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

  const result = spawnSync(process.execPath, [absolutePath, ...extraArgs], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 12,
    env,
  });

  return {
    ok: result.status === 0,
    exitCode: result.status,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    json: parseJsonOutput(result.stdout),
    command: `node ${relativePath} ${extraArgs.join(" ")}`.trim(),
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

  const docsDriftRun = runNodeScriptImpl("scripts/codex-docs-drift-check.mjs", ["--json"], { repoRoot, env });
  const docsDriftPayload = docsDriftRun.json;
  if (!docsDriftPayload) {
    checkCollector.push(
      "codex-docs-drift",
      "warning",
      false,
      "Unable to parse codex docs drift output. Inspect script output manually.",
      {
        command: docsDriftRun.command,
        exitCode: docsDriftRun.exitCode,
        stderr: docsDriftRun.stderr,
      },
    );
  } else if (docsDriftPayload.summary?.errors > 0) {
    checkCollector.push("codex-docs-drift", "error", false, "Codex docs drift check reported hard errors.", {
      command: docsDriftRun.command,
      status: docsDriftPayload.status,
      summary: docsDriftPayload.summary,
      artifactPath: docsDriftPayload.artifactPath,
    });
  } else if (docsDriftPayload.summary?.warnings > 0) {
    checkCollector.push("codex-docs-drift", "warning", false, "Codex docs drift check reported warnings.", {
      command: docsDriftRun.command,
      status: docsDriftPayload.status,
      summary: docsDriftPayload.summary,
      artifactPath: docsDriftPayload.artifactPath,
    });
  } else {
    checkCollector.push("codex-docs-drift", "info", true, "Codex docs drift check passed.", {
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
        command: mcpAuditRun.command,
        configPath: codexConfigPath,
      });
    } else {
      checkCollector.push("codex-mcp-audit", "error", false, "Codex MCP audit failed.", {
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
        command: openMemoryRun.command,
        total: openMemoryPayload.stats.total ?? null,
        bySource: Array.isArray(openMemoryPayload.stats.bySource) ? openMemoryPayload.stats.bySource.slice(0, 8) : [],
      });
    } else {
      checkCollector.push(
        "codex-open-memory",
        "warning",
        false,
        "Open Memory stats check failed; falling back to local memory layout check.",
        {
          authHydration,
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
      "Unable to parse Codex startup preflight output.",
      {
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
        command: startupPreflightRun.command,
        checks: startupPreflightPayload.checks,
      },
    );
  }

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
        command: ephemeralGuardRun.command,
        exitCode: ephemeralGuardRun.exitCode,
        stderr: ephemeralGuardRun.stderr,
      },
    );
  } else if (ephemeralPayload.status !== "pass") {
    checkCollector.push("ephemeral-artifact-guard", "error", false, "Ephemeral artifact guard found tracked disallowed paths.", {
      command: ephemeralGuardRun.command,
      summary: ephemeralPayload.summary,
      trackedPaths: ephemeralPayload.findings?.trackedPaths || [],
      stagedPaths: ephemeralPayload.findings?.stagedPaths || [],
      artifactPath: ephemeralPayload.artifactPath,
    });
  } else {
    checkCollector.push("ephemeral-artifact-guard", "info", true, "Ephemeral artifact guard passed.", {
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
        command: wrapperAuditRun.command,
        findings: wrapperAuditPayload.findings,
      },
    );
  } else {
    checkCollector.push("codex-cross-platform-wrapper-audit", "info", true, "Cross-platform wrapper audit passed.", {
      command: wrapperAuditRun.command,
      targetFiles: wrapperAuditPayload.targetFiles,
    });
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

  const summary = checkCollector.summarize();
  const report = {
    schema: "codex-doctor-v1",
    generatedAt: new Date().toISOString(),
    strict,
    status: summary.errors > 0 || (strict && summary.warnings > 0) ? "fail" : "pass",
    artifactPath,
    codexCli,
    package: packageMeta,
    summary,
    checks: checkCollector.checks,
    remediation: {
      docsDrift: "npm run codex:docs:drift",
      mcpAudit: "npm run audit:codex-mcp",
      openMemoryStats: "npm run open-memory -- stats",
      startupPreflight: "node ./scripts/codex-startup-preflight.mjs --json",
      memoryFallbackInit: "npm run codex:memory:init",
      wrapperAudit: "node ./scripts/audit-cross-platform-wrappers.mjs",
      ephemeralGuard: "npm run guard:ephemeral:artifacts",
    },
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
