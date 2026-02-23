import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";

import { readEnv } from "../config/env";
import { createLogger } from "../config/logger";
import { checkPgConnection, closePgPool, getPgPool } from "../db/postgres";
import { createDatabaseConnection } from "../connectivity/database";
import { buildRedisClient } from "../connectivity/redis";
import { createRedisStreamEventBus } from "../swarm/bus/eventBus";
import { createArtifactStore } from "../connectivity/artifactStore";
import { createVectorStore } from "../connectivity/vectorStore";
import { SwarmOrchestrator } from "../swarm/orchestrator";
import { getRecentSwarmEvents, getTask } from "../swarm/store";

function runCommand(
  command: string,
  args: string[],
  options: { env?: Record<string, string>; cwd?: string } = {}
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
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

async function withPatchedEnv<T>(patch: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const original: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(patch)) {
    original[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function parseJsonFromOutput(output: string): Record<string, unknown> {
  const trimmed = output.trim();
  const match = trimmed.match(/(\{[\s\S]*\})\s*$/);
  if (!match) throw new Error("no JSON object in output");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

function parseArtifactPort(endpoint: string, fallback: number): number {
  try {
    const parsed = new URL(endpoint);
    const parsedPort = Number(parsed.port);
    return Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : fallback;
  } catch {
    return fallback;
  }
}

async function waitForTask(taskId: string, attempts = 20, delayMs = 250) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const task = await getTask(taskId);
    if (task) {
      return task;
    }
    await wait(delayMs);
  }
  throw new Error(`orchestrator task not materialized for ${taskId}`);
}

async function waitForDependencies(loggerLabel: string, patch: Record<string, string>, attempts = 45) {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await withPatchedEnv(patch, async () => {
        readEnv();
        const env = readEnv();
        const pg = await checkPgConnection(createLogger("error"));
        if (!pg.ok) {
          throw new Error(`postgres not ready: ${pg.error ?? "unknown"}`);
        }

        const redis = buildRedisClient(
          {
            host: env.REDIS_HOST,
            port: env.REDIS_PORT,
            username: env.REDIS_USERNAME,
            password: env.REDIS_PASSWORD,
            connectTimeoutMs: 1_000,
            commandTimeoutMs: 1_000,
          },
          createLogger("error")
        );

        const redisHealth = await redis.healthcheck();
        await redis.close();
        if (!redisHealth.ok) {
          throw new Error(`redis not ready: ${redisHealth.error ?? "unknown"}`);
        }
      });

      await closePgPool();
      return;
    } catch (error) {
      lastError = error;
      await wait(400 + attempt * 200);
    }
  }

  throw new Error(`service readiness failed (${loggerLabel}): ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

const RUN_INTEGRATION = process.env.STUDIO_BRAIN_INFRA_INTEGRATION === "1";
const composePath = path.join(process.cwd(), "docker-compose.yml");

if (!RUN_INTEGRATION) {
  test("backend integration test is skipped unless STUDIO_BRAIN_INFRA_INTEGRATION=1", () => {
    // integration run intentionally optional to keep CI lightweight
  });
} else {
  test("backend integration stack can start and process event/store checks", async () => {
    const patch = {
      PGHOST: "127.0.0.1",
      PGPORT: "5433",
      PGDATABASE: "monsoonfire_studio_os",
      PGUSER: "postgres",
      PGPASSWORD: "postgres",
      REDIS_HOST: "127.0.0.1",
      REDIS_PORT: "6379",
      STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT: "http://127.0.0.1:9010",
      STUDIO_BRAIN_ARTIFACT_STORE_BUCKET: "studiobrain-artifacts",
      STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY: "minioadmin",
      STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY: "minioadmin",
      STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED: "true",
      STUDIO_BRAIN_VECTOR_STORE_ENABLED: "true",
      STUDIO_BRAIN_SKILL_SANDBOX_ENABLED: "false",
    };

    const composeUp = runCommand(
      "docker",
      ["compose", "-f", composePath, "up", "-d", "postgres", "redis", "minio"],
      { env: patch }
    );
    if (composeUp.status !== 0) {
      throw new Error(`compose up failed: ${composeUp.stderr || composeUp.stdout}`);
    }

    try {
      await waitForDependencies("backend integration", patch);

      const logger = createLogger("info");
      const db = await withPatchedEnv(patch, async () => {
        const env = readEnv();
        return createDatabaseConnection(logger);
      });
      const dbHealth = await db.healthcheck();
      assert.ok(dbHealth.ok, `postgres health failed: ${dbHealth.error ?? "unknown"}`);

      const migration = await withPatchedEnv(patch, async () => db.migrate());
      assert.ok(Array.isArray(migration.applied), "migrations should return array");

      const tableCheck = await withPatchedEnv(patch, async () => {
        const pool = getPgPool();
        return pool.query(
          "SELECT to_regclass('public.swarm_tasks') AS swarm_tasks_table, to_regclass('public.brain_migrations') AS migrations_table"
        );
      });
      assert.ok(tableCheck.rows[0]?.swarm_tasks_table);
      assert.ok(tableCheck.rows[0]?.migrations_table);

      await withPatchedEnv(patch, async () => {
        const env = readEnv();
        const redis = buildRedisClient(
          {
            host: env.REDIS_HOST,
            port: env.REDIS_PORT,
            username: env.REDIS_USERNAME,
            password: env.REDIS_PASSWORD,
          },
          logger
        );

        const bus = await createRedisStreamEventBus(
          redis,
          env.STUDIO_BRAIN_REDIS_STREAM_NAME,
          logger,
          {
            startId: "0-0",
            pollIntervalMs: 250,
            maxBatchSize: 8,
            commandTimeoutMs: 1_000,
          }
        );

        const seen: Array<{ taskId: string }> = [];
        const marker = `it-${Date.now()}`;
        const sub = await bus.subscribe(async (event) => {
          if (event.type === "task.created") {
            const taskId = String((event.payload as { taskId?: unknown }).taskId ?? "");
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

        await wait(900);
        assert.ok(
          seen.some((entry) => entry.taskId === marker),
          "event bus should receive the published test event"
        );

        await sub.stop();
        await bus.close();
      });

      await withPatchedEnv(patch, async () => {
        const env = readEnv();
        const redis = buildRedisClient(
          {
            host: env.REDIS_HOST,
            port: env.REDIS_PORT,
            username: env.REDIS_USERNAME,
            password: env.REDIS_PASSWORD,
            connectTimeoutMs: 1_000,
            commandTimeoutMs: 1_000,
          },
          logger
        );

        const bus = await createRedisStreamEventBus(
          redis,
          env.STUDIO_BRAIN_REDIS_STREAM_NAME,
          logger,
          {
            startId: "$",
            pollIntervalMs: 250,
            maxBatchSize: 8,
            commandTimeoutMs: 1_000,
          }
        );

        const orchestrator = new SwarmOrchestrator({
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
        assert.equal(persistedTask.id, marker);
        assert.equal(persistedTask.status, "assigned");

        const events = await getRecentSwarmEvents(20);
        const followed = events.find(
          (event) =>
            event.eventType === "task.assigned" &&
            String(event.payload?.taskId ?? "") === marker
        );
        assert.ok(
          followed,
          "orchestrator should emit and persist task.assigned event"
        );

        await orchestrator.stop();
      });

      await withPatchedEnv(patch, async () => {
        const env = readEnv();
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

        const key = `infra-smoke/${Date.now()}.txt`;
        await artifactStore.put(key, Buffer.from("ok", "utf8"));
        const readBack = await artifactStore.get(key);
        assert.equal(readBack?.toString("utf8"), "ok");
      });

      await withPatchedEnv(patch, async () => {
        const vectorStore = await createVectorStore(logger);
        const vectorHealth = await vectorStore.healthcheck();
        assert.ok(vectorHealth.ok, vectorHealth.error ?? "vector check failed");
      });

      const healthOutput = runCommand(
        "node",
        ["lib/cli/healthcheck.js", "--output", "json"],
        { env: patch }
      );
      if (healthOutput.status !== 0) {
        throw new Error(`healthcheck command failed: ${healthOutput.stderr || healthOutput.stdout}`);
      }

      const report = parseJsonFromOutput(healthOutput.stdout);
      assert.equal(report.ok, true);
      const checks = Array.isArray(report.checks) ? report.checks : [];
      const checkNames = checks.map((entry) => String((entry as Record<string, unknown>).name));
      assert.ok(checkNames.includes("postgres"));
      assert.ok(checkNames.includes("redis"));
      assert.ok(checkNames.includes("event_bus"));

      await db.close();
      await closePgPool();
    } finally {
      if (process.env.STUDIO_BRAIN_INFRA_KEEP_STACK !== "1") {
        runCommand("docker", ["compose", "-f", composePath, "down", "-v"], { env: patch });
      }
    }
  });
}
