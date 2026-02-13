"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoborockConnector = void 0;
const hash_1 = require("../stores/hash");
const types_1 = require("./types");
function classifyRoborockError(error) {
    if (error instanceof types_1.ConnectorError)
        return error;
    const message = error instanceof Error ? error.message : String(error);
    if (/timeout/i.test(message))
        return new types_1.ConnectorError("TIMEOUT", message, true);
    if (/401|403|unauthor/i.test(message))
        return new types_1.ConnectorError("AUTH", message, false);
    if (/5\d\d|unavailable|econnrefused/i.test(message))
        return new types_1.ConnectorError("UNAVAILABLE", message, true);
    if (/malformed|invalid|parse/i.test(message))
        return new types_1.ConnectorError("BAD_RESPONSE", message, false);
    return new types_1.ConnectorError("UNKNOWN", message, false);
}
class RoborockConnector {
    transport;
    staleAfterMs;
    id = "roborock";
    target = "roborock";
    version = "0.1.0";
    readOnly = true;
    constructor(transport, staleAfterMs = 30 * 60 * 1000) {
        this.transport = transport;
        this.staleAfterMs = staleAfterMs;
    }
    async health(ctx) {
        const inputHash = (0, hash_1.stableHashDeep)({ requestId: ctx.requestId, path: "/health" });
        try {
            const payload = await this.transport("/health", { requestId: ctx.requestId }, ctx.timeoutMs ?? 10_000);
            return {
                ok: true,
                latencyMs: 1,
                availability: "healthy",
                requestId: ctx.requestId,
                inputHash,
                outputHash: (0, hash_1.stableHashDeep)(payload),
            };
        }
        catch (error) {
            throw classifyRoborockError(error);
        }
    }
    async readStatus(ctx, input) {
        const nowMs = Date.now();
        const request = { ...input, requestId: ctx.requestId };
        try {
            const payload = await this.transport("/devices", request, ctx.timeoutMs ?? 10_000);
            const root = payload && typeof payload === "object" ? payload : {};
            if (root.devices !== undefined && !Array.isArray(root.devices)) {
                throw new types_1.ConnectorError("BAD_RESPONSE", "Malformed Roborock payload: devices must be an array.", false);
            }
            const rows = Array.isArray(root.devices) ? root.devices : [];
            const devices = rows.map((row, index) => {
                const item = row && typeof row === "object" ? row : {};
                const lastSeenAt = typeof item.lastSeenAt === "string" ? item.lastSeenAt : null;
                const lastSeenMs = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
                const stale = Number.isFinite(lastSeenMs) ? nowMs - lastSeenMs > this.staleAfterMs : false;
                const onlineValue = item.online === true && !stale;
                return {
                    id: typeof item.id === "string" ? item.id : `roborock-${index + 1}`,
                    label: typeof item.name === "string" ? item.name : `Roborock ${index + 1}`,
                    online: onlineValue,
                    batteryPct: typeof item.battery === "number" ? Math.max(0, Math.min(100, Math.round(item.battery))) : null,
                    attributes: {
                        ...item,
                        stale,
                    },
                };
            });
            return {
                requestId: ctx.requestId,
                inputHash: (0, hash_1.stableHashDeep)(request),
                outputHash: (0, hash_1.stableHashDeep)(devices),
                devices,
                rawCount: rows.length,
            };
        }
        catch (error) {
            throw classifyRoborockError(error);
        }
    }
    async execute(ctx, request) {
        if (request.intent === "write") {
            throw new types_1.ConnectorError("READ_ONLY_VIOLATION", "Roborock connector is read-only.", false, {
                action: request.action,
            });
        }
        return this.readStatus(ctx, request.input);
    }
}
exports.RoborockConnector = RoborockConnector;
