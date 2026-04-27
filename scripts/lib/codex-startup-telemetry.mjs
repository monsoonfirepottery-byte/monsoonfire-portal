import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeRolloutRecord, parseRolloutEntries, resolveCodexThreadContext } from "./codex-session-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");
const LOG_TOOLCALL_SCRIPT = resolve(REPO_ROOT, "scripts", "codex", "log-toolcall.mjs");

const DEFAULT_STARTUP_TOOL_NAMES = new Set([
  "studio_brain_startup_context",
  "startup_memory_context",
  "studio_brain_memory_context",
]);

const DIRECT_REPO_READ_TOOLS = new Set([
  "functions.read_mcp_resource",
  "functions.list_mcp_resources",
  "functions.list_mcp_resource_templates",
]);

const EXEC_REPO_READ_PATTERN = /\b(rg|cat|type|dir|ls|get-content|gc|sed|findstr|git\s+show|git\s+diff|git\s+status|more)\b/i;

function clean(value) {
  return String(value ?? "").trim();
}

function startupToolNameVariants(value) {
  const normalized = clean(value);
  if (!normalized) return [];
  const variants = new Set([normalized]);
  const withoutFunctionsPrefix = normalized.replace(/^functions\./i, "");
  if (withoutFunctionsPrefix) variants.add(withoutFunctionsPrefix);
  if (withoutFunctionsPrefix.startsWith("mcp__")) {
    const parts = withoutFunctionsPrefix.split("__");
    if (parts.length >= 3) {
      variants.add(parts.slice(2).join("__"));
    }
  }
  return Array.from(variants).filter(Boolean);
}

export function matchesStartupToolName(value, startupToolNames = DEFAULT_STARTUP_TOOL_NAMES) {
  const allowed = new Set(Array.from(startupToolNames || []).map((entry) => clean(entry)).filter(Boolean));
  return startupToolNameVariants(value).some((variant) => allowed.has(variant));
}

function resolveStartupThreadHint(env = process.env) {
  return clean(
    env.STUDIO_BRAIN_BOOTSTRAP_THREAD_ID ||
      env.CODEX_THREAD_ID ||
      env.CODEX_THREAD ||
      env.CODEX_OPEN_MEMORY_THREAD_ID ||
      env.STUDIO_BRAIN_THREAD_ID ||
      ""
  );
}

function resolveStartupCwd(env = process.env) {
  return clean(env.CODEX_CWD || env.INIT_CWD || env.PWD || process.cwd()) || process.cwd();
}

function toNullableBoolean(value) {
  if (typeof value === "boolean") return value;
  return null;
}

function toNonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.trunc(parsed);
}

function isAssistantMessage(record) {
  return record?.captureKind === "message" && clean(record?.role).toLowerCase() === "assistant" && clean(record?.content);
}

function isRepoReadToolCall(record) {
  if (record?.captureKind !== "function_call") return false;
  const toolName = clean(record?.metadata?.toolName);
  if (!toolName) return false;
  if (DIRECT_REPO_READ_TOOLS.has(toolName)) return true;
  if (toolName !== "functions.exec_command") return false;
  return EXEC_REPO_READ_PATTERN.test(clean(record?.content));
}

export function inspectStartupTranscriptTelemetry({
  env = process.env,
  startupToolNames = DEFAULT_STARTUP_TOOL_NAMES,
  cwd = resolveStartupCwd(env),
} = {}) {
  const threadInfo = resolveCodexThreadContext({
    threadId: resolveStartupThreadHint(env),
    cwd,
  });

  if (!threadInfo?.threadId) {
    return {
      threadId: "",
      rolloutPath: "",
      startupToolObserved: false,
      startupToolCalledBeforeFirstAssistantMessage: null,
      groundingLineEmitted: null,
      groundingLineObserved: false,
      repoReadsBeforeStartupContext: null,
      repoReadTelemetryObserved: false,
      source: "thread-unavailable",
    };
  }

  const rolloutPath = clean(threadInfo.rolloutPath);
  if (!rolloutPath) {
    return {
      threadId: clean(threadInfo.threadId),
      rolloutPath: "",
      startupToolObserved: false,
      startupToolCalledBeforeFirstAssistantMessage: null,
      groundingLineEmitted: null,
      groundingLineObserved: false,
      repoReadsBeforeStartupContext: null,
      repoReadTelemetryObserved: false,
      source: "rollout-unavailable",
    };
  }

  const records = parseRolloutEntries(rolloutPath)
    .map((entry) => normalizeRolloutRecord(entry, threadInfo))
    .filter(Boolean);

  const firstStartupToolIndex = records.findIndex((record) => {
    if (record?.captureKind !== "function_call") return false;
    return matchesStartupToolName(record?.metadata?.toolName, startupToolNames);
  });
  const firstAssistantIndex = records.findIndex((record) => isAssistantMessage(record));
  const assistantTelemetryIndex =
    firstStartupToolIndex >= 0
      ? records.findIndex((record, index) => index > firstStartupToolIndex && isAssistantMessage(record))
      : firstAssistantIndex;
  const assistantRecord = assistantTelemetryIndex >= 0 ? records[assistantTelemetryIndex] : null;
  const startupToolRecord = firstStartupToolIndex >= 0 ? records[firstStartupToolIndex] : null;
  const groundingLineEmitted = assistantRecord
    ? clean(assistantRecord.content).replace(/^\s+/, "").startsWith("Grounding:")
    : null;

  return {
    threadId: clean(threadInfo.threadId),
    rolloutPath,
    startupToolObserved: firstStartupToolIndex >= 0,
    startupToolName: clean(startupToolRecord?.metadata?.toolName),
    startupToolCalledBeforeFirstAssistantMessage:
      firstStartupToolIndex >= 0 && firstAssistantIndex >= 0 ? firstStartupToolIndex < firstAssistantIndex : null,
    groundingLineEmitted: toNullableBoolean(groundingLineEmitted),
    groundingLineObserved: Boolean(assistantRecord),
    repoReadsBeforeStartupContext:
      firstStartupToolIndex >= 0
        ? records.slice(0, firstStartupToolIndex).filter((record) => isRepoReadToolCall(record)).length
        : null,
    repoReadTelemetryObserved: firstStartupToolIndex >= 0,
    source: "codex-rollout",
  };
}

function readToolcallEntries(toolcallPath) {
  if (!toolcallPath || !existsSync(toolcallPath)) return [];
  const raw = readFileSync(toolcallPath, "utf8");
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function sleepMs(durationMs) {
  const millis = Math.max(0, Math.round(Number(durationMs) || 0));
  if (millis <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, millis);
}

function withStartupObservationLock(toolcallPath, fn, { timeoutMs = 2000, pollMs = 25 } = {}) {
  const lockPath = `${toolcallPath}.startup.lock`;
  mkdirSync(dirname(lockPath), { recursive: true });
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    let lockFd = null;
    try {
      lockFd = openSync(lockPath, "wx");
      try {
        return fn();
      } finally {
        if (lockFd != null) closeSync(lockFd);
        try {
          unlinkSync(lockPath);
        } catch {}
      }
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      sleepMs(pollMs);
    }
  }

  return fn();
}

function hasStartupObservation(entries, { tool, action, observationKey, threadId, rolloutPath }) {
  return (entries || []).some((entry) => {
    if (clean(entry?.tool) !== clean(tool) || clean(entry?.action) !== clean(action)) return false;
    const startup = entry?.context?.startup && typeof entry.context.startup === "object" ? entry.context.startup : {};
    const startupPacket = startup?.startupPacket && typeof startup.startupPacket === "object" ? startup.startupPacket : {};
    if (observationKey && clean(startup.observationKey || startupPacket.observationKey) === observationKey) return true;
    if (threadId && rolloutPath) {
      return (
        clean(startup.threadId || startupPacket.threadId) === threadId &&
        clean(startup.rolloutPath || startupPacket.rolloutPath) === rolloutPath
      );
    }
    return false;
  });
}

export function logStartupTelemetryToolcall({
  tool,
  action = "startup-bootstrap",
  ok = true,
  durationMs = null,
  errorType = null,
  errorMessage = null,
  context = null,
  env = process.env,
  cwd = REPO_ROOT,
} = {}) {
  const args = [
    LOG_TOOLCALL_SCRIPT,
    "--actor",
    "codex",
    "--tool",
    clean(tool) || "codex",
    "--action",
    clean(action) || "startup-bootstrap",
    "--ok",
    ok ? "true" : "false",
  ];

  const normalizedDurationMs = toNonNegativeInteger(durationMs);
  if (normalizedDurationMs != null) {
    args.push("--duration-ms", String(normalizedDurationMs));
  }
  if (clean(errorType)) {
    args.push("--error-type", clean(errorType));
  }
  if (clean(errorMessage)) {
    args.push("--error-message", clean(errorMessage));
  }
  if (context && typeof context === "object") {
    args.push("--context-json", JSON.stringify(context));
  }

  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    ok: result.status === 0,
    status: typeof result.status === "number" ? result.status : 1,
    stdout: clean(result.stdout),
    stderr: clean(result.stderr),
    error: result.error instanceof Error ? result.error.message : "",
  };
}

export function maybeLogStartupTelemetryToolcall({
  tool,
  action = "startup-bootstrap",
  context = null,
  cwd = REPO_ROOT,
  ...rest
} = {}) {
  const startup = context?.startup && typeof context.startup === "object" ? context.startup : {};
  const startupPacket = startup?.startupPacket && typeof startup.startupPacket === "object" ? startup.startupPacket : {};
  const observationKey = clean(startup.observationKey || startupPacket.observationKey);
  const threadId = clean(startup.threadId || startupPacket.threadId);
  const rolloutPath = clean(startup.rolloutPath || startupPacket.rolloutPath);
  if (!observationKey && !(threadId && rolloutPath)) {
    return {
      ok: false,
      skipped: true,
      reason: "missing-startup-observation-key",
    };
  }

  const toolcallPath = resolve(cwd, ".codex", "toolcalls.ndjson");
  return withStartupObservationLock(toolcallPath, () => {
    const existingEntries = readToolcallEntries(toolcallPath);
    if (hasStartupObservation(existingEntries, { tool, action, observationKey, threadId, rolloutPath })) {
      return {
        ok: true,
        skipped: true,
        reason: "startup-observation-already-logged",
      };
    }

    return logStartupTelemetryToolcall({
      tool,
      action,
      context,
      cwd,
      ...rest,
    });
  });
}
