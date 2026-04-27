"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const renderKilnCommandPage_1 = require("./renderKilnCommandPage");
(0, node_test_1.default)("Kiln Command page is explicit about overlay posture and control badges", () => {
    const html = (0, renderKilnCommandPage_1.renderKilnCommandPage)({
        generatedAt: "2026-04-14T12:00:00.000Z",
        overview: {
            generatedAt: "2026-04-14T12:00:00.000Z",
            fleet: {
                kilnCount: 1,
                activeRuns: 1,
                attentionCount: 1,
            },
            kilns: [
                {
                    kilnId: "kiln_test",
                    kilnName: "Studio Electric",
                    connectivityState: "online",
                    currentTemp: 1820,
                    setPoint: 1840,
                    segment: 5,
                    inferredPhase: "Firing",
                    zoneSpread: 18,
                    currentProgram: "Cone 6 Glaze",
                    timeRunningSec: 14_400,
                    lastImportTime: "2026-04-14T12:00:00.000Z",
                    lastHumanAcknowledgement: "2026-04-14T10:00:00.000Z",
                    controlPosture: "Human-triggered",
                    currentRunId: "run_test",
                    nextQueuedRunId: null,
                    healthWarnings: ["Zone imbalance is elevated versus normal three-zone spread."],
                    maintenanceFlags: ["Historic baseline is limited; trend comparisons are preliminary."],
                },
            ],
            requiredOperatorActions: [],
            recentFirings: [],
            maintenanceFlags: [],
        },
        kilnDetails: [
            {
                kiln: {
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
                    capabilitiesDetected: {
                        supportsKilnAidMonitoring: false,
                        supportsLocalLogExport: true,
                        supportsZoneTelemetry: true,
                        supportsDiagnostics: true,
                        supportsMaintenanceLogging: true,
                        supportsStartCode: true,
                        supportsLiveViewStatus: true,
                        supportsProgramCatalog: true,
                        supportsHumanTriggeredStart: true,
                        supportsObservedRemoteWrite: false,
                        supportedWriteActions: [],
                    },
                    riskFlags: [],
                    lastSeenAt: "2026-04-14T12:00:00.000Z",
                    currentRunId: "run_test",
                },
                capabilityDocument: null,
                currentRun: {
                    id: "run_test",
                    kilnId: "kiln_test",
                    runSource: "manual_controller",
                    status: "firing",
                    queueState: "firing",
                    controlPosture: "Human-triggered",
                    programName: "Cone 6 Glaze",
                    programType: "glaze",
                    coneTarget: "6",
                    speed: "slow",
                    startTime: "2026-04-14T10:00:00.000Z",
                    endTime: null,
                    durationSec: null,
                    currentSegment: 5,
                    totalSegments: 8,
                    maxTemp: 2232,
                    finalSetPoint: 2232,
                    operatorId: "staff-1",
                    operatorConfirmationAt: "2026-04-14T10:00:00.000Z",
                    firmwareVersion: "2.1.4",
                    rawArtifactRefs: [],
                    linkedPortalRefs: { batchIds: [], pieceIds: [], reservationIds: [], portalFiringId: null },
                },
                recentRuns: [],
                recentArtifacts: [],
                requiredActions: [],
                recentOperatorActions: [],
                healthSnapshot: null,
                currentRunEvents: [],
                currentRunTelemetry: [],
            },
        ],
        uploadMaxBytes: 5 * 1024 * 1024,
    });
    strict_1.default.match(html, /Genesis remains the control authority/i);
    strict_1.default.match(html, /Human-triggered/);
    strict_1.default.match(html, /without implying unsupported remote writes/i);
    strict_1.default.match(html, /Stage a firing run/i);
    strict_1.default.match(html, /Record local Start pressed/i);
    strict_1.default.match(html, /Import Genesis evidence/i);
});
