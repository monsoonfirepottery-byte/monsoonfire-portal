import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildQualityReport, renderMarkdown } from "./work_packet_quality_lint.mjs";
import { validateJsonSchema } from "./validate_ops_artifacts.mjs";

const goodPacket = {
  schema: "studiobrain-ops-work-packet.v1",
  generatedAt: "2026-05-07T12:00:00.000Z",
  sourceSignalAudit: { status: "pass" },
  packets: [
    {
      packetId: "ops-wp-good",
      title: "[ops] Good packet",
      status: "ready",
      priority: "P1",
      suggestedBranchName: "codex/good-packet",
      suggestedPrTitle: "[ops] Good packet",
      safeNextStep: "Run the read-only validator and attach the generated artifact.",
      verification: ["Run validator.", "Confirm generated artifacts contain no secrets."],
      sourceSignals: [{ source: "backlog", status: "ready for implementation" }, { source: "a" }, { source: "b" }],
      constraints: {
        readOnlyFirst: true,
        noSecrets: true,
        noDataMutation: true,
      },
    },
  ],
};

test("buildQualityReport passes strong work packets", () => {
  const report = buildQualityReport(goodPacket, { generatedAt: "2026-05-07T12:10:00.000Z", runId: "quality-pass" });

  assert.equal(report.status, "pass");
  assert.equal(report.summary.packets, 1);
  assert.equal(report.summary.readyPackets, 1);
  assert.equal(report.findings.length, 0);
  assert.match(renderMarkdown(report), /Work Packet Quality Lint/);
});

test("buildQualityReport warns on weak operational packet fields", () => {
  const report = buildQualityReport(
    {
      ...goodPacket,
      packets: [
        {
          ...goodPacket.packets[0],
          title: "No area prefix",
          suggestedBranchName: "`codex/wrapped`",
          suggestedPrTitle: "`[ops] Wrapped`",
          safeNextStep: "Do it.",
          verification: ["Only one check."],
          sourceSignals: [{ source: "a" }],
        },
      ],
    },
    { generatedAt: "2026-05-07T12:10:00.000Z", runId: "quality-warn" },
  );

  assert.equal(report.status, "warn");
  assert.ok(report.findings.some((finding) => finding.code === "weak-title-area"));
  assert.ok(report.findings.some((finding) => finding.code === "markdown-wrapped-branch"));
  assert.ok(report.findings.some((finding) => finding.code === "weak-verification"));
});

test("buildQualityReport warns when backlog status looks stale", () => {
  const report = buildQualityReport(
    {
      ...goodPacket,
      packets: [
        {
          ...goodPacket.packets[0],
          sourceSignals: [
            { source: "backlog", status: "follow-up prepared in docs/ops/14-post-merge-verification.md" },
            { source: "fresh-admin-audit" },
            { source: "fresh-pr-stack-audit" },
          ],
        },
        {
          ...goodPacket.packets[0],
          packetId: "ops-wp-missing-status",
          title: "[ops] Missing status packet",
          sourceSignals: [
            { source: "backlog", status: "" },
            { source: "fresh-admin-audit" },
            { source: "fresh-pr-stack-audit" },
          ],
        },
      ],
    },
    { generatedAt: "2026-05-07T12:10:00.000Z", runId: "quality-stale-backlog" },
  );

  assert.equal(report.status, "warn");
  assert.equal(report.summary.staleBacklogPackets, 1);
  assert.equal(report.summary.missingBacklogStatusPackets, 1);
  assert.ok(report.findings.some((finding) => finding.code === "stale-backlog-status"));
  assert.ok(report.findings.some((finding) => finding.code === "missing-backlog-status"));
});

test("buildQualityReport fails duplicate ids and unsafe constraints", () => {
  const report = buildQualityReport(
    {
      ...goodPacket,
      packets: [
        goodPacket.packets[0],
        {
          ...goodPacket.packets[0],
          constraints: { readOnlyFirst: false, noSecrets: true, noDataMutation: true },
        },
      ],
    },
    { generatedAt: "2026-05-07T12:10:00.000Z", runId: "quality-fail" },
  );

  assert.equal(report.status, "fail");
  assert.ok(report.findings.some((finding) => finding.code === "duplicate-packet-id"));
  assert.ok(report.findings.some((finding) => finding.code === "unsafe-constraints"));
});

test("buildQualityReport stays compatible with schema", () => {
  const report = buildQualityReport(goodPacket, { generatedAt: "2026-05-07T12:10:00.000Z", runId: "quality-schema" });
  const schema = JSON.parse(readFileSync("schemas/ops/work-packet-quality-lint.v1.schema.json", "utf8"));

  assert.deepEqual(validateJsonSchema(report, schema), []);
});
