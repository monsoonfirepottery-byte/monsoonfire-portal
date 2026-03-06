import type { Logger } from "../config/logger";
import { readEnv } from "../config/env";
import type { MemoryStatus, MemoryType, RetrievalMode } from "../memory/contracts";
import { getPgPool } from "../db/postgres";
import { withRetry } from "./retry";

export type SwarmMemory = {
  id: string;
  agentId: string;
  runId: string;
  tenantId: string | null;
  content: string;
  contextualizedContent: string;
  embedding: number[] | null;
  metadata: Record<string, unknown>;
  occurredAt: string | null;
  status: MemoryStatus;
  memoryType: MemoryType;
  sourceConfidence: number;
  importance: number;
  fingerprint: string | null;
  embeddingModel: string | null;
  embeddingVersion: number;
};

export type VectorSearchResult = {
  id: string;
  tenantId: string | null;
  agentId: string;
  runId: string;
  score: number;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  occurredAt: string | null;
  status: MemoryStatus;
  memoryType: MemoryType;
  sourceConfidence: number;
  importance: number;
  matchedBy: string[];
  scoreBreakdown: {
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
};

export type VectorStoreHealth = {
  ok: boolean;
  latencyMs: number;
  error?: string;
  vectorEnabled?: boolean;
};

export type VectorStore = {
  upsertMemory: (item: SwarmMemory) => Promise<void>;
  searchMemory: (params: {
    query: string;
    embedding?: number[];
    limit?: number;
    tenantId?: string | null;
    agentId?: string;
    runId?: string;
    sourceAllowlist?: string[];
    sourceDenylist?: string[];
    retrievalMode?: RetrievalMode;
    minScore?: number;
    explain?: boolean;
  }) => Promise<VectorSearchResult[]>;
  healthcheck: () => Promise<VectorStoreHealth>;
};

type ScoredLane = {
  lane: "semantic" | "lexical" | "session";
  id: string;
  tenantId: string | null;
  agentId: string;
  runId: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  occurredAt: string | null;
  status: MemoryStatus;
  memoryType: MemoryType;
  sourceConfidence: number;
  importance: number;
  laneScore: number;
};

type EmbeddingStorageMode = "vector" | "float8-array" | "none";

function clampLimit(limit: number | undefined): number {
  const raw = Number.isFinite(limit ?? Number.NaN) ? Number(limit) : 10;
  return Math.max(1, Math.min(raw, 100));
}

function clamp01(value: unknown, fallback = 0.5): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function sanitizeVector(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    .map((item) => Number(item.toFixed(6)));
}

function sanitizeSourceList(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value ?? "").trim()).filter(Boolean);
}

function normalizeRetrievalMode(raw: RetrievalMode | undefined): RetrievalMode {
  if (raw === "semantic" || raw === "lexical") return raw;
  return "hybrid";
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

function parseMemoryStatus(value: unknown): MemoryStatus {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "accepted" || raw === "quarantined" || raw === "archived") return raw;
  return "proposed";
}

function parseMemoryType(value: unknown): MemoryType {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "working" || raw === "semantic" || raw === "procedural") return raw;
  return "episodic";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function withQueryTimeout<T>(timeoutMs: number, label: string, task: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`vector store ${label} query timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([task(), timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function isFingerprintDuplicateError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /duplicate key value violates unique constraint.*idx_swarm_memory_tenant_fingerprint_unique/i.test(message);
}

function noOpLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function halfLifeDays(memoryType: MemoryType): number {
  if (memoryType === "working") return 3;
  if (memoryType === "episodic") return 30;
  if (memoryType === "semantic") return 180;
  return 365;
}

function recencyScore(occurredAt: string | null, createdAt: string, memoryType: MemoryType): number {
  const ts = Date.parse(occurredAt || createdAt);
  if (!Number.isFinite(ts)) return 0.5;
  const ageDays = Math.max(0, Date.now() - ts) / 86_400_000;
  return Math.exp(-ageDays / halfLifeDays(memoryType));
}

function toScoredLane(row: Record<string, unknown>, lane: ScoredLane["lane"]): ScoredLane {
  return {
    lane,
    id: String(row.memory_id ?? ""),
    tenantId: row.tenant_id === null ? null : String(row.tenant_id ?? ""),
    agentId: String(row.agent_id ?? "memory-api"),
    runId: String(row.run_id ?? "memory-run"),
    content: String(row.content ?? ""),
    metadata: asRecord(row.metadata),
    createdAt: parseDate(row.created_at),
    occurredAt: parseNullableDate(row.occurred_at),
    status: parseMemoryStatus(row.status),
    memoryType: parseMemoryType(row.memory_type),
    sourceConfidence: clamp01(row.source_confidence),
    importance: clamp01(row.importance),
    laneScore: Number(row.lane_score ?? 0),
  };
}

function createScopedFilter(options: {
  tenantId?: string | null;
  agentId?: string;
  runId?: string;
  sourceAllowlist?: string[];
  sourceDenylist?: string[];
}) {
  const values: unknown[] = [];
  const predicates: string[] = [];
  const push = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  predicates.push(`tenant_id IS NOT DISTINCT FROM ${push(options.tenantId ?? null)}`);
  predicates.push("status <> 'quarantined'");

  const agentId = String(options.agentId ?? "").trim();
  if (agentId) {
    predicates.push(`agent_id = ${push(agentId)}`);
  }
  const runId = String(options.runId ?? "").trim();
  if (runId) {
    predicates.push(`run_id = ${push(runId)}`);
  }

  const allow = sanitizeSourceList(options.sourceAllowlist);
  if (allow.length > 0) {
    predicates.push(`COALESCE(metadata->>'source', 'manual') = ANY(${push(allow)}::text[])`);
  }

  const deny = sanitizeSourceList(options.sourceDenylist);
  if (deny.length > 0) {
    predicates.push(`COALESCE(metadata->>'source', 'manual') <> ALL(${push(deny)}::text[])`);
  }

  return {
    values,
    push,
    where: predicates.join(" AND "),
  };
}

async function hasPgExtension(extname: string): Promise<boolean> {
  const pool = getPgPool();
  const result = await pool.query(
    `
    SELECT 1
      FROM pg_extension
     WHERE extname = $1
    `,
    [extname]
  );
  return (result.rowCount ?? 0) > 0;
}

async function detectEmbeddingStorageMode(): Promise<EmbeddingStorageMode> {
  const pool = getPgPool();
  const result = await pool.query(
    `
    SELECT format_type(a.atttypid, a.atttypmod) AS type_name
      FROM pg_attribute a
      JOIN pg_class c
        ON c.oid = a.attrelid
      JOIN pg_namespace n
        ON n.oid = c.relnamespace
     WHERE c.relname = 'swarm_memory'
       AND a.attname = 'embedding'
       AND a.attnum > 0
       AND NOT a.attisdropped
     ORDER BY (n.nspname = 'public') DESC, n.nspname ASC
     LIMIT 1
    `
  );
  const typeName = String(result.rows?.[0]?.type_name ?? "").trim().toLowerCase();
  if (!typeName) return "none";
  if (typeName.includes("vector")) return "vector";
  if (typeName.includes("double precision[]") || typeName.includes("real[]")) return "float8-array";
  return "none";
}

export async function createVectorStore(logger: Logger = noOpLogger()): Promise<VectorStore> {
  const supportsVector = await hasPgExtension("vector");
  const supportsPgTrgm = await hasPgExtension("pg_trgm");
  const embeddingStorageMode = await detectEmbeddingStorageMode();
  const pool = getPgPool();
  const queryTimeoutMs = Math.max(500, readEnv().STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS ?? 5_000);
  const semanticLaneEnabled = supportsVector && embeddingStorageMode !== "none";

  if (supportsVector && embeddingStorageMode === "float8-array") {
    logger.warn("vector_store_embedding_column_legacy_array_mode", {
      message:
        "swarm_memory.embedding is double precision[]; running in compatibility mode with runtime casts to vector.",
    });
  } else if (supportsVector && embeddingStorageMode === "none") {
    logger.warn("vector_store_embedding_column_missing", {
      message: "swarm_memory.embedding column is unavailable; semantic lane disabled until schema is upgraded.",
    });
  }

  const upsertMemory = async (item: SwarmMemory): Promise<void> => {
    const baseValues = [
      item.id,
      item.agentId,
      item.runId,
      item.tenantId,
      item.content,
      item.contextualizedContent,
      JSON.stringify(item.metadata),
      item.occurredAt,
      item.status,
      item.memoryType,
      clamp01(item.sourceConfidence),
      clamp01(item.importance),
      item.fingerprint,
      item.embeddingModel,
      Math.max(1, Math.trunc(item.embeddingVersion || 1)),
    ];
    await withRetry(
      "vector_store_upsert",
      async () => {
        const sanitizedEmbedding = sanitizeVector(item.embedding);
        const hasEmbedding = sanitizedEmbedding.length > 0;
        const embeddingColumnEnabled = embeddingStorageMode !== "none";
        const embeddingWriteEnabled = embeddingColumnEnabled && hasEmbedding;
        const embeddingValue =
          embeddingStorageMode === "vector"
            ? hasEmbedding
              ? JSON.stringify(sanitizedEmbedding)
              : null
            : hasEmbedding
              ? sanitizedEmbedding
              : null;
        const embeddingCast =
          embeddingStorageMode === "vector"
            ? "$16::vector"
            : embeddingStorageMode === "float8-array"
              ? "$16::double precision[]"
              : "";
        const query = `
          INSERT INTO swarm_memory (
            memory_id,
            agent_id,
            run_id,
            tenant_id,
            content,
            contextualized_content,
            metadata,
            occurred_at,
            status,
            memory_type,
            source_confidence,
            importance,
            fingerprint,
            embedding_model,
            embedding_version${embeddingWriteEnabled ? ", embedding" : ""},
            first_seen_at,
            last_seen_at,
            created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz, $9, $10, $11, $12, $13, $14, $15${
              embeddingWriteEnabled ? `, ${embeddingCast}` : ""
            }, now(), now(), now()
          )
          ON CONFLICT (memory_id) DO UPDATE SET
            agent_id = EXCLUDED.agent_id,
            run_id = EXCLUDED.run_id,
            tenant_id = EXCLUDED.tenant_id,
            content = EXCLUDED.content,
            contextualized_content = EXCLUDED.contextualized_content,
            metadata = EXCLUDED.metadata,
            occurred_at = COALESCE(LEAST(swarm_memory.occurred_at, EXCLUDED.occurred_at), swarm_memory.occurred_at, EXCLUDED.occurred_at),
            status = EXCLUDED.status,
            memory_type = EXCLUDED.memory_type,
            source_confidence = EXCLUDED.source_confidence,
            importance = EXCLUDED.importance,
            fingerprint = EXCLUDED.fingerprint,
            embedding_model = EXCLUDED.embedding_model,
            embedding_version = EXCLUDED.embedding_version${
              embeddingWriteEnabled ? ", embedding = EXCLUDED.embedding" : ""
            },
            first_seen_at = LEAST(swarm_memory.first_seen_at, EXCLUDED.first_seen_at),
            last_seen_at = now()
          `;
        const values = embeddingWriteEnabled ? [...baseValues, embeddingValue] : baseValues;
        try {
          await withQueryTimeout(queryTimeoutMs, "upsert", () => pool.query(query, values));
        } catch (error) {
          if (isFingerprintDuplicateError(error)) {
            logger.debug("vector_store_upsert_duplicate_fingerprint_skipped", {
              memoryId: item.id,
              fingerprint: item.fingerprint ?? null,
            });
            return;
          }
          throw error;
        }
      },
      logger,
      { attempts: 3, baseDelayMs: 50 }
    );
  };

  const searchMemory = async (params: {
    query: string;
    embedding?: number[];
    limit?: number;
    tenantId?: string | null;
    agentId?: string;
    runId?: string;
    sourceAllowlist?: string[];
    sourceDenylist?: string[];
    retrievalMode?: RetrievalMode;
    minScore?: number;
    explain?: boolean;
  }): Promise<VectorSearchResult[]> => {
    const bounded = clampLimit(params.limit);
    const candidateLimit = Math.max(20, Math.min(200, bounded * 6));
    const retrievalMode = normalizeRetrievalMode(params.retrievalMode);
    const vector = sanitizeVector(params.embedding);
    const hasSemanticQuery = semanticLaneEnabled && vector.length > 0;
    const useSemanticLane = retrievalMode !== "lexical" && hasSemanticQuery;
    const useLexicalLane = retrievalMode !== "semantic" || !hasSemanticQuery;
    const useSessionLane = Boolean(String(params.runId ?? "").trim() || String(params.agentId ?? "").trim());
    const queryText = String(params.query ?? "").trim();
    const laneRows: ScoredLane[] = [];

    if (useSemanticLane) {
      const scoped = createScopedFilter({
        tenantId: params.tenantId ?? null,
        agentId: params.agentId,
        runId: params.runId,
        sourceAllowlist: params.sourceAllowlist,
        sourceDenylist: params.sourceDenylist,
      });
      const vectorRef = scoped.push(JSON.stringify(vector));
      const vectorDimsRef = embeddingStorageMode === "float8-array" ? scoped.push(vector.length) : "";
      const limitRef = scoped.push(candidateLimit);
      const distanceExpr =
        embeddingStorageMode === "float8-array"
          ? `(embedding::vector <=> ${vectorRef}::vector)`
          : `embedding <=> ${vectorRef}::vector`;
      const semanticResult = await withRetry(
        "vector_store_search_semantic",
        async () =>
          withQueryTimeout(
            queryTimeoutMs,
            "search-semantic",
            () =>
              pool.query(
                `
                SELECT
                  memory_id,
                  tenant_id,
                  agent_id,
                  run_id,
                  content,
                  metadata,
                  created_at,
                  occurred_at,
                  status,
                  memory_type,
                  source_confidence,
                  importance,
                  1 - (${distanceExpr}) AS lane_score
                  FROM swarm_memory
                 WHERE ${scoped.where}
                   AND embedding IS NOT NULL
                   ${embeddingStorageMode === "float8-array" ? `AND array_length(embedding, 1) = ${vectorDimsRef}` : ""}
                 ORDER BY ${distanceExpr}
                 LIMIT ${limitRef}
                `,
                scoped.values
              )
          ),
        logger,
        { attempts: 1 }
      );
      laneRows.push(...semanticResult.rows.map((row) => toScoredLane(row as Record<string, unknown>, "semantic")));
    }

    if (useLexicalLane) {
      const scoped = createScopedFilter({
        tenantId: params.tenantId ?? null,
        agentId: params.agentId,
        runId: params.runId,
        sourceAllowlist: params.sourceAllowlist,
        sourceDenylist: params.sourceDenylist,
      });
      const textExpr = "COALESCE(contextualized_content, content)";
      const likeRef = scoped.push(`%${queryText}%`);
      const limitRef = scoped.push(candidateLimit);
      const lexicalResult =
        queryText.length < 2
          ? await withRetry(
              "vector_store_search_lexical_short_query",
              async () =>
                withQueryTimeout(
                  queryTimeoutMs,
                  "search-lexical-short",
                  () =>
                    pool.query(
                      `
                      SELECT
                        memory_id,
                        tenant_id,
                        agent_id,
                        run_id,
                        content,
                        metadata,
                        created_at,
                        occurred_at,
                        status,
                        memory_type,
                        source_confidence,
                        importance,
                        CASE WHEN ${textExpr} ILIKE ${likeRef} THEN 0.6 ELSE 0.2 END AS lane_score
                        FROM swarm_memory
                       WHERE ${scoped.where}
                         AND ${textExpr} ILIKE ${likeRef}
                       ORDER BY lane_score DESC, COALESCE(occurred_at, created_at) DESC
                       LIMIT ${limitRef}
                      `,
                      scoped.values
                    )
                ),
              logger,
              { attempts: 1 }
            )
          : await withRetry(
              "vector_store_search_lexical",
              async () => {
                const scopedLong = createScopedFilter({
                  tenantId: params.tenantId ?? null,
                  agentId: params.agentId,
                  runId: params.runId,
                  sourceAllowlist: params.sourceAllowlist,
                  sourceDenylist: params.sourceDenylist,
                });
                const queryRef = scopedLong.push(queryText);
                const limitRefLong = scopedLong.push(candidateLimit);
                return withQueryTimeout(
                  queryTimeoutMs,
                  "search-lexical",
                  () =>
                    pool.query(
                      `
                      SELECT
                        memory_id,
                        tenant_id,
                        agent_id,
                        run_id,
                        content,
                        metadata,
                        created_at,
                        occurred_at,
                        status,
                        memory_type,
                        source_confidence,
                        importance,
                        ts_rank_cd(to_tsvector('english', ${textExpr}), websearch_to_tsquery('english', ${queryRef})) AS lane_score
                        FROM swarm_memory
                       WHERE ${scopedLong.where}
                         AND to_tsvector('english', ${textExpr}) @@ websearch_to_tsquery('english', ${queryRef})
                       ORDER BY lane_score DESC, COALESCE(occurred_at, created_at) DESC
                       LIMIT ${limitRefLong}
                      `,
                      scopedLong.values
                    )
                );
              },
              logger,
              { attempts: 1 }
            );
      laneRows.push(...lexicalResult.rows.map((row) => toScoredLane(row as Record<string, unknown>, "lexical")));
    }

    if (useSessionLane) {
      const scoped = createScopedFilter({
        tenantId: params.tenantId ?? null,
        sourceAllowlist: params.sourceAllowlist,
        sourceDenylist: params.sourceDenylist,
      });
      const runRef = scoped.push(String(params.runId ?? "").trim() || null);
      const agentRef = scoped.push(String(params.agentId ?? "").trim() || null);
      const limitRef = scoped.push(candidateLimit);
      const sessionResult = await withQueryTimeout(
        queryTimeoutMs,
        "search-session",
        () =>
          pool.query(
            `
            SELECT
              memory_id,
              tenant_id,
              agent_id,
              run_id,
              content,
              metadata,
              created_at,
              occurred_at,
              status,
              memory_type,
              source_confidence,
              importance,
              (
                CASE WHEN run_id IS NOT DISTINCT FROM ${runRef} THEN 1.0 ELSE 0 END +
                CASE WHEN agent_id IS NOT DISTINCT FROM ${agentRef} THEN 0.5 ELSE 0 END
              ) AS lane_score
              FROM swarm_memory
             WHERE ${scoped.where}
               AND (
                 run_id IS NOT DISTINCT FROM ${runRef}
                 OR agent_id IS NOT DISTINCT FROM ${agentRef}
               )
             ORDER BY COALESCE(occurred_at, created_at) DESC
             LIMIT ${limitRef}
            `,
            scoped.values
          )
      );
      laneRows.push(...sessionResult.rows.map((row) => toScoredLane(row as Record<string, unknown>, "session")));
    }

    const laneBuckets: Record<"semantic" | "lexical" | "session", ScoredLane[]> = {
      semantic: [],
      lexical: [],
      session: [],
    };
    for (const row of laneRows) {
      laneBuckets[row.lane].push(row);
    }
    laneBuckets.semantic.sort((left, right) => right.laneScore - left.laneScore);
    laneBuckets.lexical.sort((left, right) => right.laneScore - left.laneScore);
    laneBuckets.session.sort((left, right) => right.laneScore - left.laneScore);

    const ranked = new Map<
      string,
      {
        row: ScoredLane;
        matchedBy: Set<string>;
        rrf: number;
        semantic?: number;
        lexical?: number;
        sessionLane?: number;
      }
    >();
    const rrfK = 60;
    for (const [lane, rows] of Object.entries(laneBuckets) as Array<[ScoredLane["lane"], ScoredLane[]]>) {
      for (const [index, row] of rows.entries()) {
        const existing = ranked.get(row.id) ?? {
          row,
          matchedBy: new Set<string>(),
          rrf: 0,
        };
        const rank = index + 1;
        existing.rrf += 1 / (rrfK + rank);
        existing.matchedBy.add(lane);
        if (!ranked.has(row.id)) {
          ranked.set(row.id, existing);
        }
        if (lane === "semantic") existing.semantic = row.laneScore;
        if (lane === "lexical") existing.lexical = row.laneScore;
        if (lane === "session") existing.sessionLane = row.laneScore;
      }
    }

    const minScore = Number.isFinite(params.minScore ?? Number.NaN) ? Number(params.minScore) : null;
    const results = Array.from(ranked.values())
      .map((entry): VectorSearchResult => {
        const session = params.runId && entry.row.runId === params.runId ? 1 : params.agentId && entry.row.agentId === params.agentId ? 0.5 : 0;
        const recency = recencyScore(entry.row.occurredAt, entry.row.createdAt, entry.row.memoryType);
        const sourceTrust = clamp01(entry.row.sourceConfidence);
        const importance = clamp01(entry.row.importance);
        const score = 0.5 * entry.rrf + 0.2 * sourceTrust + 0.15 * recency + 0.1 * importance + 0.05 * session;
        return {
          id: entry.row.id,
          tenantId: entry.row.tenantId,
          agentId: entry.row.agentId,
          runId: entry.row.runId,
          content: entry.row.content,
          metadata: entry.row.metadata,
          createdAt: entry.row.createdAt,
          occurredAt: entry.row.occurredAt,
          status: entry.row.status,
          memoryType: entry.row.memoryType,
          sourceConfidence: sourceTrust,
          importance,
          score,
          matchedBy: Array.from(entry.matchedBy),
          scoreBreakdown: {
            rrf: entry.rrf,
            sourceTrust,
            recency,
            importance,
            session,
            semantic: entry.semantic,
            lexical: entry.lexical,
            sessionLane: entry.sessionLane,
          },
        };
      })
      .filter((row) => (minScore === null ? true : row.score >= minScore))
      .sort((left, right) => right.score - left.score || right.createdAt.localeCompare(left.createdAt))
      .slice(0, bounded);

    return results;
  };

  const healthcheck = async (): Promise<VectorStoreHealth> => {
    const startedAt = Date.now();
    try {
      await withRetry(
        "vector_store_health",
        async () => {
          await withQueryTimeout(queryTimeoutMs, "health", () => pool.query("SELECT 1 FROM swarm_memory LIMIT 1", []));
        },
        logger,
        { attempts: 3 }
      );
      return { ok: true, latencyMs: Date.now() - startedAt, vectorEnabled: semanticLaneEnabled };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        vectorEnabled: semanticLaneEnabled,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  return { upsertMemory, searchMemory, healthcheck };
}
