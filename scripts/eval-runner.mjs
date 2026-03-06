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
    intentId: "",
    suitePath: "",
    threshold: null,
    runReportPath: "output/intent/intent-run-report.json",
    artifact: "output/intent/eval-result.json",
    allowMissingSuite: true,
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

    if (arg === "--intent-id" && argv[index + 1]) {
      parsed.intentId = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--intent-id=")) {
      parsed.intentId = arg.slice("--intent-id=".length).trim();
      continue;
    }

    if (arg === "--suite" && argv[index + 1]) {
      parsed.suitePath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--suite=")) {
      parsed.suitePath = arg.slice("--suite=".length).trim();
      continue;
    }

    if (arg === "--threshold" && argv[index + 1]) {
      parsed.threshold = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--threshold=")) {
      parsed.threshold = Number(arg.slice("--threshold=".length));
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

    if ((arg === "--artifact" || arg === "--report") && argv[index + 1]) {
      parsed.artifact = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      parsed.artifact = arg.slice("--artifact=".length).trim();
      continue;
    }

    if (arg === "--allow-missing-suite") {
      parsed.allowMissingSuite = true;
      continue;
    }
    if (arg === "--no-allow-missing-suite") {
      parsed.allowMissingSuite = false;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Eval runner",
          "",
          "Usage:",
          "  node ./scripts/eval-runner.mjs --intent-id <intentId> --suite <path> [--threshold 0.9]",
          "",
          "Options:",
          "  --run-report <path>          Intent run report input",
          "  --artifact <path>            Eval result output path",
          "  --allow-missing-suite        Emit deferred_missing_eval when suite is absent",
          "  --no-allow-missing-suite     Treat missing suite as hard failure",
        ].join("\n")
      );
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.intentId) {
    throw new Error("--intent-id is required.");
  }
  if (!Number.isFinite(parsed.threshold) && parsed.threshold !== null) {
    throw new Error("--threshold must be a number when provided.");
  }
  return parsed;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function evaluateCase({ caseRow, intentTasks, summary, succeededCommands }) {
  const type = String(caseRow.type || "").trim();
  if (!type) {
    return {
      passed: false,
      details: { reason: "missing_case_type" },
    };
  }

  if (type === "summary.failed_max") {
    const max = Number(caseRow.max);
    const passed = Number.isFinite(max) ? summary.failed <= max : false;
    return { passed, details: { observed: summary.failed, max } };
  }

  if (type === "summary.blocked_max") {
    const max = Number(caseRow.max);
    const passed = Number.isFinite(max) ? summary.blocked <= max : false;
    return { passed, details: { observed: summary.blocked, max } };
  }

  if (type === "summary.succeeded_min") {
    const min = Number(caseRow.min);
    const passed = Number.isFinite(min) ? summary.succeeded >= min : false;
    return { passed, details: { observed: summary.succeeded, min } };
  }

  if (type === "check.succeeded") {
    const command = String(caseRow.command || "").trim();
    const passed = command ? succeededCommands.has(command) : false;
    return { passed, details: { command } };
  }

  if (type === "task.status") {
    const taskId = String(caseRow.taskId || "").trim();
    const expectedStatus = String(caseRow.status || "").trim();
    const task = intentTasks.find((row) => String(row.taskId || "") === taskId) || null;
    const observedStatus = task ? String(task.status || "unknown") : "missing";
    return {
      passed: Boolean(task && expectedStatus && observedStatus === expectedStatus),
      details: { taskId, expectedStatus, observedStatus },
    };
  }

  return {
    passed: false,
    details: { reason: `unsupported_case_type:${type}` },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifactAbsolutePath = resolve(REPO_ROOT, args.artifact);
  const runReportAbsolutePath = resolve(REPO_ROOT, args.runReportPath);
  const suiteAbsolutePath = args.suitePath ? resolve(REPO_ROOT, args.suitePath) : "";

  if (!existsSync(runReportAbsolutePath)) {
    throw new Error(`Run report not found at ${args.runReportPath}`);
  }
  const runReport = readJson(runReportAbsolutePath);

  const intentTasks = (Array.isArray(runReport.tasks) ? runReport.tasks : []).filter((task) => task.intentId === args.intentId);
  const summary = {
    total: intentTasks.length,
    succeeded: intentTasks.filter((row) => row.status === "succeeded" || row.status === "succeeded_resume").length,
    failed: intentTasks.filter((row) => row.status === "failed").length,
    blocked: intentTasks.filter((row) => row.status === "blocked").length,
  };

  const succeededCommands = new Set();
  for (const task of intentTasks) {
    for (const check of Array.isArray(task.checks) ? task.checks : []) {
      if (check?.ok && typeof check.command === "string") {
        succeededCommands.add(check.command);
      }
    }
  }

  if (!suiteAbsolutePath || !existsSync(suiteAbsolutePath)) {
    const missingReport = {
      schema: "intent-eval-result.v1",
      generatedAt: new Date().toISOString(),
      intentId: args.intentId,
      suiteId: "missing",
      suitePath: args.suitePath || "",
      threshold: Number.isFinite(args.threshold) ? args.threshold : 1,
      score: 0,
      status: "deferred_missing_eval",
      summary: {
        totalCases: 0,
        passedCases: 0,
        failedCases: 0,
        requiredFailures: 0,
      },
      cases: [],
    };
    mkdirSync(dirname(artifactAbsolutePath), { recursive: true });
    writeFileSync(artifactAbsolutePath, `${JSON.stringify(missingReport, null, 2)}\n`, "utf8");
    if (args.json) {
      process.stdout.write(`${JSON.stringify(missingReport, null, 2)}\n`);
    } else {
      process.stdout.write(`eval-runner status: ${missingReport.status}\n`);
      process.stdout.write(`intent: ${missingReport.intentId}\n`);
      process.stdout.write(`report: ${artifactAbsolutePath}\n`);
    }
    if (!args.allowMissingSuite) {
      process.exitCode = 1;
    }
    return;
  }

  const suite = readJson(suiteAbsolutePath);
  const threshold =
    Number.isFinite(args.threshold) && args.threshold !== null ? Number(args.threshold) : Number(suite.threshold ?? 1);
  const cases = Array.isArray(suite.cases) ? suite.cases : [];

  const evaluatedCases = cases.map((caseRow) => {
    const weight = Number(caseRow.weight);
    const required = caseRow.required === true;
    const outcome = evaluateCase({ caseRow, intentTasks, summary, succeededCommands });
    return {
      id: String(caseRow.id || "case-unknown"),
      title: String(caseRow.title || "Untitled case"),
      type: String(caseRow.type || "unknown"),
      required,
      weight: Number.isFinite(weight) ? weight : 0,
      passed: Boolean(outcome.passed),
      details: outcome.details || {},
    };
  });

  const totalWeight = evaluatedCases.reduce((sum, row) => sum + row.weight, 0);
  const passedWeight = evaluatedCases.filter((row) => row.passed).reduce((sum, row) => sum + row.weight, 0);
  const score = totalWeight > 0 ? Number((passedWeight / totalWeight).toFixed(6)) : 1;
  const requiredFailures = evaluatedCases.filter((row) => row.required && !row.passed).length;
  const failedCases = evaluatedCases.filter((row) => !row.passed).length;
  const status = requiredFailures > 0 || score < threshold ? "fail" : "pass";

  const report = {
    schema: "intent-eval-result.v1",
    generatedAt: new Date().toISOString(),
    intentId: args.intentId,
    suiteId: String(suite.suiteId || "unnamed-suite"),
    suitePath: args.suitePath,
    threshold,
    score,
    status,
    summary: {
      totalCases: evaluatedCases.length,
      passedCases: evaluatedCases.filter((row) => row.passed).length,
      failedCases,
      requiredFailures,
    },
    cases: evaluatedCases,
  };

  mkdirSync(dirname(artifactAbsolutePath), { recursive: true });
  writeFileSync(artifactAbsolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`eval-runner status: ${report.status}\n`);
    process.stdout.write(`intent: ${report.intentId}\n`);
    process.stdout.write(`score: ${report.score} threshold=${report.threshold}\n`);
    process.stdout.write(`report: ${artifactAbsolutePath}\n`);
  }

  if (report.status !== "pass") {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`eval-runner failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
