import test from "node:test";
import assert from "node:assert/strict";
import { RoborockConnector } from "./roborockConnector";

test("Roborock connector read execution path returns devices", async () => {
  const connector = new RoborockConnector(async (path) => {
    if (path === "/health") return { ok: true };
    return {
      devices: [{ id: "rr-1", name: "Studio Vacuum", online: true, battery: 61 }],
    };
  });

  const result = await connector.execute(
    { requestId: "rr-read" },
    { intent: "read", action: "devices.read", input: {} }
  );

  assert.equal(result.devices.length, 1);
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

test("Roborock connector emits alerts for stopped job + filter life", async () => {
  const connector = new RoborockConnector(async () => ({
    devices: [
      {
        id: "rr-1",
        name: "Studio Vacuum",
        online: true,
        battery: 61,
        state: "paused",
        filterLifePct: 10,
      },
    ],
  }));

  const result = await connector.readStatus({ requestId: "rr-alerts" }, {});
  const alerts = (result.devices[0].attributes as { alerts?: Array<{ code?: string }> }).alerts ?? [];
  const codes = alerts.map((row) => row.code);
  assert.ok(codes.includes("job_stopped"));
  assert.ok(codes.includes("filter_maintenance_due"));
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

test("Roborock connector executes full clean command then refreshes state", async () => {
  const calls: string[] = [];
  const connector = new RoborockConnector(async (path) => {
    calls.push(path);
    if (path === "/commands/start_full") return { ok: true };
    if (path === "/devices") return { devices: [{ id: "rr-1", name: "Studio Vacuum", online: true, battery: 91 }] };
    return { ok: true };
  });

  const result = await connector.execute(
    { requestId: "rr-start-full" },
    { intent: "write", action: "clean.start_full", input: {} }
  );

  assert.equal(result.devices.length, 1);
  assert.deepEqual(calls, ["/commands/start_full", "/devices"]);
});

test("Roborock connector requires roomIds for room clean command", async () => {
  const connector = new RoborockConnector(async () => ({ ok: true }));
  await assert.rejects(
    () =>
      connector.execute(
        { requestId: "rr-start-rooms" },
        { intent: "write", action: "clean.start_rooms", input: {} }
      ),
    (error: unknown) => (error as { code?: string }).code === "BAD_RESPONSE"
  );
});
