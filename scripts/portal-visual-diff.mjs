#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  buildVisualDiffAggregateJson,
  buildVisualDiffAggregateMarkdown,
  normalizeVisualDiffId,
  writeJson,
} from "./lib/portal-visual-diff.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");
const DEFAULT_BASE_URL = "https://portal.monsoonfire.com";
const DEFAULT_OUTPUT_ROOT = resolve(repoRoot, "output", "qa", "portal-visual-diff");
const DEFAULT_MODE = "compare";

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.PORTAL_CANARY_BASE_URL || DEFAULT_BASE_URL,
    mode: String(process.env.PORTAL_VISUAL_DIFF_MODE || DEFAULT_MODE).trim().toLowerCase(),
    outputRoot: process.env.PORTAL_VISUAL_DIFF_OUTPUT_ROOT || DEFAULT_OUTPUT_ROOT,
    baselineRoot: process.env.PORTAL_VISUAL_DIFF_BASELINE_ROOT || "",
    headed: false,
    asJson: false,
    scripts: ["portal-authenticated-canary", "portal-community-layout-canary", "portal-playwright-smoke"],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;
    if (arg === "--base-url") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --base-url");
      options.baseUrl = String(next).trim().replace(/\/+$/, "");
      index += 1;
      continue;
    }
    if (arg === "--mode") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --mode");
      options.mode = String(next).trim().toLowerCase();
      index += 1;
      continue;
    }
    if (arg === "--output-root") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --output-root");
      options.outputRoot = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--baseline-root") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --baseline-root");
      options.baselineRoot = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--headed") {
      options.headed = true;
      continue;
    }
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--only") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --only");
      options.scripts = String(next)
        .split(",")
        .map((value) => normalizeVisualDiffId(value))
        .filter(Boolean);
      index += 1;
      continue;
    }
  }

  return options;
}

function scriptCommand(scriptKey, options, runDir) {
  const scriptPath = resolve(repoRoot, "scripts", `${scriptKey}.mjs`);
  const reportPath = resolve(runDir, `${scriptKey}.json`);
  const outputDir = resolve(runDir, scriptKey);
  const args = [
    scriptPath,
    "--base-url",
    options.baseUrl,
    "--output-dir",
    outputDir,
    "--report",
    reportPath,
    "--visual-diff-mode",
    options.mode,
    "--visual-diff-output-root",
    options.outputRoot,
  ];
  if (options.baselineRoot) {
    args.push("--visual-diff-baseline-root", options.baselineRoot);
  }
  if (options.headed) {
    args.push("--headed");
  }
  return { args, reportPath, outputDir, scriptPath };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = resolve(options.outputRoot, "runs", runId);
  await mkdir(runDir, { recursive: true });

  const startedAtIso = new Date().toISOString();
  const aggregate = {
    status: "running",
    startedAtIso,
    finishedAtIso: "",
    mode: options.mode,
    baseUrl: options.baseUrl,
    runId,
    runDir,
    outputRoot: options.outputRoot,
    baselineRoot: options.baselineRoot || "",
    scripts: [],
    reports: [],
    errors: [],
  };

  for (const scriptKey of options.scripts) {
    const command = scriptCommand(scriptKey, options, runDir);
    const result = spawnSync(process.execPath, command.args, { cwd: repoRoot, stdio: "inherit" });
    const scriptResult = {
      scriptKey,
      exitCode: Number(result.status ?? 0),
      signal: result.signal || "",
      reportPath: command.reportPath,
      outputDir: command.outputDir,
    };
    aggregate.scripts.push(scriptResult);
    if (result.error) {
      aggregate.errors.push(`${scriptKey}: ${result.error.message || String(result.error)}`);
    }
    if ((result.status ?? 0) !== 0) {
      aggregate.errors.push(`${scriptKey}: exited ${String(result.status ?? 0)}`);
    }
    try {
      const report = JSON.parse(await readFile(command.reportPath, "utf8"));
      aggregate.reports.push(report);
    } catch (error) {
      aggregate.errors.push(`${scriptKey}: report read failed (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  aggregate.finishedAtIso = new Date().toISOString();
  aggregate.status =
    aggregate.errors.length > 0 || aggregate.reports.some((report) => report?.status === "failed")
      ? "failed"
      : "passed";

  const summaryJson = buildVisualDiffAggregateJson(aggregate.reports);
  summaryJson.status = aggregate.status;
  summaryJson.mode = options.mode;
  summaryJson.baseUrl = options.baseUrl;
  summaryJson.runDir = runDir;
  summaryJson.errors = aggregate.errors;

  const reportPath = resolve(runDir, "portal-visual-diff.json");
  const markdownPath = resolve(runDir, "portal-visual-diff.md");
  summaryJson.reportPath = reportPath;
  summaryJson.markdownPath = markdownPath;
  await writeJson(reportPath, summaryJson);
  await writeFile(markdownPath, `${buildVisualDiffAggregateMarkdown(aggregate.reports, markdownPath)}\n`, "utf8");

  const latestJson = resolve(options.outputRoot, "latest.json");
  const latestMd = resolve(options.outputRoot, "latest.md");
  await writeJson(latestJson, summaryJson);
  await writeFile(latestMd, `${buildVisualDiffAggregateMarkdown(aggregate.reports, latestMd)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summaryJson, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${aggregate.status}\n`);
    process.stdout.write(`mode: ${options.mode}\n`);
    process.stdout.write(`run: ${runDir}\n`);
    process.stdout.write(`report: ${reportPath}\n`);
    if (aggregate.errors.length > 0) {
      for (const error of aggregate.errors) {
        process.stdout.write(`! ${error}\n`);
      }
    }
  }

  if (aggregate.status !== "passed") {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`portal visual diff failed: ${error?.message || String(error)}`);
  process.exit(1);
});
