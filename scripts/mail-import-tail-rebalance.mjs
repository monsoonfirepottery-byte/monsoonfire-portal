#!/usr/bin/env node
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function parseArgs(argv) {
  const args = new Map();
  for (let idx = 2; idx < argv.length; idx += 1) {
    const token = argv[idx];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[idx + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, "true");
      continue;
    }
    args.set(key, next);
    idx += 1;
  }
  return args;
}

function toInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readJsonl(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8");
    const lines = raw.split(/\r?\n/g).filter(Boolean);
    const out = [];
    for (const line of lines) {
      try {
        out.push(JSON.parse(line));
      } catch {
        // ignore malformed line
      }
    }
    return out;
  } catch {
    return [];
  }
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonl(filePath, rows) {
  const payload = rows.map((row) => JSON.stringify(row)).join("\n");
  writeFileSync(filePath, payload.length > 0 ? `${payload}\n` : "", "utf8");
}

function workerSort(a, b) {
  const an = Number(String(a).replace(/^w/, ""));
  const bn = Number(String(b).replace(/^w/, ""));
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return String(a).localeCompare(String(b));
}

function bucketSplit(rows, bucketCount) {
  const buckets = Array.from({ length: bucketCount }, () => []);
  if (bucketCount <= 0 || rows.length === 0) return buckets;
  const perBucket = Math.ceil(rows.length / bucketCount);
  for (let i = 0; i < bucketCount; i += 1) {
    const start = i * perBucket;
    const end = Math.min(rows.length, start + perBucket);
    if (start >= rows.length) break;
    buckets[i] = rows.slice(start, end);
  }
  return buckets;
}

function backupAndResetWorkerFiles(workerDir, stamp) {
  const backupDir = join(workerDir, `.rebalance-${stamp}`);
  mkdirSync(backupDir, { recursive: true });
  for (const name of [
    "mail-memory-outlook-snapshot.jsonl",
    "mail-import-checkpoint.json",
    "mail-import-ledger.jsonl",
    "mail-import-dead-letter.jsonl",
    "mail-import-report.json",
    "watchdog-worker.log",
  ]) {
    const src = join(workerDir, name);
    try {
      renameSync(src, join(backupDir, name));
    } catch {
      // ignore missing file
    }
  }
  try {
    rmSync(join(workerDir, ".watchdog-start.lock"), { recursive: true, force: true });
  } catch {
    // ignore
  }
  return backupDir;
}

function main() {
  const args = parseArgs(process.argv);
  const runRootArg = args.get("run-root");
  if (!runRootArg) {
    throw new Error("--run-root is required");
  }
  const runRoot = resolve(runRootArg);
  const rowsPerWorker = Math.max(50, toInt(args.get("rows-per-worker"), 220));
  const maxWorkersArg = toInt(args.get("max-workers"), 0);
  const dryRun = String(args.get("dry-run") || "false").toLowerCase() === "true";

  const workerNames = readdirSync(runRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^w\d+$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort(workerSort);

  if (workerNames.length === 0) {
    throw new Error(`no worker folders found under ${runRoot}`);
  }

  const workers = workerNames.map((workerName) => {
    const workerDir = join(runRoot, workerName);
    const checkpointPath = join(workerDir, "mail-import-checkpoint.json");
    const snapshotPath = join(workerDir, "mail-memory-outlook-snapshot.jsonl");
    const checkpoint = readJson(checkpointPath, {});
    const snapshotRows = readJsonl(snapshotPath);
    const totalRows = snapshotRows.length;
    const nextIndexRaw = toInt(checkpoint.nextIndex, 0);
    const nextIndex = Math.min(Math.max(0, nextIndexRaw), totalRows);
    const remainingRows = snapshotRows.slice(nextIndex);
    const runId = String(checkpoint.runId || `mail-office365-rebalanced-${workerName}`);
    const source = String(checkpoint.source || "mail:outlook");
    return {
      workerName,
      workerDir,
      checkpointPath,
      snapshotPath,
      checkpoint,
      runId,
      source,
      totalRows,
      nextIndex,
      remainingRows,
      remainingCount: remainingRows.length,
    };
  });

  const remainingRows = workers.flatMap((worker) => worker.remainingRows);
  const remainingTotal = remainingRows.length;
  const maxWorkers = maxWorkersArg > 0 ? Math.min(maxWorkersArg, workers.length) : workers.length;
  const targetWorkers = remainingTotal === 0 ? 0 : Math.min(maxWorkers, Math.max(1, Math.ceil(remainingTotal / rowsPerWorker)));
  const assignWorkers = workers.slice(0, targetWorkers);
  const idleWorkers = workers.slice(targetWorkers);
  const buckets = bucketSplit(remainingRows, targetWorkers);

  const summary = {
    at: new Date().toISOString(),
    runRoot,
    workers: workers.length,
    rowsPerWorker,
    maxWorkers,
    remainingTotal,
    targetWorkers,
    dryRun,
    workerRemaining: workers.map((worker) => ({
      worker: worker.workerName,
      runId: worker.runId,
      totalRows: worker.totalRows,
      nextIndex: worker.nextIndex,
      remaining: worker.remainingCount,
    })),
    assignments: assignWorkers.map((worker, idx) => ({
      worker: worker.workerName,
      runId: worker.runId,
      assigned: buckets[idx]?.length || 0,
    })),
    idled: idleWorkers.map((worker) => ({
      worker: worker.workerName,
      runId: worker.runId,
    })),
  };

  if (dryRun) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  for (let idx = 0; idx < assignWorkers.length; idx += 1) {
    const worker = assignWorkers[idx];
    const assignedRows = buckets[idx] || [];
    backupAndResetWorkerFiles(worker.workerDir, stamp);
    writeJsonl(join(worker.workerDir, "mail-memory-outlook-snapshot.jsonl"), assignedRows);
    writeJson(join(worker.workerDir, "mail-import-checkpoint.json"), {
      runId: worker.runId,
      source: worker.source,
      mode: "outlook",
      nextIndex: 0,
      totalRows: assignedRows.length,
      status: assignedRows.length > 0 ? "running" : "completed",
      updatedAt: new Date().toISOString(),
      totals: {
        imported: 0,
        failed: 0,
        chunksSucceeded: 0,
        chunksFailed: 0,
      },
      rebalance: {
        at: new Date().toISOString(),
        strategy: "tail-work-steal",
        rowsPerWorker,
        assignedRows: assignedRows.length,
      },
    });
    writeJsonl(join(worker.workerDir, "mail-import-ledger.jsonl"), []);
    writeJsonl(join(worker.workerDir, "mail-import-dead-letter.jsonl"), []);
    writeJson(join(worker.workerDir, "mail-import-report.json"), {
      runId: worker.runId,
      source: worker.source,
      mode: "outlook",
      rebalanceAt: new Date().toISOString(),
      assignedRows: assignedRows.length,
      importedRows: 0,
      failedRows: 0,
      deadLetterRows: 0,
      malformedRows: 0,
      preflightRejectedRows: 0,
      preflightDuplicateIdRows: 0,
      preflightDuplicateClientRequestRows: 0,
      preflightFallbackQueuedRows: 0,
      preflightFallbackRejectedRows: 0,
      fallbackAttempted: 0,
      fallbackRecovered: 0,
      fallbackFailed: 0,
      chunkSize: null,
      continueOnError: true,
      disableRunBurstLimit: true,
      stopReason: "rebalanced",
    });
  }

  for (const worker of idleWorkers) {
    backupAndResetWorkerFiles(worker.workerDir, stamp);
    writeJsonl(join(worker.workerDir, "mail-memory-outlook-snapshot.jsonl"), []);
    writeJson(join(worker.workerDir, "mail-import-checkpoint.json"), {
      runId: worker.runId,
      source: worker.source,
      mode: "outlook",
      nextIndex: 0,
      totalRows: 0,
      status: "completed",
      updatedAt: new Date().toISOString(),
      totals: {
        imported: 0,
        failed: 0,
        chunksSucceeded: 0,
        chunksFailed: 0,
      },
      rebalance: {
        at: new Date().toISOString(),
        strategy: "tail-work-steal",
        rowsPerWorker,
        assignedRows: 0,
      },
    });
    writeJsonl(join(worker.workerDir, "mail-import-ledger.jsonl"), []);
    writeJsonl(join(worker.workerDir, "mail-import-dead-letter.jsonl"), []);
    writeJson(join(worker.workerDir, "mail-import-report.json"), {
      runId: worker.runId,
      source: worker.source,
      mode: "outlook",
      rebalanceAt: new Date().toISOString(),
      assignedRows: 0,
      importedRows: 0,
      failedRows: 0,
      deadLetterRows: 0,
      malformedRows: 0,
      preflightRejectedRows: 0,
      preflightDuplicateIdRows: 0,
      preflightDuplicateClientRequestRows: 0,
      preflightFallbackQueuedRows: 0,
      preflightFallbackRejectedRows: 0,
      fallbackAttempted: 0,
      fallbackRecovered: 0,
      fallbackFailed: 0,
      chunkSize: null,
      continueOnError: true,
      disableRunBurstLimit: true,
      stopReason: "rebalanced-idle",
    });
  }

  const summaryPath = join(runRoot, `rebalance-summary-${stamp}.json`);
  writeJson(summaryPath, summary);
  process.stdout.write(`${JSON.stringify({ ok: true, summaryPath, ...summary }, null, 2)}\n`);
}

main();

