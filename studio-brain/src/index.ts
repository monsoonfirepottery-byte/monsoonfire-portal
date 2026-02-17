import { readEnv, redactEnvForLogs } from "./config/env";
import { createLogger } from "./config/logger";
import { runMigrations } from "./db/migrate";
import { PostgresEventStore } from "./stores/postgresEventStore";
import { PostgresStateStore } from "./stores/postgresStateStore";
import { JobRunner } from "./jobs/runner";
import { computeStudioStateJob } from "./jobs/studioStateJob";
import { startHttpServer } from "./http/server";
import { closePgPool } from "./db/postgres";
import { pruneOldRows } from "./db/maintenance";
import { CapabilityRuntime, defaultCapabilities } from "./capabilities/runtime";
import { PostgresPolicyStore, PostgresProposalStore, PostgresQuotaStore } from "./capabilities/postgresStores";
import { HubitatConnector } from "./connectors/hubitatConnector";
import { RoborockConnector } from "./connectors/roborockConnector";
import { ConnectorRegistry } from "./connectors/registry";
import { createPilotWriteExecutor } from "./capabilities/pilotWriteExecutor";

async function main(): Promise<void> {
  const env = readEnv();
  const logger = createLogger(env.STUDIO_BRAIN_LOG_LEVEL);
  const runtimeStartedAt = new Date().toISOString();
  const schedulerState: {
    intervalMs: number;
    jitterMs: number;
    initialDelayMs: number;
    nextRunAt: string | null;
    lastRunStartedAt: string | null;
    lastRunCompletedAt: string | null;
    lastRunDurationMs: number | null;
    totalRuns: number;
    totalFailures: number;
    consecutiveFailures: number;
    lastFailureMessage: string | null;
  } = {
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
    env: redactEnvForLogs(env),
  });

  logger.info("studio_brain_migrations_start", {});
  const migrationResult = await runMigrations();
  logger.info("studio_brain_migrations_complete", {
    appliedCount: migrationResult.applied.length,
    applied: migrationResult.applied,
  });

  const stateStore = new PostgresStateStore();
  const eventStore = new PostgresEventStore();
  const connectorRegistry = new ConnectorRegistry(
    [
      new HubitatConnector(async (path) => {
        if (path === "/health") return { ok: true };
        return { devices: [] };
      }),
      new RoborockConnector(async (path) => {
        if (path === "/health") return { ok: true };
        return { devices: [] };
      }),
    ],
    logger
  );
  const capabilityRuntime = new CapabilityRuntime(
    defaultCapabilities,
    eventStore,
    new PostgresProposalStore(),
    new PostgresQuotaStore(),
    new PostgresPolicyStore(),
    connectorRegistry
  );

  const runner = new JobRunner(
    {
      stateStore,
      eventStore,
      logger,
    },
    {
      computeStudioState: computeStudioStateJob,
    }
  );

  const runCompute = async (trigger: "startup" | "scheduled"): Promise<void> => {
    const startedAtMs = Date.now();
    schedulerState.lastRunStartedAt = new Date(startedAtMs).toISOString();
    schedulerState.totalRuns += 1;
    try {
      await runner.run("computeStudioState");
      schedulerState.consecutiveFailures = 0;
      schedulerState.lastFailureMessage = null;
    } catch (error) {
      schedulerState.totalFailures += 1;
      schedulerState.consecutiveFailures += 1;
      schedulerState.lastFailureMessage = error instanceof Error ? error.message : String(error);
      logger.error("compute_studio_state_failed", {
        trigger,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      schedulerState.lastRunCompletedAt = new Date().toISOString();
      schedulerState.lastRunDurationMs = Date.now() - startedAtMs;
    }
  };

  if (env.STUDIO_BRAIN_ENABLE_STARTUP_COMPUTE) {
    await runCompute("startup");
  }

  const server = startHttpServer({
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
      ? createPilotWriteExecutor({ functionsBaseUrl: env.STUDIO_BRAIN_FUNCTIONS_BASE_URL })
      : null,
  });

  let timer: NodeJS.Timeout | null = null;
  let pruneInterval: NodeJS.Timeout | null = null;
  let shuttingDown = false;

  const scheduleNext = (delayMs: number): void => {
    if (shuttingDown) return;
    const jitterMs =
      env.STUDIO_BRAIN_JOB_JITTER_MS > 0 ? Math.floor(Math.random() * (env.STUDIO_BRAIN_JOB_JITTER_MS + 1)) : 0;
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

  const firstDelayMs =
    env.STUDIO_BRAIN_JOB_INITIAL_DELAY_MS > 0
      ? env.STUDIO_BRAIN_JOB_INITIAL_DELAY_MS
      : env.STUDIO_BRAIN_ENABLE_STARTUP_COMPUTE
        ? env.STUDIO_BRAIN_JOB_INTERVAL_MS
        : 0;
  scheduleNext(firstDelayMs);

  const runPrune = async (trigger: "startup" | "scheduled"): Promise<void> => {
    if (!env.STUDIO_BRAIN_ENABLE_RETENTION_PRUNE) return;
    try {
      const result = await pruneOldRows(env.STUDIO_BRAIN_RETENTION_DAYS);
      logger.info("studio_brain_retention_prune_completed", {
        trigger,
        ...result,
      });
    } catch (error) {
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

  const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) return;
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

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    await closePgPool();
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
