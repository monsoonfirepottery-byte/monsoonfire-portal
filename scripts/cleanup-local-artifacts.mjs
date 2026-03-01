#!/usr/bin/env node

import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_CONFIRMATION = "CLEAN LOCAL ARTIFACTS";

const DEFAULT_TARGETS = [
  { path: "output/playwright", reason: "Playwright screenshots, traces, and videos" },
  { path: "output/stability", reason: "Reliability heartbeat artifacts" },
  { path: "output/cutover-gate", reason: "Cutover gate run artifacts" },
  { path: "output/phased-smoke-gate", reason: "Phased smoke gate artifacts" },
  { path: "output/pr-gate", reason: "PR gate artifacts" },
  { path: "output/source-of-truth-contract-matrix", reason: "Source-of-truth contract matrix artifacts" },
  { path: "output/source-of-truth-deployment-gates", reason: "Source-of-truth deployment artifacts" },
  { path: "output/source-of-truth-index-audit", reason: "Source-of-truth index audit artifacts" },
  { path: "output/well-known", reason: "Well-known validation artifacts" },
  { path: "output/mobile-store-readiness", reason: "Store-readiness artifacts" },
  { path: "output/journey-tests", reason: "Journey contract test artifacts" },
  { path: "output/qa", reason: "Ad hoc QA artifacts" },
  { path: "web/.lighthouseci", reason: "Local Lighthouse cache" },
  { path: ".tmp", reason: "Temporary local scratch outputs" },
];

function parseArgs(rawArgs) {
  const parsed = {
    apply: false,
    confirm: "",
    json: false,
    artifact: "output/maintenance/local-artifact-cleanup-latest.json",
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = String(rawArgs[index] || "");
    if (!arg) continue;

    if (arg === "--apply") {
      parsed.apply = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--confirm" && rawArgs[index + 1]) {
      parsed.confirm = String(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--confirm=")) {
      parsed.confirm = arg.slice("--confirm=".length);
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

function ensureInsideRepo(absolutePath) {
  const rootWithSep = `${REPO_ROOT}${sep}`;
  if (absolutePath === REPO_ROOT || absolutePath.startsWith(rootWithSep)) {
    return;
  }
  throw new Error(`Refusing to operate outside repository root: ${absolutePath}`);
}

function walkPath(targetPath) {
  const stats = {
    exists: false,
    files: 0,
    directories: 0,
    bytes: 0,
  };

  if (!existsSync(targetPath)) {
    return stats;
  }

  const stack = [targetPath];
  stats.exists = true;
  while (stack.length > 0) {
    const current = stack.pop();
    const currentStat = lstatSync(current);
    if (currentStat.isDirectory()) {
      stats.directories += 1;
      const children = readdirSync(current);
      for (const child of children) {
        stack.push(resolve(current, child));
      }
      continue;
    }
    stats.files += 1;
    stats.bytes += currentStat.size;
  }

  return stats;
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.apply ? "apply" : "preview";
  const artifactPath = resolve(REPO_ROOT, args.artifact);
  ensureInsideRepo(artifactPath);

  if (args.apply && args.confirm.trim() !== DEFAULT_CONFIRMATION) {
    throw new Error(
      `Missing confirmation phrase. Re-run with --confirm "${DEFAULT_CONFIRMATION}" to apply deletions.`,
    );
  }

  const report = {
    schema: "local-artifact-cleanup-v1",
    generatedAt: new Date().toISOString(),
    mode,
    confirmationRequired: DEFAULT_CONFIRMATION,
    confirmationMatched: args.confirm.trim() === DEFAULT_CONFIRMATION,
    status: "pass",
    artifactPath,
    targets: [],
    summary: {
      targets: DEFAULT_TARGETS.length,
      existingTargets: 0,
      removedTargets: 0,
      bytesBefore: 0,
      bytesAfter: 0,
      bytesReclaimed: 0,
    },
  };

  for (const target of DEFAULT_TARGETS) {
    const absolute = resolve(REPO_ROOT, target.path);
    ensureInsideRepo(absolute);

    const before = walkPath(absolute);
    report.summary.bytesBefore += before.bytes;
    if (before.exists) {
      report.summary.existingTargets += 1;
    }

    let removed = false;
    let removeError = null;
    if (args.apply && before.exists) {
      try {
        rmSync(absolute, { recursive: true, force: true });
        removed = true;
        report.summary.removedTargets += 1;
      } catch (error) {
        removeError = error instanceof Error ? error.message : String(error);
        report.status = "fail";
      }
    }

    const after = walkPath(absolute);
    report.summary.bytesAfter += after.bytes;

    report.targets.push({
      path: target.path,
      reason: target.reason,
      absolute,
      existedBefore: before.exists,
      removed,
      removeError,
      bytesBefore: before.bytes,
      bytesAfter: after.bytes,
      filesBefore: before.files,
      filesAfter: after.files,
      directoriesBefore: before.directories,
      directoriesAfter: after.directories,
    });
  }

  report.summary.bytesReclaimed = Math.max(0, report.summary.bytesBefore - report.summary.bytesAfter);

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`Local artifact cleanup (${mode})\n`);
    process.stdout.write(`  existing targets: ${report.summary.existingTargets}/${report.summary.targets}\n`);
    process.stdout.write(`  removed targets: ${report.summary.removedTargets}\n`);
    process.stdout.write(`  bytes before: ${formatBytes(report.summary.bytesBefore)}\n`);
    process.stdout.write(`  bytes after: ${formatBytes(report.summary.bytesAfter)}\n`);
    process.stdout.write(`  bytes reclaimed: ${formatBytes(report.summary.bytesReclaimed)}\n`);
    process.stdout.write(`  artifact: ${artifactPath}\n`);
  }

  if (report.status !== "pass") {
    process.exitCode = 1;
  }
}

main();
