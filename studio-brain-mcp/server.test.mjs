import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function createBootstrapHome() {
  const homeDir = mkdtempSync(join(tmpdir(), "studio-brain-mcp-home-"));
  const threadId = "thread-startup-alias";
  const runtimeDir = join(homeDir, ".codex", "memory", "runtime", threadId);
  mkdirSync(runtimeDir, { recursive: true });

  writeFileSync(
    join(runtimeDir, "bootstrap-context.json"),
    `${JSON.stringify(
      {
        summary: "Current goal: ship the memory actionability bridge before broad repo reads.",
        items: [
          {
            source: "handoff",
            content: "Implement the startup quality card and memory next-actions card.",
            metadata: {
              source: "handoff",
            },
          },
        ],
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

  return {
    homeDir,
    threadId,
    cleanup() {
      rmSync(homeDir, { recursive: true, force: true });
    },
  };
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
