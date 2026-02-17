"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPgPool = getPgPool;
exports.createPgPool = createPgPool;
exports.checkPgConnection = checkPgConnection;
exports.closePgPool = closePgPool;
const pg_1 = require("pg");
const env_1 = require("../config/env");
const retry_1 = require("../connectivity/retry");
let pool = null;
function createQueryTimeout(env) {
    return Math.max(500, env.STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS ?? 5_000);
}
function withQueryTimeout(timeoutMs, label, task) {
    let timer = null;
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`postgres ${label} query timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    return Promise.race([task(), deadline]).finally(() => {
        if (timer) {
            clearTimeout(timer);
        }
    });
}
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
async function createPgPool() {
    const env = (0, env_1.readEnv)();
    const next = new pg_1.Pool({
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
async function checkPgConnection(logger) {
    const startedAt = Date.now();
    try {
        const pool = getPgPool();
        const queryTimeoutMs = createQueryTimeout((0, env_1.readEnv)());
        await (0, retry_1.withRetry)("postgres_healthcheck", async () => {
            const result = await withQueryTimeout(queryTimeoutMs, "health", () => pool.query("SELECT 1 as ok, current_setting('server_version') as version"));
            if (!result.rows[0]?.version) {
                throw new Error("invalid postgres result");
            }
        }, logger ?? { debug: () => { }, info: () => { }, warn: () => { }, error: () => { } }, { attempts: 3, baseDelayMs: 100 });
        return {
            ok: true,
            details: { status: "connected" },
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
