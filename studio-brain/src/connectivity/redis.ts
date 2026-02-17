import { createClient, type RedisClientType } from "redis";
import type { Logger } from "../config/logger";
import { withRetry } from "./retry";

export type RedisConfig = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
};

export type RedisHealth = {
  ok: boolean;
  latencyMs: number;
  error?: string;
};

export type RedisConnection = {
  client: RedisClientType;
  healthcheck: () => Promise<RedisHealth>;
  close: () => Promise<void>;
};

export function buildRedisClient(config: RedisConfig, logger: Logger): RedisConnection {
  const commandTimeoutMs = Math.max(500, config.commandTimeoutMs ?? 5_000);

  const withCommandTimeout = async <T>(label: string, task: () => Promise<T>): Promise<T> => {
    let timer: NodeJS.Timeout | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`redis ${label} command timed out after ${commandTimeoutMs}ms`));
      }, commandTimeoutMs);
    });
    return Promise.race([task(), timeout]).finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
    });
  };

  const client = createClient({
    socket: {
      host: config.host,
      port: config.port,
      connectTimeout: Math.max(500, config.connectTimeoutMs ?? 5_000),
      reconnectStrategy(retries) {
        return Math.min(250 * (retries + 1), 3_000);
      },
    },
    username: config.username || undefined,
    password: config.password || undefined,
    pingInterval: 1_000,
  });

  client.on("error", (error) => {
    logger.error("redis_client_error", {
      message: error.message,
      code: (error as { code?: string }).code,
    });
  });

  const connect = async (): Promise<void> => {
    await withRetry(
      "redis_connect",
      async () => {
        if (!client.isOpen) {
          await client.connect();
        }
      },
      logger
    );
  };

  const healthcheck = async (): Promise<RedisHealth> => {
    const startedAt = Date.now();
    try {
      await connect();
      await withRetry(
        "redis_ping",
        async () => {
          const result = await withCommandTimeout("ping", () => client.ping());
          if (result !== "PONG") {
            throw new Error(`bad redis ping response ${String(result)}`);
          }
        },
        logger,
        { attempts: 3 }
      );
      return { ok: true, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const close = async (): Promise<void> => {
    if (client.isOpen || client.isReady) {
      await withCommandTimeout("quit", () => client.quit());
    }
  };

  return { client, healthcheck, close };
}
