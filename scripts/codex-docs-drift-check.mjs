#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

function compareSemver(left, right) {
  const toParts = (value) => String(value || "").split(".").map((part) => Number(part));
  const a = toParts(left);
  const b = toParts(right);
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff === 0) continue;
    return diff > 0 ? 1 : -1;
  }
  return 0;
}

function parseVersionOutput(rawOutput) {
  const match = String(rawOutput || "").match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

function readInstalledCodexVersions() {
  const candidates = [];

  const readVersion = (label, pathOverride) => {
    try {
      const output = execSync("codex --version", {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: pathOverride ? { ...process.env, PATH: pathOverride } : process.env,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const version = parseVersionOutput(output);
      if (!version) return;
      if (candidates.some((entry) => entry.version === version && entry.source === label)) return;
      candidates.push({ source: label, version, raw: output });
    } catch {
      // ignored: not all execution contexts have both binaries resolvable
    }
  };

  readVersion("active-path", null);

  const sanitizedPath = String(process.env.PATH || "")
    .split(delimiter)
    .filter((segment) => !/[\\/]node_modules[\\/]\.bin/.test(segment))
    .join(delimiter);
  if (sanitizedPath && sanitizedPath !== String(process.env.PATH || "")) {
    readVersion("non-local-path", sanitizedPath);
  }

  return candidates;
}

function selectBestInstalledVersion(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const sorted = [...candidates].sort((left, right) => compareSemver(right.version, left.version));
  return sorted[0]?.version || null;
}

function readInstalledCodexVersion() {
  try {
    const candidates = readInstalledCodexVersions();
    return {
      selected: selectBestInstalledVersion(candidates),
      candidates,
    };
  } catch {
    return {
      selected: null,
      candidates: [],
    };
  }
}

function createReport(strict, artifactPath, versionResult) {
  return {
    schema: "codex-docs-drift-v1",
    generatedAt: new Date().toISOString(),
    strict,
    artifactPath,
    installedCodexCliVersion: versionResult.selected,
    detectedCodexCliVersions: versionResult.candidates,
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
  process.stdout.write(`  files scanned: ${report.summary.filesScanned}\n`);
  process.stdout.write(`  errors: ${report.summary.errors}\n`);
  process.stdout.write(`  warnings: ${report.summary.warnings}\n`);
  process.stdout.write(`  status: ${report.status}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifactPath = resolve(REPO_ROOT, args.artifact);
  const versionResult = readInstalledCodexVersion();
  const installedVersion = versionResult.selected;
  const report = createReport(args.strict, artifactPath, versionResult);

  if (!installedVersion) {
    pushFinding(
      report,
      "warning",
      "codex-version-read",
      "Unable to read installed Codex CLI version from `codex --version`.",
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
