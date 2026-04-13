import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveBootstrapThreadInfo } from "./thread-context.mjs";

test("resolveBootstrapThreadInfo synthesizes a fallback thread context when state lookup misses", () => {
  const threadInfo = resolveBootstrapThreadInfo({
    env: {
      CODEX_THREAD_ID: "missing-thread-for-test",
      CODEX_CWD: "D:/monsoonfire-portal",
      CODEX_FIRST_USER_MESSAGE: "test studio brain memory",
    },
    fallbackCwd: "C:/fallback-cwd",
  });

  assert.equal(threadInfo.threadId, "missing-thread-for-test");
  assert.equal(threadInfo.cwd, "D:/monsoonfire-portal");
  assert.equal(threadInfo.firstUserMessage, "test studio brain memory");
  assert.equal(threadInfo.rolloutPath, "");
  assert.equal(threadInfo.resolution, "fallback");
});

test("resolveBootstrapThreadInfo creates a stable cwd-based thread id when no hints exist", () => {
  const threadInfo = resolveBootstrapThreadInfo({
    env: {},
    fallbackCwd: "D:/monsoonfire-portal",
  });

  assert.match(threadInfo.threadId, /^cwd-[a-f0-9]+$/i);
  assert.equal(threadInfo.cwd, "D:/monsoonfire-portal");
  assert.equal(threadInfo.resolution, "fallback");
});

test("resolveBootstrapThreadInfo does not reuse the last cwd thread when a new thread id is already hinted", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "thread-context-state-"));
  const stateDbPath = join(tempDir, "state.sqlite");
  const db = new DatabaseSync(stateDbPath);

  try {
    db.exec(`
      create table threads (
        id text primary key,
        rollout_path text,
        cwd text,
        title text,
        first_user_message text,
        updated_at integer
      );
    `);
    db.prepare(
      "insert into threads (id, rollout_path, cwd, title, first_user_message, updated_at) values (?, ?, ?, ?, ?, ?)"
    ).run(
      "existing-thread-id",
      "C:/rollouts/existing.jsonl",
      "D:/monsoonfire-portal",
      "Older portal thread",
      "old portal message",
      1234567890,
    );
  } finally {
    db.close();
  }

  try {
    const threadInfo = resolveBootstrapThreadInfo({
      env: {
        CODEX_THREAD_ID: "fresh-thread-id",
        CODEX_CWD: "D:/monsoonfire-portal",
        CODEX_FIRST_USER_MESSAGE: "new portal startup check",
      },
      fallbackCwd: "C:/fallback-cwd",
      stateDbPath,
    });

    assert.equal(threadInfo.threadId, "fresh-thread-id");
    assert.equal(threadInfo.cwd, "D:/monsoonfire-portal");
    assert.equal(threadInfo.firstUserMessage, "new portal startup check");
    assert.equal(threadInfo.rolloutPath, "");
    assert.equal(threadInfo.resolution, "fallback");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
