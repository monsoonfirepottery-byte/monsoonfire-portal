import test from "node:test";
import assert from "node:assert/strict";

import { buildOpsWorkPacket } from "./studiobrain-ops-work-packet.mjs";

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

test("buildOpsWorkPacket creates bounded read-only packets from docs evidence", () => {
  const report = buildOpsWorkPacket(
    {
      riskMarkdown,
      backlogMarkdown,
      effectivityMarkdown,
    },
    { runId: "unit-test", generatedAt: "2026-05-06T20:00:00.000Z" },
  );

  assert.equal(report.schema, "studiobrain-ops-work-packet.v1");
  assert.equal(report.constraints.noSecrets, true);
  assert.equal(report.constraints.noServiceRestart, true);
  assert.equal(report.evidenceSummary.risks, 2);
  assert.equal(report.evidenceSummary.backlogItems, 2);
  assert.ok(report.packets.length >= 2);
  assert.ok(report.packets.every((packet) => packet.packetId.startsWith("ops-wp-")));
  assert.ok(report.packets.every((packet) => packet.constraints.readOnlyFirst));
  assert.equal(report.packets[0].priority, "P0");
  assert.ok(report.packets[0].humanGate.includes("PostgreSQL dump"));
  assert.ok(report.packets[0].safeNextStep.includes("restore-prerequisite"));
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
