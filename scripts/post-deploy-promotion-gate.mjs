#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_BASE_URL = "https://portal.monsoonfire.com";
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "post-deploy-promotion-gate.json");

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.PORTAL_PROMOTION_BASE_URL || DEFAULT_BASE_URL,
    reportPath: process.env.PORTAL_PROMOTION_GATE_REPORT || DEFAULT_REPORT_PATH,
    includeVirtualStaff: true,
    includeThemeSweep: true,
    includeIndexGuard: true,
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--base-url") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --base-url");
      options.baseUrl = String(next).trim().replace(/\/+$/, "");
      index += 1;
      continue;
    }

    if (arg === "--report") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --report");
      options.reportPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }

    if (arg === "--skip-virtual-staff") {
      options.includeVirtualStaff = false;
      continue;
    }

    if (arg === "--skip-theme-sweep") {
      options.includeThemeSweep = false;
      continue;
    }

    if (arg === "--skip-index-guard") {
      options.includeIndexGuard = false;
      continue;
    }

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
  }

  return options;
}

function truncate(value, max = 16000) {
  if (typeof value !== "string") return "";
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n...[truncated ${value.length - max} chars]`;
}

function runStep(label, command, args, env = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf8",
  });

  const durationMs = Date.now() - startedAt;
  const exitCode = typeof result.status === "number" ? result.status : 1;
  const status = exitCode === 0 ? "passed" : "failed";

  return {
    label,
    status,
    exitCode,
    durationMs,
    command: [command, ...args].join(" "),
    stdout: truncate(result.stdout || ""),
    stderr: truncate(result.stderr || ""),
  };
}

function printHuman(summary) {
  process.stdout.write(`status: ${summary.status}\n`);
  process.stdout.write(`baseUrl: ${summary.baseUrl}\n`);
  summary.steps.forEach((step) => {
    process.stdout.write(`- ${step.label}: ${step.status} (${step.durationMs}ms, exit=${step.exitCode})\n`);
  });
  process.stdout.write(`report: ${summary.reportPath}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAtIso = new Date().toISOString();
  const steps = [];

  const canaryArgs = [
    "./scripts/portal-authenticated-canary.mjs",
    "--base-url",
    options.baseUrl,
    "--output-dir",
    "output/qa/post-deploy-canary",
    "--report",
    "output/qa/post-deploy-authenticated-canary.json",
    "--json",
  ];
  if (!options.includeThemeSweep) {
    canaryArgs.push("--no-theme-sweep");
  }

  steps.push(runStep("authenticated portal canary", "node", canaryArgs));

  if (options.includeVirtualStaff) {
    steps.push(
      runStep("virtual staff backend regression", "node", [
        "./scripts/run-portal-virtual-staff-regression.mjs",
        "--project",
        "monsoonfire-portal",
        "--base-url",
        options.baseUrl,
        "--skip-ui-smoke",
        "--report",
        "output/qa/post-deploy-virtual-staff-regression.json",
        "--json",
      ])
    );
  }

  if (options.includeIndexGuard) {
    steps.push(
      runStep("firestore index contract guard", "node", [
        "./scripts/firestore-index-contract-guard.mjs",
        "--strict",
        "--json",
        "--no-github",
        "--report",
        "output/qa/post-deploy-index-guard.json",
      ])
    );
  }

  const failedSteps = steps.filter((step) => step.status === "failed");
  const summary = {
    status: failedSteps.length > 0 ? "failed" : "passed",
    baseUrl: options.baseUrl,
    startedAtIso,
    finishedAtIso: new Date().toISOString(),
    reportPath: options.reportPath,
    steps,
  };

  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    printHuman(summary);
  }

  if (summary.status !== "passed") {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`post-deploy-promotion-gate failed: ${message}`);
  process.exit(1);
});
