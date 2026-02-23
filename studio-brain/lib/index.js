"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const env_1 = require("./config/env");
const logger_1 = require("./config/logger");
const healthcheck_1 = require("./connectivity/healthcheck");
const database_1 = require("./connectivity/database");
const artifactStore_1 = require("./connectivity/artifactStore");
const eventBus_1 = require("./swarm/bus/eventBus");
const redis_1 = require("./connectivity/redis");
const vectorStore_1 = require("./connectivity/vectorStore");
const maintenance_1 = require("./db/maintenance");
const postgresEventStore_1 = require("./stores/postgresEventStore");
const postgresStateStore_1 = require("./stores/postgresStateStore");
const runner_1 = require("./jobs/runner");
const studioStateJob_1 = require("./jobs/studioStateJob");
const server_1 = require("./http/server");
const runtime_1 = require("./capabilities/runtime");
const postgresStores_1 = require("./capabilities/postgresStores");
const hubitatConnector_1 = require("./connectors/hubitatConnector");
const roborockConnector_1 = require("./connectors/roborockConnector");
const registry_1 = require("./connectors/registry");
const pilotWriteExecutor_1 = require("./capabilities/pilotWriteExecutor");
const orchestrator_1 = require("./swarm/orchestrator");
const registry_2 = require("./skills/registry");
const sandbox_1 = require("./skills/sandbox");
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
async function main() {
    const env = (0, env_1.readEnv)();
    const logger = (0, logger_1.createLogger)(env.STUDIO_BRAIN_LOG_LEVEL);
    const runtimeStartedAt = new Date().toISOString();
    const schedulerState = {
        intervalMs: env.STUDIO_BRAIN_JOB_INTERVAL_MS,
        jitterMs: env.STUDIO_BRAIN_JOB_JITTER_MS,
        initialDelayMs: env.STUDIO_BRAIN_JOB_INITIAL_DELAY_MS,
        nextRunAt: null,
        lastRunStartedAt: null,
        lastRunCompletedAt: null,
        lastRunDurationMs: null,
        totalRuns: 0,
        totalFailures: 0,
        consecutiveFailures: 0,
        lastFailureMessage: null,
    };
    logger.info("studio_brain_boot", {
        mode: "anchor",
        cloudAuthoritative: true,
        localWriteExecutionEnabled: env.STUDIO_BRAIN_ENABLE_WRITE_EXECUTION,
        requireApprovalForExternalWrites: env.STUDIO_BRAIN_REQUIRE_APPROVAL_FOR_EXTERNAL_WRITES,
        env: (0, env_1.redactEnvForLogs)(env),
    });
    logger.info("studio_brain_connectivity_boot", {});
    const dbConnection = await (0, database_1.createDatabaseConnection)(logger);
    const skillRegistry = env.STUDIO_BRAIN_SKILL_REGISTRY_REMOTE_BASE_URL
        ? (0, registry_2.createRemoteRegistryClient)({
            baseUrl: env.STUDIO_BRAIN_SKILL_REGISTRY_REMOTE_BASE_URL,
        })
        : (0, registry_2.createLocalRegistryClient)({
            rootPath: env.STUDIO_BRAIN_SKILL_REGISTRY_LOCAL_PATH,
        });
    const artifactStore = await (0, artifactStore_1.createArtifactStore)({
        endpoint: env.STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT,
        port: parseArtifactPort(env.STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT, 9010),
        useSSL: env.STUDIO_BRAIN_ARTIFACT_STORE_USE_SSL,
        accessKey: env.STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY,
        secretKey: env.STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY,
        bucket: env.STUDIO_BRAIN_ARTIFACT_STORE_BUCKET,
        timeoutMs: env.STUDIO_BRAIN_ARTIFACT_STORE_TIMEOUT_MS,
    }, logger);
    const vectorStore = env.STUDIO_BRAIN_VECTOR_STORE_ENABLED
        ? await (0, vectorStore_1.createVectorStore)(logger)
        : null;
    let redisConnection = null;
    let eventBus = null;
    let orchestrator = null;
    let swarmRunId = "";
    if (env.STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED) {
        redisConnection = (0, redis_1.buildRedisClient)({
            host: env.REDIS_HOST,
            port: env.REDIS_PORT,
            username: env.REDIS_USERNAME,
            password: env.REDIS_PASSWORD,
            connectTimeoutMs: env.REDIS_CONNECT_TIMEOUT_MS,
            commandTimeoutMs: env.REDIS_COMMAND_TIMEOUT_MS,
        }, logger);
        eventBus = await (0, eventBus_1.createRedisStreamEventBus)(redisConnection, env.STUDIO_BRAIN_REDIS_STREAM_NAME, logger, {
            startId: env.STUDIO_BRAIN_EVENT_BUS_START_ID,
            pollIntervalMs: env.STUDIO_BRAIN_EVENT_BUS_POLL_INTERVAL_MS,
            maxBatchSize: env.STUDIO_BRAIN_EVENT_BUS_BATCH_SIZE,
            commandTimeoutMs: env.REDIS_COMMAND_TIMEOUT_MS,
        });
        swarmRunId = env.STUDIO_BRAIN_SWARM_RUN_ID || (0, orchestrator_1.deriveSwarmRunId)(env.STUDIO_BRAIN_SWARM_ID);
        orchestrator = new orchestrator_1.SwarmOrchestrator({
            bus: eventBus,
            logger,
            config: {
                swarmId: env.STUDIO_BRAIN_SWARM_ID,
                runId: swarmRunId,
            },
        });
        await orchestrator.start();
        await eventBus.publish({
            type: "run.started",
            swarmId: env.STUDIO_BRAIN_SWARM_ID,
            runId: swarmRunId,
            actorId: "studio-brain",
            payload: {
                reason: "service_start",
                role: "coordinator",
            },
        });
    }
    const skillSandbox = await (async () => {
        if (!env.STUDIO_BRAIN_SKILL_SANDBOX_ENABLED) {
            return null;
        }
        try {
            return await (0, sandbox_1.createSkillSandbox)({
                enabled: env.STUDIO_BRAIN_SKILL_SANDBOX_ENABLED,
                egressDeny: env.STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_DENY,
                egressAllowlist: env.STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_ALLOWLIST,
                entryTimeoutMs: env.STUDIO_BRAIN_SKILL_SANDBOX_ENTRY_TIMEOUT_MS,
                runtimeAllowlist: env.STUDIO_BRAIN_SKILL_RUNTIME_ALLOWLIST,
                logger,
            });
        }
        catch (error) {
            logger.warn("studio_brain_skill_sandbox_init_failed", {
                message: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    })();
    const stateStore = new postgresStateStore_1.PostgresStateStore();
    const eventStore = new postgresEventStore_1.PostgresEventStore();
    const connectorRegistry = new registry_1.ConnectorRegistry([
        new hubitatConnector_1.HubitatConnector(async (path) => {
            if (path === "/health")
                return { ok: true };
            return { devices: [] };
        }),
        new roborockConnector_1.RoborockConnector(async (path) => {
            if (path === "/health")
                return { ok: true };
            return { devices: [] };
        }),
    ], logger);
    const capabilityRuntime = new runtime_1.CapabilityRuntime(runtime_1.defaultCapabilities, eventStore, new postgresStores_1.PostgresProposalStore(), new postgresStores_1.PostgresQuotaStore(), new postgresStores_1.PostgresPolicyStore(), connectorRegistry);
    const runner = new runner_1.JobRunner({
        stateStore,
        eventStore,
        logger,
    }, {
        computeStudioState: studioStateJob_1.computeStudioStateJob,
    });
    const runCompute = async (trigger) => {
        const startedAtMs = Date.now();
        schedulerState.lastRunStartedAt = new Date(startedAtMs).toISOString();
        schedulerState.totalRuns += 1;
        try {
            await runner.run("computeStudioState");
            schedulerState.consecutiveFailures = 0;
            schedulerState.lastFailureMessage = null;
        }
        catch (error) {
            schedulerState.totalFailures += 1;
            schedulerState.consecutiveFailures += 1;
            schedulerState.lastFailureMessage = error instanceof Error ? error.message : String(error);
            logger.error("compute_studio_state_failed", {
                trigger,
                message: error instanceof Error ? error.message : String(error),
            });
        }
        finally {
            schedulerState.lastRunCompletedAt = new Date().toISOString();
            schedulerState.lastRunDurationMs = Date.now() - startedAtMs;
        }
    };
    if (env.STUDIO_BRAIN_ENABLE_STARTUP_COMPUTE) {
        await runCompute("startup");
    }
    const runPrune = async (trigger) => {
        if (!env.STUDIO_BRAIN_ENABLE_RETENTION_PRUNE)
            return;
        try {
            const result = await (0, maintenance_1.pruneOldRows)(env.STUDIO_BRAIN_RETENTION_DAYS);
            logger.info("studio_brain_retention_prune_completed", {
                trigger,
                ...result,
            });
        }
        catch (error) {
            logger.error("studio_brain_retention_prune_failed", {
                trigger,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    };
    let timer = null;
    let pruneInterval = null;
    let shuttingDown = false;
    const backendHealth = async () => {
        const checks = [
            {
                label: "postgres",
                enabled: true,
                run: async () => dbConnection.healthcheck(),
            },
            {
                label: "redis",
                enabled: env.STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED,
                run: async () => redisConnection
                    ? redisConnection.healthcheck()
                    : { ok: false, latencyMs: 0, error: "redis disabled" },
            },
            {
                label: "event_bus",
                enabled: env.STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED && Boolean(eventBus),
                run: async () => eventBus ? eventBus.healthcheck() : { ok: false, latencyMs: 0, error: "event bus disabled" },
            },
            {
                label: "artifact_store",
                enabled: true,
                run: async () => artifactStore.healthcheck(),
            },
            {
                label: "vector_store",
                enabled: env.STUDIO_BRAIN_VECTOR_STORE_ENABLED,
                run: async () => {
                    if (!vectorStore)
                        return { ok: false, latencyMs: 0, error: "vector store disabled" };
                    return vectorStore.healthcheck();
                },
            },
            {
                label: "skill_registry",
                enabled: true,
                run: async () => skillRegistry.healthcheck(),
            },
            {
                label: "skill_sandbox",
                enabled: env.STUDIO_BRAIN_SKILL_SANDBOX_ENABLED,
                run: async () => {
                    if (!skillSandbox)
                        return { ok: false, latencyMs: 0, error: "skill sandbox disabled" };
                    const startedAt = Date.now();
                    const ok = await skillSandbox.healthcheck();
                    return { ok, latencyMs: Date.now() - startedAt };
                },
            },
        ];
        return (0, healthcheck_1.collectBackendHealth)(checks.map((check) => ({
            label: check.label,
            enabled: check.enabled,
            run: check.run,
        })), logger);
    };
    const server = (0, server_1.startHttpServer)({
        host: env.STUDIO_BRAIN_HOST,
        port: env.STUDIO_BRAIN_PORT,
        logger,
        stateStore,
        eventStore,
        requireFreshSnapshotForReady: env.STUDIO_BRAIN_REQUIRE_FRESH_SNAPSHOT_FOR_READY,
        readyMaxSnapshotAgeMinutes: env.STUDIO_BRAIN_READY_MAX_SNAPSHOT_AGE_MINUTES,
        getRuntimeStatus: () => ({
            startedAt: runtimeStartedAt,
            scheduler: { ...schedulerState },
            retention: {
                enabled: env.STUDIO_BRAIN_ENABLE_RETENTION_PRUNE,
                retentionDays: env.STUDIO_BRAIN_RETENTION_DAYS,
            },
            jobs: runner.getStats(),
        }),
        getRuntimeMetrics: () => ({
            scheduler: { ...schedulerState },
            retention: {
                enabled: env.STUDIO_BRAIN_ENABLE_RETENTION_PRUNE,
                retentionDays: env.STUDIO_BRAIN_RETENTION_DAYS,
            },
            jobs: runner.getStats(),
        }),
        capabilityRuntime,
        allowedOrigins: env.STUDIO_BRAIN_ALLOWED_ORIGINS
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
        adminToken: env.STUDIO_BRAIN_ADMIN_TOKEN,
        backendHealth,
        pilotWriteExecutor: env.STUDIO_BRAIN_ENABLE_WRITE_EXECUTION
            ? (0, pilotWriteExecutor_1.createPilotWriteExecutor)({ functionsBaseUrl: env.STUDIO_BRAIN_FUNCTIONS_BASE_URL })
            : null,
    });
    const scheduleNext = (delayMs) => {
        if (shuttingDown)
            return;
        const jitterMs = env.STUDIO_BRAIN_JOB_JITTER_MS > 0 ? Math.floor(Math.random() * (env.STUDIO_BRAIN_JOB_JITTER_MS + 1)) : 0;
        const effectiveDelayMs = delayMs + jitterMs;
        schedulerState.nextRunAt = new Date(Date.now() + effectiveDelayMs).toISOString();
        timer = setTimeout(async () => {
            schedulerState.nextRunAt = null;
            await runCompute("scheduled");
            scheduleNext(env.STUDIO_BRAIN_JOB_INTERVAL_MS);
        }, effectiveDelayMs);
        if (typeof timer.unref === "function") {
            timer.unref();
        }
    };
    const firstDelayMs = env.STUDIO_BRAIN_JOB_INITIAL_DELAY_MS > 0
        ? env.STUDIO_BRAIN_JOB_INITIAL_DELAY_MS
        : env.STUDIO_BRAIN_ENABLE_STARTUP_COMPUTE
            ? env.STUDIO_BRAIN_JOB_INTERVAL_MS
            : 0;
    scheduleNext(firstDelayMs);
    if (env.STUDIO_BRAIN_ENABLE_RETENTION_PRUNE) {
        await runPrune("startup");
        pruneInterval = setInterval(() => {
            void runPrune("scheduled");
        }, 24 * 60 * 60 * 1000);
        if (typeof pruneInterval.unref === "function") {
            pruneInterval.unref();
        }
    }
    const shutdown = async (signal, exitCode = 0) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        logger.info("studio_brain_shutdown_start", { signal });
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        if (pruneInterval) {
            clearInterval(pruneInterval);
            pruneInterval = null;
        }
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error)
                    reject(error);
                else
                    resolve();
            });
        });
        if (orchestrator) {
            await orchestrator.stop();
            orchestrator = null;
        }
        if (eventBus) {
            await eventBus.close();
            eventBus = null;
        }
        if (redisConnection) {
            await redisConnection.close();
            redisConnection = null;
        }
        if (skillSandbox) {
            await skillSandbox.close();
        }
        await dbConnection.close();
        logger.info("studio_brain_shutdown_complete", {});
        process.exitCode = exitCode;
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    process.on("uncaughtException", (error) => {
        logger.error("studio_brain_uncaught_exception", {
            message: error.message,
            stack: error.stack ?? null,
        });
        void shutdown("uncaughtException", 1);
    });
    process.on("unhandledRejection", (reason) => {
        logger.error("studio_brain_unhandled_rejection", {
            message: reason instanceof Error ? reason.message : String(reason),
        });
        void shutdown("unhandledRejection", 1);
    });
}
void main().catch((error) => {
    process.stderr.write(`studio-brain fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
});
