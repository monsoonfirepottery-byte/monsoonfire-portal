import { z } from "zod";

export const MAX_MEMORY_CONTENT_CHARS = 65_536;
export const MAX_MEMORY_LIMIT = 100;
export const MAX_MEMORY_IMPORT_ITEMS = 500;

const embeddingValue = z.number().finite();
const stringList = z.array(z.string().trim().min(1).max(128)).max(64);
const memoryLayerListSchema = z.array(z.enum(["core", "working", "episodic", "canonical"])).max(4);

export const embeddingSchema = z.array(embeddingValue).min(1).max(4096);
export const retrievalModeSchema = z.enum(["hybrid", "semantic", "lexical"]);
export const memoryQueryLaneSchema = z.enum(["interactive", "ops", "bulk"]);
export const memoryUseModeSchema = z.enum([
  "operational",
  "planning",
  "debugging",
  "safety-critical",
  "exploratory",
  "human-facing",
]);
export const memoryStatusSchema = z.enum(["proposed", "accepted", "quarantined", "archived"]);
export const memoryTypeSchema = z.enum(["working", "episodic", "semantic", "procedural"]);
export const memoryLayerSchema = z.enum(["core", "working", "episodic", "canonical"]);
export const memoryCategorySchema = z.enum([
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
export const memoryTruthStatusSchema = z.enum([
  "observed",
  "inferred",
  "proposed",
  "verified",
  "trusted",
  "contradicted",
]);
export const memoryFreshnessStatusSchema = z.enum(["fresh", "aging", "revalidation-required", "stale"]);
export const memoryOperationalStatusSchema = z.enum([
  "active",
  "cooling",
  "quarantined",
  "deprecated",
  "archived",
  "retired",
]);
export const memoryAuthorityClassSchema = z.enum(["a0-live", "a1-repo", "a2-policy", "a3-telemetry", "a4-derived", "a5-inferred"]);
export const memorySourceClassSchema = z.enum([
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
export const memoryRedactionStateSchema = z.enum([
  "none",
  "redacted",
  "verified-redacted",
  "requires-review",
  "quarantined",
]);
export const memoryReviewActionSchema = z.enum(["none", "revalidate", "resolve-conflict", "retire"]);
export const memoryConflictSeveritySchema = z.enum(["none", "soft", "hard"]);
export const memoryReviewCaseTypeSchema = z.enum([
  "resolve-conflict",
  "revalidate",
  "retire",
  "promote-guidance",
]);
export const memoryReviewCaseStatusSchema = z.enum(["open", "in-progress", "resolved", "dismissed"]);
export const memoryReviewCaseActionSchema = z.enum([
  "verify_now",
  "accept_winner",
  "keep_quarantined",
  "retire_memory",
  "dismiss_case",
  "promote_guidance",
  "reject_promotion",
]);
export const memoryVerifierKindSchema = z.enum([
  "repo-head",
  "runtime-check",
  "startup-instruction",
  "support-policy",
  "support-outcome",
  "operator-attested",
]);
export const memoryVerificationTriggerSchema = z.enum([
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
export const memoryVerificationResultStatusSchema = z.enum(["passed", "failed", "needs-review", "skipped"]);
export const memoryLoopStateSchema = z.enum(["open-loop", "resolved", "reopened", "superseded"]);
export const memoryLoopLaneSchema = z.enum(["critical", "high", "watch", "stable"]);
export const memoryLoopIncidentActionTypeSchema = z.enum([
  "ack",
  "assign",
  "snooze",
  "resolve",
  "false-positive",
  "escalate",
]);
export const memoryLoopActionPrioritySchema = z.enum(["p0", "p1", "p2", "p3"]);
export const memoryLoopSortSchema = z.enum([
  "attention",
  "updatedAt",
  "confidence",
  "volatility",
  "anomaly",
  "centrality",
  "escalation",
  "blastRadius",
]);

export const memoryCaptureRequestSchema = z.object({
  id: z.string().trim().min(1).max(128).optional(),
  content: z.string().trim().min(1).max(MAX_MEMORY_CONTENT_CHARS),
  source: z.string().trim().min(1).max(128).default("manual"),
  tags: z.array(z.string().trim().min(1).max(64)).max(32).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  tenantId: z.string().trim().min(1).max(128).nullable().optional(),
  agentId: z.string().trim().min(1).max(128).optional(),
  runId: z.string().trim().min(1).max(128).optional(),
  embedding: embeddingSchema.optional(),
  clientRequestId: z.string().trim().min(1).max(128).optional(),
  occurredAt: z.string().datetime().optional(),
  status: memoryStatusSchema.optional(),
  memoryType: memoryTypeSchema.optional(),
  memoryLayer: memoryLayerSchema.optional(),
  memoryCategory: memoryCategorySchema.optional(),
  truthStatus: memoryTruthStatusSchema.optional(),
  freshnessStatus: memoryFreshnessStatusSchema.optional(),
  operationalStatus: memoryOperationalStatusSchema.optional(),
  authorityClass: memoryAuthorityClassSchema.optional(),
  lastVerifiedAt: z.string().datetime().optional(),
  nextReviewAt: z.string().datetime().optional(),
  freshnessExpiresAt: z.string().datetime().optional(),
  sourceConfidence: z.number().min(0).max(1).optional(),
  importance: z.number().min(0).max(1).optional(),
  sourceClass: memorySourceClassSchema.optional(),
  evidence: z.array(
    z.object({
      evidenceId: z.string().trim().min(1).max(160).optional(),
      sourceClass: memorySourceClassSchema.default("derived"),
      sourceUri: z.string().trim().min(1).max(2048).optional(),
      sourcePath: z.string().trim().min(1).max(2048).optional(),
      capturedAt: z.string().datetime().optional(),
      verifiedAt: z.string().datetime().optional(),
      verifier: z.string().trim().min(1).max(160).optional(),
      redactionState: memoryRedactionStateSchema.default("none"),
      hash: z.string().trim().min(1).max(256).optional(),
      supportsMemoryIds: z.array(z.string().trim().min(1).max(128)).max(32).default([]),
      metadata: z.record(z.string(), z.unknown()).default({}),
    })
  ).max(16).default([]),
});

export const memorySearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(4096),
  tenantId: z.string().trim().min(1).max(128).nullable().optional(),
  agentId: z.string().trim().min(1).max(128).optional(),
  runId: z.string().trim().min(1).max(128).optional(),
  sourceAllowlist: stringList.default([]),
  sourceDenylist: stringList.default([]),
  layerAllowlist: memoryLayerListSchema.default([]),
  layerDenylist: memoryLayerListSchema.default([]),
  retrievalMode: retrievalModeSchema.default("hybrid"),
  useMode: memoryUseModeSchema.default("operational"),
  queryLane: memoryQueryLaneSchema.optional(),
  bulk: z.boolean().optional(),
  minScore: z.number().min(0).max(2).optional(),
  explain: z.boolean().default(false),
  embedding: embeddingSchema.optional(),
  fillToValidLimit: z.boolean().default(false),
  minAuthorityClass: memoryAuthorityClassSchema.optional(),
  excludeReviewActions: z.array(memoryReviewActionSchema).max(4).default([]),
  evidenceRequired: z.boolean().default(false),
  allowContested: z.boolean().optional(),
  maxStalenessHours: z.number().int().min(0).max(24 * 365).optional(),
  limit: z.number().int().min(1).max(MAX_MEMORY_LIMIT).default(10),
});

export const memoryRecentRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128).nullable().optional(),
  layerAllowlist: memoryLayerListSchema.default([]),
  layerDenylist: memoryLayerListSchema.default([]),
  useMode: memoryUseModeSchema.default("operational"),
  limit: z.number().int().min(1).max(200).default(20),
});

export const memoryStatsRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128).nullable().optional(),
  layerAllowlist: memoryLayerListSchema.default([]),
  layerDenylist: memoryLayerListSchema.default([]),
});

export const memoryContextRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128).nullable().optional(),
  agentId: z.string().trim().min(1).max(128).optional(),
  runId: z.string().trim().min(1).max(128).optional(),
  query: z.string().trim().min(1).max(4096).optional(),
  seedMemoryId: z.string().trim().min(1).max(128).optional(),
  sourceAllowlist: stringList.default([]),
  sourceDenylist: stringList.default([]),
  layerAllowlist: memoryLayerListSchema.default([]),
  layerDenylist: memoryLayerListSchema.default([]),
  retrievalMode: retrievalModeSchema.default("hybrid"),
  useMode: memoryUseModeSchema.default("operational"),
  queryLane: memoryQueryLaneSchema.optional(),
  bulk: z.boolean().optional(),
  temporalAnchorAt: z.string().datetime().optional(),
  explain: z.boolean().default(false),
  fillToValidLimit: z.boolean().default(false),
  minAuthorityClass: memoryAuthorityClassSchema.optional(),
  excludeReviewActions: z.array(memoryReviewActionSchema).max(4).default([]),
  evidenceRequired: z.boolean().default(false),
  allowContested: z.boolean().optional(),
  maxStalenessHours: z.number().int().min(0).max(24 * 365).optional(),
  maxItems: z.number().int().min(1).max(MAX_MEMORY_LIMIT).default(12),
  maxChars: z.number().int().min(256).max(100_000).default(8_000),
  scanLimit: z.number().int().min(1).max(500).default(200),
  includeTenantFallback: z.boolean().default(false),
  expandRelationships: z.boolean().default(false),
  maxHops: z.number().int().min(1).max(4).default(2),
});

export const memoryReviewCaseListRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128).nullable().optional(),
  statuses: z.array(memoryReviewCaseStatusSchema).max(4).default([]),
  caseTypes: z.array(memoryReviewCaseTypeSchema).max(4).default([]),
  scopePrefixes: z.array(z.string().trim().min(1).max(240)).max(32).default([]),
  linkedMemoryIds: z.array(z.string().trim().min(1).max(128)).max(64).default([]),
  limit: z.number().int().min(1).max(200).default(50),
});

export const memoryReviewCaseActionRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128).nullable().optional(),
  action: memoryReviewCaseActionSchema,
  actorId: z.string().trim().min(1).max(160).optional(),
  selectedMemoryId: z.string().trim().min(1).max(128).optional(),
  verifierKind: memoryVerifierKindSchema.optional(),
  note: z.string().trim().min(1).max(4_000).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const memoryImportRequestSchema = z.object({
  sourceOverride: z.string().trim().min(1).max(128).optional(),
  continueOnError: z.boolean().default(true),
  disableRunWriteBurstLimit: z.boolean().default(false),
  generateBriefing: z.boolean().default(false),
  briefingQuery: z.string().trim().min(1).max(4096).optional(),
  briefingLimit: z.number().int().min(1).max(50).default(12),
  briefingStates: z.array(memoryLoopStateSchema).max(4).default([]),
  briefingLanes: z.array(memoryLoopLaneSchema).max(4).default([]),
  briefingIncidentMinEscalation: z.number().min(0).max(2).optional(),
  briefingIncidentMinBlastRadius: z.number().min(0).max(1).optional(),
  items: z.array(memoryCaptureRequestSchema).min(1).max(MAX_MEMORY_IMPORT_ITEMS),
});

export const memoryEmailThreadBackfillRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128).nullable().optional(),
  limit: z.number().int().min(1).max(20_000).default(2_000),
  dryRun: z.boolean().default(false),
  sourcePrefixes: z.array(z.string().trim().min(1).max(64)).max(12).default(["mail:", "email"]),
  includeNonMailLikeWithMessageSignals: z.boolean().default(false),
  maxWrites: z.number().int().min(1).max(20_000).default(500),
  writeDelayMs: z.number().int().min(0).max(60_000).default(20),
  stopAfterTimeoutErrors: z.number().int().min(1).max(100).default(5),
});

export const memorySignalIndexBackfillRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128).nullable().optional(),
  limit: z.number().int().min(1).max(20_000).default(2_000),
  dryRun: z.boolean().default(false),
  sourcePrefixes: z.array(z.string().trim().min(1).max(64)).max(12).default(["mail:", "email"]),
  includeNonMailLike: z.boolean().default(false),
  minSignals: z.number().int().min(1).max(512).default(1),
  skipAlreadyIndexed: z.boolean().default(true),
  includeLoopStateUpdates: z.boolean().default(true),
  inferRelationships: z.boolean().default(true),
  relationshipProbeLimit: z.number().int().min(2).max(128).default(24),
  maxInferredEdgesPerMemory: z.number().int().min(0).max(128).default(16),
  minRelatedSignalScore: z.number().min(0).max(2).default(0.12),
  maxWrites: z.number().int().min(1).max(20_000).default(500),
  writeDelayMs: z.number().int().min(0).max(60_000).default(20),
  stopAfterTimeoutErrors: z.number().int().min(1).max(100).default(5),
});

export const memoryThreadMetadataScrubRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128).nullable().optional(),
  limit: z.number().int().min(1).max(20_000).default(2_000),
  dryRun: z.boolean().default(false),
  sourcePrefixes: z.array(z.string().trim().min(1).max(64)).max(24).default([]),
  includeMailLike: z.boolean().default(false),
  maxWrites: z.number().int().min(1).max(20_000).default(500),
  writeDelayMs: z.number().int().min(0).max(60_000).default(20),
  stopAfterTimeoutErrors: z.number().int().min(1).max(100).default(5),
});

export const memoryLoopsRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128).nullable().optional(),
  loopKeys: stringList.default([]),
  states: z.array(memoryLoopStateSchema).max(4).default([]),
  lanes: z.array(memoryLoopLaneSchema).max(4).default([]),
  query: z.string().trim().min(1).max(4096).optional(),
  includeMemory: z.boolean().default(true),
  includeIncidents: z.boolean().default(true),
  sortBy: memoryLoopSortSchema.default("attention"),
  minAttention: z.number().min(0).max(2).optional(),
  minVolatility: z.number().min(0).max(1).optional(),
  minAnomaly: z.number().min(0).max(1).optional(),
  minCentrality: z.number().min(0).max(1).optional(),
  minEscalation: z.number().min(0).max(2).optional(),
  minBlastRadius: z.number().min(0).max(1).optional(),
  incidentLimit: z.number().int().min(1).max(50).default(12),
  incidentMinEscalation: z.number().min(0).max(2).optional(),
  incidentMinBlastRadius: z.number().min(0).max(1).optional(),
  limit: z.number().int().min(1).max(200).default(30),
});

export const memoryLoopIncidentActionRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128).nullable().optional(),
  loopKey: z.string().trim().min(1).max(180),
  incidentId: z.string().trim().min(1).max(160).optional(),
  memoryId: z.string().trim().min(1).max(128).optional(),
  idempotencyKey: z.string().trim().min(1).max(180).optional(),
  action: memoryLoopIncidentActionTypeSchema,
  actorId: z.string().trim().min(1).max(160).optional(),
  note: z.string().trim().min(1).max(4_000).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  occurredAt: z.string().datetime().optional(),
});

export const memoryLoopIncidentActionBatchRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128).nullable().optional(),
  actorId: z.string().trim().min(1).max(160).optional(),
  idempotencyPrefix: z.string().trim().min(1).max(120).optional(),
  continueOnError: z.boolean().default(true),
  actions: z
    .array(
      z.object({
        tenantId: z.string().trim().min(1).max(128).nullable().optional(),
        loopKey: z.string().trim().min(1).max(180),
        incidentId: z.string().trim().min(1).max(160).optional(),
        memoryId: z.string().trim().min(1).max(128).optional(),
        idempotencyKey: z.string().trim().min(1).max(180).optional(),
        action: memoryLoopIncidentActionTypeSchema,
        actorId: z.string().trim().min(1).max(160).optional(),
        note: z.string().trim().min(1).max(4_000).optional(),
        metadata: z.record(z.string(), z.unknown()).default({}),
        occurredAt: z.string().datetime().optional(),
      })
    )
    .min(1)
    .max(200),
});

export const memoryLoopFeedbackStatsRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128).nullable().optional(),
  loopKeys: stringList.default([]),
  windowDays: z.number().int().min(1).max(3650).default(180),
  limit: z.number().int().min(1).max(500).default(120),
});

export const memoryLoopOwnerQueuesRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128).nullable().optional(),
  query: z.string().trim().min(1).max(4096).optional(),
  states: z.array(memoryLoopStateSchema).max(4).default([]),
  lanes: z.array(memoryLoopLaneSchema).max(4).default([]),
  loopKeys: stringList.default([]),
  limit: z.number().int().min(1).max(200).default(50),
  incidentLimit: z.number().int().min(1).max(50).default(20),
  incidentMinEscalation: z.number().min(0).max(2).optional(),
  incidentMinBlastRadius: z.number().min(0).max(1).optional(),
});

export const memoryLoopActionPlanRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128).nullable().optional(),
  query: z.string().trim().min(1).max(4096).optional(),
  states: z.array(memoryLoopStateSchema).max(4).default([]),
  lanes: z.array(memoryLoopLaneSchema).max(4).default([]),
  loopKeys: stringList.default([]),
  limit: z.number().int().min(1).max(200).default(50),
  incidentLimit: z.number().int().min(1).max(80).default(30),
  incidentMinEscalation: z.number().min(0).max(2).optional(),
  incidentMinBlastRadius: z.number().min(0).max(1).optional(),
  maxActions: z.number().int().min(1).max(200).default(40),
  includeBatchPayload: z.boolean().default(true),
});

export const memoryLoopAutomationTickRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128).nullable().optional(),
  query: z.string().trim().min(1).max(4096).optional(),
  states: z.array(memoryLoopStateSchema).max(4).default([]),
  lanes: z.array(memoryLoopLaneSchema).max(4).default([]),
  loopKeys: stringList.default([]),
  limit: z.number().int().min(1).max(200).default(50),
  incidentLimit: z.number().int().min(1).max(80).default(30),
  incidentMinEscalation: z.number().min(0).max(2).optional(),
  incidentMinBlastRadius: z.number().min(0).max(1).optional(),
  maxActions: z.number().int().min(1).max(200).default(40),
  applyActions: z.boolean().default(false),
  applyPriorities: z.array(memoryLoopActionPrioritySchema).max(4).default(["p0", "p1"]),
  allowedActions: z.array(memoryLoopIncidentActionTypeSchema).max(6).default(["escalate", "assign", "ack"]),
  actorId: z.string().trim().min(1).max(160).optional(),
  idempotencyKey: z.string().trim().min(1).max(180).optional(),
  includeBatchPayload: z.boolean().default(true),
});

export type MemoryCaptureRequest = z.infer<typeof memoryCaptureRequestSchema>;
export type MemorySearchRequest = z.infer<typeof memorySearchRequestSchema>;
export type MemoryRecentRequest = z.infer<typeof memoryRecentRequestSchema>;
export type MemoryStatsRequest = z.infer<typeof memoryStatsRequestSchema>;
export type MemoryContextRequest = z.infer<typeof memoryContextRequestSchema>;
export type MemoryReviewCaseListRequest = z.infer<typeof memoryReviewCaseListRequestSchema>;
export type MemoryReviewCaseActionRequest = z.infer<typeof memoryReviewCaseActionRequestSchema>;
export type MemoryImportRequest = z.infer<typeof memoryImportRequestSchema>;
export type MemoryEmailThreadBackfillRequest = z.infer<typeof memoryEmailThreadBackfillRequestSchema>;
export type MemorySignalIndexBackfillRequest = z.infer<typeof memorySignalIndexBackfillRequestSchema>;
export type MemoryThreadMetadataScrubRequest = z.infer<typeof memoryThreadMetadataScrubRequestSchema>;
export type MemoryLoopsRequest = z.infer<typeof memoryLoopsRequestSchema>;
export type MemoryLoopIncidentActionRequest = z.infer<typeof memoryLoopIncidentActionRequestSchema>;
export type MemoryLoopIncidentActionBatchRequest = z.infer<typeof memoryLoopIncidentActionBatchRequestSchema>;
export type MemoryLoopFeedbackStatsRequest = z.infer<typeof memoryLoopFeedbackStatsRequestSchema>;
export type MemoryLoopOwnerQueuesRequest = z.infer<typeof memoryLoopOwnerQueuesRequestSchema>;
export type MemoryLoopActionPlanRequest = z.infer<typeof memoryLoopActionPlanRequestSchema>;
export type MemoryLoopAutomationTickRequest = z.infer<typeof memoryLoopAutomationTickRequestSchema>;
export type RetrievalMode = z.infer<typeof retrievalModeSchema>;
export type MemoryQueryLane = z.infer<typeof memoryQueryLaneSchema>;
export type MemoryUseMode = z.infer<typeof memoryUseModeSchema>;
export type MemoryStatus = z.infer<typeof memoryStatusSchema>;
export type MemoryType = z.infer<typeof memoryTypeSchema>;
export type MemoryLayer = z.infer<typeof memoryLayerSchema>;
export type MemoryCategory = z.infer<typeof memoryCategorySchema>;
export type MemoryTruthStatus = z.infer<typeof memoryTruthStatusSchema>;
export type MemoryFreshnessStatus = z.infer<typeof memoryFreshnessStatusSchema>;
export type MemoryOperationalStatus = z.infer<typeof memoryOperationalStatusSchema>;
export type MemoryAuthorityClass = z.infer<typeof memoryAuthorityClassSchema>;
export type MemorySourceClass = z.infer<typeof memorySourceClassSchema>;
export type MemoryRedactionState = z.infer<typeof memoryRedactionStateSchema>;
export type MemoryReviewAction = z.infer<typeof memoryReviewActionSchema>;
export type MemoryConflictSeverity = z.infer<typeof memoryConflictSeveritySchema>;
export type MemoryReviewCaseType = z.infer<typeof memoryReviewCaseTypeSchema>;
export type MemoryReviewCaseStatus = z.infer<typeof memoryReviewCaseStatusSchema>;
export type MemoryReviewCaseAction = z.infer<typeof memoryReviewCaseActionSchema>;
export type MemoryVerifierKind = z.infer<typeof memoryVerifierKindSchema>;
export type MemoryVerificationTrigger = z.infer<typeof memoryVerificationTriggerSchema>;
export type MemoryVerificationResultStatus = z.infer<typeof memoryVerificationResultStatusSchema>;
export type MemoryLoopState = z.infer<typeof memoryLoopStateSchema>;
export type MemoryLoopLane = z.infer<typeof memoryLoopLaneSchema>;
export type MemoryLoopIncidentActionType = z.infer<typeof memoryLoopIncidentActionTypeSchema>;
export type MemoryLoopActionPriority = z.infer<typeof memoryLoopActionPrioritySchema>;

export type MemoryEvidence = {
  evidenceId: string;
  sourceClass: MemorySourceClass;
  sourceUri: string | null;
  sourcePath: string | null;
  capturedAt: string;
  verifiedAt: string | null;
  verifier: string | null;
  redactionState: MemoryRedactionState;
  hash: string | null;
  supportsMemoryIds: string[];
  metadata: Record<string, unknown>;
};

export type MemoryTransitionEvent = {
  transitionId: string;
  memoryId: string;
  actor: string | null;
  reason: string | null;
  at: string;
  fromStatus: MemoryStatus | null;
  toStatus: MemoryStatus;
  fromTruthStatus: MemoryTruthStatus | null;
  toTruthStatus: MemoryTruthStatus;
  fromFreshnessStatus: MemoryFreshnessStatus | null;
  toFreshnessStatus: MemoryFreshnessStatus;
  fromOperationalStatus: MemoryOperationalStatus | null;
  toOperationalStatus: MemoryOperationalStatus;
  evidenceIds: string[];
  metadata: Record<string, unknown>;
};

export type MemoryReviewCase = {
  id: string;
  tenantId: string | null;
  caseType: MemoryReviewCaseType;
  status: MemoryReviewCaseStatus;
  scope: string | null;
  primaryMemoryId: string | null;
  linkedMemoryIds: string[];
  priority: number;
  reasonCodes: string[];
  recommendedActions: MemoryReviewCaseAction[];
  owner: string | null;
  resolution: string | null;
  lastVerificationRunId: string | null;
  openedAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  metadata: Record<string, unknown>;
};

export type MemoryVerificationRun = {
  id: string;
  tenantId: string | null;
  caseId: string | null;
  targetMemoryId: string | null;
  verifierKind: MemoryVerifierKind;
  trigger: MemoryVerificationTrigger;
  requestSnapshot: Record<string, unknown>;
  resultStatus: MemoryVerificationResultStatus;
  resultSummary: string | null;
  evidenceIds: string[];
  startedAt: string;
  finishedAt: string | null;
  metadata: Record<string, unknown>;
};

export type MemoryLatticeSnapshot = {
  category: MemoryCategory;
  truthStatus: MemoryTruthStatus;
  freshnessStatus: MemoryFreshnessStatus;
  operationalStatus: MemoryOperationalStatus;
  authorityClass: MemoryAuthorityClass;
  sourceClass: MemorySourceClass | null;
  lastVerifiedAt: string | null;
  nextReviewAt: string | null;
  freshnessExpiresAt: string | null;
  folkloreRisk: number;
  contradictionCount: number;
  conflictSeverity: MemoryConflictSeverity;
  conflictKinds: string[];
  conflictingMemoryIds: string[];
  evidenceStrength: number;
  hasEvidence: boolean;
  scope: string | null;
  redactionState: MemoryRedactionState | null;
  secretExposure: boolean;
  shadowMcpRisk: boolean;
  reviewAction: MemoryReviewAction;
  reviewPriority: number;
  reviewReasons: string[];
  badges: string[];
};

export type MemoryRecord = {
  id: string;
  tenantId: string | null;
  agentId: string;
  runId: string;
  content: string;
  source: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  occurredAt: string | null;
  status: MemoryStatus;
  memoryType: MemoryType;
  memoryLayer: MemoryLayer;
  sourceConfidence: number;
  importance: number;
  evidence?: MemoryEvidence[];
  transitions?: MemoryTransitionEvent[];
  lattice?: MemoryLatticeSnapshot;
};

export type MemoryScoreBreakdown = {
  rrf: number;
  sourceTrust: number;
  recency: number;
  importance: number;
  session: number;
  signal?: number;
  graph?: number;
  entity?: number;
  pattern?: number;
  semantic?: number;
  lexical?: number;
  sessionLane?: number;
};

export type MemorySearchResult = MemoryRecord & {
  score: number;
  scoreBreakdown: MemoryScoreBreakdown;
  matchedBy: string[];
};

export type MemoryStats = {
  total: number;
  lastCapturedAt: string | null;
  bySource: Array<{ source: string; count: number }>;
  byLayer: Array<{ layer: MemoryLayer; count: number }>;
  byStatus?: Array<{ status: MemoryStatus; count: number }>;
  lattice?: {
    coverage: {
      rowsWithLattice: number;
      totalRows: number;
      ratio: number;
    };
    byCategory: Array<{ category: MemoryCategory; count: number }>;
    byTruthStatus: Array<{ status: MemoryTruthStatus; count: number }>;
    byFreshnessStatus: Array<{ status: MemoryFreshnessStatus; count: number }>;
    byOperationalStatus: Array<{ status: MemoryOperationalStatus; count: number }>;
    byReviewAction: Array<{ action: MemoryReviewAction; count: number }>;
    backlog: {
      reviewNow: number;
      revalidate: number;
      resolveConflict: number;
      retire: number;
      folkloreRiskHigh: number;
    };
  };
  reviewBacklog?: {
    reviewNow: number;
    revalidate: number;
    resolveConflict: number;
    retire: number;
    folkloreRiskHigh: number;
  };
  openReviewCases?: number;
  verificationFailures24h?: number;
  emberPromotionBacklog?: number;
  conflictBacklog?: {
    contestedRows: number;
    hardConflicts: number;
    quarantinedRows: number;
    conflictRecords: number;
    retrievalShadowedRows?: number;
  };
  startupReadiness?: {
    startupEligibleRows: number;
    trustedStartupRows: number;
    handoffRows: number;
    checkpointRows: number;
    fallbackRiskRows: number;
  };
  secretExposureFindings?: {
    totalRows: number;
    redactedRows: number;
    requiresReviewRows: number;
    canonicalBlockedRows: number;
    quarantinedRows: number;
  };
  shadowMcpFindings?: {
    totalRows: number;
    governedRows: number;
    ungovernedRows: number;
    reviewRows: number;
    highRiskRows: number;
  };
  continuity?: {
    state: "ready" | "continuity_degraded" | "missing" | "unknown";
    fallbackSources: Array<{ source: string; count: number }>;
    continuityHitRate: number;
    degradedStartupRate: number;
  };
  consolidation?: {
    status: "idle" | "running" | "success" | "failed" | "stale" | "unavailable";
    mode: string | null;
    lastRunAt: string | null;
    nextRunAt: string | null;
    successCount: number;
    failureCount: number;
    promotionCount: number;
    quarantineCount: number;
    archiveCount: number;
    repairedEdgeCount: number;
    staleWarning: boolean;
    lastError: string | null;
    influence: string[];
  };
};

export type MemoryImportResult = {
  total: number;
  imported: number;
  failed: number;
  results: Array<{ index: number; id?: string; ok: boolean; error?: string }>;
  briefing?: MemoryImportBriefing | null;
};

export type MemoryBackfillConvergenceTelemetry = {
  windowScanned: number;
  windowEligible: number;
  windowUpdated: number;
  windowRemainingEligible: number;
  windowRemainingRatio: number;
  writeUtilization: number;
  timeoutRate: number;
  exhaustedWithinWindow: boolean;
  indexedSkipRatio?: number;
};

export type MemoryEmailThreadBackfillResult = {
  tenantId: string | null;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  scanned: number;
  eligible: number;
  updated: number;
  skipped: number;
  failed: number;
  writesAttempted?: number;
  maxWrites?: number;
  stoppedEarly?: boolean;
  stopReason?: string | null;
  timeoutErrors?: number;
  convergence?: MemoryBackfillConvergenceTelemetry;
  sample: Array<{
    id: string;
    source: string;
    reason: string;
    beforeNormalizedMessageId: string | null;
    afterNormalizedMessageId: string | null;
    beforeThreadSignature: string | null;
    afterThreadSignature: string | null;
  }>;
  errors: Array<{ id: string; message: string }>;
};

export type MemorySignalIndexBackfillResult = {
  tenantId: string | null;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  scanned: number;
  eligible: number;
  updated: number;
  skipped: number;
  failed: number;
  writesAttempted?: number;
  maxWrites?: number;
  stoppedEarly?: boolean;
  stopReason?: string | null;
  timeoutErrors?: number;
  alreadyIndexedSkipped?: number;
  loopStateUpdates?: number;
  relationshipInference?: {
    enabled: boolean;
    probes: number;
    memoriesConsidered: number;
    memoriesAugmented: number;
    inferredEdgesAdded: number;
    messageReferenceEdgesAdded: number;
    stateInferenceEdgesAdded: number;
    contextOverlapEdgesAdded: number;
    skippedDueToBudget: number;
  };
  convergence?: MemoryBackfillConvergenceTelemetry;
  sample: Array<{
    id: string;
    source: string;
    reason: string;
    edgeCount: number;
    entityCount: number;
    patternCount: number;
    signalCount: number;
    loopKeys: string[];
  }>;
  errors: Array<{ id: string; message: string }>;
};

export type MemoryThreadMetadataScrubResult = {
  tenantId: string | null;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  scanned: number;
  eligible: number;
  updated: number;
  skipped: number;
  failed: number;
  writesAttempted?: number;
  maxWrites?: number;
  stoppedEarly?: boolean;
  stopReason?: string | null;
  timeoutErrors?: number;
  convergence?: MemoryBackfillConvergenceTelemetry;
  sample: Array<{
    id: string;
    source: string;
    reason: string;
    beforeThreadKey: string | null;
    afterThreadKey: string | null;
    beforeLoopClusterKey: string | null;
    afterLoopClusterKey: string | null;
    beforeThreadEvidence: "explicit" | "derived" | "none";
    afterThreadEvidence: "explicit" | "derived" | "none";
  }>;
  errors: Array<{ id: string; message: string }>;
};

export type MemoryImportBriefing = {
  generatedAt: string;
  query: string | null;
  importedCount: number;
  sourceFamilies: string[];
  topTopics: Array<{ key: string; count: number }>;
  topOwners: Array<{
    owner: string;
    total: number;
    critical: number;
    atRisk: number;
    breached: number;
  }>;
  incidents: MemoryLoopsResult["incidents"];
  summary: MemoryLoopsResult["summary"];
  actionPlan: MemoryLoopActionPlanResult;
};

export type MemoryContextResult = {
  summary: string;
  items: MemorySearchResult[];
  budget: {
    maxItems: number;
    maxChars: number;
    usedChars: number;
    scanLimit: number;
    scanned: number;
    droppedByBudget: number;
  };
  selection: {
    tenantId: string | null;
    requestedTenantId: string | null;
    tenantFallbackApplied: boolean;
    agentId: string | null;
    runId: string | null;
    query: string | null;
    seedMemoryId: string | null;
    retrievalMode: RetrievalMode;
    sourceAllowlist: string[];
    sourceDenylist: string[];
    layerAllowlist: MemoryLayer[];
    layerDenylist: MemoryLayer[];
    temporalAnchorAt: string | null;
    includeExplain: boolean;
    expandRelationships: boolean;
    requestedMaxHops: number;
    tenantFallbackUsedForEmptyScope: boolean;
    relationshipExpansion: {
      hopsUsed: number;
      addedFromRelationships: number;
      attempted: boolean;
      frontierSeedCount: number;
    };
  };
  diagnostics: {
    candidateCounts: {
      tenantRows: number;
      scopedRows: number;
      searchRows: number;
      mergedRows: number;
      byLayer: Array<{ layer: MemoryLayer; count: number }>;
      selectedByLayer: Array<{ layer: MemoryLayer; count: number }>;
      fallbackByLayer: Array<{ layer: MemoryLayer; count: number }>;
    };
    retrievalModeUsed: RetrievalMode;
    includeTenantFallback: boolean;
    consolidationInfluence?: {
      status: "idle" | "running" | "success" | "failed" | "stale" | "unavailable";
      mode: string | null;
      lastRunAt: string | null;
      nextRunAt: string | null;
      focusAreas: string[];
    };
    tenantRowsTimedOut?: boolean;
    degradedComputeMode?: boolean;
    queryDegradation?: {
      applied: boolean;
      lane: MemoryQueryLane;
      shed: boolean;
      reasons: string[];
      retryAfterSeconds: number;
      requested: {
        retrievalMode: RetrievalMode;
        maxItems?: number;
        scanLimit?: number;
        maxChars?: number;
        limit?: number;
      };
      effective: {
        retrievalMode: RetrievalMode | string;
        maxItems?: number;
        scanLimit?: number;
        maxChars?: number;
        limit?: number;
      };
      pressure?: Record<string, unknown>;
    };
    blockedByHardConflict?: {
      blocked: boolean;
      useMode: MemoryUseMode;
      scope: string | null;
      conflictRecordId: string | null;
      reviewCaseId?: string | null;
      reasonCodes?: string[];
      recommendedActions?: MemoryReviewCaseAction[];
      conflictingMemoryIds: string[];
    };
  };
};

export type MemoryLoopsResult = {
  rows: Array<{
    loopKey: string;
    currentState: MemoryLoopState;
    confidence: number;
    attentionScore: number;
    attentionLane: MemoryLoopLane;
    attentionReasons: string[];
    volatilityScore: number;
    stagnationDays: number;
    anomalyScore: number;
    anomalyReasons: string[];
    centralityScore: number;
    feedbackScore: number;
    lastFeedbackAt: string | null;
    feedbackCounts: {
      ackCount: number;
      assignCount: number;
      snoozeCount: number;
      resolveCount: number;
      falsePositiveCount: number;
      escalateCount: number;
    };
    escalationScore: number;
    blastRadiusScore: number;
    recommendedAction: string;
    updatedAt: string;
    lastTransitionAt: string | null;
    recentTransitions7d: number;
    recentReopened7d: number;
    recentResolved7d: number;
    pointerMemoryId: string | null;
    pointerMemory: MemorySearchResult | null;
    stats: {
      openEvents: number;
      resolvedEvents: number;
      reopenedEvents: number;
      supersededEvents: number;
    };
  }>;
  incidents: Array<{
    id: string;
    loopKey: string;
    lane: MemoryLoopLane;
    escalationScore: number;
    blastRadiusScore: number;
    anomalyScore: number;
    confidence: number;
    currentState: MemoryLoopState;
    suggestedOwner: string | null;
    affectedActors: string[];
    affectedThreads: string[];
    timelineMemoryIds: string[];
    pointerMemoryId: string | null;
    recommendedAction: string;
    slaTargetHours: number;
    hoursSinceUpdate: number;
    hoursUntilBreach: number;
    slaStatus: "healthy" | "at-risk" | "breached";
    narrative: string;
    updatedAt: string;
  }>;
  actionResult?: MemoryLoopIncidentActionResult;
  summary: {
    total: number;
    incidentCount: number;
    byState: Array<{ state: MemoryLoopState; count: number }>;
    byLane: Array<{ lane: MemoryLoopLane; count: number }>;
    highestAttentionScore: number;
    highestVolatilityScore: number;
    highestAnomalyScore: number;
    highestCentralityScore: number;
    highestFeedbackScore: number;
    highestEscalationScore: number;
    highestBlastRadiusScore: number;
    feedbackCoverage: number;
    ownerQueues: Array<{
      owner: string;
      total: number;
      critical: number;
      high: number;
      atRisk: number;
      breached: number;
      topIncidentId: string | null;
      avgEscalationScore: number;
    }>;
    sla: {
      healthy: number;
      atRisk: number;
      breached: number;
      soonestBreachHours: number | null;
    };
    hotspots: {
      threads: Array<{ key: string; count: number }>;
      actors: Array<{ key: string; count: number }>;
    };
    calibration: {
      sampleSize: number;
      openPressure: number;
      criticalMinAttention: number;
      highMinAttention: number;
      watchMinAttention: number;
      highVolatility: number;
      criticalVolatility: number;
      highAnomaly: number;
      criticalAnomaly: number;
      highEscalation: number;
      criticalEscalation: number;
      highBlastRadius: number;
      criticalBlastRadius: number;
    };
  };
};

export type MemoryLoopIncidentActionResult = {
  ok: true;
  tenantId: string | null;
  loopKey: string;
  incidentId: string | null;
  memoryId: string | null;
  action: MemoryLoopIncidentActionType;
  actorId: string | null;
  note: string | null;
  recordedAt: string;
  stateUpdate: {
    applied: boolean;
    state: MemoryLoopState | null;
    confidence: number | null;
  };
  idempotency: {
    key: string | null;
    replayed: boolean;
  };
  feedback: {
    feedbackScore: number;
    lastFeedbackAt: string | null;
    counts: {
      ackCount: number;
      assignCount: number;
      snoozeCount: number;
      resolveCount: number;
      falsePositiveCount: number;
      escalateCount: number;
    };
  } | null;
};

export type MemoryLoopIncidentActionBatchResult = {
  total: number;
  processed: number;
  failed: number;
  results: Array<{ index: number; ok: boolean; result?: MemoryLoopIncidentActionResult; error?: string }>;
};

export type MemoryLoopFeedbackStatsReport = {
  rows: Array<{
    loopKey: string;
    feedbackScore: number;
    ackCount: number;
    assignCount: number;
    snoozeCount: number;
    resolveCount: number;
    falsePositiveCount: number;
    escalateCount: number;
    totalCount: number;
    lastActionAt: string | null;
  }>;
  summary: {
    totalLoops: number;
    highConfidenceLoops: number;
    falsePositiveHeavyLoops: number;
    coveredLoops: number;
    windowDays: number;
  };
};

export type MemoryLoopOwnerQueuesResult = {
  generatedAt: string;
  query: string | null;
  queues: Array<{
    owner: string;
    total: number;
    critical: number;
    high: number;
    atRisk: number;
    breached: number;
    topIncidentId: string | null;
    avgEscalationScore: number;
    incidentIds: string[];
  }>;
  sla: {
    healthy: number;
    atRisk: number;
    breached: number;
    soonestBreachHours: number | null;
  };
  incidents: MemoryLoopsResult["incidents"];
  summary: MemoryLoopsResult["summary"];
};

export type MemoryLoopActionPlanResult = {
  generatedAt: string;
  query: string | null;
  actions: Array<{
    priority: MemoryLoopActionPriority;
    confidence: number;
    reason: string;
    idempotencyKeySuggestion: string;
    incidentId: string;
    loopKey: string;
    currentState: MemoryLoopState;
    lane: MemoryLoopLane;
    action: MemoryLoopIncidentActionType;
    suggestedOwner: string | null;
    hoursUntilBreach: number;
    slaStatus: "healthy" | "at-risk" | "breached";
    escalationScore: number;
    blastRadiusScore: number;
    anomalyScore: number;
  }>;
  summary: {
    totalIncidentsConsidered: number;
    totalPlannedActions: number;
    byAction: Array<{ action: MemoryLoopIncidentActionType; count: number }>;
    byPriority: Array<{ priority: MemoryLoopActionPriority; count: number }>;
  };
  batchPayload: {
    continueOnError: true;
    actions: Array<{
      loopKey: string;
      incidentId: string;
      action: MemoryLoopIncidentActionType;
      actorId?: string;
      note: string;
      idempotencyKey: string;
    }>;
  } | null;
  ownerQueues: MemoryLoopOwnerQueuesResult["queues"];
  sla: MemoryLoopOwnerQueuesResult["sla"];
};

export type MemoryLoopAutomationTickResult = {
  generatedAt: string;
  idempotency: {
    key: string | null;
    replayed: boolean;
  };
  plan: MemoryLoopActionPlanResult;
  applied: {
    requested: boolean;
    selectedActions: number;
    result: MemoryLoopIncidentActionBatchResult | null;
  };
};
