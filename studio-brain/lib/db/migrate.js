"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigrations = runMigrations;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const postgres_1 = require("./postgres");
const env_1 = require("../config/env");
function createQueryTimeout() {
    const env = (0, env_1.readEnv)();
    return Math.max(500, env.STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS ?? 5_000);
}
function withQueryTimeout(timeoutMs, label, task) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`postgres migration ${label} query timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    return Promise.race([task(), timeout]).finally(() => {
        if (timer) {
            clearTimeout(timer);
        }
    });
}
async function runMigrations(migrationsDir = node_path_1.default.join(process.cwd(), "migrations")) {
    const pool = (0, postgres_1.getPgPool)();
    const queryTimeoutMs = createQueryTimeout();
    const applied = [];
    await withQueryTimeout(queryTimeoutMs, "bootstrap", () => pool.query(`
    CREATE TABLE IF NOT EXISTS brain_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `));
    const files = (await promises_1.default.readdir(migrationsDir))
        .filter((f) => f.endsWith(".sql"))
        .sort((a, b) => a.localeCompare(b));
    for (const file of files) {
        const exists = await withQueryTimeout(queryTimeoutMs, "check", () => pool.query("SELECT 1 FROM brain_migrations WHERE id = $1", [file]));
        if (exists.rowCount && exists.rowCount > 0)
            continue;
        const sql = await promises_1.default.readFile(node_path_1.default.join(migrationsDir, file), "utf8");
        await withQueryTimeout(queryTimeoutMs, "begin", () => pool.query("BEGIN"));
        try {
            await withQueryTimeout(queryTimeoutMs, "migration", () => pool.query(sql));
            await withQueryTimeout(queryTimeoutMs, "record", () => pool.query("INSERT INTO brain_migrations (id) VALUES ($1)", [file]));
            await withQueryTimeout(queryTimeoutMs, "commit", () => pool.query("COMMIT"));
            applied.push(file);
        }
        catch (error) {
            await withQueryTimeout(queryTimeoutMs, "rollback", () => pool.query("ROLLBACK"));
            throw error;
        }
    }
    return { applied };
}
