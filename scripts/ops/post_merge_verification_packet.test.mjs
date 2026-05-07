import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildPostMergeVerificationPacket, renderMarkdown } from "./post_merge_verification_packet.mjs";
import { validateJsonSchema } from "./validate_ops_artifacts.mjs";

const doc = {
  exists: true,
  text: `# Ops Doctor Post-Merge Verification

## Current Approval Gates

| Gate | Why | Pre-check |
| --- | --- | --- |
| Future deploys | restarts service | guarded helper |
| Package updates | may reboot | backup evidence |
`,
};

const artifactValidation = {
  schema: "studiobrain-ops-artifact-schema-validation.v1",
  generatedAt: "2026-05-07T20:00:00.000Z",
  status: "pass",
  summary: { checks: 18, passed: 18, warned: 0, missing: 0, failed: 0 },
};

const workPacketQuality = {
  schema: "studiobrain-work-packet-quality-lint.v1",
  generatedAt: "2026-05-07T20:00:00.000Z",
  status: "pass",
  summary: {
    findings: 0,
    staleBacklogPackets: 0,
    missingBacklogStatusPackets: 0,
    readyPackets: 1,
    approvalGatedPackets: 7,
  },
};

const staleBacklog = {
  schema: "studiobrain-stale-backlog-packet-report.v1",
  generatedAt: "2026-05-07T20:00:00.000Z",
  status: "pass",
  summary: { candidates: 0, staleBacklogPackets: 0, missingBacklogStatusPackets: 0 },
};

const prStack = {
  schema: "studiobrain-ops-pr-stack-audit.v1",
  generatedAt: "2026-05-07T20:00:00.000Z",
  status: "warn",
  steeringDigest: {
    openLowerBound: 40,
    openCountExact: false,
    mergeReady: 0,
    mergeBlocked: 40,
    recommendedSteering: "do_not_merge_or_rebase_from_this_slice",
  },
};

test("buildPostMergeVerificationPacket summarizes current post-merge evidence", () => {
  const packet = buildPostMergeVerificationPacket(
    { doc, artifactValidation, workPacketQuality, staleBacklog, prStack },
    {
      generatedAt: "2026-05-07T20:01:00.000Z",
      runId: "post-merge-test",
      gitState: { branch: "codex/test", head: "abc1234", dirtyFiles: [] },
    },
  );

  assert.equal(packet.status, "warn");
  assert.equal(packet.summary.docExists, true);
  assert.equal(packet.summary.approvalGates, 2);
  assert.equal(packet.summary.workPacketQualityFindings, 0);
  assert.equal(packet.summary.staleBacklogCandidates, 0);
  assert.equal(packet.summary.prStackOpenLowerBound, 40);
  assert.ok(packet.warnings.some((warning) => warning.includes("no merge-ready PRs")));
  assert.match(renderMarkdown(packet), /Post-Merge Verification Packet/);
  assert.match(renderMarkdown(packet), /Approval gates: 2/);
});

test("buildPostMergeVerificationPacket fails when the durable doc is missing", () => {
  const packet = buildPostMergeVerificationPacket(
    { doc: { exists: false, text: "" }, artifactValidation, workPacketQuality, staleBacklog, prStack },
    {
      generatedAt: "2026-05-07T20:01:00.000Z",
      runId: "post-merge-missing-doc",
      gitState: { branch: "codex/test", head: "abc1234", dirtyFiles: [] },
    },
  );

  assert.equal(packet.status, "fail");
  assert.ok(packet.warnings.some((warning) => warning.includes("doc is missing")));
});

test("buildPostMergeVerificationPacket stays compatible with schema", () => {
  const packet = buildPostMergeVerificationPacket(
    { doc, artifactValidation, workPacketQuality, staleBacklog, prStack },
    {
      generatedAt: "2026-05-07T20:01:00.000Z",
      runId: "post-merge-schema",
      gitState: { branch: "codex/test", head: "abc1234", dirtyFiles: [] },
    },
  );
  const schema = JSON.parse(readFileSync("schemas/ops/post-merge-verification-packet.v1.schema.json", "utf8"));

  assert.deepEqual(validateJsonSchema(packet, schema), []);
});
