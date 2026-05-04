import assert from "node:assert/strict";
import test from "node:test";

import { buildIdleTaskQueueReport } from "./lib/wiki-postgres-utils.mjs";

test("wiki idle task queue advertises the read-only idle budget lanes", () => {
  const report = buildIdleTaskQueueReport();
  const byKey = new Map(report.tasks.map((task) => [task.taskKey, task]));

  for (const taskKey of [
    "wiki-source-index-refresh",
    "wiki-claim-extraction-review",
    "wiki-context-pack-refresh",
    "wiki-contradiction-scan-review",
    "wiki-db-probe-plan-review",
  ]) {
    assert.ok(byKey.has(taskKey), `${taskKey} should be visible in the idle task queue`);
  }

  assert.ok(
    byKey.has("wiki-export-drift-verify") || byKey.has("wiki-export-drift-review"),
    "export drift should be visible as either a clean verification task or a review task",
  );

  assert.ok(report.summary.tasks >= 6);
  assert.equal(report.summary.readOnly, report.summary.tasks);
  assert.equal(report.summary.writeCapable, 0);
  assert.equal(byKey.get("wiki-claim-extraction-review").metadata.lane, "claim-extraction");
  assert.equal(byKey.get("wiki-db-probe-plan-review").metadata.queryCount, 5);
});
