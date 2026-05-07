import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildTrendReport, renderMarkdown } from "./admin_effectivity_trend.mjs";
import { validateJsonSchema } from "./validate_ops_artifacts.mjs";

function audit({ generatedAt, runId, status = "pass", from = "slice-1", to = "slice-5", usefulness = 0.8, noOpRate = 0, toolInventoryFreshness = 1, workPacketOutcomeHealth = 1 }) {
  return {
    artifact: `output/ops/effectivity/${runId}.json`,
    audit: {
      schema: "studiobrain-admin-effectivity-audit.v1",
      generatedAt,
      runId,
      status,
      sliceWindow: { from, to, count: 5 },
      scores: {
        usefulness,
        verification: 1,
        noOpRate,
        blockedLaneClarity: 1,
        toolInventoryFreshness,
        workPacketOutcomeHealth,
      },
    },
  };
}

test("buildTrendReport summarizes recent admin effectivity audits", () => {
  const report = buildTrendReport(
    [
      audit({ generatedAt: "2026-05-07T10:00:00.000Z", runId: "audit-1", from: "slice-081", to: "slice-085", usefulness: 0.8 }),
      audit({ generatedAt: "2026-05-07T11:00:00.000Z", runId: "audit-2", from: "slice-086", to: "slice-090", usefulness: 0.9 }),
    ],
    { generatedAt: "2026-05-07T12:00:00.000Z", runId: "trend-test", limit: 10, auditDir: "output/ops/effectivity" },
  );

  assert.equal(report.schema, "studiobrain-admin-effectivity-trend.v1");
  assert.equal(report.status, "pass");
  assert.equal(report.summary.audits, 2);
  assert.equal(report.summary.latestStatus, "pass");
  assert.equal(report.summary.averageUsefulness, 0.85);
  assert.equal(report.trend.usefulnessDelta, 0.1);
  assert.equal(report.trend.fromSlice, "slice-081");
  assert.equal(report.trend.toSlice, "slice-090");
  assert.match(renderMarkdown(report), /Admin Effectivity Trend/);
});

test("buildTrendReport warns on degraded latest audit or regressions", () => {
  const report = buildTrendReport(
    [
      audit({ generatedAt: "2026-05-07T10:00:00.000Z", runId: "audit-1", usefulness: 0.95 }),
      audit({ generatedAt: "2026-05-07T11:00:00.000Z", runId: "audit-2", status: "warn", usefulness: 0.7, noOpRate: 0.2, toolInventoryFreshness: 0 }),
    ],
    { generatedAt: "2026-05-07T12:00:00.000Z", runId: "trend-warn", limit: 10 },
  );

  assert.equal(report.status, "warn");
  assert.ok(report.warnings.some((warning) => warning.includes("latest audit status")));
  assert.ok(report.warnings.some((warning) => warning.includes("usefulness declined")));
  assert.ok(report.warnings.some((warning) => warning.includes("no-op rate increased")));
  assert.ok(report.warnings.some((warning) => warning.includes("tool inventory freshness")));
});

test("buildTrendReport stays compatible with schema", () => {
  const report = buildTrendReport(
    [audit({ generatedAt: "2026-05-07T11:00:00.000Z", runId: "audit-schema" })],
    { generatedAt: "2026-05-07T12:00:00.000Z", runId: "trend-schema", limit: 1 },
  );
  const schema = JSON.parse(readFileSync("schemas/ops/admin-effectivity-trend.v1.schema.json", "utf8"));

  assert.deepEqual(validateJsonSchema(report, schema), []);
});
