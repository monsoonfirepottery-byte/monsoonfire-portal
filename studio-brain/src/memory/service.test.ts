import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryService } from "./service";
import { createInMemoryMemoryStoreAdapter } from "./inMemoryAdapter";

test("memory service capture/search pipeline works with in-memory adapter", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-a",
  });

  const first = await service.capture({
    content: "Decision: launch moved after QA blocker review.",
    source: "manual",
    clientRequestId: "capture-1",
  });
  assert.equal(first.tenantId, "tenant-a");
  assert.ok(first.id.startsWith("mem_req_"));

  const duplicate = await service.capture({
    content: "Decision: launch moved after QA blocker review.",
    source: "manual",
    clientRequestId: "capture-1",
  });
  assert.equal(duplicate.id, first.id);

  const rows = await service.search({ query: "QA blocker" });
  assert.ok(rows.length >= 1);
  assert.equal(rows[0]?.id, first.id);

  const stats = await service.stats({});
  assert.equal(stats.total, 1);
  assert.equal(stats.bySource[0]?.source, "manual");
});

test("memory service importBatch reports failures when continueOnError=false", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-b",
  });

  const result = await service.importBatch({
    continueOnError: false,
    items: [{ content: "valid row" }, { content: "" }, { content: "unreached row" }],
  });

  assert.equal(result.imported, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[1]?.ok, false);
});

test("memory nanny reroutes non-allowlisted tenant and derives stable namespace", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "monsoonfire-main",
    defaultAgentId: "studio-brain-memory",
    defaultRunId: "open-memory-v1",
    allowedTenantIds: ["monsoonfire-main"],
  });

  const row = await service.capture({
    content: "Discord note from a new agent tenant should be rerouted safely.",
    source: "discord",
    tenantId: "random-agent-space",
  });

  assert.equal(row.tenantId, "monsoonfire-main");
  assert.equal(row.agentId, "agent:discord");
  assert.equal(row.runId, "agent:discord:main");
  const nanny = (row.metadata._memoryNanny ?? {}) as Record<string, unknown>;
  assert.equal(nanny.tenantFallbackApplied, true);
  assert.equal(nanny.requestedTenantId, "random-agent-space");
  assert.equal(nanny.resolvedTenantId, "monsoonfire-main");
});

test("memory nanny suppresses fast duplicate loops without client request ids", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-loop",
    nannyDuplicateWindowMs: 60_000,
  });

  const first = await service.capture({
    content: "Loop candidate note that should not duplicate endlessly.",
    source: "codex-handoff",
  });
  const second = await service.capture({
    content: "Loop candidate note that should not duplicate endlessly.",
    source: "codex-handoff",
  });

  assert.equal(first.id.startsWith("mem_"), true);
  assert.equal(second.id.startsWith("mem_loop_"), true);
  const stats = await service.stats({});
  assert.equal(stats.total, 2);
});

test("context packs are budgeted and scoped for startup", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-context",
    defaultAgentId: "agent:codex",
  });

  await service.capture({
    content: "Intent runner is green and drift checks are passing.",
    source: "codex-handoff",
    agentId: "agent:codex",
    runId: "agent:codex:main",
  });
  await service.capture({
    content: "Unrelated discord social memory.",
    source: "discord",
    agentId: "agent:discord",
    runId: "agent:discord:main",
  });

  const context = await service.context({
    agentId: "agent:codex",
    runId: "agent:codex:main",
    query: "intent drift",
    maxItems: 5,
    maxChars: 512,
    scanLimit: 50,
    includeTenantFallback: false,
  });

  assert.ok(context.items.length >= 1);
  assert.equal(context.selection.agentId, "agent:codex");
  assert.equal(context.selection.runId, "agent:codex:main");
  assert.ok(context.budget.usedChars <= 512);
  assert.ok(context.items.every((row) => row.agentId === "agent:codex"));
});

test("context can expand memory relationships across linked rows", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-context",
    defaultAgentId: "agent:codex",
  });

  await service.capture({
    id: "mem-root",
    content: "Session anchor: we were moving the intent runner forward.",
    source: "codex-handoff",
    agentId: "agent:codex",
    runId: "agent:codex:main",
    tags: ["context-seed"],
    metadata: {
      threadKey: "continuity-thread",
      relatedMemoryIds: ["mem-follow-up"],
    },
  });
  await service.capture({
    id: "mem-follow-up",
    content: "Worker handoff pending: codex needs shell restart notes.",
    source: "codex-handoff",
    agentId: "agent:codex",
    runId: "agent:codex:main",
    tags: ["context-follow-up"],
    metadata: {
      relatedMemoryIds: ["mem-root"],
    },
  });
  await service.capture({
    id: "mem-other",
    content: "Unrelated reminder that does not connect to continuity thread.",
    source: "codex-handoff",
    agentId: "agent:codex",
    runId: "agent:codex:main",
    tags: ["other"],
  });

  const context = await service.context({
    agentId: "agent:codex",
    runId: "agent:codex:main",
    query: "anchor",
    maxItems: 3,
    maxChars: 1200,
    scanLimit: 50,
    includeTenantFallback: false,
    expandRelationships: true,
    maxHops: 2,
  });

  assert.equal(context.items.length >= 2, true);
  assert.ok(context.selection.expandRelationships);
  assert.equal(context.selection.relationshipExpansion.addedFromRelationships >= 1, true);
  assert.ok(context.selection.relationshipExpansion.attempted);
});

test("context can force a seed memory id before scoring", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-context-seed",
    defaultAgentId: "agent:codex",
  });

  await service.capture({
    id: "mem-seed",
    content: "Seed for explicit restart continuity.",
    source: "codex-handoff",
    agentId: "agent:codex",
    runId: "agent:codex:main",
    tags: ["seed"],
  });
  await service.capture({
    id: "mem-tail",
    content: "Recent unrelated codex item with same run.",
    source: "codex-handoff",
    agentId: "agent:codex",
    runId: "agent:codex:main",
    tags: ["tail"],
  });

  const context = await service.context({
    runId: "agent:codex:main",
    agentId: "agent:codex",
    query: "unrelated",
    maxItems: 1,
    maxChars: 1200,
    scanLimit: 50,
    includeTenantFallback: false,
    seedMemoryId: "mem-seed",
  });

  assert.equal(context.selection.seedMemoryId, "mem-seed");
  assert.equal(context.items[0]?.id, "mem-seed");
});

test("incident action idempotency replays when occurredAt is omitted", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-incident-idempotency",
  });

  const first = await service.incidentAction({
    loopKey: "loop.audit.idempotency",
    action: "ack",
    idempotencyKey: "incident-idem-001",
    note: "same payload",
  });
  assert.equal(first.ok, true);
  assert.equal(first.idempotency.replayed, false);
  assert.ok(first.feedback);
  assert.equal(first.feedback.counts.ackCount, 1);

  const replay = await service.incidentAction({
    loopKey: "loop.audit.idempotency",
    action: "ack",
    idempotencyKey: "incident-idem-001",
    note: "same payload",
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotency.replayed, true);
  assert.equal(replay.recordedAt, first.recordedAt);
  assert.ok(replay.feedback);
  assert.equal(replay.feedback.counts.ackCount, 1);
});
