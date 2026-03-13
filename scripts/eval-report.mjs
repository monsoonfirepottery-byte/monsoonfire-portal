#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function parseArgs(argv) {
  const parsed = {
    json: false,
    runId: "",
    runReportPath: "",
    runArtifactsDir: "",
    artifactJson: "",
    artifactMarkdown: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (!arg) continue;

    if (arg === "--json") {
      parsed.json = true;
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

    if ((arg === "--run-report" || arg === "--report-input") && argv[index + 1]) {
      parsed.runReportPath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--run-report=")) {
      parsed.runReportPath = arg.slice("--run-report=".length).trim();
      continue;
    }

    if ((arg === "--run-artifacts-dir" || arg === "--dir") && argv[index + 1]) {
      parsed.runArtifactsDir = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--run-artifacts-dir=")) {
      parsed.runArtifactsDir = arg.slice("--run-artifacts-dir=".length).trim();
      continue;
    }

    if ((arg === "--artifact-json" || arg === "--json-out") && argv[index + 1]) {
      parsed.artifactJson = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact-json=")) {
      parsed.artifactJson = arg.slice("--artifact-json=".length).trim();
      continue;
    }

    if ((arg === "--artifact-markdown" || arg === "--markdown-out") && argv[index + 1]) {
      parsed.artifactMarkdown = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact-markdown=")) {
      parsed.artifactMarkdown = arg.slice("--artifact-markdown=".length).trim();
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Eval report builder",
          "",
          "Usage:",
          "  node ./scripts/eval-report.mjs --run-id <id> --run-report <path> --run-artifacts-dir <dir>",
          "",
          "Options:",
          "  --artifact-json <path>       JSON summary output path",
          "  --artifact-markdown <path>   Markdown summary output path",
        ].join("\n")
      );
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.runId) throw new Error("--run-id is required.");
  if (!parsed.runReportPath) throw new Error("--run-report is required.");
  if (!parsed.runArtifactsDir) throw new Error("--run-artifacts-dir is required.");

  if (!parsed.artifactJson) {
    parsed.artifactJson = `${parsed.runArtifactsDir}/eval-summary.json`;
  }
  if (!parsed.artifactMarkdown) {
    parsed.artifactMarkdown = `${parsed.runArtifactsDir}/eval-summary.md`;
  }

  return parsed;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function listByPrefix(rootDir, prefix) {
  if (!existsSync(rootDir)) return [];
  return readdirSync(rootDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .sort()
    .map((name) => resolve(rootDir, name));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runReportPath = resolve(REPO_ROOT, args.runReportPath);
  const runArtifactsDir = resolve(REPO_ROOT, args.runArtifactsDir);
  const artifactJsonPath = resolve(REPO_ROOT, args.artifactJson);
  const artifactMarkdownPath = resolve(REPO_ROOT, args.artifactMarkdown);

  if (!existsSync(runReportPath)) {
    throw new Error(`Run report not found at ${runReportPath}`);
  }

  const runReport = readJson(runReportPath);
  const simReports = listByPrefix(runArtifactsDir, "sim-result.");
  const evalReports = listByPrefix(runArtifactsDir, "eval-result.");
  const parsedSimReports = simReports.map((path) => readJson(path));
  const parsedEvalReports = evalReports.map((path) => readJson(path));

  const summary = {
    schema: "intent-eval-summary.v1",
    generatedAt: new Date().toISOString(),
    runId: args.runId,
    runStatus: String(runReport.status || "unknown"),
    totals: {
      taskCount: Number(runReport.summary?.total || 0),
      succeeded: Number(runReport.summary?.succeeded || 0) + Number(runReport.summary?.succeededResume || 0),
      failed: Number(runReport.summary?.failed || 0),
      blocked: Number(runReport.summary?.blocked || 0),
      evalPass: parsedEvalReports.filter((row) => row.status === "pass").length,
      evalFail: parsedEvalReports.filter((row) => row.status === "fail").length,
      evalDeferred: parsedEvalReports.filter((row) => row.status === "deferred_missing_eval").length,
      simPass: parsedSimReports.filter((row) => row.status === "pass").length,
      simFail: parsedSimReports.filter((row) => row.status !== "pass").length,
    },
    simulation: parsedSimReports,
    evaluation: parsedEvalReports,
  };

  const lines = [];
  lines.push(`# Intent Eval Summary (${args.runId})`);
  lines.push("");
  lines.push(`- Run status: ${summary.runStatus}`);
  lines.push(
    `- Tasks: ${summary.totals.taskCount} (succeeded=${summary.totals.succeeded}, failed=${summary.totals.failed}, blocked=${summary.totals.blocked})`
  );
  lines.push(
    `- Simulation: pass=${summary.totals.simPass}, fail=${summary.totals.simFail}`
  );
  lines.push(
    `- Evaluation: pass=${summary.totals.evalPass}, fail=${summary.totals.evalFail}, deferred=${summary.totals.evalDeferred}`
  );

  if (summary.evaluation.length > 0) {
    lines.push("");
    lines.push("## Evaluation Details");
    for (const row of summary.evaluation) {
      lines.push(
        `- ${row.intentId}: status=${row.status} score=${Number(row.score ?? 0).toFixed(3)} threshold=${Number(
          row.threshold ?? 0
        ).toFixed(3)}`
      );
    }
  }

  mkdirSync(dirname(artifactJsonPath), { recursive: true });
  mkdirSync(dirname(artifactMarkdownPath), { recursive: true });
  writeFileSync(artifactJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  writeFileSync(artifactMarkdownPath, `${lines.join("\n")}\n`, "utf8");

  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`eval-summary runId: ${summary.runId}\n`);
    process.stdout.write(`json: ${artifactJsonPath}\n`);
    process.stdout.write(`markdown: ${artifactMarkdownPath}\n`);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`eval-report failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
