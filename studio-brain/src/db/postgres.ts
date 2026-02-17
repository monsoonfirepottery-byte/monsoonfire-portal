import { Pool } from "pg";
import { readEnv } from "../config/env";
import { withRetry } from "../connectivity/retry";
import type { Logger } from "../config/logger";

let pool: Pool | null = null;

function createQueryTimeout(env: ReturnType<typeof readEnv>): number {
  return Math.max(500, env.STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS ?? 5_000);
}

function withQueryTimeout<T>(
  timeoutMs: number,
  label: string,
  task: () => Promise<T>
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`postgres ${label} query timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([task(), deadline]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

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

export type PgCheckResult = {
  ok: boolean;
  latencyMs: number;
  error?: string;
  details?: Record<string, unknown>;
};

export async function createPgPool(): Promise<Pool> {
  const env = readEnv();
  const next = new Pool({
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
  return next;
}

export async function checkPgConnection(logger?: Logger): Promise<PgCheckResult> {
  const startedAt = Date.now();
  try {
    const pool = getPgPool();
    const queryTimeoutMs = createQueryTimeout(readEnv());
    await withRetry(
      "postgres_healthcheck",
      async () => {
        const result = await withQueryTimeout(
          queryTimeoutMs,
          "health",
          () => pool.query("SELECT 1 as ok, current_setting('server_version') as version")
        );
        if (!result.rows[0]?.version) {
          throw new Error("invalid postgres result");
        }
      },
      logger ?? { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      { attempts: 3, baseDelayMs: 100 }
    );
    return {
      ok: true,
      details: { status: "connected" },
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
