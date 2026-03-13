#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parseCliArgs, readBoolFlag, readNumberFlag, readStringFlag } from "./lib/pst-memory-utils.mjs";

const REPO_ROOT = resolve(process.cwd(), ".");

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const normalized = String(line || "").trim();
    if (!normalized || normalized.startsWith("#")) {
      continue;
    }
    const assignment = normalized.startsWith("export ") ? normalized.slice(7).trim() : normalized;
    const separator = assignment.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = assignment.slice(0, separator).trim();
    let value = assignment.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseQuery(rawQuery) {
  const query = String(rawQuery || "").trim();
  if (!query) {
    return JSON.stringify({ kqlQuery: "isRead:false" });
  }
  if (query.startsWith("{")) {
    return query;
  }
  return JSON.stringify({ kqlQuery: query });
}

function resultRowsFromPayload(payload) {
  if (!payload || payload.type !== "success") {
    return null;
  }

  if (payload.shape === "objects") {
    return Array.isArray(payload.items) ? payload.items : [];
  }

  if (payload.shape === "arrays") {
    const columns = Array.isArray(payload.columns) ? payload.columns : [];
    if (!Array.isArray(payload.rows) || columns.length === 0) {
      return [];
    }
    return payload.rows
      .filter(Array.isArray)
      .map((row) => Object.fromEntries(row.map((value, index) => [columns[index] || `col_${String(index)}`, value])));
  }

  return [];
}

function toolText(result) {
  if (!result || !Array.isArray(result.content)) {
    return "";
  }
  return result.content
    .map((entry) => String(entry.text || ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function fail(message, extra = null) {
  if (extra) {
    process.stderr.write(`${message}: ${extra}\n`);
    process.exitCode = 1;
    throw new Error(`${message}: ${extra}`);
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

async function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  const runId = readStringFlag(flags, "run-id", `mail-office-mcp-${Date.now()}`);
  const maxItems = readNumberFlag(flags, "max-items", 100, { min: 1, max: 100000 });
  const pageSize = Math.min(readNumberFlag(flags, "page-size", 100, { min: 1, max: 500 }), 500);
  const shape = readStringFlag(flags, "shape", "objects");
  const rawQuery = readStringFlag(flags, "query", "");
  const reportPath = readStringFlag(flags, "report", "");
  const loadEnv = readBoolFlag(flags, "load-env-file", true);
  const envFile = resolve(
    REPO_ROOT,
    readStringFlag(flags, "env-file", process.env.MAIL_IMPORT_ENV_FILE || "secrets/studio-brain/open-memory-mail-import.env")
  );
  const loadPortalEnv = readBoolFlag(flags, "load-portal-env-file", true);
  const portalEnvFile = resolve(
    REPO_ROOT,
    readStringFlag(flags, "portal-env-file", process.env.MAIL_IMPORT_PORTAL_ENV_FILE || "secrets/portal/portal-automation.env")
  );

  if (loadEnv) {
    loadEnvFile(envFile);
  }
  if (loadPortalEnv) {
    loadEnvFile(portalEnvFile);
  }

  const tenantId = readStringFlag(flags, "tenant-id", process.env.MAIL_IMPORT_OUTLOOK_TENANT_ID || process.env.MS_TENANT_ID || "");
  const clientId = readStringFlag(flags, "client-id", process.env.MAIL_IMPORT_OUTLOOK_CLIENT_ID || process.env.MS_CLIENT_ID || "");
  const clientSecret = readStringFlag(flags, "client-secret", process.env.MAIL_IMPORT_OUTLOOK_CLIENT_SECRET || process.env.MS_CLIENT_SECRET || "");
  const tokenStoreUri = readStringFlag(flags, "token-store", "");

  if (!tenantId || !clientId) {
    fail("Missing required Outlook MCP config", "provide --tenant-id and --client-id (or set MAIL_IMPORT_OUTLOOK_TENANT_ID / MAIL_IMPORT_OUTLOOK_CLIENT_ID)");
  }

  const mcpEnv = {
    ...process.env,
    MS_TENANT_ID: tenantId,
    MS_CLIENT_ID: clientId,
    LOG_LEVEL: readStringFlag(flags, "log-level", process.env.LOG_LEVEL || "warn"),
  };
  if (clientSecret) {
    mcpEnv.MS_CLIENT_SECRET = clientSecret;
  }
  if (tokenStoreUri) {
    mcpEnv.TOKEN_STORE_URI = tokenStoreUri;
  }

  const query = parseQuery(rawQuery);
  const requestedPageSize = Math.min(pageSize, maxItems);

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["--yes", "@mcp-z/mcp-outlook", "--auth=device-code", "--headless"],
    env: mcpEnv,
    cwd: REPO_ROOT,
    stderr: "inherit",
  });

  const client = new Client(
    {
      name: "studio-brain-outlook-mcp-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  let rows = [];
  let nextPageToken;

  try {
    await client.connect(transport);

    while (rows.length < maxItems) {
      const remaining = maxItems - rows.length;
      const currentPageSize = Math.min(requestedPageSize, remaining);
      const args = {
        pageSize: currentPageSize,
        shape,
        query,
      };
      if (nextPageToken) {
        args.pageToken = nextPageToken;
      }

      const result = await client.callTool({
        name: "message-search",
        arguments: args,
      });

      if (result.isError) {
        const msg = toolText(result);
        if (msg.includes("No valid token available in headless mode")) {
          fail(
            "Outlook MCP auth required. In one interactive terminal run:\n" +
              "  npx --yes @mcp-z/mcp-outlook --auth=device-code\n" +
              "Then retry this command with the same --tenant-id and --client-id."
          );
        }
        fail("message-search tool call failed", msg || JSON.stringify(result));
      }

      const payload = result.structuredContent?.result;
      const pageRows = resultRowsFromPayload(payload);
      if (!Array.isArray(pageRows)) {
        fail("Unexpected message-search response shape", JSON.stringify(payload));
      }

      rows = rows.concat(pageRows);
      nextPageToken = payload?.nextPageToken;

      if (!nextPageToken || pageRows.length === 0) {
        break;
      }
    }

    const report = {
      runId,
      count: rows.length,
      maxItems,
      shape,
      query,
      source: "@mcp-z/mcp-outlook",
      tenantId,
      items: rows,
    };

    if (reportPath) {
      const normalizedPath = resolve(REPO_ROOT, reportPath);
      writeFileSync(normalizedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      process.stdout.write(`Wrote report: ${normalizedPath}\n`);
    }

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    if (typeof client.close === "function") {
      await client.close();
    }
  }
}

main().catch((error) => {
  if (error instanceof Error) {
    fail(error.message);
  }
  fail(String(error));
});
