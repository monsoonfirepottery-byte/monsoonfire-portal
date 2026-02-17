import test from "node:test";
import assert from "node:assert/strict";

import * as shared from "./shared";
import {
  handleApiV1,
  toTimelineEventRow,
  toFiringRow,
  toAgentRequestRow,
  toBatchDetailRow,
} from "./apiV1";
import type { AuthContext } from "./shared";

type DbValue = Record<string, unknown> | null;
type MockDbState = Record<string, Record<string, DbValue>>;

type MockSnapshot = {
  id: string;
  exists: boolean;
  data: () => Record<string, unknown> | null;
};

type MockQuery = {
  where: (..._args: unknown[]) => MockQuery;
  orderBy: (..._args: unknown[]) => MockQuery;
  limit: (limit: number) => MockQuery;
  get: () => Promise<{ docs: MockSnapshot[]; empty: boolean }>;
};
type MockTransaction = {
  get: (docRef: { __mfCollection: string; __mfDocId: string }) => Promise<MockSnapshot>;
  set: () => Promise<void>;
};
const AGENT_TERMS_VERSION = "2026-02-12.v1";

function createSnapshot(id: string, row: DbValue): MockSnapshot {
  return {
    id,
    exists: row !== null,
    data: () => row ?? null,
  };
}

function listSnapshots(rows: Record<string, DbValue> = {}): MockSnapshot[] {
  return Object.entries(rows).map(([id, row]) => createSnapshot(id, row));
}

function createCollectionQuery(rows: Record<string, DbValue>, limitCount?: number): MockQuery {
  return {
    where: () => createCollectionQuery(rows, limitCount),
    orderBy: () => createCollectionQuery(rows, limitCount),
    limit: (nextLimit) => createCollectionQuery(rows, nextLimit),
    get: async () => {
      const docs = limitCount ? listSnapshots(rows).slice(0, limitCount) : listSnapshots(rows);
      return { docs, empty: docs.length === 0 };
    },
  };
}

function withMockFirestore<T>(
  state: MockDbState,
  callback: () => Promise<T>,
  options?: { runTransaction?: (cb: (tx: MockTransaction) => Promise<unknown>) => Promise<unknown> },
): Promise<T> {
  const db = shared.db as unknown as {
    collection: (path: string) => {
      add: (value: Record<string, unknown>) => Promise<{ id: string }>;
      doc: (id: string) => {
        __mfCollection: string;
        __mfDocId: string;
      };
      where: (..._args: unknown[]) => MockQuery;
      orderBy: (..._args: unknown[]) => MockQuery;
      limit: (_limit: number) => MockQuery;
      get: () => Promise<{ docs: MockSnapshot[]; empty: boolean }>;
    };
    doc: (path: string) => { exists: boolean; get: () => Promise<MockSnapshot>; set: () => Promise<void> };
    runTransaction: (cb: (tx: MockTransaction) => Promise<unknown>) => Promise<unknown>;
  };

  const original = {
    collection: db.collection,
    doc: db.doc,
    runTransaction: db.runTransaction,
  };

  const lookup = (collectionName: string, id: string): MockSnapshot => {
    const rows = state[collectionName] ?? {};
    const row = Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
    return createSnapshot(id, row);
  };

  db.collection = (collectionName) => {
    const rows = state[collectionName] ?? {};
    if (!Object.prototype.hasOwnProperty.call(state, collectionName)) {
      state[collectionName] = rows;
    }
    let addId = 1;
    return {
      add: async (_doc) => {
        const generatedId = `${collectionName}-${addId++}`;
        rows[generatedId] = _doc;
        return { id: generatedId };
      },
      doc: (id: string) => {
        const collectionRow = rows[id] ?? null;
        return {
          __mfCollection: collectionName,
          __mfDocId: id,
          get: async () => createSnapshot(id, Object.prototype.hasOwnProperty.call(rows, id) ? collectionRow : null),
          set: async () => {},
          collection: (_sub: string) => ({
            add: async () => ({ id: `${id}-${_sub}` }),
          }),
        };
      },
      where: () => createCollectionQuery(rows),
      orderBy: () => createCollectionQuery(rows),
      limit: (limit) => createCollectionQuery(rows, limit),
      get: async () => {
        const docs = listSnapshots(rows);
        return { docs, empty: docs.length === 0 };
      },
    };
  };

  db.doc = (path: string) => {
    const [collectionName = "", docId = ""] = path.split("/");
    const rows = state[collectionName] ?? {};
    const raw = Object.prototype.hasOwnProperty.call(rows, docId) ? rows[docId] : null;
    return {
      get: async () => createSnapshot(docId, raw),
      set: async () => {},
      exists: raw !== null,
    };
  };

  db.runTransaction =
    options?.runTransaction ??
    (async (txCallback) => {
      const tx: MockTransaction = {
        get: async (docRef) => lookup(docRef.__mfCollection, docRef.__mfDocId),
        set: async () => {},
      };
      return txCallback(tx);
    });

  return callback().finally(() => {
    db.collection = original.collection;
    db.doc = original.doc;
    db.runTransaction = original.runTransaction;
  });
}

async function withMockedRateLimit<T>(callback: () => Promise<T>): Promise<T> {
  const runtime = shared as unknown as { enforceRateLimit: typeof shared.enforceRateLimit };
  const original = runtime.enforceRateLimit;
  runtime.enforceRateLimit = async () => ({ ok: true });
  try {
    return await callback();
  } finally {
    runtime.enforceRateLimit = original;
  }
}

type RateLimitMode = "ok" | "throw";

async function withMockedRateLimitPlan<T>(plan: RateLimitMode[], callback: () => Promise<T>): Promise<T> {
  const runtime = shared as unknown as { enforceRateLimit: typeof shared.enforceRateLimit };
  const original = runtime.enforceRateLimit;
  let callIndex = 0;
  runtime.enforceRateLimit = async () => {
    const mode = plan[callIndex] ?? "ok";
    callIndex += 1;
    if (mode === "throw") {
      throw new Error("simulated rate-limit backend failure");
    }
    return { ok: true };
  };
  try {
    return await callback();
  } finally {
    runtime.enforceRateLimit = original;
  }
}

function createResponse() {
  let status = 0;
  let body: unknown;
  const headers: Record<string, string> = {};

  const res: shared.ResponseLike = {
    status: (code: number) => {
      status = code;
      return res;
    },
    json: (payload: unknown) => {
      body = payload;
    },
    set: (name: string, value: string) => {
      headers[name] = value;
    },
    send: () => {},
  } satisfies shared.ResponseLike;

  return { res, status: () => status, body: () => body, headers: () => headers };
}

function getAuditEvents(state: MockDbState): Array<Record<string, unknown>> {
  const rows = state.auditEvents ?? {};
  return Object.values(rows).filter((row): row is Record<string, unknown> => row !== null);
}

function assertDelegationAuditMetadata(
  event: Record<string, unknown> | undefined,
  expected: {
    delegationId?: string | null;
    delegationAudience?: string;
    agentClientId?: string;
  } = {},
) {
  const metadata = event?.metadata;
  assert.ok(metadata !== null && typeof metadata === "object", "delegated audit event must include metadata");
  const row = metadata as Record<string, unknown>;
  assert.equal(row.delegationId, expected.delegationId ?? "delegation-1");
  assert.equal(row.delegationAudience, expected.delegationAudience ?? "agent-aud");
  assert.equal(row.agentClientId, expected.agentClientId ?? "agent-client-1");
}

function withPatTermsAcceptance(state: MockDbState, uid = "owner-1", tokenId = "pat-token", version = AGENT_TERMS_VERSION): MockDbState {
  return {
    ...state,
    config: {
      ...state.config,
      agentTerms: {
        currentVersion: version,
      },
    },
    agentTermsAcceptances: {
      ...state.agentTermsAcceptances,
      [`pat-accept-${uid}-${tokenId}-${version}`]: {
        uid,
        version,
        tokenId,
        status: "accepted",
      },
    },
  };
}

function withDelegatedTermsAcceptance(
  state: MockDbState,
  uid = "owner-1",
  agentClientId = "agent-client-1",
  version = AGENT_TERMS_VERSION,
): MockDbState {
  return {
    ...state,
    config: {
      ...state.config,
      agentTerms: {
        currentVersion: version,
      },
    },
    agentTermsAcceptances: {
      ...state.agentTermsAcceptances,
      [`delegate-accept-${uid}-${agentClientId}-${version}`]: {
        uid,
        version,
        agentClientId,
        status: "accepted",
      },
    },
  };
}

function patContext(overrides?: Partial<Omit<AuthContext, "mode" | "decoded" | "delegated">>): AuthContext {
  return {
    mode: "pat",
    uid: overrides?.uid ?? "owner-1",
    decoded: null,
    tokenId: overrides?.tokenId ?? "pat-token",
    scopes: overrides?.scopes ?? ["events:read", "reserve:write", "pay:write", "status:read", "requests:write"],
    delegated: null,
  };
}

function delegatedContext(overrides?: {
  uid?: string;
  tokenId?: string;
  scopes?: string[];
  agentClientId?: string;
  audience?: string;
  expiresAt?: number;
  nonce?: string;
  delegationId?: string | null;
}): AuthContext {
  return {
    mode: "delegated",
    uid: overrides?.uid ?? "owner-1",
    decoded: null,
    scopes: overrides?.scopes ?? ["status:read", "order:read"],
    tokenId: overrides?.tokenId ?? "delegated-token",
    delegated: {
      agentClientId: overrides?.agentClientId ?? "agent-client-1",
      audience: overrides?.audience ?? "agent-aud",
      expiresAt: overrides?.expiresAt ?? Date.now() + 60_000,
      nonce: overrides?.nonce ?? "nonce-1",
      delegationId: overrides?.delegationId ?? "delegation-1",
    },
  };
}

function staffContext(overrides?: Partial<Omit<AuthContext, "mode" | "decoded" | "delegated">>): AuthContext {
  const uid = overrides?.uid ?? "staff-1";
  return {
    mode: "firebase",
    uid,
    decoded: {
      uid,
      staff: true,
    } as never,
    tokenId: null,
    scopes: null,
    delegated: null,
  };
}

function firebaseContext(overrides?: Partial<Omit<AuthContext, "mode" | "decoded" | "delegated">>): AuthContext {
  const uid = overrides?.uid ?? "owner-1";
  return {
    mode: "firebase",
    uid,
    decoded: {
      uid,
    } as never,
    tokenId: null,
    scopes: null,
    delegated: null,
  };
}

async function withStrictDelegation<T>(callback: () => Promise<T>): Promise<T> {
  const originalV2 = process.env.V2_AGENTIC_ENABLED;
  const originalStrict = process.env.STRICT_DELEGATION_CHECKS_ENABLED;
  process.env.V2_AGENTIC_ENABLED = "true";
  process.env.STRICT_DELEGATION_CHECKS_ENABLED = "true";
  try {
    return await callback();
  } finally {
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
  }
}

function makeRequest(path: string, body: Record<string, unknown>, ctx: AuthContext) {
  return { method: "POST", path, body, __mfAuthContext: ctx };
}

test("toTimelineEventRow normalizes explicit fields and drops unknown fields", () => {
  const result = toTimelineEventRow("timeline-1", {
    type: "CREATE_BATCH",
    at: { seconds: 1_700_000 },
    actorUid: "user-1",
    actorName: "Sam Potter",
    notes: "Placed",
    kilnId: "kiln-1",
    kilnName: "Aubergine",
    photos: ["before.jpg", 3, null, "after.jpg"],
    pieceState: { state: "queued" },
    internal: "should not leak",
  });

  assert.deepEqual(result, {
    id: "timeline-1",
    type: "CREATE_BATCH",
    at: { seconds: 1_700_000 },
    actorUid: "user-1",
    actorName: "Sam Potter",
    notes: "Placed",
    kilnId: "kiln-1",
    kilnName: "Aubergine",
    photos: ["before.jpg", "after.jpg"],
    pieceState: { state: "queued" },
  });
});

test("toFiringRow normalizes scalar fields and trims malformed arrays", () => {
  const result = toFiringRow("firing-1", {
    kilnId: "kiln-1",
    title: "Evening glaze",
    cycleType: "bisque",
    startAt: { seconds: 12_000 },
    endAt: null,
    status: "scheduled",
    confidence: "estimated",
    notes: "No rush",
    unloadedByUid: "staff-1",
    unloadNote: "done",
    batchIds: ["b1", 2, "b2"],
    pieceIds: ["p1"],
    kilnName: null,
    secretField: 123,
  });

  assert.deepEqual(result, {
    id: "firing-1",
    kilnId: "kiln-1",
    title: "Evening glaze",
    cycleType: "bisque",
    startAt: { seconds: 12_000 },
    endAt: null,
    status: "scheduled",
    confidence: "estimated",
    notes: "No rush",
    unloadedAt: null,
    unloadedByUid: "staff-1",
    unloadNote: "done",
    batchIds: ["b1", "b2"],
    pieceIds: ["p1"],
    kilnName: null,
  });
});

test("toFiringRow defaults malformed scalar values to null", () => {
  const result = toFiringRow("firing-2", {
    kilnId: 123,
    title: 456,
    cycleType: null,
    status: 0,
    confidence: null,
    notes: [],
    unloadedByUid: [],
    unloadNote: undefined,
    batchIds: "bad",
    pieceIds: "bad",
  });

  assert.equal(result.kilnId, null);
  assert.equal(result.title, null);
  assert.equal(result.cycleType, null);
  assert.equal(result.status, null);
  assert.equal(result.confidence, null);
  assert.equal(result.notes, null);
  assert.equal(result.unloadedByUid, null);
  assert.equal(result.unloadNote, null);
  assert.deepEqual(result.batchIds, []);
  assert.deepEqual(result.pieceIds, []);
});

test("toAgentRequestRow normalizes list payload and hides unknown keys", () => {
  const result = toAgentRequestRow("request-1", {
    title: "Test request",
    summary: "Need help",
    notes: "Keep it warm",
    kind: "firing",
    status: "accepted",
    linkedBatchId: null,
    createdByUid: "owner-1",
    createdByMode: "pat",
    createdByTokenId: "pat-token",
    logistics: { mode: "pickup", extra: "ignored" },
    constraints: { requiresFork: true },
    metadata: { project: "summer" },
    staff: {
      assignedToUid: "staff-1",
      triagedAt: { seconds: 2_000_000 },
      internalNotes: "Needs special clay",
    },
    commissionOrderId: "order-1",
    commissionPaymentStatus: "checkout_pending",
    internalNote: "should not leak",
    createdAt: { seconds: 1_000_000 },
    updatedAt: { seconds: 1_500_000 },
  });

  assert.equal(result.id, "request-1");
  assert.equal(result.title, "Test request");
  assert.equal(result.summary, "Need help");
  assert.equal(result.notes, "Keep it warm");
  assert.equal(result.kind, "firing");
  assert.equal(result.status, "accepted");
  assert.equal(result.logisticsMode, "pickup");
  assert.equal(result.createdByUid, "owner-1");
  assert.equal(result.createdByMode, "pat");
  assert.equal(result.createdByTokenId, "pat-token");
  assert.equal(result.staffAssignedToUid, "staff-1");
  assert.deepEqual(result.staffTriagedAt, { seconds: 2_000_000 });
  assert.equal(result.staffInternalNotes, "Needs special clay");
  assert.deepEqual(result.constraints, { requiresFork: true });
  assert.deepEqual(result.metadata, { project: "summer" });
  assert.equal(result.commissionOrderId, "order-1");
  assert.equal(result.commissionPaymentStatus, "checkout_pending");
  assert.deepEqual(result.createdAt, { seconds: 1_000_000 });
  assert.deepEqual(result.updatedAt, { seconds: 1_500_000 });
  assert.equal("internalNote" in result, false);
});

test("toBatchDetailRow omits undefined fields while preserving known document keys", () => {
  const result = toBatchDetailRow("batch-1", {
    title: "Summer test",
    isClosed: false,
    hidden: undefined as unknown,
    nested: { secret: "value" },
    nestedUndefined: { value: undefined as unknown },
  });

  assert.equal(result.id, "batch-1");
  assert.equal(result.title, "Summer test");
  assert.equal(result.isClosed, false);
  assert.equal("hidden" in result, false);
  assert.equal((result.nested as Record<string, unknown>).secret, "value");
  assert.equal((result.nestedUndefined as Record<string, unknown>).value, undefined);
});

test("handleApiV1 normalizes trailing slash for known routes", async () => {
  const request = makeRequest("/v1/hello/", {}, patContext());
  const response = createResponse();

  await withMockedRateLimit(async () =>
    withMockFirestore({}, async () => {
      await handleApiV1(request, response.res);
    }),
  );

  assert.equal(response.status(), 200);
  const body = response.body() as { ok: boolean };
  assert.equal(body.ok, true);
});

test("handleApiV1 rejects unknown route paths", async () => {
  const request = makeRequest("/v1/nonexistent", {}, patContext());
  const response = createResponse();

  await withMockedRateLimit(async () =>
    withMockFirestore({}, async () => {
      await handleApiV1(request, response.res);
    }),
  );

  assert.equal(response.status(), 404);
  const body = response.body() as { code: string; message: string };
  assert.equal(body.code, "NOT_FOUND");
  assert.equal(body.message, "Unknown route");
});

test("handleApiV1 continues when route-level rate limit check throws", async () => {
  const request = makeRequest("/v1/hello", {}, patContext());
  const response = createResponse();

  await withMockedRateLimitPlan(["throw"], async () =>
    withMockFirestore({}, async () => {
      await handleApiV1(request, response.res);
    }),
  );

  assert.equal(response.status(), 200);
});

test("handleApiV1 continues when agent actor rate limit check throws", async () => {
  const request = makeRequest("/v1/agent.catalog", {}, patContext({ scopes: ["catalog:read"] }));
  const response = createResponse();
  const state = withPatTermsAcceptance({});

  await withMockedRateLimitPlan(["ok", "throw"], async () =>
    withMockFirestore(state, async () => {
      await handleApiV1(request, response.res);
    }),
  );

  assert.equal(response.status(), 200);
  const body = response.body() as { ok: boolean };
  assert.equal(body.ok, true);
});

test("delegated owner mismatch on agent.status emits authz audit event", async () => {
  const request = makeRequest("/v1/agent.status", { orderId: "order-owner-mismatch" }, delegatedContext({ uid: "owner-1", scopes: ["status:read"], delegationId: "delegation-1" }));
  const response = createResponse();
  const state = withDelegatedTermsAcceptance(
    {
      delegations: {
        "delegation-1": {
          ownerUid: "owner-1",
          agentClientId: "agent-client-1",
          scopes: ["status:read"],
          resources: ["*"],
          status: "active",
          expiresAt: Date.now() + 60_000,
          revokedAt: 0,
        },
      },
      agentOrders: {
        "order-owner-mismatch": {
          uid: "owner-2",
          status: "payment_required",
        },
      },
    },
    "owner-1",
    "agent-client-1",
  );

  await withStrictDelegation(async () =>
    withMockedRateLimit(async () =>
      withMockFirestore(state, async () => {
        await handleApiV1(request, response.res);
      }),
    ),
  );

  assert.equal(response.status(), 403);
  assert.equal((response.body() as { code: string }).code, "OWNER_MISMATCH");
  const auditEvents = getAuditEvents(state);
  const event = auditEvents.find((row) => row.action === "agent_status_authz");
  assert.ok(event);
  assert.equal(event?.action, "agent_status_authz");
  assert.equal(event?.reasonCode, "OWNER_MISMATCH");
  assert.equal(event?.resourceId, "order-owner-mismatch");
  assertDelegationAuditMetadata(event);
});

type OwnerMismatchCase = {
  label: string;
  route: string;
  body: Record<string, unknown>;
  scopes: string[];
  state: MockDbState;
  expectedCode: string;
  auditAction?: string;
  expectedResourceType?: string;
};

const ownerMismatchScenarios: OwnerMismatchCase[] = [
  {
    label: "events.feed",
    route: "/v1/events.feed",
    body: { uid: "owner-2" },
    scopes: ["events:read"],
    state: {} as MockDbState,
    expectedCode: "OWNER_MISMATCH",
  },
  {
    label: "agent.pay",
    route: "/v1/agent.pay",
    body: { reservationId: "reservation-owner-mismatch" },
    scopes: ["pay:write"],
    state: { agentReservations: { "reservation-owner-mismatch": { uid: "owner-2" } } },
    expectedCode: "OWNER_MISMATCH",
  },
  {
    label: "agent.status",
    route: "/v1/agent.status",
    body: { orderId: "order-owner-mismatch" },
    scopes: ["status:read"],
    state: { agentOrders: { "order-owner-mismatch": { uid: "owner-2" } } },
    expectedCode: "OWNER_MISMATCH",
  },
  {
    label: "agent.order.get",
    route: "/v1/agent.order.get",
    body: { orderId: "order-get-owner-mismatch" },
    scopes: ["status:read"],
    state: { agentOrders: { "order-get-owner-mismatch": { uid: "owner-2" } } },
    expectedCode: "OWNER_MISMATCH",
  },
  {
    label: "agent.orders.list",
    route: "/v1/agent.orders.list",
    body: { uid: "owner-2" },
    scopes: ["status:read"],
    state: {} as MockDbState,
    expectedCode: "OWNER_MISMATCH",
  },
  {
    label: "agent.requests.updateStatus",
    route: "/v1/agent.requests.updateStatus",
    body: { requestId: "request-owner-mismatch", status: "cancelled" },
    scopes: ["requests:write"],
    state: { agentRequests: { "request-owner-mismatch": { createdByUid: "owner-2" } } },
    expectedCode: "OWNER_MISMATCH",
  },
];

for (const scenario of ownerMismatchScenarios) {
  test(`handleApiV1 denies ${scenario.label} for non-owner pat actor`, async () => {
    const request = makeRequest(scenario.route, scenario.body, patContext({ uid: "owner-1", scopes: scenario.scopes }));
    const response = createResponse();

    await withMockedRateLimit(async () =>
      withMockFirestore(withPatTermsAcceptance(scenario.state), async () => {
        await handleApiV1(request, response.res);
      }),
    );

    assert.equal(response.status(), 403);
    assert.equal((response.body() as { code: string }).code, scenario.expectedCode);
  });
}

for (const scenario of ownerMismatchScenarios) {
  test(`handleApiV1 denies ${scenario.label} for non-owner non-staff firebase actor`, async () => {
    const request = makeRequest(scenario.route, scenario.body, firebaseContext({ uid: "owner-1" }));
    const response = createResponse();

    await withMockedRateLimit(async () =>
      withMockFirestore(scenario.state, async () => {
        await handleApiV1(request, response.res);
      }),
    );

    assert.equal(response.status(), 403);
    assert.equal((response.body() as { code: string }).code, scenario.expectedCode);
  });
}

const delegatedOwnerMismatchScenarios: OwnerMismatchCase[] = [
  {
    label: "events.feed",
    route: "/v1/events.feed",
    body: { uid: "owner-2" },
    scopes: ["events:read"],
    state: {},
    expectedCode: "OWNER_MISMATCH",
    auditAction: "events_feed_authz",
    expectedResourceType: "agent_events",
  },
  {
    label: "agent.pay",
    route: "/v1/agent.pay",
    body: { reservationId: "reservation-owner-mismatch" },
    scopes: ["pay:write"],
    state: { agentReservations: { "reservation-owner-mismatch": { uid: "owner-2" } } },
    expectedCode: "OWNER_MISMATCH",
    auditAction: "agent_pay_authz",
    expectedResourceType: "agent_order",
  },
  {
    label: "agent.status",
    route: "/v1/agent.status",
    body: { orderId: "order-owner-mismatch" },
    scopes: ["status:read"],
    state: { agentOrders: { "order-owner-mismatch": { uid: "owner-2" } } },
    expectedCode: "OWNER_MISMATCH",
    auditAction: "agent_status_authz",
    expectedResourceType: "agent_status",
  },
  {
    label: "agent.order.get",
    route: "/v1/agent.order.get",
    body: { orderId: "order-get-owner-mismatch" },
    scopes: ["status:read"],
    state: { agentOrders: { "order-get-owner-mismatch": { uid: "owner-2" } } },
    expectedCode: "OWNER_MISMATCH",
    auditAction: "agent_order_authz",
    expectedResourceType: "agent_order",
  },
  {
    label: "agent.orders.list",
    route: "/v1/agent.orders.list",
    body: { uid: "owner-2" },
    scopes: ["status:read"],
    state: {} as MockDbState,
    expectedCode: "OWNER_MISMATCH",
    auditAction: "agent_orders_list_authz",
    expectedResourceType: "agent_orders",
  },
  {
    label: "agent.requests.updateStatus",
    route: "/v1/agent.requests.updateStatus",
    body: { requestId: "request-owner-mismatch", status: "cancelled" },
    scopes: ["requests:write"],
    state: { agentRequests: { "request-owner-mismatch": { createdByUid: "owner-2" } } },
    expectedCode: "OWNER_MISMATCH",
    auditAction: "agent_request_status_update_authz",
    expectedResourceType: "agent_request",
  },
  {
    label: "agent.reserve",
    route: "/v1/agent.reserve",
    body: { quoteId: "quote-owner-mismatch", holdMinutes: 20 },
    scopes: ["reserve:write"],
    state: {
      agentQuotes: {
        "quote-owner-mismatch": {
          uid: "owner-2",
          status: "quoted",
          expiresAt: { seconds: Math.floor(Date.now() / 1000) + 60 },
        },
      },
    },
    expectedCode: "OWNER_MISMATCH",
    auditAction: "agent_reserve_authz",
    expectedResourceType: "agent_quote",
  },
];

for (const scenario of delegatedOwnerMismatchScenarios) {
  test(`handleApiV1 denies ${scenario.label} for non-owner delegated actor`, async () => {
    const state = withDelegatedTermsAcceptance(
      {
        ...scenario.state,
        delegations: {
          "delegation-1": {
            ownerUid: "owner-1",
            agentClientId: "agent-client-1",
            scopes: scenario.scopes,
            resources: ["*"],
            status: "active",
            expiresAt: Date.now() + 60_000,
            revokedAt: 0,
          },
        },
      },
      "owner-1",
      "agent-client-1",
    );

    const request = makeRequest(
      scenario.route,
      scenario.body,
      delegatedContext({ uid: "owner-1", tokenId: "delegated-token", scopes: scenario.scopes, delegationId: "delegation-1" }),
    );
    const response = createResponse();

    await withStrictDelegation(async () =>
      withMockedRateLimit(async () =>
        withMockFirestore(state, async () => {
          await handleApiV1(request, response.res);
        }),
      ),
    );

    assert.equal(response.status(), 403);
    assert.equal((response.body() as { code: string }).code, scenario.expectedCode);
    if (scenario.auditAction) {
      const auditEvents = getAuditEvents(state);
      const event = auditEvents.find((row) => row.action === scenario.auditAction);
      assert.ok(event, `Missing ${scenario.auditAction} audit event for ${scenario.label}`);
      assert.equal(event?.reasonCode, scenario.expectedCode);
      assert.equal(event?.actorMode, "delegated");
      assertDelegationAuditMetadata(event);
      if (scenario.expectedResourceType) {
        assert.equal(event?.resourceType, scenario.expectedResourceType);
      }
    }
  });
}

const staffBypassScenarios: OwnerMismatchCase[] = [
  {
    label: "events.feed",
    route: "/v1/events.feed",
    body: { uid: "owner-2" },
    scopes: [],
    state: {},
    expectedCode: "200",
  },
  {
    label: "agent.pay",
    route: "/v1/agent.pay",
    body: { reservationId: "reservation-bypass" },
    scopes: [],
    state: { agentReservations: { "reservation-bypass": { uid: "owner-2", status: "reserved" } } },
    expectedCode: "200",
  },
  {
    label: "agent.status",
    route: "/v1/agent.status",
    body: { orderId: "order-bypass" },
    scopes: [],
    state: { agentOrders: { "order-bypass": { uid: "owner-2" } } },
    expectedCode: "200",
  },
  {
    label: "agent.order.get",
    route: "/v1/agent.order.get",
    body: { orderId: "order-get-bypass" },
    scopes: [],
    state: { agentOrders: { "order-get-bypass": { uid: "owner-2", status: "payment_required" } } },
    expectedCode: "200",
  },
  {
    label: "agent.orders.list",
    route: "/v1/agent.orders.list",
    body: { uid: "owner-2" },
    scopes: [],
    state: { agentOrders: { "order-list-bypass": { uid: "owner-2", status: "payment_required" } } },
    expectedCode: "200",
  },
  {
    label: "agent.requests.updateStatus",
    route: "/v1/agent.requests.updateStatus",
    body: { requestId: "request-bypass", status: "cancelled" },
    scopes: [],
    state: {
      agentRequests: {
        "request-bypass": {
          createdByUid: "owner-2",
          kind: "firing",
          title: "Sample",
          status: "new",
        },
      },
    },
    expectedCode: "200",
  },
];

for (const scenario of staffBypassScenarios) {
  test(`handleApiV1 allows staff bypass for ${scenario.label}`, async () => {
    const request = makeRequest(scenario.route, scenario.body, staffContext());
    const response = createResponse();

    await withMockedRateLimit(async () =>
      withMockFirestore(scenario.state, async () => {
        await handleApiV1(request, response.res);
      }),
    );

    assert.equal(response.status(), 200);
  });
}

test("handleApiV1 denies agent.reserve for non-owner quote owner", async () => {
  const request = makeRequest("/v1/agent.reserve", { quoteId: "quote-owner-mismatch" }, patContext({ scopes: ["reserve:write"] }));
  const response = createResponse();
  const state = withPatTermsAcceptance({ agentQuotes: { "quote-owner-mismatch": { uid: "owner-2" } } });

  await withMockedRateLimit(async () => {
    await withMockFirestore(state, async () => {
      await handleApiV1(request, response.res);
    }, {
      runTransaction: async (callback) => callback({
        get: async (docRef) => {
          if (docRef.__mfCollection === "agentQuotes" && docRef.__mfDocId === "quote-owner-mismatch") {
            return {
              id: "quote-owner-mismatch",
              exists: true,
              data: () => ({ uid: "owner-2" }),
            };
          }
          return { id: docRef.__mfDocId, exists: false, data: () => null };
        },
        set: async () => {},
      }),
    });
  });

  assert.equal(response.status(), 403);
  assert.equal((response.body() as { code: string }).code, "OWNER_MISMATCH");
});

test("delegated actor denied for status read when delegation scope is missing", async () => {
  const state = withDelegatedTermsAcceptance(
    {
      delegations: {
        "delegation-1": {
          ownerUid: "owner-1",
          agentClientId: "agent-client-1",
          scopes: ["requests:write"],
          resources: ["order:order-missing-scope"],
          status: "active",
          expiresAt: Date.now() + 60_000,
          revokedAt: 0,
        },
      },
      agentOrders: {
        "order-missing-scope": { uid: "owner-1" },
      },
    },
    "owner-1",
    "agent-client-1",
  );
  await withStrictDelegation(async () =>
    withMockedRateLimit(async () =>
      withMockFirestore(state, async () => {
        const request = makeRequest("/v1/agent.order.get", { orderId: "order-missing-scope" }, delegatedContext());
        const response = createResponse();
        await handleApiV1(request, response.res);
        assert.equal(response.status(), 403);
        assert.equal((response.body() as { code: string }).code, "DELEGATION_SCOPE_MISSING");
        const auditEvents = getAuditEvents(state);
        const event = auditEvents.find((row) => row.action === "agent_order_authz");
        if (!event) {
          assert.fail(`Missing agent_order_authz audit event: ${JSON.stringify(auditEvents)}`);
        }
        assert.equal(event?.reasonCode, "DELEGATION_SCOPE_MISSING");
        assert.equal(event?.actorMode, "delegated");
        assert.equal(event?.resourceType, "agent_order");
        assertDelegationAuditMetadata(event);
      }),
    ),
  );
});

test("delegated actor denied for status read when delegation resource is missing", async () => {
  const state = withDelegatedTermsAcceptance(
    {
      delegations: {
        "delegation-1": {
          ownerUid: "owner-1",
          agentClientId: "agent-client-1",
          scopes: ["status:read"],
          resources: ["route:/v1/agent.order.get"],
          status: "active",
          expiresAt: Date.now() + 60_000,
          revokedAt: 0,
        },
      },
      agentOrders: {
        "order-missing-resource": { uid: "owner-1" },
      },
    },
    "owner-1",
    "agent-client-1",
  );
  await withStrictDelegation(async () =>
    withMockedRateLimit(async () =>
      withMockFirestore(state, async () => {
        const request = makeRequest("/v1/agent.order.get", { orderId: "order-missing-resource" }, delegatedContext());
        const response = createResponse();
        await handleApiV1(request, response.res);
        assert.equal(response.status(), 403);
        assert.equal((response.body() as { code: string }).code, "DELEGATION_RESOURCE_MISSING");
        const auditEvents = getAuditEvents(state);
        const event = auditEvents.find((row) => row.action === "agent_order_authz");
        if (!event) {
          assert.fail(`Missing agent_order_authz audit event: ${JSON.stringify(auditEvents)}`);
        }
        assert.equal(event?.reasonCode, "DELEGATION_RESOURCE_MISSING");
        assert.equal(event?.actorMode, "delegated");
        assert.equal(event?.resourceType, "agent_order");
        assertDelegationAuditMetadata(event);
      }),
    ),
  );
});
test("delegated actor denied for status read when delegation scope missing on status route", async () => {
  const state = withDelegatedTermsAcceptance(
    {
      delegations: {
        "delegation-1": {
          ownerUid: "owner-1",
          agentClientId: "agent-client-1",
          scopes: ["requests:write"],
          resources: ["order:order-status-route-scope"],
          status: "active",
          expiresAt: Date.now() + 60_000,
          revokedAt: 0,
        },
      },
      agentOrders: {
        "order-status-route-scope": { uid: "owner-1" },
      },
    },
    "owner-1",
    "agent-client-1",
  );
  await withStrictDelegation(async () =>
    withMockedRateLimit(async () =>
      withMockFirestore(state, async () => {
        const request = makeRequest("/v1/agent.status", { orderId: "order-status-route-scope" }, delegatedContext());
        const response = createResponse();
        await handleApiV1(request, response.res);
        assert.equal(response.status(), 403);
        assert.equal((response.body() as { code: string }).code, "DELEGATION_SCOPE_MISSING");
        const auditEvents = getAuditEvents(state);
        const event = auditEvents.find((row) => row.action === "agent_status_authz");
        if (!event) {
          assert.fail(`Missing agent_status_authz audit event: ${JSON.stringify(auditEvents)}`);
        }
        assert.equal(event?.reasonCode, "DELEGATION_SCOPE_MISSING");
        assert.equal(event?.actorMode, "delegated");
        assert.equal(event?.resourceType, "agent_status");
        assertDelegationAuditMetadata(event);
      }),
    ),
  );
});

test("delegated actor denied for status read when delegation resource is missing on status route", async () => {
  const state = withDelegatedTermsAcceptance(
    {
      delegations: {
        "delegation-1": {
          ownerUid: "owner-1",
          agentClientId: "agent-client-1",
          scopes: ["status:read"],
          resources: ["route:/v1/agent.order.get"],
          status: "active",
          expiresAt: Date.now() + 60_000,
          revokedAt: 0,
        },
      },
      agentOrders: {
        "order-status-route-resource": { uid: "owner-1" },
      },
    },
    "owner-1",
    "agent-client-1",
  );
  await withStrictDelegation(async () =>
    withMockedRateLimit(async () =>
      withMockFirestore(state, async () => {
        const request = makeRequest("/v1/agent.status", { orderId: "order-status-route-resource" }, delegatedContext());
        const response = createResponse();
        await handleApiV1(request, response.res);
        assert.equal(response.status(), 403);
        assert.equal((response.body() as { code: string }).code, "DELEGATION_RESOURCE_MISSING");
        const auditEvents = getAuditEvents(state);
        const event = auditEvents.find((row) => row.action === "agent_status_authz");
        if (!event) {
          assert.fail(`Missing agent_status_authz audit event: ${JSON.stringify(auditEvents)}`);
        }
        assert.equal(event?.reasonCode, "DELEGATION_RESOURCE_MISSING");
        assert.equal(event?.actorMode, "delegated");
        assert.equal(event?.resourceType, "agent_status");
        assertDelegationAuditMetadata(event);
      }),
    ),
  );
});

test("delegated actor denied for agent.orders.list and agent.requests.updateStatus when delegation scope is missing", async () => {
  const state = withDelegatedTermsAcceptance({
    delegations: {
      "delegation-1": {
        ownerUid: "owner-1",
        agentClientId: "agent-client-1",
        scopes: ["status:read"],
        resources: ["*"],
        status: "active",
        expiresAt: Date.now() + 60_000,
        revokedAt: 0,
      },
    },
    agentRequests: {
      "request-scope-missing": {
        createdByUid: "owner-1",
        status: "new",
      },
    },
  }, "owner-1", "agent-client-1");
  const testState = {
    ...state,
    agentOrders: {
      "order-list-scope-missing": {
        uid: "owner-1",
        status: "payment_required",
      },
    },
  };
  await withStrictDelegation(async () =>
    withMockedRateLimit(async () =>
      withMockFirestore(
        testState,
        async () => {
          const missingScopeStatus = {
            "/v1/agent.orders.list": {
              action: "agent_orders_list_authz",
              code: "MISSING_SCOPE",
              body: { uid: "owner-1" },
              scopes: [],
              resourceType: "agent_orders",
            },
            "/v1/agent.requests.updateStatus": {
              action: "agent_request_status_update_authz",
              code: "MISSING_SCOPE",
              body: { requestId: "request-scope-missing", status: "cancelled" },
              scopes: [],
              resourceType: "agent_request",
            },
          } as Record<string, { action: string; code: string; body: Record<string, unknown>; scopes: string[]; resourceType: string }>;

          for (const [route, expectation] of Object.entries(missingScopeStatus)) {
            const request = makeRequest(
              route as "/v1/agent.orders.list" | "/v1/agent.requests.updateStatus",
              expectation.body,
              delegatedContext({ uid: "owner-1", scopes: expectation.scopes }),
            );
            const response = createResponse();
            await handleApiV1(request, response.res);
            assert.equal(response.status(), 403);
            assert.equal((response.body() as { code: string }).code, expectation.code);
            const auditEvents = getAuditEvents(testState);
            const event = auditEvents.find((row) => row.action === expectation.action);
            if (!event) {
              assert.fail(`Missing ${expectation.action} audit event for ${route}: ${JSON.stringify(auditEvents)}`);
            }
            assert.equal(event?.reasonCode, expectation.code);
            assert.equal(event?.actorMode, "delegated");
            assert.equal(event?.resourceType, expectation.resourceType);
            assertDelegationAuditMetadata(event);
          }
        },
      ),
    ),
  );
});

test("delegated actor denied for agent.orders.list and agent.requests.updateStatus when delegation resource is missing", async () => {
  const state = withDelegatedTermsAcceptance({
    delegations: {
      "delegation-1": {
        ownerUid: "owner-1",
        agentClientId: "agent-client-1",
        scopes: ["status:read", "requests:write"],
        resources: ["route:/v1/agent.order.get"],
        status: "active",
        expiresAt: Date.now() + 60_000,
        revokedAt: 0,
      },
    },
    agentRequests: {
      "request-resource-missing": {
        createdByUid: "owner-1",
        status: "new",
      },
    },
  }, "owner-1", "agent-client-1");
  const testState = {
    ...state,
    agentOrders: {
      "order-list-resource-missing": {
        uid: "owner-1",
        status: "payment_required",
      },
    },
  };
  await withStrictDelegation(async () =>
    withMockedRateLimit(async () =>
      withMockFirestore(
        testState,
        async () => {
          const missingResource = {
            "/v1/agent.orders.list": {
              action: "agent_orders_list_authz",
              code: "DELEGATION_RESOURCE_MISSING",
              body: { uid: "owner-1" },
              scopes: ["status:read"],
              resourceType: "agent_orders",
            },
            "/v1/agent.requests.updateStatus": {
              action: "agent_request_status_update_authz",
              code: "DELEGATION_RESOURCE_MISSING",
              body: { requestId: "request-resource-missing", status: "cancelled" },
              scopes: ["requests:write"],
              resourceType: "agent_request",
            },
          } as Record<string, { action: string; code: string; body: Record<string, unknown>; scopes: string[]; resourceType: string }>;

          for (const [route, expectation] of Object.entries(missingResource)) {
            const request = makeRequest(
              route as "/v1/agent.orders.list" | "/v1/agent.requests.updateStatus",
              expectation.body,
              delegatedContext({ uid: "owner-1", scopes: expectation.scopes }),
            );
            const response = createResponse();
            await handleApiV1(request, response.res);
            assert.equal(response.status(), 403);
            assert.equal((response.body() as { code: string }).code, expectation.code);
            const auditEvents = getAuditEvents(testState);
            const event = auditEvents.find((row) => row.action === expectation.action);
            if (!event) {
              assert.fail(`Missing ${expectation.action} audit event for ${route}: ${JSON.stringify(auditEvents)}`);
            }
            assert.equal(event?.reasonCode, expectation.code);
            assert.equal(event?.actorMode, "delegated");
            assert.equal(event?.resourceType, expectation.resourceType);
            assertDelegationAuditMetadata(event);
          }
        },
      ),
    ),
  );
});

type DelegatedStrictFailureCase = {
  label: string;
  route: "/v1/events.feed" | "/v1/agent.reserve" | "/v1/agent.pay" | "/v1/agent.status" | "/v1/agent.order.get" | "/v1/agent.orders.list" | "/v1/agent.requests.updateStatus";
  body: Record<string, unknown>;
  scope: string;
  ownerUid: string;
  delegationResource: string;
  auditAction: string;
  expectedResourceType: string;
  state: MockDbState;
  supportedFailureModes?: Array<DelegationFailureMode["expectedCode"]>;
};

type DelegationFailureMode = {
  label: string;
  expectedCode: "DELEGATION_NOT_FOUND" | "DELEGATION_INACTIVE" | "DELEGATION_REVOKED" | "DELEGATION_EXPIRED";
  buildDelegation?:
    | ((delegation: {
      ownerUid: string;
      agentClientId: string;
      scopes: string[];
      resources: string[];
      status: string;
      expiresAt: number;
      revokedAt: number;
    }) => Record<string, unknown>)
    | null;
};

const delegatedStrictFixtures: DelegatedStrictFailureCase[] = [
  {
    label: "events.feed",
    route: "/v1/events.feed",
    body: { uid: "owner-1" },
    scope: "events:read",
    ownerUid: "owner-1",
    delegationResource: "owner:owner-1",
    auditAction: "events_feed_authz",
    expectedResourceType: "agent_events",
    state: {},
    supportedFailureModes: ["DELEGATION_NOT_FOUND", "DELEGATION_INACTIVE"],
  },
  {
    label: "agent.reserve",
    route: "/v1/agent.reserve",
    body: { quoteId: "quote-strict-failure", holdMinutes: 20 },
    scope: "reserve:write",
    ownerUid: "owner-1",
    delegationResource: "route:/v1/agent.reserve",
    auditAction: "api_v1_route_authz",
    expectedResourceType: "api_v1_route",
    state: {
      agentQuotes: {
        "quote-strict-failure": {
          uid: "owner-1",
          status: "quoted",
          expiresAt: { seconds: Math.floor(Date.now() / 1000) + 60 },
        },
      },
    },
    supportedFailureModes: ["DELEGATION_NOT_FOUND", "DELEGATION_INACTIVE", "DELEGATION_REVOKED", "DELEGATION_EXPIRED"],
  },
  {
    label: "agent.pay",
    route: "/v1/agent.pay",
    body: { reservationId: "reservation-strict-failure" },
    scope: "pay:write",
    ownerUid: "owner-1",
    delegationResource: "route:/v1/agent.pay",
    auditAction: "api_v1_route_authz",
    expectedResourceType: "api_v1_route",
    state: {
      agentReservations: {
        "reservation-strict-failure": {
          uid: "owner-1",
          status: "reserved",
        },
      },
    },
    supportedFailureModes: ["DELEGATION_NOT_FOUND", "DELEGATION_INACTIVE", "DELEGATION_REVOKED", "DELEGATION_EXPIRED"],
  },
  {
    label: "agent.status",
    route: "/v1/agent.status",
    body: { orderId: "order-strict-failure" },
    scope: "status:read",
    ownerUid: "owner-1",
    delegationResource: "route:/v1/agent.status",
    auditAction: "agent_status_authz",
    expectedResourceType: "agent_status",
    state: {
      agentOrders: {
        "order-strict-failure": {
          uid: "owner-1",
          status: "payment_required",
        },
      },
    },
  },
  {
    label: "agent.order.get",
    route: "/v1/agent.order.get",
    body: { orderId: "order-strict-get" },
    scope: "status:read",
    ownerUid: "owner-1",
    delegationResource: "route:/v1/agent.order.get",
    auditAction: "agent_order_authz",
    expectedResourceType: "agent_order",
    state: {
      agentOrders: {
        "order-strict-get": {
          uid: "owner-1",
          status: "payment_required",
        },
      },
    },
  },
  {
    label: "agent.orders.list",
    route: "/v1/agent.orders.list",
    body: { uid: "owner-1" },
    scope: "status:read",
    ownerUid: "owner-1",
    delegationResource: "route:/v1/agent.orders.list",
    auditAction: "agent_orders_list_authz",
    expectedResourceType: "agent_orders",
    state: {
      agentOrders: {
        "order-strict-list": {
          uid: "owner-1",
          status: "payment_required",
        },
      },
    },
  },
  {
    label: "agent.requests.updateStatus",
    route: "/v1/agent.requests.updateStatus",
    body: { requestId: "request-strict-failure", status: "cancelled" },
    scope: "requests:write",
    ownerUid: "owner-1",
    delegationResource: "route:/v1/agent.requests.updateStatus",
    auditAction: "agent_request_status_update_authz",
    expectedResourceType: "agent_request",
    state: {
      agentRequests: {
        "request-strict-failure": {
          createdByUid: "owner-1",
          status: "new",
        },
      },
    },
  },
];

const delegatedFailureModes: DelegationFailureMode[] = [
  {
    label: "not found",
    expectedCode: "DELEGATION_NOT_FOUND",
    buildDelegation: null,
  },
  {
    label: "inactive",
    expectedCode: "DELEGATION_INACTIVE",
    buildDelegation: (delegation) => ({
      ...delegation,
      status: "inactive",
    }),
  },
  {
    label: "revoked",
    expectedCode: "DELEGATION_REVOKED",
    buildDelegation: (delegation) => ({
      ...delegation,
      revokedAt: Date.now() + 1,
    }),
  },
  {
    label: "expired",
    expectedCode: "DELEGATION_EXPIRED",
    buildDelegation: (delegation) => ({
      ...delegation,
      expiresAt: Date.now() - 10_000,
    }),
  },
];

for (const mode of delegatedFailureModes) {
  for (const fixture of delegatedStrictFixtures) {
    if (fixture.supportedFailureModes && !fixture.supportedFailureModes.includes(mode.expectedCode)) {
      continue;
    }
        test(`delegated strict mode returns ${mode.expectedCode} for ${fixture.label}`, async () => {
      const baseDelegation = {
        ownerUid: fixture.ownerUid,
        agentClientId: "agent-client-1",
        scopes: [fixture.scope],
        resources: [fixture.delegationResource],
        status: "active",
        expiresAt: Date.now() + 60_000,
        revokedAt: 0,
      };
      const delegation = mode.buildDelegation?.(baseDelegation);
      const state = withDelegatedTermsAcceptance(
        {
          ...fixture.state,
          ...(mode.expectedCode !== "DELEGATION_NOT_FOUND"
            ? { delegations: { "delegation-1": delegation as Record<string, unknown> } }
            : {}),
        },
        fixture.ownerUid,
        "agent-client-1",
      );

      await withStrictDelegation(async () =>
        withMockedRateLimit(async () =>
          withMockFirestore(state, async () => {
            const request = makeRequest(
              fixture.route,
              fixture.body,
              delegatedContext({
                uid: fixture.ownerUid,
                scopes: [fixture.scope],
                delegationId: "delegation-1",
              }),
            );
            const response = createResponse();
            await handleApiV1(request, response.res);
            assert.equal(response.status(), 403);
            assert.equal((response.body() as { code: string }).code, mode.expectedCode);
            const auditEvents = getAuditEvents(state);
            const event = auditEvents.find((row) => row.action === fixture.auditAction);
            if (!event) {
              assert.fail(`Missing ${fixture.auditAction} audit event for ${fixture.label} (${mode.label}): ${JSON.stringify(auditEvents)}`);
            }
            assert.equal(event?.reasonCode, mode.expectedCode);
            assert.equal(event?.actorMode, "delegated");
            assert.equal(event?.resourceType, fixture.expectedResourceType);
            assertDelegationAuditMetadata(event);
          }),
        ),
      );
    });
  }
}
