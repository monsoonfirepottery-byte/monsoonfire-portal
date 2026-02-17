"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const memoryStores_1 = require("../stores/memoryStores");
const runtime_1 = require("./runtime");
const registry_1 = require("../connectors/registry");
(0, node_test_1.default)("proposal lifecycle appends audit events", async () => {
    const eventStore = new memoryStores_1.MemoryEventStore();
    const runtime = new runtime_1.CapabilityRuntime(runtime_1.defaultCapabilities, eventStore);
    const created = await runtime.create({
        actorType: "staff",
        actorId: "staff-1",
        ownerUid: "owner-1",
        effectiveScopes: [],
    }, {
        capabilityId: "firestore.batch.close",
        rationale: "Close this batch after final QA pass completes.",
        previewSummary: "Close batch mfb-123",
        requestInput: { batchId: "mfb-123" },
        expectedEffects: ["Batch is marked closed."],
        requestedBy: "staff-1",
    });
    strict_1.default.ok(created.proposal);
    await runtime.approve(created.proposal.id, "staff-approver", "Approved after final operator verification.");
    await runtime.reject(created.proposal.id, "staff-approver", "Policy mismatch in final review.");
    const events = await eventStore.listRecent(10);
    const actions = events.map((event) => event.action);
    strict_1.default.ok(actions.includes("capability.firestore.batch.close.proposal_created"));
    strict_1.default.ok(actions.includes("capability.firestore.batch.close.proposal_approved"));
    strict_1.default.ok(actions.includes("capability.firestore.batch.close.proposal_rejected"));
});
(0, node_test_1.default)("kill switch blocks execution regardless of proposal approval", async () => {
    const eventStore = new memoryStores_1.MemoryEventStore();
    const runtime = new runtime_1.CapabilityRuntime(runtime_1.defaultCapabilities, eventStore);
    const created = await runtime.create({
        actorType: "staff",
        actorId: "staff-1",
        ownerUid: "owner-1",
        effectiveScopes: [],
    }, {
        capabilityId: "firestore.batch.close",
        rationale: "Close this batch after final QA pass completes.",
        previewSummary: "Close batch mfb-123",
        requestInput: { batchId: "mfb-123" },
        expectedEffects: ["Batch is marked closed."],
        requestedBy: "staff-1",
    });
    strict_1.default.ok(created.proposal);
    await runtime.approve(created.proposal.id, "staff-approver", "Approved after supervisor review and signoff.");
    await runtime.setKillSwitch(true, "staff-approver", "Incident containment while validating policy drift.");
    const executed = await runtime.execute(created.proposal.id, {
        actorType: "staff",
        actorId: "staff-1",
        ownerUid: "owner-1",
        effectiveScopes: [],
    }, { result: "closed" });
    strict_1.default.equal(executed.decision.allowed, false);
    strict_1.default.equal(executed.decision.reasonCode, "BLOCKED_BY_POLICY");
});
(0, node_test_1.default)("execute uses mapped roborock connector read output", async () => {
    const eventStore = new memoryStores_1.MemoryEventStore();
    const logger = { debug: () => { }, info: () => { }, warn: () => { }, error: () => { } };
    const connectorRegistry = new registry_1.ConnectorRegistry([
        {
            id: "roborock",
            target: "roborock",
            version: "0.1.0",
            readOnly: true,
            async health() {
                return {
                    ok: true,
                    latencyMs: 1,
                    availability: "healthy",
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
    ], logger);
    const runtime = new runtime_1.CapabilityRuntime(runtime_1.defaultCapabilities, eventStore, undefined, undefined, undefined, connectorRegistry);
    const created = await runtime.create({
        actorType: "staff",
        actorId: "staff-1",
        ownerUid: "owner-1",
        effectiveScopes: [],
    }, {
        capabilityId: "roborock.devices.read",
        rationale: "Refresh roborock telemetry for operations dashboard.",
        previewSummary: "Read roborock status",
        requestInput: { locationId: "main" },
        expectedEffects: ["No external writes."],
        requestedBy: "staff-1",
    });
    strict_1.default.ok(created.proposal);
    const executed = await runtime.execute(created.proposal.id, {
        actorType: "staff",
        actorId: "staff-1",
        ownerUid: "owner-1",
        effectiveScopes: [],
    }, {});
    strict_1.default.equal(executed.decision.allowed, true);
    const events = await eventStore.listRecent(1);
    strict_1.default.equal(events[0].action, "capability.roborock.devices.read.executed");
});
