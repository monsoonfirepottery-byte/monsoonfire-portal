#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCompactionBatchReport,
  compactionSettingsFromEnv,
  extractCompactionMemoryProducts,
  parseRolloutEntries,
  resolveCodexThreadContext,
  runtimePathsForThread,
  writeJsonlFile,
} from "./lib/codex-session-memory-utils.mjs";
import {
  parseCliArgs,
  readBoolFlag,
  readNumberFlag,
  readStringFlag,
  writeJson,
} from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "Extract Codex compaction memory window",
      "",
      "Usage:",
      "  node ./scripts/extract-codex-compaction-window.mjs --thread-id <id> --line-number <n>",
      "",
      "Options:",
      "  --thread-id <id>      Codex thread id (preferred)",
      "  --cwd <path>          Workspace cwd fallback when thread id is absent",
      "  --rollout-path <p>    Explicit rollout path override",
      "  --line-number <n>     Compaction line number in the rollout JSONL",
      "  --output <path>       JSONL output for combined rows",
      "  --report <path>       JSON report output",
      "  --before <n>          Eligible records before compaction",
      "  --after <n>           Eligible records after compaction",
      "  --json                Print report JSON to stdout",
    ].join("\n")
  );
}

function run() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const settings = compactionSettingsFromEnv(process.env);
  const threadId = readStringFlag(flags, "thread-id", "");
  const cwd = readStringFlag(flags, "cwd", process.cwd());
  const lineNumber = readNumberFlag(flags, "line-number", 0, { min: 1 });
  if (!lineNumber) {
    throw new Error("--line-number is required.");
  }

  const threadInfo = resolveCodexThreadContext({ threadId, cwd });
  if (!threadInfo && !readStringFlag(flags, "rollout-path", "").trim()) {
    throw new Error("Unable to resolve thread context. Provide --thread-id or --rollout-path.");
  }

  const resolvedThreadId = threadInfo?.threadId || threadId || `cwd-${cwd}`;
  const rolloutPath = readStringFlag(flags, "rollout-path", threadInfo?.rolloutPath || "");
  if (!rolloutPath) {
    throw new Error("Unable to resolve rollout path for compaction extraction.");
  }

  const runtimePaths = runtimePathsForThread(resolvedThreadId);
  const outputPath = readStringFlag(flags, "output", resolve(runtimePaths.pendingDir, `extract-${lineNumber}.jsonl`));
  const reportPath = readStringFlag(flags, "report", resolve(runtimePaths.runtimeDir, `extract-${lineNumber}-report.json`));
  const entries = parseRolloutEntries(rolloutPath);
  const products = extractCompactionMemoryProducts({
    threadInfo: {
      ...(threadInfo || {}),
      threadId: resolvedThreadId,
      rolloutPath,
      cwd: threadInfo?.cwd || cwd,
    },
    rolloutEntries: entries,
    compactionLineNumber: lineNumber,
    beforeCount: readNumberFlag(flags, "before", settings.compactionBefore, { min: 1, max: 200 }),
    afterCount: readNumberFlag(flags, "after", settings.compactionAfter, { min: 1, max: 100 }),
    rawRowMaxBytes: settings.rawRowMaxBytes,
    rawBatchMaxBytes: settings.rawBatchMaxBytes,
    rawTtlDays: settings.rawTtlDays,
  });

  const rows = [...products.rawRows, products.windowRow, ...products.promotedRows];
  writeJsonlFile(outputPath, rows);
  const report = {
    ...buildCompactionBatchReport(products),
    threadId: resolvedThreadId,
    rolloutPath,
    outputPath,
    reportPath,
  };
  writeJson(reportPath, report);

  if (readBoolFlag(flags, "json", false)) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${outputPath}\n`);
  }
}

try {
  run();
} catch (error) {
  process.stderr.write(`extract-codex-compaction-window failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
