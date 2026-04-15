export const kilnControllerFamilies = ["bartlett_genesis"] as const;
export type KilnControllerFamily = (typeof kilnControllerFamilies)[number];

export const kilnObservationConfidences = ["documented", "observed", "inferred"] as const;
export type KilnObservationConfidence = (typeof kilnObservationConfidences)[number];

export const firingRunSources = ["manual_controller", "imported_log", "kilnaid", "inferred"] as const;
export type FiringRunSource = (typeof firingRunSources)[number];

export const firingRunStatuses = ["queued", "armed", "firing", "cooling", "complete", "error", "aborted"] as const;
export type FiringRunStatus = (typeof firingRunStatuses)[number];

export const firingQueueStates = [
  "intake",
  "staged",
  "ready_for_program",
  "ready_for_start",
  "firing",
  "cooling",
  "ready_for_unload",
  "complete",
  "exception",
] as const;
export type FiringQueueState = (typeof firingQueueStates)[number];

export const kilnControlPostures = ["Observed only", "Human-triggered", "Supported write path"] as const;
export type KilnControlPosture = (typeof kilnControlPostures)[number];

export const firingEventSeverities = ["info", "warning", "critical"] as const;
export type FiringEventSeverity = (typeof firingEventSeverities)[number];

export const firingEventSources = ["controller_log", "kilnaid", "operator", "inferred"] as const;
export type FiringEventSource = (typeof firingEventSources)[number];

export const operatorActionTypes = [
  "loaded_kiln",
  "verified_clearance",
  "pressed_start",
  "observed_error_code",
  "opened_kiln",
  "completed_unload",
  "relay_replaced",
  "thermocouple_replaced",
  "acknowledged_ready_for_program",
  "acknowledged_ready_for_start",
  "program_assigned",
  "manual_note",
] as const;
export type OperatorActionType = (typeof operatorActionTypes)[number];

export type KilnCapabilitySet = {
  supportsKilnAidMonitoring: boolean;
  supportsLocalLogExport: boolean;
  supportsZoneTelemetry: boolean;
  supportsDiagnostics: boolean;
  supportsMaintenanceLogging: boolean;
  supportsStartCode: boolean;
  supportsLiveViewStatus: boolean;
  supportsProgramCatalog: boolean;
  supportsHumanTriggeredStart: boolean;
  supportsObservedRemoteWrite: boolean;
  supportedWriteActions: string[];
};

export type CapabilityEvidence = {
  source: string;
  detail: string;
  confidence: KilnObservationConfidence;
};

export type LinkedPortalRefs = {
  batchIds: string[];
  pieceIds: string[];
  reservationIds: string[];
  portalFiringId: string | null;
};

export type RawArtifactRef = {
  id: string;
  kilnId: string;
  firingRunId: string | null;
  importRunId: string | null;
  artifactKind: string;
  sourceLabel: string | null;
  filename: string;
  contentType: string;
  sha256: string;
  sizeBytes: number;
  storageKey: string;
  observedAt: string | null;
  sourcePath: string | null;
  metadata: Record<string, unknown>;
};

export type Kiln = {
  id: string;
  displayName: string;
  manufacturer: string;
  kilnModel: string;
  controllerModel: string;
  controllerFamily: KilnControllerFamily;
  firmwareVersion: string | null;
  serialNumber: string | null;
  macAddress: string | null;
  zoneCount: number;
  thermocoupleType: string | null;
  output4Role: string | null;
  wifiConfigured: boolean;
  notes: string | null;
  capabilitiesDetected: KilnCapabilitySet;
  riskFlags: string[];
  lastSeenAt: string | null;
  currentRunId: string | null;
};

export type KilnCapabilityDocument = {
  id: string;
  kilnId: string;
  fingerprintHash: string;
  generatedAt: string;
  firmwareVersion: string | null;
  controllerFamily: KilnControllerFamily;
  zoneCount: number;
  enabledFeatures: string[];
  disabledFeatures: string[];
  ambiguousFeatures: string[];
  capabilities: KilnCapabilitySet;
  evidence: CapabilityEvidence[];
  observedFields: string[];
  providerSupport: Record<string, unknown>;
  operatorConfirmedFeatures: string[];
};

export type FiringRun = {
  id: string;
  kilnId: string;
  runSource: FiringRunSource;
  status: FiringRunStatus;
  queueState: FiringQueueState;
  controlPosture: KilnControlPosture;
  programName: string | null;
  programType: string | null;
  coneTarget: string | null;
  speed: string | null;
  startTime: string | null;
  endTime: string | null;
  durationSec: number | null;
  currentSegment: number | null;
  totalSegments: number | null;
  maxTemp: number | null;
  finalSetPoint: number | null;
  operatorId: string | null;
  operatorConfirmationAt: string | null;
  firmwareVersion: string | null;
  rawArtifactRefs: string[];
  linkedPortalRefs: LinkedPortalRefs;
};

export type FiringEvent = {
  id: string;
  kilnId: string;
  firingRunId: string;
  ts: string;
  eventType: string;
  severity: FiringEventSeverity;
  payloadJson: Record<string, unknown>;
  source: FiringEventSource;
  confidence: KilnObservationConfidence;
};

export type TelemetryPoint = {
  firingRunId: string;
  kilnId: string;
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

export type KilnHealthSnapshot = {
  id: string;
  kilnId: string;
  ts: string;
  relayHealth: "healthy" | "watch" | "unknown";
  lastDiagnosticsAt: string | null;
  boardTempStatus: "normal" | "watch" | "unknown";
  thermocoupleDriftEstimate: number | null;
  zoneImbalanceScore: number | null;
  heatupPerformanceScore: number | null;
  cooldownPerformanceScore: number | null;
  warnings: string[];
  confidenceNotes: string[];
  abnormalTerminationCount: number;
  underperformanceVsMedian: number | null;
};

export type OperatorAction = {
  id: string;
  kilnId: string;
  firingRunId: string | null;
  actionType: string;
  requestedBy: string;
  confirmedBy: string | null;
  requestedAt: string;
  completedAt: string | null;
  checklistJson: Record<string, unknown>;
  notes: string | null;
};

export type ParserDiagnostics = {
  parserKind: string;
  parserVersion: string;
  detectedSchema: string;
  warnings: string[];
  ambiguousFields: string[];
  unmappedFields: string[];
  parseErrors: string[];
};

export type KilnImportRun = {
  id: string;
  kilnId: string;
  source: "manual_upload" | "watch_folder" | "provider_snapshot";
  parserKind: string;
  parserVersion: string;
  status: "received" | "parsed" | "completed" | "failed";
  observedAt: string | null;
  startedAt: string;
  completedAt: string | null;
  artifactId: string | null;
  diagnostics: ParserDiagnostics;
  summary: string;
};

export type KilnCardOverview = {
  kilnId: string;
  kilnName: string;
  connectivityState: "online" | "stale" | "unknown";
  currentTemp: number | null;
  setPoint: number | null;
  segment: number | null;
  inferredPhase: string;
  zoneSpread: number | null;
  currentProgram: string | null;
  timeRunningSec: number | null;
  lastImportTime: string | null;
  lastHumanAcknowledgement: string | null;
  controlPosture: KilnControlPosture;
  currentRunId: string | null;
  nextQueuedRunId: string | null;
  healthWarnings: string[];
  maintenanceFlags: string[];
};

export type KilnOverview = {
  generatedAt: string;
  fleet: {
    kilnCount: number;
    activeRuns: number;
    attentionCount: number;
  };
  kilns: KilnCardOverview[];
  requiredOperatorActions: OperatorAction[];
  recentFirings: FiringRun[];
  maintenanceFlags: Array<{ kilnId: string; warnings: string[]; confidenceNotes: string[] }>;
};

export function defaultCapabilitySet(): KilnCapabilitySet {
  return {
    supportsKilnAidMonitoring: false,
    supportsLocalLogExport: false,
    supportsZoneTelemetry: false,
    supportsDiagnostics: false,
    supportsMaintenanceLogging: false,
    supportsStartCode: false,
    supportsLiveViewStatus: false,
    supportsProgramCatalog: false,
    supportsHumanTriggeredStart: true,
    supportsObservedRemoteWrite: false,
    supportedWriteActions: [],
  };
}
