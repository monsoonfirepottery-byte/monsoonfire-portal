#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_BASE_URL = "https://monsoonfire-portal.web.app";
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "post-deploy-promotion-gate.json");

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.PORTAL_PROMOTION_BASE_URL || DEFAULT_BASE_URL,
    reportPath: process.env.PORTAL_PROMOTION_GATE_REPORT || DEFAULT_REPORT_PATH,
    softFailPermissionDenied:
      String(process.env.PORTAL_PROMOTION_SOFT_FAIL_PERMISSION_DENIED || "").toLowerCase() === "true",
    includeVirtualStaff: true,
    includeThemeSweep: true,
    includeIndexDeploy: true,
    includeIndexGuard: true,
    feedbackPath: String(process.env.PORTAL_PROMOTION_FEEDBACK_PATH || "").trim(),
    userOverrides: {
      includeVirtualStaff: false,
      includeThemeSweep: false,
      includeIndexDeploy: false,
      includeIndexGuard: false,
    },
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
      options.userOverrides.includeVirtualStaff = true;
      continue;
    }

    if (arg === "--skip-theme-sweep") {
      options.includeThemeSweep = false;
      options.userOverrides.includeThemeSweep = true;
      continue;
    }

    if (arg === "--skip-index-deploy") {
      options.includeIndexDeploy = false;
      options.userOverrides.includeIndexDeploy = true;
      continue;
    }

    if (arg === "--skip-index-guard") {
      options.includeIndexGuard = false;
      options.userOverrides.includeIndexGuard = true;
      continue;
    }

    if (arg === "--soft-fail-permission-denied") {
      options.softFailPermissionDenied = true;
      continue;
    }

    if (arg === "--feedback") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --feedback");
      options.feedbackPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
  }

  return options;
}

async function readJsonSafe(path) {
  if (!path) return null;
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function truncate(value, max = 16000) {
  if (typeof value !== "string") return "";
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n...[truncated ${value.length - max} chars]`;
}

function isPermissionDeniedFailure(stdout, stderr) {
  const output = `${String(stdout || "")}\n${String(stderr || "")}`;
  const hasPermissionSignal =
    /permission denied/i.test(output) ||
    /caller does not have permission/i.test(output) ||
    /PERMISSION_DENIED/i.test(output);
  const hasScopeSignal = /\b403\b/.test(output) || /firebaserules\.googleapis\.com/i.test(output);
  return hasPermissionSignal && hasScopeSignal;
}

function runStep(label, command, args, env = {}, behavior = {}) {
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
  const stdout = truncate(result.stdout || "");
  const stderr = truncate(result.stderr || "");
  const allowPermissionDenied = Boolean(behavior.allowPermissionDenied);
  const permissionDenied = isPermissionDeniedFailure(stdout, stderr);
  const status =
    exitCode === 0 ? "passed" : allowPermissionDenied && permissionDenied ? "degraded" : "failed";

  return {
    label,
    status,
    failureCategory: status === "degraded" ? "permission_denied" : "",
    exitCode,
    durationMs,
    command: [command, ...args].join(" "),
    stdout,
    stderr,
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
  const feedbackProfile = await readJsonSafe(options.feedbackPath);
  const startedAtIso = new Date().toISOString();
  const steps = [];

  if (feedbackProfile?.feedback && typeof feedbackProfile.feedback === "object") {
    if (!options.userOverrides.includeThemeSweep && typeof feedbackProfile.feedback.includeThemeSweep === "boolean") {
      options.includeThemeSweep = feedbackProfile.feedback.includeThemeSweep;
    }
    if (!options.userOverrides.includeVirtualStaff && typeof feedbackProfile.feedback.includeVirtualStaff === "boolean") {
      options.includeVirtualStaff = feedbackProfile.feedback.includeVirtualStaff;
    }
    if (!options.userOverrides.includeIndexDeploy && typeof feedbackProfile.feedback.includeIndexDeploy === "boolean") {
      options.includeIndexDeploy = feedbackProfile.feedback.includeIndexDeploy;
    }
    if (!options.userOverrides.includeIndexGuard && typeof feedbackProfile.feedback.includeIndexGuard === "boolean") {
      options.includeIndexGuard = feedbackProfile.feedback.includeIndexGuard;
    }
  }

  if (options.includeIndexDeploy) {
    steps.push(
      runStep("firestore indexes deploy", "node", [
        "./scripts/firestore-indexes-deploy.mjs",
        "--project",
        "monsoonfire-portal",
        "--report",
        "output/qa/post-deploy-index-deploy.json",
        "--json",
      ], {}, {
        allowPermissionDenied: options.softFailPermissionDenied,
      })
    );
  }

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
      ], {}, {
        allowPermissionDenied: options.softFailPermissionDenied,
      })
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
  const degradedSteps = steps.filter((step) => step.status === "degraded");
  const summary = {
    status: failedSteps.length > 0 ? "failed" : degradedSteps.length > 0 ? "passed_with_warnings" : "passed",
    baseUrl: options.baseUrl,
    startedAtIso,
    finishedAtIso: new Date().toISOString(),
    reportPath: options.reportPath,
    feedback: {
      enabled: Boolean(options.feedbackPath),
      loaded: Boolean(feedbackProfile),
      profilePath: options.feedbackPath || "",
      riskLevel: String(feedbackProfile?.feedback?.riskLevel || "unknown"),
      applied: {
        includeThemeSweep: options.includeThemeSweep,
        includeVirtualStaff: options.includeVirtualStaff,
        includeIndexDeploy: options.includeIndexDeploy,
        includeIndexGuard: options.includeIndexGuard,
        softFailPermissionDenied: options.softFailPermissionDenied,
      },
    },
    warnings: degradedSteps.map((step) => {
      if (step.failureCategory) {
        return `${step.label} degraded (${step.failureCategory})`;
      }
      return `${step.label} degraded`;
    }),
    steps,
  };

  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    printHuman(summary);
  }

  if (summary.status === "failed") {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`post-deploy-promotion-gate failed: ${message}`);
  process.exit(1);
});
