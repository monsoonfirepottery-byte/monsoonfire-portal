"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const service_1 = require("./service");
const inMemoryAdapter_1 = require("./inMemoryAdapter");
(0, node_test_1.default)("memory service capture/search pipeline works with in-memory adapter", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
        defaultTenantId: "tenant-a",
    });
    const first = await service.capture({
        content: "Decision: launch moved after QA blocker review.",
        source: "manual",
        clientRequestId: "capture-1",
    });
    strict_1.default.equal(first.tenantId, "tenant-a");
    strict_1.default.ok(first.id.startsWith("mem_req_"));
    const duplicate = await service.capture({
        content: "Decision: launch moved after QA blocker review.",
        source: "manual",
        clientRequestId: "capture-1",
    });
    strict_1.default.equal(duplicate.id, first.id);
    const rows = await service.search({ query: "QA blocker" });
    strict_1.default.ok(rows.length >= 1);
    strict_1.default.equal(rows[0]?.id, first.id);
    const stats = await service.stats({});
    strict_1.default.equal(stats.total, 1);
    strict_1.default.equal(stats.bySource[0]?.source, "manual");
});
(0, node_test_1.default)("memory service importBatch reports failures when continueOnError=false", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
        defaultTenantId: "tenant-b",
    });
    const result = await service.importBatch({
        continueOnError: false,
        items: [{ content: "valid row" }, { content: "" }, { content: "unreached row" }],
    });
    strict_1.default.equal(result.imported, 1);
    strict_1.default.equal(result.failed, 1);
    strict_1.default.equal(result.results.length, 2);
    strict_1.default.equal(result.results[1]?.ok, false);
});
(0, node_test_1.default)("memory service importBatch preserves per-row source when no sourceOverride is supplied", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(rows[0]?.source, "repo-markdown");
    strict_1.default.equal(rows[1]?.source, "codex-resumable-session");
    strict_1.default.equal(rows[0]?.metadata.corpusRecordId, "fact-portal-1");
    strict_1.default.equal(rows[1]?.metadata.projectLane, "monsoonfire-portal");
});
(0, node_test_1.default)("memory service importBatch honors explicit sourceOverride when intentionally supplied", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(row?.source, "import");
});
(0, node_test_1.default)("memory nanny reroutes non-allowlisted tenant and derives stable namespace", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(row.tenantId, "monsoonfire-main");
    strict_1.default.equal(row.agentId, "agent:discord");
    strict_1.default.equal(row.runId, "agent:discord:main");
    const nanny = (row.metadata._memoryNanny ?? {});
    strict_1.default.equal(nanny.tenantFallbackApplied, true);
    strict_1.default.equal(nanny.requestedTenantId, "random-agent-space");
    strict_1.default.equal(nanny.resolvedTenantId, "monsoonfire-main");
});
(0, node_test_1.default)("memory nanny suppresses fast duplicate loops without client request ids", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(first.id.startsWith("mem_"), true);
    strict_1.default.equal(second.id.startsWith("mem_loop_"), true);
    const stats = await service.stats({});
    strict_1.default.equal(stats.total, 2);
});
(0, node_test_1.default)("context packs are budgeted and scoped for startup", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.ok(context.items.length >= 1);
    strict_1.default.equal(context.selection.agentId, "agent:codex");
    strict_1.default.equal(context.selection.runId, "agent:codex:main");
    strict_1.default.ok(context.budget.usedChars <= 512);
    strict_1.default.ok(context.items.every((row) => row.agentId === "agent:codex"));
});
(0, node_test_1.default)("context can expand memory relationships across linked rows", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(context.items.length >= 2, true);
    strict_1.default.ok(context.selection.expandRelationships);
    strict_1.default.equal(context.selection.relationshipExpansion.addedFromRelationships >= 1, true);
    strict_1.default.ok(context.selection.relationshipExpansion.attempted);
});
(0, node_test_1.default)("context can force a seed memory id before scoring", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(context.selection.seedMemoryId, "mem-seed");
    strict_1.default.equal(context.items[0]?.id, "mem-seed");
});
(0, node_test_1.default)("project-scoped queries boost same-lane corpus-backed rows over mail noise", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(rows[0]?.id, "mem-portal");
    strict_1.default.equal(rows[2]?.id, "mem-mail");
});
(0, node_test_1.default)("compaction-promoted memories outrank raw compaction captures for startup-style queries", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(rows[0]?.id, "mem-promoted");
    strict_1.default.equal(rows[1]?.id, "mem-raw");
});
(0, node_test_1.default)("expired compaction raw rows are excluded from search and context selection", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(searchRows.some((row) => row.id === "mem-expired-raw"), false);
    strict_1.default.equal(searchRows.some((row) => row.id === "mem-live-promoted"), true);
    const context = await service.context({
        agentId: "agent:codex",
        runId: "codex-thread:expired",
        query: "portal context bootstrap memory",
        maxItems: 5,
        maxChars: 1200,
        scanLimit: 50,
        includeTenantFallback: false,
    });
    strict_1.default.equal(context.items.some((row) => row.id === "mem-expired-raw"), false);
    strict_1.default.equal(context.items.some((row) => row.id === "mem-live-promoted"), true);
});
(0, node_test_1.default)("incident action idempotency replays when occurredAt is omitted", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
        defaultTenantId: "tenant-incident-idempotency",
    });
    const first = await service.incidentAction({
        loopKey: "loop.audit.idempotency",
        action: "ack",
        idempotencyKey: "incident-idem-001",
        note: "same payload",
    });
    strict_1.default.equal(first.ok, true);
    strict_1.default.equal(first.idempotency.replayed, false);
    strict_1.default.ok(first.feedback);
    strict_1.default.equal(first.feedback.counts.ackCount, 1);
    const replay = await service.incidentAction({
        loopKey: "loop.audit.idempotency",
        action: "ack",
        idempotencyKey: "incident-idem-001",
        note: "same payload",
    });
    strict_1.default.equal(replay.ok, true);
    strict_1.default.equal(replay.idempotency.replayed, true);
    strict_1.default.equal(replay.recordedAt, first.recordedAt);
    strict_1.default.ok(replay.feedback);
    strict_1.default.equal(replay.feedback.counts.ackCount, 1);
});
