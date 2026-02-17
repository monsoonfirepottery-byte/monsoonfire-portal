"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_child_process_1 = require("node:child_process");
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = require("node:timers/promises");
const env_1 = require("../config/env");
const logger_1 = require("../config/logger");
const postgres_1 = require("../db/postgres");
const database_1 = require("../connectivity/database");
const redis_1 = require("../connectivity/redis");
const eventBus_1 = require("../swarm/bus/eventBus");
const artifactStore_1 = require("../connectivity/artifactStore");
const vectorStore_1 = require("../connectivity/vectorStore");
const orchestrator_1 = require("../swarm/orchestrator");
const store_1 = require("../swarm/store");
function runCommand(command, args, options = {}) {
    const result = (0, node_child_process_1.spawnSync)(command, args, {
        cwd: options.cwd ?? process.cwd(),
        env: { ...process.env, ...(options.env ?? {}) },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    return {
        status: result.status,
        stdout: result.stdout?.toString() ?? "",
        stderr: result.stderr?.toString() ?? "",
    };
}
async function withPatchedEnv(patch, fn) {
    const original = {};
    for (const [key, value] of Object.entries(patch)) {
        original[key] = process.env[key];
        if (value === undefined) {
            delete process.env[key];
        }
        else {
            process.env[key] = value;
        }
    }
    try {
        return await fn();
    }
    finally {
        for (const [key, value] of Object.entries(original)) {
            if (value === undefined) {
                delete process.env[key];
            }
            else {
                process.env[key] = value;
            }
        }
    }
}
function parseJsonFromOutput(output) {
    const trimmed = output.trim();
    const match = trimmed.match(/(\{[\s\S]*\})\s*$/);
    if (!match)
        throw new Error("no JSON object in output");
    return JSON.parse(match[1]);
}
function parseArtifactPort(endpoint, fallback) {
    try {
        const parsed = new URL(endpoint);
        const parsedPort = Number(parsed.port);
        return Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : fallback;
    }
    catch {
        return fallback;
    }
}
async function waitForTask(taskId, attempts = 20, delayMs = 250) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const task = await (0, store_1.getTask)(taskId);
        if (task) {
            return task;
        }
        await (0, promises_1.setTimeout)(delayMs);
    }
    throw new Error(`orchestrator task not materialized for ${taskId}`);
}
async function waitForDependencies(loggerLabel, patch, attempts = 45) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            await withPatchedEnv(patch, async () => {
                (0, env_1.readEnv)();
                const env = (0, env_1.readEnv)();
                const pg = await (0, postgres_1.checkPgConnection)((0, logger_1.createLogger)("error"));
                if (!pg.ok) {
                    throw new Error(`postgres not ready: ${pg.error ?? "unknown"}`);
                }
                const redis = (0, redis_1.buildRedisClient)({
                    host: env.REDIS_HOST,
                    port: env.REDIS_PORT,
                    username: env.REDIS_USERNAME,
                    password: env.REDIS_PASSWORD,
                    connectTimeoutMs: 1_000,
                    commandTimeoutMs: 1_000,
                }, (0, logger_1.createLogger)("error"));
                const redisHealth = await redis.healthcheck();
                await redis.close();
                if (!redisHealth.ok) {
                    throw new Error(`redis not ready: ${redisHealth.error ?? "unknown"}`);
                }
            });
            await (0, postgres_1.closePgPool)();
            return;
        }
        catch (error) {
            lastError = error;
            await (0, promises_1.setTimeout)(400 + attempt * 200);
        }
    }
    throw new Error(`service readiness failed (${loggerLabel}): ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
const RUN_INTEGRATION = process.env.STUDIO_BRAIN_INFRA_INTEGRATION === "1";
const composePath = node_path_1.default.join(process.cwd(), "docker-compose.yml");
if (!RUN_INTEGRATION) {
    (0, node_test_1.default)("backend integration test is skipped unless STUDIO_BRAIN_INFRA_INTEGRATION=1", () => {
        // integration run intentionally optional to keep CI lightweight
    });
}
else {
    (0, node_test_1.default)("backend integration stack can start and process event/store checks", async () => {
        const patch = {
            PGHOST: "127.0.0.1",
            PGPORT: "5433",
            PGDATABASE: "monsoonfire_studio_os",
            PGUSER: "postgres",
            PGPASSWORD: "postgres",
            REDIS_HOST: "127.0.0.1",
            REDIS_PORT: "6379",
            STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT: "http://127.0.0.1:9000",
            STUDIO_BRAIN_ARTIFACT_STORE_BUCKET: "studiobrain-artifacts",
            STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY: "minioadmin",
            STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY: "minioadmin",
            STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED: "true",
            STUDIO_BRAIN_VECTOR_STORE_ENABLED: "true",
            STUDIO_BRAIN_SKILL_SANDBOX_ENABLED: "false",
        };
        const composeUp = runCommand("docker", ["compose", "-f", composePath, "up", "-d", "postgres", "redis", "minio"], { env: patch });
        if (composeUp.status !== 0) {
            throw new Error(`compose up failed: ${composeUp.stderr || composeUp.stdout}`);
        }
        try {
            await waitForDependencies("backend integration", patch);
            const logger = (0, logger_1.createLogger)("info");
            const db = await withPatchedEnv(patch, async () => {
                const env = (0, env_1.readEnv)();
                return (0, database_1.createDatabaseConnection)(logger);
            });
            const dbHealth = await db.healthcheck();
            strict_1.default.ok(dbHealth.ok, `postgres health failed: ${dbHealth.error ?? "unknown"}`);
            const migration = await withPatchedEnv(patch, async () => db.migrate());
            strict_1.default.ok(Array.isArray(migration.applied), "migrations should return array");
            const tableCheck = await withPatchedEnv(patch, async () => {
                const pool = (0, postgres_1.getPgPool)();
                return pool.query("SELECT to_regclass('public.swarm_tasks') AS swarm_tasks_table, to_regclass('public.brain_migrations') AS migrations_table");
            });
            strict_1.default.ok(tableCheck.rows[0]?.swarm_tasks_table);
            strict_1.default.ok(tableCheck.rows[0]?.migrations_table);
            await withPatchedEnv(patch, async () => {
                const env = (0, env_1.readEnv)();
                const redis = (0, redis_1.buildRedisClient)({
                    host: env.REDIS_HOST,
                    port: env.REDIS_PORT,
                    username: env.REDIS_USERNAME,
                    password: env.REDIS_PASSWORD,
                }, logger);
                const bus = await (0, eventBus_1.createRedisStreamEventBus)(redis, env.STUDIO_BRAIN_REDIS_STREAM_NAME, logger, {
                    startId: "0-0",
                    pollIntervalMs: 250,
                    maxBatchSize: 8,
                    commandTimeoutMs: 1_000,
                });
                const seen = [];
                const marker = `it-${Date.now()}`;
                const sub = await bus.subscribe(async (event) => {
                    if (event.type === "task.created") {
                        const taskId = String(event.payload.taskId ?? "");
                        if (taskId.startsWith("it-")) {
                            seen.push({ taskId });
                        }
                    }
                });
                await bus.publish({
                    type: "task.created",
                    swarmId: "it-swarm",
                    runId: "it-run",
                    actorId: "studiobrain-test",
                    payload: {
                        taskId: marker,
                        inputs: { marker },
                        createdBy: "infra-test",
                    },
                });
                await (0, promises_1.setTimeout)(900);
                strict_1.default.ok(seen.some((entry) => entry.taskId === marker), "event bus should receive the published test event");
                await sub.stop();
                await bus.close();
            });
            await withPatchedEnv(patch, async () => {
                const env = (0, env_1.readEnv)();
                const redis = (0, redis_1.buildRedisClient)({
                    host: env.REDIS_HOST,
                    port: env.REDIS_PORT,
                    username: env.REDIS_USERNAME,
                    password: env.REDIS_PASSWORD,
                    connectTimeoutMs: 1_000,
                    commandTimeoutMs: 1_000,
                }, logger);
                const bus = await (0, eventBus_1.createRedisStreamEventBus)(redis, env.STUDIO_BRAIN_REDIS_STREAM_NAME, logger, {
                    startId: "$",
                    pollIntervalMs: 250,
                    maxBatchSize: 8,
                    commandTimeoutMs: 1_000,
                });
                const orchestrator = new orchestrator_1.SwarmOrchestrator({
                    bus,
                    logger,
                    config: {
                        swarmId: "it-orm-swarm",
                        runId: "it-orm-run",
                    },
                });
                await orchestrator.start();
                const marker = `it-task-${Date.now()}`;
                await bus.publish({
                    type: "task.created",
                    swarmId: "it-orm-swarm",
                    runId: "it-orm-run",
                    actorId: "studiobrain-test",
                    payload: {
                        taskId: marker,
                        inputs: { marker },
                    },
                });
                const persistedTask = await waitForTask(marker);
                strict_1.default.equal(persistedTask.id, marker);
                strict_1.default.equal(persistedTask.status, "assigned");
                const events = await (0, store_1.getRecentSwarmEvents)(20);
                const followed = events.find((event) => event.eventType === "task.assigned" &&
                    String(event.payload?.taskId ?? "") === marker);
                strict_1.default.ok(followed, "orchestrator should emit and persist task.assigned event");
                await orchestrator.stop();
            });
            await withPatchedEnv(patch, async () => {
                const env = (0, env_1.readEnv)();
                const endpoint = env.STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT;
                const artifactStore = await (0, artifactStore_1.createArtifactStore)({
                    endpoint,
                    port: parseArtifactPort(endpoint, 9000),
                    useSSL: env.STUDIO_BRAIN_ARTIFACT_STORE_USE_SSL,
                    accessKey: env.STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY,
                    secretKey: env.STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY,
                    bucket: env.STUDIO_BRAIN_ARTIFACT_STORE_BUCKET,
                }, logger);
                const key = `infra-smoke/${Date.now()}.txt`;
                await artifactStore.put(key, Buffer.from("ok", "utf8"));
                const readBack = await artifactStore.get(key);
                strict_1.default.equal(readBack?.toString("utf8"), "ok");
            });
            await withPatchedEnv(patch, async () => {
                const vectorStore = await (0, vectorStore_1.createVectorStore)(logger);
                const vectorHealth = await vectorStore.healthcheck();
                strict_1.default.ok(vectorHealth.ok, vectorHealth.error ?? "vector check failed");
            });
            const healthOutput = runCommand("node", ["lib/cli/healthcheck.js", "--output", "json"], { env: patch });
            if (healthOutput.status !== 0) {
                throw new Error(`healthcheck command failed: ${healthOutput.stderr || healthOutput.stdout}`);
            }
            const report = parseJsonFromOutput(healthOutput.stdout);
            strict_1.default.equal(report.ok, true);
            const checks = Array.isArray(report.checks) ? report.checks : [];
            const checkNames = checks.map((entry) => String(entry.name));
            strict_1.default.ok(checkNames.includes("postgres"));
            strict_1.default.ok(checkNames.includes("redis"));
            strict_1.default.ok(checkNames.includes("event_bus"));
            await db.close();
            await (0, postgres_1.closePgPool)();
        }
        finally {
            if (process.env.STUDIO_BRAIN_INFRA_KEEP_STACK !== "1") {
                runCommand("docker", ["compose", "-f", composePath, "down", "-v"], { env: patch });
            }
        }
    });
}
