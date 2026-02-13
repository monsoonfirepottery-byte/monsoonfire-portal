"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const roborockConnector_1 = require("./roborockConnector");
const contractHarness_1 = require("./testing/contractHarness");
(0, node_test_1.default)("Roborock connector satisfies read-only contract harness", async () => {
    const connector = new roborockConnector_1.RoborockConnector(async (path) => {
        if (path === "/health")
            return { ok: true };
        return {
            devices: [{ id: "rr-1", name: "Studio Vacuum", online: true, battery: 61 }],
        };
    });
    await (0, contractHarness_1.runReadOnlyConnectorContract)(connector);
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
