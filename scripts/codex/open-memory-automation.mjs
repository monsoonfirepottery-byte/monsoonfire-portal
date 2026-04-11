import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STARTUP_REASON_CODES,
  classifyStartupReason,
  evaluateStartupLatency,
  inspectTokenFreshness,
} from "../lib/codex-startup-reliability.mjs";
import {
  buildLocalBootstrapContext,
  loadBootstrapArtifacts,
  parseRolloutEntries,
  readThreadHistoryLines,
  readThreadName,
  resolveBootstrapContinuityState,
  resolveCodexThreadContext,
} from "../lib/codex-session-memory-utils.mjs";
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

function preferredStartupSourcePriority(source) {
  const normalized = normalizeSource(source || "");
  if (normalized === "codex-compaction-promoted") return 0;
  if (normalized === "codex-handoff") return 0;
  if (normalized === "codex-resumable-session") return 1;
  if (normalized === "codex-friction-feedback-loop") return 2;
  if (normalized === "codex") return 3;
  if (normalized === "manual") return 4;
  if (normalized === "context-slice:automation") return 5;
  if (normalized.startsWith("context-slice:")) return 6;
  if (normalized === "codex-compaction-window") return 7;
  if (normalized === "codex-compaction-raw") return 8;
  if (normalized.startsWith("codex-")) return 9;
  if (normalized === "mcp") return 10;
  return 99;
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

function filterStartupRows(rows, { preferredOnly = false } = {}) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row, index) => ({
      row,
      index,
      source: readRowSource(row),
      score: readRowScore(row),
    }))
    .filter((entry) => rowHasStartupSignal(entry.row))
    .filter((entry) => !preferredOnly || isPreferredStartupSource(entry.source))
    .sort((left, right) => {
      const leftPriority = isPreferredStartupSource(left.source) ? preferredStartupSourcePriority(left.source) : 50;
      const rightPriority = isPreferredStartupSource(right.source) ? preferredStartupSourcePriority(right.source) : 50;
      const priorityDelta = leftPriority - rightPriority;
      if (priorityDelta !== 0) return priorityDelta;
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    })
    .map((entry) => entry.row);
}

function filterPreferredRows(rows) {
  return filterStartupRows(rows, { preferredOnly: true });
}

function summarizeStartupRows(rows, maxChars = 400) {
  const startupRows = filterStartupRows(rows);
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

function resolveSelectedStartupSummary(summary, items, maxChars = 400) {
  const summaryLines = sanitizeBriefLines(summary, 8);
  if (summaryLines.length > 0) {
    return summarizeBriefLines(summaryLines, "", maxChars);
  }
  return summarizeStartupRows(items, maxChars);
}

function readRowMemoryLayer(row) {
  return clean(row?.memoryLayer || row?.metadata?.memoryLayer || "").toLowerCase();
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
    const preferredRows = filterPreferredRows(rows);
    const startupRows = filterStartupRows(rows);
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
    response,
    startupStage,
    items,
    selectedItems,
    summary,
    selectedSummary,
    diagnostics,
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
  const cwd = resolveStartupCwd(env);
  const hintedThreadId = resolveStartupThreadHint(env);
  const resolvedThreadInfo = resolveCodexThreadContext({
    threadId: hintedThreadId,
    cwd,
  });
  const resolvedThreadId = clean(resolvedThreadInfo?.threadId || hintedThreadId);
  if (!resolvedThreadId && !resolvedThreadInfo) {
    return {
      ok: false,
      attempted: Boolean(hintedThreadId || cwd),
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
  const reasonCode =
    continuityDecision.continuityState === "ready"
      ? STARTUP_REASON_CODES.OK
      : continuityDecision.continuityState === "blocked"
        ? STARTUP_REASON_CODES.STARTUP_UNAVAILABLE
        : STARTUP_REASON_CODES.EMPTY_CONTEXT;

  return {
    ok: itemCount > 0,
    attempted: true,
    reason: continuityDecision.continuityState === "blocked" ? "local-startup-blocker" : "",
    error: continuityDecision.continuityState === "blocked" ? blockerSummary : "",
    status: 200,
    itemCount,
    contextSummary: clean(localContext?.summary).slice(0, 400),
    reasonCode,
    contextRows: localContext?.items || [],
    fallbackSources: listSourcesFromRows(localContext?.items || []),
    diagnostics: {
      ...(localContext?.diagnostics && typeof localContext.diagnostics === "object" ? localContext.diagnostics : {}),
      startupSourceBias: "local-fallback",
      strictStartupAllowlist,
      fallbackUsed: true,
      fallbackStrategy: localFallbackStrategy,
      selectedRows: localContext?.items || [],
      localThreadId: clean(threadInfo.threadId),
      localContinuityState: continuityDecision.continuityState,
      localContinuitySource: continuityDecision.source,
      localContinuityValidated: continuityDecision.continuityState === "ready",
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
  } = {},
) {
  const latencyMs = Math.max(0, Date.now() - Number(startedAt || Date.now()));
  const startupLatency = evaluateStartupLatency(latencyMs);
  const mergedDiagnostics = {
    ...(diagnostics && typeof diagnostics === "object" ? diagnostics : {}),
    ...(result?.diagnostics && typeof result.diagnostics === "object" ? result.diagnostics : {}),
  };
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
  const continuityState =
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

  return {
    ...result,
    reasonCode,
    continuityState,
    latencyMs,
    startupLatency,
    tokenFreshness,
    fallbackSources: sourceFallbacks,
    diagnostics: {
      ...mergedDiagnostics,
      continuityState,
      continuityReasonCode: reasonCode,
      continuityReason: clean(result?.error || result?.reason || ""),
      memoryLayerModel: "core-blocks|working-memory|episodic-memory|canonical-memory",
      fallbackSources: sourceFallbacks,
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
  const authState = await ensureAutomationAuth(env);
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
  const localFallback = loadLocalStartupContext({
    query: payload.query,
    maxItems: payload.maxItems,
    maxChars: payload.maxChars,
    strictStartupAllowlist,
    env,
  });

  const client = buildClient({ env, capability: "context" });
  if (!client.ready) {
    if (localFallback.ok) {
      return finalizeStartupContextResult({
        attempted: true,
        ok: true,
        reason: localFallback.reason,
        error: localFallback.error,
        status: localFallback.status,
        itemCount: localFallback.itemCount,
        contextSummary: localFallback.contextSummary,
        reasonCode: localFallback.reasonCode,
        diagnostics: localFallback.diagnostics,
      }, {
        startedAt,
        tokenFreshness,
        query: payload.query,
        contextRows: localFallback.contextRows,
        diagnostics: localFallback.diagnostics,
        fallbackSources: localFallback.fallbackSources,
      });
    }
    const allowCliFallback = isEnabled(env.CODEX_OPEN_MEMORY_CLI_FALLBACK, true);
    if (client.reason === "missing-auth-token" && allowCliFallback) {
      const cliResponse = loadContextViaCli({ payload, strictStartupAllowlist, env });
      if (cliResponse.ok) {
        const { items, summary, diagnostics } = extractContextEnvelope(cliResponse.payload);
        return finalizeStartupContextResult({
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
          },
        }, {
          startedAt,
          tokenFreshness,
          query: payload.query,
          contextRows: items,
          diagnostics,
          fallbackSources: ["open-memory-cli"],
        });
      }
      return finalizeStartupContextResult({
        attempted: true,
        ok: false,
        reason: "context-cli-fallback-failed",
        error: cliResponse.error || "open-memory CLI fallback failed",
        status: 0,
        itemCount: 0,
        contextSummary: "",
      }, {
        startedAt,
        tokenFreshness,
        query: payload.query,
        fallbackSources: ["open-memory-cli"],
      });
    }
    return finalizeStartupContextResult({
      attempted: false,
      ok: false,
      reason: client.reason,
      itemCount: 0,
      contextSummary: "",
    }, {
      startedAt,
      tokenFreshness,
      query: payload.query,
    });
  }

  const initialStage = await requestStartupContextStage({
    client,
    payload,
    strictStartupAllowlist,
    startupStage: "scoped",
  });
  if (!initialStage.ok) {
    if (localFallback.ok) {
      return finalizeStartupContextResult({
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
        },
      }, {
        startedAt,
        tokenFreshness,
        query: payload.query,
        contextRows: localFallback.contextRows,
        diagnostics: localFallback.diagnostics,
        fallbackSources: localFallback.fallbackSources,
      });
    }
    return finalizeStartupContextResult({
      attempted: true,
      ok: false,
      reason: "context-request-failed",
      error: initialStage.response.error,
      status: initialStage.response.status,
      itemCount: 0,
      contextSummary: "",
    }, {
      startedAt,
      tokenFreshness,
      query: payload.query,
    });
  }

  let activeStage = initialStage;
  const needsTenantContinuityStage =
    !initialStage.hasSelectedItems || !initialStage.selectedSummary || !initialStage.hasNonCoreSelected;
  if (needsTenantContinuityStage) {
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
    });
    if (
      tenantContinuityStage.ok &&
      (
        tenantContinuityStage.hasNonCoreSelected
        || tenantContinuityStage.hasSelectedItems
        || Boolean(tenantContinuityStage.selectedSummary)
      )
    ) {
      activeStage = tenantContinuityStage;
    }
  }

  const selectedItems = activeStage.selectedItems;
  const selectedSummary = activeStage.selectedSummary;
  let fallback = null;
  if (selectedItems.length === 0 || !selectedSummary) {
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
    });
  }
  const useLocalFallback =
    !fallback?.ok &&
    localFallback.ok &&
    (selectedItems.length === 0 || !selectedSummary);
  const finalRows = useLocalFallback
    ? localFallback.contextRows
    : selectedItems.length > 0
      ? selectedItems
      : fallback?.rows || [];
  const finalSummary = useLocalFallback
    ? localFallback.contextSummary
    : selectedSummary || summarizeSearchRows(fallback?.rows || [], 400);
  const finalItemCount = Array.isArray(finalRows) ? finalRows.length : 0;
  return finalizeStartupContextResult({
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
      startupContextStage: useLocalFallback
        ? "local-continuity-fallback"
        : fallback?.ok
          ? "search-fallback"
          : activeStage.startupStage,
      fallbackUsed: Boolean(fallback?.ok || useLocalFallback),
      fallbackStrategy: useLocalFallback ? localFallback.diagnostics?.fallbackStrategy : fallback?.strategy || null,
    },
  }, {
    startedAt,
    tokenFreshness,
    query: payload.query,
    contextRows: finalRows,
    diagnostics: activeStage.diagnostics,
    fallbackSources: useLocalFallback
      ? localFallback.fallbackSources
      : fallback?.ok
        ? listSourcesFromRows(fallback.rows)
        : [],
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
