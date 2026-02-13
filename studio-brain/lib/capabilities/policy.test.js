"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const memoryStores_1 = require("../stores/memoryStores");
const policy_1 = require("./policy");
const capabilities = [
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
(0, node_test_1.default)("createProposal requires delegation scope for agent actors", () => {
    const result = (0, policy_1.createProposal)(capabilities, {
        actorType: "agent",
        actorId: "agent-1",
        ownerUid: "owner-1",
        effectiveScopes: ["capability:hubitat.devices.read:execute"],
    }, {
        capabilityId: "firestore.batch.close",
        rationale: "Close this batch after final QA pass completes.",
        previewSummary: "Close batch mfb-123",
        input: { batchId: "mfb-123" },
        expectedEffects: ["Batch is marked closed."],
        requestedBy: "agent-1",
    }, new Date("2026-02-12T00:00:00.000Z"));
    strict_1.default.equal(result.decision.allowed, false);
    strict_1.default.equal(result.decision.reasonCode, "DELEGATION_SCOPE_MISSING");
    strict_1.default.equal(result.proposal, null);
});
(0, node_test_1.default)("evaluateExecution denies pending approval proposals", async () => {
    const proposalResult = (0, policy_1.createProposal)(capabilities, {
        actorType: "staff",
        actorId: "staff-1",
        ownerUid: "owner-1",
        effectiveScopes: [],
    }, {
        capabilityId: "firestore.batch.close",
        rationale: "Close this batch after final QA pass completes.",
        previewSummary: "Close batch mfb-123",
        input: { batchId: "mfb-123" },
        expectedEffects: ["Batch is marked closed."],
        requestedBy: "staff-1",
    }, new Date("2026-02-12T00:00:00.000Z"));
    strict_1.default.ok(proposalResult.proposal);
    strict_1.default.equal(proposalResult.proposal.status, "pending_approval");
    const decision = await (0, policy_1.evaluateExecution)(capabilities, {
        actorType: "staff",
        actorId: "staff-1",
        ownerUid: "owner-1",
        effectiveScopes: [],
    }, proposalResult.proposal, new policy_1.InMemoryQuotaStore(), {
        killSwitch: { enabled: false, updatedAt: null, updatedBy: null, rationale: null },
        exemptions: [],
    }, new Date("2026-02-12T00:05:00.000Z"));
    strict_1.default.equal(decision.allowed, false);
    strict_1.default.equal(decision.reasonCode, "APPROVAL_REQUIRED");
});
(0, node_test_1.default)("evaluateExecution enforces per-capability hourly quota", async () => {
    const proposalResult = (0, policy_1.createProposal)(capabilities, {
        actorType: "staff",
        actorId: "staff-1",
        ownerUid: "owner-1",
        effectiveScopes: [],
    }, {
        capabilityId: "firestore.batch.close",
        rationale: "Close this batch after final QA pass completes.",
        previewSummary: "Close batch mfb-123",
        input: { batchId: "mfb-123" },
        expectedEffects: ["Batch is marked closed."],
        requestedBy: "staff-1",
    }, new Date("2026-02-12T00:00:00.000Z"));
    strict_1.default.ok(proposalResult.proposal);
    proposalResult.proposal.status = "approved";
    proposalResult.proposal.approvedBy = "staff-approver";
    proposalResult.proposal.approvedAt = "2026-02-12T00:01:00.000Z";
    const quotas = new policy_1.InMemoryQuotaStore();
    const actor = {
        actorType: "staff",
        actorId: "staff-1",
        ownerUid: "owner-1",
        effectiveScopes: [],
    };
    const first = await (0, policy_1.evaluateExecution)(capabilities, actor, proposalResult.proposal, quotas, {
        killSwitch: { enabled: false, updatedAt: null, updatedBy: null, rationale: null },
        exemptions: [],
    }, new Date("2026-02-12T00:05:00.000Z"));
    const second = await (0, policy_1.evaluateExecution)(capabilities, actor, proposalResult.proposal, quotas, {
        killSwitch: { enabled: false, updatedAt: null, updatedBy: null, rationale: null },
        exemptions: [],
    }, new Date("2026-02-12T00:10:00.000Z"));
    const third = await (0, policy_1.evaluateExecution)(capabilities, actor, proposalResult.proposal, quotas, {
        killSwitch: { enabled: false, updatedAt: null, updatedBy: null, rationale: null },
        exemptions: [],
    }, new Date("2026-02-12T00:11:00.000Z"));
    strict_1.default.equal(first.allowed, true);
    strict_1.default.equal(second.allowed, true);
    strict_1.default.equal(third.allowed, false);
    strict_1.default.equal(third.reasonCode, "RATE_LIMITED");
    strict_1.default.ok((third.retryAfterSeconds ?? 0) > 0);
});
(0, node_test_1.default)("appendExecutionAudit records input and output hashes", async () => {
    const eventStore = new memoryStores_1.MemoryEventStore();
    const proposalResult = (0, policy_1.createProposal)(capabilities, {
        actorType: "staff",
        actorId: "staff-1",
        ownerUid: "owner-1",
        effectiveScopes: [],
    }, {
        capabilityId: "hubitat.devices.read",
        rationale: "Read-only status refresh for dashboard health tiles.",
        previewSummary: "Read connector status",
        input: { deviceId: "hub-7" },
        expectedEffects: ["No external writes."],
        requestedBy: "staff-1",
    }, new Date("2026-02-12T00:00:00.000Z"));
    strict_1.default.ok(proposalResult.proposal);
    const decision = await (0, policy_1.evaluateExecution)(capabilities, {
        actorType: "staff",
        actorId: "staff-1",
        ownerUid: "owner-1",
        effectiveScopes: [],
    }, proposalResult.proposal, new policy_1.InMemoryQuotaStore(), {
        killSwitch: { enabled: false, updatedAt: null, updatedBy: null, rationale: null },
        exemptions: [],
    }, new Date("2026-02-12T00:05:00.000Z"));
    strict_1.default.equal(decision.allowed, true);
    await (0, policy_1.appendExecutionAudit)(eventStore, {
        actorType: "staff",
        actorId: "staff-1",
        ownerUid: "owner-1",
        effectiveScopes: [],
    }, capabilities[1], proposalResult.proposal, { devicesOnline: 8 }, decision);
    const events = await eventStore.listRecent(1);
    strict_1.default.equal(events.length, 1);
    strict_1.default.equal(events[0].action, "capability.hubitat.devices.read.executed");
    strict_1.default.equal(events[0].inputHash, proposalResult.proposal.inputHash);
    strict_1.default.ok(events[0].outputHash);
});
(0, node_test_1.default)("evaluateExecution allows pending approval with active scoped exemption and denies once expired", async () => {
    const proposalResult = (0, policy_1.createProposal)(capabilities, {
        actorType: "staff",
        actorId: "staff-1",
        ownerUid: "owner-1",
        effectiveScopes: [],
    }, {
        capabilityId: "firestore.batch.close",
        rationale: "Close this batch after final QA pass completes.",
        previewSummary: "Close batch mfb-123",
        input: { batchId: "mfb-123" },
        expectedEffects: ["Batch is marked closed."],
        requestedBy: "staff-1",
    }, new Date("2026-02-12T00:00:00.000Z"));
    strict_1.default.ok(proposalResult.proposal);
    const active = await (0, policy_1.evaluateExecution)(capabilities, {
        actorType: "staff",
        actorId: "staff-1",
        ownerUid: "owner-1",
        effectiveScopes: [],
    }, proposalResult.proposal, new policy_1.InMemoryQuotaStore(), {
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
    }, new Date("2026-02-12T00:05:00.000Z"));
    strict_1.default.equal(active.allowed, true);
    strict_1.default.equal(active.approvalState, "exempt");
    const expired = await (0, policy_1.evaluateExecution)(capabilities, {
        actorType: "staff",
        actorId: "staff-1",
        ownerUid: "owner-1",
        effectiveScopes: [],
    }, proposalResult.proposal, new policy_1.InMemoryQuotaStore(), {
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
    }, new Date("2026-02-12T00:35:00.000Z"));
    strict_1.default.equal(expired.allowed, false);
    strict_1.default.equal(expired.reasonCode, "APPROVAL_REQUIRED");
});
(0, node_test_1.default)("evaluateExecution denies cross-tenant execution attempts", async () => {
    const proposalResult = (0, policy_1.createProposal)(capabilities, {
        actorType: "staff",
        actorId: "staff-1",
        ownerUid: "owner-1",
        tenantId: "studio-a",
        effectiveScopes: [],
    }, {
        capabilityId: "firestore.batch.close",
        rationale: "Close this batch after final QA pass completes.",
        previewSummary: "Close batch mfb-123",
        input: { batchId: "mfb-123", tenantId: "studio-a" },
        expectedEffects: ["Batch is marked closed."],
        requestedBy: "staff-1",
    }, new Date("2026-02-12T00:00:00.000Z"));
    strict_1.default.ok(proposalResult.proposal);
    proposalResult.proposal.status = "approved";
    proposalResult.proposal.approvedBy = "staff-approver";
    proposalResult.proposal.approvedAt = "2026-02-12T00:01:00.000Z";
    const decision = await (0, policy_1.evaluateExecution)(capabilities, {
        actorType: "staff",
        actorId: "staff-2",
        ownerUid: "owner-2",
        tenantId: "studio-b",
        effectiveScopes: [],
    }, proposalResult.proposal, new policy_1.InMemoryQuotaStore(), {
        killSwitch: { enabled: false, updatedAt: null, updatedBy: null, rationale: null },
        exemptions: [],
    }, new Date("2026-02-12T00:05:00.000Z"));
    strict_1.default.equal(decision.allowed, false);
    strict_1.default.equal(decision.reasonCode, "TENANT_MISMATCH");
});
