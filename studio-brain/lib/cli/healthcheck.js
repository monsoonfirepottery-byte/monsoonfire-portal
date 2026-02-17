"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const env_1 = require("../config/env");
const logger_1 = require("../config/logger");
const database_1 = require("../connectivity/database");
const artifactStore_1 = require("../connectivity/artifactStore");
const healthcheck_1 = require("../connectivity/healthcheck");
const redis_1 = require("../connectivity/redis");
const eventBus_1 = require("../swarm/bus/eventBus");
const vectorStore_1 = require("../connectivity/vectorStore");
function parseArtifactPort(endpoint, fallback) {
    try {
        const parsed = new URL(endpoint);
        const port = Number(parsed.port);
        return Number.isFinite(port) && port > 0 ? port : fallback;
    }
    catch {
        return fallback;
    }
}
function arg(name, fallback = undefined) {
    const prefix = `--${name}=`;
    const exact = process.argv.find((entry) => entry === `--${name}`);
    if (exact === `--${name}`)
        return "";
    const prefixed = process.argv.find((entry) => entry.startsWith(prefix));
    if (!prefixed)
        return fallback;
    return prefixed.slice(prefix.length);
}
async function run() {
    const outputMode = arg("output", "table") === "json" ? "json" : "table";
    const env = (0, env_1.readEnv)();
    const logger = (0, logger_1.createLogger)(env.STUDIO_BRAIN_LOG_LEVEL);
    const checks = [
        {
            label: "postgres",
            enabled: true,
            run: async () => {
                const db = await (0, database_1.createDatabaseConnection)(logger);
                const health = await db.healthcheck();
                await db.close();
                return health;
            },
        },
        {
            label: "redis",
            enabled: env.STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED,
            run: async () => {
                const client = (0, redis_1.buildRedisClient)({
                    host: env.REDIS_HOST,
                    port: env.REDIS_PORT,
                    username: env.REDIS_USERNAME,
                    password: env.REDIS_PASSWORD,
                    connectTimeoutMs: env.REDIS_CONNECT_TIMEOUT_MS,
                    commandTimeoutMs: env.REDIS_COMMAND_TIMEOUT_MS,
                }, logger);
                const result = await client.healthcheck();
                await client.close();
                return result;
            },
        },
        {
            label: "event_bus",
            enabled: env.STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED,
            run: async () => {
                const client = (0, redis_1.buildRedisClient)({
                    host: env.REDIS_HOST,
                    port: env.REDIS_PORT,
                    username: env.REDIS_USERNAME,
                    password: env.REDIS_PASSWORD,
                    connectTimeoutMs: env.REDIS_CONNECT_TIMEOUT_MS,
                    commandTimeoutMs: env.REDIS_COMMAND_TIMEOUT_MS,
                }, logger);
                const bus = await (0, eventBus_1.createRedisStreamEventBus)(client, env.STUDIO_BRAIN_REDIS_STREAM_NAME, logger, {
                    pollIntervalMs: env.STUDIO_BRAIN_EVENT_BUS_POLL_INTERVAL_MS,
                    maxBatchSize: env.STUDIO_BRAIN_EVENT_BUS_BATCH_SIZE,
                    commandTimeoutMs: env.REDIS_COMMAND_TIMEOUT_MS,
                });
                const result = await bus.healthcheck();
                await bus.close();
                return result;
            },
        },
        {
            label: "artifact_store",
            enabled: true,
            run: async () => {
                const endpoint = env.STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT;
                const artifactStore = await (0, artifactStore_1.createArtifactStore)({
                    endpoint,
                    port: parseArtifactPort(endpoint, 9000),
                    useSSL: env.STUDIO_BRAIN_ARTIFACT_STORE_USE_SSL,
                    accessKey: env.STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY,
                    secretKey: env.STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY,
                    bucket: env.STUDIO_BRAIN_ARTIFACT_STORE_BUCKET,
                }, logger);
                const result = await artifactStore.healthcheck();
                return result;
            },
        },
        {
            label: "vector_store",
            enabled: env.STUDIO_BRAIN_VECTOR_STORE_ENABLED,
            run: async () => {
                const vectorStore = await (0, vectorStore_1.createVectorStore)(logger);
                return vectorStore.healthcheck();
            },
        },
    ];
    const report = await (0, healthcheck_1.collectBackendHealth)(checks.map((check) => ({
        label: check.label,
        enabled: check.enabled,
        run: check.run,
    })), logger);
    if (outputMode === "json") {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    }
    else {
        process.stdout.write((0, healthcheck_1.renderHealthTable)(report));
    }
    process.exitCode = report.ok ? 0 : 1;
}
void run().catch((error) => {
    process.stderr.write(`healthcheck failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
