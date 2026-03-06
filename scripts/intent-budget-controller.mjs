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
    mode: "preflight",
    planPath: "artifacts/intent-plan.generated.json",
    runReportPath: "",
    budgetPath: "config/intent-budget.json",
    artifact: "output/intent/budget-controller-report.json",
    intentIds: [],
    infraPhase: String(process.env.INTENT_INFRA_PHASE || "normal").toLowerCase(),
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

    if (arg === "--mode" && argv[index + 1]) {
      parsed.mode = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      parsed.mode = arg.slice("--mode=".length).trim();
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

    if ((arg === "--budget" || arg === "--budget-path") && argv[index + 1]) {
      parsed.budgetPath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--budget=")) {
      parsed.budgetPath = arg.slice("--budget=".length).trim();
      continue;
    }

    if ((arg === "--artifact" || arg === "--report") && argv[index + 1]) {
      parsed.artifact = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      parsed.artifact = arg.slice("--artifact=".length).trim();
      continue;
    }

    if (arg === "--intent-id" && argv[index + 1]) {
      parsed.intentIds.push(String(argv[index + 1]).trim());
      index += 1;
      continue;
    }
    if (arg.startsWith("--intent-id=")) {
      parsed.intentIds.push(arg.slice("--intent-id=".length).trim());
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

    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Intent budget controller",
          "",
          "Usage:",
          "  node ./scripts/intent-budget-controller.mjs --mode preflight --plan artifacts/intent-plan.generated.json",
          "",
          "Modes:",
          "  preflight  Validate planned task/check counts against budget config",
          "  postflight Validate actual run report metrics against budget config",
          "",
          "Options:",
          "  --infra-phase <id>  Infra phase (normal|ingestion)",
        ].join("\n")
      );
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  parsed.intentIds = parsed.intentIds.filter(Boolean);
  if (!["preflight", "postflight"].includes(parsed.mode)) {
    throw new Error("--mode must be preflight or postflight.");
  }
  if (parsed.mode === "postflight" && !parsed.runReportPath) {
    throw new Error("--run-report is required in postflight mode.");
  }
  if (!["normal", "ingestion"].includes(parsed.infraPhase)) {
    throw new Error("--infra-phase must be one of: normal, ingestion.");
  }
  return parsed;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function selectRows(plan, intentIds) {
  const filter = intentIds.length > 0 ? new Set(intentIds) : null;
  const intents = (Array.isArray(plan.intents) ? plan.intents : []).filter((intent) =>
    filter ? filter.has(intent.intentId) : true
  );
  const tasks = (Array.isArray(plan.tasks) ? plan.tasks : []).filter((task) =>
    filter ? filter.has(task.intentId) : true
  );
  return { intents, tasks };
}

function buildBudgetEnvelope(config) {
  const defaults = config?.defaults || {};

  const envelope = {
    softMaxTasksPerRun: Number(defaults.softMaxTasksPerRun || defaults.maxTasksPerRun || 0) || 0,
    hardMaxTasksPerRun: Number(defaults.hardMaxTasksPerRun || defaults.maxTasksPerRun || 0) || 0,
    softMaxChecksPerRun: Number(defaults.softMaxChecksPerRun || defaults.maxChecksPerRun || 0) || 0,
    hardMaxChecksPerRun: Number(defaults.hardMaxChecksPerRun || defaults.maxChecksPerRun || 0) || 0,
    softMaxChecksPerTask: Number(defaults.softMaxChecksPerTask || defaults.maxChecksPerTask || 0) || 0,
    hardMaxChecksPerTask: Number(defaults.hardMaxChecksPerTask || defaults.maxChecksPerTask || 0) || 0,
    softMaxRuntimeMsPerRun: Number(defaults.softMaxRuntimeMsPerRun || defaults.maxRuntimeMsPerRun || 0) || 0,
    hardMaxRuntimeMsPerRun: Number(defaults.hardMaxRuntimeMsPerRun || defaults.maxRuntimeMsPerRun || 0) || 0,
    softMaxRetriesPerCheck: Number(defaults.softMaxRetriesPerCheck || defaults.maxRetriesPerCheck || 0) || 0,
    hardMaxRetriesPerCheck: Number(defaults.hardMaxRetriesPerCheck || defaults.maxRetriesPerCheck || 0) || 0,
    softMaxWriteActionsPerRun: Number(defaults.softMaxWriteActionsPerRun || 0) || 0,
    hardMaxWriteActionsPerRun: Number(defaults.hardMaxWriteActionsPerRun || 0) || 0,
    softMaxChangedFilesPerRun: Number(defaults.softMaxChangedFilesPerRun || 0) || 0,
    hardMaxChangedFilesPerRun: Number(defaults.hardMaxChangedFilesPerRun || 0) || 0,
  };

  return envelope;
}

function applyInfraPhaseOverrides(envelope, config, infraPhase) {
  if (infraPhase !== "ingestion") return envelope;
  const override = config?.infraPhaseOverrides?.ingestion || null;
  if (!override || typeof override !== "object") return envelope;

  const runtimeMultiplier = Number(override.runtimeMultiplier || 1);
  if (Number.isFinite(runtimeMultiplier) && runtimeMultiplier > 0) {
    if (envelope.softMaxRuntimeMsPerRun > 0) {
      envelope.softMaxRuntimeMsPerRun = Math.round(envelope.softMaxRuntimeMsPerRun * runtimeMultiplier);
    }
    if (envelope.hardMaxRuntimeMsPerRun > 0) {
      envelope.hardMaxRuntimeMsPerRun = Math.round(envelope.hardMaxRuntimeMsPerRun * runtimeMultiplier);
    }
  }

  if (Number.isFinite(Number(override.maxRetriesPerCheck))) {
    envelope.softMaxRetriesPerCheck = Number(override.maxRetriesPerCheck);
  }
  if (Number.isFinite(Number(override.hardMaxRetriesPerCheck))) {
    envelope.hardMaxRetriesPerCheck = Number(override.hardMaxRetriesPerCheck);
  }

  return envelope;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const planAbsolutePath = resolve(REPO_ROOT, args.planPath);
  const budgetAbsolutePath = resolve(REPO_ROOT, args.budgetPath);
  const artifactAbsolutePath = resolve(REPO_ROOT, args.artifact);

  if (!existsSync(planAbsolutePath)) throw new Error(`Plan file not found: ${planAbsolutePath}`);
  if (!existsSync(budgetAbsolutePath)) throw new Error(`Budget config not found: ${budgetAbsolutePath}`);

  const plan = readJson(planAbsolutePath);
  const config = readJson(budgetAbsolutePath);
  const { intents, tasks } = selectRows(plan, args.intentIds);
  const envelope = applyInfraPhaseOverrides(buildBudgetEnvelope(config), config, args.infraPhase);
  const riskOverrides = config?.riskTierOverrides || {};
  const intentById = new Map(intents.map((intent) => [intent.intentId, intent]));

  const findings = [];

  const checkAgainstEnvelope = (metrics) => {
    if (envelope.hardMaxTasksPerRun > 0 && metrics.taskCount > envelope.hardMaxTasksPerRun) {
      findings.push({
        severity: "error",
        code: "max_tasks_exceeded",
        message: `Task count ${metrics.taskCount} exceeded hardMaxTasksPerRun=${envelope.hardMaxTasksPerRun}.`,
      });
    }
    if (envelope.softMaxTasksPerRun > 0 && metrics.taskCount > envelope.softMaxTasksPerRun) {
      findings.push({
        severity: "warning",
        code: "soft_max_tasks_exceeded",
        message: `Task count ${metrics.taskCount} exceeded softMaxTasksPerRun=${envelope.softMaxTasksPerRun}.`,
      });
    }
    if (envelope.hardMaxChecksPerRun > 0 && metrics.totalChecks > envelope.hardMaxChecksPerRun) {
      findings.push({
        severity: "error",
        code: "max_checks_exceeded",
        message: `Check count ${metrics.totalChecks} exceeded hardMaxChecksPerRun=${envelope.hardMaxChecksPerRun}.`,
      });
    }
    if (envelope.softMaxChecksPerRun > 0 && metrics.totalChecks > envelope.softMaxChecksPerRun) {
      findings.push({
        severity: "warning",
        code: "soft_max_checks_exceeded",
        message: `Check count ${metrics.totalChecks} exceeded softMaxChecksPerRun=${envelope.softMaxChecksPerRun}.`,
      });
    }
    if (envelope.hardMaxRuntimeMsPerRun > 0 && metrics.runtimeMs > envelope.hardMaxRuntimeMsPerRun) {
      findings.push({
        severity: "error",
        code: "max_runtime_exceeded",
        message: `Runtime ${metrics.runtimeMs}ms exceeded hardMaxRuntimeMsPerRun=${envelope.hardMaxRuntimeMsPerRun}.`,
      });
    }
    if (envelope.softMaxRuntimeMsPerRun > 0 && metrics.runtimeMs > envelope.softMaxRuntimeMsPerRun) {
      findings.push({
        severity: "warning",
        code: "soft_max_runtime_exceeded",
        message: `Runtime ${metrics.runtimeMs}ms exceeded softMaxRuntimeMsPerRun=${envelope.softMaxRuntimeMsPerRun}.`,
      });
    }
    if (envelope.hardMaxChecksPerTask > 0 && metrics.maxChecksPerTask > envelope.hardMaxChecksPerTask) {
      findings.push({
        severity: "error",
        code: "max_checks_per_task_exceeded",
        message: `Observed maxChecksPerTask=${metrics.maxChecksPerTask} exceeded hardMaxChecksPerTask=${envelope.hardMaxChecksPerTask}.`,
      });
    }
    if (envelope.softMaxChecksPerTask > 0 && metrics.maxChecksPerTask > envelope.softMaxChecksPerTask) {
      findings.push({
        severity: "warning",
        code: "soft_max_checks_per_task_exceeded",
        message: `Observed maxChecksPerTask=${metrics.maxChecksPerTask} exceeded softMaxChecksPerTask=${envelope.softMaxChecksPerTask}.`,
      });
    }
    if (envelope.hardMaxRetriesPerCheck > 0 && metrics.maxRetriesPerCheckObserved > envelope.hardMaxRetriesPerCheck) {
      findings.push({
        severity: "error",
        code: "max_retries_per_check_exceeded",
        message: `Observed retries/check ${metrics.maxRetriesPerCheckObserved} exceeded hardMaxRetriesPerCheck=${envelope.hardMaxRetriesPerCheck}.`,
      });
    }
    if (envelope.softMaxRetriesPerCheck > 0 && metrics.maxRetriesPerCheckObserved > envelope.softMaxRetriesPerCheck) {
      findings.push({
        severity: "warning",
        code: "soft_max_retries_per_check_exceeded",
        message: `Observed retries/check ${metrics.maxRetriesPerCheckObserved} exceeded softMaxRetriesPerCheck=${envelope.softMaxRetriesPerCheck}.`,
      });
    }
    if (envelope.hardMaxWriteActionsPerRun > 0 && metrics.writeActionCount > envelope.hardMaxWriteActionsPerRun) {
      findings.push({
        severity: "error",
        code: "max_write_actions_exceeded",
        message: `Write action count ${metrics.writeActionCount} exceeded hardMaxWriteActionsPerRun=${envelope.hardMaxWriteActionsPerRun}.`,
      });
    }
    if (envelope.softMaxWriteActionsPerRun > 0 && metrics.writeActionCount > envelope.softMaxWriteActionsPerRun) {
      findings.push({
        severity: "warning",
        code: "soft_max_write_actions_exceeded",
        message: `Write action count ${metrics.writeActionCount} exceeded softMaxWriteActionsPerRun=${envelope.softMaxWriteActionsPerRun}.`,
      });
    }
    if (envelope.hardMaxChangedFilesPerRun > 0 && metrics.plannedChangedFilesBudget > envelope.hardMaxChangedFilesPerRun) {
      findings.push({
        severity: "error",
        code: "max_changed_files_budget_exceeded",
        message: `Planned changed-files budget ${metrics.plannedChangedFilesBudget} exceeded hardMaxChangedFilesPerRun=${envelope.hardMaxChangedFilesPerRun}.`,
      });
    }
    if (envelope.softMaxChangedFilesPerRun > 0 && metrics.plannedChangedFilesBudget > envelope.softMaxChangedFilesPerRun) {
      findings.push({
        severity: "warning",
        code: "soft_max_changed_files_budget_exceeded",
        message: `Planned changed-files budget ${metrics.plannedChangedFilesBudget} exceeded softMaxChangedFilesPerRun=${envelope.softMaxChangedFilesPerRun}.`,
      });
    }
  };

  let metrics = {
    taskCount: tasks.length,
    totalChecks: tasks.reduce((sum, task) => sum + (Array.isArray(task.checks) ? task.checks.length : 0), 0),
    maxChecksPerTask: tasks.reduce((max, task) => Math.max(max, Array.isArray(task.checks) ? task.checks.length : 0), 0),
    runtimeMs: 0,
    writeActionCount: tasks.filter((task) => {
      const scope = String(task?.writeScope || "none").toLowerCase();
      return !["none", "artifact-only", "artifact_only"].includes(scope);
    }).length,
    plannedChangedFilesBudget: intents.reduce((sum, intent) => sum + Number(intent?.constraints?.maxChangedFiles || 0), 0),
    maxRetriesPerCheckObserved: 0,
  };
  let intentMetrics = new Map();

  if (args.mode === "postflight") {
    const runReportAbsolutePath = resolve(REPO_ROOT, args.runReportPath);
    if (!existsSync(runReportAbsolutePath)) {
      throw new Error(`Run report not found: ${runReportAbsolutePath}`);
    }
    const runReport = readJson(runReportAbsolutePath);
    const runTasks = (Array.isArray(runReport.tasks) ? runReport.tasks : []).filter((task) =>
      args.intentIds.length > 0 ? args.intentIds.includes(task.intentId) : true
    );
    metrics = {
      taskCount: runTasks.length,
      totalChecks: runTasks.reduce((sum, task) => sum + (Array.isArray(task.checks) ? task.checks.length : 0), 0),
      maxChecksPerTask: runTasks.reduce((max, task) => Math.max(max, Array.isArray(task.checks) ? task.checks.length : 0), 0),
      runtimeMs: runTasks.reduce(
        (sum, task) =>
          sum +
          (Array.isArray(task.checks)
            ? task.checks.reduce((checkSum, check) => checkSum + Number(check?.durationMs || 0), 0)
            : 0),
        0
      ),
      writeActionCount: runTasks.filter((task) => {
        const scope = String(task?.writeScope || "none").toLowerCase();
        return !["none", "artifact-only", "artifact_only"].includes(scope);
      }).length,
      plannedChangedFilesBudget: intents.reduce((sum, intent) => sum + Number(intent?.constraints?.maxChangedFiles || 0), 0),
      maxRetriesPerCheckObserved: runTasks.reduce(
        (max, task) =>
          Math.max(
            max,
            Array.isArray(task.checks)
              ? task.checks.reduce((checkMax, check) => Math.max(checkMax, Number(check?.retryCount || 0)), 0)
              : 0
          ),
        0
      ),
    };
    intentMetrics = runTasks.reduce((map, task) => {
      const intentId = String(task.intentId || "");
      const current = map.get(intentId) || {
        taskCount: 0,
        totalChecks: 0,
        maxChecksPerTask: 0,
        runtimeMs: 0,
        maxRetriesPerCheckObserved: 0,
      };
      const checks = Array.isArray(task.checks) ? task.checks : [];
      const checkCount = checks.length;
      const runtimeMs = checks.reduce((sum, check) => sum + Number(check?.durationMs || 0), 0);
      map.set(intentId, {
        taskCount: current.taskCount + 1,
        totalChecks: current.totalChecks + checkCount,
        maxChecksPerTask: Math.max(current.maxChecksPerTask, checkCount),
        runtimeMs: current.runtimeMs + runtimeMs,
        maxRetriesPerCheckObserved: Math.max(
          Number(current.maxRetriesPerCheckObserved || 0),
          checks.reduce((checkMax, check) => Math.max(checkMax, Number(check?.retryCount || 0)), 0)
        ),
      });
      return map;
    }, new Map());
  } else {
    intentMetrics = tasks.reduce((map, task) => {
      const intentId = String(task.intentId || "");
      const current = map.get(intentId) || { taskCount: 0, totalChecks: 0, maxChecksPerTask: 0, runtimeMs: 0 };
      const checks = Array.isArray(task.checks) ? task.checks : [];
      map.set(intentId, {
        taskCount: current.taskCount + 1,
        totalChecks: current.totalChecks + checks.length,
        maxChecksPerTask: Math.max(current.maxChecksPerTask, checks.length),
        runtimeMs: 0,
        maxRetriesPerCheckObserved: Math.max(
          Number(current.maxRetriesPerCheckObserved || 0),
          checks.reduce((checkMax, check) => Math.max(checkMax, Number(check?.retryCount || 0)), 0)
        ),
      });
      return map;
    }, new Map());
  }

  checkAgainstEnvelope(metrics);

  for (const [intentId, intentMetric] of intentMetrics.entries()) {
    const intent = intentById.get(intentId) || null;
    if (!intent) continue;

    const intentBudget = intent?.budget || null;
    if (intentBudget) {
      if (Number(intentBudget.maxTasks) > 0 && intentMetric.taskCount > Number(intentBudget.maxTasks)) {
        findings.push({
          severity: "error",
          code: "intent_max_tasks_exceeded",
          intentId,
          message: `Intent ${intentId} taskCount ${intentMetric.taskCount} exceeded maxTasks=${intentBudget.maxTasks}.`,
        });
      }
      if (Number(intentBudget.maxChecks) > 0 && intentMetric.totalChecks > Number(intentBudget.maxChecks)) {
        findings.push({
          severity: "error",
          code: "intent_max_checks_exceeded",
          intentId,
          message: `Intent ${intentId} totalChecks ${intentMetric.totalChecks} exceeded maxChecks=${intentBudget.maxChecks}.`,
        });
      }
      if (Number(intentBudget.maxRuntimeMs) > 0 && intentMetric.runtimeMs > Number(intentBudget.maxRuntimeMs)) {
        findings.push({
          severity: "error",
          code: "intent_max_runtime_exceeded",
          intentId,
          message: `Intent ${intentId} runtimeMs ${intentMetric.runtimeMs} exceeded maxRuntimeMs=${intentBudget.maxRuntimeMs}.`,
        });
      }
    }

    const riskTier = String(intent.riskTier || "").toLowerCase();
    const riskOverride = riskOverrides[riskTier] || null;
    if (riskOverride && Number(riskOverride.maxChecksPerTask) > 0 && intentMetric.maxChecksPerTask > Number(riskOverride.maxChecksPerTask)) {
      findings.push({
        severity: "error",
        code: "risk_override_max_checks_per_task_exceeded",
        intentId,
        message: `Intent ${intentId} maxChecksPerTask ${intentMetric.maxChecksPerTask} exceeded risk override ${riskOverride.maxChecksPerTask}.`,
      });
    }
    if (
      riskOverride &&
      Number(riskOverride.hardMaxRetriesPerCheck) > 0 &&
      Number(intentMetric.maxRetriesPerCheckObserved || 0) > Number(riskOverride.hardMaxRetriesPerCheck)
    ) {
      findings.push({
        severity: "error",
        code: "risk_override_retries_exceeded",
        intentId,
        message: `Intent ${intentId} retries/check ${intentMetric.maxRetriesPerCheckObserved} exceeded risk override ${riskOverride.hardMaxRetriesPerCheck}.`,
      });
    }
  }

  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  const status = errorCount === 0 ? "pass" : "fail";
  const report = {
    schema: "intent-budget-controller-report.v1",
    generatedAt: new Date().toISOString(),
    status,
    mode: args.mode,
    infraPhase: args.infraPhase,
    planPath: args.planPath,
    runReportPath: args.runReportPath || null,
    selectedIntentIds: args.intentIds,
    envelope,
    metrics,
    summary: {
      errors: errorCount,
      warnings: warningCount,
    },
    intentMetrics: Object.fromEntries(intentMetrics.entries()),
    findings,
  };

  mkdirSync(dirname(artifactAbsolutePath), { recursive: true });
  writeFileSync(artifactAbsolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`intent-budget-controller status: ${status}\n`);
    process.stdout.write(`mode: ${args.mode}\n`);
    process.stdout.write(`report: ${artifactAbsolutePath}\n`);
  }

  if (status !== "pass" && args.strict) {
    process.exitCode = 1;
  } else if (status !== "pass") {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`intent-budget-controller failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
