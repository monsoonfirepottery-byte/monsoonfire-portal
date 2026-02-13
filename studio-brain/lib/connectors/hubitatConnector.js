"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HubitatConnector = void 0;
exports.classifyConnectorError = classifyConnectorError;
const hash_1 = require("../stores/hash");
const circuitBreaker_1 = require("./circuitBreaker");
const types_1 = require("./types");
function normalizeDevice(raw) {
    const row = raw && typeof raw === "object" ? raw : {};
    const id = typeof row.id === "string" ? row.id : String(row.deviceId ?? "unknown-device");
    const label = typeof row.label === "string" ? row.label : String(row.name ?? id);
    const switchValue = typeof row.switch === "string" ? row.switch.toLowerCase() : "";
    const online = switchValue === "on" || row.online === true || row.presence === "present";
    const batteryRaw = row.battery;
    const batteryPct = typeof batteryRaw === "number" ? Math.max(0, Math.min(100, Math.round(batteryRaw))) : null;
    return {
        id,
        label,
        online,
        batteryPct,
        attributes: row,
    };
}
function classifyConnectorError(error) {
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
class HubitatConnector {
    transport;
    circuitBreaker;
    id = "hubitat";
    target = "hubitat";
    version = "0.1.0";
    readOnly = true;
    constructor(transport, circuitBreaker = new circuitBreaker_1.ConnectorCircuitBreaker()) {
        this.transport = transport;
        this.circuitBreaker = circuitBreaker;
    }
    async health(ctx) {
        const started = Date.now();
        const input = { path: "/health", requestId: ctx.requestId };
        const inputHash = (0, hash_1.stableHashDeep)(input);
        try {
            if (!this.circuitBreaker.canAttempt(started)) {
                return {
                    ok: false,
                    latencyMs: 0,
                    availability: "degraded",
                    requestId: ctx.requestId,
                    inputHash,
                    outputHash: null,
                };
            }
            const payload = await this.transport("/health", input, ctx.timeoutMs ?? 10_000);
            this.circuitBreaker.recordSuccess();
            return {
                ok: true,
                latencyMs: Date.now() - started,
                availability: "healthy",
                requestId: ctx.requestId,
                inputHash,
                outputHash: (0, hash_1.stableHashDeep)(payload),
            };
        }
        catch (error) {
            this.circuitBreaker.recordFailure(started);
            throw classifyConnectorError(error);
        }
    }
    async readStatus(ctx, input) {
        const started = Date.now();
        if (!this.circuitBreaker.canAttempt(started)) {
            throw new types_1.ConnectorError("UNAVAILABLE", "Connector is in backoff window.", true, {
                circuit: this.circuitBreaker.state(),
            });
        }
        const request = { ...input, requestId: ctx.requestId };
        const inputHash = (0, hash_1.stableHashDeep)(request);
        try {
            const payload = await this.transport("/devices", request, ctx.timeoutMs ?? 10_000);
            const root = payload && typeof payload === "object" ? payload : {};
            if (root.devices !== undefined && !Array.isArray(root.devices)) {
                throw new types_1.ConnectorError("BAD_RESPONSE", "Malformed Hubitat payload: devices must be an array.", false);
            }
            const rawDevices = Array.isArray(root.devices) ? root.devices : [];
            const devices = rawDevices.map((row) => normalizeDevice(row));
            this.circuitBreaker.recordSuccess();
            return {
                requestId: ctx.requestId,
                inputHash,
                outputHash: (0, hash_1.stableHashDeep)(devices),
                devices,
                rawCount: rawDevices.length,
            };
        }
        catch (error) {
            this.circuitBreaker.recordFailure(started);
            throw classifyConnectorError(error);
        }
    }
    async execute(ctx, request) {
        if (request.intent === "write") {
            throw new types_1.ConnectorError("READ_ONLY_VIOLATION", "Hubitat connector is read-only.", false, {
                action: request.action,
            });
        }
        return this.readStatus(ctx, request.input);
    }
}
exports.HubitatConnector = HubitatConnector;
