import test from "node:test";
import assert from "node:assert/strict";

import { buildDraftBinding, stampReportIntegrity, validateReportIntegrity } from "./planning-live-swarm.mjs";

test("planning live swarm integrity helpers bind the report to the submitted draft", () => {
  const payload = {
    sourceType: "draft-plan",
    requestedBy: "tester",
    draftPlan: `# Draft Plan

## Objective
- Sentinel wrapper draft for council integrity.

## Steps
1. Prepare the live swarm.
2. Complete the packet.
`,
  };
  const integrity = buildDraftBinding(payload, {
    preparedRunId: "planning_council_sentinel",
    draftFingerprint: "draft_fp_sentinel",
    reportCorrelationId: "report_corr_sentinel",
  });
  const report = stampReportIntegrity({
    schema: "planning-live-swarm-report.v1",
    mode: "live_codex_cli",
    preparedRunId: "planning_council_sentinel",
    packet: {
      packetId: "human_packet_sentinel",
      objective: "Sentinel wrapper draft for council integrity.",
    },
  }, integrity, { canaryGate: "matched" });

  const validation = validateReportIntegrity(report, integrity);
  assert.equal(validation.ok, true);
  assert.equal(report.packet.wrapperIntegrity.requestId, integrity.requestId);
  assert.equal(report.packet.wrapperIntegrity.draftFingerprint, "draft_fp_sentinel");
  assert.equal(report.wrapperIntegrity.reportCorrelationId, "report_corr_sentinel");
});

test("planning live swarm integrity helpers detect stale unrelated packets", () => {
  const expected = {
    requestId: "req_expected",
    draftFingerprint: "draft_expected",
    preparedRunId: "planning_council_expected",
    submittedObjective: "Council wrapper integrity objective",
    submittedSourceType: "draft-plan",
    reportCorrelationId: "report_expected",
  };
  const report = {
    schema: "planning-live-swarm-report.v1",
    mode: "live_codex_cli",
    preparedRunId: "planning_council_other",
    packet: {
      packetId: "human_packet_other",
      objective: "Unrelated stale objective",
      wrapperIntegrity: {
        requestId: "req_other",
        draftFingerprint: "draft_other",
        preparedRunId: "planning_council_other",
        submittedObjective: "Unrelated stale objective",
      },
    },
  };

  const validation = validateReportIntegrity(report, expected);
  assert.equal(validation.ok, false);
  assert.match(validation.issues.join(" | "), /requestId mismatch/i);
  assert.match(validation.issues.join(" | "), /draftFingerprint mismatch/i);
  assert.match(validation.issues.join(" | "), /packet objective mismatch/i);
});
