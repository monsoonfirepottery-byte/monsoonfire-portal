import { readEnv } from "../config/env";
import { createLogger } from "../config/logger";
import { createDatabaseConnection } from "../connectivity/database";
import { createArtifactStore } from "../connectivity/artifactStore";
import { collectBackendHealth, renderHealthTable } from "../connectivity/healthcheck";
import { buildRedisClient } from "../connectivity/redis";
import { createRedisStreamEventBus } from "../swarm/bus/eventBus";
import { createVectorStore } from "../connectivity/vectorStore";

function parseArtifactPort(endpoint: string, fallback: number): number {
  try {
    const parsed = new URL(endpoint);
    const port = Number(parsed.port);
    return Number.isFinite(port) && port > 0 ? port : fallback;
  } catch {
    return fallback;
  }
}

type HealthArgument = {
  output: "json" | "table";
};

function arg(name: string, fallback: string | undefined = undefined): string | undefined {
  const prefix = `--${name}=`;
  const exact = process.argv.find((entry) => entry === `--${name}`);
  if (exact === `--${name}`) return "";
  const prefixed = process.argv.find((entry) => entry.startsWith(prefix));
  if (!prefixed) return fallback;
  return prefixed.slice(prefix.length);
}

async function run(): Promise<void> {
  const outputMode = arg("output", "table") === "json" ? "json" : "table";
  const env = readEnv();
  const logger = createLogger(env.STUDIO_BRAIN_LOG_LEVEL);

  const checks = [
    {
      label: "postgres",
      enabled: true,
      run: async () => {
        const db = await createDatabaseConnection(logger);
        const health = await db.healthcheck();
        await db.close();
        return health;
      },
    },
    {
      label: "redis",
      enabled: env.STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED,
      run: async () => {
        const client = buildRedisClient(
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
        const result = await client.healthcheck();
        await client.close();
        return result;
      },
    },
    {
      label: "event_bus",
      enabled: env.STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED,
      run: async () => {
        const client = buildRedisClient(
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
        const bus = await createRedisStreamEventBus(
          client,
          env.STUDIO_BRAIN_REDIS_STREAM_NAME,
          logger,
          {
            pollIntervalMs: env.STUDIO_BRAIN_EVENT_BUS_POLL_INTERVAL_MS,
            maxBatchSize: env.STUDIO_BRAIN_EVENT_BUS_BATCH_SIZE,
            commandTimeoutMs: env.REDIS_COMMAND_TIMEOUT_MS,
          }
        );
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
        const artifactStore = await createArtifactStore(
          {
            endpoint,
            port: parseArtifactPort(endpoint, 9000),
            useSSL: env.STUDIO_BRAIN_ARTIFACT_STORE_USE_SSL,
            accessKey: env.STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY,
            secretKey: env.STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY,
            bucket: env.STUDIO_BRAIN_ARTIFACT_STORE_BUCKET,
          },
          logger
        );
        const result = await artifactStore.healthcheck();
        return result;
      },
    },
    {
      label: "vector_store",
      enabled: env.STUDIO_BRAIN_VECTOR_STORE_ENABLED,
      run: async () => {
        const vectorStore = await createVectorStore(logger);
        return vectorStore.healthcheck();
      },
    },
  ] as const;

  const report = await collectBackendHealth(
    checks.map((check) => ({
      label: check.label,
      enabled: check.enabled,
      run: check.run,
    })),
    logger
  );

  if (outputMode === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(renderHealthTable(report));
  }

  process.exitCode = report.ok ? 0 : 1;
}

void run().catch((error) => {
  process.stderr.write(`healthcheck failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
