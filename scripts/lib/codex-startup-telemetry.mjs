import { spawnSync } from "node:child_process";
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
    return startupToolNames.has(clean(record?.metadata?.toolName));
  });
  const firstAssistantIndex = records.findIndex((record) => isAssistantMessage(record));
  const assistantTelemetryIndex =
    firstStartupToolIndex >= 0
      ? records.findIndex((record, index) => index > firstStartupToolIndex && isAssistantMessage(record))
      : firstAssistantIndex;
  const assistantRecord = assistantTelemetryIndex >= 0 ? records[assistantTelemetryIndex] : null;
  const groundingLineEmitted = assistantRecord
    ? clean(assistantRecord.content).replace(/^\s+/, "").startsWith("Grounding:")
    : null;

  return {
    threadId: clean(threadInfo.threadId),
    rolloutPath,
    startupToolObserved: firstStartupToolIndex >= 0,
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
