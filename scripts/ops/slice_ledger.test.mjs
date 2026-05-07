import test from "node:test";
import assert from "node:assert/strict";

import { auditCadence, summarize } from "./slice_ledger.mjs";

function row(id, status = "completed", runId = "run-a") {
  return {
    schema: "studiobrain-admin-slice-ledger.v1",
    sliceId: `slice-20260507-${String(id).padStart(3, "0")}`,
    runId,
    lane: "tooling",
    title: `Slice ${id}`,
    startedAt: `2026-05-07T00:${String(id).padStart(2, "0")}:00.000Z`,
    completedAt: `2026-05-07T00:${String(id).padStart(2, "0")}:30.000Z`,
    status,
    changedFiles: ["scripts/ops/x.mjs"],
    commands: [{ command: "node --check x.mjs", status: "pass" }],
    artifacts: [],
    usefulness: { score: 0.8, minutesSaved: 1, operatorSignal: "test" },
    noOp: { detected: status === "noop", reason: status === "noop" ? "test noop" : null },
    blocker: { class: null, owner: null, safeNextStep: null },
  };
}

test("auditCadence is due every five countable slices", () => {
  assert.deepEqual(auditCadence([], 5), {
    interval: 5,
    countedSlices: 0,
    slicesSinceLastAudit: 0,
    auditDue: false,
    nextAuditAt: 5,
    lastAuditSliceId: null,
  });
  assert.equal(auditCadence([1, 2, 3, 4].map(row), 5).auditDue, false);
  assert.equal(auditCadence([1, 2, 3, 4].map(row), 5).slicesSinceLastAudit, 4);
  assert.equal(auditCadence([1, 2, 3, 4, 5].map(row), 5).auditDue, true);
  assert.equal(auditCadence([1, 2, 3, 4, 5, 6].map(row), 5).nextAuditAt, 10);
});

test("auditCadence ignores no-op rows", () => {
  const cadence = auditCadence([row(1), row(2, "noop"), row(3), row(4), row(5), row(6)], 5);

  assert.equal(cadence.countedSlices, 5);
  assert.equal(cadence.auditDue, true);
});

test("auditCadence treats effectivity audit rows as cadence acknowledgements", () => {
  const audit = row(5);
  audit.title = "Run five-slice admin effectivity audit";
  audit.commands = [{ command: "node scripts/ops/admin_effectivity_audit.mjs --json --write", status: "pass" }];
  const acknowledged = auditCadence([row(1), row(2), row(3), row(4), audit], 5);
  const nextSlice = auditCadence([row(1), row(2), row(3), row(4), audit, row(6)], 5);

  assert.equal(acknowledged.auditDue, false);
  assert.equal(acknowledged.slicesSinceLastAudit, 0);
  assert.equal(acknowledged.lastAuditSliceId, "slice-20260507-005");
  assert.equal(acknowledged.nextAuditAt, 10);
  assert.equal(nextSlice.slicesSinceLastAudit, 1);
  assert.equal(nextSlice.nextAuditAt, 10);
});

test("summarize filters cadence by run id while preserving natural slice order", () => {
  const rows = [row(10, "completed", "other"), row(2), row(1), row(3), row(4), row(5)];
  rows.ledgerPath = "output/ops/effectivity/slice-ledger.jsonl";
  const summary = summarize(rows, 5, "run-a", 5);

  assert.equal(summary.window.from, "slice-20260507-001");
  assert.equal(summary.window.to, "slice-20260507-005");
  assert.equal(summary.auditCadence.countedSlices, 5);
  assert.equal(summary.auditCadence.auditDue, true);
});
