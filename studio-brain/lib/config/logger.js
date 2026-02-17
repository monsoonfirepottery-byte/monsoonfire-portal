"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLogger = createLogger;
const REDACT_KEYS = ["password", "secret", "token", "authorization", "apikey", "api_key"];
function levelWeight(level) {
    switch (level) {
        case "debug":
            return 10;
        case "info":
            return 20;
        case "warn":
            return 30;
        case "error":
            return 40;
    }
}
function shouldRedactKey(key) {
    const normalized = key.toLowerCase();
    return REDACT_KEYS.some((candidate) => normalized.includes(candidate));
}
function sanitize(value) {
    if (value === null || value === undefined)
        return value;
    if (Array.isArray(value))
        return value.map((entry) => sanitize(entry));
    if (typeof value !== "object")
        return value;
    const output = {};
    for (const [key, innerValue] of Object.entries(value)) {
        output[key] = shouldRedactKey(key) ? "[redacted]" : sanitize(innerValue);
    }
    return output;
}
function createLogger(level = "info") {
    const threshold = levelWeight(level);
    const write = (lvl, msg, meta) => {
        if (levelWeight(lvl) < threshold)
            return;
        const payload = {
            at: new Date().toISOString(),
            level: lvl,
            msg,
            ...(meta ? { meta: sanitize(meta) } : {}),
        };
        // Keep it JSONL for easy local ingestion.
        process.stdout.write(`${JSON.stringify(payload)}\n`);
    };
    return {
        debug: (msg, meta) => write("debug", msg, meta),
        info: (msg, meta) => write("info", msg, meta),
        warn: (msg, meta) => write("warn", msg, meta),
        error: (msg, meta) => write("error", msg, meta),
    };
}
