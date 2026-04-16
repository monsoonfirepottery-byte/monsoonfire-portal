#!/usr/bin/env node

/* eslint-disable no-console */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { STARTUP_REASON_CODES } from "./lib/codex-startup-reliability.mjs";
import { summarizeStartupObservationCoverage } from "./lib/codex-toolcall-governance.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_WINDOW_HOURS = 168;
const DEFAULT_OUTPUT_DIR = resolve(repoRoot, "output", "qa");
const DEFAULT_REPORT_JSON = resolve(DEFAULT_OUTPUT_DIR, "codex-startup-scorecard.json");
const DEFAULT_REPORT_MARKDOWN = resolve(DEFAULT_OUTPUT_DIR, "codex-startup-scorecard.md");
const DEFAULT_HISTORY_PATH = resolve(DEFAULT_OUTPUT_DIR, "codex-startup-scorecard-history.ndjson");
const DEFAULT_TOOLCALLS_PATH = resolve(repoRoot, ".codex", "toolcalls.ndjson");
const DEFAULT_LIFECYCLE_MEMORY_PATH = resolve(repoRoot, ".codex", "lifecycle-memory.ndjson");
const DEFAULT_INTERACTION_LOG_PATH = resolve(repoRoot, ".codex", "interaction-log.md");
const STARTUP_TOOL_NAMES = new Set([
  "codex-startup-preflight",
  "codex-doctor",
  "codex-shell",
  "codex-worktree",
  "codex-startup-scorecard",
]);
const BLOCKED_REASON_CODES = new Set([
  STARTUP_REASON_CODES.MISSING_TOKEN,
  STARTUP_REASON_CODES.EXPIRED_TOKEN,
  STARTUP_REASON_CODES.TRANSPORT_UNREACHABLE,
  STARTUP_REASON_CODES.TIMEOUT,
]);
const TARGETS = Object.freeze({
  passRateMin: 0.95,
  readyRateMin: 0.85,
  groundingReadyRateMin: 0.9,
  emptyContextRateMax: 0.08,
  blockedContinuityRateMax: 0.05,
  richContextRateMin: 0.6,
  p50LatencyMsMax: 1500,
  p95LatencyMsMax: 3000,
  tokenFreshRateMin: 0.9,
  mcpBridgeFailureRateMax: 0.05,
});
const REQUIRED_LIVE_STARTUP_SAMPLES = 5;

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  node ./scripts/codex-startup-scorecard.mjs [options]",
      "",
      "Options:",
      "  --window-hours <n>       History window to analyze (default: 168)",
      "  --history <path>         NDJSON history path",
      "  --toolcalls <path>       Toolcall NDJSON path",
      "  --lifecycle-memory <p>   Lifecycle memory NDJSON path",
      "  --interaction-log <path> Interaction log markdown path",
      "  --report-json <path>     JSON report output path (with --write)",
      "  --report-markdown <path> Markdown report output path (with --write)",
      "  --now <iso>              Override current time",
      "  --skip-doctor            Skip live codex-doctor run",
      "  --skip-interaction-log   Skip interaction-log parsing",
      "  --no-append-history      Do not append the current sample to history",
      "  --write                  Write JSON/Markdown artifacts",
      "  --strict                 Fail when startup quality falls below thresholds",
      "  --json                   Print JSON to stdout",
      "  --markdown               Print markdown to stdout",
      "  -h, --help               Show this help",
      "",
      "Note:",
      "  The current live startup sample is appended to history by default so trendlines improve over time.",
      "",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const options = {
    windowHours: DEFAULT_WINDOW_HOURS,
    historyPath: DEFAULT_HISTORY_PATH,
    toolcallsPath: DEFAULT_TOOLCALLS_PATH,
    lifecycleMemoryPath: DEFAULT_LIFECYCLE_MEMORY_PATH,
    interactionLogPath: DEFAULT_INTERACTION_LOG_PATH,
    reportJsonPath: DEFAULT_REPORT_JSON,
    reportMarkdownPath: DEFAULT_REPORT_MARKDOWN,
    nowIso: "",
    writeArtifacts: false,
    strict: false,
    appendHistory: true,
    includeDoctor: true,
    includeInteractionLog: true,
    asJson: false,
    asMarkdown: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "").trim();
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--write") {
      options.writeArtifacts = true;
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--markdown") {
      options.asMarkdown = true;
      continue;
    }
    if (arg === "--skip-doctor") {
      options.includeDoctor = false;
      continue;
    }
    if (arg === "--skip-interaction-log") {
      options.includeInteractionLog = false;
      continue;
    }
    if (arg === "--no-append-history") {
      options.appendHistory = false;
      continue;
    }

    const next = argv[index + 1];
    if (!arg.startsWith("--")) continue;
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--window-hours") {
      const value = Number(next);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid --window-hours value: ${next}`);
      }
      options.windowHours = Math.max(1, Math.round(value));
      index += 1;
      continue;
    }
    if (arg === "--history") {
      options.historyPath = resolve(process.cwd(), String(next));
      index += 1;
      continue;
    }
    if (arg === "--toolcalls") {
      options.toolcallsPath = resolve(process.cwd(), String(next));
      index += 1;
      continue;
    }
    if (arg === "--lifecycle-memory") {
      options.lifecycleMemoryPath = resolve(process.cwd(), String(next));
      index += 1;
      continue;
    }
    if (arg === "--interaction-log") {
      options.interactionLogPath = resolve(process.cwd(), String(next));
      index += 1;
      continue;
    }
    if (arg === "--report-json") {
      options.reportJsonPath = resolve(process.cwd(), String(next));
      index += 1;
      continue;
    }
    if (arg === "--report-markdown") {
      options.reportMarkdownPath = resolve(process.cwd(), String(next));
      index += 1;
      continue;
    }
    if (arg === "--now") {
      options.nowIso = String(next).trim();
      index += 1;
    }
  }

  return options;
}

function clean(value) {
  return String(value ?? "").trim();
}

function nowDate(options) {
  if (!options.nowIso) return new Date();
  const parsed = new Date(options.nowIso);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid --now value: ${options.nowIso}`);
  }
  return parsed;
}

function toMs(value) {
  if (!value) return null;
  const parsed = new Date(value);
  const millis = parsed.getTime();
  return Number.isFinite(millis) ? millis : null;
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toNullableBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pct(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  return Number((value * 100).toFixed(digits));
}

function average(values) {
  const numeric = (values || []).filter((value) => Number.isFinite(value));
  if (numeric.length === 0) return null;
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
}

function percentile(values, p) {
  const numeric = (values || [])
    .filter((value) => Number.isFinite(value))
    .slice()
    .sort((left, right) => left - right);
  if (numeric.length === 0) return null;
  const rank = clamp(p, 0, 1) * (numeric.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return numeric[low];
  const weight = rank - low;
  return numeric[low] * (1 - weight) + numeric[high] * weight;
}

function letterGrade(score) {
  if (!Number.isFinite(score)) return "n/a";
  if (score >= 95) return "A";
  if (score >= 88) return "B";
  if (score >= 78) return "C";
  if (score >= 65) return "D";
  return "F";
}

function parseJsonOutput(raw) {
  const text = clean(raw);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace < firstBrace) return null;
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

async function readNdjson(path) {
  let raw = "";
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { entries: [], invalidLines: 0 };
  }

  const entries = [];
  let invalidLines = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      invalidLines += 1;
    }
  }
  return { entries, invalidLines };
}

async function readText(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function runNodeScript(relativePath, extraArgs = []) {
  const absolutePath = resolve(repoRoot, relativePath);
  const result = spawnSync(process.execPath, [absolutePath, ...extraArgs], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 12,
    env: process.env,
  });
  return {
    ok: result.status === 0,
    exitCode: result.status,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    json: parseJsonOutput(result.stdout),
    command: `node ${relativePath} ${extraArgs.join(" ")}`.trim(),
  };
}

function normalizeStartupSample(preflightPayload, generatedAtIso) {
  if (!preflightPayload || typeof preflightPayload !== "object") {
    return {
      tsIso: generatedAtIso,
      status: "fail",
      reasonCode: STARTUP_REASON_CODES.STARTUP_UNAVAILABLE,
      continuityState: "missing",
      itemCount: 0,
      contextSummary: "",
      groundingReady: false,
      richContext: false,
      fallbackOnly: false,
      studioBrainReachable: null,
      tokenState: "unknown",
      latencyMs: null,
      latencyState: "unknown",
      mcpBridgeOk: null,
      mcpBridgeLatencyMs: null,
      startupToolStatus: "unknown",
      groundingLineEmitted: null,
      groundingLineObserved: false,
      repoReadsBeforeStartupContext: null,
      repoReadTelemetryObserved: false,
      recoveryStep: "",
      error: "startup-preflight-json-missing",
    };
  }

  const startup = preflightPayload.checks?.startupContext || {};
  const reachability = preflightPayload.checks?.studioBrainReachability || {};
  const tokenFreshness = preflightPayload.checks?.tokenFreshness || {};
  const mcpBridge = preflightPayload.checks?.mcpBridge || null;
  const startupTelemetry =
    startup.telemetry && typeof startup.telemetry === "object"
      ? startup.telemetry
      : {};
  const tsIso = clean(preflightPayload.generatedAt) || generatedAtIso;
  const reasonCode = clean(startup.reasonCode || STARTUP_REASON_CODES.STARTUP_UNAVAILABLE);
  const continuityState = clean(startup.continuityState || "missing").toLowerCase();
  const itemCount = Math.max(0, Math.round(Number(startup.itemCount || 0)));
  const contextSummary = clean(startup.contextSummary).slice(0, 300);
  const latencyMs = toFiniteNumber(startup.latency?.latencyMs);
  const latencyState = clean(startup.latency?.state || "unknown");

  return {
    tsIso,
    status: clean(preflightPayload.status || "fail"),
    reasonCode,
    continuityState,
    itemCount,
    contextSummary,
    groundingReady: itemCount > 0 && contextSummary.length > 0,
    richContext: itemCount >= 2,
    fallbackOnly: reasonCode === STARTUP_REASON_CODES.OK && continuityState !== "ready",
    studioBrainReachable: typeof reachability.ok === "boolean" ? reachability.ok : null,
    studioBrainLatencyMs: toFiniteNumber(reachability.latencyMs),
    tokenState: clean(tokenFreshness.state || "unknown").toLowerCase(),
    latencyMs,
    latencyState,
    mcpBridgeOk: mcpBridge && typeof mcpBridge.ok === "boolean" ? mcpBridge.ok : null,
    mcpBridgeLatencyMs: toFiniteNumber(mcpBridge?.latencyMs),
    startupToolStatus: clean(startupTelemetry.toolStatus || "unknown").toLowerCase(),
    groundingLineEmitted: toNullableBoolean(startupTelemetry.groundingLineEmitted),
    groundingLineObserved: startupTelemetry.groundingLineObserved === true,
    repoReadsBeforeStartupContext: toFiniteNumber(startupTelemetry.repoReadsBeforeStartupContext),
    repoReadTelemetryObserved: startupTelemetry.repoReadTelemetryObserved === true,
    recoveryStep: clean(startup.recoveryStep),
    error: clean(startup.error),
  };
}

function extractDoctorSummary(doctorPayload) {
  if (!doctorPayload || typeof doctorPayload !== "object") return null;
  return {
    status: clean(doctorPayload.status || "unknown"),
    checks: Number(doctorPayload.summary?.checks || 0),
    errors: Number(doctorPayload.summary?.errors || 0),
    warnings: Number(doctorPayload.summary?.warnings || 0),
    infos: Number(doctorPayload.summary?.infos || 0),
  };
}

function normalizeHistoryEntries(entries) {
  return (entries || [])
    .map((entry) => {
      if (entry?.sample && typeof entry.sample === "object") {
        return entry.sample;
      }
      if (entry && typeof entry === "object" && entry.reasonCode) {
        return entry;
      }
      return null;
    })
    .filter(Boolean)
    .map((entry) => {
      const itemCount = Math.max(0, Math.round(Number(entry.itemCount || 0)));
      const contextSummary = clean(entry.contextSummary).slice(0, 300);
      const storedGroundingReady = toNullableBoolean(entry.groundingReady);
      const storedRichContext = toNullableBoolean(entry.richContext);

      return {
        tsIso: clean(entry.tsIso || entry.generatedAt),
        status: clean(entry.status || "fail"),
        reasonCode: clean(entry.reasonCode || STARTUP_REASON_CODES.STARTUP_UNAVAILABLE),
        continuityState: clean(entry.continuityState || "missing").toLowerCase(),
        itemCount,
        contextSummary,
        groundingReady:
          storedGroundingReady ?? (itemCount > 0 && contextSummary.length > 0),
        richContext: storedRichContext ?? itemCount >= 2,
        fallbackOnly:
          entry.fallbackOnly === true ||
          (clean(entry.reasonCode || STARTUP_REASON_CODES.STARTUP_UNAVAILABLE) === STARTUP_REASON_CODES.OK &&
            clean(entry.continuityState || "missing").toLowerCase() !== "ready"),
        studioBrainReachable:
          typeof entry.studioBrainReachable === "boolean" ? entry.studioBrainReachable : null,
        studioBrainLatencyMs: toFiniteNumber(entry.studioBrainLatencyMs),
        tokenState: clean(entry.tokenState || "unknown").toLowerCase(),
        latencyMs: toFiniteNumber(entry.latencyMs),
        latencyState: clean(entry.latencyState || "unknown"),
        mcpBridgeOk: typeof entry.mcpBridgeOk === "boolean" ? entry.mcpBridgeOk : null,
        mcpBridgeLatencyMs: toFiniteNumber(entry.mcpBridgeLatencyMs),
        startupToolStatus: clean(entry.startupToolStatus || "unknown").toLowerCase(),
        groundingLineEmitted: toNullableBoolean(entry.groundingLineEmitted),
        groundingLineObserved: entry.groundingLineObserved === true,
        repoReadsBeforeStartupContext: toFiniteNumber(entry.repoReadsBeforeStartupContext),
        repoReadTelemetryObserved: entry.repoReadTelemetryObserved === true,
        recoveryStep: clean(entry.recoveryStep),
        error: clean(entry.error),
      };
    })
    .filter((entry) => toMs(entry.tsIso) != null);
}

function scoreHigherBetter(value, target, floor = 0) {
  if (!Number.isFinite(value)) return null;
  if (value >= target) return 100;
  const denominator = Math.max(target - floor, Number.EPSILON);
  return Math.round(clamp((value - floor) / denominator, 0, 1) * 100);
}

function scoreLowerBetter(value, target, ceiling) {
  if (!Number.isFinite(value)) return null;
  if (value <= target) return 100;
  const denominator = Math.max(ceiling - target, Number.EPSILON);
  return Math.round((1 - clamp((value - target) / denominator, 0, 1)) * 100);
}

function summarizeCounts(values) {
  const counts = {};
  for (const value of values || []) {
    const key = clean(value) || "unknown";
    counts[key] = Number(counts[key] || 0) + 1;
  }
  return counts;
}

function getStartupTelemetry(entry) {
  const context = entry?.context && typeof entry.context === "object" ? entry.context : {};
  return context.startup && typeof context.startup === "object" ? context.startup : {};
}

function computeWindowMetrics(samples) {
  const total = samples.length;
  const latencies = samples.map((sample) => toFiniteNumber(sample.latencyMs)).filter(Number.isFinite);
  const tokenObservations = samples.filter((sample) => sample.tokenState && sample.tokenState !== "unknown");
  const bridgeObservations = samples.filter((sample) => typeof sample.mcpBridgeOk === "boolean");
  const reachabilityObservations = samples.filter((sample) => typeof sample.studioBrainReachable === "boolean");
  const countBy = (predicate) => samples.filter(predicate).length;

  return {
    sampleCount: total,
    passRate: total > 0 ? countBy((sample) => sample.status === "pass") / total : null,
    readyRate: total > 0 ? countBy((sample) => sample.continuityState === "ready") / total : null,
    groundingReadyRate: total > 0 ? countBy((sample) => sample.groundingReady) / total : null,
    richContextRate: total > 0 ? countBy((sample) => sample.richContext) / total : null,
    emptyContextRate:
      total > 0
        ? countBy(
            (sample) =>
              sample.reasonCode === STARTUP_REASON_CODES.EMPTY_CONTEXT || sample.continuityState === "missing"
          ) / total
        : null,
    blockedContinuityRate:
      total > 0
        ? countBy(
            (sample) => BLOCKED_REASON_CODES.has(sample.reasonCode) || sample.continuityState === "blocked"
          ) / total
        : null,
    fallbackOnlyRate: total > 0 ? countBy((sample) => sample.fallbackOnly) / total : null,
    tokenFreshRate:
      tokenObservations.length > 0
        ? tokenObservations.filter((sample) => sample.tokenState === "fresh" || sample.tokenState === "expiring")
            .length / tokenObservations.length
        : null,
    mcpBridgeFailureRate:
      bridgeObservations.length > 0
        ? bridgeObservations.filter((sample) => sample.mcpBridgeOk === false).length / bridgeObservations.length
        : null,
    reachabilityFailureRate:
      reachabilityObservations.length > 0
        ? reachabilityObservations.filter((sample) => sample.studioBrainReachable === false).length /
          reachabilityObservations.length
        : null,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    averageLatencyMs: average(latencies),
    healthyLatencyRate:
      total > 0 ? countBy((sample) => clean(sample.latencyState).toLowerCase() === "healthy") / total : null,
    reasonCodes: summarizeCounts(samples.map((sample) => sample.reasonCode)),
    continuityStates: summarizeCounts(samples.map((sample) => sample.continuityState)),
    tokenStates: summarizeCounts(samples.map((sample) => sample.tokenState)),
  };
}

function delta(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return Number((current - previous).toFixed(4));
}

function scoreDimension(label, score, target, actual, weight) {
  let status = "insufficient-data";
  if (Number.isFinite(score)) {
    status = score >= 90 ? "pass" : score >= 75 ? "warn" : "fail";
  }
  return { label, weight, score, target, actual, status };
}

function countRepeatFailureBursts(entries, windowMinutes = 15) {
  const failures = (entries || [])
    .filter((entry) => entry.ok === false)
    .map((entry) => ({
      ...entry,
      tsMs: toMs(entry.tsIso),
      signature: [
        clean(entry.tool),
        clean(entry.action),
        clean(entry.errorType),
        clean(entry.errorMessage).toLowerCase().slice(0, 120),
      ].join("|"),
    }))
    .filter((entry) => entry.tsMs != null)
    .sort((left, right) => left.tsMs - right.tsMs);

  const grouped = new Map();
  for (const entry of failures) {
    if (!grouped.has(entry.signature)) {
      grouped.set(entry.signature, []);
    }
    grouped.get(entry.signature).push(entry);
  }

  let bursts = 0;
  const details = [];
  for (const group of grouped.values()) {
    let currentBurst = [group[0]];
    for (let index = 1; index < group.length; index += 1) {
      const previous = group[index - 1];
      const current = group[index];
      if (current.tsMs - previous.tsMs <= windowMinutes * 60 * 1000) {
        currentBurst.push(current);
      } else {
        if (currentBurst.length >= 2) {
          bursts += 1;
          details.push({
            signature: currentBurst[0].signature,
            count: currentBurst.length,
            firstTsIso: currentBurst[0].tsIso,
            lastTsIso: currentBurst[currentBurst.length - 1].tsIso,
          });
        }
        currentBurst = [current];
      }
    }
    if (currentBurst.length >= 2) {
      bursts += 1;
      details.push({
        signature: currentBurst[0].signature,
        count: currentBurst.length,
        firstTsIso: currentBurst[0].tsIso,
        lastTsIso: currentBurst[currentBurst.length - 1].tsIso,
      });
    }
  }

  return {
    burstCount: bursts,
    details: details.slice(0, 6),
  };
}

function summarizeToolcallSignals(entries, startMs) {
  const inWindow = (entries || []).filter((entry) => {
    const tsMs = toMs(entry?.tsIso);
    return tsMs != null && tsMs >= startMs;
  });
  const startupCoverage = summarizeStartupObservationCoverage(inWindow);
  const isEligibleStartupSignal = (entry) => {
    const startupTelemetry = getStartupTelemetry(entry);
    return clean(entry?.action).startsWith("startup") || Object.keys(startupTelemetry).length > 0;
  };
  const startupEntries = startupCoverage.uniqueEntries.filter((entry) => {
    return isEligibleStartupSignal(entry);
  });
  const liveStartupEntries = startupCoverage.uniqueLiveEntries.filter((entry) => {
    return isEligibleStartupSignal(entry);
  });
  const failures = startupEntries.filter((entry) => entry.ok === false);
  const repeat = countRepeatFailureBursts(startupEntries);
  const groundingObservations = startupEntries.filter((entry) => typeof getStartupTelemetry(entry).groundingLineEmitted === "boolean");
  const repoReadObservations = startupEntries.filter((entry) =>
    Number.isFinite(Number(getStartupTelemetry(entry).repoReadsBeforeStartupContext))
  );
  const fullyObservedEntries = startupEntries.filter((entry) => {
    const startupTelemetry = getStartupTelemetry(entry);
    return (
      typeof startupTelemetry.groundingLineEmitted === "boolean" &&
      Number.isFinite(Number(startupTelemetry.repoReadsBeforeStartupContext))
    );
  });

  return {
    totalEntries: inWindow.length,
    startupEntries: startupEntries.length,
    liveStartupEntries: liveStartupEntries.length,
    rawStartupEntries: startupCoverage.rawStartupEntries,
    liveRawRows: startupCoverage.liveRawRows,
    syntheticRawRows: startupCoverage.syntheticRawRows,
    duplicateObservationCount: startupCoverage.duplicateObservationCount,
    startupFailures: failures.length,
    startupFailureRate: startupEntries.length > 0 ? failures.length / startupEntries.length : null,
    startupToolStatusCounts: summarizeCounts(
      startupEntries.map((entry) => clean(getStartupTelemetry(entry).startupToolStatus || "unknown"))
    ),
    groundingObservedEntries: groundingObservations.length,
    groundingLineComplianceRate:
      groundingObservations.length > 0
        ? groundingObservations.filter((entry) => getStartupTelemetry(entry).groundingLineEmitted === true).length /
          groundingObservations.length
        : null,
    preStartupRepoReadObservedEntries: repoReadObservations.length,
    averagePreStartupRepoReads: average(
      repoReadObservations.map((entry) => Number(getStartupTelemetry(entry).repoReadsBeforeStartupContext))
    ),
    preStartupRepoReadFreeRate:
      repoReadObservations.length > 0
        ? repoReadObservations.filter((entry) => Number(getStartupTelemetry(entry).repoReadsBeforeStartupContext) <= 0)
            .length / repoReadObservations.length
        : null,
    telemetryCoverageRate:
      startupEntries.length > 0 ? fullyObservedEntries.length / startupEntries.length : null,
    repeatFailureBursts: repeat.burstCount,
    repeatFailureBurstDetails: repeat.details,
  };
}

export function parseInteractionLog(raw) {
  const source = String(raw || "");
  if (!source.trim()) return [];
  const blocks = source.split(/^##\s+/m).slice(1);
  const entries = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const header = clean(lines[0]);
    const match = header.match(/^(\d{4}-\d{2}-\d{2})\s+\((AM|PM)\)$/i);
    if (!match) continue;
    const hour = match[2].toUpperCase() === "AM" ? "09" : "15";
    const tsIso = new Date(`${match[1]}T${hour}:00:00-07:00`).toISOString();
    const clarificationLoopsMatch = block.match(/Clarification loops detected:\s*(\d+)/i);
    const clarificationLoops = clarificationLoopsMatch ? Number(clarificationLoopsMatch[1]) : 0;

    const frictionSection = block.match(
      /### Friction Patterns\s+([\s\S]*?)(?:\n### |\n## |\s*$)/i
    );
    const frictionPatterns = frictionSection
      ? frictionSection[1]
          .split(/\r?\n/)
          .map((line) => clean(line.replace(/^-+\s*/, "")))
          .filter(Boolean)
          .filter((line) => !/^none crossed thresholds/i.test(line))
      : [];

    entries.push({
      tsIso,
      clarificationLoops,
      frictionPatterns,
    });
  }

  return entries;
}

export function parseInteractionLifecycleEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) => clean(entry?.tool) === "daily-interaction" && clean(entry?.event) === "run-summary")
    .map((entry) => {
      const metrics = entry?.metrics && typeof entry.metrics === "object" ? entry.metrics : {};
      const metadata = entry?.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
      const recommendationTitles = Array.isArray(metadata.recommendationTitles)
        ? metadata.recommendationTitles
        : Array.isArray(metrics.recommendationTitles)
          ? metrics.recommendationTitles
          : [];
      const clarificationLoops = Number(
        metrics.clarificationLoopsDetected ??
          metrics.clarificationLoops ??
          metadata.clarificationLoopsDetected ??
          0
      );
      return {
        tsIso: clean(entry?.tsIso || entry?.occurredAt),
        clarificationLoops: Number.isFinite(clarificationLoops) ? clarificationLoops : 0,
        frictionPatterns: recommendationTitles.map((value) => clean(value)).filter(Boolean),
      };
    })
    .filter((entry) => toMs(entry.tsIso) != null);
}

function summarizeInteractionSignals(entries, startMs) {
  const inWindow = (entries || []).filter((entry) => {
    const tsMs = toMs(entry.tsIso);
    return tsMs != null && tsMs >= startMs;
  });

  return {
    entries: inWindow.length,
    averageClarificationLoops: average(inWindow.map((entry) => entry.clarificationLoops)),
    maxClarificationLoops:
      inWindow.length > 0 ? Math.max(...inWindow.map((entry) => Number(entry.clarificationLoops || 0))) : null,
    retryLoopMentions: inWindow.filter((entry) =>
      (entry.frictionPatterns || []).some((pattern) => /retry/i.test(pattern))
    ).length,
  };
}

function buildCoverageGaps({ currentMetrics, previousMetrics, toolcallSignals, interactionSignals }) {
  const gaps = [];
  if (currentMetrics.sampleCount < 3) {
    gaps.push("Startup baseline is still thin; fewer than 3 samples exist in the current analysis window.");
  }
  if (toolcallSignals.liveStartupEntries < REQUIRED_LIVE_STARTUP_SAMPLES) {
    gaps.push(
      `Live launcher startup coverage is still thin; ${toolcallSignals.liveStartupEntries}/${REQUIRED_LIVE_STARTUP_SAMPLES} startup toolcall sample(s) are available.`
    );
  }
  if (previousMetrics.sampleCount === 0) {
    gaps.push("No previous-window samples exist yet, so trend deltas are provisional.");
  }
  if (toolcallSignals.liveStartupEntries === 0) {
    gaps.push("Launcher-level startup toolcall telemetry is absent; this report relies on scorecard history samples instead.");
  }
  if (interactionSignals.entries === 0) {
    gaps.push(
      "No lifecycle-memory or interaction-log entries fell inside the selected window, so clarification and retry friction signals are incomplete."
    );
  }
  if (toolcallSignals.groundingObservedEntries === 0) {
    gaps.push("First-answer Grounding line compliance is not yet directly instrumented from real thread transcripts.");
  }
  if (toolcallSignals.preStartupRepoReadObservedEntries === 0) {
    gaps.push("Irrelevant repo reads before the first target file are not yet captured in repo-local telemetry.");
  }
  if (
    Number.isFinite(toolcallSignals.telemetryCoverageRate) &&
    toolcallSignals.telemetryCoverageRate > 0 &&
    toolcallSignals.telemetryCoverageRate < 1
  ) {
    gaps.push(
      `Startup transcript telemetry is only partially captured; ${pct(toolcallSignals.telemetryCoverageRate) ?? 0}% of startup entries carried both Grounding and repo-read signals.`
    );
  }
  return gaps;
}

function buildRecommendations({ latestSample, currentMetrics, toolcallSignals, interactionSignals, coverageGaps }) {
  const recommendations = [];
  if (latestSample.status !== "pass" || BLOCKED_REASON_CODES.has(latestSample.reasonCode)) {
    recommendations.push(
      `Restore startup auth/transport health first; latest sample is ${latestSample.reasonCode || "unavailable"}.`
    );
  }
  if (Number.isFinite(currentMetrics.readyRate) && currentMetrics.readyRate < TARGETS.readyRateMin) {
    recommendations.push("Increase end-of-thread handoff/checkpoint writes so trusted startup continuity is ready more often.");
  }
  if (Number.isFinite(currentMetrics.emptyContextRate) && currentMetrics.emptyContextRate > TARGETS.emptyContextRateMax) {
    recommendations.push("Reduce empty-context starts by capturing durable blockers, current goals, and next actions in Studio Brain.");
  }
  if (Number.isFinite(currentMetrics.p95LatencyMs) && currentMetrics.p95LatencyMs > TARGETS.p95LatencyMsMax) {
    recommendations.push("Inspect Studio Brain latency and trim startup retrieval scope before adding more repo bootstrap text.");
  }
  if (toolcallSignals.repeatFailureBursts > 0 || interactionSignals.retryLoopMentions > 0) {
    recommendations.push("Review retry hygiene; repeated startup failure signatures are still appearing in the supporting telemetry.");
  }
  if (toolcallSignals.liveStartupEntries < REQUIRED_LIVE_STARTUP_SAMPLES) {
    recommendations.push(
      `Collect at least ${REQUIRED_LIVE_STARTUP_SAMPLES} live launcher startup samples before treating startup quality as trustworthy.`
    );
  }
  if (
    Number.isFinite(toolcallSignals.groundingLineComplianceRate) &&
    toolcallSignals.groundingLineComplianceRate < TARGETS.groundingReadyRateMin
  ) {
    recommendations.push("Tighten first-answer Grounding line compliance so startup continuity is visible before repo work fans out.");
  }
  if (
    Number.isFinite(toolcallSignals.averagePreStartupRepoReads) &&
    toolcallSignals.averagePreStartupRepoReads > 0
  ) {
    recommendations.push("Trim repo reads before startup continuity; the observed average is above zero in captured startup transcripts.");
  }
  if (coverageGaps.some((gap) => gap.includes("Grounding line compliance"))) {
    recommendations.push("Add transcript-level startup instrumentation if you want to score real Grounding-line compliance instead of repo proxies.");
  }
  if (recommendations.length === 0) {
    recommendations.push("Startup quality is within the current thresholds; keep collecting history so future regressions are easier to spot.");
  }
  return recommendations;
}

export function computeStartupScorecardReport({
  generatedAtIso,
  windowHours,
  latestSample,
  historySamples,
  toolcallEntries,
  interactionEntries,
  latestDoctorSummary = null,
  historyInvalidLines = 0,
  toolcallInvalidLines = 0,
  lifecycleInvalidLines = 0,
  historyPath = DEFAULT_HISTORY_PATH,
  toolcallsPath = DEFAULT_TOOLCALLS_PATH,
  lifecycleMemoryPath = DEFAULT_LIFECYCLE_MEMORY_PATH,
  interactionLogPath = DEFAULT_INTERACTION_LOG_PATH,
  interactionSignalSource = "interaction-log",
} = {}) {
  const nowMs = toMs(generatedAtIso);
  if (nowMs == null) {
    throw new Error("computeStartupScorecardReport requires a valid generatedAtIso.");
  }

  const normalizedHistory = normalizeHistoryEntries(historySamples || []);
  const normalizedLatest =
    latestSample && latestSample.reasonCode ? normalizeHistoryEntries([latestSample])[0] : latestSample;
  if (!normalizedLatest || toMs(normalizedLatest.tsIso) == null) {
    throw new Error("computeStartupScorecardReport requires a valid latestSample.");
  }

  const effectiveNowMs = Math.max(nowMs, toMs(normalizedLatest.tsIso) || nowMs);
  const allSamples = [...normalizedHistory, normalizedLatest].sort((left, right) => toMs(left.tsIso) - toMs(right.tsIso));
  const currentStartMs = effectiveNowMs - windowHours * 60 * 60 * 1000;
  const previousStartMs = currentStartMs - windowHours * 60 * 60 * 1000;
  const currentSamples = allSamples.filter((sample) => {
    const tsMs = toMs(sample.tsIso);
    return tsMs != null && tsMs >= currentStartMs && tsMs <= effectiveNowMs;
  });
  const previousSamples = normalizedHistory.filter((sample) => {
    const tsMs = toMs(sample.tsIso);
    return tsMs != null && tsMs >= previousStartMs && tsMs < currentStartMs;
  });

  const currentMetrics = computeWindowMetrics(currentSamples);
  const previousMetrics = computeWindowMetrics(previousSamples);
  const toolcallSignals = summarizeToolcallSignals(toolcallEntries || [], currentStartMs);
  const interactionSignals = summarizeInteractionSignals(interactionEntries || [], currentStartMs);
  const coverageGaps = buildCoverageGaps({
    currentMetrics,
    previousMetrics,
    toolcallSignals,
    interactionSignals,
  });

  const reliabilityScore = average([
    scoreHigherBetter(currentMetrics.passRate, TARGETS.passRateMin, 0.6),
    scoreLowerBetter(currentMetrics.blockedContinuityRate, TARGETS.blockedContinuityRateMax, 0.3),
  ]);
  const continuityScore = average([
    scoreHigherBetter(currentMetrics.readyRate, TARGETS.readyRateMin, 0.35),
    scoreHigherBetter(currentMetrics.groundingReadyRate, TARGETS.groundingReadyRateMin, 0.35),
    scoreLowerBetter(currentMetrics.emptyContextRate, TARGETS.emptyContextRateMax, 0.3),
    scoreHigherBetter(currentMetrics.richContextRate, TARGETS.richContextRateMin, 0.2),
  ]);
  const latencyScore = average([
    scoreLowerBetter(currentMetrics.p50LatencyMs, TARGETS.p50LatencyMsMax, 5000),
    scoreLowerBetter(currentMetrics.p95LatencyMs, TARGETS.p95LatencyMsMax, 9000),
  ]);
  const supportScore = average([
    scoreHigherBetter(currentMetrics.tokenFreshRate, TARGETS.tokenFreshRateMin, 0.3),
    scoreLowerBetter(currentMetrics.mcpBridgeFailureRate, TARGETS.mcpBridgeFailureRateMax, 0.5),
  ]);

  const weightedDimensions = [
    scoreDimension(
      "Reliability",
      reliabilityScore,
      `passRate >= ${pct(TARGETS.passRateMin)}%, blockedRate <= ${pct(TARGETS.blockedContinuityRateMax)}%`,
      `passRate ${pct(currentMetrics.passRate) ?? "n/a"}%, blockedRate ${pct(currentMetrics.blockedContinuityRate) ?? "n/a"}%`,
      0.35
    ),
    scoreDimension(
      "Continuity",
      continuityScore,
      `readyRate >= ${pct(TARGETS.readyRateMin)}%, groundingRate >= ${pct(TARGETS.groundingReadyRateMin)}%`,
      `readyRate ${pct(currentMetrics.readyRate) ?? "n/a"}%, groundingRate ${pct(currentMetrics.groundingReadyRate) ?? "n/a"}%`,
      0.35
    ),
    scoreDimension(
      "Latency",
      latencyScore,
      `p50 <= ${TARGETS.p50LatencyMsMax}ms, p95 <= ${TARGETS.p95LatencyMsMax}ms`,
      `p50 ${currentMetrics.p50LatencyMs == null ? "n/a" : Math.round(currentMetrics.p50LatencyMs)}ms, p95 ${
        currentMetrics.p95LatencyMs == null ? "n/a" : Math.round(currentMetrics.p95LatencyMs)
      }ms`,
      0.2
    ),
    scoreDimension(
      "Support",
      supportScore,
      `tokenFresh >= ${pct(TARGETS.tokenFreshRateMin)}%, mcpBridgeFailure <= ${pct(TARGETS.mcpBridgeFailureRateMax)}%`,
      `tokenFresh ${pct(currentMetrics.tokenFreshRate) ?? "n/a"}%, mcpBridgeFailure ${
        pct(currentMetrics.mcpBridgeFailureRate) ?? "n/a"
      }%`,
      0.1
    ),
  ];

  const weightedScores = weightedDimensions.filter((dimension) => Number.isFinite(dimension.score));
  const overallScore =
    weightedScores.length > 0
      ? Math.round(
          weightedScores.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0) /
            weightedScores.reduce((sum, dimension) => sum + dimension.weight, 0)
        )
      : null;

  const recommendations = buildRecommendations({
    latestSample: normalizedLatest,
    currentMetrics,
    toolcallSignals,
    interactionSignals,
    coverageGaps,
  });

  return {
    schema: "codex-startup-scorecard.v1",
    generatedAtIso,
    windowHours,
    targets: TARGETS,
    latest: {
      sample: normalizedLatest,
      doctor: latestDoctorSummary,
    },
    window: {
      current: {
        sampleCount: currentMetrics.sampleCount,
        startIso: new Date(currentStartMs).toISOString(),
        endIso: new Date(effectiveNowMs).toISOString(),
      },
      previous: {
        sampleCount: previousMetrics.sampleCount,
        startIso: new Date(previousStartMs).toISOString(),
        endIso: new Date(currentStartMs).toISOString(),
      },
    },
    metrics: {
      passRate: currentMetrics.passRate,
      readyRate: currentMetrics.readyRate,
      groundingReadyRate: currentMetrics.groundingReadyRate,
      richContextRate: currentMetrics.richContextRate,
      emptyContextRate: currentMetrics.emptyContextRate,
      blockedContinuityRate: currentMetrics.blockedContinuityRate,
      fallbackOnlyRate: currentMetrics.fallbackOnlyRate,
      tokenFreshRate: currentMetrics.tokenFreshRate,
      mcpBridgeFailureRate: currentMetrics.mcpBridgeFailureRate,
      reachabilityFailureRate: currentMetrics.reachabilityFailureRate,
      averageLatencyMs: currentMetrics.averageLatencyMs,
      p50LatencyMs: currentMetrics.p50LatencyMs,
      p95LatencyMs: currentMetrics.p95LatencyMs,
      healthyLatencyRate: currentMetrics.healthyLatencyRate,
      reasonCodes: currentMetrics.reasonCodes,
      continuityStates: currentMetrics.continuityStates,
      tokenStates: currentMetrics.tokenStates,
    },
    trends: {
      passRateDelta: delta(currentMetrics.passRate, previousMetrics.passRate),
      readyRateDelta: delta(currentMetrics.readyRate, previousMetrics.readyRate),
      groundingReadyRateDelta: delta(currentMetrics.groundingReadyRate, previousMetrics.groundingReadyRate),
      emptyContextRateDelta: delta(currentMetrics.emptyContextRate, previousMetrics.emptyContextRate),
      blockedContinuityRateDelta: delta(currentMetrics.blockedContinuityRate, previousMetrics.blockedContinuityRate),
      p95LatencyMsDelta: delta(currentMetrics.p95LatencyMs, previousMetrics.p95LatencyMs),
    },
    supportingSignals: {
      toolcalls: toolcallSignals,
      interactionLog: {
        source: interactionSignalSource,
        ...interactionSignals,
      },
    },
    launcherCoverage: {
      liveStartupSamples: toolcallSignals.liveStartupEntries,
      requiredLiveStartupSamples: REQUIRED_LIVE_STARTUP_SAMPLES,
      trustworthy: toolcallSignals.liveStartupEntries >= REQUIRED_LIVE_STARTUP_SAMPLES,
    },
    rubric: {
      dimensions: weightedDimensions,
      overallScore,
      grade: letterGrade(overallScore),
    },
    coverage: {
      historySamplesAvailable: normalizedHistory.length,
      historyInvalidLines,
      toolcallInvalidLines,
      lifecycleInvalidLines,
      historyPath: relative(repoRoot, historyPath),
      toolcallsPath: relative(repoRoot, toolcallsPath),
      lifecycleMemoryPath: relative(repoRoot, lifecycleMemoryPath),
      interactionLogPath: relative(repoRoot, interactionLogPath),
      interactionSignalSource,
      gaps: coverageGaps,
    },
    recommendations,
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Codex Startup Scorecard");
  lines.push("");
  lines.push(`- Generated at: ${report.generatedAtIso}`);
  lines.push(`- Window: last ${report.windowHours}h`);
  lines.push(`- Overall score: ${report.rubric.overallScore == null ? "n/a" : report.rubric.overallScore} (${report.rubric.grade})`);
  lines.push(`- Current samples: ${report.window.current.sampleCount}`);
  lines.push(`- Previous samples: ${report.window.previous.sampleCount}`);
  lines.push(`- Live startup coverage: ${report.launcherCoverage.liveStartupSamples}/${report.launcherCoverage.requiredLiveStartupSamples} (${report.launcherCoverage.trustworthy ? "trustworthy" : "provisional"})`);
  lines.push("");
  lines.push("## Latest Startup");
  lines.push(`- Status: ${report.latest.sample.status}`);
  lines.push(`- Reason code: ${report.latest.sample.reasonCode}`);
  lines.push(`- Continuity state: ${report.latest.sample.continuityState}`);
  lines.push(`- Item count: ${report.latest.sample.itemCount}`);
  lines.push(`- Context summary: ${report.latest.sample.contextSummary || "n/a"}`);
  lines.push(`- Latency: ${report.latest.sample.latencyMs == null ? "n/a" : `${Math.round(report.latest.sample.latencyMs)}ms`} (${report.latest.sample.latencyState})`);
  lines.push(`- Recovery step: ${report.latest.sample.recoveryStep || "n/a"}`);
  if (report.latest.doctor) {
    lines.push(
      `- Doctor: ${report.latest.doctor.status} (${report.latest.doctor.errors} errors, ${report.latest.doctor.warnings} warnings)`
    );
  }
  lines.push("");
  lines.push("## Key Metrics");
  lines.push(`- Pass rate: ${pct(report.metrics.passRate) ?? "n/a"}%`);
  lines.push(`- Continuity ready rate: ${pct(report.metrics.readyRate) ?? "n/a"}%`);
  lines.push(`- Grounding-ready rate: ${pct(report.metrics.groundingReadyRate) ?? "n/a"}%`);
  lines.push(`- Empty-context rate: ${pct(report.metrics.emptyContextRate) ?? "n/a"}%`);
  lines.push(`- Blocked-continuity rate: ${pct(report.metrics.blockedContinuityRate) ?? "n/a"}%`);
  lines.push(`- Rich-context rate: ${pct(report.metrics.richContextRate) ?? "n/a"}%`);
  lines.push(`- p50 latency: ${report.metrics.p50LatencyMs == null ? "n/a" : Math.round(report.metrics.p50LatencyMs)}ms`);
  lines.push(`- p95 latency: ${report.metrics.p95LatencyMs == null ? "n/a" : Math.round(report.metrics.p95LatencyMs)}ms`);
  lines.push(`- Token fresh rate: ${pct(report.metrics.tokenFreshRate) ?? "n/a"}%`);
  lines.push(`- MCP bridge failure rate: ${pct(report.metrics.mcpBridgeFailureRate) ?? "n/a"}%`);
  lines.push("");
  lines.push("## Trend Deltas");
  lines.push(`- Pass rate delta: ${pct(report.trends.passRateDelta) ?? "n/a"}%`);
  lines.push(`- Ready rate delta: ${pct(report.trends.readyRateDelta) ?? "n/a"}%`);
  lines.push(`- Grounding-ready delta: ${pct(report.trends.groundingReadyRateDelta) ?? "n/a"}%`);
  lines.push(`- Empty-context delta: ${pct(report.trends.emptyContextRateDelta) ?? "n/a"}%`);
  lines.push(`- Blocked-continuity delta: ${pct(report.trends.blockedContinuityRateDelta) ?? "n/a"}%`);
  lines.push(`- p95 latency delta: ${report.trends.p95LatencyMsDelta == null ? "n/a" : `${Math.round(report.trends.p95LatencyMsDelta)}ms`}`);
  lines.push("");
  lines.push("## Recommended Actions");
  report.recommendations.forEach((recommendation) => lines.push(`- ${recommendation}`));
  lines.push("");
  lines.push("## Coverage Gaps");
  report.coverage.gaps.forEach((gap) => lines.push(`- ${gap}`));
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function writeArtifacts(options, report, markdown) {
  await mkdir(dirname(options.reportJsonPath), { recursive: true });
  await mkdir(dirname(options.reportMarkdownPath), { recursive: true });
  await writeFile(options.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(options.reportMarkdownPath, markdown, "utf8");
}

async function appendHistoryEntry(historyPath, latestSample, latestDoctorSummary, generatedAtIso) {
  await mkdir(dirname(historyPath), { recursive: true });
  const payload = {
    schema: "codex-startup-scorecard-history.v1",
    tsIso: generatedAtIso,
    sample: latestSample,
    doctor: latestDoctorSummary,
  };
  await appendFile(historyPath, `${JSON.stringify(payload)}\n`, "utf8");
}

function enforceStrictMode(report) {
  if (report.window.current.sampleCount === 0) {
    throw new Error("Strict mode failed: no startup samples in the selected window.");
  }
  if (report.latest.sample.status !== "pass") {
    throw new Error(`Strict mode failed: latest startup sample status is ${report.latest.sample.status}.`);
  }
  if (Number.isFinite(report.metrics.passRate) && report.metrics.passRate < 0.9) {
    throw new Error(`Strict mode failed: pass rate ${pct(report.metrics.passRate)}% is below 90%.`);
  }
  if (Number.isFinite(report.metrics.groundingReadyRate) && report.metrics.groundingReadyRate < 0.8) {
    throw new Error(
      `Strict mode failed: grounding-ready rate ${pct(report.metrics.groundingReadyRate)}% is below 80%.`
    );
  }
  if (Number.isFinite(report.metrics.blockedContinuityRate) && report.metrics.blockedContinuityRate > 0.1) {
    throw new Error(
      `Strict mode failed: blocked-continuity rate ${pct(report.metrics.blockedContinuityRate)}% exceeds 10%.`
    );
  }
  if (Number.isFinite(report.metrics.p95LatencyMs) && report.metrics.p95LatencyMs > TARGETS.p95LatencyMsMax) {
    throw new Error(
      `Strict mode failed: p95 latency ${Math.round(report.metrics.p95LatencyMs)}ms exceeds ${TARGETS.p95LatencyMsMax}ms.`
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const now = nowDate(options);
  const generatedAtIso = now.toISOString();
  const preflightRun = runNodeScript("scripts/codex-startup-preflight.mjs", ["--json"]);
  const latestSample = normalizeStartupSample(preflightRun.json, generatedAtIso);

  const doctorRun = options.includeDoctor ? runNodeScript("scripts/codex-doctor.mjs", ["--json"]) : null;
  const latestDoctorSummary = extractDoctorSummary(doctorRun?.json);

  const historyData = await readNdjson(options.historyPath);
  const toolcallData = await readNdjson(options.toolcallsPath);
  const lifecycleData = await readNdjson(options.lifecycleMemoryPath);
  const lifecycleInteractionEntries = parseInteractionLifecycleEntries(lifecycleData.entries);
  const interactionLogRaw = options.includeInteractionLog ? await readText(options.interactionLogPath) : "";
  const interactionLogEntries = options.includeInteractionLog ? parseInteractionLog(interactionLogRaw) : [];
  const interactionEntries = lifecycleInteractionEntries.length > 0 ? lifecycleInteractionEntries : interactionLogEntries;
  const interactionSignalSource =
    lifecycleInteractionEntries.length > 0 ? "lifecycle-memory" : options.includeInteractionLog ? "interaction-log" : "disabled";

  const report = computeStartupScorecardReport({
    generatedAtIso,
    windowHours: options.windowHours,
    latestSample,
    historySamples: historyData.entries,
    toolcallEntries: toolcallData.entries,
    interactionEntries,
    latestDoctorSummary,
    historyInvalidLines: historyData.invalidLines,
    toolcallInvalidLines: toolcallData.invalidLines,
    lifecycleInvalidLines: lifecycleData.invalidLines,
    historyPath: options.historyPath,
    toolcallsPath: options.toolcallsPath,
    lifecycleMemoryPath: options.lifecycleMemoryPath,
    interactionLogPath: options.interactionLogPath,
    interactionSignalSource,
  });

  const markdown = buildMarkdown(report);

  if (options.appendHistory) {
    await appendHistoryEntry(options.historyPath, latestSample, latestDoctorSummary, generatedAtIso);
  }

  if (options.strict) {
    enforceStrictMode(report);
  }
  if (options.writeArtifacts) {
    await writeArtifacts(options, report, markdown);
  }

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  if (options.asMarkdown) {
    process.stdout.write(markdown);
    return;
  }

  process.stdout.write(
    [
      `overallScore: ${report.rubric.overallScore == null ? "n/a" : report.rubric.overallScore}`,
      `grade: ${report.rubric.grade}`,
      `latestReason: ${report.latest.sample.reasonCode}`,
      `passRate: ${pct(report.metrics.passRate) ?? "n/a"}%`,
      `readyRate: ${pct(report.metrics.readyRate) ?? "n/a"}%`,
      "",
    ].join("\n")
  );
}

const isMain = process.argv[1] && resolve(process.argv[1]) === __filename;

if (isMain) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`startup-scorecard failed: ${message}`);
    process.exit(1);
  });
}
