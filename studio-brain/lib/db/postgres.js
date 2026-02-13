"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPgPool = getPgPool;
exports.checkPgConnection = checkPgConnection;
exports.closePgPool = closePgPool;
const pg_1 = require("pg");
const env_1 = require("../config/env");
let pool = null;
function getPgPool() {
    if (pool)
        return pool;
    const env = (0, env_1.readEnv)();
    pool = new pg_1.Pool({
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
async function checkPgConnection() {
    const startedAt = Date.now();
    try {
        const pool = getPgPool();
        await pool.query("SELECT 1");
        return {
            ok: true,
            latencyMs: Date.now() - startedAt,
        };
    }
    catch (error) {
        return {
            ok: false,
            latencyMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
async function closePgPool() {
    if (!pool)
        return;
    await pool.end();
    pool = null;
}
