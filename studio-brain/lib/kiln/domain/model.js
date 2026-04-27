"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.operatorActionTypes = exports.firingEventSources = exports.firingEventSeverities = exports.kilnControlPostures = exports.firingQueueStates = exports.firingRunStatuses = exports.firingRunSources = exports.kilnObservationConfidences = exports.kilnControllerFamilies = void 0;
exports.defaultCapabilitySet = defaultCapabilitySet;
exports.kilnControllerFamilies = ["bartlett_genesis"];
exports.kilnObservationConfidences = ["documented", "observed", "inferred"];
exports.firingRunSources = ["manual_controller", "imported_log", "kilnaid", "inferred"];
exports.firingRunStatuses = ["queued", "armed", "firing", "cooling", "complete", "error", "aborted"];
exports.firingQueueStates = [
    "intake",
    "staged",
    "ready_for_program",
    "ready_for_start",
    "firing",
    "cooling",
    "ready_for_unload",
    "complete",
    "exception",
];
exports.kilnControlPostures = ["Observed only", "Human-triggered", "Supported write path"];
exports.firingEventSeverities = ["info", "warning", "critical"];
exports.firingEventSources = ["controller_log", "kilnaid", "operator", "inferred"];
exports.operatorActionTypes = [
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
];
function defaultCapabilitySet() {
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
