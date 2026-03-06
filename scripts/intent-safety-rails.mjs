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
    mode: "postflight",
    planPath: "artifacts/intent-plan.generated.json",
    runReportPath: "output/intent/intent-run-report.json",
    ledgerPath: "output/intent/intent-run-ledger.jsonl",
    configPath: "config/intent-safety-rails.json",
    artifact: "output/intent/safety-rails-report.json",
    snapshotPath: "output/intent/rathole-snapshot.json",
    infraPhase: String(process.env.INTENT_INFRA_PHASE || "normal").toLowerCase(),
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
    if ((arg === "--mode" || arg === "--phase") && argv[index + 1]) {
      parsed.mode = String(argv[index + 1]).trim().toLowerCase();
      index += 1;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      parsed.mode = arg.slice("--mode=".length).trim().toLowerCase();
      continue;
    }
    if (arg === "--plan" && argv[index + 1]) {
      parsed.planPath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--plan=")) {
      parsed.planPath = arg.slice("--plan=".length).trim();
      continue;
    }
    if ((arg === "--run-report" || arg === "--report-input") && argv[index + 1]) {
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
    if (arg === "--config" && argv[index + 1]) {
      parsed.configPath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--config=")) {
      parsed.configPath = arg.slice("--config=".length).trim();
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
    if (arg === "--snapshot" && argv[index + 1]) {
      parsed.snapshotPath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--snapshot=")) {
      parsed.snapshotPath = arg.slice("--snapshot=".length).trim();
      continue;
    }
    if (arg === "--infra-phase" && argv[index + 1]) {
      parsed.infraPhase = String(argv[index + 1]).trim().toLowerCase();
      index += 1;
      continue;
    }
    if (arg.startsWith("--infra-phase=")) {
      parsed.infraPhase = arg.slice("--infra-phase=".length).trim().toLowerCase();
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
          "Intent safety rails",
          "",
          "Usage:",
          "  node ./scripts/intent-safety-rails.mjs --mode postflight --json",
          "",
          "Modes:",
          "  preflight   Validate static rails before execution",
          "  postflight  Detect drift/rathole signatures from run artifacts",
        ].join("\n")
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!["preflight", "postflight"].includes(parsed.mode)) {
    throw new Error("--mode must be preflight or postflight.");
  }
  if (!["normal", "ingestion"].includes(parsed.infraPhase)) {
    throw new Error("--infra-phase must be normal or ingestion.");
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

function withInfraOverrides(base, config, infraPhase) {
  if (infraPhase !== "ingestion") return base;
  const override = config?.infraPhaseOverrides?.ingestion || {};
  return {
    ...base,
    maxRepeatedErrorSignature: Number(override.maxRepeatedErrorSignature || base.maxRepeatedErrorSignature),
    maxRepeatedErrorWindowSteps: Number(override.maxRepeatedErrorWindowSteps || base.maxRepeatedErrorWindowSteps),
  };
}

function ensureNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildSnapshot({ args, runReport, repeatedErrors, findings, rails }) {
  const topRepeatedErrors = repeatedErrors
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((row) => ({
      signature: row.signature,
      count: row.count,
      taskIds: row.taskIds,
    }));

  return {
    schema: "intent-rathole-snapshot.v1",
    generatedAt: new Date().toISOString(),
    runId: args.runId || runReport?.runId || null,
    infraPhase: args.infraPhase,
    activeCriterion: null,
    summary: {
      status: runReport?.status || null,
      totalTasks: Number(runReport?.summary?.total || 0),
      failedTasks: Number(runReport?.summary?.failed || 0),
      blockedTasks: Number(runReport?.summary?.blocked || 0),
      retriesUsed: Number(runReport?.summary?.retriesUsed || 0),
    },
    rails,
    findings,
    repeatedErrors: topRepeatedErrors,
    recommendedActions: [
      "Recompile next 1-3 steps with verification-first ordering.",
      "Reduce mutation scope and force dry-run for destructive classes.",
      "Escalate when repeated signature threshold remains breached after one autonomous replan."
    ],
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const planAbsolutePath = resolve(REPO_ROOT, args.planPath);
  const runReportAbsolutePath = resolve(REPO_ROOT, args.runReportPath);
  const ledgerAbsolutePath = resolve(REPO_ROOT, args.ledgerPath);
  const configAbsolutePath = resolve(REPO_ROOT, args.configPath);
  const artifactAbsolutePath = resolve(REPO_ROOT, args.artifact);
  const snapshotAbsolutePath = resolve(REPO_ROOT, args.snapshotPath);

  if (!existsSync(configAbsolutePath)) {
    throw new Error(`Safety rails config not found: ${configAbsolutePath}`);
  }
  const config = readJson(configAbsolutePath);
  const baseRails = {
    maxRepeatedErrorSignature: ensureNumber(config?.defaults?.maxRepeatedErrorSignature, 3),
    maxRepeatedErrorWindowSteps: ensureNumber(config?.defaults?.maxRepeatedErrorWindowSteps, 8),
    maxPlanChurnInWindow: ensureNumber(config?.defaults?.maxPlanChurnInWindow, 3),
    planChurnWindowMinutes: ensureNumber(config?.defaults?.planChurnWindowMinutes, 15),
    maxNoProgressChecks: ensureNumber(config?.defaults?.maxNoProgressChecks, 6),
    maxNoEvidenceCycles: ensureNumber(config?.defaults?.maxNoEvidenceCycles, 3),
  };
  const rails = withInfraOverrides(baseRails, config, args.infraPhase);

  const findings = [];
  const warnings = [];
  let runReport = null;
  const repeatedErrors = [];
  let snapshot = null;

  if (!existsSync(planAbsolutePath)) {
    findings.push({
      severity: "error",
      code: "missing_plan",
      message: `Plan file not found: ${args.planPath}`,
    });
  }

  if (args.mode === "postflight") {
    if (!existsSync(runReportAbsolutePath)) {
      findings.push({
        severity: "error",
        code: "missing_run_report",
        message: `Run report not found: ${args.runReportPath}`,
      });
    } else {
      runReport = readJson(runReportAbsolutePath);
      const tasks = Array.isArray(runReport.tasks) ? runReport.tasks : [];
      const signatureMap = new Map();
      for (const task of tasks) {
        const taskId = String(task?.taskId || "");
        for (const check of Array.isArray(task?.checks) ? task.checks : []) {
          if (!check || check.ok === true) continue;
          const signature = `${String(check?.classification || "unknown")}::${String(check?.command || "").trim()}`;
          const prior = signatureMap.get(signature) || { count: 0, taskIds: new Set() };
          prior.count += 1;
          if (taskId) prior.taskIds.add(taskId);
          signatureMap.set(signature, prior);
        }
      }
      for (const [signature, row] of signatureMap.entries()) {
        repeatedErrors.push({
          signature,
          count: row.count,
          taskIds: Array.from(row.taskIds).sort(),
        });
      }

      const repeatedHotspots = repeatedErrors.filter((row) => row.count >= rails.maxRepeatedErrorSignature);
      for (const hotspot of repeatedHotspots) {
        findings.push({
          severity: "error",
          code: "repeated_error_signature",
          message: `Repeated error signature threshold exceeded (${hotspot.count} >= ${rails.maxRepeatedErrorSignature}).`,
          signature: hotspot.signature,
          taskIds: hotspot.taskIds,
        });
      }

      const successfulTasks =
        Number(runReport?.summary?.succeeded || 0) +
        Number(runReport?.summary?.succeededResume || 0) +
        Number(runReport?.summary?.planned || 0);
      const totalChecks = tasks.reduce((sum, task) => sum + (Array.isArray(task?.checks) ? task.checks.length : 0), 0);
      if (successfulTasks === 0 && totalChecks >= rails.maxNoProgressChecks) {
        findings.push({
          severity: "error",
          code: "no_progress_after_checks",
          message: `No progress detected after ${totalChecks} checks (limit ${rails.maxNoProgressChecks}).`,
        });
      }

      const ledgerRows = readJsonl(ledgerAbsolutePath).filter((row) => (args.runId ? row?.runId === args.runId : true));
      const retryEvents = ledgerRows.filter((row) => row?.eventType === "check_retry_scheduled").length;
      if (retryEvents >= rails.maxPlanChurnInWindow) {
        warnings.push({
          severity: "warning",
          code: "plan_churn_proxy",
          message: `Retry event count ${retryEvents} reached plan churn proxy threshold ${rails.maxPlanChurnInWindow}.`,
        });
      }
    }
  }

  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const warningCount = warnings.length;
  const status = errorCount > 0 ? "fail" : "pass";

  if (status !== "pass" && args.mode === "postflight") {
    snapshot = buildSnapshot({ args, runReport, repeatedErrors, findings, rails });
    mkdirSync(dirname(snapshotAbsolutePath), { recursive: true });
    writeFileSync(snapshotAbsolutePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }

  const report = {
    schema: "intent-safety-rails-report.v1",
    generatedAt: new Date().toISOString(),
    mode: args.mode,
    infraPhase: args.infraPhase,
    status,
    summary: {
      errors: errorCount,
      warnings: warningCount,
      repeatedErrorSignatures: repeatedErrors.length,
    },
    rails,
    findings,
    warnings,
    snapshotPath: snapshot ? args.snapshotPath : null,
  };

  mkdirSync(dirname(artifactAbsolutePath), { recursive: true });
  writeFileSync(artifactAbsolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`intent-safety-rails status: ${report.status}\n`);
    process.stdout.write(`report: ${artifactAbsolutePath}\n`);
  }

  if (report.status !== "pass" && args.strict) {
    process.exitCode = 1;
  } else if (report.status !== "pass") {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`intent-safety-rails failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
