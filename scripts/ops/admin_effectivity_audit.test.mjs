import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInstalledToolsFreshness,
  classifyEffectivityLanes,
  earliestRowIso,
  sourceFreshness,
  summarizeWorkPacketOutcome
} from "./admin_effectivity_audit.mjs";

test("sourceFreshness rejects sources older than the selected slice window", () => {
  const result = sourceFreshness("2026-05-07T10:00:00.000Z", {
    now: "2026-05-07T11:00:00.000Z",
    minGeneratedAt: "2026-05-07T10:30:00.000Z",
    maxAgeHours: 24
  });

  assert.equal(result.status, "older_than_slice_window");
  assert.equal(result.score, 0);
});

test("sourceFreshness accepts fresh sources inside the max age", () => {
  const result = sourceFreshness("2026-05-07T10:45:00.000Z", {
    now: "2026-05-07T11:00:00.000Z",
    minGeneratedAt: "2026-05-07T10:30:00.000Z",
    maxAgeHours: 24
  });

  assert.equal(result.status, "fresh");
  assert.equal(result.score, 1);
});

test("buildInstalledToolsFreshness requires both inventory and tooling source freshness", () => {
  const stale = buildInstalledToolsFreshness({
    schema: "studiobrain-installed-tool-inventory.v1",
    generatedAt: "2026-05-07T11:00:00.000Z",
    effectivitySource: {
      generatedAt: "2026-05-07T09:00:00.000Z",
      status: "warn"
    }
  }, {
    now: "2026-05-07T11:05:00.000Z",
    minGeneratedAt: "2026-05-07T10:30:00.000Z"
  });

  assert.equal(stale.status, "stale_source");
  assert.equal(stale.score, 0);
  assert.equal(stale.inventory.status, "fresh");
  assert.equal(stale.toolingQuality.status, "older_than_slice_window");

  const fresh = buildInstalledToolsFreshness({
    schema: "studiobrain-installed-tool-inventory.v1",
    generatedAt: "2026-05-07T11:00:00.000Z",
    effectivitySource: {
      generatedAt: "2026-05-07T10:45:00.000Z",
      status: "warn"
    }
  }, {
    now: "2026-05-07T11:05:00.000Z",
    minGeneratedAt: "2026-05-07T10:30:00.000Z"
  });

  assert.equal(fresh.status, "fresh");
  assert.equal(fresh.score, 1);
});

test("earliestRowIso uses the start of the selected slice window", () => {
  const timestamp = earliestRowIso([
    { sliceId: "slice-20260507-059", completedAt: "2026-05-07T15:31:02.238Z" },
    { sliceId: "slice-20260507-060", completedAt: "2026-05-07T15:36:18.629Z" },
  ]);

  assert.equal(timestamp, "2026-05-07T15:31:02.238Z");
});

test("classifyEffectivityLanes turns degraded report sections into approval-aware lanes", () => {
  const lanes = classifyEffectivityLanes({
    sources: {
      idleAudit: { exists: false, stale: true },
    },
    sections: {
      idleWorker: { status: "unavailable", commandStatus: "warn" },
      backup: { status: "warn", gaps: ["PostgreSQL dump artifacts not proven"] },
      failedUnits: { status: "warn", trueFailedUnits: 2, commandStatus: "pass" },
      privilegedEvidence: {
        status: "sudo_unavailable",
        summaryPresent: false,
        note: "Privileged host capture evidence is absent.",
        safeNextStep: "run the approval-gated collector",
      },
    },
  });

  assert.deepEqual(lanes.map((lane) => lane.id), [
    "idle_worker_effectivity",
    "backup_confidence",
    "failed_units",
    "privileged_evidence",
  ]);
  assert.equal(lanes.find((lane) => lane.id === "backup_confidence").severity, "high");
  assert.equal(lanes.find((lane) => lane.id === "privileged_evidence").approvalRequired, true);
  assert.ok(lanes.find((lane) => lane.id === "privileged_evidence").safeNextStep.includes("approval-gated"));
});

test("summarizeWorkPacketOutcome warns on stale packet outcomes after maturity threshold", () => {
  const summary = summarizeWorkPacketOutcome({
    schema: "studiobrain-ops-work-packet.v1",
    generatedAt: "2026-05-07T11:00:00.000Z",
    outcomeSummary: {
      total: 4,
      uniquePackets: 3,
      helpfulRate: 0.25,
      staleOrMisleadingRate: 0.5,
      staleOrMisleadingPackets: [
        { packetId: "ops-wp-1", outcome: "stale", reason: "superseded by newer host evidence" }
      ],
      blockedPackets: [
        { packetId: "ops-wp-2", outcome: "blocked", reason: "sudo unavailable", blockerClass: "approval_gate" }
      ]
    }
  }, {
    now: "2026-05-07T11:05:00.000Z",
    minGeneratedAt: "2026-05-07T10:30:00.000Z",
    path: "output/ops/swarm/latest-work-packet.json"
  });

  assert.equal(summary.status, "warn");
  assert.equal(summary.score, 0.4);
  assert.equal(summary.maturity, "evidence_ready");
  assert.deepEqual(summary.warnings, ["staleOrMisleadingRate=0.5", "blockedPackets=1"]);
  assert.equal(summary.outcomeSummary.staleOrMisleadingPackets[0].packetId, "ops-wp-1");
  assert.equal(summary.outcomeSummary.blockedPackets[0].blockerClass, "approval_gate");
});

test("summarizeWorkPacketOutcome treats a small clean ledger as warming up", () => {
  const summary = summarizeWorkPacketOutcome({
    schema: "studiobrain-ops-work-packet.v1",
    generatedAt: "2026-05-07T11:00:00.000Z",
    outcomeSummary: {
      total: 1,
      uniquePackets: 1,
      helpfulRate: 1,
      staleOrMisleadingRate: 0,
      staleOrMisleadingPackets: [],
      blockedPackets: []
    }
  }, {
    now: "2026-05-07T11:05:00.000Z",
    minGeneratedAt: "2026-05-07T10:30:00.000Z"
  });

  assert.equal(summary.status, "pass");
  assert.equal(summary.score, 1);
  assert.equal(summary.maturity, "warming_up");
});
