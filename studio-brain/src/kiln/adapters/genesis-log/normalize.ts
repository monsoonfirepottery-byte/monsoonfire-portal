import { stableHashDeep } from "../../../stores/hash";
import type { CapabilityEvidence, FiringEvent, TelemetryPoint } from "../../domain/model";
import type { GenesisParseResult } from "./types";

export type NormalizedGenesisImport = {
  events: FiringEvent[];
  telemetry: TelemetryPoint[];
  evidence: CapabilityEvidence[];
  lastDiagnosticsAt: string | null;
};

export function normalizeGenesisImport(input: {
  kilnId: string;
  firingRunId: string;
  parseResult: GenesisParseResult;
}): NormalizedGenesisImport {
  const events: FiringEvent[] = input.parseResult.events.map((event) => ({
    id: `fevt_${stableHashDeep({ firingRunId: input.firingRunId, ts: event.ts, eventType: event.eventType }).slice(0, 16)}`,
    kilnId: input.kilnId,
    firingRunId: input.firingRunId,
    ts: event.ts,
    eventType: event.eventType,
    severity: event.severity,
    payloadJson: event.payload,
    source: "controller_log",
    confidence: event.confidence,
  }));
  const telemetry: TelemetryPoint[] = input.parseResult.telemetry.map((point) => ({
    firingRunId: input.firingRunId,
    kilnId: input.kilnId,
    ts: point.ts,
    tempPrimary: point.tempPrimary,
    tempZone1: point.tempZone1,
    tempZone2: point.tempZone2,
    tempZone3: point.tempZone3,
    setPoint: point.setPoint,
    segment: point.segment,
    percentPower1: point.percentPower1,
    percentPower2: point.percentPower2,
    percentPower3: point.percentPower3,
    boardTemp: point.boardTemp,
    rawPayload: point.rawPayload,
  }));
  const evidence: CapabilityEvidence[] = [
    {
      source: "genesis_log",
      detail: `Detected ${input.parseResult.detectedSchema} with ${input.parseResult.observedFields.length} observed fields.`,
      confidence: "observed",
    },
  ];
  const lastDiagnosticsAt = events.find((entry) => entry.eventType.toLowerCase().includes("diagnostic"))?.ts ?? null;
  return {
    events,
    telemetry,
    evidence,
    lastDiagnosticsAt,
  };
}
