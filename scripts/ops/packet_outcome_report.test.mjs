import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildPacketOutcomeReport, renderMarkdown } from "./packet_outcome_report.mjs";
import { validateJsonSchema } from "./validate_ops_artifacts.mjs";

const workPacket = {
  schema: "studiobrain-ops-work-packet.v1",
  generatedAt: "2026-05-07T12:00:00.000Z",
  packets: [
    { packetId: "ops-wp-current", title: "[ops] Current packet", status: "ready", priority: "P1" },
    { packetId: "ops-wp-blocked", title: "[ops] Blocked packet", status: "approval_gated", priority: "P1" },
  ],
};

test("buildPacketOutcomeReport summarizes outcome health and orphaned packets", () => {
  const report = buildPacketOutcomeReport(
    {
      workPacket,
      outcomes: [
        { packetId: "ops-wp-current", outcome: "helpful", recordedAt: "2026-05-07T12:01:00.000Z", notes: "useful" },
        { packetId: "ops-wp-stale", outcome: "stale", recordedAt: "2026-05-07T12:02:00.000Z", notes: "old id" },
        { packetId: "ops-wp-blocked", outcome: "blocked", recordedAt: "2026-05-07T12:03:00.000Z", notes: "approval" },
      ],
    },
    {
      generatedAt: "2026-05-07T12:10:00.000Z",
      runId: "packet-outcome-test",
      outcomesPath: "output/ops/swarm/outcomes.jsonl",
      workPacketPath: "output/ops/swarm/latest-work-packet.json",
    },
  );

  assert.equal(report.schema, "studiobrain-ops-packet-outcome-report.v1");
  assert.equal(report.status, "warn");
  assert.equal(report.readOnly, true);
  assert.equal(report.outcomeSummary.total, 3);
  assert.equal(report.outcomeHealth.status, "warn");
  assert.equal(report.currentPacketWindow.packets, 2);
  assert.deepEqual(report.currentPacketWindow.packetIds, ["ops-wp-current", "ops-wp-blocked"]);
  assert.equal(report.orphanedLatestOutcomes.length, 1);
  assert.equal(report.orphanedLatestOutcomes[0].packetId, "ops-wp-stale");
  assert.equal(report.packetChurn.status, "pass");
  assert.equal(report.packetChurn.orphanedRate, 0.333);
  assert.match(renderMarkdown(report), /Orphaned Latest Outcomes/);
});

test("buildPacketOutcomeReport warns when latest outcomes mostly reference old packet ids", () => {
  const report = buildPacketOutcomeReport(
    {
      workPacket,
      outcomes: [
        { packetId: "ops-wp-old-1", outcome: "helpful", recordedAt: "2026-05-07T12:01:00.000Z" },
        { packetId: "ops-wp-old-2", outcome: "helpful", recordedAt: "2026-05-07T12:02:00.000Z" },
        { packetId: "ops-wp-old-3", outcome: "helpful", recordedAt: "2026-05-07T12:03:00.000Z" },
        { packetId: "ops-wp-current", outcome: "helpful", recordedAt: "2026-05-07T12:04:00.000Z" },
      ],
    },
    { generatedAt: "2026-05-07T12:10:00.000Z", runId: "packet-churn-test" },
  );

  assert.equal(report.status, "warn");
  assert.equal(report.packetChurn.status, "warn");
  assert.equal(report.packetChurn.resetRecommended, true);
  assert.equal(report.packetChurn.orphanedRate, 0.75);
  assert.match(renderMarkdown(report), /Reset recommended: true/);
});

test("buildPacketOutcomeReport stays compatible with schema", () => {
  const report = buildPacketOutcomeReport(
    { workPacket, outcomes: [] },
    { generatedAt: "2026-05-07T12:10:00.000Z", runId: "packet-outcome-test" },
  );
  const schema = JSON.parse(readFileSync("schemas/ops/packet-outcome-report.v1.schema.json", "utf8"));

  assert.deepEqual(validateJsonSchema(report, schema), []);
});
