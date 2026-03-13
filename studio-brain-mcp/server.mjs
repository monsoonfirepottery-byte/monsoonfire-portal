import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const DEFAULT_BASE_URL = process.env.STUDIO_BRAIN_MCP_BASE_URL || "http://127.0.0.1:8787";
const DEFAULT_TIMEOUT_MS = parsePositiveInt(process.env.STUDIO_BRAIN_MCP_TIMEOUT_MS, 10000);
const ID_TOKEN = process.env.STUDIO_BRAIN_MCP_ID_TOKEN || "";
const ADMIN_TOKEN = process.env.STUDIO_BRAIN_MCP_ADMIN_TOKEN || "";

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
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

function getHeaders() {
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (ID_TOKEN) {
    headers.authorization = `Bearer ${ID_TOKEN}`;
  }
  if (ADMIN_TOKEN) {
    headers["x-studio-brain-admin-token"] = ADMIN_TOKEN;
  }
  return headers;
}

async function studioBrainRequest({ method, path, body, baseUrl = DEFAULT_BASE_URL, timeoutMs = DEFAULT_TIMEOUT_MS }) {
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
    if (!response.ok) {
      const message =
        typeof payload?.message === "string"
          ? payload.message
          : `Studio Brain returned HTTP ${response.status}`;
      throw new Error(message);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
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
      const payload = await studioBrainRequest({
        method: "POST",
        path: "/api/memory/search",
        body: {
          query,
          limit,
          tenantId,
        },
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
      const query = new URLSearchParams();
      if (limit) query.set("limit", String(limit));
      const path = query.size > 0 ? `/api/memory/recent?${query.toString()}` : "/api/memory/recent";
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
  async ({ query, agentId, runId, maxItems, maxChars, tenantId, baseUrl, timeoutMs }) => {
    try {
      const payload = await studioBrainRequest({
        method: "POST",
        path: "/api/memory/context",
        body: {
          query,
          agentId,
          runId,
          maxItems,
          maxChars,
          tenantId,
        },
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
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
