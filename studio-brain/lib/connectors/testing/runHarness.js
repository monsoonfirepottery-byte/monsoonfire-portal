"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const hubitatConnector_1 = require("../hubitatConnector");
const roborockConnector_1 = require("../roborockConnector");
const contractHarness_1 = require("./contractHarness");
async function runConnectorCase(connectorId) {
    try {
        if (connectorId === "hubitat") {
            const connector = new hubitatConnector_1.HubitatConnector(async (route) => {
                if (route === "/health")
                    return { ok: true };
                return { devices: [{ id: "hub-1", label: "Kiln Vent", switch: "on", battery: 88 }] };
            });
            await (0, contractHarness_1.runReadOnlyConnectorContract)(connector);
            await assertNegativeCases(connectorId, connector.readStatus.bind(connector));
        }
        else if (connectorId === "roborock") {
            const connector = new roborockConnector_1.RoborockConnector(async (route) => {
                if (route === "/health")
                    return { ok: true };
                return { devices: [{ id: "rr-1", name: "Studio Vacuum", online: true, battery: 61 }] };
            });
            await (0, contractHarness_1.runReadOnlyConnectorContract)(connector);
            await assertNegativeCases(connectorId, connector.readStatus.bind(connector));
        }
        else {
            return { connectorId, passed: false, checks: [], error: "Unknown connector id." };
        }
        return {
            connectorId,
            passed: true,
            checks: ["contract_read_only", "negative_auth", "negative_timeout", "negative_malformed"],
        };
    }
    catch (error) {
        return {
            connectorId,
            passed: false,
            checks: ["contract_read_only", "negative_auth", "negative_timeout", "negative_malformed"],
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
async function assertNegativeCases(connectorId, readStatus) {
    const authFactory = connectorId === "hubitat" ? new hubitatConnector_1.HubitatConnector(async () => { throw new Error("401 unauthorized"); }) : new roborockConnector_1.RoborockConnector(async () => { throw new Error("403 unauthorized"); });
    await authFactory
        .readStatus({ requestId: `${connectorId}-auth` }, {})
        .then(() => {
        throw new Error(`${connectorId}: expected auth failure`);
    })
        .catch((error) => {
        const code = error.code;
        if (code !== "AUTH") {
            throw new Error(`${connectorId}: expected AUTH error, received ${String(code ?? "unknown")}`);
        }
    });
    const timeoutFactory = connectorId === "hubitat" ? new hubitatConnector_1.HubitatConnector(async () => { throw new Error("request timeout"); }) : new roborockConnector_1.RoborockConnector(async () => { throw new Error("request timeout"); });
    await timeoutFactory
        .readStatus({ requestId: `${connectorId}-timeout` }, {})
        .then(() => {
        throw new Error(`${connectorId}: expected timeout failure`);
    })
        .catch((error) => {
        const code = error.code;
        if (code !== "TIMEOUT") {
            throw new Error(`${connectorId}: expected TIMEOUT error, received ${String(code ?? "unknown")}`);
        }
    });
    const malformedFactory = connectorId === "hubitat" ? new hubitatConnector_1.HubitatConnector(async () => ({ devices: "bad-shape" })) : new roborockConnector_1.RoborockConnector(async () => ({ devices: "bad-shape" }));
    await malformedFactory
        .readStatus({ requestId: `${connectorId}-malformed` }, {})
        .then(() => {
        throw new Error(`${connectorId}: expected malformed payload failure`);
    })
        .catch((error) => {
        const code = error.code;
        if (code !== "BAD_RESPONSE") {
            throw new Error(`${connectorId}: expected BAD_RESPONSE error, received ${String(code ?? "unknown")}`);
        }
    });
    await readStatus({ requestId: `${connectorId}-noop` }, { locationId: "studio-main" });
}
async function main() {
    const rows = await Promise.all([runConnectorCase("hubitat"), runConnectorCase("roborock")]);
    const summary = {
        generatedAt: new Date().toISOString(),
        allPassed: rows.every((row) => row.passed),
        rows,
    };
    const reportsDir = node_path_1.default.join(process.cwd(), "reports");
    await promises_1.default.mkdir(reportsDir, { recursive: true });
    const outputPath = node_path_1.default.join(reportsDir, "connector-contract-summary.json");
    await promises_1.default.writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    if (!summary.allPassed) {
        process.stderr.write(`Connector contract harness failed. See ${outputPath}\n`);
        process.exitCode = 1;
        return;
    }
    process.stdout.write(`Connector contract harness passed. Summary: ${outputPath}\n`);
}
void main().catch((error) => {
    process.stderr.write(`Connector contract harness failed: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
});
