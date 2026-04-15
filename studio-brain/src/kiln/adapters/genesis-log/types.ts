import type { FiringRunStatus, KilnObservationConfidence, ParserDiagnostics } from "../../domain/model";

export type GenesisDetectedSchema =
  | "synthetic-genesis-v1"
  | "synthetic-genesis-variant"
  | "generic-kv"
  | "unknown";

export type GenesisParsedEvent = {
  ts: string;
  eventType: string;
  severity: "info" | "warning" | "critical";
  payload: Record<string, unknown>;
  confidence: KilnObservationConfidence;
};

export type GenesisParsedTelemetry = {
  ts: string;
  tempPrimary: number | null;
  tempZone1: number | null;
  tempZone2: number | null;
  tempZone3: number | null;
  setPoint: number | null;
  segment: number | null;
  percentPower1: number | null;
  percentPower2: number | null;
  percentPower3: number | null;
  boardTemp: number | null;
  rawPayload: Record<string, unknown>;
};

export type GenesisParseResult = {
  detectedSchema: GenesisDetectedSchema;
  parserDiagnostics: ParserDiagnostics;
  observedFields: string[];
  kilnHints: {
    displayName?: string;
    manufacturer?: string;
    kilnModel?: string;
    controllerModel?: string;
    firmwareVersion?: string;
    serialNumber?: string;
    macAddress?: string;
    zoneCount?: number;
    thermocoupleType?: string;
    output4Role?: string;
    wifiConfigured?: boolean;
    riskFlags?: string[];
  };
  runHints: {
    programName?: string;
    programType?: string;
    coneTarget?: string;
    speed?: string;
    startTime?: string;
    endTime?: string;
    status?: FiringRunStatus;
    currentSegment?: number;
    totalSegments?: number;
    finalSetPoint?: number;
    maxTemp?: number;
  };
  events: GenesisParsedEvent[];
  telemetry: GenesisParsedTelemetry[];
  summary: string;
};
