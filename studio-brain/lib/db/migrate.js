"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigrations = runMigrations;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const postgres_1 = require("./postgres");
async function runMigrations(migrationsDir = node_path_1.default.join(process.cwd(), "migrations")) {
    const pool = (0, postgres_1.getPgPool)();
    const applied = [];
    await pool.query(`
    CREATE TABLE IF NOT EXISTS brain_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
    const files = (await promises_1.default.readdir(migrationsDir))
        .filter((f) => f.endsWith(".sql"))
        .sort((a, b) => a.localeCompare(b));
    for (const file of files) {
        const exists = await pool.query("SELECT 1 FROM brain_migrations WHERE id = $1", [file]);
        if (exists.rowCount && exists.rowCount > 0)
            continue;
        const sql = await promises_1.default.readFile(node_path_1.default.join(migrationsDir, file), "utf8");
        await pool.query("BEGIN");
        try {
            await pool.query(sql);
            await pool.query("INSERT INTO brain_migrations (id) VALUES ($1)", [file]);
            await pool.query("COMMIT");
            applied.push(file);
        }
        catch (error) {
            await pool.query("ROLLBACK");
            throw error;
        }
    }
    return { applied };
}
