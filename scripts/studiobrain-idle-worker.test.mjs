import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseArgs, runIdleWorker } from "./studiobrain-idle-worker.mjs";

test("idle worker writes bounded run history and utilization context", async () => {
  const runRoot = mkdtempSync(join(tmpdir(), "studiobrain-idle-worker-"));
  try {
    const firstOptions = parseArgs([
      "--dry-run",
      "--jobs",
      "memory",
      "--run-id",
      "idle-history-one",
      "--run-root",
      runRoot,
      "--history-limit",
      "2",
    ]);
    const secondOptions = parseArgs([
      "--dry-run",
      "--jobs",
      "memory",
      "--run-id",
      "idle-history-two",
      "--run-root",
      runRoot,
      "--history-limit",
      "2",
    ]);

    const firstReport = await runIdleWorker(firstOptions);
    const secondReport = await runIdleWorker(secondOptions);
    const latest = JSON.parse(readFileSync(join(runRoot, "latest.json"), "utf8"));
    const history = JSON.parse(readFileSync(join(runRoot, "history.json"), "utf8"));

    assert.equal(firstReport.status, "planned");
    assert.equal(secondReport.status, "planned");
    assert.equal(latest.runId, "idle-history-two");
    assert.equal(latest.utilization.idleReason, "Dry run planned the idle-worker jobs without spending the execution budget.");
    assert.equal(latest.utilization.nextRecommendedJob, "memory-consolidation");
    assert.equal(latest.budget.memory.maxCandidates, 80);
    assert.equal(history.schema, "studiobrain-idle-worker-history-v1");
    assert.deepEqual(history.runs.map((run) => run.runId), ["idle-history-two", "idle-history-one"]);
    assert.equal(history.runs[0].utilization.attemptedJobs, 0);
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});
