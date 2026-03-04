#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isoNow,
  parseCliArgs,
  readBoolFlag,
  readJson,
  readJsonlWithRaw,
  readStringFlag,
  runCommand,
  writeJson,
} from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "PST memory reconcile stage",
      "",
      "Usage:",
      "  node ./scripts/pst-memory-reconcile.mjs --run-id <id>",
      "",
      "Options:",
      "  --checkpoint <path>   checkpoint file path",
      "  --ledger <path>       import ledger path",
      "  --dead-letter <path>  dead-letter path",
      "  --report <path>       report path",
      "  --stats <t/f>         run open-memory stats probe (default: true)",
      "  --json                print report JSON",
    ].join("\n")
  );
}

function parseLedger(path) {
  if (!existsSync(path)) return [];
  return readJsonlWithRaw(path)
    .filter((entry) => entry.ok && entry.value && typeof entry.value === "object")
    .map((entry) => entry.value);
}

async function run() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const runId = readStringFlag(flags, "run-id", "");
  if (!runId) {
    throw new Error("--run-id is required");
  }
  const checkpointPath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "checkpoint", `./imports/pst/runs/${runId}/import-checkpoint.json`)
  );
  const ledgerPath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "ledger", `./imports/pst/runs/${runId}/import-ledger.jsonl`)
  );
  const deadLetterPath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "dead-letter", `./imports/pst/runs/${runId}/import-dead-letter.jsonl`)
  );
  const reportPath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "report", `./output/open-memory/pst-reconcile-${runId}.json`)
  );
  const runStats = readBoolFlag(flags, "stats", true);
  const printJson = readBoolFlag(flags, "json", false);

  const checkpoint = readJson(checkpointPath, null);
  const ledgerRows = parseLedger(ledgerPath);
  const deadLetterRows = existsSync(deadLetterPath)
    ? readJsonlWithRaw(deadLetterPath).filter((entry) => entry.ok).length
    : 0;

  const totals = {
    chunks: ledgerRows.length,
    chunksSucceeded: ledgerRows.filter((row) => row.ok).length,
    chunksFailed: ledgerRows.filter((row) => !row.ok).length,
    imported: ledgerRows.reduce((sum, row) => sum + Number(row.imported || 0), 0),
    failed: ledgerRows.reduce((sum, row) => sum + Number(row.failed || 0), 0),
    deadLetterRows,
  };

  let memoryStats = null;
  let statsError = "";
  if (runStats) {
    const result = runCommand(process.execPath, ["./scripts/open-memory.mjs", "stats"], {
      cwd: REPO_ROOT,
      allowFailure: true,
    });
    if (result.ok) {
      try {
        memoryStats = JSON.parse(String(result.stdout || "{}"));
      } catch {
        memoryStats = null;
      }
    } else {
      statsError = String(result.stderr || result.stdout || "open-memory stats failed").trim();
    }
  }

  const report = {
    schema: "pst-memory-reconcile-report.v1",
    generatedAt: isoNow(),
    runId,
    checkpointPath,
    ledgerPath,
    deadLetterPath,
    checkpoint,
    totals,
    memoryStats,
    statsError: statsError || null,
    status:
      checkpoint && Number(checkpoint.nextIndex || 0) > 0
        ? Number(checkpoint.nextIndex || 0) >= Number(checkpoint.totalRows || checkpoint?.rowsTotal || checkpoint?.nextIndex || 0)
          ? "completed"
          : "partial"
        : totals.chunks > 0
          ? "partial"
          : "empty",
  };
  writeJson(reportPath, report);

  if (printJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write("pst-memory-reconcile complete\n");
    process.stdout.write(`run-id: ${runId}\n`);
    process.stdout.write(`ledger chunks: ${totals.chunks} (ok ${totals.chunksSucceeded}, failed ${totals.chunksFailed})\n`);
    process.stdout.write(`imported: ${totals.imported}, failed: ${totals.failed}\n`);
    process.stdout.write(`dead-letter rows: ${totals.deadLetterRows}\n`);
    process.stdout.write(`report: ${reportPath}\n`);
  }
}

run().catch((error) => {
  process.stderr.write(`pst-memory-reconcile failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
