#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function parseArgs(argv) {
  const parsed = {
    json: false,
    strict: true,
    baseRef: process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main",
    headRef: process.env.GITHUB_SHA || "HEAD",
    artifact: "output/intent/intent-eval-gate-report.json",
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
    if (arg === "--no-strict") {
      parsed.strict = false;
      continue;
    }
    if (arg === "--base-ref" && argv[index + 1]) {
      parsed.baseRef = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--base-ref=")) {
      parsed.baseRef = arg.slice("--base-ref=".length).trim();
      continue;
    }
    if (arg === "--head-ref" && argv[index + 1]) {
      parsed.headRef = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--head-ref=")) {
      parsed.headRef = arg.slice("--head-ref=".length).trim();
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
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Intent eval gate",
          "",
          "Usage:",
          "  node ./scripts/intent-eval-gate.mjs --json --strict",
          "",
          "Checks changed intent contracts and ensures required evaluation suites are valid.",
        ].join("\n")
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function runGitDiff(baseRef, headRef) {
  const result = spawnSync("git", ["diff", "--name-only", `${baseRef}...${headRef}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    // Fall back to staged/worktree diff in local/dev runs.
    const fallback = spawnSync("git", ["diff", "--name-only"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (fallback.status !== 0) {
      return [];
    }
    return String(fallback.stdout || "")
      .split(/\r?\n/)
      .map((row) => row.trim())
      .filter(Boolean);
  }

  return String(result.stdout || "")
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifactAbsolutePath = resolve(REPO_ROOT, args.artifact);
  const changedPaths = runGitDiff(args.baseRef, args.headRef);
  const changedIntentPaths = changedPaths.filter((path) => path.startsWith("intents/") && path.endsWith(".intent.json"));

  const findings = [];
  const checked = [];

  for (const intentPath of changedIntentPaths) {
    const absolute = resolve(REPO_ROOT, intentPath);
    if (!existsSync(absolute)) continue;

    const intent = readJson(absolute);
    const evaluation = intent?.evaluation || null;
    if (!evaluation || evaluation.required !== true) {
      continue;
    }

    const suitePath = String(evaluation.suite || "").trim();
    if (!suitePath) {
      findings.push({
        severity: "error",
        code: "missing_eval_suite_path",
        intentPath,
        message: "evaluation.required=true but evaluation.suite is missing.",
      });
      continue;
    }

    const suiteAbsolute = resolve(REPO_ROOT, suitePath);
    if (!existsSync(suiteAbsolute)) {
      findings.push({
        severity: "error",
        code: "missing_eval_suite_file",
        intentPath,
        suitePath,
        message: `Evaluation suite file not found: ${suitePath}`,
      });
      continue;
    }

    const suite = readJson(suiteAbsolute);
    const cases = Array.isArray(suite.cases) ? suite.cases : [];
    const totalWeight = cases.reduce((sum, row) => sum + Number(row?.weight || 0), 0);
    const threshold = Number(evaluation.threshold);
    const suiteIntentId = String(suite.intentId || "");

    checked.push({
      intentId: String(intent.intentId || ""),
      intentPath,
      suitePath,
      caseCount: cases.length,
      totalWeight,
      threshold,
    });

    if (suiteIntentId && suiteIntentId !== intent.intentId) {
      findings.push({
        severity: "error",
        code: "suite_intent_mismatch",
        intentPath,
        suitePath,
        message: `Suite intentId ${suiteIntentId} does not match intentId ${intent.intentId}.`,
      });
    }
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      findings.push({
        severity: "error",
        code: "invalid_eval_threshold",
        intentPath,
        suitePath,
        message: "evaluation.threshold must be a number in [0, 1].",
      });
    }
    if (cases.length === 0) {
      findings.push({
        severity: "error",
        code: "empty_eval_suite",
        intentPath,
        suitePath,
        message: "Evaluation suite must define at least one case.",
      });
    }
    if (!(totalWeight > 0)) {
      findings.push({
        severity: "error",
        code: "invalid_eval_weights",
        intentPath,
        suitePath,
        message: "Evaluation suite total case weight must be > 0.",
      });
    }
  }

  const errors = findings.filter((row) => row.severity === "error").length;
  const status = errors > 0 ? "fail" : "pass";

  const report = {
    schema: "intent-eval-gate-report.v1",
    generatedAt: new Date().toISOString(),
    status,
    strict: args.strict,
    baseRef: args.baseRef,
    headRef: args.headRef,
    changedPathCount: changedPaths.length,
    changedIntentCount: changedIntentPaths.length,
    checkedCount: checked.length,
    checked,
    findings,
  };

  mkdirSync(dirname(artifactAbsolutePath), { recursive: true });
  writeFileSync(artifactAbsolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`intent-eval-gate status: ${status}\n`);
    process.stdout.write(`report: ${artifactAbsolutePath}\n`);
  }

  if (status !== "pass" && args.strict) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`intent-eval-gate failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
