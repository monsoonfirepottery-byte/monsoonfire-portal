#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compareSemver, resolveCodexCliCandidates } from "./lib/codex-cli-utils.mjs";

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

function readPackageMetadata() {
  const packageJsonPath = resolve(REPO_ROOT, "package.json");
  const packageLockPath = resolve(REPO_ROOT, "package-lock.json");

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

function runNodeScript(relativePath, extraArgs = []) {
  const absolutePath = resolve(REPO_ROOT, relativePath);
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
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 12,
    env: process.env,
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifactPath = resolve(REPO_ROOT, args.artifact || DEFAULT_ARTIFACT);
  const codexConfigPath = resolve(homedir(), ".codex", "config.toml");

  const checkCollector = createCheckCollector();
  const codexCli = resolveCodexCliCandidates(REPO_ROOT);
  const packageMeta = readPackageMetadata();

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
      `Multiple Codex CLI versions detected (${codexCli.versionSet.join(", ")}). Prefer the repo-local binary for deterministic behavior.`,
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

  const docsDriftRun = runNodeScript("scripts/codex-docs-drift-check.mjs", ["--json"]);
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
    const mcpAuditRun = runNodeScript("scripts/audit-codex-mcp.mjs", []);
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

  const memoryRun = runNodeScript("scripts/codex-memory-pipeline.mjs", ["status", "--json"]);
  const memoryPayload = memoryRun.json;
  if (!memoryPayload || !memoryPayload.memory) {
    checkCollector.push(
      "codex-memory-layout",
      "warning",
      false,
      "Unable to inspect local memory layout. Run `npm run codex:memory:init` to initialize.",
      {
        command: memoryRun.command,
        exitCode: memoryRun.exitCode,
      },
    );
  } else if (!memoryPayload.memory.layoutReady) {
    checkCollector.push(
      "codex-memory-layout",
      "warning",
      false,
      "Local memory workspace is not initialized. Run `npm run codex:memory:init`.",
      {
        memoryRoot: memoryPayload.memory.memoryRoot,
      },
    );
  } else {
    checkCollector.push("codex-memory-layout", "info", true, "Local memory workspace is initialized.", {
      memoryRoot: memoryPayload.memory.memoryRoot,
      proposedCount: memoryPayload.memory.proposedCount,
      acceptedCount: memoryPayload.memory.acceptedCount,
    });
  }

  const ephemeralGuardRun = runNodeScript("scripts/check-ephemeral-artifact-tracking.mjs", ["--json"]);
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

  const summary = checkCollector.summarize();
  const report = {
    schema: "codex-doctor-v1",
    generatedAt: new Date().toISOString(),
    strict: args.strict,
    status: summary.errors > 0 || (args.strict && summary.warnings > 0) ? "fail" : "pass",
    artifactPath,
    codexCli,
    package: packageMeta,
    summary,
    checks: checkCollector.checks,
    remediation: {
      docsDrift: "npm run codex:docs:drift",
      mcpAudit: "npm run audit:codex-mcp",
      memoryInit: "npm run codex:memory:init",
      ephemeralGuard: "npm run guard:ephemeral:artifacts",
    },
  };

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printSummary(report);
  }

  if (report.status !== "pass") {
    process.exitCode = 1;
  }
}

main();
