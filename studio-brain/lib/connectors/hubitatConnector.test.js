"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const circuitBreaker_1 = require("./circuitBreaker");
const hubitatConnector_1 = require("./hubitatConnector");
const contractHarness_1 = require("./testing/contractHarness");
(0, node_test_1.default)("Hubitat connector normalizes payload", async () => {
    const connector = new hubitatConnector_1.HubitatConnector(async () => ({
        devices: [
            { id: "hub-1", label: "Kiln Vent", switch: "on", battery: 98 },
            { deviceId: "hub-2", name: "Studio Fan", online: false, battery: "n/a" },
        ],
    }));
    const result = await connector.readStatus({ requestId: "req-1" }, { locationId: "main" });
    strict_1.default.equal(result.devices.length, 2);
    strict_1.default.equal(result.devices[0].online, true);
    strict_1.default.equal(result.devices[1].id, "hub-2");
    strict_1.default.equal(result.devices[1].batteryPct, null);
});
(0, node_test_1.default)("Hubitat connector classifies timeout errors", () => {
    const err = (0, hubitatConnector_1.classifyConnectorError)(new Error("request timeout after 10s"));
    strict_1.default.equal(err.code, "TIMEOUT");
    strict_1.default.equal(err.retryable, true);
});
(0, node_test_1.default)("Circuit breaker enters backoff after threshold failures", () => {
    const breaker = new circuitBreaker_1.ConnectorCircuitBreaker(2, 1000, 1000);
    strict_1.default.equal(breaker.canAttempt(0), true);
    breaker.recordFailure(0);
    strict_1.default.equal(breaker.canAttempt(1), true);
    breaker.recordFailure(1);
    strict_1.default.equal(breaker.canAttempt(500), false);
    strict_1.default.equal(breaker.canAttempt(1001), true);
});
(0, node_test_1.default)("Hubitat connector satisfies read-only contract harness", async () => {
    const connector = new hubitatConnector_1.HubitatConnector(async (path) => {
        if (path === "/health")
            return { ok: true };
        return {
            devices: [{ id: "hub-1", label: "Kiln Vent", switch: "on", battery: 76 }],
        };
    });
    await (0, contractHarness_1.runReadOnlyConnectorContract)(connector);
});
(0, node_test_1.default)("Hubitat connector classifies auth failures", async () => {
    const connector = new hubitatConnector_1.HubitatConnector(async () => {
        throw new Error("401 unauthorized");
    });
    await strict_1.default.rejects(() => connector.readStatus({ requestId: "hub-auth" }, {}), (error) => error.code === "AUTH");
});
(0, node_test_1.default)("Hubitat connector rejects malformed payload", async () => {
    const connector = new hubitatConnector_1.HubitatConnector(async () => ({ devices: "bad-shape" }));
    await strict_1.default.rejects(() => connector.readStatus({ requestId: "hub-malformed" }, {}), (error) => error.code === "BAD_RESPONSE");
});
