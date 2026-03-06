#!/usr/bin/env node

import { spawn } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureParentDir,
  isoNow,
  parseCliArgs,
  readBoolFlag,
  readJson,
  readNumberFlag,
  readStringFlag,
  writeJson,
} from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_WAVE_ROOT = resolve(REPO_ROOT, "./output/memory/production-wave-2026-03-06b");

function usage() {
  process.stdout.write(
    [
      "Open Memory overnight iteration runner",
      "",
      "Usage:",
      "  node ./scripts/open-memory-overnight-iterate.mjs \\",
      "    --wave-root ./output/memory/production-wave-2026-03-06b",
      "",
      "Options:",
      "  --wave-root <path>            Active production wave root",
      "  --run-id <id>                 Stable overnight run id",
      "  --output-root <path>          Overnight output root (default: ./output/memory/<run-id>)",
      "  --heartbeat-seconds <n>       Heartbeat cadence (default: 60)",
      "  --audit-seed <value>          Base audit seed (default: 20260306)",
      "  --audit-seed-count <n>        Aggregate audit seed count (default: 16)",
      "  --mail-sample-limit <n>       Max sampled mail folders (default: 12)",
      "  --mail-review-sample <n>      Review sample size (default: 8)",
      "  --max-iterations <n>          Max strategy iterations (default: 5)",
      "  --auto-promote-safe-wins      Mark the best passing candidate as promoted inside the overnight run",
      "  --run-soak                    Run reliability + portal soak after candidate evaluation",
      "  --json                        Print final summary JSON",
    ].join("\n")
  );
}

function appendText(path, value) {
  ensureParentDir(path);
  appendFileSync(path, value, "utf8");
}

function appendJsonl(path, value) {
  appendText(path, `${JSON.stringify(value)}\n`);
}

function fileExists(path) {
  return Boolean(path) && existsSync(path);
}

function safeReadJson(path, fallback = null) {
  try {
    return readJson(path, fallback);
  } catch {
    return fallback;
  }
}

function sourceRootFromManifest(manifestPath) {
  return String(manifestPath || "").replace(/\/canonical-corpus\/manifest\.json$/, "");
}

function slugify(value) {
  return (
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item"
  );
}

function summarizeCounts(counts) {
  return Object.entries(counts || {})
    .filter(([, value]) => Number.isFinite(value))
    .slice(0, 4)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}

function persistStatus(status, statusPath) {
  status.updatedAt = isoNow();
  writeJson(statusPath, status);
}

function emitHeartbeat(status) {
  const elapsedMs = Math.max(0, Date.now() - new Date(status.startedAt).getTime());
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const label = `${Math.floor(elapsedSeconds / 60)}m${String(elapsedSeconds % 60).padStart(2, "0")}s`;
  const counts = summarizeCounts(status.summary || {});
  return `${isoNow()} [overnight:${status.runId}] phase=${status.currentPhase || "idle"} elapsed=${label}${counts ? ` ${counts}` : ""}`;
}

async function runChild({
  status,
  statusPath,
  eventsPath,
  phase,
  label,
  command,
  args,
  logPath,
  heartbeatSeconds,
}) {
  status.currentPhase = phase;
  status.currentLogPath = logPath;
  persistStatus(status, statusPath);
  appendJsonl(eventsPath, {
    type: "phase_started",
    generatedAt: isoNow(),
    phase,
    label,
    command: [command, ...args].join(" "),
    logPath,
  });
  process.stdout.write(`${isoNow()} [overnight] ${phase} started\n`);

  await new Promise((resolvePromise, rejectPromise) => {
    ensureParentDir(logPath);
    const child = spawn(command, args, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    status.currentChildPid = child.pid;
    persistStatus(status, statusPath);

    const interval = setInterval(() => {
      const line = emitHeartbeat(status);
      process.stdout.write(`${line}\n`);
      appendJsonl(eventsPath, { type: "heartbeat", generatedAt: isoNow(), phase, line });
      persistStatus(status, statusPath);
    }, heartbeatSeconds * 1000);

    child.stdout.on("data", (chunk) => appendText(logPath, String(chunk)));
    child.stderr.on("data", (chunk) => appendText(logPath, String(chunk)));
    child.on("error", (error) => {
      clearInterval(interval);
      status.currentChildPid = null;
      rejectPromise(error);
    });
    child.on("close", (code) => {
      clearInterval(interval);
      status.currentChildPid = null;
      if (code === 0) {
        appendJsonl(eventsPath, { type: "phase_completed", generatedAt: isoNow(), phase, code, logPath });
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

function ensureWaveArtifacts(waveRoot) {
  const required = [
    resolve(waveRoot, "ingest-catalog.json"),
    resolve(waveRoot, "wave-summary.json"),
    resolve(waveRoot, "production-review.json"),
    resolve(waveRoot, "production-audit.json"),
  ];
  for (const path of required) {
    if (!fileExists(path)) throw new Error(`Required wave artifact missing: ${path}`);
  }
}

function collectMailSampleRuns({ catalog, review, singleAudit, limit }) {
  const mailRuns = (catalog.runs || []).filter((run) => run.sourceFamily === "mail");
  const mailSummary = Array.isArray(review?.sourceSummaries)
    ? review.sourceSummaries.find((entry) => String(entry?.sourceFamily) === "mail") || {}
    : {};
  const wantedRunIds = new Set();
  const wantedRoots = new Set();

  for (const run of mailSummary.representativeRuns || []) wantedRunIds.add(String(run.runId || "").trim());
  for (const run of mailSummary.densestRuns || []) wantedRunIds.add(String(run.runId || "").trim());
  for (const entry of mailSummary.mirroredRuns || []) {
    for (const runId of entry.runIds || []) wantedRunIds.add(String(runId || "").trim());
  }
  for (const finding of singleAudit?.findings || []) {
    if (String(finding?.sourceFamily) === "mail" && finding.runRoot) {
      wantedRoots.add(String(finding.runRoot).trim());
    }
  }

  const selected = [];
  for (const run of mailRuns) {
    const root = sourceRootFromManifest(run.manifestPath);
    if (wantedRunIds.has(String(run.runId || "")) || wantedRoots.has(root)) {
      selected.push({ ...run, root });
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const run of selected) {
    const key = String(run.runId || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(run);
  }
  return deduped.slice(0, limit);
}

function buildSubsetArtifacts({ baseCatalog, mailRuns, outputRoot, docsRootOverride = null }) {
  const runs = (baseCatalog.runs || []).filter((run) => ["pst", "twitter", "docs"].includes(String(run.sourceFamily || "")));
  const docsRuns = runs.filter((run) => run.sourceFamily === "docs");
  const fixedRuns = runs.filter((run) => run.sourceFamily !== "docs");
  const finalRuns = [
    ...fixedRuns,
    ...(docsRootOverride && docsRuns.length > 0
      ? docsRuns.map((run) => ({
          ...run,
          manifestPath: resolve(docsRootOverride, "canonical-corpus/manifest.json"),
          sqlitePath: resolve(docsRootOverride, "canonical-corpus/corpus.sqlite"),
        }))
      : docsRuns),
    ...mailRuns.map((run) => ({
      ...run,
      sourceFamily: "mail",
    })),
  ];
  const catalogPath = resolve(outputRoot, "ingest-catalog.json");
  const summaryPath = resolve(outputRoot, "wave-summary.json");
  writeJson(catalogPath, {
    schema: "open-memory-production-catalog.v1",
    generatedAt: isoNow(),
    runCount: finalRuns.length,
    runs: finalRuns,
  });
  writeJson(summaryPath, {
    schema: "open-memory-production-wave-summary.v1",
    generatedAt: isoNow(),
    state: "completed",
    vectors: {
      pst: { status: "validated-baseline" },
      mail: { status: "completed", counts: { completedFolders: mailRuns.length, queuedFolders: mailRuns.length, failedFolders: 0 } },
      twitter: { status: "completed" },
      docs: { status: "completed" },
    },
    postRunReview: { status: "pending", warnings: [] },
  });
  return { catalogPath, summaryPath };
}

function readPromotedRows(path) {
  if (!fileExists(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function countPromoteStats(mailRoots) {
  const stats = { promotedRows: 0, semanticRows: 0, messageInsightSemanticRows: 0, contactFactSemanticRows: 0 };
  for (const root of mailRoots) {
    const rows = readPromotedRows(resolve(root, "mail-promoted-memory.jsonl"));
    stats.promotedRows += rows.length;
    for (const row of rows) {
      const layer = String(row?.metadata?.memoryLayer || "");
      if (layer === "semantic") {
        stats.semanticRows += 1;
        if (String(row?.metadata?.analysisType || "") === "message_insight") {
          stats.messageInsightSemanticRows += 1;
        }
        if (String(row?.metadata?.analysisType || "") === "contact_fact") {
          stats.contactFactSemanticRows += 1;
        }
      }
    }
  }
  return stats;
}

function chooseBestCandidate(results) {
  const passing = results.filter((result) => result.pass);
  if (passing.length === 0) return null;
  return [...passing].sort((a, b) => {
    if (a.scoreDelta !== b.scoreDelta) return b.scoreDelta - a.scoreDelta;
    return b.promoteStats.semanticRows - a.promoteStats.semanticRows;
  })[0];
}

function evaluateCandidate({ baselineAudit, candidateAudit, baselinePromoteStats, candidatePromoteStats }) {
  const baselineSummary = baselineAudit.summary || {};
  const candidateSummary = candidateAudit.summary || {};
  const warnings = [];
  let pass = true;

  const mailHighDelta = Number(baselineSummary.mailHighDriftFindings || 0) - Number(candidateSummary.mailHighDriftFindings || 0);
  const messageHighDelta =
    Number(baselineSummary.mailMessageInsightHighDriftFindings || 0) -
    Number(candidateSummary.mailMessageInsightHighDriftFindings || 0);
  const contactHighDelta =
    Number(baselineSummary.mailContactFactHighDriftFindings || 0) -
    Number(candidateSummary.mailContactFactHighDriftFindings || 0);
  if (mailHighDelta < 0) {
    pass = false;
    warnings.push("mail high-drift findings increased");
  }
  if (messageHighDelta < 0) {
    pass = false;
    warnings.push("mail message_insight high-drift findings increased");
  }
  if (contactHighDelta < 0) {
    pass = false;
    warnings.push("mail contact_fact high-drift findings increased");
  }
  if (Number(candidateSummary.docsHighDriftFindings || 0) > Number(baselineSummary.docsHighDriftFindings || 0)) {
    pass = false;
    warnings.push("docs high-drift findings increased");
  }
  if (Number(candidateSummary.twitterHighDriftFindings || 0) > Number(baselineSummary.twitterHighDriftFindings || 0)) {
    pass = false;
    warnings.push("twitter high-drift findings increased");
  }
  if (candidatePromoteStats.semanticRows < Math.floor(Number(baselinePromoteStats.semanticRows || 0) * 0.8)) {
    pass = false;
    warnings.push("semantic mail coverage regressed too far");
  }
  if (candidatePromoteStats.messageInsightSemanticRows <= 0) {
    pass = false;
    warnings.push("message_insight semantic coverage collapsed to zero");
  }
  if (candidatePromoteStats.contactFactSemanticRows <= 0) {
    pass = false;
    warnings.push("contact_fact semantic coverage collapsed to zero");
  }

  return {
    pass,
    warnings,
    scoreDelta: mailHighDelta + messageHighDelta + contactHighDelta,
  };
}

function candidateStrategies() {
  return [
    {
      id: "grounded-message-insights",
      description: "Normalize source ids and upgrade weak message_insight grounding where direct evidence exists.",
      promoteArgs: ["--ground-message-insights"],
    },
    {
      id: "grounded-strict-message-insights",
      description: "Normalize source ids and demote weak semantic message_insight rows to episodic.",
      promoteArgs: ["--ground-message-insights", "--strict-message-insights"],
    },
    {
      id: "grounded-contact-facts",
      description: "Keep grounded message_insight behavior and improve contact_fact evidence grounding where direct evidence exists.",
      promoteArgs: ["--ground-message-insights", "--strict-message-insights", "--ground-contact-facts"],
    },
    {
      id: "grounded-strict-contact-facts",
      description: "Keep grounded message_insight behavior and demote weak semantic contact_fact rows to episodic.",
      promoteArgs: [
        "--ground-message-insights",
        "--strict-message-insights",
        "--ground-contact-facts",
        "--strict-contact-facts",
      ],
    },
  ];
}

function summaryPaths(outputRoot) {
  return {
    json: resolve(outputRoot, "overnight-summary.json"),
    md: resolve(outputRoot, "overnight-summary.md"),
  };
}

function writeSummaryArtifacts({
  outputRoot,
  runId,
  waveRoot,
  sampledMailRuns,
  baselinePromoteStats,
  bestCandidate,
  candidateResults,
  autoPromoteSafeWins,
  promotedRoot,
  runSoak,
  sidecar,
}) {
  const summary = {
    schema: "open-memory-overnight-summary.v1",
    generatedAt: isoNow(),
    runId,
    waveRoot,
    outputRoot,
    sampledMailRunIds: sampledMailRuns.map((run) => run.runId),
    baselinePromoteStats,
    bestCandidate,
    candidates: candidateResults,
    autoPromoteSafeWins,
    promotedRoot: bestCandidate && autoPromoteSafeWins ? promotedRoot : null,
    soakRequested: Boolean(runSoak),
    soakCompleted: Boolean(sidecar?.soakCompleted),
    sidecarStatus: sidecar?.status || "pending",
    sidecarWarnings: Array.isArray(sidecar?.warnings) ? sidecar.warnings : [],
  };
  const paths = summaryPaths(outputRoot);
  writeJson(paths.json, summary);
  writeFileSync(
    paths.md,
    [
      `# Overnight Summary ${runId}`,
      "",
      `Generated: ${summary.generatedAt}`,
      `Wave root: ${waveRoot}`,
      `Sampled mail runs: ${sampledMailRuns.length}`,
      `Best candidate: ${bestCandidate ? bestCandidate.id : "none"}`,
      `Promoted: ${bestCandidate && autoPromoteSafeWins ? "yes" : "no"}`,
      `Sidecar status: ${summary.sidecarStatus}`,
      ...(summary.sidecarWarnings.length > 0
        ? ["", "## Sidecar Warnings", "", ...summary.sidecarWarnings.map((warning) => `- ${warning}`)]
        : []),
      "",
      "## Candidates",
      "",
      ...candidateResults.map(
        (candidate) => `- ${candidate.id}: pass=${candidate.pass} scoreDelta=${candidate.scoreDelta} warnings=${candidate.warnings.join("; ") || "none"}`
      ),
      "",
    ].join("\n"),
    "utf8"
  );
  return summary;
}

async function runOptionalChild(options) {
  try {
    await runChild(options);
    return { ok: true, warning: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendJsonl(options.eventsPath, {
      type: "phase_warning",
      generatedAt: isoNow(),
      phase: options.phase,
      warning: message,
      logPath: options.logPath,
    });
    process.stdout.write(`${isoNow()} [overnight] ${options.phase} warning: ${message}\n`);
    return { ok: false, warning: `${options.label}: ${message}` };
  }
}

async function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const waveRoot = resolve(REPO_ROOT, readStringFlag(flags, "wave-root", DEFAULT_WAVE_ROOT));
  const runId = readStringFlag(flags, "run-id", `overnight-iterate-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const outputRoot = resolve(REPO_ROOT, readStringFlag(flags, "output-root", `./output/memory/${runId}`));
  const heartbeatSeconds = readNumberFlag(flags, "heartbeat-seconds", 60, { min: 5, max: 3600 });
  const auditSeed = readStringFlag(flags, "audit-seed", "20260306");
  const auditSeedCount = readNumberFlag(flags, "audit-seed-count", 16, { min: 1, max: 100 });
  const mailSampleLimit = readNumberFlag(flags, "mail-sample-limit", 12, { min: 1, max: 50 });
  const mailReviewSample = readNumberFlag(flags, "mail-review-sample", 8, { min: 1, max: 50 });
  const maxIterations = readNumberFlag(flags, "max-iterations", 5, { min: 1, max: 20 });
  const autoPromoteSafeWins = readBoolFlag(flags, "auto-promote-safe-wins", true);
  const runSoak = readBoolFlag(flags, "run-soak", true);
  const resume = readBoolFlag(flags, "resume", true);
  const printJson = readBoolFlag(flags, "json", false);

  ensureWaveArtifacts(waveRoot);
  mkdirSync(outputRoot, { recursive: true });

  const statusPath = resolve(outputRoot, "overnight-status.json");
  const eventsPath = resolve(outputRoot, "overnight-events.jsonl");
  const status = {
    schema: "open-memory-overnight-status.v1",
    runId,
    waveRoot,
    state: "running",
    startedAt: isoNow(),
    updatedAt: isoNow(),
    currentPhase: "preflight",
    currentLogPath: null,
    currentChildPid: null,
    summary: {
      sampledMailRuns: 0,
      candidateIterations: 0,
      passingCandidates: 0,
      bestScoreDelta: 0,
      soakCompleted: 0,
    },
    candidates: [],
    sidecar: {
      status: "pending",
      warnings: [],
      soakCompleted: 0,
    },
  };
  if (resume && fileExists(statusPath)) {
    const prior = safeReadJson(statusPath, null);
    if (prior && typeof prior === "object") {
      status.summary = { ...status.summary, ...(prior.summary || {}) };
      status.candidates = Array.isArray(prior.candidates) ? prior.candidates : [];
      status.sidecar = { ...status.sidecar, ...(prior.sidecar || {}) };
    }
  }
  persistStatus(status, statusPath);
  appendJsonl(eventsPath, { type: "overnight_started", generatedAt: isoNow(), runId, waveRoot, outputRoot });

  const baseCatalog = safeReadJson(resolve(waveRoot, "ingest-catalog.json"), { runs: [] });
  const currentReview = safeReadJson(resolve(waveRoot, "production-review.json"), {});
  const currentAudit = safeReadJson(resolve(waveRoot, "production-audit.json"), {});
  const sampledMailRuns = collectMailSampleRuns({
    catalog: baseCatalog,
    review: currentReview,
    singleAudit: currentAudit,
    limit: mailSampleLimit,
  });
  if (sampledMailRuns.length === 0) throw new Error("No mail runs available for overnight sampling");
  status.summary.sampledMailRuns = sampledMailRuns.length;
  persistStatus(status, statusPath);

  const docsRun = (baseCatalog.runs || []).find((run) => run.sourceFamily === "docs");
  const docsRoot = docsRun ? sourceRootFromManifest(docsRun.manifestPath) : resolve(waveRoot, "sources/docs-v3-candidate");

  const baselineRoot = resolve(outputRoot, "baseline-subset");
  if (!resume || !fileExists(resolve(baselineRoot, "expanded-audit.json"))) {
    buildSubsetArtifacts({ baseCatalog, mailRuns: sampledMailRuns, outputRoot: baselineRoot, docsRootOverride: docsRoot });
    await runChild({
      status,
      statusPath,
      eventsPath,
      phase: "baseline-review",
      label: "Baseline subset review",
      command: process.execPath,
      args: ["./scripts/open-memory-production-review.mjs", "--wave-root", baselineRoot, "--mail-sample", String(mailReviewSample), "--json"],
      logPath: resolve(outputRoot, "baseline-review.log"),
      heartbeatSeconds,
    });
    await runChild({
      status,
      statusPath,
      eventsPath,
      phase: "baseline-audit",
      label: "Baseline expanded audit",
      command: process.execPath,
      args: [
        "./scripts/open-memory-production-audit.mjs",
        "--wave-root",
        baselineRoot,
        "--docs-root",
        docsRoot,
        "--mode",
        "aggregate",
        "--seed",
        auditSeed,
        "--seed-count",
        String(auditSeedCount),
        "--json",
      ],
      logPath: resolve(outputRoot, "baseline-audit.log"),
      heartbeatSeconds,
    });
  }

  const baselineAudit = safeReadJson(resolve(baselineRoot, "expanded-audit.json"), {});
  const baselinePromoteStats = countPromoteStats(sampledMailRuns.map((run) => run.root));
  const strategies = candidateStrategies().slice(0, maxIterations);
  const priorCandidates = new Map(status.candidates.map((entry) => [String(entry.id || ""), entry]));
  const candidateResults = [];

  for (let index = 0; index < strategies.length; index += 1) {
    const strategy = strategies[index];
    const iterationLabel = `${String(index + 1).padStart(2, "0")}-${strategy.id}`;
    const iterationRoot = resolve(outputRoot, `iteration-${iterationLabel}`);
    const cached = resume ? priorCandidates.get(strategy.id) : null;
    if (cached && fileExists(resolve(iterationRoot, "expanded-audit.json"))) {
      candidateResults.push(cached);
      status.summary.candidateIterations = candidateResults.length;
      status.summary.passingCandidates = candidateResults.filter((entry) => entry.pass).length;
      status.summary.bestScoreDelta = Math.max(0, ...candidateResults.map((entry) => entry.scoreDelta || 0));
      status.candidates = candidateResults;
      persistStatus(status, statusPath);
      appendJsonl(eventsPath, { type: "candidate_reused", generatedAt: isoNow(), result: cached });
      continue;
    }
    const candidateMailRuns = [];

    for (const run of sampledMailRuns) {
      const candidateMailRoot = resolve(iterationRoot, "sources/mail", slugify(run.runId));
      const snapshotPath = resolve(run.root, "mail-memory-outlook-snapshot.jsonl");
      candidateMailRuns.push({
        ...run,
        manifestPath: resolve(candidateMailRoot, "canonical-corpus/manifest.json"),
        sqlitePath: resolve(candidateMailRoot, "canonical-corpus/corpus.sqlite"),
        root: candidateMailRoot,
      });
      await runChild({
        status,
        statusPath,
        eventsPath,
        phase: `candidate:${strategy.id}:${run.runId}`,
        label: `${strategy.id} on ${run.runId}`,
        command: process.execPath,
        args: [
          "./scripts/mail-memory-corpus-export.mjs",
          "--run-id",
          `${run.runId}-${strategy.id}`,
          "--snapshot",
          snapshotPath,
          "--run-root",
          candidateMailRoot,
          "--json",
          ...strategy.promoteArgs,
        ],
        logPath: resolve(candidateMailRoot, "overnight-mail-corpus.log"),
        heartbeatSeconds,
      });
    }

    buildSubsetArtifacts({ baseCatalog, mailRuns: candidateMailRuns, outputRoot: iterationRoot, docsRootOverride: docsRoot });
    await runChild({
      status,
      statusPath,
      eventsPath,
      phase: `candidate-review:${strategy.id}`,
      label: `Candidate review ${strategy.id}`,
      command: process.execPath,
      args: ["./scripts/open-memory-production-review.mjs", "--wave-root", iterationRoot, "--mail-sample", String(mailReviewSample), "--json"],
      logPath: resolve(iterationRoot, "candidate-review.log"),
      heartbeatSeconds,
    });
    await runChild({
      status,
      statusPath,
      eventsPath,
      phase: `candidate-audit:${strategy.id}`,
      label: `Candidate expanded audit ${strategy.id}`,
      command: process.execPath,
      args: [
        "./scripts/open-memory-production-audit.mjs",
        "--wave-root",
        iterationRoot,
        "--docs-root",
        docsRoot,
        "--mode",
        "aggregate",
        "--seed",
        auditSeed,
        "--seed-count",
        String(auditSeedCount),
        "--json",
      ],
      logPath: resolve(iterationRoot, "candidate-audit.log"),
      heartbeatSeconds,
    });

    const candidateAudit = safeReadJson(resolve(iterationRoot, "expanded-audit.json"), {});
    const candidatePromoteStats = countPromoteStats(candidateMailRuns.map((run) => run.root));
    const evaluation = evaluateCandidate({
      baselineAudit,
      candidateAudit,
      baselinePromoteStats,
      candidatePromoteStats,
    });

    const result = {
      id: strategy.id,
      description: strategy.description,
      root: iterationRoot,
      promoteArgs: strategy.promoteArgs,
      pass: evaluation.pass,
      warnings: evaluation.warnings,
      scoreDelta: evaluation.scoreDelta,
      promoteStats: candidatePromoteStats,
      auditSummary: candidateAudit.summary || {},
    };
    candidateResults.push(result);
    status.summary.candidateIterations = candidateResults.length;
    status.summary.passingCandidates = candidateResults.filter((entry) => entry.pass).length;
    status.summary.bestScoreDelta = Math.max(0, ...candidateResults.map((entry) => entry.scoreDelta || 0));
    status.candidates = candidateResults;
    persistStatus(status, statusPath);
    appendJsonl(eventsPath, { type: "candidate_evaluated", generatedAt: isoNow(), result });
  }

  const bestCandidate = chooseBestCandidate(candidateResults);
  const promotedRoot = resolve(outputRoot, "promoted");
  if (bestCandidate && autoPromoteSafeWins) {
    mkdirSync(promotedRoot, { recursive: true });
    copyFileSync(resolve(bestCandidate.root, "production-review.json"), resolve(promotedRoot, "production-review.json"));
    copyFileSync(resolve(bestCandidate.root, "production-review.md"), resolve(promotedRoot, "production-review.md"));
    copyFileSync(resolve(bestCandidate.root, "expanded-audit.json"), resolve(promotedRoot, "expanded-audit.json"));
    copyFileSync(resolve(bestCandidate.root, "expanded-audit.md"), resolve(promotedRoot, "expanded-audit.md"));
    writeJson(resolve(promotedRoot, "promotion-decision.json"), {
      schema: "open-memory-overnight-promotion.v1",
      generatedAt: isoNow(),
      status: "promoted",
      bestCandidate,
    });
  }

  status.sidecar = status.sidecar || { status: "pending", warnings: [], soakCompleted: 0 };
  if (runSoak) {
    const sidecarWarnings = [];
    const before = await runOptionalChild({
      status,
      statusPath,
      eventsPath,
      phase: "reliability-before-soak",
      label: "Reliability report before soak",
      command: process.execPath,
      args: ["./scripts/reliability-hub.mjs", "report", "--json"],
      logPath: resolve(outputRoot, "reliability-before-soak.log"),
      heartbeatSeconds,
    });
    if (!before.ok && before.warning) sidecarWarnings.push(before.warning);
    const soak = await runOptionalChild({
      status,
      statusPath,
      eventsPath,
      phase: "portal-soak",
      label: "Portal soak load test",
      command: process.execPath,
      args: ["./scripts/portal-load-test.mjs", "--profile", "soak", "--strict", "--write", "--json"],
      logPath: resolve(outputRoot, "portal-soak.log"),
      heartbeatSeconds,
    });
    if (!soak.ok && soak.warning) sidecarWarnings.push(soak.warning);
    const after = await runOptionalChild({
      status,
      statusPath,
      eventsPath,
      phase: "reliability-after-soak",
      label: "Reliability report after soak",
      command: process.execPath,
      args: ["./scripts/reliability-hub.mjs", "report", "--json"],
      logPath: resolve(outputRoot, "reliability-after-soak.log"),
      heartbeatSeconds,
    });
    if (!after.ok && after.warning) sidecarWarnings.push(after.warning);
    status.summary.soakCompleted = soak.ok ? 1 : 0;
    status.sidecar = {
      status: sidecarWarnings.length > 0 ? "warn" : "pass",
      warnings: sidecarWarnings,
      soakCompleted: status.summary.soakCompleted,
    };
    persistStatus(status, statusPath);
  }

  const summary = writeSummaryArtifacts({
    outputRoot,
    runId,
    waveRoot,
    sampledMailRuns,
    baselinePromoteStats,
    bestCandidate,
    candidateResults,
    autoPromoteSafeWins,
    promotedRoot,
    runSoak,
    sidecar: status.sidecar,
  });

  status.state = bestCandidate ? "promoted" : "completed";
  status.currentPhase = "done";
  status.summary.bestScoreDelta = bestCandidate ? bestCandidate.scoreDelta : 0;
  status.currentChildPid = null;
  persistStatus(status, statusPath);
  appendJsonl(eventsPath, { type: "overnight_completed", generatedAt: isoNow(), state: status.state, bestCandidate });

  if (printJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  process.stdout.write(`overnight iterate complete\nsummary: ${resolve(outputRoot, "overnight-summary.json")}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`open-memory-overnight-iterate failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
