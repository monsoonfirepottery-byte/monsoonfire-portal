import test from "node:test";
import assert from "node:assert/strict";

import { runChiefOfStaffAudit } from "./lib/studiobrain-chief-of-staff-audit.mjs";

test("chief-of-staff audit passes end to end against the fixture runtime", async () => {
  const report = await runChiefOfStaffAudit({ writeReport: false, cleanupFixture: true });

  assert.equal(report.status, "passed");
  assert.equal(report.summary?.openLoopId, "room:portal");
  assert.equal(report.summary?.finalOpenLoopStatus, "delegated");
  assert.equal(report.summary?.checkinActions.includes("snooze"), true);
  assert.equal(report.summary?.checkinActions.includes("continue"), true);
  assert.equal(report.summary?.checkinActions.includes("redirect"), true);
  assert.equal(report.summary?.auditActions.includes("studio_ops.control_tower.partner_checkin"), true);
  assert.equal(report.summary?.auditActions.includes("studio_ops.control_tower.partner_open_loop_updated"), true);
  assert.equal(report.artifacts?.artifactOpenLoopStatus, "delegated");
  assert.equal(report.steps.every((step) => step.status === "passed"), true);
});
