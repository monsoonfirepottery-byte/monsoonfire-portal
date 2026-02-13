import fs from "node:fs/promises";
import path from "node:path";
import { getPgPool } from "./postgres";

export async function runMigrations(
  migrationsDir = path.join(process.cwd(), "migrations")
): Promise<{ applied: string[] }> {
  const pool = getPgPool();
  const applied: string[] = [];
  await pool.query(`
    CREATE TABLE IF NOT EXISTS brain_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await fs.readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const exists = await pool.query("SELECT 1 FROM brain_migrations WHERE id = $1", [file]);
    if (exists.rowCount && exists.rowCount > 0) continue;

    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO brain_migrations (id) VALUES ($1)", [file]);
      await pool.query("COMMIT");
      applied.push(file);
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }
  return { applied };
}
