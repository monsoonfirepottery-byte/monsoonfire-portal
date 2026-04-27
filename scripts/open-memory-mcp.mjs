#!/usr/bin/env node

import crypto from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { mintStaffIdTokenFromPortalEnv } from "./lib/firebase-auth-token.mjs";
import { loadCodexAutomationEnv } from "./lib/codex-automation-env.mjs";
import { resolvePortalCredentialsPath } from "./lib/studio-brain-startup-auth.mjs";
import { resolveStudioBrainBaseUrlFromEnv } from "./studio-brain-url-resolution.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
loadCodexAutomationEnv({ repoRoot: REPO_ROOT, env: process.env });
const baseUrl = resolveStudioBrainBaseUrlFromEnv({ env: process.env });

function normalizeBearer(value) {
  if (!value) return null;
  const token = String(value).trim();
  if (!token) return null;
  return /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

function isEnabled(value, fallback = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseIntValue(value, fallback = 2) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, parsed);
}

export function resolveMcpDefaultCredentialsPath({ repoRoot = REPO_ROOT, env = process.env } = {}) {
  return resolvePortalCredentialsPath(repoRoot, env) || resolve(repoRoot, "secrets", "portal", "portal-agent-staff.json");
}

let authorization = normalizeBearer(
  process.env.STUDIO_BRAIN_AUTH_TOKEN ?? process.env.STUDIO_BRAIN_ID_TOKEN ?? process.env.STUDIO_BRAIN_MCP_ID_TOKEN ?? ""
);
const adminToken = String(process.env.STUDIO_BRAIN_ADMIN_TOKEN ?? process.env.STUDIO_BRAIN_MCP_ADMIN_TOKEN ?? "").trim();
const ingestSecret = String(process.env.STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET ?? "").trim();
let lastIdTokenRefreshAtMs = 0;

async function mintStaffAuthorizationHeader() {
  const minted = await mintStaffIdTokenFromPortalEnv({
    env: process.env,
    defaultCredentialsPath: resolveMcpDefaultCredentialsPath(),
    preferRefreshToken: true,
  });
  if (!minted.ok || !minted.token) return null;
  return normalizeBearer(minted.token);
}

function isExpiredIdTokenResponse(status, payload) {
  if (status !== 401) return false;
  const message =
    typeof payload?.message === "string"
      ? payload.message
      : typeof payload?.error?.message === "string"
        ? payload.error.message
        : typeof payload?.raw === "string"
          ? payload.raw
          : "";
  return /id-token-expired|auth\/id-token-expired|token.*expired/i.test(message);
}

async function requestOnce(path, method = "GET", body = undefined) {
  if (!authorization) {
    authorization = await mintStaffAuthorizationHeader().catch(() => null);
  }
  const headers = { "content-type": "application/json" };
  if (authorization) headers.authorization = authorization;
  if (adminToken) headers["x-studio-brain-admin-token"] = adminToken;

  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to reach Studio Brain memory API at ${baseUrl}${path}: ${reason}`);
  }
  const raw = await response.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }

  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

async function request(path, method = "GET", body = undefined) {
  let result = await requestOnce(path, method, body);

  if (!result.ok && isExpiredIdTokenResponse(result.status, result.payload)) {
    const now = Date.now();
    if (now - lastIdTokenRefreshAtMs > 10_000) {
      lastIdTokenRefreshAtMs = now;
      const refreshedAuth = await mintStaffAuthorizationHeader().catch(() => null);
      if (refreshedAuth) {
        authorization = refreshedAuth;
        result = await requestOnce(path, method, body);
      }
    }
  }

  if (!result.ok) {
    const message = typeof result.payload?.message === "string" ? result.payload.message : `HTTP ${result.status}`;
    const hint =
      result.status === 404
        ? " Memory routes are not available on this Studio Brain instance."
        : "";
    throw new Error(`${message} (${result.status}) from ${baseUrl}${path}.${hint}`);
  }
  return result.payload;
}

const startupMemoryExpandDefault = isEnabled(process.env.CODEX_OPEN_MEMORY_EXPAND_RELATIONSHIPS, true);
const startupMemoryMaxHopsDefault = parseIntValue(process.env.CODEX_OPEN_MEMORY_MAX_HOPS, 2);
const startupMemoryFastPathDefault = isEnabled(process.env.CODEX_OPEN_MEMORY_STARTUP_FAST_PATH, true);
const startupMemoryFastMaxItemsDefault = Math.min(100, parseIntValue(process.env.CODEX_OPEN_MEMORY_STARTUP_FAST_MAX_ITEMS, 8));
const startupMemoryFastMaxCharsDefault = Math.min(
  100_000,
  Math.max(256, parseIntValue(process.env.CODEX_OPEN_MEMORY_STARTUP_FAST_MAX_CHARS, 6000))
);
const startupMemoryFastScanLimitDefault = Math.min(
  500,
  Math.max(1, parseIntValue(process.env.CODEX_OPEN_MEMORY_STARTUP_FAST_SCAN_LIMIT, 90))
);
const startupMemoryFastRetryMsDefault = Math.max(0, parseIntValue(process.env.CODEX_OPEN_MEMORY_STARTUP_FAST_RETRY_MS, 450));

async function requestIngest(body) {
  if (!ingestSecret) {
    throw new Error("STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET is required for ingest tool.");
  }
  const timestamp = Math.trunc(Date.now() / 1000);
  const rawBody = JSON.stringify(body);
  const signature = crypto.createHmac("sha256", ingestSecret).update(`${timestamp}.${rawBody}`).digest("hex");
  let response;
  try {
    response = await fetch(`${baseUrl}/api/memory/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-memory-ingest-timestamp": `${timestamp}`,
        "x-memory-ingest-signature": `v1=${signature}`,
      },
      body: rawBody,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to reach Studio Brain memory ingest API at ${baseUrl}/api/memory/ingest: ${reason}`);
  }
  const raw = await response.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }
  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : `HTTP ${response.status}`;
    const hint =
      response.status === 404
        ? " Memory ingest route is not available on this Studio Brain instance."
        : "";
    throw new Error(`${message} (${response.status}) from ${baseUrl}/api/memory/ingest.${hint}`);
  }
  return payload;
}

function asToolResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
  };
}

function extractRows(payload) {
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

function extractMemoryId(row) {
  if (!row || typeof row !== "object") return "";
  const id = row.id ?? row.memoryId ?? row.memory_id ?? row._id;
  return String(id ?? "").trim();
}

function summarizeRow(row, maxChars = 180) {
  if (!row || typeof row !== "object") return "";
  const text = String(row.summary ?? row.content ?? row.text ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function normalizeRelatedEntry(entry) {
  if (!entry) return null;
  if (typeof entry === "string") {
    const id = String(entry).trim();
    return id ? { id } : null;
  }
  if (typeof entry !== "object") return null;
  const id = extractMemoryId(entry);
  const summary = summarizeRow(entry, 180);
  const scoreRaw = Number(entry.score ?? entry.relevanceScore ?? entry.relevance ?? NaN);
  const score = Number.isFinite(scoreRaw) ? scoreRaw : undefined;
  if (!id && !summary) return null;
  return {
    ...(id ? { id } : {}),
    ...(summary ? { summary } : {}),
    ...(score !== undefined ? { score } : {}),
  };
}

function dedupeRelatedEntries(entries, excludeId = "") {
  const out = [];
  const seen = new Set();
  const skip = String(excludeId || "").trim();
  for (const entry of entries) {
    const normalized = normalizeRelatedEntry(entry);
    if (!normalized) continue;
    const key = String(normalized.id || normalized.summary || "").trim();
    if (!key) continue;
    if (skip && normalized.id === skip) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function buildContextRelationshipPreview(payload, seedId) {
  const relatedFromPayload = Array.isArray(payload?.related) ? payload.related : [];
  const rows = extractRows(payload).filter((row) => extractMemoryId(row) !== seedId);
  const related = dedupeRelatedEntries([...relatedFromPayload, ...rows], seedId);
  const edgeSummary =
    payload?.edgeSummary && typeof payload.edgeSummary === "object"
      ? payload.edgeSummary
      : {
          relatedCount: related.length,
          sampleCount: rows.length,
        };
  return {
    related,
    edgeSummary,
  };
}

function buildEdgeSummaryFromPreviewRows(previewRows) {
  const okRows = previewRows.filter((row) => row && !row.error);
  const relatedCount = okRows.reduce((sum, row) => sum + Number(row.related?.length || 0), 0);
  return {
    previewRows: previewRows.length,
    previewRowsOk: okRows.length,
    previewRowsErrored: previewRows.length - okRows.length,
    relatedCount,
  };
}

const server = new McpServer({
  name: "open-memory",
  version: "1.0.0",
});

server.registerTool(
  "capture_thought",
  {
    description: "Capture a memory item into the Open Memory store.",
    inputSchema: {
      content: z.string().min(1).max(20_000),
      source: z.string().min(1).max(128).optional(),
      tenantId: z.string().min(1).max(128).nullable().optional(),
      agentId: z.string().min(1).max(128).optional(),
      runId: z.string().min(1).max(128).optional(),
      tags: z.array(z.string().min(1).max(64)).max(32).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      clientRequestId: z.string().min(1).max(128).optional(),
      occurredAt: z.string().optional(),
      status: z.enum(["proposed", "accepted", "quarantined", "archived"]).optional(),
      memoryType: z.enum(["working", "episodic", "semantic", "procedural"]).optional(),
      sourceConfidence: z.number().min(0).max(1).optional(),
      importance: z.number().min(0).max(1).optional(),
    },
  },
  async (input) => {
    const payload = await request("/api/memory/capture", "POST", {
      content: input.content,
      source: input.source ?? "mcp",
      tenantId: input.tenantId,
      agentId: input.agentId,
      runId: input.runId,
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
      clientRequestId: input.clientRequestId,
      occurredAt: input.occurredAt,
      status: input.status,
      memoryType: input.memoryType,
      sourceConfidence: input.sourceConfidence,
      importance: input.importance,
    });
    return asToolResult(payload);
  }
);

server.registerTool(
  "startup_memory_context",
  {
    description:
      "Return a bounded startup context pack so agents only load relevant memories and preserve context window budget.",
    inputSchema: {
      tenantId: z.string().min(1).max(128).nullable().optional(),
      agentId: z.string().min(1).max(128).optional(),
      runId: z.string().min(1).max(128).optional(),
      seedMemoryId: z.string().min(1).max(128).optional(),
      query: z.string().min(1).max(4096).optional(),
      sourceAllowlist: z.array(z.string().min(1).max(128)).max(64).optional(),
      sourceDenylist: z.array(z.string().min(1).max(128)).max(64).optional(),
      retrievalMode: z.enum(["hybrid", "semantic", "lexical"]).optional(),
      queryLane: z.enum(["interactive", "ops", "bulk"]).optional(),
      fastPath: z.boolean().optional(),
      temporalAnchorAt: z.string().optional(),
      explain: z.boolean().optional(),
      maxItems: z.number().int().min(1).max(100).optional(),
      maxChars: z.number().int().min(256).max(100_000).optional(),
      scanLimit: z.number().int().min(1).max(500).optional(),
      includeTenantFallback: z.boolean().optional(),
      expandRelationships: z.boolean().optional(),
      maxHops: z.number().int().min(1).max(4).optional(),
    },
  },
  async (input) => {
    const fastPath = input.fastPath ?? startupMemoryFastPathDefault;
    const hasExplicitBudget =
      input.maxItems !== undefined ||
      input.maxChars !== undefined ||
      input.scanLimit !== undefined ||
      input.retrievalMode !== undefined ||
      input.includeTenantFallback !== undefined;
    const primaryBody = {
      tenantId: input.tenantId,
      agentId: input.agentId,
      runId: input.runId,
      seedMemoryId: input.seedMemoryId,
      query: input.query,
      sourceAllowlist: input.sourceAllowlist ?? [],
      sourceDenylist: input.sourceDenylist ?? [],
      retrievalMode: input.retrievalMode ?? (fastPath ? "lexical" : "hybrid"),
      queryLane: input.queryLane ?? "interactive",
      temporalAnchorAt: input.temporalAnchorAt,
      explain: input.explain ?? false,
      maxItems: input.maxItems ?? (fastPath ? startupMemoryFastMaxItemsDefault : 12),
      maxChars: input.maxChars ?? (fastPath ? startupMemoryFastMaxCharsDefault : 8000),
      scanLimit: input.scanLimit ?? (fastPath ? startupMemoryFastScanLimitDefault : 200),
      includeTenantFallback: input.includeTenantFallback ?? (fastPath ? true : false),
      expandRelationships: input.expandRelationships ?? startupMemoryExpandDefault,
      maxHops: input.maxHops ?? startupMemoryMaxHopsDefault,
    };
    let payload;
    try {
      payload = await request("/api/memory/context", "POST", primaryBody);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /\(503\)/.test(message) || /query-shed|deferred/i.test(message);
      if (!fastPath || hasExplicitBudget || !retryable) {
        throw error;
      }
      if (startupMemoryFastRetryMsDefault > 0) {
        await new Promise((resolveSleep) => setTimeout(resolveSleep, startupMemoryFastRetryMsDefault));
      }
      payload = await request("/api/memory/context", "POST", {
        ...primaryBody,
        retrievalMode: "lexical",
        queryLane: "interactive",
        includeTenantFallback: true,
        maxItems: Math.max(4, Math.min(startupMemoryFastMaxItemsDefault, Number(primaryBody.maxItems ?? 8))),
        maxChars: Math.max(1024, Math.min(startupMemoryFastMaxCharsDefault, Number(primaryBody.maxChars ?? 6000))),
        scanLimit: Math.max(24, Math.min(startupMemoryFastScanLimitDefault, Number(primaryBody.scanLimit ?? 90))),
      });
      if (payload && typeof payload === "object") {
        payload.startupFastPathRetry = {
          attempted: true,
          reason: "initial-request-deferred",
        };
      }
    }
    return asToolResult(payload);
  }
);

server.registerTool(
  "capture_thought_ingest",
  {
    description:
      "Capture a memory item using signed ingest (HMAC), useful for Discord/bot-style pipelines without Firebase auth.",
    inputSchema: {
      content: z.string().min(1).max(20_000),
      source: z.string().min(1).max(128).optional(),
      tenantId: z.string().min(1).max(128).nullable().optional(),
      tags: z.array(z.string().min(1).max(64)).max(32).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      clientRequestId: z.string().min(1).max(128).optional(),
      occurredAt: z.string().optional(),
    },
  },
  async (input) => {
    const payload = await requestIngest({
      content: input.content,
      source: input.source ?? "mcp",
      tenantId: input.tenantId,
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
      clientRequestId: input.clientRequestId ?? `mcp-${Date.now()}`,
      occurredAt: input.occurredAt,
    });
    return asToolResult(payload);
  }
);

server.registerTool(
  "search_memory",
  {
    description: "Search stored memories by semantic or lexical relevance.",
    inputSchema: {
      query: z.string().min(1).max(4096),
      limit: z.number().int().min(1).max(100).optional(),
      tenantId: z.string().min(1).max(128).nullable().optional(),
      agentId: z.string().min(1).max(128).optional(),
      runId: z.string().min(1).max(128).optional(),
      sourceAllowlist: z.array(z.string().min(1).max(128)).max(64).optional(),
      sourceDenylist: z.array(z.string().min(1).max(128)).max(64).optional(),
      retrievalMode: z.enum(["hybrid", "semantic", "lexical"]).optional(),
      queryLane: z.enum(["interactive", "ops", "bulk"]).optional(),
      minScore: z.number().min(0).max(2).optional(),
      explain: z.boolean().optional(),
      expandRelationships: z.boolean().optional(),
      maxHops: z.number().int().min(1).max(4).optional(),
      relationshipPreviewLimit: z.number().int().min(0).max(20).optional(),
      relationshipPreviewMaxItems: z.number().int().min(1).max(100).optional(),
      relationshipPreviewMaxChars: z.number().int().min(256).max(100_000).optional(),
      relationshipPreviewScanLimit: z.number().int().min(1).max(500).optional(),
    },
  },
  async (input) => {
    const payload = await request("/api/memory/search", "POST", {
      query: input.query,
      limit: input.limit ?? 10,
      tenantId: input.tenantId,
      agentId: input.agentId,
      runId: input.runId,
      sourceAllowlist: input.sourceAllowlist ?? [],
      sourceDenylist: input.sourceDenylist ?? [],
      retrievalMode: input.retrievalMode ?? "hybrid",
      queryLane: input.queryLane ?? "interactive",
      minScore: input.minScore,
      explain: input.explain ?? false,
    });

    const expandRelationships = input.expandRelationships ?? false;
    const previewLimit = Math.max(0, input.relationshipPreviewLimit ?? 3);
    const previewMaxItems = Math.max(1, input.relationshipPreviewMaxItems ?? 16);
    const previewMaxChars = Math.max(256, input.relationshipPreviewMaxChars ?? 10_000);
    const previewScanLimit = Math.max(1, input.relationshipPreviewScanLimit ?? 220);
    const maxHops = Math.max(1, input.maxHops ?? startupMemoryMaxHopsDefault);

    if (expandRelationships && previewLimit > 0) {
      const seedRows = extractRows(payload)
        .map((row) => ({ id: extractMemoryId(row), row }))
        .filter((entry) => Boolean(entry.id))
        .slice(0, previewLimit);

      const previewRows = await Promise.all(
        seedRows.map(async (entry) => {
          try {
            const contextPayload = await request("/api/memory/context", "POST", {
              tenantId: input.tenantId,
              agentId: input.agentId,
              runId: input.runId,
              seedMemoryId: entry.id,
              query: input.query,
              sourceAllowlist: input.sourceAllowlist ?? [],
              sourceDenylist: input.sourceDenylist ?? [],
              retrievalMode: input.retrievalMode ?? "hybrid",
              queryLane: "ops",
              explain: input.explain ?? false,
              maxItems: previewMaxItems,
              maxChars: previewMaxChars,
              scanLimit: previewScanLimit,
              includeTenantFallback: false,
              expandRelationships: true,
              maxHops,
            });
            const preview = buildContextRelationshipPreview(contextPayload, entry.id);
            return {
              memoryId: entry.id,
              score: Number(entry.row?.score ?? entry.row?.relevanceScore ?? NaN),
              summary: summarizeRow(entry.row, 180),
              related: preview.related,
              edgeSummary: preview.edgeSummary,
            };
          } catch (error) {
            return {
              memoryId: entry.id,
              score: Number(entry.row?.score ?? entry.row?.relevanceScore ?? NaN),
              summary: summarizeRow(entry.row, 180),
              related: [],
              edgeSummary: { relatedCount: 0 },
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })
      );

      const aggregateRelated = dedupeRelatedEntries(
        previewRows.flatMap((row) => (Array.isArray(row.related) ? row.related : []))
      );
      payload.relationshipPreview = {
        enabled: true,
        maxHops,
        rows: previewRows,
      };
      payload.related = aggregateRelated;
      payload.edgeSummary = {
        ...buildEdgeSummaryFromPreviewRows(previewRows),
        maxHops,
      };
    }

    return asToolResult(payload);
  }
);

server.registerTool(
  "memory_neighborhood",
  {
    description:
      "Return ranked relationship neighborhood for a memory item id using bounded hops/nodes.",
    inputSchema: {
      memoryId: z.string().min(1).max(128),
      tenantId: z.string().min(1).max(128).nullable().optional(),
      agentId: z.string().min(1).max(128).optional(),
      runId: z.string().min(1).max(128).optional(),
      query: z.string().min(1).max(4096).optional(),
      sourceAllowlist: z.array(z.string().min(1).max(128)).max(64).optional(),
      sourceDenylist: z.array(z.string().min(1).max(128)).max(64).optional(),
      retrievalMode: z.enum(["hybrid", "semantic", "lexical"]).optional(),
      queryLane: z.enum(["interactive", "ops", "bulk"]).optional(),
      maxItems: z.number().int().min(1).max(100).optional(),
      maxChars: z.number().int().min(256).max(100_000).optional(),
      scanLimit: z.number().int().min(1).max(500).optional(),
      maxHops: z.number().int().min(1).max(4).optional(),
      explain: z.boolean().optional(),
    },
  },
  async (input) => {
    const payload = await request("/api/memory/context", "POST", {
      tenantId: input.tenantId,
      agentId: input.agentId,
      runId: input.runId,
      seedMemoryId: input.memoryId,
      query: input.query,
      sourceAllowlist: input.sourceAllowlist ?? [],
      sourceDenylist: input.sourceDenylist ?? [],
      retrievalMode: input.retrievalMode ?? "hybrid",
      queryLane: input.queryLane ?? "interactive",
      explain: input.explain ?? false,
      maxItems: input.maxItems ?? 20,
      maxChars: input.maxChars ?? 10_000,
      scanLimit: input.scanLimit ?? 250,
      includeTenantFallback: false,
      expandRelationships: true,
      maxHops: input.maxHops ?? startupMemoryMaxHopsDefault,
    });
    return asToolResult(payload);
  }
);

server.registerTool(
  "relationship_diagnostics",
  {
    description:
      "Run relationship expansion diagnostics for a query and return edge/neighbor explain data.",
    inputSchema: {
      query: z.string().min(1).max(4096),
      tenantId: z.string().min(1).max(128).nullable().optional(),
      agentId: z.string().min(1).max(128).optional(),
      runId: z.string().min(1).max(128).optional(),
      sourceAllowlist: z.array(z.string().min(1).max(128)).max(64).optional(),
      sourceDenylist: z.array(z.string().min(1).max(128)).max(64).optional(),
      retrievalMode: z.enum(["hybrid", "semantic", "lexical"]).optional(),
      queryLane: z.enum(["interactive", "ops", "bulk"]).optional(),
      maxItems: z.number().int().min(1).max(100).optional(),
      maxChars: z.number().int().min(256).max(100_000).optional(),
      scanLimit: z.number().int().min(1).max(500).optional(),
      maxHops: z.number().int().min(1).max(4).optional(),
    },
  },
  async (input) => {
    const payload = await request("/api/memory/context", "POST", {
      tenantId: input.tenantId,
      agentId: input.agentId,
      runId: input.runId,
      query: input.query,
      sourceAllowlist: input.sourceAllowlist ?? [],
      sourceDenylist: input.sourceDenylist ?? [],
      retrievalMode: input.retrievalMode ?? "hybrid",
      queryLane: input.queryLane ?? "ops",
      explain: true,
      maxItems: input.maxItems ?? 20,
      maxChars: input.maxChars ?? 10_000,
      scanLimit: input.scanLimit ?? 250,
      includeTenantFallback: false,
      expandRelationships: true,
      maxHops: input.maxHops ?? startupMemoryMaxHopsDefault,
    });
    return asToolResult(payload);
  }
);

server.registerTool(
  "list_recent_memories",
  {
    description: "List recently captured memories.",
    inputSchema: {
      limit: z.number().int().min(1).max(200).optional(),
      tenantId: z.string().min(1).max(128).nullable().optional(),
    },
  },
  async (input) => {
    const query = new URLSearchParams();
    query.set("limit", String(input.limit ?? 20));
    if (typeof input.tenantId === "string" && input.tenantId.trim().length > 0) {
      query.set("tenantId", input.tenantId.trim());
    }
    const payload = await request(`/api/memory/recent?${query.toString()}`, "GET");
    return asToolResult(payload);
  }
);

server.registerTool(
  "memory_stats",
  {
    description: "Get memory store totals and source distribution stats.",
    inputSchema: {
      tenantId: z.string().min(1).max(128).nullable().optional(),
    },
  },
  async (input) => {
    const query = new URLSearchParams();
    if (typeof input.tenantId === "string" && input.tenantId.trim().length > 0) {
      query.set("tenantId", input.tenantId.trim());
    }
    const suffix = query.toString();
    const payload = await request(`/api/memory/stats${suffix ? `?${suffix}` : ""}`, "GET");
    return asToolResult(payload);
  }
);

server.registerTool(
  "search_loop_state",
  {
    description:
      "Query loop-state lanes (open/resolved/reopened/superseded) and return attention-ranked loop clusters with pointer memories.",
    inputSchema: {
      tenantId: z.string().min(1).max(128).nullable().optional(),
      limit: z.number().int().min(1).max(200).optional(),
      query: z.string().min(1).max(4096).optional(),
      sortBy: z
        .enum(["attention", "updatedAt", "confidence", "volatility", "anomaly", "centrality", "escalation", "blastRadius"])
        .optional(),
      includeMemory: z.boolean().optional(),
      includeIncidents: z.boolean().optional(),
      minAttention: z.number().min(0).max(2).optional(),
      minVolatility: z.number().min(0).max(1).optional(),
      minAnomaly: z.number().min(0).max(1).optional(),
      minCentrality: z.number().min(0).max(1).optional(),
      minEscalation: z.number().min(0).max(2).optional(),
      minBlastRadius: z.number().min(0).max(1).optional(),
      incidentLimit: z.number().int().min(1).max(50).optional(),
      incidentMinEscalation: z.number().min(0).max(2).optional(),
      incidentMinBlastRadius: z.number().min(0).max(1).optional(),
      lanes: z.array(z.enum(["critical", "high", "watch", "stable"])).max(4).optional(),
      states: z.array(z.enum(["open-loop", "resolved", "reopened", "superseded"])).max(4).optional(),
      loopKeys: z.array(z.string().min(1).max(180)).max(100).optional(),
    },
  },
  async (input) => {
    const query = new URLSearchParams();
    query.set("limit", String(input.limit ?? 30));
    if (typeof input.tenantId === "string" && input.tenantId.trim().length > 0) {
      query.set("tenantId", input.tenantId.trim());
    }
    if (typeof input.query === "string" && input.query.trim().length > 0) {
      query.set("query", input.query.trim());
    }
    if (input.sortBy) {
      query.set("sortBy", input.sortBy);
    }
    if (input.includeMemory !== undefined) {
      query.set("includeMemory", input.includeMemory ? "true" : "false");
    }
    if (input.includeIncidents !== undefined) {
      query.set("includeIncidents", input.includeIncidents ? "true" : "false");
    }
    if (typeof input.minAttention === "number" && Number.isFinite(input.minAttention)) {
      query.set("minAttention", String(input.minAttention));
    }
    if (typeof input.minVolatility === "number" && Number.isFinite(input.minVolatility)) {
      query.set("minVolatility", String(input.minVolatility));
    }
    if (typeof input.minAnomaly === "number" && Number.isFinite(input.minAnomaly)) {
      query.set("minAnomaly", String(input.minAnomaly));
    }
    if (typeof input.minCentrality === "number" && Number.isFinite(input.minCentrality)) {
      query.set("minCentrality", String(input.minCentrality));
    }
    if (typeof input.minEscalation === "number" && Number.isFinite(input.minEscalation)) {
      query.set("minEscalation", String(input.minEscalation));
    }
    if (typeof input.minBlastRadius === "number" && Number.isFinite(input.minBlastRadius)) {
      query.set("minBlastRadius", String(input.minBlastRadius));
    }
    if (typeof input.incidentLimit === "number" && Number.isFinite(input.incidentLimit)) {
      query.set("incidentLimit", String(input.incidentLimit));
    }
    if (typeof input.incidentMinEscalation === "number" && Number.isFinite(input.incidentMinEscalation)) {
      query.set("incidentMinEscalation", String(input.incidentMinEscalation));
    }
    if (typeof input.incidentMinBlastRadius === "number" && Number.isFinite(input.incidentMinBlastRadius)) {
      query.set("incidentMinBlastRadius", String(input.incidentMinBlastRadius));
    }
    if (Array.isArray(input.lanes) && input.lanes.length > 0) {
      query.set("lanes", input.lanes.join(","));
    }
    if (Array.isArray(input.states) && input.states.length > 0) {
      query.set("states", input.states.join(","));
    }
    if (Array.isArray(input.loopKeys) && input.loopKeys.length > 0) {
      query.set("loopKeys", input.loopKeys.join(","));
    }
    const payload = await request(`/api/memory/loops?${query.toString()}`, "GET");
    return asToolResult(payload);
  }
);

server.registerTool(
  "loop_incident_packets",
  {
    description:
      "Generate high-signal loop incident packets with suggested owner, blast radius, and recommended actions.",
    inputSchema: {
      tenantId: z.string().min(1).max(128).nullable().optional(),
      limit: z.number().int().min(1).max(50).optional(),
      query: z.string().min(1).max(4096).optional(),
      states: z.array(z.enum(["open-loop", "resolved", "reopened", "superseded"])).max(4).optional(),
      lanes: z.array(z.enum(["critical", "high", "watch", "stable"])).max(4).optional(),
      loopKeys: z.array(z.string().min(1).max(180)).max(100).optional(),
      incidentMinEscalation: z.number().min(0).max(2).optional(),
      incidentMinBlastRadius: z.number().min(0).max(1).optional(),
    },
  },
  async (input) => {
    const query = new URLSearchParams();
    query.set("limit", String(input.limit ?? 12));
    if (typeof input.tenantId === "string" && input.tenantId.trim().length > 0) {
      query.set("tenantId", input.tenantId.trim());
    }
    if (typeof input.query === "string" && input.query.trim().length > 0) {
      query.set("query", input.query.trim());
    }
    if (Array.isArray(input.states) && input.states.length > 0) {
      query.set("states", input.states.join(","));
    }
    if (Array.isArray(input.lanes) && input.lanes.length > 0) {
      query.set("lanes", input.lanes.join(","));
    }
    if (Array.isArray(input.loopKeys) && input.loopKeys.length > 0) {
      query.set("loopKeys", input.loopKeys.join(","));
    }
    if (typeof input.incidentMinEscalation === "number" && Number.isFinite(input.incidentMinEscalation)) {
      query.set("incidentMinEscalation", String(input.incidentMinEscalation));
    }
    if (typeof input.incidentMinBlastRadius === "number" && Number.isFinite(input.incidentMinBlastRadius)) {
      query.set("incidentMinBlastRadius", String(input.incidentMinBlastRadius));
    }
    const payload = await request(`/api/memory/loops/incidents?${query.toString()}`, "GET");
    return asToolResult(payload);
  }
);

server.registerTool(
  "record_loop_incident_action",
  {
    description: "Record incident lifecycle action (ack/assign/snooze/resolve/false-positive/escalate) for a loop.",
    inputSchema: {
      tenantId: z.string().min(1).max(128).nullable().optional(),
      loopKey: z.string().min(1).max(180),
      action: z.enum(["ack", "assign", "snooze", "resolve", "false-positive", "escalate"]),
      incidentId: z.string().min(1).max(160).optional(),
      memoryId: z.string().min(1).max(128).optional(),
      idempotencyKey: z.string().min(1).max(180).optional(),
      actorId: z.string().min(1).max(160).optional(),
      note: z.string().min(1).max(4000).optional(),
      occurredAt: z.string().datetime().optional(),
    },
  },
  async (input) => {
    const payload = await request("/api/memory/loops/incident-action", "POST", {
      tenantId: input.tenantId,
      loopKey: input.loopKey,
      action: input.action,
      incidentId: input.incidentId,
      memoryId: input.memoryId,
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      note: input.note,
      occurredAt: input.occurredAt,
    });
    return asToolResult(payload);
  }
);

server.registerTool(
  "record_loop_incident_action_batch",
  {
    description: "Record many loop incident lifecycle actions in one request.",
    inputSchema: {
      tenantId: z.string().min(1).max(128).nullable().optional(),
      actorId: z.string().min(1).max(160).optional(),
      idempotencyPrefix: z.string().min(1).max(120).optional(),
      continueOnError: z.boolean().optional(),
      actions: z
        .array(
          z.object({
            tenantId: z.string().min(1).max(128).nullable().optional(),
            loopKey: z.string().min(1).max(180),
            action: z.enum(["ack", "assign", "snooze", "resolve", "false-positive", "escalate"]),
            incidentId: z.string().min(1).max(160).optional(),
            memoryId: z.string().min(1).max(128).optional(),
            idempotencyKey: z.string().min(1).max(180).optional(),
            actorId: z.string().min(1).max(160).optional(),
            note: z.string().min(1).max(4000).optional(),
            occurredAt: z.string().datetime().optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
          })
        )
        .min(1)
        .max(200),
    },
  },
  async (input) => {
    const payload = await request("/api/memory/loops/incident-action/batch", "POST", {
      tenantId: input.tenantId,
      actorId: input.actorId,
      idempotencyPrefix: input.idempotencyPrefix,
      continueOnError: input.continueOnError ?? true,
      actions: input.actions,
    });
    return asToolResult(payload);
  }
);

server.registerTool(
  "loop_feedback_stats",
  {
    description: "Return loop feedback/outcome statistics used for self-tuning.",
    inputSchema: {
      tenantId: z.string().min(1).max(128).nullable().optional(),
      loopKeys: z.array(z.string().min(1).max(180)).max(220).optional(),
      limit: z.number().int().min(1).max(500).optional(),
      windowDays: z.number().int().min(1).max(3650).optional(),
    },
  },
  async (input) => {
    const query = new URLSearchParams();
    query.set("limit", String(input.limit ?? 120));
    query.set("windowDays", String(input.windowDays ?? 180));
    if (typeof input.tenantId === "string" && input.tenantId.trim().length > 0) {
      query.set("tenantId", input.tenantId.trim());
    }
    if (Array.isArray(input.loopKeys) && input.loopKeys.length > 0) {
      query.set("loopKeys", input.loopKeys.join(","));
    }
    const payload = await request(`/api/memory/loops/feedback-stats?${query.toString()}`, "GET");
    return asToolResult(payload);
  }
);

server.registerTool(
  "loop_owner_queues",
  {
    description: "Return owner-centric incident queues with SLA risk rollups.",
    inputSchema: {
      tenantId: z.string().min(1).max(128).nullable().optional(),
      query: z.string().min(1).max(4096).optional(),
      states: z.array(z.enum(["open-loop", "resolved", "reopened", "superseded"])).max(4).optional(),
      lanes: z.array(z.enum(["critical", "high", "watch", "stable"])).max(4).optional(),
      loopKeys: z.array(z.string().min(1).max(180)).max(100).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      incidentLimit: z.number().int().min(1).max(50).optional(),
      incidentMinEscalation: z.number().min(0).max(2).optional(),
      incidentMinBlastRadius: z.number().min(0).max(1).optional(),
    },
  },
  async (input) => {
    const query = new URLSearchParams();
    query.set("limit", String(input.limit ?? 50));
    query.set("incidentLimit", String(input.incidentLimit ?? 20));
    if (typeof input.tenantId === "string" && input.tenantId.trim().length > 0) {
      query.set("tenantId", input.tenantId.trim());
    }
    if (typeof input.query === "string" && input.query.trim().length > 0) {
      query.set("query", input.query.trim());
    }
    if (Array.isArray(input.states) && input.states.length > 0) {
      query.set("states", input.states.join(","));
    }
    if (Array.isArray(input.lanes) && input.lanes.length > 0) {
      query.set("lanes", input.lanes.join(","));
    }
    if (Array.isArray(input.loopKeys) && input.loopKeys.length > 0) {
      query.set("loopKeys", input.loopKeys.join(","));
    }
    if (typeof input.incidentMinEscalation === "number" && Number.isFinite(input.incidentMinEscalation)) {
      query.set("incidentMinEscalation", String(input.incidentMinEscalation));
    }
    if (typeof input.incidentMinBlastRadius === "number" && Number.isFinite(input.incidentMinBlastRadius)) {
      query.set("incidentMinBlastRadius", String(input.incidentMinBlastRadius));
    }
    const payload = await request(`/api/memory/loops/owner-queues?${query.toString()}`, "GET");
    return asToolResult(payload);
  }
);

server.registerTool(
  "generate_loop_action_plan",
  {
    description: "Generate prioritized batch action plan from owner queues, SLA risk, and incident lanes.",
    inputSchema: {
      tenantId: z.string().min(1).max(128).nullable().optional(),
      query: z.string().min(1).max(4096).optional(),
      states: z.array(z.enum(["open-loop", "resolved", "reopened", "superseded"])).max(4).optional(),
      lanes: z.array(z.enum(["critical", "high", "watch", "stable"])).max(4).optional(),
      loopKeys: z.array(z.string().min(1).max(180)).max(100).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      incidentLimit: z.number().int().min(1).max(80).optional(),
      incidentMinEscalation: z.number().min(0).max(2).optional(),
      incidentMinBlastRadius: z.number().min(0).max(1).optional(),
      maxActions: z.number().int().min(1).max(200).optional(),
      includeBatchPayload: z.boolean().optional(),
    },
  },
  async (input) => {
    const query = new URLSearchParams();
    query.set("limit", String(input.limit ?? 50));
    query.set("incidentLimit", String(input.incidentLimit ?? 30));
    query.set("maxActions", String(input.maxActions ?? 40));
    if (typeof input.includeBatchPayload === "boolean") {
      query.set("includeBatchPayload", input.includeBatchPayload ? "true" : "false");
    }
    if (typeof input.tenantId === "string" && input.tenantId.trim().length > 0) {
      query.set("tenantId", input.tenantId.trim());
    }
    if (typeof input.query === "string" && input.query.trim().length > 0) {
      query.set("query", input.query.trim());
    }
    if (Array.isArray(input.states) && input.states.length > 0) {
      query.set("states", input.states.join(","));
    }
    if (Array.isArray(input.lanes) && input.lanes.length > 0) {
      query.set("lanes", input.lanes.join(","));
    }
    if (Array.isArray(input.loopKeys) && input.loopKeys.length > 0) {
      query.set("loopKeys", input.loopKeys.join(","));
    }
    if (typeof input.incidentMinEscalation === "number" && Number.isFinite(input.incidentMinEscalation)) {
      query.set("incidentMinEscalation", String(input.incidentMinEscalation));
    }
    if (typeof input.incidentMinBlastRadius === "number" && Number.isFinite(input.incidentMinBlastRadius)) {
      query.set("incidentMinBlastRadius", String(input.incidentMinBlastRadius));
    }
    const payload = await request(`/api/memory/loops/action-plan?${query.toString()}`, "GET");
    return asToolResult(payload);
  }
);

server.registerTool(
  "run_loop_automation_tick",
  {
    description: "Run digest + action-plan tick; optionally auto-apply batch actions.",
    inputSchema: {
      tenantId: z.string().min(1).max(128).nullable().optional(),
      query: z.string().min(1).max(4096).optional(),
      states: z.array(z.enum(["open-loop", "resolved", "reopened", "superseded"])).max(4).optional(),
      lanes: z.array(z.enum(["critical", "high", "watch", "stable"])).max(4).optional(),
      loopKeys: z.array(z.string().min(1).max(180)).max(100).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      incidentLimit: z.number().int().min(1).max(80).optional(),
      maxActions: z.number().int().min(1).max(200).optional(),
      incidentMinEscalation: z.number().min(0).max(2).optional(),
      incidentMinBlastRadius: z.number().min(0).max(1).optional(),
      dispatch: z.boolean().optional(),
      webhookUrl: z.string().url().optional(),
      applyActions: z.boolean().optional(),
      actorId: z.string().min(1).max(160).optional(),
      idempotencyKey: z.string().min(1).max(180).optional(),
      applyPriorities: z.array(z.enum(["p0", "p1", "p2", "p3"])).max(4).optional(),
      allowedActions: z.array(z.enum(["ack", "assign", "snooze", "resolve", "false-positive", "escalate"])).max(6).optional(),
    },
  },
  async (input) => {
    const payload = await request("/api/memory/loops/automation-tick", "POST", {
      tenantId: input.tenantId,
      query: input.query,
      states: input.states ?? [],
      lanes: input.lanes ?? [],
      loopKeys: input.loopKeys ?? [],
      limit: input.limit ?? 50,
      incidentLimit: input.incidentLimit ?? 30,
      maxActions: input.maxActions ?? 30,
      incidentMinEscalation: input.incidentMinEscalation,
      incidentMinBlastRadius: input.incidentMinBlastRadius,
      applyActions: input.applyActions ?? false,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey,
      applyPriorities: input.applyPriorities,
      allowedActions: input.allowedActions,
      includeBatchPayload: true,
      dispatch: input.dispatch ?? false,
      webhookUrl: input.webhookUrl,
    });
    return asToolResult(payload);
  }
);

server.registerTool(
  "generate_loop_digest",
  {
    description: "Generate digest for top loop incidents, with optional webhook dispatch.",
    inputSchema: {
      tenantId: z.string().min(1).max(128).nullable().optional(),
      limit: z.number().int().min(1).max(50).optional(),
      query: z.string().min(1).max(4096).optional(),
      states: z.array(z.enum(["open-loop", "resolved", "reopened", "superseded"])).max(4).optional(),
      lanes: z.array(z.enum(["critical", "high", "watch", "stable"])).max(4).optional(),
      loopKeys: z.array(z.string().min(1).max(180)).max(100).optional(),
      incidentMinEscalation: z.number().min(0).max(2).optional(),
      incidentMinBlastRadius: z.number().min(0).max(1).optional(),
      dispatch: z.boolean().optional(),
      webhookUrl: z.string().url().optional(),
    },
  },
  async (input) => {
    const query = new URLSearchParams();
    query.set("limit", String(input.limit ?? 12));
    if (typeof input.tenantId === "string" && input.tenantId.trim().length > 0) {
      query.set("tenantId", input.tenantId.trim());
    }
    if (typeof input.query === "string" && input.query.trim().length > 0) {
      query.set("query", input.query.trim());
    }
    if (Array.isArray(input.states) && input.states.length > 0) {
      query.set("states", input.states.join(","));
    }
    if (Array.isArray(input.lanes) && input.lanes.length > 0) {
      query.set("lanes", input.lanes.join(","));
    }
    if (Array.isArray(input.loopKeys) && input.loopKeys.length > 0) {
      query.set("loopKeys", input.loopKeys.join(","));
    }
    if (typeof input.incidentMinEscalation === "number" && Number.isFinite(input.incidentMinEscalation)) {
      query.set("incidentMinEscalation", String(input.incidentMinEscalation));
    }
    if (typeof input.incidentMinBlastRadius === "number" && Number.isFinite(input.incidentMinBlastRadius)) {
      query.set("incidentMinBlastRadius", String(input.incidentMinBlastRadius));
    }
    if (input.dispatch !== undefined) {
      query.set("dispatch", input.dispatch ? "true" : "false");
    }
    if (typeof input.webhookUrl === "string" && input.webhookUrl.trim().length > 0) {
      query.set("webhookUrl", input.webhookUrl.trim());
    }
    const payload = await request(`/api/memory/loops/digest?${query.toString()}`, "GET");
    return asToolResult(payload);
  }
);

server.registerTool(
  "import_memories",
  {
    description: "Bulk import memory items.",
    inputSchema: {
      sourceOverride: z.string().min(1).max(128).optional(),
      continueOnError: z.boolean().optional(),
      disableRunWriteBurstLimit: z.boolean().optional(),
      items: z
        .array(
          z.object({
            content: z.string().min(1).max(20_000),
            source: z.string().min(1).max(128).optional(),
            tenantId: z.string().min(1).max(128).nullable().optional(),
            tags: z.array(z.string().min(1).max(64)).max(32).optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
            clientRequestId: z.string().min(1).max(128).optional(),
          })
        )
        .min(1)
        .max(500),
    },
  },
  async (input) => {
    const payload = await request("/api/memory/import", "POST", {
      sourceOverride: input.sourceOverride,
      continueOnError: input.continueOnError ?? true,
      disableRunWriteBurstLimit: input.disableRunWriteBurstLimit ?? false,
      items: input.items,
    });
    return asToolResult(payload);
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("open-memory MCP server running on stdio\n");
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    process.stderr.write(`open-memory-mcp failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
