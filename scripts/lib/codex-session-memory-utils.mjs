import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  buildContextSignals,
  classifyDevelopmentScope,
  detectPoisoning,
  extractStructuredCandidates,
  inferProjectLane,
  normalizeHybridText,
  redactLikelySecrets,
} from "./hybrid-memory-utils.mjs";
import { readJson, stableHash, writeJson } from "./pst-memory-utils.mjs";

const DEFAULT_COMPACTION_WINDOW_BEFORE = 40;
const DEFAULT_COMPACTION_WINDOW_AFTER = 12;
const DEFAULT_RAW_ROW_MAX_BYTES = 64 * 1024;
const DEFAULT_RAW_BATCH_MAX_BYTES = 512 * 1024;
const DEFAULT_RAW_TTL_DAYS = 90;

const BOILERPLATE_PATTERNS = [
  /^<permissions instructions>/i,
  /^# AGENTS\.md instructions/i,
  /^<environment_context>/i,
  /^<collaboration_mode>/i,
  /^<INSTRUCTIONS>/i,
  /^## JavaScript REPL/i,
  /^## Skills/i,
  /^## Apps/i,
  /^You are Codex, a coding agent/i,
  /^<subagent_notification>/i,
];

const STARTUP_SOURCE_PREFERENCE = [
  "codex-continuity-envelope",
  "codex-handoff",
  "codex-startup-blocker",
  "codex-friction-feedback-loop",
  "codex",
  "manual",
];

const PROFILE_FAST_LANE_SOURCE_PREFERENCE = [
  "manual",
  "codex-handoff",
  "codex-continuity-envelope",
  "codex",
];

const TRUSTED_STARTUP_SATISFIERS = new Set(["studio-brain", "trusted-envelope", "validated-local-continuity"]);
const STARTUP_BLOCKER_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const STARTUP_SOURCE_DENYLIST = [
  "memory-pack-mined-memories-unique-runid",
  "memory-pack-all-threads-unique-runid",
  "memory-pack-context-derived",
  "memory-pack-codex-exec-derived",
  "chatgpt-export:memory-pack.zip",
  "chatgpt-export:crossref-context-2026-03-03",
  "chatgpt-export:codex-exec-context-2026-03-03",
];

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeSource(value) {
  return clean(value)
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function toRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function dedupeStrings(values, limit = 64) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = clean(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

export function codexHomePath(...parts) {
  return resolve(homedir(), ".codex", ...parts);
}

export function normalizeThreadCwd(value) {
  const trimmed = clean(value);
  if (!trimmed) return "";
  return trimmed.replace(/^\\\\\?\\/, "");
}

function normalizeContinuityProfile(profile) {
  const normalized = clean(profile).toLowerCase();
  if (normalized === "profile-fast-lane") return "profile-fast-lane";
  if (normalized === "task-broad") return "task-broad";
  return "startup-strict";
}

export function preferredStartupSources(profile = "startup-strict") {
  const normalized = normalizeContinuityProfile(profile);
  if (normalized === "profile-fast-lane") {
    return [...PROFILE_FAST_LANE_SOURCE_PREFERENCE];
  }
  return [...STARTUP_SOURCE_PREFERENCE];
}

export function preferredStartupSourceDenylist() {
  return [...STARTUP_SOURCE_DENYLIST];
}

export function preferredStartupSourcePriority(source, profile = "startup-strict") {
  const preferredSources = preferredStartupSources(profile);
  const normalized = normalizeSource(source);
  const directIndex = preferredSources.indexOf(normalized);
  if (directIndex >= 0) return directIndex;
  if (normalized.startsWith("context-slice:")) {
    return preferredSources.indexOf("context-slice") >= 0
      ? preferredSources.indexOf("context-slice")
      : 99;
  }
  return 99;
}

function normalizeBootstrapMode(mode) {
  const normalized = clean(mode).toLowerCase();
  if (!normalized) return "hard";
  if (["off", "disabled", "none", "false", "0"].includes(normalized)) return "off";
  if (["local", "local-only", "fallback-only", "rollout-history"].includes(normalized)) return "local-only";
  return "hard";
}

function normalizeBootstrapFailureMode(mode) {
  const normalized = clean(mode).toLowerCase();
  if (!normalized) return "none";
  if (["none", "disabled", "off", "strict", "hard-fail", "fail", "error"].includes(normalized)) return "none";
  return "local-fallback";
}

export function resolveStartupBootstrapPolicy(settings = {}) {
  const bootstrapMode = normalizeBootstrapMode(settings.bootstrapMode);
  const bootstrapFailureMode = normalizeBootstrapFailureMode(settings.bootstrapFailureMode);
  const strictStartupAllowlist = settings.strictStartupAllowlist !== false;
  return {
    bootstrapMode,
    bootstrapFailureMode,
    strictStartupAllowlist,
    remoteEnabled: bootstrapMode === "hard",
    localFallbackEnabled:
      bootstrapMode !== "off" && (bootstrapMode === "local-only" || bootstrapFailureMode === "local-fallback"),
  };
}

export function buildStartupContextSearchPayload({ query, strictStartupAllowlist = true } = {}) {
  const payload = {
    query: clean(query),
    maxItems: 10,
    maxChars: 8000,
    scanLimit: 180,
    includeTenantFallback: false,
    retrievalMode: "hybrid",
    sourceDenylist: preferredStartupSourceDenylist(),
  };
  if (strictStartupAllowlist) {
    payload.sourceAllowlist = preferredStartupSources("startup-strict");
  }
  return payload;
}

export function runtimePathsForThread(threadId) {
  const stableThreadId = clean(threadId) || `cwd-${stableHash(process.cwd(), 16)}`;
  const runtimeDir = codexHomePath("memory", "runtime", stableThreadId);
  return {
    threadId: stableThreadId,
    runtimeDir,
    sharedToolProfileCachePath: codexHomePath("memory", "runtime", "tool-profile-cache.json"),
    toolProfileSnapshotPath: resolve(runtimeDir, "tool-profile.json"),
    bootstrapContextJsonPath: resolve(runtimeDir, "bootstrap-context.json"),
    bootstrapContextMarkdownPath: resolve(runtimeDir, "bootstrap-context.md"),
    bootstrapMetadataPath: resolve(runtimeDir, "bootstrap-metadata.json"),
    continuityEnvelopePath: resolve(runtimeDir, "continuity-envelope.json"),
    startupBlockerPath: resolve(runtimeDir, "startup-blocker.json"),
    handoffPath: resolve(runtimeDir, "handoff.json"),
    writesJsonlPath: resolve(runtimeDir, "writes.jsonl"),
    compactionWatermarkPath: resolve(runtimeDir, "compaction-watermark.json"),
    pendingDir: resolve(runtimeDir, "pending"),
  };
}

function ensureRuntimeDir(path) {
  mkdirSync(path, { recursive: true });
}

function parseTimestampMs(value) {
  const text = clean(value);
  if (!text) return 0;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeIsoTimestamp(value, fallback = "") {
  const text = clean(value);
  if (text) {
    const parsed = Date.parse(text);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return fallback || new Date().toISOString();
}

function normalizeArtifactPointers(value) {
  const record = toRecord(value);
  return Object.fromEntries(
    Object.entries(record)
      .map(([key, entry]) => [clean(key), clean(entry)])
      .filter(([key, entry]) => key && entry)
  );
}

function normalizeSignalRows(value, keyName = "summary", limit = 12) {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set();
  const normalized = [];
  for (const row of rows) {
    const record = toRecord(row);
    const primary = clean(record[keyName] || record.summary || record.reason || JSON.stringify(record));
    if (!primary || seen.has(primary)) continue;
    seen.add(primary);
    normalized.push({
      ...record,
      [keyName]: clean(record[keyName] || record.summary || primary),
      ...(record.summary || keyName === "summary" ? { summary: clean(record.summary || primary) } : {}),
      ...(record.reason ? { reason: clean(record.reason) } : {}),
    });
    if (normalized.length >= limit) break;
  }
  return normalized;
}

function normalizeBlockers(value, limit = 12) {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set();
  const normalized = [];
  for (const row of rows) {
    const record = toRecord(row);
    const summary = clean(record.summary || record.firstSignal || record.blocker || record.reason);
    if (!summary || seen.has(summary)) continue;
    seen.add(summary);
    normalized.push({
      summary,
      ...(clean(record.reason) ? { reason: clean(record.reason) } : {}),
      ...(clean(record.unblockStep) ? { unblockStep: clean(record.unblockStep) } : {}),
      ...(clean(record.occurredAt) ? { occurredAt: normalizeIsoTimestamp(record.occurredAt) } : {}),
      ...(clean(record.source) ? { source: clean(record.source) } : {}),
    });
    if (normalized.length >= limit) break;
  }
  return normalized;
}

export function normalizeContinuityState(value, fallback = "missing") {
  const normalized = clean(value).toLowerCase();
  if (normalized === "ready") return "ready";
  if (normalized === "blocked") return "blocked";
  if (normalized === "missing") return "missing";
  return fallback;
}

export function isFreshStartupArtifact(value, maxAgeMs = STARTUP_BLOCKER_MAX_AGE_MS, nowMs = Date.now()) {
  const parsed = Date.parse(clean(value));
  if (!Number.isFinite(parsed)) return false;
  return parsed >= nowMs - Math.max(1000, maxAgeMs);
}

export function normalizeResumeHints(value, limit = 12) {
  const hints = Array.isArray(value) ? value : [];
  const seen = new Set();
  const normalized = [];
  for (const hint of hints) {
    if (typeof hint === "string") {
      const summary = clean(hint);
      if (!summary || seen.has(summary)) continue;
      seen.add(summary);
      normalized.push({ summary });
    } else if (hint && typeof hint === "object") {
      const record = toRecord(hint);
      const summary = clean(record.summary || record.nextStep || record.label || JSON.stringify(record));
      if (!summary || seen.has(summary)) continue;
      seen.add(summary);
      normalized.push({
        ...record,
        summary,
        ...(clean(record.nextStep) ? { nextStep: clean(record.nextStep) } : {}),
        ...(clean(record.path) ? { path: clean(record.path) } : {}),
      });
    }
    if (normalized.length >= limit) break;
  }
  return normalized;
}

export function normalizeContinuityEnvelope(envelope = {}, { threadId = "", cwd = "", existing = null, now = new Date().toISOString() } = {}) {
  const source = toRecord(envelope);
  const prior = toRecord(existing);
  const continuityState = normalizeContinuityState(
    source.continuityState || source.startup?.continuityState || prior.continuityState || prior.startup?.continuityState,
    "missing"
  );
  const startupSatisfiedBy = clean(
    source.startupSatisfiedBy || source.startup?.satisfiedBy || prior.startupSatisfiedBy || prior.startup?.satisfiedBy
  );
  return {
    ...prior,
    ...source,
    schema: "codex-continuity-envelope.v1",
    createdAt: normalizeIsoTimestamp(source.createdAt || prior.createdAt, now),
    updatedAt: normalizeIsoTimestamp(source.updatedAt || now, now),
    threadId: clean(source.threadId || prior.threadId || threadId),
    cwd: normalizeThreadCwd(source.cwd || prior.cwd || cwd),
    continuityState,
    startupSatisfiedBy,
    currentGoal: clean(source.currentGoal || prior.currentGoal),
    lastHandoffSummary: clean(source.lastHandoffSummary || prior.lastHandoffSummary),
    blockers: normalizeBlockers(source.blockers ?? prior.blockers),
    nextRecommendedAction: clean(source.nextRecommendedAction || prior.nextRecommendedAction),
    bootstrapSummary: clean(source.bootstrapSummary || prior.bootstrapSummary),
    threadTitle: clean(source.threadTitle || prior.threadTitle),
    firstUserMessage: clean(source.firstUserMessage || prior.firstUserMessage),
    query: clean(source.query || prior.query),
    rolloutPath: clean(source.rolloutPath || prior.rolloutPath),
    trustedSources: dedupeStrings([...(Array.isArray(prior.trustedSources) ? prior.trustedSources : []), ...(Array.isArray(source.trustedSources) ? source.trustedSources : [])], 12),
    frustrationSignals: normalizeSignalRows(source.frustrationSignals ?? prior.frustrationSignals, "summary"),
    ratholeSignals: normalizeSignalRows(source.ratholeSignals ?? prior.ratholeSignals, "summary"),
    artifactPointers: normalizeArtifactPointers(source.artifactPointers || prior.artifactPointers),
    startup: {
      ...toRecord(prior.startup),
      ...toRecord(source.startup),
      satisfiedBy: startupSatisfiedBy,
      continuityState,
      continuityAvailable: continuityState === "ready",
      remoteError: clean(source.startup?.remoteError || source.remoteError || prior.startup?.remoteError),
    },
    git: Object.keys(toRecord(source.git)).length > 0 ? toRecord(source.git) : toRecord(prior.git),
  };
}

export function normalizeStartupBlocker(blocker = {}, { threadId = "", cwd = "", existing = null, now = new Date().toISOString() } = {}) {
  const source = toRecord(blocker);
  const prior = toRecord(existing);
  const status = clean(source.status || prior.status).toLowerCase() === "blocked" ? "blocked" : "clear";
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(source, key);
  return {
    ...prior,
    ...source,
    schema: "codex-startup-blocker.v1",
    createdAt: normalizeIsoTimestamp(source.createdAt || prior.createdAt, now),
    threadId: clean(source.threadId || prior.threadId || threadId),
    cwd: normalizeThreadCwd(source.cwd || prior.cwd || cwd),
    status,
    failureClass: hasOwn("failureClass") ? clean(source.failureClass) : clean(prior.failureClass),
    query: hasOwn("query") ? clean(source.query) : clean(prior.query),
    queryFingerprint: hasOwn("queryFingerprint") ? clean(source.queryFingerprint) : clean(prior.queryFingerprint),
    firstSignal: hasOwn("firstSignal") ? clean(source.firstSignal) : clean(prior.firstSignal),
    remoteError: hasOwn("remoteError") ? clean(source.remoteError) : clean(prior.remoteError),
    unblockStep: hasOwn("unblockStep") ? clean(source.unblockStep) : clean(prior.unblockStep),
    localDiagnosticsAvailable:
      source.localDiagnosticsAvailable === undefined
        ? Boolean(prior.localDiagnosticsAvailable)
        : Boolean(source.localDiagnosticsAvailable),
    blockers: normalizeBlockers(source.blockers ?? prior.blockers),
    git: Object.keys(toRecord(source.git)).length > 0 ? toRecord(source.git) : toRecord(prior.git),
  };
}

export function normalizeHandoffArtifact(handoff = {}, { threadId = "", existing = null, now = new Date().toISOString() } = {}) {
  const source = toRecord(handoff);
  const prior = toRecord(existing);
  const summary = clean(source.summary || prior.summary || source.workCompleted || prior.workCompleted);
  return {
    ...prior,
    ...source,
    schema: "codex-handoff.v1",
    createdAt: normalizeIsoTimestamp(source.createdAt || prior.createdAt, now),
    threadId: clean(source.threadId || prior.threadId || threadId),
    runId: clean(source.runId || prior.runId),
    agentId: clean(source.agentId || prior.agentId),
    startupProvenance: {
      ...toRecord(prior.startupProvenance),
      ...toRecord(source.startupProvenance),
    },
    completionStatus: clean(source.completionStatus || prior.completionStatus || "complete"),
    activeGoal: clean(source.activeGoal || prior.activeGoal),
    summary,
    workCompleted: clean(source.workCompleted || prior.workCompleted || summary),
    blockers: normalizeBlockers(source.blockers ?? prior.blockers),
    nextRecommendedAction: clean(source.nextRecommendedAction || prior.nextRecommendedAction),
    artifactPointers: normalizeArtifactPointers(source.artifactPointers || prior.artifactPointers),
    parentRunId: clean(source.parentRunId || prior.parentRunId),
    handoffOwner: clean(source.handoffOwner || prior.handoffOwner),
    sourceShellId: clean(source.sourceShellId || prior.sourceShellId),
    targetShellId: clean(source.targetShellId || prior.targetShellId),
    resumeHints: normalizeResumeHints(source.resumeHints ?? prior.resumeHints),
  };
}

export function resolveBootstrapContinuityState({
  remoteContextAvailable = false,
  startupBlocker = null,
  continuityEnvelope = null,
  handoff = null,
  query = "",
  nowMs = Date.now(),
} = {}) {
  const blocker = normalizeStartupBlocker(startupBlocker);
  const envelope = normalizeContinuityEnvelope(continuityEnvelope);
  const handoffArtifact = normalizeHandoffArtifact(handoff);
  const supplementalHandoffSummary = clean(
    envelope.lastHandoffSummary || handoffArtifact.summary || handoffArtifact.workCompleted || handoffArtifact.activeGoal
  );
  const matchingBlocker =
    blocker.status === "blocked"
    && blocker.queryFingerprint
    && blocker.queryFingerprint === stableHash(clean(query), 24)
    && isFreshStartupArtifact(blocker.createdAt, STARTUP_BLOCKER_MAX_AGE_MS, nowMs);
  if (remoteContextAvailable) {
    return {
      continuityState: "ready",
      blockerActive: false,
      source: "remote",
      supplementalHandoffSummary,
    };
  }
  if (matchingBlocker) {
    return {
      continuityState: "blocked",
      blockerActive: true,
      source: "startup-blocker",
      supplementalHandoffSummary,
    };
  }
  const priorReady =
    normalizeContinuityState(envelope.continuityState || envelope.startup?.continuityState) === "ready"
    || Boolean(supplementalHandoffSummary);
  if (priorReady) {
    return {
      continuityState: "ready",
      blockerActive: false,
      source: "validated-local-continuity",
      supplementalHandoffSummary,
    };
  }
  return {
    continuityState: "missing",
    blockerActive: false,
    source: "missing",
    supplementalHandoffSummary,
  };
}

function boolEnv(value, fallback = false) {
  const normalized = clean(value).toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function intEnv(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(clean(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function readJsonlObjects(path) {
  if (!path || !existsSync(path)) return [];
  return String(readFileSync(path, "utf8") || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseJsonLine(line))
    .filter(Boolean);
}

function readThreadRow({ threadId, cwd, stateDbPath }) {
  if (!stateDbPath || !existsSync(stateDbPath)) return null;
  const db = new DatabaseSync(stateDbPath, { readOnly: true });
  try {
    if (threadId) {
      const byId = db
        .prepare(
          "select id, rollout_path as rolloutPath, cwd, title, first_user_message as firstUserMessage, updated_at as updatedAt from threads where id = ?"
        )
        .get(threadId);
      if (byId) return byId;
    }

    const normalizedCwd = normalizeThreadCwd(cwd);
    if (!normalizedCwd) return null;
    return db
      .prepare(
        [
          "select id, rollout_path as rolloutPath, cwd, title, first_user_message as firstUserMessage, updated_at as updatedAt",
          "from threads",
          "where cwd = ? or cwd = ?",
          "order by updated_at desc",
          "limit 1",
        ].join(" ")
      )
      .get(normalizedCwd, `\\\\?\\${normalizedCwd}`);
  } finally {
    db.close();
  }
}

export function resolveCodexThreadContext({
  threadId = "",
  cwd = process.cwd(),
  stateDbPath = codexHomePath("state_5.sqlite"),
} = {}) {
  const row = readThreadRow({ threadId: clean(threadId), cwd, stateDbPath });
  if (!row) return null;
  const resolvedThreadId = clean(row.id);
  return {
    threadId: resolvedThreadId,
    rolloutPath: clean(row.rolloutPath),
    cwd: normalizeThreadCwd(row.cwd || cwd),
    title: clean(row.title),
    firstUserMessage: clean(row.firstUserMessage),
    updatedAtEpochSeconds: Number(row.updatedAt ?? 0) || 0,
    updatedAt:
      Number.isFinite(Number(row.updatedAt)) && Number(row.updatedAt) > 0
        ? new Date(Number(row.updatedAt) * 1000).toISOString()
        : "",
  };
}

export function readThreadName(threadId, sessionIndexPath = codexHomePath("session_index.jsonl")) {
  if (!threadId || !existsSync(sessionIndexPath)) return "";
  const matches = readJsonlObjects(sessionIndexPath).filter((row) => clean(row?.id) === clean(threadId));
  const latest = matches.sort(
    (left, right) => parseTimestampMs(right?.updated_at) - parseTimestampMs(left?.updated_at)
  )[0];
  return clean(latest?.thread_name);
}

export function readThreadHistoryLines(threadId, { limit = 5, historyPath = codexHomePath("history.jsonl") } = {}) {
  if (!threadId || !existsSync(historyPath)) return [];
  const rows = readJsonlObjects(historyPath)
    .filter((row) => clean(row?.session_id) === clean(threadId))
    .sort((left, right) => Number(left?.ts ?? 0) - Number(right?.ts ?? 0));
  return rows
    .slice(-Math.max(1, limit))
    .map((row) => clean(row?.text))
    .filter(Boolean);
}

export function buildThreadBootstrapQuery({ threadInfo = null, threadName = "", historyLines = [] } = {}) {
  const normalizedCwd = normalizeThreadCwd(threadInfo?.cwd || process.cwd());
  const cwdBase = basename(normalizedCwd) || "workspace";
  const homeBase = basename(normalizeThreadCwd(homedir()));
  const includeCwdSeed =
    normalizedCwd &&
    cwdBase &&
    cwdBase.toLowerCase() !== homeBase.toLowerCase() &&
    !["users", "home", "micah"].includes(cwdBase.toLowerCase());
  const queryParts = dedupeStrings([
    clean(threadName),
    clean(threadInfo?.title),
    clean(threadInfo?.firstUserMessage),
    clean(threadInfo?.threadId),
    includeCwdSeed ? cwdBase : "",
    ...historyLines,
  ]);
  return queryParts.join(" ").slice(0, 4096);
}

function isBoilerplateText(text) {
  const normalized = normalizeHybridText(text);
  if (!normalized) return true;
  return BOILERPLATE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function stringifyPayload(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function messagePartText(part) {
  if (typeof part === "string") return part;
  if (part && typeof part === "object") {
    if (typeof part.text === "string") return part.text;
    if (typeof part.output_text === "string") return part.output_text;
    if (typeof part.input_text === "string") return part.input_text;
  }
  return "";
}

function normalizeRolloutText(text) {
  return redactLikelySecrets(normalizeHybridText(text));
}

function safeClipByBytes(text, maxBytes) {
  const normalized = String(text ?? "");
  if (Buffer.byteLength(normalized, "utf8") <= maxBytes) return normalized;
  let low = 0;
  let high = normalized.length;
  let best = "";
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = `${normalized.slice(0, mid).trimEnd()} [truncated]`;
    const bytes = Buffer.byteLength(candidate, "utf8");
    if (bytes <= maxBytes) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best || normalized.slice(0, Math.max(1, Math.floor(maxBytes / 4))).trimEnd();
}

export function parseRolloutEntries(rolloutPath) {
  if (!rolloutPath || !existsSync(rolloutPath)) return [];
  return String(readFileSync(rolloutPath, "utf8") || "")
    .split(/\r?\n/)
    .map((line, index) => ({
      raw: line,
      lineNumber: index + 1,
      event: line.trim() ? parseJsonLine(line) : null,
    }))
    .filter((entry) => entry.event);
}

export function isContextCompactedEvent(entry) {
  const event = entry?.event || entry;
  return event?.type === "event_msg" && clean(event?.payload?.type) === "context_compacted";
}

export function buildCompactionId({ threadId, timestamp, rolloutPath, lineNumber }) {
  return `compaction-${stableHash(`${clean(threadId)}|${clean(timestamp)}|${clean(rolloutPath)}|${Number(lineNumber) || 0}`, 24)}`;
}

function eventPriority(kind) {
  if (kind === "message") return 4;
  if (kind === "assistant_event") return 3;
  if (kind === "function_call") return 2;
  if (kind === "function_call_output") return 1;
  return 0;
}

function formatFunctionCallText(payload) {
  const name = clean(payload?.name) || "tool";
  const args = normalizeRolloutText(stringifyPayload(payload?.arguments));
  return args ? `Tool call ${name}\n${args}` : `Tool call ${name}`;
}

function formatFunctionCallOutputText(payload) {
  const output = normalizeRolloutText(stringifyPayload(payload?.output));
  return output || "";
}

export function normalizeRolloutRecord(entry, threadInfo = null) {
  const event = entry?.event || entry;
  const lineNumber = Number(entry?.lineNumber ?? 0) || 0;
  if (!event || typeof event !== "object") return null;
  const occurredAt = normalizeIsoTimestamp(event.timestamp);

  if (event.type === "response_item" && clean(event.payload?.type) === "message") {
    const role = clean(event.payload?.role).toLowerCase() || "assistant";
    const parts = Array.isArray(event.payload?.content) ? event.payload.content : [];
    const content = normalizeRolloutText(parts.map((part) => messagePartText(part)).filter(Boolean).join("\n"));
    if (!content || isBoilerplateText(content) || detectPoisoning(content)) return null;
    return {
      lineNumber,
      occurredAt,
      captureKind: "message",
      role,
      source: "codex-rollout",
      content,
      label: role,
      priority: eventPriority("message"),
      lowSignal: false,
      metadata: {
        threadId: clean(threadInfo?.threadId),
        rolloutPath: clean(threadInfo?.rolloutPath),
        cwd: normalizeThreadCwd(threadInfo?.cwd),
        role,
      },
    };
  }

  if (event.type === "event_msg" && clean(event.payload?.type) === "agent_message") {
    const content = normalizeRolloutText(event.payload?.message);
    if (!content || isBoilerplateText(content) || detectPoisoning(content)) return null;
    return {
      lineNumber,
      occurredAt,
      captureKind: "assistant_event",
      role: "assistant",
      source: "codex-rollout",
      content,
      label: "assistant note",
      priority: eventPriority("assistant_event"),
      lowSignal: false,
      metadata: {
        threadId: clean(threadInfo?.threadId),
        rolloutPath: clean(threadInfo?.rolloutPath),
        cwd: normalizeThreadCwd(threadInfo?.cwd),
        phase: clean(event.payload?.phase),
      },
    };
  }

  if (event.type === "response_item" && clean(event.payload?.type) === "function_call") {
    const content = formatFunctionCallText(event.payload);
    if (!content) return null;
    return {
      lineNumber,
      occurredAt,
      captureKind: "function_call",
      role: "assistant",
      source: "codex-rollout",
      content,
      label: clean(event.payload?.name) || "tool call",
      priority: eventPriority("function_call"),
      lowSignal: true,
      metadata: {
        threadId: clean(threadInfo?.threadId),
        rolloutPath: clean(threadInfo?.rolloutPath),
        cwd: normalizeThreadCwd(threadInfo?.cwd),
        callId: clean(event.payload?.call_id),
        toolName: clean(event.payload?.name),
      },
    };
  }

  if (event.type === "response_item" && clean(event.payload?.type) === "function_call_output") {
    const content = formatFunctionCallOutputText(event.payload);
    if (!content) return null;
    return {
      lineNumber,
      occurredAt,
      captureKind: "function_call_output",
      role: "tool",
      source: "codex-rollout",
      content,
      label: clean(event.payload?.call_id) || "tool output",
      priority: eventPriority("function_call_output"),
      lowSignal: true,
      metadata: {
        threadId: clean(threadInfo?.threadId),
        rolloutPath: clean(threadInfo?.rolloutPath),
        cwd: normalizeThreadCwd(threadInfo?.cwd),
        callId: clean(event.payload?.call_id),
      },
    };
  }

  return null;
}

function trimCompactionItems(items, maxTotalBytes) {
  const next = [...items].map((item, index) => ({
    ...item,
    byteLength: Buffer.byteLength(String(item.content ?? ""), "utf8"),
    originalIndex: index,
  }));
  let totalBytes = next.reduce((sum, item) => sum + item.byteLength, 0);
  if (totalBytes <= maxTotalBytes) {
    return {
      items: next,
      totalBytes,
      dropped: [],
    };
  }

  const removable = next
    .filter((item, index) => index !== 0 && index !== next.length - 1)
    .sort((left, right) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      if (left.lowSignal !== right.lowSignal) return left.lowSignal ? -1 : 1;
      return right.byteLength - left.byteLength;
    });

  const removedIds = new Set();
  const dropped = [];
  for (const candidate of removable) {
    if (totalBytes <= maxTotalBytes) break;
    removedIds.add(candidate.originalIndex);
    dropped.push(candidate);
    totalBytes -= candidate.byteLength;
  }

  return {
    items: next.filter((item) => !removedIds.has(item.originalIndex)),
    totalBytes,
    dropped,
  };
}

function buildCompactionFallbackCandidate(text, lane) {
  const signals = buildContextSignals(text);
  const patternHints = [`lane:${lane}`];
  if (signals.urgentLike) patternHints.push("priority:urgent");
  if (signals.reopenedLike) patternHints.push("state:reopened");
  if (signals.correctionLike) patternHints.push("state:superseded");
  if (signals.decisionLike && !signals.blockerLike) patternHints.push("state:resolved");
  if (signals.actionLike || signals.blockerLike) patternHints.push("state:open-loop");
  return {
    kind: "summary",
    analysisType: "codex_compaction_summary",
    summary: `Compaction summary: ${text.slice(0, 220)}`,
    score: 0.72,
    contextSignals: signals,
    patternHints,
  };
}

function buildRawRow({
  threadInfo,
  compactionId,
  item,
  windowIndex,
  rawTtlDays,
  projectLane,
  rawRowMaxBytes,
}) {
  const expiresAt = new Date(Date.now() + rawTtlDays * 24 * 60 * 60 * 1000).toISOString();
  const content = safeClipByBytes(item.content, rawRowMaxBytes);
  return {
    content,
    source: "codex-compaction-raw",
    tags: dedupeStrings(["codex", "compaction", "raw", projectLane, item.captureKind, item.role], 12),
    metadata: {
      threadId: clean(threadInfo?.threadId),
      compactionId,
      rolloutPath: clean(threadInfo?.rolloutPath),
      cwd: normalizeThreadCwd(threadInfo?.cwd),
      threadTitle: clean(threadInfo?.title),
      firstUserMessage: clean(threadInfo?.firstUserMessage),
      projectLane,
      windowIndex,
      lineNumber: item.lineNumber,
      capturedAt: item.occurredAt,
      captureKind: item.captureKind,
      expiresAt,
      label: item.label,
      ...item.metadata,
    },
    agentId: "agent:codex-compaction",
    runId: `codex-thread:${clean(threadInfo?.threadId)}`.slice(0, 128),
    clientRequestId: `codex-compaction-raw-${stableHash(`${compactionId}|${windowIndex}|${item.lineNumber}|${item.captureKind}`, 24)}`,
    occurredAt: item.occurredAt,
    status: "accepted",
    memoryType: "working",
    sourceConfidence: 0.64,
    importance: item.priority >= 3 ? 0.78 : 0.58,
  };
}

function buildEnvelopeContent({ threadInfo, compactionId, beforeItems, afterItems, transcript }) {
  const title = clean(threadInfo?.title) || clean(threadInfo?.firstUserMessage) || clean(threadInfo?.threadId) || "Untitled thread";
  const cwdBase = basename(normalizeThreadCwd(threadInfo?.cwd)) || "workspace";
  const lines = [
    `Codex context compaction snapshot for "${title}" in ${cwdBase}.`,
    `Compaction id: ${compactionId}.`,
    `Captured ${beforeItems.length} eligible records before compaction and ${afterItems.length} after compaction.`,
    "",
    transcript,
  ].filter(Boolean);
  return safeClipByBytes(lines.join("\n"), 18_000);
}

function buildTranscript(items) {
  return items
    .map((item) => `${item.label || item.captureKind}: ${normalizeHybridText(item.content)}`)
    .filter(Boolean)
    .join("\n");
}

function buildPromotedRows({ threadInfo, compactionId, rawRows, transcript, projectLane, occurredAt }) {
  const candidates = [];
  const aggregateCandidates = extractStructuredCandidates(transcript, {
    title: clean(threadInfo?.title) || clean(threadInfo?.firstUserMessage) || "compaction",
    maxCandidates: 8,
  });
  candidates.push(...aggregateCandidates);

  for (const row of rawRows) {
    if (String(row.metadata?.captureKind) === "function_call_output") continue;
    const rowCandidates = extractStructuredCandidates(String(row.content || ""), {
      title: clean(threadInfo?.title) || "compaction",
      maxCandidates: 3,
    });
    candidates.push(...rowCandidates);
  }

  if (candidates.length === 0) {
    const fallback = buildCompactionFallbackCandidate(transcript, projectLane);
    if (fallback) candidates.push(fallback);
  }

  const deduped = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = `${candidate.kind}|${clean(candidate.summary).toLowerCase()}`;
    if (!clean(candidate.summary) || seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }

  return deduped.map((candidate) => {
    const semantic = ["decision", "preference", "evidence"].includes(candidate.kind);
    const importance = ["decision", "open_loop"].includes(candidate.kind) ? 0.9 : 0.76;
    return {
      content: safeClipByBytes(candidate.summary, 18_000),
      source: "codex-compaction-promoted",
      tags: dedupeStrings(["codex", "compaction", "promoted", projectLane, candidate.kind], 12),
      metadata: {
        threadId: clean(threadInfo?.threadId),
        compactionId,
        rolloutPath: clean(threadInfo?.rolloutPath),
        cwd: normalizeThreadCwd(threadInfo?.cwd),
        threadTitle: clean(threadInfo?.title),
        firstUserMessage: clean(threadInfo?.firstUserMessage),
        projectLane,
        capturedAt: occurredAt,
        captureKind: "promoted",
        sourceClientRequestIds: rawRows.map((row) => row.clientRequestId).filter(Boolean),
        analysisType: candidate.analysisType,
        memoryKind: candidate.kind,
        contextSignals: candidate.contextSignals,
        patternHints: dedupeStrings([...(candidate.patternHints || []), `lane:${projectLane}`], 16),
        confidence: Number(candidate.score || 0.84),
        memoryLayer: semantic ? "semantic" : "episodic",
        importance,
      },
      agentId: "agent:codex-compaction",
      runId: `codex-thread:${clean(threadInfo?.threadId)}`.slice(0, 128),
      clientRequestId: `codex-compaction-promoted-${stableHash(`${compactionId}|${candidate.kind}|${candidate.summary}`, 24)}`,
      occurredAt,
      status: "accepted",
      memoryType: semantic ? "semantic" : "episodic",
      sourceConfidence: semantic ? 0.88 : 0.8,
      importance,
    };
  });
}

export function extractCompactionMemoryProducts({
  threadInfo,
  rolloutEntries,
  compactionLineNumber,
  beforeCount = DEFAULT_COMPACTION_WINDOW_BEFORE,
  afterCount = DEFAULT_COMPACTION_WINDOW_AFTER,
  rawRowMaxBytes = DEFAULT_RAW_ROW_MAX_BYTES,
  rawBatchMaxBytes = DEFAULT_RAW_BATCH_MAX_BYTES,
  rawTtlDays = DEFAULT_RAW_TTL_DAYS,
} = {}) {
  const normalizedEntries = (rolloutEntries || [])
    .map((entry) => normalizeRolloutRecord(entry, threadInfo))
    .filter(Boolean);
  const compactionLine = Number(compactionLineNumber || 0);
  const compactionEvent = (rolloutEntries || []).find((entry) => Number(entry?.lineNumber ?? 0) === compactionLine);
  const compactionTimestamp = normalizeIsoTimestamp(compactionEvent?.event?.timestamp, new Date().toISOString());
  const compactionId = buildCompactionId({
    threadId: clean(threadInfo?.threadId),
    timestamp: compactionTimestamp,
    rolloutPath: clean(threadInfo?.rolloutPath),
    lineNumber: compactionLine,
  });
  const beforeItems = normalizedEntries.filter((entry) => entry.lineNumber < compactionLine).slice(-beforeCount);
  const afterItems = normalizedEntries.filter((entry) => entry.lineNumber > compactionLine).slice(0, afterCount);
  const selectedWindow = [...beforeItems, ...afterItems];
  const trimmed = trimCompactionItems(selectedWindow, rawBatchMaxBytes);
  const projectLane = inferProjectLane({
    text: selectedWindow.map((item) => item.content).join("\n"),
    title: clean(threadInfo?.title),
    path: clean(threadInfo?.rolloutPath),
  });

  const rawRows = trimmed.items.map((item, index) =>
    buildRawRow({
      threadInfo,
      compactionId,
      item,
      windowIndex: index,
      rawTtlDays,
      projectLane,
      rawRowMaxBytes,
    })
  );
  const transcript = buildTranscript(trimmed.items);
  const windowRow = {
    content: buildEnvelopeContent({
      threadInfo,
      compactionId,
      beforeItems,
      afterItems,
      transcript,
    }),
    source: "codex-compaction-window",
    tags: dedupeStrings(["codex", "compaction", "window", projectLane], 10),
    metadata: {
      threadId: clean(threadInfo?.threadId),
      compactionId,
      rolloutPath: clean(threadInfo?.rolloutPath),
      cwd: normalizeThreadCwd(threadInfo?.cwd),
      threadTitle: clean(threadInfo?.title),
      firstUserMessage: clean(threadInfo?.firstUserMessage),
      projectLane,
      capturedAt: compactionTimestamp,
      captureKind: "envelope",
      expiresAt: new Date(Date.now() + rawTtlDays * 24 * 60 * 60 * 1000).toISOString(),
      beforeEligibleCount: beforeItems.length,
      afterEligibleCount: afterItems.length,
      selectedCount: trimmed.items.length,
      droppedCount: trimmed.dropped.length,
      sourceClientRequestIds: rawRows.map((row) => row.clientRequestId).filter(Boolean),
    },
    agentId: "agent:codex-compaction",
    runId: `codex-thread:${clean(threadInfo?.threadId)}`.slice(0, 128),
    clientRequestId: `codex-compaction-window-${stableHash(`${compactionId}|window`, 24)}`,
    occurredAt: compactionTimestamp,
    status: "accepted",
    memoryType: "episodic",
    sourceConfidence: 0.72,
    importance: 0.82,
  };
  const promotedRows = buildPromotedRows({
    threadInfo,
    compactionId,
    rawRows,
    transcript,
    projectLane,
    occurredAt: compactionTimestamp,
  });

  return {
    compactionId,
    compactionTimestamp,
    beforeEligibleCount: beforeItems.length,
    afterEligibleCount: afterItems.length,
    selectedCount: trimmed.items.length,
    droppedCount: trimmed.dropped.length,
    totalSelectedBytes: trimmed.totalBytes,
    rawRows,
    windowRow,
    promotedRows,
  };
}

function buildLocalBootstrapItem(threadInfo, row, index) {
  return {
    id: row.clientRequestId || `local-bootstrap-${stableHash(`${threadInfo?.threadId}|${index}|${row.content}`, 16)}`,
    source: row.source,
    score: 0.65 + Math.max(0, (Number(row.importance ?? 0.7) - 0.5) * 0.2),
    content: row.content,
    tags: row.tags,
    metadata: {
      ...(row.metadata && typeof row.metadata === "object" ? row.metadata : {}),
      threadId: clean(threadInfo?.threadId),
      rolloutPath: clean(threadInfo?.rolloutPath),
      cwd: normalizeThreadCwd(threadInfo?.cwd),
    },
    matchedBy: ["local-fallback"],
    occurredAt: row.occurredAt,
  };
}

export function buildLocalBootstrapContext({
  threadInfo,
  threadName = "",
  historyLines = [],
  rolloutEntries = [],
  maxItems = 10,
  maxChars = 8000,
  strictStartupAllowlist = true,
} = {}) {
  const normalizedEntries = (rolloutEntries || [])
    .map((entry) => normalizeRolloutRecord(entry, threadInfo))
    .filter(Boolean);
  const recentEntries = normalizedEntries.slice(-Math.max(1, maxItems));
  const cwdBase = basename(normalizeThreadCwd(threadInfo?.cwd)) || "workspace";
  const title = clean(threadName) || clean(threadInfo?.title) || clean(threadInfo?.firstUserMessage) || "Codex thread";
  const fallbackRows = [];

  for (const historyLine of historyLines.slice(-5)) {
    const normalized = normalizeRolloutText(historyLine);
    if (!normalized || isBoilerplateText(normalized) || detectPoisoning(normalized)) continue;
    fallbackRows.push({
      content: normalized,
      source: "codex-compaction-raw",
      tags: ["codex", "history", "bootstrap"],
      metadata: {
        captureKind: "message",
        historyLine: true,
        lineNumber: null,
      },
      clientRequestId: `local-history-${stableHash(`${threadInfo?.threadId}|${normalized}`, 20)}`,
      occurredAt: normalizeIsoTimestamp(threadInfo?.updatedAt),
      importance: 0.66,
    });
  }

  for (const entry of recentEntries) {
    fallbackRows.push({
      content: safeClipByBytes(entry.content, 18_000),
      source: entry.captureKind === "message" ? "codex-compaction-promoted" : "codex-compaction-raw",
      tags: ["codex", "bootstrap", entry.captureKind, entry.role].filter(Boolean),
      metadata: {
        captureKind: entry.captureKind,
        lineNumber: entry.lineNumber,
        label: entry.label,
      },
      clientRequestId: `local-rollout-${stableHash(`${threadInfo?.threadId}|${entry.lineNumber}|${entry.captureKind}`, 20)}`,
      occurredAt: entry.occurredAt,
      importance: entry.priority >= 3 ? 0.76 : 0.58,
    });
  }

  if (fallbackRows.length === 0 && clean(threadInfo?.firstUserMessage)) {
    fallbackRows.push({
      content: normalizeRolloutText(threadInfo.firstUserMessage),
      source: "codex-compaction-promoted",
      tags: ["codex", "bootstrap", "message", "user"],
      metadata: {
        captureKind: "message",
        syntheticBootstrapSeed: true,
      },
      clientRequestId: `local-seed-${stableHash(`${threadInfo?.threadId}|${threadInfo?.firstUserMessage}`, 20)}`,
      occurredAt: normalizeIsoTimestamp(threadInfo?.updatedAt),
      importance: 0.7,
    });
  }

  const items = fallbackRows.slice(-Math.max(1, maxItems)).map((row, index) => buildLocalBootstrapItem(threadInfo, row, index));
  const summaryLines = [
    `Local fallback context for "${title}" in ${cwdBase}.`,
    clean(threadInfo?.firstUserMessage) ? `First user message: ${clean(threadInfo.firstUserMessage)}` : "",
    historyLines.length > 0 ? `Recent user lines: ${historyLines.slice(-3).join(" | ")}` : "",
    items.length > 0
      ? `Recent thread signals: ${items
          .slice(0, 4)
          .map((item) => normalizeHybridText(item.content).slice(0, 120))
          .filter(Boolean)
          .join(" | ")}`
      : "",
  ].filter(Boolean);
  const summary = safeClipByBytes(summaryLines.join("\n"), maxChars);

  return {
    schema: "codex-startup-bootstrap-context.v1",
    createdAt: new Date().toISOString(),
    threadId: clean(threadInfo?.threadId),
    query: buildThreadBootstrapQuery({ threadInfo, threadName, historyLines }),
    summary,
    items,
    diagnostics: {
      startupSourceBias: "local-fallback",
      strictStartupAllowlist,
      fallbackUsed: true,
      fallbackStrategy: "rollout-history",
      itemCount: items.length,
    },
  };
}

export function writeBootstrapArtifacts({ threadId, contextPayload, metadata } = {}) {
  const paths = runtimePathsForThread(threadId);
  ensureRuntimeDir(paths.runtimeDir);
  const context = contextPayload && typeof contextPayload === "object" ? contextPayload : {};
  const items = Array.isArray(context.items) ? context.items : [];
  const summary = clean(context.summary);
  const markdown = [
    "# Bootstrap Context",
    "",
    summary || "No summary available.",
    "",
    items.length > 0 ? "## Items" : "",
    ...items.slice(0, 12).map((item, index) => `- ${index + 1}. [${clean(item.source) || "memory"}] ${normalizeHybridText(item.content).slice(0, 240)}`),
  ]
    .filter(Boolean)
    .join("\n");
  writeJson(paths.bootstrapContextJsonPath, context);
  ensureRuntimeDir(dirname(paths.bootstrapContextMarkdownPath));
  writeFileSync(paths.bootstrapContextMarkdownPath, `${markdown}\n`, "utf8");
  writeJson(paths.bootstrapMetadataPath, metadata || {});
  return paths;
}

export function writeContinuityEnvelope(threadId, envelope = {}) {
  const paths = runtimePathsForThread(threadId);
  ensureRuntimeDir(paths.runtimeDir);
  writeJson(
    paths.continuityEnvelopePath,
    normalizeContinuityEnvelope(envelope, {
      threadId,
      cwd: envelope?.cwd,
      existing: readJson(paths.continuityEnvelopePath, null),
    })
  );
  return paths.continuityEnvelopePath;
}

export function writeStartupBlocker(threadId, blocker = {}) {
  const paths = runtimePathsForThread(threadId);
  ensureRuntimeDir(paths.runtimeDir);
  writeJson(
    paths.startupBlockerPath,
    normalizeStartupBlocker(blocker, {
      threadId,
      cwd: blocker?.cwd,
      existing: readJson(paths.startupBlockerPath, null),
    })
  );
  return paths.startupBlockerPath;
}

export function writeHandoffArtifact(threadId, handoff = {}) {
  const paths = runtimePathsForThread(threadId);
  ensureRuntimeDir(paths.runtimeDir);
  writeJson(
    paths.handoffPath,
    normalizeHandoffArtifact(handoff, {
      threadId,
      existing: readJson(paths.handoffPath, null),
    })
  );
  return paths.handoffPath;
}

function rowMetadata(row) {
  return row && typeof row.metadata === "object" && row.metadata ? row.metadata : {};
}

export function isExpiredMemoryRow(row, nowMs = Date.now()) {
  const metadata = rowMetadata(row);
  const expiresAt = clean(metadata.expiresAt || row?.expiresAt);
  if (!expiresAt) return false;
  const expiresMs = Date.parse(expiresAt);
  return Number.isFinite(expiresMs) && expiresMs <= nowMs;
}

function rowScopeMatchesThread(row, threadInfo) {
  const metadata = rowMetadata(row);
  const rowThreadId = clean(metadata.threadId || row?.threadId);
  const rowCwd = normalizeThreadCwd(metadata.cwd || row?.cwd);
  const currentThreadId = clean(threadInfo?.threadId);
  const currentCwd = normalizeThreadCwd(threadInfo?.cwd);
  return Boolean((currentThreadId && rowThreadId === currentThreadId) || (currentCwd && rowCwd === currentCwd));
}

function rowSourcePenalty(row, threadInfo, profile = "startup-strict") {
  const normalizedProfile = normalizeContinuityProfile(profile);
  const metadata = rowMetadata(row);
  const source = normalizeSource(row?.source || row?.metadata?.source || "");
  const startupEligible = metadata.startupEligible === true;
  const personalProfile = clean(metadata.profileClass);
  if (normalizedProfile === "task-broad") {
    if (source === "manual") return 0.01;
    if (source === "codex-handoff") return 0.02;
    if (source === "codex-continuity-envelope") return 0.03;
    if (source === "codex") return 0.035;
    if (source === "repo-markdown") return 0.04;
    if (source === "codex-resumable-session") return 0.08;
    return 0.06 + Math.min(0.18, preferredStartupSourcePriority(source, normalizedProfile) / 100);
  }
  if (normalizedProfile === "profile-fast-lane") {
    if (source === "manual") return personalProfile ? 0 : 0.01;
    if (source === "codex-handoff") return 0.02;
    if (source === "codex-continuity-envelope") return 0.025;
    if (source === "codex") return 0.04;
    if (source === "codex-resumable-session") return startupEligible ? 0.08 : 0.22;
    if (source === "repo-markdown") return 0.2;
    return 0.08 + Math.min(0.28, preferredStartupSourcePriority(source, normalizedProfile) / 100);
  }
  if (source === "codex-continuity-envelope") return 0.01;
  if (source === "codex-compaction-promoted") return 0;
  if (source === "codex-handoff") return 0.015;
  if (source === "codex-startup-blocker") return 0.02;
  if (source === "codex-friction-feedback-loop") return 0.025;
  if (source === "manual") return startupEligible || personalProfile ? 0.03 : 0.06;
  if (source === "codex") return startupEligible ? 0.035 : 0.06;
  if (source === "codex-resumable-session") return startupEligible ? 0.07 : 0.34;
  if (source === "repo-markdown") return 0.14;
  if (source === "codex-history-export") return rowScopeMatchesThread(row, threadInfo) ? 0.06 : 0.1;
  if (source.startsWith("context-slice:")) return 0.07;
  if (source === "codex-compaction-window") {
    return rowScopeMatchesThread(row, threadInfo) ? 0.1 : 0.2;
  }
  if (source === "codex-compaction-raw") {
    return rowScopeMatchesThread(row, threadInfo) ? 0.16 : 0.35;
  }
  return 0.12 + Math.min(0.25, preferredStartupSourcePriority(source, normalizedProfile) / 100);
}

export function rankBootstrapRows(rows, threadInfo, { preserveOriginalScore = true, profile = "startup-strict" } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const normalizedProfile = normalizeContinuityProfile(profile);
  return rows
    .map((row, index) => {
      const metadata = rowMetadata(row);
      const baseScore = Number(row?.score);
      const normalizedBaseScore = Number.isFinite(baseScore) ? baseScore : 0.45;
      const penalty = rowSourcePenalty(row, threadInfo, normalizedProfile);
      const scopeBoost =
        normalizedProfile === "task-broad"
          ? rowScopeMatchesThread(row, threadInfo)
            ? 0.04
            : 0
          : rowScopeMatchesThread(row, threadInfo)
            ? 0.12
            : 0;
      const profileBoost =
        normalizedProfile === "profile-fast-lane" &&
        clean(metadata.scopeClass).toLowerCase() === "personal"
          ? 0.12
          : 0;
      const startupBoost =
        normalizedProfile !== "task-broad" && metadata.startupEligible === true ? 0.06 : 0;
      const priorityBoost =
        normalizedProfile === "task-broad"
          ? 0
          : Math.max(0, 0.1 - preferredStartupSourcePriority(row?.source, normalizedProfile) * 0.01);
      const rankScore = normalizedBaseScore + scopeBoost + profileBoost + startupBoost + priorityBoost - penalty;
      return {
        row,
        index,
        rankScore,
      };
    })
    .sort((left, right) => right.rankScore - left.rankScore || left.index - right.index)
    .map(({ row, rankScore }) =>
      preserveOriginalScore
        ? {
            ...row,
            metadata: {
              ...rowMetadata(row),
              bootstrapRankScore: Math.round(rankScore * 1000) / 1000,
            },
          }
        : {
            ...row,
            score: Math.round(rankScore * 1000) / 1000,
          }
    );
}

export function filterExpiredRows(rows, nowMs = Date.now()) {
  return Array.isArray(rows) ? rows.filter((row) => !isExpiredMemoryRow(row, nowMs) && row?.status !== "archived") : [];
}

export function loadBootstrapArtifacts(threadId) {
  const paths = runtimePathsForThread(threadId);
  const continuityEnvelope = normalizeContinuityEnvelope(readJson(paths.continuityEnvelopePath, null), {
    threadId,
    existing: null,
  });
  const startupBlocker = normalizeStartupBlocker(readJson(paths.startupBlockerPath, null), {
    threadId,
    cwd: continuityEnvelope.cwd,
    existing: null,
  });
  const handoff = normalizeHandoffArtifact(readJson(paths.handoffPath, null), {
    threadId,
    existing: null,
  });
  return {
    paths,
    toolProfile: readJson(paths.toolProfileSnapshotPath, readJson(paths.sharedToolProfileCachePath, null)),
    context: readJson(paths.bootstrapContextJsonPath, null),
    metadata: readJson(paths.bootstrapMetadataPath, null),
    continuityEnvelope,
    startupBlocker,
    handoff,
  };
}

export function buildCompactionBatchReport(products) {
  return {
    schema: "codex-compaction-memory-products.v1",
    compactionId: clean(products?.compactionId),
    compactionTimestamp: clean(products?.compactionTimestamp),
    counts: {
      beforeEligible: Number(products?.beforeEligibleCount ?? 0),
      afterEligible: Number(products?.afterEligibleCount ?? 0),
      selected: Number(products?.selectedCount ?? 0),
      dropped: Number(products?.droppedCount ?? 0),
      rawRows: Array.isArray(products?.rawRows) ? products.rawRows.length : 0,
      promotedRows: Array.isArray(products?.promotedRows) ? products.promotedRows.length : 0,
    },
    totalSelectedBytes: Number(products?.totalSelectedBytes ?? 0),
  };
}

export function readCompactionWatermark(path) {
  return readJson(path, {
    schema: "codex-compaction-watermark.v1",
    threadId: "",
    rolloutPath: "",
    lastProcessedLine: 0,
    compactions: {},
  });
}

export function writeCompactionWatermark(path, value) {
  writeJson(path, {
    schema: "codex-compaction-watermark.v1",
    threadId: clean(value?.threadId),
    rolloutPath: clean(value?.rolloutPath),
    lastProcessedLine: Number(value?.lastProcessedLine ?? 0) || 0,
    updatedAt: new Date().toISOString(),
    compactions: value?.compactions && typeof value.compactions === "object" ? value.compactions : {},
  });
}

export function compactionSettingsFromEnv(env = process.env) {
  return {
    bootstrapMode: clean(env.STUDIO_BRAIN_BOOTSTRAP_MODE || "hard") || "hard",
    bootstrapTimeoutMs: intEnv(env.STUDIO_BRAIN_BOOTSTRAP_TIMEOUT_MS, 8000, { min: 500, max: 60000 }),
    bootstrapFailureMode: clean(env.STUDIO_BRAIN_BOOTSTRAP_FAILURE_MODE || "none") || "none",
    compactionBefore: intEnv(env.STUDIO_BRAIN_COMPACTION_WINDOW_BEFORE, DEFAULT_COMPACTION_WINDOW_BEFORE, { min: 1, max: 200 }),
    compactionAfter: intEnv(env.STUDIO_BRAIN_COMPACTION_WINDOW_AFTER, DEFAULT_COMPACTION_WINDOW_AFTER, { min: 1, max: 100 }),
    captureToolOutput: clean(env.STUDIO_BRAIN_COMPACTION_CAPTURE_TOOL_OUTPUT || "all") || "all",
    rawTtlDays: intEnv(env.STUDIO_BRAIN_RAW_TTL_DAYS, DEFAULT_RAW_TTL_DAYS, { min: 1, max: 3650 }),
    rawRowMaxBytes: intEnv(env.STUDIO_BRAIN_RAW_ROW_MAX_BYTES, DEFAULT_RAW_ROW_MAX_BYTES, { min: 1024, max: 256 * 1024 }),
    rawBatchMaxBytes: intEnv(env.STUDIO_BRAIN_RAW_BATCH_MAX_BYTES, DEFAULT_RAW_BATCH_MAX_BYTES, { min: 16 * 1024, max: 1024 * 1024 }),
    strictStartupAllowlist: boolEnv(env.CODEX_OPEN_MEMORY_STRICT_STARTUP_ALLOWLIST, true),
  };
}

export function buildCompactionQueuePath(threadId, compactionId) {
  const paths = runtimePathsForThread(threadId);
  ensureRuntimeDir(paths.pendingDir);
  return resolve(paths.pendingDir, `${compactionId}.jsonl`);
}

export function writeJsonlFile(path, rows) {
  ensureRuntimeDir(dirname(path));
  const body = (rows || []).map((row) => JSON.stringify(row)).join("\n");
  writeFileSync(path, body ? `${body}\n` : "", "utf8");
}

export function classifyCompactionLane(threadInfo, text) {
  const scope = classifyDevelopmentScope({
    text,
    title: clean(threadInfo?.title),
    path: clean(threadInfo?.cwd),
  });
  if (scope.isPersonal && !scope.isDevelopment) return "personal";
  return inferProjectLane({
    text,
    title: clean(threadInfo?.title),
    path: clean(threadInfo?.cwd),
  });
}

export function describeBootstrapMetadata(metadata) {
  const threadId = clean(metadata?.threadId);
  const satisfiedBy = clean(metadata?.startupGateSatisfiedBy) || "unknown";
  const query = clean(metadata?.query);
  return {
    threadId,
    startupGateSatisfiedBy: satisfiedBy,
    continuityState: TRUSTED_STARTUP_SATISFIERS.has(satisfiedBy) ? "ready" : satisfiedBy === "blocked" ? "blocked" : "missing",
    query,
    itemCount: Number(metadata?.itemCount ?? 0) || 0,
  };
}

export function isTrustedStartupSatisfier(value) {
  return TRUSTED_STARTUP_SATISFIERS.has(clean(value));
}
