import { Client as MinioClient } from "minio";
import type { Logger } from "../config/logger";
import { withRetry } from "./retry";

export type ArtifactMetadata = Record<string, unknown>;

export type ArtifactStoreHealth = {
  ok: boolean;
  latencyMs: number;
  error?: string;
};

export type ArtifactStore = {
  put: (key: string, data: Buffer, metadata?: ArtifactMetadata) => Promise<void>;
  get: (key: string) => Promise<Buffer | null>;
  list: (prefix?: string) => Promise<string[]>;
  healthcheck: () => Promise<ArtifactStoreHealth>;
};

export type ArtifactStoreConfig = {
  endpoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region?: string;
  timeoutMs?: number;
};

function toHostAndPort(url: string): { host: string; port: number; useSSL: boolean } {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || "127.0.0.1",
      port: Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80)),
      useSSL: parsed.protocol === "https:",
    };
  } catch {
    return {
      host: url || "127.0.0.1",
      port: 9000,
      useSSL: false,
    };
  }
}

function parseTimeoutMs(value: number | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 30_000) : 5_000;
}

function redactArtifactConfig(config: ArtifactStoreConfig): Record<string, string | number | boolean> {
  return {
    endpoint: config.endpoint,
    port: config.port,
    useSSL: config.useSSL,
    bucket: config.bucket,
    accessKey: config.accessKey ? "[set]" : "[missing]",
    secretKey: config.secretKey ? "[set]" : "[missing]",
  };
}

export async function createArtifactStore(config: ArtifactStoreConfig, logger: Logger): Promise<ArtifactStore> {
  const parsedUrl = toHostAndPort(config.endpoint);
  const timeoutMs = parseTimeoutMs(config.timeoutMs);
  const withTimeout = <T>(label: string, task: () => Promise<T>): Promise<T> => {
    let timer: NodeJS.Timeout | null = null;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`artifact store ${label} timed out`)), timeoutMs);
    });
    return Promise.race([task(), deadline]).finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
    });
  };

  const client = new MinioClient({
    endPoint: parsedUrl.host,
    port: Number.isFinite(config.port) ? config.port : parsedUrl.port,
    useSSL: config.useSSL || parsedUrl.useSSL,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    region: config.region,
  });

  const ensureBucket = async (): Promise<void> => {
    await withRetry("artifact_store_bucket", async () => {
      const exists = await client.bucketExists(config.bucket);
      if (!exists) {
        await client.makeBucket(config.bucket, config.region);
        logger.info("artifact_store_bucket_created", { bucket: config.bucket });
      }
    }, logger);
  };

  await ensureBucket();
  logger.info("artifact_store_connected", { config: redactArtifactConfig(config) });

  const put = async (key: string, data: Buffer, metadata: ArtifactMetadata = {}): Promise<void> => {
    await withRetry("artifact_store_put", async () => {
      await withTimeout("put", () =>
        client.putObject(config.bucket, key, data, data.length, {
          "Content-Type": "application/octet-stream",
          ...Object.fromEntries(
            Object.entries(metadata).map(([metaKey, metaValue]) => [metaKey, String(metaValue)])
          ),
        })
      );
    }, logger);
  };

  const get = async (key: string): Promise<Buffer | null> => {
    try {
      const stream = await withTimeout(
        "get",
        () => withRetry("artifact_store_get", async () => client.getObject(config.bucket, key), logger)
      );
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        stream.on("end", () => resolve());
        stream.on("error", (error: Error) => reject(error));
      });
      return Buffer.concat(chunks);
    } catch (error) {
      if ((error as { code?: string }).code === "NoSuchKey") {
        return null;
      }
      throw error;
    }
  };

  const list = async (prefix = ""): Promise<string[]> => {
    const objects: string[] = [];
    const stream = await withTimeout(
      "list",
      () =>
        withRetry("artifact_store_list", () => Promise.resolve(client.listObjects(config.bucket, prefix, true)), logger)
    );
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (obj: { name?: string }) => {
        if (obj?.name) {
          objects.push(obj.name);
        }
      });
      stream.on("error", (error: Error) => reject(error));
      stream.on("end", () => resolve());
    });
    return objects;
  };

  const healthcheck = async (): Promise<ArtifactStoreHealth> => {
    const startedAt = Date.now();
    try {
      await withTimeout(
        "health",
        () =>
          withRetry("artifact_store_health", async () => {
            const exists = await client.bucketExists(config.bucket);
            if (!exists) {
              throw new Error(`bucket not found: ${config.bucket}`);
            }
          }, logger)
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

  return { put, get, list, healthcheck };
}
