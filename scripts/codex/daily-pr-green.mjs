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
const codexDir = resolve(repoRoot, ".codex");
const toolcallPath = resolve(codexDir, "toolcalls.ndjson");
const improvementStatePath = resolve(codexDir, "improvement-state.json");
const prGreenLogPath = resolve(codexDir, "pr-green-log.md");
const rollingIssueTitle = "Codex PR Green Daily (Rolling)";

const secretKeyPattern = /(token|secret|password|authorization|api[_-]?key|cookie|session|private[_-]?key)/i;
const secretValuePatterns = [
  /bearer\s+[a-z0-9._~-]+/gi,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /(gh[opsu]_[A-Za-z0-9_]{20,})/g,
  /(sk-[A-Za-z0-9]{20,})/g,
];

function defaultTopLevelState() {
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
  };
}

function defaultPrGreenState() {
  return {
    lastRunAtIso: "1970-01-01T00:00:00.000Z",
    lastRunId: "1970-01-01-PR-GREEN",
    rerunRunIds: [],
    rerunHistory: [],
    lastSummary: {
      prsAnalyzed: 0,
      prsGreen: 0,
      prsPending: 0,
      prsBlocked: 0,
      failingChecks: 0,
      pendingChecks: 0,
      healthScore: 100,
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
    nowIso: "",
    runId: "",
    maxPrs: 30,
    maxReruns: 8,
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
    if (arg === "--persist-dry-run") {
      options.persistDryRun = true;
      continue;
    }
    if (arg === "--json") {
      options.asJson = true;
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
    if (arg === "--max-prs") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 1) throw new Error(`Invalid --max-prs value: ${next}`);
      options.maxPrs = Math.floor(value);
      index += 1;
      continue;
    }
    if (arg === "--max-reruns") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid --max-reruns value: ${next}`);
      options.maxReruns = Math.floor(value);
      index += 1;
      continue;
    }
  }

  return options;
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

  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry, keyHint));
  if (typeof value === "object") {
    const output = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = sanitizeValue(nested, key);
    }
    return output;
  }
  if (typeof value === "string") return sanitizeString(value);
  return value;
}

function runCommand(command, args, { allowFailure = false, cwd = repoRoot, env = process.env } = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8" });
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
    };
  }

  try {
    return {
      ok: true,
      data: response.stdout.trim() ? JSON.parse(response.stdout) : null,
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: `Invalid JSON from gh: ${error instanceof Error ? error.message : String(error)}`,
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

  if (!(await pathExists(toolcallPath))) {
    await writeFile(toolcallPath, "", "utf8");
  }
  if (!(await pathExists(improvementStatePath))) {
    await writeFile(improvementStatePath, `${JSON.stringify(defaultTopLevelState(), null, 2)}\n`, "utf8");
  }
  if (!(await pathExists(prGreenLogPath))) {
    await writeFile(
      prGreenLogPath,
      "# Codex PR Green Daily Log\n\nThis file is append-only and tracks daily PR green status audits.\n",
      "utf8"
    );
  }
}

async function readJsonFile(path, fallback) {
  try {
    const raw = await readFile(path, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function appendToolcall(entry) {
  const payload = {
    tsIso: entry.tsIso || new Date().toISOString(),
    actor: entry.actor || "codex",
    tool: entry.tool || "daily-pr-green",
    action: entry.action || "analyze",
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

function nowDate(options) {
  if (!options.nowIso) return new Date();
  const parsed = new Date(options.nowIso);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Invalid --now value: ${options.nowIso}`);
  return parsed;
}

function detectRunActor() {
  return process.env.GITHUB_ACTIONS === "true" ? "github-action" : "codex";
}

function getPhoenixDailyRunInfo(nowUtc) {
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
  for (const part of parts) map[part.type] = part.value;
  const dateKey = `${map.year}-${map.month}-${map.day}`;
  return {
    dateKey,
    runId: `${dateKey}-PR-GREEN`,
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

function toMs(value) {
  if (!value) return null;
  const parsed = new Date(value);
  const millis = parsed.getTime();
  return Number.isFinite(millis) ? millis : null;
}

function uniqueList(values) {
  return Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))
  );
}

function parseRunIdFromUrl(url) {
  const value = String(url || "");
  const match = value.match(/\/actions\/runs\/(\d+)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasAutomationLabel(item) {
  const labels = Array.isArray(item?.labels) ? item.labels : [];
  return labels.some((label) => String(label?.name || "").toLowerCase() === "automation");
}

function checkOutcomeType(check) {
  const status = String(check?.status || "").toLowerCase();
  const conclusion = String(check?.conclusion || "").toLowerCase();

  if (["queued", "in_progress", "pending", "waiting", "requested"].includes(status)) return "pending";
  if (status && status !== "completed") return "pending";
  if (["success", "neutral", "skipped"].includes(conclusion)) return "success";
  if (["failure", "timed_out", "cancelled", "startup_failure", "action_required", "stale"].includes(conclusion)) {
    return "failed";
  }
  return "pending";
}

function isRerunnableFailure(check) {
  const conclusion = String(check?.conclusion || "").toLowerCase();
  return ["timed_out", "cancelled", "startup_failure", "action_required"].includes(conclusion);
}

function computeHealthScore(summary) {
  let score = 100;
  score -= summary.prsBlocked * 12;
  score -= summary.prsPending * 5;
  score += summary.prsGreen * 2;
  if (summary.failingChecks === 0 && summary.pendingChecks === 0 && summary.prsAnalyzed > 0) {
    score += 4;
  }
  return Math.max(0, Math.min(100, score));
}

function buildLogEntry({ runInfo, summary, blockedPrs, rerunActions, nextFocus }) {
  const lines = [];
  lines.push(`## ${runInfo.dateKey} (PR-GREEN daily)`);
  lines.push("");
  lines.push("### PR Status Snapshot");
  lines.push(`- PRs analyzed: ${summary.prsAnalyzed}`);
  lines.push(`- Green: ${summary.prsGreen}`);
  lines.push(`- Pending: ${summary.prsPending}`);
  lines.push(`- Blocked: ${summary.prsBlocked}`);
  lines.push(`- Failing checks: ${summary.failingChecks}`);
  lines.push(`- Pending checks: ${summary.pendingChecks}`);
  lines.push(`- Health score: ${summary.healthScore}`);
  lines.push("");
  lines.push("### Blocking PRs");
  if (blockedPrs.length === 0) {
    lines.push("- None");
  } else {
    blockedPrs.slice(0, 20).forEach((pr) => {
      lines.push(`- #${pr.number} ${pr.title} (${pr.url})`);
      pr.failingChecks.slice(0, 5).forEach((check) => {
        lines.push(`  - ${check.name} [${check.conclusion}]`);
      });
    });
  }
  lines.push("");
  lines.push("### Auto Reruns");
  if (rerunActions.length === 0) {
    lines.push("- None");
  } else {
    rerunActions.forEach((action) => {
      lines.push(`- PR #${action.prNumber} run ${action.workflowRunId}: ${action.status}`);
    });
  }
  lines.push("");
  lines.push("### Next Focus");
  nextFocus.forEach((focus) => lines.push(`- ${focus}`));
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildRollingIssueComment({ runInfo, summary, blockedPrs, rerunActions, nextFocus }) {
  const lines = [];
  lines.push(`## ${runInfo.dateKey} (PR Green Daily)`);
  lines.push("");
  lines.push("### Status");
  lines.push(`- PRs analyzed: ${summary.prsAnalyzed}`);
  lines.push(`- Green: ${summary.prsGreen}`);
  lines.push(`- Pending: ${summary.prsPending}`);
  lines.push(`- Blocked: ${summary.prsBlocked}`);
  lines.push(`- Health score: ${summary.healthScore}`);
  lines.push("");
  lines.push("### Blocking PRs");
  if (blockedPrs.length === 0) {
    lines.push("- None");
  } else {
    blockedPrs.slice(0, 15).forEach((pr) => {
      lines.push(`- #${pr.number} ${pr.title}: ${pr.url}`);
      pr.failingChecks.slice(0, 4).forEach((check) => {
        lines.push(`  - ${check.name} [${check.conclusion}]`);
      });
    });
  }
  lines.push("");
  lines.push("### Auto Reruns");
  if (rerunActions.length === 0) {
    lines.push("- None");
  } else {
    rerunActions.forEach((action) => lines.push(`- PR #${action.prNumber} run ${action.workflowRunId}: ${action.status}`));
  }
  lines.push("");
  lines.push("### Next Focus");
  nextFocus.forEach((focus) => lines.push(`- ${focus}`));
  lines.push("");
  return lines.join("\n");
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

function buildNextFocus(summary, blockedPrs, rerunActions) {
  const focus = [];
  if (summary.prsBlocked > 0) {
    focus.push(`Unblock top ${Math.min(3, blockedPrs.length)} blocked PR(s) by fixing failing checks.`);
  } else {
    focus.push("Keep open PR checks green and reduce pending duration.");
  }
  if (rerunActions.length > 0) {
    focus.push("Verify rerun-requested jobs complete successfully and do not flap.");
  }
  if (summary.prsPending > 0) {
    focus.push("Investigate long-running pending checks and queue bottlenecks.");
  }
  return uniqueList(focus);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runStartedAt = new Date();
  const shouldPersist = options.apply || options.persistDryRun;

  await ensureContracts();

  const state = await readJsonFile(improvementStatePath, defaultTopLevelState());
  const prGreenState = {
    ...defaultPrGreenState(),
    ...(state.prGreenDaily && typeof state.prGreenDaily === "object" ? state.prGreenDaily : {}),
  };

  const now = nowDate(options);
  const runInfo = getPhoenixDailyRunInfo(now);
  if (options.runId) runInfo.runId = options.runId;

  if (!options.force && prGreenState.lastRunId === runInfo.runId) {
    const skipped = {
      status: "skipped",
      reason: `Run ${runInfo.runId} already processed`,
      runId: runInfo.runId,
      timeZone: TZ,
      statePath: relative(repoRoot, improvementStatePath),
    };

    await appendToolcall({
      actor: detectRunActor(),
      tool: "daily-pr-green",
      action: "skip-duplicate-run",
      ok: true,
      durationMs: Date.now() - runStartedAt.getTime(),
      context: { runId: runInfo.runId },
    });

    if (options.asJson) process.stdout.write(`${JSON.stringify(skipped, null, 2)}\n`);
    else process.stdout.write(`skipped: ${skipped.reason}\n`);
    return;
  }

  const notes = [];
  const repoSlug = parseRepoSlug();
  let githubAvailable = false;
  let rollingIssueUrl = "";
  let rollingIssueNumber = null;
  const rerunActions = [];
  const blockedPrs = [];
  const pendingPrs = [];
  const greenPrs = [];

  if (!options.includeGithub) {
    notes.push("GitHub API calls disabled (--no-github).");
  } else {
    const ghVersion = runGh(["--version"], { allowFailure: true });
    const authStatus = runGh(["auth", "status"], { allowFailure: true });
    githubAvailable = ghVersion.ok && authStatus.ok && !!repoSlug;

    if (!repoSlug) notes.push("Unable to resolve repository slug; GitHub actions skipped.");
    if (!ghVersion.ok) notes.push("GitHub CLI is unavailable.");
    if (!authStatus.ok) notes.push("GitHub CLI is not authenticated.");
  }

  const previousRerunIds = new Set(
    (Array.isArray(prGreenState.rerunRunIds) ? prGreenState.rerunRunIds : [])
      .map((id) => Number(id))
      .filter(Number.isFinite)
  );

  let prsAnalyzed = 0;
  let failingChecks = 0;
  let pendingChecks = 0;

  if (githubAvailable) {
    const prsResp = runGhJson([
      "pr",
      "list",
      "--repo",
      repoSlug,
      "--state",
      "open",
      "--limit",
      "200",
      "--json",
      "number,title,url,isDraft,headRefOid,labels,updatedAt,headRefName,baseRefName",
    ]);

    if (!prsResp.ok || !Array.isArray(prsResp.data)) {
      notes.push(`Failed to read open PRs: ${prsResp.error || "unknown error"}`);
    } else {
      const candidatePrs = prsResp.data
        .filter((pr) => !pr.isDraft)
        .filter((pr) => !hasAutomationLabel(pr))
        .sort((left, right) => (toMs(right.updatedAt) || 0) - (toMs(left.updatedAt) || 0))
        .slice(0, options.maxPrs);

      let rerunsThisRun = 0;
      for (const pr of candidatePrs) {
        const headSha = String(pr.headRefOid || "").trim();
        if (!headSha) continue;

        const checksResp = runGhJson(["api", `repos/${repoSlug}/commits/${headSha}/check-runs?per_page=100`]);
        if (!checksResp.ok) {
          notes.push(`Failed checks lookup for PR #${pr.number}: ${checksResp.error}`);
          continue;
        }

        const checkRuns = Array.isArray(checksResp?.data?.check_runs) ? checksResp.data.check_runs : [];
        const failing = [];
        const pending = [];
        const success = [];

        for (const check of checkRuns) {
          const outcome = checkOutcomeType(check);
          const item = {
            name: String(check?.name || "unnamed-check"),
            status: String(check?.status || ""),
            conclusion: String(check?.conclusion || ""),
            detailsUrl: String(check?.details_url || check?.html_url || ""),
            app: String(check?.app?.name || ""),
          };
          if (outcome === "failed") failing.push(item);
          else if (outcome === "pending") pending.push(item);
          else success.push(item);
        }

        failingChecks += failing.length;
        pendingChecks += pending.length;
        prsAnalyzed += 1;

        const prSnapshot = {
          number: Number(pr.number),
          title: String(pr.title || ""),
          url: String(pr.url || ""),
          failingChecks: failing,
          pendingChecks: pending,
          successChecks: success.length,
          totalChecks: checkRuns.length,
        };

        if (failing.length > 0) {
          blockedPrs.push(prSnapshot);
        } else if (pending.length > 0) {
          pendingPrs.push(prSnapshot);
        } else {
          greenPrs.push(prSnapshot);
        }

        if (options.apply) {
          for (const check of failing) {
            if (rerunsThisRun >= options.maxReruns) break;
            if (!isRerunnableFailure(check)) continue;

            const workflowRunId = parseRunIdFromUrl(check.detailsUrl);
            if (!workflowRunId) continue;
            if (previousRerunIds.has(workflowRunId)) continue;

            const rerunResp = runGh(
              ["run", "rerun", String(workflowRunId), "--failed", "--repo", repoSlug],
              { allowFailure: true }
            );

            const action = {
              prNumber: Number(pr.number),
              workflowRunId,
              checkName: check.name,
              status: rerunResp.ok ? "rerun_requested" : "rerun_failed",
              error: rerunResp.ok ? "" : String(rerunResp.stderr || rerunResp.stdout || ""),
              atIso: new Date().toISOString(),
            };
            rerunActions.push(action);
            rerunsThisRun += 1;
            if (rerunResp.ok) previousRerunIds.add(workflowRunId);
          }
        }
      }
    }
  }

  const summary = {
    prsAnalyzed,
    prsGreen: greenPrs.length,
    prsPending: pendingPrs.length,
    prsBlocked: blockedPrs.length,
    failingChecks,
    pendingChecks,
    healthScore: 100,
  };
  summary.healthScore = computeHealthScore(summary);

  const nextFocus = buildNextFocus(summary, blockedPrs, rerunActions);
  const logEntry = buildLogEntry({ runInfo, summary, blockedPrs, rerunActions, nextFocus });

  if (shouldPersist) {
    await appendFile(prGreenLogPath, `${logEntry}\n`, "utf8");
  } else {
    notes.push("Dry-run persistence disabled; PR green log/state files were not modified.");
  }

  if (options.apply && githubAvailable) {
    await ensureGhLabel(repoSlug, "automation", "1d76db", "Automation-generated work", true);
    await ensureGhLabel(repoSlug, "epic:codex-pr-green", "0366d6", "Daily PR green automation", true);

    const existingIssueResp = runGhJson([
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

    if (existingIssueResp.ok && Array.isArray(existingIssueResp.data)) {
      const exact = existingIssueResp.data.find((issue) => issue.title === rollingIssueTitle);
      if (exact) {
        rollingIssueNumber = exact.number;
        rollingIssueUrl = exact.url;
      }
    }

    if (!rollingIssueNumber) {
      const createIssue = runGh(
        [
          "issue",
          "create",
          "--repo",
          repoSlug,
          "--title",
          rollingIssueTitle,
          "--body",
          "Rolling daily status for open PR check health and unblock actions.",
          "--label",
          "automation",
          "--label",
          "epic:codex-pr-green",
        ],
        { allowFailure: true }
      );
      if (createIssue.ok) {
        rollingIssueUrl = createIssue.stdout.trim();
        const match = rollingIssueUrl.match(/\/issues\/(\d+)$/);
        rollingIssueNumber = match ? Number(match[1]) : null;
      }
    }

    if (rollingIssueNumber) {
      runGh(
        [
          "issue",
          "comment",
          String(rollingIssueNumber),
          "--repo",
          repoSlug,
          "--body",
          buildRollingIssueComment({ runInfo, summary, blockedPrs, rerunActions, nextFocus }),
        ],
        { allowFailure: true }
      );
    }
  }

  const nextState = {
    ...state,
    prGreenDaily: {
      ...prGreenState,
      lastRunAtIso: now.toISOString(),
      lastRunId: runInfo.runId,
      rerunRunIds: uniqueList(Array.from(previousRerunIds).map((id) => String(id))).slice(-400),
      rerunHistory: [
        ...(Array.isArray(prGreenState.rerunHistory) ? prGreenState.rerunHistory : []),
        ...rerunActions,
      ].slice(-400),
      lastSummary: summary,
    },
  };

  if (shouldPersist) {
    await writeJsonFile(improvementStatePath, nextState);
  }

  await appendToolcall({
    actor: detectRunActor(),
    tool: "daily-pr-green",
    action: "analyze",
    ok: true,
    durationMs: Date.now() - runStartedAt.getTime(),
    context: {
      runId: runInfo.runId,
      dryRun: options.dryRun,
      persisted: shouldPersist,
      prsAnalyzed: summary.prsAnalyzed,
      prsBlocked: summary.prsBlocked,
      rerunsRequested: rerunActions.filter((entry) => entry.status === "rerun_requested").length,
    },
  });

  const output = {
    status: options.apply ? "applied" : "dry-run",
    persisted: shouldPersist,
    runId: runInfo.runId,
    timeZone: TZ,
    summary,
    blockedPrs: blockedPrs.slice(0, 25).map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      failingChecks: pr.failingChecks.slice(0, 6),
    })),
    rerunActions,
    rollingIssue: rollingIssueUrl || null,
    nextFocus,
    notes,
    artifacts: {
      prGreenLogPath: relative(repoRoot, prGreenLogPath),
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
        `persisted: ${output.persisted}`,
        `runId: ${output.runId}`,
        `prs analyzed: ${output.summary.prsAnalyzed}`,
        `blocked: ${output.summary.prsBlocked}`,
        `reruns requested: ${output.rerunActions.filter((entry) => entry.status === "rerun_requested").length}`,
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
      actor: detectRunActor(),
      tool: "daily-pr-green",
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

  console.error(`daily-pr-green failed: ${message}`);
  process.exit(1);
});
