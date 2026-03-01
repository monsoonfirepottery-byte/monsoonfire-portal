#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const DISALLOWED_PREFIXES = [
  "output/playwright/",
  "output/qa/",
  "output/maintenance/",
  "output/codex-docs-drift/",
  "output/codex-doctor/",
  "output/codex-memory/",
  "web/.lighthouseci/",
  ".tmp/",
];

function parseArgs(argv) {
  const parsed = {
    json: false,
    artifact: "output/qa/ephemeral-artifact-tracking-guard.json",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (!arg) continue;

    if (arg === "--json") {
      parsed.json = true;
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

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 8,
  });

  return {
    ok: result.status === 0,
    exitCode: result.status,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
  };
}

function parseNulDelimitedPaths(raw) {
  return String(raw || "")
    .split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifactPath = resolve(REPO_ROOT, args.artifact);

  const tracked = runGit(["ls-files", "-z", "--", ...DISALLOWED_PREFIXES]);
  const staged = runGit(["diff", "--cached", "--name-only", "-z", "--", ...DISALLOWED_PREFIXES]);

  const report = {
    schema: "ephemeral-artifact-tracking-guard-v1",
    generatedAt: new Date().toISOString(),
    status: "pass",
    artifactPath,
    disallowedPrefixes: DISALLOWED_PREFIXES,
    git: {
      trackedExitCode: tracked.exitCode,
      stagedExitCode: staged.exitCode,
      trackedStderr: tracked.stderr,
      stagedStderr: staged.stderr,
    },
    findings: {
      trackedPaths: [],
      stagedPaths: [],
    },
    summary: {
      trackedCount: 0,
      stagedCount: 0,
      errors: 0,
    },
  };

  if (!tracked.ok || !staged.ok) {
    report.status = "fail";
    report.summary.errors += 1;
  }

  if (tracked.ok) {
    report.findings.trackedPaths = parseNulDelimitedPaths(tracked.stdout);
    report.summary.trackedCount = report.findings.trackedPaths.length;
    if (report.summary.trackedCount > 0) {
      report.status = "fail";
      report.summary.errors += 1;
    }
  }

  if (staged.ok) {
    report.findings.stagedPaths = parseNulDelimitedPaths(staged.stdout);
    report.summary.stagedCount = report.findings.stagedPaths.length;
    if (report.summary.stagedCount > 0) {
      report.status = "fail";
      report.summary.errors += 1;
    }
  }

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write("Ephemeral artifact tracking guard\n");
    process.stdout.write(`  status: ${report.status}\n`);
    process.stdout.write(`  tracked disallowed paths: ${report.summary.trackedCount}\n`);
    process.stdout.write(`  staged disallowed paths: ${report.summary.stagedCount}\n`);
    process.stdout.write(`  artifact: ${artifactPath}\n`);
  }

  if (report.status !== "pass") {
    process.exitCode = 1;
  }
}

main();
