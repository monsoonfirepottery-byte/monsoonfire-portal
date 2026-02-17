"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVectorStore = createVectorStore;
const env_1 = require("../config/env");
const postgres_1 = require("../db/postgres");
const retry_1 = require("./retry");
function clampLimit(limit) {
    const raw = Number.isFinite(limit ?? NaN) ? Number(limit) : 10;
    return Math.max(1, Math.min(raw, 100));
}
function sanitizeVector(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .filter((item) => typeof item === "number" && Number.isFinite(item))
        .map((item) => Number(item.toFixed(6)));
}
function withQueryTimeout(timeoutMs, label, task) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`vector store ${label} query timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    return Promise.race([task(), timeout]).finally(() => {
        if (timer) {
            clearTimeout(timer);
        }
    });
}
function noOpLogger() {
    return {
        debug: () => { },
        info: () => { },
        warn: () => { },
        error: () => { },
    };
}
async function hasPgVector() {
    const pool = (0, postgres_1.getPgPool)();
    const result = await pool.query(`
    SELECT 1
      FROM pg_extension
     WHERE extname = 'vector'
  `);
    return (result.rowCount ?? 0) > 0;
}
async function createVectorStore(logger = noOpLogger()) {
    const supportsVector = await hasPgVector();
    const pool = (0, postgres_1.getPgPool)();
    const queryTimeoutMs = Math.max(500, (0, env_1.readEnv)().STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS ?? 5_000);
    const upsertMemory = async (item) => {
        const baseValues = [item.id, item.agentId, item.runId, item.tenantId, item.content, JSON.stringify(item.metadata)];
        await (0, retry_1.withRetry)("vector_store_upsert", async () => {
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
        }, logger, { attempts: 3, baseDelayMs: 50 });
    };
    const searchMemory = async (params) => {
        const bounded = clampLimit(params.limit);
        if (supportsVector && params.embedding && params.embedding.length > 0) {
            const vector = sanitizeVector(params.embedding);
            if (vector.length > 0) {
                const result = await (0, retry_1.withRetry)("vector_store_search", async () => withQueryTimeout(queryTimeoutMs, "search-vector", () => pool.query(`
              SELECT memory_id, content, metadata,
                     1 - (embedding <=> $1::vector) AS score
                FROM swarm_memory
               WHERE tenant_id IS NOT DISTINCT FROM $2
               ORDER BY embedding <=> $1::vector
               LIMIT $3
              `, [JSON.stringify(vector), params.tenantId ?? null, bounded])), logger, { attempts: 3 });
                return result.rows.map((row) => ({
                    id: String(row.memory_id),
                    score: Number(row.score ?? 0),
                    content: String(row.content ?? ""),
                    metadata: row.metadata ?? {},
                }));
            }
        }
        const result = await withQueryTimeout(queryTimeoutMs, "search", () => pool.query(`
          SELECT memory_id, content, metadata
            FROM swarm_memory
           WHERE tenant_id IS NOT DISTINCT FROM $1
             AND content ILIKE $2
           ORDER BY created_at DESC
           LIMIT $3
          `, [params.tenantId ?? null, `%${params.query}%`, bounded]));
        return result.rows.map((row) => ({
            id: String(row.memory_id),
            score: 0.5,
            content: String(row.content ?? ""),
            metadata: row.metadata ?? {},
        }));
    };
    const healthcheck = async () => {
        const startedAt = Date.now();
        try {
            await (0, retry_1.withRetry)("vector_store_health", async () => {
                await withQueryTimeout(queryTimeoutMs, "health", () => pool.query("SELECT 1 FROM swarm_memory LIMIT 1", []));
            }, logger, { attempts: 3 });
            return { ok: true, latencyMs: Date.now() - startedAt, vectorEnabled: supportsVector };
        }
        catch (error) {
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
