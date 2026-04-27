"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeZoneImbalanceScore = computeZoneImbalanceScore;
exports.computeThermocoupleDriftEstimate = computeThermocoupleDriftEstimate;
exports.computeHeatupPerformanceScore = computeHeatupPerformanceScore;
exports.computeCooldownPerformanceScore = computeCooldownPerformanceScore;
exports.computeUnderperformanceVsMedian = computeUnderperformanceVsMedian;
exports.buildAnalyticsConfidenceNotes = buildAnalyticsConfidenceNotes;
exports.buildKilnHealthSnapshot = buildKilnHealthSnapshot;
exports.inferRunPhase = inferRunPhase;
const node_crypto_1 = __importDefault(require("node:crypto"));
function median(values) {
    if (!values.length)
        return null;
    const sorted = [...values].sort((left, right) => left - right);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
function clamp01(value) {
    if (value === null || !Number.isFinite(value))
        return null;
    return Math.max(0, Math.min(1, value));
}
function minutesBetween(startIso, endIso) {
    if (!startIso || !endIso)
        return null;
    const start = Date.parse(startIso);
    const end = Date.parse(endIso);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
        return null;
    return (end - start) / 60_000;
}
function availableZoneTemps(point) {
    return [point.tempZone1, point.tempZone2, point.tempZone3].filter((value) => typeof value === "number");
}
function computeZoneImbalanceScore(telemetry) {
    if (!telemetry.length)
        return null;
    const spreads = telemetry
        .map((point) => {
        const zones = availableZoneTemps(point);
        if (zones.length < 2)
            return null;
        const max = Math.max(...zones);
        const min = Math.min(...zones);
        const base = point.tempPrimary ?? max;
        if (!Number.isFinite(base) || base <= 0)
            return null;
        return (max - min) / base;
    })
        .filter((value) => value !== null);
    if (!spreads.length)
        return null;
    const average = spreads.reduce((sum, value) => sum + value, 0) / spreads.length;
    return clamp01(average);
}
function computeThermocoupleDriftEstimate(telemetry) {
    if (!telemetry.length)
        return null;
    const deltas = telemetry
        .map((point) => {
        const zones = availableZoneTemps(point);
        if (!zones.length || point.tempPrimary === null)
            return null;
        const zoneAverage = zones.reduce((sum, value) => sum + value, 0) / zones.length;
        return Math.abs(zoneAverage - point.tempPrimary);
    })
        .filter((value) => value !== null);
    if (!deltas.length)
        return null;
    return deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
}
function computeHeatupPerformanceScore(run, telemetry) {
    if (telemetry.length < 2)
        return null;
    const first = telemetry[0];
    const last = telemetry[telemetry.length - 1];
    if (first.tempPrimary === null || last.tempPrimary === null)
        return null;
    const minutes = minutesBetween(first.ts, last.ts);
    if (minutes === null || minutes <= 0)
        return null;
    const degreesPerMinute = Math.max(0, last.tempPrimary - first.tempPrimary) / minutes;
    return clamp01(degreesPerMinute / 12);
}
function computeCooldownPerformanceScore(run, telemetry) {
    if (telemetry.length < 3 || run.status === "firing")
        return null;
    const first = telemetry[0];
    const last = telemetry[telemetry.length - 1];
    if (first.tempPrimary === null || last.tempPrimary === null)
        return null;
    const minutes = minutesBetween(first.ts, last.ts);
    if (minutes === null || minutes <= 0)
        return null;
    const degreesPerMinute = Math.max(0, first.tempPrimary - last.tempPrimary) / minutes;
    return clamp01(degreesPerMinute / 8);
}
function computeUnderperformanceVsMedian(run, historicalRuns) {
    if (!run.durationSec)
        return null;
    const cohort = historicalRuns.filter((entry) => entry.id !== run.id && entry.programName === run.programName && entry.status === "complete" && entry.durationSec);
    const medianDuration = median(cohort.map((entry) => entry.durationSec).filter((value) => value > 0));
    if (medianDuration === null || medianDuration <= 0)
        return null;
    return (run.durationSec - medianDuration) / medianDuration;
}
function buildAnalyticsConfidenceNotes(input) {
    const notes = [];
    if (input.telemetry.length < 5) {
        notes.push("Telemetry sample is thin, so health conclusions are inferred conservatively.");
    }
    if (input.historicalRuns.length < 3) {
        notes.push("Historic baseline is limited; trend comparisons are preliminary.");
    }
    if (input.diagnosticsCount === 0) {
        notes.push("No explicit diagnostics markers were observed in the imported evidence.");
    }
    if (!notes.length) {
        notes.push("Confidence is stronger because telemetry, diagnostics, and historical baselines are all present.");
    }
    return notes;
}
function buildKilnHealthSnapshot(input) {
    const zoneImbalanceScore = computeZoneImbalanceScore(input.telemetry);
    const thermocoupleDriftEstimate = computeThermocoupleDriftEstimate(input.telemetry);
    const heatupPerformanceScore = computeHeatupPerformanceScore(input.run, input.telemetry);
    const cooldownPerformanceScore = computeCooldownPerformanceScore(input.run, input.telemetry);
    const underperformanceVsMedian = computeUnderperformanceVsMedian(input.run, input.historicalRuns);
    const abnormalTerminationCount = input.historicalRuns.filter((entry) => entry.status === "error" || entry.status === "aborted").length;
    const warnings = [];
    if ((zoneImbalanceScore ?? 0) > 0.08) {
        warnings.push("Zone imbalance is elevated versus normal three-zone spread.");
    }
    if ((thermocoupleDriftEstimate ?? 0) > 18) {
        warnings.push("Thermocouple drift estimate is elevated and should be checked against calibration history.");
    }
    if ((underperformanceVsMedian ?? 0) > 0.15) {
        warnings.push("Run duration is materially slower than the recent median for the same profile.");
    }
    if (abnormalTerminationCount >= 2) {
        warnings.push("Recent abnormal termination pattern detected across historical firings.");
    }
    return {
        id: `khealth_${node_crypto_1.default.randomUUID()}`,
        kilnId: input.kilnId,
        ts: new Date().toISOString(),
        relayHealth: input.diagnosticsCount > 0 ? "healthy" : "unknown",
        lastDiagnosticsAt: input.lastDiagnosticsAt,
        boardTempStatus: input.telemetry.some((point) => typeof point.boardTemp === "number" && point.boardTemp > 70) ? "watch" : "unknown",
        thermocoupleDriftEstimate,
        zoneImbalanceScore,
        heatupPerformanceScore,
        cooldownPerformanceScore,
        warnings,
        confidenceNotes: buildAnalyticsConfidenceNotes({
            telemetry: input.telemetry,
            historicalRuns: input.historicalRuns,
            diagnosticsCount: input.diagnosticsCount,
        }),
        abnormalTerminationCount,
        underperformanceVsMedian,
    };
}
function inferRunPhase(run) {
    switch (run.status) {
        case "queued":
            return run.queueState === "ready_for_start" ? "Awaiting local start" : "Queued";
        case "armed":
            return "Armed";
        case "firing":
            return "Firing";
        case "cooling":
            return "Cooling";
        case "complete":
            return run.queueState === "ready_for_unload" ? "Ready for unload" : "Complete";
        case "error":
            return "Exception";
        case "aborted":
            return "Aborted";
        default:
            return "Observed";
    }
}
