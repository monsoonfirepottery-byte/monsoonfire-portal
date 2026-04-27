"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.persistRawKilnArtifact = persistRawKilnArtifact;
exports.importGenesisArtifact = importGenesisArtifact;
exports.scanGenesisWatchFolder = scanGenesisWatchFolder;
const node_crypto_1 = __importDefault(require("node:crypto"));
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const hash_1 = require("../../stores/hash");
const fingerprint_1 = require("../domain/fingerprint");
const model_1 = require("../domain/model");
const normalize_1 = require("../adapters/genesis-log/normalize");
const parser_1 = require("../adapters/genesis-log/parser");
const analytics_1 = require("./analytics");
const orchestration_1 = require("./orchestration");
function sha256(buffer) {
    return node_crypto_1.default.createHash("sha256").update(buffer).digest("hex");
}
function sanitizeFilename(filename) {
    return filename.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "artifact.txt";
}
function guessContentType(filename, fallback = null) {
    const normalized = filename.toLowerCase();
    if (normalized.endsWith(".txt") || normalized.endsWith(".log"))
        return "text/plain; charset=utf-8";
    if (normalized.endsWith(".json"))
        return "application/json";
    return fallback ?? "application/octet-stream";
}
function createKilnFromHints(id, existing, hints) {
    return {
        id,
        displayName: hints.displayName ?? existing?.displayName ?? "Genesis Kiln",
        manufacturer: hints.manufacturer ?? existing?.manufacturer ?? "L&L / Bartlett",
        kilnModel: hints.kilnModel ?? existing?.kilnModel ?? "Unknown kiln",
        controllerModel: hints.controllerModel ?? existing?.controllerModel ?? "Genesis",
        controllerFamily: "bartlett_genesis",
        firmwareVersion: hints.firmwareVersion ?? existing?.firmwareVersion ?? null,
        serialNumber: hints.serialNumber ?? existing?.serialNumber ?? null,
        macAddress: hints.macAddress ?? existing?.macAddress ?? null,
        zoneCount: hints.zoneCount ?? existing?.zoneCount ?? 1,
        thermocoupleType: hints.thermocoupleType ?? existing?.thermocoupleType ?? null,
        output4Role: hints.output4Role ?? existing?.output4Role ?? null,
        wifiConfigured: hints.wifiConfigured ?? existing?.wifiConfigured ?? false,
        notes: existing?.notes ?? null,
        capabilitiesDetected: existing?.capabilitiesDetected ?? (0, model_1.defaultCapabilitySet)(),
        riskFlags: [...new Set([...(existing?.riskFlags ?? []), ...(hints.riskFlags ?? [])])],
        lastSeenAt: new Date().toISOString(),
        currentRunId: existing?.currentRunId ?? null,
    };
}
async function resolveKiln(store, input) {
    if (input.kilnId) {
        const existing = await store.getKiln(input.kilnId);
        return createKilnFromHints(input.kilnId, existing, input.kilnHints);
    }
    const existingKilns = await store.listKilns();
    const match = existingKilns.find((candidate) => {
        if (input.kilnHints.serialNumber && candidate.serialNumber === input.kilnHints.serialNumber)
            return true;
        if (input.kilnHints.macAddress && candidate.macAddress === input.kilnHints.macAddress)
            return true;
        if (input.kilnHints.displayName && candidate.displayName === input.kilnHints.displayName)
            return true;
        return false;
    });
    const kilnId = match?.id
        ?? `kiln_${(0, hash_1.stableHashDeep)({
            displayName: input.kilnHints.displayName ?? "",
            serialNumber: input.kilnHints.serialNumber ?? "",
            macAddress: input.kilnHints.macAddress ?? "",
        }).slice(0, 16)}`;
    return createKilnFromHints(kilnId, match ?? null, input.kilnHints);
}
function deriveInitialQueueState(run) {
    switch (run.status) {
        case "firing":
            return "firing";
        case "cooling":
            return "cooling";
        case "complete":
            return "ready_for_unload";
        case "error":
        case "aborted":
            return "exception";
        default:
            return run.programName || run.programType ? "ready_for_program" : "intake";
    }
}
function createRunFromHints(input) {
    const base = input.existingRun ?? {
        id: `frun_${node_crypto_1.default.randomUUID()}`,
        kilnId: input.kilnId,
        runSource: "imported_log",
        status: input.parseResult.runHints.status ?? (input.parseResult.telemetry.length > 0 ? "firing" : "queued"),
        queueState: "intake",
        controlPosture: "Observed only",
        programName: null,
        programType: null,
        coneTarget: null,
        speed: null,
        startTime: null,
        endTime: null,
        durationSec: null,
        currentSegment: null,
        totalSegments: null,
        maxTemp: null,
        finalSetPoint: null,
        operatorId: null,
        operatorConfirmationAt: null,
        firmwareVersion: null,
        rawArtifactRefs: [],
        linkedPortalRefs: {
            batchIds: [],
            pieceIds: [],
            reservationIds: [],
            portalFiringId: null,
        },
    };
    const observed = (0, orchestration_1.applyObservedRunState)(base, {
        observedStatus: input.parseResult.runHints.status,
        currentSegment: input.parseResult.runHints.currentSegment ?? null,
        totalSegments: input.parseResult.runHints.totalSegments ?? null,
        finalSetPoint: input.parseResult.runHints.finalSetPoint ?? null,
        maxTemp: input.parseResult.runHints.maxTemp ?? null,
        startTime: input.parseResult.runHints.startTime ?? null,
        endTime: input.parseResult.runHints.endTime ?? null,
    });
    observed.queueState = deriveInitialQueueState(observed);
    observed.programName = input.parseResult.runHints.programName ?? observed.programName;
    observed.programType = input.parseResult.runHints.programType ?? observed.programType;
    observed.coneTarget = input.parseResult.runHints.coneTarget ?? observed.coneTarget;
    observed.speed = input.parseResult.runHints.speed ?? observed.speed;
    observed.firmwareVersion = input.parseResult.kilnHints.firmwareVersion ?? observed.firmwareVersion;
    observed.rawArtifactRefs = [...new Set([...observed.rawArtifactRefs, input.artifactId])];
    return observed;
}
async function persistRawKilnArtifact(input) {
    const contentSha = sha256(input.content);
    const existing = await input.kilnStore.findArtifactBySha256(contentSha);
    const safeFilename = sanitizeFilename(input.filename);
    const storageKey = existing?.storageKey
        ?? ["kiln", "raw", new Date().toISOString().slice(0, 10), `${contentSha.slice(0, 16)}-${safeFilename}`].join("/");
    if (!existing) {
        await input.artifactStore.put(storageKey, input.content, {
            sha256: contentSha,
            filename: safeFilename,
            kilnId: input.kilnId,
        });
    }
    const record = {
        id: `kart_${node_crypto_1.default.randomUUID()}`,
        kilnId: input.kilnId,
        firingRunId: input.firingRunId ?? null,
        importRunId: input.importRunId ?? null,
        artifactKind: input.artifactKind,
        sourceLabel: input.sourceLabel ?? null,
        filename: safeFilename,
        contentType: input.contentType ?? guessContentType(safeFilename),
        sha256: contentSha,
        sizeBytes: input.content.byteLength,
        storageKey,
        observedAt: input.observedAt ?? null,
        sourcePath: input.sourcePath ?? null,
        metadata: {
            sourcePath: input.sourcePath ?? null,
            reusedStorageObject: Boolean(existing),
        },
    };
    await input.kilnStore.saveArtifactRecord(record);
    return record;
}
async function importGenesisArtifact(input) {
    const parseResult = (0, parser_1.parseGenesisLog)(input.content.toString("utf8"));
    const kiln = await resolveKiln(input.kilnStore, {
        kilnId: input.kilnId ?? null,
        kilnHints: parseResult.kilnHints,
    });
    await input.kilnStore.upsertKiln(kiln);
    const importRunId = `kirun_${node_crypto_1.default.randomUUID()}`;
    const importRunBase = {
        id: importRunId,
        kilnId: kiln.id,
        source: input.source,
        parserKind: parseResult.parserDiagnostics.parserKind,
        parserVersion: parseResult.parserDiagnostics.parserVersion,
        status: "received",
        observedAt: input.observedAt ?? null,
        startedAt: new Date().toISOString(),
        completedAt: null,
        artifactId: null,
        diagnostics: parseResult.parserDiagnostics,
        summary: parseResult.summary,
    };
    await input.kilnStore.saveImportRun(importRunBase);
    const artifact = await persistRawKilnArtifact({
        artifactStore: input.artifactStore,
        kilnStore: input.kilnStore,
        kilnId: kiln.id,
        importRunId,
        artifactKind: "genesis_log",
        filename: input.filename,
        contentType: input.contentType,
        observedAt: input.observedAt,
        sourceLabel: input.sourceLabel,
        sourcePath: input.sourcePath,
        content: input.content,
    });
    const existingRun = await input.kilnStore.findCurrentRunForKiln(kiln.id);
    const firingRun = createRunFromHints({
        kilnId: kiln.id,
        existingRun,
        artifactId: artifact.id,
        parseResult,
    });
    await input.kilnStore.saveFiringRun(firingRun);
    const normalized = (0, normalize_1.normalizeGenesisImport)({
        kilnId: kiln.id,
        firingRunId: firingRun.id,
        parseResult,
    });
    await input.kilnStore.appendFiringEvents(normalized.events);
    await input.kilnStore.appendTelemetryPoints(normalized.telemetry);
    const capabilityDocument = (0, fingerprint_1.buildCapabilityFingerprint)({
        kiln: { ...kiln, currentRunId: firingRun.status === "complete" ? null : firingRun.id },
        observedFields: parseResult.observedFields,
        providerSupport: input.providerSupport
            ? {
                supportsKilnAidMonitoring: input.providerSupport.supportsStatus,
                supportsDiagnostics: input.providerSupport.supportsDiagnostics,
                supportsHistorySnapshots: input.providerSupport.supportsHistory,
                supportedWriteActions: input.providerSupport.supportedWriteActions,
            }
            : undefined,
        evidence: normalized.evidence,
    });
    const nextKiln = {
        ...kiln,
        capabilitiesDetected: capabilityDocument.capabilities,
        currentRunId: firingRun.status === "complete" ? null : firingRun.id,
        lastSeenAt: input.observedAt ?? new Date().toISOString(),
    };
    await input.kilnStore.upsertKiln(nextKiln);
    await input.kilnStore.saveCapabilityDocument(capabilityDocument);
    const historicalRuns = await input.kilnStore.listFiringRuns({ kilnId: kiln.id, limit: 25 });
    const healthSnapshot = (0, analytics_1.buildKilnHealthSnapshot)({
        kilnId: kiln.id,
        telemetry: normalized.telemetry,
        run: firingRun,
        historicalRuns,
        diagnosticsCount: normalized.events.filter((entry) => entry.eventType.toLowerCase().includes("diagnostic")).length,
        lastDiagnosticsAt: normalized.lastDiagnosticsAt,
    });
    await input.kilnStore.saveHealthSnapshot(healthSnapshot);
    const importRun = {
        ...importRunBase,
        status: "completed",
        completedAt: new Date().toISOString(),
        artifactId: artifact.id,
    };
    await input.kilnStore.saveImportRun(importRun);
    return {
        kiln: nextKiln,
        firingRun,
        capabilityDocument,
        healthSnapshot,
        importRun,
        artifact,
        parseSummary: parseResult.summary,
    };
}
async function walkFiles(root) {
    let entries;
    try {
        entries = await (0, promises_1.readdir)(root, { withFileTypes: true });
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
    const output = [];
    for (const entry of entries) {
        const nextPath = (0, node_path_1.resolve)(root, entry.name);
        if (entry.isDirectory()) {
            output.push(...(await walkFiles(nextPath)));
            continue;
        }
        if (entry.isFile()) {
            output.push(nextPath);
        }
    }
    return output;
}
async function scanGenesisWatchFolder(input) {
    const files = await walkFiles((0, node_path_1.resolve)(input.watchDir));
    let imported = 0;
    let skipped = 0;
    const summaries = [];
    for (const path of files) {
        const content = await (0, promises_1.readFile)(path);
        const contentSha = sha256(content);
        const existing = await input.kilnStore.findArtifactBySha256(contentSha);
        if (existing?.sourcePath && (0, node_path_1.resolve)(existing.sourcePath) === (0, node_path_1.resolve)(path)) {
            skipped += 1;
            continue;
        }
        const result = await importGenesisArtifact({
            artifactStore: input.artifactStore,
            kilnStore: input.kilnStore,
            providerSupport: input.providerSupport,
            filename: path.split(/[\\/]/).pop() ?? "genesis-log.txt",
            content,
            observedAt: new Date().toISOString(),
            sourceLabel: "watch-folder",
            sourcePath: path,
            source: "watch_folder",
        });
        imported += 1;
        summaries.push(`${result.kiln.displayName}: ${result.parseSummary}`);
    }
    return { imported, skipped, summaries };
}
