#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_REPORT_PATH = resolve(process.cwd(), "output", "open-memory", "ingest-guard-latest.json");
const CONVERGE_SCRIPT_PATH = "./scripts/open-memory-backfill-converge.mjs";
const EXPERIMENTAL_CONTEXT_SCRIPT_PATH = "./scripts/open-memory-context-experimental-index.mjs";
const EXPERIMENTAL_CAPTURE_SCRIPT_PATH = "./scripts/open-memory-context-experimental-capture.mjs";
const DEFAULT_PHASES = ["email", "mail-signal", "global-signal", "experimental-context"];
const VALID_PHASES = new Set(DEFAULT_PHASES);

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] ?? "");
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).trim().toLowerCase();
    if (key.includes("=")) {
      const [rawKey, ...rest] = key.split("=");
      flags[rawKey.trim().toLowerCase()] = rest.join("=");
      continue;
    }
    const next = argv[i + 1];
    if (next && !String(next).startsWith("--")) {
      flags[key] = String(next);
      i += 1;
    } else {
      flags[key] = "true";
    }
  }
  return flags;
}

function readBool(flags, key, fallback = false) {
  const raw = String(flags[key] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function readInt(flags, key, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(flags[key] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function readNumber(flags, key, fallback, { min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(flags[key] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function readString(flags, key, fallback = "") {
  const raw = String(flags[key] ?? "").trim();
  return raw || fallback;
}

function parseCsv(raw) {
  return String(raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizePhaseList(raw) {
  const preferred = parseCsv(raw);
  if (!preferred.length) return [...DEFAULT_PHASES];
  const seen = new Set();
  const phases = [];
  for (const value of preferred) {
    if (!VALID_PHASES.has(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    phases.push(value);
  }
  return phases.length ? phases : [...DEFAULT_PHASES];
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, Math.max(0, ms));
  });
}

function scaleDown(current, floor, factor) {
  const safeFactor = Math.max(0.1, Math.min(factor, 0.99));
  const next = Math.floor(current * safeFactor);
  return Math.max(floor, next);
}

function scaleUp(current, target, recoveryFactor) {
  if (current >= target) return current;
  const safe = Math.max(0.01, Math.min(recoveryFactor, 1));
  const gap = target - current;
  const step = Math.max(1, Math.floor(gap * safe));
  return Math.min(target, current + step);
}

function parseJsonFromStdout(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {}
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {}
  }
  return null;
}

async function runPhaseScript(scriptPath, args, { timeoutMs = 0 } = {}) {
  const cmd = "node";
  const fullArgs = [scriptPath, ...args, "--json", "true"];
  const startedAt = new Date().toISOString();
  const child = spawn(cmd, fullArgs, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let forceKillTimer = null;
  const timeoutHandle =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          forceKillTimer = setTimeout(() => {
            child.kill("SIGKILL");
          }, 2500);
        }, timeoutMs)
      : null;

  child.stdout.on("data", (chunk) => {
    stdout += String(chunk ?? "");
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk ?? "");
  });

  const exitCode = await new Promise((resolveExit) => {
    child.on("close", (code) => resolveExit(code ?? 0));
  });

  if (timeoutHandle) clearTimeout(timeoutHandle);
  if (forceKillTimer) clearTimeout(forceKillTimer);

  const parsed = parseJsonFromStdout(stdout);
  const trimmedStdout = stdout.trim();
  const trimmedStderr = stderr.trim();

  return {
    ok: exitCode === 0 && !timedOut && Boolean(parsed?.ok ?? false),
    exitCode,
    timedOut,
    startedAt,
    finishedAt: new Date().toISOString(),
    args: fullArgs,
    result: parsed,
    stderr: trimmedStderr || null,
    stdout: trimmedStdout || null,
  };
}

async function runConvergeWithRetries(
  args,
  {
    attempts = 1,
    retryDelayMs = 0,
    timeoutMs = 0,
    scriptPath = CONVERGE_SCRIPT_PATH,
  } = {}
) {
  const runs = [];
  const totalAttempts = Math.max(1, attempts);
  for (let index = 1; index <= totalAttempts; index += 1) {
    const run = await runPhaseScript(scriptPath, args, { timeoutMs });
    runs.push(run);
    if (run.ok) break;
    if (index < totalAttempts && retryDelayMs > 0) {
      await sleep(Math.max(0, retryDelayMs * index));
    }
  }
  const lastRun = runs[runs.length - 1] ?? null;
  return {
    ok: Boolean(lastRun?.ok),
    attempts: runs.length,
    lastRun,
    runs,
  };
}

function summarizeConverge(run) {
  const totals = run?.result?.totals ?? {};
  return {
    scanned: Number(totals.scanned ?? 0),
    eligible: Number(totals.eligible ?? 0),
    updated: Number(totals.updated ?? 0),
    failed: Number(totals.failed ?? 0),
    timeoutErrors: Number(totals.timeoutErrors ?? 0),
    relationshipEdgesAdded: Number(totals.relationshipEdgesAdded ?? 0),
    requestRetries: Number(totals.requestRetries ?? 0),
    recoverableHttpErrors: Number(totals.recoverableHttpErrors ?? 0),
    fatalHttpErrors: Number(totals.fatalHttpErrors ?? 0),
    downshiftCount: Number(totals.downshiftCount ?? 0),
    motifsDetected: Number(totals.motifsDetected ?? 0),
    decisionFlowMotifsDetected: Number(totals.decisionFlowMotifsDetected ?? 0),
    bridgeHubMotifsDetected: Number(totals.bridgeHubMotifsDetected ?? 0),
    relationshipCandidates: Number(totals.relationshipCandidates ?? 0),
    relationshipEdgesCaptured: Number(totals.relationshipEdgesCaptured ?? totals.relationshipEdgesAdded ?? 0),
    capturesAttempted: Number(totals.capturesAttempted ?? totals.eligible ?? 0),
    capturesWritten: Number(totals.capturesWritten ?? totals.updated ?? 0),
    noveltySuppressedCandidates: Number(totals.noveltySuppressedCandidates ?? 0),
    noveltyReusedKeys: Number(totals.noveltyReusedKeys ?? 0),
    noveltyAvgScore: Number(totals.noveltyAvgScore ?? 0),
    rerankRowsInput: Number(totals.rerankRowsInput ?? 0),
    rerankRowsRetained: Number(totals.rerankRowsRetained ?? 0),
    rerankSignalDominantRows: Number(totals.rerankSignalDominantRows ?? 0),
    rerankAvgSeedOverlap: Number(totals.rerankAvgSeedOverlap ?? 0),
    rerankAvgScore: Number(totals.rerankAvgScore ?? 0),
    searchQueriesAttempted: Number(totals.searchQueriesAttempted ?? 0),
    searchQueriesFailed: Number(totals.searchQueriesFailed ?? 0),
    searchQueriesDegraded: Number(totals.searchQueriesDegraded ?? 0),
    searchQueriesDeferred: Number(totals.searchQueriesDeferred ?? 0),
    searchDegradationRate: Number(totals.searchDegradationRate ?? 0),
  };
}

function firstPhaseStopReason(run) {
  const phases = Array.isArray(run?.result?.phases) ? run.result.phases : [];
  const first = phases[0];
  return typeof first?.stopReason === "string" ? first.stopReason : null;
}

function firstPhaseLastMessage(run) {
  const phases = Array.isArray(run?.result?.phases) ? run.result.phases : [];
  const first = phases[0];
  const last = first?.last;
  return typeof last?.message === "string" ? last.message : null;
}

function aggregatePhaseSummary(cyclePhases) {
  const aggregate = cyclePhases.reduce(
    (acc, row) => {
      if (row.dryRun?.summary) {
        acc.dryEligible += Number(row.dryRun.summary.eligible ?? 0);
      }
      if (row.apply?.summary) {
        acc.applyUpdated += Number(row.apply.summary.updated ?? 0);
        acc.applyFailed += Number(row.apply.summary.failed ?? 0);
        acc.relationshipEdgesAdded += Number(row.apply.summary.relationshipEdgesAdded ?? 0);
        acc.experimentalMotifsDetected += Number(row.apply.summary.motifsDetected ?? 0);
        acc.experimentalDecisionFlowMotifsDetected += Number(row.apply.summary.decisionFlowMotifsDetected ?? 0);
        acc.experimentalBridgeHubMotifsDetected += Number(row.apply.summary.bridgeHubMotifsDetected ?? 0);
        acc.experimentalRelationshipCandidates += Number(row.apply.summary.relationshipCandidates ?? 0);
        acc.experimentalRelationshipEdgesCaptured += Number(row.apply.summary.relationshipEdgesCaptured ?? 0);
        acc.experimentalCapturesWritten += Number(row.apply.summary.capturesWritten ?? 0);
        acc.experimentalNoveltySuppressedCandidates += Number(row.apply.summary.noveltySuppressedCandidates ?? 0);
        acc.experimentalNoveltyReusedKeys += Number(row.apply.summary.noveltyReusedKeys ?? 0);
        const noveltyWeight = Math.max(1, Number(row.apply.summary.capturesAttempted ?? 0));
        acc.experimentalNoveltyAvgScoreWeighted += Number(row.apply.summary.noveltyAvgScore ?? 0) * noveltyWeight;
        acc.experimentalNoveltyAvgScoreWeight += noveltyWeight;
        acc.experimentalRerankRowsInput += Number(row.apply.summary.rerankRowsInput ?? 0);
        acc.experimentalRerankRowsRetained += Number(row.apply.summary.rerankRowsRetained ?? 0);
        acc.experimentalRerankSignalDominantRows += Number(row.apply.summary.rerankSignalDominantRows ?? 0);
        acc.experimentalRerankAvgSeedOverlapWeighted +=
          Number(row.apply.summary.rerankAvgSeedOverlap ?? 0) * Number(row.apply.summary.rerankRowsRetained ?? 0);
        acc.experimentalRerankAvgScoreWeighted +=
          Number(row.apply.summary.rerankAvgScore ?? 0) * Number(row.apply.summary.rerankRowsRetained ?? 0);
        acc.experimentalSearchQueriesAttempted += Number(row.apply.summary.searchQueriesAttempted ?? 0);
        acc.experimentalSearchQueriesFailed += Number(row.apply.summary.searchQueriesFailed ?? 0);
        acc.experimentalSearchQueriesDegraded += Number(row.apply.summary.searchQueriesDegraded ?? 0);
        acc.experimentalSearchQueriesDeferred += Number(row.apply.summary.searchQueriesDeferred ?? 0);
      }
      return acc;
    },
    {
      dryEligible: 0,
      applyUpdated: 0,
      applyFailed: 0,
      relationshipEdgesAdded: 0,
      experimentalMotifsDetected: 0,
      experimentalDecisionFlowMotifsDetected: 0,
      experimentalBridgeHubMotifsDetected: 0,
      experimentalRelationshipCandidates: 0,
      experimentalRelationshipEdgesCaptured: 0,
      experimentalCapturesWritten: 0,
      experimentalNoveltySuppressedCandidates: 0,
      experimentalNoveltyReusedKeys: 0,
      experimentalNoveltyAvgScoreWeighted: 0,
      experimentalNoveltyAvgScoreWeight: 0,
      experimentalRerankRowsInput: 0,
      experimentalRerankRowsRetained: 0,
      experimentalRerankSignalDominantRows: 0,
      experimentalRerankAvgSeedOverlapWeighted: 0,
      experimentalRerankAvgScoreWeighted: 0,
      experimentalSearchQueriesAttempted: 0,
      experimentalSearchQueriesFailed: 0,
      experimentalSearchQueriesDegraded: 0,
      experimentalSearchQueriesDeferred: 0,
    }
  );
  const rerankDivisor = Math.max(1, aggregate.experimentalRerankRowsRetained);
  return {
    ...aggregate,
    experimentalRerankAvgSeedOverlap: Number(
      (aggregate.experimentalRerankAvgSeedOverlapWeighted / rerankDivisor).toFixed(4)
    ),
    experimentalRerankAvgScore: Number((aggregate.experimentalRerankAvgScoreWeighted / rerankDivisor).toFixed(4)),
    experimentalNoveltyAvgScore: Number(
      (aggregate.experimentalNoveltyAvgScoreWeighted / Math.max(1, aggregate.experimentalNoveltyAvgScoreWeight)).toFixed(4)
    ),
    experimentalSearchDegradationRate: Number(
      (aggregate.experimentalSearchQueriesDegraded / Math.max(1, aggregate.experimentalSearchQueriesAttempted)).toFixed(4)
    ),
  };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (readBool(flags, "help", false)) {
    process.stdout.write(
      [
        "Open Memory Ingest Guard",
        "",
        "Usage:",
        "  node ./scripts/open-memory-ingest-guard.mjs --cycles 0 --interval-ms 120000",
        "",
        "Options:",
        "  --cycles <n>                              Number of guard cycles (0 = infinite, default: 0)",
        "  --interval-ms <n>                         Delay between cycles (default: 120000)",
        "  --phases <csv>                            Phase order (default: email,mail-signal,global-signal,experimental-context)",
        "  --limit <n>                               Initial backfill scan window limit (default: 2000)",
        "  --max-writes <n>                          Initial max writes for apply pass (default: 500)",
        "  --dry-run-max-waves <n>                   Max waves for each dry-run converge call (default: 1)",
        "  --apply-max-waves <n>                     Max waves for each apply converge call (default: 1)",
        "  --write-delay-ms <n>                      Write delay for apply pass (default: 2)",
        "  --timeout-ms <n>                          HTTP timeout passed into converge runs (default: 900000)",
        "  --phase-run-timeout-ms <n>                Timeout for each converge process run",
        "  --phase-run-retries <n>                   Extra retry attempts for failed converge runs (default: 1)",
        "  --phase-run-retry-delay-ms <n>            Delay between converge retries (default: 20000)",
        "  --relationship-probe-limit <n>            Relationship probe limit (default: 24)",
        "  --max-inferred-edges-per-memory <n>       Max inferred edges per memory (default: 16)",
        "  --min-related-signal-score <n>            Related-signal threshold (default: 0.12)",
        "  --experimental-source-prefixes <csv>      Source prefixes for experimental context phase (default: mail:,email)",
        "  --experimental-include-non-mail-like bool Include non-mail-like rows in experimental phase (default: false)",
        "  --experimental-search-limit <n>           Search limit per seed query (default: 60)",
        "  --experimental-search-seed-limit <n>      Max extracted query seeds per cycle (default: 12)",
        "  --experimental-max-search-queries <n>     Max search requests per cycle (default: 12)",
        "  --experimental-rerank-top-k <n>           Max rows retained after retrieval rerank (default: 260)",
        "  --experimental-rerank-signal-weight <n>   Retrieval rerank signal weight (default: 0.55)",
        "  --experimental-rerank-recency-weight <n>  Retrieval rerank recency weight (default: 0.2)",
        "  --experimental-rerank-seed-overlap-weight <n> Retrieval rerank seed overlap weight (default: 0.25)",
        "  --experimental-rerank-query-rank-weight <n> Retrieval rerank query-rank prior weight (default: 0.12)",
        "  --experimental-defer-on-pressure bool     Skip experimental discovery on ingest pressure (default: true)",
        "  --experimental-pressure-timeout-ms <n>    Timeout for pressure check in experimental phase (default: 5000)",
        "  --experimental-participant-noise-filter bool Filter noisy mailbox participants (default: true)",
        "  --experimental-max-consecutive-search-failures <n> Stop expansion after N consecutive search failures (default: 1)",
        "  --experimental-recent-retries <n>         Retry attempts for recent-memory fetch (default: 1)",
        "  --experimental-recent-retry-delay-ms <n>  Backoff delay for recent-memory fetch retries (default: 1000)",
        "  --experimental-min-edge-support <n>       Min support for relationship edge candidates (default: 3)",
        "  --experimental-min-edge-confidence <n>    Min confidence for relationship edges (default: 0.62)",
        "  --experimental-min-motif-score <n>        Min score for motif candidates (default: 1.4)",
        "  --experimental-max-motifs <n>             Max motif candidates retained per cycle (default: 20)",
        "  --experimental-max-edges <n>              Max relationship edge candidates retained per cycle (default: 40)",
        "  --experimental-capture-source <value>     Source tag for synthetic context memories",
        "  --experimental-fallback-capture-on-discovery-failure bool Use preview-capture fallback when discovery fails (default: true)",
        "  --experimental-preview-path <path>        Preview jsonl path used by capture fallback",
        "  --experimental-fallback-max-writes <n>    Max fallback capture writes per cycle (default: 12)",
        "  --experimental-fallback-timeout-ms <n>    Per-write timeout for fallback capture (default: 12000)",
        "  --experimental-adaptive-mode bool         Adapt experimental budgets across cycles (default: true)",
        "  --experimental-min-search-limit <n>       Min adaptive search limit (default: 20)",
        "  --experimental-min-search-seed-limit <n>  Min adaptive search seed limit (default: 3)",
        "  --experimental-min-max-search-queries <n> Min adaptive max-search-queries (default: 2)",
        "  --experimental-min-fallback-max-writes <n> Min adaptive fallback writes (default: 2)",
        "  --experimental-min-rerank-top-k <n>       Min adaptive rerank top-k (default: 80)",
        "  --experimental-profile-ingest-factor <n>  Experimental target factor in ingest mode (default: 0.7)",
        "  --experimental-profile-catchup-factor <n> Experimental target factor in catchup mode (default: 1.2)",
        "  --experimental-dedupe-window-days <n>     Novelty dedupe window for experimental index (default: 14)",
        "  --experimental-novelty-weight <n>          Novelty score boost weight (default: 0.24)",
        "  --experimental-refresh-confidence-delta <n> Confidence delta needed to refresh recent duplicates (default: 0.08)",
        "  --experimental-adaptive-thresholds bool   Adapt min edge/motif thresholds from outcomes (default: true)",
        "  --experimental-min-edge-confidence-floor <n> Adaptive floor for edge confidence threshold (default: 0.5)",
        "  --experimental-max-edge-confidence-ceiling <n> Adaptive ceiling for edge confidence threshold (default: 0.88)",
        "  --experimental-min-motif-score-floor <n>  Adaptive floor for motif score threshold (default: 1.0)",
        "  --experimental-max-motif-score-ceiling <n> Adaptive ceiling for motif score threshold (default: 2.6)",
        "  --request-retries <n>                     Per-wave recoverable HTTP retries in converge (default: 3)",
        "  --retry-base-delay-ms <n>                 Base retry delay in converge (default: 2500)",
        "  --retry-backoff-factor <n>                Retry backoff factor in converge (default: 1.9)",
        "  --retry-max-delay-ms <n>                  Max retry delay in converge (default: 45000)",
        "  --retry-jitter-ms <n>                     Retry jitter in converge (default: 750)",
        "  --max-consecutive-http-errors <n>         Consecutive recoverable HTTP errors before phase stops (default: 4)",
        "  --cooldown-after-http-error-ms <n>        Cooldown between waves after recoverable HTTP errors (default: 12000)",
        "  --adaptive-downshift-on-http-error bool   Adaptive wave downshift in converge (default: true)",
        "  --min-wave-limit <n>                      Converge adaptive limit floor (default: 200)",
        "  --min-wave-writes <n>                     Converge adaptive max-writes floor (default: 50)",
        "  --downshift-factor <n>                    Converge downshift factor (default: 0.6)",
        "  --guard-downshift-factor <n>              Guard-level limit/write downshift factor (default: 0.75)",
        "  --guard-recovery-factor <n>               Guard-level recovery factor after healthy cycles (default: 0.35)",
        "  --guard-min-limit <n>                     Guard-level limit floor (default: 300)",
        "  --guard-min-max-writes <n>                Guard-level max-writes floor (default: 100)",
        "  --pause-after-failed-cycle-ms <n>         Extra delay after failed cycle (default: 180000)",
        "  --phase-failure-threshold <n>             Consecutive failed phase runs before cooldown (default: 3)",
        "  --phase-cooldown-cycles <n>               Phase cooldown cycles after breaker trips (default: 3)",
        "  --pressure-defer-cooldown-cycles <n>      Cycles to skip phase after ingest-pressure deferral (default: 2)",
        "  --auto-profile-switch bool                Auto switch ingest/normal/catchup profiles (default: true)",
        "  --ingest-limit-factor <n>                 Limit factor in ingest profile (default: 0.45)",
        "  --ingest-writes-factor <n>                Max-writes factor in ingest profile (default: 0.35)",
        "  --catchup-limit-factor <n>                Limit factor in catchup profile (default: 1.5)",
        "  --catchup-writes-factor <n>               Max-writes factor in catchup profile (default: 1.4)",
        "  --catchup-promote-healthy-cycles <n>      Healthy no-defer cycles before catchup mode (default: 3)",
        "  --ingest-demote-deferred-phases <n>       Deferred phase count that triggers ingest mode (default: 1)",
        "  --history-limit <n>                       Max cycle history retained in report (default: 200)",
        "  --forced-reindex-every <n>                Run skipAlreadyIndexed=false every N cycles (default: 12; 0 disables)",
        "  --forced-reindex-writes <n>               Max writes for forced reindex burst (default: 200)",
        "  --report <path>                           Guard report output path",
      ].join("\n")
    );
    return;
  }

  const cycles = readInt(flags, "cycles", 0, { min: 0, max: 1_000_000 });
  const intervalMs = readInt(flags, "interval-ms", 120_000, { min: 1_000, max: 86_400_000 });
  const phases = normalizePhaseList(readString(flags, "phases", DEFAULT_PHASES.join(",")));
  const limit = readInt(flags, "limit", 2000, { min: 1, max: 20_000 });
  const maxWrites = readInt(flags, "max-writes", 500, { min: 1, max: 20_000 });
  const dryRunMaxWaves = readInt(flags, "dry-run-max-waves", 1, { min: 1, max: 25 });
  const applyMaxWaves = readInt(flags, "apply-max-waves", 1, { min: 1, max: 25 });
  const writeDelayMs = readInt(flags, "write-delay-ms", 2, { min: 0, max: 60_000 });
  const timeoutMs = readInt(flags, "timeout-ms", 900_000, { min: 5_000, max: 1_800_000 });
  const phaseRunTimeoutMs = readInt(flags, "phase-run-timeout-ms", Math.max(600_000, timeoutMs * 2), {
    min: 30_000,
    max: 7_200_000,
  });
  const phaseRunRetries = readInt(flags, "phase-run-retries", 1, { min: 0, max: 20 });
  const phaseRunRetryDelayMs = readInt(flags, "phase-run-retry-delay-ms", 20_000, { min: 0, max: 900_000 });
  const relationshipProbeLimit = readInt(flags, "relationship-probe-limit", 24, { min: 2, max: 128 });
  const maxInferredEdgesPerMemory = readInt(flags, "max-inferred-edges-per-memory", 16, { min: 0, max: 128 });
  const minRelatedSignalScore = readNumber(flags, "min-related-signal-score", 0.12, { min: 0, max: 2 });
  const experimentalSourcePrefixes = parseCsv(readString(flags, "experimental-source-prefixes", "mail:,email"));
  const experimentalIncludeNonMailLike = readBool(flags, "experimental-include-non-mail-like", false);
  const experimentalSearchLimit = readInt(flags, "experimental-search-limit", 60, { min: 5, max: 200 });
  const experimentalSearchSeedLimit = readInt(flags, "experimental-search-seed-limit", 12, { min: 1, max: 100 });
  const experimentalMaxSearchQueries = readInt(flags, "experimental-max-search-queries", 12, { min: 1, max: 100 });
  const experimentalRerankTopK = readInt(flags, "experimental-rerank-top-k", 260, { min: 20, max: 5000 });
  const experimentalRerankSignalWeight = readNumber(flags, "experimental-rerank-signal-weight", 0.55, {
    min: 0,
    max: 1,
  });
  const experimentalRerankRecencyWeight = readNumber(flags, "experimental-rerank-recency-weight", 0.2, {
    min: 0,
    max: 1,
  });
  const experimentalRerankSeedOverlapWeight = readNumber(flags, "experimental-rerank-seed-overlap-weight", 0.25, {
    min: 0,
    max: 1,
  });
  const experimentalRerankQueryRankWeight = readNumber(flags, "experimental-rerank-query-rank-weight", 0.12, {
    min: 0,
    max: 1,
  });
  const experimentalDeferOnPressure = readBool(flags, "experimental-defer-on-pressure", true);
  const experimentalPressureTimeoutMs = readInt(flags, "experimental-pressure-timeout-ms", 5000, {
    min: 1000,
    max: 120_000,
  });
  const experimentalParticipantNoiseFilter = readBool(flags, "experimental-participant-noise-filter", true);
  const experimentalMaxConsecutiveSearchFailures = readInt(flags, "experimental-max-consecutive-search-failures", 1, {
    min: 1,
    max: 25,
  });
  const experimentalRecentRetries = readInt(flags, "experimental-recent-retries", 1, { min: 1, max: 20 });
  const experimentalRecentRetryDelayMs = readInt(flags, "experimental-recent-retry-delay-ms", 1000, {
    min: 0,
    max: 120_000,
  });
  const experimentalMinEdgeSupport = readInt(flags, "experimental-min-edge-support", 3, { min: 1, max: 100 });
  const experimentalMinEdgeConfidence = readNumber(flags, "experimental-min-edge-confidence", 0.62, { min: 0, max: 1 });
  const experimentalMinMotifScore = readNumber(flags, "experimental-min-motif-score", 1.4, { min: 0, max: 10 });
  const experimentalMaxMotifs = readInt(flags, "experimental-max-motifs", 20, { min: 1, max: 500 });
  const experimentalMaxEdges = readInt(flags, "experimental-max-edges", 40, { min: 1, max: 500 });
  const experimentalCaptureSource = readString(
    flags,
    "experimental-capture-source",
    "open-memory:experimental-context-index"
  );
  const experimentalFallbackCaptureOnDiscoveryFailure = readBool(
    flags,
    "experimental-fallback-capture-on-discovery-failure",
    true
  );
  const experimentalPreviewPath = readString(
    flags,
    "experimental-preview-path",
    "output/open-memory/context-experimental-candidates.jsonl"
  );
  const experimentalFallbackMaxWrites = readInt(flags, "experimental-fallback-max-writes", 12, { min: 1, max: 500 });
  const experimentalFallbackTimeoutMs = readInt(flags, "experimental-fallback-timeout-ms", 12000, {
    min: 2000,
    max: 300_000,
  });
  const experimentalAdaptiveMode = readBool(flags, "experimental-adaptive-mode", true);
  const experimentalMinSearchLimit = readInt(flags, "experimental-min-search-limit", 20, { min: 5, max: 200 });
  const experimentalMinSearchSeedLimit = readInt(flags, "experimental-min-search-seed-limit", 3, { min: 1, max: 100 });
  const experimentalMinMaxSearchQueries = readInt(flags, "experimental-min-max-search-queries", 2, { min: 1, max: 100 });
  const experimentalMinFallbackMaxWrites = readInt(flags, "experimental-min-fallback-max-writes", 2, {
    min: 1,
    max: 500,
  });
  const experimentalMinRerankTopK = readInt(flags, "experimental-min-rerank-top-k", 80, { min: 20, max: 5000 });
  const experimentalProfileIngestFactor = readNumber(flags, "experimental-profile-ingest-factor", 0.7, {
    min: 0.1,
    max: 1,
  });
  const experimentalProfileCatchupFactor = readNumber(flags, "experimental-profile-catchup-factor", 1.2, {
    min: 1,
    max: 3,
  });
  const experimentalDedupeWindowDays = readInt(flags, "experimental-dedupe-window-days", 14, { min: 1, max: 365 });
  const experimentalNoveltyWeight = readNumber(flags, "experimental-novelty-weight", 0.24, { min: 0, max: 2 });
  const experimentalRefreshConfidenceDelta = readNumber(
    flags,
    "experimental-refresh-confidence-delta",
    0.08,
    { min: 0, max: 1 }
  );
  const experimentalAdaptiveThresholds = readBool(flags, "experimental-adaptive-thresholds", true);
  const experimentalMinEdgeConfidenceFloor = readNumber(
    flags,
    "experimental-min-edge-confidence-floor",
    Math.min(0.5, experimentalMinEdgeConfidence),
    { min: 0, max: 1 }
  );
  const experimentalMaxEdgeConfidenceCeiling = readNumber(
    flags,
    "experimental-max-edge-confidence-ceiling",
    Math.max(0.88, experimentalMinEdgeConfidence),
    { min: 0, max: 1 }
  );
  const experimentalMinMotifScoreFloor = readNumber(
    flags,
    "experimental-min-motif-score-floor",
    Math.min(1, experimentalMinMotifScore),
    { min: 0, max: 10 }
  );
  const experimentalMaxMotifScoreCeiling = readNumber(
    flags,
    "experimental-max-motif-score-ceiling",
    Math.max(2.6, experimentalMinMotifScore),
    { min: 0, max: 10 }
  );
  const adaptiveEdgeConfidenceFloor = Math.min(experimentalMinEdgeConfidenceFloor, experimentalMaxEdgeConfidenceCeiling);
  const adaptiveEdgeConfidenceCeiling = Math.max(experimentalMinEdgeConfidenceFloor, experimentalMaxEdgeConfidenceCeiling);
  const adaptiveMotifScoreFloor = Math.min(experimentalMinMotifScoreFloor, experimentalMaxMotifScoreCeiling);
  const adaptiveMotifScoreCeiling = Math.max(experimentalMinMotifScoreFloor, experimentalMaxMotifScoreCeiling);

  const requestRetries = readInt(flags, "request-retries", 3, { min: 0, max: 25 });
  const retryBaseDelayMs = readInt(flags, "retry-base-delay-ms", 2500, { min: 0, max: 300_000 });
  const retryBackoffFactor = readNumber(flags, "retry-backoff-factor", 1.9, { min: 1, max: 4 });
  const retryMaxDelayMs = readInt(flags, "retry-max-delay-ms", 45_000, { min: 1, max: 600_000 });
  const retryJitterMs = readInt(flags, "retry-jitter-ms", 750, { min: 0, max: 120_000 });
  const maxConsecutiveHttpErrors = readInt(flags, "max-consecutive-http-errors", 4, { min: 1, max: 100 });
  const cooldownAfterHttpErrorMs = readInt(flags, "cooldown-after-http-error-ms", 12_000, { min: 0, max: 900_000 });
  const adaptiveDownshiftOnHttpError = readBool(flags, "adaptive-downshift-on-http-error", true);
  const minWaveLimit = readInt(flags, "min-wave-limit", 200, { min: 1, max: 20_000 });
  const minWaveWrites = readInt(flags, "min-wave-writes", 50, { min: 1, max: 20_000 });
  const downshiftFactor = readNumber(flags, "downshift-factor", 0.6, { min: 0.1, max: 0.99 });

  const forcedReindexEvery = readInt(flags, "forced-reindex-every", 12, { min: 0, max: 10_000 });
  const forcedReindexWrites = readInt(flags, "forced-reindex-writes", 200, { min: 1, max: 20_000 });

  const guardDownshiftFactor = readNumber(flags, "guard-downshift-factor", 0.75, { min: 0.2, max: 0.99 });
  const guardRecoveryFactor = readNumber(flags, "guard-recovery-factor", 0.35, { min: 0.01, max: 1 });
  const guardMinLimit = readInt(flags, "guard-min-limit", 300, { min: 1, max: 20_000 });
  const guardMinMaxWrites = readInt(flags, "guard-min-max-writes", 100, { min: 1, max: 20_000 });
  const pauseAfterFailedCycleMs = readInt(flags, "pause-after-failed-cycle-ms", 180_000, {
    min: 0,
    max: 7_200_000,
  });
  const phaseFailureThreshold = readInt(flags, "phase-failure-threshold", 3, { min: 1, max: 100 });
  const phaseCooldownCycles = readInt(flags, "phase-cooldown-cycles", 3, { min: 1, max: 10_000 });
  const pressureDeferCooldownCycles = readInt(flags, "pressure-defer-cooldown-cycles", 2, { min: 0, max: 10_000 });
  const autoProfileSwitch = readBool(flags, "auto-profile-switch", true);
  const ingestLimitFactor = readNumber(flags, "ingest-limit-factor", 0.45, { min: 0.05, max: 1 });
  const ingestWritesFactor = readNumber(flags, "ingest-writes-factor", 0.35, { min: 0.05, max: 1 });
  const catchupLimitFactor = readNumber(flags, "catchup-limit-factor", 1.5, { min: 1, max: 6 });
  const catchupWritesFactor = readNumber(flags, "catchup-writes-factor", 1.4, { min: 1, max: 6 });
  const catchupPromoteHealthyCycles = readInt(flags, "catchup-promote-healthy-cycles", 3, { min: 1, max: 100 });
  const ingestDemoteDeferredPhases = readInt(flags, "ingest-demote-deferred-phases", 1, { min: 1, max: 100 });
  const historyLimit = readInt(flags, "history-limit", 200, { min: 5, max: 10_000 });

  const reportPath = readString(flags, "report", DEFAULT_REPORT_PATH);

  const startedAt = new Date().toISOString();
  const history = [];
  let cycle = 0;
  let keepGoing = true;
  let adaptiveLimit = limit;
  let adaptiveMaxWrites = maxWrites;
  let consecutiveFailedCycles = 0;
  let consecutiveHealthyCycles = 0;
  let healthyNoDeferredCycles = 0;
  let profileMode = "normal";
  let profileTargets = {
    mode: profileMode,
    limit,
    maxWrites,
  };
  let adaptiveExperimental = {
    searchLimit: experimentalSearchLimit,
    searchSeedLimit: experimentalSearchSeedLimit,
    maxSearchQueries: experimentalMaxSearchQueries,
    fallbackMaxWrites: experimentalFallbackMaxWrites,
    rerankTopK: experimentalRerankTopK,
    edgeConfidence: Math.min(adaptiveEdgeConfidenceCeiling, Math.max(adaptiveEdgeConfidenceFloor, experimentalMinEdgeConfidence)),
    motifScore: Math.min(adaptiveMotifScoreCeiling, Math.max(adaptiveMotifScoreFloor, experimentalMinMotifScore)),
  };
  const phaseState = Object.fromEntries(
    phases.map((phase) => [
      phase,
      {
        consecutiveFailures: 0,
        cooldownRemaining: 0,
        pressureCooldownRemaining: 0,
        lastStatus: "idle",
      },
    ])
  );

  const resolveProfileTargets = (mode) => {
    if (mode === "ingest") {
      return {
        mode,
        limit: Math.max(guardMinLimit, Math.floor(limit * ingestLimitFactor)),
        maxWrites: Math.max(guardMinMaxWrites, Math.floor(maxWrites * ingestWritesFactor)),
      };
    }
    if (mode === "catchup") {
      return {
        mode,
        limit: Math.min(20_000, Math.max(guardMinLimit, Math.floor(limit * catchupLimitFactor))),
        maxWrites: Math.min(20_000, Math.max(guardMinMaxWrites, Math.floor(maxWrites * catchupWritesFactor))),
      };
    }
    return {
      mode: "normal",
      limit,
      maxWrites,
    };
  };

  const resolveExperimentalTargets = (mode) => {
    const factor =
      mode === "ingest"
        ? experimentalProfileIngestFactor
        : mode === "catchup"
          ? experimentalProfileCatchupFactor
          : 1;
    return {
      searchLimit: Math.max(
        experimentalMinSearchLimit,
        Math.min(200, Math.floor(experimentalSearchLimit * factor))
      ),
      searchSeedLimit: Math.max(
        experimentalMinSearchSeedLimit,
        Math.min(100, Math.floor(experimentalSearchSeedLimit * factor))
      ),
      maxSearchQueries: Math.max(
        experimentalMinMaxSearchQueries,
        Math.min(100, Math.floor(experimentalMaxSearchQueries * factor))
      ),
      fallbackMaxWrites: Math.max(
        experimentalMinFallbackMaxWrites,
        Math.min(500, Math.floor(experimentalFallbackMaxWrites * factor))
      ),
      rerankTopK: Math.max(
        experimentalMinRerankTopK,
        Math.min(5000, Math.floor(experimentalRerankTopK * factor))
      ),
      edgeConfidence: Math.min(adaptiveEdgeConfidenceCeiling, Math.max(adaptiveEdgeConfidenceFloor, experimentalMinEdgeConfidence)),
      motifScore: Math.min(adaptiveMotifScoreCeiling, Math.max(adaptiveMotifScoreFloor, experimentalMinMotifScore)),
    };
  };

  while (keepGoing) {
    cycle += 1;
    const cycleStartedAt = new Date().toISOString();
    const phaseReports = [];

    profileTargets = resolveProfileTargets(profileMode);
    if (adaptiveLimit > profileTargets.limit) {
      adaptiveLimit = Math.max(profileTargets.limit, Math.floor(adaptiveLimit * guardDownshiftFactor));
    } else if (adaptiveLimit < profileTargets.limit) {
      adaptiveLimit = scaleUp(adaptiveLimit, profileTargets.limit, guardRecoveryFactor);
    }
    if (adaptiveMaxWrites > profileTargets.maxWrites) {
      adaptiveMaxWrites = Math.max(profileTargets.maxWrites, Math.floor(adaptiveMaxWrites * guardDownshiftFactor));
    } else if (adaptiveMaxWrites < profileTargets.maxWrites) {
      adaptiveMaxWrites = scaleUp(adaptiveMaxWrites, profileTargets.maxWrites, guardRecoveryFactor);
    }
    const experimentalTargets = resolveExperimentalTargets(profileMode);
    if (experimentalAdaptiveMode) {
      if (adaptiveExperimental.searchLimit > experimentalTargets.searchLimit) {
        adaptiveExperimental.searchLimit = Math.max(
          experimentalTargets.searchLimit,
          Math.floor(adaptiveExperimental.searchLimit * guardDownshiftFactor)
        );
      } else if (adaptiveExperimental.searchLimit < experimentalTargets.searchLimit) {
        adaptiveExperimental.searchLimit = scaleUp(
          adaptiveExperimental.searchLimit,
          experimentalTargets.searchLimit,
          guardRecoveryFactor
        );
      }
      if (adaptiveExperimental.searchSeedLimit > experimentalTargets.searchSeedLimit) {
        adaptiveExperimental.searchSeedLimit = Math.max(
          experimentalTargets.searchSeedLimit,
          Math.floor(adaptiveExperimental.searchSeedLimit * guardDownshiftFactor)
        );
      } else if (adaptiveExperimental.searchSeedLimit < experimentalTargets.searchSeedLimit) {
        adaptiveExperimental.searchSeedLimit = scaleUp(
          adaptiveExperimental.searchSeedLimit,
          experimentalTargets.searchSeedLimit,
          guardRecoveryFactor
        );
      }
      if (adaptiveExperimental.maxSearchQueries > experimentalTargets.maxSearchQueries) {
        adaptiveExperimental.maxSearchQueries = Math.max(
          experimentalTargets.maxSearchQueries,
          Math.floor(adaptiveExperimental.maxSearchQueries * guardDownshiftFactor)
        );
      } else if (adaptiveExperimental.maxSearchQueries < experimentalTargets.maxSearchQueries) {
        adaptiveExperimental.maxSearchQueries = scaleUp(
          adaptiveExperimental.maxSearchQueries,
          experimentalTargets.maxSearchQueries,
          guardRecoveryFactor
        );
      }
      if (adaptiveExperimental.fallbackMaxWrites > experimentalTargets.fallbackMaxWrites) {
        adaptiveExperimental.fallbackMaxWrites = Math.max(
          experimentalTargets.fallbackMaxWrites,
          Math.floor(adaptiveExperimental.fallbackMaxWrites * guardDownshiftFactor)
        );
      } else if (adaptiveExperimental.fallbackMaxWrites < experimentalTargets.fallbackMaxWrites) {
        adaptiveExperimental.fallbackMaxWrites = scaleUp(
          adaptiveExperimental.fallbackMaxWrites,
          experimentalTargets.fallbackMaxWrites,
          guardRecoveryFactor
        );
      }
      if (adaptiveExperimental.rerankTopK > experimentalTargets.rerankTopK) {
        adaptiveExperimental.rerankTopK = Math.max(
          experimentalTargets.rerankTopK,
          Math.floor(adaptiveExperimental.rerankTopK * guardDownshiftFactor)
        );
      } else if (adaptiveExperimental.rerankTopK < experimentalTargets.rerankTopK) {
        adaptiveExperimental.rerankTopK = scaleUp(
          adaptiveExperimental.rerankTopK,
          experimentalTargets.rerankTopK,
          guardRecoveryFactor
        );
      }
      if (experimentalAdaptiveThresholds) {
        if (adaptiveExperimental.edgeConfidence > experimentalTargets.edgeConfidence) {
          adaptiveExperimental.edgeConfidence = Math.max(
            experimentalTargets.edgeConfidence,
            Number((adaptiveExperimental.edgeConfidence * guardDownshiftFactor).toFixed(4))
          );
        } else if (adaptiveExperimental.edgeConfidence < experimentalTargets.edgeConfidence) {
          adaptiveExperimental.edgeConfidence = Math.min(
            experimentalTargets.edgeConfidence,
            Number(
              (
                adaptiveExperimental.edgeConfidence +
                (experimentalTargets.edgeConfidence - adaptiveExperimental.edgeConfidence) * guardRecoveryFactor
              ).toFixed(4)
            )
          );
        }
        adaptiveExperimental.edgeConfidence = Math.min(
          adaptiveEdgeConfidenceCeiling,
          Math.max(adaptiveEdgeConfidenceFloor, adaptiveExperimental.edgeConfidence)
        );
        if (adaptiveExperimental.motifScore > experimentalTargets.motifScore) {
          adaptiveExperimental.motifScore = Math.max(
            experimentalTargets.motifScore,
            Number((adaptiveExperimental.motifScore * guardDownshiftFactor).toFixed(4))
          );
        } else if (adaptiveExperimental.motifScore < experimentalTargets.motifScore) {
          adaptiveExperimental.motifScore = Math.min(
            experimentalTargets.motifScore,
            Number(
              (
                adaptiveExperimental.motifScore +
                (experimentalTargets.motifScore - adaptiveExperimental.motifScore) * guardRecoveryFactor
              ).toFixed(4)
            )
          );
        }
        adaptiveExperimental.motifScore = Math.min(
          adaptiveMotifScoreCeiling,
          Math.max(adaptiveMotifScoreFloor, adaptiveExperimental.motifScore)
        );
      }
    } else {
      adaptiveExperimental = { ...experimentalTargets };
    }

    const baseArgs = [
      "--limit",
      String(adaptiveLimit),
      "--timeout-ms",
      String(timeoutMs),
      "--relationship-probe-limit",
      String(relationshipProbeLimit),
      "--max-inferred-edges-per-memory",
      String(maxInferredEdgesPerMemory),
      "--min-related-signal-score",
      String(minRelatedSignalScore),
      "--request-retries",
      String(requestRetries),
      "--retry-base-delay-ms",
      String(retryBaseDelayMs),
      "--retry-backoff-factor",
      String(retryBackoffFactor),
      "--retry-max-delay-ms",
      String(retryMaxDelayMs),
      "--retry-jitter-ms",
      String(retryJitterMs),
      "--max-consecutive-http-errors",
      String(maxConsecutiveHttpErrors),
      "--cooldown-after-http-error-ms",
      String(cooldownAfterHttpErrorMs),
      "--adaptive-downshift-on-http-error",
      String(adaptiveDownshiftOnHttpError),
      "--min-wave-limit",
      String(minWaveLimit),
      "--min-wave-writes",
      String(minWaveWrites),
      "--downshift-factor",
      String(downshiftFactor),
    ];

    for (const phase of phases) {
      const isExperimentalPhase = phase === "experimental-context";
      const phaseScript = isExperimentalPhase ? EXPERIMENTAL_CONTEXT_SCRIPT_PATH : CONVERGE_SCRIPT_PATH;
      const state = phaseState[phase];
      if (state && state.cooldownRemaining > 0) {
        state.cooldownRemaining = Math.max(0, state.cooldownRemaining - 1);
        state.lastStatus = "cooldown";
        phaseReports.push({
          phase,
          skipped: true,
          skipReason: "phase-cooldown",
          cooldownRemaining: state.cooldownRemaining,
          dryRun: null,
          apply: null,
        });
        continue;
      }
      if (state && state.pressureCooldownRemaining > 0) {
        state.pressureCooldownRemaining = Math.max(0, state.pressureCooldownRemaining - 1);
        state.lastStatus = "pressure-cooldown";
        phaseReports.push({
          phase,
          skipped: true,
          skipReason: "pressure-cooldown",
          pressureCooldownRemaining: state.pressureCooldownRemaining,
          dryRun: null,
          apply: null,
        });
        continue;
      }

      const dry = await runConvergeWithRetries(
        isExperimentalPhase
          ? [
              "--dry-run",
              "true",
              "--limit",
              String(adaptiveLimit),
              "--search-limit",
              String(adaptiveExperimental.searchLimit),
              "--search-seed-limit",
              String(adaptiveExperimental.searchSeedLimit),
              "--max-search-queries",
              String(adaptiveExperimental.maxSearchQueries),
              "--rerank-top-k",
              String(adaptiveExperimental.rerankTopK),
              "--rerank-signal-weight",
              String(experimentalRerankSignalWeight),
              "--rerank-recency-weight",
              String(experimentalRerankRecencyWeight),
              "--rerank-seed-overlap-weight",
              String(experimentalRerankSeedOverlapWeight),
              "--rerank-query-rank-weight",
              String(experimentalRerankQueryRankWeight),
              "--defer-on-pressure",
              String(experimentalDeferOnPressure),
              "--pressure-timeout-ms",
              String(experimentalPressureTimeoutMs),
              "--participant-noise-filter",
              String(experimentalParticipantNoiseFilter),
              "--max-consecutive-search-failures",
              String(experimentalMaxConsecutiveSearchFailures),
              "--recent-retries",
              String(experimentalRecentRetries),
              "--recent-retry-delay-ms",
              String(experimentalRecentRetryDelayMs),
              "--max-writes",
              String(adaptiveMaxWrites),
              "--write-delay-ms",
              String(writeDelayMs),
              "--min-edge-support",
              String(experimentalMinEdgeSupport),
              "--dedupe-window-days",
              String(experimentalDedupeWindowDays),
              "--novelty-weight",
              String(experimentalNoveltyWeight),
              "--refresh-confidence-delta",
              String(experimentalRefreshConfidenceDelta),
              "--min-edge-confidence",
              String(adaptiveExperimental.edgeConfidence),
              "--min-motif-score",
              String(adaptiveExperimental.motifScore),
              "--max-motifs",
              String(experimentalMaxMotifs),
              "--max-edges",
              String(experimentalMaxEdges),
              "--capture-source",
              experimentalCaptureSource,
              "--source-prefixes",
              experimentalSourcePrefixes.join(","),
              "--include-non-mail-like",
              String(experimentalIncludeNonMailLike),
              "--timeout-ms",
              String(timeoutMs),
            ]
          : [
              "--mode",
              phase,
              "--dry-run",
              "true",
              "--skip-already-indexed",
              "true",
              "--infer-relationships",
              "true",
              "--max-waves",
              String(dryRunMaxWaves),
              ...baseArgs,
            ],
        {
          attempts: phaseRunRetries + 1,
          retryDelayMs: phaseRunRetryDelayMs,
          timeoutMs: phaseRunTimeoutMs,
          scriptPath: phaseScript,
        }
      );

      const drySummary = summarizeConverge(dry.lastRun);
      const phaseReport = {
        phase,
        executor: isExperimentalPhase ? "experimental-context-index" : "backfill-converge",
        dryRun: {
          ok: dry.ok,
          attempts: dry.attempts,
          timedOut: Boolean(dry.lastRun?.timedOut),
          summary: drySummary,
          stopReason: firstPhaseStopReason(dry.lastRun),
          lastMessage: firstPhaseLastMessage(dry.lastRun),
          stderr: dry.lastRun?.stderr ?? null,
        },
        apply: null,
      };
      const discoveryFailureText = String(
        dry.lastRun?.stderr ?? dry.lastRun?.stdout ?? dry.lastRun?.result?.message ?? ""
      );
      const discoveryErrorsSerialized = JSON.stringify(dry.lastRun?.result?.errors ?? []);
      const discoveryStopReason = String(phaseReport.dryRun?.stopReason ?? "");
      const discoveryTimedOutOrFetchFailed = /unable to fetch recent memories|timed out|timeout exceeded|request-failed/i.test(
        `${discoveryFailureText} ${discoveryErrorsSerialized}`
      );
      const discoveryNoSourceAfterRecentFailure =
        dry.ok &&
        drySummary.eligible <= 0 &&
        /no-source-rows|recent-fetch-failed/i.test(discoveryStopReason) &&
        /recent-fetch-failed|request-failed|unable to fetch recent/i.test(
          `${discoveryFailureText} ${discoveryErrorsSerialized}`
        );

      if (dry.ok && drySummary.eligible > 0) {
        const apply = await runConvergeWithRetries(
          isExperimentalPhase
            ? [
                "--dry-run",
                "false",
                "--limit",
                String(adaptiveLimit),
                "--search-limit",
                String(adaptiveExperimental.searchLimit),
                "--search-seed-limit",
                String(adaptiveExperimental.searchSeedLimit),
                "--max-search-queries",
                String(adaptiveExperimental.maxSearchQueries),
                "--rerank-top-k",
                String(adaptiveExperimental.rerankTopK),
                "--rerank-signal-weight",
                String(experimentalRerankSignalWeight),
                "--rerank-recency-weight",
                String(experimentalRerankRecencyWeight),
                "--rerank-seed-overlap-weight",
                String(experimentalRerankSeedOverlapWeight),
                "--rerank-query-rank-weight",
                String(experimentalRerankQueryRankWeight),
                "--defer-on-pressure",
                String(experimentalDeferOnPressure),
                "--pressure-timeout-ms",
                String(experimentalPressureTimeoutMs),
                "--participant-noise-filter",
                String(experimentalParticipantNoiseFilter),
                "--max-consecutive-search-failures",
                String(experimentalMaxConsecutiveSearchFailures),
                "--recent-retries",
                String(experimentalRecentRetries),
                "--recent-retry-delay-ms",
                String(experimentalRecentRetryDelayMs),
                "--max-writes",
                String(adaptiveMaxWrites),
                "--write-delay-ms",
                String(writeDelayMs),
                "--min-edge-support",
                String(experimentalMinEdgeSupport),
                "--dedupe-window-days",
                String(experimentalDedupeWindowDays),
                "--novelty-weight",
                String(experimentalNoveltyWeight),
                "--refresh-confidence-delta",
                String(experimentalRefreshConfidenceDelta),
                "--min-edge-confidence",
                String(adaptiveExperimental.edgeConfidence),
                "--min-motif-score",
                String(adaptiveExperimental.motifScore),
                "--max-motifs",
                String(experimentalMaxMotifs),
                "--max-edges",
                String(experimentalMaxEdges),
                "--capture-source",
                experimentalCaptureSource,
                "--source-prefixes",
                experimentalSourcePrefixes.join(","),
                "--include-non-mail-like",
                String(experimentalIncludeNonMailLike),
                "--timeout-ms",
                String(timeoutMs),
              ]
            : [
                "--mode",
                phase,
                "--dry-run",
                "false",
                "--skip-already-indexed",
                "true",
                "--infer-relationships",
                "true",
                "--max-waves",
                String(applyMaxWaves),
                "--max-writes",
                String(adaptiveMaxWrites),
                "--write-delay-ms",
                String(writeDelayMs),
                ...baseArgs,
              ],
          {
            attempts: phaseRunRetries + 1,
            retryDelayMs: phaseRunRetryDelayMs,
            timeoutMs: phaseRunTimeoutMs,
            scriptPath: phaseScript,
          }
        );
        phaseReport.apply = {
          ok: apply.ok,
          attempts: apply.attempts,
          timedOut: Boolean(apply.lastRun?.timedOut),
          summary: summarizeConverge(apply.lastRun),
          stopReason: firstPhaseStopReason(apply.lastRun),
          lastMessage: firstPhaseLastMessage(apply.lastRun),
          stderr: apply.lastRun?.stderr ?? null,
        };
      } else if (
        isExperimentalPhase &&
        experimentalFallbackCaptureOnDiscoveryFailure &&
        ((!dry.ok && discoveryTimedOutOrFetchFailed) || discoveryNoSourceAfterRecentFailure)
      ) {
        const fallbackApply = await runConvergeWithRetries(
          [
            "--dry-run",
            "false",
            "--preview-path",
            experimentalPreviewPath,
            "--max-writes",
            String(Math.max(1, Math.min(adaptiveMaxWrites, adaptiveExperimental.fallbackMaxWrites))),
            "--write-delay-ms",
            String(writeDelayMs),
            "--timeout-ms",
            String(experimentalFallbackTimeoutMs),
            "--defer-on-pressure",
            String(experimentalDeferOnPressure),
            "--pressure-timeout-ms",
            String(experimentalPressureTimeoutMs),
          ],
          {
            attempts: phaseRunRetries + 1,
            retryDelayMs: phaseRunRetryDelayMs,
            timeoutMs: phaseRunTimeoutMs,
            scriptPath: EXPERIMENTAL_CAPTURE_SCRIPT_PATH,
          }
        );
        phaseReport.apply = {
          ok: fallbackApply.ok,
          attempts: fallbackApply.attempts,
          timedOut: Boolean(fallbackApply.lastRun?.timedOut),
          summary: summarizeConverge(fallbackApply.lastRun),
          stopReason: firstPhaseStopReason(fallbackApply.lastRun),
          lastMessage: firstPhaseLastMessage(fallbackApply.lastRun),
          stderr: fallbackApply.lastRun?.stderr ?? null,
          fallbackCaptureApplied: true,
        };
      }

      const lastMessage = String(phaseReport.apply?.lastMessage ?? phaseReport.dryRun?.lastMessage ?? "");
      const pressureDeferred = /deferred due current memory ingest pressure/i.test(lastMessage);
      phaseReport.pressureDeferred = pressureDeferred;

      const applyAttempted = Boolean(phaseReport.apply);
      const phaseHealthy = applyAttempted ? Boolean(phaseReport.apply?.ok) : Boolean(phaseReport.dryRun?.ok);
      if (state) {
        if (pressureDeferred) {
          state.consecutiveFailures = 0;
          state.pressureCooldownRemaining = pressureDeferCooldownCycles;
          state.lastStatus = "deferred";
        } else if (phaseHealthy) {
          state.consecutiveFailures = 0;
          state.pressureCooldownRemaining = 0;
          state.lastStatus = "ok";
        } else {
          state.consecutiveFailures += 1;
          state.pressureCooldownRemaining = 0;
          state.lastStatus = "failed";
          if (state.consecutiveFailures >= phaseFailureThreshold) {
            state.cooldownRemaining = phaseCooldownCycles;
            state.consecutiveFailures = 0;
            phaseReport.phaseBreakerTripped = true;
            phaseReport.cooldownCyclesScheduled = phaseCooldownCycles;
          }
        }
      }

      if (isExperimentalPhase && experimentalAdaptiveMode) {
        const experimentalTargetsForPhase = resolveExperimentalTargets(profileMode);
        const rerankAvgScore = Number(
          phaseReport.apply?.summary?.rerankAvgScore ?? phaseReport.dryRun?.summary?.rerankAvgScore ?? 0
        );
        const rerankRetained = Number(
          phaseReport.apply?.summary?.rerankRowsRetained ?? phaseReport.dryRun?.summary?.rerankRowsRetained ?? 0
        );
        const capturesWritten = Number(
          phaseReport.apply?.summary?.capturesWritten ?? phaseReport.dryRun?.summary?.capturesWritten ?? 0
        );
        const candidateSignals =
          Number(phaseReport.apply?.summary?.motifsDetected ?? phaseReport.dryRun?.summary?.motifsDetected ?? 0) +
          Number(
            phaseReport.apply?.summary?.relationshipCandidates ??
              phaseReport.dryRun?.summary?.relationshipCandidates ??
              0
          );
        const noveltySuppressed = Number(
          phaseReport.apply?.summary?.noveltySuppressedCandidates ??
            phaseReport.dryRun?.summary?.noveltySuppressedCandidates ??
            0
        );
        const noveltySuppressionRate = noveltySuppressed / Math.max(1, candidateSignals + noveltySuppressed);
        let adaptiveReason = pressureDeferred ? "pressure-deferred-downshift" : phaseHealthy ? "healthy-recovery" : "failure-downshift";
        if (pressureDeferred || !phaseHealthy) {
          adaptiveExperimental.searchLimit = scaleDown(
            adaptiveExperimental.searchLimit,
            experimentalMinSearchLimit,
            guardDownshiftFactor
          );
          adaptiveExperimental.searchSeedLimit = scaleDown(
            adaptiveExperimental.searchSeedLimit,
            experimentalMinSearchSeedLimit,
            guardDownshiftFactor
          );
          adaptiveExperimental.maxSearchQueries = scaleDown(
            adaptiveExperimental.maxSearchQueries,
            experimentalMinMaxSearchQueries,
            guardDownshiftFactor
          );
          adaptiveExperimental.fallbackMaxWrites = scaleDown(
            adaptiveExperimental.fallbackMaxWrites,
            experimentalMinFallbackMaxWrites,
            guardDownshiftFactor
          );
          adaptiveExperimental.rerankTopK = scaleDown(
            adaptiveExperimental.rerankTopK,
            experimentalMinRerankTopK,
            guardDownshiftFactor
          );
          if (experimentalAdaptiveThresholds && pressureDeferred) {
            adaptiveReason = "pressure-deferred-hold-thresholds";
          }
        } else {
          adaptiveExperimental.searchLimit = scaleUp(
            adaptiveExperimental.searchLimit,
            experimentalTargetsForPhase.searchLimit,
            guardRecoveryFactor
          );
          adaptiveExperimental.searchSeedLimit = scaleUp(
            adaptiveExperimental.searchSeedLimit,
            experimentalTargetsForPhase.searchSeedLimit,
            guardRecoveryFactor
          );
          adaptiveExperimental.maxSearchQueries = scaleUp(
            adaptiveExperimental.maxSearchQueries,
            experimentalTargetsForPhase.maxSearchQueries,
            guardRecoveryFactor
          );
          adaptiveExperimental.fallbackMaxWrites = scaleUp(
            adaptiveExperimental.fallbackMaxWrites,
            experimentalTargetsForPhase.fallbackMaxWrites,
            guardRecoveryFactor
          );
          adaptiveExperimental.rerankTopK = scaleUp(
            adaptiveExperimental.rerankTopK,
            experimentalTargetsForPhase.rerankTopK,
            guardRecoveryFactor
          );
          if (rerankRetained > 0 && rerankAvgScore < 0.2) {
            adaptiveExperimental.searchSeedLimit = Math.min(100, adaptiveExperimental.searchSeedLimit + 1);
            adaptiveExperimental.maxSearchQueries = Math.min(100, adaptiveExperimental.maxSearchQueries + 1);
            adaptiveReason = "quality-low-expand-query-diversity";
          } else if (
            rerankRetained > 0 &&
            rerankAvgScore > 0.5 &&
            rerankRetained >= Math.floor(adaptiveExperimental.rerankTopK * 0.8)
          ) {
            adaptiveExperimental.searchLimit = Math.max(
              experimentalMinSearchLimit,
              adaptiveExperimental.searchLimit - 2
            );
            adaptiveReason = "quality-high-trim-search-volume";
          }
          if (experimentalAdaptiveThresholds) {
            if (noveltySuppressionRate >= 0.45) {
              adaptiveExperimental.edgeConfidence = Math.min(
                adaptiveEdgeConfidenceCeiling,
                Number((adaptiveExperimental.edgeConfidence + 0.02).toFixed(4))
              );
              adaptiveExperimental.motifScore = Math.min(
                adaptiveMotifScoreCeiling,
                Number((adaptiveExperimental.motifScore + 0.08).toFixed(4))
              );
              adaptiveReason = "novelty-duplicate-pressure-raise-thresholds";
            } else if (rerankRetained > 0 && rerankAvgScore < 0.18) {
              adaptiveExperimental.edgeConfidence = Math.min(
                adaptiveEdgeConfidenceCeiling,
                Number((adaptiveExperimental.edgeConfidence + 0.015).toFixed(4))
              );
              adaptiveExperimental.motifScore = Math.min(
                adaptiveMotifScoreCeiling,
                Number((adaptiveExperimental.motifScore + 0.06).toFixed(4))
              );
              adaptiveReason = "quality-low-raise-thresholds";
            } else if (capturesWritten <= 1 && candidateSignals >= 6) {
              adaptiveExperimental.edgeConfidence = Math.max(
                adaptiveEdgeConfidenceFloor,
                Number((adaptiveExperimental.edgeConfidence - 0.015).toFixed(4))
              );
              adaptiveExperimental.motifScore = Math.max(
                adaptiveMotifScoreFloor,
                Number((adaptiveExperimental.motifScore - 0.05).toFixed(4))
              );
              adaptiveReason = "low-yield-lower-thresholds";
            } else if (
              capturesWritten >= Math.max(4, Math.floor(adaptiveMaxWrites * 0.7)) &&
              noveltySuppressionRate <= 0.12 &&
              rerankAvgScore >= 0.45
            ) {
              adaptiveExperimental.edgeConfidence = Math.min(
                adaptiveEdgeConfidenceCeiling,
                Number((adaptiveExperimental.edgeConfidence + 0.01).toFixed(4))
              );
              adaptiveExperimental.motifScore = Math.min(
                adaptiveMotifScoreCeiling,
                Number((adaptiveExperimental.motifScore + 0.04).toFixed(4))
              );
              adaptiveReason = "high-throughput-tighten-thresholds";
            }
          }
        }
        if (experimentalAdaptiveThresholds) {
          adaptiveExperimental.edgeConfidence = Math.min(
            adaptiveEdgeConfidenceCeiling,
            Math.max(adaptiveEdgeConfidenceFloor, adaptiveExperimental.edgeConfidence)
          );
          adaptiveExperimental.motifScore = Math.min(
            adaptiveMotifScoreCeiling,
            Math.max(adaptiveMotifScoreFloor, adaptiveExperimental.motifScore)
          );
        }
        phaseReport.experimentalAdaptive = {
          reason: adaptiveReason,
          noveltySuppressedCandidates: noveltySuppressed,
          noveltySuppressionRate: Number(noveltySuppressionRate.toFixed(4)),
          rerankAvgScore: Number(rerankAvgScore.toFixed(4)),
          ...adaptiveExperimental,
        };
      }

      phaseReports.push(phaseReport);
    }

    let forcedReindex = null;
    if (forcedReindexEvery > 0 && cycle % forcedReindexEvery === 0) {
      const run = await runConvergeWithRetries(
        [
          "--mode",
          "global-signal",
          "--dry-run",
          "false",
          "--skip-already-indexed",
          "false",
          "--infer-relationships",
          "true",
          "--max-waves",
          String(applyMaxWaves),
          "--max-writes",
          String(Math.max(forcedReindexWrites, guardMinMaxWrites)),
          "--write-delay-ms",
          String(writeDelayMs),
          ...baseArgs,
        ],
        {
          attempts: phaseRunRetries + 1,
          retryDelayMs: phaseRunRetryDelayMs,
          timeoutMs: phaseRunTimeoutMs,
        }
      );
      forcedReindex = {
        ok: run.ok,
        attempts: run.attempts,
        timedOut: Boolean(run.lastRun?.timedOut),
        summary: summarizeConverge(run.lastRun),
        stopReason: firstPhaseStopReason(run.lastRun),
        stderr: run.lastRun?.stderr ?? null,
      };
    }

    const successfulDryRuns = phaseReports.filter((row) => !row.apply && row.dryRun?.ok).length;
    const successfulApplyRuns = phaseReports.filter((row) => row.apply?.ok).length;
    const deferredPhases = phaseReports.filter(
      (row) => row.pressureDeferred || row.skipReason === "phase-cooldown" || row.skipReason === "pressure-cooldown"
    ).length;
    const anyHealthyPhase = phaseReports.some((row) => (row.apply ? Boolean(row.apply?.ok) : Boolean(row.dryRun?.ok)));
    const cycleIsFailure = !anyHealthyPhase && deferredPhases === 0;
    const aggregate = aggregatePhaseSummary(phaseReports);

    if (cycleIsFailure) {
      consecutiveFailedCycles += 1;
      consecutiveHealthyCycles = 0;
      healthyNoDeferredCycles = 0;
      adaptiveLimit = scaleDown(adaptiveLimit, Math.min(guardMinLimit, limit), guardDownshiftFactor);
      adaptiveMaxWrites = scaleDown(adaptiveMaxWrites, Math.min(guardMinMaxWrites, maxWrites), guardDownshiftFactor);
    } else {
      consecutiveFailedCycles = 0;
      consecutiveHealthyCycles += 1;
      if (deferredPhases === 0 && anyHealthyPhase) {
        healthyNoDeferredCycles += 1;
      } else {
        healthyNoDeferredCycles = 0;
      }
      adaptiveLimit = scaleUp(adaptiveLimit, profileTargets.limit, guardRecoveryFactor);
      adaptiveMaxWrites = scaleUp(adaptiveMaxWrites, profileTargets.maxWrites, guardRecoveryFactor);
    }

    if (autoProfileSwitch) {
      if (deferredPhases >= ingestDemoteDeferredPhases) {
        profileMode = "ingest";
      } else if (healthyNoDeferredCycles >= catchupPromoteHealthyCycles) {
        profileMode = "catchup";
      } else {
        profileMode = "normal";
      }
      profileTargets = resolveProfileTargets(profileMode);
    }

    const cycleReport = {
      cycle,
      ok: !cycleIsFailure,
      startedAt: cycleStartedAt,
      finishedAt: new Date().toISOString(),
      adaptive: {
        limit: adaptiveLimit,
        maxWrites: adaptiveMaxWrites,
        experimental: {
          ...adaptiveExperimental,
        },
        consecutiveFailedCycles,
        consecutiveHealthyCycles,
      },
      profile: {
        mode: profileMode,
        healthyNoDeferredCycles,
        targets: profileTargets,
      },
      aggregate,
      phases: phaseReports,
      forcedReindex,
    };

    history.push(cycleReport);
    if (history.length > historyLimit) {
      history.splice(0, history.length - historyLimit);
    }

    const snapshot = {
      ok: true,
      startedAt,
      updatedAt: new Date().toISOString(),
      config: {
        cycles,
        intervalMs,
        phases,
        limit,
        maxWrites,
        dryRunMaxWaves,
        applyMaxWaves,
        writeDelayMs,
        timeoutMs,
        phaseRunTimeoutMs,
        phaseRunRetries,
        phaseRunRetryDelayMs,
        relationshipProbeLimit,
        maxInferredEdgesPerMemory,
        minRelatedSignalScore,
        experimentalSourcePrefixes,
        experimentalIncludeNonMailLike,
        experimentalSearchLimit,
        experimentalSearchSeedLimit,
        experimentalMaxSearchQueries,
        experimentalRerankTopK,
        experimentalRerankSignalWeight,
        experimentalRerankRecencyWeight,
        experimentalRerankSeedOverlapWeight,
        experimentalRerankQueryRankWeight,
        experimentalDeferOnPressure,
        experimentalPressureTimeoutMs,
        experimentalParticipantNoiseFilter,
        experimentalMaxConsecutiveSearchFailures,
        experimentalRecentRetries,
        experimentalRecentRetryDelayMs,
        experimentalMinEdgeSupport,
        experimentalMinEdgeConfidence,
        experimentalMinMotifScore,
        experimentalMaxMotifs,
        experimentalMaxEdges,
        experimentalCaptureSource,
        experimentalFallbackCaptureOnDiscoveryFailure,
        experimentalPreviewPath,
        experimentalFallbackMaxWrites,
        experimentalFallbackTimeoutMs,
        experimentalAdaptiveMode,
        experimentalMinSearchLimit,
        experimentalMinSearchSeedLimit,
        experimentalMinMaxSearchQueries,
        experimentalMinFallbackMaxWrites,
        experimentalMinRerankTopK,
        experimentalProfileIngestFactor,
        experimentalProfileCatchupFactor,
        experimentalDedupeWindowDays,
        experimentalNoveltyWeight,
        experimentalRefreshConfidenceDelta,
        experimentalAdaptiveThresholds,
        experimentalMinEdgeConfidenceFloor,
        experimentalMaxEdgeConfidenceCeiling,
        experimentalMinMotifScoreFloor,
        experimentalMaxMotifScoreCeiling,
        requestRetries,
        retryBaseDelayMs,
        retryBackoffFactor,
        retryMaxDelayMs,
        retryJitterMs,
        maxConsecutiveHttpErrors,
        cooldownAfterHttpErrorMs,
        adaptiveDownshiftOnHttpError,
        minWaveLimit,
        minWaveWrites,
        downshiftFactor,
        guardDownshiftFactor,
        guardRecoveryFactor,
        guardMinLimit,
        guardMinMaxWrites,
        pauseAfterFailedCycleMs,
        phaseFailureThreshold,
        phaseCooldownCycles,
        pressureDeferCooldownCycles,
        autoProfileSwitch,
        ingestLimitFactor,
        ingestWritesFactor,
        catchupLimitFactor,
        catchupWritesFactor,
        catchupPromoteHealthyCycles,
        ingestDemoteDeferredPhases,
        forcedReindexEvery,
        forcedReindexWrites,
        historyLimit,
      },
      phaseState,
      latest: cycleReport,
      history,
    };

    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

    process.stdout.write(
      `${JSON.stringify(
        {
          cycle,
          ok: cycleReport.ok,
          adaptive: cycleReport.adaptive,
          aggregate,
          phases: phaseReports.map((row) => ({
            phase: row.phase,
            dryRun: row.dryRun,
            apply: row.apply,
            pressureDeferred: row.pressureDeferred,
            experimentalAdaptive: row.experimentalAdaptive ?? null,
          })),
          forcedReindex,
          reportPath,
        },
        null,
        2
      )}\n`
    );

    if (cycles > 0 && cycle >= cycles) keepGoing = false;
    if (!keepGoing) break;

    const waitMs = cycleIsFailure ? Math.max(intervalMs, pauseAfterFailedCycleMs) : intervalMs;
    await sleep(waitMs);
  }
}

main().catch((error) => {
  process.stderr.write(`open-memory-ingest-guard failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
