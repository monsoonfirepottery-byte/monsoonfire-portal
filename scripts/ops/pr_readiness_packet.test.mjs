import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildPrReadinessPacket, renderMarkdown } from "./pr_readiness_packet.mjs";
import { validateJsonSchema } from "./validate_ops_artifacts.mjs";

const gitState = {
  base: "origin/main",
  branch: "codex/ops-test",
  head: "abc1234",
  changedFiles: ["scripts/ops/example.mjs"],
  dirtyFiles: [],
};

const artifactValidation = {
  schema: "studiobrain-ops-artifact-schema-validation.v1",
  generatedAt: "2026-05-07T12:00:00.000Z",
  status: "pass",
  summary: { checks: 4, passed: 4, warned: 0, missing: 0, failed: 0 },
  checks: [],
};

const workPacket = {
  schema: "studiobrain-ops-work-packet.v1",
  generatedAt: "2026-05-07T12:01:00.000Z",
  evidenceSummary: {
    freshSources: 5,
    staleSources: 0,
    toolInstallNowCandidates: 2,
    toolInstallApprovalRequired: 1,
    effectivityEvidenceLanes: 4,
    effectivityApprovalRequiredLanes: 1,
    effectivityHighSeverityLanes: 1,
  },
  packets: [
    { title: "[ops] Refresh evidence", status: "ready", priority: "P1", humanGate: "" },
    { title: "[backup] Restore drill", status: "approval_gated", priority: "P0", humanGate: "human approval" },
  ],
};

const waveRunner = {
  schema: "studiobrain-ops-wave-runner.v1",
  generatedAt: "2026-05-07T12:00:30.000Z",
  runId: "ops-wave-test",
  status: "warn",
  plan: [
    {
      id: "work-packet",
      command: "node scripts/studiobrain-ops-work-packet.mjs --json --write --max-packets 8",
    },
  ],
  receipts: [],
};

const sliceLedger = {
  schema: "studiobrain-admin-slice-ledger-summary.v1",
  generatedAt: "2026-05-07T12:02:00.000Z",
  window: { from: "slice-046", to: "slice-047", count: 2 },
  counts: { failed: 0, commandFailures: 0 },
  scores: { usefulness: 0.88, verification: 1 },
};

const toolInstallRecommendations = {
  schema: "studiobrain-ops-tool-install-recommendations.v1",
  generatedAt: "2026-05-07T12:03:00.000Z",
  status: "warn",
  summary: { recommendations: 7, installNowCandidates: 2, approvalRequired: 1 },
  recommendations: [
    {
      tool: "shellcheck",
      priority: "P1",
      acquisitionClass: "ephemeral-runner",
      validationCommand: "node scripts/ops/tooling_quality_report.mjs --mode shellcheck --allow-install --json --write",
      installCommand: "do not copy this into readiness markdown",
      approvalRequired: false,
    },
    {
      tool: "docker",
      priority: "P2",
      acquisitionClass: "remote-lane",
      validationCommand: "node scripts/ops/tooling_quality_report.mjs --mode compose-config --json --write",
      installCommand: "do not install Docker from a packet",
      approvalRequired: true,
    },
  ],
};

test("buildPrReadinessPacket summarizes current evidence without executable install commands", () => {
  const packet = buildPrReadinessPacket(
    { gitState, artifactValidation, waveRunner, workPacket, sliceLedger, toolInstallRecommendations },
    { generatedAt: "2026-05-07T12:10:00.000Z", pr: "#123", sliceIds: "slice-046,slice-047" },
  );

  assert.equal(packet.schema, "studiobrain-ops-pr-readiness-packet.v1");
  assert.equal(packet.readOnly, true);
  assert.equal(packet.status, "warn");
  assert.equal(packet.evidence.artifactValidation.status, "pass");
  assert.equal(packet.evidence.waveRunner.workPacketMaxPackets, 8);
  assert.equal(packet.evidence.workPacket.freshSources, 5);
  assert.equal(packet.evidence.workPacket.readyPackets, 1);
  assert.equal(packet.evidence.workPacket.approvalGatedPackets, 1);
  assert.equal(packet.evidence.workPacket.effectivityEvidenceLanes, 4);
  assert.equal(packet.evidence.workPacket.effectivityApprovalRequiredLanes, 1);
  assert.equal(packet.evidence.workPacket.effectivityHighSeverityLanes, 1);
  assert.equal(packet.evidence.toolInstall.installNowCandidates, 2);
  assert.equal(packet.evidence.toolInstall.approvalRequired, 1);
  assert.ok(packet.warnings.some((warning) => warning.includes("require approval")));

  const markdown = renderMarkdown(packet);
  assert.match(markdown, /Tool Recommendation Summary/);
  assert.match(markdown, /Work Packet Window/);
  assert.match(markdown, /workPacketMaxPackets=8/);
  assert.match(markdown, /ready=1/);
  assert.match(markdown, /approvalGated=1/);
  assert.match(markdown, /lanes=4/);
  assert.match(markdown, /approvalLanes=1/);
  assert.match(markdown, /shellcheck/);
  assert.doesNotMatch(markdown, /do not copy this/);
  assert.doesNotMatch(markdown, /do not install Docker/);
});

test("buildPrReadinessPacket warns when dry-run wave evidence mismatches packet count", () => {
  const packet = buildPrReadinessPacket({
    gitState,
    artifactValidation,
    waveRunner: {
      ...waveRunner,
      status: "planned",
      plan: [{ id: "work-packet", command: "node scripts/studiobrain-ops-work-packet.mjs --json --write --max-packets 1" }],
    },
    workPacket,
    sliceLedger,
    toolInstallRecommendations: { ...toolInstallRecommendations, summary: { recommendations: 1, installNowCandidates: 0, approvalRequired: 0 } },
  });

  assert.equal(packet.status, "warn");
  assert.ok(packet.warnings.some((warning) => warning.includes("dry-run plan")));
  assert.ok(packet.warnings.some((warning) => warning.includes("more packets than the wave runner packet window")));
});

test("buildPrReadinessPacket stays compatible with its JSON schema", () => {
  const packet = buildPrReadinessPacket(
    { gitState, artifactValidation, waveRunner, workPacket, sliceLedger, toolInstallRecommendations },
    { generatedAt: "2026-05-07T12:10:00.000Z", pr: "#123", sliceIds: "slice-046,slice-047" },
  );
  const schema = JSON.parse(readFileSync("schemas/ops/pr-readiness-packet.v1.schema.json", "utf8"));

  assert.deepEqual(validateJsonSchema(packet, schema), []);
});

test("buildPrReadinessPacket fails on failing artifact validation", () => {
  const packet = buildPrReadinessPacket({
    gitState,
    artifactValidation: {
      ...artifactValidation,
      status: "fail",
      summary: { checks: 4, passed: 3, warned: 0, missing: 0, failed: 1 },
      checks: [{ id: "work-packet", status: "fail" }],
    },
    waveRunner,
    workPacket,
    sliceLedger,
    toolInstallRecommendations: { ...toolInstallRecommendations, summary: { recommendations: 1, installNowCandidates: 0, approvalRequired: 0 } },
  });

  assert.equal(packet.status, "fail");
  assert.deepEqual(packet.evidence.artifactValidation.problems, ["work-packet: fail"]);
});

test("buildPrReadinessPacket warns on dirty local state", () => {
  const packet = buildPrReadinessPacket({
    gitState: { ...gitState, dirtyFiles: [" M scripts/ops/example.mjs"] },
    artifactValidation,
    waveRunner,
    workPacket,
    sliceLedger,
    toolInstallRecommendations: { ...toolInstallRecommendations, summary: { recommendations: 1, installNowCandidates: 0, approvalRequired: 0 } },
  });

  assert.equal(packet.status, "warn");
  assert.ok(packet.warnings.some((warning) => warning.includes("dirty file")));
});
