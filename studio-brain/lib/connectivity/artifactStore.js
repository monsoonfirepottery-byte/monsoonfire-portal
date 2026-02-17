"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createArtifactStore = createArtifactStore;
const minio_1 = require("minio");
const retry_1 = require("./retry");
function toHostAndPort(url) {
    try {
        const parsed = new URL(url);
        return {
            host: parsed.hostname || "127.0.0.1",
            port: Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80)),
            useSSL: parsed.protocol === "https:",
        };
    }
    catch {
        return {
            host: url || "127.0.0.1",
            port: 9000,
            useSSL: false,
        };
    }
}
function parseTimeoutMs(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 30_000) : 5_000;
}
function redactArtifactConfig(config) {
    return {
        endpoint: config.endpoint,
        port: config.port,
        useSSL: config.useSSL,
        bucket: config.bucket,
        accessKey: config.accessKey ? "[set]" : "[missing]",
        secretKey: config.secretKey ? "[set]" : "[missing]",
    };
}
async function createArtifactStore(config, logger) {
    const parsedUrl = toHostAndPort(config.endpoint);
    const timeoutMs = parseTimeoutMs(config.timeoutMs);
    const withTimeout = (label, task) => {
        let timer = null;
        const deadline = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`artifact store ${label} timed out`)), timeoutMs);
        });
        return Promise.race([task(), deadline]).finally(() => {
            if (timer) {
                clearTimeout(timer);
            }
        });
    };
    const client = new minio_1.Client({
        endPoint: parsedUrl.host,
        port: Number.isFinite(config.port) ? config.port : parsedUrl.port,
        useSSL: config.useSSL || parsedUrl.useSSL,
        accessKey: config.accessKey,
        secretKey: config.secretKey,
        region: config.region,
    });
    const ensureBucket = async () => {
        await (0, retry_1.withRetry)("artifact_store_bucket", async () => {
            const exists = await client.bucketExists(config.bucket);
            if (!exists) {
                await client.makeBucket(config.bucket, config.region);
                logger.info("artifact_store_bucket_created", { bucket: config.bucket });
            }
        }, logger);
    };
    await ensureBucket();
    logger.info("artifact_store_connected", { config: redactArtifactConfig(config) });
    const put = async (key, data, metadata = {}) => {
        await (0, retry_1.withRetry)("artifact_store_put", async () => {
            await withTimeout("put", () => client.putObject(config.bucket, key, data, data.length, {
                "Content-Type": "application/octet-stream",
                ...Object.fromEntries(Object.entries(metadata).map(([metaKey, metaValue]) => [metaKey, String(metaValue)])),
            }));
        }, logger);
    };
    const get = async (key) => {
        try {
            const stream = await withTimeout("get", () => (0, retry_1.withRetry)("artifact_store_get", async () => client.getObject(config.bucket, key), logger));
            const chunks = [];
            await new Promise((resolve, reject) => {
                stream.on("data", (chunk) => {
                    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                });
                stream.on("end", () => resolve());
                stream.on("error", (error) => reject(error));
            });
            return Buffer.concat(chunks);
        }
        catch (error) {
            if (error.code === "NoSuchKey") {
                return null;
            }
            throw error;
        }
    };
    const list = async (prefix = "") => {
        const objects = [];
        const stream = await withTimeout("list", () => (0, retry_1.withRetry)("artifact_store_list", () => Promise.resolve(client.listObjects(config.bucket, prefix, true)), logger));
        await new Promise((resolve, reject) => {
            stream.on("data", (obj) => {
                if (obj?.name) {
                    objects.push(obj.name);
                }
            });
            stream.on("error", (error) => reject(error));
            stream.on("end", () => resolve());
        });
        return objects;
    };
    const healthcheck = async () => {
        const startedAt = Date.now();
        try {
            await withTimeout("health", () => (0, retry_1.withRetry)("artifact_store_health", async () => {
                const exists = await client.bucketExists(config.bucket);
                if (!exists) {
                    throw new Error(`bucket not found: ${config.bucket}`);
                }
            }, logger));
            return { ok: true, latencyMs: Date.now() - startedAt };
        }
        catch (error) {
            return {
                ok: false,
                latencyMs: Date.now() - startedAt,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    };
    return { put, get, list, healthcheck };
}
