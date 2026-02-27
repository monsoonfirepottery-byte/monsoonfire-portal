#!/usr/bin/env node

/* eslint-disable no-console */

import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_LOOKBACK_HOURS = 48;
const DEFAULT_RUN_LIMIT = 30;
const DEFAULT_BRANCH = String(process.env.GITHUB_REF_NAME || "main").trim() || "main";
const DEFAULT_JSON_REPORT = resolve(repoRoot, "output", "qa", "portal-automation-health-dashboard.json");
const DEFAULT_MARKDOWN_REPORT = resolve(repoRoot, "output", "qa", "portal-automation-health-dashboard.md");
const DEFAULT_TUNING_REPORT = resolve(repoRoot, "output", "qa", "portal-loop-threshold-tuning.json");

const AUTOMATIONS = [
  {
    key: "canary",
    label: "Portal Daily Authenticated Canary",
    workflowName: "Portal Daily Authenticated Canary",
    defaultFeedbackLimit: 12,
    maxFeedbackLimit: 30,
    artifactSources: [
      {
        artifactNames: (runId) => [`portal-authenticated-canary-${runId}`],
        fileNames: [
          "portal-authenticated-canary.json",
          "portal-authenticated-canary-feedback.json",
          "portal-fixture-self-healing.json",
        ],
      },
    ],
  },
  {
    key: "indexGuard",
    label: "Firestore Index Contract Guard",
    workflowName: "Firestore Index Contract Guard",
    defaultFeedbackLimit: 12,
    maxFeedbackLimit: 30,
    artifactSources: [
      {
        artifactNames: (runId) => [`firestore-index-contract-guard-${runId}`],
        fileNames: ["firestore-index-contract-guard.json", "firestore-index-auto-remediation.json"],
      },
    ],
  },
  {
    key: "promotion",
    label: "Portal Post-Deploy Promotion Gate",
    workflowName: "Portal Post-Deploy Promotion Gate",
    defaultFeedbackLimit: 12,
    maxFeedbackLimit: 30,
    artifactSources: [
      {
        artifactNames: (runId) => [`portal-post-deploy-promotion-gate-${runId}`],
        fileNames: ["post-deploy-promotion-gate.json", "post-deploy-promotion-feedback.json"],
      },
    ],
  },
  {
    key: "smoke",
    label: "Portal Production Smoke",
    workflowName: "Portal Production Smoke",
    defaultFeedbackLimit: 12,
    maxFeedbackLimit: 30,
    artifactSources: [
      {
        artifactNames: () => ["portal-playwright-prod-smoke"],
        fileNames: ["portal-smoke-summary.json"],
      },
      {
        artifactNames: () => ["portal-prod-smoke-feedback"],
        fileNames: ["portal-prod-smoke-feedback.json"],
      },
    ],
  },
  {
    key: "prFunctional",
    label: "Portal PR Functional Gate",
    workflowName: "Portal PR Functional Gate",
    defaultFeedbackLimit: 20,
    maxFeedbackLimit: 60,
    artifactSources: [
      {
        artifactNames: (runId) => [`portal-pr-functional-gate-${runId}`],
        fileNames: ["portal-pr-functional-gate.json", "portal-pr-functional-feedback.json"],
      },
    ],
  },
];

const CHECK_SUGGESTIONS = [
  {
    test: /my pieces/i,
    suggestion:
      "Run fixture steward and validate deterministic My Pieces seed data before canary/smoke assertions.",
  },
  {
    test: /staff/i,
    suggestion:
      "Validate staff credentials/claims and keep staff-page smoke selectors resilient to semantic heading changes.",
  },
  {
    test: /index|firestore/i,
    suggestion:
      "Run Firestore index guard locally with strict mode and apply missing indexes before next scheduled run.",
  },
  {
    test: /notification|mark read/i,
    suggestion:
      "Increase mark-read retries only when transient recoveries dominate persistent failures in recent history.",
  },
  {
    test: /theme|contrast/i,
    suggestion:
      "Retain theme sweep during elevated risk periods and only relax after sustained clean streaks.",
  },
];

function parseArgs(argv) {
  const options = {
    branch: DEFAULT_BRANCH,
    lookbackHours: DEFAULT_LOOKBACK_HOURS,
    runLimit: DEFAULT_RUN_LIMIT,
    reportJsonPath: DEFAULT_JSON_REPORT,
    reportMarkdownPath: DEFAULT_MARKDOWN_REPORT,
    tuningPath: DEFAULT_TUNING_REPORT,
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--branch") {
      options.branch = String(next).trim() || DEFAULT_BRANCH;
      index += 1;
      continue;
    }
    if (arg === "--lookback-hours") {
      options.lookbackHours = clampInteger(next, 6, 168, DEFAULT_LOOKBACK_HOURS);
      index += 1;
      continue;
    }
    if (arg === "--run-limit") {
      options.runLimit = clampInteger(next, 5, 80, DEFAULT_RUN_LIMIT);
      index += 1;
      continue;
    }
    if (arg === "--report-json") {
      options.reportJsonPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--report-markdown") {
      options.reportMarkdownPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--threshold-report") {
      options.tuningPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
  }

  return options;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function runCommand(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8" });
  const code = typeof result.status === "number" ? result.status : 1;
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  if (!allowFailure && code !== 0) {
    throw new Error(`Command failed (${code}): ${command} ${args.join(" ")}\n${stderr || stdout}`);
  }
  return { ok: code === 0, code, stdout, stderr };
}

async function readJsonSafe(path) {
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeConclusion(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "unknown";
  if (raw === "success" || raw === "passed") return "success";
  if (["failure", "failed", "timed_out", "cancelled", "action_required", "startup_failure"].includes(raw)) {
    return "failure";
  }
  if (raw === "neutral" || raw === "skipped") return "neutral";
  return raw;
}

function shorten(text, max = 160) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function slug(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function guessSuggestion(label, fallback = "Investigate latest failing artifact and add deterministic repro notes.") {
  const normalized = String(label || "");
  for (const rule of CHECK_SUGGESTIONS) {
    if (rule.test.test(normalized)) return rule.suggestion;
  }
  return fallback;
}

async function findFilesRecursive(rootPath, fileName) {
  const matches = [];
  async function walk(dir) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name === fileName) {
        matches.push(fullPath);
      }
    }
  }
  await walk(rootPath);
  return matches;
}

function pickPreferredFile(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return "";
  const nonDeep = paths.find((item) => !/[/\\]deep[/\\]/i.test(item));
  return nonDeep || paths[0];
}

async function loadArtifactsForRun(run, automation, scratchDir) {
  const runId = String(run.databaseId || "").trim();
  const runDir = resolve(scratchDir, `${automation.key}-${runId}`);
  await mkdir(runDir, { recursive: true });

  const files = {};
  const downloadNotes = [];

  for (const source of automation.artifactSources) {
    const names = source.artifactNames(runId);
    let downloaded = false;
    let downloadedName = "";

    for (const name of names) {
      const download = runCommand("gh", ["run", "download", runId, "-n", name, "-D", runDir], {
        allowFailure: true,
      });
      if (download.ok) {
        downloaded = true;
        downloadedName = name;
        break;
      }
    }

    if (!downloaded) {
      downloadNotes.push(`Artifact unavailable: ${names.join(" | ")}`);
      continue;
    }

    downloadNotes.push(`Downloaded artifact: ${downloadedName}`);
    for (const fileName of source.fileNames) {
      if (files[fileName]) continue;
      const matches = await findFilesRecursive(runDir, fileName);
      const preferred = pickPreferredFile(matches);
      if (!preferred) continue;
      const parsed = await readJsonSafe(preferred);
      if (parsed) {
        files[fileName] = {
          path: preferred,
          data: parsed,
        };
      }
    }
  }

  return { files, downloadNotes };
}

function pushSignature(list, workflowKey, workflowLabel, key, label, run, suggestion, evidence = "") {
  if (!key || !label) return;
  list.push({
    workflowKey,
    workflowLabel,
    key,
    label: shorten(label, 180),
    evidence: shorten(evidence, 220),
    suggestion: shorten(suggestion, 240),
    runId: Number(run.databaseId || 0),
    runUrl: String(run.url || ""),
    createdAt: String(run.createdAt || ""),
  });
}

function extractCanarySignatures(run, files, workflowKey, workflowLabel) {
  const signatures = [];
  const canaryReport = files["portal-authenticated-canary.json"]?.data || null;
  const canaryFeedback = files["portal-authenticated-canary-feedback.json"]?.data || null;
  const fixtureFeedback = files["portal-fixture-self-healing.json"]?.data || null;

  if (canaryReport) {
    const checks = Array.isArray(canaryReport.checks) ? canaryReport.checks : [];
    for (const check of checks) {
      if (String(check?.status || "") !== "failed") continue;
      const label = String(check?.label || "failed check").trim();
      const evidence = String(check?.message || check?.error || "").trim();
      pushSignature(
        signatures,
        workflowKey,
        workflowLabel,
        `canary.check.${slug(label) || "unknown"}`,
        `Canary failed check: ${label}`,
        run,
        guessSuggestion(label),
        evidence
      );
    }
    const errors = Array.isArray(canaryReport.errors) ? canaryReport.errors : [];
    for (const error of errors.slice(0, 3)) {
      const trimmed = shorten(error, 120);
      pushSignature(
        signatures,
        workflowKey,
        workflowLabel,
        `canary.error.${slug(trimmed) || "unknown"}`,
        `Canary runtime error: ${trimmed}`,
        run,
        "Review canary artifacts/screenshots and verify fixture/auth state before rerun.",
        error
      );
    }
  }

  if (canaryFeedback && Array.isArray(canaryFeedback.signals?.checks)) {
    for (const stat of canaryFeedback.signals.checks) {
      const failures = Number(stat?.failures || 0);
      if (failures <= 0) continue;
      const label = String(stat?.label || "unknown check").trim();
      const transient = Number(stat?.transientRecoveries || 0);
      const persistent = Number(stat?.persistentFailures || 0);
      pushSignature(
        signatures,
        workflowKey,
        workflowLabel,
        `canary.signal.${slug(label) || "unknown"}`,
        `Canary historical failures: ${label}`,
        run,
        guessSuggestion(label),
        `failures=${failures}, transient=${transient}, persistent=${persistent}`
      );
    }
  }

  if (fixtureFeedback?.feedback?.shouldSeedFixturesBeforeCanary) {
    const reasons = Array.isArray(fixtureFeedback.feedback.reasonCodes)
      ? fixtureFeedback.feedback.reasonCodes.join(", ")
      : "";
    pushSignature(
      signatures,
      workflowKey,
      workflowLabel,
      "canary.fixture.seed-required",
      "Fixture self-healing indicates pre-canary seed is required",
      run,
      "Keep fixture steward pre-seed enabled and verify fixture TTL windows remain aligned with run cadence.",
      reasons
    );
  }

  return signatures;
}

function extractIndexSignatures(run, files, workflowKey, workflowLabel) {
  const signatures = [];
  const guard = files["firestore-index-contract-guard.json"]?.data || null;
  const feedback = files["firestore-index-auto-remediation.json"]?.data || null;

  if (guard) {
    const missing = Array.isArray(guard.missing) ? guard.missing : [];
    for (const entry of missing) {
      const id = String(entry?.id || "").trim();
      if (!id) continue;
      pushSignature(
        signatures,
        workflowKey,
        workflowLabel,
        `index.missing.${slug(id) || "unknown"}`,
        `Missing required index: ${id}`,
        run,
        "Apply generated index candidate and deploy Firestore indexes.",
        JSON.stringify(entry)
      );
    }
    if (String(guard.status || "") === "failed" && missing.length === 0) {
      pushSignature(
        signatures,
        workflowKey,
        workflowLabel,
        "index.guard.failed-generic",
        "Index guard failed without explicit missing list",
        run,
        "Inspect guard stderr/stdout and verify contract matrix coverage.",
        ""
      );
    }
  }

  if (feedback && Array.isArray(feedback.feedback?.candidateMissingIds)) {
    for (const id of feedback.feedback.candidateMissingIds) {
      const normalized = String(id || "").trim();
      if (!normalized) continue;
      pushSignature(
        signatures,
        workflowKey,
        workflowLabel,
        `index.candidate.${slug(normalized) || "unknown"}`,
        `Index auto-remediation candidate: ${normalized}`,
        run,
        "Validate candidate index definitions and include safe additions in firestore.indexes.json.",
        ""
      );
    }
  }

  return signatures;
}

function extractPromotionSignatures(run, files, workflowKey, workflowLabel) {
  const signatures = [];
  const gateReport = files["post-deploy-promotion-gate.json"]?.data || null;
  const feedback = files["post-deploy-promotion-feedback.json"]?.data || null;

  if (gateReport && Array.isArray(gateReport.steps)) {
    for (const step of gateReport.steps) {
      if (String(step?.status || "") !== "failed") continue;
      const label = String(step?.label || "failed step").trim();
      const details = String(step?.details || "").trim();
      pushSignature(
        signatures,
        workflowKey,
        workflowLabel,
        `promotion.step.${slug(label) || "unknown"}`,
        `Promotion gate failed step: ${label}`,
        run,
        guessSuggestion(label),
        details
      );
    }
  }

  if (feedback?.signals?.riskLevel && String(feedback.signals.riskLevel) !== "low") {
    const riskLevel = String(feedback.signals.riskLevel);
    const riskScore = Number(feedback.signals.riskScore || 0);
    pushSignature(
      signatures,
      workflowKey,
      workflowLabel,
      `promotion.risk.${slug(riskLevel) || "unknown"}`,
      `Promotion risk level is ${riskLevel}`,
      run,
      "Retain full promotion checks (theme, virtual staff, index guard) until risk returns to low.",
      `riskScore=${riskScore}`
    );
  }

  return signatures;
}

function extractSmokeSignatures(run, files, workflowKey, workflowLabel) {
  const signatures = [];
  const summary = files["portal-smoke-summary.json"]?.data || null;
  const feedback = files["portal-prod-smoke-feedback.json"]?.data || null;

  if (summary && Array.isArray(summary.checks)) {
    for (const check of summary.checks) {
      if (String(check?.status || "") !== "failed") continue;
      const label = String(check?.label || "failed check").trim();
      const error = String(check?.error || "").trim();
      pushSignature(
        signatures,
        workflowKey,
        workflowLabel,
        `smoke.check.${slug(label) || "unknown"}`,
        `Smoke failed check: ${label}`,
        run,
        guessSuggestion(label),
        error
      );
    }
  }

  if (feedback && Array.isArray(feedback.signals?.checkStats)) {
    for (const stat of feedback.signals.checkStats) {
      const failures = Number(stat?.failures || 0);
      if (failures <= 0) continue;
      const label = String(stat?.label || "").trim() || "unknown check";
      const transient = Number(stat?.transientRecoveries || 0);
      const persistent = Number(stat?.persistentFailures || 0);
      pushSignature(
        signatures,
        workflowKey,
        workflowLabel,
        `smoke.signal.${slug(label) || "unknown"}`,
        `Smoke historical failures: ${label}`,
        run,
        guessSuggestion(label),
        `failures=${failures}, transient=${transient}, persistent=${persistent}`
      );
    }
  }

  return signatures;
}

function extractPrFunctionalSignatures(run, files, workflowKey, workflowLabel) {
  const signatures = [];
  const gateReport = files["portal-pr-functional-gate.json"]?.data || null;
  const feedback = files["portal-pr-functional-feedback.json"]?.data || null;

  if (gateReport && Array.isArray(gateReport.steps)) {
    for (const step of gateReport.steps) {
      if (String(step?.status || "") !== "failed") continue;
      const label = String(step?.label || "failed step").trim();
      pushSignature(
        signatures,
        workflowKey,
        workflowLabel,
        `pr.step.${slug(label) || "unknown"}`,
        `PR functional failed step: ${label}`,
        run,
        guessSuggestion(label),
        String(step?.stdout || step?.stderr || "").slice(0, 360)
      );
    }
  }

  if (feedback && Array.isArray(feedback.feedback?.priorityFailureSteps)) {
    for (const label of feedback.feedback.priorityFailureSteps) {
      const normalized = String(label || "").trim();
      if (!normalized) continue;
      pushSignature(
        signatures,
        workflowKey,
        workflowLabel,
        `pr.priority.${slug(normalized) || "unknown"}`,
        `PR functional priority failure: ${normalized}`,
        run,
        guessSuggestion(normalized),
        ""
      );
    }
  }

  return signatures;
}

function extractSignatures(automation, run, files) {
  const workflowKey = automation.key;
  const workflowLabel = automation.label;
  if (workflowKey === "canary") return extractCanarySignatures(run, files, workflowKey, workflowLabel);
  if (workflowKey === "indexGuard") return extractIndexSignatures(run, files, workflowKey, workflowLabel);
  if (workflowKey === "promotion") return extractPromotionSignatures(run, files, workflowKey, workflowLabel);
  if (workflowKey === "smoke") return extractSmokeSignatures(run, files, workflowKey, workflowLabel);
  if (workflowKey === "prFunctional") return extractPrFunctionalSignatures(run, files, workflowKey, workflowLabel);
  return [];
}

function summarizeLatestFeedback(automation, latestRunWithFiles) {
  if (!latestRunWithFiles) return {};
  const files = latestRunWithFiles.files || {};

  if (automation.key === "canary") {
    const feedback = files["portal-authenticated-canary-feedback.json"]?.data?.feedback || {};
    const fixture = files["portal-fixture-self-healing.json"]?.data?.feedback || {};
    return {
      myPiecesReadyTimeoutMs: Number(feedback.myPiecesReadyTimeoutMs || 0) || null,
      myPiecesReloadRetryCount: Number(feedback.myPiecesReloadRetryCount || 0),
      markReadRetryCount: Number(feedback.markReadRetryCount || 0),
      fixtureSelfHealEnabled: Boolean(fixture.shouldSeedFixturesBeforeCanary),
      fixtureReasonCodes: Array.isArray(fixture.reasonCodes) ? fixture.reasonCodes : [],
    };
  }
  if (automation.key === "indexGuard") {
    const feedback = files["firestore-index-auto-remediation.json"]?.data?.feedback || {};
    return {
      shouldProposePatch: Boolean(feedback.shouldProposePatch),
      candidateIndexCount: Number(feedback.candidateIndexCount || 0),
      shouldEnableApplyMode: Boolean(feedback.shouldEnableApplyMode),
    };
  }
  if (automation.key === "promotion") {
    const feedback = files["post-deploy-promotion-feedback.json"]?.data?.feedback || {};
    return {
      includeThemeSweep: feedback.includeThemeSweep !== false,
      includeVirtualStaff: feedback.includeVirtualStaff !== false,
      includeIndexGuard: feedback.includeIndexGuard !== false,
      riskLevel: String(feedback.riskLevel || "unknown"),
    };
  }
  if (automation.key === "smoke") {
    const feedback = files["portal-prod-smoke-feedback.json"]?.data?.feedback || {};
    return {
      defaultCheckRetryCount: Number(feedback.defaultCheckRetryCount || 0),
      retriableCheckCount: Object.keys(feedback.checkRetries || {}).length,
      retryCooldownMs: Number(feedback.retryCooldownMs || 0),
    };
  }
  if (automation.key === "prFunctional") {
    const feedback = files["portal-pr-functional-feedback.json"]?.data?.feedback || {};
    return {
      priorityFailureSteps: Array.isArray(feedback.priorityFailureSteps) ? feedback.priorityFailureSteps : [],
      remediationStepCount:
        feedback.stepRemediation && typeof feedback.stepRemediation === "object"
          ? Object.keys(feedback.stepRemediation).length
          : 0,
    };
  }

  return {};
}

function aggregateSignatures(signatures) {
  const map = new Map();
  for (const signature of signatures) {
    const key = `${signature.workflowKey}::${signature.key}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        ...signature,
        count: 1,
        runIds: signature.runId ? [signature.runId] : [],
        runUrls: signature.runUrl ? [signature.runUrl] : [],
      });
      continue;
    }

    existing.count += 1;
    if (signature.runId && !existing.runIds.includes(signature.runId)) existing.runIds.push(signature.runId);
    if (signature.runUrl && !existing.runUrls.includes(signature.runUrl)) existing.runUrls.push(signature.runUrl);
    if (toTimestamp(signature.createdAt) > toTimestamp(existing.createdAt)) {
      existing.createdAt = signature.createdAt;
      existing.evidence = signature.evidence;
      existing.runId = signature.runId;
      existing.runUrl = signature.runUrl;
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
  });
}

function buildTuningRecommendation(automation, workflowSummary) {
  const total = Number(workflowSummary.totalRuns || 0);
  const failed = Number(workflowSummary.failedRuns || 0);
  const passRate = total > 0 ? Number((workflowSummary.successRuns / total).toFixed(3)) : 0;
  const failRate = total > 0 ? Number((failed / total).toFixed(3)) : 0;

  let feedbackLimit = automation.defaultFeedbackLimit;
  const reasons = [];

  if (total < 8) {
    feedbackLimit = Math.min(automation.maxFeedbackLimit, automation.defaultFeedbackLimit + 6);
    reasons.push("Low sample size in lookback window; increase feedback history depth.");
  } else if (failRate >= 0.25) {
    feedbackLimit = Math.min(automation.maxFeedbackLimit, automation.defaultFeedbackLimit + 8);
    reasons.push("Failure rate elevated; widen history to improve signal confidence.");
  } else if (failRate >= 0.12) {
    feedbackLimit = Math.min(automation.maxFeedbackLimit, automation.defaultFeedbackLimit + 4);
    reasons.push("Mild instability observed; slightly widen feedback history.");
  } else {
    reasons.push("Stability is acceptable; keep baseline history depth.");
  }

  const recommendation = {
    workflow: automation.workflowName,
    feedbackLimit,
    passRate,
    failRate,
    reasons,
  };

  if (automation.key === "canary") {
    recommendation.recoveryWindow = failRate >= 0.2 ? 3 : 2;
    recommendation.reasons.push(
      recommendation.recoveryWindow === 3
        ? "Transient/persistent split is uncertain; use wider recovery window."
        : "Use default recovery window under stable canary behavior."
    );
    const latest = workflowSummary.latestFeedback || {};
    recommendation.directiveCandidates = {
      "mypieces-timeout-ms": latest.myPiecesReadyTimeoutMs || 18000,
      "mypieces-reload-retries": latest.myPiecesReloadRetryCount ?? 1,
      "mark-read-retries": latest.markReadRetryCount ?? 1,
    };
  }

  if (automation.key === "smoke") {
    const repeatedStaff = workflowSummary.repeatedSignatures.find((entry) => /staff/i.test(entry.label));
    recommendation.defaultCheckRetryCount = failRate >= 0.2 ? 1 : 0;
    recommendation.retryCooldownMs = 350;
    recommendation.checkRetries = repeatedStaff ? { "staff renders": 1 } : {};
  }

  if (automation.key === "indexGuard") {
    const repeatedMissing = workflowSummary.repeatedSignatures.some((entry) => entry.key.startsWith("index.missing."));
    recommendation.keepStrictMode = !repeatedMissing;
    recommendation.enableApplyMode = repeatedMissing;
  }

  if (automation.key === "promotion") {
    recommendation.recentRunsWindow = 6;
    recommendation.minStablePassesToSkipThemeSweep = 4;
  }

  if (automation.key === "prFunctional") {
    recommendation.priorityFailureThreshold = 1;
  }

  return recommendation;
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Portal Automation Health Dashboard");
  lines.push("");
  lines.push(`Generated at: \`${report.generatedAtIso}\``);
  lines.push(`Lookback window: last \`${report.lookbackHours}\` hours`);
  lines.push(`Branch: \`${report.branch}\``);
  lines.push("");
  lines.push("## Workflow Status");
  lines.push("");
  lines.push("| Workflow | Runs | Success | Failed | Pass Rate | Repeated Signatures |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const workflow of report.workflows) {
    lines.push(
      `| ${workflow.label} | ${workflow.totalRuns} | ${workflow.successRuns} | ${workflow.failedRuns} | ${Math.round(
        workflow.passRate * 100
      )}% | ${workflow.repeatedSignatures.length} |`
    );
  }
  lines.push("");

  lines.push("## Repeated Failure Signatures");
  lines.push("");
  if (report.repeatedFailureSignatures.length === 0) {
    lines.push("- None detected in current lookback window.");
  } else {
    for (const entry of report.repeatedFailureSignatures.slice(0, 20)) {
      lines.push(
        `- [${entry.workflowLabel}] ${entry.label} (count=${entry.count}, latest=${entry.createdAt || "unknown"})`
      );
      if (entry.runUrl) lines.push(`  - Latest run: ${entry.runUrl}`);
      if (entry.suggestion) lines.push(`  - Suggested remediation: ${entry.suggestion}`);
      if (entry.evidence) lines.push(`  - Evidence: ${entry.evidence}`);
    }
  }
  lines.push("");

  lines.push("## Threshold Tuning Recommendations");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(report.tuning.recommendations, null, 2));
  lines.push("```");
  lines.push("");

  if (report.notes.length > 0) {
    lines.push("## Notes");
    lines.push("");
    for (const note of report.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  lines.push("## Agent Handoff");
  lines.push("");
  lines.push("- Use this report as the source of truth for repeated signatures and threshold tuning candidates.");
  lines.push("- Prioritize signatures with count >= 2 and latest failure inside this lookback window.");
  lines.push("- Keep remediation notes concrete, deterministic, and linked to run artifacts.");
  lines.push("");

  return lines.join("\n");
}

async function writeReportArtifacts(report, markdown, options) {
  await mkdir(dirname(options.reportJsonPath), { recursive: true });
  await mkdir(dirname(options.reportMarkdownPath), { recursive: true });
  await mkdir(dirname(options.tuningPath), { recursive: true });
  await writeFile(options.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(options.reportMarkdownPath, `${markdown}\n`, "utf8");
  await writeFile(options.tuningPath, `${JSON.stringify(report.tuning, null, 2)}\n`, "utf8");
}

async function collectWorkflowSummary(automation, options, lookbackStartMs, scratchDir, notes) {
  const runList = runCommand(
    "gh",
    [
      "run",
      "list",
      "--workflow",
      automation.workflowName,
      "--branch",
      options.branch,
      "--limit",
      String(options.runLimit),
      "--json",
      "databaseId,conclusion,status,createdAt,updatedAt,url,headSha,event",
    ],
    { allowFailure: true }
  );

  if (!runList.ok) {
    notes.push(`Could not list runs for ${automation.workflowName}.`);
    return {
      key: automation.key,
      label: automation.label,
      workflowName: automation.workflowName,
      totalRuns: 0,
      successRuns: 0,
      failedRuns: 0,
      passRate: 0,
      latestRun: null,
      latestFeedback: {},
      repeatedSignatures: [],
      runs: [],
      tuning: buildTuningRecommendation(automation, {
        totalRuns: 0,
        successRuns: 0,
        failedRuns: 0,
        repeatedSignatures: [],
      }),
    };
  }

  let parsedRuns = [];
  try {
    const parsed = JSON.parse(runList.stdout || "[]");
    parsedRuns = Array.isArray(parsed) ? parsed : [];
  } catch {
    notes.push(`Could not parse run list JSON for ${automation.workflowName}.`);
    parsedRuns = [];
  }

  const runs = parsedRuns
    .filter((run) => String(run?.status || "").toLowerCase() === "completed")
    .filter((run) => toTimestamp(run.createdAt) >= lookbackStartMs)
    .sort((a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt))
    .map((run) => ({
      databaseId: Number(run.databaseId || 0),
      conclusion: normalizeConclusion(run.conclusion),
      status: String(run.status || "").toLowerCase(),
      createdAt: String(run.createdAt || ""),
      updatedAt: String(run.updatedAt || ""),
      url: String(run.url || ""),
      headSha: String(run.headSha || ""),
      event: String(run.event || ""),
    }));

  const runSummaries = [];
  let latestRunWithFiles = null;
  const signatureInputs = [];

  for (const run of runs) {
    const artifact = await loadArtifactsForRun(run, automation, scratchDir);
    const files = artifact.files;
    const signatures = extractSignatures(automation, run, files);
    if (signatures.length === 0 && run.conclusion === "failure") {
      pushSignature(
        signatures,
        automation.key,
        automation.label,
        `${automation.key}.run.failure-generic`,
        `${automation.label} run failed without parsed signature`,
        run,
        "Inspect run logs/artifacts and promote the exact failure signature into parser rules.",
        ""
      );
    }

    signatureInputs.push(...signatures);
    if (!latestRunWithFiles || toTimestamp(run.createdAt) > toTimestamp(latestRunWithFiles.run.createdAt)) {
      latestRunWithFiles = { run, files };
    }

    runSummaries.push({
      databaseId: run.databaseId,
      conclusion: run.conclusion,
      createdAt: run.createdAt,
      url: run.url,
      parsedFileCount: Object.keys(files).length,
      parsedFiles: Object.keys(files),
      artifactNotes: artifact.downloadNotes,
      signatures: signatures.map((entry) => ({
        key: entry.key,
        label: entry.label,
      })),
    });
  }

  const totalRuns = runs.length;
  const successRuns = runs.filter((run) => run.conclusion === "success").length;
  const failedRuns = runs.filter((run) => run.conclusion === "failure").length;
  const passRate = totalRuns > 0 ? Number((successRuns / totalRuns).toFixed(4)) : 0;

  const signatureStats = aggregateSignatures(signatureInputs);
  const repeatedSignatures = signatureStats.filter((entry) => entry.count >= 2);

  const workflowSummary = {
    key: automation.key,
    label: automation.label,
    workflowName: automation.workflowName,
    totalRuns,
    successRuns,
    failedRuns,
    passRate,
    latestRun: runs[runs.length - 1] || null,
    latestFeedback: summarizeLatestFeedback(automation, latestRunWithFiles),
    repeatedSignatures,
    signatureStats,
    runs: runSummaries,
  };

  workflowSummary.tuning = buildTuningRecommendation(automation, workflowSummary);
  return workflowSummary;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const generatedAtIso = new Date().toISOString();
  const lookbackStartMs = Date.now() - options.lookbackHours * 60 * 60 * 1000;
  const notes = [];

  const auth = runCommand("gh", ["auth", "status"], { allowFailure: true });
  if (!auth.ok) {
    throw new Error("GitHub CLI auth is required for dashboard generation.");
  }

  const report = {
    status: "ok",
    generatedAtIso,
    branch: options.branch,
    lookbackHours: options.lookbackHours,
    runLimit: options.runLimit,
    workflows: [],
    repeatedFailureSignatures: [],
    summary: {
      totalRuns: 0,
      totalSuccess: 0,
      totalFailed: 0,
      overallPassRate: 0,
      workflowsWithFailures: 0,
    },
    tuning: {
      generatedAtIso,
      lookbackHours: options.lookbackHours,
      recommendations: {},
    },
    notes,
    artifacts: {
      json: options.reportJsonPath,
      markdown: options.reportMarkdownPath,
      thresholds: options.tuningPath,
    },
  };

  const scratchDir = await mkdtemp(resolve(tmpdir(), "portal-automation-health-"));
  try {
    for (const automation of AUTOMATIONS) {
      const summary = await collectWorkflowSummary(automation, options, lookbackStartMs, scratchDir, notes);
      report.workflows.push(summary);
      report.tuning.recommendations[automation.key] = summary.tuning;
    }
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }

  const allRepeated = [];
  let totalRuns = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  let workflowsWithFailures = 0;

  for (const workflow of report.workflows) {
    totalRuns += Number(workflow.totalRuns || 0);
    totalSuccess += Number(workflow.successRuns || 0);
    totalFailed += Number(workflow.failedRuns || 0);
    if (workflow.failedRuns > 0) workflowsWithFailures += 1;
    allRepeated.push(...workflow.repeatedSignatures);
  }

  report.repeatedFailureSignatures = allRepeated.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
  });

  report.summary.totalRuns = totalRuns;
  report.summary.totalSuccess = totalSuccess;
  report.summary.totalFailed = totalFailed;
  report.summary.workflowsWithFailures = workflowsWithFailures;
  report.summary.overallPassRate = totalRuns > 0 ? Number((totalSuccess / totalRuns).toFixed(4)) : 0;

  const markdown = buildMarkdown(report);
  await writeReportArtifacts(report, markdown, options);

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${report.status}\n`);
    process.stdout.write(`lookbackHours: ${String(report.lookbackHours)}\n`);
    process.stdout.write(`overallPassRate: ${String(report.summary.overallPassRate)}\n`);
    process.stdout.write(`repeatedSignatures: ${String(report.repeatedFailureSignatures.length)}\n`);
    process.stdout.write(`jsonReport: ${options.reportJsonPath}\n`);
    process.stdout.write(`markdownReport: ${options.reportMarkdownPath}\n`);
    process.stdout.write(`thresholdReport: ${options.tuningPath}\n`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`portal-automation-health-dashboard failed: ${message}`);
  process.exit(1);
});
