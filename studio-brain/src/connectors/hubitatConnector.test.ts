import assert from "node:assert/strict";
import test from "node:test";
import { ConnectorCircuitBreaker } from "./circuitBreaker";
import { classifyConnectorError, HubitatConnector } from "./hubitatConnector";
import { runReadOnlyConnectorContract } from "./testing/contractHarness";

test("Hubitat connector normalizes payload", async () => {
  const connector = new HubitatConnector(async () => ({
    devices: [
      { id: "hub-1", label: "Kiln Vent", switch: "on", battery: 98 },
      { deviceId: "hub-2", name: "Studio Fan", online: false, battery: "n/a" },
    ],
  }));

  const result = await connector.readStatus({ requestId: "req-1" }, { locationId: "main" });
  assert.equal(result.devices.length, 2);
  assert.equal(result.devices[0].online, true);
  assert.equal(result.devices[1].id, "hub-2");
  assert.equal(result.devices[1].batteryPct, null);
});

test("Hubitat connector classifies timeout errors", () => {
  const err = classifyConnectorError(new Error("request timeout after 10s"));
  assert.equal(err.code, "TIMEOUT");
  assert.equal(err.retryable, true);
});

test("Circuit breaker enters backoff after threshold failures", () => {
  const breaker = new ConnectorCircuitBreaker(2, 1000, 1000);
  assert.equal(breaker.canAttempt(0), true);
  breaker.recordFailure(0);
  assert.equal(breaker.canAttempt(1), true);
  breaker.recordFailure(1);
  assert.equal(breaker.canAttempt(500), false);
  assert.equal(breaker.canAttempt(1001), true);
});

test("Hubitat connector satisfies read-only contract harness", async () => {
  const connector = new HubitatConnector(async (path) => {
    if (path === "/health") return { ok: true };
    return {
      devices: [{ id: "hub-1", label: "Kiln Vent", switch: "on", battery: 76 }],
    };
  });
  await runReadOnlyConnectorContract(connector);
});

test("Hubitat connector classifies auth failures", async () => {
  const connector = new HubitatConnector(async () => {
    throw new Error("401 unauthorized");
  });
  await assert.rejects(
    () => connector.readStatus({ requestId: "hub-auth" }, {}),
    (error: unknown) => (error as { code?: string }).code === "AUTH"
  );
});

test("Hubitat connector rejects malformed payload", async () => {
  const connector = new HubitatConnector(async () => ({ devices: "bad-shape" }));
  await assert.rejects(
    () => connector.readStatus({ requestId: "hub-malformed" }, {}),
    (error: unknown) => (error as { code?: string }).code === "BAD_RESPONSE"
  );
});
