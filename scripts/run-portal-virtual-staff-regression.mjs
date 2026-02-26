#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(__filename, "..", "..");

const DEFAULT_PROJECT_ID = "monsoonfire-portal";
const DEFAULT_BASE_URL = "https://portal.monsoonfire.com";
const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "portal-virtual-staff-regression.json");
const DEFAULT_SMOKE_OUTPUT_DIR = resolve(repoRoot, "output", "playwright", "portal", "virtual-staff");

function parseArgs(argv) {
  const options = {
    projectId: process.env.PORTAL_PROJECT_ID || DEFAULT_PROJECT_ID,
    baseUrl: process.env.PORTAL_REGRESSION_BASE_URL || DEFAULT_BASE_URL,
    functionsBaseUrl: process.env.PORTAL_FUNCTIONS_BASE_URL || DEFAULT_FUNCTIONS_BASE_URL,
    credentialsPath: process.env.PORTAL_AGENT_STAFF_CREDENTIALS || "",
    reportPath: process.env.PORTAL_REGRESSION_REPORT || DEFAULT_REPORT_PATH,
    smokeOutputDir: process.env.PORTAL_REGRESSION_SMOKE_OUTPUT_DIR || DEFAULT_SMOKE_OUTPUT_DIR,
    includeUiSmoke: true,
    deepSmoke: false,
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--project") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --project");
      options.projectId = String(next).trim();
      index += 1;
      continue;
    }

    if (arg === "--base-url") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --base-url");
      options.baseUrl = String(next).trim().replace(/\/+$/, "");
      index += 1;
      continue;
    }

    if (arg === "--functions-base-url") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --functions-base-url");
      options.functionsBaseUrl = String(next).trim().replace(/\/+$/, "");
      index += 1;
      continue;
    }

    if (arg === "--credentials") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --credentials");
      options.credentialsPath = resolve(process.cwd(), String(next).trim());
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

    if (arg === "--smoke-output-dir") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --smoke-output-dir");
      options.smokeOutputDir = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }

    if (arg === "--skip-ui-smoke") {
      options.includeUiSmoke = false;
      continue;
    }

    if (arg === "--deep-smoke") {
      options.deepSmoke = true;
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

function runNodeStep(label, scriptPath, args = [], env = {}) {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf8",
  });

  const durationMs = Date.now() - startedAt;
  const exitCode = typeof result.status === "number" ? result.status : 1;
  const passed = exitCode === 0;

  return {
    label,
    status: passed ? "passed" : "failed",
    exitCode,
    durationMs,
    command: [process.execPath, scriptPath, ...args].join(" "),
    stdout: truncate(result.stdout || ""),
    stderr: truncate(result.stderr || ""),
  };
}

async function writeCredentialsFromEnvIfNeeded(explicitPath) {
  if (explicitPath) {
    return { credentialsPath: explicitPath, cleanupDir: "" };
  }

  const rawJson = String(process.env.PORTAL_AGENT_STAFF_CREDENTIALS_JSON || "").trim();
  if (!rawJson) {
    return { credentialsPath: "", cleanupDir: "" };
  }

  const dir = await mkdtemp(resolve(tmpdir(), "portal-agent-staff-"));
  const credentialsPath = resolve(dir, "portal-agent-staff.json");
  await writeFile(credentialsPath, rawJson, "utf8");
  return { credentialsPath, cleanupDir: dir };
}

function printHumanSummary(summary) {
  process.stdout.write(`status: ${summary.status}\n`);
  process.stdout.write(`project: ${summary.projectId}\n`);
  process.stdout.write(`baseUrl: ${summary.baseUrl}\n`);
  summary.steps.forEach((step) => {
    process.stdout.write(
      `- ${step.label}: ${step.status} (${step.durationMs}ms, exit=${step.exitCode})\n`
    );
  });
  if (summary.notes.length > 0) {
    summary.notes.forEach((note) => process.stdout.write(`note: ${note}\n`));
  }
  process.stdout.write(`report: ${summary.reportPath}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAtIso = new Date().toISOString();
  const steps = [];
  const notes = [];

  const { credentialsPath, cleanupDir } = await writeCredentialsFromEnvIfNeeded(
    options.credentialsPath
  );

  try {
    steps.push(
      runNodeStep(
        "firestore release drift check",
        "./scripts/sync-firestore-rules-releases.mjs",
        ["--check", "--project", options.projectId, "--json"]
      )
    );

    steps.push(
      runNodeStep(
        "pricing + intake policy check",
        "./scripts/check-pricing-and-intake-policy.mjs"
      )
    );

    const authzArgs = [
      "--project",
      options.projectId,
      "--functions-base-url",
      options.functionsBaseUrl,
      "--json",
    ];
    if (credentialsPath) {
      authzArgs.push("--credentials", credentialsPath);
    }
    steps.push(
      runNodeStep(
        "my pieces authz probe",
        "./scripts/check-portal-mypieces-authz.mjs",
        authzArgs
      )
    );

    steps.push(
      runNodeStep(
        "notifications mark-read authz probe",
        "./scripts/check-portal-notifications-authz.mjs",
        authzArgs
      )
    );

    if (options.includeUiSmoke) {
      const smokeArgs = [
        "--base-url",
        options.baseUrl,
        "--output-dir",
        options.smokeOutputDir,
      ];
      if (options.deepSmoke) {
        smokeArgs.push("--deep");
      }

      const staffEmail = String(process.env.PORTAL_STAFF_EMAIL || "").trim();
      const staffPassword = String(process.env.PORTAL_STAFF_PASSWORD || "").trim();
      if (staffEmail && staffPassword) {
        smokeArgs.push("--with-auth", "--staff-email", staffEmail, "--staff-password", staffPassword);
      } else {
        notes.push(
          "UI smoke ran without authenticated staff login because PORTAL_STAFF_EMAIL/PORTAL_STAFF_PASSWORD were not set."
        );
      }

      steps.push(
        runNodeStep(
          options.deepSmoke ? "portal playwright smoke (deep)" : "portal playwright smoke",
          "./scripts/portal-playwright-smoke.mjs",
          smokeArgs
        )
      );
    } else {
      notes.push("UI smoke step skipped (--skip-ui-smoke).");
    }
  } finally {
    if (cleanupDir) {
      await rm(cleanupDir, { recursive: true, force: true });
    }
  }

  const failedSteps = steps.filter((step) => step.status === "failed");
  const status = failedSteps.length > 0 ? "failed" : "passed";
  const finishedAtIso = new Date().toISOString();
  const summary = {
    status,
    projectId: options.projectId,
    baseUrl: options.baseUrl,
    functionsBaseUrl: options.functionsBaseUrl,
    startedAtIso,
    finishedAtIso,
    reportPath: options.reportPath,
    notes,
    steps,
  };

  const reportDir = dirname(options.reportPath);
  await mkdir(reportDir, { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    printHumanSummary(summary);
  }

  if (status !== "passed") {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`run-portal-virtual-staff-regression failed: ${message}`);
  process.exit(1);
});
