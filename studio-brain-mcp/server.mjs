import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { mintStaffIdTokenFromPortalEnv, normalizeBearer } from "../scripts/lib/firebase-auth-token.mjs";
import {
  filterExpiredRows,
  loadBootstrapArtifacts,
  preferredStartupSources,
  rankBootstrapRows,
} from "../scripts/lib/codex-session-memory-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const DEFAULT_BASE_URL = process.env.STUDIO_BRAIN_MCP_BASE_URL || "http://192.168.1.226:8787";
const DEFAULT_TIMEOUT_MS = parsePositiveInt(process.env.STUDIO_BRAIN_MCP_TIMEOUT_MS, 10000);
const ADMIN_TOKEN = process.env.STUDIO_BRAIN_MCP_ADMIN_TOKEN || process.env.STUDIO_BRAIN_ADMIN_TOKEN || "";
const AUTH_REFRESH_MIN_INTERVAL_MS = 10_000;
const DEFAULT_REPO_CREDENTIALS_PATH = resolve(repoRoot, "secrets", "portal", "portal-agent-staff.json");
const DEFAULT_HOME_CREDENTIALS_PATH = resolve(homedir(), ".ssh", "portal-agent-staff.json");

let authorizationHeader = normalizeBearer(
  process.env.STUDIO_BRAIN_MCP_AUTH_HEADER ||
    process.env.STUDIO_BRAIN_MCP_ID_TOKEN ||
    process.env.STUDIO_BRAIN_ID_TOKEN ||
    process.env.STUDIO_BRAIN_AUTH_TOKEN ||
    ""
);
let lastAuthRefreshAtMs = 0;

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function clean(value) {
  return String(value ?? "").trim();
}

function withOptionalString(schema) {
  return schema.optional().transform((value) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  });
}

function withOptionalStringArray() {
  return z
    .array(z.string())
    .optional()
    .transform((items) =>
      Array.isArray(items)
        ? items.map((item) => item.trim()).filter(Boolean)
        : undefined
    );
}

const bootstrapArtifacts = loadBootstrapArtifacts(clean(process.env.STUDIO_BRAIN_BOOTSTRAP_THREAD_ID || ""));
const bootstrapThreadInfo = {
  threadId: clean(bootstrapArtifacts.metadata?.threadId || bootstrapArtifacts.context?.threadId || process.env.STUDIO_BRAIN_BOOTSTRAP_THREAD_ID),
  cwd: clean(bootstrapArtifacts.metadata?.cwd || bootstrapArtifacts.context?.cwd),
  rolloutPath: clean(bootstrapArtifacts.metadata?.rolloutPath),
  title: clean(bootstrapArtifacts.metadata?.threadTitle),
  firstUserMessage: clean(bootstrapArtifacts.metadata?.firstUserMessage),
};

function bootstrapItems() {
  const items = Array.isArray(bootstrapArtifacts.context?.items) ? bootstrapArtifacts.context.items : [];
  return rankBootstrapRows(filterExpiredRows(items), bootstrapThreadInfo);
}

function hasBootstrapContext() {
  return bootstrapItems().length > 0;
}

function summarizeRows(rows, maxChars = 400) {
  const lines = [];
  for (const [index, row] of rows.entries()) {
    const source = clean(row?.source || row?.metadata?.source || "memory");
    const content = clean(row?.content || row?.summary || "").replace(/\s+/g, " ").slice(0, 120);
    if (!content) continue;
    lines.push(`${index + 1}. [${source}] ${content}`);
    if (lines.join("\n").length >= maxChars) break;
  }
  return lines.join("\n").slice(0, maxChars);
}

function queryTokens(query) {
  return clean(query)
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9._:@/-]+/g, "").trim())
    .filter((token) => token.length >= 3)
    .slice(0, 16);
}

function localBootstrapSearch(query, limit = 10) {
  const rows = bootstrapItems();
  if (rows.length === 0) return [];
  const tokens = queryTokens(query);
  return rows
    .map((row, index) => {
      const haystack = `${clean(row?.content)}\n${clean(row?.source)}\n${clean(row?.metadata?.threadTitle)}`.toLowerCase();
      const tokenHits = tokens.reduce((count, token) => count + (haystack.includes(token) ? 1 : 0), 0);
      const baseScore = Number(row?.score);
      const score = (Number.isFinite(baseScore) ? baseScore : 0.5) + tokenHits * 0.08 - index * 0.001;
      return {
        ...row,
        score: Math.round(score * 1000) / 1000,
        matchedBy: Array.isArray(row?.matchedBy) ? [...new Set([...row.matchedBy, "bootstrap-artifact"])] : ["bootstrap-artifact"],
      };
    })
    .filter((row) => tokens.length === 0 || Number(row.score) > 0.5)
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0))
    .slice(0, Math.max(1, limit));
}

function applyRowsToPayload(payload, rows) {
  if (Array.isArray(payload)) {
    return {
      rows,
      results: rows,
      items: rows,
    };
  }
  if (!payload || typeof payload !== "object") {
    return { rows, results: rows };
  }
  const next = { ...payload };
  if (Array.isArray(next.rows)) next.rows = rows;
  if (Array.isArray(next.results)) next.results = rows;
  if (Array.isArray(next.items)) next.items = rows;
  return next;
}

function extractPayloadRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

function rewriteContextPayload(payload, rows) {
  const root = payload && typeof payload === "object" ? { ...payload } : {};
  const context =
    root.context && typeof root.context === "object"
      ? { ...root.context }
      : root.payload && typeof root.payload === "object"
        ? { ...root.payload }
        : { ...root };
  context.items = rows;
  if (!clean(context.summary)) {
    context.summary = summarizeRows(rows, 600);
  }
  context.diagnostics = {
    ...(context.diagnostics && typeof context.diagnostics === "object" ? context.diagnostics : {}),
    bootstrapContextLoaded: hasBootstrapContext(),
  };
  root.context = context;
  root.items = rows;
  root.summary = context.summary;
  root.diagnostics = context.diagnostics;
  return root;
}

function localBootstrapContextPayload(query, maxItems, maxChars) {
  const rows = localBootstrapSearch(query, maxItems);
  const summary =
    clean(bootstrapArtifacts.context?.summary) || summarizeRows(rows, Math.max(256, Math.min(600, maxChars || 600)));
  return {
    context: {
      ...(bootstrapArtifacts.context && typeof bootstrapArtifacts.context === "object" ? bootstrapArtifacts.context : {}),
      items: rows.slice(0, Math.max(1, maxItems)),
      summary: summary.slice(0, Math.max(256, maxChars || 8000)),
      diagnostics: {
        ...(bootstrapArtifacts.context?.diagnostics && typeof bootstrapArtifacts.context.diagnostics === "object"
          ? bootstrapArtifacts.context.diagnostics
          : {}),
        bootstrapContextLoaded: true,
        fallbackUsed: true,
        fallbackStrategy: "bootstrap-artifact",
      },
    },
    items: rows.slice(0, Math.max(1, maxItems)),
    summary: summary.slice(0, Math.max(256, maxChars || 8000)),
    diagnostics: {
      bootstrapContextLoaded: true,
      fallbackUsed: true,
      fallbackStrategy: "bootstrap-artifact",
    },
  };
}

function defaultStartupContextQuery() {
  return (
    clean(bootstrapThreadInfo.firstUserMessage) ||
    clean(bootstrapThreadInfo.title) ||
    clean(bootstrapThreadInfo.threadId) ||
    clean(bootstrapThreadInfo.cwd) ||
    "Studio Brain startup continuity"
  );
}

async function handleMemoryContextRequest({
  query,
  agentId,
  runId,
  maxItems,
  maxChars,
  tenantId,
  baseUrl,
  timeoutMs,
  allowDefaultQuery = false,
}) {
  const requestedMaxItems = maxItems ?? 12;
  const requestedMaxChars = maxChars ?? 8000;
  const resolvedQuery = clean(query) || (allowDefaultQuery ? defaultStartupContextQuery() : "");
  if (!resolvedQuery) {
    throw new Error("query is required");
  }

  try {
    const applyBootstrapBias = hasBootstrapContext() && !agentId && !runId;
    const payload = await studioBrainRequest({
      method: "POST",
      path: "/api/memory/context",
      body: {
        query: resolvedQuery,
        agentId,
        runId,
        maxItems: applyBootstrapBias ? Math.min(Math.max(requestedMaxItems * 2, 16), 40) : requestedMaxItems,
        maxChars: requestedMaxChars,
        tenantId,
        sourceAllowlist: applyBootstrapBias ? preferredStartupSources() : undefined,
        sourceDenylist: [],
      },
      baseUrl,
      timeoutMs,
    });
    const rawRows =
      (payload?.context && typeof payload.context === "object" && Array.isArray(payload.context.items) ? payload.context.items : null) ||
      (payload?.payload && typeof payload.payload === "object" && Array.isArray(payload.payload.items) ? payload.payload.items : null) ||
      extractPayloadRows(payload);
    const rankedRows = rankBootstrapRows(filterExpiredRows(rawRows), bootstrapThreadInfo).slice(0, requestedMaxItems);
    return asToolResult(rewriteContextPayload(payload, rankedRows));
  } catch (error) {
    if (hasBootstrapContext()) {
      return asToolResult(localBootstrapContextPayload(resolvedQuery, requestedMaxItems, requestedMaxChars));
    }
    return asToolError(error);
  }
}

function resolveDefaultCredentialsPath() {
  const explicitPath = clean(process.env.PORTAL_AGENT_STAFF_CREDENTIALS);
  const candidates = [explicitPath, DEFAULT_REPO_CREDENTIALS_PATH, DEFAULT_HOME_CREDENTIALS_PATH].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || DEFAULT_REPO_CREDENTIALS_PATH;
}

async function mintAuthorizationHeader() {
  const minted = await mintStaffIdTokenFromPortalEnv({
    env: process.env,
    defaultCredentialsPath: resolveDefaultCredentialsPath(),
    preferRefreshToken: true,
  });
  if (!minted.ok || !minted.token) return "";
  process.env.STUDIO_BRAIN_MCP_ID_TOKEN = minted.token;
  return normalizeBearer(minted.token);
}

function getHeaders() {
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (authorizationHeader) {
    headers.authorization = authorizationHeader;
  }
  if (ADMIN_TOKEN) {
    headers["x-studio-brain-admin-token"] = ADMIN_TOKEN;
  }
  return headers;
}

function getErrorMessage(payload) {
  if (typeof payload?.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }
  if (typeof payload?.error?.message === "string" && payload.error.message.trim()) {
    return payload.error.message.trim();
  }
  if (typeof payload?.raw === "string" && payload.raw.trim()) {
    return payload.raw.trim();
  }
  return "";
}

function shouldRefreshAuthorization(status, payload) {
  if (status !== 401 && status !== 403) return false;
  const message = getErrorMessage(payload);
  return /missing authorization header|invalid authorization|id-token-expired|auth\/id-token-expired|token.*expired/i.test(
    message
  );
}

async function studioBrainRequestOnce({ method, path, body, baseUrl = DEFAULT_BASE_URL, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = new URL(path, baseUrl);
  try {
    const response = await fetch(url, {
      method,
      headers: getHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = { raw };
    }
    return {
      ok: response.ok,
      status: response.status,
      payload,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function studioBrainRequest(args) {
  let result = await studioBrainRequestOnce(args);

  if (!result.ok && shouldRefreshAuthorization(result.status, result.payload)) {
    const now = Date.now();
    if (now - lastAuthRefreshAtMs > AUTH_REFRESH_MIN_INTERVAL_MS) {
      lastAuthRefreshAtMs = now;
      const refreshed = await mintAuthorizationHeader().catch(() => "");
      if (refreshed) {
        authorizationHeader = refreshed;
        result = await studioBrainRequestOnce(args);
      }
    }
  }

  if (!result.ok) {
    const message = getErrorMessage(result.payload) || `Studio Brain returned HTTP ${result.status}`;
    throw new Error(message);
  }

  return result.payload;
}

function asToolResult(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data,
  };
}

function asToolError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

const server = new McpServer(
  {
    name: "studio-brain-memory",
    version: "0.1.0",
  },
  {
    capabilities: {
      logging: {},
    },
  }
);

server.registerTool(
  "studio_brain_health",
  {
    title: "Studio Brain Health",
    description: "Check whether the Studio Brain HTTP service is reachable.",
    inputSchema: {
      baseUrl: z.string().url().optional(),
      timeoutMs: z.number().int().positive().max(60000).optional(),
    },
  },
  async ({ baseUrl, timeoutMs }) => {
    try {
      const payload = await studioBrainRequest({
        method: "GET",
        path: "/healthz",
        baseUrl,
        timeoutMs,
      });
      return asToolResult(payload);
    } catch (error) {
      return asToolError(error);
    }
  }
);

server.registerTool(
  "studio_brain_memory_search",
  {
    title: "Studio Brain Memory Search",
    description: "Search Studio Brain memory rows by query text.",
    inputSchema: {
      query: z.string().min(1),
      limit: z.number().int().min(1).max(100).optional(),
      tenantId: withOptionalString(z.string()),
      baseUrl: z.string().url().optional(),
      timeoutMs: z.number().int().positive().max(60000).optional(),
    },
  },
  async ({ query, limit, tenantId, baseUrl, timeoutMs }) => {
    try {
      const requestedLimit = limit ?? 10;
      const internalLimit = hasBootstrapContext() ? Math.min(Math.max(requestedLimit * 4, 24), 80) : requestedLimit;
      const payload = await studioBrainRequest({
        method: "POST",
        path: "/api/memory/search",
        body: {
          query,
          limit: internalLimit,
          tenantId,
          sourceAllowlist: hasBootstrapContext() ? preferredStartupSources() : undefined,
          sourceDenylist: [],
        },
        baseUrl,
        timeoutMs,
      });
      const rows = rankBootstrapRows(filterExpiredRows(extractPayloadRows(payload)), bootstrapThreadInfo)
        .slice(0, requestedLimit);
      return asToolResult(
        applyRowsToPayload(
          {
            ...payload,
            diagnostics: {
              ...(payload?.diagnostics && typeof payload.diagnostics === "object" ? payload.diagnostics : {}),
              bootstrapContextLoaded: hasBootstrapContext(),
            },
          },
          rows
        )
      );
    } catch (error) {
      if (hasBootstrapContext()) {
        const rows = localBootstrapSearch(query, limit ?? 10);
        return asToolResult({
          ok: true,
          rows,
          results: rows,
          diagnostics: {
            bootstrapContextLoaded: true,
            fallbackUsed: true,
            fallbackStrategy: "bootstrap-artifact",
          },
        });
      }
      return asToolError(error);
    }
  }
);

server.registerTool(
  "studio_brain_memory_recent",
  {
    title: "Studio Brain Memory Recent",
    description: "List the most recent Studio Brain memory entries.",
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional(),
      baseUrl: z.string().url().optional(),
      timeoutMs: z.number().int().positive().max(60000).optional(),
    },
  },
  async ({ limit, baseUrl, timeoutMs }) => {
    try {
      const requestedLimit = limit ?? 20;
      const query = new URLSearchParams();
      if (requestedLimit) query.set("limit", String(hasBootstrapContext() ? Math.min(Math.max(requestedLimit * 3, 30), 90) : requestedLimit));
      const path = query.size > 0 ? `/api/memory/recent?${query.toString()}` : "/api/memory/recent";
      const payload = await studioBrainRequest({
        method: "GET",
        path,
        baseUrl,
        timeoutMs,
      });
      const rows = rankBootstrapRows(filterExpiredRows(extractPayloadRows(payload)), bootstrapThreadInfo)
        .slice(0, requestedLimit);
      return asToolResult(
        applyRowsToPayload(
          {
            ...payload,
            diagnostics: {
              ...(payload?.diagnostics && typeof payload.diagnostics === "object" ? payload.diagnostics : {}),
              bootstrapContextLoaded: hasBootstrapContext(),
            },
          },
          rows
        )
      );
    } catch (error) {
      return asToolError(error);
    }
  }
);

server.registerTool(
  "studio_brain_memory_stats",
  {
    title: "Studio Brain Memory Stats",
    description: "Fetch aggregate counts and source breakdowns for Studio Brain memory.",
    inputSchema: {
      baseUrl: z.string().url().optional(),
      timeoutMs: z.number().int().positive().max(60000).optional(),
    },
  },
  async ({ baseUrl, timeoutMs }) => {
    try {
      const payload = await studioBrainRequest({
        method: "GET",
        path: "/api/memory/stats",
        baseUrl,
        timeoutMs,
      });
      return asToolResult(payload);
    } catch (error) {
      return asToolError(error);
    }
  }
);

server.registerTool(
  "studio_brain_startup_context",
  {
    title: "Studio Brain Startup Context",
    description: "Return the bounded startup continuity context for a fresh thread before broad repo exploration.",
    inputSchema: {
      query: withOptionalString(z.string()),
      agentId: withOptionalString(z.string()),
      runId: withOptionalString(z.string()),
      maxItems: z.number().int().min(1).max(50).optional(),
      maxChars: z.number().int().min(128).max(20000).optional(),
      tenantId: withOptionalString(z.string()),
      baseUrl: z.string().url().optional(),
      timeoutMs: z.number().int().positive().max(60000).optional(),
    },
  },
  async ({ query, agentId, runId, maxItems, maxChars, tenantId, baseUrl, timeoutMs }) =>
    handleMemoryContextRequest({
      query,
      agentId,
      runId,
      maxItems,
      maxChars,
      tenantId,
      baseUrl,
      timeoutMs,
      allowDefaultQuery: true,
    })
);

server.registerTool(
  "studio_brain_memory_context",
  {
    title: "Studio Brain Memory Context",
    description: "Build a bounded context pack from Studio Brain memory for an agent or task.",
    inputSchema: {
      query: z.string().min(1),
      agentId: withOptionalString(z.string()),
      runId: withOptionalString(z.string()),
      maxItems: z.number().int().min(1).max(50).optional(),
      maxChars: z.number().int().min(128).max(20000).optional(),
      tenantId: withOptionalString(z.string()),
      baseUrl: z.string().url().optional(),
      timeoutMs: z.number().int().positive().max(60000).optional(),
    },
  },
  async ({ query, agentId, runId, maxItems, maxChars, tenantId, baseUrl, timeoutMs }) =>
    handleMemoryContextRequest({
      query,
      agentId,
      runId,
      maxItems,
      maxChars,
      tenantId,
      baseUrl,
      timeoutMs,
      allowDefaultQuery: false,
    })
);

server.registerTool(
  "studio_brain_loop_incidents",
  {
    title: "Studio Brain Loop Incidents",
    description: "List loop incidents ranked by escalation and blast radius from Studio Brain memory.",
    inputSchema: {
      tenantId: withOptionalString(z.string()),
      query: withOptionalString(z.string()),
      limit: z.number().int().min(1).max(100).optional(),
      states: withOptionalStringArray(),
      lanes: withOptionalStringArray(),
      loopKeys: withOptionalStringArray(),
      incidentMinEscalation: z.number().min(0).max(1).optional(),
      incidentMinBlastRadius: z.number().min(0).max(1).optional(),
      baseUrl: z.string().url().optional(),
      timeoutMs: z.number().int().positive().max(60000).optional(),
    },
  },
  async ({
    tenantId,
    query,
    limit,
    states,
    lanes,
    loopKeys,
    incidentMinEscalation,
    incidentMinBlastRadius,
    baseUrl,
    timeoutMs,
  }) => {
    try {
      const params = new URLSearchParams();
      if (tenantId) params.set("tenantId", tenantId);
      if (query) params.set("query", query);
      if (limit) params.set("limit", String(limit));
      if (states?.length) params.set("states", states.join(","));
      if (lanes?.length) params.set("lanes", lanes.join(","));
      if (loopKeys?.length) params.set("loopKeys", loopKeys.join(","));
      if (incidentMinEscalation !== undefined) params.set("incidentMinEscalation", String(incidentMinEscalation));
      if (incidentMinBlastRadius !== undefined) params.set("incidentMinBlastRadius", String(incidentMinBlastRadius));
      const path = `/api/memory/loops/incidents${params.size > 0 ? `?${params.toString()}` : ""}`;
      const payload = await studioBrainRequest({
        method: "GET",
        path,
        baseUrl,
        timeoutMs,
      });
      return asToolResult(payload);
    } catch (error) {
      return asToolError(error);
    }
  }
);

server.registerTool(
  "studio_brain_loop_action_plan",
  {
    title: "Studio Brain Loop Action Plan",
    description: "Build an action plan from loop incidents and owner queues.",
    inputSchema: {
      tenantId: withOptionalString(z.string()),
      query: withOptionalString(z.string()),
      limit: z.number().int().min(1).max(100).optional(),
      incidentLimit: z.number().int().min(1).max(100).optional(),
      maxActions: z.number().int().min(1).max(100).optional(),
      states: withOptionalStringArray(),
      lanes: withOptionalStringArray(),
      loopKeys: withOptionalStringArray(),
      incidentMinEscalation: z.number().min(0).max(1).optional(),
      incidentMinBlastRadius: z.number().min(0).max(1).optional(),
      baseUrl: z.string().url().optional(),
      timeoutMs: z.number().int().positive().max(60000).optional(),
    },
  },
  async ({
    tenantId,
    query,
    limit,
    incidentLimit,
    maxActions,
    states,
    lanes,
    loopKeys,
    incidentMinEscalation,
    incidentMinBlastRadius,
    baseUrl,
    timeoutMs,
  }) => {
    try {
      const params = new URLSearchParams();
      if (tenantId) params.set("tenantId", tenantId);
      if (query) params.set("query", query);
      if (limit) params.set("limit", String(limit));
      if (incidentLimit) params.set("incidentLimit", String(incidentLimit));
      if (maxActions) params.set("maxActions", String(maxActions));
      if (states?.length) params.set("states", states.join(","));
      if (lanes?.length) params.set("lanes", lanes.join(","));
      if (loopKeys?.length) params.set("loopKeys", loopKeys.join(","));
      if (incidentMinEscalation !== undefined) params.set("incidentMinEscalation", String(incidentMinEscalation));
      if (incidentMinBlastRadius !== undefined) params.set("incidentMinBlastRadius", String(incidentMinBlastRadius));
      const path = `/api/memory/loops/action-plan${params.size > 0 ? `?${params.toString()}` : ""}`;
      const payload = await studioBrainRequest({
        method: "GET",
        path,
        baseUrl,
        timeoutMs,
      });
      return asToolResult(payload);
    } catch (error) {
      return asToolError(error);
    }
  }
);

async function main() {
  if (!authorizationHeader) {
    const minted = await mintAuthorizationHeader().catch(() => "");
    if (minted) {
      authorizationHeader = minted;
    }
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
