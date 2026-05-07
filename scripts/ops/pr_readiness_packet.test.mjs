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
    staleBacklogPackets: 0,
    hostDriftStatus: "warn",
    hostDriftDirtyPaths: 3,
    hostDriftRequiresHumanApproval: 2,
    hostDriftDoNotTouchSecurityReview: 0,
    hostDriftSensitivePathNames: 0,
    hostDriftAllowlistStatus: "present",
    hostDriftExpiredAllowlistMatches: 0,
  },
  packets: [
    { packetId: "ops-wp-ready", title: "[ops] Refresh evidence", status: "ready", priority: "P1", humanGate: "" },
    { packetId: "ops-wp-gated", title: "[backup] Restore drill", status: "approval_gated", priority: "P0", humanGate: "human approval" },
  ],
  nextExecutablePacket: {
    status: "ready",
    packetId: "ops-wp-ready",
    title: "[ops] Refresh evidence",
    priority: "P1",
    risk: "low",
    recommendedOwner: "Codex",
    safeNextStep: "Run the evidence refresh.",
    suggestedBranchName: "codex/ops-refresh-evidence",
    suggestedPrTitle: "[ops] Refresh evidence",
    verification: ["Rerun packet generation", "Validate artifacts"],
    sourceSignalCount: 4,
    totalPackets: 2,
    approvalGatedCount: 1,
  },
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

const packetOutcomeReport = {
  schema: "studiobrain-ops-packet-outcome-report.v1",
  generatedAt: "2026-05-07T12:02:30.000Z",
  status: "pass",
  outcomeSummary: { total: 2 },
  outcomeHealth: { maturity: "warming_up", score: 1, warnings: [] },
  packetChurn: { orphanedRate: 0, resetRecommended: false },
};

const incidentBundle = {
  schema: "studio-brain-incident-bundle-v2.summary.v1",
  generatedAt: "2026-05-07T12:02:40.000Z",
  scope: "read_only_redacted_incident_evidence_v2",
  mode: "smoke",
  outputDir: "output/ops/incidents-v2/unit",
  postgresContainer: "studiobrain_postgres",
  postgresDatabase: "monsoonfire_studio_os",
  includeLogs: "0",
  reports: [
    { label: "versions", file: "versions.txt", status: "ok", exitCode: 0, bytes: 120 },
    { label: "journal_studio_brain", file: "journal_studio_brain.txt", status: "skipped", exitCode: 0, bytes: 80 },
  ],
};

const workPacketQuality = {
  schema: "studiobrain-work-packet-quality-lint.v1",
  generatedAt: "2026-05-07T12:02:45.000Z",
  runId: "work-packet-quality-test",
  status: "pass",
  readOnly: true,
  sources: { workPacket: "output/ops/swarm/latest-work-packet.json", generatedAt: "2026-05-07T12:01:00.000Z" },
  summary: {
    packets: 2,
    readyPackets: 1,
    approvalGatedPackets: 1,
    findings: 0,
    warnings: 0,
    failures: 0,
    staleBacklogPackets: 0,
    missingBacklogStatusPackets: 0,
    sourceSignalAuditStatus: "pass",
  },
  findings: [],
};

const prStackAudit = {
  schema: "studiobrain-ops-pr-stack-audit.v1",
  generatedAt: "2026-05-07T12:02:50.000Z",
  status: "warn",
  steeringDigest: {
    status: "blocked",
    openCountExact: false,
    openLowerBound: 40,
    openLimitReached: true,
    mergeReady: 0,
    mergeBlocked: 40,
    nextMergeCandidate: null,
    recommendedSteering: "do_not_merge_or_rebase_from_this_slice",
    notes: ["Open PR count reached one or more collection limits; treat openLowerBound as a lower bound."],
    blockedStackLanes: [
      {
        repoId: "portal",
        count: 20,
        bottomPr: 651,
        bottomHead: "codex/ops-packet-outcome-pressure-wave2",
        tipPr: 670,
        tipHead: "codex/ops-incident-bundle-readiness-wave2",
        openLimitReached: true,
        commonBlockers: ["draft", "merge_state_unknown", "base_pr_open"],
        recommendedSteering: "do_not_merge_or_rebase_from_this_slice",
      },
    ],
  },
  summary: { open: 40, openCountExact: false, openLowerBound: 40, mergeReady: 0, mergeBlocked: 40 },
  warnings: ["portal open PR collection reached limit 40"],
};

const staleBacklogReport = {
  schema: "studiobrain-stale-backlog-packet-report.v1",
  generatedAt: "2026-05-07T12:02:55.000Z",
  status: "warn",
  summary: {
    packets: 2,
    candidates: 2,
    staleBacklogPackets: 1,
    missingBacklogStatusPackets: 1,
    readyPackets: 0,
    approvalGatedPackets: 2,
    nextExecutableStatus: "none_ready",
    sourceWarnings: 0,
  },
  candidates: [
    {
      packetId: "ops-wp-stale",
      title: "[ops] Stale packet",
      priority: "P1",
      suggestedAction: "refresh_or_retire_backlog_item",
    },
    {
      packetId: "ops-wp-missing",
      title: "[ops] Missing status packet",
      priority: "P2",
      suggestedAction: "add_backlog_status_evidence",
    },
  ],
  sourceWarnings: [],
};

const postMergeVerification = {
  schema: "studiobrain-post-merge-verification-packet.v1",
  generatedAt: "2026-05-07T12:04:00.000Z",
  status: "warn",
  summary: {
    approvalGates: 5,
    dirtyFiles: 0,
    workPacketQualityFindings: 0,
    staleBacklogCandidates: 2,
    prStackOpenLowerBound: 40,
    prStackMergeReady: 0,
    recommendedSteering: "do_not_merge_or_rebase_from_this_slice",
  },
  warnings: ["PR stack has no merge-ready PRs in the latest steering digest"],
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
    { gitState, artifactValidation, incidentBundle, waveRunner, workPacket, workPacketQuality, prStackAudit, staleBacklogReport, postMergeVerification, packetOutcomeReport, sliceLedger, toolInstallRecommendations },
    { generatedAt: "2026-05-07T12:10:00.000Z", pr: "#123", sliceIds: "slice-046,slice-047", packetId: "ops-wp-ready" },
  );

  assert.equal(packet.schema, "studiobrain-ops-pr-readiness-packet.v1");
  assert.equal(packet.readOnly, true);
  assert.equal(packet.status, "warn");
  assert.equal(packet.evidence.artifactValidation.status, "pass");
  assert.equal(packet.evidence.waveRunner.workPacketMaxPackets, 8);
  assert.equal(packet.evidence.workPacket.freshSources, 5);
  assert.equal(packet.evidence.workPacket.readyPackets, 1);
  assert.equal(packet.evidence.workPacket.approvalGatedPackets, 1);
  assert.equal(packet.evidence.workPacket.nextExecutablePacket.packetId, "ops-wp-ready");
  assert.equal(packet.evidence.workPacket.nextExecutablePacket.suggestedBranchName, "codex/ops-refresh-evidence");
  assert.equal(packet.evidence.workPacket.nextExecutablePacket.verification.length, 2);
  assert.equal(packet.evidence.packetOutcome.status, "pass");
  assert.equal(packet.evidence.packetOutcome.total, 2);
  assert.equal(packet.evidence.incidentBundle.status, "present");
  assert.equal(packet.evidence.incidentBundle.mode, "smoke");
  assert.equal(packet.evidence.incidentBundle.reports, 2);
  assert.equal(packet.evidence.incidentBundle.skippedReports, 1);
  assert.equal(packet.evidence.sliceLedger.requestedCoverage.status, "covered");
  assert.deepEqual(packet.evidence.sliceLedger.requestedCoverage.covered, ["slice-046", "slice-047"]);
  assert.equal(packet.outcomeLedger.packetId, "ops-wp-ready");
  assert.equal(packet.outcomeLedger.packetIdInSuggestedWindow, true);
  assert.equal(packet.outcomeLedger.validationStatus, "suggested");
  assert.ok(packet.outcomeLedger.suggestedPacketIds.includes("ops-wp-gated"));
  assert.match(packet.outcomeLedger.recordCommand, /--record-outcome ops-wp-ready/);
  assert.equal(packet.evidence.workPacket.effectivityEvidenceLanes, 4);
  assert.equal(packet.evidence.workPacket.staleBacklogPackets, 0);
  assert.equal(packet.evidence.workPacket.effectivityApprovalRequiredLanes, 1);
  assert.equal(packet.evidence.workPacket.effectivityHighSeverityLanes, 1);
  assert.equal(packet.evidence.workPacket.hostDriftStatus, "warn");
  assert.equal(packet.evidence.workPacket.hostDriftDirtyPaths, 3);
  assert.equal(packet.evidence.workPacket.hostDriftRequiresHumanApproval, 2);
  assert.equal(packet.evidence.workPacket.hostDriftAllowlistStatus, "present");
  assert.equal(packet.evidence.workPacketQuality.status, "pass");
  assert.equal(packet.evidence.workPacketQuality.findings, 0);
  assert.equal(packet.evidence.prStack.status, "warn");
  assert.equal(packet.evidence.prStack.openCountExact, false);
  assert.equal(packet.evidence.prStack.openLowerBound, 40);
  assert.equal(packet.evidence.prStack.blockedStackLanes.length, 1);
  assert.equal(packet.evidence.staleBacklog.candidates, 2);
  assert.equal(packet.evidence.staleBacklog.staleBacklogPackets, 1);
  assert.equal(packet.evidence.staleBacklog.missingBacklogStatusPackets, 1);
  assert.equal(packet.evidence.postMergeVerification.approvalGates, 5);
  assert.equal(packet.evidence.postMergeVerification.staleBacklogCandidates, 2);
  assert.equal(packet.evidence.toolInstall.installNowCandidates, 2);
  assert.equal(packet.evidence.toolInstall.approvalRequired, 1);
  assert.ok(packet.warnings.some((warning) => warning.includes("require approval")));

  const markdown = renderMarkdown(packet);
  assert.match(markdown, /Tool Recommendation Summary/);
  assert.match(markdown, /Work Packet Window/);
  assert.match(markdown, /Next Executable Packet/);
  assert.match(markdown, /Outcome Ledger/);
  assert.match(markdown, /Packet outcomes/);
  assert.match(markdown, /Incident bundle v2/);
  assert.match(markdown, /mode=smoke/);
  assert.match(markdown, /reports=2/);
  assert.match(markdown, /Work packet quality/);
  assert.match(markdown, /sourceSignalAudit=pass/);
  assert.match(markdown, /PR stack/);
  assert.match(markdown, /openLowerBound=40/);
  assert.match(markdown, /do_not_merge_or_rebase_from_this_slice/);
  assert.match(markdown, /Stale backlog packets/);
  assert.match(markdown, /candidates=2/);
  assert.match(markdown, /Post-merge verification/);
  assert.match(markdown, /approvalGates=5/);
  assert.match(markdown, /ops-wp-ready/);
  assert.match(markdown, /Run the evidence refresh/);
  assert.match(markdown, /codex\/ops-refresh-evidence/);
  assert.match(markdown, /--record-outcome ops-wp-ready/);
  assert.match(markdown, /workPacketMaxPackets=8/);
  assert.match(markdown, /ready=1/);
  assert.match(markdown, /approvalGated=1/);
  assert.match(markdown, /staleBacklog=0/);
  assert.match(markdown, /requestedCoverage=covered/);
  assert.match(markdown, /lanes=4/);
  assert.match(markdown, /approvalLanes=1/);
  assert.match(markdown, /hostDrift=warn/);
  assert.match(markdown, /hostDriftDirty=3/);
  assert.match(markdown, /hostDriftApproval=2/);
  assert.match(markdown, /shellcheck/);
  assert.doesNotMatch(markdown, /do not copy this/);
  assert.doesNotMatch(markdown, /do not install Docker/);
});

test("buildPrReadinessPacket warns when incident bundle reports fail", () => {
  const packet = buildPrReadinessPacket({
    gitState,
    artifactValidation,
    incidentBundle: {
      ...incidentBundle,
      mode: "full",
      reports: [
        ...incidentBundle.reports,
        { label: "docker", file: "docker.txt", status: "check_failed", exitCode: 1, bytes: 48 },
      ],
    },
    waveRunner,
    workPacket,
    workPacketQuality,
    packetOutcomeReport,
    sliceLedger,
    toolInstallRecommendations: { ...toolInstallRecommendations, summary: { recommendations: 1, installNowCandidates: 0, approvalRequired: 0 } },
  });

  assert.equal(packet.status, "warn");
  assert.equal(packet.evidence.incidentBundle.status, "warn");
  assert.equal(packet.evidence.incidentBundle.failedReports, 1);
  assert.ok(packet.warnings.some((warning) => warning.includes("incident bundle v2 has 1 failed report")));
  assert.match(renderMarkdown(packet), /Incident bundle v2 \| warn/);
});

test("buildPrReadinessPacket warns when requested packet id is outside the latest window", () => {
  const packet = buildPrReadinessPacket(
    { gitState, artifactValidation, waveRunner, workPacket, workPacketQuality, prStackAudit, staleBacklogReport, postMergeVerification, packetOutcomeReport, sliceLedger, toolInstallRecommendations },
    { generatedAt: "2026-05-07T12:10:00.000Z", packetId: "ops-wp-stale" },
  );

  assert.equal(packet.status, "warn");
  assert.equal(packet.outcomeLedger.packetId, "ops-wp-stale");
  assert.equal(packet.outcomeLedger.packetIdInSuggestedWindow, false);
  assert.equal(packet.outcomeLedger.validationStatus, "outside_window");
  assert.ok(packet.warnings.some((warning) => warning.includes("not in the latest suggested packet window")));
  assert.match(renderMarkdown(packet), /Packet ID validation: outside_window/);
});

test("buildPrReadinessPacket warns when requested slice ids are outside the latest slice-ledger window", () => {
  const packet = buildPrReadinessPacket(
    { gitState, artifactValidation, waveRunner, workPacket, workPacketQuality, prStackAudit, staleBacklogReport, postMergeVerification, packetOutcomeReport, sliceLedger, toolInstallRecommendations },
    { generatedAt: "2026-05-07T12:10:00.000Z", sliceIds: "slice-20260507-076,slice-20260507-077" },
  );

  assert.equal(packet.status, "warn");
  assert.equal(packet.evidence.sliceLedger.requestedCoverage.status, "outside_window");
  assert.deepEqual(packet.evidence.sliceLedger.requestedCoverage.missing, ["slice-20260507-076", "slice-20260507-077"]);
  assert.ok(packet.warnings.some((warning) => warning.includes("slice ids outside latest slice-ledger window")));
  assert.match(renderMarkdown(packet), /requestedCoverage=outside_window/);
  assert.match(renderMarkdown(packet), /slice-20260507-076/);
});

test("buildPrReadinessPacket surfaces degraded packet outcome churn", () => {
  const packet = buildPrReadinessPacket({
    gitState,
    artifactValidation,
    waveRunner,
    workPacket,
    workPacketQuality,
    packetOutcomeReport: {
      ...packetOutcomeReport,
      status: "warn",
      outcomeSummary: { total: 4 },
      outcomeHealth: { maturity: "evidence_ready", score: 0.55, warnings: ["blockedPackets=1"] },
      packetChurn: { orphanedRate: 0.75, resetRecommended: true },
    },
    sliceLedger,
    toolInstallRecommendations: { ...toolInstallRecommendations, summary: { recommendations: 1, installNowCandidates: 0, approvalRequired: 0 } },
  });

  assert.equal(packet.status, "warn");
  assert.equal(packet.evidence.packetOutcome.status, "warn");
  assert.equal(packet.evidence.packetOutcome.orphanedRate, 0.75);
  assert.equal(packet.evidence.packetOutcome.resetRecommended, true);
  assert.ok(packet.warnings.some((warning) => warning.includes("packet outcome report has warnings")));
  assert.ok(packet.warnings.some((warning) => warning.includes("blockedPackets=1")));
  assert.ok(packet.warnings.some((warning) => warning.includes("recording fresh current packet outcomes")));
  assert.match(renderMarkdown(packet), /orphanedRate=0.75/);
});

test("buildPrReadinessPacket warns on host drift security review gates", () => {
  const packet = buildPrReadinessPacket({
    gitState,
    artifactValidation,
    waveRunner,
    workPacket: {
      ...workPacket,
      evidenceSummary: {
        ...workPacket.evidenceSummary,
        hostDriftDoNotTouchSecurityReview: 1,
        hostDriftExpiredAllowlistMatches: 2,
      },
    },
    workPacketQuality,
    packetOutcomeReport,
    sliceLedger,
    toolInstallRecommendations: { ...toolInstallRecommendations, summary: { recommendations: 1, installNowCandidates: 0, approvalRequired: 0 } },
  });

  assert.equal(packet.status, "warn");
  assert.equal(packet.evidence.workPacket.hostDriftDoNotTouchSecurityReview, 1);
  assert.equal(packet.evidence.workPacket.hostDriftExpiredAllowlistMatches, 2);
  assert.ok(packet.warnings.some((warning) => warning.includes("host-drift allowlist")));
  assert.ok(packet.warnings.some((warning) => warning.includes("security review")));
  assert.match(renderMarkdown(packet), /hostDriftSecurity=1/);
});

test("buildPrReadinessPacket fails when work-packet quality lint fails", () => {
  const packet = buildPrReadinessPacket({
    gitState,
    artifactValidation,
    waveRunner,
    workPacket,
    workPacketQuality: {
      ...workPacketQuality,
      status: "fail",
      summary: { ...workPacketQuality.summary, findings: 1, warnings: 0, failures: 1 },
      findings: [
        {
          severity: "fail",
          code: "unsafe-constraints",
          packetId: "ops-wp-ready",
          title: "[ops] Refresh evidence",
          message: "Packet constraints must preserve read-only-first defaults.",
        },
      ],
    },
    packetOutcomeReport,
    sliceLedger,
    toolInstallRecommendations: { ...toolInstallRecommendations, summary: { recommendations: 1, installNowCandidates: 0, approvalRequired: 0 } },
  });

  assert.equal(packet.status, "fail");
  assert.equal(packet.evidence.workPacketQuality.failures, 1);
  assert.ok(packet.warnings.some((warning) => warning.includes("work-packet quality lint status is fail")));
  assert.ok(packet.warnings.some((warning) => warning.includes("unsafe-constraints")));
  assert.match(renderMarkdown(packet), /Work packet quality \| fail/);
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
    workPacketQuality,
    packetOutcomeReport,
    sliceLedger,
    toolInstallRecommendations: { ...toolInstallRecommendations, summary: { recommendations: 1, installNowCandidates: 0, approvalRequired: 0 } },
  });

  assert.equal(packet.status, "warn");
  assert.ok(packet.warnings.some((warning) => warning.includes("dry-run plan")));
  assert.ok(packet.warnings.some((warning) => warning.includes("more packets than the wave runner packet window")));
});

test("buildPrReadinessPacket stays compatible with its JSON schema", () => {
  const packet = buildPrReadinessPacket(
    { gitState, artifactValidation, waveRunner, workPacket, workPacketQuality, prStackAudit, staleBacklogReport, postMergeVerification, packetOutcomeReport, sliceLedger, toolInstallRecommendations },
    { generatedAt: "2026-05-07T12:10:00.000Z", pr: "#123", sliceIds: "slice-046,slice-047", packetId: "ops-wp-ready" },
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
    workPacketQuality,
    packetOutcomeReport,
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
    workPacketQuality,
    packetOutcomeReport,
    sliceLedger,
    toolInstallRecommendations: { ...toolInstallRecommendations, summary: { recommendations: 1, installNowCandidates: 0, approvalRequired: 0 } },
  });

  assert.equal(packet.status, "warn");
  assert.ok(packet.warnings.some((warning) => warning.includes("dirty file")));
});
