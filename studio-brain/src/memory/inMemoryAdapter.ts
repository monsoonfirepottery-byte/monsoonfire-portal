import type {
  MemoryLoopActionIdempotencyClaimInput,
  MemoryLoopActionIdempotencyClaimResult,
  MemoryLoopActionIdempotencyLookupInput,
  MemoryLoopActionIdempotencyLookupResult,
  MemoryLoopActionIdempotencyStoreInput,
  MemoryEntityHint,
  MemoryLoopFeedbackAction,
  MemoryLoopFeedbackStatsInput,
  MemoryLoopFeedbackStatsResult,
  MemoryLoopFeedbackUpsertInput,
  MemorySignalIndexPresenceInput,
  MemorySignalIndexPresenceResult,
  MemoryLoopStateResult,
  MemoryLoopStateSearchInput,
  MemoryLoopStateUpsertInput,
  MemoryRelatedInput,
  MemoryRelatedResult,
  MemoryStoreAdapter,
  MemoryUpsertInput,
} from "./adapters";
import type {
  MemoryEvidence,
  MemoryCategory,
  MemoryFreshnessStatus,
  MemoryLayer,
  MemoryLoopState,
  MemoryOperationalStatus,
  MemoryRedactionState,
  MemoryRecord,
  MemoryReviewAction,
  MemorySearchResult,
  MemorySourceClass,
  MemoryStats,
  MemoryTransitionEvent,
  MemoryTruthStatus,
  MemoryType,
} from "./contracts";
import { isAllowedMemoryLayer, normalizeMemoryLayer, normalizeMemoryLayerList } from "./layers";

function clamp01(value: unknown, fallback = 0.5): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function clampLimit(value: unknown, fallback = 24): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(200, Math.trunc(numeric)));
}

function normalizeTenantScope(tenantId: string | null | undefined): string {
  return String(tenantId ?? "");
}

function normalizeIdList(values: string[] | undefined, maxItems = 64): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter((value) => value.length > 0)
        .slice(0, maxItems)
    )
  );
}

function normalizeEntityType(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48);
}

function normalizeEntityKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().slice(0, 160);
}

function normalizeEntityHints(values: MemoryEntityHint[] | undefined, maxItems = 32): Array<MemoryEntityHint & { weight: number }> {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: Array<MemoryEntityHint & { weight: number }> = [];
  for (const value of values) {
    const entityType = normalizeEntityType(value?.entityType);
    const entityKey = normalizeEntityKey(value?.entityKey);
    if (!entityType || !entityKey) continue;
    const dedupe = `${entityType}|${entityKey}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({
      entityType,
      entityKey,
      weight: clamp01(value?.weight, 0.6),
    });
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizePatternType(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48);
}

function normalizePatternKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().slice(0, 180);
}

function normalizePatternHints(
  values: Array<{ patternType: string; patternKey: string; weight?: number }> | undefined,
  maxItems = 32
): Array<{ patternType: string; patternKey: string; weight: number }> {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: Array<{ patternType: string; patternKey: string; weight: number }> = [];
  for (const value of values) {
    const patternType = normalizePatternType(value?.patternType);
    const patternKey = normalizePatternKey(value?.patternKey);
    if (!patternType || !patternKey) continue;
    const dedupe = `${patternType}|${patternKey}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({
      patternType,
      patternKey,
      weight: clamp01(value?.weight, 0.62),
    });
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeLoopKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().slice(0, 180);
}

function normalizeLoopState(value: unknown): MemoryLoopState {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "resolved" || raw === "reopened" || raw === "superseded") return raw;
  return "open-loop";
}

function normalizeLoopFeedbackAction(value: unknown): MemoryLoopFeedbackAction {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "assign" || raw === "snooze" || raw === "resolve" || raw === "false-positive" || raw === "escalate") {
    return raw;
  }
  return "ack";
}

function normalizeRelationType(value: unknown): string {
  const relationType = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48);
  return relationType || "related";
}

function relationWeightMultiplier(relationTypeRaw: unknown): number {
  const relationType = normalizeRelationType(relationTypeRaw);
  if (relationType === "resolves") return 1.18;
  if (relationType === "reopens") return 1.12;
  if (relationType === "supersedes") return 1.1;
  if (relationType === "parent" || relationType === "reply-to" || relationType === "thread-root") return 1.08;
  return 1;
}

function memoryScopeKey(tenantScope: string, memoryId: string): string {
  return `${tenantScope}::${memoryId}`;
}

type InMemoryEdge = {
  tenantScope: string;
  sourceId: string;
  targetId: string;
  relationType: string;
  weight: number;
  evidence: Record<string, unknown>;
};

type InMemoryEntity = {
  tenantScope: string;
  memoryId: string;
  entityType: string;
  entityKey: string;
  entityValue: string;
  confidence: number;
};

type InMemoryPattern = {
  tenantScope: string;
  memoryId: string;
  patternType: string;
  patternKey: string;
  patternValue: string;
  confidence: number;
};

type InMemoryLoopState = {
  tenantScope: string;
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
};

type InMemoryLoopFeedbackEvent = {
  id: string;
  tenantScope: string;
  loopKey: string;
  action: MemoryLoopFeedbackAction;
  incidentId: string | null;
  memoryId: string | null;
  actorId: string | null;
  note: string | null;
  occurredAt: string;
  metadata: Record<string, unknown>;
};

type InMemoryLoopActionIdempotencyEntry = {
  tenantScope: string;
  idempotencyKey: string;
  requestHash: string;
  responseJson: Record<string, unknown>;
  createdAt: string;
  lastSeenAt: string;
};

function edgeKey(edge: InMemoryEdge): string {
  return [edge.tenantScope, edge.sourceId, edge.targetId, edge.relationType].join("|");
}

function entityKey(entry: InMemoryEntity): string {
  return [entry.tenantScope, entry.memoryId, entry.entityType, entry.entityKey].join("|");
}

function patternIndexKey(entry: InMemoryPattern): string {
  return [entry.tenantScope, entry.memoryId, entry.patternType, entry.patternKey].join("|");
}

function relationProbeKey(tenantScope: string, memoryId: string, targetId: string, relationType: string): string {
  return [tenantScope, memoryId, targetId, normalizeRelationType(relationType)].join("|");
}

function entityProbeKey(tenantScope: string, memoryId: string, entityType: string, entityKeyRaw: string): string {
  return [tenantScope, memoryId, normalizeEntityType(entityType), normalizeEntityKey(entityKeyRaw)].join("|");
}

function patternProbeKey(tenantScope: string, memoryId: string, patternType: string, patternKeyRaw: string): string {
  return [tenantScope, memoryId, normalizePatternType(patternType), normalizePatternKey(patternKeyRaw)].join("|");
}

function loopStateKey(tenantScope: string, loopKey: string): string {
  return `${tenantScope}|${loopKey}`;
}

function halfLifeDays(memoryType: MemoryType): number {
  if (memoryType === "working") return 3;
  if (memoryType === "episodic") return 30;
  if (memoryType === "semantic") return 180;
  return 365;
}

function layerBreakdown(rows: MemoryRecord[]): Array<{ layer: MemoryLayer; count: number }> {
  const counts = new Map<MemoryLayer, number>();
  for (const row of rows) {
    counts.set(row.memoryLayer, (counts.get(row.memoryLayer) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([layer, count]) => ({ layer, count }))
    .sort((left, right) => right.count - left.count || left.layer.localeCompare(right.layer));
}

function statusBreakdown(rows: MemoryRecord[]): Array<{ status: MemoryRecord["status"]; count: number }> {
  const counts = new Map<MemoryRecord["status"], number>();
  for (const row of rows) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => right.count - left.count || left.status.localeCompare(right.status));
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readLatticeValue(metadata: Record<string, unknown>, key: string): unknown {
  const nested = normalizeMetadata(metadata.memoryLattice);
  if (metadata[key] !== undefined && metadata[key] !== null && metadata[key] !== "") return metadata[key];
  if (nested[key] !== undefined && nested[key] !== null && nested[key] !== "") return nested[key];
  return null;
}

function mapBreakdown<T extends string>(counts: Map<T, number>, key: string): Array<Record<string, unknown>> {
  return Array.from(counts.entries())
    .map(([value, count]) => ({ [key]: value, count }))
    .sort((left, right) => Number(right.count) - Number(left.count) || String(left[key]).localeCompare(String(right[key])));
}

function latticeBreakdown(rows: MemoryRecord[]): MemoryStats["lattice"] {
  const byCategory = new Map<MemoryCategory, number>();
  const byTruthStatus = new Map<MemoryTruthStatus, number>();
  const byFreshnessStatus = new Map<MemoryFreshnessStatus, number>();
  const byOperationalStatus = new Map<MemoryOperationalStatus, number>();
  const byReviewAction = new Map<MemoryReviewAction, number>();
  let rowsWithLattice = 0;
  let reviewNow = 0;
  let revalidate = 0;
  let resolveConflict = 0;
  let retire = 0;
  let folkloreRiskHigh = 0;

  for (const row of rows) {
    const metadata = normalizeMetadata(row.metadata);
    const category = normalizeText(readLatticeValue(metadata, "memoryCategory") ?? readLatticeValue(metadata, "category")) as MemoryCategory;
    const truthStatus = normalizeText(readLatticeValue(metadata, "truthStatus")) as MemoryTruthStatus;
    const freshnessStatus = normalizeText(readLatticeValue(metadata, "freshnessStatus")) as MemoryFreshnessStatus;
    const operationalStatus = normalizeText(readLatticeValue(metadata, "operationalStatus")) as MemoryOperationalStatus;
    const reviewAction = normalizeText(readLatticeValue(metadata, "reviewAction")) as MemoryReviewAction;
    const folkloreRisk = Number(readLatticeValue(metadata, "folkloreRisk") ?? 0);
    const hasLattice = Boolean(category || truthStatus || freshnessStatus || operationalStatus || reviewAction);
    if (hasLattice) rowsWithLattice += 1;
    if (category) byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
    if (truthStatus) byTruthStatus.set(truthStatus, (byTruthStatus.get(truthStatus) ?? 0) + 1);
    if (freshnessStatus) byFreshnessStatus.set(freshnessStatus, (byFreshnessStatus.get(freshnessStatus) ?? 0) + 1);
    if (operationalStatus) byOperationalStatus.set(operationalStatus, (byOperationalStatus.get(operationalStatus) ?? 0) + 1);
    if (reviewAction) {
      byReviewAction.set(reviewAction, (byReviewAction.get(reviewAction) ?? 0) + 1);
      if (reviewAction !== "none") reviewNow += 1;
      if (reviewAction === "revalidate") revalidate += 1;
      if (reviewAction === "resolve-conflict") resolveConflict += 1;
      if (reviewAction === "retire") retire += 1;
    }
    if (Number.isFinite(folkloreRisk) && folkloreRisk >= 0.65) folkloreRiskHigh += 1;
  }

  return {
    coverage: {
      rowsWithLattice,
      totalRows: rows.length,
      ratio: rows.length > 0 ? Number((rowsWithLattice / rows.length).toFixed(3)) : 0,
    },
    byCategory: mapBreakdown(byCategory, "category") as Array<{ category: MemoryCategory; count: number }>,
    byTruthStatus: mapBreakdown(byTruthStatus, "status") as Array<{ status: MemoryTruthStatus; count: number }>,
    byFreshnessStatus: mapBreakdown(byFreshnessStatus, "status") as Array<{ status: MemoryFreshnessStatus; count: number }>,
    byOperationalStatus: mapBreakdown(byOperationalStatus, "status") as Array<{ status: MemoryOperationalStatus; count: number }>,
    byReviewAction: mapBreakdown(byReviewAction, "action") as Array<{ action: MemoryReviewAction; count: number }>,
    backlog: {
      reviewNow,
      revalidate,
      resolveConflict,
      retire,
      folkloreRiskHigh,
    },
  };
}

function readEvidenceFromRow(row: MemoryRecord): MemoryEvidence[] {
  return Array.isArray(row.evidence) ? row.evidence : [];
}

function readTransitionsFromRow(row: MemoryRecord): MemoryTransitionEvent[] {
  return Array.isArray(row.transitions) ? row.transitions : [];
}

function recencyScore(occurredAt: string | null, createdAt: string, memoryType: MemoryType): number {
  const timestamp = Date.parse(occurredAt || createdAt);
  if (!Number.isFinite(timestamp)) return 0.5;
  const ageMs = Math.max(0, Date.now() - timestamp);
  const ageDays = ageMs / 86_400_000;
  return Math.exp(-ageDays / halfLifeDays(memoryType));
}

function normalizeRecord(input: MemoryUpsertInput): MemoryRecord {
  const createdAt = new Date().toISOString();
  return {
    id: input.id,
    tenantId: input.tenantId,
    agentId: input.agentId,
    runId: input.runId,
    content: input.content,
    source: input.source,
    tags: [...input.tags],
    metadata: { ...input.metadata },
    createdAt,
    occurredAt: input.occurredAt ?? null,
    status: input.status,
    memoryType: input.memoryType,
    memoryLayer: normalizeMemoryLayer(input.memoryLayer, "episodic"),
    sourceConfidence: clamp01(input.sourceConfidence),
    importance: clamp01(input.importance),
    evidence: Array.isArray(input.evidence) ? input.evidence.map((entry) => ({ ...entry, supportsMemoryIds: [...entry.supportsMemoryIds], metadata: normalizeMetadata(entry.metadata) })) : [],
    transitions: Array.isArray(input.transitionEvents)
      ? input.transitionEvents.map((entry) => ({ ...entry, evidenceIds: [...entry.evidenceIds], metadata: normalizeMetadata(entry.metadata) }))
      : [],
  };
}

function scoreRecord(
  row: MemoryRecord,
  query: string,
  options: { runId?: string; agentId?: string; explain?: boolean; minScore?: number }
): MemorySearchResult {
  const normalizedQuery = query.trim().toLowerCase();
  const terms = normalizedQuery
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 24);
  const searchable = `${row.content}\n${row.tags.join(" ")}\n${row.source}`.toLowerCase();
  let tokenHits = 0;
  for (const token of terms) {
    if (searchable.includes(token)) tokenHits += 1;
  }
  const lexical = terms.length ? tokenHits / terms.length : searchable.includes(normalizedQuery) ? 1 : 0;
  const session = options.runId && row.runId === options.runId ? 1 : options.agentId && row.agentId === options.agentId ? 0.5 : 0;
  const recency = recencyScore(row.occurredAt, row.createdAt, row.memoryType);
  const score = 0.5 * lexical + 0.2 * row.sourceConfidence + 0.15 * recency + 0.1 * row.importance + 0.05 * session;
  return {
    ...row,
    score,
    matchedBy: lexical > 0 ? ["lexical"] : session > 0 ? ["session"] : ["recent"],
    scoreBreakdown: {
      rrf: lexical,
      sourceTrust: row.sourceConfidence,
      recency,
      importance: row.importance,
      session,
      lexical,
      sessionLane: session,
    },
  };
}

export function createInMemoryMemoryStoreAdapter(): MemoryStoreAdapter {
  const records = new Map<string, MemoryRecord>();
  const relationEdges = new Map<string, InMemoryEdge>();
  const entities = new Map<string, InMemoryEntity>();
  const patterns = new Map<string, InMemoryPattern>();
  const loopStates = new Map<string, InMemoryLoopState>();
  const loopFeedbackEvents = new Map<string, InMemoryLoopFeedbackEvent>();
  const loopActionIdempotency = new Map<string, InMemoryLoopActionIdempotencyEntry>();
  let loopFeedbackCounter = 0;
  const edgeKeysByMemory = new Map<string, Set<string>>();
  const entityKeysByMemory = new Map<string, Set<string>>();
  const patternKeysByMemory = new Map<string, Set<string>>();

  const toArray = (): MemoryRecord[] =>
    Array.from(records.values()).sort((left, right) => {
      const leftTime = Date.parse(left.occurredAt || left.createdAt);
      const rightTime = Date.parse(right.occurredAt || right.createdAt);
      return rightTime - leftTime;
    });

  const stats = (tenantId: string | null | undefined, rowsOverride?: MemoryRecord[]): MemoryStats => {
    const rows =
      rowsOverride ??
      toArray().filter((row) => (tenantId === undefined ? true : row.tenantId === tenantId));
    const bySourceMap = new Map<string, number>();
    for (const row of rows) {
      bySourceMap.set(row.source, (bySourceMap.get(row.source) ?? 0) + 1);
    }
    const lattice = latticeBreakdown(rows);
    let contestedRows = 0;
    let hardConflicts = 0;
    let quarantinedRows = 0;
    let conflictRecords = 0;
    let startupEligibleRows = 0;
    let trustedStartupRows = 0;
    let handoffRows = 0;
    let checkpointRows = 0;
    let fallbackRiskRows = 0;
    let redactedRows = 0;
    let requiresReviewRows = 0;
    let canonicalBlockedRows = 0;
    let secretQuarantinedRows = 0;
    let governedMcpRows = 0;
    let ungovernedMcpRows = 0;
    let shadowMcpReviewRows = 0;
    let highRiskShadowMcpRows = 0;
    for (const row of rows) {
      const metadata = normalizeMetadata(row.metadata);
      const category = normalizeText(readLatticeValue(metadata, "memoryCategory") ?? readLatticeValue(metadata, "category"));
      const truthStatus = normalizeText(readLatticeValue(metadata, "truthStatus"));
      const operationalStatus = normalizeText(readLatticeValue(metadata, "operationalStatus"));
      const conflictSeverity = normalizeText(readLatticeValue(metadata, "conflictSeverity"));
      const sourceClass = normalizeText(readLatticeValue(metadata, "sourceClass")) as MemorySourceClass;
      const redactionState = normalizeText(metadata.redactionState ?? readLatticeValue(metadata, "redactionState")) as MemoryRedactionState;
      const startupEligible = metadata.startupEligible === true || metadata.rememberForStartup === true;
      const secretExposure = normalizeMetadata(metadata.secretExposure);
      const mcpGovernance = normalizeMetadata(metadata.mcpGovernance);
      const evidenceCount = readEvidenceFromRow(row).length;
      if (truthStatus === "contradicted" || operationalStatus === "quarantined") contestedRows += 1;
      if (conflictSeverity === "hard") hardConflicts += 1;
      if (operationalStatus === "quarantined") quarantinedRows += 1;
      if (category === "conflict-record") conflictRecords += 1;
      if (startupEligible) {
        startupEligibleRows += 1;
        if ((truthStatus === "trusted" || truthStatus === "verified") && operationalStatus === "active") {
          trustedStartupRows += 1;
        }
        if (!evidenceCount && row.status !== "accepted") fallbackRiskRows += 1;
      }
      if (String(metadata.rememberKind ?? "").trim().toLowerCase() === "handoff") handoffRows += 1;
      if (String(metadata.rememberKind ?? "").trim().toLowerCase() === "checkpoint") checkpointRows += 1;
      if (redactionState === "redacted" || redactionState === "verified-redacted") redactedRows += 1;
      if (redactionState === "requires-review") requiresReviewRows += 1;
      if (secretExposure.canonicalPromotionBlocked === true) canonicalBlockedRows += 1;
      if (secretExposure.quarantined === true) secretQuarantinedRows += 1;
      if (sourceClass === "mcp-tool" || Object.keys(mcpGovernance).length > 0) {
        if (normalizeText(mcpGovernance.approvalState)) governedMcpRows += 1;
        else ungovernedMcpRows += 1;
        if (mcpGovernance.shadowRisk === true) shadowMcpReviewRows += 1;
        if (mcpGovernance.shadowRisk === true && normalizeText(mcpGovernance.approvalState) !== "approved") {
          highRiskShadowMcpRows += 1;
        }
      }
    }
    return {
      total: rows.length,
      lastCapturedAt: rows.length ? rows[0].createdAt : null,
      bySource: Array.from(bySourceMap.entries())
        .map(([source, count]) => ({ source, count }))
        .sort((left, right) => right.count - left.count),
      byLayer: layerBreakdown(rows),
      byStatus: statusBreakdown(rows),
      lattice,
      reviewBacklog: lattice?.backlog,
      conflictBacklog: {
        contestedRows,
        hardConflicts,
        quarantinedRows,
        conflictRecords,
      },
      startupReadiness: {
        startupEligibleRows,
        trustedStartupRows,
        handoffRows,
        checkpointRows,
        fallbackRiskRows,
      },
      secretExposureFindings: {
        totalRows: rows.length,
        redactedRows,
        requiresReviewRows,
        canonicalBlockedRows,
        quarantinedRows: secretQuarantinedRows,
      },
      shadowMcpFindings: {
        totalRows: governedMcpRows + ungovernedMcpRows,
        governedRows: governedMcpRows,
        ungovernedRows: ungovernedMcpRows,
        reviewRows: shadowMcpReviewRows,
        highRiskRows: highRiskShadowMcpRows,
      },
    };
  };

  return {
    async upsert(input) {
      const existing = records.get(input.id);
      const next = normalizeRecord(input);
      if (existing) {
        const mergedEvidence = new Map<string, MemoryEvidence>();
        for (const entry of [...readEvidenceFromRow(existing), ...readEvidenceFromRow(next)]) {
          mergedEvidence.set(entry.evidenceId, {
            ...entry,
            supportsMemoryIds: [...entry.supportsMemoryIds],
            metadata: normalizeMetadata(entry.metadata),
          });
        }
        const mergedTransitions = new Map<string, MemoryTransitionEvent>();
        for (const entry of [...readTransitionsFromRow(existing), ...readTransitionsFromRow(next)]) {
          mergedTransitions.set(entry.transitionId, {
            ...entry,
            evidenceIds: [...entry.evidenceIds],
            metadata: normalizeMetadata(entry.metadata),
          });
        }
        records.set(input.id, {
          ...next,
          createdAt: existing.createdAt,
          occurredAt: existing.occurredAt && next.occurredAt ? (existing.occurredAt < next.occurredAt ? existing.occurredAt : next.occurredAt) : existing.occurredAt || next.occurredAt,
          evidence: Array.from(mergedEvidence.values()),
          transitions: Array.from(mergedTransitions.values()).sort((left, right) => left.at.localeCompare(right.at)),
        });
      } else {
        records.set(next.id, next);
      }
      return records.get(input.id) as MemoryRecord;
    },

    async search(input): Promise<MemorySearchResult[]> {
      const normalizedAllow = new Set((input.sourceAllowlist ?? []).map((value) => value.trim()).filter(Boolean));
      const normalizedDeny = new Set((input.sourceDenylist ?? []).map((value) => value.trim()).filter(Boolean));
      const layerAllowlist = normalizeMemoryLayerList(input.layerAllowlist);
      const layerDenylist = normalizeMemoryLayerList(input.layerDenylist);
      const scored = toArray()
        .filter((row) => (input.tenantId === undefined ? true : row.tenantId === input.tenantId))
        .filter((row) => (input.agentId ? row.agentId === input.agentId : true))
        .filter((row) => (input.runId ? row.runId === input.runId : true))
        .filter((row) => row.status !== "quarantined")
        .filter((row) => (normalizedAllow.size > 0 ? normalizedAllow.has(row.source) : true))
        .filter((row) => (normalizedDeny.size > 0 ? !normalizedDeny.has(row.source) : true))
        .filter((row) => isAllowedMemoryLayer(row.memoryLayer, layerAllowlist, layerDenylist))
        .map((row) => scoreRecord(row, input.query, { runId: input.runId, agentId: input.agentId, explain: input.explain, minScore: input.minScore }))
        .filter((row) => (input.minScore === undefined ? true : row.score >= input.minScore))
        .sort((left, right) => right.score - left.score || right.createdAt.localeCompare(left.createdAt))
        .slice(0, Math.max(1, input.limit ?? 10));
      return scored;
    },

    async getByIds(input): Promise<MemoryRecord[]> {
      const requestedIds = Array.from(
        new Set(
          (input.ids ?? [])
            .map((value) => String(value ?? "").trim())
            .filter((value) => value.length > 0)
        )
      );
      if (!requestedIds.length) {
        return [];
      }
      return requestedIds
        .map((id) => records.get(id))
        .filter((row): row is MemoryRecord => Boolean(row))
        .filter((row) => (input.tenantId === undefined ? true : row.tenantId === input.tenantId));
    },

    async recent(input): Promise<MemoryRecord[]> {
      const normalizedAllow = new Set((input.sourceAllowlist ?? []).map((value) => value.trim()).filter(Boolean));
      const normalizedDeny = new Set((input.sourceDenylist ?? []).map((value) => value.trim()).filter(Boolean));
      const excludedStatuses = new Set((input.excludeStatuses ?? []).map((value) => String(value ?? "").trim()).filter(Boolean));
      const layerAllowlist = normalizeMemoryLayerList(input.layerAllowlist);
      const layerDenylist = normalizeMemoryLayerList(input.layerDenylist);
      return toArray()
        .filter((row) => (input.tenantId === undefined ? true : row.tenantId === input.tenantId))
        .filter((row) => (input.agentId ? row.agentId === input.agentId : true))
        .filter((row) => (input.runId ? row.runId === input.runId : true))
        .filter((row) => (normalizedAllow.size > 0 ? normalizedAllow.has(row.source) : true))
        .filter((row) => (normalizedDeny.size > 0 ? !normalizedDeny.has(row.source) : true))
        .filter((row) => isAllowedMemoryLayer(row.memoryLayer, layerAllowlist, layerDenylist))
        .filter((row) => (excludedStatuses.size > 0 ? !excludedStatuses.has(row.status) : true))
        .slice(0, Math.max(1, input.limit));
    },

    async recentCreated(input): Promise<MemoryRecord[]> {
      const normalizedAllow = new Set((input.sourceAllowlist ?? []).map((value) => value.trim()).filter(Boolean));
      const normalizedDeny = new Set((input.sourceDenylist ?? []).map((value) => value.trim()).filter(Boolean));
      const excludedStatuses = new Set((input.excludeStatuses ?? []).map((value) => String(value ?? "").trim()).filter(Boolean));
      const layerAllowlist = normalizeMemoryLayerList(input.layerAllowlist);
      const layerDenylist = normalizeMemoryLayerList(input.layerDenylist);
      return toArray()
        .filter((row) => (input.tenantId === undefined ? true : row.tenantId === input.tenantId))
        .filter((row) => (input.agentId ? row.agentId === input.agentId : true))
        .filter((row) => (input.runId ? row.runId === input.runId : true))
        .filter((row) => (normalizedAllow.size > 0 ? normalizedAllow.has(row.source) : true))
        .filter((row) => (normalizedDeny.size > 0 ? !normalizedDeny.has(row.source) : true))
        .filter((row) => isAllowedMemoryLayer(row.memoryLayer, layerAllowlist, layerDenylist))
        .filter((row) => (excludedStatuses.size > 0 ? !excludedStatuses.has(row.status) : true))
        .sort((left, right) => {
          const rightCreated = Date.parse(right.createdAt || "") || 0;
          const leftCreated = Date.parse(left.createdAt || "") || 0;
          return rightCreated - leftCreated;
        })
        .slice(0, Math.max(1, input.limit));
    },

    async stats(input): Promise<MemoryStats> {
      const rows = toArray()
        .filter((row) => (input.tenantId === undefined ? true : row.tenantId === input.tenantId))
        .filter((row) => isAllowedMemoryLayer(row.memoryLayer, normalizeMemoryLayerList(input.layerAllowlist), normalizeMemoryLayerList(input.layerDenylist)));
      return stats(input.tenantId, rows);
    },

    async indexSignals(input) {
      const tenantScope = normalizeTenantScope(input.tenantId);
      const memoryId = String(input.memoryId ?? "").trim();
      if (!memoryId) return;

      const scopeMemoryKey = memoryScopeKey(tenantScope, memoryId);
      const previousEdgeKeys = edgeKeysByMemory.get(scopeMemoryKey);
      if (previousEdgeKeys) {
        for (const key of previousEdgeKeys) {
          relationEdges.delete(key);
        }
      }
      const previousEntityKeys = entityKeysByMemory.get(scopeMemoryKey);
      if (previousEntityKeys) {
        for (const key of previousEntityKeys) {
          entities.delete(key);
        }
      }
      const previousPatternKeys = patternKeysByMemory.get(scopeMemoryKey);
      if (previousPatternKeys) {
        for (const key of previousPatternKeys) {
          patterns.delete(key);
        }
      }

      const nextEdgeKeys = new Set<string>();
      for (const edge of input.edges ?? []) {
        const targetId = String(edge.targetId ?? "").trim();
        if (!targetId || targetId === memoryId) continue;
        const row: InMemoryEdge = {
          tenantScope,
          sourceId: memoryId,
          targetId,
          relationType: normalizeRelationType(edge.relationType),
          weight: clamp01(edge.weight, 0.55),
          evidence:
            edge.evidence && typeof edge.evidence === "object" && !Array.isArray(edge.evidence)
              ? (edge.evidence as Record<string, unknown>)
              : {},
        };
        const key = edgeKey(row);
        relationEdges.set(key, row);
        nextEdgeKeys.add(key);
      }
      edgeKeysByMemory.set(scopeMemoryKey, nextEdgeKeys);

      const nextEntityKeys = new Set<string>();
      for (const entity of input.entities ?? []) {
        const entityType = normalizeEntityType(entity.entityType);
        const normalizedEntityKey = normalizeEntityKey(entity.entityKey);
        const entityValue = String(entity.entityValue ?? "").trim().slice(0, 240);
        if (!entityType || !normalizedEntityKey || !entityValue) continue;
        const row: InMemoryEntity = {
          tenantScope,
          memoryId,
          entityType,
          entityKey: normalizedEntityKey,
          entityValue,
          confidence: clamp01(entity.confidence, 0.55),
        };
        const key = entityKey(row);
        entities.set(key, row);
        nextEntityKeys.add(key);
      }
      entityKeysByMemory.set(scopeMemoryKey, nextEntityKeys);

      const nextPatternKeys = new Set<string>();
      for (const pattern of input.patterns ?? []) {
        const patternType = normalizePatternType(pattern.patternType);
        const patternKey = normalizePatternKey(pattern.patternKey);
        const patternValue = String(pattern.patternValue ?? "").trim().slice(0, 240);
        if (!patternType || !patternKey || !patternValue) continue;
        const row: InMemoryPattern = {
          tenantScope,
          memoryId,
          patternType,
          patternKey,
          patternValue,
          confidence: clamp01(pattern.confidence, 0.55),
        };
        const key = patternIndexKey(row);
        patterns.set(key, row);
        nextPatternKeys.add(key);
      }
      patternKeysByMemory.set(scopeMemoryKey, nextPatternKeys);
    },

    async hasSignalIndex(input: MemorySignalIndexPresenceInput): Promise<MemorySignalIndexPresenceResult> {
      const tenantScope = normalizeTenantScope(input.tenantId);
      const memoryId = String(input.memoryId ?? "").trim();
      if (!memoryId) {
        return {
          indexed: false,
          edgeMatches: 0,
          entityMatches: 0,
          patternMatches: 0,
        };
      }

      const scopeMemoryKey = memoryScopeKey(tenantScope, memoryId);
      const edgeSet = edgeKeysByMemory.get(scopeMemoryKey) ?? new Set<string>();
      const entitySet = entityKeysByMemory.get(scopeMemoryKey) ?? new Set<string>();
      const patternSet = patternKeysByMemory.get(scopeMemoryKey) ?? new Set<string>();

      const requestedEdgeKeys = Array.from(
        new Set(
          (input.edgeKeys ?? [])
            .map((entry) => {
              const targetId = String(entry?.targetId ?? "").trim();
              if (!targetId || targetId === memoryId) return "";
              return relationProbeKey(tenantScope, memoryId, targetId, entry?.relationType ?? "related");
            })
            .filter((value) => value.length > 0)
        )
      );
      const requestedEntityKeys = Array.from(
        new Set(
          (input.entityKeys ?? [])
            .map((entry) => entityProbeKey(tenantScope, memoryId, entry?.entityType ?? "", entry?.entityKey ?? ""))
            .filter((value) => {
              const tokens = value.split("|");
              return Boolean(tokens[2]) && Boolean(tokens[3]);
            })
        )
      );
      const requestedPatternKeys = Array.from(
        new Set(
          (input.patternKeys ?? [])
            .map((entry) => patternProbeKey(tenantScope, memoryId, entry?.patternType ?? "", entry?.patternKey ?? ""))
            .filter((value) => {
              const tokens = value.split("|");
              return Boolean(tokens[2]) && Boolean(tokens[3]);
            })
        )
      );

      if (requestedEdgeKeys.length === 0 && requestedEntityKeys.length === 0 && requestedPatternKeys.length === 0) {
        return {
          indexed: false,
          edgeMatches: 0,
          entityMatches: 0,
          patternMatches: 0,
        };
      }

      let edgeMatches = 0;
      for (const key of requestedEdgeKeys) {
        if (edgeSet.has(key)) edgeMatches += 1;
      }
      let entityMatches = 0;
      for (const key of requestedEntityKeys) {
        if (entitySet.has(key)) entityMatches += 1;
      }
      let patternMatches = 0;
      for (const key of requestedPatternKeys) {
        if (patternSet.has(key)) patternMatches += 1;
      }

      const indexed =
        (requestedEdgeKeys.length === 0 || edgeMatches >= requestedEdgeKeys.length) &&
        (requestedEntityKeys.length === 0 || entityMatches >= requestedEntityKeys.length) &&
        (requestedPatternKeys.length === 0 || patternMatches >= requestedPatternKeys.length);

      return {
        indexed,
        edgeMatches,
        entityMatches,
        patternMatches,
      };
    },

    async related(input: MemoryRelatedInput): Promise<MemoryRelatedResult[]> {
      const tenantScope = normalizeTenantScope(input.tenantId);
      const seedIds = normalizeIdList(input.seedIds);
      const seedSet = new Set(seedIds);
      const includeSeed = input.includeSeed === true;
      const maxHops = Math.max(1, Math.min(4, Math.trunc(Number(input.maxHops ?? 2)) || 2));
      const explicitEntityHints = normalizeEntityHints(input.entityHints);
      const explicitPatternHints = normalizePatternHints(input.patternHints);
      const limit = clampLimit(input.limit, 24);

      const scored = new Map<
        string,
        {
          graphScore: number;
          entityScore: number;
          patternScore: number;
          hops: number;
          matchedBy: Set<string>;
          relationTypes: Set<string>;
        }
      >();
      const touch = (params: {
        memoryId: string;
        graphContribution?: number;
        entityContribution?: number;
        patternContribution?: number;
        hop?: number;
        matchedBy: "graph" | "entity" | "pattern";
        relationType?: string;
      }) => {
        const memoryId = String(params.memoryId ?? "").trim();
        if (!memoryId) return;
        if (!includeSeed && seedSet.has(memoryId)) return;
        const existing = scored.get(memoryId) ?? {
          graphScore: 0,
          entityScore: 0,
          patternScore: 0,
          hops: 0,
          matchedBy: new Set<string>(),
          relationTypes: new Set<string>(),
        };
        existing.graphScore += Math.max(0, params.graphContribution ?? 0);
        existing.entityScore += Math.max(0, params.entityContribution ?? 0);
        existing.patternScore += Math.max(0, params.patternContribution ?? 0);
        existing.matchedBy.add(params.matchedBy);
        if (params.relationType) {
          existing.relationTypes.add(normalizeRelationType(params.relationType));
        }
        const hop = Math.max(0, Math.trunc(Number(params.hop ?? 0)));
        if (hop > 0 && (existing.hops === 0 || hop < existing.hops)) {
          existing.hops = hop;
        }
        scored.set(memoryId, existing);
      };

      if (seedIds.length > 0) {
        let frontier = [...seedIds];
        const visited = new Set(seedIds);
        for (let hop = 1; hop <= maxHops && frontier.length > 0; hop += 1) {
          const frontierSet = new Set(frontier);
          const nextFrontier = new Set<string>();
          for (const edge of relationEdges.values()) {
            if (edge.tenantScope !== tenantScope) continue;
            const fromFrontier = frontierSet.has(edge.sourceId);
            const toFrontier = frontierSet.has(edge.targetId);
            if (!fromFrontier && !toFrontier) continue;
            const candidateId = fromFrontier ? edge.targetId : edge.sourceId;
            const hopDecay = hop === 1 ? 1 : 1 / (hop * 1.35);
            const graphContribution = clamp01(edge.weight, 0.55) * hopDecay * relationWeightMultiplier(edge.relationType);
            touch({
              memoryId: candidateId,
              graphContribution,
              hop,
              matchedBy: "graph",
              relationType: edge.relationType,
            });
            if (!visited.has(candidateId)) {
              visited.add(candidateId);
              nextFrontier.add(candidateId);
            }
          }
          frontier = Array.from(nextFrontier).slice(0, Math.max(24, limit * 6));
        }
      }

      const inferredSeedHints = new Map<string, MemoryEntityHint & { weight: number }>();
      if (seedIds.length > 0) {
        for (const row of entities.values()) {
          if (row.tenantScope !== tenantScope) continue;
          if (!seedSet.has(row.memoryId)) continue;
          const key = `${row.entityType}|${row.entityKey}`;
          if (!inferredSeedHints.has(key)) {
            inferredSeedHints.set(key, {
              entityType: row.entityType,
              entityKey: row.entityKey,
              weight: clamp01(row.confidence, 0.55) * 0.72,
            });
          }
          if (inferredSeedHints.size >= 24) break;
        }
      }

      const mergedEntityHints = new Map<string, MemoryEntityHint & { weight: number }>();
      for (const hint of explicitEntityHints) {
        mergedEntityHints.set(`${hint.entityType}|${hint.entityKey}`, hint);
      }
      for (const [key, hint] of inferredSeedHints) {
        if (mergedEntityHints.has(key)) continue;
        mergedEntityHints.set(key, hint);
      }

      if (mergedEntityHints.size > 0) {
        for (const hint of mergedEntityHints.values()) {
          for (const row of entities.values()) {
            if (row.tenantScope !== tenantScope) continue;
            if (row.entityType !== hint.entityType) continue;
            if (row.entityKey !== hint.entityKey) continue;
            touch({
              memoryId: row.memoryId,
              entityContribution: clamp01(row.confidence, 0.55) * hint.weight,
              matchedBy: "entity",
            });
          }
        }
      }

      const inferredSeedPatternHints = new Map<string, { patternType: string; patternKey: string; weight: number }>();
      if (seedIds.length > 0) {
        for (const row of patterns.values()) {
          if (row.tenantScope !== tenantScope) continue;
          if (!seedSet.has(row.memoryId)) continue;
          const key = `${row.patternType}|${row.patternKey}`;
          if (!inferredSeedPatternHints.has(key)) {
            inferredSeedPatternHints.set(key, {
              patternType: row.patternType,
              patternKey: row.patternKey,
              weight: clamp01(row.confidence, 0.55) * 0.74,
            });
          }
          if (inferredSeedPatternHints.size >= 24) break;
        }
      }

      const mergedPatternHints = new Map<string, { patternType: string; patternKey: string; weight: number }>();
      for (const hint of explicitPatternHints) {
        mergedPatternHints.set(`${hint.patternType}|${hint.patternKey}`, hint);
      }
      for (const [key, hint] of inferredSeedPatternHints) {
        if (mergedPatternHints.has(key)) continue;
        mergedPatternHints.set(key, hint);
      }

      if (mergedPatternHints.size > 0) {
        for (const hint of mergedPatternHints.values()) {
          for (const row of patterns.values()) {
            if (row.tenantScope !== tenantScope) continue;
            if (row.patternType !== hint.patternType) continue;
            if (row.patternKey !== hint.patternKey) continue;
            touch({
              memoryId: row.memoryId,
              patternContribution: clamp01(row.confidence, 0.55) * hint.weight,
              matchedBy: "pattern",
            });
          }
        }
      }

      const desiredStates = new Set(
        Array.from(mergedPatternHints.values())
          .filter((hint) => hint.patternType === "state")
          .map((hint) => normalizeLoopState(hint.patternKey))
      );
      if (desiredStates.size > 0) {
        for (const row of patterns.values()) {
          if (row.tenantScope !== tenantScope) continue;
          if (row.patternType !== "loop-cluster") continue;
          const loopKey = normalizeLoopKey(row.patternKey);
          if (!loopKey) continue;
          const loopState = loopStates.get(loopStateKey(tenantScope, loopKey));
          if (!loopState) continue;
          if (!desiredStates.has(loopState.currentState)) continue;
          touch({
            memoryId: row.memoryId,
            patternContribution: clamp01(row.confidence, 0.55) * clamp01(loopState.confidence, 0.6) * 0.92,
            matchedBy: "pattern",
          });
        }
      }

      return Array.from(scored.entries())
        .map(([id, row]): MemoryRelatedResult => {
          const graphScore = row.graphScore;
          const entityScore = row.entityScore;
          const patternScore = row.patternScore;
          const synergy = row.matchedBy.size > 1 ? 0.08 : 0;
          const score = Math.min(2, graphScore * 0.8 + entityScore * 0.76 + patternScore * 0.74 + synergy);
          return {
            id,
            score,
            graphScore,
            entityScore,
            patternScore,
            hops: row.hops,
            matchedBy: Array.from(row.matchedBy),
            relationTypes: Array.from(row.relationTypes),
          };
        })
        .filter((row) => row.score > 0)
        .sort((left, right) => right.score - left.score || left.hops - right.hops || left.id.localeCompare(right.id))
        .slice(0, limit);
    },

    async updateLoopState(input: MemoryLoopStateUpsertInput): Promise<void> {
      const tenantScope = normalizeTenantScope(input.tenantId);
      const loopKey = normalizeLoopKey(input.loopKey);
      const memoryId = String(input.memoryId ?? "").trim();
      if (!loopKey || !memoryId) return;
      const state = normalizeLoopState(input.state);
      const key = loopStateKey(tenantScope, loopKey);
      const previous = loopStates.get(key);
      const next: InMemoryLoopState = {
        tenantScope,
        loopKey,
        currentState: state,
        confidence: clamp01(input.confidence, previous?.confidence ?? 0.62),
        lastMemoryId: memoryId,
        lastOpenMemoryId:
          state === "open-loop" || state === "reopened" ? memoryId : (previous?.lastOpenMemoryId ?? null),
        lastResolvedMemoryId: state === "resolved" ? memoryId : (previous?.lastResolvedMemoryId ?? null),
        openEvents: (previous?.openEvents ?? 0) + (state === "open-loop" ? 1 : 0),
        resolvedEvents: (previous?.resolvedEvents ?? 0) + (state === "resolved" ? 1 : 0),
        reopenedEvents: (previous?.reopenedEvents ?? 0) + (state === "reopened" ? 1 : 0),
        supersededEvents: (previous?.supersededEvents ?? 0) + (state === "superseded" ? 1 : 0),
        updatedAt: new Date().toISOString(),
      };
      loopStates.set(key, next);
    },

    async searchLoopState(input: MemoryLoopStateSearchInput): Promise<MemoryLoopStateResult[]> {
      const tenantScope = normalizeTenantScope(input.tenantId);
      const loopKeys = normalizeIdList(input.loopKeys, 200).map((value) => normalizeLoopKey(value)).filter(Boolean);
      const loopKeySet = new Set(loopKeys);
      const stateSet = new Set((input.states ?? []).map((value) => normalizeLoopState(value)));
      const limit = clampLimit(input.limit, 40);
      return Array.from(loopStates.values())
        .filter((row) => row.tenantScope === tenantScope)
        .filter((row) => (loopKeySet.size > 0 ? loopKeySet.has(row.loopKey) : true))
        .filter((row) => (stateSet.size > 0 ? stateSet.has(row.currentState) : true))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit)
        .map((row) => ({
          loopKey: row.loopKey,
          currentState: row.currentState,
          confidence: row.confidence,
          lastMemoryId: row.lastMemoryId,
          lastOpenMemoryId: row.lastOpenMemoryId,
          lastResolvedMemoryId: row.lastResolvedMemoryId,
          openEvents: row.openEvents,
          resolvedEvents: row.resolvedEvents,
          reopenedEvents: row.reopenedEvents,
          supersededEvents: row.supersededEvents,
          updatedAt: row.updatedAt,
          recentTransitions7d: 0,
          recentReopened7d: 0,
          recentResolved7d: 0,
          lastTransitionAt: null,
        }));
    },

    async recordLoopFeedback(input: MemoryLoopFeedbackUpsertInput): Promise<void> {
      const tenantScope = normalizeTenantScope(input.tenantId);
      const loopKey = normalizeLoopKey(input.loopKey);
      if (!loopKey) return;
      const action = normalizeLoopFeedbackAction(input.action);
      const id = `imlfe_${Date.now()}_${(loopFeedbackCounter += 1)}`;
      const event: InMemoryLoopFeedbackEvent = {
        id,
        tenantScope,
        loopKey,
        action,
        incidentId: String(input.incidentId ?? "").trim() || null,
        memoryId: String(input.memoryId ?? "").trim() || null,
        actorId: String(input.actorId ?? "").trim() || null,
        note: String(input.note ?? "").trim() || null,
        occurredAt: (() => {
          const parsed = Date.parse(String(input.occurredAt ?? ""));
          return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
        })(),
        metadata:
          input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? input.metadata : {},
      };
      loopFeedbackEvents.set(event.id, event);
    },

    async searchLoopFeedbackStats(input: MemoryLoopFeedbackStatsInput): Promise<MemoryLoopFeedbackStatsResult[]> {
      const tenantScope = normalizeTenantScope(input.tenantId);
      const loopKeys = normalizeIdList(input.loopKeys, 220).map((value) => normalizeLoopKey(value)).filter(Boolean);
      const loopKeySet = new Set(loopKeys);
      const limit = clampLimit(input.limit, 120);
      const windowDays = Math.max(1, Math.min(3650, Number.isFinite(input.windowDays) ? Number(input.windowDays) : 120));
      const minOccurredMs = Date.now() - windowDays * 86_400_000;
      const byLoop = new Map<
        string,
        {
          loopKey: string;
          ackCount: number;
          assignCount: number;
          snoozeCount: number;
          resolveCount: number;
          falsePositiveCount: number;
          escalateCount: number;
          totalCount: number;
          lastActionAt: string | null;
        }
      >();
      for (const event of loopFeedbackEvents.values()) {
        if (event.tenantScope !== tenantScope) continue;
        if (loopKeySet.size > 0 && !loopKeySet.has(event.loopKey)) continue;
        const occurredMs = Date.parse(event.occurredAt);
        if (Number.isFinite(occurredMs) && occurredMs < minOccurredMs) continue;
        const entry = byLoop.get(event.loopKey) ?? {
          loopKey: event.loopKey,
          ackCount: 0,
          assignCount: 0,
          snoozeCount: 0,
          resolveCount: 0,
          falsePositiveCount: 0,
          escalateCount: 0,
          totalCount: 0,
          lastActionAt: null,
        };
        if (event.action === "ack") entry.ackCount += 1;
        if (event.action === "assign") entry.assignCount += 1;
        if (event.action === "snooze") entry.snoozeCount += 1;
        if (event.action === "resolve") entry.resolveCount += 1;
        if (event.action === "false-positive") entry.falsePositiveCount += 1;
        if (event.action === "escalate") entry.escalateCount += 1;
        entry.totalCount += 1;
        if (!entry.lastActionAt || event.occurredAt > entry.lastActionAt) {
          entry.lastActionAt = event.occurredAt;
        }
        byLoop.set(event.loopKey, entry);
      }
      return Array.from(byLoop.values())
        .sort(
          (left, right) =>
            right.escalateCount + right.resolveCount - (left.escalateCount + left.resolveCount) ||
            left.falsePositiveCount - right.falsePositiveCount ||
            String(right.lastActionAt ?? "").localeCompare(String(left.lastActionAt ?? ""))
        )
        .slice(0, limit);
    },

    async lookupLoopActionIdempotency(
      input: MemoryLoopActionIdempotencyLookupInput
    ): Promise<MemoryLoopActionIdempotencyLookupResult | null> {
      const tenantScope = normalizeTenantScope(input.tenantId);
      const idempotencyKey = String(input.idempotencyKey ?? "").trim();
      if (!idempotencyKey) return null;
      const key = `${tenantScope}|${idempotencyKey}`;
      const entry = loopActionIdempotency.get(key);
      if (!entry) return null;
      entry.lastSeenAt = new Date().toISOString();
      loopActionIdempotency.set(key, entry);
      return {
        idempotencyKey: entry.idempotencyKey,
        requestHash: entry.requestHash,
        responseJson: entry.responseJson,
        createdAt: entry.createdAt,
        lastSeenAt: entry.lastSeenAt,
      };
    },

    async claimLoopActionIdempotency(
      input: MemoryLoopActionIdempotencyClaimInput
    ): Promise<MemoryLoopActionIdempotencyClaimResult> {
      const tenantScope = normalizeTenantScope(input.tenantId);
      const idempotencyKey = String(input.idempotencyKey ?? "").trim();
      const requestHash = String(input.requestHash ?? "").trim();
      if (!idempotencyKey || !requestHash) {
        return { status: "conflict", entry: null };
      }
      const now = new Date().toISOString();
      const key = `${tenantScope}|${idempotencyKey}`;
      const existing = loopActionIdempotency.get(key);
      if (!existing) {
        const pendingResponseJson =
          input.pendingResponseJson && typeof input.pendingResponseJson === "object" && !Array.isArray(input.pendingResponseJson)
            ? input.pendingResponseJson
            : { _pending: true };
        loopActionIdempotency.set(key, {
          tenantScope,
          idempotencyKey,
          requestHash,
          responseJson: pendingResponseJson,
          createdAt: now,
          lastSeenAt: now,
        });
        return { status: "claimed", entry: null };
      }
      existing.lastSeenAt = now;
      loopActionIdempotency.set(key, existing);
      const lookup: MemoryLoopActionIdempotencyLookupResult = {
        idempotencyKey: existing.idempotencyKey,
        requestHash: existing.requestHash,
        responseJson: existing.responseJson,
        createdAt: existing.createdAt,
        lastSeenAt: existing.lastSeenAt,
      };
      if (existing.requestHash !== requestHash) {
        return { status: "conflict", entry: lookup };
      }
      const isPending = existing.responseJson && existing.responseJson._pending === true;
      if (isPending) {
        return { status: "in-flight", entry: lookup };
      }
      return { status: "existing", entry: lookup };
    },

    async storeLoopActionIdempotency(input: MemoryLoopActionIdempotencyStoreInput): Promise<void> {
      const tenantScope = normalizeTenantScope(input.tenantId);
      const idempotencyKey = String(input.idempotencyKey ?? "").trim();
      const requestHash = String(input.requestHash ?? "").trim();
      if (!idempotencyKey || !requestHash) return;
      const now = new Date().toISOString();
      const key = `${tenantScope}|${idempotencyKey}`;
      const existing = loopActionIdempotency.get(key);
      loopActionIdempotency.set(key, {
        tenantScope,
        idempotencyKey,
        requestHash,
        responseJson:
          input.responseJson && typeof input.responseJson === "object" && !Array.isArray(input.responseJson)
            ? input.responseJson
            : {},
        createdAt: existing?.createdAt ?? now,
        lastSeenAt: now,
      });
    },

    async healthcheck() {
      return { ok: true, latencyMs: 0 };
    },
  };
}
