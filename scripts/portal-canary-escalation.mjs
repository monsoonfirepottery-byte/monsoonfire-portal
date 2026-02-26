#!/usr/bin/env node

/* eslint-disable no-console */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_WORKFLOW_NAME = "Portal Daily Authenticated Canary";
const DEFAULT_THRESHOLD = 2;
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "portal-authenticated-canary-escalation.json");
const DEFAULT_CANARY_REPORT = resolve(repoRoot, "output", "qa", "portal-authenticated-canary.json");
const ROLLING_ISSUE_TITLE = "Portal Authenticated Canary Failures (Rolling)";

function parseArgs(argv) {
  const options = {
    workflowName: DEFAULT_WORKFLOW_NAME,
    threshold: DEFAULT_THRESHOLD,
    branch: process.env.GITHUB_REF_NAME || "main",
    currentConclusion: "",
    runId: String(process.env.GITHUB_RUN_ID || "").trim(),
    runUrl: buildRunUrl(),
    reportPath: DEFAULT_REPORT_PATH,
    canaryReportPath: DEFAULT_CANARY_REPORT,
    asJson: false,
    apply: true,
    includeGithub: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--no-apply") {
      options.apply = false;
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
    if (arg === "--threshold") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 1) throw new Error("--threshold must be >= 1");
      options.threshold = Math.floor(value);
      index += 1;
      continue;
    }
    if (arg === "--branch") {
      options.branch = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--current-conclusion") {
      options.currentConclusion = String(next).trim().toLowerCase();
      index += 1;
      continue;
    }
    if (arg === "--run-id") {
      options.runId = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--run-url") {
      options.runUrl = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--report") {
      options.reportPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--canary-report") {
      options.canaryReportPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
  }

  return options;
}

function buildRunUrl() {
  const server = String(process.env.GITHUB_SERVER_URL || "https://github.com").trim();
  const repo = String(process.env.GITHUB_REPOSITORY || "").trim();
  const runId = String(process.env.GITHUB_RUN_ID || "").trim();
  if (!repo || !runId) return "";
  return `${server}/${repo}/actions/runs/${runId}`;
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

async function readJsonSafe(path) {
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
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

function countConsecutiveFailures(conclusions) {
  let count = 0;
  for (const item of conclusions) {
    const normalized = normalizeConclusion(item);
    if (normalized === "success") break;
    if (normalized === "failure") {
      count += 1;
      continue;
    }
    break;
  }
  return count;
}

function ensureGhLabel(repoSlug, name, color, description) {
  runCommand(
    "gh",
    ["label", "create", name, "--repo", repoSlug, "--color", color, "--description", description, "--force"],
    { allowFailure: true }
  );
}

function ensureRollingIssue(repoSlug) {
  const existing = runCommand(
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

  if (existing.ok) {
    try {
      const parsed = JSON.parse(existing.stdout || "[]");
      const match = parsed.find((item) => String(item?.title || "") === ROLLING_ISSUE_TITLE);
      if (match) {
        return {
          number: Number(match.number || 0),
          url: String(match.url || ""),
        };
      }
    } catch {
      // no-op
    }
  }

  const created = runCommand(
    "gh",
    [
      "issue",
      "create",
      "--repo",
      repoSlug,
      "--title",
      ROLLING_ISSUE_TITLE,
      "--body",
      "Rolling alert log for authenticated portal canary outcomes.",
      "--label",
      "automation",
      "--label",
      "qa",
      "--label",
      "oncall",
    ],
    { allowFailure: true }
  );

  if (!created.ok) return { number: 0, url: "" };

  const issueUrl = created.stdout.split(/\s+/).find((token) => token.startsWith("https://github.com/")) || "";
  const issueNumberMatch = issueUrl.match(/\/issues\/(\d+)/);
  return {
    number: issueNumberMatch ? Number(issueNumberMatch[1]) : 0,
    url: issueUrl,
  };
}

function issueHasRunMarker(repoSlug, issueNumber, marker) {
  const view = runCommand(
    "gh",
    ["issue", "view", String(issueNumber), "--repo", repoSlug, "--json", "comments"],
    { allowFailure: true }
  );
  if (!view.ok) return false;

  try {
    const parsed = JSON.parse(view.stdout || "{}");
    const comments = Array.isArray(parsed.comments) ? parsed.comments : [];
    return comments.some((comment) => String(comment?.body || "").includes(marker));
  } catch {
    return false;
  }
}

function postIssueComment(repoSlug, issueNumber, body) {
  runCommand(
    "gh",
    ["issue", "comment", String(issueNumber), "--repo", repoSlug, "--body", body],
    { allowFailure: true }
  );
}

function buildEscalationComment(summary, marker) {
  const lines = [];
  lines.push(`## ${summary.timestampIso} — authenticated canary escalation`);
  lines.push("");
  lines.push(`- Current conclusion: ${summary.currentConclusion}`);
  lines.push(`- Consecutive failures: ${summary.consecutiveFailures}`);
  lines.push(`- Escalation threshold: ${summary.threshold}`);
  if (summary.runUrl) {
    lines.push(`- Run: ${summary.runUrl}`);
  }
  if (summary.canaryReportPath) {
    lines.push(`- Canary report: ${summary.canaryReportPath}`);
  }
  if (summary.canaryStatus) {
    lines.push(`- Canary status: ${summary.canaryStatus}`);
  }
  lines.push("");
  lines.push("Action:");
  lines.push("1. Inspect canary report and failing step.");
  lines.push("2. Validate auth health (staff creds + backend probes).");
  lines.push("3. Re-run canary manually after mitigation.");
  lines.push("");
  lines.push(marker);
  return lines.join("\n");
}

function buildRecoveryComment(summary, marker) {
  const lines = [];
  lines.push(`## ${summary.timestampIso} — authenticated canary recovery`);
  lines.push("");
  lines.push(`- Current conclusion: ${summary.currentConclusion}`);
  lines.push(`- Previous consecutive failures: ${summary.previousConsecutiveFailures}`);
  if (summary.runUrl) {
    lines.push(`- Recovery run: ${summary.runUrl}`);
  }
  lines.push("");
  lines.push("Recovery signal: consecutive failure streak cleared.");
  lines.push("");
  lines.push(marker);
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const canaryReport = await readJsonSafe(options.canaryReportPath);
  const inferredConclusion = canaryReport?.status === "passed" ? "success" : canaryReport?.status === "failed" ? "failure" : "unknown";
  const currentConclusion = normalizeConclusion(options.currentConclusion || inferredConclusion);

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
      "20",
      "--json",
      "databaseId,conclusion,url,createdAt,headBranch,event",
    ],
    { allowFailure: true }
  );

  const previousConclusions = [];
  if (runsResponse.ok) {
    try {
      const runs = JSON.parse(runsResponse.stdout || "[]");
      for (const run of runs) {
        const runId = String(run?.databaseId || "").trim();
        if (options.runId && runId === options.runId) continue;
        const conclusion = normalizeConclusion(run?.conclusion || "unknown");
        previousConclusions.push(conclusion);
      }
    } catch {
      // ignore parse errors; fallback to current-only decision
    }
  }

  const consecutiveFailures = countConsecutiveFailures([currentConclusion, ...previousConclusions]);
  const previousConsecutiveFailures = countConsecutiveFailures(previousConclusions);
  const shouldEscalate = currentConclusion === "failure" && consecutiveFailures >= options.threshold;
  const shouldPostRecovery = currentConclusion === "success" && previousConsecutiveFailures >= options.threshold;

  const summary = {
    status: shouldEscalate ? "escalated" : currentConclusion === "failure" ? "failed_below_threshold" : "ok",
    timestampIso: new Date().toISOString(),
    threshold: options.threshold,
    workflowName: options.workflowName,
    branch: options.branch,
    currentConclusion,
    previousConsecutiveFailures,
    consecutiveFailures,
    shouldEscalate,
    shouldPostRecovery,
    runId: options.runId,
    runUrl: options.runUrl,
    canaryStatus: String(canaryReport?.status || "unknown"),
    canaryReportPath: options.canaryReportPath.startsWith(`${repoRoot}/`)
      ? options.canaryReportPath.slice(repoRoot.length + 1)
      : options.canaryReportPath,
    rollingIssue: {
      number: 0,
      url: "",
    },
  };

  if (options.apply && options.includeGithub) {
    const repoSlug = parseRepoSlug();
    if (repoSlug) {
      ensureGhLabel(repoSlug, "automation", "0e8a16", "Automated monitoring and remediation.");
      ensureGhLabel(repoSlug, "qa", "1d76db", "Quality assurance automation coverage.");
      ensureGhLabel(repoSlug, "oncall", "d73a4a", "Operational attention required.");

      const rollingIssue = ensureRollingIssue(repoSlug);
      summary.rollingIssue = rollingIssue;

      if (rollingIssue.number > 0 && (shouldEscalate || shouldPostRecovery)) {
        const marker = `<!-- portal-canary-run:${options.runId || "manual"} -->`;
        const alreadyPosted = issueHasRunMarker(repoSlug, rollingIssue.number, marker);
        if (!alreadyPosted) {
          const body = shouldEscalate
            ? buildEscalationComment(summary, marker)
            : buildRecoveryComment(summary, marker);
          postIssueComment(repoSlug, rollingIssue.number, body);
        }
      }
    }
  }

  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${summary.status}\n`);
    process.stdout.write(`currentConclusion: ${summary.currentConclusion}\n`);
    process.stdout.write(`consecutiveFailures: ${summary.consecutiveFailures}\n`);
    process.stdout.write(`threshold: ${String(summary.threshold)}\n`);
    process.stdout.write(`report: ${options.reportPath}\n`);
    if (summary.rollingIssue.url) {
      process.stdout.write(`rollingIssue: ${summary.rollingIssue.url}\n`);
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`portal-canary-escalation failed: ${message}`);
  process.exit(1);
});
