"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRedisStreamEventBus = createRedisStreamEventBus;
const retry_1 = require("../../connectivity/retry");
async function createRedisStreamEventBus(redis, streamName, logger, options) {
    const pollIntervalMs = Math.max(200, options?.pollIntervalMs ?? 750);
    const maxBatchSize = Math.max(1, Math.min(options?.maxBatchSize ?? 32, 128));
    const startId = options?.startId ?? "$";
    let active = true;
    let worker = null;
    const commandTimeoutMs = Math.max(500, options?.commandTimeoutMs ?? 5_000, pollIntervalMs + 1_000);
    const withCommandTimeout = async (label, task) => {
        let timer = null;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`event bus ${label} command timed out after ${commandTimeoutMs}ms`)), commandTimeoutMs);
        });
        return Promise.race([task(), timeout]).finally(() => {
            if (timer) {
                clearTimeout(timer);
            }
        });
    };
    await (0, retry_1.withRetry)("event_bus_connect", async () => {
        if (!redis.client.isOpen) {
            await redis.client.connect();
        }
    }, logger, { attempts: 5, baseDelayMs: 100 });
    const toStringValue = (value) => (Buffer.isBuffer(value) ? value.toString("utf8") : String(value));
    const parseEventPayload = (payload) => {
        if (!payload || typeof payload !== "string") {
            throw new Error("Invalid event payload in redis stream.");
        }
        const parsed = JSON.parse(payload);
        if (!parsed.id || !parsed.type || !parsed.swarmId || !parsed.runId) {
            throw new Error("Invalid event payload shape.");
        }
        return {
            ...parsed,
            createdAt: parsed.createdAt ?? new Date().toISOString(),
        };
    };
    const parseStreamRecords = (raw) => {
        if (!Array.isArray(raw) || raw.length === 0)
            return [];
        const streamBlock = raw[0];
        if (!Array.isArray(streamBlock) || streamBlock.length < 2)
            return [];
        const entries = streamBlock[1];
        if (!Array.isArray(entries))
            return [];
        const records = [];
        for (const entryRaw of entries) {
            if (!Array.isArray(entryRaw) || entryRaw.length < 2)
                continue;
            const idRaw = entryRaw[0];
            const fieldsRaw = entryRaw[1];
            if (typeof idRaw !== "string" && !Buffer.isBuffer(idRaw))
                continue;
            const id = toStringValue(idRaw);
            if (!Array.isArray(fieldsRaw))
                continue;
            for (let i = 0; i + 1 < fieldsRaw.length; i += 2) {
                const key = toStringValue(fieldsRaw[i]);
                const value = toStringValue(fieldsRaw[i + 1]);
                if (key !== "event")
                    continue;
                records.push({ id, event: parseEventPayload(value) });
            }
        }
        return records;
    };
    const publish = async (event) => {
        const now = new Date().toISOString();
        const payload = {
            ...event,
            id: event.id ?? `${streamName}-${Date.now().toString(36)}`,
            createdAt: now,
        };
        const message = JSON.stringify(payload);
        return (0, retry_1.withRetry)("event_bus_publish", async () => {
            const id = await withCommandTimeout("publish", () => redis.client.sendCommand(["XADD", streamName, "*", "event", message]));
            if (!id || typeof id !== "string") {
                throw new Error("Redis stream publish did not return an id.");
            }
            return id;
        }, logger);
    };
    const healthcheck = async () => {
        const startedAt = Date.now();
        try {
            await (0, retry_1.withRetry)("event_bus_health", async () => {
                await redis.healthcheck();
            }, logger, { attempts: 2 });
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
    const subscribe = async (handler) => {
        if (worker)
            return { stop: async () => { } };
        const loop = async () => {
            let lastId = startId;
            while (active) {
                const response = await withCommandTimeout("read", () => redis.client.sendCommand([
                    "XREAD",
                    "COUNT",
                    String(maxBatchSize),
                    "BLOCK",
                    String(pollIntervalMs),
                    "STREAMS",
                    streamName,
                    lastId,
                ]));
                const records = parseStreamRecords(response);
                for (const record of records) {
                    if (!active)
                        break;
                    if (record.id <= lastId) {
                        lastId = record.id;
                        continue;
                    }
                    try {
                        await handler(record.event);
                    }
                    catch (error) {
                        logger.error("event_bus_handler_error", {
                            stream: streamName,
                            eventId: record.id,
                            message: error instanceof Error ? error.message : String(error),
                        });
                    }
                    lastId = record.id;
                }
            }
        };
        worker = loop().catch((error) => {
            logger.error("event_bus_subscribe_loop_error", {
                stream: streamName,
                message: error instanceof Error ? error.message : String(error),
            });
        });
        return {
            stop: async () => {
                active = false;
                await worker;
                worker = null;
            },
        };
    };
    const close = async () => {
        active = false;
        if (worker) {
            try {
                await worker;
            }
            catch {
                // ignore
            }
            worker = null;
        }
        await redis.close();
    };
    return { publish, subscribe, healthcheck, close };
}
