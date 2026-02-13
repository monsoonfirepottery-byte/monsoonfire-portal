import test from "node:test";
import assert from "node:assert/strict";
import { RoborockConnector } from "./roborockConnector";
import { runReadOnlyConnectorContract } from "./testing/contractHarness";

test("Roborock connector satisfies read-only contract harness", async () => {
  const connector = new RoborockConnector(async (path) => {
    if (path === "/health") return { ok: true };
    return {
      devices: [{ id: "rr-1", name: "Studio Vacuum", online: true, battery: 61 }],
    };
  });

  await runReadOnlyConnectorContract(connector);
});

test("Roborock connector marks stale devices offline", async () => {
  const connector = new RoborockConnector(
    async () => ({
      devices: [{ id: "rr-1", name: "Studio Vacuum", online: true, battery: 61, lastSeenAt: "2026-02-12T00:00:00.000Z" }],
    }),
    60_000
  );
  const result = await connector.readStatus({ requestId: "rr-stale" }, {});
  assert.equal(result.devices[0].online, false);
  const stale = (result.devices[0].attributes as { stale?: boolean }).stale;
  assert.equal(stale, true);
});

test("Roborock connector classifies auth failures", async () => {
  const connector = new RoborockConnector(async () => {
    throw new Error("403 unauthorized");
  });
  await assert.rejects(
    () => connector.readStatus({ requestId: "rr-auth" }, {}),
    (error: unknown) => (error as { code?: string }).code === "AUTH"
  );
});

test("Roborock connector rejects malformed payload", async () => {
  const connector = new RoborockConnector(async () => ({ devices: "bad-shape" }));
  await assert.rejects(
    () => connector.readStatus({ requestId: "rr-malformed" }, {}),
    (error: unknown) => (error as { code?: string }).code === "BAD_RESPONSE"
  );
});
