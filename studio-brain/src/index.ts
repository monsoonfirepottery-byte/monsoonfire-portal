import { readEnv, redactEnvForLogs } from "./config/env";
import { createLogger } from "./config/logger";
import { collectBackendHealth, type BackendHealthReport } from "./connectivity/healthcheck";
import { createDatabaseConnection } from "./connectivity/database";
import { createArtifactStore, type ArtifactStore } from "./connectivity/artifactStore";
import { createRedisStreamEventBus, type SwarmEventBus } from "./swarm/bus/eventBus";
import { buildRedisClient, type RedisConnection } from "./connectivity/redis";
import { createVectorStore, type VectorStore } from "./connectivity/vectorStore";
import { PruneResult, pruneOldRows } from "./db/maintenance";
import { PostgresEventStore } from "./stores/postgresEventStore";
import { PostgresStateStore } from "./stores/postgresStateStore";
import { JobRunner } from "./jobs/runner";
import { computeStudioStateJob } from "./jobs/studioStateJob";
import { startHttpServer } from "./http/server";
import { CapabilityRuntime, defaultCapabilities } from "./capabilities/runtime";
import { InMemoryQuotaStore } from "./capabilities/policy";
import { PostgresPolicyStore, PostgresProposalStore, PostgresQuotaStore } from "./capabilities/postgresStores";
import { HubitatConnector } from "./connectors/hubitatConnector";
import { RoborockConnector } from "./connectors/roborockConnector";
import { ConnectorRegistry } from "./connectors/registry";
import { createPilotWriteExecutor } from "./capabilities/pilotWriteExecutor";
import { SwarmOrchestrator, deriveSwarmRunId } from "./swarm/orchestrator";
import { createLocalRegistryClient, createRemoteRegistryClient, type SkillRegistryClient } from "./skills/registry";
import { createSkillSandbox, type SkillSandboxClient } from "./skills/sandbox";

function parseArtifactPort(endpoint: string, fallback: number): number {
  try {
    const parsed = new URL(endpoint);
    const port = Number(parsed.port);
    return Number.isFinite(port) && port > 0 ? port : fallback;
  } catch {
    return fallback;
  }
}

async function main(): Promise<void> {
  const env = readEnv();
  const logger = createLogger(env.STUDIO_BRAIN_LOG_LEVEL);
  const runtimeStartedAt = new Date().toISOString();

  const schedulerState = {
    intervalMs: env.STUDIO_BRAIN_JOB_INTERVAL_MS,
    jitterMs: env.STUDIO_BRAIN_JOB_JITTER_MS,
    initialDelayMs: env.STUDIO_BRAIN_JOB_INITIAL_DELAY_MS,
    nextRunAt: null as string | null,
    lastRunStartedAt: null as string | null,
    lastRunCompletedAt: null as string | null,
    lastRunDurationMs: null as number | null,
    totalRuns: 0,
    totalFailures: 0,
    consecutiveFailures: 0,
    lastFailureMessage: null as string | null,
  };

  logger.info("studio_brain_boot", {
    mode: "anchor",
    cloudAuthoritative: true,
    localWriteExecutionEnabled: env.STUDIO_BRAIN_ENABLE_WRITE_EXECUTION,
    requireApprovalForExternalWrites: env.STUDIO_BRAIN_REQUIRE_APPROVAL_FOR_EXTERNAL_WRITES,
    env: redactEnvForLogs(env),
  });

  logger.info("studio_brain_connectivity_boot", {});
  const dbConnection = await createDatabaseConnection(logger);

  const skillRegistry: SkillRegistryClient = env.STUDIO_BRAIN_SKILL_REGISTRY_REMOTE_BASE_URL
    ? createRemoteRegistryClient({
        baseUrl: env.STUDIO_BRAIN_SKILL_REGISTRY_REMOTE_BASE_URL,
      })
    : createLocalRegistryClient({
        rootPath: env.STUDIO_BRAIN_SKILL_REGISTRY_LOCAL_PATH,
      });

  const artifactStore: ArtifactStore = await createArtifactStore(
    {
      endpoint: env.STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT,
      port: parseArtifactPort(env.STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT, 9000),
      useSSL: env.STUDIO_BRAIN_ARTIFACT_STORE_USE_SSL,
      accessKey: env.STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY,
      secretKey: env.STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY,
      bucket: env.STUDIO_BRAIN_ARTIFACT_STORE_BUCKET,
      timeoutMs: env.STUDIO_BRAIN_ARTIFACT_STORE_TIMEOUT_MS,
    },
    logger
  );

  const vectorStore: VectorStore | null = env.STUDIO_BRAIN_VECTOR_STORE_ENABLED
    ? await createVectorStore(logger)
    : null;

  let redisConnection: RedisConnection | null = null;
  let eventBus: SwarmEventBus | null = null;
  let orchestrator: SwarmOrchestrator | null = null;
  let swarmRunId = "";

  if (env.STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED) {
    redisConnection = buildRedisClient(
      {
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        username: env.REDIS_USERNAME,
        password: env.REDIS_PASSWORD,
        connectTimeoutMs: env.REDIS_CONNECT_TIMEOUT_MS,
        commandTimeoutMs: env.REDIS_COMMAND_TIMEOUT_MS,
      },
      logger
    );

    eventBus = await createRedisStreamEventBus(
      redisConnection,
      env.STUDIO_BRAIN_REDIS_STREAM_NAME,
      logger,
      {
        startId: env.STUDIO_BRAIN_EVENT_BUS_START_ID,
        pollIntervalMs: env.STUDIO_BRAIN_EVENT_BUS_POLL_INTERVAL_MS,
        maxBatchSize: env.STUDIO_BRAIN_EVENT_BUS_BATCH_SIZE,
        commandTimeoutMs: env.REDIS_COMMAND_TIMEOUT_MS,
      }
    );

    swarmRunId = env.STUDIO_BRAIN_SWARM_RUN_ID || deriveSwarmRunId(env.STUDIO_BRAIN_SWARM_ID);

    orchestrator = new SwarmOrchestrator({
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
      return await createSkillSandbox({
        enabled: env.STUDIO_BRAIN_SKILL_SANDBOX_ENABLED,
        egressDeny: env.STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_DENY,
        egressAllowlist: env.STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_ALLOWLIST,
        entryTimeoutMs: env.STUDIO_BRAIN_SKILL_SANDBOX_ENTRY_TIMEOUT_MS,
        runtimeAllowlist: env.STUDIO_BRAIN_SKILL_RUNTIME_ALLOWLIST,
        logger,
      });
    } catch (error) {
      logger.warn("studio_brain_skill_sandbox_init_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  })();

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

  const runPrune = async (trigger: "startup" | "scheduled"): Promise<void> => {
    if (!env.STUDIO_BRAIN_ENABLE_RETENTION_PRUNE) return;
    try {
      const result: PruneResult = await pruneOldRows(env.STUDIO_BRAIN_RETENTION_DAYS);
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

  let timer: NodeJS.Timeout | null = null;
  let pruneInterval: NodeJS.Timeout | null = null;
  let shuttingDown = false;

  const backendHealth = async (): Promise<BackendHealthReport> => {
    const checks = [
      {
        label: "postgres",
        enabled: true,
        run: async () => dbConnection.healthcheck(),
      },
      {
        label: "redis",
        enabled: env.STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED,
        run: async () =>
          redisConnection
            ? redisConnection.healthcheck()
            : { ok: false, latencyMs: 0, error: "redis disabled" },
      },
      {
        label: "event_bus",
        enabled: env.STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED && Boolean(eventBus),
        run: async () =>
          eventBus ? eventBus.healthcheck() : { ok: false, latencyMs: 0, error: "event bus disabled" },
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
          if (!vectorStore) return { ok: false, latencyMs: 0, error: "vector store disabled" };
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
          if (!skillSandbox) return { ok: false, latencyMs: 0, error: "skill sandbox disabled" };
          const startedAt = Date.now();
          const ok = await skillSandbox.healthcheck();
          return { ok, latencyMs: Date.now() - startedAt };
        },
      },
    ];

    return collectBackendHealth(
      checks.map((check) => ({
        label: check.label,
        enabled: check.enabled,
        run: check.run,
      })),
      logger
    );
  };

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
    backendHealth,
    pilotWriteExecutor: env.STUDIO_BRAIN_ENABLE_WRITE_EXECUTION
      ? createPilotWriteExecutor({ functionsBaseUrl: env.STUDIO_BRAIN_FUNCTIONS_BASE_URL })
      : null,
  });

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
