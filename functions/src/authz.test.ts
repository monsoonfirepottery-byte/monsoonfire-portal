import test from "node:test";
import assert from "node:assert/strict";

import { assertActorAuthorized, evaluateDelegationAuthorization } from "./authz";
import { db } from "./shared";

type MockFirestoreDoc = {
  exists: boolean;
  data: () => Record<string, unknown> | null;
};

type MockFirestoreCollection = {
  doc: (id: string) => {
    get: () => Promise<MockFirestoreDoc>;
  };
};

function withMockDelegationLookup(
  delegation: Record<string, unknown> | null,
): { restore: () => void; collection: (name: string) => MockFirestoreCollection } {
  const mutableDb = db as unknown as { collection: (collectionPath: string) => MockFirestoreCollection };
  const originalCollection = mutableDb.collection;
  const restored = { restored: false };

  const collection = (name: string): MockFirestoreCollection => {
    if (name !== "delegations") {
      return {
        doc: () => ({
          get: async () => ({
            exists: false,
            data: () => null,
          }),
        }),
      };
    }
    return {
      doc: (id: string) => ({
        get: async () => ({
          exists: Boolean(delegation && id),
          data: () => delegation,
        }),
      }),
    };
  };

  mutableDb.collection = (name: string): MockFirestoreCollection => collection(name);
  return {
    restore: () => {
      if (!restored.restored) {
        restored.restored = true;
        mutableDb.collection = originalCollection;
      }
    },
    collection,
  };
}

function withStrictDelegationMode<T>(fn: () => Promise<T>): Promise<T> {
  const originalV2 = process.env.V2_AGENTIC_ENABLED;
  const originalStrict = process.env.STRICT_DELEGATION_CHECKS_ENABLED;
  process.env.V2_AGENTIC_ENABLED = "true";
  process.env.STRICT_DELEGATION_CHECKS_ENABLED = "true";

  return fn().finally(() => {
    if (originalV2 === undefined) {
      delete process.env.V2_AGENTIC_ENABLED;
    } else {
      process.env.V2_AGENTIC_ENABLED = originalV2;
    }
    if (originalStrict === undefined) {
      delete process.env.STRICT_DELEGATION_CHECKS_ENABLED;
    } else {
      process.env.STRICT_DELEGATION_CHECKS_ENABLED = originalStrict;
    }
  });
}

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

test("assertActorAuthorized allows a matching owner in pat mode", async () => {
  const result = await assertActorAuthorized({
    req: {},
    ctx: {
      mode: "pat",
      uid: "owner_123",
      decoded: null,
      tokenId: "token-1",
      scopes: ["requests:read", "status:read", "pay:write"],
      delegated: null,
    },
    ownerUid: "owner_123",
    scope: "status:read",
    resource: "route:/v1/agent.status",
    allowStaff: false,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.actorType, "agent_pat");
    assert.equal(result.ctx.uid, "owner_123");
  }
});

test("assertActorAuthorized denies mismatched owner for non-staff delegates", async () => {
  const result = await assertActorAuthorized({
    req: {},
    ctx: {
      mode: "delegated",
      uid: "owner_123",
      decoded: null,
      tokenId: "delegated-token",
      scopes: ["status:read", "batches:read", "requests:read"],
      delegated: {
        agentClientId: "agent_client_123",
        audience: "audience",
        expiresAt: Date.now() + 60_000,
        nonce: "nonce",
        delegationId: null,
      },
    },
    ownerUid: "owner_456",
    scope: null,
    resource: "owner:owner_456",
    allowStaff: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 403);
  assert.equal(result.code, "OWNER_MISMATCH");
});

test("assertActorAuthorized allows staff in firebase mode regardless of ownerUid when allowStaff is true", async () => {
  const result = await assertActorAuthorized({
    req: {},
    ctx: {
      mode: "firebase",
      uid: "staff_123",
      decoded: { staff: true, uid: "staff_123" } as never,
      tokenId: null,
      scopes: null,
      delegated: null,
    },
    ownerUid: "owner_456",
    scope: "requests:write",
    resource: "owner:owner_456",
    allowStaff: true,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.actorType, "staff");
    assert.equal(result.ctx.uid, "staff_123");
  }
});

test("assertActorAuthorized fails owner check for non-staff firebase when owners differ", async () => {
  const result = await assertActorAuthorized({
    req: {},
    ctx: {
      mode: "firebase",
      uid: "owner_123",
      decoded: { staff: false, uid: "owner_123" } as never,
      tokenId: null,
      scopes: null,
      delegated: null,
    },
    ownerUid: "owner_456",
    scope: null,
    resource: null,
    allowStaff: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 403);
  assert.equal(result.code, "OWNER_MISMATCH");
});

test("assertActorAuthorized enforces delegation resource matching under strict delegation mode", async () => {
  const mock = baseDelegation();
  const delegation = {
    ...mock,
    resources: [...mock.resources],
  };
  const restoreHandle = withMockDelegationLookup(delegation);

  try {
    await withStrictDelegationMode(async () => {
      const result = await assertActorAuthorized({
        req: {},
        ctx: {
          mode: "delegated",
          uid: "owner_123",
          decoded: null,
          scopes: ["pay:write"],
          tokenId: "delegated-token",
          delegated: {
            agentClientId: "agent_client_123",
            audience: "audience",
            expiresAt: Date.now() + 60_000,
            nonce: "nonce",
            delegationId: "delegation_123",
          },
        },
        ownerUid: "owner_123",
        scope: "pay:write",
        resource: "route:/v1/agent.pay",
        allowStaff: false,
      });
      assert.equal(result.ok, true);
    });

    await withStrictDelegationMode(async () => {
      const result = await assertActorAuthorized({
        req: {},
        ctx: {
          mode: "delegated",
          uid: "owner_123",
          decoded: null,
          scopes: ["pay:write"],
          tokenId: "delegated-token",
          delegated: {
            agentClientId: "agent_client_123",
            audience: "audience",
            expiresAt: Date.now() + 60_000,
            nonce: "nonce",
            delegationId: "delegation_123",
          },
        },
        ownerUid: "owner_123",
        scope: "pay:write",
        resource: "owner:other",
        allowStaff: false,
      });
      assert.equal(result.ok, false);
      assert.equal(result.httpStatus, 403);
      assert.equal(result.code, "DELEGATION_RESOURCE_MISSING");
    });
  } finally {
    restoreHandle.restore();
  }
});

test("assertActorAuthorized denies delegated access when strict delegation record is missing", async () => {
  const restoreHandle = withMockDelegationLookup(null);

  try {
    const result = await withStrictDelegationMode(async () =>
      assertActorAuthorized({
        req: {},
        ctx: {
          mode: "delegated",
          uid: "owner_123",
          decoded: null,
          scopes: ["pay:write"],
          tokenId: "delegated-token",
          delegated: {
            agentClientId: "agent_client_123",
            audience: "audience",
            expiresAt: Date.now() + 60_000,
            nonce: "nonce",
            delegationId: "missing_123",
          },
        },
        ownerUid: "owner_123",
        scope: "pay:write",
        resource: "route:/v1/agent.pay",
        allowStaff: false,
      })
    );
    assert.equal(result.ok, false);
    assert.equal(result.httpStatus, 403);
    assert.equal(result.code, "DELEGATION_NOT_FOUND");
  } finally {
    restoreHandle.restore();
  }
});
