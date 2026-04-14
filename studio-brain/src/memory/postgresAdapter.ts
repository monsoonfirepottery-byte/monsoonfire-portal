import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { getPgPool } from "../db/postgres";
import type { VectorStore } from "../connectivity/vectorStore";
import type {
  MemoryEntityHint,
  MemoryLoopActionIdempotencyClaimInput,
  MemoryLoopActionIdempotencyClaimResult,
  MemoryLoopActionIdempotencyLookupInput,
  MemoryLoopActionIdempotencyLookupResult,
  MemoryLoopActionIdempotencyStoreInput,
  MemoryLoopFeedbackAction,
  MemoryLoopFeedbackStatsInput,
  MemoryLoopFeedbackStatsResult,
  MemoryLoopFeedbackUpsertInput,
  MemoryIndexInput,
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
  MemoryStatus,
  MemoryTransitionEvent,
  MemoryTruthStatus,
} from "./contracts";
import { isAllowedMemoryLayer, normalizeMemoryLayer, normalizeMemoryLayerList } from "./layers";

type AdapterParams = {
  vectorStore: VectorStore;
  tableName?: string;
};

function sanitizeTableName(value: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`Invalid memory table name: ${value}`);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseSource(metadata: Record<string, unknown>, fallback: string): string {
  const source = metadata.source;
  return typeof source === "string" && source.trim().length > 0 ? source.trim() : fallback;
}

function parseTags(metadata: Record<string, unknown>): string[] {
  const raw = metadata.tags;
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => String(entry)).filter(Boolean);
}

function sanitizeSourceList(values: string[] | undefined, maxItems = 40): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
        .slice(0, maxItems)
    )
  );
}

function sanitizeStatusList(values: MemoryStatus[] | undefined, maxItems = 8): MemoryStatus[] {
  if (!Array.isArray(values)) return [];
  const out = new Set<MemoryStatus>();
  for (const value of values.slice(0, maxItems)) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "proposed" || normalized === "accepted" || normalized === "quarantined" || normalized === "archived") {
      out.add(normalized);
    }
  }
  return Array.from(out);
}

function sanitizeLayerList(values: MemoryLayer[] | undefined, maxItems = 4): MemoryLayer[] {
  return normalizeMemoryLayerList(values, maxItems);
}

function parseDate(value: unknown): string {
  const date = new Date(String(value ?? ""));
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function parseNullableDate(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function parseStringList(value: unknown, maxItems = 64): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean)
        .slice(0, maxItems)
    )
  );
}

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

function normalizeTenantScope(value: string | null | undefined): string {
  return String(value ?? "");
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

function normalizeEntityHints(raw: MemoryEntityHint[] | undefined, maxItems = 32): Array<MemoryEntityHint & { weight: number }> {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Array<MemoryEntityHint & { weight: number }> = [];
  for (const value of raw) {
    const entityType = normalizeEntityType(value?.entityType);
    const entityKey = normalizeEntityKey(value?.entityKey);
    if (!entityType || !entityKey) continue;
    const dedupeKey = `${entityType}|${entityKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
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

function normalizePatternHints(
  raw: Array<{ patternType: string; patternKey: string; weight?: number }> | undefined,
  maxItems = 32
): Array<{ patternType: string; patternKey: string; weight: number }> {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Array<{ patternType: string; patternKey: string; weight: number }> = [];
  for (const value of raw) {
    const patternType = normalizePatternType(value?.patternType);
    const patternKey = normalizePatternKey(value?.patternKey);
    if (!patternType || !patternKey) continue;
    const dedupeKey = `${patternType}|${patternKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      patternType,
      patternKey,
      weight: clamp01(value?.weight, 0.62),
    });
    if (out.length >= maxItems) break;
  }
  return out;
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

function normalizeSignalEdgeKeys(
  values: MemorySignalIndexPresenceInput["edgeKeys"],
  memoryId: string,
  maxItems = 192
): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((entry) => {
          const targetId = String(entry?.targetId ?? "").trim();
          if (!targetId || targetId === memoryId) return "";
          const relationType = normalizeRelationType(entry?.relationType ?? "related");
          if (!relationType) return "";
          return `${targetId}|${relationType}`;
        })
        .filter((value) => value.length > 0)
        .slice(0, maxItems)
    )
  );
}

function normalizeSignalEntityKeys(values: MemorySignalIndexPresenceInput["entityKeys"], maxItems = 256): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((entry) => {
          const entityType = normalizeEntityType(entry?.entityType);
          const entityKey = normalizeEntityKey(entry?.entityKey);
          if (!entityType || !entityKey) return "";
          return `${entityType}|${entityKey}`;
        })
        .filter((value) => value.length > 0)
        .slice(0, maxItems)
    )
  );
}

function normalizeSignalPatternKeys(values: MemorySignalIndexPresenceInput["patternKeys"], maxItems = 320): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((entry) => {
          const patternType = normalizePatternType(entry?.patternType);
          const patternKey = normalizePatternKey(entry?.patternKey);
          if (!patternType || !patternKey) return "";
          return `${patternType}|${patternKey}`;
        })
        .filter((value) => value.length > 0)
        .slice(0, maxItems)
    )
  );
}

function parseStatus(value: unknown): MemoryRecord["status"] {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "accepted" || raw === "quarantined" || raw === "archived") return raw;
  return "proposed";
}

function parseMemoryType(value: unknown): MemoryRecord["memoryType"] {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "working" || raw === "semantic" || raw === "procedural") return raw;
  return "episodic";
}

function parseSourceClass(value: unknown): MemorySourceClass | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (
    raw === "live-check" ||
    raw === "repo-file" ||
    raw === "policy" ||
    raw === "telemetry" ||
    raw === "human" ||
    raw === "derived" ||
    raw === "mcp-tool" ||
    raw === "runtime-artifact" ||
    raw === "external-doc"
  ) {
    return raw;
  }
  return null;
}

function parseRedactionState(value: unknown): MemoryRedactionState | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (
    raw === "none" ||
    raw === "redacted" ||
    raw === "verified-redacted" ||
    raw === "requires-review" ||
    raw === "quarantined"
  ) {
    return raw;
  }
  return null;
}

function parseMemoryLayer(metadata: Record<string, unknown>, memoryType: unknown): MemoryLayer {
  return normalizeMemoryLayer(metadata.memoryLayer, normalizeMemoryLayer(memoryType, "episodic"));
}

function memoryLayerSql(): string {
  return `
    COALESCE(
      NULLIF(LOWER(metadata->>'memoryLayer'), ''),
      CASE
        WHEN LOWER(memory_type) = 'working' THEN 'working'
        WHEN LOWER(memory_type) = 'episodic' THEN 'episodic'
        WHEN LOWER(memory_type) IN ('semantic', 'procedural') THEN 'canonical'
        ELSE 'episodic'
      END
    )
  `;
}

function latticeTextSql(topLevelKey: string, nestedKey: string): string {
  return `COALESCE(NULLIF(LOWER(metadata->>'${topLevelKey}'), ''), NULLIF(LOWER(metadata->'memoryLattice'->>'${nestedKey}'), ''))`;
}

function latticeNumericSql(topLevelKey: string, nestedKey: string, fallback = "0"): string {
  return `
    CASE
      WHEN COALESCE(metadata->>'${topLevelKey}', metadata->'memoryLattice'->>'${nestedKey}', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
        THEN COALESCE(metadata->>'${topLevelKey}', metadata->'memoryLattice'->>'${nestedKey}')::numeric
      ELSE ${fallback}::numeric
    END
  `;
}

function mapCountRows<T extends string>(rows: QueryResultRow[], key: string): Array<{ value: T; count: number }> {
  return rows
    .map((row) => ({
      value: String(row[key] ?? "").trim().toLowerCase() as T,
      count: Number(row.count ?? 0),
    }))
    .filter((row) => row.value.length > 0 && row.count > 0)
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

function mapRowToRecord(row: QueryResultRow): MemoryRecord {
  const metadata = asRecord(row.metadata);
  const source = parseSource(metadata, "manual");
  const memoryType = parseMemoryType(row.memory_type);
  return {
    id: String(row.memory_id),
    tenantId: row.tenant_id === null ? null : String(row.tenant_id),
    agentId: String(row.agent_id ?? "memory-api"),
    runId: String(row.run_id ?? "memory-run"),
    content: String(row.content ?? ""),
    source,
    tags: parseTags(metadata),
    metadata,
    createdAt: parseDate(row.created_at),
    occurredAt: parseNullableDate(row.occurred_at),
    status: parseStatus(row.status),
    memoryType,
    memoryLayer: parseMemoryLayer(metadata, memoryType),
    sourceConfidence: clamp01(row.source_confidence),
    importance: clamp01(row.importance),
  };
}

function mapEvidenceRow(row: QueryResultRow): MemoryEvidence {
  return {
    evidenceId: String(row.evidence_id),
    sourceClass: parseSourceClass(row.source_class) ?? "derived",
    sourceUri: row.source_uri === null ? null : String(row.source_uri),
    sourcePath: row.source_path === null ? null : String(row.source_path),
    capturedAt: parseDate(row.captured_at),
    verifiedAt: parseNullableDate(row.verified_at),
    verifier: row.verifier === null ? null : String(row.verifier),
    redactionState: parseRedactionState(row.redaction_state) ?? "none",
    hash: row.hash === null ? null : String(row.hash),
    supportsMemoryIds: parseStringList(row.supports_memory_ids, 32),
    metadata: asRecord(row.metadata),
  };
}

function mapTransitionRow(row: QueryResultRow): MemoryTransitionEvent {
  return {
    transitionId: String(row.transition_id),
    memoryId: String(row.memory_id),
    actor: row.actor === null ? null : String(row.actor),
    reason: row.reason === null ? null : String(row.reason),
    at: parseDate(row.at),
    fromStatus: row.from_status === null ? null : parseStatus(row.from_status),
    toStatus: parseStatus(row.to_status),
    fromTruthStatus: row.from_truth_status === null ? null : (String(row.from_truth_status) as MemoryTruthStatus),
    toTruthStatus: String(row.to_truth_status) as MemoryTruthStatus,
    fromFreshnessStatus:
      row.from_freshness_status === null ? null : (String(row.from_freshness_status) as MemoryFreshnessStatus),
    toFreshnessStatus: String(row.to_freshness_status) as MemoryFreshnessStatus,
    fromOperationalStatus:
      row.from_operational_status === null ? null : (String(row.from_operational_status) as MemoryOperationalStatus),
    toOperationalStatus: String(row.to_operational_status) as MemoryOperationalStatus,
    evidenceIds: parseStringList(row.evidence_ids, 32),
    metadata: asRecord(row.metadata),
  };
}

export function createPostgresMemoryStoreAdapter(params: AdapterParams): MemoryStoreAdapter {
  const tableName = sanitizeTableName(params.tableName ?? "swarm_memory");
  const vectorStore = params.vectorStore;
  const pool = getPgPool();
  const latticeProjectionTable = "memory_lattice_projection";
  const evidenceTable = "memory_evidence";
  const transitionTable = "memory_transition_event";

  const attachRecordDetails = async <TRow extends MemoryRecord | MemorySearchResult>(rows: TRow[]): Promise<TRow[]> => {
    const memoryIds = Array.from(new Set(rows.map((row) => String(row.id ?? "").trim()).filter(Boolean)));
    if (memoryIds.length === 0) return rows;

    const [evidenceResult, transitionResult] = await Promise.all([
      pool.query(
        `
          SELECT
            evidence_id,
            memory_id,
            source_class,
            source_uri,
            source_path,
            captured_at,
            verified_at,
            verifier,
            redaction_state,
            hash,
            supports_memory_ids,
            metadata
            FROM ${evidenceTable}
           WHERE memory_id = ANY($1::text[])
           ORDER BY captured_at ASC, evidence_id ASC
        `,
        [memoryIds]
      ),
      pool.query(
        `
          SELECT
            transition_id,
            memory_id,
            actor,
            reason,
            at,
            from_status,
            to_status,
            from_truth_status,
            to_truth_status,
            from_freshness_status,
            to_freshness_status,
            from_operational_status,
            to_operational_status,
            evidence_ids,
            metadata
            FROM ${transitionTable}
           WHERE memory_id = ANY($1::text[])
           ORDER BY at ASC, transition_id ASC
        `,
        [memoryIds]
      ),
    ]);

    const evidenceByMemoryId = new Map<string, MemoryEvidence[]>();
    for (const row of evidenceResult.rows) {
      const memoryId = String(row.memory_id ?? "").trim();
      if (!memoryId) continue;
      const bucket = evidenceByMemoryId.get(memoryId) ?? [];
      bucket.push(mapEvidenceRow(row));
      evidenceByMemoryId.set(memoryId, bucket);
    }

    const transitionsByMemoryId = new Map<string, MemoryTransitionEvent[]>();
    for (const row of transitionResult.rows) {
      const memoryId = String(row.memory_id ?? "").trim();
      if (!memoryId) continue;
      const bucket = transitionsByMemoryId.get(memoryId) ?? [];
      bucket.push(mapTransitionRow(row));
      transitionsByMemoryId.set(memoryId, bucket);
    }

    return rows.map((row) => ({
      ...row,
      evidence: evidenceByMemoryId.get(row.id) ?? [],
      transitions: transitionsByMemoryId.get(row.id) ?? [],
    }));
  };

  const persistLatticeProjection = async (client: PoolClient, input: MemoryUpsertInput): Promise<void> => {
    const metadata = asRecord(input.metadata);
    const lattice = asRecord(metadata.memoryLattice);
    const secretExposure = asRecord(metadata.secretExposure);
    const mcpGovernance = asRecord(metadata.mcpGovernance);
    const sourceClass = parseSourceClass(metadata.sourceClass ?? lattice.sourceClass);
    const redactionState = parseRedactionState(metadata.redactionState ?? lattice.redactionState);
    const hasEvidence = Array.isArray(input.evidence)
      ? input.evidence.length > 0
      : Boolean(metadata.evidenceCount ?? lattice.hasEvidence);
    const shadowMcpRisk =
      metadata.shadowMcpRisk === true || lattice.shadowMcpRisk === true || mcpGovernance.shadowRisk === true;
    const startupEligible = metadata.startupEligible === true || metadata.rememberForStartup === true;
    await client.query(
      `
        INSERT INTO ${latticeProjectionTable} (
          memory_id,
          tenant_id,
          memory_layer,
          status,
          category,
          truth_status,
          freshness_status,
          operational_status,
          authority_class,
          review_action,
          review_priority,
          folklore_risk,
          contradiction_count,
          conflict_severity,
          conflict_kinds,
          conflicting_memory_ids,
          scope,
          last_verified_at,
          next_review_at,
          freshness_expires_at,
          source_class,
          has_evidence,
          redaction_state,
          secret_exposure,
          canonical_promotion_blocked,
          secret_quarantined,
          shadow_mcp_risk,
          mcp_governed,
          mcp_approval_state,
          review_shadow_mcp,
          high_risk_shadow_mcp,
          startup_eligible,
          remember_kind,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb, $17,
          $18::timestamptz, $19::timestamptz, $20::timestamptz, $21, $22, $23, $24::jsonb, $25, $26, $27, $28, $29, $30, $31, $32, $33, now()
        )
        ON CONFLICT (memory_id) DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          memory_layer = EXCLUDED.memory_layer,
          status = EXCLUDED.status,
          category = EXCLUDED.category,
          truth_status = EXCLUDED.truth_status,
          freshness_status = EXCLUDED.freshness_status,
          operational_status = EXCLUDED.operational_status,
          authority_class = EXCLUDED.authority_class,
          review_action = EXCLUDED.review_action,
          review_priority = EXCLUDED.review_priority,
          folklore_risk = EXCLUDED.folklore_risk,
          contradiction_count = EXCLUDED.contradiction_count,
          conflict_severity = EXCLUDED.conflict_severity,
          conflict_kinds = EXCLUDED.conflict_kinds,
          conflicting_memory_ids = EXCLUDED.conflicting_memory_ids,
          scope = EXCLUDED.scope,
          last_verified_at = EXCLUDED.last_verified_at,
          next_review_at = EXCLUDED.next_review_at,
          freshness_expires_at = EXCLUDED.freshness_expires_at,
          source_class = EXCLUDED.source_class,
          has_evidence = EXCLUDED.has_evidence,
          redaction_state = EXCLUDED.redaction_state,
          secret_exposure = EXCLUDED.secret_exposure,
          canonical_promotion_blocked = EXCLUDED.canonical_promotion_blocked,
          secret_quarantined = EXCLUDED.secret_quarantined,
          shadow_mcp_risk = EXCLUDED.shadow_mcp_risk,
          mcp_governed = EXCLUDED.mcp_governed,
          mcp_approval_state = EXCLUDED.mcp_approval_state,
          review_shadow_mcp = EXCLUDED.review_shadow_mcp,
          high_risk_shadow_mcp = EXCLUDED.high_risk_shadow_mcp,
          startup_eligible = EXCLUDED.startup_eligible,
          remember_kind = EXCLUDED.remember_kind,
          updated_at = now()
      `,
      [
        input.id,
        input.tenantId ?? null,
        input.memoryLayer,
        input.status,
        String(metadata.memoryCategory ?? lattice.category ?? "") || null,
        String(metadata.truthStatus ?? lattice.truthStatus ?? "") || null,
        String(metadata.freshnessStatus ?? lattice.freshnessStatus ?? "") || null,
        String(metadata.operationalStatus ?? lattice.operationalStatus ?? "") || null,
        String(metadata.authorityClass ?? lattice.authorityClass ?? "") || null,
        String(metadata.reviewAction ?? lattice.reviewAction ?? "") || null,
        Number(metadata.reviewPriority ?? lattice.reviewPriority ?? 0),
        clamp01(metadata.folkloreRisk ?? lattice.folkloreRisk, 0),
        Math.max(0, Math.trunc(Number(metadata.contradictionCount ?? lattice.contradictionCount ?? 0))),
        String(metadata.conflictSeverity ?? lattice.conflictSeverity ?? "") || null,
        JSON.stringify(parseStringList(metadata.conflictKinds ?? lattice.conflictKinds, 16)),
        JSON.stringify(parseStringList(metadata.conflictingMemoryIds ?? lattice.conflictingMemoryIds, 32)),
        String(metadata.scope ?? lattice.scope ?? "") || null,
        parseNullableDate(metadata.lastVerifiedAt ?? lattice.lastVerifiedAt),
        parseNullableDate(metadata.nextReviewAt ?? lattice.nextReviewAt),
        parseNullableDate(metadata.freshnessExpiresAt ?? lattice.freshnessExpiresAt),
        sourceClass,
        hasEvidence,
        redactionState,
        JSON.stringify(secretExposure),
        secretExposure.canonicalPromotionBlocked === true,
        secretExposure.quarantined === true,
        shadowMcpRisk,
        String(mcpGovernance.approvalState ?? "").trim().length > 0,
        String(mcpGovernance.approvalState ?? "") || null,
        mcpGovernance.shadowRisk === true,
        mcpGovernance.shadowRisk === true && String(mcpGovernance.approvalState ?? "").trim().toLowerCase() !== "approved",
        startupEligible,
        String(metadata.rememberKind ?? "") || null,
      ]
    );
  };

  const replaceEvidence = async (client: PoolClient, input: MemoryUpsertInput): Promise<void> => {
    if (!Array.isArray(input.evidence)) return;
    await client.query(`DELETE FROM ${evidenceTable} WHERE memory_id = $1`, [input.id]);
    for (const evidence of input.evidence) {
      await client.query(
        `
          INSERT INTO ${evidenceTable} (
            evidence_id,
            memory_id,
            tenant_id,
            source_class,
            source_uri,
            source_path,
            captured_at,
            verified_at,
            verifier,
            redaction_state,
            hash,
            supports_memory_ids,
            metadata,
            updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9, $10, $11, $12::jsonb, $13::jsonb, now()
          )
          ON CONFLICT (evidence_id) DO UPDATE SET
            memory_id = EXCLUDED.memory_id,
            tenant_id = EXCLUDED.tenant_id,
            source_class = EXCLUDED.source_class,
            source_uri = EXCLUDED.source_uri,
            source_path = EXCLUDED.source_path,
            captured_at = EXCLUDED.captured_at,
            verified_at = EXCLUDED.verified_at,
            verifier = EXCLUDED.verifier,
            redaction_state = EXCLUDED.redaction_state,
            hash = EXCLUDED.hash,
            supports_memory_ids = EXCLUDED.supports_memory_ids,
            metadata = EXCLUDED.metadata,
            updated_at = now()
        `,
        [
          evidence.evidenceId,
          input.id,
          input.tenantId ?? null,
          evidence.sourceClass,
          evidence.sourceUri ?? null,
          evidence.sourcePath ?? null,
          evidence.capturedAt,
          evidence.verifiedAt ?? null,
          evidence.verifier ?? null,
          evidence.redactionState,
          evidence.hash ?? null,
          JSON.stringify(parseStringList(evidence.supportsMemoryIds, 32)),
          JSON.stringify(asRecord(evidence.metadata)),
        ]
      );
    }
  };

  const upsertTransitionEvents = async (client: PoolClient, input: MemoryUpsertInput): Promise<void> => {
    if (!Array.isArray(input.transitionEvents) || input.transitionEvents.length === 0) return;
    for (const transition of input.transitionEvents) {
      await client.query(
        `
          INSERT INTO ${transitionTable} (
            transition_id,
            memory_id,
            tenant_id,
            actor,
            reason,
            at,
            from_status,
            to_status,
            from_truth_status,
            to_truth_status,
            from_freshness_status,
            to_freshness_status,
            from_operational_status,
            to_operational_status,
            evidence_ids,
            metadata
          ) VALUES (
            $1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb
          )
          ON CONFLICT (transition_id) DO UPDATE SET
            memory_id = EXCLUDED.memory_id,
            tenant_id = EXCLUDED.tenant_id,
            actor = EXCLUDED.actor,
            reason = EXCLUDED.reason,
            at = EXCLUDED.at,
            from_status = EXCLUDED.from_status,
            to_status = EXCLUDED.to_status,
            from_truth_status = EXCLUDED.from_truth_status,
            to_truth_status = EXCLUDED.to_truth_status,
            from_freshness_status = EXCLUDED.from_freshness_status,
            to_freshness_status = EXCLUDED.to_freshness_status,
            from_operational_status = EXCLUDED.from_operational_status,
            to_operational_status = EXCLUDED.to_operational_status,
            evidence_ids = EXCLUDED.evidence_ids,
            metadata = EXCLUDED.metadata
        `,
        [
          transition.transitionId,
          input.id,
          input.tenantId ?? null,
          transition.actor ?? null,
          transition.reason ?? null,
          transition.at,
          transition.fromStatus ?? null,
          transition.toStatus,
          transition.fromTruthStatus ?? null,
          transition.toTruthStatus,
          transition.fromFreshnessStatus ?? null,
          transition.toFreshnessStatus,
          transition.fromOperationalStatus ?? null,
          transition.toOperationalStatus,
          JSON.stringify(parseStringList(transition.evidenceIds, 32)),
          JSON.stringify(asRecord(transition.metadata)),
        ]
      );
    }
  };

  return {
    async upsert(input: MemoryUpsertInput): Promise<MemoryRecord> {
      const metadata = {
        ...input.metadata,
        source: input.source,
        tags: input.tags,
        occurredAt: input.occurredAt,
        clientRequestId: input.clientRequestId,
        memoryLayer: input.memoryLayer,
      };

      await vectorStore.upsertMemory({
        id: input.id,
        tenantId: input.tenantId,
        agentId: input.agentId,
        runId: input.runId,
        content: input.content,
        contextualizedContent: input.contextualizedContent,
        embedding: input.embedding,
        metadata,
        occurredAt: input.occurredAt,
        status: input.status,
        memoryType: input.memoryType,
        sourceConfidence: input.sourceConfidence,
        importance: input.importance,
        fingerprint: input.fingerprint,
        embeddingModel: input.embeddingModel,
        embeddingVersion: input.embeddingVersion,
      });
      try {
        await pool.query(
          `
          INSERT INTO memory_ingest_event (
            event_id,
            tenant_id,
            source,
            decision,
            memory_id,
            fingerprint,
            reason,
            metadata
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8::jsonb
          )
          `,
          [
            `mie_${randomUUID()}`,
            input.tenantId ?? null,
            input.source,
            input.status,
            input.id,
            input.fingerprint,
            input.clientRequestId ?? null,
            JSON.stringify({
              memoryType: input.memoryType,
              memoryLayer: input.memoryLayer,
              sourceConfidence: input.sourceConfidence,
              importance: input.importance,
              embeddingModel: input.embeddingModel,
              embeddingVersion: input.embeddingVersion,
            }),
          ]
        );
      } catch {
        // best-effort telemetry
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await persistLatticeProjection(client, input);
        await replaceEvidence(client, input);
        await upsertTransitionEvents(client, input);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      const row = await pool.query(
        `
          SELECT
            memory_id,
            agent_id,
            run_id,
            tenant_id,
            content,
            metadata,
            created_at,
            occurred_at,
            status,
            memory_type,
            source_confidence,
            importance
            FROM ${tableName}
           WHERE memory_id = $1
           LIMIT 1
        `,
        [input.id]
      );
      if (row.rowCount && row.rows[0]) {
        const [enriched] = await attachRecordDetails([mapRowToRecord(row.rows[0])]);
        return enriched;
      }

      return {
        id: input.id,
        tenantId: input.tenantId,
        agentId: input.agentId,
        runId: input.runId,
        content: input.content,
        source: input.source,
        tags: [...input.tags],
        metadata,
        createdAt: new Date().toISOString(),
        occurredAt: input.occurredAt,
        status: input.status,
        memoryType: input.memoryType,
        memoryLayer: input.memoryLayer,
        sourceConfidence: clamp01(input.sourceConfidence),
        importance: clamp01(input.importance),
        evidence: Array.isArray(input.evidence) ? input.evidence : [],
        transitions: Array.isArray(input.transitionEvents) ? input.transitionEvents : [],
      };
    },

    async search(input): Promise<MemorySearchResult[]> {
      const startedAtMs = Date.now();
      const layerAllowlist = sanitizeLayerList(input.layerAllowlist);
      const layerDenylist = sanitizeLayerList(input.layerDenylist);
      const rows = await vectorStore.searchMemory({
        query: input.query,
        embedding: input.embedding,
        limit: input.limit,
        tenantId: input.tenantId ?? null,
        agentId: input.agentId,
        runId: input.runId,
        sourceAllowlist: input.sourceAllowlist,
        sourceDenylist: input.sourceDenylist,
        retrievalMode: input.retrievalMode,
        minScore: input.minScore,
        explain: input.explain,
      });
      const mapped = rows.map((row) => {
        const metadata = asRecord(row.metadata);
        const memoryType = parseMemoryType(row.memoryType);
        return {
          id: row.id,
          score: row.score,
          tenantId: row.tenantId,
          agentId: row.agentId,
          runId: row.runId,
          content: row.content,
          source: parseSource(metadata, "manual"),
          tags: parseTags(metadata),
          metadata,
          createdAt: parseDate(row.createdAt),
          occurredAt: parseNullableDate(row.occurredAt),
          status: parseStatus(row.status),
          memoryType,
          memoryLayer: parseMemoryLayer(metadata, memoryType),
          sourceConfidence: clamp01(row.sourceConfidence),
          importance: clamp01(row.importance),
          scoreBreakdown: row.scoreBreakdown,
          matchedBy: row.matchedBy,
        };
      }).filter((row) => isAllowedMemoryLayer(row.memoryLayer, layerAllowlist, layerDenylist));
      const enriched = await attachRecordDetails(mapped);
      const matchedByCounts = enriched.reduce<Record<string, number>>((acc, row) => {
        for (const key of row.matchedBy) {
          const normalized = String(key || "").trim().toLowerCase();
          if (!normalized) continue;
          acc[normalized] = (acc[normalized] ?? 0) + 1;
        }
        return acc;
      }, {});
      try {
        await pool.query(
          `
          INSERT INTO memory_retrieval_event (
            event_id,
            tenant_id,
            agent_id,
            run_id,
            query,
            retrieval_mode,
            candidate_count,
            selected_count,
            selected_memory_ids,
            score_snapshot,
            latency_ms
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11
          )
          `,
          [
            `mre_${randomUUID()}`,
            input.tenantId ?? null,
            input.agentId ?? null,
            input.runId ?? null,
            input.query,
            input.retrievalMode ?? "hybrid",
            rows.length,
            enriched.length,
            JSON.stringify(enriched.map((row) => row.id)),
            JSON.stringify({
              topScore: enriched[0]?.score ?? null,
              topMatchedBy: enriched[0]?.matchedBy ?? [],
              topBreakdown: enriched[0]?.scoreBreakdown ?? null,
              laneCounts: matchedByCounts,
              minScore: input.minScore ?? null,
            }),
            Date.now() - startedAtMs,
          ]
        );
      } catch {
        // best-effort telemetry
      }
      return enriched;
    },

    async recent(input): Promise<MemoryRecord[]> {
      const values: unknown[] = [];
      const predicates: string[] = [];
      const memoryLayerExpr = memoryLayerSql();
      if (input.tenantId !== undefined) {
        values.push(input.tenantId);
        predicates.push(`tenant_id IS NOT DISTINCT FROM $${values.length}`);
      }
      const agentId = String(input.agentId ?? "").trim();
      if (agentId) {
        values.push(agentId);
        predicates.push(`agent_id = $${values.length}`);
      }
      const runId = String(input.runId ?? "").trim();
      if (runId) {
        values.push(runId);
        predicates.push(`run_id = $${values.length}`);
      }
      const allow = sanitizeSourceList(input.sourceAllowlist);
      if (allow.length > 0) {
        values.push(allow);
        predicates.push(`COALESCE(metadata->>'source', 'manual') = ANY($${values.length}::text[])`);
      }
      const deny = sanitizeSourceList(input.sourceDenylist);
      if (deny.length > 0) {
        values.push(deny);
        predicates.push(`COALESCE(metadata->>'source', 'manual') <> ALL($${values.length}::text[])`);
      }
      const excludedStatuses = sanitizeStatusList(input.excludeStatuses);
      if (excludedStatuses.length > 0) {
        values.push(excludedStatuses);
        predicates.push(`status <> ALL($${values.length}::text[])`);
      }
      const allowLayers = sanitizeLayerList(input.layerAllowlist);
      if (allowLayers.length > 0) {
        values.push(allowLayers);
        predicates.push(`${memoryLayerExpr} = ANY($${values.length}::text[])`);
      }
      const denyLayers = sanitizeLayerList(input.layerDenylist);
      if (denyLayers.length > 0) {
        values.push(denyLayers);
        predicates.push(`${memoryLayerExpr} <> ALL($${values.length}::text[])`);
      }
      values.push(input.limit);
      const query = `
        SELECT
          memory_id,
          agent_id,
          run_id,
          tenant_id,
          content,
          metadata,
          created_at,
          occurred_at,
          status,
          memory_type,
          source_confidence,
          importance
          FROM ${tableName}
         ${predicates.length ? `WHERE ${predicates.join(" AND ")}` : ""}
         ORDER BY COALESCE(occurred_at, created_at) DESC, created_at DESC
         LIMIT $${values.length}
      `;
      const result = await pool.query(query, values);
      return attachRecordDetails(result.rows.map(mapRowToRecord));
    },

    async recentCreated(input): Promise<MemoryRecord[]> {
      const values: unknown[] = [];
      const predicates: string[] = [];
      const memoryLayerExpr = memoryLayerSql();
      if (input.tenantId !== undefined) {
        values.push(input.tenantId);
        predicates.push(`tenant_id IS NOT DISTINCT FROM $${values.length}`);
      }
      const agentId = String(input.agentId ?? "").trim();
      if (agentId) {
        values.push(agentId);
        predicates.push(`agent_id = $${values.length}`);
      }
      const runId = String(input.runId ?? "").trim();
      if (runId) {
        values.push(runId);
        predicates.push(`run_id = $${values.length}`);
      }
      const allow = sanitizeSourceList(input.sourceAllowlist);
      if (allow.length > 0) {
        values.push(allow);
        predicates.push(`COALESCE(metadata->>'source', 'manual') = ANY($${values.length}::text[])`);
      }
      const deny = sanitizeSourceList(input.sourceDenylist);
      if (deny.length > 0) {
        values.push(deny);
        predicates.push(`COALESCE(metadata->>'source', 'manual') <> ALL($${values.length}::text[])`);
      }
      const excludedStatuses = sanitizeStatusList(input.excludeStatuses);
      if (excludedStatuses.length > 0) {
        values.push(excludedStatuses);
        predicates.push(`status <> ALL($${values.length}::text[])`);
      }
      const allowLayers = sanitizeLayerList(input.layerAllowlist);
      if (allowLayers.length > 0) {
        values.push(allowLayers);
        predicates.push(`${memoryLayerExpr} = ANY($${values.length}::text[])`);
      }
      const denyLayers = sanitizeLayerList(input.layerDenylist);
      if (denyLayers.length > 0) {
        values.push(denyLayers);
        predicates.push(`${memoryLayerExpr} <> ALL($${values.length}::text[])`);
      }
      values.push(input.limit);
      const query = `
        SELECT
          memory_id,
          agent_id,
          run_id,
          tenant_id,
          content,
          metadata,
          created_at,
          occurred_at,
          status,
          memory_type,
          source_confidence,
          importance
          FROM ${tableName}
         ${predicates.length ? `WHERE ${predicates.join(" AND ")}` : ""}
         ORDER BY created_at DESC
         LIMIT $${values.length}
      `;
      const result = await pool.query(query, values);
      return attachRecordDetails(result.rows.map(mapRowToRecord));
    },

    async getByIds(input): Promise<MemoryRecord[]> {
      const ids = Array.from(new Set((input.ids ?? []).map((value) => String(value ?? "").trim()).filter(Boolean)));
      if (!ids.length) return [];

      const values: unknown[] = [ids];
      const predicates: string[] = ["memory_id = ANY($1::text[])"];
      if (input.tenantId !== undefined) {
        values.push(input.tenantId);
        predicates.push(`tenant_id IS NOT DISTINCT FROM $2`);
      }
      const query = `
        SELECT
          memory_id,
          agent_id,
          run_id,
          tenant_id,
          content,
          metadata,
          created_at,
          occurred_at,
          status,
          memory_type,
          source_confidence,
          importance
          FROM ${tableName}
         WHERE ${predicates.join(" AND ")}
         ORDER BY COALESCE(occurred_at, created_at) DESC, created_at DESC
      `;
      const result = await pool.query(query, values);
      const rows = await attachRecordDetails(result.rows.map(mapRowToRecord));
      return rows;
    },

    async stats(input): Promise<MemoryStats> {
      const values: unknown[] = [];
      const predicates: string[] = [];
      const projectionPredicates: string[] = [];
      const memoryLayerExpr = memoryLayerSql();
      if (input.tenantId !== undefined) {
        values.push(input.tenantId);
        predicates.push(`tenant_id IS NOT DISTINCT FROM $${values.length}`);
        projectionPredicates.push(`tenant_id IS NOT DISTINCT FROM $${values.length}`);
      }
      const allowLayers = sanitizeLayerList(input.layerAllowlist);
      if (allowLayers.length > 0) {
        values.push(allowLayers);
        predicates.push(`${memoryLayerExpr} = ANY($${values.length}::text[])`);
        projectionPredicates.push(`memory_layer = ANY($${values.length}::text[])`);
      }
      const denyLayers = sanitizeLayerList(input.layerDenylist);
      if (denyLayers.length > 0) {
        values.push(denyLayers);
        predicates.push(`${memoryLayerExpr} <> ALL($${values.length}::text[])`);
        projectionPredicates.push(`memory_layer <> ALL($${values.length}::text[])`);
      }
      const whereClause = predicates.length ? `WHERE ${predicates.join(" AND ")}` : "";

      const totals = await pool.query(
        `
          SELECT COUNT(*)::int AS total,
                 MAX(created_at) AS last_captured_at
            FROM ${tableName}
           ${whereClause}
        `,
        values
      );
      const bySource = await pool.query(
        `
          SELECT COALESCE(metadata->>'source', 'manual') AS source,
                 COUNT(*)::int AS count
            FROM ${tableName}
           ${whereClause}
        GROUP BY 1
        ORDER BY count DESC, source ASC
           LIMIT 20
        `,
        values
      );
      const byLayer = await pool.query(
        `
          SELECT ${memoryLayerExpr} AS layer,
                 COUNT(*)::int AS count
            FROM ${tableName}
           ${whereClause}
        GROUP BY 1
        ORDER BY count DESC, layer ASC
           LIMIT 8
        `,
        values
      );
      const byStatus = await pool.query(
        `
          SELECT status,
                 COUNT(*)::int AS count
            FROM ${tableName}
           ${whereClause}
        GROUP BY 1
        ORDER BY count DESC, status ASC
           LIMIT 8
        `,
        values
      );
      const projectionWhereClause = projectionPredicates.length ? `WHERE ${projectionPredicates.join(" AND ")}` : "";
      const latticeCoverage = await pool.query(
        `
          SELECT
            COUNT(*) FILTER (
              WHERE category IS NOT NULL
                 OR truth_status IS NOT NULL
                 OR freshness_status IS NOT NULL
                 OR operational_status IS NOT NULL
                 OR review_action IS NOT NULL
            )::int AS rows_with_lattice,
            COUNT(*) FILTER (WHERE review_action IS NOT NULL AND review_action <> 'none')::int AS review_now,
            COUNT(*) FILTER (WHERE review_action = 'revalidate')::int AS revalidate,
            COUNT(*) FILTER (WHERE review_action = 'resolve-conflict')::int AS resolve_conflict,
            COUNT(*) FILTER (WHERE review_action = 'retire')::int AS retire,
            COUNT(*) FILTER (WHERE folklore_risk >= 0.65)::int AS folklore_risk_high
            FROM ${latticeProjectionTable}
           ${projectionWhereClause}
        `,
        values
      );
      const byCategory = await pool.query(
        `
          SELECT category,
                 COUNT(*)::int AS count
            FROM ${latticeProjectionTable}
           ${projectionWhereClause}
             ${projectionWhereClause ? "AND" : "WHERE"} category IS NOT NULL
        GROUP BY 1
        ORDER BY count DESC, category ASC
           LIMIT 16
        `,
        values
      );
      const byTruthStatus = await pool.query(
        `
          SELECT truth_status AS status,
                 COUNT(*)::int AS count
            FROM ${latticeProjectionTable}
           ${projectionWhereClause}
             ${projectionWhereClause ? "AND" : "WHERE"} truth_status IS NOT NULL
        GROUP BY 1
        ORDER BY count DESC, status ASC
           LIMIT 8
        `,
        values
      );
      const byFreshnessStatus = await pool.query(
        `
          SELECT freshness_status AS status,
                 COUNT(*)::int AS count
            FROM ${latticeProjectionTable}
           ${projectionWhereClause}
             ${projectionWhereClause ? "AND" : "WHERE"} freshness_status IS NOT NULL
        GROUP BY 1
        ORDER BY count DESC, status ASC
           LIMIT 8
        `,
        values
      );
      const byOperationalStatus = await pool.query(
        `
          SELECT operational_status AS status,
                 COUNT(*)::int AS count
            FROM ${latticeProjectionTable}
           ${projectionWhereClause}
             ${projectionWhereClause ? "AND" : "WHERE"} operational_status IS NOT NULL
        GROUP BY 1
        ORDER BY count DESC, status ASC
           LIMIT 8
        `,
        values
      );
      const byReviewAction = await pool.query(
        `
          SELECT review_action AS action,
                 COUNT(*)::int AS count
            FROM ${latticeProjectionTable}
           ${projectionWhereClause}
             ${projectionWhereClause ? "AND" : "WHERE"} review_action IS NOT NULL
        GROUP BY 1
        ORDER BY count DESC, action ASC
           LIMIT 8
        `,
        values
      );
      const launchFindings = await pool.query(
        `
          SELECT
            COUNT(*) FILTER (WHERE truth_status = 'contradicted' OR operational_status = 'quarantined')::int AS contested_rows,
            COUNT(*) FILTER (WHERE conflict_severity = 'hard')::int AS hard_conflicts,
            COUNT(*) FILTER (WHERE operational_status = 'quarantined')::int AS quarantined_rows,
            COUNT(*) FILTER (WHERE category = 'conflict-record')::int AS conflict_records,
            COUNT(*) FILTER (WHERE startup_eligible)::int AS startup_eligible_rows,
            COUNT(*) FILTER (
              WHERE startup_eligible
                AND operational_status = 'active'
                AND truth_status IN ('trusted', 'verified')
            )::int AS trusted_startup_rows,
            COUNT(*) FILTER (WHERE remember_kind = 'handoff')::int AS handoff_rows,
            COUNT(*) FILTER (WHERE remember_kind = 'checkpoint')::int AS checkpoint_rows,
            COUNT(*) FILTER (WHERE startup_eligible AND has_evidence = false AND status <> 'accepted')::int AS fallback_risk_rows,
            COUNT(*) FILTER (WHERE redaction_state IN ('redacted', 'verified-redacted'))::int AS redacted_rows,
            COUNT(*) FILTER (WHERE redaction_state = 'requires-review')::int AS requires_review_rows,
            COUNT(*) FILTER (WHERE canonical_promotion_blocked = true)::int AS canonical_blocked_rows,
            COUNT(*) FILTER (WHERE secret_quarantined = true)::int AS secret_quarantined_rows,
            COUNT(*) FILTER (
              WHERE source_class = 'mcp-tool'
                 OR mcp_governed = true
                 OR mcp_approval_state IS NOT NULL
                 OR shadow_mcp_risk = true
            )::int AS total_shadow_rows,
            COUNT(*) FILTER (
              WHERE (source_class = 'mcp-tool' OR mcp_governed = true OR mcp_approval_state IS NOT NULL OR shadow_mcp_risk = true)
                AND mcp_governed = true
            )::int AS governed_shadow_rows,
            COUNT(*) FILTER (
              WHERE (source_class = 'mcp-tool' OR mcp_governed = true OR mcp_approval_state IS NOT NULL OR shadow_mcp_risk = true)
                AND mcp_governed = false
            )::int AS ungoverned_shadow_rows,
            COUNT(*) FILTER (WHERE review_shadow_mcp = true)::int AS review_shadow_rows,
            COUNT(*) FILTER (WHERE high_risk_shadow_mcp = true)::int AS high_risk_shadow_rows
            FROM ${latticeProjectionTable}
           ${projectionWhereClause}
        `,
        values
      );
      const retrievalShadow = await pool.query(
        `
          WITH filtered AS (
            SELECT memory_id, category, conflict_severity, operational_status, conflicting_memory_ids
              FROM ${latticeProjectionTable}
             ${projectionWhereClause}
          ),
          linked AS (
            SELECT DISTINCT linked.memory_id
              FROM filtered row
              CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(row.conflicting_memory_ids, '[]'::jsonb)) AS linked(memory_id)
              JOIN filtered target ON target.memory_id = linked.memory_id
             WHERE row.category = 'conflict-record'
               AND row.conflict_severity = 'hard'
               AND COALESCE(row.operational_status, 'active') NOT IN ('archived', 'deprecated', 'retired')
          )
          SELECT COUNT(*)::int AS retrieval_shadowed_rows
            FROM linked
        `,
        values
      );

      const total = Number(totals.rows[0]?.total ?? 0);
      const lastRaw = totals.rows[0]?.last_captured_at;
      const rowsWithLattice = Number(latticeCoverage.rows[0]?.rows_with_lattice ?? 0);
      const launchRow = launchFindings.rows[0] ?? {};
      const retrievalShadowRow = retrievalShadow.rows[0] ?? {};
      const backlog = {
        reviewNow: Number(latticeCoverage.rows[0]?.review_now ?? 0),
        revalidate: Number(latticeCoverage.rows[0]?.revalidate ?? 0),
        resolveConflict: Number(latticeCoverage.rows[0]?.resolve_conflict ?? 0),
        retire: Number(latticeCoverage.rows[0]?.retire ?? 0),
        folkloreRiskHigh: Number(latticeCoverage.rows[0]?.folklore_risk_high ?? 0),
      };
      return {
        total,
        lastCapturedAt: lastRaw ? new Date(String(lastRaw)).toISOString() : null,
        bySource: bySource.rows.map((row) => ({
          source: String(row.source ?? "manual"),
          count: Number(row.count ?? 0),
        })),
        byLayer: byLayer.rows.map((row) => ({
          layer: normalizeMemoryLayer(row.layer, "episodic"),
          count: Number(row.count ?? 0),
        })),
        byStatus: byStatus.rows.map((row) => ({
          status: parseStatus(row.status),
          count: Number(row.count ?? 0),
        })),
        lattice: {
          coverage: {
            rowsWithLattice,
            totalRows: total,
            ratio: total > 0 ? Number((rowsWithLattice / total).toFixed(3)) : 0,
          },
          byCategory: mapCountRows<MemoryCategory>(byCategory.rows, "category").map((row) => ({
            category: row.value,
            count: row.count,
          })),
          byTruthStatus: mapCountRows<MemoryTruthStatus>(byTruthStatus.rows, "status").map((row) => ({
            status: row.value,
            count: row.count,
          })),
          byFreshnessStatus: mapCountRows<MemoryFreshnessStatus>(byFreshnessStatus.rows, "status").map((row) => ({
            status: row.value,
            count: row.count,
          })),
          byOperationalStatus: mapCountRows<MemoryOperationalStatus>(byOperationalStatus.rows, "status").map((row) => ({
            status: row.value,
            count: row.count,
          })),
          byReviewAction: mapCountRows<MemoryReviewAction>(byReviewAction.rows, "action").map((row) => ({
            action: row.value,
            count: row.count,
          })),
          backlog,
        },
        reviewBacklog: backlog,
        conflictBacklog: {
          contestedRows: Number(launchRow.contested_rows ?? 0),
          hardConflicts: Number(launchRow.hard_conflicts ?? 0),
          quarantinedRows: Number(launchRow.quarantined_rows ?? 0),
          conflictRecords: Number(launchRow.conflict_records ?? 0),
          retrievalShadowedRows: Number(retrievalShadowRow.retrieval_shadowed_rows ?? 0),
        },
        startupReadiness: {
          startupEligibleRows: Number(launchRow.startup_eligible_rows ?? 0),
          trustedStartupRows: Number(launchRow.trusted_startup_rows ?? 0),
          handoffRows: Number(launchRow.handoff_rows ?? 0),
          checkpointRows: Number(launchRow.checkpoint_rows ?? 0),
          fallbackRiskRows: Number(launchRow.fallback_risk_rows ?? 0),
        },
        secretExposureFindings: {
          totalRows: total,
          redactedRows: Number(launchRow.redacted_rows ?? 0),
          requiresReviewRows: Number(launchRow.requires_review_rows ?? 0),
          canonicalBlockedRows: Number(launchRow.canonical_blocked_rows ?? 0),
          quarantinedRows: Number(launchRow.secret_quarantined_rows ?? 0),
        },
        shadowMcpFindings: {
          totalRows: Number(launchRow.total_shadow_rows ?? 0),
          governedRows: Number(launchRow.governed_shadow_rows ?? 0),
          ungovernedRows: Number(launchRow.ungoverned_shadow_rows ?? 0),
          reviewRows: Number(launchRow.review_shadow_rows ?? 0),
          highRiskRows: Number(launchRow.high_risk_shadow_rows ?? 0),
        },
      };
    },

    async indexSignals(input: MemoryIndexInput): Promise<void> {
      const tenantScope = normalizeTenantScope(input.tenantId);
      const memoryId = String(input.memoryId ?? "").trim();
      if (!memoryId) return;

      const edges = Array.isArray(input.edges)
        ? input.edges
            .map((edge) => ({
              targetId: String(edge?.targetId ?? "").trim(),
              relationType: normalizeRelationType(edge?.relationType),
              weight: clamp01(edge?.weight, 0.55),
              evidence:
                edge?.evidence && typeof edge.evidence === "object" && !Array.isArray(edge.evidence)
                  ? (edge.evidence as Record<string, unknown>)
                  : {},
            }))
            .filter((edge) => edge.targetId.length > 0 && edge.targetId !== memoryId)
            .slice(0, 64)
        : [];

      const entities = Array.isArray(input.entities)
        ? input.entities
            .map((entity) => ({
              entityType: normalizeEntityType(entity?.entityType),
              entityKey: normalizeEntityKey(entity?.entityKey),
              entityValue: String(entity?.entityValue ?? "").trim().slice(0, 240),
              confidence: clamp01(entity?.confidence, 0.55),
            }))
            .filter((entity) => entity.entityType.length > 0 && entity.entityKey.length > 0 && entity.entityValue.length > 0)
            .slice(0, 96)
        : [];

      const patterns = Array.isArray(input.patterns)
        ? input.patterns
            .map((pattern) => ({
              patternType: normalizePatternType(pattern?.patternType),
              patternKey: normalizePatternKey(pattern?.patternKey),
              patternValue: String(pattern?.patternValue ?? "").trim().slice(0, 240),
              confidence: clamp01(pattern?.confidence, 0.55),
            }))
            .filter((pattern) => pattern.patternType.length > 0 && pattern.patternKey.length > 0 && pattern.patternValue.length > 0)
            .slice(0, 128)
        : [];

      if (edges.length === 0 && entities.length === 0 && patterns.length === 0) return;

      try {
        await pool.query(
          `
          DELETE FROM memory_relation_edge
           WHERE tenant_scope = $1
             AND source_memory_id = $2
          `,
          [tenantScope, memoryId]
        );
        await pool.query(
          `
          DELETE FROM memory_entity_index
           WHERE tenant_scope = $1
             AND memory_id = $2
          `,
          [tenantScope, memoryId]
        );
        await pool.query(
          `
          DELETE FROM memory_pattern_index
           WHERE tenant_scope = $1
             AND memory_id = $2
          `,
          [tenantScope, memoryId]
        );

        for (const edge of edges) {
          await pool.query(
            `
            INSERT INTO memory_relation_edge (
              tenant_scope,
              source_memory_id,
              target_memory_id,
              relation_type,
              weight,
              evidence
            ) VALUES (
              $1, $2, $3, $4, $5, $6::jsonb
            )
            ON CONFLICT (tenant_scope, source_memory_id, target_memory_id, relation_type) DO UPDATE SET
              weight = GREATEST(memory_relation_edge.weight, EXCLUDED.weight),
              evidence = memory_relation_edge.evidence || EXCLUDED.evidence,
              updated_at = now()
            `,
            [tenantScope, memoryId, edge.targetId, edge.relationType, edge.weight, JSON.stringify(edge.evidence)]
          );
        }

        for (const entity of entities) {
          await pool.query(
            `
            INSERT INTO memory_entity_index (
              tenant_scope,
              memory_id,
              entity_type,
              entity_key,
              entity_value,
              confidence
            ) VALUES (
              $1, $2, $3, $4, $5, $6
            )
            ON CONFLICT (tenant_scope, memory_id, entity_type, entity_key) DO UPDATE SET
              entity_value = EXCLUDED.entity_value,
              confidence = GREATEST(memory_entity_index.confidence, EXCLUDED.confidence),
              updated_at = now()
            `,
            [tenantScope, memoryId, entity.entityType, entity.entityKey, entity.entityValue, entity.confidence]
          );
        }

        for (const pattern of patterns) {
          await pool.query(
            `
            INSERT INTO memory_pattern_index (
              tenant_scope,
              memory_id,
              pattern_type,
              pattern_key,
              pattern_value,
              confidence
            ) VALUES (
              $1, $2, $3, $4, $5, $6
            )
            ON CONFLICT (tenant_scope, memory_id, pattern_type, pattern_key) DO UPDATE SET
              pattern_value = EXCLUDED.pattern_value,
              confidence = GREATEST(memory_pattern_index.confidence, EXCLUDED.confidence),
              updated_at = now()
            `,
            [tenantScope, memoryId, pattern.patternType, pattern.patternKey, pattern.patternValue, pattern.confidence]
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes('relation "memory_relation_edge" does not exist') ||
          message.includes('relation "memory_entity_index" does not exist') ||
          message.includes('relation "memory_pattern_index" does not exist')
        ) {
          return;
        }
        throw error;
      }
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

      const edgeKeys = normalizeSignalEdgeKeys(input.edgeKeys, memoryId);
      const entityKeys = normalizeSignalEntityKeys(input.entityKeys);
      const patternKeys = normalizeSignalPatternKeys(input.patternKeys);
      if (edgeKeys.length === 0 && entityKeys.length === 0 && patternKeys.length === 0) {
        return {
          indexed: false,
          edgeMatches: 0,
          entityMatches: 0,
          patternMatches: 0,
        };
      }

      let edgeMatches = 0;
      let entityMatches = 0;
      let patternMatches = 0;

      try {
        if (edgeKeys.length > 0) {
          const edgeResult = await pool.query(
            `
            SELECT COUNT(*)::int AS count
              FROM memory_relation_edge
             WHERE tenant_scope = $1
               AND source_memory_id = $2
               AND (target_memory_id || '|' || relation_type) = ANY($3::text[])
            `,
            [tenantScope, memoryId, edgeKeys]
          );
          edgeMatches = Number(edgeResult.rows[0]?.count ?? 0);
        }

        if (entityKeys.length > 0) {
          const entityResult = await pool.query(
            `
            SELECT COUNT(*)::int AS count
              FROM memory_entity_index
             WHERE tenant_scope = $1
               AND memory_id = $2
               AND (entity_type || '|' || entity_key) = ANY($3::text[])
            `,
            [tenantScope, memoryId, entityKeys]
          );
          entityMatches = Number(entityResult.rows[0]?.count ?? 0);
        }

        if (patternKeys.length > 0) {
          const patternResult = await pool.query(
            `
            SELECT COUNT(*)::int AS count
              FROM memory_pattern_index
             WHERE tenant_scope = $1
               AND memory_id = $2
               AND (pattern_type || '|' || pattern_key) = ANY($3::text[])
            `,
            [tenantScope, memoryId, patternKeys]
          );
          patternMatches = Number(patternResult.rows[0]?.count ?? 0);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes('relation "memory_relation_edge" does not exist') ||
          message.includes('relation "memory_entity_index" does not exist') ||
          message.includes('relation "memory_pattern_index" does not exist')
        ) {
          return {
            indexed: false,
            edgeMatches: 0,
            entityMatches: 0,
            patternMatches: 0,
          };
        }
        throw error;
      }

      const indexed =
        (edgeKeys.length === 0 || edgeMatches >= edgeKeys.length) &&
        (entityKeys.length === 0 || entityMatches >= entityKeys.length) &&
        (patternKeys.length === 0 || patternMatches >= patternKeys.length);

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
      const limit = clampLimit(input.limit, 24);
      const explicitEntityHints = normalizeEntityHints(input.entityHints);
      const explicitPatternHints = normalizePatternHints(input.patternHints);

      if (seedIds.length === 0 && explicitEntityHints.length === 0 && explicitPatternHints.length === 0) {
        return [];
      }

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
        const entry = scored.get(memoryId) ?? {
          graphScore: 0,
          entityScore: 0,
          patternScore: 0,
          hops: 0,
          matchedBy: new Set<string>(),
          relationTypes: new Set<string>(),
        };
        entry.graphScore += Math.max(0, params.graphContribution ?? 0);
        entry.entityScore += Math.max(0, params.entityContribution ?? 0);
        entry.patternScore += Math.max(0, params.patternContribution ?? 0);
        entry.matchedBy.add(params.matchedBy);
        if (params.relationType) {
          entry.relationTypes.add(normalizeRelationType(params.relationType));
        }
        const hop = Math.max(0, Math.trunc(Number(params.hop ?? 0)));
        if (hop > 0 && (entry.hops === 0 || hop < entry.hops)) {
          entry.hops = hop;
        }
        scored.set(memoryId, entry);
      };

      try {
        if (seedIds.length > 0) {
          let frontier = [...seedIds];
          const visited = new Set(seedIds);
          for (let hop = 1; hop <= maxHops && frontier.length > 0; hop += 1) {
            const frontierSet = new Set(frontier);
            const traversalLimit = Math.max(64, limit * 10);
            const result = await pool.query(
              `
              SELECT
                source_memory_id,
                target_memory_id,
                relation_type,
                weight
                FROM memory_relation_edge
               WHERE tenant_scope = $1
                 AND (
                   source_memory_id = ANY($2::text[])
                   OR target_memory_id = ANY($2::text[])
                 )
               ORDER BY weight DESC, updated_at DESC
               LIMIT $3
              `,
              [tenantScope, frontier, traversalLimit]
            );

            const nextFrontier = new Set<string>();
            for (const row of result.rows) {
              const sourceId = String(row.source_memory_id ?? "").trim();
              const targetId = String(row.target_memory_id ?? "").trim();
              if (!sourceId || !targetId) continue;
              const sourceInFrontier = frontierSet.has(sourceId);
              const targetInFrontier = frontierSet.has(targetId);
              if (!sourceInFrontier && !targetInFrontier) continue;
              const candidateId = sourceInFrontier ? targetId : sourceId;
              const hopDecay = hop === 1 ? 1 : 1 / (hop * 1.35);
              const relationType = String(row.relation_type ?? "related");
              touch({
                memoryId: candidateId,
                graphContribution: clamp01(row.weight, 0.55) * hopDecay * relationWeightMultiplier(relationType),
                hop,
                matchedBy: "graph",
                relationType,
              });
              if (!visited.has(candidateId)) {
                visited.add(candidateId);
                nextFrontier.add(candidateId);
              }
            }
            frontier = Array.from(nextFrontier).slice(0, Math.max(32, limit * 8));
          }
        }

        const mergedEntityHints = new Map<string, MemoryEntityHint & { weight: number }>();
        for (const hint of explicitEntityHints) {
          mergedEntityHints.set(`${hint.entityType}|${hint.entityKey}`, hint);
        }

        if (seedIds.length > 0) {
          const seedEntityRows = await pool.query(
            `
            SELECT
              entity_type,
              entity_key,
              MAX(confidence) AS confidence
              FROM memory_entity_index
             WHERE tenant_scope = $1
               AND memory_id = ANY($2::text[])
             GROUP BY 1, 2
             ORDER BY MAX(confidence) DESC, entity_type ASC, entity_key ASC
             LIMIT 24
            `,
            [tenantScope, seedIds]
          );
          for (const row of seedEntityRows.rows) {
            const entityType = normalizeEntityType(row.entity_type);
            const entityKey = normalizeEntityKey(row.entity_key);
            if (!entityType || !entityKey) continue;
            const key = `${entityType}|${entityKey}`;
            if (mergedEntityHints.has(key)) continue;
            mergedEntityHints.set(key, {
              entityType,
              entityKey,
              weight: clamp01(row.confidence, 0.55) * 0.72,
            });
          }
        }

        if (mergedEntityHints.size > 0) {
          for (const hint of mergedEntityHints.values()) {
            const result = await pool.query(
              `
              SELECT memory_id, confidence
                FROM memory_entity_index
               WHERE tenant_scope = $1
                 AND entity_type = $2
                 AND entity_key = $3
               ORDER BY confidence DESC, updated_at DESC
              LIMIT $4
              `,
              [tenantScope, hint.entityType, hint.entityKey, Math.max(40, limit * 10)]
            );
            for (const row of result.rows) {
              touch({
                memoryId: String(row.memory_id ?? "").trim(),
                entityContribution: clamp01(row.confidence, 0.55) * hint.weight,
                matchedBy: "entity",
              });
            }
          }
        }

        const mergedPatternHints = new Map<string, { patternType: string; patternKey: string; weight: number }>();
        for (const hint of explicitPatternHints) {
          mergedPatternHints.set(`${hint.patternType}|${hint.patternKey}`, hint);
        }
        if (seedIds.length > 0) {
          const seedPatternRows = await pool.query(
            `
            SELECT
              pattern_type,
              pattern_key,
              MAX(confidence) AS confidence
              FROM memory_pattern_index
             WHERE tenant_scope = $1
               AND memory_id = ANY($2::text[])
             GROUP BY 1, 2
             ORDER BY MAX(confidence) DESC, pattern_type ASC, pattern_key ASC
             LIMIT 24
            `,
            [tenantScope, seedIds]
          );
          for (const row of seedPatternRows.rows) {
            const patternType = normalizePatternType(row.pattern_type);
            const patternKey = normalizePatternKey(row.pattern_key);
            if (!patternType || !patternKey) continue;
            const key = `${patternType}|${patternKey}`;
            if (mergedPatternHints.has(key)) continue;
            mergedPatternHints.set(key, {
              patternType,
              patternKey,
              weight: clamp01(row.confidence, 0.55) * 0.74,
            });
          }
        }

        if (mergedPatternHints.size > 0) {
          for (const hint of mergedPatternHints.values()) {
            const result = await pool.query(
              `
              SELECT memory_id, confidence
                FROM memory_pattern_index
               WHERE tenant_scope = $1
                 AND pattern_type = $2
                 AND pattern_key = $3
               ORDER BY confidence DESC, updated_at DESC
               LIMIT $4
              `,
              [tenantScope, hint.patternType, hint.patternKey, Math.max(40, limit * 10)]
            );
            for (const row of result.rows) {
              touch({
                memoryId: String(row.memory_id ?? "").trim(),
                patternContribution: clamp01(row.confidence, 0.55) * hint.weight,
                matchedBy: "pattern",
              });
            }
          }
        }

        const desiredStates = Array.from(mergedPatternHints.values())
          .filter((hint) => hint.patternType === "state")
          .map((hint) => normalizeLoopState(hint.patternKey));
        const desiredUnique = Array.from(new Set(desiredStates));
        if (desiredUnique.length > 0) {
          const loopStateRows = await pool.query(
            `
            SELECT
              p.memory_id,
              p.confidence AS pattern_confidence,
              l.current_state,
              l.last_state_confidence
              FROM memory_pattern_index p
              JOIN memory_loop_state l
                ON l.tenant_scope = p.tenant_scope
               AND l.loop_key = p.pattern_key
             WHERE p.tenant_scope = $1
               AND p.pattern_type = 'loop-cluster'
               AND l.current_state = ANY($2::text[])
             ORDER BY l.last_seen_at DESC, p.confidence DESC
             LIMIT $3
            `,
            [tenantScope, desiredUnique, Math.max(64, limit * 12)]
          );
          for (const row of loopStateRows.rows) {
            touch({
              memoryId: String(row.memory_id ?? "").trim(),
              patternContribution: clamp01(row.pattern_confidence, 0.55) * clamp01(row.last_state_confidence, 0.6) * 0.92,
              matchedBy: "pattern",
            });
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes('relation "memory_relation_edge" does not exist') ||
          message.includes('relation "memory_entity_index" does not exist') ||
          message.includes('relation "memory_pattern_index" does not exist') ||
          message.includes('relation "memory_loop_state" does not exist')
        ) {
          return [];
        }
        throw error;
      }

      return Array.from(scored.entries())
        .map(([id, row]): MemoryRelatedResult => {
          const synergy = row.matchedBy.size > 1 ? 0.08 : 0;
          const score = Math.min(2, row.graphScore * 0.8 + row.entityScore * 0.76 + row.patternScore * 0.74 + synergy);
          return {
            id,
            score,
            graphScore: row.graphScore,
            entityScore: row.entityScore,
            patternScore: row.patternScore,
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
      const confidence = clamp01(input.confidence, 0.62);
      try {
        const previous = await pool.query(
          `
          SELECT current_state, last_state_confidence
            FROM memory_loop_state
           WHERE tenant_scope = $1
             AND loop_key = $2
           LIMIT 1
          `,
          [tenantScope, loopKey]
        );
        const previousState =
          previous.rowCount && previous.rows[0] ? normalizeLoopState(previous.rows[0].current_state) : null;
        const previousConfidence =
          previous.rowCount && previous.rows[0] ? clamp01(previous.rows[0].last_state_confidence, 0.5) : null;
        await pool.query(
          `
          INSERT INTO memory_loop_state (
            tenant_scope,
            loop_key,
            current_state,
            last_state_confidence,
            last_memory_id,
            last_open_memory_id,
            last_resolved_memory_id,
            open_events,
            resolved_events,
            reopened_events,
            superseded_events,
            first_seen_at,
            last_seen_at,
            updated_at,
            metadata
          ) VALUES (
            $1, $2, $3, $4, $5,
            CASE WHEN $3 IN ('open-loop', 'reopened') THEN $5 ELSE NULL END,
            CASE WHEN $3 = 'resolved' THEN $5 ELSE NULL END,
            CASE WHEN $3 = 'open-loop' THEN 1 ELSE 0 END,
            CASE WHEN $3 = 'resolved' THEN 1 ELSE 0 END,
            CASE WHEN $3 = 'reopened' THEN 1 ELSE 0 END,
            CASE WHEN $3 = 'superseded' THEN 1 ELSE 0 END,
            COALESCE($6::timestamptz, now()),
            COALESCE($6::timestamptz, now()),
            now(),
            $7::jsonb
          )
          ON CONFLICT (tenant_scope, loop_key) DO UPDATE SET
            current_state = EXCLUDED.current_state,
            last_state_confidence = EXCLUDED.last_state_confidence,
            last_memory_id = EXCLUDED.last_memory_id,
            last_open_memory_id = CASE
              WHEN EXCLUDED.current_state IN ('open-loop', 'reopened') THEN EXCLUDED.last_memory_id
              ELSE memory_loop_state.last_open_memory_id
            END,
            last_resolved_memory_id = CASE
              WHEN EXCLUDED.current_state = 'resolved' THEN EXCLUDED.last_memory_id
              ELSE memory_loop_state.last_resolved_memory_id
            END,
            open_events = memory_loop_state.open_events + CASE WHEN EXCLUDED.current_state = 'open-loop' THEN 1 ELSE 0 END,
            resolved_events = memory_loop_state.resolved_events + CASE WHEN EXCLUDED.current_state = 'resolved' THEN 1 ELSE 0 END,
            reopened_events = memory_loop_state.reopened_events + CASE WHEN EXCLUDED.current_state = 'reopened' THEN 1 ELSE 0 END,
            superseded_events = memory_loop_state.superseded_events + CASE WHEN EXCLUDED.current_state = 'superseded' THEN 1 ELSE 0 END,
            last_seen_at = COALESCE($6::timestamptz, now()),
            updated_at = now(),
            metadata = memory_loop_state.metadata || EXCLUDED.metadata
          `,
          [
            tenantScope,
            loopKey,
            state,
            confidence,
            memoryId,
            input.occurredAt ?? null,
            JSON.stringify(
              input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
                ? input.metadata
                : {}
            ),
          ]
        );
        try {
          await pool.query(
            `
            INSERT INTO memory_loop_transition_event (
              event_id,
              tenant_scope,
              loop_key,
              from_state,
              to_state,
              confidence,
              memory_id,
              occurred_at,
              metadata
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()), $9::jsonb
            )
            `,
            [
              `mlte_${randomUUID()}`,
              tenantScope,
              loopKey,
              previousState,
              state,
              confidence,
              memoryId,
              input.occurredAt ?? null,
              JSON.stringify({
                previousConfidence,
                metadata:
                  input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
                    ? input.metadata
                    : {},
              }),
            ]
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes('relation "memory_loop_transition_event" does not exist')) {
            throw error;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('relation "memory_loop_state" does not exist')) {
          return;
        }
        throw error;
      }
    },

    async searchLoopState(input: MemoryLoopStateSearchInput): Promise<MemoryLoopStateResult[]> {
      const tenantScope = normalizeTenantScope(input.tenantId);
      const loopKeys = normalizeIdList(input.loopKeys, 200).map((value) => normalizeLoopKey(value)).filter(Boolean);
      const states = Array.from(new Set((input.states ?? []).map((value) => normalizeLoopState(value))));
      const limit = clampLimit(input.limit, 40);
      const values: unknown[] = [tenantScope];
      const predicates: string[] = ["tenant_scope = $1"];
      if (loopKeys.length > 0) {
        values.push(loopKeys);
        predicates.push(`loop_key = ANY($${values.length}::text[])`);
      }
      if (states.length > 0) {
        values.push(states);
        predicates.push(`current_state = ANY($${values.length}::text[])`);
      }
      values.push(limit);
      try {
        try {
          const result = await pool.query(
            `
            SELECT
              s.loop_key,
              s.current_state,
              s.last_state_confidence,
              s.last_memory_id,
              s.last_open_memory_id,
              s.last_resolved_memory_id,
              s.open_events,
              s.resolved_events,
              s.reopened_events,
              s.superseded_events,
              s.updated_at,
              COALESCE(t.recent_transitions_7d, 0) AS recent_transitions_7d,
              COALESCE(t.recent_reopened_7d, 0) AS recent_reopened_7d,
              COALESCE(t.recent_resolved_7d, 0) AS recent_resolved_7d,
              t.last_transition_at
              FROM memory_loop_state s
              LEFT JOIN LATERAL (
                SELECT
                  COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS recent_transitions_7d,
                  COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days' AND to_state = 'reopened')::int AS recent_reopened_7d,
                  COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days' AND to_state = 'resolved')::int AS recent_resolved_7d,
                  MAX(created_at) AS last_transition_at
                  FROM memory_loop_transition_event e
                 WHERE e.tenant_scope = s.tenant_scope
                   AND e.loop_key = s.loop_key
              ) t ON TRUE
             WHERE ${predicates.map((predicate) => predicate.replace(/\btenant_scope\b/g, "s.tenant_scope")).join(" AND ")}
             ORDER BY s.last_seen_at DESC, s.updated_at DESC
             LIMIT $${values.length}
            `,
            values
          );
          return result.rows.map((row) => ({
            loopKey: normalizeLoopKey(row.loop_key),
            currentState: normalizeLoopState(row.current_state),
            confidence: clamp01(row.last_state_confidence, 0.5),
            lastMemoryId: row.last_memory_id ? String(row.last_memory_id) : null,
            lastOpenMemoryId: row.last_open_memory_id ? String(row.last_open_memory_id) : null,
            lastResolvedMemoryId: row.last_resolved_memory_id ? String(row.last_resolved_memory_id) : null,
            openEvents: Number(row.open_events ?? 0),
            resolvedEvents: Number(row.resolved_events ?? 0),
            reopenedEvents: Number(row.reopened_events ?? 0),
            supersededEvents: Number(row.superseded_events ?? 0),
            updatedAt: parseDate(row.updated_at),
            recentTransitions7d: Number(row.recent_transitions_7d ?? 0),
            recentReopened7d: Number(row.recent_reopened_7d ?? 0),
            recentResolved7d: Number(row.recent_resolved_7d ?? 0),
            lastTransitionAt: row.last_transition_at ? parseDate(row.last_transition_at) : null,
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes('relation "memory_loop_transition_event" does not exist')) {
            throw error;
          }
          const result = await pool.query(
            `
            SELECT
              loop_key,
              current_state,
              last_state_confidence,
              last_memory_id,
              last_open_memory_id,
              last_resolved_memory_id,
              open_events,
              resolved_events,
              reopened_events,
              superseded_events,
              updated_at
              FROM memory_loop_state
             WHERE ${predicates.join(" AND ")}
             ORDER BY last_seen_at DESC, updated_at DESC
             LIMIT $${values.length}
            `,
            values
          );
          return result.rows.map((row) => ({
            loopKey: normalizeLoopKey(row.loop_key),
            currentState: normalizeLoopState(row.current_state),
            confidence: clamp01(row.last_state_confidence, 0.5),
            lastMemoryId: row.last_memory_id ? String(row.last_memory_id) : null,
            lastOpenMemoryId: row.last_open_memory_id ? String(row.last_open_memory_id) : null,
            lastResolvedMemoryId: row.last_resolved_memory_id ? String(row.last_resolved_memory_id) : null,
            openEvents: Number(row.open_events ?? 0),
            resolvedEvents: Number(row.resolved_events ?? 0),
            reopenedEvents: Number(row.reopened_events ?? 0),
            supersededEvents: Number(row.superseded_events ?? 0),
            updatedAt: parseDate(row.updated_at),
            recentTransitions7d: 0,
            recentReopened7d: 0,
            recentResolved7d: 0,
            lastTransitionAt: null,
          }));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('relation "memory_loop_state" does not exist')) {
          return [];
        }
        throw error;
      }
    },

    async recordLoopFeedback(input: MemoryLoopFeedbackUpsertInput): Promise<void> {
      const tenantScope = normalizeTenantScope(input.tenantId);
      const loopKey = normalizeLoopKey(input.loopKey);
      if (!loopKey) return;
      const action = normalizeLoopFeedbackAction(input.action);
      const incidentId = String(input.incidentId ?? "").trim() || null;
      const memoryId = String(input.memoryId ?? "").trim() || null;
      const actorId = String(input.actorId ?? "").trim() || null;
      const note = String(input.note ?? "").trim() || null;
      const metadata =
        input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? input.metadata : {};
      try {
        await pool.query(
          `
          INSERT INTO memory_loop_feedback_event (
            event_id,
            tenant_scope,
            loop_key,
            action,
            actor_id,
            incident_id,
            memory_id,
            note,
            occurred_at,
            metadata
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, now()), $10::jsonb
          )
          `,
          [
            `mlfe_${randomUUID()}`,
            tenantScope,
            loopKey,
            action,
            actorId,
            incidentId,
            memoryId,
            note,
            input.occurredAt ?? null,
            JSON.stringify(metadata),
          ]
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('relation "memory_loop_feedback_event" does not exist')) {
          return;
        }
        throw error;
      }
    },

    async searchLoopFeedbackStats(input: MemoryLoopFeedbackStatsInput): Promise<MemoryLoopFeedbackStatsResult[]> {
      const tenantScope = normalizeTenantScope(input.tenantId);
      const loopKeys = normalizeIdList(input.loopKeys, 220).map((value) => normalizeLoopKey(value)).filter(Boolean);
      const limit = clampLimit(input.limit, 120);
      const windowDays = Math.max(1, Math.min(3650, Number.isFinite(input.windowDays) ? Number(input.windowDays) : 120));
      const values: unknown[] = [tenantScope];
      const predicates: string[] = ["tenant_scope = $1", `occurred_at >= now() - make_interval(days => $2::int)`];
      values.push(windowDays);
      if (loopKeys.length > 0) {
        values.push(loopKeys);
        predicates.push(`loop_key = ANY($${values.length}::text[])`);
      }
      values.push(limit);
      try {
        const result = await pool.query(
          `
          SELECT
            loop_key,
            COUNT(*) FILTER (WHERE action = 'ack')::int AS ack_count,
            COUNT(*) FILTER (WHERE action = 'assign')::int AS assign_count,
            COUNT(*) FILTER (WHERE action = 'snooze')::int AS snooze_count,
            COUNT(*) FILTER (WHERE action = 'resolve')::int AS resolve_count,
            COUNT(*) FILTER (WHERE action = 'false-positive')::int AS false_positive_count,
            COUNT(*) FILTER (WHERE action = 'escalate')::int AS escalate_count,
            COUNT(*)::int AS total_count,
            MAX(occurred_at) AS last_action_at
            FROM memory_loop_feedback_event
           WHERE ${predicates.join(" AND ")}
           GROUP BY loop_key
           ORDER BY
             (COUNT(*) FILTER (WHERE action = 'escalate') + COUNT(*) FILTER (WHERE action = 'resolve')) DESC,
             (COUNT(*) FILTER (WHERE action = 'false-positive')) ASC,
             MAX(occurred_at) DESC
           LIMIT $${values.length}
          `,
          values
        );
        return result.rows.map((row) => ({
          loopKey: normalizeLoopKey(row.loop_key),
          ackCount: Number(row.ack_count ?? 0),
          assignCount: Number(row.assign_count ?? 0),
          snoozeCount: Number(row.snooze_count ?? 0),
          resolveCount: Number(row.resolve_count ?? 0),
          falsePositiveCount: Number(row.false_positive_count ?? 0),
          escalateCount: Number(row.escalate_count ?? 0),
          totalCount: Number(row.total_count ?? 0),
          lastActionAt: row.last_action_at ? parseDate(row.last_action_at) : null,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('relation "memory_loop_feedback_event" does not exist')) {
          return [];
        }
        throw error;
      }
    },

    async lookupLoopActionIdempotency(
      input: MemoryLoopActionIdempotencyLookupInput
    ): Promise<MemoryLoopActionIdempotencyLookupResult | null> {
      const tenantScope = normalizeTenantScope(input.tenantId);
      const idempotencyKey = String(input.idempotencyKey ?? "").trim();
      if (!idempotencyKey) return null;
      try {
        const result = await pool.query(
          `
          SELECT
            idempotency_key,
            request_hash,
            response_json,
            created_at,
            last_seen_at
            FROM memory_loop_action_idempotency
           WHERE tenant_scope = $1
             AND idempotency_key = $2
             AND (expires_at IS NULL OR expires_at >= now())
           LIMIT 1
          `,
          [tenantScope, idempotencyKey]
        );
        if (!result.rowCount || !result.rows[0]) return null;
        const row = result.rows[0];
        await pool.query(
          `
          UPDATE memory_loop_action_idempotency
             SET last_seen_at = now()
           WHERE tenant_scope = $1
             AND idempotency_key = $2
          `,
          [tenantScope, idempotencyKey]
        );
        return {
          idempotencyKey: String(row.idempotency_key ?? ""),
          requestHash: String(row.request_hash ?? ""),
          responseJson: asRecord(row.response_json),
          createdAt: parseDate(row.created_at),
          lastSeenAt: parseDate(row.last_seen_at),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('relation "memory_loop_action_idempotency" does not exist')) {
          return null;
        }
        throw error;
      }
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
      const pendingResponseJson =
        input.pendingResponseJson && typeof input.pendingResponseJson === "object" && !Array.isArray(input.pendingResponseJson)
          ? input.pendingResponseJson
          : { _pending: true };
      try {
        const inserted = await pool.query(
          `
          INSERT INTO memory_loop_action_idempotency (
            tenant_scope,
            idempotency_key,
            request_hash,
            response_json,
            created_at,
            last_seen_at,
            expires_at
          ) VALUES (
            $1, $2, $3, $4::jsonb, now(), now(), now() + interval '30 days'
          )
          ON CONFLICT (tenant_scope, idempotency_key) DO NOTHING
          RETURNING idempotency_key, request_hash, response_json, created_at, last_seen_at
          `,
          [tenantScope, idempotencyKey, requestHash, JSON.stringify(pendingResponseJson)]
        );
        if (inserted.rowCount && inserted.rows[0]) {
          return { status: "claimed", entry: null };
        }

        const result = await pool.query(
          `
          SELECT
            idempotency_key,
            request_hash,
            response_json,
            created_at,
            last_seen_at
            FROM memory_loop_action_idempotency
           WHERE tenant_scope = $1
             AND idempotency_key = $2
             AND (expires_at IS NULL OR expires_at >= now())
           LIMIT 1
          `,
          [tenantScope, idempotencyKey]
        );
        if (!result.rowCount || !result.rows[0]) {
          return { status: "conflict", entry: null };
        }
        const row = result.rows[0];
        await pool.query(
          `
          UPDATE memory_loop_action_idempotency
             SET last_seen_at = now()
           WHERE tenant_scope = $1
             AND idempotency_key = $2
          `,
          [tenantScope, idempotencyKey]
        );
        const entry: MemoryLoopActionIdempotencyLookupResult = {
          idempotencyKey: String(row.idempotency_key ?? ""),
          requestHash: String(row.request_hash ?? ""),
          responseJson: asRecord(row.response_json),
          createdAt: parseDate(row.created_at),
          lastSeenAt: parseDate(row.last_seen_at),
        };
        if (entry.requestHash !== requestHash) {
          return { status: "conflict", entry };
        }
        const isPending = entry.responseJson && entry.responseJson._pending === true;
        if (isPending) {
          return { status: "in-flight", entry };
        }
        return { status: "existing", entry };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('relation "memory_loop_action_idempotency" does not exist')) {
          return { status: "claimed", entry: null };
        }
        throw error;
      }
    },

    async storeLoopActionIdempotency(input: MemoryLoopActionIdempotencyStoreInput): Promise<void> {
      const tenantScope = normalizeTenantScope(input.tenantId);
      const idempotencyKey = String(input.idempotencyKey ?? "").trim();
      const requestHash = String(input.requestHash ?? "").trim();
      if (!idempotencyKey || !requestHash) return;
      const responseJson = asRecord(input.responseJson);
      try {
        await pool.query(
          `
          INSERT INTO memory_loop_action_idempotency (
            tenant_scope,
            idempotency_key,
            request_hash,
            response_json,
            created_at,
            last_seen_at,
            expires_at
          ) VALUES (
            $1, $2, $3, $4::jsonb, now(), now(), now() + interval '30 days'
          )
          ON CONFLICT (tenant_scope, idempotency_key) DO UPDATE SET
            request_hash = EXCLUDED.request_hash,
            response_json = EXCLUDED.response_json,
            last_seen_at = now(),
            expires_at = now() + interval '30 days'
          `,
          [tenantScope, idempotencyKey, requestHash, JSON.stringify(responseJson)]
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('relation "memory_loop_action_idempotency" does not exist')) {
          return;
        }
        throw error;
      }
    },

    async healthcheck() {
      const startedAt = Date.now();
      try {
        await pool.query(`SELECT 1 FROM ${tableName} LIMIT 1`);
        return { ok: true, latencyMs: Date.now() - startedAt };
      } catch (error) {
        return {
          ok: false,
          latencyMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
