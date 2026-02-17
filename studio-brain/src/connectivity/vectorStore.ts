import type { Logger } from "../config/logger";
import { readEnv } from "../config/env";
import { getPgPool } from "../db/postgres";
import { withRetry } from "./retry";

export type SwarmMemory = {
  id: string;
  agentId: string;
  runId: string;
  tenantId: string | null;
  content: string;
  embedding: number[] | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type VectorSearchResult = {
  id: string;
  score: number;
  content: string;
  metadata: Record<string, unknown>;
};

export type VectorStoreHealth = {
  ok: boolean;
  latencyMs: number;
  error?: string;
  vectorEnabled?: boolean;
};

export type VectorStore = {
  upsertMemory: (item: Omit<SwarmMemory, "createdAt">) => Promise<void>;
  searchMemory: (params: { query: string; embedding?: number[]; limit?: number; tenantId?: string }) => Promise<VectorSearchResult[]>;
  healthcheck: () => Promise<VectorStoreHealth>;
};

function clampLimit(limit: number | undefined): number {
  const raw = Number.isFinite(limit ?? NaN) ? Number(limit) : 10;
  return Math.max(1, Math.min(raw, 100));
}

function sanitizeVector(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    .map((item) => Number(item.toFixed(6)));
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

function noOpLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

async function hasPgVector(): Promise<boolean> {
  const pool = getPgPool();
  const result = await pool.query(`
    SELECT 1
      FROM pg_extension
     WHERE extname = 'vector'
  `);
  return (result.rowCount ?? 0) > 0;
}

export async function createVectorStore(logger: Logger = noOpLogger()): Promise<VectorStore> {
  const supportsVector = await hasPgVector();
  const pool = getPgPool();
  const queryTimeoutMs = Math.max(500, readEnv().STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS ?? 5_000);

  const upsertMemory = async (item: Omit<SwarmMemory, "createdAt">): Promise<void> => {
    const baseValues = [item.id, item.agentId, item.runId, item.tenantId, item.content, JSON.stringify(item.metadata)];
    await withRetry(
      "vector_store_upsert",
      async () => {
        const embeddingJson = supportsVector ? JSON.stringify(item.embedding ?? []) : null;
        const query = supportsVector
          ? `
            INSERT INTO swarm_memory (
              memory_id, agent_id, run_id, tenant_id, content, metadata, embedding, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::vector, now())
            ON CONFLICT (memory_id) DO UPDATE SET
              tenant_id = EXCLUDED.tenant_id,
              content = EXCLUDED.content,
              metadata = EXCLUDED.metadata,
              embedding = EXCLUDED.embedding,
              created_at = now()
            `
          : `
            INSERT INTO swarm_memory (
              memory_id, agent_id, run_id, tenant_id, content, metadata, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
            ON CONFLICT (memory_id) DO UPDATE SET
              tenant_id = EXCLUDED.tenant_id,
              content = EXCLUDED.content,
              metadata = EXCLUDED.metadata,
              created_at = now()
            `;
        const values = supportsVector ? [...baseValues, embeddingJson] : baseValues;
        await withQueryTimeout(queryTimeoutMs, "upsert", () => pool.query(query, values));
      },
      logger,
      { attempts: 3, baseDelayMs: 50 }
    );
  };

  const searchMemory = async (params: {
    query: string;
    embedding?: number[];
    limit?: number;
    tenantId?: string;
  }): Promise<VectorSearchResult[]> => {
    const bounded = clampLimit(params.limit);
    if (supportsVector && params.embedding && params.embedding.length > 0) {
      const vector = sanitizeVector(params.embedding);
      if (vector.length > 0) {
        const result = await withRetry(
          "vector_store_search",
          async () =>
            withQueryTimeout(
              queryTimeoutMs,
              "search-vector",
              () =>
                pool.query(
                  `
              SELECT memory_id, content, metadata,
                     1 - (embedding <=> $1::vector) AS score
                FROM swarm_memory
               WHERE tenant_id IS NOT DISTINCT FROM $2
               ORDER BY embedding <=> $1::vector
               LIMIT $3
              `,
                  [JSON.stringify(vector), params.tenantId ?? null, bounded]
                )
            ),
          logger,
          { attempts: 3 }
        );
        return result.rows.map((row) => ({
          id: String(row.memory_id),
          score: Number(row.score ?? 0),
          content: String(row.content ?? ""),
          metadata: (row.metadata as Record<string, unknown>) ?? {},
        }));
      }
    }

    const result = await withQueryTimeout(
      queryTimeoutMs,
      "search",
      () =>
        pool.query(
          `
          SELECT memory_id, content, metadata
            FROM swarm_memory
           WHERE tenant_id IS NOT DISTINCT FROM $1
             AND content ILIKE $2
           ORDER BY created_at DESC
           LIMIT $3
          `,
          [params.tenantId ?? null, `%${params.query}%`, bounded]
        )
    );
    return result.rows.map((row) => ({
      id: String(row.memory_id),
      score: 0.5,
      content: String(row.content ?? ""),
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    }));
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
      return { ok: true, latencyMs: Date.now() - startedAt, vectorEnabled: supportsVector };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        vectorEnabled: supportsVector,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  return { upsertMemory, searchMemory, healthcheck };
}
