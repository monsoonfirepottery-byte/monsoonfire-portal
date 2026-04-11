import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function createBootstrapHome({
  summary = "Current goal: ship the memory actionability bridge before broad repo reads.",
  items = [
    {
      source: "handoff",
      content: "Implement the startup quality card and memory next-actions card.",
      metadata: {
        source: "handoff",
      },
    },
  ],
  diagnostics,
  startupBlocker = null,
} = {}) {
  const homeDir = mkdtempSync(join(tmpdir(), "studio-brain-mcp-home-"));
  const threadId = "thread-startup-alias";
  const runtimeDir = join(homeDir, ".codex", "memory", "runtime", threadId);
  mkdirSync(runtimeDir, { recursive: true });

  writeFileSync(
    join(runtimeDir, "bootstrap-context.json"),
    `${JSON.stringify(
      {
        summary,
        items,
        ...(diagnostics ? { diagnostics } : {}),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  writeFileSync(
    join(runtimeDir, "bootstrap-metadata.json"),
    `${JSON.stringify(
      {
        threadId,
        cwd: "D:/monsoonfire-portal",
        threadTitle: "Memory Actionability Bridge",
        firstUserMessage: "Implement the startup quality bridge.",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  if (startupBlocker) {
    writeFileSync(
      join(runtimeDir, "startup-blocker.json"),
      `${JSON.stringify(startupBlocker, null, 2)}\n`,
      "utf8",
    );
  }

  return {
    homeDir,
    threadId,
    cleanup() {
      rmSync(homeDir, { recursive: true, force: true });
    },
  };
}

async function withAuthRejectingServer(run) {
  const server = createServer((req, res) => {
    if ((req.url || "").startsWith("/healthz")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "studio-brain", at: new Date().toISOString() }));
      return;
    }
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, message: "Missing Authorization header." }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function withContextServer(payload, run) {
  const server = createServer((req, res) => {
    if ((req.url || "").startsWith("/healthz")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "studio-brain", at: new Date().toISOString() }));
      return;
    }

    if ((req.url || "").startsWith("/api/memory/context")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, message: "Not found" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function withBootstrapServer({ searchPayload = null, contextPayload = null }, run) {
  const server = createServer((req, res) => {
    if ((req.url || "").startsWith("/healthz")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "studio-brain", at: new Date().toISOString() }));
      return;
    }

    if ((req.url || "").startsWith("/api/memory/search")) {
      if (searchPayload) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(searchPayload));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: "Search unavailable" }));
      return;
    }

    if ((req.url || "").startsWith("/api/memory/context")) {
      if (contextPayload) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(contextPayload));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: "Context unavailable" }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, message: "Not found" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function withClient(envOverrides, run) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["./server.mjs"],
    cwd: new URL(".", import.meta.url),
    stderr: "pipe",
    env: {
      ...process.env,
      ...envOverrides,
    },
  });

  const client = new Client({
    name: "studio-brain-mcp-test",
    version: "0.1.0",
  });

  await client.connect(transport);
  try {
    await run(client);
  } finally {
    await transport.close();
  }
}

test("studio-brain MCP advertises the canonical startup alias and preserves the legacy context tool", async () => {
  const bootstrap = createBootstrapHome();

  try {
    await withClient(
      {
        HOME: bootstrap.homeDir,
        USERPROFILE: bootstrap.homeDir,
        STUDIO_BRAIN_BOOTSTRAP_THREAD_ID: bootstrap.threadId,
      },
      async (client) => {
        const listed = await client.listTools();
        const names = listed.tools.map((tool) => tool.name);

        assert.equal(names.includes("studio_brain_startup_context"), true);
        assert.equal(names.includes("studio_brain_memory_context"), true);
      },
    );
  } finally {
    bootstrap.cleanup();
  }
});

test("studio-brain startup tools fall back to blocker artifacts when auth is missing", async () => {
  const bootstrap = createBootstrapHome({
    summary: "Grounding: continuity blocked until Studio Brain auth is restored.",
    items: [],
    diagnostics: {
      continuityState: "blocked",
      continuityAvailable: false,
      continuityReason: "missing_token",
      continuityReasonCode: "missing_token",
    },
    startupBlocker: {
      schema: "codex-startup-blocker.v1",
      createdAt: new Date().toISOString(),
      status: "blocked",
      failureClass: "missing_token",
      threadId: "thread-startup-alias",
      cwd: "D:/monsoonfire-portal",
      query: "Studio Brain startup continuity",
      queryFingerprint: "fingerprint-test",
      firstSignal: "Missing Authorization header.",
      remoteError: "Missing Authorization header.",
      unblockStep: "Restore a durable Studio Brain staff auth source for the MCP launcher.",
      localDiagnosticsAvailable: true,
    },
  });

  try {
    await withAuthRejectingServer(async (baseUrl) => {
      await withClient(
        {
          HOME: bootstrap.homeDir,
          USERPROFILE: bootstrap.homeDir,
          STUDIO_BRAIN_BOOTSTRAP_THREAD_ID: bootstrap.threadId,
        },
        async (client) => {
          const startupResult = await client.callTool({
            name: "studio_brain_startup_context",
            arguments: {
              baseUrl,
              timeoutMs: 2000,
            },
          });

          assert.notEqual(startupResult.isError, true);
          assert.equal(startupResult.structuredContent?.diagnostics?.fallbackStrategy, "bootstrap-artifact");
          assert.equal(startupResult.structuredContent?.diagnostics?.continuityState, "blocked");
          assert.match(String(startupResult.structuredContent?.summary || ""), /continuity blocked/i);
          assert.equal(
            startupResult.structuredContent?.items?.some((row) => row?.source === "codex-startup-blocker"),
            true,
          );

          const recentResult = await client.callTool({
            name: "studio_brain_memory_recent",
            arguments: {
              baseUrl,
              timeoutMs: 2000,
              limit: 5,
            },
          });

          assert.notEqual(recentResult.isError, true);
          assert.equal(recentResult.structuredContent?.rows?.[0]?.source, "codex-startup-blocker");

          const statsResult = await client.callTool({
            name: "studio_brain_memory_stats",
            arguments: {
              baseUrl,
              timeoutMs: 2000,
            },
          });

          assert.notEqual(statsResult.isError, true);
          assert.equal(statsResult.structuredContent?.diagnostics?.dataScope, "bootstrap-artifact");
          assert.equal(Number(statsResult.structuredContent?.stats?.total || 0) >= 1, true);
        },
      );
    });
  } finally {
    bootstrap.cleanup();
  }
});

test("studio-brain startup alias falls back to bootstrap artifacts when the remote memory bridge is unavailable", async () => {
  const bootstrap = createBootstrapHome();

  try {
    await withClient(
      {
        HOME: bootstrap.homeDir,
        USERPROFILE: bootstrap.homeDir,
        STUDIO_BRAIN_BOOTSTRAP_THREAD_ID: bootstrap.threadId,
      },
      async (client) => {
        const startupResult = await client.callTool({
          name: "studio_brain_startup_context",
          arguments: {
            baseUrl: "http://127.0.0.1:9",
            timeoutMs: 25,
          },
        });

        assert.notEqual(startupResult.isError, true);
        assert.match(String(startupResult.structuredContent?.summary || ""), /Current goal/i);
        assert.equal(startupResult.structuredContent?.diagnostics?.fallbackStrategy, "bootstrap-artifact");
        assert.equal(Array.isArray(startupResult.structuredContent?.items), true);

        const legacyResult = await client.callTool({
          name: "studio_brain_memory_context",
          arguments: {
            query: "startup bridge",
            baseUrl: "http://127.0.0.1:9",
            timeoutMs: 25,
          },
        });

        assert.notEqual(legacyResult.isError, true);
        assert.equal(legacyResult.structuredContent?.diagnostics?.fallbackStrategy, "bootstrap-artifact");
      },
    );
  } finally {
    bootstrap.cleanup();
  }
});

test("studio-brain startup context rewrites misleading upstream summaries from reranked rows", async () => {
  const bootstrap = createBootstrapHome({
    summary: "Local bootstrap summary should not be used when remote context succeeds.",
  });

  const payload = {
    ok: true,
    context: {
      summary: "1. [startup-context] query=dream rescue cleanup",
      items: [
        {
          id: "mem-portal",
          source: "codex-handoff",
          content: "Portal continuity: continue Monsoon Fire portal startup work, not generic Studio Brain history.",
          metadata: {
            source: "codex-handoff",
            projectLane: "monsoonfire-portal",
            startupEligible: true,
          },
        },
      ],
    },
  };

  try {
    await withContextServer(payload, async (baseUrl) => {
      await withClient(
        {
          HOME: bootstrap.homeDir,
          USERPROFILE: bootstrap.homeDir,
          STUDIO_BRAIN_BOOTSTRAP_THREAD_ID: bootstrap.threadId,
        },
        async (client) => {
          const startupResult = await client.callTool({
            name: "studio_brain_startup_context",
            arguments: {
              baseUrl,
              timeoutMs: 2000,
            },
          });

          assert.notEqual(startupResult.isError, true);
          assert.match(String(startupResult.structuredContent?.summary || ""), /Portal continuity/i);
          assert.doesNotMatch(
            String(startupResult.structuredContent?.summary || ""),
            /dream rescue cleanup/i,
          );
          assert.equal(startupResult.structuredContent?.items?.[0]?.id, "mem-portal");
        },
      );
    });
  } finally {
    bootstrap.cleanup();
  }
});

test("studio-brain startup context prefers startup search hits over misleading context rows", async () => {
  const bootstrap = createBootstrapHome({
    summary: "Local bootstrap summary should not be used when remote startup search succeeds.",
  });

  const searchPayload = {
    ok: true,
    rows: [
      {
        id: "mem-portal",
        source: "codex-handoff",
        content: "Portal continuity: continue Monsoon Fire portal startup work, not generic Studio Brain history.",
        metadata: {
          source: "codex-handoff",
          projectLane: "monsoonfire-portal",
          startupEligible: true,
        },
      },
    ],
  };

  const contextPayload = {
    ok: true,
    context: {
      summary: "1. [startup-context] query=dream rescue cleanup",
      items: [
        {
          id: "mem-studio",
          source: "codex-handoff",
          content: "Studio Brain continuity: keep working on generic Journeykits history.",
          metadata: {
            source: "codex-handoff",
            projectLane: "studio-brain",
            startupEligible: true,
          },
        },
      ],
    },
  };

  try {
    await withBootstrapServer({ searchPayload, contextPayload }, async (baseUrl) => {
      await withClient(
        {
          HOME: bootstrap.homeDir,
          USERPROFILE: bootstrap.homeDir,
          STUDIO_BRAIN_BOOTSTRAP_THREAD_ID: bootstrap.threadId,
        },
        async (client) => {
          const startupResult = await client.callTool({
            name: "studio_brain_startup_context",
            arguments: {
              baseUrl,
              timeoutMs: 2000,
            },
          });

          assert.notEqual(startupResult.isError, true);
          assert.match(String(startupResult.structuredContent?.summary || ""), /Portal continuity/i);
          assert.equal(startupResult.structuredContent?.items?.[0]?.id, "mem-portal");
          assert.equal(
            startupResult.structuredContent?.diagnostics?.startupSelectionStrategy,
            "search-first",
          );
          assert.equal(startupResult.structuredContent?.diagnostics?.projectLane, "monsoonfire-portal");
        },
      );
    });
  } finally {
    bootstrap.cleanup();
  }
});

test("studio-brain startup context can prefer the local bootstrap artifact inside launched sessions", async () => {
  const bootstrap = createBootstrapHome({
    summary: "Portal continuity: continue Monsoon Fire portal startup work, not generic Studio Brain history.",
    items: [
      {
        id: "mem-local-portal",
        source: "codex-handoff",
        content: "Portal continuity: continue Monsoon Fire portal startup work, not generic Studio Brain history.",
        metadata: {
          source: "codex-handoff",
          projectLane: "monsoonfire-portal",
          startupEligible: true,
        },
      },
    ],
  });

  const payload = {
    ok: true,
    context: {
      summary: "Studio Brain continuity: keep working on generic Journeykits history.",
      items: [
        {
          id: "mem-remote-studio",
          source: "codex-handoff",
          content: "Studio Brain continuity: keep working on generic Journeykits history.",
          metadata: {
            source: "codex-handoff",
            projectLane: "studio-brain",
            startupEligible: true,
          },
        },
      ],
    },
  };

  try {
    await withContextServer(payload, async (baseUrl) => {
      await withClient(
        {
          HOME: bootstrap.homeDir,
          USERPROFILE: bootstrap.homeDir,
          STUDIO_BRAIN_BOOTSTRAP_THREAD_ID: bootstrap.threadId,
          STUDIO_BRAIN_STARTUP_CONTEXT_PREFER_LOCAL: "1",
        },
        async (client) => {
          const startupResult = await client.callTool({
            name: "studio_brain_startup_context",
            arguments: {
              baseUrl,
              timeoutMs: 2000,
            },
          });

          assert.notEqual(startupResult.isError, true);
          assert.match(String(startupResult.structuredContent?.summary || ""), /Portal continuity/i);
          assert.equal(startupResult.structuredContent?.items?.[0]?.id, "mem-local-portal");
          assert.equal(startupResult.structuredContent?.diagnostics?.projectLane, "monsoonfire-portal");
          assert.equal(startupResult.structuredContent?.diagnostics?.dominantProjectLane, "monsoonfire-portal");
        },
      );
    });
  } finally {
    bootstrap.cleanup();
  }
});
