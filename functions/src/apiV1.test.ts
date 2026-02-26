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
  get: (docRef: unknown) => Promise<unknown>;
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

  const getCollectionRows = (collectionPath: string): Record<string, DbValue> => {
    const rows = state[collectionPath] ?? {};
    if (!Object.prototype.hasOwnProperty.call(state, collectionPath)) {
      state[collectionPath] = rows;
    }
    return rows;
  };

  const addCounters = new Map<string, number>();
  const nextGeneratedId = (collectionPath: string): string => {
    const nextValue = (addCounters.get(collectionPath) ?? 0) + 1;
    addCounters.set(collectionPath, nextValue);
    const prefix = collectionPath.split("/").join("_");
    return `${prefix}-${nextValue}`;
  };

  const lookup = (collectionName: string, id: string): MockSnapshot => {
    const rows = getCollectionRows(collectionName);
    const row = Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
    return createSnapshot(id, row);
  };

  const createCollectionRef = (collectionName: string) => {
    const rows = getCollectionRows(collectionName);
    return {
      add: async (_doc: Record<string, unknown>) => {
        const generatedId = nextGeneratedId(collectionName);
        rows[generatedId] = _doc;
        return { id: generatedId };
      },
      doc: (id: string) => {
        const collectionRow = rows[id] ?? null;
        return {
          __mfCollection: collectionName,
          __mfDocId: id,
          get: async () => createSnapshot(id, Object.prototype.hasOwnProperty.call(rows, id) ? collectionRow : null),
          set: async () => {
            return undefined;
          },
          collection: (sub: string) => createCollectionRef(`${collectionName}/${id}/${sub}`),
        };
      },
      where: () => createCollectionQuery(rows),
      orderBy: () => createCollectionQuery(rows),
      limit: (limit: number) => createCollectionQuery(rows, limit),
      get: async () => {
        const docs = listSnapshots(rows);
        return { docs, empty: docs.length === 0 };
      },
    };
  };

  db.collection = (collectionName) => createCollectionRef(collectionName);

  db.doc = (path: string) => {
    const parts = path.split("/").filter((part) => part.length > 0);
    const docId = parts.at(-1) ?? "";
    const collectionName = parts.slice(0, -1).join("/");
    const rows = getCollectionRows(collectionName);
    const raw = Object.prototype.hasOwnProperty.call(rows, docId) ? rows[docId] : null;
    return {
      get: async () => createSnapshot(docId, raw),
      set: async () => {
        return undefined;
      },
      exists: raw !== null,
    };
  };

  db.runTransaction =
    options?.runTransaction ??
    (async (txCallback) => {
      const tx: MockTransaction = {
        get: async (docRef) => {
          const maybeDoc = docRef as { __mfCollection?: unknown; __mfDocId?: unknown };
          if (
            maybeDoc &&
            typeof maybeDoc.__mfCollection === "string" &&
            typeof maybeDoc.__mfDocId === "string"
          ) {
            return lookup(maybeDoc.__mfCollection, maybeDoc.__mfDocId);
          }

          const maybeQuery = docRef as { get?: unknown };
          if (maybeQuery && typeof maybeQuery.get === "function") {
            return await (maybeQuery.get as () => Promise<unknown>)();
          }

          throw new Error("Unsupported tx.get target in test mock");
        },
        set: async () => {
          return undefined;
        },
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
    send: () => {
      return undefined;
    },
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

function makeApiV1Request(params: {
  path: string;
  body: Record<string, unknown>;
  ctx: AuthContext;
  routeFamily?: "v1" | "legacy";
  staffAuthUid?: string | null;
  authClaims?: Record<string, unknown> | null;
}): shared.RequestLike {
  const request: shared.RequestLike & { __routeFamily?: "legacy" } = {
    method: "POST",
    path: params.path,
    body: params.body,
    __mfAuthContext: params.ctx,
  };
  if (params.routeFamily === "legacy") {
    request.__routeFamily = "legacy";
  }
  if (params.staffAuthUid) {
    request.__mfAuth = {
      uid: params.staffAuthUid,
      staff: true,
    };
  } else if (params.authClaims) {
    request.__mfAuth = params.authClaims;
  }
  return request;
}

function cloneState(state: MockDbState): MockDbState {
  return JSON.parse(JSON.stringify(state)) as MockDbState;
}

function withoutRequestId(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") return {};
  const out = { ...(body as Record<string, unknown>) };
  delete out.requestId;
  return out;
}

async function invokeApiV1Route(state: MockDbState, request: shared.RequestLike) {
  const response = createResponse();
  await withMockedRateLimit(async () =>
    withMockFirestore(state, async () => {
      await handleApiV1(request, response.res);
    }),
  );
  return {
    status: response.status(),
    body: response.body(),
    headers: response.headers(),
  };
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

test("handleApiV1 normalizes missing leading slash for known routes", async () => {
  const request = makeRequest("v1/hello", {}, patContext());
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

test("handleApiV1 rejects unknown and malformed route paths with route audit events", async () => {
  const scenarios = [
    { path: "/v1/nonexistent", normalizedRoute: "/v1/nonexistent" },
    { path: "/v1/", normalizedRoute: "/v1" },
    { path: "/v1//hello", normalizedRoute: "/v1//hello" },
  ] as const;

  for (const scenario of scenarios) {
    const request = makeRequest(scenario.path, {}, patContext());
    const response = createResponse();
    const state: MockDbState = {};

    await withMockedRateLimit(async () =>
      withMockFirestore(state, async () => {
        await handleApiV1(request, response.res);
      }),
    );

    assert.equal(response.status(), 404);
    const body = response.body() as { code: string; message: string; details?: Record<string, unknown> };
    assert.equal(body.code, "NOT_FOUND");
    assert.equal(body.message, "Unknown route");
    assert.equal(body.details?.route, scenario.normalizedRoute);

    const event = getAuditEvents(state).find((row) => row.action === "api_v1_route_reject");
    assert.ok(event, `expected route reject audit event for ${scenario.path}`);
    assert.equal(event?.resourceType, "api_v1_route");
    assert.equal(event?.resourceId, scenario.normalizedRoute);
    assert.equal(event?.reasonCode, "ROUTE_NOT_FOUND");
    const metadata = (event?.metadata ?? {}) as Record<string, unknown>;
    assert.equal(metadata.routeFamily, "v1");
  }
});

test("handleApiV1 dispatches /v1/batches.get with stable response contract", async () => {
  const request = makeRequest("/v1/batches.get", { batchId: "batch-1" }, patContext({ scopes: ["batches:read"] }));
  const response = createResponse();
  const state: MockDbState = {
    batches: {
      "batch-1": {
        ownerUid: "owner-1",
        title: "Summer test",
        isClosed: false,
        hidden: undefined as unknown,
        nested: { secret: "keep" },
        experimentalFlag: true,
      },
    },
  };

  await withMockedRateLimit(async () =>
    withMockFirestore(state, async () => {
      await handleApiV1(request, response.res);
    }),
  );

  assert.equal(response.status(), 200);
  const body = response.body() as { ok: boolean; data: { batch: Record<string, unknown> } };
  assert.equal(body.ok, true);
  assert.deepEqual(Object.keys(body.data.batch).sort(), ["experimentalFlag", "id", "isClosed", "nested", "ownerUid", "title"]);
  assert.equal(body.data.batch.id, "batch-1");
  assert.equal(body.data.batch.ownerUid, "owner-1");
  assert.equal(body.data.batch.title, "Summer test");
  assert.equal(body.data.batch.isClosed, false);
  assert.deepEqual(body.data.batch.nested, { secret: "keep" });
  assert.equal(body.data.batch.experimentalFlag, true);
  assert.equal("hidden" in body.data.batch, false);
});

test("handleApiV1 dispatches /v1/batches.timeline.list with projected timeline rows", async () => {
  const request = makeRequest("/v1/batches.timeline.list", { batchId: "batch-1", limit: 5 }, patContext({ scopes: ["timeline:read"] }));
  const response = createResponse();
  const state: MockDbState = {
    batches: {
      "batch-1": {
        ownerUid: "owner-1",
      },
    },
    "batches/batch-1/timeline": {
      "evt-new": {
        type: "LOAD",
        at: { seconds: 300 },
        actorUid: "owner-1",
        actorName: 7,
        notes: "Ready",
        kilnId: "kiln-1",
        kilnName: undefined as unknown,
        photos: ["before.jpg", 2, "after.jpg"],
        pieceState: { stage: "queued" },
        internalOnly: "hidden",
      },
      "evt-old": {
        type: 99,
        at: null,
        actorUid: null,
        actorName: "Helper",
        notes: null,
        kilnId: null,
        kilnName: null,
        photos: "bad",
        pieceState: undefined as unknown,
      },
    },
  };

  await withMockedRateLimit(async () =>
    withMockFirestore(state, async () => {
      await handleApiV1(request, response.res);
    }),
  );

  assert.equal(response.status(), 200);
  assert.deepEqual(withoutRequestId(response.body()), {
    ok: true,
    data: {
      batchId: "batch-1",
      events: [
        {
          id: "evt-new",
          type: "LOAD",
          at: { seconds: 300 },
          actorUid: "owner-1",
          actorName: null,
          notes: "Ready",
          kilnId: "kiln-1",
          kilnName: null,
          photos: ["before.jpg", "after.jpg"],
          pieceState: { stage: "queued" },
        },
        {
          id: "evt-old",
          type: null,
          at: null,
          actorUid: null,
          actorName: "Helper",
          notes: null,
          kilnId: null,
          kilnName: null,
          photos: [],
          pieceState: null,
        },
      ],
    },
  });
});

test("handleApiV1 dispatches /v1/agent.requests.listMine with projected rows and hidden unknown fields", async () => {
  const request = makeRequest(
    "/v1/agent.requests.listMine",
    { includeClosed: false, limit: 10 },
    patContext({ scopes: ["requests:read"] }),
  );
  const response = createResponse();
  const state = withPatTermsAcceptance({
    agentRequests: {
      "request-open": {
        createdByUid: "owner-1",
        createdByMode: "pat",
        createdByTokenId: "pat-token",
        title: "Need test firing",
        summary: "cone 6",
        notes: null,
        kind: "firing",
        status: "triaged",
        linkedBatchId: 3,
        logistics: { mode: "pickup", hidden: "nope" },
        constraints: { rush: true },
        metadata: { source: "portal" },
        staff: {
          assignedToUid: "staff-1",
          triagedAt: { seconds: 200 },
          internalNotes: "watch cone ramp",
        },
        commissionOrderId: null,
        commissionPaymentStatus: "checkout_pending",
        createdAt: { seconds: 100 },
        updatedAt: { seconds: 300 },
        internalOnly: "hide-me",
      },
      "request-closed": {
        createdByUid: "owner-1",
        title: "already done",
        status: "cancelled",
        updatedAt: { seconds: 400 },
      },
    },
  });

  await withMockedRateLimit(async () =>
    withMockFirestore(state, async () => {
      await handleApiV1(request, response.res);
    }),
  );

  assert.equal(response.status(), 200);
  assert.deepEqual(withoutRequestId(response.body()), {
    ok: true,
    data: {
      requests: [
        {
          id: "request-open",
          createdByUid: "owner-1",
          createdByMode: "pat",
          createdByTokenId: "pat-token",
          title: "Need test firing",
          summary: "cone 6",
          notes: null,
          kind: "firing",
          status: "triaged",
          linkedBatchId: null,
          logisticsMode: "pickup",
          createdAt: { seconds: 100 },
          updatedAt: { seconds: 300 },
          staffAssignedToUid: "staff-1",
          staffTriagedAt: { seconds: 200 },
          staffInternalNotes: "watch cone ramp",
          constraints: { rush: true },
          metadata: { source: "portal" },
          commissionOrderId: null,
          commissionPaymentStatus: "checkout_pending",
        },
      ],
    },
  });
  const body = response.body() as { data: { requests: Array<Record<string, unknown>> } };
  assert.equal("internalOnly" in body.data.requests[0], false);
});

test("handleApiV1 continues when route-level rate limit check throws", async () => {
  const request = makeRequest("/v1/hello", {}, patContext());
  const response = createResponse();
  const state: MockDbState = {};

  await withMockedRateLimitPlan(["throw"], async () =>
    withMockFirestore(state, async () => {
      await handleApiV1(request, response.res);
    }),
  );

  assert.equal(response.status(), 200);
  const event = getAuditEvents(state).find((row) => row.action === "api_v1_route_rate_limit_fallback");
  assert.ok(event);
  assert.equal(event?.resourceId, "/v1/hello");
  assert.equal(event?.reasonCode, "RATE_LIMIT_CHECK_ERROR");
  const metadata = (event?.metadata ?? {}) as Record<string, unknown>;
  assert.equal(metadata.scope, "route");
  assert.equal(metadata.route, "/v1/hello");
  assert.equal(metadata.actorMode, "pat");
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
  const event = getAuditEvents(state).find((row) => row.action === "api_v1_agent_rate_limit_fallback");
  assert.ok(event);
  assert.equal(event?.resourceId, "/v1/agent.catalog");
  assert.equal(event?.reasonCode, "RATE_LIMIT_CHECK_ERROR");
  const metadata = (event?.metadata ?? {}) as Record<string, unknown>;
  assert.equal(metadata.scope, "agent");
  assert.equal(metadata.actorKey, "actor:owner-1");
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
    label: "agent.revenue.summary",
    route: "/v1/agent.revenue.summary",
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
    label: "agent.revenue.summary",
    route: "/v1/agent.revenue.summary",
    body: { uid: "owner-2" },
    scopes: ["status:read"],
    state: {} as MockDbState,
    expectedCode: "OWNER_MISMATCH",
    auditAction: "agent_revenue_summary_authz",
    expectedResourceType: "agent_revenue",
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
    label: "agent.revenue.summary",
    route: "/v1/agent.revenue.summary",
    body: { uid: "owner-2" },
    scopes: [],
    state: { agentOrders: { "order-revenue-bypass": { uid: "owner-2", status: "payment_required", amountCents: 1500 } } },
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
          const target = docRef as { __mfCollection?: unknown; __mfDocId?: unknown };
          const docId = typeof target.__mfDocId === "string" ? target.__mfDocId : "unknown";
          if (target.__mfCollection === "agentQuotes" && target.__mfDocId === "quote-owner-mismatch") {
            return {
              id: "quote-owner-mismatch",
              exists: true,
              data: () => ({ uid: "owner-2" }),
            };
          }
          return { id: docId, exists: false, data: () => null };
        },
        set: async () => {
          return undefined;
        },
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

test("delegated actor denied for agent.orders.list, agent.revenue.summary, and agent.requests.updateStatus when delegation scope is missing", async () => {
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
            "/v1/agent.revenue.summary": {
              action: "agent_revenue_summary_authz",
              code: "MISSING_SCOPE",
              body: { uid: "owner-1" },
              scopes: [],
              resourceType: "agent_revenue",
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
              route as "/v1/agent.orders.list" | "/v1/agent.revenue.summary" | "/v1/agent.requests.updateStatus",
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

test("delegated actor denied for agent.orders.list, agent.revenue.summary, and agent.requests.updateStatus when delegation resource is missing", async () => {
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
            "/v1/agent.revenue.summary": {
              action: "agent_revenue_summary_authz",
              code: "DELEGATION_RESOURCE_MISSING",
              body: { uid: "owner-1" },
              scopes: ["status:read"],
              resourceType: "agent_revenue",
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
              route as "/v1/agent.orders.list" | "/v1/agent.revenue.summary" | "/v1/agent.requests.updateStatus",
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
  route:
    | "/v1/events.feed"
    | "/v1/agent.reserve"
    | "/v1/agent.pay"
    | "/v1/agent.status"
    | "/v1/agent.order.get"
    | "/v1/agent.orders.list"
    | "/v1/agent.revenue.summary"
    | "/v1/agent.requests.updateStatus";
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
    label: "agent.revenue.summary",
    route: "/v1/agent.revenue.summary",
    body: { uid: "owner-1" },
    scope: "status:read",
    ownerUid: "owner-1",
    delegationResource: "route:/v1/agent.revenue.summary",
    auditAction: "agent_revenue_summary_authz",
    expectedResourceType: "agent_revenue",
    state: {
      agentOrders: {
        "order-strict-revenue": {
          uid: "owner-1",
          status: "payment_required",
          amountCents: 500,
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

test("reservations.create returns parity envelopes for v1 and legacy route families", async () => {
  const payload = {
    firingType: "glaze",
    shelfEquivalent: 1,
    kilnId: "reductionraku",
  };

  const v1 = await invokeApiV1Route(
    {},
    makeApiV1Request({
      path: "/v1/reservations.create",
      body: payload,
      ctx: firebaseContext({ uid: "owner-1" }),
      routeFamily: "v1",
    }),
  );
  const legacy = await invokeApiV1Route(
    {},
    makeApiV1Request({
      path: "/v1/reservations.create",
      body: payload,
      ctx: firebaseContext({ uid: "owner-1" }),
      routeFamily: "legacy",
    }),
  );

  assert.equal(v1.status, 200);
  assert.equal(legacy.status, 200);
  assert.equal(typeof v1.headers["x-request-id"], "string");
  assert.equal(typeof legacy.headers["x-request-id"], "string");
  assert.deepEqual(withoutRequestId(v1.body), withoutRequestId(legacy.body));
});

test("reservations.create rejects unknown station ids with parity across route families", async () => {
  const payload = {
    firingType: "bisque",
    shelfEquivalent: 1,
    kilnId: "ghost-kiln",
  };

  const v1 = await invokeApiV1Route(
    {},
    makeApiV1Request({
      path: "/v1/reservations.create",
      body: payload,
      ctx: firebaseContext({ uid: "owner-1" }),
      routeFamily: "v1",
    }),
  );
  const legacy = await invokeApiV1Route(
    {},
    makeApiV1Request({
      path: "/v1/reservations.create",
      body: payload,
      ctx: firebaseContext({ uid: "owner-1" }),
      routeFamily: "legacy",
    }),
  );

  assert.equal(v1.status, 400);
  assert.equal(legacy.status, 400);
  assert.deepEqual(withoutRequestId(v1.body), withoutRequestId(legacy.body));
});

test("reservations.update returns parity envelopes for v1 and legacy route families", async () => {
  const baseState: MockDbState = {
    reservations: {
      "reservation-1": {
        ownerUid: "owner-1",
        status: "REQUESTED",
        loadStatus: "queued",
        assignedStationId: "studio-electric",
        stageHistory: [],
      },
    },
  };
  const payload = {
    reservationId: "reservation-1",
    status: "CONFIRMED",
  };

  const v1 = await invokeApiV1Route(
    cloneState(baseState),
    makeApiV1Request({
      path: "/v1/reservations.update",
      body: payload,
      ctx: staffContext({ uid: "staff-1" }),
      routeFamily: "v1",
      staffAuthUid: "staff-1",
    }),
  );
  const legacy = await invokeApiV1Route(
    cloneState(baseState),
    makeApiV1Request({
      path: "/v1/reservations.update",
      body: payload,
      ctx: staffContext({ uid: "staff-1" }),
      routeFamily: "legacy",
      staffAuthUid: "staff-1",
    }),
  );

  assert.equal(v1.status, 200);
  assert.equal(legacy.status, 200);
  const v1Body = withoutRequestId(v1.body);
  const legacyBody = withoutRequestId(legacy.body);
  const v1Data = (v1Body.data ?? {}) as Record<string, unknown>;
  const legacyData = (legacyBody.data ?? {}) as Record<string, unknown>;
  assert.equal(v1Data.reservationId, legacyData.reservationId);
  assert.equal(v1Data.status, legacyData.status);
  assert.equal(v1Data.loadStatus, legacyData.loadStatus);
  assert.equal(v1Data.arrivalToken, legacyData.arrivalToken);
  assert.equal(typeof v1Data.arrivalTokenExpiresAt, "object");
  assert.equal(typeof legacyData.arrivalTokenExpiresAt, "object");
  assert.equal(v1Data.idempotentReplay, legacyData.idempotentReplay);
});

test("reservations.assignStation rejects unknown station with parity across route families", async () => {
  const baseState: MockDbState = {
    reservations: {
      "reservation-1": {
        ownerUid: "owner-1",
        status: "REQUESTED",
        loadStatus: "queued",
        stageHistory: [],
      },
    },
  };
  const payload = {
    reservationId: "reservation-1",
    assignedStationId: "ghost-station",
  };

  const v1 = await invokeApiV1Route(
    cloneState(baseState),
    makeApiV1Request({
      path: "/v1/reservations.assignStation",
      body: payload,
      ctx: staffContext({ uid: "staff-1" }),
      routeFamily: "v1",
      staffAuthUid: "staff-1",
    }),
  );
  const legacy = await invokeApiV1Route(
    cloneState(baseState),
    makeApiV1Request({
      path: "/v1/reservations.assignStation",
      body: payload,
      ctx: staffContext({ uid: "staff-1" }),
      routeFamily: "legacy",
      staffAuthUid: "staff-1",
    }),
  );

  assert.equal(v1.status, 400);
  assert.equal(legacy.status, 400);
  assert.deepEqual(withoutRequestId(v1.body), withoutRequestId(legacy.body));
});

test("reservations.assignStation blocks over-capacity station assignments", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-target": {
        ownerUid: "owner-1",
        status: "REQUESTED",
        loadStatus: "queued",
        estimatedHalfShelves: 2,
        stageHistory: [],
      },
      "reservation-existing-a": {
        ownerUid: "owner-2",
        status: "CONFIRMED",
        loadStatus: "queued",
        assignedStationId: "studio-electric",
        estimatedHalfShelves: 4,
      },
      "reservation-existing-b": {
        ownerUid: "owner-3",
        status: "CONFIRMED",
        loadStatus: "queued",
        assignedStationId: "studio-electric",
        estimatedHalfShelves: 4,
      },
    },
  };

  const response = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/reservations.assignStation",
      body: {
        reservationId: "reservation-target",
        assignedStationId: "studio-electric",
      },
      ctx: staffContext({ uid: "staff-1" }),
      routeFamily: "v1",
      staffAuthUid: "staff-1",
    }),
  );

  assert.equal(response.status, 409);
  const body = response.body as Record<string, unknown>;
  assert.equal(body.code, "CONFLICT");
  assert.match(String(body.message ?? ""), /capacity/i);
});

test("reservations.assignStation excludes community shelf from capacity checks", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-target": {
        ownerUid: "owner-1",
        status: "REQUESTED",
        loadStatus: "queued",
        estimatedHalfShelves: 2,
        stageHistory: [],
      },
      "reservation-community": {
        ownerUid: "owner-2",
        status: "CONFIRMED",
        loadStatus: "queued",
        assignedStationId: "studio-electric",
        intakeMode: "COMMUNITY_SHELF",
        estimatedHalfShelves: 8,
      },
    },
  };

  const response = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/reservations.assignStation",
      body: {
        reservationId: "reservation-target",
        assignedStationId: "studio-electric",
      },
      ctx: staffContext({ uid: "staff-1" }),
      routeFamily: "v1",
      staffAuthUid: "staff-1",
    }),
  );

  assert.equal(response.status, 200, JSON.stringify(response.body));
  const body = response.body as Record<string, unknown>;
  assert.equal(body.ok, true);
  const data = (body.data ?? {}) as Record<string, unknown>;
  assert.equal(data.assignedStationId, "studio-electric");
  assert.equal(data.stationUsedAfter, 2);
});

test("reservation authz audit metadata includes routeFamily for legacy and v1", async () => {
  await withStrictDelegation(async () => {
    for (const routeFamily of ["v1", "legacy"] as const) {
      const state: MockDbState = {};
      const request = makeApiV1Request({
        path: "/v1/reservations.create",
        body: {
          firingType: "glaze",
          shelfEquivalent: 1,
          ownerUid: "owner-1",
        },
        ctx: delegatedContext({
          uid: "owner-1",
          scopes: ["reservations:write"],
          delegationId: "delegation-1",
        }),
        routeFamily,
      });
      const response = await invokeApiV1Route(state, request);
      assert.equal(response.status, 403);

      const auditEvents = getAuditEvents(state);
      const event = auditEvents.find((row) => row.action === "reservations_create_authz");
      if (!event) {
        assert.fail(`Missing reservations_create_authz audit event: ${JSON.stringify(auditEvents)}`);
      }
      const metadata = event.metadata as Record<string, unknown> | undefined;
      assert.equal(metadata?.routeFamily, routeFamily);
    }
  });
});

test("reservations.create rejects pickup or return delivery without address and instructions", async () => {
  const response = await invokeApiV1Route(
    {},
    makeApiV1Request({
      path: "/v1/reservations.create",
      body: {
        firingType: "bisque",
        shelfEquivalent: 1,
        addOns: {
          pickupDeliveryRequested: true,
        },
      },
      ctx: firebaseContext({ uid: "owner-1" }),
      routeFamily: "v1",
    }),
  );

  assert.equal(response.status, 400);
  const body = response.body as Record<string, unknown>;
  assert.equal(body.code, "INVALID_ARGUMENT");
  assert.match(String(body.message ?? ""), /Delivery address and instructions are required/i);
});

test("reservations.create accepts dropoff + pickup details when provided", async () => {
  const response = await invokeApiV1Route(
    {},
    makeApiV1Request({
      path: "/v1/reservations.create",
      body: {
        firingType: "bisque",
        shelfEquivalent: 1,
        dropOffProfile: {
          id: "dropoff-many",
          pieceCount: "many",
          bisqueOnly: true,
        },
        addOns: {
          pickupDeliveryRequested: true,
          deliveryAddress: "123 Clay St, Phoenix, AZ",
          deliveryInstructions: "Front desk",
        },
      },
      ctx: firebaseContext({ uid: "owner-1" }),
      routeFamily: "v1",
    }),
  );

  assert.equal(response.status, 200, JSON.stringify(response.body));
  const body = response.body as Record<string, unknown>;
  assert.equal(body.ok, true);
  const data = (body.data ?? {}) as Record<string, unknown>;
  assert.equal(data.status, "REQUESTED");
});

test("reservations.create accepts optional piece rows in request payload", async () => {
  const response = await invokeApiV1Route(
    {},
    makeApiV1Request({
      path: "/v1/reservations.create",
      body: {
        firingType: "glaze",
        shelfEquivalent: 1,
        pieces: [
          {
            pieceId: "custom-01",
            pieceLabel: "Tall vase",
            pieceCount: 1,
            pieceStatus: "loaded",
          },
          {
            pieceLabel: "Mug set",
            pieceCount: 4,
          },
        ],
      },
      ctx: firebaseContext({ uid: "owner-1" }),
      routeFamily: "v1",
    }),
  );

  assert.equal(response.status, 200, JSON.stringify(response.body));
  const body = response.body as Record<string, unknown>;
  const data = (body.data ?? {}) as Record<string, unknown>;
  assert.equal(data.status, "REQUESTED");
});

test("reservations.create rejects bisque-only profile for non-bisque firings", async () => {
  const response = await invokeApiV1Route(
    {},
    makeApiV1Request({
      path: "/v1/reservations.create",
      body: {
        firingType: "glaze",
        shelfEquivalent: 1,
        dropOffProfile: {
          bisqueOnly: true,
        },
      },
      ctx: firebaseContext({ uid: "owner-1" }),
      routeFamily: "v1",
    }),
  );

  assert.equal(response.status, 400);
  const body = response.body as Record<string, unknown>;
  assert.equal(body.code, "INVALID_ARGUMENT");
  assert.match(String(body.message ?? ""), /Bisque-only dropoff profile/i);
});

test("reservations.update blocks invalid lifecycle transition from cancelled back to confirmed", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-cancelled": {
        ownerUid: "owner-1",
        status: "CANCELLED",
        loadStatus: "queued",
        stageHistory: [],
      },
    },
  };

  const response = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/reservations.update",
      body: {
        reservationId: "reservation-cancelled",
        status: "CONFIRMED",
      },
      ctx: staffContext({ uid: "staff-1" }),
      routeFamily: "v1",
      staffAuthUid: "staff-1",
    }),
  );

  assert.equal(response.status, 409);
  const body = response.body as Record<string, unknown>;
  assert.equal(body.code, "CONFLICT");
});

test("reservations.update rejects unauthenticated admin mutation attempts", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-needs-staff": {
        ownerUid: "owner-1",
        status: "REQUESTED",
        loadStatus: "queued",
        stageHistory: [],
      },
    },
  };

  const response = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/reservations.update",
      body: {
        reservationId: "reservation-needs-staff",
        status: "CONFIRMED",
      },
      ctx: firebaseContext({ uid: "owner-1" }),
      routeFamily: "v1",
    }),
  );

  assert.equal(response.status, 401);
  const body = response.body as Record<string, unknown>;
  assert.equal(body.code, "UNAUTHENTICATED");
  assert.equal(body.message, "Unauthorized");
  const event = getAuditEvents(state).find((row) => row.action === "reservations_update_admin_auth");
  assert.ok(event, "expected reservations_update_admin_auth audit row");
  assert.equal(event?.resourceType, "reservation");
  assert.equal(event?.resourceId, "/v1/reservations.update");
  assert.equal(event?.reasonCode, "UNAUTHENTICATED");
  assert.equal(event?.result, "deny");
  assert.equal(event?.requestId, body.requestId);
});

test("reservations.update rejects authenticated non-staff admin mutation attempts", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-needs-staff": {
        ownerUid: "owner-1",
        status: "REQUESTED",
        loadStatus: "queued",
        stageHistory: [],
      },
    },
  };

  const response = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/reservations.update",
      body: {
        reservationId: "reservation-needs-staff",
        status: "CONFIRMED",
      },
      ctx: firebaseContext({ uid: "owner-1" }),
      routeFamily: "v1",
      authClaims: { uid: "owner-1", staff: false },
    }),
  );

  assert.equal(response.status, 403);
  const body = response.body as Record<string, unknown>;
  assert.equal(body.code, "FORBIDDEN");
  assert.equal(body.message, "Unauthorized");
  const event = getAuditEvents(state).find((row) => row.action === "reservations_update_admin_auth");
  assert.ok(event, "expected reservations_update_admin_auth audit row");
  assert.equal(event?.resourceType, "reservation");
  assert.equal(event?.resourceId, "/v1/reservations.update");
  assert.equal(event?.reasonCode, "FORBIDDEN");
  assert.equal(event?.result, "deny");
  assert.equal(event?.requestId, body.requestId);
});

test("reservations.update returns not found when reservation does not exist", async () => {
  const response = await invokeApiV1Route(
    {},
    makeApiV1Request({
      path: "/v1/reservations.update",
      body: {
        reservationId: "reservation-missing",
        status: "CONFIRMED",
      },
      ctx: staffContext({ uid: "staff-1" }),
      routeFamily: "v1",
      staffAuthUid: "staff-1",
    }),
  );

  assert.equal(response.status, 404);
  const body = response.body as Record<string, unknown>;
  assert.equal(body.code, "NOT_FOUND");
  assert.equal(body.message, "Reservation not found");
});

test("reservations.update allows confirmed reservations to progress to loaded loadStatus", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-loaded": {
        ownerUid: "owner-1",
        status: "CONFIRMED",
        loadStatus: "queued",
        stageHistory: [],
      },
    },
  };

  const response = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/reservations.update",
      body: {
        reservationId: "reservation-loaded",
        loadStatus: "loaded",
      },
      ctx: staffContext({ uid: "staff-1" }),
      routeFamily: "v1",
      staffAuthUid: "staff-1",
    }),
  );

  assert.equal(response.status, 200);
  const body = response.body as Record<string, unknown>;
  const data = (body.data ?? {}) as Record<string, unknown>;
  assert.equal(data.loadStatus, "loaded");
  assert.equal(data.status, "CONFIRMED");
});

test("reservations.pickupWindow lets staff open window and member confirm it", async () => {
  const baseState: MockDbState = {
    reservations: {
      "reservation-pickup-open-confirm": {
        ownerUid: "owner-1",
        status: "CONFIRMED",
        loadStatus: "loaded",
        stageHistory: [],
      },
    },
  };

  const openResponse = await invokeApiV1Route(
    cloneState(baseState),
    makeApiV1Request({
      path: "/v1/reservations.pickupWindow",
      body: {
        reservationId: "reservation-pickup-open-confirm",
        action: "staff_set_open_window",
        confirmedStart: "2099-02-24T18:00:00.000Z",
        confirmedEnd: "2099-02-24T20:00:00.000Z",
      },
      ctx: staffContext({ uid: "staff-1" }),
      routeFamily: "v1",
      staffAuthUid: "staff-1",
    }),
  );
  assert.equal(openResponse.status, 200);
  const openData = (((openResponse.body as Record<string, unknown>).data ?? {}) as Record<string, unknown>);
  assert.equal(openData.pickupWindowStatus, "open");

  const confirmState: MockDbState = {
    reservations: {
      "reservation-pickup-open-confirm": {
        ownerUid: "owner-1",
        status: "CONFIRMED",
        loadStatus: "loaded",
        pickupWindow: {
          status: "open",
          confirmedStart: "2099-02-24T18:00:00.000Z",
          confirmedEnd: "2099-02-24T20:00:00.000Z",
        },
        stageHistory: [],
      },
    },
  };
  const confirmResponse = await invokeApiV1Route(
    confirmState,
    makeApiV1Request({
      path: "/v1/reservations.pickupWindow",
      body: {
        reservationId: "reservation-pickup-open-confirm",
        action: "member_confirm_window",
      },
      ctx: firebaseContext({ uid: "owner-1" }),
      routeFamily: "v1",
    }),
  );
  assert.equal(confirmResponse.status, 200, JSON.stringify(confirmResponse.body));
  const confirmData = (((confirmResponse.body as Record<string, unknown>).data ?? {}) as Record<string, unknown>);
  assert.equal(confirmData.pickupWindowStatus, "confirmed");
});

test("reservations.pickupWindow enforces one reschedule request without force", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-pickup-reschedule": {
        ownerUid: "owner-1",
        status: "CONFIRMED",
        loadStatus: "loaded",
        pickupWindow: {
          status: "open",
          confirmedStart: "2099-02-24T18:00:00.000Z",
          confirmedEnd: "2099-02-24T20:00:00.000Z",
          rescheduleCount: 1,
        },
        stageHistory: [],
      },
    },
  };

  const secondResponse = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/reservations.pickupWindow",
      body: {
        reservationId: "reservation-pickup-reschedule",
        action: "member_request_reschedule",
        requestedStart: "2099-02-26T18:00:00.000Z",
        requestedEnd: "2099-02-26T20:00:00.000Z",
      },
      ctx: firebaseContext({ uid: "owner-1" }),
      routeFamily: "v1",
    }),
  );

  assert.equal(secondResponse.status, 409, JSON.stringify(secondResponse.body));
  const secondBody = secondResponse.body as Record<string, unknown>;
  assert.equal(secondBody.code, "CONFLICT");
});

test("reservations.pickupWindow escalates to stored_by_policy after repeated missed windows", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-pickup-missed": {
        ownerUid: "owner-1",
        status: "CONFIRMED",
        loadStatus: "loaded",
        pickupWindow: {
          status: "confirmed",
          confirmedStart: "2026-02-20T18:00:00.000Z",
          confirmedEnd: "2026-02-20T20:00:00.000Z",
          missedCount: 1,
        },
        storageStatus: "active",
        stageHistory: [],
      },
    },
  };

  const response = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/reservations.pickupWindow",
      body: {
        reservationId: "reservation-pickup-missed",
        action: "staff_mark_missed",
      },
      ctx: staffContext({ uid: "staff-1" }),
      routeFamily: "v1",
      staffAuthUid: "staff-1",
    }),
  );

  assert.equal(response.status, 200);
  const body = response.body as Record<string, unknown>;
  const data = (body.data ?? {}) as Record<string, unknown>;
  assert.equal(data.storageStatus, "stored_by_policy");
});

test("reservations.queueFairness records no-show evidence and updates policy penalty", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-fairness-no-show": {
        ownerUid: "owner-1",
        status: "CONFIRMED",
        loadStatus: "queued",
        assignedStationId: "studio-electric",
        stageHistory: [],
      },
    },
  };

  const response = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/reservations.queueFairness",
      body: {
        reservationId: "reservation-fairness-no-show",
        action: "record_no_show",
        reason: "Missed confirmed pickup window.",
      },
      ctx: staffContext({ uid: "staff-1" }),
      routeFamily: "v1",
      staffAuthUid: "staff-1",
    }),
  );

  assert.equal(response.status, 200, JSON.stringify(response.body));
  const body = response.body as Record<string, unknown>;
  const data = (body.data ?? {}) as Record<string, unknown>;
  const queueFairness = (data.queueFairness ?? {}) as Record<string, unknown>;
  const queueFairnessPolicy = (data.queueFairnessPolicy ?? {}) as Record<string, unknown>;
  assert.equal(queueFairness.noShowCount, 1);
  assert.equal(queueFairness.lateArrivalCount, 0);
  assert.equal(queueFairnessPolicy.penaltyPoints, 2);
  assert.equal(queueFairnessPolicy.effectivePenaltyPoints, 2);
  assert.ok(typeof data.evidenceId === "string" && String(data.evidenceId).length > 0);
});

test("reservations.queueFairness override boost reduces effective penalty", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-fairness-override": {
        ownerUid: "owner-1",
        status: "CONFIRMED",
        loadStatus: "queued",
        queueFairness: {
          noShowCount: 1,
          lateArrivalCount: 0,
        },
        stageHistory: [],
      },
    },
  };

  const response = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/reservations.queueFairness",
      body: {
        reservationId: "reservation-fairness-override",
        action: "set_override_boost",
        reason: "Urgent memorial delivery approved by staff.",
        boostPoints: 2,
      },
      ctx: staffContext({ uid: "staff-1" }),
      routeFamily: "v1",
      staffAuthUid: "staff-1",
    }),
  );

  assert.equal(response.status, 200, JSON.stringify(response.body));
  const body = response.body as Record<string, unknown>;
  const data = (body.data ?? {}) as Record<string, unknown>;
  const queueFairness = (data.queueFairness ?? {}) as Record<string, unknown>;
  const queueFairnessPolicy = (data.queueFairnessPolicy ?? {}) as Record<string, unknown>;
  const reasonCodes = Array.isArray(queueFairnessPolicy.reasonCodes)
    ? (queueFairnessPolicy.reasonCodes as unknown[])
    : [];
  assert.equal(queueFairness.overrideBoost, 2);
  assert.equal(queueFairnessPolicy.penaltyPoints, 2);
  assert.equal(queueFairnessPolicy.effectivePenaltyPoints, 0);
  assert.equal(queueFairnessPolicy.overrideBoostApplied, 2);
  assert.ok(reasonCodes.includes("staff_override_boost"));
});

test("reservations.queueFairness rejects non-staff caller and emits admin auth deny audit", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-fairness-deny": {
        ownerUid: "owner-1",
        status: "CONFIRMED",
        loadStatus: "queued",
        stageHistory: [],
      },
    },
  };

  const response = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/reservations.queueFairness",
      body: {
        reservationId: "reservation-fairness-deny",
        action: "record_late_arrival",
        reason: "Arrived after confirmed slot.",
      },
      ctx: firebaseContext({ uid: "owner-1" }),
      routeFamily: "v1",
    }),
  );

  assert.equal(response.status, 401);
  const body = response.body as Record<string, unknown>;
  assert.equal(body.code, "UNAUTHENTICATED");
  const event = getAuditEvents(state).find((row) => row.action === "reservations_queue_fairness_admin_auth");
  assert.ok(event, "expected reservations_queue_fairness_admin_auth audit row");
  assert.equal(event?.resourceType, "reservation");
  assert.equal(event?.resourceId, "reservation-fairness-deny");
  assert.equal(event?.reasonCode, "UNAUTHENTICATED");
  assert.equal(event?.result, "deny");
  assert.equal(event?.requestId, body.requestId);
});

test("reservations.list excludes cancelled by default and includes it when requested", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-open": {
        ownerUid: "owner-1",
        status: "REQUESTED",
        createdAt: { toMillis: () => 2 },
      },
      "reservation-cancelled": {
        ownerUid: "owner-1",
        status: "CANCELLED",
        createdAt: { toMillis: () => 1 },
      },
    },
  };

  const defaultList = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/reservations.list",
      body: {},
      ctx: firebaseContext({ uid: "owner-1" }),
      routeFamily: "v1",
    }),
  );
  assert.equal(defaultList.status, 200);
  const defaultBody = defaultList.body as Record<string, unknown>;
  const defaultRows = (((defaultBody.data ?? {}) as Record<string, unknown>).reservations ?? []) as Array<Record<string, unknown>>;
  assert.equal(defaultRows.length, 1);
  assert.equal(defaultRows[0]?.status, "REQUESTED");

  const includeCancelledList = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/reservations.list",
      body: {
        includeCancelled: true,
      },
      ctx: firebaseContext({ uid: "owner-1" }),
      routeFamily: "v1",
    }),
  );
  assert.equal(includeCancelledList.status, 200);
  const includeBody = includeCancelledList.body as Record<string, unknown>;
  const includeRows = (((includeBody.data ?? {}) as Record<string, unknown>).reservations ?? []) as Array<Record<string, unknown>>;
  assert.equal(includeRows.length, 2);
});

test("notifications.markRead marks owner notification as read", async () => {
  const state: MockDbState = {
    "users/owner-1/notifications": {
      "notification-1": {
        title: "Kiln update",
        body: "Ready for pickup.",
      },
    },
  };

  const response = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/notifications.markRead",
      body: {
        notificationId: "notification-1",
      },
      ctx: firebaseContext({ uid: "owner-1" }),
      routeFamily: "v1",
    }),
  );

  assert.equal(response.status, 200, JSON.stringify(response.body));
  const body = response.body as Record<string, unknown>;
  const data = ((body.data ?? {}) as Record<string, unknown>) ?? {};
  assert.equal(data.ownerUid, "owner-1");
  assert.equal(data.notificationId, "notification-1");
});

test("notifications.markRead rejects owner mismatch for non-staff caller", async () => {
  const state: MockDbState = {
    "users/owner-2/notifications": {
      "notification-2": {
        title: "Studio note",
      },
    },
  };

  const response = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/notifications.markRead",
      body: {
        ownerUid: "owner-2",
        notificationId: "notification-2",
      },
      ctx: firebaseContext({ uid: "owner-1" }),
      routeFamily: "v1",
    }),
  );

  assert.equal(response.status, 403);
  const body = response.body as Record<string, unknown>;
  assert.equal(body.code, "OWNER_MISMATCH");
});

test("reservations.exportContinuity returns signed continuity bundle for owner", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-export-1": {
        ownerUid: "owner-1",
        status: "CONFIRMED",
        loadStatus: "loaded",
        firingType: "glaze",
        shelfEquivalent: 1,
        stageHistory: [
          {
            fromStage: "intake",
            toStage: "loaded",
            reason: "status:CONFIRMED->CONFIRMED",
            at: "2026-02-24T18:00:00.000Z",
          },
        ],
        pieces: [
          {
            pieceId: "MF-RES-ABCD12-01AAAA",
            pieceLabel: "Mug set",
            pieceCount: 4,
            pieceStatus: "loaded",
          },
        ],
        storageNoticeHistory: [
          {
            at: "2026-02-24T19:00:00.000Z",
            kind: "pickup_ready",
            detail: "Pickup ready",
            status: "active",
          },
        ],
        createdAt: "2026-02-24T17:00:00.000Z",
        updatedAt: "2026-02-24T20:00:00.000Z",
      },
    },
    reservationStorageAudit: {
      "storage-audit-1": {
        reservationId: "reservation-export-1",
        uid: "owner-1",
        action: "pickup_ready",
        reason: "test",
        at: "2026-02-24T19:00:00.000Z",
        createdAt: "2026-02-24T19:00:01.000Z",
      },
    },
    reservationQueueFairnessAudit: {
      "fairness-audit-1": {
        reservationId: "reservation-export-1",
        ownerUid: "owner-1",
        action: "record_late_arrival",
        reason: "late arrival",
        actorUid: "staff-1",
        actorRole: "staff",
        requestId: "req_test",
        createdAt: "2026-02-24T19:10:00.000Z",
        queueFairnessPolicy: {
          policyVersion: "2026-02-24.v1",
          effectivePenaltyPoints: 1,
        },
      },
    },
  };

  const response = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/reservations.exportContinuity",
      body: {
        ownerUid: "owner-1",
        includeCsv: true,
      },
      ctx: firebaseContext({ uid: "owner-1" }),
      routeFamily: "v1",
    }),
  );

  assert.equal(response.status, 200, JSON.stringify(response.body));
  const body = response.body as Record<string, unknown>;
  const data = (body.data ?? {}) as Record<string, unknown>;
  const exportHeader = (data.exportHeader ?? {}) as Record<string, unknown>;
  const summary = (data.summary ?? {}) as Record<string, unknown>;
  const csvBundle = (data.csvBundle ?? {}) as Record<string, unknown>;
  const jsonBundle = (data.jsonBundle ?? {}) as Record<string, unknown>;
  assert.equal(exportHeader.ownerUid, "owner-1");
  assert.equal(exportHeader.schemaVersion, "2026-02-24.v1");
  assert.ok(typeof exportHeader.signature === "string" && String(exportHeader.signature).startsWith("mfexp_"));
  assert.equal(summary.reservations, 1);
  assert.equal(summary.storageAudit, 1);
  assert.equal(summary.queueFairnessAudit, 1);
  assert.ok(typeof csvBundle.reservations === "string" && String(csvBundle.reservations).includes("reservationId"));
  assert.ok(Array.isArray(jsonBundle.reservations));
});

test("reservations.exportContinuity blocks non-owner non-staff access", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-export-deny": {
        ownerUid: "owner-1",
        status: "CONFIRMED",
        loadStatus: "queued",
      },
    },
  };

  const response = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/reservations.exportContinuity",
      body: {
        ownerUid: "owner-1",
      },
      ctx: firebaseContext({ uid: "owner-2" }),
      routeFamily: "v1",
    }),
  );

  assert.equal(response.status, 403);
  const body = response.body as Record<string, unknown>;
  assert.equal(body.code, "OWNER_MISMATCH");
});

test("reservations.update issues an arrival token when status moves to confirmed", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-arrival-token": {
        ownerUid: "owner-1",
        status: "REQUESTED",
        loadStatus: "queued",
        stageHistory: [],
      },
    },
  };

  const response = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/reservations.update",
      body: {
        reservationId: "reservation-arrival-token",
        status: "CONFIRMED",
      },
      ctx: staffContext({ uid: "staff-1" }),
      routeFamily: "v1",
      staffAuthUid: "staff-1",
    }),
  );

  assert.equal(response.status, 200);
  const body = response.body as Record<string, unknown>;
  const data = (body.data ?? {}) as Record<string, unknown>;
  assert.equal(typeof data.arrivalToken, "string");
  assert.match(String(data.arrivalToken ?? ""), /^MF-ARR-/);
});

test("reservations.lookupArrival returns reservation summary for staff", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-lookup": {
        ownerUid: "owner-1",
        status: "CONFIRMED",
        loadStatus: "queued",
        arrivalStatus: "expected",
        arrivalToken: "MF-ARR-ABCD-1234",
        arrivalTokenLookup: "MFARRABCD1234",
        queuePositionHint: 2,
        stageHistory: [],
      },
    },
  };

  const response = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/reservations.lookupArrival",
      body: {
        arrivalToken: "MF-ARR-ABCD-1234",
      },
      ctx: staffContext({ uid: "staff-1" }),
      routeFamily: "v1",
      staffAuthUid: "staff-1",
    }),
  );

  assert.equal(response.status, 200);
  const body = response.body as Record<string, unknown>;
  const data = (body.data ?? {}) as Record<string, unknown>;
  const reservation = (data.reservation ?? {}) as Record<string, unknown>;
  const outstanding = (data.outstandingRequirements ?? {}) as Record<string, unknown>;
  assert.equal(reservation.id, "reservation-lookup");
  assert.equal(outstanding.needsArrivalCheckIn, true);
});

test("reservations.lookupArrival emits admin auth deny audit metadata", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-lookup-deny": {
        ownerUid: "owner-1",
        status: "CONFIRMED",
        loadStatus: "queued",
        arrivalStatus: "expected",
        arrivalToken: "MF-ARR-DENY-1234",
        arrivalTokenLookup: "MFARRDENY1234",
        stageHistory: [],
      },
    },
  };

  const response = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/reservations.lookupArrival",
      body: {
        arrivalToken: "MF-ARR-DENY-1234",
      },
      ctx: firebaseContext({ uid: "owner-1" }),
      routeFamily: "v1",
    }),
  );

  assert.equal(response.status, 401);
  const body = response.body as Record<string, unknown>;
  assert.equal(body.code, "UNAUTHENTICATED");
  const event = getAuditEvents(state).find((row) => row.action === "reservations_lookup_arrival_admin_auth");
  assert.ok(event, "expected reservations_lookup_arrival_admin_auth audit row");
  assert.equal(event?.resourceType, "reservation");
  assert.equal(event?.resourceId, "/v1/reservations.lookupArrival");
  assert.equal(event?.reasonCode, "UNAUTHENTICATED");
  assert.equal(event?.result, "deny");
  assert.equal(event?.requestId, body.requestId);
});

test("reservations.checkIn allows owner check-in by reservation id", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-checkin-owner": {
        ownerUid: "owner-1",
        status: "CONFIRMED",
        loadStatus: "queued",
        arrivalStatus: "expected",
        stageHistory: [],
      },
    },
  };

  const response = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/reservations.checkIn",
      body: {
        reservationId: "reservation-checkin-owner",
        note: "At front desk.",
      },
      ctx: firebaseContext({ uid: "owner-1" }),
      routeFamily: "v1",
    }),
  );

  assert.equal(response.status, 200);
  const body = response.body as Record<string, unknown>;
  const data = (body.data ?? {}) as Record<string, unknown>;
  assert.equal(data.arrivalStatus, "arrived");
});

test("reservations.checkIn rejects non-owner non-staff caller", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-checkin-denied": {
        ownerUid: "owner-1",
        status: "CONFIRMED",
        loadStatus: "queued",
        arrivalStatus: "expected",
        stageHistory: [],
      },
    },
  };

  const response = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/reservations.checkIn",
      body: {
        reservationId: "reservation-checkin-denied",
      },
      ctx: firebaseContext({ uid: "owner-2" }),
      routeFamily: "v1",
    }),
  );

  assert.equal(response.status, 403);
  const body = response.body as Record<string, unknown>;
  assert.equal(body.code, "OWNER_MISMATCH");
});

test("reservations.rotateArrivalToken reissues a deterministic token for staff", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-rotate-token": {
        ownerUid: "owner-1",
        status: "CONFIRMED",
        loadStatus: "queued",
        arrivalTokenVersion: 1,
        stageHistory: [],
      },
    },
  };

  const response = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/reservations.rotateArrivalToken",
      body: {
        reservationId: "reservation-rotate-token",
        reason: "manual reset",
      },
      ctx: staffContext({ uid: "staff-1" }),
      routeFamily: "v1",
      staffAuthUid: "staff-1",
    }),
  );

  assert.equal(response.status, 200);
  const body = response.body as Record<string, unknown>;
  const data = (body.data ?? {}) as Record<string, unknown>;
  assert.equal(typeof data.arrivalToken, "string");
  assert.match(String(data.arrivalToken ?? ""), /^MF-ARR-/);
});

test("reservations.rotateArrivalToken returns forbidden for authenticated non-staff callers", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-rotate-deny": {
        ownerUid: "owner-1",
        status: "CONFIRMED",
        loadStatus: "queued",
        arrivalTokenVersion: 2,
        stageHistory: [],
      },
    },
  };

  const response = await invokeApiV1Route(
    state,
    makeApiV1Request({
      path: "/v1/reservations.rotateArrivalToken",
      body: {
        reservationId: "reservation-rotate-deny",
        reason: "manual reset",
      },
      ctx: firebaseContext({ uid: "owner-1" }),
      routeFamily: "v1",
      authClaims: { uid: "owner-1", staff: false },
    }),
  );

  assert.equal(response.status, 403);
  const body = response.body as Record<string, unknown>;
  assert.equal(body.code, "FORBIDDEN");
  const event = getAuditEvents(state).find((row) => row.action === "reservations_rotate_arrival_token_admin_auth");
  assert.ok(event, "expected reservations_rotate_arrival_token_admin_auth audit row");
  assert.equal(event?.resourceType, "reservation");
  assert.equal(event?.resourceId, "/v1/reservations.rotateArrivalToken");
  assert.equal(event?.reasonCode, "FORBIDDEN");
  assert.equal(event?.result, "deny");
  assert.equal(event?.requestId, body.requestId);
});
