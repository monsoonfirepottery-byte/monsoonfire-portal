"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const server_1 = require("./server");
const memoryStores_1 = require("../stores/memoryStores");
const runtime_1 = require("../capabilities/runtime");
const logger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
};
async function withServer(options, run) {
    const stateStore = options.stateStore ?? new memoryStores_1.MemoryStateStore();
    const eventStore = options.eventStore ?? new memoryStores_1.MemoryEventStore();
    const capabilityRuntime = new runtime_1.CapabilityRuntime(runtime_1.defaultCapabilities, eventStore);
    const server = (0, server_1.startHttpServer)({
        host: "127.0.0.1",
        port: 0,
        logger,
        stateStore,
        eventStore,
        pgCheck: async () => ({ ok: true, latencyMs: 1 }),
        capabilityRuntime,
        verifyFirebaseAuth: async (authorizationHeader) => {
            if (authorizationHeader === "Bearer test-staff") {
                return { uid: "staff-test-uid", isStaff: true, roles: ["staff"] };
            }
            if (authorizationHeader === "Bearer test-admin") {
                return { uid: "admin-test-uid", isStaff: true, roles: ["staff", "admin"] };
            }
            if (authorizationHeader === "Bearer test-member") {
                return { uid: "member-test-uid", isStaff: false, roles: [] };
            }
            throw new Error("Missing Authorization header.");
        },
        ...options,
    });
    await new Promise((resolve) => server.on("listening", () => resolve()));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
        await run(baseUrl);
    }
    finally {
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error)
                    reject(error);
                else
                    resolve();
            });
        });
    }
}
(0, node_test_1.default)("health endpoint returns ok", async () => {
    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/healthz`);
        const payload = (await response.json());
        strict_1.default.equal(response.status, 200);
        strict_1.default.equal(payload.ok, true);
        strict_1.default.equal(payload.service, "studio-brain");
    });
});
(0, node_test_1.default)("readyz fails when snapshot freshness is required and missing", async () => {
    await withServer({
        requireFreshSnapshotForReady: true,
        readyMaxSnapshotAgeMinutes: 10,
    }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/readyz`);
        const payload = (await response.json());
        strict_1.default.equal(response.status, 503);
        strict_1.default.equal(payload.ok, false);
    });
});
(0, node_test_1.default)("readyz succeeds without requiring fresh snapshot", async () => {
    await withServer({
        requireFreshSnapshotForReady: false,
    }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/readyz`);
        const payload = (await response.json());
        strict_1.default.equal(response.status, 200);
        strict_1.default.equal(payload.ok, true);
    });
});
(0, node_test_1.default)("status endpoint includes runtime payload and recent jobs", async () => {
    const stateStore = new memoryStores_1.MemoryStateStore();
    await stateStore.startJobRun("computeStudioState");
    await withServer({
        stateStore,
        getRuntimeStatus: () => ({ scheduler: { intervalMs: 1000 }, custom: "ok" }),
    }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/status`);
        const payload = (await response.json());
        strict_1.default.equal(response.status, 200);
        strict_1.default.equal(payload.ok, true);
        strict_1.default.equal(payload.runtime.custom, "ok");
        strict_1.default.ok(Array.isArray(payload.jobRuns));
        strict_1.default.ok(payload.jobRuns.length >= 1);
    });
});
(0, node_test_1.default)("metrics endpoint includes process payload", async () => {
    await withServer({
        getRuntimeMetrics: () => ({ scheduler: { intervalMs: 1000 } }),
    }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/metrics`);
        const payload = (await response.json());
        strict_1.default.equal(response.status, 200);
        strict_1.default.equal(payload.ok, true);
        strict_1.default.ok(payload.metrics.process.pid > 0);
        strict_1.default.ok(payload.metrics.process.uptimeSec >= 0);
    });
});
(0, node_test_1.default)("ops scorecard endpoint returns KPI status and records compute event", async () => {
    const stateStore = new memoryStores_1.MemoryStateStore();
    const eventStore = new memoryStores_1.MemoryEventStore();
    await stateStore.saveStudioState({
        schemaVersion: "v3.0",
        snapshotDate: "2026-02-13",
        generatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        cloudSync: {
            firestoreReadAt: new Date().toISOString(),
            stripeReadAt: null,
        },
        counts: { batchesActive: 1, batchesClosed: 1, reservationsOpen: 1, firingsScheduled: 1, reportsOpen: 1 },
        ops: { blockedTickets: 0, agentRequestsPending: 0, highSeverityReports: 0 },
        finance: { pendingOrders: 0, unsettledPayments: 0 },
        sourceHashes: { firestore: "hash", stripe: null },
        diagnostics: { completeness: "full", warnings: [] },
    });
    await withServer({
        stateStore,
        eventStore,
    }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/ops/scorecard`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(response.status, 200);
        const payload = (await response.json());
        strict_1.default.equal(payload.ok, true);
        strict_1.default.ok(["ok", "warning", "critical"].includes(payload.scorecard.overallStatus));
        strict_1.default.equal(payload.scorecard.metrics.length, 5);
        const rows = await eventStore.listRecent(10);
        strict_1.default.ok(rows.some((row) => row.action === "studio_ops.scorecard_computed"));
    });
});
(0, node_test_1.default)("handler failure returns 500 without crashing server", async () => {
    const stateStore = new memoryStores_1.MemoryStateStore();
    const badStateStore = stateStore;
    badStateStore.getLatestStudioState = async () => {
        throw new Error("boom");
    };
    await withServer({
        stateStore: badStateStore,
    }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/studio-state/latest`);
        const payload = (await response.json());
        strict_1.default.equal(response.status, 500);
        strict_1.default.equal(payload.ok, false);
        strict_1.default.equal(payload.message, "Internal server error");
    });
});
(0, node_test_1.default)("capability workflow enforces approval before execution", async () => {
    await withServer({}, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                capabilityId: "firestore.batch.close",
                rationale: "Close this batch after final QA pass completes.",
                previewSummary: "Close batch mfb-123",
                requestInput: { batchId: "mfb-123" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        strict_1.default.equal(created.status, 201);
        const createdPayload = (await created.json());
        strict_1.default.equal(createdPayload.proposal.requestedBy, "staff-test-uid");
        const proposalId = createdPayload.proposal.id;
        const denied = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                output: { result: "would close" },
            }),
        });
        strict_1.default.equal(denied.status, 409);
        const approved = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                approvedBy: "staff-approver",
                rationale: "Approved after staff review and compliance verification.",
            }),
        });
        strict_1.default.equal(approved.status, 200);
        const executed = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                output: { result: "closed" },
            }),
        });
        strict_1.default.equal(executed.status, 200);
        const executedPayload = (await executed.json());
        strict_1.default.equal(executedPayload.proposal.status, "executed");
    });
});
(0, node_test_1.default)("quota endpoints list and reset buckets", async () => {
    await withServer({}, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                capabilityId: "hubitat.devices.read",
                rationale: "Read-only status refresh for dashboard health tiles.",
                previewSummary: "Read connector status",
                requestInput: { deviceId: "hub-7" },
                expectedEffects: ["No external writes."],
            }),
        });
        const createdPayload = (await created.json());
        const proposalId = createdPayload.proposal.id;
        await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                output: { result: "ok" },
            }),
        });
        const listed = await fetch(`${baseUrl}/api/capabilities/quotas`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(listed.status, 200);
        const listedPayload = (await listed.json());
        strict_1.default.ok(listedPayload.buckets.length >= 1);
        const targetBucket = listedPayload.buckets[0].bucket;
        const reset = await fetch(`${baseUrl}/api/capabilities/quotas/${encodeURIComponent(targetBucket)}/reset`, {
            method: "POST",
            headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
            body: JSON.stringify({ reason: "Emergency counter reset during incident triage." }),
        });
        strict_1.default.equal(reset.status, 200);
    });
});
(0, node_test_1.default)("capability audit endpoint returns filtered capability events", async () => {
    await withServer({}, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                capabilityId: "hubitat.devices.read",
                rationale: "Read-only status refresh for dashboard health tiles.",
                previewSummary: "Read connector status",
                requestInput: { deviceId: "hub-7" },
                expectedEffects: ["No external writes."],
            }),
        });
        const createdPayload = (await created.json());
        const proposalId = createdPayload.proposal.id;
        await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                output: { result: "ok" },
            }),
        });
        const auditResp = await fetch(`${baseUrl}/api/capabilities/audit?limit=20`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(auditResp.status, 200);
        const payload = (await auditResp.json());
        strict_1.default.ok(payload.rows.length >= 1);
        strict_1.default.ok(payload.rows.every((row) => row.action.startsWith("capability.")));
        const filtered = await fetch(`${baseUrl}/api/capabilities/audit?limit=20&actionPrefix=capability.hubitat.devices.read`, { headers: { authorization: "Bearer test-staff" } });
        strict_1.default.equal(filtered.status, 200);
        const filteredPayload = (await filtered.json());
        strict_1.default.ok(filteredPayload.rows.length >= 1);
        strict_1.default.ok(filteredPayload.rows.every((row) => row.action.startsWith("capability.hubitat.devices.read")));
    });
});
(0, node_test_1.default)("capability audit export endpoint returns verifiable bundle", async () => {
    await withServer({}, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                capabilityId: "firestore.batch.close",
                rationale: "Export seed proposal for audit verification checks.",
                previewSummary: "Seed export",
                requestInput: { batchId: "mfb-1" },
                expectedEffects: ["none"],
            }),
        });
        strict_1.default.equal(created.status, 201);
        const response = await fetch(`${baseUrl}/api/capabilities/audit/export?limit=50`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(response.status, 200);
        const payload = (await response.json());
        strict_1.default.equal(payload.ok, true);
        strict_1.default.ok(payload.bundle.manifest.rowCount >= 1);
        strict_1.default.ok(payload.bundle.manifest.payloadHash.length > 10);
    });
});
(0, node_test_1.default)("quota reset requires a reason", async () => {
    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/capabilities/quotas/missing/reset`, {
            method: "POST",
            headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
            body: JSON.stringify({}),
        });
        strict_1.default.equal(response.status, 400);
    });
});
(0, node_test_1.default)("approval and rejection endpoints require rationale", async () => {
    await withServer({}, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                capabilityId: "firestore.batch.close",
                rationale: "Close this batch after final QA pass completes.",
                previewSummary: "Close batch mfb-123",
                requestInput: { batchId: "mfb-123" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        const createdPayload = (await created.json());
        const proposalId = createdPayload.proposal.id;
        const missingApproveRationale = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
            method: "POST",
            headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
            body: JSON.stringify({}),
        });
        strict_1.default.equal(missingApproveRationale.status, 400);
        const missingRejectRationale = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/reject`, {
            method: "POST",
            headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
            body: JSON.stringify({}),
        });
        strict_1.default.equal(missingRejectRationale.status, 400);
    });
});
(0, node_test_1.default)("kill switch blocks execution even for approved proposal", async () => {
    await withServer({}, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                capabilityId: "firestore.batch.close",
                rationale: "Close this batch after final QA pass completes.",
                previewSummary: "Close batch mfb-123",
                requestInput: { batchId: "mfb-123" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        const createdPayload = (await created.json());
        const proposalId = createdPayload.proposal.id;
        const approved = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                rationale: "Approved after staff review and compliance verification.",
            }),
        });
        strict_1.default.equal(approved.status, 200);
        const killSwitchOn = await fetch(`${baseUrl}/api/capabilities/policy/kill-switch`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                enabled: true,
                rationale: "Emergency freeze while policy behavior is validated.",
            }),
        });
        strict_1.default.equal(killSwitchOn.status, 200);
        const executeBlocked = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                output: { result: "closed" },
            }),
        });
        strict_1.default.equal(executeBlocked.status, 409);
        const payload = (await executeBlocked.json());
        strict_1.default.equal(payload.decision.reasonCode, "BLOCKED_BY_POLICY");
    });
});
(0, node_test_1.default)("capability endpoints require admin token when configured", async () => {
    await withServer({
        adminToken: "secret-token",
        allowedOrigins: ["http://127.0.0.1:5173"],
    }, async (baseUrl) => {
        const preflight = await fetch(`${baseUrl}/api/capabilities`, {
            method: "OPTIONS",
            headers: { Origin: "http://127.0.0.1:5173" },
        });
        strict_1.default.equal(preflight.status, 204);
        const unauthorized = await fetch(`${baseUrl}/api/capabilities`, {
            method: "GET",
            headers: { Origin: "http://127.0.0.1:5173", authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(unauthorized.status, 401);
        const authorized = await fetch(`${baseUrl}/api/capabilities`, {
            method: "GET",
            headers: {
                Origin: "http://127.0.0.1:5173",
                authorization: "Bearer test-staff",
                "x-studio-brain-admin-token": "secret-token",
            },
        });
        strict_1.default.equal(authorized.status, 200);
    });
});
(0, node_test_1.default)("capability endpoints reject non-staff principal", async () => {
    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/capabilities`, {
            method: "GET",
            headers: { authorization: "Bearer test-member" },
        });
        strict_1.default.equal(response.status, 401);
    });
});
(0, node_test_1.default)("capability policy lint endpoint returns lint status", async () => {
    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/capabilities/policy-lint`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(response.status, 200);
        const payload = (await response.json());
        strict_1.default.equal(payload.ok, true);
        strict_1.default.ok(payload.capabilitiesChecked >= 1);
        strict_1.default.ok(Array.isArray(payload.violations));
    });
});
(0, node_test_1.default)("connector health endpoint returns connector rows", async () => {
    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/connectors/health`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(response.status, 200);
        const payload = (await response.json());
        strict_1.default.ok(Array.isArray(payload.connectors));
    });
});
(0, node_test_1.default)("proposal endpoint rejects agent actor without delegation", async () => {
    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "agent",
                actorId: "agent-1",
                ownerUid: "owner-1",
                capabilityId: "firestore.batch.close",
                rationale: "Close this batch after final QA pass completes.",
                previewSummary: "Close batch mfb-123",
                requestInput: { batchId: "mfb-123" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        strict_1.default.equal(response.status, 403);
        const payload = (await response.json());
        strict_1.default.equal(payload.reasonCode, "DELEGATION_MISSING");
    });
});
(0, node_test_1.default)("proposal and execute allow agent actor with valid delegation", async () => {
    await withServer({}, async (baseUrl) => {
        const create = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "agent",
                actorId: "agent-1",
                ownerUid: "owner-1",
                delegation: {
                    delegationId: "del-1",
                    agentUid: "agent-1",
                    ownerUid: "owner-1",
                    scopes: ["capability:firestore.batch.close:execute"],
                    expiresAt: "2099-01-01T00:00:00.000Z",
                },
                capabilityId: "firestore.batch.close",
                rationale: "Close this batch after final QA pass completes.",
                previewSummary: "Close batch mfb-123",
                requestInput: { batchId: "mfb-123" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        strict_1.default.equal(create.status, 201);
        const createdPayload = (await create.json());
        const proposalId = createdPayload.proposal.id;
        await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                rationale: "Approved after staff review and compliance verification.",
            }),
        });
        const execute = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "agent",
                actorId: "agent-1",
                ownerUid: "owner-1",
                delegation: {
                    delegationId: "del-1",
                    agentUid: "agent-1",
                    ownerUid: "owner-1",
                    scopes: ["capability:firestore.batch.close:execute"],
                    expiresAt: "2099-01-01T00:00:00.000Z",
                },
                output: { result: "closed" },
            }),
        });
        strict_1.default.equal(execute.status, 200);
    });
});
(0, node_test_1.default)("ops recommendation drafts endpoint returns detector drafts", async () => {
    const eventStore = new memoryStores_1.MemoryEventStore();
    await eventStore.append({
        actorType: "system",
        actorId: "studio-brain",
        action: "studio_ops.recommendation_draft_created",
        rationale: "Agent requests pending is 24 (delta +10).",
        target: "local",
        approvalState: "exempt",
        inputHash: "in-hash",
        outputHash: "out-hash",
        metadata: {
            ruleId: "queue_spike",
            severity: "medium",
            title: "Agent request queue spike",
            recommendation: "Triage queue.",
            snapshotDate: "2026-02-13",
        },
    });
    await withServer({
        eventStore,
    }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/ops/recommendations/drafts?limit=10`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(response.status, 200);
        const payload = (await response.json());
        strict_1.default.equal(payload.rows.length, 1);
        strict_1.default.equal(payload.rows[0].ruleId, "queue_spike");
    });
});
(0, node_test_1.default)("marketing drafts endpoint lists drafts and review updates status", async () => {
    const eventStore = new memoryStores_1.MemoryEventStore();
    await eventStore.append({
        actorType: "system",
        actorId: "studio-brain",
        action: "studio_marketing.draft_created",
        rationale: "Generated instagram draft from StudioState snapshot.",
        target: "local",
        approvalState: "exempt",
        inputHash: "in-hash",
        outputHash: "out-hash",
        metadata: {
            draftId: "mk-2026-02-13-ig",
            status: "draft",
            channel: "instagram",
            title: "Studio Pulse Update",
            copy: "copy",
            sourceSnapshotDate: "2026-02-13",
            sourceRefs: ["ops.blockedTickets=1"],
            confidenceNotes: "notes",
            templateVersion: "marketing-v1",
        },
    });
    await withServer({ eventStore }, async (baseUrl) => {
        const listed = await fetch(`${baseUrl}/api/marketing/drafts?limit=10`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(listed.status, 200);
        const listedPayload = (await listed.json());
        strict_1.default.equal(listedPayload.rows[0].draftId, "mk-2026-02-13-ig");
        strict_1.default.equal(listedPayload.rows[0].status, "draft");
        const review = await fetch(`${baseUrl}/api/marketing/drafts/mk-2026-02-13-ig/review`, {
            method: "POST",
            headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
            body: JSON.stringify({
                toStatus: "needs_review",
                rationale: "Reviewed for tone and content alignment before publish queue.",
            }),
        });
        strict_1.default.equal(review.status, 200);
    });
});
(0, node_test_1.default)("finance reconciliation drafts endpoint returns finance drafts", async () => {
    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/finance/reconciliation/drafts?limit=10`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(response.status, 200);
        const payload = (await response.json());
        strict_1.default.ok(Array.isArray(payload.rows));
    });
});
(0, node_test_1.default)("ops drills endpoint records drill events", async () => {
    await withServer({}, async (baseUrl) => {
        const post = await fetch(`${baseUrl}/api/ops/drills`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                scenarioId: "token_compromise",
                status: "started",
                outcome: "in_progress",
                notes: "Chaos drill start.",
            }),
        });
        strict_1.default.equal(post.status, 200);
        const list = await fetch(`${baseUrl}/api/ops/drills?limit=10`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(list.status, 200);
        const payload = (await list.json());
        strict_1.default.ok(payload.rows.some((row) => row.scenarioId === "token_compromise"));
    });
});
(0, node_test_1.default)("ops drills endpoint enforces auth and required drill fields", async () => {
    await withServer({}, async (baseUrl) => {
        const unauthorized = await fetch(`${baseUrl}/api/ops/drills`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                scenarioId: "connector_outage",
                status: "started",
            }),
        });
        strict_1.default.equal(unauthorized.status, 401);
        const missingScenario = await fetch(`${baseUrl}/api/ops/drills`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                status: "started",
            }),
        });
        strict_1.default.equal(missingScenario.status, 400);
        const missingStatus = await fetch(`${baseUrl}/api/ops/drills`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                scenarioId: "connector_outage",
            }),
        });
        strict_1.default.equal(missingStatus.status, 400);
        const nonStaff = await fetch(`${baseUrl}/api/ops/drills`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-member" },
            body: JSON.stringify({
                scenarioId: "connector_outage",
                status: "started",
            }),
        });
        strict_1.default.equal(nonStaff.status, 401);
    });
});
(0, node_test_1.default)("ops drills endpoint preserves mttr and unresolved risk metadata", async () => {
    await withServer({}, async (baseUrl) => {
        const posted = await fetch(`${baseUrl}/api/ops/drills`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                scenarioId: "policy_bypass_attempt",
                status: "completed",
                outcome: "partial",
                notes: "Kill switch blocked writes; one stale alert remained.",
                mttrMinutes: 42,
                unresolvedRisks: ["alert-routing-followup", "playbook-clarification"],
            }),
        });
        strict_1.default.equal(posted.status, 200);
        const list = await fetch(`${baseUrl}/api/ops/drills?limit=10`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(list.status, 200);
        const payload = (await list.json());
        const row = payload.rows.find((entry) => entry.scenarioId === "policy_bypass_attempt");
        strict_1.default.ok(row);
        strict_1.default.equal(row?.status, "completed");
        strict_1.default.equal(row?.outcome, "partial");
        strict_1.default.equal(row?.mttrMinutes, 42);
        strict_1.default.deepEqual(row?.unresolvedRisks ?? [], ["alert-routing-followup", "playbook-clarification"]);
    });
});
(0, node_test_1.default)("ops drills endpoint events are queryable in ops audit stream", async () => {
    await withServer({}, async (baseUrl) => {
        const post = await fetch(`${baseUrl}/api/ops/drills`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                scenarioId: "connector_outage",
                status: "completed",
                outcome: "success",
                notes: "Connector timeout storm drill completed.",
            }),
        });
        strict_1.default.equal(post.status, 200);
        const audit = await fetch(`${baseUrl}/api/ops/audit?limit=20&actionPrefix=studio_ops.drill_event`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(audit.status, 200);
        const payload = (await audit.json());
        const row = payload.rows.find((entry) => entry.action === "studio_ops.drill_event");
        strict_1.default.ok(row);
        strict_1.default.equal(row?.metadata?.scenarioId, "connector_outage");
        strict_1.default.equal(row?.metadata?.status, "completed");
        strict_1.default.equal(row?.metadata?.outcome, "success");
    });
});
(0, node_test_1.default)("ops degraded endpoint records entry and audit list returns events", async () => {
    await withServer({}, async (baseUrl) => {
        const post = await fetch(`${baseUrl}/api/ops/degraded`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                status: "entered",
                mode: "offline",
                reason: "Studio Brain not reachable from staff console.",
            }),
        });
        strict_1.default.equal(post.status, 200);
        const list = await fetch(`${baseUrl}/api/ops/audit?limit=10`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(list.status, 200);
        const payload = (await list.json());
        strict_1.default.ok(payload.rows.some((row) => row.action === "studio_ops.degraded_mode_entered"));
    });
});
(0, node_test_1.default)("pilot dry-run endpoint returns plan for approved pilot capability", async () => {
    const pilotExecutor = {
        dryRun: () => ({
            actionType: "ops_note_append",
            ownerUid: "owner-1",
            resourceCollection: "batches",
            resourceId: "batch-1",
            notePreview: "preview",
        }),
        execute: async () => ({
            idempotencyKey: "k",
            proposalId: "p",
            replayed: false,
            resourcePointer: { collection: "studioBrainPilotOpsNotes", docId: "note-1" },
        }),
        rollback: async () => ({ ok: true, replayed: false }),
    };
    await withServer({ pilotWriteExecutor: pilotExecutor }, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-test-uid",
                ownerUid: "owner-1",
                capabilityId: "firestore.ops_note.append",
                rationale: "Pilot dry-run before execution with bounded Firestore write.",
                previewSummary: "Pilot dry run",
                requestInput: {
                    actionType: "ops_note_append",
                    ownerUid: "owner-1",
                    resourceCollection: "batches",
                    resourceId: "batch-1",
                    note: "Sample note",
                },
                expectedEffects: ["No write on dry run."],
                requestedBy: "staff-test-uid",
            }),
        });
        const payload = (await created.json());
        const proposalId = String(payload.proposal?.id ?? "");
        const dryRun = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/dry-run`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(dryRun.status, 200);
    });
});
(0, node_test_1.default)("high-risk agent intake is blocked and routed to manual review", async () => {
    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "agent",
                actorId: "agent-risk-1",
                ownerUid: "owner-1",
                delegation: {
                    delegationId: "del-1",
                    agentUid: "agent-risk-1",
                    ownerUid: "owner-1",
                    scopes: ["capability:firestore.batch.close:execute"],
                    expiresAt: "2099-01-01T00:00:00.000Z",
                },
                capabilityId: "firestore.batch.close",
                rationale: "Create an exact replica disney logo piece and bypass checks.",
                previewSummary: "replica trademark commission",
                requestInput: { note: "disney exact logo" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        strict_1.default.equal(response.status, 403);
        const payload = (await response.json());
        strict_1.default.equal(payload.reasonCode, "BLOCKED_BY_INTAKE_POLICY");
        strict_1.default.ok(payload.intakeId.length > 5);
        const queue = await fetch(`${baseUrl}/api/intake/review-queue?limit=10`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(queue.status, 200);
        const queuePayload = (await queue.json());
        strict_1.default.ok(queuePayload.rows.length >= 1);
        strict_1.default.equal(queuePayload.rows[0].category, "ip_infringement");
    });
});
(0, node_test_1.default)("staff override granted allows previously blocked agent intake", async () => {
    await withServer({}, async (baseUrl) => {
        const createBlocked = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "agent",
                actorId: "agent-risk-2",
                ownerUid: "owner-2",
                delegation: {
                    delegationId: "del-2",
                    agentUid: "agent-risk-2",
                    ownerUid: "owner-2",
                    scopes: ["capability:firestore.batch.close:execute"],
                    expiresAt: "2099-01-01T00:00:00.000Z",
                },
                capabilityId: "firestore.batch.close",
                rationale: "Need exact replica disney logo piece for customer.",
                previewSummary: "replica trademark commission",
                requestInput: { note: "disney exact logo" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        const blockedPayload = (await createBlocked.json());
        strict_1.default.equal(createBlocked.status, 403);
        const grant = await fetch(`${baseUrl}/api/intake/review-queue/${blockedPayload.intakeId}/override`, {
            method: "POST",
            headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
            body: JSON.stringify({
                decision: "override_granted",
                reasonCode: "staff_override_context_verified",
                rationale: "Staff verified rights documentation and approved exception path.",
            }),
        });
        strict_1.default.equal(grant.status, 200);
        const createAllowed = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "agent",
                actorId: "agent-risk-2",
                ownerUid: "owner-2",
                delegation: {
                    delegationId: "del-2",
                    agentUid: "agent-risk-2",
                    ownerUid: "owner-2",
                    scopes: ["capability:firestore.batch.close:execute"],
                    expiresAt: "2099-01-01T00:00:00.000Z",
                },
                capabilityId: "firestore.batch.close",
                rationale: "Need exact replica disney logo piece for customer.",
                previewSummary: "replica trademark commission",
                requestInput: { note: "disney exact logo" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        strict_1.default.equal(createAllowed.status, 201);
    });
});
(0, node_test_1.default)("ops degraded endpoint enforces auth and validates status values", async () => {
    await withServer({}, async (baseUrl) => {
        const nonStaff = await fetch(`${baseUrl}/api/ops/degraded`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-member" },
            body: JSON.stringify({
                status: "entered",
                mode: "offline",
            }),
        });
        strict_1.default.equal(nonStaff.status, 401);
        const invalidStatus = await fetch(`${baseUrl}/api/ops/degraded`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                status: "paused",
                mode: "offline",
            }),
        });
        strict_1.default.equal(invalidStatus.status, 400);
    });
});
(0, node_test_1.default)("staff override denied keeps blocked intake denied on retry", async () => {
    await withServer({}, async (baseUrl) => {
        const createBlocked = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "agent",
                actorId: "agent-risk-3",
                ownerUid: "owner-3",
                delegation: {
                    delegationId: "del-3",
                    agentUid: "agent-risk-3",
                    ownerUid: "owner-3",
                    scopes: ["capability:firestore.batch.close:execute"],
                    expiresAt: "2099-01-01T00:00:00.000Z",
                },
                capabilityId: "firestore.batch.close",
                rationale: "Need exact replica disney logo for a rush order.",
                previewSummary: "replica trademark commission",
                requestInput: { note: "disney exact logo" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        strict_1.default.equal(createBlocked.status, 403);
        const blockedPayload = (await createBlocked.json());
        strict_1.default.equal(blockedPayload.reasonCode, "BLOCKED_BY_INTAKE_POLICY");
        strict_1.default.ok(blockedPayload.intakeId.length > 5);
        const deny = await fetch(`${baseUrl}/api/intake/review-queue/${blockedPayload.intakeId}/override`, {
            method: "POST",
            headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
            body: JSON.stringify({
                decision: "override_denied",
                reasonCode: "staff_override_context_verified",
                rationale: "Staff denied request because rights proof is missing.",
            }),
        });
        strict_1.default.equal(deny.status, 200);
        const createStillBlocked = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "agent",
                actorId: "agent-risk-3",
                ownerUid: "owner-3",
                delegation: {
                    delegationId: "del-3",
                    agentUid: "agent-risk-3",
                    ownerUid: "owner-3",
                    scopes: ["capability:firestore.batch.close:execute"],
                    expiresAt: "2099-01-01T00:00:00.000Z",
                },
                capabilityId: "firestore.batch.close",
                rationale: "Need exact replica disney logo for a rush order.",
                previewSummary: "replica trademark commission",
                requestInput: { note: "disney exact logo" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        strict_1.default.equal(createStillBlocked.status, 403);
        const stillBlockedPayload = (await createStillBlocked.json());
        strict_1.default.equal(stillBlockedPayload.reasonCode, "BLOCKED_BY_INTAKE_POLICY");
    });
});
(0, node_test_1.default)("trust safety triage suggestion endpoints generate and track feedback", async () => {
    await withServer({}, async (baseUrl) => {
        const suggest = await fetch(`${baseUrl}/api/trust-safety/triage/suggest`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                reportId: "report-1",
                targetType: "blog_post",
                targetTitle: "Safety notice",
                note: "This contains threat language and possible self-harm hints.",
            }),
        });
        strict_1.default.equal(suggest.status, 200);
        const suggestPayload = (await suggest.json());
        strict_1.default.equal(suggestPayload.suggestion.suggestionOnly, true);
        strict_1.default.equal(suggestPayload.suggestion.category, "safety");
        const feedback = await fetch(`${baseUrl}/api/trust-safety/triage/feedback`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                reportId: "report-1",
                decision: "accepted",
                mismatch: false,
                suggestedSeverity: "high",
                suggestedCategory: "safety",
                suggestedReasonCode: "safety_escalated",
                finalSeverity: "high",
                finalCategory: "safety",
                finalReasonCode: "safety_escalated",
            }),
        });
        strict_1.default.equal(feedback.status, 200);
        const stats = await fetch(`${baseUrl}/api/trust-safety/triage/stats?limit=100`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(stats.status, 200);
        const statsPayload = (await stats.json());
        strict_1.default.equal(statsPayload.stats.accepted, 1);
        strict_1.default.equal(statsPayload.stats.rejected, 0);
    });
});
(0, node_test_1.default)("proposal endpoint returns 429 when endpoint throttle exceeded and logs rate-limit event", async () => {
    await withServer({
        endpointRateLimits: { createProposalPerMinute: 1 },
    }, async (baseUrl) => {
        const first = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                capabilityId: "hubitat.devices.read",
                rationale: "Read-only status refresh for dashboard health tiles.",
                previewSummary: "Read connector status",
                requestInput: { deviceId: "hub-7" },
                expectedEffects: ["No external writes."],
            }),
        });
        strict_1.default.equal(first.status, 201);
        const second = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                capabilityId: "hubitat.devices.read",
                rationale: "Read-only status refresh for dashboard health tiles.",
                previewSummary: "Read connector status",
                requestInput: { deviceId: "hub-7" },
                expectedEffects: ["No external writes."],
            }),
        });
        strict_1.default.equal(second.status, 429);
        const payload = (await second.json());
        strict_1.default.equal(payload.reasonCode, "RATE_LIMITED");
        strict_1.default.ok(payload.retryAfterSeconds > 0);
        const eventsResp = await fetch(`${baseUrl}/api/capabilities/rate-limits/events?limit=10`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(eventsResp.status, 200);
        const eventsPayload = (await eventsResp.json());
        strict_1.default.ok(eventsPayload.rows.length >= 1);
        strict_1.default.ok(eventsPayload.rows.every((row) => row.action === "rate_limit_triggered"));
    });
});
(0, node_test_1.default)("reopen rejected proposal requires admin role", async () => {
    await withServer({}, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                capabilityId: "firestore.batch.close",
                rationale: "Close this batch after final QA pass completes.",
                previewSummary: "Close batch mfb-123",
                requestInput: { batchId: "mfb-123" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        const payload = (await created.json());
        const proposalId = payload.proposal.id;
        await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/reject`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({ reason: "Policy mismatch in final review." }),
        });
        const forbidden = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/reopen`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({ reason: "Need another review pass with updated context." }),
        });
        strict_1.default.equal(forbidden.status, 403);
        const reopened = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/reopen`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-admin" },
            body: JSON.stringify({ reason: "Need another review pass with updated context." }),
        });
        strict_1.default.equal(reopened.status, 200);
        const reopenedPayload = (await reopened.json());
        strict_1.default.equal(reopenedPayload.proposal.status, "pending_approval");
    });
});
(0, node_test_1.default)("pilot write executes only after approval and supports replay semantics", async () => {
    const idempotencySeen = new Set();
    const pilotExecutor = {
        dryRun: (input) => ({
            actionType: "ops_note_append",
            ownerUid: String(input.ownerUid ?? "owner-1"),
            resourceCollection: "batches",
            resourceId: String(input.resourceId ?? "batch-1"),
            notePreview: String(input.note ?? ""),
        }),
        execute: async (input) => ({
            idempotencyKey: input.idempotencyKey,
            proposalId: input.proposalId,
            replayed: idempotencySeen.has(input.idempotencyKey),
            resourcePointer: {
                collection: "studioBrainPilotOpsNotes",
                docId: "note-1",
            },
        }),
        rollback: async () => ({ ok: true, replayed: false }),
    };
    await withServer({ pilotWriteExecutor: pilotExecutor }, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-test-uid",
                ownerUid: "owner-1",
                capabilityId: "firestore.ops_note.append",
                rationale: "Pilot append note after approved ops review.",
                previewSummary: "Append note",
                requestInput: {
                    actionType: "ops_note_append",
                    ownerUid: "owner-1",
                    resourceCollection: "batches",
                    resourceId: "batch-1",
                    note: "Dry rack moved; verify glaze consistency.",
                },
                expectedEffects: ["Add staff-visible note for ops context."],
                requestedBy: "staff-test-uid",
            }),
        });
        strict_1.default.ok(created.status === 200 || created.status === 201);
        const createdPayload = (await created.json());
        const proposalId = String(createdPayload.proposal?.id ?? "");
        strict_1.default.ok(proposalId.length > 0);
        const deniedBeforeApproval = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-test-uid",
                ownerUid: "owner-1",
                idempotencyKey: "pilot-key-001",
                output: {},
            }),
        });
        strict_1.default.equal(deniedBeforeApproval.status, 409);
        const approved = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                approvedBy: "staff-test-uid",
                rationale: "Approved for low-risk pilot note write.",
            }),
        });
        strict_1.default.equal(approved.status, 200);
        const firstExecute = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-test-uid",
                ownerUid: "owner-1",
                idempotencyKey: "pilot-key-001",
                output: {},
            }),
        });
        strict_1.default.equal(firstExecute.status, 200);
        idempotencySeen.add("pilot-key-001");
        const replay = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-test-uid",
                ownerUid: "owner-1",
                idempotencyKey: "pilot-key-001",
                output: {},
            }),
        });
        strict_1.default.equal(replay.status, 409);
    });
});
(0, node_test_1.default)("execute denies cross-tenant actor on approved proposal", async () => {
    await withServer({}, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-test-uid",
                ownerUid: "owner-a",
                tenantId: "studio-a",
                capabilityId: "firestore.batch.close",
                rationale: "Cross-tenant denial test proposal for batch close.",
                previewSummary: "tenant scoped close",
                requestInput: { batchId: "batch-a", tenantId: "studio-a" },
                expectedEffects: ["Batch closes in tenant a."],
                requestedBy: "staff-test-uid",
            }),
        });
        const createdPayload = (await created.json());
        const proposalId = String(createdPayload.proposal?.id ?? "");
        strict_1.default.ok(proposalId.length > 0);
        const approved = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                approvedBy: "staff-test-uid",
                rationale: "Approved for tenant-scope denial verification.",
            }),
        });
        strict_1.default.equal(approved.status, 200);
        const execute = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-test-uid",
                ownerUid: "owner-b",
                tenantId: "studio-b",
                output: {},
            }),
        });
        strict_1.default.equal(execute.status, 409);
        const payload = (await execute.json());
        strict_1.default.equal(payload.decision?.reasonCode, "TENANT_MISMATCH");
        const audit = await fetch(`${baseUrl}/api/ops/audit?limit=20&actionPrefix=studio_ops.cross_tenant_denied`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(audit.status, 200);
        const auditPayload = (await audit.json());
        strict_1.default.ok(auditPayload.rows.some((row) => row.action === "studio_ops.cross_tenant_denied"));
    });
});
(0, node_test_1.default)("capabilities endpoint returns cockpit bootstrap payload", async () => {
    await withServer({}, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                capabilityId: "firestore.batch.close",
                rationale: "Bootstrap payload should include new pending proposal rows.",
                previewSummary: "Close batch mfb-888",
                requestInput: { batchId: "mfb-888" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        strict_1.default.equal(created.status, 201);
        const createdPayload = (await created.json());
        const response = await fetch(`${baseUrl}/api/capabilities`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(response.status, 200);
        const payload = (await response.json());
        strict_1.default.equal(payload.ok, true);
        strict_1.default.ok(payload.capabilities.some((row) => row.id === "firestore.batch.close"));
        strict_1.default.ok(payload.proposals.some((row) => row.id === createdPayload.proposal.id));
        strict_1.default.equal(typeof payload.policy.killSwitch.enabled, "boolean");
        strict_1.default.ok(Array.isArray(payload.policy.exemptions));
        strict_1.default.ok(Array.isArray(payload.connectors));
    });
});
(0, node_test_1.default)("pilot rollback endpoint forwards idempotency and reason to executor", async () => {
    const rollbackCalls = [];
    const pilotExecutor = {
        dryRun: (input) => ({
            actionType: "ops_note_append",
            ownerUid: String(input.ownerUid ?? "owner-1"),
            resourceCollection: "batches",
            resourceId: String(input.resourceId ?? "batch-1"),
            notePreview: String(input.note ?? ""),
        }),
        execute: async (input) => ({
            idempotencyKey: input.idempotencyKey,
            proposalId: input.proposalId,
            replayed: false,
            resourcePointer: {
                collection: "studioBrainPilotOpsNotes",
                docId: "note-rollback-1",
            },
        }),
        rollback: async (input) => {
            rollbackCalls.push(input);
            return { ok: true, replayed: false };
        },
    };
    await withServer({ pilotWriteExecutor: pilotExecutor }, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-test-uid",
                ownerUid: "owner-1",
                capabilityId: "firestore.ops_note.append",
                rationale: "Pilot rollback path should preserve idempotency linkage.",
                previewSummary: "Append ops note",
                requestInput: {
                    actionType: "ops_note_append",
                    ownerUid: "owner-1",
                    resourceCollection: "batches",
                    resourceId: "batch-1",
                    note: "Pilot note for rollback validation.",
                },
                expectedEffects: ["Add staff-visible note for ops context."],
            }),
        });
        strict_1.default.equal(created.status, 201);
        const createdPayload = (await created.json());
        const proposalId = createdPayload.proposal.id;
        const approved = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                approvedBy: "staff-test-uid",
                rationale: "Approved pilot write before rollback validation.",
            }),
        });
        strict_1.default.equal(approved.status, 200);
        const execute = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-test-uid",
                ownerUid: "owner-1",
                idempotencyKey: "pilot-rb-001",
                output: { executedFrom: "server-test" },
            }),
        });
        strict_1.default.equal(execute.status, 200);
        const rollback = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/rollback`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                idempotencyKey: "pilot-rb-001",
                reason: "Rollback requested after duplicate operator note.",
            }),
        });
        strict_1.default.equal(rollback.status, 200);
        const rollbackPayload = (await rollback.json());
        strict_1.default.equal(rollbackPayload.ok, true);
        strict_1.default.equal(rollbackCalls.length, 1);
        strict_1.default.equal(rollbackCalls[0].proposalId, proposalId);
        strict_1.default.equal(rollbackCalls[0].idempotencyKey, "pilot-rb-001");
        strict_1.default.equal(rollbackCalls[0].reason, "Rollback requested after duplicate operator note.");
        strict_1.default.equal(rollbackCalls[0].actorUid, "staff-test-uid");
    });
});
