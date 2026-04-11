"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const roborockConnector_1 = require("./roborockConnector");
(0, node_test_1.default)("Roborock connector read execution path returns devices", async () => {
    const connector = new roborockConnector_1.RoborockConnector(async (path) => {
        if (path === "/health")
            return { ok: true };
        return {
            devices: [{ id: "rr-1", name: "Studio Vacuum", online: true, battery: 61 }],
        };
    });
    const result = await connector.execute({ requestId: "rr-read" }, { intent: "read", action: "devices.read", input: {} });
    strict_1.default.equal(result.devices.length, 1);
});
(0, node_test_1.default)("Roborock connector marks stale devices offline", async () => {
    const connector = new roborockConnector_1.RoborockConnector(async () => ({
        devices: [{ id: "rr-1", name: "Studio Vacuum", online: true, battery: 61, lastSeenAt: "2026-02-12T00:00:00.000Z" }],
    }), 60_000);
    const result = await connector.readStatus({ requestId: "rr-stale" }, {});
    strict_1.default.equal(result.devices[0].online, false);
    const stale = result.devices[0].attributes.stale;
    strict_1.default.equal(stale, true);
});
(0, node_test_1.default)("Roborock connector emits alerts for stopped job + filter life", async () => {
    const connector = new roborockConnector_1.RoborockConnector(async () => ({
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
    const alerts = result.devices[0].attributes.alerts ?? [];
    const codes = alerts.map((row) => row.code);
    strict_1.default.ok(codes.includes("job_stopped"));
    strict_1.default.ok(codes.includes("filter_maintenance_due"));
});
(0, node_test_1.default)("Roborock connector classifies auth failures", async () => {
    const connector = new roborockConnector_1.RoborockConnector(async () => {
        throw new Error("403 unauthorized");
    });
    await strict_1.default.rejects(() => connector.readStatus({ requestId: "rr-auth" }, {}), (error) => error.code === "AUTH");
});
(0, node_test_1.default)("Roborock connector rejects malformed payload", async () => {
    const connector = new roborockConnector_1.RoborockConnector(async () => ({ devices: "bad-shape" }));
    await strict_1.default.rejects(() => connector.readStatus({ requestId: "rr-malformed" }, {}), (error) => error.code === "BAD_RESPONSE");
});
(0, node_test_1.default)("Roborock connector executes full clean command then refreshes state", async () => {
    const calls = [];
    const connector = new roborockConnector_1.RoborockConnector(async (path) => {
        calls.push(path);
        if (path === "/commands/start_full")
            return { ok: true };
        if (path === "/devices")
            return { devices: [{ id: "rr-1", name: "Studio Vacuum", online: true, battery: 91 }] };
        return { ok: true };
    });
    const result = await connector.execute({ requestId: "rr-start-full" }, { intent: "write", action: "clean.start_full", input: {} });
    strict_1.default.equal(result.devices.length, 1);
    strict_1.default.deepEqual(calls, ["/commands/start_full", "/devices"]);
});
(0, node_test_1.default)("Roborock connector requires roomIds for room clean command", async () => {
    const connector = new roborockConnector_1.RoborockConnector(async () => ({ ok: true }));
    await strict_1.default.rejects(() => connector.execute({ requestId: "rr-start-rooms" }, { intent: "write", action: "clean.start_rooms", input: {} }), (error) => error.code === "BAD_RESPONSE");
});
