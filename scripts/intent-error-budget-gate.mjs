#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function parseArgs(argv) {
  const parsed = {
    json: false,
    strict: false,
    runReportPath: "output/intent/intent-run-report.json",
    ledgerPath: "output/intent/intent-run-ledger.jsonl",
    budgetPath: "config/intent-budget.json",
    historyPath: "output/intent/error-budget-history.json",
    artifact: "output/intent/error-budget-gate-report.json",
    runId: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (!arg) continue;
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }
    if (arg === "--run-report" && argv[index + 1]) {
      parsed.runReportPath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--run-report=")) {
      parsed.runReportPath = arg.slice("--run-report=".length).trim();
      continue;
    }
    if (arg === "--ledger" && argv[index + 1]) {
      parsed.ledgerPath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--ledger=")) {
      parsed.ledgerPath = arg.slice("--ledger=".length).trim();
      continue;
    }
    if (arg === "--budget" && argv[index + 1]) {
      parsed.budgetPath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--budget=")) {
      parsed.budgetPath = arg.slice("--budget=".length).trim();
      continue;
    }
    if (arg === "--history" && argv[index + 1]) {
      parsed.historyPath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--history=")) {
      parsed.historyPath = arg.slice("--history=".length).trim();
      continue;
    }
    if (arg === "--artifact" && argv[index + 1]) {
      parsed.artifact = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      parsed.artifact = arg.slice("--artifact=".length).trim();
      continue;
    }
    if (arg === "--run-id" && argv[index + 1]) {
      parsed.runId = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--run-id=")) {
      parsed.runId = arg.slice("--run-id=".length).trim();
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Intent error budget gate",
          "",
          "Usage:",
          "  node ./scripts/intent-error-budget-gate.mjs --json --run-report output/intent/intent-run-report.json",
        ].join("\n")
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function toIsoDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runReportAbsolutePath = resolve(REPO_ROOT, args.runReportPath);
  const ledgerAbsolutePath = resolve(REPO_ROOT, args.ledgerPath);
  const budgetAbsolutePath = resolve(REPO_ROOT, args.budgetPath);
  const historyAbsolutePath = resolve(REPO_ROOT, args.historyPath);
  const artifactAbsolutePath = resolve(REPO_ROOT, args.artifact);

  if (!existsSync(runReportAbsolutePath)) {
    throw new Error(`Run report file not found: ${runReportAbsolutePath}`);
  }
  if (!existsSync(budgetAbsolutePath)) {
    throw new Error(`Budget config file not found: ${budgetAbsolutePath}`);
  }

  const runReport = readJson(runReportAbsolutePath);
  const budgetConfig = readJson(budgetAbsolutePath);
  const history = existsSync(historyAbsolutePath)
    ? readJson(historyAbsolutePath)
    : { schema: "intent-error-budget-history.v1", generatedAt: null, entries: [] };

  const windowDays = Number(budgetConfig?.errorBudgetSlo?.windowDays || 7);
  const maxRunFailureRate = Number(budgetConfig?.errorBudgetSlo?.maxRunFailureRate || 0.25);
  const maxAbortRate = Number(budgetConfig?.errorBudgetSlo?.maxAbortRate || 0.1);
  const maxDriftEventsPer100Checks = Number(budgetConfig?.errorBudgetSlo?.maxDriftEventsPer100Checks || 8);

  const runId = args.runId || String(runReport?.runId || "");
  const runGeneratedAt = toIsoDate(runReport?.generatedAt) || new Date().toISOString();
  const runStatus = String(runReport?.status || "unknown");
  const failed = Number(runReport?.summary?.failed || 0);
  const blocked = Number(runReport?.summary?.blocked || 0);
  const totalChecks = (Array.isArray(runReport?.tasks) ? runReport.tasks : []).reduce(
    (sum, task) => sum + (Array.isArray(task?.checks) ? task.checks.length : 0),
    0
  );

  const ledgerRows = readJsonl(ledgerAbsolutePath).filter((row) => (runId ? row?.runId === runId : true));
  const driftEvents = ledgerRows.filter((row) => String(row?.eventType || "").includes("drift")).length;
  const abortEvents = ledgerRows.filter((row) => row?.eventType === "run_finished" && row?.status === "aborted").length;

  const entry = {
    runId: runId || null,
    generatedAt: runGeneratedAt,
    status: runStatus,
    failed,
    blocked,
    totalChecks,
    driftEvents,
    abortEvents,
  };

  const priorEntries = Array.isArray(history.entries) ? history.entries : [];
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const mergedEntries = [...priorEntries, entry]
    .map((row) => ({
      ...row,
      generatedAt: toIsoDate(row.generatedAt) || new Date().toISOString(),
    }))
    .filter((row) => Date.parse(row.generatedAt) >= cutoff);

  const runCount = mergedEntries.length;
  const failCount = mergedEntries.filter((row) => row.status !== "pass").length;
  const abortCount = mergedEntries.reduce((sum, row) => sum + Number(row.abortEvents || 0), 0);
  const totalChecksWindow = mergedEntries.reduce((sum, row) => sum + Number(row.totalChecks || 0), 0);
  const totalDriftEventsWindow = mergedEntries.reduce((sum, row) => sum + Number(row.driftEvents || 0), 0);

  const failureRate = runCount > 0 ? failCount / runCount : 0;
  const abortRate = runCount > 0 ? abortCount / runCount : 0;
  const driftEventsPer100Checks = totalChecksWindow > 0 ? (totalDriftEventsWindow / totalChecksWindow) * 100 : 0;

  const findings = [];
  if (failureRate > maxRunFailureRate) {
    findings.push({
      severity: "error",
      code: "failure_rate_budget_exceeded",
      message: `Failure rate ${failureRate.toFixed(3)} exceeded ${maxRunFailureRate.toFixed(3)}.`,
    });
  }
  if (abortRate > maxAbortRate) {
    findings.push({
      severity: "error",
      code: "abort_rate_budget_exceeded",
      message: `Abort rate ${abortRate.toFixed(3)} exceeded ${maxAbortRate.toFixed(3)}.`,
    });
  }
  if (driftEventsPer100Checks > maxDriftEventsPer100Checks) {
    findings.push({
      severity: "error",
      code: "drift_budget_exceeded",
      message: `Drift events/100 checks ${driftEventsPer100Checks.toFixed(3)} exceeded ${maxDriftEventsPer100Checks.toFixed(3)}.`,
    });
  }

  const status = findings.length === 0 ? "pass" : "fail";

  const updatedHistory = {
    schema: "intent-error-budget-history.v1",
    generatedAt: new Date().toISOString(),
    entries: mergedEntries,
    summary: {
      runCount,
      failureRate,
      abortRate,
      driftEventsPer100Checks,
      windowDays,
    },
  };

  mkdirSync(dirname(historyAbsolutePath), { recursive: true });
  writeFileSync(historyAbsolutePath, `${JSON.stringify(updatedHistory, null, 2)}\n`, "utf8");

  const report = {
    schema: "intent-error-budget-gate-report.v1",
    generatedAt: new Date().toISOString(),
    status,
    runId: runId || null,
    runReportPath: args.runReportPath,
    historyPath: args.historyPath,
    budgetPath: args.budgetPath,
    thresholds: {
      windowDays,
      maxRunFailureRate,
      maxAbortRate,
      maxDriftEventsPer100Checks,
    },
    metrics: {
      runCount,
      failureRate,
      abortRate,
      driftEventsPer100Checks,
    },
    findings,
  };

  mkdirSync(dirname(artifactAbsolutePath), { recursive: true });
  writeFileSync(artifactAbsolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`intent-error-budget-gate status: ${report.status}\n`);
    process.stdout.write(`report: ${artifactAbsolutePath}\n`);
  }

  if (status !== "pass") {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`intent-error-budget-gate failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
