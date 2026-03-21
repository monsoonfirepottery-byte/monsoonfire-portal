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

test("memory service importBatch preserves per-row source when no sourceOverride is supplied", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-import-preserve",
  });

  await service.importBatch({
    items: [
      {
        id: "mem-row-repo",
        content: "Repo markdown row should keep repo-markdown as source.",
        source: "repo-markdown",
        clientRequestId: "row-repo-1",
        metadata: {
          projectLane: "monsoonfire-portal",
          corpusRecordId: "fact-portal-1",
        },
      },
      {
        id: "mem-row-codex",
        content: "Codex resumable row should keep codex-resumable-session as source.",
        source: "codex-resumable-session",
        clientRequestId: "row-codex-1",
        metadata: {
          projectLane: "monsoonfire-portal",
          corpusRecordId: "fact-portal-2",
        },
      },
    ],
  });

  const rows = await service.getByIds({
    ids: ["mem-row-repo", "mem-row-codex"],
    includeArchived: true,
  });

  assert.equal(rows[0]?.source, "repo-markdown");
  assert.equal(rows[1]?.source, "codex-resumable-session");
  assert.equal(rows[0]?.metadata.corpusRecordId, "fact-portal-1");
  assert.equal(rows[1]?.metadata.projectLane, "monsoonfire-portal");
});

test("memory service importBatch honors explicit sourceOverride when intentionally supplied", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-import-override",
  });

  await service.importBatch({
    sourceOverride: "import",
    items: [
      {
        id: "mem-row-override",
        content: "Explicit overrides should still be honored for archive/replay batches.",
        source: "repo-markdown",
        clientRequestId: "row-override-1",
      },
    ],
  });

  const [row] = await service.getByIds({
    ids: ["mem-row-override"],
    includeArchived: true,
  });

  assert.equal(row?.source, "import");
});

test("repo markdown rows do not synthesize thread lineage without real thread evidence", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-thread-evidence",
  });

  const row = await service.capture({
    content: "Portal dashboard documentation notes and implementation outline.",
    source: "repo-markdown",
    metadata: {
      subject: "Portal dashboard docs",
    },
  });

  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  assert.equal(metadata.threadEvidence, "none");
  assert.equal(typeof metadata.threadKey, "undefined");
  assert.equal(Array.isArray(metadata.patternHints), true);
  assert.equal((metadata.patternHints as string[]).includes("structure:has-thread"), false);
});

test("mail-like rows retain derived thread evidence for relationship indexing", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-mail-thread-evidence",
  });

  const row = await service.capture({
    content: "Re: kiln queue blocker follow-up with references and next action.",
    source: "email",
    metadata: {
      subject: "Re: Kiln queue blocker",
      from: "owner@example.com",
      to: "team@example.com",
      normalizedMessageId: "<msg-2@example.com>",
      inReplyToNormalized: "<msg-1@example.com>",
      referenceMessageIds: ["<msg-1@example.com>"],
    },
  });

  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  assert.equal(metadata.threadEvidence, "derived");
  assert.equal(typeof metadata.threadKey, "string");
  assert.notEqual(String(metadata.threadKey || "").length, 0);
});

test("synthetic thread metadata scrubber rewrites legacy non-threaded rows", async () => {
  const store = createInMemoryMemoryStoreAdapter();
  const service = createMemoryService({
    store,
    defaultTenantId: "tenant-thread-scrub",
  });

  await store.upsert({
    id: "mem-legacy-thread-noise",
    tenantId: "tenant-thread-scrub",
    agentId: "agent:import",
    runId: "import:legacy",
    content: "Imported repo notes that should not behave like an email thread.",
    source: "repo-markdown",
    tags: ["import"],
    metadata: {
      source: "repo-markdown",
      threadKey: "mail-thread:unknown",
      loopClusterKey: "thread:mail-thread:unknown",
      threadDeterministicSignature: "threadsig_legacy_noise",
      threadEvidence: "derived",
      entityHints: ["thread:mail-thread:unknown", "thread-signature:threadsig_legacy_noise"],
      patternHints: ["loop-cluster:thread:mail-thread:unknown", "structure:has-thread"],
      workstreamKey: "thread:mail-thread:unknown",
      messageStructure: {
        hasThreadKey: true,
        sourceFamily: "generic",
      },
      threadReconstructionSignals: {
        deterministicSignature: "threadsig_legacy_noise",
        hasLinkableMessagePath: false,
      },
    },
    embedding: null,
    occurredAt: null,
    clientRequestId: "legacy-thread-noise-1",
    status: "accepted",
    memoryType: "semantic",
    sourceConfidence: 0.75,
    importance: 0.6,
    contextualizedContent: "Imported repo notes that should not behave like an email thread.",
    fingerprint: null,
    embeddingModel: null,
    embeddingVersion: 1,
  });

  const result = await service.scrubSyntheticThreadMetadata({
    dryRun: false,
    limit: 10,
  });

  assert.equal(result.updated, 1);
  assert.equal(result.sample[0]?.beforeThreadKey, "mail-thread:unknown");
  assert.equal(result.sample[0]?.afterThreadKey, null);

  const [row] = await service.getByIds({
    ids: ["mem-legacy-thread-noise"],
    includeArchived: true,
  });

  const metadata = (row?.metadata ?? {}) as Record<string, unknown>;
  assert.equal(metadata.threadEvidence, "none");
  assert.equal(typeof metadata.threadKey, "undefined");
  assert.equal(typeof metadata.loopClusterKey, "undefined");
  assert.equal(typeof metadata.threadDeterministicSignature, "undefined");
  assert.equal((metadata.patternHints as string[]).includes("structure:has-thread"), false);
});

test("synthetic thread metadata scrubber leaves legitimate mail threading alone", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-thread-scrub-mail",
  });

  await service.capture({
    content: "Re: real thread with actual message references.",
    source: "email",
    metadata: {
      subject: "Re: Kiln notice",
      from: "owner@example.com",
      to: "team@example.com",
      normalizedMessageId: "<msg-10@example.com>",
      inReplyToNormalized: "<msg-9@example.com>",
      referenceMessageIds: ["<msg-9@example.com>"],
    },
  });

  const result = await service.scrubSyntheticThreadMetadata({
    dryRun: true,
    limit: 10,
    includeMailLike: true,
  });

  assert.equal(result.eligible, 0);
  assert.equal(result.updated, 0);
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

test("project-scoped queries boost same-lane corpus-backed rows over mail noise", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-project-lane",
  });

  await service.capture({
    id: "mem-mail",
    content: "Support email thread about a generic follow up.",
    source: "mail:outlook",
    metadata: {
      projectLane: "personal",
      participants: ["support@example.com"],
    },
  });

  await service.capture({
    id: "mem-cross-lane",
    content: "Decision: real estate search coverage was updated.",
    source: "repo-markdown",
    metadata: {
      projectLane: "real-estate",
      corpusRecordId: "fact-real-estate",
      corpusManifestPath: "/tmp/real-estate-manifest.json",
      contextSignals: { decisionLike: true },
    },
    status: "accepted",
    sourceConfidence: 0.84,
  });

  await service.capture({
    id: "mem-portal",
    content: "Decision: Monsoon Fire portal memory retrieval now prefers same-project corpus rows.",
    source: "repo-markdown",
    metadata: {
      projectLane: "monsoonfire-portal",
      corpusRecordId: "fact-portal",
      corpusManifestPath: "/tmp/portal-manifest.json",
      contextSignals: { decisionLike: true },
    },
    status: "accepted",
    sourceConfidence: 0.84,
  });

  const rows = await service.search({
    query: "codex monsoonfire portal memory decisions",
    limit: 3,
  });

  assert.equal(rows[0]?.id, "mem-portal");
  assert.equal(rows[2]?.id, "mem-mail");
});

test("compaction-promoted memories outrank raw compaction captures for startup-style queries", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-compaction-ranking",
  });

  await service.capture({
    id: "mem-raw",
    content: "Raw tool transcript for portal memory retrieval tuning.",
    source: "codex-compaction-raw",
    metadata: {
      threadId: "thread-1",
      cwd: "D:/monsoonfire-portal",
      captureKind: "function_call_output",
    },
  });

  await service.capture({
    id: "mem-promoted",
    content: "Decision: startup retrieval should prefer promoted compaction memories for portal context.",
    source: "codex-compaction-promoted",
    metadata: {
      threadId: "thread-1",
      cwd: "D:/monsoonfire-portal",
      captureKind: "promoted",
      contextSignals: { decisionLike: true },
    },
  });

  const rows = await service.search({
    query: "portal startup retrieval promoted compaction context",
    limit: 2,
  });

  assert.equal(rows[0]?.id, "mem-promoted");
  assert.equal(rows[1]?.id, "mem-raw");
});

test("expired compaction raw rows are excluded from search and context selection", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-compaction-expiry",
    defaultAgentId: "agent:codex",
  });

  await service.capture({
    id: "mem-expired-raw",
    content: "Expired raw compaction capture about portal memory context.",
    source: "codex-compaction-raw",
    agentId: "agent:codex",
    runId: "codex-thread:expired",
    metadata: {
      threadId: "thread-expired",
      expiresAt: "2020-01-01T00:00:00.000Z",
      captureKind: "function_call_output",
    },
  });

  await service.capture({
    id: "mem-live-promoted",
    content: "Decision: keep live promoted memory for portal context bootstrap.",
    source: "codex-compaction-promoted",
    agentId: "agent:codex",
    runId: "codex-thread:expired",
    metadata: {
      threadId: "thread-expired",
      captureKind: "promoted",
    },
  });

  const searchRows = await service.search({
    query: "portal context bootstrap memory",
    limit: 5,
  });
  assert.equal(searchRows.some((row) => row.id === "mem-expired-raw"), false);
  assert.equal(searchRows.some((row) => row.id === "mem-live-promoted"), true);

  const context = await service.context({
    agentId: "agent:codex",
    runId: "codex-thread:expired",
    query: "portal context bootstrap memory",
    maxItems: 5,
    maxChars: 1200,
    scanLimit: 50,
    includeTenantFallback: false,
  });
  assert.equal(context.items.some((row) => row.id === "mem-expired-raw"), false);
  assert.equal(context.items.some((row) => row.id === "mem-live-promoted"), true);
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
