#!/usr/bin/env node

/* eslint-disable no-console */

import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..", "..");

const TZ = "America/Phoenix";
const PRIMARY_WINDOW_HOURS = 12;
const SECONDARY_WINDOW_HOURS = 24;
const ROLLING_WINDOW_HOURS = 24 * 7;

const codexDir = resolve(repoRoot, ".codex");
const toolcallPath = resolve(codexDir, "toolcalls.ndjson");
const improvementLogPath = resolve(codexDir, "improvement-log.md");
const improvementStatePath = resolve(codexDir, "improvement-state.json");
const improvementReportsDir = resolve(repoRoot, "docs", "runbooks", "codex-improvement");

const rollingIssueTitle = "Codex Continuous Improvement (Rolling)";
const ignoreAnalysisFiles = new Set([
  ".codex/improvement-log.md",
  ".codex/improvement-state.json",
  ".codex/user.md",
  ".codex/agents.md",
  "docs/epics/EPIC-CODEX-INTERACTION-INTERROGATION.md",
]);

const metadataMatchers = [
  /^firebase\.json$/,
  /^firestore\.rules$/,
  /^storage\.rules$/,
  /^tsconfig[^/]*\.json$/,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^\.github\/workflows\//,
  /^web\/package\.json$/,
  /^functions\/package\.json$/,
  /^web\/package-lock\.json$/,
  /^functions\/package-lock\.json$/,
  /^yarn\.lock$/,
  /^pnpm-lock\.yaml$/,
];

const secretKeyPattern = /(token|secret|password|authorization|api[_-]?key|cookie|session|private[_-]?key)/i;
const secretValuePatterns = [
  /bearer\s+[a-z0-9._~-]+/gi,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /(gh[opsu]_[A-Za-z0-9_]{20,})/g,
  /(sk-[A-Za-z0-9]{20,})/g,
];

function defaultState() {
  return {
    lastRunAtIso: "1970-01-01T00:00:00.000Z",
    lastRunId: "1970-01-01-AM",
    lastSeenCommitSha: "",
    rolling7Day: {
      errorCounts: {},
      ciFailures: 0,
      churnFiles: {},
      ticketsCreated: 0,
      ticketsClosed: 0,
    },
    lastRecommendations: [],
    recommendationOutcomes: [],
    improvementImpactScores: [],
    skillDensityLast: {
      firestore: 0,
      cloudFunctions: 0,
      schedulingLogic: 0,
      metadataConfig: 0,
      tooling: 0,
      workflowPolicy: 0,
      automation: 0,
    },
    sharedCoordination: {
      automationPrByRunId: {},
      lastStructuralEditAtIso: "",
    },
  };
}

function parseArgs(argv) {
  const options = {
    apply: false,
    dryRun: true,
    persistDryRun: false,
    asJson: false,
    includeGithub: true,
    force: false,
    allowDirty: false,
    nowIso: "",
    runId: "",
    maxIssuesPerRun: 6,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--apply") {
      options.apply = true;
      options.dryRun = false;
      continue;
    }

    if (arg === "--dry-run") {
      options.apply = false;
      options.dryRun = true;
      continue;
    }

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }

    if (arg === "--persist-dry-run") {
      options.persistDryRun = true;
      continue;
    }

    if (arg === "--no-github") {
      options.includeGithub = false;
      continue;
    }

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    if (arg === "--allow-dirty") {
      options.allowDirty = true;
      continue;
    }

    const next = argv[index + 1];
    if (!arg.startsWith("--")) continue;
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--now") {
      options.nowIso = String(next).trim();
      index += 1;
      continue;
    }

    if (arg === "--run-id") {
      options.runId = String(next).trim();
      index += 1;
      continue;
    }

    if (arg === "--max-issues") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid --max-issues value: ${next}`);
      }
      options.maxIssuesPerRun = Math.floor(value);
      index += 1;
      continue;
    }
  }

  return options;
}

function toMs(value) {
  if (!value) return null;
  const parsed = new Date(value);
  const millis = parsed.getTime();
  return Number.isFinite(millis) ? millis : null;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function sanitizeString(value) {
  if (typeof value !== "string") return value;
  let out = value;
  for (const pattern of secretValuePatterns) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

function sanitizeValue(value, keyHint = "") {
  if (value == null) return value;
  if (secretKeyPattern.test(keyHint)) return "[REDACTED]";

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, keyHint));
  }

  if (typeof value === "object") {
    const output = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = sanitizeValue(nested, key);
    }
    return output;
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  return value;
}

function runCommand(command, args, { allowFailure = false, cwd = repoRoot, env = process.env } = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
  });
  const durationMs = Date.now() - startedAt;
  const code = typeof result.status === "number" ? result.status : 1;
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");

  if (code !== 0 && !allowFailure) {
    throw new Error(`Command failed (${code}): ${command} ${args.join(" ")}\n${stderr || stdout}`);
  }

  return {
    code,
    ok: code === 0,
    stdout,
    stderr,
    durationMs,
  };
}

function runGit(args, options = {}) {
  return runCommand("git", args, options);
}

function runGh(args, options = {}) {
  return runCommand("gh", args, options);
}

function runGhJson(args, { allowFailure = true } = {}) {
  const response = runGh(args, { allowFailure });
  if (!response.ok) {
    return {
      ok: false,
      data: null,
      error: response.stderr || response.stdout || "gh command failed",
      durationMs: response.durationMs,
    };
  }

  try {
    return {
      ok: true,
      data: response.stdout.trim() ? JSON.parse(response.stdout) : null,
      error: "",
      durationMs: response.durationMs,
    };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: `Invalid JSON from gh: ${error instanceof Error ? error.message : String(error)}`,
      durationMs: response.durationMs,
    };
  }
}

async function pathExists(targetPath) {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureContracts() {
  await mkdir(codexDir, { recursive: true });
  await mkdir(improvementReportsDir, { recursive: true });

  if (!(await pathExists(toolcallPath))) {
    await writeFile(toolcallPath, "", "utf8");
  }

  if (!(await pathExists(improvementLogPath))) {
    await writeFile(
      improvementLogPath,
      "# Codex Continuous Improvement Log\n\nThis file is append-only per run and summarizes autonomous improvement analysis windows.\n",
      "utf8"
    );
  }

  if (!(await pathExists(improvementStatePath))) {
    await writeFile(improvementStatePath, `${JSON.stringify(defaultState(), null, 2)}\n`, "utf8");
  }
}

async function readJsonFile(path, fallbackValue) {
  try {
    const raw = await readFile(path, "utf8");
    if (!raw.trim()) return fallbackValue;
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

async function writeJsonFile(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function appendToolcall(entry) {
  const payload = {
    tsIso: entry.tsIso || new Date().toISOString(),
    actor: entry.actor || "codex",
    tool: entry.tool || "unknown",
    action: entry.action || "unknown",
    ok: entry.ok === true,
    durationMs: typeof entry.durationMs === "number" ? Math.round(entry.durationMs) : null,
    errorType: typeof entry.errorType === "string" && entry.errorType.trim() ? entry.errorType.trim() : null,
    errorMessage:
      typeof entry.errorMessage === "string" && entry.errorMessage.trim()
        ? sanitizeString(entry.errorMessage.trim())
        : null,
    context: entry.context == null ? null : sanitizeValue(entry.context),
  };
  await appendFile(toolcallPath, `${JSON.stringify(payload)}\n`, "utf8");
}

function getPhoenixRunInfo(nowUtc) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(nowUtc);
  const map = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  const hour = Number(map.hour || "0");
  const runSlot = hour < 12 ? "AM" : "PM";
  const dateKey = `${map.year}-${map.month}-${map.day}`;

  return {
    dateKey,
    runSlot,
    runId: `${dateKey}-${runSlot}`,
    localClock: `${map.hour}:${map.minute}:${map.second}`,
  };
}

function parseRepoSlug() {
  const envSlug = String(process.env.GITHUB_REPOSITORY || "").trim();
  if (envSlug) return envSlug;

  const remote = runGit(["config", "--get", "remote.origin.url"], { allowFailure: true });
  if (!remote.ok) return "";
  const value = remote.stdout.trim();
  if (!value) return "";

  const sshMatch = value.match(/^git@github\.com:([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (sshMatch) return sshMatch[1];

  const httpsMatch = value.match(/^https:\/\/github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (httpsMatch) return httpsMatch[1];

  return "";
}

function isMetadataPath(path) {
  return metadataMatchers.some((matcher) => matcher.test(path));
}

function parseCommitLog(stdout) {
  const commits = [];
  const lines = String(stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const firstTab = line.indexOf("\t");
    const secondTab = line.indexOf("\t", firstTab + 1);
    if (firstTab <= 0 || secondTab <= firstTab) continue;

    const sha = line.slice(0, firstTab);
    const unix = Number(line.slice(firstTab + 1, secondTab));
    const subject = line.slice(secondTab + 1);
    if (!sha) continue;

    commits.push({
      sha,
      unix,
      atIso: Number.isFinite(unix) ? new Date(unix * 1000).toISOString() : null,
      subject,
    });
  }

  return commits;
}

function collectCommitsSince(sinceIso) {
  const result = runGit([
    "log",
    `--since=${sinceIso}`,
    "--pretty=format:%H%x09%ct%x09%s",
  ]);
  return parseCommitLog(result.stdout);
}

function collectFileCommitCountsSince(sinceIso) {
  const result = runGit([
    "log",
    `--since=${sinceIso}`,
    "--name-only",
    "--pretty=format:__COMMIT__%H",
  ]);

  const counts = new Map();
  let activeCommit = "";
  const lines = String(result.stdout || "").split("\n");

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("__COMMIT__")) {
      activeCommit = line.slice("__COMMIT__".length).trim();
      continue;
    }

    if (!activeCommit) continue;
    const normalized = line.replace(/\\/g, "/");
    if (!counts.has(normalized)) {
      counts.set(normalized, new Set());
    }
    counts.get(normalized).add(activeCommit);
  }

  const output = {};
  for (const [path, commits] of counts.entries()) {
    output[path] = commits.size;
  }

  return output;
}

async function readToolcalls() {
  let raw = "";
  try {
    raw = await readFile(toolcallPath, "utf8");
  } catch {
    return { entries: [], invalidLines: 0 };
  }

  const entries = [];
  let invalidLines = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      entries.push(parsed);
    } catch {
      invalidLines += 1;
    }
  }

  return { entries, invalidLines };
}

function filterByTimeWindow(items, key, sinceMs) {
  return items.filter((item) => {
    const ts = toMs(item?.[key]);
    return ts != null && ts >= sinceMs;
  });
}

function countByKey(items, key) {
  const counts = {};
  for (const item of items) {
    const value = String(item?.[key] ?? "").trim();
    if (!value) continue;
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function hasAutomationLabel(item) {
  const labels = Array.isArray(item?.labels) ? item.labels : [];
  return labels.some((label) => String(label?.name || "").toLowerCase() === "automation");
}

function toFailureSignature(run) {
  const workflow = String(run?.workflowName || "unknown-workflow").trim();
  const title = String(run?.displayTitle || run?.name || "untitled").trim();
  return `${workflow} :: ${title}`;
}

function collectFailureSignatures(runs) {
  const counts = {};
  for (const run of runs) {
    const signature = toFailureSignature(run);
    counts[signature] = (counts[signature] || 0) + 1;
  }
  return counts;
}

function isFailedConclusion(conclusion) {
  const normalized = String(conclusion || "").toLowerCase();
  return ["failure", "timed_out", "cancelled", "action_required", "startup_failure"].includes(normalized);
}

function ensureRecommendation(recommendations, recommendation) {
  if (!recommendation?.id) return;
  if (recommendations.some((entry) => entry.id === recommendation.id)) return;
  recommendations.push(recommendation);
}

function buildRunMarkdown({
  runInfo,
  summary,
  recommendations,
  ticketUrls,
  prUrl,
  nextFocus,
}) {
  const lines = [];
  lines.push(`# Codex Continuous Improvement ${runInfo.runId}`);
  lines.push("");
  lines.push("## Evidence Summary");
  lines.push(`- Window (primary): last ${PRIMARY_WINDOW_HOURS}h`);
  lines.push(`- Window (rollup): last ${SECONDARY_WINDOW_HOURS}h`);
  lines.push(`- Commits (24h): ${summary.activity.commits24h}`);
  lines.push(`- CI failures (24h): ${summary.failures.ciFailures24h}`);
  lines.push(`- Tool failure rate (24h): ${(summary.tools.failureRate24h * 100).toFixed(1)}%`);
  lines.push("");

  lines.push("## What Changed");
  if (recommendations.length === 0) {
    lines.push("- No threshold-triggered changes for this run.");
  } else {
    for (const recommendation of recommendations) {
      lines.push(`- ${recommendation.title}`);
    }
  }
  lines.push("");

  lines.push("## Why");
  lines.push("- Reduce recurring failures and noisy churn with small, targeted interventions.");
  lines.push("- Keep automation evidence-based and reviewable through normal PR flow.");
  lines.push("");

  lines.push("## Risk Assessment");
  lines.push("- Scope is constrained to recommendation/ticket/reporting automation.");
  lines.push("- No direct pushes to main.");
  lines.push("- Loop-prevention and run-id gating are enforced.");
  lines.push("");

  lines.push("## QA Steps");
  lines.push("1. Run `node ./scripts/codex/daily-improvement.mjs --dry-run --json`.");
  lines.push("2. Confirm no secrets appear in `.codex/toolcalls.ndjson` entries.");
  lines.push("3. Verify run heading appended to `.codex/improvement-log.md`.");
  lines.push("4. Validate run-id skip by re-running without `--force`.");
  lines.push("5. Verify branch name format and labels in created/updated PR.");
  lines.push("");

  lines.push("## Tickets Created");
  if (ticketUrls.length === 0) {
    lines.push("- None created in this run.");
  } else {
    ticketUrls.forEach((url) => lines.push(`- ${url}`));
  }
  lines.push("");

  lines.push("## Next 12h Focus");
  nextFocus.forEach((focus) => lines.push(`- ${focus}`));
  lines.push("");

  lines.push("## PR Link");
  lines.push(`- ${prUrl || "pending"}`);
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function buildRollingIssueComment({ runInfo, summary, recommendations, ticketUrls, prUrl, nextFocus }) {
  const lines = [];
  lines.push(`## ${runInfo.dateKey} (${runInfo.runSlot}, last ${PRIMARY_WINDOW_HOURS}h, rollup ${SECONDARY_WINDOW_HOURS}h)`);
  lines.push("");
  lines.push("### Activity Summary");
  lines.push(`- Commits (12h): ${summary.activity.commits12h}`);
  lines.push(`- Commits (24h): ${summary.activity.commits24h}`);
  lines.push(`- Reverts (24h): ${summary.activity.reverts24h}`);
  lines.push(`- PRs merged (24h): ${summary.activity.prMerged24h}`);
  lines.push("");

  lines.push("### Failure Clusters");
  if (recommendations.length === 0) {
    lines.push("- No threshold-triggered clusters this run.");
  } else {
    recommendations.slice(0, 8).forEach((recommendation) => {
      lines.push(`- ${recommendation.id}: ${recommendation.trigger}`);
    });
  }
  lines.push("");

  lines.push("### Impact Summary");
  lines.push(`- CI health delta: ${summary.impact.ciHealthDelta == null ? "n/a" : summary.impact.ciHealthDelta}`);
  lines.push(`- Error cluster delta: ${summary.impact.errorClusterDelta == null ? "n/a" : summary.impact.errorClusterDelta}`);
  lines.push(`- Tool failure rate delta: ${summary.impact.toolFailureRateDelta == null ? "n/a" : `${(summary.impact.toolFailureRateDelta * 100).toFixed(1)}%`}`);
  lines.push(`- File churn delta: ${summary.impact.fileChurnDelta == null ? "n/a" : summary.impact.fileChurnDelta}`);
  lines.push(`- Impact score: ${summary.impact.impactScore}`);
  lines.push("");

  lines.push("### Skill Density Report");
  Object.entries(summary.skillDensity).forEach(([skill, count]) => {
    lines.push(`- ${skill}: ${count}`);
  });
  lines.push("");

  lines.push("### Interaction Friction Clusters");
  if (summary.interactionFrictionClusters.length === 0) {
    lines.push("- None");
  } else {
    summary.interactionFrictionClusters.forEach((cluster) => lines.push(`- ${cluster}`));
  }
  lines.push("");

  lines.push("### Structural Evolution Decision");
  lines.push(`- ${summary.structuralEvolutionDecision.status}`);
  lines.push(`- Reason: ${summary.structuralEvolutionDecision.reason}`);
  lines.push("");

  lines.push("### Auto-Created Tickets");
  if (ticketUrls.length === 0) {
    lines.push("- None");
  } else {
    ticketUrls.forEach((url) => lines.push(`- ${url}`));
  }
  lines.push("");

  lines.push("### PRs Created");
  lines.push(`- ${prUrl || "None"}`);
  lines.push("");

  lines.push("### Next 12h Focus");
  nextFocus.forEach((focus) => lines.push(`- ${focus}`));
  lines.push("");

  return lines.join("\n");
}

function buildLogEntry({ runInfo, summary, recommendations, ticketUrls, prUrl, nextFocus }) {
  const lines = [];
  lines.push(`## ${runInfo.dateKey} (${runInfo.runSlot}, last ${PRIMARY_WINDOW_HOURS}h, rollup ${SECONDARY_WINDOW_HOURS}h)`);
  lines.push("");

  lines.push("### Activity Summary");
  lines.push(`- Commits (12h): ${summary.activity.commits12h}`);
  lines.push(`- Commits (24h): ${summary.activity.commits24h}`);
  lines.push(`- Reverts (24h): ${summary.activity.reverts24h}`);
  lines.push(`- PRs opened (24h): ${summary.activity.prOpened24h}`);
  lines.push(`- PRs merged (24h): ${summary.activity.prMerged24h}`);
  lines.push("");

  lines.push("### Failure Clusters");
  if (recommendations.length === 0) {
    lines.push("- No recurring clusters crossed thresholds.");
  } else {
    recommendations.slice(0, 12).forEach((recommendation) => {
      lines.push(`- ${recommendation.id}: ${recommendation.trigger}`);
    });
  }
  lines.push("");

  lines.push("### Tool Call Analysis");
  lines.push(`- Tool calls (24h): ${summary.tools.total24h}`);
  lines.push(`- Tool failures (24h): ${summary.tools.failed24h}`);
  lines.push(`- Failure rate (24h): ${(summary.tools.failureRate24h * 100).toFixed(1)}%`);
  lines.push("");

  lines.push("### Metadata Changes");
  if (summary.metadata.changedFiles.length === 0) {
    lines.push("- No metadata/config changes in the last 24h.");
  } else {
    summary.metadata.changedFiles.forEach((entry) => {
      lines.push(`- ${entry.path} (${entry.commitTouches} commit touches)`);
    });
  }
  lines.push("");

  lines.push("### Impact Summary");
  lines.push(`- PRs merged since last run: ${summary.impact.prMergedSinceLast}`);
  lines.push(`- Tickets closed since last run: ${summary.impact.ticketsClosedSinceLast}`);
  lines.push(`- CI health delta: ${summary.impact.ciHealthDelta == null ? "n/a" : summary.impact.ciHealthDelta}`);
  lines.push(`- Error cluster delta: ${summary.impact.errorClusterDelta == null ? "n/a" : summary.impact.errorClusterDelta}`);
  lines.push(`- Tool failure rate delta: ${summary.impact.toolFailureRateDelta == null ? "n/a" : `${(summary.impact.toolFailureRateDelta * 100).toFixed(1)}%`}`);
  lines.push(`- File churn delta: ${summary.impact.fileChurnDelta == null ? "n/a" : summary.impact.fileChurnDelta}`);
  lines.push(`- Impact score: ${summary.impact.impactScore}`);
  lines.push("");

  lines.push("### Recommendation Follow-Through");
  if (summary.followThrough.length === 0) {
    lines.push("- No prior recommendations to evaluate.");
  } else {
    summary.followThrough.forEach((outcome) => {
      const evidenceSuffix =
        Array.isArray(outcome.evidenceLinks) && outcome.evidenceLinks.length > 0
          ? ` (${outcome.evidenceLinks.slice(0, 2).join(", ")})`
          : "";
      lines.push(`- ${outcome.recommendationId}: ${outcome.status}${evidenceSuffix}`);
    });
  }
  lines.push("");

  lines.push("### Skill Density Report");
  Object.entries(summary.skillDensity).forEach(([skill, count]) => {
    lines.push(`- ${skill}: ${count}`);
  });
  lines.push("");

  lines.push("### Interaction Friction Clusters");
  if (summary.interactionFrictionClusters.length === 0) {
    lines.push("- None");
  } else {
    summary.interactionFrictionClusters.forEach((cluster) => lines.push(`- ${cluster}`));
  }
  lines.push("");

  lines.push("### Structural Evolution Decision");
  lines.push(`- ${summary.structuralEvolutionDecision.status}`);
  lines.push(`- Reason: ${summary.structuralEvolutionDecision.reason}`);
  lines.push("");

  lines.push("### Auto-Created Tickets");
  if (ticketUrls.length === 0) {
    lines.push("- None");
  } else {
    ticketUrls.forEach((url) => lines.push(`- ${url}`));
  }
  lines.push("");

  lines.push("### PRs Created");
  lines.push(`- ${prUrl || "None"}`);
  lines.push("");

  lines.push("### Next 12h Focus");
  nextFocus.forEach((focus) => lines.push(`- ${focus}`));
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function recommendationIssueTitle(recommendation) {
  return `[Codex Improvement] ${recommendation.title}`;
}

function recommendationIssueBody(recommendation, runInfo) {
  return [
    `<!-- codex-improvement:${recommendation.id} -->`,
    `Run: ${runInfo.runId}`,
    "",
    "## Trigger",
    recommendation.trigger,
    "",
    "## Why This Matters",
    recommendation.why,
    "",
    "## Suggested Action",
    recommendation.action,
    "",
    "## Evidence",
    ...recommendation.evidence.map((item) => `- ${item}`),
    "",
    "## Safety",
    "- No direct push to main",
    "- PR-only remediation",
    "",
  ].join("\n");
}

function toRecommendationOutcomes(
  previousRecommendations,
  currentRecommendations,
  githubAvailable,
  evidenceByRecommendation = {}
) {
  const currentIds = new Set(currentRecommendations.map((recommendation) => recommendation.id));
  const outcomes = [];

  for (const id of previousRecommendations) {
    let status = "Achieved";
    if (currentIds.has(id)) {
      status = githubAvailable ? "In Progress" : "Blocked";
    }

    if (!currentIds.has(id) && !githubAvailable) {
      status = "Not Started";
    }

    outcomes.push({
      recommendationId: id,
      status,
      evidenceLinks: Array.isArray(evidenceByRecommendation[id]) ? evidenceByRecommendation[id] : [],
      atIso: new Date().toISOString(),
    });
  }

  return outcomes;
}

async function ensureGhLabel(repoSlug, name, color, description, enabled) {
  if (!enabled) return;
  runGh(
    [
      "label",
      "create",
      name,
      "--repo",
      repoSlug,
      "--color",
      color,
      "--description",
      description,
      "--force",
    ],
    { allowFailure: true }
  );
}

function nowDate(options) {
  if (!options.nowIso) return new Date();
  const parsed = new Date(options.nowIso);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid --now value: ${options.nowIso}`);
  }
  return parsed;
}

function detectRunActor() {
  return process.env.GITHUB_ACTIONS === "true" ? "github-action" : "codex";
}

function getWorkingTreeDirty() {
  const result = runGit(["status", "--porcelain"], { allowFailure: true });
  if (!result.ok) return false;
  return result.stdout.trim().length > 0;
}

function summarizeGithubPrs(prs, start24Ms, sinceLastMs) {
  const safeList = Array.isArray(prs) ? prs : [];
  const nonAutomation = safeList.filter((pr) => !hasAutomationLabel(pr));

  const opened24h = nonAutomation.filter((pr) => {
    const createdAt = toMs(pr.createdAt);
    return createdAt != null && createdAt >= start24Ms;
  }).length;

  const merged24h = nonAutomation.filter((pr) => {
    const mergedAt = toMs(pr.mergedAt);
    return mergedAt != null && mergedAt >= start24Ms;
  }).length;

  const mergedSinceLast =
    sinceLastMs == null
      ? 0
      : nonAutomation.filter((pr) => {
          const mergedAt = toMs(pr.mergedAt);
          return mergedAt != null && mergedAt >= sinceLastMs;
        }).length;

  return {
    opened24h,
    merged24h,
    mergedSinceLast,
    nonAutomation,
  };
}

function averageMergeCycleHours(prs, start24Ms) {
  const samples = [];
  for (const pr of prs) {
    const createdAt = toMs(pr.createdAt);
    const mergedAt = toMs(pr.mergedAt);
    if (createdAt == null || mergedAt == null) continue;
    if (mergedAt < start24Ms) continue;
    if (mergedAt < createdAt) continue;
    samples.push((mergedAt - createdAt) / (1000 * 60 * 60));
  }

  if (samples.length === 0) return null;
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

function parseLabels(entry) {
  const labels = Array.isArray(entry?.labels) ? entry.labels : [];
  return labels.map((label) => String(label?.name || "").toLowerCase());
}

function summarizeIssues(issues, start24Ms, sinceLastMs) {
  const safeList = Array.isArray(issues) ? issues : [];

  const automationIssues = safeList.filter((issue) => {
    const labels = parseLabels(issue);
    return labels.includes("automation") || labels.includes("epic:codex-improvement");
  });

  const created24h = automationIssues.filter((issue) => {
    const createdAt = toMs(issue.createdAt);
    return createdAt != null && createdAt >= start24Ms;
  }).length;

  const closed24h = automationIssues.filter((issue) => {
    const closedAt = toMs(issue.closedAt);
    return closedAt != null && closedAt >= start24Ms;
  }).length;

  const closedSinceLast =
    sinceLastMs == null
      ? 0
      : automationIssues.filter((issue) => {
          const closedAt = toMs(issue.closedAt);
          return closedAt != null && closedAt >= sinceLastMs;
        }).length;

  return {
    created24h,
    closed24h,
    closedSinceLast,
  };
}

function computeImpactScore({
  repeatedFailureClusterCount,
  clarificationLoopCount,
  ciFailureRepeatCount,
  toolRetryClusterCount,
  highChurnHotspotCount,
  mergedPrNoReworkCount,
  ticketsClosedNoReopenCount,
  toolFailureRateDecreased,
}) {
  let score = 100;
  score -= repeatedFailureClusterCount * 5;
  score -= clarificationLoopCount * 5;
  score -= ciFailureRepeatCount * 5;
  score -= toolRetryClusterCount * 3;
  score -= highChurnHotspotCount * 3;
  score += mergedPrNoReworkCount * 3;
  score += ticketsClosedNoReopenCount * 3;
  if (toolFailureRateDecreased) {
    score += 2;
  }
  return Math.max(0, Math.min(100, score));
}

function buildNextFocus(runSlot, recommendations) {
  const focus = [];

  if (runSlot === "AM") {
    focus.push("Triage new failure clusters and convert top items into scoped tickets.");
    focus.push("Land low-risk guardrails (lint/test/check scripts) for highest-frequency failures.");
    focus.push("Verify metadata/config churn has explicit owner and rollback notes.");
  } else {
    focus.push("Drive follow-through on AM recommendations and reduce open automation ticket backlog.");
    focus.push("Stabilize repeated CI failures and close at least one recurring signature.");
    focus.push("Promote proven guardrails into default developer workflows.");
  }

  if (recommendations.length > 0) {
    focus.push(`Address top recommendation first: ${recommendations[0].title}.`);
  }

  return focus;
}

function uniqueList(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function normalizeSkillDensity(raw) {
  const baseline = {
    firestore: 0,
    cloudFunctions: 0,
    schedulingLogic: 0,
    metadataConfig: 0,
    tooling: 0,
    workflowPolicy: 0,
    automation: 0,
  };

  if (!raw || typeof raw !== "object") return baseline;
  return {
    ...baseline,
    ...Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, Number(value || 0)])
    ),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runStartedAt = new Date();
  const shouldPersist = options.apply || options.persistDryRun;

  await ensureContracts();
  const state = await readJsonFile(improvementStatePath, defaultState());
  const sharedCoordination =
    state?.sharedCoordination && typeof state.sharedCoordination === "object"
      ? state.sharedCoordination
      : { automationPrByRunId: {} };

  const now = nowDate(options);
  const runInfo = getPhoenixRunInfo(now);
  if (options.runId) {
    runInfo.runId = options.runId;
  }

  if (!options.force && state.lastRunId === runInfo.runId) {
    const skipped = {
      status: "skipped",
      reason: `Run ${runInfo.runId} already processed by state memory`,
      runId: runInfo.runId,
      timeZone: TZ,
      statePath: relative(repoRoot, improvementStatePath),
    };

    await appendToolcall({
      actor: detectRunActor(),
      tool: "daily-improvement",
      action: "skip-duplicate-run",
      ok: true,
      durationMs: Date.now() - runStartedAt.getTime(),
      context: {
        runId: runInfo.runId,
      },
    });

    if (options.asJson) {
      process.stdout.write(`${JSON.stringify(skipped, null, 2)}\n`);
    } else {
      process.stdout.write(`skipped: ${skipped.reason}\n`);
    }
    return;
  }

  const start12Ms = now.getTime() - PRIMARY_WINDOW_HOURS * 60 * 60 * 1000;
  const start24Ms = now.getTime() - SECONDARY_WINDOW_HOURS * 60 * 60 * 1000;
  const start7dMs = now.getTime() - ROLLING_WINDOW_HOURS * 60 * 60 * 1000;

  const start12Iso = new Date(start12Ms).toISOString();
  const start24Iso = new Date(start24Ms).toISOString();
  const start7dIso = new Date(start7dMs).toISOString();

  const lastRunMs = toMs(state.lastRunAtIso);
  const headSha = runGit(["rev-parse", "HEAD"]).stdout.trim();

  const commits12 = collectCommitsSince(start12Iso);
  const commits24 = collectCommitsSince(start24Iso);
  const commits7d = collectCommitsSince(start7dIso);
  const commitsSinceLast = lastRunMs == null ? [] : collectCommitsSince(new Date(lastRunMs).toISOString());

  const reverts24 = commits24.filter((commit) => {
    const subject = String(commit.subject || "").toLowerCase();
    return subject.startsWith("revert") || subject.includes("reverted");
  }).length;

  const churn24 = collectFileCommitCountsSince(start24Iso);
  const churn7d = collectFileCommitCountsSince(start7dIso);

  const churnEntries24 = Object.entries(churn24)
    .filter(([path]) => !ignoreAnalysisFiles.has(path))
    .sort((left, right) => right[1] - left[1]);

  const highChurnFiles = churnEntries24.filter(([, touches]) => touches >= 4);

  const metadataEntries24 = churnEntries24
    .filter(([path]) => isMetadataPath(path))
    .map(([path, touches]) => ({ path, commitTouches: touches }));
  const metadataTouchTotal24 = metadataEntries24.reduce((sum, entry) => sum + entry.commitTouches, 0);
  const metadataUnstable =
    metadataTouchTotal24 >= 4 || metadataEntries24.some((entry) => entry.commitTouches >= 3);

  const toolcallData = await readToolcalls();
  const calls12 = filterByTimeWindow(toolcallData.entries, "tsIso", start12Ms);
  const calls24 = filterByTimeWindow(toolcallData.entries, "tsIso", start24Ms);
  const calls7d = filterByTimeWindow(toolcallData.entries, "tsIso", start7dMs);

  const callFailures24 = calls24.filter((entry) => entry?.ok === false);
  const toolFailureRate24 = calls24.length === 0 ? 0 : callFailures24.length / calls24.length;
  const errorCounts24 = countByKey(callFailures24, "errorType");
  const repeatedErrorEntries = Object.entries(errorCounts24).filter(([, count]) => count >= 2);

  let githubAvailable = false;
  const notes = [];
  const repoSlug = parseRepoSlug();
  let prList = [];
  let issueList = [];
  let runList = [];

  if (!options.includeGithub) {
    notes.push("GitHub API calls disabled (--no-github). Running local-only analysis.");
  } else {
    const ghVersion = runGh(["--version"], { allowFailure: true });
    const authStatus = runGh(["auth", "status"], { allowFailure: true });
    githubAvailable = ghVersion.ok && authStatus.ok && !!repoSlug;

    if (!repoSlug) {
      notes.push("Unable to resolve repository slug from env or git remote; GitHub actions skipped.");
    }
    if (!ghVersion.ok) {
      notes.push("GitHub CLI is not available; GitHub actions skipped.");
    }
    if (!authStatus.ok) {
      notes.push("GitHub CLI is not authenticated; GitHub actions skipped.");
    }

    if (githubAvailable) {
      const prsResp = runGhJson([
        "pr",
        "list",
        "--repo",
        repoSlug,
        "--state",
        "all",
        "--limit",
        "200",
        "--json",
        "number,title,state,isDraft,createdAt,updatedAt,mergedAt,url,labels,headRefName,baseRefName",
      ]);
      if (prsResp.ok && Array.isArray(prsResp.data)) {
        prList = prsResp.data;
      } else {
        notes.push(`Failed to read PR list: ${prsResp.error}`);
      }

      const issuesResp = runGhJson([
        "issue",
        "list",
        "--repo",
        repoSlug,
        "--state",
        "all",
        "--limit",
        "200",
        "--json",
        "number,title,state,createdAt,updatedAt,closedAt,url,labels",
      ]);
      if (issuesResp.ok && Array.isArray(issuesResp.data)) {
        issueList = issuesResp.data;
      } else {
        notes.push(`Failed to read issue list: ${issuesResp.error}`);
      }

      const runsResp = runGhJson([
        "run",
        "list",
        "--repo",
        repoSlug,
        "--limit",
        "200",
        "--json",
        "databaseId,workflowName,displayTitle,name,status,conclusion,createdAt,updatedAt,url,event",
      ]);
      if (runsResp.ok && Array.isArray(runsResp.data)) {
        runList = runsResp.data;
      } else {
        notes.push(`Failed to read workflow runs: ${runsResp.error}`);
      }
    }
  }

  const prSummary = summarizeGithubPrs(prList, start24Ms, lastRunMs);
  const issueSummary = summarizeIssues(issueList, start24Ms, lastRunMs);

  const runs24 = runList.filter((run) => {
    const created = toMs(run.createdAt);
    return created != null && created >= start24Ms;
  });
  const failedRuns24 = runs24.filter((run) => isFailedConclusion(run.conclusion));
  const failedRuns7d = runList.filter((run) => {
    const created = toMs(run.createdAt);
    return created != null && created >= start7dMs && isFailedConclusion(run.conclusion);
  });

  const failureSignatures24 = collectFailureSignatures(failedRuns24);
  const repeatedFailureSignatures = Object.entries(failureSignatures24).filter(([, count]) => count >= 2);

  const recommendations = [];

  for (const [errorType, count] of repeatedErrorEntries) {
    ensureRecommendation(recommendations, {
      id: `error-${slugify(errorType)}`,
      title: `Reduce repeated ${errorType} failures`,
      trigger: `errorType '${errorType}' occurred ${count} times in 24h (threshold: >=2).`,
      why: "Repeated tool failures slow delivery and hide root causes.",
      action: "Add focused guardrail/tests or fallback handling for this failure cluster.",
      evidence: [`toolcalls.ndjson cluster count: ${count}`],
    });
  }

  if (toolFailureRate24 > 0.1 && calls24.length > 0) {
    ensureRecommendation(recommendations, {
      id: "tool-failure-rate-24h",
      title: "Lower tool failure rate above 10%",
      trigger: `Tool failure rate is ${(toolFailureRate24 * 100).toFixed(1)}% over ${calls24.length} calls (threshold: >10%).`,
      why: "High tool failure rates create avoidable rework and reduce confidence in automation.",
      action: "Prioritize top failing tools, add retries/fallbacks, and improve error classification.",
      evidence: [`failed calls: ${callFailures24.length}`, `total calls: ${calls24.length}`],
    });
  }

  for (const [signature, count] of repeatedFailureSignatures.slice(0, 4)) {
    ensureRecommendation(recommendations, {
      id: `ci-${slugify(signature)}`,
      title: "Stabilize repeated CI failure signature",
      trigger: `CI failure signature repeated ${count} times in 24h: ${signature}`,
      why: "Recurring CI failures block merges and inflate cycle time.",
      action: "Create a stabilization ticket and apply the smallest durable fix + regression guard.",
      evidence: [signature],
    });
  }

  for (const [path, touches] of highChurnFiles.slice(0, 6)) {
    ensureRecommendation(recommendations, {
      id: `churn-${slugify(path)}`,
      title: `Reduce churn hotspot in ${path}`,
      trigger: `${path} touched in ${touches} commits over 24h (threshold: >=4).`,
      why: "High churn often signals unclear ownership, unstable contracts, or missing tests.",
      action: "Add guardrails/tests and split responsibilities to reduce repeated edits.",
      evidence: [`commit touches: ${touches}`],
    });
  }

  if (metadataUnstable) {
    ensureRecommendation(recommendations, {
      id: "metadata-churn-unstable",
      title: "Stabilize metadata/config churn",
      trigger: `Metadata/config files show unstable churn (${metadataTouchTotal24} touches in 24h).`,
      why: "Frequent metadata churn can destabilize deploys and CI behavior.",
      action: "Consolidate config changes behind explicit runbooks and add stricter policy checks.",
      evidence: metadataEntries24.map((entry) => `${entry.path}: ${entry.commitTouches}`),
    });
  }

  const interactionSnapshot =
    state?.interactionInterrogation && typeof state.interactionInterrogation === "object"
      ? state.interactionInterrogation
      : {};

  const interactionPatternIds = uniqueList(interactionSnapshot.lastPatternIds || []);
  const interactionPatternRecommendationMap = {
    "clarification-loop-control": {
      id: "interaction-clarification-loop",
      title: "Reduce interaction clarification loops",
      trigger: "Interaction interrogation detected clarification loops >3 comments.",
      why: "Long comment loops indicate instruction ambiguity and slow delivery.",
      action: "Tighten prompt contracts and enforce ask-vs-decide guidance.",
      evidence: ["interactionInterrogation.lastPatternIds includes clarification-loop-control"],
    },
    "intake-mode-clarity": {
      id: "interaction-intakemode-misunderstanding",
      title: "Reduce repeated intakeMode misunderstandings",
      trigger: "Interaction interrogation detected repeated intakeMode misunderstandings.",
      why: "Repeated enum confusion creates preventable regression loops.",
      action: "Standardize canonical intakeMode references in prompts, checks, and tests.",
      evidence: ["interactionInterrogation.lastPatternIds includes intake-mode-clarity"],
    },
    "firestore-undefined-guardrail": {
      id: "interaction-firestore-undefined",
      title: "Reinforce Firestore undefined write guardrails",
      trigger: "Interaction interrogation detected repeated Firestore undefined confusion.",
      why: "Undefined write mistakes create runtime failures and avoidable churn.",
      action: "Strengthen payload sanitation and policy checks around undefined writes.",
      evidence: ["interactionInterrogation.lastPatternIds includes firestore-undefined-guardrail"],
    },
    "scheduling-exclusion-clarity": {
      id: "interaction-scheduling-exclusion",
      title: "Clarify scheduling exclusion expectations",
      trigger: "Interaction interrogation detected scheduling exclusion confusion.",
      why: "Scheduling ambiguity risks operational regressions.",
      action: "Add explicit include/exclude matrices to scheduling changes.",
      evidence: ["interactionInterrogation.lastPatternIds includes scheduling-exclusion-clarity"],
    },
  };

  for (const patternId of interactionPatternIds) {
    const mapped = interactionPatternRecommendationMap[patternId];
    if (!mapped) continue;
    ensureRecommendation(recommendations, mapped);
  }

  const retryClusterCounts = {};
  for (const entry of callFailures24) {
    const tool = String(entry?.tool || "").trim();
    const action = String(entry?.action || "").trim();
    if (!tool || !action) continue;
    const key = `${tool}::${action}`;
    retryClusterCounts[key] = (retryClusterCounts[key] || 0) + 1;
  }
  const toolRetryClusters = Object.entries(retryClusterCounts).filter(([, count]) => count >= 2);
  if (toolRetryClusters.length > 0) {
    ensureRecommendation(recommendations, {
      id: "tool-retry-loop-cluster",
      title: "Reduce repeated tool retry loops",
      trigger: `${toolRetryClusters.length} tool retry cluster(s) crossed threshold >=2.`,
      why: "Repeated identical retries waste cycles and hide root causes.",
      action: "Stop after repeated signatures and switch to structured fallback strategies.",
      evidence: toolRetryClusters.map(([signature, count]) => `${signature}: ${count}`),
    });
  }

  const interactionFrictionClusters = uniqueList([
    ...interactionPatternIds,
    ...(toolRetryClusters.length > 0 ? ["tool-retry-loop-cluster"] : []),
    ...(repeatedFailureSignatures.length > 0 ? ["ci-failure-repeat"] : []),
    ...(repeatedErrorEntries.length > 0 ? ["error-cluster-repeat"] : []),
  ]);

  const prevErrorTotal = Object.values(state?.rolling7Day?.errorCounts || {}).reduce(
    (sum, value) => sum + Number(value || 0),
    0
  );
  const currentErrorTotal = Object.values(errorCounts24).reduce((sum, value) => sum + Number(value || 0), 0);
  const errorClusterDelta = prevErrorTotal === 0 ? null : prevErrorTotal - currentErrorTotal;

  const previousToolFailureRate = (() => {
    const outcomes = Array.isArray(state.recommendationOutcomes) ? state.recommendationOutcomes : [];
    const last = outcomes.at(-1);
    if (!last || typeof last.toolFailureRate24h !== "number") return null;
    return last.toolFailureRate24h;
  })();
  const toolFailureRateDelta =
    previousToolFailureRate == null ? null : toolFailureRate24 - previousToolFailureRate;

  const ciHealthDelta =
    typeof state?.rolling7Day?.ciFailures === "number"
      ? state.rolling7Day.ciFailures - failedRuns24.length
      : null;

  const mergeCycleHours = averageMergeCycleHours(prSummary.nonAutomation, start24Ms);
  const totalTouches24 = churnEntries24.reduce((sum, [, touches]) => sum + touches, 0);
  const churnDensity = commits24.length === 0 ? 0 : totalTouches24 / commits24.length;
  const fileChurnDelta =
    typeof state?.lastHighChurnCount24 === "number"
      ? state.lastHighChurnCount24 - highChurnFiles.length
      : null;

  const localSkillDensity = {
    firestore:
      repeatedErrorEntries
        .filter(([errorType]) => /firestore|permission|failed-precondition/i.test(String(errorType || "")))
        .reduce((sum, [, count]) => sum + count, 0),
    cloudFunctions: repeatedFailureSignatures.filter(([signature]) =>
      /cloud function|functions|http/i.test(String(signature || ""))
    ).length,
    schedulingLogic: recommendations.filter((recommendation) =>
      /scheduling|firing|trigger|exclude/i.test(
        `${recommendation.id} ${recommendation.title} ${recommendation.trigger}`
      )
    ).length,
    metadataConfig: metadataTouchTotal24,
    tooling: callFailures24.length,
    workflowPolicy: recommendations.filter((recommendation) =>
      /workflow|branch|policy|guardrail/i.test(
        `${recommendation.id} ${recommendation.title} ${recommendation.trigger}`
      )
    ).length,
    automation: failedRuns24.filter((run) =>
      /codex|automation/i.test(
        `${String(run?.workflowName || "")} ${String(run?.displayTitle || "")}`
      )
    ).length,
  };
  const interactionSkillDensity = normalizeSkillDensity(interactionSnapshot.lastSkillDensity);
  const skillDensity = Object.fromEntries(
    Object.entries(localSkillDensity).map(([key, value]) => [
      key,
      Math.max(Number(value || 0), Number(interactionSkillDensity[key] || 0)),
    ])
  );
  const previousSkillDensity = normalizeSkillDensity(state.skillDensityLast);
  const skillDensitySpikes = Object.entries(skillDensity)
    .filter(([key, value]) => {
      const previous = Number(previousSkillDensity[key] || 0);
      if (previous === 0) return Number(value || 0) >= 3;
      return Number(value || 0) >= previous + 2 && Number(value || 0) >= Math.ceil(previous * 1.5);
    })
    .map(([key]) => key);

  if (skillDensitySpikes.length > 0) {
    ensureRecommendation(recommendations, {
      id: "skill-density-spike",
      title: "Address skill density spikes with structural guardrails",
      trigger: `Skill density spikes detected in: ${skillDensitySpikes.join(", ")}`,
      why: "Category-level spikes indicate recurring friction requiring stronger policy guardrails.",
      action: "Add structural constraints for affected skill areas and monitor for 2-3 runs.",
      evidence: skillDensitySpikes.map((skill) => `${skill}: ${skillDensity[skill]} (prev ${previousSkillDensity[skill] || 0})`),
    });
  }

  const repeatedFailureClusterCount = repeatedErrorEntries.length + interactionFrictionClusters.length;
  const clarificationLoopCount = interactionPatternIds.includes("clarification-loop-control") ? 1 : 0;
  const ciFailureRepeatCount = repeatedFailureSignatures.length;
  const toolRetryClusterCount = toolRetryClusters.length;
  const highChurnHotspotCount = highChurnFiles.length;
  const mergedPrNoReworkCount = Math.max(
    0,
    prSummary.merged24h - (interactionPatternIds.includes("pr-rework-ambiguity") ? 1 : 0)
  );
  const ticketsClosedNoReopenCount = issueSummary.closed24h;
  const toolFailureRateDecreased = toolFailureRateDelta != null && toolFailureRateDelta < 0;

  const impactScore = computeImpactScore({
    repeatedFailureClusterCount,
    clarificationLoopCount,
    ciFailureRepeatCount,
    toolRetryClusterCount,
    highChurnHotspotCount,
    mergedPrNoReworkCount,
    ticketsClosedNoReopenCount,
    toolFailureRateDecreased,
  });

  const impactHistory = Array.isArray(state.improvementImpactScores)
    ? state.improvementImpactScores.filter((value) => typeof value === "number")
    : [];
  const previousImpactScore = impactHistory.at(-1) ?? null;
  const twoBackImpactScore = impactHistory.at(-2) ?? null;
  const scoreDroppedTwice =
    previousImpactScore != null &&
    twoBackImpactScore != null &&
    previousImpactScore < twoBackImpactScore &&
    impactScore < previousImpactScore;

  const structuralTrigger =
    interactionFrictionClusters.length >= 2 || scoreDroppedTwice || skillDensitySpikes.length > 0;
  const structuralCooldownMs = 24 * 60 * 60 * 1000;
  const lastStructuralEditMs = toMs(state?.sharedCoordination?.lastStructuralEditAtIso);
  const structuralCooldownPassed =
    lastStructuralEditMs == null || now.getTime() - lastStructuralEditMs >= structuralCooldownMs;
  const structuralEvolutionDecision = {
    status: structuralTrigger && structuralCooldownPassed ? "Triggered" : "Deferred",
    reason: !structuralTrigger
      ? "No friction cluster >=2, no double impact-score drop, and no skill-density spike."
      : !structuralCooldownPassed
        ? "Structural trigger hit but 24h stability governor is active."
        : "Structural trigger met and cooldown satisfied.",
  };

  if (scoreDroppedTwice) {
    ensureRecommendation(recommendations, {
      id: "impact-score-double-drop",
      title: "Force structural guardrail tightening after consecutive score drops",
      trigger:
        "Impact score dropped across two consecutive runs (forced guardrail creation condition).",
      why: "Consecutive score decline indicates compounding process friction.",
      action:
        "Open/update automation PR with structural guardrail changes and validate over next 2-3 runs.",
      evidence: [
        `two runs back: ${twoBackImpactScore}`,
        `previous: ${previousImpactScore}`,
        `current: ${impactScore}`,
      ],
    });
  }

  const nextFocus = buildNextFocus(runInfo.runSlot, recommendations);
  if (structuralEvolutionDecision.status === "Triggered") {
    nextFocus.push("Apply structural guardrail tightening in this run and validate over next 2-3 runs.");
  }

  let createdTicketUrls = [];
  let prUrl = "";
  let runBranchUsed = "";
  let rollingIssueUrl = "";
  let rollingIssueNumber = null;

  if (options.apply && !options.allowDirty && getWorkingTreeDirty()) {
    throw new Error(
      "Refusing --apply run on dirty worktree. Commit/stash changes first or pass --allow-dirty explicitly."
    );
  }

  if (options.apply && githubAvailable) {
    await ensureGhLabel(repoSlug, "automation", "1d76db", "Automation-generated work", true);
    await ensureGhLabel(repoSlug, "epic:codex-improvement", "5319e7", "Codex continuous improvement epic", true);
    await ensureGhLabel(repoSlug, `run:${runInfo.runSlot}`, "0e8a16", "Codex AM/PM run marker", true);

    for (const recommendation of recommendations.slice(0, options.maxIssuesPerRun)) {
      const marker = `codex-improvement:${recommendation.id}`;
      const existingIssueResp = runGhJson([
        "issue",
        "list",
        "--repo",
        repoSlug,
        "--state",
        "open",
        "--search",
        `\"${marker}\" in:body`,
        "--limit",
        "1",
        "--json",
        "number,url,title",
      ]);

      if (existingIssueResp.ok && Array.isArray(existingIssueResp.data) && existingIssueResp.data.length > 0) {
        createdTicketUrls.push(existingIssueResp.data[0].url);
        continue;
      }

      const body = recommendationIssueBody(recommendation, runInfo);
      const createIssue = runGh(
        [
          "issue",
          "create",
          "--repo",
          repoSlug,
          "--title",
          recommendationIssueTitle(recommendation),
          "--body",
          body,
          "--label",
          "automation",
          "--label",
          "epic:codex-improvement",
        ],
        { allowFailure: true }
      );

      if (createIssue.ok) {
        const url = createIssue.stdout.trim();
        if (url) createdTicketUrls.push(url);
      }
    }

    const existingRollingResp = runGhJson([
      "issue",
      "list",
      "--repo",
      repoSlug,
      "--state",
      "open",
      "--search",
      `\"${rollingIssueTitle}\" in:title`,
      "--limit",
      "5",
      "--json",
      "number,title,url",
    ]);

    if (existingRollingResp.ok && Array.isArray(existingRollingResp.data)) {
      const exact = existingRollingResp.data.find((issue) => issue.title === rollingIssueTitle);
      if (exact) {
        rollingIssueNumber = exact.number;
        rollingIssueUrl = exact.url;
      }
    }

    if (!rollingIssueNumber) {
      const createRolling = runGh(
        [
          "issue",
          "create",
          "--repo",
          repoSlug,
          "--title",
          rollingIssueTitle,
          "--body",
          "Rolling run-by-run automation summary for Codex continuous improvement.",
          "--label",
          "automation",
          "--label",
          "epic:codex-improvement",
        ],
        { allowFailure: true }
      );
      if (createRolling.ok) {
        rollingIssueUrl = createRolling.stdout.trim();
        const numberMatch = rollingIssueUrl.match(/\/issues\/(\d+)$/);
        rollingIssueNumber = numberMatch ? Number(numberMatch[1]) : null;
      }
    }

    if (rollingIssueNumber) {
      const rollingComment = buildRollingIssueComment({
        runInfo,
        summary: {
          activity: {
            commits12h: commits12.length,
            commits24h: commits24.length,
            reverts24h: reverts24,
            prMerged24h: prSummary.merged24h,
          },
          failures: {
            ciFailures24h: failedRuns24.length,
          },
          impact: {
            ciHealthDelta,
            errorClusterDelta,
            toolFailureRateDelta,
            fileChurnDelta,
            impactScore,
          },
          skillDensity,
          interactionFrictionClusters,
          structuralEvolutionDecision,
        },
        recommendations,
        ticketUrls: createdTicketUrls,
        prUrl,
        nextFocus,
      });

      runGh(
        [
          "issue",
          "comment",
          String(rollingIssueNumber),
          "--repo",
          repoSlug,
          "--body",
          rollingComment,
        ],
        { allowFailure: true }
      );
    }

    const shouldCreateRunPr = recommendations.length > 0 || scoreDroppedTwice;

    if (shouldCreateRunPr) {
      const sharedRunPr = sharedCoordination?.automationPrByRunId?.[runInfo.runId];
      const branchName = sharedRunPr?.branch || `codex/auto-improve/${runInfo.runId}`;
      runBranchUsed = branchName;
      const previousBranch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
      const branchOwnedByImprovement = branchName.startsWith("codex/auto-improve/");

      if (sharedRunPr?.branch) {
        const fetchResult = runGit(["fetch", "origin", branchName], { allowFailure: true });
        if (fetchResult.ok) {
          runGit(["checkout", "-B", branchName, `origin/${branchName}`]);
        } else {
          runGit(["checkout", "-B", branchName]);
        }
      } else {
        runGit(["checkout", "-B", branchName]);
      }

      const reportPath = resolve(improvementReportsDir, `${runInfo.runId}.md`);
      const reportContent = buildRunMarkdown({
        runInfo,
        summary: {
          activity: {
            commits24h: commits24.length,
          },
          failures: {
            ciFailures24h: failedRuns24.length,
          },
          tools: {
            failureRate24h: toolFailureRate24,
          },
          impact: {
            ciHealthDelta,
            errorClusterDelta,
            toolFailureRateDelta,
            impactScore,
            prMergedSinceLast: prSummary.mergedSinceLast,
            ticketsClosedSinceLast: issueSummary.closedSinceLast,
          },
        },
        recommendations,
        ticketUrls: createdTicketUrls,
        prUrl,
        nextFocus,
      });
      await writeFile(reportPath, reportContent, "utf8");

      runGit([
        "add",
        relative(repoRoot, reportPath),
        relative(repoRoot, improvementLogPath),
        relative(repoRoot, improvementStatePath),
      ]);

      const stagedStatus = runGit(["diff", "--cached", "--name-only"], { allowFailure: true });
      if (stagedStatus.ok && stagedStatus.stdout.trim()) {
        runGit([
          "commit",
          "-m",
          `chore(codex): continuous improvement ${runInfo.runId}`,
        ]);
      }

      runGit(["push", "--set-upstream", "origin", branchName], { allowFailure: false });

      const existingPrResp = runGhJson([
        "pr",
        "list",
        "--repo",
        repoSlug,
        "--head",
        branchName,
        "--state",
        "open",
        "--limit",
        "1",
        "--json",
        "number,url,title",
      ]);

      const prTitle = `Codex Continuous Improvement ${runInfo.runId}`;
      const prBody = buildRunMarkdown({
        runInfo,
        summary: {
          activity: {
            commits24h: commits24.length,
          },
          failures: {
            ciFailures24h: failedRuns24.length,
          },
          tools: {
            failureRate24h: toolFailureRate24,
          },
          impact: {
            ciHealthDelta,
            errorClusterDelta,
            toolFailureRateDelta,
            impactScore,
            prMergedSinceLast: prSummary.mergedSinceLast,
            ticketsClosedSinceLast: issueSummary.closedSinceLast,
          },
        },
        recommendations,
        ticketUrls: createdTicketUrls,
        prUrl,
        nextFocus,
      });

      if (existingPrResp.ok && Array.isArray(existingPrResp.data) && existingPrResp.data.length > 0) {
        const currentPr = existingPrResp.data[0];
        if (branchOwnedByImprovement) {
          runGh(
            [
              "pr",
              "edit",
              String(currentPr.number),
              "--repo",
              repoSlug,
              "--title",
              prTitle,
              "--body",
              prBody,
              "--add-label",
              "automation",
              "--add-label",
              "epic:codex-improvement",
              "--add-label",
              `run:${runInfo.runSlot}`,
            ],
            { allowFailure: true }
          );
        } else {
          runGh(
            [
              "issue",
              "comment",
              String(currentPr.number),
              "--repo",
              repoSlug,
              "--body",
              `Continuous improvement update ${runInfo.runId}: recommendations=${recommendations.length}, impactScore=${impactScore}.`,
            ],
            { allowFailure: true }
          );
          runGh(
            [
              "pr",
              "edit",
              String(currentPr.number),
              "--repo",
              repoSlug,
              "--add-label",
              "epic:codex-improvement",
            ],
            { allowFailure: true }
          );
        }
        prUrl = currentPr.url;
      } else {
        const createPr = runGh(
          [
            "pr",
            "create",
            "--repo",
            repoSlug,
            "--base",
            "main",
            "--head",
            branchName,
            "--title",
            prTitle,
            "--body",
            prBody,
            "--label",
            "automation",
            "--label",
            "epic:codex-improvement",
            "--label",
            `run:${runInfo.runSlot}`,
          ],
          { allowFailure: true }
        );
        if (createPr.ok) {
          prUrl = createPr.stdout.trim();
        }
      }

      if (previousBranch && previousBranch !== branchName) {
        runGit(["checkout", previousBranch], { allowFailure: true });
      }
    }
  }

  const previousRecommendationIds = Array.isArray(state.lastRecommendations)
    ? state.lastRecommendations.map((entry) => String(entry))
    : [];
  const evidenceForOutcomes = uniqueList([
    ...createdTicketUrls,
    ...(prUrl ? [prUrl] : []),
  ]);
  const recommendationEvidenceMap = Object.fromEntries(
    previousRecommendationIds.map((id) => [id, evidenceForOutcomes])
  );
  const recommendationOutcomes = toRecommendationOutcomes(
    previousRecommendationIds,
    recommendations,
    githubAvailable,
    recommendationEvidenceMap
  );

  const summary = {
    activity: {
      commits12h: commits12.length,
      commits24h: commits24.length,
      commitsSinceLast: commitsSinceLast.length,
      reverts24h: reverts24,
      prOpened24h: prSummary.opened24h,
      prMerged24h: prSummary.merged24h,
    },
    failures: {
      repeatedErrorTypes24h: repeatedErrorEntries,
      ciFailures24h: failedRuns24.length,
      repeatedCiSignatures24h: repeatedFailureSignatures,
      highChurnFiles24h: highChurnFiles,
    },
    tools: {
      total12h: calls12.length,
      total24h: calls24.length,
      failed24h: callFailures24.length,
      failureRate24h: toolFailureRate24,
      invalidLines: toolcallData.invalidLines,
    },
    metadata: {
      changedFiles: metadataEntries24,
      unstable: metadataUnstable,
      touches24h: metadataTouchTotal24,
    },
    impact: {
      prMergedSinceLast: prSummary.mergedSinceLast,
      ticketsClosedSinceLast: issueSummary.closedSinceLast,
      ciHealthDelta,
      errorClusterDelta,
      toolFailureRateDelta,
      fileChurnDelta,
      mergeCycleHours24h: mergeCycleHours,
      reopenedPrCount24h: 0,
      churnDensity24h: churnDensity,
      impactScore,
    },
    followThrough: recommendationOutcomes.slice(0, 3),
    skillDensity,
    interactionFrictionClusters,
    structuralEvolutionDecision,
  };

  const logEntry = buildLogEntry({
    runInfo,
    summary,
    recommendations,
    ticketUrls: createdTicketUrls,
    prUrl,
    nextFocus,
  });
  if (shouldPersist) {
    await appendFile(improvementLogPath, `${logEntry}\n`, "utf8");
  } else {
    notes.push("Dry-run persistence disabled; improvement log/state files were not modified.");
  }

  const newState = {
    ...state,
    lastRunAtIso: now.toISOString(),
    lastRunId: runInfo.runId,
    lastSeenCommitSha: headSha,
    lastHighChurnCount24: highChurnFiles.length,
    improvementImpactScores: [
      ...(Array.isArray(state.improvementImpactScores) ? state.improvementImpactScores : []),
      impactScore,
    ].slice(-20),
    skillDensityLast: skillDensity,
    rolling7Day: {
      errorCounts: countByKey(calls7d.filter((entry) => entry?.ok === false), "errorType"),
      ciFailures: failedRuns7d.length,
      churnFiles: Object.fromEntries(
        Object.entries(churn7d)
          .filter(([path]) => !ignoreAnalysisFiles.has(path))
          .sort((left, right) => right[1] - left[1])
          .slice(0, 30)
      ),
      ticketsCreated: issueSummary.created24h,
      ticketsClosed: issueSummary.closed24h,
    },
    lastRecommendations: recommendations.map((recommendation) => recommendation.id),
    recommendationOutcomes: [
      ...(Array.isArray(state.recommendationOutcomes) ? state.recommendationOutcomes : []),
      ...recommendationOutcomes.map((outcome) => ({
        ...outcome,
        toolFailureRate24h: toolFailureRate24,
      })),
    ].slice(-250),
    sharedCoordination: {
      ...sharedCoordination,
      automationPrByRunId: {
        ...(sharedCoordination?.automationPrByRunId || {}),
        ...(prUrl
          ? {
              [runInfo.runId]: {
                url: prUrl,
                branch: runBranchUsed || `codex/auto-improve/${runInfo.runId}`,
                source:
                  (runBranchUsed || "").startsWith("codex/auto-improve/")
                    ? "improvement"
                    : "shared",
                updatedAtIso: now.toISOString(),
              },
            }
          : {}),
      },
      lastStructuralEditAtIso:
        structuralEvolutionDecision.status === "Triggered"
          ? now.toISOString()
          : sharedCoordination?.lastStructuralEditAtIso || "",
    },
  };
  if (shouldPersist) {
    await writeJsonFile(improvementStatePath, newState);
  }

  await appendToolcall({
    actor: detectRunActor(),
    tool: "daily-improvement",
    action: "analyze",
    ok: true,
    durationMs: Date.now() - runStartedAt.getTime(),
    context: {
      runId: runInfo.runId,
      recommendations: recommendations.length,
      ticketsCreated: createdTicketUrls.length,
      prCreated: Boolean(prUrl),
      impactScore,
      structuralEvolutionDecision: structuralEvolutionDecision.status,
      githubAvailable,
      dryRun: options.dryRun,
      persisted: shouldPersist,
    },
  });

  const output = {
    status: options.apply ? "applied" : "dry-run",
    persisted: shouldPersist,
    runId: runInfo.runId,
    runSlot: runInfo.runSlot,
    timeZone: TZ,
    windows: {
      primaryHours: PRIMARY_WINDOW_HOURS,
      rollupHours: SECONDARY_WINDOW_HOURS,
      start12Iso,
      start24Iso,
    },
    activitySummary: summary.activity,
    failureClusters: summary.failures,
    toolCallAnalysis: summary.tools,
    metadataChanges: summary.metadata,
    impactSummary: summary.impact,
    recommendationFollowThrough: summary.followThrough,
    skillDensityReport: summary.skillDensity,
    interactionFrictionClusters: summary.interactionFrictionClusters,
    structuralEvolutionDecision: summary.structuralEvolutionDecision,
    recommendations,
    autoCreatedTickets: createdTicketUrls,
    prsCreated: prUrl ? [prUrl] : [],
    rollingIssue: rollingIssueUrl || null,
    nextFocus,
    notes,
    artifacts: {
      improvementLogPath: relative(repoRoot, improvementLogPath),
      improvementStatePath: relative(repoRoot, improvementStatePath),
      toolcallPath: relative(repoRoot, toolcallPath),
    },
  };

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    process.stdout.write(
      [
        `status: ${output.status}`,
        `runId: ${output.runId}`,
        `recommendations: ${output.recommendations.length}`,
        `tickets: ${output.autoCreatedTickets.length}`,
        `pr: ${output.prsCreated[0] || "none"}`,
        `log: ${output.artifacts.improvementLogPath}`,
        "",
      ].join("\n")
    );
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await ensureContracts();
    await appendToolcall({
      actor: process.env.GITHUB_ACTIONS === "true" ? "github-action" : "codex",
      tool: "daily-improvement",
      action: "analyze",
      ok: false,
      durationMs: null,
      errorType: "runtime_error",
      errorMessage: message,
      context: null,
    });
  } catch {
    // Ignore nested logging failures.
  }

  console.error(`daily-improvement failed: ${message}`);
  process.exit(1);
});
