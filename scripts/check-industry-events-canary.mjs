#!/usr/bin/env node

/* eslint-disable no-console */

import { spawnSync } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");
const defaultArtifactPath = resolve(repoRoot, "output", "qa", "industry-events-canary.json");

function parseArgs(argv) {
  const options = {
    strict: false,
    asJson: false,
    artifactPath: defaultArtifactPath,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }

    if (arg.startsWith("--artifact=")) {
      options.artifactPath = resolve(repoRoot, String(arg.slice("--artifact=".length)).trim());
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${arg}`);

    if (arg === "--artifact") {
      options.artifactPath = resolve(repoRoot, String(next).trim());
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const exitCode = typeof result.status === "number" ? result.status : 1;
  return {
    exitCode,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
  };
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(String(text || "").trim());
  } catch {
    return null;
  }
}

function truncate(text, max = 1400) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function checkResult(checks, id, label, pass, detail) {
  checks.push({
    id,
    label,
    status: pass ? "pass" : "fail",
    detail: detail || null,
  });
}

async function pathExists(pathValue) {
  try {
    await access(pathValue);
    return true;
  } catch {
    return false;
  }
}

function resolveMaybePath(pathValue) {
  if (!pathValue || typeof pathValue !== "string") return null;
  if (isAbsolute(pathValue)) return pathValue;
  return resolve(repoRoot, pathValue);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const importRun = runCommand("node", [
    "./functions/scripts/import-industry-events.mjs",
    "--source",
    "fixture",
    "--dry-run",
    "--json",
  ]);
  const auditRun = runCommand("node", [
    "./functions/scripts/audit-industry-events-freshness.mjs",
    "--source",
    "fixture",
    "--json",
  ]);

  const importReport = parseJsonSafe(importRun.stdout);
  const auditReport = parseJsonSafe(auditRun.stdout);
  const checks = [];

  checkResult(
    checks,
    "import-command",
    "Import script exits cleanly",
    importRun.exitCode === 0,
    importRun.exitCode === 0 ? null : truncate(importRun.stderr || importRun.stdout)
  );
  checkResult(
    checks,
    "audit-command",
    "Freshness audit exits cleanly",
    auditRun.exitCode === 0,
    auditRun.exitCode === 0 ? null : truncate(auditRun.stderr || auditRun.stdout)
  );

  const accepted = Number(importReport?.accepted ?? 0);
  const triageDraftCount = Number(importReport?.triageDraftCount ?? 0);
  checkResult(
    checks,
    "triage-draft",
    "Connector rows remain in draft/triage state",
    accepted > 0 && accepted === triageDraftCount,
    `accepted=${accepted}, triageDraftCount=${triageDraftCount}`
  );

  const duplicateBySourceUrl = Number(importReport?.duplicateReasons?.sourceUrl ?? 0);
  checkResult(
    checks,
    "dedupe-source-url",
    "Duplicate suppression by sourceUrl",
    duplicateBySourceUrl > 0,
    `sourceUrl duplicates suppressed=${duplicateBySourceUrl}`
  );

  const duplicateByTitleDateHash = Number(importReport?.duplicateReasons?.titleDateHash ?? 0);
  checkResult(
    checks,
    "dedupe-title-date",
    "Duplicate suppression by normalized title/date hash",
    duplicateByTitleDateHash > 0,
    `titleDateHash duplicates suppressed=${duplicateByTitleDateHash}`
  );

  const staleReviewCount = Number(auditReport?.stateCounts?.staleReview ?? 0);
  const retiredCount = Number(auditReport?.stateCounts?.retired ?? 0);
  checkResult(
    checks,
    "freshness-policy",
    "Freshness SLA flags stale/retired events",
    staleReviewCount + retiredCount > 0,
    `staleReview=${staleReviewCount}, retired=${retiredCount}`
  );

  const importArtifactPath = resolveMaybePath(importReport?.artifactPath);
  const auditArtifactPath = resolveMaybePath(auditReport?.artifactPath);
  const importArtifactExists = importArtifactPath ? await pathExists(importArtifactPath) : false;
  const auditArtifactExists = auditArtifactPath ? await pathExists(auditArtifactPath) : false;
  checkResult(
    checks,
    "artifacts",
    "Failure/report artifacts are emitted",
    importArtifactExists && auditArtifactExists,
    `importArtifact=${importArtifactPath || "n/a"} (${importArtifactExists ? "present" : "missing"}), auditArtifact=${auditArtifactPath || "n/a"} (${auditArtifactExists ? "present" : "missing"})`
  );

  const passed = checks.every((check) => check.status === "pass");
  const report = {
    status: passed ? "pass" : "fail",
    generatedAt: new Date().toISOString(),
    checks,
    import: {
      exitCode: importRun.exitCode,
      report: importReport,
      stderr: truncate(importRun.stderr),
    },
    audit: {
      exitCode: auditRun.exitCode,
      report: auditReport,
      stderr: truncate(auditRun.stderr),
    },
  };

  await mkdir(dirname(options.artifactPath), { recursive: true });
  await writeFile(options.artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const lines = [
      `industry-events-canary: ${report.status}`,
      ...checks.map((check) => `- [${check.status}] ${check.label}${check.detail ? ` (${check.detail})` : ""}`),
      `artifact: ${options.artifactPath.startsWith(`${repoRoot}/`) ? options.artifactPath.slice(repoRoot.length + 1) : options.artifactPath}`,
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
  }

  if (options.strict && !passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`check-industry-events-canary failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
