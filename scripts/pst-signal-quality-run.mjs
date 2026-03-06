#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isoNow, parseCliArgs, readJson, readNumberFlag, readStringFlag, runCommand } from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "PST signal-quality pipeline runner",
      "",
      "Usage:",
      "  node ./scripts/pst-signal-quality-run.mjs \\",
      "    --input ./imports/pst/runs/<run>/mailbox-units.jsonl \\",
      "    --output-root ./output/memory/pst-signal-quality-run \\",
      "    --baseline-report ./output/memory/<baseline>/signal-quality/report.json",
      "",
      "Options:",
      "  --run-id <id>             Stable run id for corpus export",
      "  --review-limit <n>        Review pack limit (default: 15)",
      "  --clean-output-root       Remove an existing output root before running",
    ].join("\n")
  );
}

function appendLog(path, value) {
  appendFileSync(path, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

function timedRun(logPath, args) {
  const timeBinary = existsSync("/usr/bin/time") ? "/usr/bin/time" : "";
  const command = timeBinary || process.execPath;
  const finalArgs = timeBinary ? ["-v", process.execPath, ...args] : args;
  const result = runCommand(command, finalArgs, { cwd: REPO_ROOT, allowFailure: true, maxBuffer: 1024 * 1024 * 128 });
  appendLog(logPath, result.stdout || "");
  appendLog(logPath, result.stderr || "");
  if (!result.ok) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `${command} ${finalArgs.join(" ")} failed`);
  }
}

function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (flags.help || flags.h) {
    usage();
    return;
  }

  const input = resolve(REPO_ROOT, readStringFlag(flags, "input", "./imports/pst/mailbox-units.jsonl"));
  const outputRoot = resolve(REPO_ROOT, readStringFlag(flags, "output-root", "./output/memory/pst-signal-quality-run"));
  const baselineReport = readStringFlag(flags, "baseline-report", "").trim();
  const runId = readStringFlag(flags, "run-id", "").trim() || outputRoot.split("/").filter(Boolean).at(-1) || "pst-signal-quality-run";
  const reviewLimit = readNumberFlag(flags, "review-limit", 15, { min: 1, max: 100 });
  const cleanOutputRoot = String(flags["clean-output-root"] || "").trim() === "true";

  if (cleanOutputRoot) {
    rmSync(outputRoot, { recursive: true, force: true });
  }

  mkdirSync(join(outputRoot, "fresh-analysis"), { recursive: true });
  mkdirSync(join(outputRoot, "canonical-corpus"), { recursive: true });
  mkdirSync(join(outputRoot, "signal-quality"), { recursive: true });

  const logPath = join(outputRoot, "pipeline.log");
  writeFileSync(logPath, `START=${isoNow()}\n`, "utf8");

  appendLog(logPath, "ANALYZE");
  timedRun(logPath, [
    "./scripts/pst-memory-analyze-hybrid.mjs",
    "--input",
    input,
    "--output",
    join(outputRoot, "fresh-analysis", "mailbox-analysis-memory.jsonl"),
    "--report",
    join(outputRoot, "fresh-analysis", "report.json"),
    "--dead-letter",
    join(outputRoot, "fresh-analysis", "dead-letter.jsonl"),
  ]);
  const analyzeReport = readJson(join(outputRoot, "fresh-analysis", "report.json"), {});
  if (
    Array.isArray(analyzeReport?.warnings) &&
    analyzeReport.warnings.some((warning) => String(warning || "").includes("Gateway output looks unexpectedly thin"))
  ) {
    throw new Error("Hybrid analysis reported unexpectedly thin gateway output; aborting pipeline early.");
  }

  appendLog(logPath, "PROMOTE");
  timedRun(logPath, [
    "./scripts/pst-memory-promote.mjs",
    "--analysis",
    join(outputRoot, "fresh-analysis", "mailbox-analysis-memory.jsonl"),
    "--output",
    join(outputRoot, "fresh-analysis", "mailbox-promoted-memory.jsonl"),
    "--report",
    join(outputRoot, "fresh-analysis", "promote-report.json"),
    "--dead-letter",
    join(outputRoot, "fresh-analysis", "promote-dead-letter.jsonl"),
  ]);

  appendLog(logPath, "EXPORT");
  timedRun(logPath, [
    "./scripts/pst-memory-corpus-export.mjs",
    "--run-id",
    runId,
    "--units",
    input,
    "--promoted",
    join(outputRoot, "fresh-analysis", "mailbox-promoted-memory.jsonl"),
    "--output-dir",
    join(outputRoot, "canonical-corpus"),
    "--fresh",
  ]);

  appendLog(logPath, "EVAL");
  const evalArgs = [
    "./scripts/pst-signal-quality-eval.mjs",
    "--analysis",
    join(outputRoot, "fresh-analysis", "mailbox-analysis-memory.jsonl"),
    "--promoted",
    join(outputRoot, "fresh-analysis", "mailbox-promoted-memory.jsonl"),
    "--dropped",
    join(outputRoot, "fresh-analysis", "promote-dead-letter.jsonl"),
    "--promote-report",
    join(outputRoot, "fresh-analysis", "promote-report.json"),
    "--manifest",
    join(outputRoot, "canonical-corpus", "manifest.json"),
    "--pipeline-log",
    logPath,
    "--output-dir",
    join(outputRoot, "signal-quality"),
    "--review-limit",
    String(reviewLimit),
  ];
  if (baselineReport) {
    evalArgs.push("--baseline-report", resolve(REPO_ROOT, baselineReport));
  }
  timedRun(logPath, evalArgs);

  appendLog(logPath, `END=${isoNow()}`);
  process.stdout.write(`pst-signal-quality-run complete\noutput-root: ${outputRoot}\nlog: ${logPath}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`pst-signal-quality-run failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
