#!/usr/bin/env node

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const DEFAULT_PLAN_PATH = "artifacts/intent-plan.generated.json";
const DEFAULT_LEDGER_PATH = "output/intent/intent-run-ledger.jsonl";
const DEFAULT_REPORT_PATH = "output/intent/intent-run-report.json";
const DEFAULT_RUN_ARTIFACTS_ROOT = "artifacts/runs";
const DEFAULT_DEAD_LETTER_PATH = "output/intent/intent-dead-letter.jsonl";

function parseArgs(argv) {
  const parsed = {
    json: false,
    execute: false,
    resume: false,
    continueOnError: false,
    enableScoring: false,
    planPath: DEFAULT_PLAN_PATH,
    ledgerPath: DEFAULT_LEDGER_PATH,
    reportPath: DEFAULT_REPORT_PATH,
    runArtifactsRoot: DEFAULT_RUN_ARTIFACTS_ROOT,
    deadLetterPath: DEFAULT_DEAD_LETTER_PATH,
    policyPath: "config/intent-policy.json",
    budgetPath: "config/intent-budget.json",
    safetyRailsPath: "config/intent-safety-rails.json",
    memoryInputPath: "imports/memory-context-slice.jsonl",
    environment: String(process.env.INTENT_ENVIRONMENT || "local").toLowerCase(),
    infraPhase: String(process.env.INTENT_INFRA_PHASE || "normal").toLowerCase(),
    runId: `intent-run-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    intentIds: [],
    taskIds: [],
    maxTasks: null,
    commandTimeoutMs: 30 * 60 * 1000,
    maxRetriesPerCheck: 1,
    evalThreshold: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] ?? "");
    if (!arg) continue;

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--execute") {
      parsed.execute = true;
      continue;
    }
    if (arg === "--resume") {
      parsed.resume = true;
      continue;
    }
    if (arg === "--continue-on-error") {
      parsed.continueOnError = true;
      continue;
    }
    if (arg === "--enable-scoring") {
      parsed.enableScoring = true;
      continue;
    }

    if (arg === "--run-id" && argv[index + 1]) {
      parsed.runId = String(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--run-id=")) {
      parsed.runId = arg.slice("--run-id=".length);
      continue;
    }

    if (arg === "--plan" && argv[index + 1]) {
      parsed.planPath = String(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--plan=")) {
      parsed.planPath = arg.slice("--plan=".length);
      continue;
    }

    if (arg === "--ledger" && argv[index + 1]) {
      parsed.ledgerPath = String(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--ledger=")) {
      parsed.ledgerPath = arg.slice("--ledger=".length);
      continue;
    }

    if ((arg === "--report" || arg === "--artifact") && argv[index + 1]) {
      parsed.reportPath = String(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--report=")) {
      parsed.reportPath = arg.slice("--report=".length);
      continue;
    }

    if (arg === "--run-artifacts-root" && argv[index + 1]) {
      parsed.runArtifactsRoot = String(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--run-artifacts-root=")) {
      parsed.runArtifactsRoot = arg.slice("--run-artifacts-root=".length);
      continue;
    }

    if (arg === "--dead-letter" && argv[index + 1]) {
      parsed.deadLetterPath = String(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--dead-letter=")) {
      parsed.deadLetterPath = arg.slice("--dead-letter=".length);
      continue;
    }

    if (arg === "--policy" && argv[index + 1]) {
      parsed.policyPath = String(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--policy=")) {
      parsed.policyPath = arg.slice("--policy=".length);
      continue;
    }

    if (arg === "--budget" && argv[index + 1]) {
      parsed.budgetPath = String(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--budget=")) {
      parsed.budgetPath = arg.slice("--budget=".length);
      continue;
    }

    if (arg === "--safety-rails" && argv[index + 1]) {
      parsed.safetyRailsPath = String(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--safety-rails=")) {
      parsed.safetyRailsPath = arg.slice("--safety-rails=".length);
      continue;
    }

    if (arg === "--memory-input" && argv[index + 1]) {
      parsed.memoryInputPath = String(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--memory-input=")) {
      parsed.memoryInputPath = arg.slice("--memory-input=".length);
      continue;
    }

    if (arg === "--environment" && argv[index + 1]) {
      parsed.environment = String(argv[index + 1]).toLowerCase();
      index += 1;
      continue;
    }
    if (arg.startsWith("--environment=")) {
      parsed.environment = arg.slice("--environment=".length).toLowerCase();
      continue;
    }

    if (arg === "--infra-phase" && argv[index + 1]) {
      parsed.infraPhase = String(argv[index + 1]).toLowerCase();
      index += 1;
      continue;
    }
    if (arg.startsWith("--infra-phase=")) {
      parsed.infraPhase = arg.slice("--infra-phase=".length).toLowerCase();
      continue;
    }

    if (arg === "--intent" && argv[index + 1]) {
      parsed.intentIds.push(String(argv[index + 1]).trim());
      index += 1;
      continue;
    }
    if (arg.startsWith("--intent=")) {
      parsed.intentIds.push(arg.slice("--intent=".length).trim());
      continue;
    }

    if (arg === "--task" && argv[index + 1]) {
      parsed.taskIds.push(String(argv[index + 1]).trim());
      index += 1;
      continue;
    }
    if (arg.startsWith("--task=")) {
      parsed.taskIds.push(arg.slice("--task=".length).trim());
      continue;
    }

    if (arg === "--max-tasks" && argv[index + 1]) {
      parsed.maxTasks = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--max-tasks=")) {
      parsed.maxTasks = Number(arg.slice("--max-tasks=".length));
      continue;
    }

    if (arg === "--command-timeout-ms" && argv[index + 1]) {
      parsed.commandTimeoutMs = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--command-timeout-ms=")) {
      parsed.commandTimeoutMs = Number(arg.slice("--command-timeout-ms=".length));
      continue;
    }

    if (arg === "--max-retries" && argv[index + 1]) {
      parsed.maxRetriesPerCheck = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--max-retries=")) {
      parsed.maxRetriesPerCheck = Number(arg.slice("--max-retries=".length));
      continue;
    }

    if (arg === "--eval-threshold" && argv[index + 1]) {
      parsed.evalThreshold = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--eval-threshold=")) {
      parsed.evalThreshold = Number(arg.slice("--eval-threshold=".length));
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Intent runner",
          "",
          "Usage:",
          "  node ./scripts/intent-runner.mjs [--json] [--execute] [--resume]",
          "",
          "Options:",
          "  --intent <intentId>          Limit run to one or more intent IDs",
          "  --task <taskId>              Limit run to one or more task IDs (deps auto-included)",
          "  --execute                    Execute checks (default is plan-only)",
          "  --resume                     Resume by run-id using ledger history",
          "  --run-id <id>                Stable run id for replay/resume",
          "  --continue-on-error          Continue scheduling independent tasks after failures",
          "  --enable-scoring             Enable simulation/evaluation/policy/budget/memory hooks",
          "  --max-tasks <n>              Cap number of ordered tasks for this run",
          "  --plan <path>                Compiled intent plan path",
          "  --ledger <path>              Append-only run ledger path (.jsonl)",
          "  --report <path>              Run report output path",
          "  --run-artifacts-root <path>  Run-scoped artifact root (default: artifacts/runs)",
          "  --dead-letter <path>         Dead-letter ledger path",
          "  --policy <path>              Policy gate config path",
          "  --budget <path>              Budget controller config path",
          "  --safety-rails <path>        Safety rails config path",
          "  --memory-input <path>        Memory JSONL path for governance checks",
          "  --environment <id>           Runtime environment (local|staging|production)",
          "  --infra-phase <id>           Infra phase (normal|ingestion)",
          "  --max-retries <n>            Max retries for retryable check failures",
          "  --command-timeout-ms <ms>    Max per-check command timeout (default: 1800000)",
          "  --eval-threshold <n>         Override evaluation threshold (0..1)",
        ].join("\n")
      );
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  parsed.intentIds = parsed.intentIds.filter(Boolean);
  parsed.taskIds = parsed.taskIds.filter(Boolean);

  if (!Number.isFinite(parsed.commandTimeoutMs) || parsed.commandTimeoutMs <= 0) {
    throw new Error("--command-timeout-ms must be a positive integer.");
  }
  if (!Number.isInteger(parsed.maxRetriesPerCheck) || parsed.maxRetriesPerCheck < 0 || parsed.maxRetriesPerCheck > 5) {
    throw new Error("--max-retries must be an integer in [0, 5].");
  }
  if (parsed.maxTasks !== null) {
    if (!Number.isFinite(parsed.maxTasks) || parsed.maxTasks <= 0) {
      throw new Error("--max-tasks must be a positive integer when provided.");
    }
    parsed.maxTasks = Math.floor(parsed.maxTasks);
  }
  if (parsed.evalThreshold !== null && (!Number.isFinite(parsed.evalThreshold) || parsed.evalThreshold < 0 || parsed.evalThreshold > 1)) {
    throw new Error("--eval-threshold must be in [0, 1].");
  }
  if (!["normal", "ingestion"].includes(parsed.infraPhase)) {
    throw new Error("--infra-phase must be one of: normal, ingestion.");
  }

  if (parsed.resume && (!parsed.runId || parsed.runId.trim().length === 0)) {
    throw new Error("--resume requires --run-id.");
  }

  return parsed;
}

const LEDGER_CHAIN_STATE = new Map();
let ACTIVE_RUN_CONTEXT = null;

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function initializeLedgerChainState(ledgerPath) {
  if (LEDGER_CHAIN_STATE.has(ledgerPath)) {
    return LEDGER_CHAIN_STATE.get(ledgerPath);
  }
  const state = {
    sequence: 0,
    previousEventHash: null,
  };
  if (existsSync(ledgerPath)) {
    const lines = readFileSync(ledgerPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        const row = JSON.parse(lines[index]);
        state.sequence = Number.isInteger(Number(row?.sequence)) ? Number(row.sequence) : lines.length;
        state.previousEventHash = typeof row?.eventHash === "string" ? row.eventHash : null;
        break;
      } catch {
        // Ignore malformed lines and keep scanning backwards.
      }
    }
  }
  LEDGER_CHAIN_STATE.set(ledgerPath, state);
  return state;
}

function truncateText(value, max = 4000) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...<truncated ${text.length - max} chars>`;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readLedgerEvents(filePath) {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const events = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      events.push({ malformed: true, raw: line });
    }
  }
  return events;
}

function appendLedgerEvent(ledgerPath, event) {
  const chainState = initializeLedgerChainState(ledgerPath);
  const sequence = Number(chainState.sequence || 0) + 1;
  const enrichedEvent = {
    ...event,
    sequence,
    previousEventHash: chainState.previousEventHash || null,
  };
  if (ACTIVE_RUN_CONTEXT && typeof ACTIVE_RUN_CONTEXT === "object") {
    if (enrichedEvent.infraPhase === undefined) {
      enrichedEvent.infraPhase = ACTIVE_RUN_CONTEXT.infraPhase;
    }
    if (enrichedEvent.environment === undefined) {
      enrichedEvent.environment = ACTIVE_RUN_CONTEXT.environment;
    }
    if (enrichedEvent.runnerVersion === undefined) {
      enrichedEvent.runnerVersion = ACTIVE_RUN_CONTEXT.runnerVersion;
    }
  }
  enrichedEvent.eventHash = sha256(JSON.stringify(enrichedEvent));
  mkdirSync(dirname(ledgerPath), { recursive: true });
  appendFileSync(ledgerPath, `${JSON.stringify(enrichedEvent)}\n`, "utf8");
  chainState.sequence = sequence;
  chainState.previousEventHash = enrichedEvent.eventHash;
}

function appendDeadLetter(deadLetterPath, row) {
  mkdirSync(dirname(deadLetterPath), { recursive: true });
  appendFileSync(deadLetterPath, `${JSON.stringify(row)}\n`, "utf8");
}

function topologicalSort(taskRows) {
  const taskMap = new Map(taskRows.map((task) => [task.taskId, task]));
  const indegree = new Map();
  const edges = new Map();

  for (const task of taskRows) {
    indegree.set(task.taskId, 0);
    edges.set(task.taskId, []);
  }

  for (const task of taskRows) {
    for (const dependency of task.dependsOn || []) {
      if (!taskMap.has(dependency)) {
        throw new Error(`Task ${task.taskId} depends on missing task ${dependency} in selected scope.`);
      }
      indegree.set(task.taskId, (indegree.get(task.taskId) || 0) + 1);
      edges.get(dependency).push(task.taskId);
    }
  }

  const queue = Array.from(indegree.entries())
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
    .sort();

  const ordered = [];
  while (queue.length > 0) {
    const nextId = queue.shift();
    ordered.push(taskMap.get(nextId));

    for (const downstreamId of edges.get(nextId) || []) {
      const updated = (indegree.get(downstreamId) || 0) - 1;
      indegree.set(downstreamId, updated);
      if (updated === 0) {
        queue.push(downstreamId);
        queue.sort();
      }
    }
  }

  if (ordered.length !== taskRows.length) {
    throw new Error("Cycle detected in selected task dependency graph.");
  }

  return ordered;
}

function selectTasks(plan, intentIds, taskIds) {
  const allTasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  const taskMap = new Map(allTasks.map((task) => [task.taskId, task]));

  let selected = new Set();
  if (intentIds.length === 0 && taskIds.length === 0) {
    selected = new Set(taskMap.keys());
  } else {
    for (const task of allTasks) {
      if (intentIds.includes(task.intentId)) {
        selected.add(task.taskId);
      }
    }
    for (const taskId of taskIds) {
      if (!taskMap.has(taskId)) {
        throw new Error(`Unknown task selector: ${taskId}`);
      }
      selected.add(taskId);
    }
  }

  const withDeps = new Set();
  const addWithDependencies = (taskId) => {
    if (withDeps.has(taskId)) return;
    const task = taskMap.get(taskId);
    if (!task) {
      throw new Error(`Missing task while expanding dependencies: ${taskId}`);
    }
    withDeps.add(taskId);
    for (const dependency of task.dependsOn || []) {
      addWithDependencies(dependency);
    }
  };

  for (const taskId of selected) {
    addWithDependencies(taskId);
  }

  return Array.from(withDeps)
    .map((taskId) => taskMap.get(taskId))
    .filter(Boolean);
}

function executeCheck(command, timeoutMs) {
  const startedAt = Date.now();
  const result = spawnSync("bash", ["-lc", command], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 32,
  });

  const durationMs = Date.now() - startedAt;
  const timedOut = result.signal === "SIGTERM" && result.status === null;
  const exitCode = typeof result.status === "number" ? result.status : timedOut ? 124 : 1;

  return {
    ok: exitCode === 0,
    exitCode,
    signal: result.signal || null,
    timedOut,
    durationMs,
    stdout: truncateText(result.stdout || ""),
    stderr: truncateText(result.stderr || ""),
  };
}

function classifyFailure(result) {
  if (result.ok) {
    return { category: "none", retryable: false };
  }

  const text = `${String(result.stderr || "")}\n${String(result.stdout || "")}`.toLowerCase();
  if (result.timedOut) return { category: "transient_timeout", retryable: true };
  if (/(econnreset|etimedout|eai_again|enotfound|network timeout|temporary failure)/i.test(text)) {
    return { category: "transient_network", retryable: true };
  }
  if (/(429|rate limit|quota exceeded|resource exhausted)/i.test(text)) {
    return { category: "quota", retryable: true };
  }
  if (
    /(\b401\b|\b403\b|unauthori[sz]ed|permission denied|forbidden|invalid token|id token expired|token expired|auth\/(?:id-token-expired|insufficient-permission)|sign in blocked|user remains signed out|requires staff credentials)/i.test(
      text
    )
  ) {
    return { category: "auth", retryable: false };
  }
  if (/(schema|validation|invalid json|unexpected token|ajv|contract)/i.test(text)) {
    return { category: "schema", retryable: false };
  }
  return { category: "permanent", retryable: false };
}

function runNodeScript(scriptRelativePath, scriptArgs, timeoutMs = 15 * 60 * 1000) {
  const result = spawnSync(process.execPath, [scriptRelativePath, ...scriptArgs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 32,
    env: process.env,
  });

  const stdout = String(result.stdout || "").trim();
  let parsed = null;
  try {
    parsed = stdout ? JSON.parse(stdout) : null;
  } catch {
    parsed = null;
  }

  return {
    ok: result.status === 0,
    status: typeof result.status === "number" ? result.status : null,
    signal: result.signal || null,
    stdout,
    stderr: String(result.stderr || "").trim(),
    parsed,
  };
}

function toRepoPath(absolutePath) {
  return relative(REPO_ROOT, absolutePath).replaceAll("\\", "/");
}

function readPolicyRuntimeControls(policyPath) {
  const absolute = resolve(REPO_ROOT, policyPath);
  if (!existsSync(absolute)) {
    return {};
  }
  try {
    const policy = readJson(absolute);
    return policy?.runtimeControls && typeof policy.runtimeControls === "object" ? policy.runtimeControls : {};
  } catch {
    return {};
  }
}

function hookFailureBlocks(runtimeControls, hookName) {
  const failOpenMatrix =
    runtimeControls?.failOpenMatrix && typeof runtimeControls.failOpenMatrix === "object"
      ? runtimeControls.failOpenMatrix
      : {};
  const mode = String(failOpenMatrix?.[hookName] || "fail_closed").toLowerCase();
  return mode !== "fail_open";
}

function buildRunReport({
  runStatus,
  args,
  mode,
  resume,
  planAbsolutePath,
  plan,
  ledgerAbsolutePath,
  reportAbsolutePath,
  runArtifactsAbsolutePath,
  taskResults,
  summary,
  orderedTasks,
  hooks,
}) {
  return {
    schema: "intent-run-report.v2",
    generatedAt: new Date().toISOString(),
    runId: args.runId,
    mode,
    resume,
    scoringEnabled: args.enableScoring,
    environment: args.environment,
    infraPhase: args.infraPhase,
    status: runStatus,
    planPath: toRepoPath(planAbsolutePath),
    planDigestSha256: plan.planDigestSha256,
    ledgerPath: toRepoPath(ledgerAbsolutePath),
    reportPath: toRepoPath(reportAbsolutePath),
    runArtifactsDir: toRepoPath(runArtifactsAbsolutePath),
    deadLetterPath: args.deadLetterPath,
    safetyRailsPath: args.safetyRailsPath,
    selectedIntents: args.intentIds,
    selectedTasks: args.taskIds,
    orderedTaskCount: orderedTasks.length,
    summary,
    hooks,
    tasks: taskResults,
  };
}

function writeReport(reportAbsolutePath, report) {
  mkdirSync(dirname(reportAbsolutePath), { recursive: true });
  writeFileSync(reportAbsolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const planAbsolutePath = resolve(REPO_ROOT, args.planPath);
  const ledgerAbsolutePath = resolve(REPO_ROOT, args.ledgerPath);
  const reportAbsolutePath = resolve(REPO_ROOT, args.reportPath);
  const runArtifactsAbsolutePath = resolve(REPO_ROOT, args.runArtifactsRoot, args.runId);
  const deadLetterAbsolutePath = resolve(REPO_ROOT, args.deadLetterPath);

  mkdirSync(runArtifactsAbsolutePath, { recursive: true });

  if (!existsSync(planAbsolutePath)) {
    throw new Error(`Compiled plan not found at ${args.planPath}. Run npm run intent:compile first.`);
  }

  const plan = readJson(planAbsolutePath);
  if (plan?.schema !== "intent-plan.v1") {
    throw new Error(`Unsupported plan schema: ${String(plan?.schema ?? "unknown")}`);
  }

  const selectedRows = selectTasks(plan, args.intentIds, args.taskIds);
  if (selectedRows.length === 0) {
    throw new Error("No tasks selected for execution.");
  }

  let orderedTasks = topologicalSort(selectedRows);
  if (args.maxTasks !== null) {
    orderedTasks = orderedTasks.slice(0, args.maxTasks);
  }

  const intentMap = new Map((Array.isArray(plan.intents) ? plan.intents : []).map((intent) => [intent.intentId, intent]));
  const selectedIntentIds = Array.from(new Set(orderedTasks.map((task) => task.intentId))).sort();

  const priorEvents = readLedgerEvents(ledgerAbsolutePath).filter((event) => !event.malformed);
  const priorRunEvents = priorEvents.filter((event) => event.runId === args.runId);
  const priorStarted = priorRunEvents.find((event) => event.eventType === "run_started") || null;

  if (args.resume) {
    if (priorRunEvents.length === 0) {
      throw new Error(`Resume requested but no prior ledger events found for runId=${args.runId}`);
    }
    const priorDigest = priorStarted?.planDigestSha256 ?? null;
    if (priorDigest && priorDigest !== plan.planDigestSha256) {
      throw new Error(
        `Plan digest mismatch for resume runId=${args.runId}. prior=${priorDigest} current=${plan.planDigestSha256}`
      );
    }
  }

  const mode = args.execute ? "execute" : "plan";
  const runtimeControls = readPolicyRuntimeControls(args.policyPath);
  ACTIVE_RUN_CONTEXT = {
    infraPhase: args.infraPhase,
    environment: args.environment,
    runnerVersion: "intent-runner.v3",
  };

  if (!args.resume) {
    appendLedgerEvent(ledgerAbsolutePath, {
      schema: "intent-run-event.v1",
      at: new Date().toISOString(),
      eventType: "run_started",
      runId: args.runId,
      mode,
      planPath: toRepoPath(planAbsolutePath),
      planDigestSha256: plan.planDigestSha256,
      selectedIntents: args.intentIds,
      selectedTasks: args.taskIds,
      orderedTaskCount: orderedTasks.length,
    });
  }

  const hooks = {
    policyGate: null,
    policyDecisionTable: null,
    budgetPreflight: null,
    safetyRailsPreflight: null,
    budgetPostflight: null,
    safetyRailsPostflight: null,
    simulations: [],
    evaluations: [],
    evalSummary: null,
    memoryGovernance: null,
    replayDeterminism: null,
    errorBudgetGate: null,
    missionTimeline: null,
  };

  const resumedSucceededTaskIds = new Set(
    priorRunEvents
      .filter((event) => event.eventType === "task_finished" && event.status === "succeeded")
      .map((event) => String(event.taskId))
  );

  let preflightBlocked = false;
  if (mode === "execute") {
    const policyArtifactPath = resolve(runArtifactsAbsolutePath, "policy-gate.json");
    const policyArgs = [
      "./scripts/intent-policy-gate.mjs",
      "--json",
      "--strict",
      "--plan",
      args.planPath,
      "--policy",
      args.policyPath,
      "--environment",
      args.environment,
      "--infra-phase",
      args.infraPhase,
      "--artifact",
      toRepoPath(policyArtifactPath),
      ...selectedIntentIds.flatMap((intentId) => ["--intent-id", intentId]),
    ];
    const policyResult = runNodeScript(policyArgs[0], policyArgs.slice(1));
    hooks.policyGate = {
      ok: policyResult.ok,
      artifactPath: toRepoPath(policyArtifactPath),
      status: policyResult.parsed?.status || (policyResult.ok ? "pass" : "fail"),
    };
    appendLedgerEvent(ledgerAbsolutePath, {
      schema: "intent-run-event.v1",
      at: new Date().toISOString(),
      eventType: "preflight_policy_finished",
      runId: args.runId,
      mode,
      status: hooks.policyGate.status,
      artifactPath: hooks.policyGate.artifactPath,
    });

    const budgetPreflightPath = resolve(runArtifactsAbsolutePath, "budget-preflight.json");
    const budgetPreflightArgs = [
      "./scripts/intent-budget-controller.mjs",
      "--mode",
      "preflight",
      "--json",
      "--strict",
      "--plan",
      args.planPath,
      "--budget",
      args.budgetPath,
      "--infra-phase",
      args.infraPhase,
      "--artifact",
      toRepoPath(budgetPreflightPath),
      ...selectedIntentIds.flatMap((intentId) => ["--intent-id", intentId]),
    ];
    const budgetPreflightResult = runNodeScript(budgetPreflightArgs[0], budgetPreflightArgs.slice(1));
    hooks.budgetPreflight = {
      ok: budgetPreflightResult.ok,
      artifactPath: toRepoPath(budgetPreflightPath),
      status: budgetPreflightResult.parsed?.status || (budgetPreflightResult.ok ? "pass" : "fail"),
    };
    appendLedgerEvent(ledgerAbsolutePath, {
      schema: "intent-run-event.v1",
      at: new Date().toISOString(),
      eventType: "preflight_budget_finished",
      runId: args.runId,
      mode,
      status: hooks.budgetPreflight.status,
      artifactPath: hooks.budgetPreflight.artifactPath,
    });

    const policyDecisionTablePath = resolve(runArtifactsAbsolutePath, "policy-decision-table.json");
    const policyDecisionTableArgs = [
      "./scripts/intent-policy-decision-table.mjs",
      "--json",
      "--strict",
      "--policy",
      args.policyPath,
      "--environment",
      args.environment,
      "--artifact",
      toRepoPath(policyDecisionTablePath),
    ];
    const policyDecisionTableResult = runNodeScript(policyDecisionTableArgs[0], policyDecisionTableArgs.slice(1));
    hooks.policyDecisionTable = {
      ok: policyDecisionTableResult.ok,
      artifactPath: toRepoPath(policyDecisionTablePath),
      status: policyDecisionTableResult.parsed?.status || (policyDecisionTableResult.ok ? "pass" : "fail"),
    };
    appendLedgerEvent(ledgerAbsolutePath, {
      schema: "intent-run-event.v1",
      at: new Date().toISOString(),
      eventType: "preflight_policy_decision_table_finished",
      runId: args.runId,
      mode,
      status: hooks.policyDecisionTable.status,
      artifactPath: hooks.policyDecisionTable.artifactPath,
    });

    const safetyRailsPreflightPath = resolve(runArtifactsAbsolutePath, "safety-rails-preflight.json");
    const safetyRailsPreflightArgs = [
      "./scripts/intent-safety-rails.mjs",
      "--mode",
      "preflight",
      "--json",
      "--strict",
      "--plan",
      args.planPath,
      "--config",
      args.safetyRailsPath,
      "--infra-phase",
      args.infraPhase,
      "--run-id",
      args.runId,
      "--artifact",
      toRepoPath(safetyRailsPreflightPath),
      "--snapshot",
      toRepoPath(resolve(runArtifactsAbsolutePath, "rathole-snapshot-preflight.json")),
    ];
    const safetyRailsPreflightResult = runNodeScript(safetyRailsPreflightArgs[0], safetyRailsPreflightArgs.slice(1));
    hooks.safetyRailsPreflight = {
      ok: safetyRailsPreflightResult.ok,
      artifactPath: toRepoPath(safetyRailsPreflightPath),
      status: safetyRailsPreflightResult.parsed?.status || (safetyRailsPreflightResult.ok ? "pass" : "fail"),
    };
    appendLedgerEvent(ledgerAbsolutePath, {
      schema: "intent-run-event.v1",
      at: new Date().toISOString(),
      eventType: "preflight_safety_rails_finished",
      runId: args.runId,
      mode,
      status: hooks.safetyRailsPreflight.status,
      artifactPath: hooks.safetyRailsPreflight.artifactPath,
    });

    const preflightHookOutcomes = [
      ["policyGate", hooks.policyGate?.ok],
      ["budgetPreflight", hooks.budgetPreflight?.ok],
      ["policyDecisionTable", hooks.policyDecisionTable?.ok],
      ["safetyRailsPreflight", hooks.safetyRailsPreflight?.ok],
    ];
    preflightBlocked = preflightHookOutcomes.some(([hookName, ok]) => ok === false && hookFailureBlocks(runtimeControls, hookName));
  }

  const taskStates = new Map();
  const taskResults = [];
  const intentBlockedReasons = new Map();
  const simulatedIntents = new Set();
  const deadLetterRows = [];

  if (!preflightBlocked) {
    for (const task of orderedTasks) {
      const taskId = task.taskId;
      const intentId = task.intentId;
      const intent = intentMap.get(intentId) || null;
      const dependencyStates = (task.dependsOn || []).map((dependencyId) => taskStates.get(dependencyId) || "unknown");
      const dependencyFailed = dependencyStates.some((state) => state === "failed" || state === "blocked");

      if (intentBlockedReasons.has(intentId)) {
        const blockedReason = intentBlockedReasons.get(intentId);
        taskStates.set(taskId, "blocked");
        taskResults.push({ taskId, intentId, status: "blocked", reason: blockedReason, checks: [] });
        appendLedgerEvent(ledgerAbsolutePath, {
          schema: "intent-run-event.v1",
          at: new Date().toISOString(),
          eventType: "task_finished",
          runId: args.runId,
          mode,
          taskId,
          intentId,
          status: "blocked",
          reason: blockedReason,
        });
        const deadLetterRow = {
          schema: "intent-dead-letter.v1",
          at: new Date().toISOString(),
          runId: args.runId,
          taskId,
          intentId,
          status: "blocked",
          reason: blockedReason,
          retryEligible: false,
        };
        appendDeadLetter(deadLetterAbsolutePath, deadLetterRow);
        deadLetterRows.push(deadLetterRow);
        continue;
      }

      if (dependencyFailed) {
        taskStates.set(taskId, "blocked");
        taskResults.push({ taskId, intentId, status: "blocked", reason: "dependency_failed", checks: [] });
        appendLedgerEvent(ledgerAbsolutePath, {
          schema: "intent-run-event.v1",
          at: new Date().toISOString(),
          eventType: "task_finished",
          runId: args.runId,
          mode,
          taskId,
          intentId,
          status: "blocked",
          reason: "dependency_failed",
        });
        const deadLetterRow = {
          schema: "intent-dead-letter.v1",
          at: new Date().toISOString(),
          runId: args.runId,
          taskId,
          intentId,
          status: "blocked",
          reason: "dependency_failed",
          retryEligible: false,
        };
        appendDeadLetter(deadLetterAbsolutePath, deadLetterRow);
        deadLetterRows.push(deadLetterRow);
        if (!args.continueOnError) {
          break;
        }
        continue;
      }

      if (args.resume && resumedSucceededTaskIds.has(taskId)) {
        taskStates.set(taskId, "succeeded");
        taskResults.push({ taskId, intentId, status: "succeeded_resume", reason: "resume_skip", checks: [] });
        appendLedgerEvent(ledgerAbsolutePath, {
          schema: "intent-run-event.v1",
          at: new Date().toISOString(),
          eventType: "task_skipped",
          runId: args.runId,
          mode,
          taskId,
          intentId,
          status: "succeeded_resume",
          reason: "resume_skip",
        });
        continue;
      }

      if (mode === "execute" && !simulatedIntents.has(intentId) && intent?.simulation?.profile) {
        const simArtifactPath = resolve(runArtifactsAbsolutePath, `sim-result.${intentId}.json`);
        const simArgs = [
          "./scripts/sim-runner.mjs",
          "--json",
          "--strict",
          "--intent-id",
          intentId,
          "--plan",
          args.planPath,
          "--profile",
          String(intent.simulation.profile || "safe"),
          "--artifact",
          toRepoPath(simArtifactPath),
        ];
        const simResult = runNodeScript(simArgs[0], simArgs.slice(1));
        const simStatus = simResult.parsed?.status || (simResult.ok ? "pass" : "fail");
        const simSummary = {
          intentId,
          status: simStatus,
          profile: String(intent.simulation.profile || "safe"),
          artifactPath: toRepoPath(simArtifactPath),
        };
        hooks.simulations.push(simSummary);
        appendLedgerEvent(ledgerAbsolutePath, {
          schema: "intent-run-event.v1",
          at: new Date().toISOString(),
          eventType: "simulation_finished",
          runId: args.runId,
          mode,
          intentId,
          status: simStatus,
          artifactPath: simSummary.artifactPath,
        });

        if (!simResult.ok || simStatus !== "pass") {
          intentBlockedReasons.set(intentId, "blocked_simulation_runtime");
          taskStates.set(taskId, "blocked");
          taskResults.push({ taskId, intentId, status: "blocked", reason: "blocked_simulation_runtime", checks: [] });
          const deadLetterRow = {
            schema: "intent-dead-letter.v1",
            at: new Date().toISOString(),
            runId: args.runId,
            taskId,
            intentId,
            status: "blocked",
            reason: "blocked_simulation_runtime",
            retryEligible: false,
          };
          appendDeadLetter(deadLetterAbsolutePath, deadLetterRow);
          deadLetterRows.push(deadLetterRow);
          continue;
        }
        simulatedIntents.add(intentId);
      }

      appendLedgerEvent(ledgerAbsolutePath, {
        schema: "intent-run-event.v1",
        at: new Date().toISOString(),
        eventType: "task_started",
        runId: args.runId,
        mode,
        taskId,
        intentId,
        checkCount: Array.isArray(task.checks) ? task.checks.length : 0,
      });

      const checkResults = [];
      let taskStatus = "succeeded";
      let taskReason = null;

      if (mode === "plan") {
        taskStatus = "planned";
        taskReason = "plan_only";
      } else {
        for (const command of task.checks || []) {
          let finalResult = null;
          const attempts = [];

          for (let attempt = 1; attempt <= args.maxRetriesPerCheck + 1; attempt += 1) {
            appendLedgerEvent(ledgerAbsolutePath, {
              schema: "intent-run-event.v1",
              at: new Date().toISOString(),
              eventType: "check_started",
              runId: args.runId,
              mode,
              taskId,
              intentId,
              command,
              attempt,
            });

            const run = executeCheck(command, args.commandTimeoutMs);
            const classification = classifyFailure(run);
            const attemptResult = { command, attempt, classification: classification.category, ...run };
            attempts.push(attemptResult);

            appendLedgerEvent(ledgerAbsolutePath, {
              schema: "intent-run-event.v1",
              at: new Date().toISOString(),
              eventType: "check_finished",
              runId: args.runId,
              mode,
              taskId,
              intentId,
              command,
              attempt,
              status: run.ok ? "succeeded" : "failed",
              classification: classification.category,
              exitCode: run.exitCode,
              signal: run.signal,
              timedOut: run.timedOut,
              durationMs: run.durationMs,
              stdout: run.stdout,
              stderr: run.stderr,
            });

            if (run.ok) {
              finalResult = { ...attemptResult, attempts, retryCount: attempt - 1 };
              break;
            }

            const hasRetry = attempt <= args.maxRetriesPerCheck;
            if (hasRetry && classification.retryable) {
              appendLedgerEvent(ledgerAbsolutePath, {
                schema: "intent-run-event.v1",
                at: new Date().toISOString(),
                eventType: "check_retry_scheduled",
                runId: args.runId,
                mode,
                taskId,
                intentId,
                command,
                attempt,
                classification: classification.category,
              });
              continue;
            }

            finalResult = { ...attemptResult, attempts, retryCount: attempt - 1 };
            break;
          }

          checkResults.push(finalResult);

          if (!finalResult.ok) {
            taskStatus = "failed";
            taskReason = `check_failed:${command}:${finalResult.classification}`;
            const deadLetterRow = {
              schema: "intent-dead-letter.v1",
              at: new Date().toISOString(),
              runId: args.runId,
              taskId,
              intentId,
              status: "failed",
              reason: taskReason,
              classification: finalResult.classification,
              retryEligible: ["transient_timeout", "transient_network", "quota"].includes(finalResult.classification),
            };
            appendDeadLetter(deadLetterAbsolutePath, deadLetterRow);
            deadLetterRows.push(deadLetterRow);
            break;
          }
        }
      }

      taskStates.set(taskId, taskStatus === "planned" ? "succeeded" : taskStatus);
      taskResults.push({
        taskId,
        intentId,
        status: taskStatus,
        reason: taskReason,
        checks: checkResults,
      });

      appendLedgerEvent(ledgerAbsolutePath, {
        schema: "intent-run-event.v1",
        at: new Date().toISOString(),
        eventType: "task_finished",
        runId: args.runId,
        mode,
        taskId,
        intentId,
        status: taskStatus,
        reason: taskReason,
      });

      if (taskStatus === "failed" && !args.continueOnError) {
        break;
      }
    }
  }

  const summary = {
    total: taskResults.length,
    succeeded: taskResults.filter((row) => row.status === "succeeded").length,
    succeededResume: taskResults.filter((row) => row.status === "succeeded_resume").length,
    planned: taskResults.filter((row) => row.status === "planned").length,
    failed: taskResults.filter((row) => row.status === "failed").length,
    blocked: taskResults.filter((row) => row.status === "blocked").length,
    deferredMissingEval: 0,
    qualityGateFailedIntents: 0,
    retriesUsed: taskResults.reduce(
      (sum, row) =>
        sum +
        (Array.isArray(row.checks)
          ? row.checks.reduce((checkSum, check) => checkSum + Number(check?.retryCount || 0), 0)
          : 0),
      0
    ),
    deadLetterCount: deadLetterRows.length,
  };

  let runStatus = preflightBlocked || summary.failed > 0 || summary.blocked > 0 ? "fail" : "pass";

  let provisionalReport = buildRunReport({
    runStatus,
    args,
    mode,
    resume: args.resume,
    planAbsolutePath,
    plan,
    ledgerAbsolutePath,
    reportAbsolutePath,
    runArtifactsAbsolutePath,
    taskResults,
    summary,
    orderedTasks,
    hooks,
  });
  writeReport(reportAbsolutePath, provisionalReport);

  if (mode === "execute") {
    for (const intentId of selectedIntentIds) {
      const intent = intentMap.get(intentId) || null;
      const evaluation = intent?.evaluation || null;
      if (!evaluation || evaluation.required !== true) continue;

      const evalArtifactPath = resolve(runArtifactsAbsolutePath, `eval-result.${intentId}.json`);
      const evalArgs = [
        "./scripts/eval-runner.mjs",
        "--json",
        "--intent-id",
        intentId,
        "--suite",
        String(evaluation.suite || ""),
        "--threshold",
        String(args.evalThreshold !== null ? args.evalThreshold : Number(evaluation.threshold || 1)),
        "--run-report",
        args.reportPath,
        "--artifact",
        toRepoPath(evalArtifactPath),
      ];
      const evalResult = runNodeScript(evalArgs[0], evalArgs.slice(1));
      const evalStatus = evalResult.parsed?.status || (evalResult.ok ? "pass" : "fail");

      hooks.evaluations.push({
        intentId,
        status: evalStatus,
        score: Number(evalResult.parsed?.score || 0),
        threshold: Number(
          evalResult.parsed?.threshold || (args.evalThreshold !== null ? args.evalThreshold : Number(evaluation.threshold || 1))
        ),
        artifactPath: toRepoPath(evalArtifactPath),
      });

      appendLedgerEvent(ledgerAbsolutePath, {
        schema: "intent-run-event.v1",
        at: new Date().toISOString(),
        eventType: "evaluation_finished",
        runId: args.runId,
        mode,
        intentId,
        status: evalStatus,
        artifactPath: toRepoPath(evalArtifactPath),
      });

      if (evalStatus === "deferred_missing_eval") {
        summary.deferredMissingEval += 1;
      }
      if (evalStatus === "fail") {
        summary.qualityGateFailedIntents += 1;
      }
    }

    const evalSummaryJsonPath = resolve(runArtifactsAbsolutePath, "eval-summary.json");
    const evalSummaryMdPath = resolve(runArtifactsAbsolutePath, "eval-summary.md");
    const evalReportArgs = [
      "./scripts/eval-report.mjs",
      "--json",
      "--run-id",
      args.runId,
      "--run-report",
      args.reportPath,
      "--run-artifacts-dir",
      toRepoPath(runArtifactsAbsolutePath),
      "--artifact-json",
      toRepoPath(evalSummaryJsonPath),
      "--artifact-markdown",
      toRepoPath(evalSummaryMdPath),
    ];
    const evalReportResult = runNodeScript(evalReportArgs[0], evalReportArgs.slice(1));
    hooks.evalSummary = {
      ok: evalReportResult.ok,
      artifactPath: toRepoPath(evalSummaryJsonPath),
      markdownPath: toRepoPath(evalSummaryMdPath),
    };

    const budgetPostflightPath = resolve(runArtifactsAbsolutePath, "budget-postflight.json");
    const budgetPostflightArgs = [
      "./scripts/intent-budget-controller.mjs",
      "--mode",
      "postflight",
      "--json",
      "--strict",
      "--plan",
      args.planPath,
      "--budget",
      args.budgetPath,
      "--infra-phase",
      args.infraPhase,
      "--run-report",
      args.reportPath,
      "--artifact",
      toRepoPath(budgetPostflightPath),
      ...selectedIntentIds.flatMap((intentId) => ["--intent-id", intentId]),
    ];
    const budgetPostflightResult = runNodeScript(budgetPostflightArgs[0], budgetPostflightArgs.slice(1));
    hooks.budgetPostflight = {
      ok: budgetPostflightResult.ok,
      artifactPath: toRepoPath(budgetPostflightPath),
      status: budgetPostflightResult.parsed?.status || (budgetPostflightResult.ok ? "pass" : "fail"),
    };

    const memoryGovernancePath = resolve(runArtifactsAbsolutePath, "memory-governance.json");
    const memoryGovernanceArgs = [
      "./scripts/intent-memory-governance.mjs",
      "--json",
      "--run-id",
      args.runId,
      "--input",
      args.memoryInputPath,
      "--artifact",
      toRepoPath(memoryGovernancePath),
    ];
    const memoryGovernanceResult = runNodeScript(memoryGovernanceArgs[0], memoryGovernanceArgs.slice(1));
    hooks.memoryGovernance = {
      ok: memoryGovernanceResult.ok,
      artifactPath: toRepoPath(memoryGovernancePath),
      status: memoryGovernanceResult.parsed?.status || (memoryGovernanceResult.ok ? "pass" : "fail"),
      lowConfidenceCount: Number(memoryGovernanceResult.parsed?.summary?.lowConfidence || 0),
      experimentModeArmed: Number(memoryGovernanceResult.parsed?.summary?.lowConfidence || 0) > 0,
    };
    if (hooks.memoryGovernance.experimentModeArmed) {
      appendLedgerEvent(ledgerAbsolutePath, {
        schema: "intent-run-event.v1",
        at: new Date().toISOString(),
        eventType: "low_confidence_experiment_mode_armed",
        runId: args.runId,
        mode,
        lowConfidenceCount: hooks.memoryGovernance.lowConfidenceCount,
      });
    }

    const safetyRailsPostflightPath = resolve(runArtifactsAbsolutePath, "safety-rails-postflight.json");
    const safetySnapshotPath = resolve(runArtifactsAbsolutePath, "rathole-snapshot-postflight.json");
    const safetyRailsPostflightArgs = [
      "./scripts/intent-safety-rails.mjs",
      "--mode",
      "postflight",
      "--json",
      "--strict",
      "--plan",
      args.planPath,
      "--run-report",
      args.reportPath,
      "--ledger",
      args.ledgerPath,
      "--config",
      args.safetyRailsPath,
      "--infra-phase",
      args.infraPhase,
      "--run-id",
      args.runId,
      "--artifact",
      toRepoPath(safetyRailsPostflightPath),
      "--snapshot",
      toRepoPath(safetySnapshotPath),
    ];
    const safetyRailsPostflightResult = runNodeScript(safetyRailsPostflightArgs[0], safetyRailsPostflightArgs.slice(1));
    hooks.safetyRailsPostflight = {
      ok: safetyRailsPostflightResult.ok,
      artifactPath: toRepoPath(safetyRailsPostflightPath),
      status: safetyRailsPostflightResult.parsed?.status || (safetyRailsPostflightResult.ok ? "pass" : "fail"),
      snapshotPath: toRepoPath(safetySnapshotPath),
    };
    appendLedgerEvent(ledgerAbsolutePath, {
      schema: "intent-run-event.v1",
      at: new Date().toISOString(),
      eventType: "postflight_safety_rails_finished",
      runId: args.runId,
      mode,
      status: hooks.safetyRailsPostflight.status,
      artifactPath: hooks.safetyRailsPostflight.artifactPath,
      snapshotPath: hooks.safetyRailsPostflight.snapshotPath,
    });

    const replayDeterminismPath = resolve(runArtifactsAbsolutePath, "replay-determinism.json");
    const replayDeterminismArgs = [
      "./scripts/intent-replay-determinism.mjs",
      "--json",
      "--strict",
      "--run-id",
      args.runId,
      "--ledger",
      args.ledgerPath,
      "--artifact",
      toRepoPath(replayDeterminismPath),
    ];
    const replayDeterminismResult = runNodeScript(replayDeterminismArgs[0], replayDeterminismArgs.slice(1));
    hooks.replayDeterminism = {
      ok: replayDeterminismResult.ok,
      artifactPath: toRepoPath(replayDeterminismPath),
      status: replayDeterminismResult.parsed?.status || (replayDeterminismResult.ok ? "pass" : "fail"),
      score: Number(replayDeterminismResult.parsed?.score || 0),
    };
    appendLedgerEvent(ledgerAbsolutePath, {
      schema: "intent-run-event.v1",
      at: new Date().toISOString(),
      eventType: "postflight_replay_determinism_finished",
      runId: args.runId,
      mode,
      status: hooks.replayDeterminism.status,
      score: hooks.replayDeterminism.score,
      artifactPath: hooks.replayDeterminism.artifactPath,
    });

    const errorBudgetGatePath = resolve(runArtifactsAbsolutePath, "error-budget-gate.json");
    const errorBudgetGateArgs = [
      "./scripts/intent-error-budget-gate.mjs",
      "--json",
      "--strict",
      "--run-id",
      args.runId,
      "--run-report",
      args.reportPath,
      "--ledger",
      args.ledgerPath,
      "--budget",
      args.budgetPath,
      "--artifact",
      toRepoPath(errorBudgetGatePath),
    ];
    const errorBudgetGateResult = runNodeScript(errorBudgetGateArgs[0], errorBudgetGateArgs.slice(1));
    hooks.errorBudgetGate = {
      ok: errorBudgetGateResult.ok,
      artifactPath: toRepoPath(errorBudgetGatePath),
      status: errorBudgetGateResult.parsed?.status || (errorBudgetGateResult.ok ? "pass" : "fail"),
    };
    appendLedgerEvent(ledgerAbsolutePath, {
      schema: "intent-run-event.v1",
      at: new Date().toISOString(),
      eventType: "postflight_error_budget_finished",
      runId: args.runId,
      mode,
      status: hooks.errorBudgetGate.status,
      artifactPath: hooks.errorBudgetGate.artifactPath,
    });

    if (summary.deferredMissingEval > 0 || summary.qualityGateFailedIntents > 0) {
      runStatus = "fail";
    }
    if (hooks.budgetPostflight && hooks.budgetPostflight.ok === false && hookFailureBlocks(runtimeControls, "budgetPostflight")) {
      runStatus = "fail";
    }
    if (hooks.memoryGovernance && hooks.memoryGovernance.ok === false && hookFailureBlocks(runtimeControls, "memoryGovernance")) {
      runStatus = "fail";
    }
    if (
      hooks.safetyRailsPostflight &&
      hooks.safetyRailsPostflight.ok === false &&
      hookFailureBlocks(runtimeControls, "safetyRailsPostflight")
    ) {
      runStatus = "fail";
    }
    if (
      hooks.replayDeterminism &&
      hooks.replayDeterminism.ok === false &&
      hookFailureBlocks(runtimeControls, "replayDeterminism")
    ) {
      runStatus = "fail";
    }
    if (hooks.errorBudgetGate && hooks.errorBudgetGate.ok === false && hookFailureBlocks(runtimeControls, "errorBudgetGate")) {
      runStatus = "fail";
    }
  }

  const finalReport = buildRunReport({
    runStatus,
    args,
    mode,
    resume: args.resume,
    planAbsolutePath,
    plan,
    ledgerAbsolutePath,
    reportAbsolutePath,
    runArtifactsAbsolutePath,
    taskResults,
    summary,
    orderedTasks,
    hooks,
  });
  writeReport(reportAbsolutePath, finalReport);

  appendLedgerEvent(ledgerAbsolutePath, {
    schema: "intent-run-event.v1",
    at: new Date().toISOString(),
    eventType: "run_finished",
    runId: args.runId,
    mode,
    status: runStatus,
    summary,
    planDigestSha256: plan.planDigestSha256,
  });

  const timelinePath = resolve(runArtifactsAbsolutePath, "mission-timeline.ndjson");
  const timelineSummaryPath = resolve(runArtifactsAbsolutePath, "mission-timeline-summary.json");
  const timelineArgs = [
    "./scripts/intent-mission-timeline.mjs",
    "--json",
    "--run-id",
    args.runId,
    "--ledger",
    args.ledgerPath,
    "--run-artifacts-dir",
    toRepoPath(runArtifactsAbsolutePath),
    "--output",
    toRepoPath(timelinePath),
    "--summary",
    toRepoPath(timelineSummaryPath),
  ];
  const timelineResult = runNodeScript(timelineArgs[0], timelineArgs.slice(1));
  hooks.missionTimeline = {
    ok: timelineResult.ok,
    outputPath: toRepoPath(timelinePath),
    summaryPath: toRepoPath(timelineSummaryPath),
  };

  const finalReportWithTimeline = buildRunReport({
    runStatus,
    args,
    mode,
    resume: args.resume,
    planAbsolutePath,
    plan,
    ledgerAbsolutePath,
    reportAbsolutePath,
    runArtifactsAbsolutePath,
    taskResults,
    summary,
    orderedTasks,
    hooks,
  });
  writeReport(reportAbsolutePath, finalReportWithTimeline);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(finalReportWithTimeline, null, 2)}\n`);
  } else {
    process.stdout.write(`intent-runner status: ${finalReportWithTimeline.status}\n`);
    process.stdout.write(`runId: ${args.runId}\n`);
    process.stdout.write(`mode: ${mode}\n`);
    process.stdout.write(
      `tasks: ${summary.total} (pass=${summary.succeeded + summary.succeededResume + summary.planned}, fail=${summary.failed}, blocked=${summary.blocked})\n`
    );
    process.stdout.write(`ledger: ${ledgerAbsolutePath}\n`);
    process.stdout.write(`report: ${reportAbsolutePath}\n`);
  }

  if (finalReportWithTimeline.status !== "pass") {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`intent-runner failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
