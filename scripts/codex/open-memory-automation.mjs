import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStudioBrainBaseUrlFromEnv } from "../studio-brain-url-resolution.mjs";

const DEFAULT_TIMEOUT_MS = 3500;
const DEFAULT_CLI_TIMEOUT_MS = 12000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");
const OPEN_MEMORY_CLI_SCRIPT = resolve(REPO_ROOT, "scripts/open-memory.mjs");

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
    "codex",
    "codex-handoff",
    "codex-resumable-session",
    "codex-friction-feedback-loop",
    "mcp",
    "manual",
    "context-slice:automation",
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
  if (normalized === "mcp" || normalized === "manual" || normalized === "codex") return true;
  if (normalized.startsWith("codex-")) return true;
  if (normalized.startsWith("context-slice:")) return true;
  return false;
}

function preferredStartupSourcePriority(source) {
  const normalized = normalizeSource(source || "");
  if (normalized === "codex-handoff") return 0;
  if (normalized === "codex-resumable-session") return 1;
  if (normalized === "codex-friction-feedback-loop") return 2;
  if (normalized === "codex") return 3;
  if (normalized.startsWith("codex-")) return 4;
  if (normalized === "manual") return 5;
  if (normalized === "context-slice:automation") return 6;
  if (normalized.startsWith("context-slice:")) return 7;
  if (normalized === "mcp") return 8;
  return 99;
}

function readRowSource(row) {
  return row?.source || row?.metadata?.source || "";
}

function readRowScore(row) {
  const numeric = Number(row?.score);
  return Number.isFinite(numeric) ? numeric : 0;
}

function filterPreferredRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row, index) => ({
      row,
      index,
      source: readRowSource(row),
      score: readRowScore(row),
    }))
    .filter((entry) => isPreferredStartupSource(entry.source))
    .sort((left, right) => {
      const priorityDelta =
        preferredStartupSourcePriority(left.source) - preferredStartupSourcePriority(right.source);
      if (priorityDelta !== 0) return priorityDelta;
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    })
    .map((entry) => entry.row);
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
    const selectedRows = strictStartupAllowlist ? preferredRows : preferredRows.length > 0 ? preferredRows : rows;
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

function resolveTenantId(env) {
  return clean(env.OPEN_MEMORY_TENANT_ID || env.STUDIO_BRAIN_MEMORY_TENANT_ID || "");
}

function resolveAgentId(env, fallback) {
  return clean(env.CODEX_OPEN_MEMORY_AGENT_ID || fallback || "agent:codex-automation");
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
  const selectedItems = strictStartupAllowlist ? preferredItems : preferredItems.length > 0 ? preferredItems : items;
  const selectedSummary = clean(summary) || summarizeItems(selectedItems, 400);
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

  const authHeader = normalizeBearer(env.STUDIO_BRAIN_AUTH_TOKEN || env.STUDIO_BRAIN_ID_TOKEN || "");
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

  const adminToken = clean(env.STUDIO_BRAIN_ADMIN_TOKEN || "");
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
  };

  const client = buildClient({ env, capability: "context" });
  if (!client.ready) {
    const allowCliFallback = isEnabled(env.CODEX_OPEN_MEMORY_CLI_FALLBACK, true);
    if (client.reason === "missing-auth-token" && allowCliFallback) {
      const cliResponse = loadContextViaCli({ payload, strictStartupAllowlist, env });
      if (cliResponse.ok) {
        const { items, summary, diagnostics } = extractContextEnvelope(cliResponse.payload);
        return {
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
        };
      }
      return {
        attempted: true,
        ok: false,
        reason: "context-cli-fallback-failed",
        error: cliResponse.error || "open-memory CLI fallback failed",
        status: 0,
        itemCount: 0,
        contextSummary: "",
      };
    }
    return {
      attempted: false,
      ok: false,
      reason: client.reason,
      itemCount: 0,
      contextSummary: "",
    };
  }

  const response = await requestJson(client, "/api/memory/context", payload);
  if (!response.ok) {
    return {
      attempted: true,
      ok: false,
      reason: "context-request-failed",
      error: response.error,
      status: response.status,
      itemCount: 0,
      contextSummary: "",
    };
  }

  const { items, summary, diagnostics } = extractContextEnvelope(response.payload);
  const preferredItems = filterPreferredRows(items);
  const selectedItems = strictStartupAllowlist ? preferredItems : preferredItems.length > 0 ? preferredItems : items;
  const selectedSummary = summary || summarizeItems(selectedItems, 400);
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
  const finalSummary = selectedSummary || summarizeSearchRows(fallback?.rows || [], 400);
  const finalItemCount =
    selectedItems.length > 0 ? selectedItems.length : Array.isArray(fallback?.rows) ? fallback.rows.length : 0;
  return {
    attempted: true,
    ok: true,
    reason: "",
    error: "",
    status: response.status,
    itemCount: finalItemCount,
    contextSummary: finalSummary.slice(0, 400),
    diagnostics: {
      ...diagnostics,
      startupSourceBias: "preferred-startup-sources",
      strictStartupAllowlist,
      fallbackUsed: Boolean(fallback?.ok),
      fallbackStrategy: fallback?.strategy || null,
    },
  };
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

  const client = buildClient({ env, capability: "capture" });
  if (!client.ready) {
    const allowCliFallback = isEnabled(env.CODEX_OPEN_MEMORY_CLI_FALLBACK, true);
    if (client.reason === "missing-auth-token" && allowCliFallback) {
      const cliResponse = captureViaCli({ payload, env });
      if (cliResponse.ok) {
        return {
          attempted: true,
          ok: true,
          reason: "",
          error: "",
          status: 200,
        };
      }
      return {
        attempted: true,
        ok: false,
        reason: "capture-cli-fallback-failed",
        error: cliResponse.error || "open-memory CLI fallback failed",
        status: 0,
      };
    }
    return {
      attempted: false,
      ok: false,
      reason: client.reason,
      error: "",
      status: 0,
    };
  }

  const response = await requestJson(client, "/api/memory/capture", payload);
  if (!response.ok) {
    return {
      attempted: true,
      ok: false,
      reason: "capture-request-failed",
      error: response.error,
      status: response.status,
    };
  }

  return {
    attempted: true,
    ok: true,
    reason: "",
    error: "",
    status: response.status,
  };
}
