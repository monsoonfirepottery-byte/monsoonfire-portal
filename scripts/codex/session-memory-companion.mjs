#!/usr/bin/env node

import { readdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
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
    if (content.length <= 18_000) return row;
    return {
      ...row,
      content: `${content.slice(0, 17_980).trimEnd()} [truncated for import compatibility]`,
      metadata: {
        ...(row?.metadata && typeof row.metadata === "object" ? row.metadata : {}),
        importCompatibilityClip: true,
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

function importPendingFile(path, env) {
  const authToken = clean(env.STUDIO_BRAIN_AUTH_TOKEN || env.STUDIO_BRAIN_ID_TOKEN || env.STUDIO_BRAIN_MCP_ID_TOKEN || "");
  const adminToken = clean(env.STUDIO_BRAIN_ADMIN_TOKEN || env.STUDIO_BRAIN_MCP_ADMIN_TOKEN || "");
  const args = [
    OPEN_MEMORY_SCRIPT,
    "import",
    "--input",
    path,
    "--continue-on-error",
    "true",
    "--disable-run-burst-limit",
    "true",
  ];
  if (authToken) {
    args.push("--auth", authToken);
  }
  if (adminToken) {
    args.push("--admin-token", adminToken);
  }
  const runImport = () =>
    spawnSync(process.execPath, args, {
      cwd: REPO_ROOT,
      env,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 16,
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
    error: combined || `open-memory import exited with status ${result.status ?? "unknown"}`,
  };
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

    for (const pendingPath of listPendingJsonl(runtimePaths.pendingDir)) {
      const compactionId = clean(pendingPath.split(/[/\\]/).pop() || "").replace(/\.jsonl$/i, "");
      const result = importPendingFile(pendingPath, env);
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
  await processLoop({
    threadInfo,
    runtimePaths,
    startupContextPath,
    parentPid,
    once,
    pollMs,
    env: process.env,
  });
}

main().catch((error) => {
  process.stderr.write(`session-memory-companion failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
