#!/usr/bin/env node

/* eslint-disable no-console */

import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_WORKFLOW_NAME = "Portal Daily Authenticated Canary";
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "portal-authenticated-canary-feedback.json");
const DEFAULT_ARTIFACT_PREFIX = "portal-authenticated-canary-";
const DEFAULT_LIMIT = 12;
const DEFAULT_RECOVERY_WINDOW = 2;
const ROLLING_ISSUE_TITLE = "Portal Authenticated Canary Failures (Rolling)";
const MY_PIECES_CHECK = "dashboard piece click-through opens my pieces detail";
const NOTIFICATIONS_CHECK = "notifications mark read gives user feedback";

function parseArgs(argv) {
  const options = {
    workflowName: DEFAULT_WORKFLOW_NAME,
    branch: String(process.env.GITHUB_REF_NAME || "main").trim(),
    runId: String(process.env.GITHUB_RUN_ID || "").trim(),
    reportPath: DEFAULT_REPORT_PATH,
    artifactPrefix: DEFAULT_ARTIFACT_PREFIX,
    limit: DEFAULT_LIMIT,
    recoveryWindow: DEFAULT_RECOVERY_WINDOW,
    asJson: false,
    includeGithub: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--no-github") {
      options.includeGithub = false;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--workflow-name") {
      options.workflowName = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--branch") {
      options.branch = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--run-id") {
      options.runId = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--report") {
      options.reportPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--artifact-prefix") {
      options.artifactPrefix = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 1) throw new Error("--limit must be >= 1");
      options.limit = Math.min(30, Math.round(value));
      index += 1;
      continue;
    }
    if (arg === "--recovery-window") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 1) throw new Error("--recovery-window must be >= 1");
      options.recoveryWindow = Math.min(5, Math.round(value));
      index += 1;
      continue;
    }
  }

  return options;
}

function runCommand(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8" });
  const code = typeof result.status === "number" ? result.status : 1;
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  if (!allowFailure && code !== 0) {
    throw new Error(`Command failed (${code}): ${command} ${args.join(" ")}\n${stderr || stdout}`);
  }
  return {
    ok: code === 0,
    code,
    stdout,
    stderr,
  };
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function parseRepoSlug() {
  const envSlug = String(process.env.GITHUB_REPOSITORY || "").trim();
  if (envSlug) return envSlug;

  const remote = runCommand("git", ["config", "--get", "remote.origin.url"], { allowFailure: true });
  if (!remote.ok) return "";
  const value = remote.stdout.trim();

  const sshMatch = value.match(/^git@github\.com:([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (sshMatch) return sshMatch[1];
  const httpsMatch = value.match(/^https:\/\/github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (httpsMatch) return httpsMatch[1];
  return "";
}

function normalizeConclusion(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized === "success" || normalized === "passed") return "success";
  if (["failure", "failed", "timed_out", "cancelled", "action_required", "startup_failure"].includes(normalized)) {
    return "failure";
  }
  if (normalized === "neutral" || normalized === "skipped") return "neutral";
  return normalized;
}

function getRunCheck(report, label) {
  if (!report || !Array.isArray(report.checks)) return null;
  return report.checks.find((item) => String(item?.label || "") === label) || null;
}

function extractCanaryFeedbackDirectives(comments) {
  const directives = [];
  if (!Array.isArray(comments)) return directives;

  for (const comment of comments) {
    const body = String(comment?.body || "");
    const author = String(comment?.author?.login || comment?.author?.name || "").trim();
    for (const line of body.split(/\r?\n/)) {
      const match = line.match(/^\s*canary-feedback\s*:\s*([a-z0-9._-]+)\s*=\s*(.+)\s*$/i);
      if (!match) continue;
      directives.push({
        key: String(match[1] || "").trim().toLowerCase(),
        value: String(match[2] || "").trim(),
        author,
      });
    }
  }

  return directives;
}

function extractEmptyStatePatternsFromWarnings(warnings) {
  const patterns = [];
  if (!Array.isArray(warnings)) return patterns;

  for (const warning of warnings) {
    const text = String(warning || "");
    const match = text.match(/emptyStatePreview=([^;]+)$/i);
    if (!match) continue;

    const preview = String(match[1] || "").trim();
    for (const token of preview.split("|")) {
      const normalized = token.trim();
      if (!normalized || normalized.toLowerCase() === "none") continue;
      if (normalized.length > 120) continue;
      patterns.push(normalized);
    }
  }

  return Array.from(new Set(patterns)).slice(0, 20);
}

function findRollingIssue(repoSlug) {
  if (!repoSlug) return { number: 0, url: "", comments: [] };
  const list = runCommand(
    "gh",
    [
      "issue",
      "list",
      "--repo",
      repoSlug,
      "--state",
      "open",
      "--search",
      `in:title \"${ROLLING_ISSUE_TITLE}\"`,
      "--json",
      "number,title,url",
    ],
    { allowFailure: true }
  );
  if (!list.ok) return { number: 0, url: "", comments: [] };

  let issue = null;
  try {
    const parsed = JSON.parse(list.stdout || "[]");
    issue = parsed.find((item) => String(item?.title || "") === ROLLING_ISSUE_TITLE) || null;
  } catch {
    return { number: 0, url: "", comments: [] };
  }
  if (!issue?.number) return { number: 0, url: "", comments: [] };

  const view = runCommand(
    "gh",
    ["issue", "view", String(issue.number), "--repo", repoSlug, "--json", "comments"],
    { allowFailure: true }
  );
  if (!view.ok) return { number: Number(issue.number), url: String(issue.url || ""), comments: [] };

  try {
    const parsed = JSON.parse(view.stdout || "{}");
    const comments = Array.isArray(parsed.comments) ? parsed.comments : [];
    return { number: Number(issue.number), url: String(issue.url || ""), comments };
  } catch {
    return { number: Number(issue.number), url: String(issue.url || ""), comments: [] };
  }
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

async function loadRunReport(run, options, scratchDir) {
  const runId = String(run.databaseId || "").trim();
  const artifactName = `${options.artifactPrefix}${runId}`;
  const runDir = resolve(scratchDir, runId);
  await mkdir(runDir, { recursive: true });

  const download = runCommand(
    "gh",
    ["run", "download", runId, "-n", artifactName, "-D", runDir],
    { allowFailure: true }
  );
  if (!download.ok) {
    return {
      hasReport: false,
      report: null,
      downloadError: `artifact ${artifactName} unavailable`,
    };
  }

  const reportPath = resolve(runDir, "portal-authenticated-canary.json");
  const report = await readJsonSafe(reportPath);
  if (!report) {
    return {
      hasReport: false,
      report: null,
      downloadError: "portal-authenticated-canary.json missing or invalid",
    };
  }

  return {
    hasReport: true,
    report,
    downloadError: "",
  };
}

function analyzeRuns(records, options, directives) {
  const runsWithReports = records
    .filter((item) => item.hasReport && item.report)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const checkStats = new Map();
  const failureMessages = new Map();
  const inheritedEmptyStatePatterns = [];

  const ensureCheckStat = (label) => {
    if (!checkStats.has(label)) {
      checkStats.set(label, {
        label,
        failures: 0,
        transientRecoveries: 0,
        persistentFailures: 0,
        lastMessage: "",
        lastRunId: "",
      });
    }
    return checkStats.get(label);
  };

  for (let index = 0; index < runsWithReports.length; index += 1) {
    const run = runsWithReports[index];
    const checks = Array.isArray(run.report?.checks) ? run.report.checks : [];
    const failedChecks = checks.filter((item) => String(item?.status || "") === "failed");

    for (const failedCheck of failedChecks) {
      const label = String(failedCheck?.label || "").trim() || "(unnamed check)";
      const message = String(failedCheck?.message || "").trim();
      const stat = ensureCheckStat(label);
      stat.failures += 1;
      stat.lastMessage = message;
      stat.lastRunId = String(run.databaseId || "");

      const key = `${label} :: ${message || "(no message)"}`;
      failureMessages.set(key, (failureMessages.get(key) || 0) + 1);

      let recovered = false;
      for (let lookahead = 1; lookahead <= options.recoveryWindow; lookahead += 1) {
        const nextRun = runsWithReports[index + lookahead];
        if (!nextRun) break;
        const nextCheck = getRunCheck(nextRun.report, label);
        if (!nextCheck) continue;
        const nextStatus = String(nextCheck.status || "");
        if (nextStatus === "passed") {
          recovered = true;
        }
        break;
      }

      if (recovered) {
        stat.transientRecoveries += 1;
      } else {
        stat.persistentFailures += 1;
      }
    }

    inheritedEmptyStatePatterns.push(...extractEmptyStatePatternsFromWarnings(run.report?.warnings));
  }

  const uniqueInheritedPatterns = Array.from(new Set(inheritedEmptyStatePatterns)).slice(0, 20);
  const myPieces = checkStats.get(MY_PIECES_CHECK) || {
    failures: 0,
    transientRecoveries: 0,
    persistentFailures: 0,
  };
  const notifications = checkStats.get(NOTIFICATIONS_CHECK) || {
    failures: 0,
    transientRecoveries: 0,
    persistentFailures: 0,
  };

  let myPiecesReadyTimeoutMs = 18000 + Math.min(12000, myPieces.transientRecoveries * 3000);
  let myPiecesReloadRetryCount = 1 + Math.min(2, Math.max(0, myPieces.transientRecoveries - 1));
  let markReadRetryCount = 1 + Math.min(2, notifications.transientRecoveries);

  if (myPieces.persistentFailures > myPieces.transientRecoveries + 1) {
    myPiecesReloadRetryCount = 1;
  }
  if (notifications.persistentFailures > notifications.transientRecoveries + 1) {
    markReadRetryCount = 1;
  }

  myPiecesReadyTimeoutMs = clampInteger(myPiecesReadyTimeoutMs, 12000, 45000, 18000);
  myPiecesReloadRetryCount = clampInteger(myPiecesReloadRetryCount, 0, 3, 1);
  markReadRetryCount = clampInteger(markReadRetryCount, 0, 3, 1);

  const appliedDirectives = [];
  const ignoredDirectives = [];
  const customPatterns = [...uniqueInheritedPatterns];

  for (const directive of directives) {
    const key = directive.key;
    const value = directive.value;

    if (["mypieces-timeout-ms", "my-pieces-timeout-ms"].includes(key)) {
      myPiecesReadyTimeoutMs = clampInteger(value, 12000, 45000, myPiecesReadyTimeoutMs);
      appliedDirectives.push(directive);
      continue;
    }
    if (["mypieces-reload-retries", "my-pieces-reload-retries"].includes(key)) {
      myPiecesReloadRetryCount = clampInteger(value, 0, 3, myPiecesReloadRetryCount);
      appliedDirectives.push(directive);
      continue;
    }
    if (["mark-read-retries", "notifications-retries", "markread-retries"].includes(key)) {
      markReadRetryCount = clampInteger(value, 0, 3, markReadRetryCount);
      appliedDirectives.push(directive);
      continue;
    }
    if (["mypieces-empty-state", "my-pieces-empty-state"].includes(key)) {
      const normalized = String(value || "").trim();
      if (normalized && normalized.length <= 120) {
        customPatterns.push(normalized);
        appliedDirectives.push(directive);
      } else {
        ignoredDirectives.push({ ...directive, reason: "empty-state directive was blank or too long" });
      }
      continue;
    }

    ignoredDirectives.push({ ...directive, reason: "unknown directive key" });
  }

  const checkStatList = Array.from(checkStats.values()).sort((a, b) => b.failures - a.failures);
  const topFailureMessages = Array.from(failureMessages.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([message, count]) => ({ message, count }));

  return {
    sourceRunCount: runsWithReports.length,
    checkStatList,
    topFailureMessages,
    feedback: {
      sourceRunCount: runsWithReports.length,
      agenticDirectiveCount: appliedDirectives.length,
      myPiecesReadyTimeoutMs,
      myPiecesReloadRetryCount,
      markReadRetryCount,
      myPiecesEmptyStatePatterns: Array.from(new Set(customPatterns)).slice(0, 20),
    },
    appliedDirectives,
    ignoredDirectives,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = {
    status: "ok",
    generatedAtIso: new Date().toISOString(),
    workflowName: options.workflowName,
    branch: options.branch,
    lookbackLimit: options.limit,
    recoveryWindow: options.recoveryWindow,
    sourceRunCount: 0,
    sourceRuns: [],
    signals: {
      checks: [],
      topFailureMessages: [],
    },
    feedback: {
      sourceRunCount: 0,
      agenticDirectiveCount: 0,
      myPiecesReadyTimeoutMs: 18000,
      myPiecesReloadRetryCount: 1,
      markReadRetryCount: 1,
      myPiecesEmptyStatePatterns: [],
    },
    agenticFeedback: {
      rollingIssue: {
        number: 0,
        url: "",
      },
      directiveCount: 0,
      appliedDirectives: [],
      ignoredDirectives: [],
    },
    notes: [],
  };

  const runsResponse = runCommand(
    "gh",
    [
      "run",
      "list",
      "--workflow",
      options.workflowName,
      "--branch",
      options.branch,
      "--limit",
      String(options.limit),
      "--json",
      "databaseId,conclusion,url,createdAt,headSha,status,event",
    ],
    { allowFailure: true }
  );

  if (!runsResponse.ok) {
    report.status = "github_unavailable";
    report.notes.push("Unable to query workflow runs via gh.");
  } else {
    let runs = [];
    try {
      const parsed = JSON.parse(runsResponse.stdout || "[]");
      runs = Array.isArray(parsed) ? parsed : [];
    } catch {
      runs = [];
      report.status = "parse_warning";
      report.notes.push("Could not parse gh run list JSON output.");
    }

    const filteredRuns = runs
      .filter((run) => String(run?.status || "").toLowerCase() === "completed")
      .filter((run) => {
        const runId = String(run?.databaseId || "").trim();
        if (!runId) return false;
        if (options.runId && runId === options.runId) return false;
        return true;
      });

    const scratchDir = await mkdtemp(resolve(tmpdir(), "portal-canary-feedback-"));
    try {
      for (const run of filteredRuns) {
        const loaded = await loadRunReport(run, options, scratchDir);
        report.sourceRuns.push({
          databaseId: Number(run.databaseId || 0),
          conclusion: normalizeConclusion(run.conclusion),
          status: String(run.status || "").toLowerCase(),
          createdAt: String(run.createdAt || ""),
          headSha: String(run.headSha || ""),
          url: String(run.url || ""),
          hasReport: loaded.hasReport,
          downloadError: loaded.downloadError,
          report: loaded.report,
        });
      }
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  }

  const repoSlug = options.includeGithub ? parseRepoSlug() : "";
  const rollingIssue = options.includeGithub && repoSlug ? findRollingIssue(repoSlug) : { number: 0, url: "", comments: [] };
  const directives = extractCanaryFeedbackDirectives(rollingIssue.comments);
  report.agenticFeedback.rollingIssue.number = rollingIssue.number;
  report.agenticFeedback.rollingIssue.url = rollingIssue.url;
  report.agenticFeedback.directiveCount = directives.length;

  const analysis = analyzeRuns(report.sourceRuns, options, directives);
  report.sourceRunCount = analysis.sourceRunCount;
  report.signals.checks = analysis.checkStatList;
  report.signals.topFailureMessages = analysis.topFailureMessages;
  report.feedback = analysis.feedback;
  report.agenticFeedback.appliedDirectives = analysis.appliedDirectives;
  report.agenticFeedback.ignoredDirectives = analysis.ignoredDirectives;

  report.sourceRuns = report.sourceRuns.map((item) => ({
    databaseId: item.databaseId,
    conclusion: item.conclusion,
    status: item.status,
    createdAt: item.createdAt,
    headSha: item.headSha,
    url: item.url,
    hasReport: item.hasReport,
    downloadError: item.downloadError,
  }));

  if (report.sourceRunCount === 0) {
    report.notes.push("No prior canary artifact reports were available; defaults retained.");
  }
  if (report.agenticFeedback.directiveCount === 0) {
    report.notes.push("No canary-feedback directives found in rolling issue comments.");
  }

  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${report.status}\n`);
    process.stdout.write(`sourceRuns: ${String(report.sourceRunCount)}\n`);
    process.stdout.write(`feedbackPath: ${options.reportPath}\n`);
    process.stdout.write(`myPiecesReadyTimeoutMs: ${String(report.feedback.myPiecesReadyTimeoutMs)}\n`);
    process.stdout.write(`myPiecesReloadRetryCount: ${String(report.feedback.myPiecesReloadRetryCount)}\n`);
    process.stdout.write(`markReadRetryCount: ${String(report.feedback.markReadRetryCount)}\n`);
    process.stdout.write(`agenticDirectiveCount: ${String(report.feedback.agenticDirectiveCount)}\n`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`portal-canary-feedback-loop failed: ${message}`);
  process.exit(1);
});
