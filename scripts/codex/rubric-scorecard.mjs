#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..", "..");

const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_OUTPUT_DIR = resolve(repoRoot, "output", "qa");
const DEFAULT_REPORT_JSON = resolve(DEFAULT_OUTPUT_DIR, "codex-agentic-rubric-scorecard.json");
const DEFAULT_REPORT_MARKDOWN = resolve(DEFAULT_OUTPUT_DIR, "codex-agentic-rubric-scorecard.md");

const toolcallPathDefault = resolve(repoRoot, ".codex", "toolcalls.ndjson");
const statePathDefault = resolve(repoRoot, ".codex", "improvement-state.json");

const rubricTargets = {
  reliability: {
    successRateMin: 0.97,
    repeatFailureBurstsMax: 2,
    invalidLinesMax: 0,
  },
  speed: {
    p95DurationMsMax: 8000,
    mttrMinutesMax: 30,
    p50DurationMsMax: 3000,
  },
  efficiency: {
    tokensPerSuccessMax: 3000,
    tokenCoverageMin: 0.7,
    successesPer1kTokensMin: 0.2,
  },
  throughput: {
    successfulCallsPerHourMin: 0.25,
  },
  quality: {
    impactScoreMin: 85,
    recommendationClosureRateMin: 0.75,
    prHealthMin: 90,
  },
};

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  node ./scripts/codex/rubric-scorecard.mjs [options]",
      "",
      "Options:",
      "  --window-hours <n>          Hours to analyze (default: 24)",
      "  --toolcalls <path>          NDJSON toolcall log path",
      "  --state <path>              improvement-state JSON path",
      "  --report-json <path>        Output JSON report path (with --write)",
      "  --report-markdown <path>    Output markdown report path (with --write)",
      "  --now <iso>                 Override current time",
      "  --write                     Write report files",
      "  --strict                    Fail when telemetry coverage is insufficient",
      "  --json                      Print JSON to stdout",
      "  --markdown                  Print markdown to stdout",
      "  -h, --help                  Show this help",
      "",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const options = {
    windowHours: DEFAULT_WINDOW_HOURS,
    toolcallsPath: toolcallPathDefault,
    statePath: statePathDefault,
    reportJsonPath: DEFAULT_REPORT_JSON,
    reportMarkdownPath: DEFAULT_REPORT_MARKDOWN,
    nowIso: "",
    writeArtifacts: false,
    strict: false,
    asJson: false,
    asMarkdown: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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

    if (arg === "--toolcalls") {
      options.toolcallsPath = resolve(process.cwd(), String(next));
      index += 1;
      continue;
    }

    if (arg === "--state") {
      options.statePath = resolve(process.cwd(), String(next));
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
      continue;
    }
  }

  return options;
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function toNonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed);
}

function pct(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  return Number((value * 100).toFixed(digits));
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const numeric = values.filter((value) => Number.isFinite(value));
  if (numeric.length === 0) return null;
  const sum = numeric.reduce((acc, value) => acc + value, 0);
  return sum / numeric.length;
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .slice()
    .sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const rank = clamp(p, 0, 1) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  const weight = rank - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
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

async function readJson(path, fallback) {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function firstNumberFromObject(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    if (!(key in obj)) continue;
    const parsed = toNonNegativeInteger(obj[key]);
    if (parsed != null) return parsed;
  }
  return null;
}

function extractUsage(entry) {
  const candidates = [
    entry?.usage,
    entry?.tokenUsage,
    entry?.context?.usage,
    entry?.context?.tokenUsage,
  ].filter((value) => value && typeof value === "object");

  const root = entry && typeof entry === "object" ? entry : {};
  const context = root.context && typeof root.context === "object" ? root.context : {};

  const inputKeys = ["inputTokens", "promptTokens", "prompt_tokens", "tokensIn", "input_tokens"];
  const outputKeys = ["outputTokens", "completionTokens", "completion_tokens", "tokensOut", "output_tokens"];
  const reasoningKeys = ["reasoningTokens", "reasoning_tokens", "tokensReasoning", "reasoning"];
  const cacheReadKeys = ["cacheReadTokens", "cache_read_tokens", "cachedTokensRead", "cacheRead"];
  const cacheWriteKeys = ["cacheWriteTokens", "cache_write_tokens", "cachedTokensWrite", "cacheWrite"];
  const totalKeys = ["totalTokens", "total_tokens", "tokensTotal", "total"];

  let inputTokens = null;
  let outputTokens = null;
  let reasoningTokens = null;
  let cacheReadTokens = null;
  let cacheWriteTokens = null;
  let totalTokens = null;

  for (const candidate of candidates) {
    inputTokens = inputTokens ?? firstNumberFromObject(candidate, inputKeys);
    outputTokens = outputTokens ?? firstNumberFromObject(candidate, outputKeys);
    reasoningTokens = reasoningTokens ?? firstNumberFromObject(candidate, reasoningKeys);
    cacheReadTokens = cacheReadTokens ?? firstNumberFromObject(candidate, cacheReadKeys);
    cacheWriteTokens = cacheWriteTokens ?? firstNumberFromObject(candidate, cacheWriteKeys);
    totalTokens = totalTokens ?? firstNumberFromObject(candidate, totalKeys);
  }

  inputTokens = inputTokens ?? firstNumberFromObject(root, inputKeys) ?? firstNumberFromObject(context, inputKeys);
  outputTokens = outputTokens ?? firstNumberFromObject(root, outputKeys) ?? firstNumberFromObject(context, outputKeys);
  reasoningTokens =
    reasoningTokens ?? firstNumberFromObject(root, reasoningKeys) ?? firstNumberFromObject(context, reasoningKeys);
  cacheReadTokens =
    cacheReadTokens ?? firstNumberFromObject(root, cacheReadKeys) ?? firstNumberFromObject(context, cacheReadKeys);
  cacheWriteTokens =
    cacheWriteTokens ?? firstNumberFromObject(root, cacheWriteKeys) ?? firstNumberFromObject(context, cacheWriteKeys);
  totalTokens = totalTokens ?? firstNumberFromObject(root, totalKeys) ?? firstNumberFromObject(context, totalKeys);

  if (totalTokens == null) {
    const sum = [inputTokens, outputTokens, reasoningTokens, cacheWriteTokens]
      .filter((value) => value != null)
      .reduce((acc, value) => acc + Number(value || 0), 0);
    totalTokens = sum > 0 ? sum : null;
  }

  const hasAny =
    inputTokens != null ||
    outputTokens != null ||
    reasoningTokens != null ||
    cacheReadTokens != null ||
    cacheWriteTokens != null ||
    totalTokens != null;

  return hasAny
    ? {
        inputTokens,
        outputTokens,
        reasoningTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens,
      }
    : null;
}

function normalizeToolcallEntry(entry) {
  const tsMs = toMs(entry?.tsIso);
  if (tsMs == null) return null;
  const durationMs = toFiniteNumber(entry?.durationMs);
  const normalized = {
    tsIso: entry.tsIso,
    tsMs,
    actor: String(entry?.actor || "").trim() || "unknown",
    tool: String(entry?.tool || "").trim() || "unknown",
    action: String(entry?.action || "").trim() || "unknown",
    ok: entry?.ok === true,
    errorType: String(entry?.errorType || "").trim() || "none",
    durationMs: durationMs != null && durationMs >= 0 ? durationMs : null,
    usage: extractUsage(entry),
  };
  return normalized;
}

function scoreLowerBetter(value, target, hardLimitMultiplier = 3) {
  if (!Number.isFinite(value) || !Number.isFinite(target)) return null;
  if (target <= 0) {
    if (value <= 0) return 100;
    const hard = Math.max(1, hardLimitMultiplier);
    return Math.round(clamp(100 - (value / hard) * 100, 0, 100));
  }
  if (value <= target) return 100;
  const max = target * hardLimitMultiplier;
  if (value >= max) return 0;
  const ratio = (value - target) / (max - target);
  return Math.round(clamp(100 - ratio * 100, 0, 100));
}

function scoreHigherBetter(value, target, hardFloorRatio = 0.2) {
  if (!Number.isFinite(value) || !Number.isFinite(target) || target <= 0) return null;
  if (value >= target) return 100;
  const floor = target * hardFloorRatio;
  if (value <= floor) return 0;
  const ratio = (value - floor) / (target - floor);
  return Math.round(clamp(ratio * 100, 0, 100));
}

function weightedAverage(parts) {
  const usable = parts.filter((entry) => Number.isFinite(entry?.score) && Number.isFinite(entry?.weight));
  if (usable.length === 0) return null;
  const totalWeight = usable.reduce((sum, part) => sum + part.weight, 0);
  if (totalWeight <= 0) return null;
  const weighted = usable.reduce((sum, part) => sum + part.score * part.weight, 0);
  return weighted / totalWeight;
}

function letterGrade(score) {
  if (!Number.isFinite(score)) return "n/a";
  if (score >= 93) return "A";
  if (score >= 85) return "B";
  if (score >= 75) return "C";
  if (score >= 65) return "D";
  return "F";
}

function computeRepeatFailureBursts(failures, burstWindowMinutes = 15) {
  const windowMs = burstWindowMinutes * 60 * 1000;
  const grouped = new Map();
  for (const entry of failures) {
    const key = `${entry.tool}::${entry.action}::${entry.errorType || "none"}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry.tsMs);
  }

  const bursts = [];
  for (const [key, timestamps] of grouped.entries()) {
    const ordered = timestamps.slice().sort((left, right) => left - right);
    let localBurstCount = 0;
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index] - ordered[index - 1] <= windowMs) {
        localBurstCount += 1;
      }
    }
    if (localBurstCount > 0) {
      bursts.push({ key, count: localBurstCount, events: ordered.length });
    }
  }
  return bursts.sort((left, right) => right.count - left.count);
}

function computeMttrMinutes(entries) {
  const bySignature = new Map();
  for (const entry of entries) {
    const key = `${entry.tool}::${entry.action}`;
    if (!bySignature.has(key)) bySignature.set(key, []);
    bySignature.get(key).push(entry);
  }

  const recoveryMinutes = [];
  let failureEvents = 0;
  let recoveredFailures = 0;

  for (const groupedEntries of bySignature.values()) {
    const ordered = groupedEntries.slice().sort((left, right) => left.tsMs - right.tsMs);
    for (let index = 0; index < ordered.length; index += 1) {
      const item = ordered[index];
      if (item.ok) continue;
      failureEvents += 1;
      let recoveredAt = null;
      for (let scan = index + 1; scan < ordered.length; scan += 1) {
        if (ordered[scan].ok) {
          recoveredAt = ordered[scan].tsMs;
          break;
        }
      }
      if (recoveredAt != null) {
        recoveredFailures += 1;
        recoveryMinutes.push((recoveredAt - item.tsMs) / 60000);
      }
    }
  }

  return {
    mttrMinutes: average(recoveryMinutes),
    failureEvents,
    recoveredFailures,
    recoveryRate: failureEvents === 0 ? 1 : recoveredFailures / failureEvents,
  };
}

function computeRecommendationClosureRate(state) {
  const outcomes = Array.isArray(state?.recommendationOutcomes)
    ? state.recommendationOutcomes.filter((entry) => entry && typeof entry === "object")
    : [];
  if (outcomes.length === 0) return null;
  const latest = outcomes.slice(-60);
  const closedStatuses = new Set(["achieved", "done", "closed"]);
  let closed = 0;
  for (const outcome of latest) {
    const status = String(outcome.status || "").toLowerCase().trim();
    if (closedStatuses.has(status)) closed += 1;
  }
  return latest.length === 0 ? null : closed / latest.length;
}

function computeRubricReport({
  generatedAtIso,
  windowHours,
  analysisStartIso,
  toolcallsPath,
  statePath,
  toolcalls,
  invalidLines,
  state,
}) {
  const normalized = toolcalls
    .map((entry) => normalizeToolcallEntry(entry))
    .filter(Boolean)
    .sort((left, right) => left.tsMs - right.tsMs);

  const totalCalls = normalized.length;
  const successfulCalls = normalized.filter((entry) => entry.ok).length;
  const failedCalls = totalCalls - successfulCalls;
  const successRate = totalCalls === 0 ? null : successfulCalls / totalCalls;

  const durations = normalized.map((entry) => entry.durationMs).filter((value) => Number.isFinite(value));
  const p50DurationMs = percentile(durations, 0.5);
  const p95DurationMs = percentile(durations, 0.95);
  const avgDurationMs = average(durations);

  const failures = normalized.filter((entry) => !entry.ok);
  const repeatBursts = computeRepeatFailureBursts(failures);
  const repeatFailureBursts = repeatBursts.reduce((sum, cluster) => sum + cluster.count, 0);

  const mttr = computeMttrMinutes(normalized);
  const successfulCallsPerHour = windowHours <= 0 ? null : successfulCalls / windowHours;

  const usageEntries = normalized
    .map((entry) => ({
      ok: entry.ok,
      usage: entry.usage,
    }))
    .filter((entry) => entry.usage && Number.isFinite(entry.usage.totalTokens));

  const tokenCoverage = totalCalls === 0 ? null : usageEntries.length / totalCalls;
  const usageTotals = usageEntries.reduce(
    (acc, entry) => {
      const usage = entry.usage;
      acc.inputTokens += Number(usage.inputTokens || 0);
      acc.outputTokens += Number(usage.outputTokens || 0);
      acc.reasoningTokens += Number(usage.reasoningTokens || 0);
      acc.cacheReadTokens += Number(usage.cacheReadTokens || 0);
      acc.cacheWriteTokens += Number(usage.cacheWriteTokens || 0);
      acc.totalTokens += Number(usage.totalTokens || 0);
      if (!entry.ok) {
        acc.failedCallTokens += Number(usage.totalTokens || 0);
      }
      return acc;
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      failedCallTokens: 0,
    }
  );

  const tokensPerSuccessfulCall =
    successfulCalls > 0 && usageTotals.totalTokens > 0 ? usageTotals.totalTokens / successfulCalls : null;
  const successesPer1kTokens =
    usageTotals.totalTokens > 0 ? successfulCalls / (usageTotals.totalTokens / 1000) : null;
  const failedTokenShare =
    usageTotals.totalTokens > 0 ? usageTotals.failedCallTokens / usageTotals.totalTokens : null;

  const impactScores = Array.isArray(state?.improvementImpactScores)
    ? state.improvementImpactScores.filter((value) => Number.isFinite(Number(value))).map(Number)
    : [];
  const impactScoreCurrent = impactScores.length > 0 ? impactScores.at(-1) : null;
  const impactScoreAvg5 = impactScores.length > 0 ? average(impactScores.slice(-5)) : null;
  const recommendationClosureRate = computeRecommendationClosureRate(state);
  const prHealthScore = toFiniteNumber(state?.prGreenDaily?.lastSummary?.healthScore);

  const reliabilityScore = weightedAverage([
    { score: scoreHigherBetter(successRate, rubricTargets.reliability.successRateMin, 0.75), weight: 0.65 },
    { score: scoreLowerBetter(repeatFailureBursts, rubricTargets.reliability.repeatFailureBurstsMax, 4), weight: 0.2 },
    { score: scoreLowerBetter(invalidLines, rubricTargets.reliability.invalidLinesMax, 8), weight: 0.15 },
  ]);

  const speedScore = weightedAverage([
    { score: scoreLowerBetter(p95DurationMs, rubricTargets.speed.p95DurationMsMax, 3.5), weight: 0.55 },
    { score: scoreLowerBetter(mttr.mttrMinutes, rubricTargets.speed.mttrMinutesMax, 4), weight: 0.25 },
    { score: scoreLowerBetter(p50DurationMs, rubricTargets.speed.p50DurationMsMax, 4), weight: 0.2 },
  ]);

  const efficiencyScore =
    tokenCoverage == null || tokenCoverage === 0
      ? null
      : weightedAverage([
          { score: scoreLowerBetter(tokensPerSuccessfulCall, rubricTargets.efficiency.tokensPerSuccessMax, 4), weight: 0.5 },
          { score: scoreHigherBetter(tokenCoverage, rubricTargets.efficiency.tokenCoverageMin, 0.2), weight: 0.3 },
          { score: scoreHigherBetter(successesPer1kTokens, rubricTargets.efficiency.successesPer1kTokensMin, 0.3), weight: 0.2 },
        ]);

  const throughputScore = weightedAverage([
    { score: scoreHigherBetter(successfulCallsPerHour, rubricTargets.throughput.successfulCallsPerHourMin, 0.25), weight: 1 },
  ]);

  const qualityScore = weightedAverage([
    { score: scoreHigherBetter(impactScoreCurrent, rubricTargets.quality.impactScoreMin, 0.5), weight: 0.45 },
    {
      score: scoreHigherBetter(recommendationClosureRate, rubricTargets.quality.recommendationClosureRateMin, 0.25),
      weight: 0.3,
    },
    { score: scoreHigherBetter(prHealthScore, rubricTargets.quality.prHealthMin, 0.6), weight: 0.25 },
  ]);

  const dimensions = [
    {
      id: "reliability",
      label: "Reliability",
      weight: 0.32,
      score: reliabilityScore,
      status: reliabilityScore == null ? "insufficient-data" : reliabilityScore >= 85 ? "healthy" : "needs-attention",
      target: `successRate>=${pct(rubricTargets.reliability.successRateMin, 0)}%, repeatBursts<=${rubricTargets.reliability.repeatFailureBurstsMax}`,
      actual: `successRate=${pct(successRate, 1) ?? "n/a"}%, repeatBursts=${repeatFailureBursts}`,
    },
    {
      id: "speed",
      label: "Speed",
      weight: 0.23,
      score: speedScore,
      status: speedScore == null ? "insufficient-data" : speedScore >= 85 ? "healthy" : "needs-attention",
      target: `p95<=${rubricTargets.speed.p95DurationMsMax}ms, MTTR<=${rubricTargets.speed.mttrMinutesMax}m`,
      actual: `p95=${p95DurationMs == null ? "n/a" : Math.round(p95DurationMs)}ms, MTTR=${mttr.mttrMinutes == null ? "n/a" : mttr.mttrMinutes.toFixed(1)}m`,
    },
    {
      id: "efficiency",
      label: "Token Efficiency",
      weight: 0.2,
      score: efficiencyScore,
      status:
        efficiencyScore == null
          ? "insufficient-data"
          : efficiencyScore >= 85
            ? "healthy"
            : "needs-attention",
      target: `tokenCoverage>=${pct(rubricTargets.efficiency.tokenCoverageMin, 0)}%, tokens/success<=${rubricTargets.efficiency.tokensPerSuccessMax}`,
      actual: `coverage=${pct(tokenCoverage, 1) ?? "n/a"}%, tokens/success=${tokensPerSuccessfulCall == null ? "n/a" : Math.round(tokensPerSuccessfulCall)}`,
    },
    {
      id: "throughput",
      label: "Throughput",
      weight: 0.1,
      score: throughputScore,
      status: throughputScore == null ? "insufficient-data" : throughputScore >= 85 ? "healthy" : "needs-attention",
      target: `successfulCalls/hour>=${rubricTargets.throughput.successfulCallsPerHourMin}`,
      actual: `successfulCalls/hour=${successfulCallsPerHour == null ? "n/a" : successfulCallsPerHour.toFixed(2)}`,
    },
    {
      id: "quality",
      label: "Outcome Quality",
      weight: 0.15,
      score: qualityScore,
      status: qualityScore == null ? "insufficient-data" : qualityScore >= 85 ? "healthy" : "needs-attention",
      target: `impact>=${rubricTargets.quality.impactScoreMin}, closure>=${pct(rubricTargets.quality.recommendationClosureRateMin, 0)}%, prHealth>=${rubricTargets.quality.prHealthMin}`,
      actual: `impact=${impactScoreCurrent == null ? "n/a" : impactScoreCurrent}, closure=${pct(recommendationClosureRate, 1) ?? "n/a"}%, prHealth=${prHealthScore == null ? "n/a" : prHealthScore}`,
    },
  ];

  const completenessSignals = [
    totalCalls > 0 ? 1 : 0,
    durations.length > 0 ? 1 : 0,
    tokenCoverage != null ? tokenCoverage : 0,
    impactScoreCurrent != null ? 1 : 0,
    recommendationClosureRate != null ? 1 : 0,
    prHealthScore != null ? 1 : 0,
  ];
  const dataCompleteness = average(completenessSignals) ?? 0;

  const overallBaseScore = weightedAverage(
    dimensions.map((dimension) => ({
      score: dimension.score,
      weight: dimension.weight,
    }))
  );
  const overallScore =
    overallBaseScore == null ? null : Number((overallBaseScore * (0.85 + dataCompleteness * 0.15)).toFixed(1));

  const recommendations = [];
  if (totalCalls === 0) {
    recommendations.push("No toolcall telemetry in the selected window. Ensure loops are running and logging.");
  }
  if (successRate != null && successRate < rubricTargets.reliability.successRateMin) {
    recommendations.push(
      "Reliability below target: cluster by tool/action and add fallback paths before retrying identical failing calls."
    );
  }
  if (repeatFailureBursts > rubricTargets.reliability.repeatFailureBurstsMax) {
    recommendations.push("Retry-loop burst detected: cap repeated retries and escalate after first repeated signature.");
  }
  if (p95DurationMs != null && p95DurationMs > rubricTargets.speed.p95DurationMsMax) {
    recommendations.push("p95 latency exceeded target: prioritize high-duration actions and add bounded timeouts.");
  }
  if (mttr.mttrMinutes != null && mttr.mttrMinutes > rubricTargets.speed.mttrMinutesMax) {
    recommendations.push("MTTR exceeded target: add faster recovery playbooks and first-failure diagnostics.");
  }
  if ((tokenCoverage ?? 0) < rubricTargets.efficiency.tokenCoverageMin) {
    recommendations.push(
      "Token telemetry coverage is low. Log usage for each call using codex toolcall usage fields for better cost/efficiency tracking."
    );
  }
  if (
    tokensPerSuccessfulCall != null &&
    tokensPerSuccessfulCall > rubricTargets.efficiency.tokensPerSuccessMax
  ) {
    recommendations.push("Tokens per successful call exceeded target: tighten prompts/context and reduce redundant retries.");
  }
  if (
    recommendationClosureRate != null &&
    recommendationClosureRate < rubricTargets.quality.recommendationClosureRateMin
  ) {
    recommendations.push("Recommendation closure is low: enforce owner + due date in each generated improvement ticket.");
  }

  return {
    generatedAtIso,
    windowHours,
    analysisStartIso,
    sources: {
      toolcallsPath: relative(repoRoot, toolcallsPath),
      statePath: relative(repoRoot, statePath),
    },
    metrics: {
      calls: {
        total: totalCalls,
        successful: successfulCalls,
        failed: failedCalls,
        successRate,
        invalidLines,
      },
      latency: {
        durationSamples: durations.length,
        averageDurationMs: avgDurationMs,
        p50DurationMs,
        p95DurationMs,
        mttrMinutes: mttr.mttrMinutes,
        failureEvents: mttr.failureEvents,
        recoveredFailures: mttr.recoveredFailures,
        recoveryRate: mttr.recoveryRate,
      },
      reliability: {
        repeatFailureBursts,
        topRepeatFailureBursts: repeatBursts.slice(0, 6),
      },
      throughput: {
        successfulCallsPerHour,
      },
      tokens: {
        telemetryEntries: usageEntries.length,
        telemetryCoverage: tokenCoverage,
        inputTokens: usageTotals.inputTokens,
        outputTokens: usageTotals.outputTokens,
        reasoningTokens: usageTotals.reasoningTokens,
        cacheReadTokens: usageTotals.cacheReadTokens,
        cacheWriteTokens: usageTotals.cacheWriteTokens,
        totalTokens: usageTotals.totalTokens,
        failedCallTokens: usageTotals.failedCallTokens,
        failedTokenShare,
        tokensPerSuccessfulCall,
        successesPer1kTokens,
      },
      outcomes: {
        impactScoreCurrent,
        impactScoreAvg5,
        recommendationClosureRate,
        prHealthScore,
      },
    },
    rubric: {
      targets: rubricTargets,
      dimensions,
      overallScore,
      grade: letterGrade(overallScore),
      dataCompleteness,
    },
    recommendations,
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Codex Agentic Rubric Scorecard");
  lines.push("");
  lines.push(`- Generated at: ${report.generatedAtIso}`);
  lines.push(`- Window: last ${report.windowHours}h (since ${report.analysisStartIso})`);
  lines.push(`- Overall score: ${report.rubric.overallScore == null ? "n/a" : report.rubric.overallScore} (${report.rubric.grade})`);
  lines.push(`- Data completeness: ${pct(report.rubric.dataCompleteness, 1) ?? "n/a"}%`);
  lines.push("");

  lines.push("## Dimension Scores");
  lines.push("| Dimension | Weight | Score | Status | Target | Actual |");
  lines.push("| --- | ---: | ---: | --- | --- | --- |");
  report.rubric.dimensions.forEach((dimension) => {
    lines.push(
      `| ${dimension.label} | ${(dimension.weight * 100).toFixed(0)}% | ${
        dimension.score == null ? "n/a" : dimension.score
      } | ${dimension.status} | ${dimension.target} | ${dimension.actual} |`
    );
  });
  lines.push("");

  lines.push("## Key Metrics");
  lines.push(`- Calls: ${report.metrics.calls.total} total / ${report.metrics.calls.successful} successful / ${report.metrics.calls.failed} failed`);
  lines.push(`- Success rate: ${pct(report.metrics.calls.successRate, 1) ?? "n/a"}%`);
  lines.push(`- p50 latency: ${report.metrics.latency.p50DurationMs == null ? "n/a" : Math.round(report.metrics.latency.p50DurationMs)}ms`);
  lines.push(`- p95 latency: ${report.metrics.latency.p95DurationMs == null ? "n/a" : Math.round(report.metrics.latency.p95DurationMs)}ms`);
  lines.push(`- MTTR: ${report.metrics.latency.mttrMinutes == null ? "n/a" : report.metrics.latency.mttrMinutes.toFixed(1)} minutes`);
  lines.push(`- Token coverage: ${pct(report.metrics.tokens.telemetryCoverage, 1) ?? "n/a"}%`);
  lines.push(`- Tokens per successful call: ${report.metrics.tokens.tokensPerSuccessfulCall == null ? "n/a" : Math.round(report.metrics.tokens.tokensPerSuccessfulCall)}`);
  lines.push(`- Failed-token share: ${pct(report.metrics.tokens.failedTokenShare, 1) ?? "n/a"}%`);
  lines.push(`- Recommendation closure: ${pct(report.metrics.outcomes.recommendationClosureRate, 1) ?? "n/a"}%`);
  lines.push("");

  lines.push("## Recommended Actions");
  if (!Array.isArray(report.recommendations) || report.recommendations.length === 0) {
    lines.push("- No immediate rubric-triggered actions.");
  } else {
    report.recommendations.forEach((recommendation) => lines.push(`- ${recommendation}`));
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}

async function writeArtifacts(options, report, markdown) {
  await mkdir(dirname(options.reportJsonPath), { recursive: true });
  await mkdir(dirname(options.reportMarkdownPath), { recursive: true });
  await writeFile(options.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(options.reportMarkdownPath, markdown, "utf8");
}

function enforceStrictMode(report) {
  if (report.metrics.calls.total === 0) {
    throw new Error("Strict mode failed: no toolcall entries in selected window.");
  }
  const coverage = report.metrics.tokens.telemetryCoverage ?? 0;
  if (coverage < 0.5) {
    throw new Error(
      `Strict mode failed: token telemetry coverage ${pct(coverage, 1)}% is below required 50%.`
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const now = nowDate(options);
  const generatedAtIso = now.toISOString();
  const startMs = now.getTime() - options.windowHours * 60 * 60 * 1000;
  const analysisStartIso = new Date(startMs).toISOString();

  const toolcallData = await readNdjson(options.toolcallsPath);
  const state = await readJson(options.statePath, {});
  const inWindow = toolcallData.entries.filter((entry) => {
    const tsMs = toMs(entry?.tsIso);
    return tsMs != null && tsMs >= startMs;
  });

  const report = computeRubricReport({
    generatedAtIso,
    windowHours: options.windowHours,
    analysisStartIso,
    toolcallsPath: options.toolcallsPath,
    statePath: options.statePath,
    toolcalls: inWindow,
    invalidLines: toolcallData.invalidLines,
    state,
  });

  const markdown = buildMarkdown(report);

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
      `calls: ${report.metrics.calls.total}`,
      `tokenCoverage: ${pct(report.metrics.tokens.telemetryCoverage, 1) ?? "n/a"}%`,
      "",
    ].join("\n")
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`rubric-scorecard failed: ${message}`);
  process.exit(1);
});
