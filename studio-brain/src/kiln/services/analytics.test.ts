import test from "node:test";
import assert from "node:assert/strict";
import type { FiringRun, TelemetryPoint } from "../domain/model";
import {
  buildAnalyticsConfidenceNotes,
  buildKilnHealthSnapshot,
  computeUnderperformanceVsMedian,
  computeZoneImbalanceScore,
} from "./analytics";

function buildRun(overrides: Partial<FiringRun> = {}): FiringRun {
  return {
    id: "run_test",
    kilnId: "kiln_test",
    runSource: "imported_log",
    status: "complete",
    queueState: "ready_for_unload",
    controlPosture: "Observed only",
    programName: "Cone 6 Glaze",
    programType: "glaze",
    coneTarget: "6",
    speed: "medium",
    startTime: "2026-04-14T10:00:00.000Z",
    endTime: "2026-04-14T20:00:00.000Z",
    durationSec: 36_000,
    currentSegment: 8,
    totalSegments: 8,
    maxTemp: 2235,
    finalSetPoint: 2232,
    operatorId: null,
    operatorConfirmationAt: null,
    firmwareVersion: "2.1.4",
    rawArtifactRefs: [],
    linkedPortalRefs: { batchIds: [], pieceIds: [], reservationIds: [], portalFiringId: null },
    ...overrides,
  };
}

function buildTelemetry(): TelemetryPoint[] {
  return [
    {
      kilnId: "kiln_test",
      firingRunId: "run_test",
      ts: "2026-04-14T10:00:00.000Z",
      tempPrimary: 400,
      tempZone1: 390,
      tempZone2: 402,
      tempZone3: 421,
      setPoint: 450,
      segment: 1,
      percentPower1: 100,
      percentPower2: 100,
      percentPower3: 100,
      boardTemp: 42,
      rawPayload: {},
    },
    {
      kilnId: "kiln_test",
      firingRunId: "run_test",
      ts: "2026-04-14T14:00:00.000Z",
      tempPrimary: 1820,
      tempZone1: 1778,
      tempZone2: 1825,
      tempZone3: 1862,
      setPoint: 1840,
      segment: 5,
      percentPower1: 74,
      percentPower2: 77,
      percentPower3: 80,
      boardTemp: 58,
      rawPayload: {},
    },
    {
      kilnId: "kiln_test",
      firingRunId: "run_test",
      ts: "2026-04-14T20:00:00.000Z",
      tempPrimary: 980,
      tempZone1: 938,
      tempZone2: 985,
      tempZone3: 1034,
      setPoint: 980,
      segment: 8,
      percentPower1: 0,
      percentPower2: 0,
      percentPower3: 0,
      boardTemp: 71,
      rawPayload: {},
    },
  ];
}

test("analytics compute zone imbalance and underperformance against historical median", () => {
  const telemetry = buildTelemetry();
  const imbalance = computeZoneImbalanceScore(telemetry);
  assert.ok((imbalance ?? 0) > 0.02);

  const underperformance = computeUnderperformanceVsMedian(buildRun(), [
    buildRun({ id: "run_hist_1", durationSec: 30_000 }),
    buildRun({ id: "run_hist_2", durationSec: 31_200 }),
    buildRun({ id: "run_hist_3", durationSec: 32_400 }),
  ]);
  assert.ok((underperformance ?? 0) > 0.1);
});

test("health snapshots surface repeated abnormal termination patterns with confidence notes", () => {
  const snapshot = buildKilnHealthSnapshot({
    kilnId: "kiln_test",
    telemetry: buildTelemetry(),
    run: buildRun(),
    historicalRuns: [
      buildRun({ id: "run_hist_1", durationSec: 30_000 }),
      buildRun({ id: "run_hist_2", status: "error", durationSec: 29_000 }),
      buildRun({ id: "run_hist_3", status: "aborted", durationSec: 28_000 }),
    ],
    diagnosticsCount: 1,
    lastDiagnosticsAt: "2026-04-14T12:00:00.000Z",
  });

  assert.ok(snapshot.warnings.some((entry) => entry.includes("abnormal termination")));
  assert.equal(snapshot.boardTempStatus, "watch");
  assert.ok(snapshot.confidenceNotes.length >= 1);
});

test("confidence notes explain thin evidence instead of overclaiming", () => {
  const notes = buildAnalyticsConfidenceNotes({
    telemetry: buildTelemetry().slice(0, 2),
    historicalRuns: [buildRun({ id: "run_hist_1" })],
    diagnosticsCount: 0,
  });
  assert.ok(notes.some((entry) => entry.includes("Telemetry sample is thin")));
  assert.ok(notes.some((entry) => entry.includes("Historic baseline is limited")));
  assert.ok(notes.some((entry) => entry.includes("No explicit diagnostics markers")));
});
