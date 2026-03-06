#!/usr/bin/env node

import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { isoNow, parseCliArgs, readNumberFlag, readStringFlag } from "./lib/pst-memory-utils.mjs";

const REPO_ROOT = resolve(process.cwd(), ".");
const RUN_ROOT = resolve(REPO_ROOT, "imports/mail/runs");

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const normalized = String(line || "").trim();
    if (!normalized || normalized.startsWith("#")) {
      continue;
    }
    const assignment = normalized.startsWith("export ") ? normalized.slice(7).trim() : normalized;
    const separator = assignment.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = assignment.slice(0, separator).trim();
    let value = assignment.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!key) {
      continue;
    }
    process.env[key] = value;
  }
}

function readBooleanFlag(flags, name, defaultValue = false) {
  if (!Object.prototype.hasOwnProperty.call(flags, name)) {
    return defaultValue;
  }
  const value = String(flags[name] ?? "")
    .trim()
    .toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(value)) {
    return false;
  }
  return defaultValue;
}

function pickLatestFolderIndex(runRoot) {
  const entries = readdirSync(runRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith("mail-office365-folder-index-") && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
  if (entries.length === 0) {
    return "";
  }
  return resolve(runRoot, entries[0]);
}

function readJson(pathname, fallback = null) {
  try {
    return JSON.parse(readFileSync(pathname, "utf8"));
  } catch {
    return fallback;
  }
}

function listProgressFiles(runRoot, doneScopePrefix = "") {
  const files = [];
  for (const entry of readdirSync(runRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (doneScopePrefix && !entry.name.startsWith(doneScopePrefix)) {
      continue;
    }
    const progressPath = resolve(runRoot, entry.name, "deep-import-progress.jsonl");
    if (existsSync(progressPath)) {
      files.push(progressPath);
    }
  }
  return files;
}

function collectDoneFolderIds(progressFiles) {
  const doneIds = new Set();
  let hardRows = 0;
  let hard429Rows = 0;
  for (const progressPath of progressFiles) {
    const raw = readFileSync(progressPath, "utf8").trim();
    if (!raw) {
      continue;
    }
    for (const line of raw.split(/\n+/).filter(Boolean)) {
      try {
        const row = JSON.parse(line);
        const folderId = String(row?.folderId || "").trim();
        if (!folderId) {
          continue;
        }
        const status = Number(row?.status ?? 1);
        if (status === 0) {
          doneIds.add(folderId);
        } else {
          hardRows += 1;
          const combinedErrorText = [
            line,
            String(row?.error || ""),
            String(row?.message || ""),
            String(row?.detail || ""),
            String(row?.reason || ""),
            String(row?.stderr || ""),
          ].join(" ");
          if (/\b429\b|too many requests|throttl/i.test(combinedErrorText)) {
            hard429Rows += 1;
          }
        }
      } catch {
        if (/\b429\b|too many requests|throttl/i.test(line)) {
          hardRows += 1;
          hard429Rows += 1;
        }
      }
    }
  }
  return { doneIds, hardRows, hard429Rows };
}

function loadFolderRows(folderIndexPath, minItems, doneIds) {
  const payload = readJson(folderIndexPath, { rows: [] });
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  return rows
    .map((row) => ({
      id: String(row?.id || "").trim(),
      path: String(row?.path || row?.displayName || "").trim(),
      displayName: String(row?.displayName || "").trim(),
      totalItemCount: Number(row?.totalItemCount || 0),
      childFolderCount: Number(row?.childFolderCount || 0),
      unreadItemCount: Number(row?.unreadItemCount || 0),
      parentId: row?.parentId || null,
    }))
    .filter((row) => row.id && row.path && row.totalItemCount >= minItems && !doneIds.has(row.id));
}

function balanceShards(rows, workerCount) {
  const bins = Array.from({ length: workerCount }, () => ({ rows: [], totalItems: 0 }));
  const sorted = [...rows].sort((a, b) => b.totalItemCount - a.totalItemCount);
  for (const row of sorted) {
    let target = 0;
    for (let i = 1; i < bins.length; i += 1) {
      if (bins[i].totalItems < bins[target].totalItems) {
        target = i;
      }
    }
    bins[target].rows.push(row);
    bins[target].totalItems += row.totalItemCount;
  }
  return bins;
}

async function refreshStudioBrainAuthToken({ portalEnvFilePath, tokenPath, tokenMetaPath }) {
  loadEnvFile(portalEnvFilePath);
  const apiKey = String(process.env.PORTAL_FIREBASE_API_KEY || process.env.FIREBASE_WEB_API_KEY || "").trim();
  const staffCredsPath = resolve(
    REPO_ROOT,
    String(process.env.PORTAL_AGENT_STAFF_CREDENTIALS || "secrets/portal/portal-agent-staff.json").trim()
  );
  const staff = readJson(staffCredsPath, {});
  const refreshToken = String(staff?.refreshToken || "").trim();
  if (!apiKey || !refreshToken) {
    throw new Error("Missing Firebase API key or staff refresh token for auth refresh.");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }).toString();

  const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json();
  if (!response.ok || !payload?.id_token) {
    throw new Error(`Token refresh failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  const token = `Bearer ${payload.id_token}`;
  const expiresInSec = Number(payload.expires_in || 3600);
  const expiresAtMs = Date.now() + expiresInSec * 1000;
  const metadata = {
    mintedAt: new Date().toISOString(),
    expiresInSec,
    expiresAt: new Date(expiresAtMs).toISOString(),
    source: "refresh-token",
    email: String(staff?.email || "").trim(),
  };

  mkdirSync(resolve(REPO_ROOT, "secrets/studio-brain"), { recursive: true });
  writeFileSync(tokenPath, token, { mode: 0o600 });
  writeFileSync(tokenMetaPath, JSON.stringify(metadata, null, 2));

  return { token, expiresAtMs, metadata };
}

function writeCycleShards({ cycleRunId, sourceIndexPath, rows, workerCount }) {
  const cycleShardDir = resolve(RUN_ROOT, `${cycleRunId}-shards`);
  mkdirSync(cycleShardDir, { recursive: true });

  const bins = balanceShards(rows, workerCount);
  const shardDescriptors = [];
  for (let i = 0; i < bins.length; i += 1) {
    const shardPath = resolve(cycleShardDir, `folder-index-shard-${i + 1}.json`);
    writeFileSync(
      shardPath,
      JSON.stringify(
        {
          generatedAt: isoNow(),
          cycleRunId,
          sourceIndex: sourceIndexPath,
          rows: bins[i].rows,
        },
        null,
        2
      )
    );
    shardDescriptors.push({
      worker: i + 1,
      shardPath,
      folders: bins[i].rows.length,
      totalItems: bins[i].totalItems,
    });
  }

  const manifestPath = resolve(cycleShardDir, "manifest.json");
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: isoNow(),
        cycleRunId,
        sourceIndex: sourceIndexPath,
        shards: shardDescriptors,
      },
      null,
      2
    )
  );

  return { cycleShardDir, manifestPath, shards: shardDescriptors };
}

function launchWorker({
  workerNumber,
  cycleRunId,
  shardPath,
  token,
  maxItemsPerFolder,
  chunkSize,
  pageSize,
  disableRunBurstLimit,
  importConcurrencyCap,
  openMemoryTimeoutMs,
  openMemoryRequestRetries,
  openMemoryRequestRetryBaseMs,
  stageMode,
  postChunkSleepMs,
  envFilePath,
  portalEnvFilePath,
  baseUrl,
}) {
  const workerRunId = `${cycleRunId}-w${workerNumber}`;
  const logPath = resolve(RUN_ROOT, `${workerRunId}.log`);
  const outFd = openSync(logPath, "a");
  appendFileSync(logPath, `\n[${isoNow()}] Launching ${workerRunId}\n`);

  const args = [
    resolve(REPO_ROOT, "scripts/mail-office365-deep-import.mjs"),
    "--run-id",
    workerRunId,
    "--folder-index",
    shardPath,
    "--min-items",
    "1",
    "--max-items-per-folder",
    String(maxItemsPerFolder),
    "--chunk-size",
    String(chunkSize),
    "--outlook-page-size",
    String(pageSize),
    "--import-concurrency-cap",
    String(importConcurrencyCap),
    "--open-memory-timeout-ms",
    String(openMemoryTimeoutMs),
    "--open-memory-request-retries",
    String(openMemoryRequestRetries),
    "--open-memory-request-retry-base-ms",
    String(openMemoryRequestRetryBaseMs),
    "--stage-mode",
    String(stageMode || "both"),
    "--post-chunk-sleep-ms",
    String(postChunkSleepMs),
    "--sort-by-items",
    "true",
    "--load-env-file",
    "true",
    "--env-file",
    envFilePath,
    "--load-portal-env-file",
    "true",
    "--portal-env-file",
    portalEnvFilePath,
    "--base-url",
    baseUrl,
  ];
  if (disableRunBurstLimit) {
    args.push("--disable-run-burst-limit", "true");
  }

  const child = spawn(process.execPath, args, {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      STUDIO_BRAIN_AUTH_TOKEN: token,
    },
    stdio: ["ignore", outFd, outFd],
  });
  closeSync(outFd);
  return { child, workerRunId, logPath };
}

async function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  const workerCount = readNumberFlag(flags, "worker-count", 10, { min: 1, max: 32 });
  const adaptiveThrottle = readBooleanFlag(flags, "adaptive-throttle", true);
  const configuredMinWorkerCount = readNumberFlag(flags, "min-worker-count", Math.max(1, Math.ceil(workerCount / 3)), {
    min: 1,
    max: 32,
  });
  const configuredMaxWorkerCount = readNumberFlag(flags, "max-worker-count", workerCount, { min: 1, max: 32 });
  const minWorkerCount = Math.min(configuredMinWorkerCount, configuredMaxWorkerCount);
  const maxWorkerCount = Math.max(configuredMinWorkerCount, configuredMaxWorkerCount);
  const throttle429ScaleDownThreshold = readNumberFlag(flags, "throttle-429-threshold", 4, { min: 1, max: 10000 });
  const throttleStepDown = readNumberFlag(flags, "throttle-step-down", 2, { min: 1, max: 16 });
  const throttleStepUp = readNumberFlag(flags, "throttle-step-up", 1, { min: 1, max: 16 });
  const throttleRecoveryCycles = readNumberFlag(flags, "throttle-recovery-cycles", 2, { min: 1, max: 100 });
  const pollSeconds = readNumberFlag(flags, "poll-seconds", 20, { min: 5, max: 600 });
  const renewWindowSec = readNumberFlag(flags, "renew-window-seconds", 180, { min: 30, max: 1800 });
  const maxItemsPerFolder = readNumberFlag(flags, "max-items-per-folder", 700, { min: 0, max: 1000000 });
  const chunkSize = readNumberFlag(flags, "chunk-size", 120, { min: 1, max: 500 });
  const pageSize = readNumberFlag(flags, "outlook-page-size", 100, { min: 1, max: 200 });
  const disableRunBurstLimit = readBooleanFlag(flags, "disable-run-burst-limit", false);
  const importConcurrencyCap = readNumberFlag(flags, "import-concurrency-cap", 3, { min: 1, max: 64 });
  const openMemoryTimeoutMs = readNumberFlag(flags, "open-memory-timeout-ms", 30000, { min: 1000, max: 300000 });
  const openMemoryRequestRetries = readNumberFlag(flags, "open-memory-request-retries", 2, { min: 0, max: 10 });
  const openMemoryRequestRetryBaseMs = readNumberFlag(flags, "open-memory-request-retry-base-ms", 400, {
    min: 50,
    max: 10000,
  });
  const stageMode = readStringFlag(flags, "stage-mode", "both");
  const postChunkSleepMs = readNumberFlag(flags, "post-chunk-sleep-ms", 150, { min: 0, max: 10000 });
  const runPrefix = readStringFlag(flags, "run-prefix", "mail-office365-auto");
  const doneScopePrefix = readStringFlag(flags, "done-scope-prefix", "");
  const baseUrl = readStringFlag(flags, "base-url", process.env.STUDIO_BRAIN_BASE_URL || "http://192.168.1.226:8787");
  const envFilePath = resolve(readStringFlag(flags, "env-file", "secrets/studio-brain/open-memory-mail-import.env"));
  const portalEnvFilePath = resolve(readStringFlag(flags, "portal-env-file", "secrets/portal/portal-automation.env"));
  const tokenPath = resolve(
    readStringFlag(flags, "token-path", "secrets/studio-brain/runtime-studio-brain-auth-token.txt")
  );
  const tokenMetaPath = resolve(
    readStringFlag(flags, "token-meta-path", "secrets/studio-brain/runtime-studio-brain-auth-token-meta.json")
  );

  loadEnvFile(envFilePath);
  loadEnvFile(portalEnvFilePath);
  mkdirSync(RUN_ROOT, { recursive: true });

  const folderIndexPath = resolve(readStringFlag(flags, "folder-index", "") || pickLatestFolderIndex(RUN_ROOT));
  if (!folderIndexPath || !existsSync(folderIndexPath)) {
    throw new Error("No Office365 folder index JSON found.");
  }

  const supervisorLog = resolve(RUN_ROOT, `${runPrefix}-supervisor.log`);
  appendFileSync(supervisorLog, `\n[${isoNow()}] Supervisor started. folderIndex=${folderIndexPath}\n`);
  process.stdout.write(`Supervisor live. log=${supervisorLog}\n`);

  let cycle = 0;
  let targetWorkerCount = Math.max(minWorkerCount, Math.min(maxWorkerCount, workerCount));
  const baselineProgressFiles = listProgressFiles(RUN_ROOT, doneScopePrefix);
  const baselineProgress = collectDoneFolderIds(baselineProgressFiles);
  let previousHardRows = baselineProgress.hardRows;
  let previousHard429Rows = baselineProgress.hard429Rows;
  let quietRecoveryCounter = 0;
  while (true) {
    cycle += 1;
    const progressFiles = listProgressFiles(RUN_ROOT, doneScopePrefix);
    const { doneIds, hardRows, hard429Rows } = collectDoneFolderIds(progressFiles);
    const deltaHardRows = Math.max(0, hardRows - previousHardRows);
    const deltaHard429Rows = Math.max(0, hard429Rows - previousHard429Rows);
    previousHardRows = hardRows;
    previousHard429Rows = hard429Rows;

    let throttleAction = "hold";
    if (adaptiveThrottle) {
      if (deltaHard429Rows >= throttle429ScaleDownThreshold) {
        const nextTarget = Math.max(minWorkerCount, targetWorkerCount - throttleStepDown);
        throttleAction = nextTarget < targetWorkerCount ? `down-${targetWorkerCount - nextTarget}` : "floor";
        targetWorkerCount = nextTarget;
        quietRecoveryCounter = 0;
      } else if (deltaHard429Rows > 0) {
        const nextTarget = Math.max(minWorkerCount, targetWorkerCount - 1);
        throttleAction = nextTarget < targetWorkerCount ? "down-1" : "floor";
        targetWorkerCount = nextTarget;
        quietRecoveryCounter = 0;
      } else {
        quietRecoveryCounter += 1;
        if (quietRecoveryCounter >= throttleRecoveryCycles && targetWorkerCount < maxWorkerCount) {
          const nextTarget = Math.min(maxWorkerCount, targetWorkerCount + throttleStepUp);
          throttleAction = nextTarget > targetWorkerCount ? `up-${nextTarget - targetWorkerCount}` : "hold";
          targetWorkerCount = nextTarget;
          quietRecoveryCounter = 0;
        } else if (quietRecoveryCounter >= throttleRecoveryCycles) {
          quietRecoveryCounter = 0;
        }
      }
    } else {
      throttleAction = "disabled";
    }

    const remainingRows = loadFolderRows(folderIndexPath, 1, doneIds);

    appendFileSync(
      supervisorLog,
      `[${isoNow()}] cycle=${cycle} done=${doneIds.size} remaining=${remainingRows.length} priorHardRows=${hardRows} deltaHardRows=${deltaHardRows} prior429Rows=${hard429Rows} delta429Rows=${deltaHard429Rows} workerTarget=${targetWorkerCount} throttleAction=${throttleAction}\n`
    );

    if (remainingRows.length === 0) {
      appendFileSync(supervisorLog, `[${isoNow()}] Completed. No remaining folders.\n`);
      process.stdout.write("Supervisor complete: no remaining folders.\n");
      break;
    }

    const token = await refreshStudioBrainAuthToken({
      portalEnvFilePath,
      tokenPath,
      tokenMetaPath,
    });
    appendFileSync(
      supervisorLog,
      `[${isoNow()}] cycle=${cycle} tokenRefreshed expiresAt=${token.metadata.expiresAt}\n`
    );

    const cycleRunId = `${runPrefix}-${isoNow().replace(/[:.]/g, "-")}`;
    const { shards, manifestPath } = writeCycleShards({
      cycleRunId,
      sourceIndexPath: folderIndexPath,
      rows: remainingRows,
      workerCount: targetWorkerCount,
    });
    appendFileSync(supervisorLog, `[${isoNow()}] cycle=${cycle} manifest=${manifestPath}\n`);

    const activeWorkers = [];
    for (const shard of shards) {
      if (shard.folders <= 0) {
        continue;
      }
      const worker = launchWorker({
        workerNumber: shard.worker,
        cycleRunId,
        shardPath: shard.shardPath,
        token: token.token,
        maxItemsPerFolder,
        chunkSize,
        pageSize,
        disableRunBurstLimit,
        importConcurrencyCap,
        openMemoryTimeoutMs,
        openMemoryRequestRetries,
        openMemoryRequestRetryBaseMs,
        stageMode,
        postChunkSleepMs,
        envFilePath,
        portalEnvFilePath,
        baseUrl,
      });
      activeWorkers.push(worker);
    }
    appendFileSync(supervisorLog, `[${isoNow()}] cycle=${cycle} launchedWorkers=${activeWorkers.length}\n`);

    let forcedRollover = false;
    while (true) {
      await sleep(pollSeconds * 1000);
      const alive = activeWorkers.filter((worker) => worker.child.exitCode === null);
      if (alive.length === 0) {
        break;
      }

      if (Date.now() >= token.expiresAtMs - renewWindowSec * 1000) {
        appendFileSync(supervisorLog, `[${isoNow()}] cycle=${cycle} token-near-expiry forcing rollover\n`);
        for (const worker of alive) {
          try {
            worker.child.kill("SIGINT");
          } catch {
            // ignore
          }
        }
        await sleep(3000);
        for (const worker of alive.filter((w) => w.child.exitCode === null)) {
          try {
            worker.child.kill("SIGTERM");
          } catch {
            // ignore
          }
        }
        await sleep(2000);
        for (const worker of alive.filter((w) => w.child.exitCode === null)) {
          try {
            worker.child.kill("SIGKILL");
          } catch {
            // ignore
          }
        }
        forcedRollover = true;
        break;
      }
    }

    const exits = activeWorkers.map((worker) => ({
      workerRunId: worker.workerRunId,
      exitCode: worker.child.exitCode,
      signalCode: worker.child.signalCode,
      logPath: worker.logPath,
    }));
    appendFileSync(
      supervisorLog,
      `[${isoNow()}] cycle=${cycle} complete forcedRollover=${forcedRollover} exits=${JSON.stringify(exits)}\n`
    );
  }
}

main().catch((error) => {
  const message = error?.stack || String(error);
  process.stderr.write(`mail-office365-auto-supervisor failed: ${message}\n`);
  process.exit(1);
});
