import test from "node:test";
import assert from "node:assert/strict";

import { evaluateDelegationAuthorization } from "./authz";

const NOW_MS = 1_760_000_000_000;

function baseDelegation() {
  return {
    ownerUid: "owner_123",
    agentClientId: "agent_client_123",
    scopes: ["quote:write", "reserve:write", "pay:write", "status:read"],
    resources: ["owner:owner_123", "batch:batch_1", "route:/v1/agent.pay"],
    status: "active",
    expiresAtMs: NOW_MS + 60_000,
    revokedAtMs: 0,
  };
}

test("evaluateDelegationAuthorization allows valid delegation", () => {
  const result = evaluateDelegationAuthorization({
    delegation: baseDelegation(),
    ownerUid: "owner_123",
    agentClientId: "agent_client_123",
    scope: "pay:write",
    resource: "owner:owner_123",
    nowMs: NOW_MS,
  });
  assert.deepEqual(result, { ok: true });
});

test("evaluateDelegationAuthorization denies expired delegation", () => {
  const result = evaluateDelegationAuthorization({
    delegation: { ...baseDelegation(), expiresAtMs: NOW_MS - 1 },
    ownerUid: "owner_123",
    agentClientId: "agent_client_123",
    scope: "pay:write",
    resource: "owner:owner_123",
    nowMs: NOW_MS,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "DELEGATION_EXPIRED");
});

test("evaluateDelegationAuthorization denies revoked delegation", () => {
  const result = evaluateDelegationAuthorization({
    delegation: { ...baseDelegation(), revokedAtMs: NOW_MS - 5_000 },
    ownerUid: "owner_123",
    agentClientId: "agent_client_123",
    scope: "pay:write",
    resource: "owner:owner_123",
    nowMs: NOW_MS,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "DELEGATION_REVOKED");
});

test("evaluateDelegationAuthorization denies wrong owner", () => {
  const result = evaluateDelegationAuthorization({
    delegation: baseDelegation(),
    ownerUid: "owner_other",
    agentClientId: "agent_client_123",
    scope: "pay:write",
    resource: "owner:owner_other",
    nowMs: NOW_MS,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "DELEGATION_OWNER_MISMATCH");
});

test("evaluateDelegationAuthorization denies wrong agent client", () => {
  const result = evaluateDelegationAuthorization({
    delegation: baseDelegation(),
    ownerUid: "owner_123",
    agentClientId: "agent_client_other",
    scope: "pay:write",
    resource: "owner:owner_123",
    nowMs: NOW_MS,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "DELEGATION_AGENT_MISMATCH");
});

test("evaluateDelegationAuthorization denies missing scope", () => {
  const result = evaluateDelegationAuthorization({
    delegation: { ...baseDelegation(), scopes: ["status:read"] },
    ownerUid: "owner_123",
    agentClientId: "agent_client_123",
    scope: "pay:write",
    resource: "owner:owner_123",
    nowMs: NOW_MS,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "DELEGATION_SCOPE_MISSING");
});

test("evaluateDelegationAuthorization denies missing resource", () => {
  const result = evaluateDelegationAuthorization({
    delegation: { ...baseDelegation(), resources: ["batch:batch_1"] },
    ownerUid: "owner_123",
    agentClientId: "agent_client_123",
    scope: "pay:write",
    resource: "owner:owner_123",
    nowMs: NOW_MS,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "DELEGATION_RESOURCE_MISSING");
});

