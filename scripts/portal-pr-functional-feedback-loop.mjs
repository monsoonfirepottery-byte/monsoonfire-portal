#!/usr/bin/env node

/* eslint-disable no-console */

import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_WORKFLOW_NAME = "Portal PR Functional Gate";
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "portal-pr-functional-feedback.json");
const DEFAULT_ARTIFACT_PREFIX = "portal-pr-functional-gate-";
const DEFAULT_LIMIT = 20;

const BASE_REMEDIATION = {
  "firestore emulator functional rules suite":
    "Run `npx firebase emulators:exec --config firebase.emulators.local.json --project monsoonfire-portal --only firestore \"node --test scripts/rules/myPieces.rules.test.mjs scripts/rules/notifications.rules.test.mjs scripts/rules/directMessages.rules.test.mjs scripts/rules/reservations.rules.test.mjs\"` locally and inspect first failing rule assertion.",
  "firestore index contract guard":
    "Run `node ./scripts/firestore-index-contract-guard.mjs --strict --json --no-github --report output/qa/firestore-index-contract-guard-pr.json` locally, then deploy missing indexes if required.",
};

function parseArgs(argv) {
  const options = {
    workflowName: DEFAULT_WORKFLOW_NAME,
    branch: String(process.env.GITHUB_REF_NAME || "main").trim(),
    runId: String(process.env.GITHUB_RUN_ID || "").trim(),
    artifactPrefix: DEFAULT_ARTIFACT_PREFIX,
    reportPath: DEFAULT_REPORT_PATH,
    limit: DEFAULT_LIMIT,
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--workflow-name") {
      options.workflowName = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--branch") {
      options.branch = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--run-id") {
      options.runId = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--artifact-prefix") {
      options.artifactPrefix = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--report") {
      options.reportPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 1) throw new Error("--limit must be >= 1");
      options.limit = Math.min(60, Math.round(value));
      index += 1;
      continue;
    }
  }

  return options;
}

function runCommand(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8" });
  const code = typeof result.status === "number" ? result.status : 1;
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  if (!allowFailure && code !== 0) {
    throw new Error(`Command failed (${code}): ${command} ${args.join(" ")}\n${stderr || stdout}`);
  }
  return { ok: code === 0, code, stdout, stderr };
}

async function readJsonSafe(path) {
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function loadRunReport(run, options, scratchDir) {
  const runId = String(run.databaseId || "").trim();
  const artifactName = `${options.artifactPrefix}${runId}`;
  const runDir = resolve(scratchDir, runId);
  await mkdir(runDir, { recursive: true });

  const download = runCommand(
    "gh",
    ["run", "download", runId, "-n", artifactName, "-D", runDir],
    { allowFailure: true }
  );
  if (!download.ok) {
    return {
      hasReport: false,
      report: null,
      downloadError: `artifact ${artifactName} unavailable`,
    };
  }

  const report = await readJsonSafe(resolve(runDir, "portal-pr-functional-gate.json"));
  if (!report) {
    return {
      hasReport: false,
      report: null,
      downloadError: "portal-pr-functional-gate.json missing or invalid",
    };
  }

  return { hasReport: true, report, downloadError: "" };
}

function analyze(records) {
  const runsWithReports = records
    .filter((item) => item.hasReport && item.report)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const stepStats = new Map();
  const ensure = (label) => {
    if (!stepStats.has(label)) {
      stepStats.set(label, {
        label,
        seen: 0,
        failures: 0,
      });
    }
    return stepStats.get(label);
  };

  for (const run of runsWithReports) {
    const steps = Array.isArray(run.report?.steps) ? run.report.steps : [];
    for (const step of steps) {
      const label = String(step?.label || "").trim();
      if (!label) continue;
      const stat = ensure(label);
      stat.seen += 1;
      if (String(step?.status || "") === "failed") {
        stat.failures += 1;
      }
    }
  }

  const stats = Array.from(stepStats.values()).map((item) => ({
    ...item,
    failureRate: item.seen > 0 ? Number((item.failures / item.seen).toFixed(3)) : 0,
  }));

  stats.sort((a, b) => {
    if (b.failures !== a.failures) return b.failures - a.failures;
    return b.failureRate - a.failureRate;
  });

  const remediation = { ...BASE_REMEDIATION };
  for (const stat of stats) {
    if (stat.failures === 0) continue;
    if (remediation[stat.label]) continue;
    remediation[stat.label] = `Investigate failing step "${stat.label}" in latest PR functional artifacts and add a deterministic local repro command.`;
  }

  const priorityFailures = stats.filter((item) => item.failures > 0).slice(0, 6);

  return {
    sourceRunCount: runsWithReports.length,
    stepStats: stats,
    feedback: {
      stepRemediation: remediation,
      priorityFailureSteps: priorityFailures.map((item) => item.label),
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = {
    status: "ok",
    generatedAtIso: new Date().toISOString(),
    workflowName: options.workflowName,
    branch: options.branch,
    sourceRunCount: 0,
    sourceRuns: [],
    signals: {
      stepStats: [],
    },
    feedback: {
      stepRemediation: BASE_REMEDIATION,
      priorityFailureSteps: [],
    },
    notes: [],
  };

  const runsResponse = runCommand(
    "gh",
    [
      "run",
      "list",
      "--workflow",
      options.workflowName,
      "--branch",
      options.branch,
      "--limit",
      String(options.limit),
      "--json",
      "databaseId,conclusion,url,createdAt,status",
    ],
    { allowFailure: true }
  );

  if (!runsResponse.ok) {
    report.status = "github_unavailable";
    report.notes.push("Could not query PR functional gate history via gh.");
  } else {
    let runs = [];
    try {
      const parsed = JSON.parse(runsResponse.stdout || "[]");
      runs = Array.isArray(parsed) ? parsed : [];
    } catch {
      runs = [];
      report.status = "parse_warning";
      report.notes.push("Could not parse gh run list JSON output.");
    }

    const filteredRuns = runs
      .filter((run) => String(run?.status || "").toLowerCase() === "completed")
      .filter((run) => {
        const runId = String(run?.databaseId || "").trim();
        if (!runId) return false;
        if (options.runId && runId === options.runId) return false;
        return true;
      });

    const scratchDir = await mkdtemp(resolve(tmpdir(), "pr-functional-feedback-"));
    try {
      for (const run of filteredRuns) {
        const loaded = await loadRunReport(run, options, scratchDir);
        report.sourceRuns.push({
          databaseId: Number(run.databaseId || 0),
          conclusion: String(run.conclusion || ""),
          status: String(run.status || "").toLowerCase(),
          createdAt: String(run.createdAt || ""),
          url: String(run.url || ""),
          hasReport: loaded.hasReport,
          downloadError: loaded.downloadError,
          report: loaded.report,
        });
      }
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  }

  const analysis = analyze(report.sourceRuns);
  report.sourceRunCount = analysis.sourceRunCount;
  report.signals.stepStats = analysis.stepStats;
  report.feedback = analysis.feedback;

  report.sourceRuns = report.sourceRuns.map((item) => ({
    databaseId: item.databaseId,
    conclusion: item.conclusion,
    status: item.status,
    createdAt: item.createdAt,
    url: item.url,
    hasReport: item.hasReport,
    downloadError: item.downloadError,
  }));

  if (report.feedback.priorityFailureSteps.length === 0) {
    report.notes.push("No repeated PR functional failures detected.");
  }

  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${report.status}\n`);
    process.stdout.write(`sourceRuns: ${String(report.sourceRunCount)}\n`);
    process.stdout.write(`priorityFailureSteps: ${report.feedback.priorityFailureSteps.join(" | ") || "none"}\n`);
    process.stdout.write(`report: ${options.reportPath}\n`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`portal-pr-functional-feedback-loop failed: ${message}`);
  process.exit(1);
});
