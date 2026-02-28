#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compareSemver, resolveCodexCliCandidates } from "./lib/codex-cli-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const DEFAULT_TARGETS = [
  "scripts/codex-mcp.sh",
  "scripts/audit-codex-mcp.mjs",
  "docs/runbooks/MCP_OPERATIONS.md",
  "docs/SOURCE_OF_TRUTH_INDEX.md",
];

function parseArgs(rawArgs) {
  const parsed = {
    json: false,
    strict: false,
    artifact: "output/codex-docs-drift/latest.json",
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = String(rawArgs[index] || "");
    if (!arg) continue;
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }
    if (arg === "--artifact" && rawArgs[index + 1]) {
      parsed.artifact = String(rawArgs[index + 1]);
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

function createReport(strict, artifactPath, codexResolution) {
  const preferred = codexResolution.preferred || null;
  return {
    schema: "codex-docs-drift-v1",
    generatedAt: new Date().toISOString(),
    strict,
    artifactPath,
    installedCodexCliVersion: preferred?.version || null,
    installedCodexCliBinary: preferred?.path || null,
    detectedCodexCliVersions: codexResolution.versionSet,
    detectedCodexCliCandidates: codexResolution.candidates,
    status: "pass",
    findings: [],
    summary: {
      filesScanned: 0,
      errors: 0,
      warnings: 0,
      infos: 0,
    },
  };
}

function pushFinding(report, severity, type, message, details = null) {
  report.findings.push({
    severity,
    type,
    message,
    details,
  });
  if (severity === "error") report.summary.errors += 1;
  if (severity === "warning") report.summary.warnings += 1;
  if (severity === "info") report.summary.infos += 1;
}

function scanFile(report, filePath, installedVersion) {
  const absolute = resolve(REPO_ROOT, filePath);
  if (!existsSync(absolute)) {
    pushFinding(report, "warning", "missing-file", `Target file missing: ${filePath}`);
    return;
  }

  report.summary.filesScanned += 1;
  const content = readFileSync(absolute, "utf8");
  const lines = content.split(/\r?\n/);
  const versionPattern = /\b(?:codex-cli|Codex CLI)\s+v?(\d+\.\d+\.\d+)\b/g;

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber];
    const legacyModelTable = line.match(/^\s*\[\[?\s*(model_providers|models)(?:[.\]])/);
    if (legacyModelTable) {
      pushFinding(
        report,
        "error",
        "deprecated-model-config",
        `Deprecated model table syntax found in ${filePath}:${lineNumber + 1}.`,
        {
          file: filePath,
          line: lineNumber + 1,
          snippet: line.trim(),
        },
      );
    }

    let match;
    versionPattern.lastIndex = 0;
    while ((match = versionPattern.exec(line)) !== null) {
      const mentionedVersion = match[1];
      if (!installedVersion) {
        pushFinding(
          report,
          "info",
          "version-reference",
          `Found explicit Codex CLI version reference in ${filePath}:${lineNumber + 1} (${mentionedVersion}).`,
          {
            file: filePath,
            line: lineNumber + 1,
            mentionedVersion,
          },
        );
        continue;
      }

      const comparison = compareSemver(mentionedVersion, installedVersion);
      if (comparison < 0) {
        pushFinding(
          report,
          "warning",
          "stale-version-reference",
          `Codex CLI reference may be stale in ${filePath}:${lineNumber + 1} (${mentionedVersion} < ${installedVersion}).`,
          {
            file: filePath,
            line: lineNumber + 1,
            mentionedVersion,
            installedVersion,
          },
        );
      } else if (comparison > 0) {
        pushFinding(
          report,
          "warning",
          "future-version-reference",
          `Codex CLI reference is newer than installed version in ${filePath}:${lineNumber + 1} (${mentionedVersion} > ${installedVersion}).`,
          {
            file: filePath,
            line: lineNumber + 1,
            mentionedVersion,
            installedVersion,
          },
        );
      }
    }
  }
}

function printHumanSummary(report) {
  process.stdout.write("Codex docs drift check\n");
  process.stdout.write(`  installed codex-cli: ${report.installedCodexCliVersion || "unknown"}\n`);
  process.stdout.write(`  installed codex binary: ${report.installedCodexCliBinary || "unknown"}\n`);
  process.stdout.write(`  files scanned: ${report.summary.filesScanned}\n`);
  process.stdout.write(`  errors: ${report.summary.errors}\n`);
  process.stdout.write(`  warnings: ${report.summary.warnings}\n`);
  process.stdout.write(`  status: ${report.status}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifactPath = resolve(REPO_ROOT, args.artifact);
  const codexResolution = resolveCodexCliCandidates(REPO_ROOT);
  const installedVersion = codexResolution.preferred?.version || null;
  const report = createReport(args.strict, artifactPath, codexResolution);

  if (!installedVersion) {
    pushFinding(
      report,
      "warning",
      "codex-version-read",
      "Unable to read installed Codex CLI version from an available `codex` binary.",
      {
        candidatesChecked: codexResolution.candidates.map((candidate) => candidate.path),
      },
    );
  }

  if (codexResolution.hasVersionAmbiguity) {
    pushFinding(
      report,
      "warning",
      "codex-version-ambiguity",
      `Multiple Codex CLI versions detected in PATH (${codexResolution.versionSet.join(", ")}). Prefer repo-local node_modules/.bin/codex for deterministic harness behavior.`,
      {
        preferred: codexResolution.preferred,
        candidates: codexResolution.candidates,
      },
    );
  }

  for (const filePath of DEFAULT_TARGETS) {
    scanFile(report, filePath, installedVersion);
  }

  const hasErrors = report.summary.errors > 0;
  const hasWarnings = report.summary.warnings > 0;
  report.status = hasErrors || (args.strict && hasWarnings) ? "fail" : "pass";

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHumanSummary(report);
  }

  if (report.status !== "pass") {
    process.exitCode = 1;
  }
}

main();
