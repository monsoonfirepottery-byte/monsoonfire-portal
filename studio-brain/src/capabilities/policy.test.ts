import assert from "node:assert/strict";
import test from "node:test";
import { MemoryEventStore } from "../stores/memoryStores";
import type { CapabilityDefinition } from "./model";
import { appendExecutionAudit, createProposal, evaluateExecution, InMemoryQuotaStore } from "./policy";

const capabilities: CapabilityDefinition[] = [
  {
    id: "firestore.batch.close",
    target: "firestore",
    description: "Close a finished kiln batch.",
    readOnly: false,
    requiresApproval: true,
    maxCallsPerHour: 2,
    risk: "high",
  },
  {
    id: "hubitat.devices.read",
    target: "hubitat",
    description: "Read connector status for dashboard.",
    readOnly: true,
    requiresApproval: false,
    maxCallsPerHour: 10,
    risk: "low",
  },
];

test("createProposal requires delegation scope for agent actors", () => {
  const result = createProposal(
    capabilities,
    {
      actorType: "agent",
      actorId: "agent-1",
      ownerUid: "owner-1",
      effectiveScopes: ["capability:hubitat.devices.read:execute"],
    },
    {
      capabilityId: "firestore.batch.close",
      rationale: "Close this batch after final QA pass completes.",
      previewSummary: "Close batch mfb-123",
      input: { batchId: "mfb-123" },
      expectedEffects: ["Batch is marked closed."],
      requestedBy: "agent-1",
    },
    new Date("2026-02-12T00:00:00.000Z")
  );

  assert.equal(result.decision.allowed, false);
  assert.equal(result.decision.reasonCode, "DELEGATION_SCOPE_MISSING");
  assert.equal(result.proposal, null);
});

test("evaluateExecution denies pending approval proposals", async () => {
  const proposalResult = createProposal(
    capabilities,
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
      input: { batchId: "mfb-123" },
      expectedEffects: ["Batch is marked closed."],
      requestedBy: "staff-1",
    },
    new Date("2026-02-12T00:00:00.000Z")
  );
  assert.ok(proposalResult.proposal);
  assert.equal(proposalResult.proposal.status, "pending_approval");

  const decision = await evaluateExecution(
    capabilities,
    {
      actorType: "staff",
      actorId: "staff-1",
      ownerUid: "owner-1",
      effectiveScopes: [],
    },
    proposalResult.proposal,
    new InMemoryQuotaStore(),
    {
      killSwitch: { enabled: false, updatedAt: null, updatedBy: null, rationale: null },
      exemptions: [],
    },
    new Date("2026-02-12T00:05:00.000Z")
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, "APPROVAL_REQUIRED");
});

test("evaluateExecution enforces per-capability hourly quota", async () => {
  const proposalResult = createProposal(
    capabilities,
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
      input: { batchId: "mfb-123" },
      expectedEffects: ["Batch is marked closed."],
      requestedBy: "staff-1",
    },
    new Date("2026-02-12T00:00:00.000Z")
  );
  assert.ok(proposalResult.proposal);
  proposalResult.proposal.status = "approved";
  proposalResult.proposal.approvedBy = "staff-approver";
  proposalResult.proposal.approvedAt = "2026-02-12T00:01:00.000Z";

  const quotas = new InMemoryQuotaStore();
  const actor = {
    actorType: "staff" as const,
    actorId: "staff-1",
    ownerUid: "owner-1",
    effectiveScopes: [],
  };
  const first = await evaluateExecution(
    capabilities,
    actor,
    proposalResult.proposal,
    quotas,
    {
      killSwitch: { enabled: false, updatedAt: null, updatedBy: null, rationale: null },
      exemptions: [],
    },
    new Date("2026-02-12T00:05:00.000Z")
  );
  const second = await evaluateExecution(
    capabilities,
    actor,
    proposalResult.proposal,
    quotas,
    {
      killSwitch: { enabled: false, updatedAt: null, updatedBy: null, rationale: null },
      exemptions: [],
    },
    new Date("2026-02-12T00:10:00.000Z")
  );
  const third = await evaluateExecution(
    capabilities,
    actor,
    proposalResult.proposal,
    quotas,
    {
      killSwitch: { enabled: false, updatedAt: null, updatedBy: null, rationale: null },
      exemptions: [],
    },
    new Date("2026-02-12T00:11:00.000Z")
  );

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.reasonCode, "RATE_LIMITED");
  assert.ok((third.retryAfterSeconds ?? 0) > 0);
});

test("appendExecutionAudit records input and output hashes", async () => {
  const eventStore = new MemoryEventStore();
  const proposalResult = createProposal(
    capabilities,
    {
      actorType: "staff",
      actorId: "staff-1",
      ownerUid: "owner-1",
      effectiveScopes: [],
    },
    {
      capabilityId: "hubitat.devices.read",
      rationale: "Read-only status refresh for dashboard health tiles.",
      previewSummary: "Read connector status",
      input: { deviceId: "hub-7" },
      expectedEffects: ["No external writes."],
      requestedBy: "staff-1",
    },
    new Date("2026-02-12T00:00:00.000Z")
  );
  assert.ok(proposalResult.proposal);

  const decision = await evaluateExecution(
    capabilities,
    {
      actorType: "staff",
      actorId: "staff-1",
      ownerUid: "owner-1",
      effectiveScopes: [],
    },
    proposalResult.proposal,
    new InMemoryQuotaStore(),
    {
      killSwitch: { enabled: false, updatedAt: null, updatedBy: null, rationale: null },
      exemptions: [],
    },
    new Date("2026-02-12T00:05:00.000Z")
  );
  assert.equal(decision.allowed, true);

  await appendExecutionAudit(
    eventStore,
    {
      actorType: "staff",
      actorId: "staff-1",
      ownerUid: "owner-1",
      effectiveScopes: [],
    },
    capabilities[1],
    proposalResult.proposal,
    { devicesOnline: 8 },
    decision
  );

  const events = await eventStore.listRecent(1);
  assert.equal(events.length, 1);
  assert.equal(events[0].action, "capability.hubitat.devices.read.executed");
  assert.equal(events[0].inputHash, proposalResult.proposal.inputHash);
  assert.ok(events[0].outputHash);
});

test("evaluateExecution allows pending approval with active scoped exemption and denies once expired", async () => {
  const proposalResult = createProposal(
    capabilities,
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
      input: { batchId: "mfb-123" },
      expectedEffects: ["Batch is marked closed."],
      requestedBy: "staff-1",
    },
    new Date("2026-02-12T00:00:00.000Z")
  );
  assert.ok(proposalResult.proposal);

  const active = await evaluateExecution(
    capabilities,
    {
      actorType: "staff",
      actorId: "staff-1",
      ownerUid: "owner-1",
      effectiveScopes: [],
    },
    proposalResult.proposal,
    new InMemoryQuotaStore(),
    {
      killSwitch: { enabled: false, updatedAt: null, updatedBy: null, rationale: null },
      exemptions: [
        {
          id: "ex-1",
          capabilityId: "firestore.batch.close",
          ownerUid: "owner-1",
          justification: "Hotfix during incident triage and monitored operation.",
          approvedBy: "staff-approver",
          createdAt: "2026-02-12T00:01:00.000Z",
          expiresAt: "2026-02-12T00:30:00.000Z",
          status: "active",
        },
      ],
    },
    new Date("2026-02-12T00:05:00.000Z")
  );
  assert.equal(active.allowed, true);
  assert.equal(active.approvalState, "exempt");

  const expired = await evaluateExecution(
    capabilities,
    {
      actorType: "staff",
      actorId: "staff-1",
      ownerUid: "owner-1",
      effectiveScopes: [],
    },
    proposalResult.proposal,
    new InMemoryQuotaStore(),
    {
      killSwitch: { enabled: false, updatedAt: null, updatedBy: null, rationale: null },
      exemptions: [
        {
          id: "ex-1",
          capabilityId: "firestore.batch.close",
          ownerUid: "owner-1",
          justification: "Hotfix during incident triage and monitored operation.",
          approvedBy: "staff-approver",
          createdAt: "2026-02-12T00:01:00.000Z",
          expiresAt: "2026-02-12T00:30:00.000Z",
          status: "expired",
        },
      ],
    },
    new Date("2026-02-12T00:35:00.000Z")
  );
  assert.equal(expired.allowed, false);
  assert.equal(expired.reasonCode, "APPROVAL_REQUIRED");
});

test("evaluateExecution denies cross-tenant execution attempts", async () => {
  const proposalResult = createProposal(
    capabilities,
    {
      actorType: "staff",
      actorId: "staff-1",
      ownerUid: "owner-1",
      tenantId: "studio-a",
      effectiveScopes: [],
    },
    {
      capabilityId: "firestore.batch.close",
      rationale: "Close this batch after final QA pass completes.",
      previewSummary: "Close batch mfb-123",
      input: { batchId: "mfb-123", tenantId: "studio-a" },
      expectedEffects: ["Batch is marked closed."],
      requestedBy: "staff-1",
    },
    new Date("2026-02-12T00:00:00.000Z")
  );
  assert.ok(proposalResult.proposal);
  proposalResult.proposal.status = "approved";
  proposalResult.proposal.approvedBy = "staff-approver";
  proposalResult.proposal.approvedAt = "2026-02-12T00:01:00.000Z";

  const decision = await evaluateExecution(
    capabilities,
    {
      actorType: "staff",
      actorId: "staff-2",
      ownerUid: "owner-2",
      tenantId: "studio-b",
      effectiveScopes: [],
    },
    proposalResult.proposal,
    new InMemoryQuotaStore(),
    {
      killSwitch: { enabled: false, updatedAt: null, updatedBy: null, rationale: null },
      exemptions: [],
    },
    new Date("2026-02-12T00:05:00.000Z")
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, "TENANT_MISMATCH");
});
