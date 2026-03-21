import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  buildStartupContextSearchPayload,
  buildLocalBootstrapContext,
  extractCompactionMemoryProducts,
  isContextCompactedEvent,
  preferredStartupSources,
  rankBootstrapRows,
  resolveStartupBootstrapPolicy,
  resolveCodexThreadContext,
} from "./lib/codex-session-memory-utils.mjs";

test("resolveCodexThreadContext reads thread metadata from sqlite", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codex-thread-sqlite-"));
  const dbPath = join(tempDir, "state_5.sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(
      [
        "create table threads (",
        "id text primary key,",
        "rollout_path text,",
        "cwd text,",
        "title text,",
        "first_user_message text,",
        "updated_at integer",
        ");",
      ].join(" ")
    );
    db.prepare(
      "insert into threads (id, rollout_path, cwd, title, first_user_message, updated_at) values (?, ?, ?, ?, ?, ?)"
    ).run(
      "thread-test-1",
      "C:\\Users\\micah\\.codex\\sessions\\thread-test-1.jsonl",
      "\\\\?\\D:\\monsoonfire-portal",
      "Thread title",
      "First user prompt",
      1773959935
    );
    const threadInfo = resolveCodexThreadContext({
      threadId: "thread-test-1",
      stateDbPath: dbPath,
    });
    assert.equal(threadInfo?.threadId, "thread-test-1");
    assert.equal(threadInfo?.rolloutPath, "C:\\Users\\micah\\.codex\\sessions\\thread-test-1.jsonl");
    assert.equal(threadInfo?.cwd, "D:\\monsoonfire-portal");
    assert.equal(threadInfo?.title, "Thread title");
    assert.equal(threadInfo?.firstUserMessage, "First user prompt");
  } finally {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("extractCompactionMemoryProducts captures bounded before/after windows and redacts secrets", () => {
  const rolloutEntries = [];
  for (let index = 1; index <= 55; index += 1) {
    rolloutEntries.push({
      lineNumber: index,
      event: {
        timestamp: `2026-03-19T22:${String(index).padStart(2, "0")}:00.000Z`,
        type: "response_item",
        payload: {
          type: "message",
          role: index % 2 === 0 ? "assistant" : "user",
          content: [{ text: `Signal message ${index} about portal memory context.` }],
        },
      },
    });
  }
  rolloutEntries.push({
    lineNumber: 56,
    event: {
      timestamp: "2026-03-19T23:00:00.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-secret",
        output: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
      },
    },
  });
  rolloutEntries.push({
    lineNumber: 57,
    event: {
      timestamp: "2026-03-19T23:00:10.000Z",
      type: "event_msg",
      payload: {
        type: "context_compacted",
      },
    },
  });
  for (let index = 58; index <= 77; index += 1) {
    rolloutEntries.push({
      lineNumber: index,
      event: {
        timestamp: `2026-03-19T23:${String(index - 57).padStart(2, "0")}:00.000Z`,
        type: "response_item",
        payload: {
          type: index % 3 === 0 ? "function_call_output" : "message",
          role: "assistant",
          content: [{ text: `Post-compaction note ${index} for portal continuity.` }],
          output: `Tool output ${index}`,
          call_id: `call-${index}`,
        },
      },
    });
  }

  assert.equal(isContextCompactedEvent(rolloutEntries[56]), true);

  const threadInfo = {
    threadId: "thread-compaction-1",
    rolloutPath: "D:/tmp/thread-compaction-1.jsonl",
    cwd: "D:\\monsoonfire-portal",
    title: "Compaction test",
    firstUserMessage: "Test compaction capture",
  };
  const first = extractCompactionMemoryProducts({
    threadInfo,
    rolloutEntries,
    compactionLineNumber: 57,
  });
  const second = extractCompactionMemoryProducts({
    threadInfo,
    rolloutEntries,
    compactionLineNumber: 57,
  });

  assert.equal(first.compactionId, second.compactionId);
  assert.equal(first.beforeEligibleCount, 40);
  assert.equal(first.afterEligibleCount, 12);
  assert.equal(first.rawRows.length, 52);
  assert.equal(first.windowRow.source, "codex-compaction-window");
  assert.equal(first.promotedRows.length > 0, true);
  assert.equal(
    first.rawRows.some((row) => String(row.content).includes("Bearer [REDACTED]")),
    true
  );
});

test("buildLocalBootstrapContext falls back to first user message when rollout/history are empty", () => {
  const context = buildLocalBootstrapContext({
    threadInfo: {
      threadId: "thread-bootstrap-1",
      rolloutPath: "",
      cwd: "C:\\Users\\micah",
      title: "Bootstrap test",
      firstUserMessage: "Is the memory system available?",
      updatedAt: "2026-03-19T20:00:00.000Z",
    },
    threadName: "Bootstrap test",
    historyLines: [],
    rolloutEntries: [],
    maxItems: 5,
    maxChars: 1200,
  });

  assert.equal(Array.isArray(context.items), true);
  assert.equal(context.items.length >= 1, true);
  assert.equal(String(context.items[0]?.content || "").includes("memory system available"), true);
});

test("buildLocalBootstrapContext preserves strict startup allowlist diagnostics", () => {
  const context = buildLocalBootstrapContext({
    threadInfo: {
      threadId: "thread-bootstrap-2",
      cwd: "D:\\monsoonfire-portal",
      title: "Bootstrap diagnostics test",
      firstUserMessage: "Probe startup policy",
      updatedAt: "2026-03-19T20:10:00.000Z",
    },
    strictStartupAllowlist: false,
  });

  assert.equal(context.diagnostics?.strictStartupAllowlist, false);
});

test("startup source preferences include hybrid repo and history sources", () => {
  const sources = preferredStartupSources();
  assert.equal(sources.includes("repo-markdown"), true);
  assert.equal(sources.includes("codex-history-export"), true);
});

test("rankBootstrapRows keeps hybrid repo and history sources ahead of generic context slices", () => {
  const ranked = rankBootstrapRows(
    [
      {
        id: "row-slice",
        source: "context-slice",
        score: 0.5,
        metadata: { cwd: "D:\\monsoonfire-portal" },
      },
      {
        id: "row-history",
        source: "codex-history-export",
        score: 0.5,
        metadata: { cwd: "D:\\monsoonfire-portal" },
      },
      {
        id: "row-repo",
        source: "repo-markdown",
        score: 0.5,
        metadata: { cwd: "D:\\monsoonfire-portal" },
      },
    ],
    { threadId: "thread-bootstrap", cwd: "D:\\monsoonfire-portal" },
    { preserveOriginalScore: false }
  );

  assert.deepEqual(
    ranked.map((row) => row.id),
    ["row-repo", "row-history", "row-slice"]
  );
});

test("buildStartupContextSearchPayload honors strict startup allowlist", () => {
  const strictPayload = buildStartupContextSearchPayload({
    query: "bootstrap test",
    strictStartupAllowlist: true,
  });
  const relaxedPayload = buildStartupContextSearchPayload({
    query: "bootstrap test",
    strictStartupAllowlist: false,
  });

  assert.deepEqual(strictPayload.sourceAllowlist, preferredStartupSources());
  assert.equal(Array.isArray(strictPayload.sourceDenylist), true);
  assert.equal("sourceAllowlist" in relaxedPayload, false);
  assert.equal(Array.isArray(relaxedPayload.sourceDenylist), true);
});

test("resolveStartupBootstrapPolicy honors off, local-only, and strict failure modes", () => {
  assert.deepEqual(resolveStartupBootstrapPolicy({}), {
    bootstrapMode: "hard",
    bootstrapFailureMode: "local-fallback",
    strictStartupAllowlist: true,
    remoteEnabled: true,
    localFallbackEnabled: true,
  });

  assert.deepEqual(
    resolveStartupBootstrapPolicy({
      bootstrapMode: "local-only",
      bootstrapFailureMode: "none",
      strictStartupAllowlist: false,
    }),
    {
      bootstrapMode: "local-only",
      bootstrapFailureMode: "none",
      strictStartupAllowlist: false,
      remoteEnabled: false,
      localFallbackEnabled: true,
    }
  );

  assert.deepEqual(
    resolveStartupBootstrapPolicy({
      bootstrapMode: "off",
      bootstrapFailureMode: "local-fallback",
      strictStartupAllowlist: true,
    }),
    {
      bootstrapMode: "off",
      bootstrapFailureMode: "local-fallback",
      strictStartupAllowlist: true,
      remoteEnabled: false,
      localFallbackEnabled: false,
    }
  );

  assert.deepEqual(
    resolveStartupBootstrapPolicy({
      bootstrapMode: "hard",
      bootstrapFailureMode: "strict",
      strictStartupAllowlist: true,
    }),
    {
      bootstrapMode: "hard",
      bootstrapFailureMode: "none",
      strictStartupAllowlist: true,
      remoteEnabled: true,
      localFallbackEnabled: false,
    }
  );
});
