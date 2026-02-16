import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { startHttpServer } from "./server";
import { MemoryEventStore, MemoryStateStore } from "../stores/memoryStores";
import { CapabilityRuntime, defaultCapabilities } from "../capabilities/runtime";

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

async function withServer(
  options: Partial<Parameters<typeof startHttpServer>[0]>,
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const stateStore = options.stateStore ?? new MemoryStateStore();
  const eventStore = options.eventStore ?? new MemoryEventStore();
  const capabilityRuntime = new CapabilityRuntime(defaultCapabilities, eventStore);

  const server = startHttpServer({
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

  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

test("health endpoint returns ok", async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`);
    const payload = (await response.json()) as { ok: boolean; service: string };
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.service, "studio-brain");
  });
});

test("readyz fails when snapshot freshness is required and missing", async () => {
  await withServer(
    {
      requireFreshSnapshotForReady: true,
      readyMaxSnapshotAgeMinutes: 10,
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/readyz`);
      const payload = (await response.json()) as { ok: boolean };
      assert.equal(response.status, 503);
      assert.equal(payload.ok, false);
    }
  );
});

test("readyz succeeds without requiring fresh snapshot", async () => {
  await withServer(
    {
      requireFreshSnapshotForReady: false,
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/readyz`);
      const payload = (await response.json()) as { ok: boolean };
      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
    }
  );
});

test("status endpoint includes runtime payload and recent jobs", async () => {
  const stateStore = new MemoryStateStore();
  await stateStore.startJobRun("computeStudioState");

  await withServer(
    {
      stateStore,
      getRuntimeStatus: () => ({ scheduler: { intervalMs: 1000 }, custom: "ok" }),
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/status`);
      const payload = (await response.json()) as {
        ok: boolean;
        runtime: { custom?: string };
        jobRuns: unknown[];
      };

      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
      assert.equal(payload.runtime.custom, "ok");
      assert.ok(Array.isArray(payload.jobRuns));
      assert.ok(payload.jobRuns.length >= 1);
    }
  );
});

test("metrics endpoint includes process payload", async () => {
  await withServer(
    {
      getRuntimeMetrics: () => ({ scheduler: { intervalMs: 1000 } }),
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/metrics`);
      const payload = (await response.json()) as {
        ok: boolean;
        metrics: { process: { pid: number; uptimeSec: number } };
      };
      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
      assert.ok(payload.metrics.process.pid > 0);
      assert.ok(payload.metrics.process.uptimeSec >= 0);
    }
  );
});

test("ops scorecard endpoint returns KPI status and records compute event", async () => {
  const stateStore = new MemoryStateStore();
  const eventStore = new MemoryEventStore();
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

  await withServer(
    {
      stateStore,
      eventStore,
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ops/scorecard`, {
        headers: { authorization: "Bearer test-staff" },
      });
      assert.equal(response.status, 200);
      const payload = (await response.json()) as {
        ok: boolean;
        scorecard: {
          overallStatus: string;
          metrics: Array<{ key: string; status: string }>;
        };
      };
      assert.equal(payload.ok, true);
      assert.ok(["ok", "warning", "critical"].includes(payload.scorecard.overallStatus));
      assert.equal(payload.scorecard.metrics.length, 5);
      const rows = await eventStore.listRecent(10);
      assert.ok(rows.some((row) => row.action === "studio_ops.scorecard_computed"));
    }
  );
});

test("handler failure returns 500 without crashing server", async () => {
  const stateStore = new MemoryStateStore();
  const badStateStore = stateStore as MemoryStateStore & {
    getLatestStudioState: () => Promise<never>;
  };
  badStateStore.getLatestStudioState = async () => {
    throw new Error("boom");
  };

  await withServer(
    {
      stateStore: badStateStore,
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/studio-state/latest`);
      const payload = (await response.json()) as { ok: boolean; message: string };
      assert.equal(response.status, 500);
      assert.equal(payload.ok, false);
      assert.equal(payload.message, "Internal server error");
    }
  );
});

test("capability workflow enforces approval before execution", async () => {
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
    assert.equal(created.status, 201);
    const createdPayload = (await created.json()) as {
      proposal: { id: string; requestedBy: string };
    };
    assert.equal(createdPayload.proposal.requestedBy, "staff-test-uid");
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
    assert.equal(denied.status, 409);

    const approved = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        approvedBy: "staff-approver",
        rationale: "Approved after staff review and compliance verification.",
      }),
    });
    assert.equal(approved.status, 200);

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
    assert.equal(executed.status, 200);
    const executedPayload = (await executed.json()) as { proposal: { status: string } };
    assert.equal(executedPayload.proposal.status, "executed");
  });
});

test("quota endpoints list and reset buckets", async () => {
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
    const createdPayload = (await created.json()) as { proposal: { id: string } };
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
    assert.equal(listed.status, 200);
    const listedPayload = (await listed.json()) as {
      buckets: Array<{ bucket: string; count: number }>;
    };
    assert.ok(listedPayload.buckets.length >= 1);
    const targetBucket = listedPayload.buckets[0].bucket;

    const reset = await fetch(`${baseUrl}/api/capabilities/quotas/${encodeURIComponent(targetBucket)}/reset`, {
      method: "POST",
      headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
      body: JSON.stringify({ reason: "Emergency counter reset during incident triage." }),
    });
    assert.equal(reset.status, 200);
  });
});

test("capability audit endpoint returns filtered capability events", async () => {
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
    const createdPayload = (await created.json()) as { proposal: { id: string } };
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
    assert.equal(auditResp.status, 200);
    const payload = (await auditResp.json()) as { rows: Array<{ action: string }> };
    assert.ok(payload.rows.length >= 1);
    assert.ok(payload.rows.every((row) => row.action.startsWith("capability.")));

    const filtered = await fetch(
      `${baseUrl}/api/capabilities/audit?limit=20&actionPrefix=capability.hubitat.devices.read`,
      { headers: { authorization: "Bearer test-staff" } }
    );
    assert.equal(filtered.status, 200);
    const filteredPayload = (await filtered.json()) as { rows: Array<{ action: string }> };
    assert.ok(filteredPayload.rows.length >= 1);
    assert.ok(filteredPayload.rows.every((row) => row.action.startsWith("capability.hubitat.devices.read")));
  });
});

test("capability audit export endpoint returns verifiable bundle", async () => {
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
    assert.equal(created.status, 201);
    const response = await fetch(`${baseUrl}/api/capabilities/audit/export?limit=50`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      ok: boolean;
      bundle: { manifest: { rowCount: number; payloadHash: string } };
    };
    assert.equal(payload.ok, true);
    assert.ok(payload.bundle.manifest.rowCount >= 1);
    assert.ok(payload.bundle.manifest.payloadHash.length > 10);
  });
});

test("quota reset requires a reason", async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/capabilities/quotas/missing/reset`, {
      method: "POST",
      headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
  });
});

test("approval and rejection endpoints require rationale", async () => {
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
    const createdPayload = (await created.json()) as { proposal: { id: string } };
    const proposalId = createdPayload.proposal.id;

    const missingApproveRationale = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
      method: "POST",
      headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(missingApproveRationale.status, 400);

    const missingRejectRationale = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/reject`, {
      method: "POST",
      headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(missingRejectRationale.status, 400);
  });
});

test("kill switch blocks execution even for approved proposal", async () => {
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
    const createdPayload = (await created.json()) as { proposal: { id: string } };
    const proposalId = createdPayload.proposal.id;

    const approved = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        rationale: "Approved after staff review and compliance verification.",
      }),
    });
    assert.equal(approved.status, 200);

    const killSwitchOn = await fetch(`${baseUrl}/api/capabilities/policy/kill-switch`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        enabled: true,
        rationale: "Emergency freeze while policy behavior is validated.",
      }),
    });
    assert.equal(killSwitchOn.status, 200);

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
    assert.equal(executeBlocked.status, 409);
    const payload = (await executeBlocked.json()) as { decision: { reasonCode: string } };
    assert.equal(payload.decision.reasonCode, "BLOCKED_BY_POLICY");
  });
});

test("capability endpoints require admin token when configured", async () => {
  await withServer(
    {
      adminToken: "secret-token",
      allowedOrigins: ["http://127.0.0.1:5173"],
    },
    async (baseUrl) => {
      const preflight = await fetch(`${baseUrl}/api/capabilities`, {
        method: "OPTIONS",
        headers: { Origin: "http://127.0.0.1:5173" },
      });
      assert.equal(preflight.status, 204);

      const unauthorized = await fetch(`${baseUrl}/api/capabilities`, {
        method: "GET",
        headers: { Origin: "http://127.0.0.1:5173", authorization: "Bearer test-staff" },
      });
      assert.equal(unauthorized.status, 401);

      const authorized = await fetch(`${baseUrl}/api/capabilities`, {
        method: "GET",
        headers: {
          Origin: "http://127.0.0.1:5173",
          authorization: "Bearer test-staff",
          "x-studio-brain-admin-token": "secret-token",
        },
      });
      assert.equal(authorized.status, 200);
    }
  );
});

test("capability endpoints reject non-staff principal", async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/capabilities`, {
      method: "GET",
      headers: { authorization: "Bearer test-member" },
    });
    assert.equal(response.status, 401);
  });
});

test("capability policy lint endpoint returns lint status", async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/capabilities/policy-lint`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      ok: boolean;
      capabilitiesChecked: number;
      violations: Array<{ code: string }>;
    };
    assert.equal(payload.ok, true);
    assert.ok(payload.capabilitiesChecked >= 1);
    assert.ok(Array.isArray(payload.violations));
  });
});

test("connector health endpoint returns connector rows", async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/connectors/health`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { connectors: Array<{ id: string }> };
    assert.ok(Array.isArray(payload.connectors));
  });
});

test("proposal endpoint rejects agent actor without delegation", async () => {
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
    assert.equal(response.status, 403);
    const payload = (await response.json()) as { reasonCode: string };
    assert.equal(payload.reasonCode, "DELEGATION_MISSING");
  });
});

test("proposal and execute allow agent actor with valid delegation", async () => {
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
    assert.equal(create.status, 201);
    const createdPayload = (await create.json()) as { proposal: { id: string } };
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
    assert.equal(execute.status, 200);
  });
});

test("ops recommendation drafts endpoint returns detector drafts", async () => {
  const eventStore = new MemoryEventStore();
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
  await withServer(
    {
      eventStore,
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ops/recommendations/drafts?limit=10`, {
        headers: { authorization: "Bearer test-staff" },
      });
      assert.equal(response.status, 200);
      const payload = (await response.json()) as { rows: Array<{ ruleId: string }> };
      assert.equal(payload.rows.length, 1);
      assert.equal(payload.rows[0].ruleId, "queue_spike");
    }
  );
});

test("marketing drafts endpoint lists drafts and review updates status", async () => {
  const eventStore = new MemoryEventStore();
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
    assert.equal(listed.status, 200);
    const listedPayload = (await listed.json()) as { rows: Array<{ draftId: string; status: string }> };
    assert.equal(listedPayload.rows[0].draftId, "mk-2026-02-13-ig");
    assert.equal(listedPayload.rows[0].status, "draft");

    const review = await fetch(`${baseUrl}/api/marketing/drafts/mk-2026-02-13-ig/review`, {
      method: "POST",
      headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
      body: JSON.stringify({
        toStatus: "needs_review",
        rationale: "Reviewed for tone and content alignment before publish queue.",
      }),
    });
    assert.equal(review.status, 200);
  });
});

test("finance reconciliation drafts endpoint returns finance drafts", async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/finance/reconciliation/drafts?limit=10`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { rows: Array<{ ruleId: string }> };
    assert.ok(Array.isArray(payload.rows));
  });
});

test("ops drills endpoint records drill events", async () => {
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
    assert.equal(post.status, 200);
    const list = await fetch(`${baseUrl}/api/ops/drills?limit=10`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(list.status, 200);
    const payload = (await list.json()) as { rows: Array<{ scenarioId: string }> };
    assert.ok(payload.rows.some((row) => row.scenarioId === "token_compromise"));
  });
});

test("ops degraded endpoint records entry and audit list returns events", async () => {
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
    assert.equal(post.status, 200);
    const list = await fetch(`${baseUrl}/api/ops/audit?limit=10`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(list.status, 200);
    const payload = (await list.json()) as { rows: Array<{ action: string }> };
    assert.ok(payload.rows.some((row) => row.action === "studio_ops.degraded_mode_entered"));
  });
});

test("pilot dry-run endpoint returns plan for approved pilot capability", async () => {
  const pilotExecutor = {
    dryRun: () => ({
      actionType: "ops_note_append" as const,
      ownerUid: "owner-1",
      resourceCollection: "batches" as const,
      resourceId: "batch-1",
      notePreview: "preview",
    }),
    execute: async () => ({
      idempotencyKey: "k",
      proposalId: "p",
      replayed: false,
      resourcePointer: { collection: "studioBrainPilotOpsNotes", docId: "note-1" },
    }),
    rollback: async () => ({ ok: true as const, replayed: false }),
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
    const payload = (await created.json()) as { proposal?: { id: string } };
    const proposalId = String(payload.proposal?.id ?? "");
    const dryRun = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/dry-run`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(dryRun.status, 200);
  });
});

test("high-risk agent intake is blocked and routed to manual review", async () => {
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
    assert.equal(response.status, 403);
    const payload = (await response.json()) as { reasonCode: string; intakeId: string };
    assert.equal(payload.reasonCode, "BLOCKED_BY_INTAKE_POLICY");
    assert.ok(payload.intakeId.length > 5);

    const queue = await fetch(`${baseUrl}/api/intake/review-queue?limit=10`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(queue.status, 200);
    const queuePayload = (await queue.json()) as { rows: Array<{ intakeId: string; category: string }> };
    assert.ok(queuePayload.rows.length >= 1);
    assert.equal(queuePayload.rows[0].category, "ip_infringement");
  });
});

test("staff override granted allows previously blocked agent intake", async () => {
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
    const blockedPayload = (await createBlocked.json()) as { intakeId: string };
    assert.equal(createBlocked.status, 403);

    const grant = await fetch(`${baseUrl}/api/intake/review-queue/${blockedPayload.intakeId}/override`, {
      method: "POST",
      headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
      body: JSON.stringify({
        decision: "override_granted",
        reasonCode: "staff_override_context_verified",
        rationale: "Staff verified rights documentation and approved exception path.",
      }),
    });
    assert.equal(grant.status, 200);

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
    assert.equal(createAllowed.status, 201);
  });
});

test("trust safety triage suggestion endpoints generate and track feedback", async () => {
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
    assert.equal(suggest.status, 200);
    const suggestPayload = (await suggest.json()) as { suggestion: { category: string; suggestionOnly: boolean } };
    assert.equal(suggestPayload.suggestion.suggestionOnly, true);
    assert.equal(suggestPayload.suggestion.category, "safety");

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
    assert.equal(feedback.status, 200);

    const stats = await fetch(`${baseUrl}/api/trust-safety/triage/stats?limit=100`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(stats.status, 200);
    const statsPayload = (await stats.json()) as { stats: { accepted: number; rejected: number } };
    assert.equal(statsPayload.stats.accepted, 1);
    assert.equal(statsPayload.stats.rejected, 0);
  });
});

test("proposal endpoint returns 429 when endpoint throttle exceeded and logs rate-limit event", async () => {
  await withServer(
    {
      endpointRateLimits: { createProposalPerMinute: 1 },
    },
    async (baseUrl) => {
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
      assert.equal(first.status, 201);

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
      assert.equal(second.status, 429);
      const payload = (await second.json()) as { reasonCode: string; retryAfterSeconds: number };
      assert.equal(payload.reasonCode, "RATE_LIMITED");
      assert.ok(payload.retryAfterSeconds > 0);

      const eventsResp = await fetch(`${baseUrl}/api/capabilities/rate-limits/events?limit=10`, {
        headers: { authorization: "Bearer test-staff" },
      });
      assert.equal(eventsResp.status, 200);
      const eventsPayload = (await eventsResp.json()) as { rows: Array<{ action: string }> };
      assert.ok(eventsPayload.rows.length >= 1);
      assert.ok(eventsPayload.rows.every((row) => row.action === "rate_limit_triggered"));
    }
  );
});

test("reopen rejected proposal requires admin role", async () => {
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
    const payload = (await created.json()) as { proposal: { id: string } };
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
    assert.equal(forbidden.status, 403);

    const reopened = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/reopen`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-admin" },
      body: JSON.stringify({ reason: "Need another review pass with updated context." }),
    });
    assert.equal(reopened.status, 200);
    const reopenedPayload = (await reopened.json()) as { proposal: { status: string } };
    assert.equal(reopenedPayload.proposal.status, "pending_approval");
  });
});

test("pilot write executes only after approval and supports replay semantics", async () => {
  const idempotencySeen = new Set<string>();
  const pilotExecutor = {
    dryRun: (input: Record<string, unknown>) => ({
      actionType: "ops_note_append" as const,
      ownerUid: String(input.ownerUid ?? "owner-1"),
      resourceCollection: "batches" as const,
      resourceId: String(input.resourceId ?? "batch-1"),
      notePreview: String(input.note ?? ""),
    }),
    execute: async (input: { idempotencyKey: string; proposalId: string }) => ({
      idempotencyKey: input.idempotencyKey,
      proposalId: input.proposalId,
      replayed: idempotencySeen.has(input.idempotencyKey),
      resourcePointer: {
        collection: "studioBrainPilotOpsNotes",
        docId: "note-1",
      },
    }),
    rollback: async () => ({ ok: true as const, replayed: false }),
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
    assert.ok(created.status === 200 || created.status === 201);
    const createdPayload = (await created.json()) as { proposal?: { id: string } };
    const proposalId = String(createdPayload.proposal?.id ?? "");
    assert.ok(proposalId.length > 0);

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
    assert.equal(deniedBeforeApproval.status, 409);

    const approved = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        approvedBy: "staff-test-uid",
        rationale: "Approved for low-risk pilot note write.",
      }),
    });
    assert.equal(approved.status, 200);

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
    assert.equal(firstExecute.status, 200);
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
    assert.equal(replay.status, 409);
  });
});

test("execute denies cross-tenant actor on approved proposal", async () => {
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
    const createdPayload = (await created.json()) as { proposal?: { id: string } };
    const proposalId = String(createdPayload.proposal?.id ?? "");
    assert.ok(proposalId.length > 0);

    const approved = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        approvedBy: "staff-test-uid",
        rationale: "Approved for tenant-scope denial verification.",
      }),
    });
    assert.equal(approved.status, 200);

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
    assert.equal(execute.status, 409);
    const payload = (await execute.json()) as { decision?: { reasonCode?: string } };
    assert.equal(payload.decision?.reasonCode, "TENANT_MISMATCH");
    const audit = await fetch(`${baseUrl}/api/ops/audit?limit=20&actionPrefix=studio_ops.cross_tenant_denied`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(audit.status, 200);
    const auditPayload = (await audit.json()) as { rows: Array<{ action: string }> };
    assert.ok(auditPayload.rows.some((row) => row.action === "studio_ops.cross_tenant_denied"));
  });
});

test("capabilities endpoint returns cockpit bootstrap payload", async () => {
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
    assert.equal(created.status, 201);
    const createdPayload = (await created.json()) as { proposal: { id: string } };

    const response = await fetch(`${baseUrl}/api/capabilities`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      ok: boolean;
      capabilities: Array<{ id: string }>;
      proposals: Array<{ id: string }>;
      policy: { killSwitch: { enabled: boolean }; exemptions: unknown[] };
      connectors: Array<{ id: string; ok: boolean }>;
    };

    assert.equal(payload.ok, true);
    assert.ok(payload.capabilities.some((row) => row.id === "firestore.batch.close"));
    assert.ok(payload.proposals.some((row) => row.id === createdPayload.proposal.id));
    assert.equal(typeof payload.policy.killSwitch.enabled, "boolean");
    assert.ok(Array.isArray(payload.policy.exemptions));
    assert.ok(Array.isArray(payload.connectors));
  });
});

test("pilot rollback endpoint forwards idempotency and reason to executor", async () => {
  const rollbackCalls: Array<{ proposalId: string; idempotencyKey: string; reason: string; actorUid: string }> = [];
  const pilotExecutor = {
    dryRun: (input: Record<string, unknown>) => ({
      actionType: "ops_note_append" as const,
      ownerUid: String(input.ownerUid ?? "owner-1"),
      resourceCollection: "batches" as const,
      resourceId: String(input.resourceId ?? "batch-1"),
      notePreview: String(input.note ?? ""),
    }),
    execute: async (input: { idempotencyKey: string; proposalId: string }) => ({
      idempotencyKey: input.idempotencyKey,
      proposalId: input.proposalId,
      replayed: false,
      resourcePointer: {
        collection: "studioBrainPilotOpsNotes",
        docId: "note-rollback-1",
      },
    }),
    rollback: async (input: { proposalId: string; idempotencyKey: string; reason: string; actorUid: string }) => {
      rollbackCalls.push(input);
      return { ok: true as const, replayed: false };
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
    assert.equal(created.status, 201);
    const createdPayload = (await created.json()) as { proposal: { id: string } };
    const proposalId = createdPayload.proposal.id;

    const approved = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        approvedBy: "staff-test-uid",
        rationale: "Approved pilot write before rollback validation.",
      }),
    });
    assert.equal(approved.status, 200);

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
    assert.equal(execute.status, 200);

    const rollback = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        idempotencyKey: "pilot-rb-001",
        reason: "Rollback requested after duplicate operator note.",
      }),
    });
    assert.equal(rollback.status, 200);
    const rollbackPayload = (await rollback.json()) as { ok: boolean };
    assert.equal(rollbackPayload.ok, true);

    assert.equal(rollbackCalls.length, 1);
    assert.equal(rollbackCalls[0].proposalId, proposalId);
    assert.equal(rollbackCalls[0].idempotencyKey, "pilot-rb-001");
    assert.equal(rollbackCalls[0].reason, "Rollback requested after duplicate operator note.");
    assert.equal(rollbackCalls[0].actorUid, "staff-test-uid");
  });
});
