"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const memoryStore_1 = require("../memoryStore");
const model_1 = require("../domain/model");
const manualEvents_1 = require("./manualEvents");
const orchestration_1 = require("./orchestration");
function buildKiln() {
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
    };
}
(0, node_test_1.default)("start acknowledgement is blocked until required checklist actions exist", async () => {
    const store = new memoryStore_1.MemoryKilnStore();
    await store.upsertKiln(buildKiln());
    const run = await (0, orchestration_1.createFiringRun)(store, {
        kilnId: "kiln_test",
        requestedBy: "staff-1",
        programName: "Cone 6 Glaze",
        queueState: "ready_for_start",
    });
    strict_1.default.equal((0, orchestration_1.hasStartPrerequisites)([], {}), false);
    await strict_1.default.rejects(() => (0, manualEvents_1.recordOperatorAction)(store, {
        kilnId: run.kilnId,
        firingRunId: run.id,
        actionType: "pressed_start",
        requestedBy: "staff-1",
        enableSupportedWrites: false,
    }), /Cannot acknowledge start before loaded_kiln and verified_clearance/);
});
(0, node_test_1.default)("operator acknowledgements move runs into firing and observed state transitions move them to unload", async () => {
    const store = new memoryStore_1.MemoryKilnStore();
    await store.upsertKiln(buildKiln());
    const run = await (0, orchestration_1.createFiringRun)(store, {
        kilnId: "kiln_test",
        requestedBy: "staff-1",
        programName: "Cone 6 Glaze",
        queueState: "ready_for_start",
    });
    await (0, manualEvents_1.recordOperatorAction)(store, {
        kilnId: run.kilnId,
        firingRunId: run.id,
        actionType: "loaded_kiln",
        requestedBy: "staff-1",
        enableSupportedWrites: false,
    });
    await (0, manualEvents_1.recordOperatorAction)(store, {
        kilnId: run.kilnId,
        firingRunId: run.id,
        actionType: "verified_clearance",
        requestedBy: "staff-1",
        enableSupportedWrites: false,
    });
    const started = await (0, manualEvents_1.recordOperatorAction)(store, {
        kilnId: run.kilnId,
        firingRunId: run.id,
        actionType: "pressed_start",
        requestedBy: "staff-1",
        confirmedBy: "staff-1",
        enableSupportedWrites: false,
    });
    const activeRun = await store.getFiringRun(run.id);
    strict_1.default.equal(started.action.actionType, "pressed_start");
    strict_1.default.equal(activeRun?.status, "firing");
    strict_1.default.equal(activeRun?.queueState, "firing");
    strict_1.default.equal(activeRun?.controlPosture, "Human-triggered");
    const cooling = (0, orchestration_1.applyObservedRunState)(activeRun, {
        observedStatus: "cooling",
        currentSegment: 7,
        totalSegments: 8,
    });
    const complete = (0, orchestration_1.applyObservedRunState)(cooling, {
        observedStatus: "complete",
        endTime: "2026-04-14T20:00:00.000Z",
    });
    strict_1.default.equal(cooling.status, "cooling");
    strict_1.default.equal(complete.queueState, "ready_for_unload");
    strict_1.default.equal(complete.endTime, "2026-04-14T20:00:00.000Z");
});
(0, node_test_1.default)("observed and operator error paths move runs into exception state", async () => {
    const store = new memoryStore_1.MemoryKilnStore();
    await store.upsertKiln(buildKiln());
    const run = await (0, orchestration_1.createFiringRun)(store, {
        kilnId: "kiln_test",
        requestedBy: "staff-1",
        programName: "Diagnostics",
    });
    const observed = (0, orchestration_1.applyObservedRunState)(run, { observedStatus: "aborted" });
    strict_1.default.equal(observed.queueState, "exception");
    await store.saveFiringRun(run);
    const updated = await (0, orchestration_1.acknowledgeFiringRunAction)(store, {
        runId: run.id,
        action: {
            id: "op_test",
            kilnId: run.kilnId,
            firingRunId: run.id,
            actionType: "observed_error_code",
            requestedBy: "staff-1",
            confirmedBy: "staff-1",
            requestedAt: "2026-04-14T12:00:00.000Z",
            completedAt: "2026-04-14T12:00:00.000Z",
            checklistJson: {},
            notes: "TC open",
        },
        enableSupportedWrites: false,
    });
    strict_1.default.equal(updated.status, "error");
    strict_1.default.equal(updated.queueState, "exception");
});
