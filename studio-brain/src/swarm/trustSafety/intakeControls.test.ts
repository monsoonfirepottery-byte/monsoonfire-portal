import assert from "node:assert/strict";
import test from "node:test";
import { buildIntakeQueue, classifyIntakeRisk, hasOverrideGrant, isValidOverrideTransition } from "./intakeControls";

test("classifyIntakeRisk maps categories", () => {
  const row = classifyIntakeRisk({
    actorId: "agent-1",
    ownerUid: "owner-1",
    capabilityId: "firestore.batch.close",
    rationale: "Need exact replica disney logo piece",
    previewSummary: "commission",
    requestInput: {},
  });
  assert.equal(row.category, "ip_infringement");
  assert.equal(row.blocked, true);
  assert.equal(row.disposition, "manual_review");
});

test("classifyIntakeRisk defaults unknown safely", () => {
  const row = classifyIntakeRisk({
    actorId: "agent-1",
    ownerUid: "owner-1",
    capabilityId: "hubitat.devices.read",
    rationale: "check dashboard status",
    previewSummary: "ops status",
    requestInput: {},
  });
  assert.equal(row.category, "unknown");
  assert.equal(row.blocked, false);
});

test("override grant detection and queue builder", () => {
  const events = [
    {
      id: "1",
      at: "2026-02-13T00:00:00.000Z",
      actorType: "system" as const,
      actorId: "studio-brain",
      action: "intake.routed_to_review",
      rationale: "blocked",
      target: "local" as const,
      approvalState: "required" as const,
      inputHash: "a",
      outputHash: null,
      metadata: { intakeId: "abc", category: "ip_infringement", reasonCode: "ip_infringement_detected" },
    },
    {
      id: "2",
      at: "2026-02-13T00:10:00.000Z",
      actorType: "staff" as const,
      actorId: "staff-1",
      action: "intake.override_granted",
      rationale: "approved",
      target: "local" as const,
      approvalState: "approved" as const,
      inputHash: "b",
      outputHash: "c",
      metadata: { intakeId: "abc" },
    },
  ];
  assert.equal(hasOverrideGrant(events, "abc"), true);
  const queue = buildIntakeQueue(events, 10);
  assert.equal(queue.length, 1);
});

test("override transition requires reason code policy", () => {
  assert.equal(isValidOverrideTransition("override_granted", "staff_override_approved"), true);
  assert.equal(isValidOverrideTransition("override_granted", "policy_blocked"), false);
  assert.equal(isValidOverrideTransition("override_denied", "policy_confirmed_block"), true);
});
