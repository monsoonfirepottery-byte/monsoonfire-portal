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

const DEFAULT_WORKFLOW_NAME = "Portal Post-Deploy Promotion Gate";
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "post-deploy-promotion-feedback.json");
const DEFAULT_ARTIFACT_PREFIX = "portal-post-deploy-promotion-gate-";
const DEFAULT_LIMIT = 12;

const STEP_KEYS = {
  canary: "authenticated portal canary",
  virtualStaff: "virtual staff backend regression",
  indexGuard: "firestore index contract guard",
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
      options.limit = Math.min(30, Math.round(value));
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

  const report = await readJsonSafe(resolve(runDir, "post-deploy-promotion-gate.json"));
  if (!report) {
    return {
      hasReport: false,
      report: null,
      downloadError: "post-deploy-promotion-gate.json missing or invalid",
    };
  }

  return { hasReport: true, report, downloadError: "" };
}

function findStep(report, label) {
  const steps = Array.isArray(report?.steps) ? report.steps : [];
  return steps.find((item) => String(item?.label || "") === label) || null;
}

function analyze(records) {
  const runsWithReports = records
    .filter((item) => item.hasReport && item.report)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const recent = runsWithReports.slice(-6);
  const stepStats = {};
  for (const [key, label] of Object.entries(STEP_KEYS)) {
    let failures = 0;
    let seen = 0;
    for (const run of recent) {
      const step = findStep(run.report, label);
      if (!step) continue;
      seen += 1;
      if (String(step.status || "") === "failed") failures += 1;
    }
    stepStats[key] = {
      label,
      seen,
      failures,
      failureRate: seen > 0 ? Number((failures / seen).toFixed(3)) : 0,
    };
  }

  let consecutivePasses = 0;
  for (let index = runsWithReports.length - 1; index >= 0; index -= 1) {
    const status = String(runsWithReports[index].report?.status || "");
    if (status === "passed") {
      consecutivePasses += 1;
      continue;
    }
    break;
  }

  const canaryFailures = stepStats.canary.failures;
  const overallFailures = recent.filter((run) => String(run.report?.status || "") !== "passed").length;
  const riskScore = canaryFailures * 2 + overallFailures;

  let riskLevel = "low";
  if (riskScore >= 4) riskLevel = "high";
  else if (riskScore >= 2) riskLevel = "elevated";

  const includeThemeSweep = !(consecutivePasses >= 4 && stepStats.canary.failures === 0 && riskLevel === "low");

  return {
    sourceRunCount: runsWithReports.length,
    recentRunCount: recent.length,
    consecutivePasses,
    riskLevel,
    riskScore,
    stepStats,
    feedback: {
      includeThemeSweep,
      includeVirtualStaff: true,
      includeIndexGuard: true,
      riskLevel,
      reasons: [
        includeThemeSweep
          ? "Theme sweep retained due recent risk signal or insufficient stable streak."
          : "Theme sweep can be skipped after stable streak with no recent canary failures.",
      ],
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
      recentRunCount: 0,
      consecutivePasses: 0,
      riskLevel: "low",
      riskScore: 0,
      stepStats: {},
    },
    feedback: {
      includeThemeSweep: true,
      includeVirtualStaff: true,
      includeIndexGuard: true,
      riskLevel: "low",
      reasons: [],
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
    report.notes.push("Could not query promotion gate run history via gh.");
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

    const scratchDir = await mkdtemp(resolve(tmpdir(), "promotion-feedback-"));
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
  report.signals.recentRunCount = analysis.recentRunCount;
  report.signals.consecutivePasses = analysis.consecutivePasses;
  report.signals.riskLevel = analysis.riskLevel;
  report.signals.riskScore = analysis.riskScore;
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

  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${report.status}\n`);
    process.stdout.write(`sourceRuns: ${String(report.sourceRunCount)}\n`);
    process.stdout.write(`riskLevel: ${report.feedback.riskLevel}\n`);
    process.stdout.write(`includeThemeSweep: ${String(report.feedback.includeThemeSweep)}\n`);
    process.stdout.write(`report: ${options.reportPath}\n`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`post-deploy-promotion-feedback-loop failed: ${message}`);
  process.exit(1);
});
