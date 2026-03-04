#!/usr/bin/env node

import { unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendJsonl,
  isoNow,
  parseCliArgs,
  readBoolFlag,
  readJson,
  readJsonlWithRaw,
  readNumberFlag,
  readStringFlag,
  runCommand,
  stableHash,
  writeJson,
  writeJsonl,
} from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "PST resumable import stage",
      "",
      "Usage:",
      "  node ./scripts/pst-memory-import-resumable.mjs \\",
      "    --input ./imports/pst/mailbox-promoted-memory.jsonl \\",
      "    --run-id pst-run-... \\",
      "    --source pst:promoted-memory",
      "",
      "Options:",
      "  --chunk-size <n>         Import batch size (default: 300, max 500)",
      "  --max-retries <n>        Per-chunk retry count (default: 3)",
      "  --continue-on-error <t/f> Continue after failed chunk (default: true)",
      "  --checkpoint <path>      Checkpoint JSON path",
      "  --ledger <path>          Chunk result ledger JSONL",
      "  --dead-letter <path>     Failed-row dead-letter JSONL",
      "  --open-memory-script <path> Path to open-memory CLI script (default: ./scripts/open-memory.mjs)",
      "  --disable-run-burst-limit <t/f> Disable run-write burst limiter for this import run",
      "  --replay <t/f>           Enable replay mode (equivalent to --inject-run-id true)",
      "  --replay-scope <scope>    Optional scope for replay mode (default: replay-<timestamp>)",
      "  --run-scope <scope>      Optional runId scope suffix for row import replay (use with --inject-run-id)",
      "  --inject-run-id <t/f>    Replace row-level runId with scoped value (default: false)",
      "  --report <path>          Final report JSON path",
      "  --json                   Print report JSON",
    ].join("\n")
  );
}

function parseImportResult(rawStdout) {
  const text = String(rawStdout || "").trim();
  if (!text) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const queue = [parsed];
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || typeof next !== "object") continue;
    const imported = Number(next.imported);
    const failed = Number(next.failed);
    const total = Number(next.total);
    if (Number.isFinite(imported) && Number.isFinite(failed)) {
      return {
        imported,
        failed,
        total: Number.isFinite(total) ? total : imported + failed,
      };
    }
    for (const nested of Object.values(next)) {
      if (nested && typeof nested === "object") {
        queue.push(nested);
      }
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, Math.max(0, ms));
  });
}

function isNodeScriptPath(commandPath) {
  return /\.(mjs|cjs|js)$/i.test(String(commandPath || "").trim());
}

function buildOpenMemoryInvocation(openMemoryScript, args) {
  const script = String(openMemoryScript || "").trim();
  if (isNodeScriptPath(script)) {
    return {
      command: process.execPath,
      commandArgs: [script, ...args],
    };
  }
  return {
    command: script || process.execPath,
    commandArgs: script ? args : ["./scripts/open-memory.mjs", ...args],
  };
}

async function run() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const inputPath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "input", "./imports/pst/mailbox-promoted-memory.jsonl")
  );
  const runId = readStringFlag(flags, "run-id", `pst-run-${isoNow().replace(/[:.]/g, "-")}`);
  const source = readStringFlag(flags, "source", "pst:promoted-memory");
  const chunkSize = readNumberFlag(flags, "chunk-size", 300, { min: 1, max: 500 });
  const maxRetries = readNumberFlag(flags, "max-retries", 3, { min: 0, max: 20 });
  const continueOnError = readBoolFlag(flags, "continue-on-error", true);
  const printJson = readBoolFlag(flags, "json", false);
  const openMemoryScript = readStringFlag(flags, "open-memory-script", "./scripts/open-memory.mjs");
  const runScope = readStringFlag(flags, "run-scope", "").trim();
  const disableRunBurstLimit = readBoolFlag(flags, "disable-run-burst-limit", false);
  const replayMode = readBoolFlag(flags, "replay", false);
  const replayScope = readStringFlag(flags, "replay-scope", "").trim();
  const injectRunId = replayMode || readBoolFlag(flags, "inject-run-id", false);
  const effectiveRunScope = runScope || replayScope;
  const scopedRunId = injectRunId ? String(effectiveRunScope || `replay-${isoNow().replace(/[:.]/g, "-")}`).trim() : null;

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
    readStringFlag(flags, "report", `./output/open-memory/pst-import-resumable-${runId}.json`)
  );

  const checkpointExisting = readJson(checkpointPath, null);
  const checkpoint = checkpointExisting && typeof checkpointExisting === "object"
    ? checkpointExisting
    : {
        schema: "pst-memory-import-checkpoint.v1",
        runId,
        inputPath,
        source,
        createdAt: isoNow(),
        updatedAt: isoNow(),
        nextIndex: 0,
        chunkSize,
        totals: {
          imported: 0,
          failed: 0,
          chunksSucceeded: 0,
          chunksFailed: 0,
        },
        totalRows: 0,
        status: "running",
      };

  const entries = readJsonlWithRaw(inputPath);
  const validRows = [];
  const deadLetterBootstrap = [];
  for (const entry of entries) {
    if (!entry.ok || !entry.value || typeof entry.value !== "object") {
      deadLetterBootstrap.push({
        stage: "import",
        runId,
        reason: "malformed_jsonl_row",
        raw: entry.raw,
      });
      continue;
    }
    validRows.push(entry.value);
  }

  if (deadLetterBootstrap.length > 0) {
    appendJsonl(deadLetterPath, deadLetterBootstrap);
  }

  let nextIndex = Number.isFinite(Number(checkpoint.nextIndex)) ? Math.max(0, Math.trunc(Number(checkpoint.nextIndex))) : 0;
  nextIndex = Math.min(nextIndex, validRows.length);
  checkpoint.totalRows = validRows.length;
  checkpoint.nextIndex = nextIndex;
  checkpoint.status = nextIndex >= validRows.length ? "completed" : "running";
  checkpoint.updatedAt = isoNow();
  writeJson(checkpointPath, checkpoint);
  let stopReason = "";

  while (nextIndex < validRows.length) {
    const chunkStart = nextIndex;
    const chunkEnd = Math.min(validRows.length, chunkStart + chunkSize);
    const chunkRows = validRows.slice(chunkStart, chunkEnd);
    const chunkPayloadRows = chunkRows.map((row) => {
      if (!injectRunId || !scopedRunId) return row;
      const baseRunId = String(row.runId || runId || "").trim();
      const resolvedRunId = baseRunId.length > 0 ? baseRunId : String(runId);
      return {
        ...row,
        runId: `${resolvedRunId}-${scopedRunId}`,
      };
    });
    const chunkHash = stableHash(
      `${runId}|${chunkStart}|${chunkEnd}|${chunkRows.map((row) => String(row.clientRequestId || row.content || "")).join("|")}`
    );
    const chunkPath = `${inputPath}.chunk-${chunkStart}-${chunkEnd}-${chunkHash}.jsonl`;
    writeJsonl(chunkPath, chunkPayloadRows);

    let attempt = 0;
    let chunkSucceeded = false;
    let lastError = "";
    let importedCount = 0;
    let failedCount = 0;

    try {
      while (attempt <= maxRetries && !chunkSucceeded) {
        attempt += 1;
        const invocation = buildOpenMemoryInvocation(openMemoryScript, [
          "import",
          "--input",
          chunkPath,
          "--source",
          source,
          "--continue-on-error",
          continueOnError ? "true" : "false",
        ]);
        if (disableRunBurstLimit) {
          invocation.commandArgs.push("--disable-run-burst-limit", "true");
        }
        const result = runCommand(invocation.command, invocation.commandArgs, {
          cwd: REPO_ROOT,
          allowFailure: true,
        });
        const counts = parseImportResult(result.stdout);
        if (counts) {
          importedCount = counts.imported;
          failedCount = counts.failed;
        } else if (result.ok) {
          importedCount = chunkRows.length;
          failedCount = 0;
        }

        if (result.ok) {
          chunkSucceeded = true;
          break;
        }
        lastError = String(result.stderr || result.stdout || `open-memory import failed on attempt ${attempt}`).trim();
        if (attempt <= maxRetries) {
          await sleep(300 * 2 ** (attempt - 1));
        }
      }

      const ledgerRow = {
        ts: isoNow(),
        runId,
        chunkStart,
        chunkEnd,
        chunkSize: chunkRows.length,
        chunkHash,
        source,
        attempts: attempt,
        ok: chunkSucceeded,
        imported: importedCount,
        failed: failedCount,
        error: chunkSucceeded ? null : lastError || "chunk_import_failed",
      };
      appendJsonl(ledgerPath, [ledgerRow]);

      if (chunkSucceeded) {
        checkpoint.totals.imported = Number(checkpoint.totals.imported || 0) + importedCount;
        checkpoint.totals.failed = Number(checkpoint.totals.failed || 0) + failedCount;
        checkpoint.totals.chunksSucceeded = Number(checkpoint.totals.chunksSucceeded || 0) + 1;
        nextIndex = chunkEnd;
        checkpoint.nextIndex = nextIndex;
        checkpoint.updatedAt = isoNow();
        checkpoint.status = nextIndex >= validRows.length ? "completed" : "running";
        writeJson(checkpointPath, checkpoint);
      } else {
        checkpoint.totals.chunksFailed = Number(checkpoint.totals.chunksFailed || 0) + 1;
        checkpoint.updatedAt = isoNow();
        checkpoint.status = "failed";
        writeJson(checkpointPath, checkpoint);
        appendJsonl(
          deadLetterPath,
          chunkRows.map((row) => ({
            stage: "import",
            runId,
            reason: "chunk_import_failed",
            chunkStart,
            chunkEnd,
            error: lastError || "unknown_error",
            row,
          }))
        );
        if (!continueOnError) {
          stopReason = "chunk_import_failed_and_continue_disabled";
          break;
        }
        nextIndex = chunkEnd;
        checkpoint.nextIndex = nextIndex;
        checkpoint.status = nextIndex >= validRows.length ? "completed_with_failures" : "running_with_failures";
        writeJson(checkpointPath, checkpoint);
      }
    } finally {
      try {
        unlinkSync(chunkPath);
      } catch {
        // best effort cleanup
      }
    }
  }

  const report = {
    schema: "pst-memory-import-resumable-report.v1",
    generatedAt: isoNow(),
    runId,
    inputPath,
    source,
    checkpointPath,
    ledgerPath,
    deadLetterPath,
    options: {
      chunkSize,
      maxRetries,
      continueOnError,
      openMemoryScript,
      disableRunBurstLimit,
      runScope: effectiveRunScope || null,
      replayMode,
      injectRunId,
    },
    totals: checkpoint.totals,
    progress: {
      nextIndex: checkpoint.nextIndex,
      totalRows: validRows.length,
      completed: Number(checkpoint.nextIndex) >= validRows.length,
      stopReason: stopReason || null,
    },
    malformedRows: deadLetterBootstrap.length,
    status:
      Number(checkpoint.nextIndex) >= validRows.length
        ? checkpoint.status || "completed"
        : stopReason
          ? "stopped"
          : "running",
  };
  writeJson(reportPath, report);

  if (printJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write("pst-memory-import-resumable complete\n");
    process.stdout.write(`run-id: ${runId}\n`);
    process.stdout.write(`input: ${inputPath}\n`);
    process.stdout.write(`checkpoint: ${checkpointPath}\n`);
    process.stdout.write(`ledger: ${ledgerPath}\n`);
    process.stdout.write(`dead-letter: ${deadLetterPath}\n`);
    process.stdout.write(`report: ${reportPath}\n`);
    process.stdout.write(`progress: ${checkpoint.nextIndex}/${validRows.length}\n`);
    process.stdout.write(
      `totals: imported ${checkpoint.totals.imported || 0}, failed ${checkpoint.totals.failed || 0}\n`
    );
  }

  const completed = Number(checkpoint.nextIndex) >= validRows.length;
  if (!completed && !continueOnError) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  process.stderr.write(
    `pst-memory-import-resumable failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
