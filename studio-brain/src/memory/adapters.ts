import type {
  MemoryEvidence,
  MemoryLoopState,
  MemoryRecord,
  MemorySearchResult,
  MemoryStats,
  MemoryLayer,
  MemoryStatus,
  MemoryTransitionEvent,
  MemoryType,
  RetrievalMode,
} from "./contracts";

export type MemoryUpsertInput = {
  id: string;
  tenantId: string | null;
  agentId: string;
  runId: string;
  content: string;
  source: string;
  tags: string[];
  metadata: Record<string, unknown>;
  embedding: number[] | null;
  occurredAt: string | null;
  clientRequestId: string | null;
  status: MemoryStatus;
  memoryType: MemoryType;
  memoryLayer: MemoryLayer;
  sourceConfidence: number;
  importance: number;
  contextualizedContent: string;
  fingerprint: string | null;
  embeddingModel: string | null;
  embeddingVersion: number;
  evidence?: MemoryEvidence[];
  transitionEvents?: MemoryTransitionEvent[];
};

export type MemorySearchInput = {
  query: string;
  tenantId: string | null | undefined;
  agentId?: string;
  runId?: string;
  sourceAllowlist?: string[];
  sourceDenylist?: string[];
  layerAllowlist?: MemoryLayer[];
  layerDenylist?: MemoryLayer[];
  retrievalMode?: RetrievalMode;
  minScore?: number;
  explain?: boolean;
  embedding?: number[];
  limit?: number;
};

export type MemoryRecentInput = {
  tenantId: string | null | undefined;
  limit: number;
  agentId?: string;
  runId?: string;
  sourceAllowlist?: string[];
  sourceDenylist?: string[];
  layerAllowlist?: MemoryLayer[];
  layerDenylist?: MemoryLayer[];
  excludeStatuses?: MemoryStatus[];
};

export type MemoryGetByIdsInput = {
  ids: string[];
  tenantId: string | null | undefined;
};

export type MemoryStatsInput = {
  tenantId: string | null | undefined;
  layerAllowlist?: MemoryLayer[];
  layerDenylist?: MemoryLayer[];
};

export type MemoryEdgeUpsertInput = {
  targetId: string;
  relationType: string;
  weight: number;
  evidence?: Record<string, unknown>;
};

export type MemoryEntityUpsertInput = {
  entityType: string;
  entityKey: string;
  entityValue: string;
  confidence: number;
};

export type MemoryPatternUpsertInput = {
  patternType: string;
  patternKey: string;
  patternValue: string;
  confidence: number;
};

export type MemoryLoopFeedbackAction = "ack" | "assign" | "snooze" | "resolve" | "false-positive" | "escalate";

export type MemoryIndexInput = {
  tenantId: string | null | undefined;
  memoryId: string;
  edges: MemoryEdgeUpsertInput[];
  entities: MemoryEntityUpsertInput[];
  patterns?: MemoryPatternUpsertInput[];
};

export type MemorySignalIndexPresenceInput = {
  tenantId: string | null | undefined;
  memoryId: string;
  edgeKeys?: Array<{ targetId: string; relationType: string }>;
  entityKeys?: Array<{ entityType: string; entityKey: string }>;
  patternKeys?: Array<{ patternType: string; patternKey: string }>;
};

export type MemorySignalIndexPresenceResult = {
  indexed: boolean;
  edgeMatches: number;
  entityMatches: number;
  patternMatches: number;
};

export type MemoryEntityHint = {
  entityType: string;
  entityKey: string;
  weight?: number;
};

export type MemoryRelatedInput = {
  tenantId: string | null | undefined;
  seedIds?: string[];
  entityHints?: MemoryEntityHint[];
  patternHints?: Array<{ patternType: string; patternKey: string; weight?: number }>;
  limit?: number;
  maxHops?: number;
  includeSeed?: boolean;
};

export type MemoryRelatedResult = {
  id: string;
  score: number;
  graphScore: number;
  entityScore: number;
  patternScore: number;
  hops: number;
  matchedBy: string[];
  relationTypes: string[];
};

export type MemoryLoopStateUpsertInput = {
  tenantId: string | null | undefined;
  loopKey: string;
  memoryId: string;
  state: MemoryLoopState;
  confidence: number;
  occurredAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type MemoryLoopStateSearchInput = {
  tenantId: string | null | undefined;
  loopKeys?: string[];
  states?: MemoryLoopState[];
  limit?: number;
};

export type MemoryLoopStateResult = {
  loopKey: string;
  currentState: MemoryLoopState;
  confidence: number;
  lastMemoryId: string | null;
  lastOpenMemoryId: string | null;
  lastResolvedMemoryId: string | null;
  openEvents: number;
  resolvedEvents: number;
  reopenedEvents: number;
  supersededEvents: number;
  updatedAt: string;
  recentTransitions7d?: number;
  recentReopened7d?: number;
  recentResolved7d?: number;
  lastTransitionAt?: string | null;
};

export type MemoryLoopFeedbackUpsertInput = {
  tenantId: string | null | undefined;
  loopKey: string;
  action: MemoryLoopFeedbackAction;
  incidentId?: string | null;
  memoryId?: string | null;
  actorId?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string | null;
};

export type MemoryLoopFeedbackStatsInput = {
  tenantId: string | null | undefined;
  loopKeys?: string[];
  limit?: number;
  windowDays?: number;
};

export type MemoryLoopFeedbackStatsResult = {
  loopKey: string;
  ackCount: number;
  assignCount: number;
  snoozeCount: number;
  resolveCount: number;
  falsePositiveCount: number;
  escalateCount: number;
  totalCount: number;
  lastActionAt: string | null;
};

export type MemoryLoopActionIdempotencyLookupInput = {
  tenantId: string | null | undefined;
  idempotencyKey: string;
};

export type MemoryLoopActionIdempotencyLookupResult = {
  idempotencyKey: string;
  requestHash: string;
  responseJson: Record<string, unknown> | null;
  createdAt: string;
  lastSeenAt: string;
};

export type MemoryLoopActionIdempotencyStoreInput = {
  tenantId: string | null | undefined;
  idempotencyKey: string;
  requestHash: string;
  responseJson: Record<string, unknown>;
};

export type MemoryLoopActionIdempotencyClaimInput = {
  tenantId: string | null | undefined;
  idempotencyKey: string;
  requestHash: string;
  pendingResponseJson?: Record<string, unknown>;
};

export type MemoryLoopActionIdempotencyClaimResult = {
  status: "claimed" | "existing" | "in-flight" | "conflict";
  entry: MemoryLoopActionIdempotencyLookupResult | null;
};

export type MemoryStoreAdapter = {
  upsert: (input: MemoryUpsertInput) => Promise<MemoryRecord>;
  search: (input: MemorySearchInput) => Promise<MemorySearchResult[]>;
  recent: (input: MemoryRecentInput) => Promise<MemoryRecord[]>;
  recentCreated?: (input: MemoryRecentInput) => Promise<MemoryRecord[]>;
  getByIds: (input: MemoryGetByIdsInput) => Promise<MemoryRecord[]>;
  stats: (input: MemoryStatsInput) => Promise<MemoryStats>;
  indexSignals?: (input: MemoryIndexInput) => Promise<void>;
  hasSignalIndex?: (input: MemorySignalIndexPresenceInput) => Promise<MemorySignalIndexPresenceResult>;
  related?: (input: MemoryRelatedInput) => Promise<MemoryRelatedResult[]>;
  updateLoopState?: (input: MemoryLoopStateUpsertInput) => Promise<void>;
  searchLoopState?: (input: MemoryLoopStateSearchInput) => Promise<MemoryLoopStateResult[]>;
  recordLoopFeedback?: (input: MemoryLoopFeedbackUpsertInput) => Promise<void>;
  searchLoopFeedbackStats?: (input: MemoryLoopFeedbackStatsInput) => Promise<MemoryLoopFeedbackStatsResult[]>;
  lookupLoopActionIdempotency?: (
    input: MemoryLoopActionIdempotencyLookupInput
  ) => Promise<MemoryLoopActionIdempotencyLookupResult | null>;
  claimLoopActionIdempotency?: (
    input: MemoryLoopActionIdempotencyClaimInput
  ) => Promise<MemoryLoopActionIdempotencyClaimResult>;
  storeLoopActionIdempotency?: (input: MemoryLoopActionIdempotencyStoreInput) => Promise<void>;
  healthcheck?: () => Promise<{ ok: boolean; latencyMs: number; error?: string }>;
};
