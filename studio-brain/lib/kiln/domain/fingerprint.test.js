"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const fingerprint_1 = require("./fingerprint");
const model_1 = require("./model");
function buildKiln(overrides = {}) {
    return {
        id: "kiln_test",
        displayName: "Studio Electric",
        manufacturer: "L&L / Bartlett",
        kilnModel: "eQ2827",
        controllerModel: "Genesis",
        controllerFamily: "bartlett_genesis",
        firmwareVersion: "2.1.4",
        serialNumber: "serial-1",
        macAddress: "AA:BB:CC:DD:EE:01",
        zoneCount: 3,
        thermocoupleType: "K",
        output4Role: "vent",
        wifiConfigured: true,
        notes: null,
        capabilitiesDetected: (0, model_1.defaultCapabilitySet)(),
        riskFlags: [],
        lastSeenAt: "2026-04-14T12:00:00.000Z",
        currentRunId: null,
        ...overrides,
    };
}
(0, node_test_1.default)("capability fingerprint enables supported read capabilities and leaves remote write ambiguous by default", () => {
    const document = (0, fingerprint_1.buildCapabilityFingerprint)({
        kiln: buildKiln(),
        observedFields: [
            "meta.startcode",
            "run.programname",
            "run.programtype",
            "run.totalsegments",
            "telemetry.tempzone1",
            "telemetry.tempzone2",
            "telemetry.percentpower1",
            "event.diagnostic",
            "event.relaystate",
            "meta.log_export",
        ],
    });
    strict_1.default.equal(document.capabilities.supportsProgramCatalog, true);
    strict_1.default.equal(document.capabilities.supportsZoneTelemetry, true);
    strict_1.default.equal(document.capabilities.supportsDiagnostics, true);
    strict_1.default.equal(document.capabilities.supportsLocalLogExport, true);
    strict_1.default.equal(document.capabilities.supportsObservedRemoteWrite, false);
    strict_1.default.ok(document.ambiguousFeatures.includes("remote_write"));
    strict_1.default.equal((0, fingerprint_1.deriveKilnControlPosture)({
        capabilityDocument: document,
        operatorConfirmationAt: "2026-04-14T13:00:00.000Z",
        enableSupportedWrites: false,
    }), "Human-triggered");
});
(0, node_test_1.default)("capability fingerprint only advertises supported write posture when explicitly enabled", () => {
    const document = (0, fingerprint_1.buildCapabilityFingerprint)({
        kiln: buildKiln(),
        observedFields: ["run.programname"],
        providerSupport: {
            supportsKilnAidMonitoring: true,
            supportsDiagnostics: true,
            supportedWriteActions: ["remote_start"],
        },
    });
    strict_1.default.equal(document.capabilities.supportsObservedRemoteWrite, true);
    strict_1.default.deepEqual(document.capabilities.supportedWriteActions, ["remote_start"]);
    strict_1.default.equal((0, fingerprint_1.deriveKilnControlPosture)({
        capabilityDocument: document,
        operatorConfirmationAt: null,
        enableSupportedWrites: true,
    }), "Supported write path");
});
