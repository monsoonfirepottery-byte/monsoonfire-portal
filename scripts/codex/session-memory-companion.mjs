#!/usr/bin/env node

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  buildCompactionBatchReport,
  buildCompactionId,
  buildCompactionQueuePath,
  compactionSettingsFromEnv,
  extractCompactionMemoryProducts,
  isContextCompactedEvent,
  parseRolloutEntries,
  readCompactionWatermark,
  resolveCodexThreadContext,
  runtimePathsForThread,
  writeCompactionWatermark,
  writeJsonlFile,
} from "../lib/codex-session-memory-utils.mjs";
import {
  parseCliArgs,
  readBoolFlag,
  readNumberFlag,
  readStringFlag,
  writeJson,
} from "../lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");
const OPEN_MEMORY_SCRIPT = resolve(REPO_ROOT, "scripts", "open-memory.mjs");
const COMPANION_LOCK_FILENAME = "session-memory-companion.lock.json";
const COMPAT_IMPORT_CONTENT_LIMIT = 18_000;
const COMPAT_IMPORT_TRUNCATION_MARKER = " [truncated for import compatibility]";

function usage() {
  process.stdout.write(
    [
      "Codex session memory companion",
      "",
      "Usage:",
      "  node ./scripts/codex/session-memory-companion.mjs --thread-id <id>",
      "",
      "Options:",
      "  --thread-id <id>            Codex thread id",
      "  --rollout-path <path>       Explicit rollout path override",
      "  --cwd <path>                Explicit cwd override",
      "  --startup-context-path <p>  Bootstrap context artifact path",
      "  --parent-pid <n>            Parent process id for lifecycle binding",
      "  --poll-ms <n>               Poll interval (default: 2000)",
      "  --once                      Process once and exit",
      "  --help                      Show this help",
    ].join("\n")
  );
}

function clean(value) {
  return String(value ?? "").trim();
}

function readEnvBool(env, key, fallback = false) {
  const raw = clean(env?.[key]).toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function readEnvNumber(env, key, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = clean(env?.[key]);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function parseJson(raw, fallback = null) {
  try {
    return JSON.parse(String(raw ?? ""));
  } catch {
    return fallback;
  }
}

function parentAlive(parentPid) {
  const pid = Number(parentPid);
  if (!Number.isFinite(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function pidAlive(pid) {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch {
    return false;
  }
}

function readJsonFile(path) {
  try {
    return parseJson(readFileSync(path, "utf8"), null);
  } catch {
    return null;
  }
}

function lockOwnerIsStale(owner, staleMs) {
  const ownerPid = Number(owner?.pid ?? 0);
  if (!pidAlive(ownerPid)) return true;
  const createdAtMs = Date.parse(clean(owner?.createdAt));
  const ageMs = Number.isFinite(createdAtMs) ? Date.now() - createdAtMs : 0;
  if (ageMs < staleMs) return false;
  const ownerParentPid = Number(owner?.parentPid ?? 0);
  return ownerParentPid > 0 && !parentAlive(ownerParentPid);
}

function acquireCompanionLock({ runtimePaths, threadInfo, parentPid, env }) {
  mkdirSync(runtimePaths.runtimeDir, { recursive: true });
  const lockPath = resolve(runtimePaths.runtimeDir, COMPANION_LOCK_FILENAME);
  const staleMs = readEnvNumber(env, "CODEX_SESSION_MEMORY_LOCK_STALE_MS", 30 * 60 * 1000, {
    min: 60_000,
    max: 24 * 60 * 60 * 1000,
  });
  const payload = {
    pid: process.pid,
    parentPid: Number(parentPid) || 0,
    threadId: threadInfo.threadId,
    rolloutPath: threadInfo.rolloutPath,
    cwd: threadInfo.cwd || "",
    createdAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, "wx");
      try {
        writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      } finally {
        closeSync(fd);
      }
      let released = false;
      return {
        lockPath,
        release() {
          if (released) return;
          released = true;
          const current = readJsonFile(lockPath);
          if (Number(current?.pid ?? 0) === process.pid) {
            rmSync(lockPath, { force: true });
          }
        },
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = readJsonFile(lockPath);
      if (lockOwnerIsStale(owner, staleMs)) {
        rmSync(lockPath, { force: true });
        continue;
      }
      process.stderr.write(
        `session-memory-companion skipped: thread ${threadInfo.threadId} is already owned by pid ${Number(owner?.pid ?? 0) || "unknown"}.\n`
      );
      return null;
    }
  }

  throw new Error(`Unable to acquire companion lock at ${lockPath}.`);
}

function installLockRelease(lock) {
  process.once("exit", () => {
    lock.release();
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      lock.release();
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  }
}

function listPendingJsonl(pendingDir) {
  if (!pendingDir || !existsSync(pendingDir)) return [];
  return readdirSync(pendingDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => resolve(pendingDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function readJsonlRows(path) {
  if (!path || !existsSync(path)) return [];
  return String(readFileSync(path, "utf8") || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseJson(line, null))
    .filter(Boolean);
}

function shrinkRowsForCompat(rows) {
  return rows.map((row) => {
    const content = String(row?.content ?? "");
    if (content.length <= COMPAT_IMPORT_CONTENT_LIMIT) return row;
    const clipAt = Math.max(0, COMPAT_IMPORT_CONTENT_LIMIT - COMPAT_IMPORT_TRUNCATION_MARKER.length);
    return {
      ...row,
      content: `${content.slice(0, clipAt).trimEnd()}${COMPAT_IMPORT_TRUNCATION_MARKER}`,
      metadata: {
        ...(row?.metadata && typeof row.metadata === "object" ? row.metadata : {}),
        importCompatibilityClip: true,
        originalContentLength: Number(row?.metadata?.originalContentLength ?? 0) || content.length,
      },
    };
  });
}

function importPayloadHasCompatFailure(payload) {
  const results = Array.isArray(payload?.result?.results)
    ? payload.result.results
    : Array.isArray(payload?.results)
      ? payload.results
      : [];
  return results.some((entry) => /content.*20,?000|content.*max|max.*content|too_big|too long|validation/i.test(clean(entry?.error)));
}

function openMemoryImportEnv(env) {
  const childEnv = { ...env };
  const mcpAuthToken = clean(env.STUDIO_BRAIN_MCP_ID_TOKEN);
  if (!clean(childEnv.STUDIO_BRAIN_AUTH_TOKEN) && !clean(childEnv.STUDIO_BRAIN_ID_TOKEN) && mcpAuthToken) {
    childEnv.STUDIO_BRAIN_ID_TOKEN = mcpAuthToken;
  }
  const mcpAdminToken = clean(env.STUDIO_BRAIN_MCP_ADMIN_TOKEN);
  if (!clean(childEnv.STUDIO_BRAIN_ADMIN_TOKEN) && mcpAdminToken) {
    childEnv.STUDIO_BRAIN_ADMIN_TOKEN = mcpAdminToken;
  }
  return childEnv;
}

function importPendingFile(path, env, options = {}) {
  const importTimeoutMs = Number(options.importTimeoutMs ?? 120_000);
  const disableRunBurstLimit = Boolean(options.disableRunBurstLimit);
  const childEnv = openMemoryImportEnv(env);
  const args = [
    OPEN_MEMORY_SCRIPT,
    "import",
    "--input",
    path,
    "--continue-on-error",
    "true",
  ];
  if (disableRunBurstLimit) {
    args.push("--disable-run-burst-limit", "true");
  }
  const runImport = () =>
    spawnSync(process.execPath, args, {
      cwd: REPO_ROOT,
      env: childEnv,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 16,
      timeout: importTimeoutMs,
      killSignal: "SIGTERM",
    });

  const rerunWithCompatShrink = () => {
    const rows = readJsonlRows(path);
    if (rows.length === 0) return null;
    writeJsonlFile(path, shrinkRowsForCompat(rows));
    return runImport();
  };

  let result = runImport();
  const stderr = clean(result.stderr);
  const stdout = clean(result.stdout);
  const combined = `${stderr}\n${stdout}`.trim();
  if (result.status === 0) {
    const parsed = parseJson(stdout, {});
    if (importPayloadHasCompatFailure(parsed)) {
      const compatResult = rerunWithCompatShrink();
      if (compatResult) {
        result = compatResult;
        if (result.status === 0) {
          return {
            ok: true,
            result: parseJson(result.stdout, {}),
            raw: clean(`${result.stderr ?? ""}\n${result.stdout ?? ""}`),
          };
        }
      }
    }
    return {
      ok: true,
      result: parsed,
      raw: combined,
    };
  }

  if (/content.*20,?000|content.*max|max.*content|too_big|too long|validation/i.test(combined)) {
    const compatResult = rerunWithCompatShrink();
    if (compatResult) {
      result = compatResult;
      if (result.status === 0) {
        return {
          ok: true,
          result: parseJson(result.stdout, {}),
          raw: clean(result.stdout),
        };
      }
    }
  }

  return {
    ok: false,
    error:
      combined ||
      clean(result.error ? `${result.error.code || result.error.name || "error"}: ${result.error.message}` : "") ||
      `open-memory import exited with status ${result.status ?? "unknown"}`,
  };
}

function importFailureBackoffActive(state, nowMs, failureBackoffMs) {
  if (failureBackoffMs <= 0 || !clean(state?.lastImportError)) return false;
  const lastAttemptMs = Date.parse(clean(state?.lastImportAttemptAt));
  if (!Number.isFinite(lastAttemptMs)) return false;
  return nowMs - lastAttemptMs < failureBackoffMs;
}

function queueCompaction(threadInfo, products, watermark, runtimePaths) {
  const queuePath = buildCompactionQueuePath(threadInfo.threadId, products.compactionId);
  const rows = [...products.rawRows, products.windowRow, ...products.promotedRows];
  writeJsonlFile(queuePath, rows);
  const reportPath = resolve(runtimePaths.runtimeDir, `${products.compactionId}-report.json`);
  writeJson(reportPath, {
    ...buildCompactionBatchReport(products),
    threadId: threadInfo.threadId,
    rolloutPath: threadInfo.rolloutPath,
    queuePath,
    reportPath,
  });
  watermark.compactions[products.compactionId] = {
    ...(watermark.compactions[products.compactionId] || {}),
    lineNumber: Number(products?.windowRow?.metadata?.lineNumber ?? watermark.compactions[products.compactionId]?.lineNumber ?? 0) || 0,
    queuedAt: new Date().toISOString(),
    queuePath,
    reportPath,
    afterEligibleCount: products.afterEligibleCount,
  };
}

function detectCompactions(entries, threadInfo, watermark) {
  for (const entry of entries) {
    if (Number(entry.lineNumber ?? 0) <= Number(watermark.lastProcessedLine ?? 0)) continue;
    if (!isContextCompactedEvent(entry)) continue;
    const compactionId = buildCompactionId({
      threadId: threadInfo.threadId,
      timestamp: entry.event?.timestamp,
      rolloutPath: threadInfo.rolloutPath,
      lineNumber: entry.lineNumber,
    });
    if (!watermark.compactions[compactionId]) {
      watermark.compactions[compactionId] = {
        lineNumber: entry.lineNumber,
        timestamp: entry.event?.timestamp,
        detectedAtMs: Date.now(),
      };
    }
  }
}

async function processLoop({
  threadInfo,
  runtimePaths,
  startupContextPath,
  parentPid,
  once,
  pollMs,
  env,
}) {
  const settings = compactionSettingsFromEnv(env);
  const importTimeoutMs = readEnvNumber(env, "CODEX_SESSION_MEMORY_IMPORT_TIMEOUT_MS", 120_000, {
    min: 5_000,
    max: 15 * 60 * 1000,
  });
  const failureBackoffMs = readEnvNumber(env, "CODEX_SESSION_MEMORY_IMPORT_FAILURE_BACKOFF_MS", 60_000, {
    min: 0,
    max: 60 * 60 * 1000,
  });
  const maxImportsPerLoop = readEnvNumber(env, "CODEX_SESSION_MEMORY_MAX_IMPORTS_PER_LOOP", 1, {
    min: 1,
    max: 25,
  });
  const disableRunBurstLimit = readEnvBool(env, "CODEX_SESSION_MEMORY_DISABLE_RUN_BURST_LIMIT", false);
  const watermark = readCompactionWatermark(runtimePaths.compactionWatermarkPath);
  watermark.threadId = threadInfo.threadId;
  watermark.rolloutPath = threadInfo.rolloutPath;
  if (startupContextPath) {
    watermark.startupContextPath = startupContextPath;
  }

  for (;;) {
    const entries = parseRolloutEntries(threadInfo.rolloutPath);
    detectCompactions(entries, threadInfo, watermark);

    for (const [compactionId, state] of Object.entries(watermark.compactions || {})) {
      if (state.importedAt) continue;
      if (state.queuePath && existsSync(state.queuePath)) continue;
      const products = extractCompactionMemoryProducts({
        threadInfo,
        rolloutEntries: entries,
        compactionLineNumber: state.lineNumber,
        beforeCount: settings.compactionBefore,
        afterCount: settings.compactionAfter,
        rawRowMaxBytes: settings.rawRowMaxBytes,
        rawBatchMaxBytes: settings.rawBatchMaxBytes,
        rawTtlDays: settings.rawTtlDays,
      });
      const afterSatisfied = Number(products.afterEligibleCount ?? 0) >= settings.compactionAfter;
      const oldEnough = Date.now() - Number(state.detectedAtMs ?? 0) >= 5000;
      if (!afterSatisfied && !oldEnough) {
        continue;
      }
      queueCompaction(threadInfo, products, watermark, runtimePaths);
      watermark.compactions[compactionId] = {
        ...watermark.compactions[compactionId],
        afterEligibleCount: products.afterEligibleCount,
      };
    }

    let importsThisLoop = 0;
    const nowMs = Date.now();
    for (const pendingPath of listPendingJsonl(runtimePaths.pendingDir)) {
      const compactionId = clean(pendingPath.split(/[/\\]/).pop() || "").replace(/\.jsonl$/i, "");
      const state = watermark.compactions?.[compactionId] || {};
      if (importFailureBackoffActive(state, nowMs, failureBackoffMs)) continue;
      const result = importPendingFile(pendingPath, env, {
        disableRunBurstLimit,
        importTimeoutMs,
      });
      importsThisLoop += 1;
      if (result.ok) {
        rmSync(pendingPath, { force: true });
        watermark.compactions[compactionId] = {
          ...(watermark.compactions[compactionId] || {}),
          importedAt: new Date().toISOString(),
          lastImportError: "",
          lastImportAttemptAt: new Date().toISOString(),
          queuePath: pendingPath,
          importResult: result.result || null,
        };
      } else {
        watermark.compactions[compactionId] = {
          ...(watermark.compactions[compactionId] || {}),
          lastImportError: clean(result.error),
          lastImportAttemptAt: new Date().toISOString(),
          queuePath: pendingPath,
        };
      }
      if (importsThisLoop >= maxImportsPerLoop) break;
    }

    watermark.lastProcessedLine = entries.length;
    writeCompactionWatermark(runtimePaths.compactionWatermarkPath, watermark);

    if (once) return;
    if (!parentAlive(parentPid)) {
      if (listPendingJsonl(runtimePaths.pendingDir).length === 0) return;
    }
    await sleep(pollMs);
  }
}

async function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const threadId = readStringFlag(flags, "thread-id", process.env.CODEX_THREAD_ID || "");
  const cwd = readStringFlag(flags, "cwd", process.cwd());
  const rolloutPathOverride = readStringFlag(flags, "rollout-path", "");
  const startupContextPath = readStringFlag(flags, "startup-context-path", process.env.STUDIO_BRAIN_BOOTSTRAP_CONTEXT_PATH || "");
  const parentPid = readNumberFlag(flags, "parent-pid", Number(process.ppid || 0), { min: 0 });
  const pollMs = readNumberFlag(flags, "poll-ms", 2000, { min: 250, max: 30000 });
  const once = readBoolFlag(flags, "once", false);

  const threadInfo = resolveCodexThreadContext({ threadId, cwd }) || {
    threadId: clean(threadId) || `cwd-${cwd}`,
    rolloutPath: rolloutPathOverride,
    cwd,
    title: "",
    firstUserMessage: "",
    updatedAt: "",
  };
  if (!threadInfo.rolloutPath && rolloutPathOverride) {
    threadInfo.rolloutPath = rolloutPathOverride;
  }
  if (!threadInfo.rolloutPath) {
    throw new Error("Unable to resolve rollout path for companion.");
  }

  const runtimePaths = runtimePathsForThread(threadInfo.threadId);
  const lock = acquireCompanionLock({ runtimePaths, threadInfo, parentPid, env: process.env });
  if (!lock) return;
  installLockRelease(lock);
  try {
    await processLoop({
      threadInfo,
      runtimePaths,
      startupContextPath,
      parentPid,
      once,
      pollMs,
      env: process.env,
    });
  } finally {
    lock.release();
  }
}

main().catch((error) => {
  process.stderr.write(`session-memory-companion failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
