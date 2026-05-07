import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildStaleBacklogPacketReport, renderMarkdown } from "./stale_backlog_packet_report.mjs";
import { validateJsonSchema } from "./validate_ops_artifacts.mjs";

const workPacket = {
  schema: "studiobrain-ops-work-packet.v1",
  generatedAt: "2026-05-07T19:30:00.000Z",
  nextExecutablePacket: { status: "none_ready" },
  packets: [
    {
      packetId: "ops-wp-stale",
      title: "[ops] Stale packet",
      priority: "P1",
      status: "approval_gated",
      humanGate: "Backlog status suggests this work is already merged.",
      safeNextStep: "Refresh the backlog item.",
      suggestedBranchName: "codex/stale",
      suggestedPrTitle: "[ops] Refresh stale packet",
      sourceSignals: [
        { source: "backlog", status: "follow-up prepared in docs", staleBacklogStatus: true },
      ],
    },
    {
      packetId: "ops-wp-missing",
      title: "[ops] Missing status packet",
      priority: "P2",
      status: "approval_gated",
      humanGate: "",
      safeNextStep: "Add status evidence.",
      suggestedBranchName: "codex/missing",
      suggestedPrTitle: "[ops] Add status evidence",
      sourceSignals: [
        { source: "backlog", status: "" },
      ],
    },
    {
      packetId: "ops-wp-good",
      title: "[ops] Fresh packet",
      priority: "P3",
      status: "ready",
      humanGate: "",
      safeNextStep: "Run the check.",
      sourceSignals: [
        { source: "backlog", status: "ready for implementation" },
      ],
    },
  ],
};

const quality = {
  schema: "studiobrain-work-packet-quality-lint.v1",
  generatedAt: "2026-05-07T19:31:00.000Z",
  status: "warn",
  summary: { staleBacklogPackets: 1, missingBacklogStatusPackets: 1 },
  findings: [
    {
      severity: "warn",
      code: "stale-backlog-status",
      packetId: "ops-wp-stale",
      title: "[ops] Stale packet",
      message: "Backlog status looks stale.",
    },
    {
      severity: "warn",
      code: "missing-backlog-status",
      packetId: "ops-wp-missing",
      title: "[ops] Missing status packet",
      message: "Backlog status is missing.",
    },
  ],
};

test("buildStaleBacklogPacketReport emits refresh and status-evidence candidates", () => {
  const report = buildStaleBacklogPacketReport(
    { workPacket, quality },
    { generatedAt: "2026-05-07T19:32:00.000Z", runId: "stale-backlog-test" },
  );

  assert.equal(report.status, "warn");
  assert.equal(report.summary.packets, 3);
  assert.equal(report.summary.candidates, 2);
  assert.equal(report.summary.staleBacklogPackets, 1);
  assert.equal(report.summary.missingBacklogStatusPackets, 1);
  assert.equal(report.summary.readyPackets, 1);
  assert.equal(report.candidates[0].suggestedAction, "refresh_or_retire_backlog_item");
  assert.equal(report.candidates[1].suggestedAction, "add_backlog_status_evidence");
  assert.match(report.candidates[0].issuePacket.title, /Refresh or retire stale backlog item/);
  assert.match(report.candidates[1].issuePacket.title, /Add backlog status evidence/);
  assert.ok(report.candidates[0].issuePacket.acceptanceCriteria.length >= 3);
  assert.ok(report.candidates[0].issuePacket.safetyNotes.some((note) => note.includes("Documentation-only")));
  assert.match(renderMarkdown(report), /Stale Backlog Packet Report/);
  assert.match(renderMarkdown(report), /ops-wp-stale/);
  assert.match(renderMarkdown(report), /Issue-Ready Action Packets/);
  assert.match(renderMarkdown(report), /## Acceptance Criteria/);
});

test("buildStaleBacklogPacketReport warns on missing sources", () => {
  const report = buildStaleBacklogPacketReport(
    { workPacket: { status: "missing" }, quality: { status: "invalid_json", parseError: "bad json" } },
    { generatedAt: "2026-05-07T19:32:00.000Z", runId: "stale-backlog-missing" },
  );

  assert.equal(report.status, "warn");
  assert.equal(report.summary.sourceWarnings, 2);
  assert.ok(report.sourceWarnings.some((warning) => warning.includes("missing")));
  assert.ok(report.sourceWarnings.some((warning) => warning.includes("bad json")));
});

test("buildStaleBacklogPacketReport stays compatible with schema", () => {
  const report = buildStaleBacklogPacketReport(
    { workPacket, quality },
    { generatedAt: "2026-05-07T19:32:00.000Z", runId: "stale-backlog-schema" },
  );
  const schema = JSON.parse(readFileSync("schemas/ops/stale-backlog-packet-report.v1.schema.json", "utf8"));

  assert.deepEqual(validateJsonSchema(report, schema), []);
});
