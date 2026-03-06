import test from "node:test";
import assert from "node:assert/strict";

import { continueJourney } from "./index";
import type * as SharedModule from "./shared";
import type * as IntegrationEventsModule from "./integrationEvents";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const shared = require("./shared") as typeof SharedModule;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const integrationEvents = require("./integrationEvents") as typeof IntegrationEventsModule;

type MockReq = {
  method: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

type MockRes = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  status: (code: number) => MockRes;
  json: (payload: unknown) => MockRes;
  set: (name: string, value: string) => MockRes;
};

type ScenarioInput = {
  authUid: string;
  requestUid?: string;
  requestFromBatchId?: string;
  sourceOwnerUid: string;
  sourceRootBatchId: string | null;
};

type ScenarioResult = {
  response: MockRes;
  writes: {
    createdBatchId: string;
    setCalls: Array<{ id: string; value: Record<string, unknown> }>;
    timelineAdds: Array<{ batchId: string; value: Record<string, unknown> }>;
    integrationCalls: number;
  };
};

function createResponse(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
  };
  return res;
}

function createSnapshot(value: Record<string, unknown> | null) {
  return {
    exists: value !== null,
    data: () => value,
  };
}

async function runScenario(input: ScenarioInput): Promise<ScenarioResult> {
  const createdBatchId = "batch-continued-001";
  const sourceBatchId = "batch-source-001";

  const req: MockReq = {
    method: "POST",
    body: {
      uid: input.requestUid ?? input.authUid,
      ...(input.requestFromBatchId === undefined ? { fromBatchId: sourceBatchId } : { fromBatchId: input.requestFromBatchId }),
    },
    headers: {},
  };
  const res = createResponse();

  const writes: ScenarioResult["writes"] = {
    createdBatchId,
    setCalls: [],
    timelineAdds: [],
    integrationCalls: 0,
  };

  const db = shared.db as unknown as {
    collection: (name: string) => {
      doc: (id?: string) => {
        id: string;
        get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | null }>;
        set: (value: Record<string, unknown>) => Promise<void>;
        collection: (sub: string) => {
          add: (value: Record<string, unknown>) => Promise<{ id: string }>;
        };
      };
    };
  };

  const originalCollection = db.collection;
  const originalApplyCors = shared.applyCors;
  const originalRequireAuthUid = shared.requireAuthUid;
  const originalEnforceRateLimit = shared.enforceRateLimit;
  const originalEmitIntegrationEvent = integrationEvents.emitIntegrationEvent;

  const sourceRow: Record<string, unknown> = {
    ownerUid: input.sourceOwnerUid,
    ownerDisplayName: "Owner One",
    title: "Source batch",
    intakeMode: "STAFF_HANDOFF",
    journeyRootBatchId: input.sourceRootBatchId,
    isClosed: true,
  };

  db.collection = (name: string) => {
    assert.equal(name, "batches");
    return {
      doc(id?: string) {
        const resolvedId = String(id || createdBatchId);
        return {
          id: resolvedId,
          async get() {
            if (resolvedId === sourceBatchId) {
              return createSnapshot(sourceRow);
            }
            const existing = writes.setCalls.find((entry) => entry.id === resolvedId)?.value ?? null;
            return createSnapshot(existing);
          },
          async set(value: Record<string, unknown>) {
            writes.setCalls.push({ id: resolvedId, value: { ...value } });
          },
          collection(sub: string) {
            assert.equal(sub, "timeline");
            return {
              async add(value: Record<string, unknown>) {
                writes.timelineAdds.push({ batchId: resolvedId, value: { ...value } });
                return { id: `timeline-${writes.timelineAdds.length}` };
              },
            };
          },
        };
      },
    };
  };

  shared.applyCors = () => false;
  shared.requireAuthUid = async () => ({
    ok: true,
    uid: input.authUid,
    decoded: {} as import("firebase-admin/auth").DecodedIdToken,
  });
  shared.enforceRateLimit = async () => ({ ok: true, retryAfterMs: 0 });
  integrationEvents.emitIntegrationEvent = async () => {
    writes.integrationCalls += 1;
    return {
      ok: true,
      eventId: "evt-1",
      cursor: 1,
      atIso: new Date().toISOString(),
    };
  };

  try {
    await continueJourney(req as unknown as Parameters<typeof continueJourney>[0], res as unknown as Parameters<typeof continueJourney>[1]);
  } finally {
    db.collection = originalCollection;
    shared.applyCors = originalApplyCors;
    shared.requireAuthUid = originalRequireAuthUid;
    shared.enforceRateLimit = originalEnforceRateLimit;
    integrationEvents.emitIntegrationEvent = originalEmitIntegrationEvent;
  }

  return {
    response: res,
    writes,
  };
}

test("continueJourney endpoint writes draft + lineage + timeline linkage on success", async () => {
  const result = await runScenario({
    authUid: "owner-1",
    sourceOwnerUid: "owner-1",
    sourceRootBatchId: "journey-root-123",
  });

  assert.equal(result.response.statusCode, 200);
  const payload = result.response.body as { ok?: boolean; batchId?: string; rootId?: string };
  assert.equal(payload.ok, true);
  assert.equal(payload.batchId, result.writes.createdBatchId);
  assert.equal(payload.rootId, "journey-root-123");

  const createdBatch = result.writes.setCalls.find((entry) => entry.id === result.writes.createdBatchId);
  assert.ok(createdBatch, "new continuation batch write missing");
  assert.equal(createdBatch?.value.state, "DRAFT");
  assert.equal(createdBatch?.value.isClosed, false);
  assert.equal(createdBatch?.value.journeyParentBatchId, "batch-source-001");
  assert.equal(createdBatch?.value.journeyRootBatchId, "journey-root-123");
  assert.equal(createdBatch?.value.ownerUid, "owner-1");

  assert.equal(result.writes.timelineAdds.length, 1);
  const timelineRow = result.writes.timelineAdds[0]?.value ?? {};
  assert.equal(timelineRow.type, "CONTINUE_JOURNEY");
  assert.equal(timelineRow.fromBatchId, "batch-source-001");
  assert.equal(result.writes.integrationCalls, 1);
});

test("continueJourney endpoint rejects uid mismatch without writes", async () => {
  const result = await runScenario({
    authUid: "owner-1",
    requestUid: "other-owner",
    sourceOwnerUid: "owner-1",
    sourceRootBatchId: "journey-root-123",
  });

  assert.equal(result.response.statusCode, 403);
  assert.equal(result.writes.setCalls.length, 0);
  assert.equal(result.writes.timelineAdds.length, 0);
  assert.equal(result.writes.integrationCalls, 0);
});

test("continueJourney endpoint rejects source ownership mismatch without writes", async () => {
  const result = await runScenario({
    authUid: "owner-1",
    sourceOwnerUid: "owner-2",
    sourceRootBatchId: "journey-root-123",
  });

  assert.equal(result.response.statusCode, 403);
  assert.equal(result.writes.setCalls.length, 0);
  assert.equal(result.writes.timelineAdds.length, 0);
  assert.equal(result.writes.integrationCalls, 0);
});

test("continueJourney endpoint rejects missing fromBatchId before writes", async () => {
  const result = await runScenario({
    authUid: "owner-1",
    requestFromBatchId: "",
    sourceOwnerUid: "owner-1",
    sourceRootBatchId: "journey-root-123",
  });

  assert.equal(result.response.statusCode, 400);
  assert.equal(result.writes.setCalls.length, 0);
  assert.equal(result.writes.timelineAdds.length, 0);
  assert.equal(result.writes.integrationCalls, 0);
});
