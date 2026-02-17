"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runReadOnlyConnectorContract = runReadOnlyConnectorContract;
const strict_1 = __importDefault(require("node:assert/strict"));
async function runReadOnlyConnectorContract(connector) {
    const health = await connector.health({ requestId: "contract-health" });
    strict_1.default.equal(typeof health.ok, "boolean");
    strict_1.default.equal(health.requestId, "contract-health");
    strict_1.default.ok(typeof health.inputHash === "string" && health.inputHash.length > 10);
    const read = await connector.readStatus({ requestId: "contract-read" }, {
        locationId: "studio-main",
    });
    strict_1.default.equal(read.requestId, "contract-read");
    strict_1.default.ok(Array.isArray(read.devices));
    strict_1.default.ok(typeof read.outputHash === "string" && read.outputHash.length > 10);
    const executeRead = await connector.execute({ requestId: "contract-execute-read" }, {
        intent: "read",
        action: "devices.list",
        input: { locationId: "studio-main" },
    });
    strict_1.default.equal(executeRead.requestId, "contract-execute-read");
    await strict_1.default.rejects(() => connector.execute({ requestId: "contract-execute-write" }, {
        intent: "write",
        action: "device.turnOn",
        input: { id: "device-1" },
    }), (error) => {
        const row = error;
        return row.code === "READ_ONLY_VIOLATION";
    });
}
