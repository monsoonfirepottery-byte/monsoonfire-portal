import fs from "node:fs/promises";
import path from "node:path";
import { getPgPool } from "./postgres";
import { readEnv } from "../config/env";

function createQueryTimeout(): number {
  const env = readEnv();
  return Math.max(500, env.STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS ?? 5_000);
}

function withQueryTimeout<T>(timeoutMs: number, label: string, task: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`postgres migration ${label} query timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([task(), timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export async function runMigrations(
  migrationsDir = path.join(process.cwd(), "migrations")
): Promise<{ applied: string[] }> {
  const pool = getPgPool();
  const queryTimeoutMs = createQueryTimeout();
  const applied: string[] = [];
  await withQueryTimeout(queryTimeoutMs, "bootstrap", () => pool.query(`
    CREATE TABLE IF NOT EXISTS brain_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `));

  const files = (await fs.readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const exists = await withQueryTimeout(
      queryTimeoutMs,
      "check",
      () => pool.query("SELECT 1 FROM brain_migrations WHERE id = $1", [file])
    );
    if (exists.rowCount && exists.rowCount > 0) continue;

    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await withQueryTimeout(queryTimeoutMs, "begin", () => pool.query("BEGIN"));
    try {
      await withQueryTimeout(queryTimeoutMs, "migration", () => pool.query(sql));
      await withQueryTimeout(queryTimeoutMs, "record", () => pool.query("INSERT INTO brain_migrations (id) VALUES ($1)", [file]));
      await withQueryTimeout(queryTimeoutMs, "commit", () => pool.query("COMMIT"));
      applied.push(file);
    } catch (error) {
      await withQueryTimeout(queryTimeoutMs, "rollback", () => pool.query("ROLLBACK"));
      throw error;
    }
  }
  return { applied };
}
