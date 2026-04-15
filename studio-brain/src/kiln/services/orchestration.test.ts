import test from "node:test";
import assert from "node:assert/strict";
import { MemoryKilnStore } from "../memoryStore";
import { defaultCapabilitySet, type Kiln } from "../domain/model";
import { recordOperatorAction } from "./manualEvents";
import { acknowledgeFiringRunAction, applyObservedRunState, createFiringRun, hasStartPrerequisites } from "./orchestration";

function buildKiln(): Kiln {
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
  };
}

test("start acknowledgement is blocked until required checklist actions exist", async () => {
  const store = new MemoryKilnStore();
  await store.upsertKiln(buildKiln());
  const run = await createFiringRun(store, {
    kilnId: "kiln_test",
    requestedBy: "staff-1",
    programName: "Cone 6 Glaze",
    queueState: "ready_for_start",
  });

  assert.equal(hasStartPrerequisites([], {}), false);
  await assert.rejects(
    () =>
      recordOperatorAction(store, {
        kilnId: run.kilnId,
        firingRunId: run.id,
        actionType: "pressed_start",
        requestedBy: "staff-1",
        enableSupportedWrites: false,
      }),
    /Cannot acknowledge start before loaded_kiln and verified_clearance/,
  );
});

test("operator acknowledgements move runs into firing and observed state transitions move them to unload", async () => {
  const store = new MemoryKilnStore();
  await store.upsertKiln(buildKiln());
  const run = await createFiringRun(store, {
    kilnId: "kiln_test",
    requestedBy: "staff-1",
    programName: "Cone 6 Glaze",
    queueState: "ready_for_start",
  });

  await recordOperatorAction(store, {
    kilnId: run.kilnId,
    firingRunId: run.id,
    actionType: "loaded_kiln",
    requestedBy: "staff-1",
    enableSupportedWrites: false,
  });
  await recordOperatorAction(store, {
    kilnId: run.kilnId,
    firingRunId: run.id,
    actionType: "verified_clearance",
    requestedBy: "staff-1",
    enableSupportedWrites: false,
  });
  const started = await recordOperatorAction(store, {
    kilnId: run.kilnId,
    firingRunId: run.id,
    actionType: "pressed_start",
    requestedBy: "staff-1",
    confirmedBy: "staff-1",
    enableSupportedWrites: false,
  });

  const activeRun = await store.getFiringRun(run.id);
  assert.equal(started.action.actionType, "pressed_start");
  assert.equal(activeRun?.status, "firing");
  assert.equal(activeRun?.queueState, "firing");
  assert.equal(activeRun?.controlPosture, "Human-triggered");

  const cooling = applyObservedRunState(activeRun!, {
    observedStatus: "cooling",
    currentSegment: 7,
    totalSegments: 8,
  });
  const complete = applyObservedRunState(cooling, {
    observedStatus: "complete",
    endTime: "2026-04-14T20:00:00.000Z",
  });

  assert.equal(cooling.status, "cooling");
  assert.equal(complete.queueState, "ready_for_unload");
  assert.equal(complete.endTime, "2026-04-14T20:00:00.000Z");
});

test("observed and operator error paths move runs into exception state", async () => {
  const store = new MemoryKilnStore();
  await store.upsertKiln(buildKiln());
  const run = await createFiringRun(store, {
    kilnId: "kiln_test",
    requestedBy: "staff-1",
    programName: "Diagnostics",
  });

  const observed = applyObservedRunState(run, { observedStatus: "aborted" });
  assert.equal(observed.queueState, "exception");

  await store.saveFiringRun(run);
  const updated = await acknowledgeFiringRunAction(store, {
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
  assert.equal(updated.status, "error");
  assert.equal(updated.queueState, "exception");
});
