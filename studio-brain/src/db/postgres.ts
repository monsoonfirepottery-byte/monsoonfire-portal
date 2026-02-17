import { Pool } from "pg";
import { readEnv } from "../config/env";

let pool: Pool | null = null;

export function getPgPool(): Pool {
  if (pool) return pool;
  const env = readEnv();
  pool = new Pool({
    host: env.PGHOST,
    port: env.PGPORT,
    database: env.PGDATABASE,
    user: env.PGUSER,
    password: env.PGPASSWORD,
    ssl: env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : false,
    max: env.STUDIO_BRAIN_PG_POOL_MAX,
    idleTimeoutMillis: env.STUDIO_BRAIN_PG_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: env.STUDIO_BRAIN_PG_CONNECTION_TIMEOUT_MS,
  });
  return pool;
}

export async function checkPgConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const startedAt = Date.now();
  try {
    const pool = getPgPool();
    await pool.query("SELECT 1");
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function closePgPool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}
