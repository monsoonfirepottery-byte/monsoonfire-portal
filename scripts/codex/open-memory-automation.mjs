import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STARTUP_REASON_CODES,
  classifyStartupReason,
  deriveStartupGroundingAuthority,
  evaluateStartupLatency,
  inspectTokenFreshness,
  isTrustedStartupGroundingAuthority,
} from "../lib/codex-startup-reliability.mjs";
import {
  buildLocalBootstrapContext,
  loadBootstrapArtifacts,
  normalizeThreadCwd,
  parseRolloutEntries,
  preferredStartupSourcePriority,
  rankBootstrapRows,
  readThreadHistoryLines,
  readThreadName,
  resolveBootstrapContinuityState,
  resolveCodexThreadContext,
  runtimePathsForThread,
  writeContinuityEnvelope,
  writeHandoffArtifact,
} from "../lib/codex-session-memory-utils.mjs";
import { inferProjectLane } from "../lib/hybrid-memory-utils.mjs";
import { stableHash } from "../lib/pst-memory-utils.mjs";
import { hydrateStudioBrainAuthFromPortal } from "../lib/studio-brain-startup-auth.mjs";
import { resolveStudioBrainBaseUrlFromEnv } from "../studio-brain-url-resolution.mjs";
import { notifyAutomationOutcome } from "./phone-notify.mjs";

const DEFAULT_TIMEOUT_MS = 3500;
const DEFAULT_CLI_TIMEOUT_MS = 12000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");
const OPEN_MEMORY_CLI_SCRIPT = resolve(REPO_ROOT, "scripts/open-memory.mjs");
const MEMORY_BRIEF_ARTIFACT_PATH = resolve(REPO_ROOT, "output", "studio-brain", "memory-brief", "latest.json");
const MEMORY_CONSOLIDATION_ARTIFACT_PATH = resolve(REPO_ROOT, "output", "studio-brain", "memory-consolidation", "latest.json");
const MEMORY_CONSOLIDATION_STALE_MS = 36 * 60 * 60 * 1000;
const DEFAULT_STARTUP_CONTEXT_CACHE_TTL_MS = 20_000;
const DEFAULT_STARTUP_CONTEXT_SINGLE_FLIGHT_TIMEOUT_MS = 8_000;
const DEFAULT_STARTUP_CONTEXT_SINGLE_FLIGHT_POLL_MS = 40;
const STARTUP_CONTEXT_INFLIGHT = new Map();

function clean(value) {
  return String(value || "").trim();
}

function isEnabled(value, defaultValue = true) {
  const raw = clean(value).toLowerCase();
  if (!raw) return defaultValue;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  return defaultValue;
}

function normalizeBearer(value) {
  const token = clean(value);
  if (!token) return "";
  return /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

function resolveStudioBrainAuthToken(env = process.env) {
  return clean(env.STUDIO_BRAIN_AUTH_TOKEN || env.STUDIO_BRAIN_ID_TOKEN || env.STUDIO_BRAIN_MCP_ID_TOKEN || "");
}

function resolveStudioBrainAdminToken(env = process.env) {
  return clean(env.STUDIO_BRAIN_ADMIN_TOKEN || env.STUDIO_BRAIN_MCP_ADMIN_TOKEN || "");
}

function parseJson(raw) {
  const text = clean(raw);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function coerceBoolean(raw, fallback = false) {
  if (typeof raw === "boolean") return raw;
  return isEnabled(String(raw ?? ""), fallback);
}

function coercePositiveInt(raw, fallback = 2) {
  const parsed = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, parsed);
}

function parseCsv(value) {
  const text = clean(value);
  if (!text) return [];
  return text
    .split(",")
    .map((entry) => normalizeSource(entry))
    .filter(Boolean);
}

function normalizeSource(raw) {
  return clean(raw)
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function parseIsoMs(value) {
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCwdValue(value) {
  return clean(value)
    .replace(/^\\\\\?\\/, "")
    .replace(/\\/g, "/")
    .toLowerCase();
}

function usableProjectLane(value) {
  const lane = normalizeSource(value);
  return lane && !["unknown", "general-dev", "personal"].includes(lane) ? lane : "";
}

function looksLikeStartupPlaceholder(value) {
  const normalized = clean(value).toLowerCase();
  return Boolean(normalized) && (
    normalized.includes("[startup-context]")
    || normalized === "startup-context"
  );
}

function looksLikeExecutionTrace(value) {
  const normalized = clean(value).toLowerCase();
  if (!normalized) return false;
  return (
    normalized.startsWith("[codex-compaction-raw] tool call ")
    || normalized.startsWith("[codex-compaction-raw] command:")
    || normalized.startsWith("tool call ")
    || normalized.startsWith("command:")
    || normalized.startsWith("chunk id:")
    || normalized.startsWith("wall time:")
    || normalized.startsWith("process exited with code")
    || normalized.includes("tool call update_plan")
    || normalized.includes("\"c:\\program files\\powershell\\7\\pwsh.exe\"")
    || normalized.includes("pwsh.exe\" -command")
    || normalized.includes("get-content ")
    || normalized.includes("rg -n ")
    || normalized.includes("node --test ")
    || normalized.includes("git diff -- ")
    || normalized.includes("git status --short")
    || normalized.includes("\"recipient_name\":")
    || normalized.includes("\"tool_uses\":")
  );
}

function looksLikePseudoDecisionTrace(value) {
  const normalized = clean(value).toLowerCase();
  if (!normalized) return false;
  if (looksLikeStartupPlaceholder(normalized)) return true;
  if (looksLikeExecutionTrace(normalized)) return true;
  return (
    normalized.includes("startup continuity loaded")
    || normalized.includes("context loaded")
    || normalized.includes("fallback retrieval")
    || normalized.includes("fallback strategy")
    || normalized.includes("query replay")
    || normalized.includes("query=")
    || normalized.includes("resume startup query")
    || normalized.includes("startup query")
    || normalized.includes("search fallback")
    || normalized.includes("semantic fallback")
    || normalized.includes("lexical timeout fallback")
    || normalized.includes("local fallback")
    || normalized.includes("open-memory-cli")
  );
}

function sanitizeBriefLine(value) {
  const normalized = clean(String(value ?? "").replace(/^\d+\.\s*/, ""));
  if (!normalized) return "";
  if (looksLikeStartupPlaceholder(normalized) || looksLikePseudoDecisionTrace(normalized)) return "";
  return normalized.slice(0, 180);
}

function sanitizeBriefLines(value, maxItems = 8) {
  const seen = new Set();
  const output = [];
  for (const entry of String(value ?? "").split(/\n+/)) {
    const sanitized = sanitizeBriefLine(entry);
    if (!sanitized) continue;
    const dedupe = sanitized.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    output.push(sanitized);
    if (output.length >= maxItems) break;
  }
  return output;
}

function sanitizeActionList(values, maxItems = 6) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const sanitized = sanitizeBriefLine(value);
    if (!sanitized) continue;
    const dedupe = sanitized.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    output.push(sanitized);
    if (output.length >= maxItems) break;
  }
  return output;
}

function summarizeBriefLines(lines, fallback, maxChars = 400) {
  if (!Array.isArray(lines) || lines.length === 0) return clean(fallback);
  const numbered = lines.map((line, index) => `${index + 1}. ${line}`);
  let summary = "";
  for (const line of numbered) {
    const next = summary ? `${summary}\n${line}` : line;
    if (next.length > maxChars) break;
    summary = next;
  }
  return clean(summary) || clean(fallback);
}

function resolveConsolidationSnapshot({
  consolidationArtifact,
  generatedAt,
  continuityState,
  continuityFallbackOnly,
} = {}) {
  const artifact = consolidationArtifact && typeof consolidationArtifact === "object" ? consolidationArtifact : null;
  const generatedAtMs = parseIsoMs(generatedAt) || Date.now();
  const status = clean(artifact?.status).toLowerCase();
  const mode = clean(artifact?.mode).toLowerCase();
  const lastRunAt = clean(artifact?.finishedAt || artifact?.lastSuccessAt) || null;
  const lastRunMs = parseIsoMs(lastRunAt);
  const nextRunAt = clean(artifact?.nextRunAt) || null;
  const nextRunMs = parseIsoMs(nextRunAt);
  const missingArtifact = !artifact || Object.keys(artifact).length === 0;
  const staleArtifact =
    !missingArtifact
    && status !== "running"
    && (
      !lastRunMs
      || generatedAtMs - lastRunMs > MEMORY_CONSOLIDATION_STALE_MS
      || (nextRunMs !== null && nextRunMs < generatedAtMs - 60 * 60 * 1000)
    );
  const failedArtifact = status === "failed";
  const unavailable = missingArtifact;
  const needsRepair = failedArtifact || staleArtifact;
  const normalizedMode =
    unavailable
      ? "unavailable"
      : needsRepair
        ? "repair"
        : status === "running"
          ? "running"
          : "scheduled";
  const normalizedStatus =
    unavailable
      ? "unavailable"
      : failedArtifact
        ? "failed"
        : staleArtifact
          ? "stale"
          : status || "success";
  const fallbackSummary =
    normalizedMode === "unavailable"
      ? "Offline consolidation artifact is missing, so dream maintenance truth is unavailable."
      : normalizedMode === "repair"
        ? "Offline consolidation needs repair before dream output can be trusted."
        : normalizedMode === "running"
          ? "Offline consolidation is running now."
          : "Offline consolidation last completed successfully and is queued for the next quiet window.";
  const blocker =
    normalizedMode === "unavailable"
      ? "Dream consolidation artifact is missing."
      : normalizedMode === "repair"
        ? clean(artifact?.lastError) || "Dream consolidation artifact is stale or failed."
        : "";
  const actionabilityStatus = clean(artifact?.actionabilityStatus).toLowerCase()
    || (normalizedMode === "scheduled" && Number(artifact?.promotionCount || 0) + Number(artifact?.quarantineCount || 0) > 0 ? "passed" : "repair");
  const actionableInsightCount = Number(artifact?.actionableInsightCount || 0);
  const suppressedConnectionNoteCount = Number(artifact?.suppressedConnectionNoteCount || 0);
  const suppressedPseudoDecisionCount = Number(artifact?.suppressedPseudoDecisionCount || 0);
  const topActions = sanitizeActionList(artifact?.topActions, 6);
  const maintenanceActions =
    normalizedMode === "scheduled"
      ? [
          continuityFallbackOnly
            ? "Promote startup-eligible episodic memories so continuity does not depend on unscoped search."
            : "Cluster related episodic memories into durable threads.",
          "Dedupe overlapping low-signal memories before promotion.",
          "Refresh links between people, projects, incidents, and artifacts.",
          "Promote stable patterns into canonical memory after review.",
        ]
      : [
          "Restore auth and transport so continuity can be refreshed.",
          "Repair consolidation artifacts before trusting dream output.",
          "Hold canonical promotions until dream maintenance is healthy again.",
        ];
  const fallbackOutputs = [
    "output/studio-brain/memory-brief/latest.json",
    "output/studio-brain/memory-consolidation/latest.json",
    "output/memory/<overnight-run>/overnight-status.json",
  ];
  const focusAreas = sanitizeActionList(artifact?.focusAreas, 8);
  return {
    mode: normalizedMode,
    status: normalizedStatus,
    summary: clean(artifact?.summary) || fallbackSummary,
    blocker,
    lastRunAt,
    nextRunAt,
    focusAreas,
    maintenanceActions,
    outputs: sanitizeActionList(artifact?.outputs, 8).length > 0 ? sanitizeActionList(artifact?.outputs, 8) : fallbackOutputs,
    counts: {
      promotions: Number(artifact?.promotionCount || 0),
      archives: Number(artifact?.archiveCount || 0),
      quarantines: Number(artifact?.quarantineCount || 0),
      repairedLinks: Number(artifact?.repairedEdgeCount || 0),
    },
    mixQuality: clean(artifact?.candidateSelectionDetails?.mixQuality) || null,
    dominanceWarnings: sanitizeActionList(artifact?.dominanceWarnings, 6),
    secondPassQueriesUsed: Number(artifact?.secondPassQueriesUsed || 0),
    promotionCandidatesPending: Number(artifact?.promotionCandidateCount || 0),
    promotionCandidatesConfirmed: Number(artifact?.promotionCandidateConfirmedCount || 0),
    stalledCandidateCount: Number(artifact?.stalledCandidateCount || 0),
    lastError: clean(artifact?.lastError) || null,
    actionabilityStatus,
    actionableInsightCount,
    suppressedConnectionNoteCount,
    suppressedPseudoDecisionCount,
    topActions,
  };
}

function summarizeItems(items, maxChars = 400) {
  if (!Array.isArray(items) || items.length === 0) return "";
  const lines = [];
  for (let index = 0; index < items.length; index += 1) {
    const row = items[index] || {};
    const source = clean(row.source || row?.metadata?.source || "memory");
    const content = clean(row.content || "").replace(/\s+/g, " ").slice(0, 96);
    if (!content) continue;
    lines.push(`${index + 1}. [${source}] ${content}`);
    const joined = lines.join("\n");
    if (joined.length >= maxChars) {
      return joined.slice(0, maxChars);
    }
  }
  return lines.join("\n");
}

function extractContextEnvelope(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const context =
    root.context && typeof root.context === "object"
      ? root.context
      : root.payload && typeof root.payload === "object"
        ? root.payload
        : root;
  const items = Array.isArray(context.items)
    ? context.items
    : Array.isArray(root.items)
      ? root.items
      : [];
  const summary =
    clean(context.summary || "") ||
    clean(root.summary || "") ||
    summarizeStartupRows(items, 400) ||
    summarizeItems(items, 400);
  const diagnostics =
    context.diagnostics && typeof context.diagnostics === "object"
      ? context.diagnostics
      : root.diagnostics && typeof root.diagnostics === "object"
        ? root.diagnostics
        : {};
  return { context, items, summary, diagnostics };
}

function normalizeRetrievalMode(raw) {
  const mode = clean(raw).toLowerCase();
  if (mode === "semantic" || mode === "lexical") return mode;
  return "hybrid";
}

function defaultBootstrapSourceAllowlist() {
  return [
    "codex-compaction-promoted",
    "codex",
    "codex-handoff",
    "codex-resumable-session",
    "codex-friction-feedback-loop",
    "mcp",
    "manual",
    "context-slice:automation",
    "codex-compaction-window",
  ];
}

function defaultBootstrapSourceDenylist() {
  return [
    "memory-pack-mined-memories-unique-runid",
    "memory-pack-all-threads-unique-runid",
    "memory-pack-context-derived",
    "memory-pack-codex-exec-derived",
    "chatgpt-export:memory-pack.zip",
    "chatgpt-export:crossref-context-2026-03-03",
    "chatgpt-export:codex-exec-context-2026-03-03",
  ];
}

function mergeUniqueSources(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    for (const value of list || []) {
      const normalized = normalizeSource(value);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}

function isPreferredStartupSource(source) {
  const normalized = normalizeSource(source || "");
  if (!normalized) return false;
  if (normalized === "codex-compaction-raw") return false;
  if (normalized === "mcp" || normalized === "manual" || normalized === "codex") return true;
  if (normalized.startsWith("codex-")) return true;
  if (normalized.startsWith("context-slice:")) return true;
  return false;
}

function readRowSource(row) {
  return row?.source || row?.metadata?.source || "";
}

function readRowScore(row) {
  const numeric = Number(row?.score);
  return Number.isFinite(numeric) ? numeric : 0;
}

function readRowText(row) {
  const candidates = [
    row?.content,
    row?.summary,
    row?.text,
    row?.title,
    row?.metadata?.content,
    row?.metadata?.summary,
    row?.metadata?.text,
    row?.metadata?.title,
  ];
  for (const value of candidates) {
    const cleaned = clean(value);
    if (cleaned) return cleaned;
  }
  return "";
}

function readRowKindHints(row) {
  const values = [
    row?.kind,
    row?.type,
    row?.memoryType,
    row?.eventType,
    row?.metadata?.kind,
    row?.metadata?.type,
    row?.metadata?.memoryType,
    row?.metadata?.eventType,
    ...(Array.isArray(row?.tags) ? row.tags : []),
    ...(Array.isArray(row?.metadata?.tags) ? row.metadata.tags : []),
  ];
  return Array.from(
    new Set(
      values
        .map((value) => normalizeSource(value))
        .filter(Boolean),
    ),
  );
}

function rowOptedOutOfStartup(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  if (metadata.startupEligible === false) return true;
  if (metadata.lifecycleMemory === true && metadata.startupEligible !== true) return true;
  return false;
}

function isDurableStartupKind(kind) {
  const normalized = normalizeSource(kind || "");
  if (!normalized) return false;
  return [
    "checkpoint",
    "handoff",
    "decision",
    "progress",
    "blocker",
    "fact",
    "preference",
    "accepted",
    "canonical",
    "goal",
    "action",
  ].some((token) => normalized === token || normalized.includes(token));
}

function rowHasStartupSignal(row) {
  const text = readRowText(row);
  if (!text) return false;
  if (rowOptedOutOfStartup(row)) return false;
  if (looksLikeStartupPlaceholder(text) || looksLikePseudoDecisionTrace(text) || looksLikeExecutionTrace(text)) {
    return false;
  }
  const source = normalizeSource(readRowSource(row));
  if (source === "codex-compaction-raw") {
    return readRowKindHints(row).some((kind) => isDurableStartupKind(kind));
  }
  return true;
}

export function selectStartupRows(rows, { preferredOnly = false, threadInfo = null } = {}) {
  if (!Array.isArray(rows)) return [];
  const filtered = rows
    .map((row, index) => ({
      row,
      index,
      source: readRowSource(row),
      score: readRowScore(row),
    }))
    .filter((entry) => rowHasStartupSignal(entry.row))
    .filter((entry) => !preferredOnly || isPreferredStartupSource(entry.source));
  const ranked = rankBootstrapRows(
    filtered.map((entry) => ({
      ...entry.row,
      metadata: {
        ...(entry.row?.metadata && typeof entry.row.metadata === "object" ? entry.row.metadata : {}),
        startupQueryOriginalIndex: entry.index,
      },
    })),
    threadInfo,
    {
      preserveOriginalScore: true,
      profile: "startup-strict",
    }
  );
  return ranked.sort((left, right) => {
    const leftRank = Number(left?.metadata?.bootstrapRankScore);
    const rightRank = Number(right?.metadata?.bootstrapRankScore);
    if (Number.isFinite(leftRank) && Number.isFinite(rightRank) && rightRank !== leftRank) {
      return rightRank - leftRank;
    }
    const leftPriority = isPreferredStartupSource(readRowSource(left))
      ? preferredStartupSourcePriority(readRowSource(left), "startup-strict")
      : 50;
    const rightPriority = isPreferredStartupSource(readRowSource(right))
      ? preferredStartupSourcePriority(readRowSource(right), "startup-strict")
      : 50;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    const leftScore = Number(readRowScore(left));
    const rightScore = Number(readRowScore(right));
    if (Number.isFinite(leftScore) && Number.isFinite(rightScore) && rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    return Number(left?.metadata?.startupQueryOriginalIndex || 0) - Number(right?.metadata?.startupQueryOriginalIndex || 0);
  });
}

function filterStartupRows(rows, options = {}) {
  return selectStartupRows(rows, options);
}

function filterPreferredRows(rows, options = {}) {
  return selectStartupRows(rows, { ...options, preferredOnly: true });
}

function summarizeStartupRows(rows, maxChars = 400, threadInfo = null) {
  const startupRows = filterStartupRows(rows, { threadInfo });
  if (startupRows.length === 0) return "";
  const lines = [];
  const seen = new Set();
  for (const row of startupRows) {
    const content = sanitizeBriefLine(readRowText(row));
    if (!content) continue;
    const source = clean(readRowSource(row));
    const line = clean(source ? `[${source}] ${content}` : content).slice(0, 180);
    if (!line) continue;
    const dedupe = line.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    lines.push(line);
    const joined = summarizeBriefLines(lines, "", maxChars);
    if (joined.length >= maxChars) return joined.slice(0, maxChars);
  }
  return summarizeBriefLines(lines, "", maxChars);
}

function resolveSelectedStartupSummary(summary, items, maxChars = 400, threadInfo = null) {
  const summaryLines = sanitizeBriefLines(summary, 8);
  if (summaryLines.length > 0) {
    return summarizeBriefLines(summaryLines, "", maxChars);
  }
  return summarizeStartupRows(items, maxChars, threadInfo);
}

function readRowMemoryLayer(row) {
  return clean(row?.memoryLayer || row?.metadata?.memoryLayer || "").toLowerCase();
}

function readRowProjectLane(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const sourceMetadata = metadata.sourceMetadata && typeof metadata.sourceMetadata === "object"
    ? metadata.sourceMetadata
    : {};
  return usableProjectLane(
    sourceMetadata.projectLane || metadata.projectLane || row?.projectLane || metadata.lane || metadata.signalLane
  );
}

function rowMatchesThread(row, threadInfo) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const rowThreadId = clean(metadata.threadId || row?.threadId);
  const rowCwd = normalizeCwdValue(metadata.cwd || row?.cwd);
  const threadId = clean(threadInfo?.threadId);
  const cwd = normalizeCwdValue(threadInfo?.cwd);
  return Boolean((threadId && rowThreadId === threadId) || (cwd && rowCwd === cwd));
}

function hasUsableLocalStartupArtifacts(artifacts = {}) {
  const handoff = artifacts?.handoff && typeof artifacts.handoff === "object" ? artifacts.handoff : {};
  const envelope = artifacts?.continuityEnvelope && typeof artifacts.continuityEnvelope === "object"
    ? artifacts.continuityEnvelope
    : {};
  const handoffSummary = clean(handoff.summary || handoff.workCompleted || handoff.activeGoal);
  if (handoffSummary) return true;
  const envelopeSummary = clean(envelope.lastHandoffSummary || envelope.currentGoal || envelope.nextRecommendedAction);
  const sourceQuality = clean(
    envelope.startupSourceQuality || envelope.laneSourceQuality || envelope.startup?.startupSourceQuality
  ).toLowerCase();
  return Boolean(envelopeSummary) && sourceQuality === "thread-scoped-dominant";
}

function rowCanRepairStartupArtifacts(row, threadInfo = null) {
  if (!rowMatchesThread(row, threadInfo)) return false;
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const source = normalizeSource(readRowSource(row));
  if (source === "codex-startup-blocker") return false;
  const checkpointKind = clean(metadata.checkpointKind).toLowerCase();
  const startupEligible =
    source === "codex-handoff" ||
    metadata.startupEligible === true ||
    checkpointKind === "handoff" ||
    checkpointKind === "checkpoint";
  if (!startupEligible) return false;
  const summary = clean(metadata.summary || metadata.workCompleted || readRowText(row));
  const activeGoal = clean(metadata.activeGoal || metadata.currentGoal || metadata.goal);
  const nextRecommendedAction = clean(metadata.nextRecommendedAction || metadata.unblockStep);
  const blockers = Array.isArray(metadata.blockers) ? metadata.blockers : [];
  return Boolean(summary || activeGoal || nextRecommendedAction || blockers.length > 0);
}

export function selectStartupArtifactRepairCandidate(rows, { threadInfo = null } = {}) {
  const startupRows = selectStartupRows(rows, { threadInfo });
  return startupRows.find((row) => rowCanRepairStartupArtifacts(row, threadInfo)) || null;
}

export function buildStartupArtifactRepair(candidate, {
  threadInfo = null,
  threadScopedItemCount = 0,
} = {}) {
  if (!candidate) return null;
  const metadata = candidate?.metadata && typeof candidate.metadata === "object" ? candidate.metadata : {};
  const threadId = clean(metadata.threadId || threadInfo?.threadId);
  if (!threadId) return null;
  const summary = clean(metadata.summary || metadata.workCompleted || readRowText(candidate));
  const activeGoal = clean(metadata.activeGoal || metadata.currentGoal || threadInfo?.firstUserMessage || threadInfo?.title || summary);
  const nextRecommendedAction = clean(metadata.nextRecommendedAction || metadata.unblockStep);
  const blockers = Array.isArray(metadata.blockers) ? metadata.blockers : [];
  const completionStatus = clean(
    metadata.completionStatus || metadata.status || metadata.checkpointStatus || (blockers.length > 0 ? "degraded" : "pass")
  ) || "pass";
  const workCompleted = clean(metadata.workCompleted || summary);
  const presentationProjectLane = readRowProjectLane(candidate) || resolveThreadProjectLane(threadInfo);
  return {
    handoff: {
      threadId,
      createdAt: clean(candidate?.createdAt || candidate?.occurredAt),
      runId: clean(candidate?.runId || metadata.runId),
      agentId: clean(candidate?.agentId || metadata.agentId),
      summary,
      activeGoal,
      workCompleted: workCompleted || summary,
      nextRecommendedAction,
      blockers,
      completionStatus,
      startupProvenance: {
        repairedFromSource: clean(readRowSource(candidate)),
        repairedFromCapturedFrom: clean(metadata.capturedFrom),
        repairedFromMemoryId: clean(candidate?.id),
      },
    },
    continuityEnvelope: {
      threadId,
      cwd: clean(metadata.cwd || threadInfo?.cwd),
      continuityState: "ready",
      currentGoal: activeGoal,
      lastHandoffSummary: summary || workCompleted,
      nextRecommendedAction,
      blockers,
      fallbackOnly: false,
      startupSourceQuality: "thread-scoped-dominant",
      laneSourceQuality: "thread-scoped-dominant",
      presentationProjectLane,
      threadScopedItemCount: Math.max(1, Math.round(Number(threadScopedItemCount || 0))),
    },
  };
}

function repairLocalStartupArtifactsFromRows(rows, {
  threadInfo = null,
  existingArtifacts = null,
} = {}) {
  const threadId = clean(threadInfo?.threadId);
  if (!threadId || !Array.isArray(rows) || rows.length === 0) {
    return {
      repaired: false,
      reason: "missing-thread-or-rows",
    };
  }
  const artifacts = existingArtifacts || loadBootstrapArtifacts(threadId);
  if (hasUsableLocalStartupArtifacts(artifacts)) {
    return {
      repaired: false,
      reason: "existing-local-artifacts",
    };
  }
  const candidate = selectStartupArtifactRepairCandidate(rows, { threadInfo });
  if (!candidate) {
    return {
      repaired: false,
      reason: "no-repair-candidate",
    };
  }
  const threadScopedItemCount = rows.filter((row) => rowMatchesThread(row, threadInfo)).length;
  const repair = buildStartupArtifactRepair(candidate, { threadInfo, threadScopedItemCount });
  if (!repair) {
    return {
      repaired: false,
      reason: "candidate-not-repairable",
    };
  }
  writeHandoffArtifact(threadId, repair.handoff);
  writeContinuityEnvelope(threadId, repair.continuityEnvelope);
  return {
    repaired: true,
    reason: "repaired-from-remote-startup-row",
    source: clean(readRowSource(candidate)),
    capturedFrom: clean(candidate?.metadata?.capturedFrom),
  };
}

function resolveThreadCwdLane(threadInfo) {
  return usableProjectLane(
    inferProjectLane({
      path: normalizeThreadCwd(threadInfo?.cwd),
    })
  );
}

function resolveThreadProjectLane(threadInfo, cwdLane = resolveThreadCwdLane(threadInfo)) {
  if (cwdLane) return cwdLane;
  return usableProjectLane(
    inferProjectLane({
      path: normalizeThreadCwd(threadInfo?.cwd),
      title: clean(threadInfo?.title),
      text: clean(threadInfo?.firstUserMessage),
    })
  );
}

function computeGroundingQuality({
  rows = [],
  continuityState = "missing",
  presentationProjectLane = "",
  threadScopedItemCount = 0,
  manualOnly = false,
} = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return clean(continuityState).toLowerCase() === "blocked" ? "blocked" : "missing";
  }
  if (manualOnly) return "manual-only";
  if (threadScopedItemCount > 0 && presentationProjectLane) {
    return rows.length >= 2 ? "thread-scoped-rich" : "thread-scoped";
  }
  if (threadScopedItemCount > 0) return "thread-scoped";
  if (presentationProjectLane) return rows.length >= 2 ? "lane-resolved-rich" : "lane-resolved";
  return "thin";
}

function continuityArtifactSignalCount(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  let signals = 0;
  if (clean(metadata.activeGoal || metadata.currentGoal)) signals += 1;
  if (clean(metadata.nextRecommendedAction || metadata.unblockStep)) signals += 1;
  if (clean(metadata.summary || metadata.lastHandoffSummary || metadata.workCompleted || metadata.bootstrapSummary)) {
    signals += 1;
  }
  if (Array.isArray(metadata.blockers) && metadata.blockers.length > 0) signals += 1;
  if (clean(metadata.firstSignal)) signals += 1;
  if (Array.isArray(metadata.resumeHints) && metadata.resumeHints.length > 0) signals += 1;
  return signals;
}

function isTrustedStartupArtifactRow(row) {
  const source = normalizeSource(readRowSource(row));
  if (!["codex-handoff", "codex-continuity-envelope", "codex-startup-blocker"].includes(source)) {
    return false;
  }
  const signals = continuityArtifactSignalCount(row);
  return source === "codex-startup-blocker" ? signals >= 1 : signals >= 2;
}

function computeStartupSourceQuality(rows = [], threadScopedItemCount = 0, threadInfo = null) {
  const startupRows = Array.isArray(rows) ? rows : [];
  if (startupRows.length === 0) {
    return {
      startupSourceQuality: "missing",
      compactionDominated: false,
      sourceCounts: {},
    };
  }
  const sourceCounts = {};
  let compactionRows = 0;
  let trustedThreadScopedArtifactRows = 0;
  for (const row of startupRows) {
    const source = normalizeSource(readRowSource(row)) || "unknown";
    sourceCounts[source] = Number(sourceCounts[source] || 0) + 1;
    if (source.startsWith("codex-compaction-")) {
      compactionRows += 1;
    }
    if (isTrustedStartupArtifactRow(row) && rowMatchesThread(row, threadInfo)) {
      trustedThreadScopedArtifactRows += 1;
    }
  }
  const compactionDominated =
    trustedThreadScopedArtifactRows === 0 &&
    compactionRows / startupRows.length >= 0.5;
  const startupSourceQuality = trustedThreadScopedArtifactRows > 0
    ? "thread-scoped-dominant"
    : compactionDominated
    ? "compaction-promoted-dominant"
    : threadScopedItemCount > 0
      ? "thread-scoped-dominant"
      : "cross-thread-fallback";
  return {
    startupSourceQuality,
    compactionDominated,
    sourceCounts,
  };
}

export function deriveStartupGroundingDiagnostics({
  rows = [],
  diagnostics = {},
  threadInfo = null,
  continuityState = "",
} = {}) {
  const startupRows = Array.isArray(rows) ? rows : [];
  const baseDiagnostics = diagnostics && typeof diagnostics === "object" ? diagnostics : {};
  const threadScopedItemCount = startupRows.length > 0
    ? startupRows.filter((row) => rowMatchesThread(row, threadInfo)).length
    : Math.max(0, Math.round(Number(baseDiagnostics.threadScopedItemCount || 0)));
  const manualOnly = startupRows.length > 0
    ? startupRows.every((row) => normalizeSource(readRowSource(row)) === "manual")
    : baseDiagnostics.manualOnly === true;
  const rankedLaneRow = startupRows.find((row) => readRowProjectLane(row));
  const rankedRowMatchesThread = Boolean(rankedLaneRow) && rowMatchesThread(rankedLaneRow, threadInfo);
  const diagnosticsLane = usableProjectLane(
    baseDiagnostics.presentationProjectLane || baseDiagnostics.projectLane || baseDiagnostics.dominantProjectLane
  );
  const cwdLane = resolveThreadCwdLane(threadInfo);
  const inferredLane = resolveThreadProjectLane(threadInfo, cwdLane);
  const rankedLane = rankedLaneRow ? readRowProjectLane(rankedLaneRow) : "";
  const shouldOverrideThreadScopedLane =
    Boolean(rankedLaneRow) &&
    Boolean(inferredLane) &&
    rankedRowMatchesThread &&
    Boolean(rankedLane) &&
    rankedLane !== inferredLane;
  const shouldPreferRepoLaneOverCrossLane =
    Boolean(rankedLaneRow) &&
    Boolean(cwdLane) &&
    !rankedRowMatchesThread &&
    Boolean(rankedLane) &&
    rankedLane !== inferredLane;
  const presentationProjectLane = rankedLaneRow
    ? shouldOverrideThreadScopedLane || shouldPreferRepoLaneOverCrossLane
      ? inferredLane
      : rankedLane
    : inferredLane || diagnosticsLane;
  const laneResolutionSource = rankedLaneRow
    ? shouldOverrideThreadScopedLane
      ? "thread-inference-override"
      : shouldPreferRepoLaneOverCrossLane
        ? "thread-inference"
      : rankedRowMatchesThread
      ? "thread-scoped-ranked-row"
      : "ranked-row"
    : inferredLane
      ? "thread-inference"
      : diagnosticsLane
        ? "diagnostics"
        : "unresolved";
  const normalizedContinuityState = clean(continuityState || baseDiagnostics.continuityState || "missing").toLowerCase();
  const sourceQuality = computeStartupSourceQuality(startupRows, threadScopedItemCount, threadInfo);
  const laneSourceQuality =
    sourceQuality.compactionDominated === true
      ? "compaction-promoted-dominant"
      : clean(baseDiagnostics.laneSourceQuality || baseDiagnostics.groundingQuality || "");
  return {
    ...baseDiagnostics,
    projectLane: presentationProjectLane || usableProjectLane(baseDiagnostics.projectLane),
    dominantProjectLane:
      presentationProjectLane || usableProjectLane(baseDiagnostics.dominantProjectLane || baseDiagnostics.projectLane),
    presentationProjectLane,
    laneResolutionSource,
    threadScopedItemCount,
    manualOnly,
    groundingQuality: computeGroundingQuality({
      rows: startupRows,
      continuityState: normalizedContinuityState,
      presentationProjectLane,
      threadScopedItemCount,
      manualOnly,
    }),
    laneSourceQuality: laneSourceQuality || sourceQuality.startupSourceQuality,
    startupSourceQuality: sourceQuality.startupSourceQuality,
    compactionDominated: sourceQuality.compactionDominated,
    rowSourceCounts: sourceQuality.sourceCounts,
  };
}

function hasNonCoreRows(rows) {
  return Array.isArray(rows) && rows.some((row) => {
    const layer = readRowMemoryLayer(row);
    return layer && layer !== "core";
  });
}

function summarizeSearchRows(rows, maxChars = 400) {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const lines = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const source = clean(row.source || row?.metadata?.source || "memory");
    const score = Number.isFinite(Number(row.score)) ? Number(row.score).toFixed(3) : "";
    const content = clean(row.content || "").replace(/\s+/g, " ").slice(0, 88);
    if (!content) continue;
    lines.push(`${index + 1}. [${source}${score ? ` s=${score}` : ""}] ${content}`);
    const joined = lines.join("\n");
    if (joined.length >= maxChars) return joined.slice(0, maxChars);
  }
  return lines.join("\n");
}

function keyTermsFromQuery(query) {
  return clean(query)
    .toLowerCase()
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 4 && !["current", "shell", "continuity", "active", "working", "context"].includes(value))
    .slice(0, 4);
}

async function fallbackSearchContext({
  client,
  tenantId,
  agentId,
  runId,
  query,
  sourceAllowlist,
  sourceDenylist,
  retrievalMode,
  strictStartupAllowlist,
  threadInfo = null,
}) {
  const attempts = [];
  const queryText = clean(query);
  const terms = keyTermsFromQuery(queryText);
  const tertiaryQuery = terms[0] || "codex";
  attempts.push({
    tenantId: tenantId || undefined,
    agentId: agentId || undefined,
    runId: runId || undefined,
    query: queryText || "codex shell continuity",
    limit: 8,
    sourceAllowlist,
    sourceDenylist,
    retrievalMode,
    explain: false,
  });
  attempts.push({
    tenantId: tenantId || undefined,
    query: queryText || "codex shell continuity",
    limit: 8,
    sourceAllowlist,
    sourceDenylist,
    retrievalMode,
    explain: false,
  });
  attempts.push({
    tenantId: tenantId || undefined,
    query: tertiaryQuery,
    limit: 8,
    sourceAllowlist,
    sourceDenylist,
    retrievalMode,
    explain: false,
  });

  for (const payload of attempts) {
    const response = await requestJson(client, "/api/memory/search", payload);
    if (!response.ok) continue;
    const rows = Array.isArray(response.payload?.rows)
      ? response.payload.rows
      : Array.isArray(response.payload?.results)
        ? response.payload.results
        : [];
    const preferredRows = filterPreferredRows(rows, { threadInfo });
    const startupRows = filterStartupRows(rows, { threadInfo });
    const selectedRows =
      strictStartupAllowlist
        ? preferredRows
        : preferredRows.length > 0
          ? preferredRows
          : startupRows;
    if (selectedRows.length > 0) {
      return {
        ok: true,
        rows: selectedRows,
        strategy: payload.runId ? "search-scoped" : payload.query === tertiaryQuery ? "search-tertiary" : "search-unscoped",
      };
    }
  }

  return {
    ok: false,
    rows: [],
    strategy: "none",
  };
}

async function requestStartupContextStage({
  client,
  payload,
  strictStartupAllowlist = true,
  startupStage = "scoped",
  threadInfo = null,
} = {}) {
  const response = await requestJson(client, "/api/memory/context", payload);
  if (!response.ok) {
    return {
      ok: false,
      response,
      startupStage,
      items: [],
      selectedItems: [],
      summary: "",
      selectedSummary: "",
      diagnostics: {},
      hasSelectedItems: false,
      hasNonCoreSelected: false,
    };
  }

  const { items, summary, diagnostics } = extractContextEnvelope(response.payload);
  const preferredItems = filterPreferredRows(items, { threadInfo });
  const startupItems = filterStartupRows(items, { threadInfo });
  const selectedItems =
    strictStartupAllowlist
      ? preferredItems
      : preferredItems.length > 0
        ? preferredItems
        : startupItems;
  const selectedSummary = resolveSelectedStartupSummary(summary, selectedItems, 400, threadInfo);
  const selectedDiagnostics = deriveStartupGroundingDiagnostics({
    rows: selectedItems,
    diagnostics,
    threadInfo,
    continuityState: clean(diagnostics?.continuityState),
  });
  return {
    ok: true,
    response,
    startupStage,
    items,
    selectedItems,
    summary,
    selectedSummary,
    diagnostics,
    selectedDiagnostics,
    compactionDominated: selectedDiagnostics.compactionDominated === true,
    hasSelectedItems: selectedItems.length > 0,
    hasNonCoreSelected: hasNonCoreRows(selectedItems),
  };
}

function sanitizeMetrics(metrics) {
  if (!metrics || typeof metrics !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (value == null) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = Math.round(value * 1000) / 1000;
      continue;
    }
    if (typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) out[key] = trimmed.slice(0, 160);
    }
  }
  return out;
}

function buildContextLine(metrics) {
  const entries = Object.entries(sanitizeMetrics(metrics));
  if (!entries.length) return "";
  return entries.map(([key, value]) => `${key}=${String(value)}`).join(", ");
}

function readJsonFile(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function delayMs(durationMs) {
  const millis = Math.max(0, Math.round(Number(durationMs) || 0));
  if (millis <= 0) return Promise.resolve();
  return new Promise((resolveDelay) => setTimeout(resolveDelay, millis));
}

function resolveStartupContextCacheTtlMs(env = process.env) {
  const raw = Number(env.CODEX_STARTUP_CONTEXT_CACHE_TTL_MS || env.CODEX_OPEN_MEMORY_STARTUP_CACHE_TTL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_STARTUP_CONTEXT_CACHE_TTL_MS;
  return Math.max(1000, Math.trunc(raw));
}

function resolveStartupContextSingleFlightTimeoutMs(env = process.env) {
  const raw = Number(env.CODEX_STARTUP_CONTEXT_SINGLE_FLIGHT_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_STARTUP_CONTEXT_SINGLE_FLIGHT_TIMEOUT_MS;
  return Math.max(1000, Math.trunc(raw));
}

function resolveStartupContextSingleFlightPollMs(env = process.env) {
  const raw = Number(env.CODEX_STARTUP_CONTEXT_SINGLE_FLIGHT_POLL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_STARTUP_CONTEXT_SINGLE_FLIGHT_POLL_MS;
  return Math.max(10, Math.trunc(raw));
}

function startupContextCacheEnabled(env = process.env) {
  return isEnabled(env.CODEX_STARTUP_CONTEXT_CACHE_ENABLED, true);
}

function buildStartupContextCacheKey({ threadInfo = null, payload = {}, strictStartupAllowlist = true } = {}) {
  return stableHash(
    JSON.stringify({
      threadId: clean(threadInfo?.threadId),
      rolloutPath: clean(threadInfo?.rolloutPath),
      cwd: clean(threadInfo?.cwd),
      query: clean(payload?.query),
      tenantId: clean(payload?.tenantId),
      sourceAllowlist: Array.isArray(payload?.sourceAllowlist) ? payload.sourceAllowlist.map((value) => clean(value)) : [],
      sourceDenylist: Array.isArray(payload?.sourceDenylist) ? payload.sourceDenylist.map((value) => clean(value)) : [],
      retrievalMode: clean(payload?.retrievalMode),
      expandRelationships: payload?.expandRelationships !== false,
      maxHops: Number(payload?.maxHops || 0),
      strictStartupAllowlist: strictStartupAllowlist === true,
    }),
    24
  );
}

function buildStartupContextCacheState({ threadId = "", cacheKey = "" } = {}) {
  const paths = runtimePathsForThread(threadId);
  return {
    threadId: clean(threadId),
    cacheKey: clean(cacheKey),
    cachePath: paths.startupContextCachePath,
    lockPath: `${paths.startupContextCachePath}.${clean(cacheKey) || "startup"}.lock`,
  };
}

function cloneStartupContextResult(result = {}) {
  try {
    return JSON.parse(JSON.stringify(result));
  } catch {
    return { ...(result && typeof result === "object" ? result : {}) };
  }
}

function readFreshStartupContextCache(cacheState, { env = process.env, nowMs = Date.now() } = {}) {
  if (!startupContextCacheEnabled(env) || !cacheState?.cachePath) return null;
  const entry = readJsonFile(cacheState.cachePath);
  if (!entry || entry.schema !== "codex-startup-context-cache.v1") return null;
  if (clean(entry.threadId) !== clean(cacheState.threadId)) return null;
  if (clean(entry.cacheKey) !== clean(cacheState.cacheKey)) return null;
  const expiresAtMs = Date.parse(clean(entry.expiresAt));
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) return null;
  const savedAtMs = Date.parse(clean(entry.savedAt));
  return {
    entry,
    ageMs: Number.isFinite(savedAtMs) ? Math.max(0, nowMs - savedAtMs) : 0,
  };
}

function applyStartupContextCacheMetadata(
  result,
  {
    cacheState = null,
    cacheHit = false,
    hitType = "",
    ageMs = 0,
    waitMs = 0,
    shortCircuit = false,
  } = {},
  {
    startedAt = Date.now(),
    recomputeLatency = false,
    env = process.env,
  } = {},
) {
  const next = cloneStartupContextResult(result);
  const baseLatencyBreakdown =
    next.latencyBreakdown && typeof next.latencyBreakdown === "object"
      ? next.latencyBreakdown
      : next.diagnostics?.startupLatencyBreakdown && typeof next.diagnostics.startupLatencyBreakdown === "object"
        ? next.diagnostics.startupLatencyBreakdown
        : {};
  const resolvedLatencyMs = recomputeLatency ? Math.max(0, Date.now() - Number(startedAt || Date.now())) : next.latencyMs;
  if (recomputeLatency) {
    next.latencyMs = resolvedLatencyMs;
    next.startupLatency = evaluateStartupLatency(resolvedLatencyMs);
  }
  const startupCache = {
    enabled: startupContextCacheEnabled(env),
    cacheHit,
    hitType: clean(hitType),
    cacheKey: clean(cacheState?.cacheKey),
    cachePath: clean(cacheState?.cachePath),
    cacheAgeMs: Math.max(0, Math.round(Number(ageMs) || 0)),
    cacheWaitMs: Math.max(0, Math.round(Number(waitMs) || 0)),
    shortCircuitLocal: shortCircuit === true,
  };
  const latencyBreakdown = sanitizeMetrics({
    ...baseLatencyBreakdown,
    totalMs: resolvedLatencyMs,
    cacheAgeMs: startupCache.cacheAgeMs,
    cacheWaitMs: startupCache.cacheWaitMs,
    cacheHit: startupCache.cacheHit,
    shortCircuitLocal: startupCache.shortCircuitLocal,
  });
  next.latencyBreakdown = latencyBreakdown;
  next.diagnostics = {
    ...(next.diagnostics && typeof next.diagnostics === "object" ? next.diagnostics : {}),
    startupCache,
    startupLatencyBreakdown: latencyBreakdown,
  };
  return next;
}

function writeStartupContextCache(cacheState, result, { env = process.env } = {}) {
  if (!startupContextCacheEnabled(env) || !cacheState?.cachePath) return false;
  mkdirSync(dirname(cacheState.cachePath), { recursive: true });
  const now = Date.now();
  const ttlMs = resolveStartupContextCacheTtlMs(env);
  const payload = {
    schema: "codex-startup-context-cache.v1",
    savedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    threadId: clean(cacheState.threadId),
    cacheKey: clean(cacheState.cacheKey),
    result: cloneStartupContextResult(result),
  };
  writeFileSync(cacheState.cachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return true;
}

async function waitForStartupContextCache(cacheState, {
  env = process.env,
  timeoutMs = resolveStartupContextSingleFlightTimeoutMs(env),
  pollMs = resolveStartupContextSingleFlightPollMs(env),
} = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const cached = readFreshStartupContextCache(cacheState, { env });
    if (cached) {
      return {
        ...cached,
        waitMs: Math.max(0, Date.now() - startedAt),
      };
    }
    if (!existsSync(cacheState.lockPath)) break;
    await delayMs(pollMs);
  }
  return null;
}

async function withStartupContextSingleFlight(
  cacheState,
  factory,
  {
    env = process.env,
    startedAt = Date.now(),
  } = {},
) {
  if (!cacheState?.threadId || !cacheState?.cacheKey || !startupContextCacheEnabled(env)) {
    return factory();
  }
  const inFlightKey = `${cacheState.threadId}:${cacheState.cacheKey}`;
  if (STARTUP_CONTEXT_INFLIGHT.has(inFlightKey)) {
    return STARTUP_CONTEXT_INFLIGHT.get(inFlightKey);
  }
  const promise = (async () => {
    const cached = readFreshStartupContextCache(cacheState, { env });
    if (cached?.entry?.result) {
      return applyStartupContextCacheMetadata(cached.entry.result, {
        cacheState,
        cacheHit: true,
        hitType: "warm-cache",
        ageMs: cached.ageMs,
      }, {
        startedAt,
        recomputeLatency: true,
        env,
      });
    }

    mkdirSync(dirname(cacheState.lockPath), { recursive: true });
    let lockFd = null;
    try {
      lockFd = openSync(cacheState.lockPath, "wx");
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }

    if (lockFd == null) {
      const waited = await waitForStartupContextCache(cacheState, { env });
      if (waited?.entry?.result) {
        return applyStartupContextCacheMetadata(waited.entry.result, {
          cacheState,
          cacheHit: true,
          hitType: "lock-wait-cache",
          ageMs: waited.ageMs,
          waitMs: waited.waitMs,
        }, {
          startedAt,
          recomputeLatency: true,
          env,
        });
      }
    }

    try {
      const recheck = readFreshStartupContextCache(cacheState, { env });
      if (recheck?.entry?.result) {
        return applyStartupContextCacheMetadata(recheck.entry.result, {
          cacheState,
          cacheHit: true,
          hitType: "post-lock-cache",
          ageMs: recheck.ageMs,
        }, {
          startedAt,
          recomputeLatency: true,
          env,
        });
      }
      const resolved = await factory();
      const annotated = applyStartupContextCacheMetadata(resolved, {
        cacheState,
        cacheHit: false,
      }, {
        startedAt,
        env,
      });
      writeStartupContextCache(cacheState, annotated, { env });
      return annotated;
    } finally {
      if (lockFd != null) {
        closeSync(lockFd);
        try {
          unlinkSync(cacheState.lockPath);
        } catch {}
      }
    }
  })();
  STARTUP_CONTEXT_INFLIGHT.set(inFlightKey, promise);
  promise.finally(() => {
    if (STARTUP_CONTEXT_INFLIGHT.get(inFlightKey) === promise) {
      STARTUP_CONTEXT_INFLIGHT.delete(inFlightKey);
    }
  }).catch(() => {});
  return promise;
}

async function safeNotifyAutomationOutcome(payload) {
  try {
    return await notifyAutomationOutcome(payload);
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveTenantId(env) {
  return clean(env.OPEN_MEMORY_TENANT_ID || env.STUDIO_BRAIN_MEMORY_TENANT_ID || "");
}

function resolveAgentId(env, fallback) {
  return clean(env.CODEX_OPEN_MEMORY_AGENT_ID || fallback || "agent:codex-automation");
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

function resolveStartupThreadInfo(env = process.env) {
  const cwd = resolveStartupCwd(env);
  const hintedThreadId = resolveStartupThreadHint(env);
  const resolvedThreadInfo = resolveCodexThreadContext({
    threadId: hintedThreadId,
    cwd,
  });
  if (resolvedThreadInfo) return resolvedThreadInfo;
  if (!hintedThreadId && !cwd) return null;
  return {
    threadId: clean(hintedThreadId),
    rolloutPath: "",
    cwd,
    title: "",
    firstUserMessage: "",
    updatedAt: "",
  };
}

function timeoutController(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    controller,
    clear: () => clearTimeout(timeout),
  };
}

function resolveCliTimeoutMs(env) {
  const timeoutMsRaw = Number(env.CODEX_OPEN_MEMORY_CLI_TIMEOUT_MS);
  if (Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0) {
    return Math.trunc(timeoutMsRaw);
  }
  return DEFAULT_CLI_TIMEOUT_MS;
}

function runOpenMemoryCli({ command, args = [], stdinText = "", env = process.env } = {}) {
  const result = spawnSync(process.execPath, [OPEN_MEMORY_CLI_SCRIPT, command, ...args], {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
    input: stdinText,
    timeout: resolveCliTimeoutMs(env),
    maxBuffer: 1024 * 1024 * 6,
  });
  if (result.error) {
    return {
      ok: false,
      error: result.error instanceof Error ? result.error.message : String(result.error),
    };
  }
  const stdout = clean(result.stdout || "");
  const stderr = clean(result.stderr || "");
  if (Number(result.status || 0) !== 0) {
    return {
      ok: false,
      error: stderr || stdout || `open-memory CLI exited with status ${result.status}`,
    };
  }
  const payload = parseJson(stdout);
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      error: "open-memory CLI returned non-JSON output",
    };
  }
  return {
    ok: true,
    payload,
  };
}

function loadContextViaCli({ payload, strictStartupAllowlist = true, env = process.env } = {}) {
  const args = [];
  if (payload.tenantId) args.push("--tenant-id", String(payload.tenantId));
  if (payload.agentId) args.push("--agent-id", String(payload.agentId));
  if (payload.runId) args.push("--run-id", String(payload.runId));
  if (payload.query) args.push("--query", String(payload.query));
  args.push("--max-items", String(payload.maxItems ?? 8));
  args.push("--max-chars", String(payload.maxChars ?? 4000));
  args.push("--scan-limit", String(payload.scanLimit ?? 180));
  args.push("--expand-relationships", String(Boolean(payload.expandRelationships)));
  args.push("--max-hops", String(payload.maxHops ?? 2));
  args.push("--compact", "true");
  args.push("--compact-limit", "10");
  const response = runOpenMemoryCli({ command: "context", args, env });
  if (!response.ok) return response;
  const { context, items, summary, diagnostics } = extractContextEnvelope(response.payload);
  const preferredItems = filterPreferredRows(items);
  const startupItems = filterStartupRows(items);
  const selectedItems =
    strictStartupAllowlist
      ? preferredItems
      : preferredItems.length > 0
        ? preferredItems
        : startupItems;
  const selectedSummary = resolveSelectedStartupSummary(summary, selectedItems, 400);
  return {
    ok: true,
    payload: {
      context,
      items: selectedItems,
      summary: selectedSummary,
      diagnostics,
    },
  };
}

function loadLocalStartupContext({
  query = "",
  maxItems = 8,
  maxChars = 4000,
  strictStartupAllowlist = true,
  env = process.env,
} = {}) {
  const resolvedThreadInfo = resolveStartupThreadInfo(env);
  const resolvedThreadId = clean(resolvedThreadInfo?.threadId);
  if (!resolvedThreadId && !resolvedThreadInfo) {
    return {
      ok: false,
      attempted: Boolean(resolveStartupThreadHint(env) || resolveStartupCwd(env)),
      reason: "missing-local-thread",
    };
  }

  const artifacts = resolvedThreadId ? loadBootstrapArtifacts(resolvedThreadId) : null;
  const threadInfo =
    resolvedThreadInfo ||
    (resolvedThreadId
      ? {
          threadId: resolvedThreadId,
          rolloutPath: "",
          cwd: clean(artifacts?.continuityEnvelope?.cwd || cwd),
          title: "",
          firstUserMessage: "",
          updatedAt: clean(
            artifacts?.continuityEnvelope?.updatedAt ||
              artifacts?.handoff?.createdAt ||
              artifacts?.startupBlocker?.createdAt
          ),
        }
      : null);
  if (!threadInfo?.threadId) {
    return {
      ok: false,
      attempted: true,
      reason: "missing-local-thread",
    };
  }

  const historyLines = readThreadHistoryLines(threadInfo.threadId, { limit: 5 });
  const threadName = readThreadName(threadInfo.threadId);
  const rolloutEntries = parseRolloutEntries(threadInfo.rolloutPath || "");
  const continuityDecision = resolveBootstrapContinuityState({
    remoteContextAvailable: false,
    startupBlocker: artifacts?.startupBlocker,
    continuityEnvelope: artifacts?.continuityEnvelope,
    handoff: artifacts?.handoff,
    bootstrapContext: artifacts?.context,
    query,
  });
  const localContext = buildLocalBootstrapContext({
    threadInfo,
    threadName,
    historyLines,
    rolloutEntries,
    maxItems,
    maxChars,
    strictStartupAllowlist,
    continuityEnvelope: artifacts?.continuityEnvelope,
    handoff: artifacts?.handoff,
    startupBlocker: artifacts?.startupBlocker,
  });
  const localFallbackStrategy =
    clean(localContext?.diagnostics?.fallbackStrategy) || "local-bootstrap-artifacts";
  const itemCount = Array.isArray(localContext?.items) ? localContext.items.length : 0;
  const blockerSummary = clean(
    artifacts?.startupBlocker?.firstSignal ||
      artifacts?.startupBlocker?.remoteError ||
      artifacts?.startupBlocker?.blockers?.[0]?.summary
  );
  const derivedLocalDiagnostics = deriveStartupGroundingDiagnostics({
    rows: localContext?.items || [],
    diagnostics: localContext?.diagnostics,
    threadInfo,
    continuityState: continuityDecision.continuityState,
  });
  const hasValidatedLocalHandoff = Boolean(
    clean(artifacts?.handoff?.summary || artifacts?.handoff?.workCompleted || artifacts?.handoff?.activeGoal)
  );
  const adjustedLocalContinuityState =
    continuityDecision.continuityState === "ready" &&
    !hasValidatedLocalHandoff &&
    derivedLocalDiagnostics.compactionDominated === true
      ? "continuity_degraded"
      : continuityDecision.continuityState;
  const reasonCode =
    adjustedLocalContinuityState === "ready" || adjustedLocalContinuityState === "continuity_degraded"
      ? STARTUP_REASON_CODES.OK
      : adjustedLocalContinuityState === "blocked"
        ? STARTUP_REASON_CODES.STARTUP_UNAVAILABLE
        : STARTUP_REASON_CODES.EMPTY_CONTEXT;

  return {
    ok: itemCount > 0,
    attempted: true,
    reason: adjustedLocalContinuityState === "blocked" ? "local-startup-blocker" : "",
    error: adjustedLocalContinuityState === "blocked" ? blockerSummary : "",
    status: 200,
    itemCount,
    contextSummary: clean(localContext?.summary).slice(0, 400),
    reasonCode,
    contextRows: localContext?.items || [],
    fallbackSources: listSourcesFromRows(localContext?.items || []),
    diagnostics: {
      ...derivedLocalDiagnostics,
      startupSourceBias: "local-fallback",
      strictStartupAllowlist,
      fallbackUsed: true,
      fallbackStrategy: localFallbackStrategy,
      selectedRows: localContext?.items || [],
      localThreadId: clean(threadInfo.threadId),
      localContinuityState: adjustedLocalContinuityState,
      localContinuitySource:
        adjustedLocalContinuityState !== continuityDecision.continuityState
          ? "local-artifact-quality"
          : continuityDecision.source,
      localContinuityValidated: adjustedLocalContinuityState === "ready",
      localContinuityBlocked: continuityDecision.blockerActive,
      localContinuitySummary: clean(continuityDecision.supplementalHandoffSummary),
      bootstrapArtifactPaths: {
        continuityEnvelopePath: clean(artifacts?.paths?.continuityEnvelopePath),
        handoffPath: clean(artifacts?.paths?.handoffPath),
        startupBlockerPath: clean(artifacts?.paths?.startupBlockerPath),
      },
    },
  };
}

function hasTrustedLocalStartupContext(localFallback, localFallbackDiagnostics) {
  if (!localFallback?.ok) return false;
  const mergedDiagnostics = {
    ...(localFallback.diagnostics && typeof localFallback.diagnostics === "object" ? localFallback.diagnostics : {}),
    ...(localFallbackDiagnostics && typeof localFallbackDiagnostics === "object" ? localFallbackDiagnostics : {}),
  };
  const continuityState = clean(
    mergedDiagnostics.localContinuityState || mergedDiagnostics.continuityState || ""
  ).toLowerCase();
  const groundingAuthority = deriveStartupGroundingAuthority({
    diagnostics: mergedDiagnostics,
    continuityState: continuityState || "ready",
  });
  return (
    continuityState === "ready" &&
    isTrustedStartupGroundingAuthority(groundingAuthority) &&
    Math.max(0, Number(mergedDiagnostics.threadScopedItemCount || 0)) > 0 &&
    mergedDiagnostics.compactionDominated !== true
  );
}

function captureViaCli({ payload, env = process.env } = {}) {
  const args = ["--text", String(payload.content || ""), "--source", String(payload.source || "codex-automation")];
  if (Array.isArray(payload.tags) && payload.tags.length > 0) {
    args.push("--tags", payload.tags.join(","));
  }
  if (payload.tenantId) args.push("--tenant-id", String(payload.tenantId));
  if (payload.agentId) args.push("--agent-id", String(payload.agentId));
  if (payload.runId) args.push("--run-id", String(payload.runId));
  return runOpenMemoryCli({ command: "capture", args, env });
}

function buildClient({ env = process.env, capability = "capture" } = {}) {
  if (capability === "capture" && !isEnabled(env.CODEX_OPEN_MEMORY_CAPTURE, true)) {
    return {
      ready: false,
      reason: "capture-disabled",
    };
  }

  if (capability === "context" && !isEnabled(env.CODEX_OPEN_MEMORY_CONTEXT, true)) {
    return {
      ready: false,
      reason: "context-disabled",
    };
  }

  const authHeader = normalizeBearer(resolveStudioBrainAuthToken(env));
  if (!authHeader) {
    return {
      ready: false,
      reason: "missing-auth-token",
    };
  }

  const baseUrl = clean(resolveStudioBrainBaseUrlFromEnv({ env })).replace(/\/$/, "");
  if (!baseUrl) {
    return {
      ready: false,
      reason: "missing-base-url",
    };
  }

  const adminToken = resolveStudioBrainAdminToken(env);
  const timeoutMsRaw = Number(env.CODEX_OPEN_MEMORY_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? Math.trunc(timeoutMsRaw) : DEFAULT_TIMEOUT_MS;

  return {
    ready: true,
    baseUrl,
    authHeader,
    adminToken,
    timeoutMs,
  };
}

async function requestJson(client, path, body) {
  const headers = {
    "content-type": "application/json",
    authorization: client.authHeader,
  };
  if (client.adminToken) {
    headers["x-studio-brain-admin-token"] = client.adminToken;
  }

  const timeout = timeoutController(client.timeoutMs);
  try {
    const response = await fetch(`${client.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: timeout.controller.signal,
    });
    const raw = await response.text();
    const parsed = parseJson(raw) || {};
    if (!response.ok) {
      const message = clean(parsed.message) || `HTTP ${response.status}`;
      return {
        ok: false,
        status: response.status,
        error: message,
      };
    }
    return {
      ok: true,
      status: response.status,
      payload: parsed,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    timeout.clear();
  }
}

function listSourcesFromRows(rows, maxItems = 8) {
  if (!Array.isArray(rows)) return [];
  const output = [];
  const seen = new Set();
  for (const row of rows) {
    const source = normalizeSource(readRowSource(row));
    if (!source || seen.has(source)) continue;
    seen.add(source);
    output.push(source);
    if (output.length >= maxItems) break;
  }
  return output;
}

function isGenericAdvisoryOnlyBlocker(value) {
  const normalized = clean(value).toLowerCase();
  if (!normalized) return false;
  return (
    normalized.startsWith("using fallback strategy:") ||
    normalized.startsWith("startup continuity loaded via fallback retrieval") ||
    normalized === "dream consolidation artifact is missing." ||
    normalized.startsWith("dreamactionability=")
  );
}

function pickTrustedTopBlocker(blockers = []) {
  const normalizedBlockers = Array.isArray(blockers) ? blockers.map((value) => clean(value)).filter(Boolean) : [];
  return normalizedBlockers.find((value) => !isGenericAdvisoryOnlyBlocker(value)) || "";
}

export function buildStartupContextPack({
  brief = {},
  diagnostics = {},
  continuityState = "missing",
  reasonCode = STARTUP_REASON_CODES.STARTUP_UNAVAILABLE,
  groundingAuthority = "",
} = {}) {
  const authority = groundingAuthority || deriveStartupGroundingAuthority({ diagnostics, continuityState });
  const publishTrustedGrounding =
    clean(continuityState).toLowerCase() === "ready" &&
    isTrustedStartupGroundingAuthority(authority);
  const advisoryGoal = clean(brief?.goal);
  const advisoryBlocker = clean(brief?.blockers?.[0]);
  const advisoryNextRecommendedAction = clean(brief?.recommendedNextActions?.[0]);
  const trustedTopBlocker = pickTrustedTopBlocker(brief?.blockers);

  return {
    dominantGoal: publishTrustedGrounding ? advisoryGoal : "",
    topBlocker: publishTrustedGrounding ? trustedTopBlocker : "",
    nextRecommendedAction: publishTrustedGrounding ? advisoryNextRecommendedAction : "",
    groundingAuthority: authority,
    grounding: publishTrustedGrounding
      ? {
          dominantGoal: advisoryGoal,
          topBlocker: trustedTopBlocker,
          nextRecommendedAction: advisoryNextRecommendedAction,
        }
      : {},
    advisory:
      publishTrustedGrounding
        ? {}
        : {
            dominantGoal: advisoryGoal,
            topBlocker: advisoryBlocker,
            nextRecommendedAction: advisoryNextRecommendedAction,
          },
    goalAuthority: publishTrustedGrounding && advisoryGoal ? authority : "",
    blockerAuthority: publishTrustedGrounding && trustedTopBlocker ? authority : "",
    publishTrustedGrounding,
    fallbackOnly: clean(continuityState).toLowerCase() !== "ready" && reasonCode === STARTUP_REASON_CODES.OK,
  };
}

export function buildMemoryBrief({
  generatedAt,
  continuityState,
  query,
  contextSummary,
  contextRows = [],
  consolidationArtifactOverride,
  fallbackSources = [],
  diagnostics = {},
  reasonCode = STARTUP_REASON_CODES.STARTUP_UNAVAILABLE,
  error = "",
} = {}) {
  const consolidationArtifact =
    consolidationArtifactOverride && typeof consolidationArtifactOverride === "object"
      ? consolidationArtifactOverride
      : readJsonFile(MEMORY_CONSOLIDATION_ARTIFACT_PATH) || {};
  const summaryLines = sanitizeBriefLines(contextSummary, 8);
  const rowLines = summarizeStartupRows(contextRows, 480);
  const rowSummaryLines = sanitizeBriefLines(rowLines, 8);
  const continuityFallbackOnly =
    continuityState !== "ready" && reasonCode === STARTUP_REASON_CODES.OK;
  const consolidationSnapshot = resolveConsolidationSnapshot({
    consolidationArtifact,
    generatedAt,
    continuityState,
    continuityFallbackOnly,
  });
  const topActions = consolidationSnapshot.topActions;
  const goal =
    summaryLines[0]
    || rowSummaryLines[0]
    || topActions[0]
    || clean(query)
    || "Recover the latest trusted Studio Brain continuity.";
  const blockers = [];
  if (continuityFallbackOnly) {
    blockers.push(`Startup continuity loaded via fallback retrieval (${clean(diagnostics?.fallbackStrategy || "search-unscoped")}).`);
  } else if (continuityState !== "ready") {
    blockers.push(clean(error) || `Startup continuity is ${continuityState}.`);
  }
  if (diagnostics?.fallbackUsed) {
    blockers.push(`Using fallback strategy: ${clean(diagnostics.fallbackStrategy || "local-fallback")}.`);
  }
  if (reasonCode && reasonCode !== STARTUP_REASON_CODES.OK && reasonCode !== STARTUP_REASON_CODES.EMPTY_CONTEXT) {
    blockers.push(`reasonCode=${reasonCode}`);
  }
  if (consolidationSnapshot.blocker) {
    blockers.push(consolidationSnapshot.blocker);
  }
  if (consolidationSnapshot.actionabilityStatus && consolidationSnapshot.actionabilityStatus !== "passed") {
    blockers.push(`dreamActionability=${consolidationSnapshot.actionabilityStatus}`);
  }

  const recentDecisions = [...summaryLines, ...rowSummaryLines]
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 4);
  const defaultNextActions =
    continuityState === "ready"
      ? [
          clean(query) ? `Resume startup query: ${clean(query)}.` : "Resume the latest bounded task context.",
          "Prefer episodic/canonical memory before broad repo reads.",
        ]
      : continuityFallbackOnly
        ? [
            "Proceed with the authenticated fallback context while keeping repo reads tightly scoped.",
            "Promote stronger startup-eligible episodic memories so future threads avoid search fallback.",
          ]
        : [
            "Proceed with the local fallback memory brief plus current repo state.",
            "Restore Studio Brain auth or transport before the next continuity refresh.",
          ];
  const recommendedNextActions =
    sanitizeActionList([...topActions, ...defaultNextActions], 4);
  const consolidationFocusAreas = [
    goal,
    ...blockers.slice(0, 2),
    ...recentDecisions.slice(0, 2),
    ...topActions.slice(0, 2),
    ...fallbackSources.slice(0, 2).map((source) => `fallback:${source}`),
  ]
    .map((value) => sanitizeBriefLine(value))
    .filter(Boolean)
    .slice(0, 6);
  const briefSummaryFallback =
    continuityState === "ready"
      ? "Startup context loaded from trusted continuity sources."
      : continuityFallbackOnly
        ? "Startup context loaded from authenticated continuity sources, but fallback retrieval was needed."
        : `Startup continuity is ${continuityState.replace(/_/g, " ")}; local fallback layers were used.`;
  const summary = summarizeBriefLines(
    recentDecisions,
    topActions[0] || briefSummaryFallback,
  );

  return {
    schema: "studio-brain.memory-brief.v1",
    generatedAt,
    continuityState,
    summary,
    goal,
    blockers: blockers.slice(0, 4),
    recentDecisions,
    recommendedNextActions: recommendedNextActions.slice(0, 4),
    fallbackSources: fallbackSources.slice(0, 8),
    sourcePath: "output/studio-brain/memory-brief/latest.json",
    layers: {
      coreBlocks: [
        goal,
        clean(query) ? `query=${clean(query)}` : "",
        continuityState === "ready" ? "persona/current-goal continuity loaded" : "persona/current-goal continuity degraded",
      ].filter(Boolean),
      workingMemory: [summary.slice(0, 220)].filter(Boolean),
      episodicMemory:
        recentDecisions.length > 0
          ? recentDecisions
          : fallbackSources.slice(0, 4).map((source) => `fallback:${source}`),
      canonicalMemory: ["accepted corpus artifacts", "promoted JSONL", "SQLite materialization"],
    },
    consolidation: {
      mode: consolidationSnapshot.mode,
      summary: consolidationSnapshot.summary,
      status: consolidationSnapshot.status,
      lastRunAt: consolidationSnapshot.lastRunAt,
      nextRunAt: consolidationSnapshot.nextRunAt,
      focusAreas: consolidationSnapshot.focusAreas.length > 0 ? consolidationSnapshot.focusAreas : consolidationFocusAreas,
      maintenanceActions: consolidationSnapshot.maintenanceActions,
      outputs: consolidationSnapshot.outputs,
      counts: consolidationSnapshot.counts,
      mixQuality: consolidationSnapshot.mixQuality,
      dominanceWarnings: consolidationSnapshot.dominanceWarnings,
      secondPassQueriesUsed: consolidationSnapshot.secondPassQueriesUsed,
      promotionCandidatesPending: consolidationSnapshot.promotionCandidatesPending,
      promotionCandidatesConfirmed: consolidationSnapshot.promotionCandidatesConfirmed,
      stalledCandidateCount: consolidationSnapshot.stalledCandidateCount,
      lastError: consolidationSnapshot.lastError,
      actionabilityStatus: consolidationSnapshot.actionabilityStatus,
      actionableInsightCount: consolidationSnapshot.actionableInsightCount,
      suppressedConnectionNoteCount: consolidationSnapshot.suppressedConnectionNoteCount,
      suppressedPseudoDecisionCount: consolidationSnapshot.suppressedPseudoDecisionCount,
      topActions,
    },
  };
}

function writeMemoryBriefArtifact(brief) {
  mkdirSync(dirname(MEMORY_BRIEF_ARTIFACT_PATH), { recursive: true });
  writeFileSync(MEMORY_BRIEF_ARTIFACT_PATH, `${JSON.stringify(brief, null, 2)}\n`, "utf8");
  return MEMORY_BRIEF_ARTIFACT_PATH;
}

async function ensureAutomationAuth(env = process.env) {
  const tokenFreshness = inspectTokenFreshness(resolveStudioBrainAuthToken(env));
  if (tokenFreshness.state === "fresh" || tokenFreshness.state === "expiring") {
    return {
      ok: true,
      hydrated: false,
      source: "existing-token",
      tokenFreshness,
    };
  }
  return hydrateStudioBrainAuthFromPortal({ repoRoot: REPO_ROOT, env });
}

function finalizeStartupContextResult(
  result,
  {
    startedAt,
    tokenFreshness,
    query = "",
    contextRows = [],
    diagnostics = {},
    fallbackSources = [],
    threadInfo = null,
    latencyBreakdown = {},
  } = {},
) {
  const latencyMs = Math.max(0, Date.now() - Number(startedAt || Date.now()));
  const startupLatency = evaluateStartupLatency(latencyMs);
  const mergedDiagnostics = deriveStartupGroundingDiagnostics({
    rows: contextRows,
    diagnostics: {
      ...(diagnostics && typeof diagnostics === "object" ? diagnostics : {}),
      ...(result?.diagnostics && typeof result.diagnostics === "object" ? result.diagnostics : {}),
    },
    threadInfo,
    continuityState: result?.continuityState,
  });
  const sourceFallbacks = Array.from(
    new Set(
      [...fallbackSources, ...listSourcesFromRows(contextRows), ...listSourcesFromRows(mergedDiagnostics?.selectedRows || [])].filter(Boolean),
    ),
  );
  const reasonCode =
    clean(result?.reasonCode) ||
    (result?.ok && Number(result?.itemCount || 0) > 0
      ? STARTUP_REASON_CODES.OK
      : classifyStartupReason({
          attempted: Boolean(result?.attempted),
          reason: result?.reason,
          error: result?.error,
          status: result?.status,
          itemCount: result?.itemCount,
          tokenFreshness,
          diagnostics: mergedDiagnostics,
        }));
  const explicitContinuityState = clean(
    result?.continuityState ||
      mergedDiagnostics?.localContinuityState ||
      mergedDiagnostics?.continuityState
  ).toLowerCase();
  const localContinuityValidated = mergedDiagnostics?.localContinuityValidated === true;
  const localContinuityBlocked =
    mergedDiagnostics?.localContinuityBlocked === true || explicitContinuityState === "blocked";
  let continuityState =
    explicitContinuityState === "ready" && localContinuityValidated
      ? "ready"
      : reasonCode === STARTUP_REASON_CODES.OK
        ? localContinuityValidated || !mergedDiagnostics?.fallbackUsed
          ? "ready"
          : "continuity_degraded"
        : localContinuityBlocked
          ? "blocked"
          : explicitContinuityState === "missing" || reasonCode === STARTUP_REASON_CODES.EMPTY_CONTEXT
            ? "missing"
            : "continuity_degraded";
  let groundingAuthority = deriveStartupGroundingAuthority({
    diagnostics: mergedDiagnostics,
    continuityState,
  });
  if (continuityState === "ready" && !isTrustedStartupGroundingAuthority(groundingAuthority)) {
    continuityState = "continuity_degraded";
    groundingAuthority = deriveStartupGroundingAuthority({
      diagnostics: mergedDiagnostics,
      continuityState,
    });
  }
  const brief = buildMemoryBrief({
    generatedAt: new Date().toISOString(),
    continuityState,
    query,
    contextSummary: result?.contextSummary || "",
    contextRows,
    fallbackSources: sourceFallbacks,
    diagnostics: mergedDiagnostics,
    reasonCode,
    error: result?.error || result?.reason || "",
  });
  const memoryBriefPath = writeMemoryBriefArtifact(brief);
  const startupContextPack = {
    ...buildStartupContextPack({
      brief,
      diagnostics: mergedDiagnostics,
      continuityState,
      reasonCode,
      groundingAuthority,
    }),
    laneSourceQuality: clean(
      mergedDiagnostics?.laneSourceQuality || mergedDiagnostics?.startupSourceQuality || mergedDiagnostics?.groundingQuality
    ),
    threadScoped: Math.max(0, Math.round(Number(mergedDiagnostics?.threadScopedItemCount || 0))) > 0,
  };
  const detailedLatencyBreakdown = sanitizeMetrics({
    ...(latencyBreakdown && typeof latencyBreakdown === "object" ? latencyBreakdown : {}),
    totalMs: latencyMs,
  });

  return {
    ...result,
    reasonCode,
    continuityState,
    latencyMs,
    startupLatency,
    latencyBreakdown: detailedLatencyBreakdown,
    tokenFreshness,
    fallbackSources: sourceFallbacks,
    dominantGoal: startupContextPack.dominantGoal,
    topBlocker: startupContextPack.topBlocker,
    nextRecommendedAction: startupContextPack.nextRecommendedAction,
    groundingAuthority: startupContextPack.groundingAuthority,
    grounding: startupContextPack.grounding,
    advisory: startupContextPack.advisory,
    goalAuthority: startupContextPack.goalAuthority,
    blockerAuthority: startupContextPack.blockerAuthority,
    laneSourceQuality: startupContextPack.laneSourceQuality,
    fallbackOnly: startupContextPack.fallbackOnly,
    diagnostics: {
      ...mergedDiagnostics,
      continuityState,
      continuityReasonCode: reasonCode,
      continuityReason: clean(result?.error || result?.reason || ""),
      memoryLayerModel: "core-blocks|working-memory|episodic-memory|canonical-memory",
      fallbackSources: sourceFallbacks,
      startupLatencyBreakdown: detailedLatencyBreakdown,
      ...startupContextPack,
      contextPack: startupContextPack,
    },
    memoryBrief: brief,
    memoryBriefPath,
  };
}

export async function loadAutomationStartupMemoryContext({
  tool = "automation",
  runId = "",
  query = "",
  maxItems = 8,
  maxChars = 4000,
  scanLimit = 180,
  expandRelationships,
  maxHops,
  env = process.env,
} = {}) {
  const startedAt = Date.now();
  const latencyBreakdown = {};
  const recordStage = (key, stageStartedAt) => {
    latencyBreakdown[key] = Math.max(0, Date.now() - Number(stageStartedAt || Date.now()));
  };
  const startupThreadInfo = resolveStartupThreadInfo(env);
  const authStartedAt = Date.now();
  const authState = await ensureAutomationAuth(env);
  recordStage("authMs", authStartedAt);
  const tokenFreshness = authState?.tokenFreshness || inspectTokenFreshness(resolveStudioBrainAuthToken(env));
  const strictStartupAllowlist = isEnabled(env.CODEX_OPEN_MEMORY_STRICT_STARTUP_ALLOWLIST, true);
  const payload = {
    tenantId: resolveTenantId(env) || undefined,
    agentId: resolveAgentId(env, `agent:codex-${tool}`),
    runId: clean(runId) || undefined,
    query: clean(query) || undefined,
    sourceAllowlist: mergeUniqueSources(
      isEnabled(env.CODEX_OPEN_MEMORY_DISABLE_DEFAULT_SOURCE_ALLOWLIST, false)
        ? []
        : defaultBootstrapSourceAllowlist(),
      parseCsv(env.CODEX_OPEN_MEMORY_SOURCE_ALLOWLIST || "")
    ),
    sourceDenylist: mergeUniqueSources(
      isEnabled(env.CODEX_OPEN_MEMORY_DISABLE_DEFAULT_SOURCE_DENYLIST, false) ? [] : defaultBootstrapSourceDenylist(),
      parseCsv(env.CODEX_OPEN_MEMORY_SOURCE_DENYLIST || "")
    ),
    retrievalMode: normalizeRetrievalMode(env.CODEX_OPEN_MEMORY_RETRIEVAL_MODE || "hybrid"),
    maxItems: Math.max(1, Math.trunc(maxItems)),
    maxChars: Math.max(256, Math.trunc(maxChars)),
    scanLimit: Math.max(40, Math.trunc(scanLimit)),
    includeTenantFallback: false,
    expandRelationships: coerceBoolean(
      expandRelationships,
      isEnabled(env.CODEX_OPEN_MEMORY_EXPAND_RELATIONSHIPS, true)
    ),
    maxHops: coercePositiveInt(
      maxHops,
      coercePositiveInt(env.CODEX_OPEN_MEMORY_MAX_HOPS, 2)
    ),
    layerAllowlist: [],
    layerDenylist: [],
  };
  const cacheState = buildStartupContextCacheState({
    threadId: clean(startupThreadInfo?.threadId),
    cacheKey: buildStartupContextCacheKey({
      threadInfo: startupThreadInfo,
      payload,
      strictStartupAllowlist,
    }),
  });
  const finalizeResolvedStartup = (
    result,
    {
      contextRows = [],
      diagnostics = {},
      fallbackSources = [],
    } = {},
  ) =>
    finalizeStartupContextResult(result, {
      startedAt,
      tokenFreshness,
      query: payload.query,
      contextRows,
      diagnostics: {
        ...(diagnostics && typeof diagnostics === "object" ? diagnostics : {}),
        startupLatencyBreakdown: sanitizeMetrics(latencyBreakdown),
      },
      fallbackSources,
      threadInfo: startupThreadInfo,
      latencyBreakdown,
    });

  const localFallbackStartedAt = Date.now();
  let localFallback = loadLocalStartupContext({
    query: payload.query,
    maxItems: payload.maxItems,
    maxChars: payload.maxChars,
    strictStartupAllowlist,
    env,
  });
  recordStage("localFallbackMs", localFallbackStartedAt);
  let localFallbackDiagnostics = localFallback.ok
    ? deriveStartupGroundingDiagnostics({
        rows: localFallback.contextRows,
        diagnostics: localFallback.diagnostics,
        threadInfo: startupThreadInfo,
        continuityState: clean(localFallback.diagnostics?.continuityState),
      })
    : null;
  if (hasTrustedLocalStartupContext(localFallback, localFallbackDiagnostics)) {
    return applyStartupContextCacheMetadata(
      finalizeResolvedStartup({
        attempted: true,
        ok: true,
        reason: localFallback.reason,
        error: localFallback.error,
        status: localFallback.status,
        itemCount: localFallback.itemCount,
        contextSummary: localFallback.contextSummary,
        reasonCode: localFallback.reasonCode,
        diagnostics: {
          ...localFallback.diagnostics,
          startupContextStage: "local-validated-short-circuit",
          fallbackUsed: true,
          fallbackStrategy: clean(localFallback.diagnostics?.fallbackStrategy || "local-bootstrap-artifacts"),
        },
      }, {
        contextRows: localFallback.contextRows,
        diagnostics: localFallback.diagnostics,
        fallbackSources: localFallback.fallbackSources,
      }),
      {
        cacheState,
        cacheHit: false,
        shortCircuit: true,
      },
      {
        startedAt,
        env,
      }
    );
  }

  return withStartupContextSingleFlight(cacheState, async () => {
    const client = buildClient({ env, capability: "context" });
    if (!client.ready) {
      if (localFallback.ok) {
        return finalizeResolvedStartup({
          attempted: true,
          ok: true,
          reason: localFallback.reason,
          error: localFallback.error,
          status: localFallback.status,
          itemCount: localFallback.itemCount,
          contextSummary: localFallback.contextSummary,
          reasonCode: localFallback.reasonCode,
          diagnostics: {
            ...localFallback.diagnostics,
            startupContextStage: "local-continuity-fallback",
            fallbackUsed: true,
            fallbackStrategy: clean(localFallback.diagnostics?.fallbackStrategy || "local-bootstrap-artifacts"),
          },
        }, {
          contextRows: localFallback.contextRows,
          diagnostics: localFallback.diagnostics,
          fallbackSources: localFallback.fallbackSources,
        });
      }
      const allowCliFallback = isEnabled(env.CODEX_OPEN_MEMORY_CLI_FALLBACK, true);
      if (client.reason === "missing-auth-token" && allowCliFallback) {
        const cliFallbackStartedAt = Date.now();
        const cliResponse = loadContextViaCli({ payload, strictStartupAllowlist, env });
        recordStage("cliFallbackMs", cliFallbackStartedAt);
        if (cliResponse.ok) {
          const { items, summary, diagnostics } = extractContextEnvelope(cliResponse.payload);
          return finalizeResolvedStartup({
            attempted: true,
            ok: true,
            reason: "",
            error: "",
            status: 200,
            itemCount: Array.isArray(items) ? items.length : 0,
            contextSummary: clean(summary).slice(0, 400),
            diagnostics: {
              ...(diagnostics && typeof diagnostics === "object" ? diagnostics : {}),
              startupSourceBias: "preferred-startup-sources",
              strictStartupAllowlist,
              fallbackUsed: true,
              fallbackStrategy: "open-memory-cli",
              startupContextStage: "cli-fallback",
            },
          }, {
            contextRows: items,
            diagnostics,
            fallbackSources: ["open-memory-cli"],
          });
        }
        return finalizeResolvedStartup({
          attempted: true,
          ok: false,
          reason: "context-cli-fallback-failed",
          error: cliResponse.error || "open-memory CLI fallback failed",
          status: 0,
          itemCount: 0,
          contextSummary: "",
        }, {
          fallbackSources: ["open-memory-cli"],
        });
      }
      return finalizeResolvedStartup({
        attempted: false,
        ok: false,
        reason: client.reason,
        itemCount: 0,
        contextSummary: "",
      });
    }

    const scopedStageStartedAt = Date.now();
    const initialStage = await requestStartupContextStage({
      client,
      payload,
      strictStartupAllowlist,
      startupStage: "scoped",
      threadInfo: startupThreadInfo,
    });
    recordStage("remoteScopedMs", scopedStageStartedAt);
    if (!initialStage.ok) {
      if (localFallback.ok) {
        return finalizeResolvedStartup({
          attempted: true,
          ok: true,
          reason: localFallback.reason,
          error: localFallback.error,
          status: localFallback.status,
          itemCount: localFallback.itemCount,
          contextSummary: localFallback.contextSummary,
          reasonCode: localFallback.reasonCode,
          diagnostics: {
            ...localFallback.diagnostics,
            remoteFailure: clean(initialStage.response.error),
            remoteStatus: Number(initialStage.response.status || 0),
            startupContextStage: "local-continuity-fallback",
            fallbackUsed: true,
            fallbackStrategy: clean(localFallback.diagnostics?.fallbackStrategy || "local-bootstrap-artifacts"),
          },
        }, {
          contextRows: localFallback.contextRows,
          diagnostics: localFallback.diagnostics,
          fallbackSources: localFallback.fallbackSources,
        });
      }
      return finalizeResolvedStartup({
        attempted: true,
        ok: false,
        reason: "context-request-failed",
        error: initialStage.response.error,
        status: initialStage.response.status,
        itemCount: 0,
        contextSummary: "",
      });
    }

    let activeStage = initialStage;
    const needsTenantContinuityStage =
      !initialStage.hasSelectedItems ||
      !initialStage.selectedSummary ||
      !initialStage.hasNonCoreSelected ||
      initialStage.compactionDominated === true;
    if (needsTenantContinuityStage) {
      const tenantStageStartedAt = Date.now();
      const tenantContinuityStage = await requestStartupContextStage({
        client,
        payload: {
          ...payload,
          agentId: undefined,
          runId: undefined,
          includeTenantFallback: true,
          layerAllowlist: [],
          layerDenylist: ["working"],
        },
        strictStartupAllowlist,
        startupStage: "tenant-continuity",
        threadInfo: startupThreadInfo,
      });
      recordStage("tenantContinuityMs", tenantStageStartedAt);
      const tenantImprovesContinuity =
        tenantContinuityStage.compactionDominated === false &&
        (activeStage.compactionDominated === true || !activeStage.hasSelectedItems || !activeStage.selectedSummary);
      if (
        tenantContinuityStage.ok &&
        (
          tenantContinuityStage.hasNonCoreSelected ||
          tenantContinuityStage.hasSelectedItems ||
          Boolean(tenantContinuityStage.selectedSummary)
        )
      ) {
        activeStage = tenantImprovesContinuity ? tenantContinuityStage : activeStage;
        if (!tenantImprovesContinuity && (!activeStage.hasSelectedItems || !activeStage.selectedSummary)) {
          activeStage = tenantContinuityStage;
        }
      }
    }

    const selectedItems = activeStage.selectedItems;
    const selectedSummary = activeStage.selectedSummary;
    const selectedDiagnostics = deriveStartupGroundingDiagnostics({
      rows: selectedItems.length > 0 ? selectedItems : activeStage.items || [],
      diagnostics: activeStage.diagnostics,
      threadInfo: startupThreadInfo,
      continuityState: clean(activeStage.diagnostics?.continuityState),
    });
    let fallback = null;
    if (selectedItems.length === 0 || !selectedSummary || activeStage.compactionDominated === true) {
      const fallbackStartedAt = Date.now();
      fallback = await fallbackSearchContext({
        client,
        tenantId: payload.tenantId,
        agentId: payload.agentId,
        runId: payload.runId,
        query: payload.query,
        sourceAllowlist: payload.sourceAllowlist,
        sourceDenylist: payload.sourceDenylist,
        retrievalMode: payload.retrievalMode,
        strictStartupAllowlist,
        threadInfo: startupThreadInfo,
      });
      recordStage("fallbackSearchMs", fallbackStartedAt);
    }
    const repairStartedAt = Date.now();
    const localArtifactRepair = !localFallback.ok || !localFallbackDiagnostics?.threadScopedItemCount
      ? repairLocalStartupArtifactsFromRows(
          selectedItems.length > 0 ? selectedItems : fallback?.rows || activeStage.items || [],
          {
            threadInfo: startupThreadInfo,
          }
        )
      : { repaired: false, reason: "existing-local-fallback-ready" };
    recordStage("localArtifactRepairMs", repairStartedAt);
    if (localArtifactRepair.repaired) {
      const localReloadStartedAt = Date.now();
      localFallback = loadLocalStartupContext({
        query: payload.query,
        maxItems: payload.maxItems,
        maxChars: payload.maxChars,
        strictStartupAllowlist,
        env,
      });
      recordStage("localReloadMs", localReloadStartedAt);
      localFallbackDiagnostics = localFallback.ok
        ? deriveStartupGroundingDiagnostics({
            rows: localFallback.contextRows,
            diagnostics: localFallback.diagnostics,
            threadInfo: startupThreadInfo,
            continuityState: clean(localFallback.diagnostics?.continuityState),
          })
        : null;
      if (hasTrustedLocalStartupContext(localFallback, localFallbackDiagnostics)) {
        return finalizeResolvedStartup({
          attempted: true,
          ok: true,
          reason: localFallback.reason,
          error: localFallback.error,
          status: localFallback.status,
          itemCount: localFallback.itemCount,
          contextSummary: localFallback.contextSummary,
          reasonCode: localFallback.reasonCode,
          diagnostics: {
            ...localFallback.diagnostics,
            localArtifactRepair,
            startupContextStage: "local-repair-short-circuit",
            fallbackUsed: true,
            fallbackStrategy: clean(localFallback.diagnostics?.fallbackStrategy || "local-bootstrap-artifacts"),
          },
        }, {
          contextRows: localFallback.contextRows,
          diagnostics: localFallback.diagnostics,
          fallbackSources: localFallback.fallbackSources,
        });
      }
    }
    const fallbackDiagnostics = fallback?.ok
      ? deriveStartupGroundingDiagnostics({
          rows: fallback.rows,
          threadInfo: startupThreadInfo,
          continuityState: clean(activeStage.diagnostics?.continuityState),
        })
      : null;
    const shouldUseSearchFallback =
      fallback?.ok &&
      (
        selectedItems.length === 0 ||
        !selectedSummary ||
        (activeStage.compactionDominated === true && fallbackDiagnostics?.compactionDominated === false)
      );
    const localFallbackImprovesContinuity =
      localFallback.ok &&
      (
        selectedItems.length === 0 ||
        !selectedSummary ||
        (
          Math.max(0, Number(localFallbackDiagnostics?.threadScopedItemCount || 0)) >
            Math.max(0, Number(selectedDiagnostics?.threadScopedItemCount || 0)) &&
          localFallbackDiagnostics?.compactionDominated !== true
        ) ||
        (
          clean(localFallbackDiagnostics?.startupSourceQuality) === "thread-scoped-dominant" &&
          clean(selectedDiagnostics?.startupSourceQuality) !== "thread-scoped-dominant"
        ) ||
        (shouldUseSearchFallback && fallbackDiagnostics?.compactionDominated === true && localFallbackDiagnostics?.compactionDominated === false) ||
        (
          activeStage.compactionDominated === true &&
          localFallbackDiagnostics?.compactionDominated === false &&
          Math.max(0, Number(localFallbackDiagnostics?.threadScopedItemCount || 0)) > 0
        )
      );
    const useLocalFallback =
      localFallbackImprovesContinuity ||
      (
        !shouldUseSearchFallback &&
        localFallback.ok &&
        (selectedItems.length === 0 || !selectedSummary)
      );
    const finalRows = useLocalFallback
      ? localFallback.contextRows
      : shouldUseSearchFallback
        ? fallback.rows
        : selectedItems.length > 0
          ? selectedItems
          : fallback?.rows || [];
    const finalSummary = useLocalFallback
      ? localFallback.contextSummary
      : shouldUseSearchFallback
        ? summarizeSearchRows(fallback?.rows || [], 400)
        : selectedSummary || summarizeSearchRows(fallback?.rows || [], 400);
    const finalItemCount = Array.isArray(finalRows) ? finalRows.length : 0;
    return finalizeResolvedStartup({
      attempted: true,
      ok: true,
      reason: "",
      error: useLocalFallback ? localFallback.error : "",
      status: activeStage.response.status,
      itemCount: finalItemCount,
      contextSummary: finalSummary.slice(0, 400),
      reasonCode: useLocalFallback ? localFallback.reasonCode : "",
      diagnostics: {
        ...activeStage.diagnostics,
        ...(useLocalFallback ? localFallback.diagnostics : {}),
        startupSourceBias: "preferred-startup-sources",
        strictStartupAllowlist,
        ...(localArtifactRepair.repaired
          ? {
              localArtifactRepair,
            }
          : {}),
        startupContextStage: useLocalFallback
          ? "local-continuity-fallback"
          : shouldUseSearchFallback
            ? selectedItems.length > 0
              ? "search-continuity-upgrade"
              : "search-fallback"
            : activeStage.startupStage,
        fallbackUsed: Boolean(shouldUseSearchFallback || useLocalFallback),
        fallbackStrategy: useLocalFallback
          ? localFallback.diagnostics?.fallbackStrategy
          : shouldUseSearchFallback
            ? fallback?.strategy || null
            : null,
      },
    }, {
      contextRows: finalRows,
      diagnostics: activeStage.diagnostics,
      fallbackSources: useLocalFallback
        ? localFallback.fallbackSources
        : shouldUseSearchFallback
          ? listSourcesFromRows(fallback.rows)
          : [],
    });
  }, {
    env,
    startedAt,
  });
}

export async function captureAutomationMemory({
  tool = "automation",
  runId = "",
  status = "unknown",
  summary = {},
  extraTags = [],
  source = "",
  metadata = {},
  env = process.env,
} = {}) {
  const cleanedTool = clean(tool) || "automation";
  const cleanedRunId = clean(runId);
  const cleanedStatus = clean(status) || "unknown";
  const metricLine = buildContextLine(summary);
  const content = [
    `Codex automation ${cleanedTool} finished with status ${cleanedStatus}.`,
    cleanedRunId ? `Run ID: ${cleanedRunId}.` : "",
    metricLine ? `Metrics: ${metricLine}.` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1800);

  const tags = [
    "codex",
    "automation",
    cleanedTool,
    `status:${cleanedStatus}`,
    ...extraTags.map((tag) => clean(tag)).filter(Boolean),
  ];

  const payload = {
    content,
    source: clean(source) || `codex-automation:${cleanedTool}`,
    tags: Array.from(new Set(tags)).slice(0, 24),
    metadata: {
      automation: true,
      tool: cleanedTool,
      status: cleanedStatus,
      runId: cleanedRunId || null,
      summary: sanitizeMetrics(summary),
      ...(metadata && typeof metadata === "object" ? metadata : {}),
    },
    tenantId: resolveTenantId(env) || undefined,
    agentId: resolveAgentId(env, `agent:codex-${cleanedTool}`),
    runId: cleanedRunId || undefined,
  };

  const notificationPayload = {
    tool: cleanedTool,
    runId: cleanedRunId,
    status: cleanedStatus,
    summary: sanitizeMetrics(summary),
    metadata: {
      source: payload.source,
      ...(metadata && typeof metadata === "object" ? metadata : {}),
    },
  };

  await ensureAutomationAuth(env);
  const client = buildClient({ env, capability: "capture" });
  if (!client.ready) {
    const allowCliFallback = isEnabled(env.CODEX_OPEN_MEMORY_CLI_FALLBACK, true);
    if (client.reason === "missing-auth-token" && allowCliFallback) {
      const cliResponse = captureViaCli({ payload, env });
      const notification = await safeNotifyAutomationOutcome({ ...notificationPayload, env });
      if (cliResponse.ok) {
        return {
          attempted: true,
          ok: true,
          reason: "",
          error: "",
          status: 200,
          notification,
        };
      }
      return {
        attempted: true,
        ok: false,
        reason: "capture-cli-fallback-failed",
        error: cliResponse.error || "open-memory CLI fallback failed",
        status: 0,
        notification,
      };
    }
    const notification = await safeNotifyAutomationOutcome({ ...notificationPayload, env });
    return {
      attempted: false,
      ok: false,
      reason: client.reason,
      error: "",
      status: 0,
      notification,
    };
  }

  const response = await requestJson(client, "/api/memory/capture", payload);
  const notification = await safeNotifyAutomationOutcome({ ...notificationPayload, env });
  if (!response.ok) {
    return {
      attempted: true,
      ok: false,
      reason: "capture-request-failed",
      error: response.error,
      status: response.status,
      notification,
    };
  }

  return {
    attempted: true,
    ok: true,
    reason: "",
    error: "",
    status: response.status,
    notification,
  };
}
