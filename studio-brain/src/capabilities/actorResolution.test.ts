import assert from "node:assert/strict";
import test from "node:test";
import { resolveCapabilityActor } from "./actorResolution";

test("resolveCapabilityActor allows valid agent delegation", () => {
  const result = resolveCapabilityActor({
    actorType: "agent",
    actorUid: "agent-1",
    ownerUid: "owner-1",
    capabilityId: "firestore.batch.close",
    principalUid: "staff-uid",
    delegation: {
      delegationId: "del-1",
      agentUid: "agent-1",
      ownerUid: "owner-1",
      scopes: ["capability:firestore.batch.close:execute"],
      expiresAt: "2026-02-14T00:00:00.000Z",
    },
    now: new Date("2026-02-13T00:00:00.000Z"),
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reasonCode, "ALLOWED");
  assert.equal(result.actor?.actorType, "agent");
});

test("resolveCapabilityActor denies missing delegation", () => {
  const result = resolveCapabilityActor({
    actorType: "agent",
    actorUid: "agent-1",
    ownerUid: "owner-1",
    capabilityId: "firestore.batch.close",
    principalUid: "staff-uid",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, "DELEGATION_MISSING");
});

test("resolveCapabilityActor denies expired delegation", () => {
  const result = resolveCapabilityActor({
    actorType: "agent",
    actorUid: "agent-1",
    ownerUid: "owner-1",
    capabilityId: "firestore.batch.close",
    principalUid: "staff-uid",
    delegation: {
      delegationId: "del-1",
      agentUid: "agent-1",
      ownerUid: "owner-1",
      scopes: ["capability:firestore.batch.close:execute"],
      expiresAt: "2026-02-12T00:00:00.000Z",
    },
    now: new Date("2026-02-13T00:00:00.000Z"),
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, "DELEGATION_EXPIRED");
});

test("resolveCapabilityActor denies revoked delegation", () => {
  const result = resolveCapabilityActor({
    actorType: "agent",
    actorUid: "agent-1",
    ownerUid: "owner-1",
    capabilityId: "firestore.batch.close",
    principalUid: "staff-uid",
    delegation: {
      delegationId: "del-1",
      agentUid: "agent-1",
      ownerUid: "owner-1",
      scopes: ["capability:firestore.batch.close:execute"],
      revokedAt: "2026-02-12T00:00:00.000Z",
      expiresAt: "2026-02-14T00:00:00.000Z",
    },
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, "DELEGATION_REVOKED");
});

test("resolveCapabilityActor denies wrong owner", () => {
  const result = resolveCapabilityActor({
    actorType: "agent",
    actorUid: "agent-1",
    ownerUid: "owner-2",
    capabilityId: "firestore.batch.close",
    principalUid: "staff-uid",
    delegation: {
      delegationId: "del-1",
      agentUid: "agent-1",
      ownerUid: "owner-1",
      scopes: ["capability:firestore.batch.close:execute"],
      expiresAt: "2026-02-14T00:00:00.000Z",
    },
    now: new Date("2026-02-13T00:00:00.000Z"),
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, "DELEGATION_OWNER_MISMATCH");
});

test("resolveCapabilityActor denies missing scope", () => {
  const result = resolveCapabilityActor({
    actorType: "agent",
    actorUid: "agent-1",
    ownerUid: "owner-1",
    capabilityId: "firestore.batch.close",
    principalUid: "staff-uid",
    delegation: {
      delegationId: "del-1",
      agentUid: "agent-1",
      ownerUid: "owner-1",
      scopes: ["capability:hubitat.devices.read:execute"],
      expiresAt: "2026-02-14T00:00:00.000Z",
    },
    now: new Date("2026-02-13T00:00:00.000Z"),
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, "DELEGATION_SCOPE_MISSING");
});
