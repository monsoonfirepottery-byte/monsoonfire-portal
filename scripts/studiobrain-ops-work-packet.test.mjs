import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildOpsWorkPacket, comparePackets, runOpsWorkPacket, summarizeFreshEvidence, workPacketReportStatus } from "./studiobrain-ops-work-packet.mjs";

const packetSchema = JSON.parse(readFileSync(resolve("schemas/ops/ops-work-packet.v1.schema.json"), "utf8"));
const reportSchema = JSON.parse(readFileSync(resolve("schemas/ops/ops-work-packet-report.v1.schema.json"), "utf8"));

function assertWorkPacketContract(report) {
  for (const key of packetSchema.required) assert.ok(Object.hasOwn(report, key), `missing ${key}`);
  assert.equal(report.schema, packetSchema.properties.schema.const);
  assert.equal(report.constraints.readOnlyFirst, true);
  assert.equal(report.constraints.noSecrets, true);
  for (const key of packetSchema.properties.evidenceSummary.required) {
    assert.ok(Object.hasOwn(report.evidenceSummary, key), `missing evidenceSummary.${key}`);
  }
  for (const packet of report.packets) {
    assert.ok(packet.packetId.startsWith("ops-wp-"));
    assert.equal(packet.constraints.readOnlyFirst, true);
    assert.equal(packet.constraints.noDataMutation, true);
  }
}

function assertWorkPacketReportContract(report) {
  for (const key of reportSchema.required) assert.ok(Object.hasOwn(report, key), `missing ${key}`);
  assert.equal(report.schema, reportSchema.properties.schema.const);
  assert.ok(["pass", "warn", "fail"].includes(report.status));
  assertWorkPacketContract(report.packet);
  for (const key of reportSchema.properties.outcomeSummary.required) {
    assert.ok(Object.hasOwn(report.outcomeSummary, key), `missing outcomeSummary.${key}`);
  }
}

function silenceStdout(callback) {
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  try {
    return callback();
  } finally {
    process.stdout.write = originalWrite;
  }
}

const riskMarkdown = `
# Studio Brain Risk Register

## High

### Backup Evidence Is Split And Restore Confidence Is Incomplete

- Affected component: backups, restore posture, PostgreSQL/Redis/MinIO data.
- Evidence: backup timer runs but PostgreSQL dump, Redis state, and MinIO data are not proven.
- Likely impact: operators may believe full service backups are fresh while restore exposure is unknown.
- Recommended action: unify backup evidence into one current manifest.
- Safe next step: rerun make ops-backup-evidence, then run a non-destructive restore-prerequisite drill against a disposable target.
- PR can address it: yes, for documentation and read-only verification scripts.

## Medium

### Several System Units Are Failed

- Affected component: base OS hygiene.
- Evidence: failed-unit classifier shows dailyaidecheck, livepatch, and network-online failures.
- Likely impact: integrity scanning and livepatch reporting may be unreliable.
- Recommended action: inspect each unit's journal.
- Safe next step: run bash scripts/ops/ubuntu_failed_units.sh and inspect journals under a privileged read.
- PR can address it: documentation and diagnostics only.
`;

const backlogMarkdown = `
# Studio Brain Ops Kanban Backlog

## Now

### [backup] Unify backup evidence and restore confidence

- Type: reliability, database, capacity
- Priority: P0
- Effort: M
- Risk: low for diagnostics, high for any backup-path change
- Status: backup evidence scripts and docs are merged; restore confidence still needs an approval-gated drill.
- Acceptance criteria:
  - Backup report distinguishes config archives, PostgreSQL dump, Redis state, MinIO data, and restore drill status.
  - Latest backup evidence is current within the documented threshold.
- Recommended owner: Codex, DBA review
- Suggested branch name: codex/ops-backup-evidence
- Suggested PR title: [ops] Add Studio Brain backup evidence and restore drill report

### [ubuntu] Triage apt OOM and failed system units

- Type: ubuntu, security, reliability
- Priority: P1
- Effort: M
- Risk: low for diagnostics, medium for package changes
- Status: diagnostic scripts and maintenance workflow are merged; package remediation remains approval-gated.
- Acceptance criteria:
  - Failed units have disposition: repair, disable intentionally, or ignore with reason.
- Recommended owner: human, Codex
`;

const effectivityMarkdown = `
# Studio Brain Administrator Effectivity Audit

## Remaining Approval Gates

- Prove PostgreSQL dump backup and restore drill against a disposable target.
- Privileged review of AIDE, Livepatch, and network-online failed-unit journals.

## Next Safe Slices

1. Add a restore-prerequisite drill packet that proves PostgreSQL dump presence without restoring over production.
2. Add a failed-unit trend artifact so the classifier can distinguish old unchanged failures from new regressions.
`;

const freshInputs = {
  adminAudit: {
    schema: "studiobrain-admin-effectivity-audit.v1",
    generatedAt: "2026-05-07T08:45:48.780Z",
    status: "pass",
    sliceWindow: { from: "slice-016", to: "slice-020", count: 5 },
    scores: { usefulness: 0.814, verification: 1, noOpRate: 0 },
    sections: {
      effectivityReport: {
        report: {
          sections: {
            privilegedEvidence: { status: "sudo_unavailable" },
          },
          evidenceLanes: [
            {
              id: "backup_confidence",
              status: "warn",
              severity: "high",
              approvalRequired: false,
              safeNextStep: "Refresh backup evidence before backup changes.",
            },
            {
              id: "privileged_evidence",
              status: "sudo_unavailable",
              severity: "medium",
              approvalRequired: true,
              safeNextStep: "Use the approval-gated privileged capture path.",
            },
          ],
        },
      },
    },
  },
  sliceLedger: {
    schema: "studiobrain-admin-slice-ledger-summary.v1",
    generatedAt: "2026-05-07T08:45:40.150Z",
    window: { from: "slice-016", to: "slice-020", count: 5 },
    counts: { completed: 5, blocked: 0, failed: 0, noop: 0 },
    scores: { usefulness: 0.814, verification: 1, noOpRate: 0 },
  },
  toolInventory: {
    schema: "studiobrain-installed-tool-inventory.v1",
    generatedAt: "2026-05-07T08:45:51.102Z",
    status: "warn",
    summary: {
      installed: 13,
      missingRequired: 0,
      missingOptional: 7,
      actionableFindings: 0,
      coverageGaps: 4,
      promotionCandidates: 0,
    },
  },
  toolInstallRecommendations: {
    schema: "studiobrain-ops-tool-install-recommendations.v1",
    generatedAt: "2026-05-07T08:45:52.000Z",
    status: "warn",
    readOnly: true,
    summary: {
      recommendations: 7,
      coverageGaps: 4,
      approvalRequired: 1,
      installNowCandidates: 2,
    },
    recommendations: [
      {
        tool: "shellcheck",
        priority: "P1",
        acquisitionClass: "ephemeral-runner",
        validationCommand: "node scripts/ops/tooling_quality_report.mjs --mode shellcheck --allow-install --json --write",
        approvalRequired: false,
      },
      {
        tool: "docker",
        priority: "P2",
        acquisitionClass: "remote-lane",
        validationCommand: "node scripts/ops/tooling_quality_report.mjs --mode compose-config --json --write",
        approvalRequired: true,
      },
    ],
  },
  toolingFindings: {
    schema: "studiobrain-ops-tooling-findings-export.v1",
    generatedAt: "2026-05-07T08:45:53.000Z",
    status: "warn",
    readOnly: true,
    summary: {
      sections: 6,
      findings: 6,
      actionableFindings: 4,
      coverageGaps: 2,
      issueReadyTasks: 2,
    },
    tasks: [
      {
        title: "[ops-tooling] Review shellcheck findings",
        priority: "P1",
        approvalRequired: false,
        suggestedBranchName: "codex/ops-tooling-shellcheck-findings",
        suggestedPrTitle: "[ops] Address shellcheck tooling findings",
      },
    ],
  },
  swarmPreflight: {
    schema: "studiobrain-swarm-lane-preflight.v1",
    generatedAt: "2026-05-07T08:46:12.000Z",
    status: "pass",
    readOnly: true,
    lane: "tooling",
    branch: "codex/ops-tooling",
    base: "origin/main",
    changedFiles: ["scripts/ops/tool.mjs"],
    dirtyFiles: [],
    outsideScope: [],
    problems: [],
    warnings: [],
    recommendation: "lane is ready for scoped work",
  },
  adminAuditPath: "output/ops/effectivity/admin-effectivity-audit-latest.json",
  sliceLedgerPath: "output/ops/effectivity/slice-ledger-latest.json",
  toolInventoryPath: "output/ops/effectivity/installed-tool-inventory-latest.json",
  toolInstallRecommendationsPath: "output/ops/effectivity/tool-install-recommendations-latest.json",
  toolingFindingsPath: "output/ops/tooling-quality/tooling-findings-latest.json",
  swarmPreflightPath: "output/ops/swarm-lane-preflight/swarm-lane-preflight-latest.json",
};

test("buildOpsWorkPacket creates bounded read-only packets from docs evidence", () => {
  const report = buildOpsWorkPacket(
    {
      riskMarkdown,
      backlogMarkdown,
      effectivityMarkdown,
      ...freshInputs,
    },
    { runId: "unit-test", generatedAt: "2026-05-06T20:00:00.000Z" },
  );

  assert.equal(report.schema, "studiobrain-ops-work-packet.v1");
  assertWorkPacketContract(report);
  assert.equal(report.constraints.noSecrets, true);
  assert.equal(report.constraints.noServiceRestart, true);
  assert.equal(report.evidenceSummary.risks, 2);
  assert.equal(report.evidenceSummary.backlogItems, 2);
  assert.equal(report.evidenceSummary.freshSources, 6);
  assert.equal(report.evidenceSummary.staleSources, 0);
  assert.equal(report.evidenceSummary.toolPromotionCandidates, 0);
  assert.equal(report.evidenceSummary.toolActionableFindings, 0);
  assert.equal(report.evidenceSummary.toolCoverageGaps, 4);
  assert.equal(report.evidenceSummary.toolInstallRecommendations, 7);
  assert.equal(report.evidenceSummary.toolInstallApprovalRequired, 1);
  assert.equal(report.evidenceSummary.toolInstallNowCandidates, 2);
  assert.equal(report.evidenceSummary.toolingFindings, 6);
  assert.equal(report.evidenceSummary.toolingActionableFindings, 4);
  assert.equal(report.evidenceSummary.toolingIssueReadyTasks, 2);
  assert.equal(report.evidenceSummary.effectivityEvidenceLanes, 2);
  assert.equal(report.evidenceSummary.effectivityApprovalRequiredLanes, 1);
  assert.equal(report.evidenceSummary.effectivityHighSeverityLanes, 1);
  assert.equal(report.evidenceSummary.swarmPreflightStatus, "pass");
  assert.equal(report.evidenceSummary.swarmPreflightOutsideScope, 0);
  assert.equal(report.freshEvidence.adminAudit.status, "pass");
  assert.equal(report.freshEvidence.adminAudit.freshness.stale, false);
  assert.ok(report.packets.length >= 2);
  assert.ok(report.packets.every((packet) => packet.packetId.startsWith("ops-wp-")));
  assert.ok(report.packets.every((packet) => packet.constraints.readOnlyFirst));
  assert.ok(report.packets[0].sourceSignals.some((signal) => signal.source === "fresh-admin-audit"));
  const adminSignal = report.packets[0].sourceSignals.find((signal) => signal.source === "fresh-admin-audit");
  assert.equal(adminSignal.signalClass, "approval_gate");
  assert.equal(adminSignal.summary.topEvidenceLanes.length, 2);
  assert.ok(report.packets[0].sourceSignals.some((signal) => signal.source === "fresh-tool-inventory"));
  assert.ok(report.packets[0].sourceSignals.some((signal) => signal.source === "fresh-tool-inventory" && signal.signalClass === "coverage_gap"));
  assert.ok(report.packets[0].sourceSignals.some((signal) => signal.source === "fresh-tool-install-recommendations"));
  assert.ok(report.packets[0].sourceSignals.some((signal) => signal.source === "fresh-tool-install-recommendations" && signal.signalClass === "tool_install_recommendation"));
  const installSignal = report.packets[0].sourceSignals.find((signal) => signal.source === "fresh-tool-install-recommendations");
  assert.equal(installSignal.summary.approvalRequired, 1);
  assert.equal(installSignal.summary.topRecommendations.some((item) => Object.hasOwn(item, "installCommand")), false);
  const toolingFindingsSignal = report.packets[0].sourceSignals.find((signal) => signal.source === "fresh-tooling-findings");
  assert.equal(toolingFindingsSignal.signalClass, "issue_ready_task");
  assert.equal(toolingFindingsSignal.summary.issueReadyTasks, 2);
  assert.ok(report.packets[0].sourceSignals.some((signal) => signal.source === "fresh-swarm-preflight"));
  assert.equal(report.packets[0].priority, "P0");
  assert.ok(report.packets[0].humanGate.includes("PostgreSQL dump"));
  assert.ok(report.packets[0].safeNextStep.includes("restore-prerequisite"));
  const toolingPacket = report.packets.find((packet) => packet.title === "[ops-tooling] Review shellcheck findings");
  assert.equal(toolingPacket.status, "ready");
  assert.ok(toolingPacket.sourceSignals.some((signal) => signal.source === "tooling-findings-task"));
  assert.equal(toolingPacket.suggestedBranchName, "codex/ops-tooling-shellcheck-findings");
});

test("summarizeFreshEvidence degrades when ignored artifacts are missing", () => {
  const fresh = summarizeFreshEvidence({});

  assert.equal(fresh.adminAudit.status, "missing");
  assert.equal(fresh.sliceLedger.status, "missing");
  assert.equal(fresh.toolInventory.status, "missing");
  assert.equal(fresh.toolInstallRecommendations.status, "missing");
  assert.equal(fresh.toolingFindings.status, "missing");
  assert.equal(fresh.swarmPreflight.status, "missing");
});

test("comparePackets prefers ready packets within the same priority", () => {
  const packets = [
    { title: "[cleanup] Approval-gated cleanup", priorityRank: 1, status: "approval_gated" },
    { title: "[ops-tooling] Ready shellcheck task", priorityRank: 1, status: "ready" },
  ].sort(comparePackets);

  assert.equal(packets[0].title, "[ops-tooling] Ready shellcheck task");
});

test("summarizeFreshEvidence does not count invalid JSON as fresh", () => {
  const report = buildOpsWorkPacket(
    {
      riskMarkdown,
      backlogMarkdown,
      effectivityMarkdown,
      adminAudit: { status: "invalid_json", parseError: "bad admin" },
      sliceLedger: freshInputs.sliceLedger,
      toolInventory: { status: "invalid_json", parseError: "bad tools" },
      toolInstallRecommendations: { status: "invalid_json", parseError: "bad tool install recommendations" },
      toolingFindings: { status: "invalid_json", parseError: "bad tooling findings" },
    },
    { maxPackets: 1 },
  );

  assert.equal(report.evidenceSummary.freshSources, 1);
  assert.equal(report.evidenceSummary.staleSources, 0);
  assert.equal(report.freshEvidence.adminAudit.status, "invalid_json");
  assert.equal(report.freshEvidence.toolInventory.summary.parseError, "bad tools");
  assert.equal(report.freshEvidence.toolInstallRecommendations.summary.parseError, "bad tool install recommendations");
  assert.equal(report.freshEvidence.toolingFindings.summary.parseError, "bad tooling findings");
  assert.equal(report.packets[0].sourceSignals.some((signal) => signal.source === "fresh-admin-audit"), false);
  assert.equal(report.packets[0].sourceSignals.some((signal) => signal.source === "fresh-tool-inventory"), false);
  assert.equal(report.packets[0].sourceSignals.some((signal) => signal.source === "fresh-tool-install-recommendations"), false);
  assert.equal(report.packets[0].sourceSignals.some((signal) => signal.source === "fresh-tooling-findings"), false);
});

test("workPacketReportStatus warns when falling back to static docs only", () => {
  const staticOnly = buildOpsWorkPacket(
    {
      riskMarkdown,
      backlogMarkdown,
      effectivityMarkdown,
    },
    { maxPackets: 1 },
  );
  const fresh = buildOpsWorkPacket(
    {
      riskMarkdown,
      backlogMarkdown,
      effectivityMarkdown,
      ...freshInputs,
    },
    { maxPackets: 1 },
  );

  assert.equal(workPacketReportStatus(staticOnly), "warn");
  assert.equal(workPacketReportStatus(fresh), "pass");
});

test("workPacketReportStatus warns when swarm preflight is missing", () => {
  const missingPreflight = buildOpsWorkPacket(
    {
      riskMarkdown,
      backlogMarkdown,
      effectivityMarkdown,
      ...freshInputs,
      swarmPreflight: null,
    },
    { maxPackets: 1 },
  );

  assert.equal(missingPreflight.freshEvidence.swarmPreflight.status, "missing");
  assert.equal(workPacketReportStatus(missingPreflight), "warn");
});

test("failed swarm preflight gates packets and fails the report", () => {
  const failedPreflight = buildOpsWorkPacket(
    {
      riskMarkdown,
      backlogMarkdown,
      effectivityMarkdown,
      ...freshInputs,
      swarmPreflight: {
        ...freshInputs.swarmPreflight,
        status: "fail",
        outsideScope: ["server/app.ts"],
        problems: ["write scope has 1 file outside lane ownership"],
        recommendation: "do not delegate this lane until the scope issue is fixed",
      },
    },
    { maxPackets: 1 },
  );

  assert.equal(failedPreflight.evidenceSummary.swarmPreflightStatus, "fail");
  assert.equal(failedPreflight.evidenceSummary.swarmPreflightOutsideScope, 1);
  assert.equal(failedPreflight.packets[0].status, "approval_gated");
  assert.ok(failedPreflight.packets[0].humanGate.includes("do not delegate"));
  assert.equal(workPacketReportStatus(failedPreflight), "fail");
});

test("workPacketReportStatus warns when fresh evidence is stale", () => {
  const stale = buildOpsWorkPacket(
    {
      riskMarkdown,
      backlogMarkdown,
      effectivityMarkdown,
      ...freshInputs,
    },
    {
      maxPackets: 1,
      maxAgeHours: 1,
      now: "2026-05-07T12:00:00.000Z",
    },
  );

  assert.equal(stale.evidenceSummary.freshSources, 0);
  assert.equal(stale.evidenceSummary.staleSources, 6);
  assert.equal(stale.freshEvidence.adminAudit.status, "stale");
  assert.equal(stale.freshEvidence.adminAudit.sourceStatus, "pass");
  assert.equal(stale.freshEvidence.adminAudit.freshness.stale, true);
  assert.equal(workPacketReportStatus(stale), "warn");
});

test("runOpsWorkPacket returns a schema-compatible CLI report", () => {
  const report = silenceStdout(() => runOpsWorkPacket([
    "--max-packets",
    "1",
    "--admin-audit",
    "output/ops/missing-admin-audit.json",
    "--slice-ledger",
    "output/ops/missing-slice-ledger.json",
    "--tool-inventory",
    "output/ops/missing-tool-inventory.json",
    "--swarm-preflight",
    "output/ops/missing-swarm-preflight.json",
  ]));

  assertWorkPacketReportContract(report);
  assert.equal(report.written, null);
  assert.equal(report.status, "warn");
});

test("outcome ledger summaries expose by-outcome and recent receipts", () => {
  const dir = mkdtempSync(join(tmpdir(), "ops-work-packet-"));
  const outcomes = join(dir, "outcomes.jsonl");
  try {
    silenceStdout(() => runOpsWorkPacket([
      "--record-outcome",
      "ops-wp-test",
      "--outcome",
      "helpful",
      "--notes",
      "kept agent in scope",
      "--outcomes",
      outcomes,
    ]));
    const report = silenceStdout(() => runOpsWorkPacket([
      "--record-outcome",
      "ops-wp-test",
      "--outcome",
      "stale",
      "--notes",
      "superseded by fresher artifact",
      "--outcomes",
      outcomes,
    ]));

    assert.equal(report.outcomeSummary.total, 2);
    assert.equal(report.outcomeSummary.byOutcome.helpful, 1);
    assert.equal(report.outcomeSummary.byOutcome.stale, 1);
    assert.equal(report.outcomeSummary.helpful, 1);
    assert.equal(report.outcomeSummary.staleOrMisleading, 1);
    assert.equal(report.outcomeSummary.recent.length, 2);
    assert.equal(report.outcomeSummary.latest.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildOpsWorkPacket limits packet count and preserves source signals", () => {
  const report = buildOpsWorkPacket(
    {
      riskMarkdown,
      backlogMarkdown,
      effectivityMarkdown,
    },
    { maxPackets: 1 },
  );

  assert.equal(report.packets.length, 1);
  assert.ok(report.packets[0].sourceSignals.some((signal) => signal.source === "backlog"));
  assert.ok(report.packets[0].sourceSignals.some((signal) => signal.source === "risk-register"));
  assert.ok(report.packets[0].verification.some((line) => line.includes("tokens")));
});
