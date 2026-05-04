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
    "wiki-startup-pack-audit",
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
  for (const task of report.tasks.filter((entry) => entry.status === "ready")) {
    assert.equal(typeof task.safetyRationale, "string");
    assert.ok(task.safetyRationale.length > 20);
    assert.ok(task.outputArtifactPath, `${task.taskKey} should declare an output artifact path`);
  }
  assert.equal(byKey.get("wiki-context-pack-refresh").metadata.operatingLayerRole, "compiled_operating_layer");
  assert.equal(byKey.get("wiki-context-pack-refresh").metadata.memoryRelationship, "not_a_competing_memory_source");
  assert.equal(typeof byKey.get("wiki-context-pack-refresh").metadata.excludedWarningBacklogItems, "number");
  assert.equal(byKey.get("wiki-startup-pack-audit").metadata.lane, "startup-pack");
  assert.equal(byKey.get("wiki-startup-pack-audit").metadata.competitionRisk, "contained");
  assert.equal(byKey.get("wiki-claim-extraction-review").metadata.lane, "claim-extraction");
  assert.equal(byKey.get("wiki-db-probe-plan-review").metadata.queryCount, 5);
  assert.equal(byKey.get("wiki-db-probe-plan-review").metadata.staticVerification, "pass");
});
