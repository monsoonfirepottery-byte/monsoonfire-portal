#!/usr/bin/env node

/* eslint-disable no-console */

import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_WORKFLOW_NAME = "Portal Production Smoke";
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "portal-prod-smoke-feedback.json");
const DEFAULT_ARTIFACT_NAME = "portal-playwright-prod-smoke";
const DEFAULT_LIMIT = 12;

function parseArgs(argv) {
  const options = {
    workflowName: DEFAULT_WORKFLOW_NAME,
    branch: String(process.env.GITHUB_REF_NAME || "main").trim(),
    runId: String(process.env.GITHUB_RUN_ID || "").trim(),
    artifactName: DEFAULT_ARTIFACT_NAME,
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
    if (arg === "--artifact-name") {
      options.artifactName = String(next).trim();
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

async function findFilesRecursive(rootPath, name) {
  const found = [];
  async function walk(current) {
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name === name) {
        found.push(fullPath);
      }
    }
  }
  await walk(rootPath);
  return found;
}

function pickPrimarySummaryPath(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return "";
  const nonDeep = paths.find((path) => !/\/deep\//i.test(path));
  return nonDeep || paths[0];
}

async function loadRunSummary(run, options, scratchDir) {
  const runId = String(run.databaseId || "").trim();
  const runDir = resolve(scratchDir, runId);
  await mkdir(runDir, { recursive: true });

  const download = runCommand(
    "gh",
    ["run", "download", runId, "-n", options.artifactName, "-D", runDir],
    { allowFailure: true }
  );
  if (!download.ok) {
    return {
      hasSummary: false,
      summary: null,
      summaryPath: "",
      downloadError: `artifact ${options.artifactName} unavailable`,
    };
  }

  const summaryFiles = await findFilesRecursive(runDir, "portal-smoke-summary.json");
  const primaryPath = pickPrimarySummaryPath(summaryFiles);
  const summary = await readJsonSafe(primaryPath);
  if (!summary) {
    return {
      hasSummary: false,
      summary: null,
      summaryPath: primaryPath,
      downloadError: "portal-smoke-summary.json missing or invalid",
    };
  }

  return {
    hasSummary: true,
    summary,
    summaryPath: primaryPath,
    downloadError: "",
  };
}

function getCheck(summary, label) {
  const checks = Array.isArray(summary?.checks) ? summary.checks : [];
  return checks.find((item) => String(item?.label || "") === label) || null;
}

function analyze(records) {
  const runsWithSummaries = records
    .filter((item) => item.hasSummary && item.summary)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const checkStats = new Map();
  const ensureStat = (label) => {
    if (!checkStats.has(label)) {
      checkStats.set(label, {
        label,
        failures: 0,
        transientRecoveries: 0,
        persistentFailures: 0,
      });
    }
    return checkStats.get(label);
  };

  for (let index = 0; index < runsWithSummaries.length; index += 1) {
    const run = runsWithSummaries[index];
    const checks = Array.isArray(run.summary?.checks) ? run.summary.checks : [];
    const failedChecks = checks.filter((item) => String(item?.status || "") === "failed");

    for (const failedCheck of failedChecks) {
      const label = String(failedCheck?.label || "").trim();
      if (!label) continue;

      const stat = ensureStat(label);
      stat.failures += 1;

      let recovered = false;
      for (let lookahead = 1; lookahead <= 2; lookahead += 1) {
        const nextRun = runsWithSummaries[index + lookahead];
        if (!nextRun) break;
        const nextCheck = getCheck(nextRun.summary, label);
        if (!nextCheck) continue;
        if (String(nextCheck.status || "") === "passed") recovered = true;
        break;
      }

      if (recovered) stat.transientRecoveries += 1;
      else stat.persistentFailures += 1;
    }
  }

  const defaultCheckRetryCount = 0;
  const checkRetries = {};
  for (const stat of checkStats.values()) {
    if (stat.transientRecoveries === 0) continue;
    if (stat.persistentFailures > stat.transientRecoveries) continue;
    const retryCount = stat.transientRecoveries >= 3 ? 2 : 1;
    checkRetries[stat.label] = retryCount;
  }

  const orderedStats = Array.from(checkStats.values()).sort((a, b) => {
    if (b.failures !== a.failures) return b.failures - a.failures;
    return b.transientRecoveries - a.transientRecoveries;
  });

  const latest = runsWithSummaries[runsWithSummaries.length - 1];
  const latestStatus = String(latest?.summary?.status || "unknown");

  return {
    sourceRunCount: runsWithSummaries.length,
    latestStatus,
    checkStats: orderedStats,
    feedback: {
      defaultCheckRetryCount,
      checkRetries,
      maxRetryCount: 2,
      retryCooldownMs: 350,
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
      latestStatus: "unknown",
      checkStats: [],
    },
    feedback: {
      defaultCheckRetryCount: 0,
      checkRetries: {},
      maxRetryCount: 2,
      retryCooldownMs: 350,
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
    report.notes.push("Could not query production smoke run history via gh.");
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

    const scratchDir = await mkdtemp(resolve(tmpdir(), "prod-smoke-feedback-"));
    try {
      for (const run of filteredRuns) {
        const loaded = await loadRunSummary(run, options, scratchDir);
        report.sourceRuns.push({
          databaseId: Number(run.databaseId || 0),
          conclusion: String(run.conclusion || ""),
          status: String(run.status || "").toLowerCase(),
          createdAt: String(run.createdAt || ""),
          url: String(run.url || ""),
          hasSummary: loaded.hasSummary,
          summaryPath: loaded.summaryPath,
          downloadError: loaded.downloadError,
          summary: loaded.summary,
        });
      }
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  }

  const analysis = analyze(report.sourceRuns);
  report.sourceRunCount = analysis.sourceRunCount;
  report.signals.latestStatus = analysis.latestStatus;
  report.signals.checkStats = analysis.checkStats;
  report.feedback = analysis.feedback;

  report.sourceRuns = report.sourceRuns.map((item) => ({
    databaseId: item.databaseId,
    conclusion: item.conclusion,
    status: item.status,
    createdAt: item.createdAt,
    url: item.url,
    hasSummary: item.hasSummary,
    summaryPath: item.summaryPath,
    downloadError: item.downloadError,
  }));

  if (Object.keys(report.feedback.checkRetries).length === 0) {
    report.notes.push("No flaky check pattern found for retry memory.");
  }

  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${report.status}\n`);
    process.stdout.write(`sourceRuns: ${String(report.sourceRunCount)}\n`);
    process.stdout.write(`retriableChecks: ${String(Object.keys(report.feedback.checkRetries).length)}\n`);
    process.stdout.write(`report: ${options.reportPath}\n`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`portal-prod-smoke-feedback-loop failed: ${message}`);
  process.exit(1);
});
