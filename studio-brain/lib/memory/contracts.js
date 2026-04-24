"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.memoryLoopAutomationTickRequestSchema = exports.memoryLoopActionPlanRequestSchema = exports.memoryLoopOwnerQueuesRequestSchema = exports.memoryLoopFeedbackStatsRequestSchema = exports.memoryLoopIncidentActionBatchRequestSchema = exports.memoryLoopIncidentActionRequestSchema = exports.memoryLoopsRequestSchema = exports.memoryThreadMetadataScrubRequestSchema = exports.memorySignalIndexBackfillRequestSchema = exports.memoryEmailThreadBackfillRequestSchema = exports.memoryImportRequestSchema = exports.memoryReviewCaseActionRequestSchema = exports.memoryReviewCaseListRequestSchema = exports.memoryContextRequestSchema = exports.memoryStatsRequestSchema = exports.memoryRecentRequestSchema = exports.memorySearchRequestSchema = exports.memoryCaptureRequestSchema = exports.memoryLoopSortSchema = exports.memoryLoopActionPrioritySchema = exports.memoryLoopIncidentActionTypeSchema = exports.memoryLoopLaneSchema = exports.memoryLoopStateSchema = exports.memoryVerificationResultStatusSchema = exports.memoryVerificationTriggerSchema = exports.memoryVerifierKindSchema = exports.memoryReviewCaseActionSchema = exports.memoryReviewCaseStatusSchema = exports.memoryReviewCaseTypeSchema = exports.memoryConflictSeveritySchema = exports.memoryReviewActionSchema = exports.memoryRedactionStateSchema = exports.memorySourceClassSchema = exports.memoryAuthorityClassSchema = exports.memoryOperationalStatusSchema = exports.memoryFreshnessStatusSchema = exports.memoryTruthStatusSchema = exports.memoryCategorySchema = exports.memoryLayerSchema = exports.memoryTypeSchema = exports.memoryStatusSchema = exports.memoryUseModeSchema = exports.memoryQueryLaneSchema = exports.retrievalModeSchema = exports.embeddingSchema = exports.MAX_MEMORY_IMPORT_ITEMS = exports.MAX_MEMORY_LIMIT = exports.MAX_MEMORY_CONTENT_CHARS = void 0;
const zod_1 = require("zod");
exports.MAX_MEMORY_CONTENT_CHARS = 65_536;
exports.MAX_MEMORY_LIMIT = 100;
exports.MAX_MEMORY_IMPORT_ITEMS = 500;
const embeddingValue = zod_1.z.number().finite();
const stringList = zod_1.z.array(zod_1.z.string().trim().min(1).max(128)).max(64);
const memoryLayerListSchema = zod_1.z.array(zod_1.z.enum(["core", "working", "episodic", "canonical"])).max(4);
exports.embeddingSchema = zod_1.z.array(embeddingValue).min(1).max(4096);
exports.retrievalModeSchema = zod_1.z.enum(["hybrid", "semantic", "lexical"]);
exports.memoryQueryLaneSchema = zod_1.z.enum(["interactive", "ops", "bulk"]);
exports.memoryUseModeSchema = zod_1.z.enum([
    "operational",
    "planning",
    "debugging",
    "safety-critical",
    "exploratory",
    "human-facing",
]);
exports.memoryStatusSchema = zod_1.z.enum(["proposed", "accepted", "quarantined", "archived"]);
exports.memoryTypeSchema = zod_1.z.enum(["working", "episodic", "semantic", "procedural"]);
exports.memoryLayerSchema = zod_1.z.enum(["core", "working", "episodic", "canonical"]);
exports.memoryCategorySchema = zod_1.z.enum([
    "observation",
    "fact",
    "decision",
    "guardrail",
    "preference",
    "known-bug",
    "workaround",
    "hypothesis",
    "procedure",
    "derived-insight",
    "legacy-lore",
    "conflict-record",
]);
exports.memoryTruthStatusSchema = zod_1.z.enum([
    "observed",
    "inferred",
    "proposed",
    "verified",
    "trusted",
    "contradicted",
]);
exports.memoryFreshnessStatusSchema = zod_1.z.enum(["fresh", "aging", "revalidation-required", "stale"]);
exports.memoryOperationalStatusSchema = zod_1.z.enum([
    "active",
    "cooling",
    "quarantined",
    "deprecated",
    "archived",
    "retired",
]);
exports.memoryAuthorityClassSchema = zod_1.z.enum(["a0-live", "a1-repo", "a2-policy", "a3-telemetry", "a4-derived", "a5-inferred"]);
exports.memorySourceClassSchema = zod_1.z.enum([
    "live-check",
    "repo-file",
    "policy",
    "telemetry",
    "human",
    "derived",
    "mcp-tool",
    "runtime-artifact",
    "external-doc",
]);
exports.memoryRedactionStateSchema = zod_1.z.enum([
    "none",
    "redacted",
    "verified-redacted",
    "requires-review",
    "quarantined",
]);
exports.memoryReviewActionSchema = zod_1.z.enum(["none", "revalidate", "resolve-conflict", "retire"]);
exports.memoryConflictSeveritySchema = zod_1.z.enum(["none", "soft", "hard"]);
exports.memoryReviewCaseTypeSchema = zod_1.z.enum([
    "resolve-conflict",
    "revalidate",
    "retire",
    "promote-guidance",
]);
exports.memoryReviewCaseStatusSchema = zod_1.z.enum(["open", "in-progress", "resolved", "dismissed"]);
exports.memoryReviewCaseActionSchema = zod_1.z.enum([
    "verify_now",
    "accept_winner",
    "keep_quarantined",
    "retire_memory",
    "dismiss_case",
    "promote_guidance",
    "reject_promotion",
]);
exports.memoryVerifierKindSchema = zod_1.z.enum([
    "repo-head",
    "runtime-check",
    "startup-instruction",
    "support-policy",
    "support-outcome",
    "operator-attested",
]);
exports.memoryVerificationTriggerSchema = zod_1.z.enum([
    "capture-conflict",
    "operational-read",
    "safety-read",
    "review-action",
    "startup-pack-change",
    "repo-diff",
    "support-case-resolved",
    "weekly-maintenance",
    "manual",
]);
exports.memoryVerificationResultStatusSchema = zod_1.z.enum(["passed", "failed", "needs-review", "skipped"]);
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
    memoryLayer: exports.memoryLayerSchema.optional(),
    memoryCategory: exports.memoryCategorySchema.optional(),
    truthStatus: exports.memoryTruthStatusSchema.optional(),
    freshnessStatus: exports.memoryFreshnessStatusSchema.optional(),
    operationalStatus: exports.memoryOperationalStatusSchema.optional(),
    authorityClass: exports.memoryAuthorityClassSchema.optional(),
    lastVerifiedAt: zod_1.z.string().datetime().optional(),
    nextReviewAt: zod_1.z.string().datetime().optional(),
    freshnessExpiresAt: zod_1.z.string().datetime().optional(),
    sourceConfidence: zod_1.z.number().min(0).max(1).optional(),
    importance: zod_1.z.number().min(0).max(1).optional(),
    sourceClass: exports.memorySourceClassSchema.optional(),
    evidence: zod_1.z.array(zod_1.z.object({
        evidenceId: zod_1.z.string().trim().min(1).max(160).optional(),
        sourceClass: exports.memorySourceClassSchema.default("derived"),
        sourceUri: zod_1.z.string().trim().min(1).max(2048).optional(),
        sourcePath: zod_1.z.string().trim().min(1).max(2048).optional(),
        capturedAt: zod_1.z.string().datetime().optional(),
        verifiedAt: zod_1.z.string().datetime().optional(),
        verifier: zod_1.z.string().trim().min(1).max(160).optional(),
        redactionState: exports.memoryRedactionStateSchema.default("none"),
        hash: zod_1.z.string().trim().min(1).max(256).optional(),
        supportsMemoryIds: zod_1.z.array(zod_1.z.string().trim().min(1).max(128)).max(32).default([]),
        metadata: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).default({}),
    })).max(16).default([]),
});
exports.memorySearchRequestSchema = zod_1.z.object({
    query: zod_1.z.string().trim().min(1).max(4096),
    tenantId: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
    agentId: zod_1.z.string().trim().min(1).max(128).optional(),
    runId: zod_1.z.string().trim().min(1).max(128).optional(),
    sourceAllowlist: stringList.default([]),
    sourceDenylist: stringList.default([]),
    layerAllowlist: memoryLayerListSchema.default([]),
    layerDenylist: memoryLayerListSchema.default([]),
    retrievalMode: exports.retrievalModeSchema.default("hybrid"),
    useMode: exports.memoryUseModeSchema.default("operational"),
    queryLane: exports.memoryQueryLaneSchema.optional(),
    bulk: zod_1.z.boolean().optional(),
    minScore: zod_1.z.number().min(0).max(2).optional(),
    explain: zod_1.z.boolean().default(false),
    embedding: exports.embeddingSchema.optional(),
    fillToValidLimit: zod_1.z.boolean().default(false),
    minAuthorityClass: exports.memoryAuthorityClassSchema.optional(),
    excludeReviewActions: zod_1.z.array(exports.memoryReviewActionSchema).max(4).default([]),
    evidenceRequired: zod_1.z.boolean().default(false),
    allowContested: zod_1.z.boolean().optional(),
    maxStalenessHours: zod_1.z.number().int().min(0).max(24 * 365).optional(),
    limit: zod_1.z.number().int().min(1).max(exports.MAX_MEMORY_LIMIT).default(10),
});
exports.memoryRecentRequestSchema = zod_1.z.object({
    tenantId: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
    layerAllowlist: memoryLayerListSchema.default([]),
    layerDenylist: memoryLayerListSchema.default([]),
    useMode: exports.memoryUseModeSchema.default("operational"),
    limit: zod_1.z.number().int().min(1).max(200).default(20),
});
exports.memoryStatsRequestSchema = zod_1.z.object({
    tenantId: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
    layerAllowlist: memoryLayerListSchema.default([]),
    layerDenylist: memoryLayerListSchema.default([]),
});
exports.memoryContextRequestSchema = zod_1.z.object({
    tenantId: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
    agentId: zod_1.z.string().trim().min(1).max(128).optional(),
    runId: zod_1.z.string().trim().min(1).max(128).optional(),
    query: zod_1.z.string().trim().min(1).max(4096).optional(),
    seedMemoryId: zod_1.z.string().trim().min(1).max(128).optional(),
    sourceAllowlist: stringList.default([]),
    sourceDenylist: stringList.default([]),
    layerAllowlist: memoryLayerListSchema.default([]),
    layerDenylist: memoryLayerListSchema.default([]),
    retrievalMode: exports.retrievalModeSchema.default("hybrid"),
    useMode: exports.memoryUseModeSchema.default("operational"),
    queryLane: exports.memoryQueryLaneSchema.optional(),
    bulk: zod_1.z.boolean().optional(),
    temporalAnchorAt: zod_1.z.string().datetime().optional(),
    explain: zod_1.z.boolean().default(false),
    fillToValidLimit: zod_1.z.boolean().default(false),
    minAuthorityClass: exports.memoryAuthorityClassSchema.optional(),
    excludeReviewActions: zod_1.z.array(exports.memoryReviewActionSchema).max(4).default([]),
    evidenceRequired: zod_1.z.boolean().default(false),
    allowContested: zod_1.z.boolean().optional(),
    maxStalenessHours: zod_1.z.number().int().min(0).max(24 * 365).optional(),
    maxItems: zod_1.z.number().int().min(1).max(exports.MAX_MEMORY_LIMIT).default(12),
    maxChars: zod_1.z.number().int().min(256).max(100_000).default(8_000),
    scanLimit: zod_1.z.number().int().min(1).max(500).default(200),
    includeTenantFallback: zod_1.z.boolean().default(false),
    expandRelationships: zod_1.z.boolean().default(false),
    maxHops: zod_1.z.number().int().min(1).max(4).default(2),
});
exports.memoryReviewCaseListRequestSchema = zod_1.z.object({
    tenantId: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
    statuses: zod_1.z.array(exports.memoryReviewCaseStatusSchema).max(4).default([]),
    caseTypes: zod_1.z.array(exports.memoryReviewCaseTypeSchema).max(4).default([]),
    scopePrefixes: zod_1.z.array(zod_1.z.string().trim().min(1).max(240)).max(32).default([]),
    linkedMemoryIds: zod_1.z.array(zod_1.z.string().trim().min(1).max(128)).max(64).default([]),
    limit: zod_1.z.number().int().min(1).max(200).default(50),
});
exports.memoryReviewCaseActionRequestSchema = zod_1.z.object({
    tenantId: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
    action: exports.memoryReviewCaseActionSchema,
    actorId: zod_1.z.string().trim().min(1).max(160).optional(),
    selectedMemoryId: zod_1.z.string().trim().min(1).max(128).optional(),
    verifierKind: exports.memoryVerifierKindSchema.optional(),
    note: zod_1.z.string().trim().min(1).max(4_000).optional(),
    metadata: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).default({}),
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
