"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const env_1 = require("./config/env");
const logger_1 = require("./config/logger");
const migrate_1 = require("./db/migrate");
const postgresEventStore_1 = require("./stores/postgresEventStore");
const postgresStateStore_1 = require("./stores/postgresStateStore");
const runner_1 = require("./jobs/runner");
const studioStateJob_1 = require("./jobs/studioStateJob");
const server_1 = require("./http/server");
const postgres_1 = require("./db/postgres");
const maintenance_1 = require("./db/maintenance");
const runtime_1 = require("./capabilities/runtime");
const postgresStores_1 = require("./capabilities/postgresStores");
const hubitatConnector_1 = require("./connectors/hubitatConnector");
const roborockConnector_1 = require("./connectors/roborockConnector");
const registry_1 = require("./connectors/registry");
const pilotWriteExecutor_1 = require("./capabilities/pilotWriteExecutor");
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
    logger.info("studio_brain_migrations_start", {});
    const migrationResult = await (0, migrate_1.runMigrations)();
    logger.info("studio_brain_migrations_complete", {
        appliedCount: migrationResult.applied.length,
        applied: migrationResult.applied,
    });
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
        pilotWriteExecutor: env.STUDIO_BRAIN_ENABLE_WRITE_EXECUTION
            ? (0, pilotWriteExecutor_1.createPilotWriteExecutor)({ functionsBaseUrl: env.STUDIO_BRAIN_FUNCTIONS_BASE_URL })
            : null,
    });
    let timer = null;
    let pruneInterval = null;
    let shuttingDown = false;
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
        await (0, postgres_1.closePgPool)();
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
