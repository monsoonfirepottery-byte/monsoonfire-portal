import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  normalizeCodexLifecycleEvent,
  rememberCodexLifecycleEvent,
} from "./codex-lifecycle-memory.mjs";

test("normalizeCodexLifecycleEvent creates compact stable rows", () => {
  const row = normalizeCodexLifecycleEvent(
    {
      tool: "codex-shell",
      event: "task-start",
      status: "running",
      runId: "run-1",
      summary: "Shell launched.",
      metrics: { bootstrap: true },
      touchedPaths: ["a", "a", "b"],
    },
    { now: new Date("2026-04-30T12:00:00.000Z") }
  );

  assert.equal(row.schema, "codex-lifecycle-memory.v1");
  assert.equal(row.tool, "codex-shell");
  assert.equal(row.event, "task-start");
  assert.equal(row.tsIso, "2026-04-30T12:00:00.000Z");
  assert.deepEqual(row.touchedPaths, ["a", "b"]);
  assert.equal(typeof row.id, "string");
});

test("rememberCodexLifecycleEvent appends local lifecycle memory without remote writes by default", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-lifecycle-"));
  const lifecyclePath = join(dir, "lifecycle.ndjson");
  const result = await rememberCodexLifecycleEvent(
    {
      tool: "codex-shell",
      event: "task-stop",
      status: "exit-0",
      runId: "run-2",
      summary: "Shell exited.",
    },
    {
      cwd: dir,
      env: {
        CODEX_LIFECYCLE_MEMORY_PATH: lifecyclePath,
      },
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.remote.attempted, false);
  const rows = readFileSync(lifecyclePath, "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tool, "codex-shell");
  assert.equal(rows[0].event, "task-stop");
});
