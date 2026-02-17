"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRedisClient = buildRedisClient;
const redis_1 = require("redis");
const retry_1 = require("./retry");
function buildRedisClient(config, logger) {
    const commandTimeoutMs = Math.max(500, config.commandTimeoutMs ?? 5_000);
    const withCommandTimeout = async (label, task) => {
        let timer = null;
        const timeout = new Promise((_, reject) => {
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
    const client = (0, redis_1.createClient)({
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
            code: error.code,
        });
    });
    const connect = async () => {
        await (0, retry_1.withRetry)("redis_connect", async () => {
            if (!client.isOpen) {
                await client.connect();
            }
        }, logger);
    };
    const healthcheck = async () => {
        const startedAt = Date.now();
        try {
            await connect();
            await (0, retry_1.withRetry)("redis_ping", async () => {
                const result = await withCommandTimeout("ping", () => client.ping());
                if (result !== "PONG") {
                    throw new Error(`bad redis ping response ${String(result)}`);
                }
            }, logger, { attempts: 3 });
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
    const close = async () => {
        if (client.isOpen || client.isReady) {
            await withCommandTimeout("quit", () => client.quit());
        }
    };
    return { client, healthcheck, close };
}
