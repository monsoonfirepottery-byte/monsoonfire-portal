import test from "node:test";
import assert from "node:assert/strict";
import { buildCapabilityFingerprint, deriveKilnControlPosture } from "./fingerprint";
import { defaultCapabilitySet, type Kiln } from "./model";

function buildKiln(overrides: Partial<Kiln> = {}): Kiln {
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
    capabilitiesDetected: defaultCapabilitySet(),
    riskFlags: [],
    lastSeenAt: "2026-04-14T12:00:00.000Z",
    currentRunId: null,
    ...overrides,
  };
}

test("capability fingerprint enables supported read capabilities and leaves remote write ambiguous by default", () => {
  const document = buildCapabilityFingerprint({
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

  assert.equal(document.capabilities.supportsProgramCatalog, true);
  assert.equal(document.capabilities.supportsZoneTelemetry, true);
  assert.equal(document.capabilities.supportsDiagnostics, true);
  assert.equal(document.capabilities.supportsLocalLogExport, true);
  assert.equal(document.capabilities.supportsObservedRemoteWrite, false);
  assert.ok(document.ambiguousFeatures.includes("remote_write"));
  assert.equal(
    deriveKilnControlPosture({
      capabilityDocument: document,
      operatorConfirmationAt: "2026-04-14T13:00:00.000Z",
      enableSupportedWrites: false,
    }),
    "Human-triggered",
  );
});

test("capability fingerprint only advertises supported write posture when explicitly enabled", () => {
  const document = buildCapabilityFingerprint({
    kiln: buildKiln(),
    observedFields: ["run.programname"],
    providerSupport: {
      supportsKilnAidMonitoring: true,
      supportsDiagnostics: true,
      supportedWriteActions: ["remote_start"],
    },
  });

  assert.equal(document.capabilities.supportsObservedRemoteWrite, true);
  assert.deepEqual(document.capabilities.supportedWriteActions, ["remote_start"]);
  assert.equal(
    deriveKilnControlPosture({
      capabilityDocument: document,
      operatorConfirmationAt: null,
      enableSupportedWrites: true,
    }),
    "Supported write path",
  );
});
