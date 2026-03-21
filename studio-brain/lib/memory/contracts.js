"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.memoryLoopAutomationTickRequestSchema = exports.memoryLoopActionPlanRequestSchema = exports.memoryLoopOwnerQueuesRequestSchema = exports.memoryLoopFeedbackStatsRequestSchema = exports.memoryLoopIncidentActionBatchRequestSchema = exports.memoryLoopIncidentActionRequestSchema = exports.memoryLoopsRequestSchema = exports.memoryThreadMetadataScrubRequestSchema = exports.memorySignalIndexBackfillRequestSchema = exports.memoryEmailThreadBackfillRequestSchema = exports.memoryImportRequestSchema = exports.memoryContextRequestSchema = exports.memoryStatsRequestSchema = exports.memoryRecentRequestSchema = exports.memorySearchRequestSchema = exports.memoryCaptureRequestSchema = exports.memoryLoopSortSchema = exports.memoryLoopActionPrioritySchema = exports.memoryLoopIncidentActionTypeSchema = exports.memoryLoopLaneSchema = exports.memoryLoopStateSchema = exports.memoryTypeSchema = exports.memoryStatusSchema = exports.memoryQueryLaneSchema = exports.retrievalModeSchema = exports.embeddingSchema = exports.MAX_MEMORY_IMPORT_ITEMS = exports.MAX_MEMORY_LIMIT = exports.MAX_MEMORY_CONTENT_CHARS = void 0;
const zod_1 = require("zod");
exports.MAX_MEMORY_CONTENT_CHARS = 65_536;
exports.MAX_MEMORY_LIMIT = 100;
exports.MAX_MEMORY_IMPORT_ITEMS = 500;
const embeddingValue = zod_1.z.number().finite();
const stringList = zod_1.z.array(zod_1.z.string().trim().min(1).max(128)).max(64);
exports.embeddingSchema = zod_1.z.array(embeddingValue).min(1).max(4096);
exports.retrievalModeSchema = zod_1.z.enum(["hybrid", "semantic", "lexical"]);
exports.memoryQueryLaneSchema = zod_1.z.enum(["interactive", "ops", "bulk"]);
exports.memoryStatusSchema = zod_1.z.enum(["proposed", "accepted", "quarantined", "archived"]);
exports.memoryTypeSchema = zod_1.z.enum(["working", "episodic", "semantic", "procedural"]);
exports.memoryLoopStateSchema = zod_1.z.enum(["open-loop", "resolved", "reopened", "superseded"]);
exports.memoryLoopLaneSchema = zod_1.z.enum(["critical", "high", "watch", "stable"]);
exports.memoryLoopIncidentActionTypeSchema = zod_1.z.enum([
    "ack",
    "assign",
    "snooze",
    "resolve",
    "false-positive",
    "escalate",
]);
exports.memoryLoopActionPrioritySchema = zod_1.z.enum(["p0", "p1", "p2", "p3"]);
exports.memoryLoopSortSchema = zod_1.z.enum([
    "attention",
    "updatedAt",
    "confidence",
    "volatility",
    "anomaly",
    "centrality",
    "escalation",
    "blastRadius",
]);
exports.memoryCaptureRequestSchema = zod_1.z.object({
    id: zod_1.z.string().trim().min(1).max(128).optional(),
    content: zod_1.z.string().trim().min(1).max(exports.MAX_MEMORY_CONTENT_CHARS),
    source: zod_1.z.string().trim().min(1).max(128).default("manual"),
    tags: zod_1.z.array(zod_1.z.string().trim().min(1).max(64)).max(32).default([]),
    metadata: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).default({}),
    tenantId: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
    agentId: zod_1.z.string().trim().min(1).max(128).optional(),
    runId: zod_1.z.string().trim().min(1).max(128).optional(),
    embedding: exports.embeddingSchema.optional(),
    clientRequestId: zod_1.z.string().trim().min(1).max(128).optional(),
    occurredAt: zod_1.z.string().datetime().optional(),
    status: exports.memoryStatusSchema.optional(),
    memoryType: exports.memoryTypeSchema.optional(),
    sourceConfidence: zod_1.z.number().min(0).max(1).optional(),
    importance: zod_1.z.number().min(0).max(1).optional(),
});
exports.memorySearchRequestSchema = zod_1.z.object({
    query: zod_1.z.string().trim().min(1).max(4096),
    tenantId: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
    agentId: zod_1.z.string().trim().min(1).max(128).optional(),
    runId: zod_1.z.string().trim().min(1).max(128).optional(),
    sourceAllowlist: stringList.default([]),
    sourceDenylist: stringList.default([]),
    retrievalMode: exports.retrievalModeSchema.default("hybrid"),
    queryLane: exports.memoryQueryLaneSchema.optional(),
    bulk: zod_1.z.boolean().optional(),
    minScore: zod_1.z.number().min(0).max(2).optional(),
    explain: zod_1.z.boolean().default(false),
    embedding: exports.embeddingSchema.optional(),
    limit: zod_1.z.number().int().min(1).max(exports.MAX_MEMORY_LIMIT).default(10),
});
exports.memoryRecentRequestSchema = zod_1.z.object({
    tenantId: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
    limit: zod_1.z.number().int().min(1).max(200).default(20),
});
exports.memoryStatsRequestSchema = zod_1.z.object({
    tenantId: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
});
exports.memoryContextRequestSchema = zod_1.z.object({
    tenantId: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
    agentId: zod_1.z.string().trim().min(1).max(128).optional(),
    runId: zod_1.z.string().trim().min(1).max(128).optional(),
    query: zod_1.z.string().trim().min(1).max(4096).optional(),
    seedMemoryId: zod_1.z.string().trim().min(1).max(128).optional(),
    sourceAllowlist: stringList.default([]),
    sourceDenylist: stringList.default([]),
    retrievalMode: exports.retrievalModeSchema.default("hybrid"),
    queryLane: exports.memoryQueryLaneSchema.optional(),
    bulk: zod_1.z.boolean().optional(),
    temporalAnchorAt: zod_1.z.string().datetime().optional(),
    explain: zod_1.z.boolean().default(false),
    maxItems: zod_1.z.number().int().min(1).max(exports.MAX_MEMORY_LIMIT).default(12),
    maxChars: zod_1.z.number().int().min(256).max(100_000).default(8_000),
    scanLimit: zod_1.z.number().int().min(1).max(500).default(200),
    includeTenantFallback: zod_1.z.boolean().default(false),
    expandRelationships: zod_1.z.boolean().default(false),
    maxHops: zod_1.z.number().int().min(1).max(4).default(2),
});
exports.memoryImportRequestSchema = zod_1.z.object({
    sourceOverride: zod_1.z.string().trim().min(1).max(128).optional(),
    continueOnError: zod_1.z.boolean().default(true),
    disableRunWriteBurstLimit: zod_1.z.boolean().default(false),
    generateBriefing: zod_1.z.boolean().default(false),
    briefingQuery: zod_1.z.string().trim().min(1).max(4096).optional(),
    briefingLimit: zod_1.z.number().int().min(1).max(50).default(12),
    briefingStates: zod_1.z.array(exports.memoryLoopStateSchema).max(4).default([]),
    briefingLanes: zod_1.z.array(exports.memoryLoopLaneSchema).max(4).default([]),
    briefingIncidentMinEscalation: zod_1.z.number().min(0).max(2).optional(),
    briefingIncidentMinBlastRadius: zod_1.z.number().min(0).max(1).optional(),
    items: zod_1.z.array(exports.memoryCaptureRequestSchema).min(1).max(exports.MAX_MEMORY_IMPORT_ITEMS),
});
exports.memoryEmailThreadBackfillRequestSchema = zod_1.z.object({
    tenantId: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
    limit: zod_1.z.number().int().min(1).max(20_000).default(2_000),
    dryRun: zod_1.z.boolean().default(false),
    sourcePrefixes: zod_1.z.array(zod_1.z.string().trim().min(1).max(64)).max(12).default(["mail:", "email"]),
    includeNonMailLikeWithMessageSignals: zod_1.z.boolean().default(false),
    maxWrites: zod_1.z.number().int().min(1).max(20_000).default(500),
    writeDelayMs: zod_1.z.number().int().min(0).max(60_000).default(20),
    stopAfterTimeoutErrors: zod_1.z.number().int().min(1).max(100).default(5),
});
exports.memorySignalIndexBackfillRequestSchema = zod_1.z.object({
    tenantId: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
    limit: zod_1.z.number().int().min(1).max(20_000).default(2_000),
    dryRun: zod_1.z.boolean().default(false),
    sourcePrefixes: zod_1.z.array(zod_1.z.string().trim().min(1).max(64)).max(12).default(["mail:", "email"]),
    includeNonMailLike: zod_1.z.boolean().default(false),
    minSignals: zod_1.z.number().int().min(1).max(512).default(1),
    skipAlreadyIndexed: zod_1.z.boolean().default(true),
    includeLoopStateUpdates: zod_1.z.boolean().default(true),
    inferRelationships: zod_1.z.boolean().default(true),
    relationshipProbeLimit: zod_1.z.number().int().min(2).max(128).default(24),
    maxInferredEdgesPerMemory: zod_1.z.number().int().min(0).max(128).default(16),
    minRelatedSignalScore: zod_1.z.number().min(0).max(2).default(0.12),
    maxWrites: zod_1.z.number().int().min(1).max(20_000).default(500),
    writeDelayMs: zod_1.z.number().int().min(0).max(60_000).default(20),
    stopAfterTimeoutErrors: zod_1.z.number().int().min(1).max(100).default(5),
});
exports.memoryThreadMetadataScrubRequestSchema = zod_1.z.object({
    tenantId: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
    limit: zod_1.z.number().int().min(1).max(20_000).default(2_000),
    dryRun: zod_1.z.boolean().default(false),
    sourcePrefixes: zod_1.z.array(zod_1.z.string().trim().min(1).max(64)).max(24).default([]),
    includeMailLike: zod_1.z.boolean().default(false),
    maxWrites: zod_1.z.number().int().min(1).max(20_000).default(500),
    writeDelayMs: zod_1.z.number().int().min(0).max(60_000).default(20),
    stopAfterTimeoutErrors: zod_1.z.number().int().min(1).max(100).default(5),
});
exports.memoryLoopsRequestSchema = zod_1.z.object({
    tenantId: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
    loopKeys: stringList.default([]),
    states: zod_1.z.array(exports.memoryLoopStateSchema).max(4).default([]),
    lanes: zod_1.z.array(exports.memoryLoopLaneSchema).max(4).default([]),
    query: zod_1.z.string().trim().min(1).max(4096).optional(),
    includeMemory: zod_1.z.boolean().default(true),
    includeIncidents: zod_1.z.boolean().default(true),
    sortBy: exports.memoryLoopSortSchema.default("attention"),
    minAttention: zod_1.z.number().min(0).max(2).optional(),
    minVolatility: zod_1.z.number().min(0).max(1).optional(),
    minAnomaly: zod_1.z.number().min(0).max(1).optional(),
    minCentrality: zod_1.z.number().min(0).max(1).optional(),
    minEscalation: zod_1.z.number().min(0).max(2).optional(),
    minBlastRadius: zod_1.z.number().min(0).max(1).optional(),
    incidentLimit: zod_1.z.number().int().min(1).max(50).default(12),
    incidentMinEscalation: zod_1.z.number().min(0).max(2).optional(),
    incidentMinBlastRadius: zod_1.z.number().min(0).max(1).optional(),
    limit: zod_1.z.number().int().min(1).max(200).default(30),
});
exports.memoryLoopIncidentActionRequestSchema = zod_1.z.object({
    tenantId: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
    loopKey: zod_1.z.string().trim().min(1).max(180),
    incidentId: zod_1.z.string().trim().min(1).max(160).optional(),
    memoryId: zod_1.z.string().trim().min(1).max(128).optional(),
    idempotencyKey: zod_1.z.string().trim().min(1).max(180).optional(),
    action: exports.memoryLoopIncidentActionTypeSchema,
    actorId: zod_1.z.string().trim().min(1).max(160).optional(),
    note: zod_1.z.string().trim().min(1).max(4_000).optional(),
    metadata: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).default({}),
    occurredAt: zod_1.z.string().datetime().optional(),
});
exports.memoryLoopIncidentActionBatchRequestSchema = zod_1.z.object({
    tenantId: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
    actorId: zod_1.z.string().trim().min(1).max(160).optional(),
    idempotencyPrefix: zod_1.z.string().trim().min(1).max(120).optional(),
    continueOnError: zod_1.z.boolean().default(true),
    actions: zod_1.z
        .array(zod_1.z.object({
        tenantId: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
        loopKey: zod_1.z.string().trim().min(1).max(180),
        incidentId: zod_1.z.string().trim().min(1).max(160).optional(),
        memoryId: zod_1.z.string().trim().min(1).max(128).optional(),
        idempotencyKey: zod_1.z.string().trim().min(1).max(180).optional(),
        action: exports.memoryLoopIncidentActionTypeSchema,
        actorId: zod_1.z.string().trim().min(1).max(160).optional(),
        note: zod_1.z.string().trim().min(1).max(4_000).optional(),
        metadata: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).default({}),
        occurredAt: zod_1.z.string().datetime().optional(),
    }))
        .min(1)
        .max(200),
});
exports.memoryLoopFeedbackStatsRequestSchema = zod_1.z.object({
    tenantId: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
    loopKeys: stringList.default([]),
    windowDays: zod_1.z.number().int().min(1).max(3650).default(180),
    limit: zod_1.z.number().int().min(1).max(500).default(120),
});
exports.memoryLoopOwnerQueuesRequestSchema = zod_1.z.object({
    tenantId: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
    query: zod_1.z.string().trim().min(1).max(4096).optional(),
    states: zod_1.z.array(exports.memoryLoopStateSchema).max(4).default([]),
    lanes: zod_1.z.array(exports.memoryLoopLaneSchema).max(4).default([]),
    loopKeys: stringList.default([]),
    limit: zod_1.z.number().int().min(1).max(200).default(50),
    incidentLimit: zod_1.z.number().int().min(1).max(50).default(20),
    incidentMinEscalation: zod_1.z.number().min(0).max(2).optional(),
    incidentMinBlastRadius: zod_1.z.number().min(0).max(1).optional(),
});
exports.memoryLoopActionPlanRequestSchema = zod_1.z.object({
    tenantId: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
    query: zod_1.z.string().trim().min(1).max(4096).optional(),
    states: zod_1.z.array(exports.memoryLoopStateSchema).max(4).default([]),
    lanes: zod_1.z.array(exports.memoryLoopLaneSchema).max(4).default([]),
    loopKeys: stringList.default([]),
    limit: zod_1.z.number().int().min(1).max(200).default(50),
    incidentLimit: zod_1.z.number().int().min(1).max(80).default(30),
    incidentMinEscalation: zod_1.z.number().min(0).max(2).optional(),
    incidentMinBlastRadius: zod_1.z.number().min(0).max(1).optional(),
    maxActions: zod_1.z.number().int().min(1).max(200).default(40),
    includeBatchPayload: zod_1.z.boolean().default(true),
});
exports.memoryLoopAutomationTickRequestSchema = zod_1.z.object({
    tenantId: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
    query: zod_1.z.string().trim().min(1).max(4096).optional(),
    states: zod_1.z.array(exports.memoryLoopStateSchema).max(4).default([]),
    lanes: zod_1.z.array(exports.memoryLoopLaneSchema).max(4).default([]),
    loopKeys: stringList.default([]),
    limit: zod_1.z.number().int().min(1).max(200).default(50),
    incidentLimit: zod_1.z.number().int().min(1).max(80).default(30),
    incidentMinEscalation: zod_1.z.number().min(0).max(2).optional(),
    incidentMinBlastRadius: zod_1.z.number().min(0).max(1).optional(),
    maxActions: zod_1.z.number().int().min(1).max(200).default(40),
    applyActions: zod_1.z.boolean().default(false),
    applyPriorities: zod_1.z.array(exports.memoryLoopActionPrioritySchema).max(4).default(["p0", "p1"]),
    allowedActions: zod_1.z.array(exports.memoryLoopIncidentActionTypeSchema).max(6).default(["escalate", "assign", "ack"]),
    actorId: zod_1.z.string().trim().min(1).max(160).optional(),
    idempotencyKey: zod_1.z.string().trim().min(1).max(180).optional(),
    includeBatchPayload: zod_1.z.boolean().default(true),
});
