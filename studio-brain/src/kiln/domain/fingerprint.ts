import { stableHashDeep } from "../../stores/hash";
import type { CapabilityEvidence, Kiln, KilnCapabilityDocument, KilnControlPosture } from "./model";
import { defaultCapabilitySet } from "./model";

export type CapabilityFingerprintInput = {
  kiln: Kiln;
  observedFields: string[];
  providerSupport?: {
    supportsKilnAidMonitoring?: boolean;
    supportsDiagnostics?: boolean;
    supportsHistorySnapshots?: boolean;
    supportedWriteActions?: string[];
  };
  operatorConfirmedFeatures?: string[];
  evidence?: CapabilityEvidence[];
};

function hasAnyField(observedFields: string[], patterns: string[]): boolean {
  return patterns.some((pattern) => observedFields.some((field) => field.toLowerCase().includes(pattern)));
}

function sortUnique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

export function buildCapabilityFingerprint(input: CapabilityFingerprintInput): KilnCapabilityDocument {
  const observedFields = sortUnique(input.observedFields);
  const base = {
    ...defaultCapabilitySet(),
    ...input.kiln.capabilitiesDetected,
  };
  const providerWriteActions = sortUnique(input.providerSupport?.supportedWriteActions ?? []);
  const supportsDiagnostics =
    (input.providerSupport?.supportsDiagnostics ?? base.supportsDiagnostics)
    || hasAnyField(observedFields, ["diagnostic", "errorcode", "relay"]);
  const capabilities = {
    supportsKilnAidMonitoring:
      input.providerSupport?.supportsKilnAidMonitoring ?? base.supportsKilnAidMonitoring,
    supportsLocalLogExport:
      base.supportsLocalLogExport || hasAnyField(observedFields, ["exportcode", "export_code", "log_export"]),
    supportsZoneTelemetry:
      base.supportsZoneTelemetry || hasAnyField(observedFields, ["tempzone", "percentpower", "zonecount"]),
    supportsDiagnostics,
    supportsMaintenanceLogging:
      base.supportsMaintenanceLogging || hasAnyField(observedFields, ["relay", "maintenance", "thermocouple"]),
    supportsStartCode:
      base.supportsStartCode || hasAnyField(observedFields, ["startcode", "start_code"]),
    supportsLiveViewStatus:
      base.supportsLiveViewStatus || hasAnyField(observedFields, ["setpoint", "segment", "tempprimary"]),
    supportsProgramCatalog:
      base.supportsProgramCatalog || hasAnyField(observedFields, ["programname", "programtype", "segments"]),
    supportsHumanTriggeredStart: true,
    supportsObservedRemoteWrite: providerWriteActions.length > 0,
    supportedWriteActions: providerWriteActions,
  };

  const enabledFeatures = sortUnique(
    Object.entries(capabilities)
      .filter(([key, value]) => key !== "supportedWriteActions" && value === true)
      .map(([key]) => key)
      .concat(capabilities.supportedWriteActions.map((action) => `write:${action}`)),
  );
  const disabledFeatures = sortUnique(
    Object.entries(capabilities)
      .filter(([key, value]) => key !== "supportedWriteActions" && value === false)
      .map(([key]) => key),
  );
  const ambiguousFeatures = sortUnique([
    ...(capabilities.supportedWriteActions.length === 0 ? ["remote_write"] : []),
    ...(input.providerSupport?.supportsHistorySnapshots ? [] : ["history_snapshots"]),
  ]);
  const operatorConfirmedFeatures = sortUnique(input.operatorConfirmedFeatures ?? []);
  const fingerprintHash = stableHashDeep({
    kilnId: input.kiln.id,
    firmwareVersion: input.kiln.firmwareVersion,
    zoneCount: input.kiln.zoneCount,
    controllerFamily: input.kiln.controllerFamily,
    enabledFeatures,
    disabledFeatures,
    ambiguousFeatures,
    observedFields,
    operatorConfirmedFeatures,
    providerSupport: input.providerSupport ?? {},
  });

  return {
    id: `kilncap_${fingerprintHash.slice(0, 16)}`,
    kilnId: input.kiln.id,
    fingerprintHash,
    generatedAt: new Date().toISOString(),
    firmwareVersion: input.kiln.firmwareVersion,
    controllerFamily: input.kiln.controllerFamily,
    zoneCount: input.kiln.zoneCount,
    enabledFeatures,
    disabledFeatures,
    ambiguousFeatures,
    capabilities,
    evidence: input.evidence ?? [],
    observedFields,
    providerSupport: input.providerSupport ?? {},
    operatorConfirmedFeatures,
  };
}

export function deriveKilnControlPosture(input: {
  capabilityDocument: Pick<KilnCapabilityDocument, "capabilities"> | null;
  operatorConfirmationAt: string | null;
  enableSupportedWrites: boolean;
}): KilnControlPosture {
  const supportedWriteActions = input.capabilityDocument?.capabilities.supportedWriteActions ?? [];
  if (input.enableSupportedWrites && supportedWriteActions.length > 0) {
    return "Supported write path";
  }
  if (input.operatorConfirmationAt) {
    return "Human-triggered";
  }
  return "Observed only";
}
