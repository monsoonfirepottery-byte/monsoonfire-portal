import { z } from "zod";

export const MAX_MEMORY_CONTENT_CHARS = 65_536;
export const MAX_MEMORY_LIMIT = 100;
export const MAX_MEMORY_IMPORT_ITEMS = 500;

const embeddingValue = z.number().finite();
const stringList = z.array(z.string().trim().min(1).max(128)).max(64);

export const embeddingSchema = z.array(embeddingValue).min(1).max(4096);
export const retrievalModeSchema = z.enum(["hybrid", "semantic", "lexical"]);
export const memoryQueryLaneSchema = z.enum(["interactive", "ops", "bulk"]);
export const memoryStatusSchema = z.enum(["proposed", "accepted", "quarantined", "archived"]);
export const memoryTypeSchema = z.enum(["working", "episodic", "semantic", "procedural"]);
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
  sourceConfidence: z.number().min(0).max(1).optional(),
  importance: z.number().min(0).max(1).optional(),
});

export const memorySearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(4096),
  tenantId: z.string().trim().min(1).max(128).nullable().optional(),
  agentId: z.string().trim().min(1).max(128).optional(),
  runId: z.string().trim().min(1).max(128).optional(),
  sourceAllowlist: stringList.default([]),
  sourceDenylist: stringList.default([]),
  retrievalMode: retrievalModeSchema.default("hybrid"),
  queryLane: memoryQueryLaneSchema.optional(),
  bulk: z.boolean().optional(),
  minScore: z.number().min(0).max(2).optional(),
  explain: z.boolean().default(false),
  embedding: embeddingSchema.optional(),
  limit: z.number().int().min(1).max(MAX_MEMORY_LIMIT).default(10),
});

export const memoryRecentRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128).nullable().optional(),
  limit: z.number().int().min(1).max(200).default(20),
});

export const memoryStatsRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128).nullable().optional(),
});

export const memoryContextRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128).nullable().optional(),
  agentId: z.string().trim().min(1).max(128).optional(),
  runId: z.string().trim().min(1).max(128).optional(),
  query: z.string().trim().min(1).max(4096).optional(),
  seedMemoryId: z.string().trim().min(1).max(128).optional(),
  sourceAllowlist: stringList.default([]),
  sourceDenylist: stringList.default([]),
  retrievalMode: retrievalModeSchema.default("hybrid"),
  queryLane: memoryQueryLaneSchema.optional(),
  bulk: z.boolean().optional(),
  temporalAnchorAt: z.string().datetime().optional(),
  explain: z.boolean().default(false),
  maxItems: z.number().int().min(1).max(MAX_MEMORY_LIMIT).default(12),
  maxChars: z.number().int().min(256).max(100_000).default(8_000),
  scanLimit: z.number().int().min(1).max(500).default(200),
  includeTenantFallback: z.boolean().default(false),
  expandRelationships: z.boolean().default(false),
  maxHops: z.number().int().min(1).max(4).default(2),
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
export type MemoryStatus = z.infer<typeof memoryStatusSchema>;
export type MemoryType = z.infer<typeof memoryTypeSchema>;
export type MemoryLoopState = z.infer<typeof memoryLoopStateSchema>;
export type MemoryLoopLane = z.infer<typeof memoryLoopLaneSchema>;
export type MemoryLoopIncidentActionType = z.infer<typeof memoryLoopIncidentActionTypeSchema>;
export type MemoryLoopActionPriority = z.infer<typeof memoryLoopActionPrioritySchema>;

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
  sourceConfidence: number;
  importance: number;
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
    };
    retrievalModeUsed: RetrievalMode;
    includeTenantFallback: boolean;
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
