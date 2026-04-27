"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseGenesisLog = parseGenesisLog;
const detect_1 = require("./detect");
const PARSER_KIND = "genesis-log";
const PARSER_VERSION = "0.1.0";
function parseNumber(value) {
    if (!value)
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function parseBoolean(value) {
    if (!value)
        return undefined;
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes")
        return true;
    if (normalized === "false" || normalized === "0" || normalized === "no")
        return false;
    return undefined;
}
function parseStatus(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "queued"
        || normalized === "armed"
        || normalized === "firing"
        || normalized === "cooling"
        || normalized === "complete"
        || normalized === "error"
        || normalized === "aborted") {
        return normalized;
    }
    return undefined;
}
function splitLine(line) {
    const match = line.match(/^(META|RUN|EVENT|TELEMETRY)\s*([:|])\s*(.*)$/i);
    if (!match)
        return null;
    return {
        prefix: match[1].toUpperCase(),
        body: match[3] ?? "",
        separator: match[2] === "|" ? "|" : ";",
    };
}
function normalizeObservedField(prefix, key) {
    return `${prefix.toLowerCase()}.${key.replace(/[^a-z0-9]+/gi, "").toLowerCase()}`;
}
function parseKeyValueBody(body, separator) {
    const entries = body
        .split(separator)
        .map((segment) => segment.trim())
        .filter(Boolean);
    const output = {};
    for (const entry of entries) {
        const divider = entry.indexOf("=");
        if (divider <= 0)
            continue;
        const key = entry.slice(0, divider).trim();
        const value = entry.slice(divider + 1).trim();
        if (!key)
            continue;
        output[key] = value;
    }
    return output;
}
function parseSeverity(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "warning" || normalized === "critical")
        return normalized;
    return "info";
}
function parseTelemetry(fields) {
    return {
        ts: fields.ts ?? "",
        tempPrimary: parseNumber(fields.tempPrimary ?? fields.temp ?? fields.primaryTemp),
        tempZone1: parseNumber(fields.tempZone1),
        tempZone2: parseNumber(fields.tempZone2),
        tempZone3: parseNumber(fields.tempZone3),
        setPoint: parseNumber(fields.setPoint),
        segment: parseNumber(fields.segment),
        percentPower1: parseNumber(fields.percentPower1),
        percentPower2: parseNumber(fields.percentPower2),
        percentPower3: parseNumber(fields.percentPower3),
        boardTemp: parseNumber(fields.boardTemp),
        rawPayload: fields,
    };
}
function parseEvent(fields) {
    return {
        ts: fields.ts ?? "",
        eventType: fields.eventType ?? fields.type ?? "event",
        severity: parseSeverity(fields.severity),
        payload: fields,
        confidence: "observed",
    };
}
function parseGenesisLog(raw) {
    const detectedSchema = (0, detect_1.detectGenesisLogSchema)(raw);
    const warnings = [];
    const ambiguousFields = [];
    const unmappedFields = [];
    const parseErrors = [];
    const observedFields = new Set();
    const kilnHints = {};
    const runHints = {};
    const events = [];
    const telemetry = [];
    const lines = raw.split(/\r?\n/);
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#"))
            continue;
        const parsedLine = splitLine(line);
        if (!parsedLine) {
            warnings.push(`Ignored unrecognized line: ${line.slice(0, 120)}`);
            continue;
        }
        const fields = parseKeyValueBody(parsedLine.body, parsedLine.separator);
        for (const key of Object.keys(fields)) {
            observedFields.add(normalizeObservedField(parsedLine.prefix, key));
        }
        try {
            if (parsedLine.prefix === "META") {
                kilnHints.displayName = fields.displayName ?? kilnHints.displayName;
                kilnHints.manufacturer = fields.manufacturer ?? kilnHints.manufacturer;
                kilnHints.kilnModel = fields.kilnModel ?? kilnHints.kilnModel;
                kilnHints.controllerModel = fields.controllerModel ?? kilnHints.controllerModel;
                kilnHints.firmwareVersion = fields.firmwareVersion ?? kilnHints.firmwareVersion;
                kilnHints.serialNumber = fields.serialNumber ?? kilnHints.serialNumber;
                kilnHints.macAddress = fields.macAddress ?? kilnHints.macAddress;
                kilnHints.zoneCount = parseNumber(fields.zoneCount) ?? kilnHints.zoneCount;
                kilnHints.thermocoupleType = fields.thermocoupleType ?? kilnHints.thermocoupleType;
                kilnHints.output4Role = fields.output4Role ?? kilnHints.output4Role;
                kilnHints.wifiConfigured = parseBoolean(fields.wifiConfigured) ?? kilnHints.wifiConfigured;
                if (fields.riskFlags) {
                    kilnHints.riskFlags = fields.riskFlags.split(",").map((entry) => entry.trim()).filter(Boolean);
                }
                continue;
            }
            if (parsedLine.prefix === "RUN") {
                runHints.programName = fields.programName ?? runHints.programName;
                runHints.programType = fields.programType ?? runHints.programType;
                runHints.coneTarget = fields.coneTarget ?? runHints.coneTarget;
                runHints.speed = fields.speed ?? runHints.speed;
                runHints.startTime = fields.startTime ?? runHints.startTime;
                runHints.endTime = fields.endTime ?? runHints.endTime;
                runHints.status = parseStatus(fields.status) ?? runHints.status;
                runHints.currentSegment = parseNumber(fields.currentSegment) ?? runHints.currentSegment;
                runHints.totalSegments = parseNumber(fields.totalSegments) ?? runHints.totalSegments;
                runHints.finalSetPoint = parseNumber(fields.finalSetPoint) ?? runHints.finalSetPoint;
                runHints.maxTemp = parseNumber(fields.maxTemp) ?? runHints.maxTemp;
                continue;
            }
            if (parsedLine.prefix === "EVENT") {
                const event = parseEvent(fields);
                if (!event.ts) {
                    ambiguousFields.push("event.ts");
                    warnings.push(`EVENT line missing ts: ${line.slice(0, 120)}`);
                }
                else {
                    events.push(event);
                }
                continue;
            }
            if (parsedLine.prefix === "TELEMETRY") {
                const point = parseTelemetry(fields);
                if (!point.ts) {
                    ambiguousFields.push("telemetry.ts");
                    warnings.push(`TELEMETRY line missing ts: ${line.slice(0, 120)}`);
                }
                else {
                    telemetry.push(point);
                }
                continue;
            }
        }
        catch (error) {
            parseErrors.push(error instanceof Error ? error.message : String(error));
        }
    }
    const knownFieldPrefixes = new Set([
        "meta.displayname",
        "meta.manufacturer",
        "meta.kilnmodel",
        "meta.controllermodel",
        "meta.firmwareversion",
        "meta.serialnumber",
        "meta.macaddress",
        "meta.zonecount",
        "meta.thermocoupletype",
        "meta.output4role",
        "meta.wificonfigured",
        "meta.riskflags",
        "run.programname",
        "run.programtype",
        "run.conetarget",
        "run.speed",
        "run.starttime",
        "run.endtime",
        "run.status",
        "run.currentsegment",
        "run.totalsegments",
        "run.finalsetpoint",
        "run.maxtemp",
        "event.ts",
        "event.eventtype",
        "event.type",
        "event.severity",
        "telemetry.ts",
        "telemetry.tempprimary",
        "telemetry.temp",
        "telemetry.primarytemp",
        "telemetry.tempzone1",
        "telemetry.tempzone2",
        "telemetry.tempzone3",
        "telemetry.setpoint",
        "telemetry.segment",
        "telemetry.percentpower1",
        "telemetry.percentpower2",
        "telemetry.percentpower3",
        "telemetry.boardtemp",
    ]);
    for (const field of observedFields) {
        if (!knownFieldPrefixes.has(field)) {
            unmappedFields.push(field);
        }
    }
    const summary = `schema=${detectedSchema} telemetry=${telemetry.length} events=${events.length} warnings=${warnings.length + parseErrors.length}`;
    return {
        detectedSchema,
        parserDiagnostics: {
            parserKind: PARSER_KIND,
            parserVersion: PARSER_VERSION,
            detectedSchema,
            warnings,
            ambiguousFields,
            unmappedFields,
            parseErrors,
        },
        observedFields: [...observedFields].sort((left, right) => left.localeCompare(right)),
        kilnHints,
        runHints,
        events,
        telemetry,
        summary,
    };
}
