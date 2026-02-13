import assert from "node:assert/strict";
import test from "node:test";
import { MemoryEventStore } from "../stores/memoryStores";
import { CapabilityRuntime, defaultCapabilities } from "./runtime";
import { ConnectorRegistry } from "../connectors/registry";

test("proposal lifecycle appends audit events", async () => {
  const eventStore = new MemoryEventStore();
  const runtime = new CapabilityRuntime(defaultCapabilities, eventStore);

  const created = await runtime.create(
    {
      actorType: "staff",
      actorId: "staff-1",
      ownerUid: "owner-1",
      effectiveScopes: [],
    },
    {
      capabilityId: "firestore.batch.close",
      rationale: "Close this batch after final QA pass completes.",
      previewSummary: "Close batch mfb-123",
      requestInput: { batchId: "mfb-123" },
      expectedEffects: ["Batch is marked closed."],
      requestedBy: "staff-1",
    }
  );
  assert.ok(created.proposal);
  await runtime.approve(created.proposal.id, "staff-approver", "Approved after final operator verification.");
  await runtime.reject(created.proposal.id, "staff-approver", "Policy mismatch in final review.");

  const events = await eventStore.listRecent(10);
  const actions = events.map((event) => event.action);
  assert.ok(actions.includes("capability.firestore.batch.close.proposal_created"));
  assert.ok(actions.includes("capability.firestore.batch.close.proposal_approved"));
  assert.ok(actions.includes("capability.firestore.batch.close.proposal_rejected"));
});

test("kill switch blocks execution regardless of proposal approval", async () => {
  const eventStore = new MemoryEventStore();
  const runtime = new CapabilityRuntime(defaultCapabilities, eventStore);
  const created = await runtime.create(
    {
      actorType: "staff",
      actorId: "staff-1",
      ownerUid: "owner-1",
      effectiveScopes: [],
    },
    {
      capabilityId: "firestore.batch.close",
      rationale: "Close this batch after final QA pass completes.",
      previewSummary: "Close batch mfb-123",
      requestInput: { batchId: "mfb-123" },
      expectedEffects: ["Batch is marked closed."],
      requestedBy: "staff-1",
    }
  );
  assert.ok(created.proposal);
  await runtime.approve(created.proposal.id, "staff-approver", "Approved after supervisor review and signoff.");
  await runtime.setKillSwitch(true, "staff-approver", "Incident containment while validating policy drift.");

  const executed = await runtime.execute(
    created.proposal.id,
    {
      actorType: "staff",
      actorId: "staff-1",
      ownerUid: "owner-1",
      effectiveScopes: [],
    },
    { result: "closed" }
  );
  assert.equal(executed.decision.allowed, false);
  assert.equal(executed.decision.reasonCode, "BLOCKED_BY_POLICY");
});

test("execute uses mapped roborock connector read output", async () => {
  const eventStore = new MemoryEventStore();
  const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  const connectorRegistry = new ConnectorRegistry(
    [
      {
        id: "roborock",
        target: "roborock" as const,
        version: "0.1.0",
        readOnly: true,
        async health() {
          return {
            ok: true,
            latencyMs: 1,
            availability: "healthy" as const,
            requestId: "h1",
            inputHash: "in",
            outputHash: "out",
          };
        },
        async readStatus() {
          return {
            requestId: "r1",
            inputHash: "ih",
            outputHash: "oh",
            rawCount: 1,
            devices: [{ id: "rr-1", label: "Vacuum", online: true, batteryPct: 70, attributes: {} }],
          };
        },
        async execute(ctx, req) {
          return this.readStatus(ctx, req.input);
        },
      },
    ],
    logger
  );
  const runtime = new CapabilityRuntime(defaultCapabilities, eventStore, undefined, undefined, undefined, connectorRegistry);

  const created = await runtime.create(
    {
      actorType: "staff",
      actorId: "staff-1",
      ownerUid: "owner-1",
      effectiveScopes: [],
    },
    {
      capabilityId: "roborock.devices.read",
      rationale: "Refresh roborock telemetry for operations dashboard.",
      previewSummary: "Read roborock status",
      requestInput: { locationId: "main" },
      expectedEffects: ["No external writes."],
      requestedBy: "staff-1",
    }
  );
  assert.ok(created.proposal);
  const executed = await runtime.execute(
    created.proposal.id,
    {
      actorType: "staff",
      actorId: "staff-1",
      ownerUid: "owner-1",
      effectiveScopes: [],
    },
    {}
  );
  assert.equal(executed.decision.allowed, true);
  const events = await eventStore.listRecent(1);
  assert.equal(events[0].action, "capability.roborock.devices.read.executed");
});
