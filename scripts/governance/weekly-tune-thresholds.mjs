#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..", "..");

function parseRepoSlug(input) {
  const raw = String(input || "").trim();
  if (!raw) return { owner: "", repo: "" };
  const normalized = raw
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+/, "")
    .trim();
  if (!normalized) return { owner: "", repo: "" };
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return { owner: parts[0], repo: parts[1] };
  }
  return { owner: "", repo: parts[0] || "" };
}

function inferFromGitConfig() {
  try {
    const configPath = resolve(REPO_ROOT, ".git", "config");
    const config = readFileSync(configPath, "utf8");
    const remoteOriginBlock = config.match(/\[remote "origin"\]([\s\S]*?)(\n\[|$)/);
    const remoteBlock = remoteOriginBlock ? remoteOriginBlock[1] : "";
    const urlMatch = remoteBlock.match(/^\s*url\s*=\s*(.+)\s*$/m);
    if (!urlMatch) return { owner: "", repo: "" };
    return parseRepoSlug(urlMatch[1]);
  } catch {
    return { owner: "", repo: "" };
  }
}

function resolveToken() {
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  if (envToken) return envToken;
  try {
    return execFileSync("gh", ["auth", "token"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

function parseArgs(argv) {
  const repoEnvParts = parseRepoSlug(process.env.GITHUB_REPOSITORY || "");
  const parsed = {
    owner: process.env.GITHUB_REPOSITORY_OWNER || repoEnvParts.owner || "",
    repo: repoEnvParts.repo || "",
    output: "output/governance/weekly-tune-report.json",
    apply: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "");
    if (!arg) continue;
    if (arg === "--owner" && argv[i + 1]) {
      parsed.owner = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--repo" && argv[i + 1]) {
      parsed.repo = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if ((arg === "--output" || arg === "--report") && argv[i + 1]) {
      parsed.output = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--apply") {
      parsed.apply = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Weekly governance threshold tuner",
          "",
          "Usage:",
          "  node ./scripts/governance/weekly-tune-thresholds.mjs [options]",
          "",
          "Options:",
          "  --owner <org>       GitHub org/user",
          "  --repo <name>       GitHub repo name",
          "  --output <path>     Output report path",
          "  --apply             Apply small-step tuning directly to supervisor-thresholds.json"
        ].join("\n")
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!parsed.owner || !parsed.repo) {
    const gitParts = inferFromGitConfig();
    if (!parsed.owner && gitParts.owner) parsed.owner = gitParts.owner;
    if (!parsed.repo && gitParts.repo) parsed.repo = gitParts.repo;
  }
  return parsed;
}

function readJson(pathValue) {
  return JSON.parse(readFileSync(pathValue, "utf8"));
}

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

async function ghFetchJson(endpoint, token) {
  const apiBase = process.env.GITHUB_API_URL || "https://api.github.com";
  const response = await fetch(`${apiBase}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "monsoonfire-governance-weekly-tune"
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${endpoint} failed: ${response.status} ${text}`);
  }
  return response.json();
}

async function ghPaginate(endpointFactory, token, limit = 500) {
  const rows = [];
  let page = 1;
  while (rows.length < limit) {
    const endpoint = endpointFactory(page);
    const pageRows = await ghFetchJson(endpoint, token);
    if (!Array.isArray(pageRows) || pageRows.length === 0) break;
    rows.push(...pageRows);
    if (pageRows.length < 100) break;
    page += 1;
  }
  return rows.slice(0, limit);
}

function daysAgoMs(days) {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function parseTimestamp(value) {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? ts : 0;
}

function uniqueBy(rows, keyFn) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = keyFn(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = resolveToken();
  if (!token) throw new Error("Missing GitHub token. Set GITHUB_TOKEN/GH_TOKEN or run gh auth login.");
  if (!args.owner || !args.repo) throw new Error("Missing repository owner/repo. Provide --owner/--repo or configure origin remote.");

  const thresholdPath = resolve(REPO_ROOT, ".governance/config/supervisor-thresholds.json");
  const thresholds = readJson(thresholdPath);
  const tuningCfg = thresholds.weekly_tuning || {};
  const maxStep = Number(tuningCfg.max_step_adjustment || 0.02);
  const targetFalsePositive = Number(tuningCfg.target_false_positive_rate || 0.15);
  const targetHoldMinutes = Number(tuningCfg.target_mean_time_on_hold_minutes || 180);

  const sinceMs = daysAgoMs(7);
  const issues = await ghPaginate(
    (page) => `/repos/${args.owner}/${args.repo}/issues?state=all&per_page=100&page=${page}`,
    token,
    800
  );
  const recentIssues = issues.filter((row) => parseTimestamp(row?.created_at) >= sinceMs);
  const holdIssues = recentIssues.filter((row) =>
    Array.isArray(row?.labels) && row.labels.some((label) => String(label?.name || "") === "verification-hold")
  );
  const dismissedIssues = recentIssues.filter((row) =>
    Array.isArray(row?.labels) && row.labels.some((label) => String(label?.name || "") === "governance-dismissed")
  );
  const escalationIssues = recentIssues.filter((row) =>
    Array.isArray(row?.labels) && row.labels.some((label) => String(label?.name || "") === "audit-escalation")
  );

  const pullOpen = await ghPaginate(
    (page) => `/repos/${args.owner}/${args.repo}/pulls?state=open&per_page=100&page=${page}`,
    token,
    300
  );
  const holdOpen = pullOpen.filter((row) =>
    Array.isArray(row?.labels) && row.labels.some((label) => String(label?.name || "") === "verification-hold")
  );

  const workflowRunsPayload = await ghFetchJson(`/repos/${args.owner}/${args.repo}/actions/runs?per_page=100`, token);
  const workflowRuns = Array.isArray(workflowRunsPayload.workflow_runs) ? workflowRunsPayload.workflow_runs : [];
  const recentRuns = workflowRuns.filter((row) => parseTimestamp(row?.created_at) >= sinceMs);
  const failedRuns = recentRuns.filter((row) => ["failure", "cancelled", "timed_out"].includes(String(row?.conclusion || "")));

  const falsePositiveRate = holdIssues.length > 0 ? dismissedIssues.length / holdIssues.length : 0;
  const verificationHoldRate = pullOpen.length > 0 ? holdOpen.length / pullOpen.length : 0;
  const ciFailureLoopRate = recentRuns.length > 0 ? failedRuns.length / recentRuns.length : 0;
  const auditWorkloadPerWeek = holdIssues.length + escalationIssues.length;

  const currentHoldConfidence = Number(thresholds.decision_ladder?.hold?.minimum_confidence || 0.7);
  const currentEscalateConfidence = Number(thresholds.decision_ladder?.escalate?.minimum_confidence || 0.8);

  let proposedHoldConfidence = currentHoldConfidence;
  let proposedEscalateConfidence = currentEscalateConfidence;
  let proposedMediumMin = Number(thresholds.decision_ladder?.hold?.medium_findings_min || 2);

  const tuningNotes = [];
  if (falsePositiveRate > targetFalsePositive) {
    proposedHoldConfidence = clamp(proposedHoldConfidence + maxStep, 0.5, 0.95);
    proposedEscalateConfidence = clamp(proposedEscalateConfidence + maxStep, 0.6, 0.98);
    proposedMediumMin = clamp(proposedMediumMin + 1, 1, 6);
    tuningNotes.push("Raised confidence thresholds and medium finding floor due to elevated false positives.");
  } else if (falsePositiveRate < targetFalsePositive / 2 && verificationHoldRate < 0.12 && ciFailureLoopRate < 0.25) {
    proposedHoldConfidence = clamp(proposedHoldConfidence - maxStep / 2, 0.5, 0.95);
    proposedEscalateConfidence = clamp(proposedEscalateConfidence - maxStep / 2, 0.6, 0.98);
    tuningNotes.push("Slightly relaxed confidence thresholds due to low false positives and low hold pressure.");
  } else {
    tuningNotes.push("Kept confidence thresholds stable this cycle.");
  }

  const proposed = {
    decision_ladder: {
      hold: {
        minimum_confidence: Number(proposedHoldConfidence.toFixed(3)),
        medium_findings_min: Number(proposedMediumMin)
      },
      escalate: {
        minimum_confidence: Number(proposedEscalateConfidence.toFixed(3))
      }
    }
  };

  if (args.apply) {
    thresholds.decision_ladder = thresholds.decision_ladder || {};
    thresholds.decision_ladder.hold = thresholds.decision_ladder.hold || {};
    thresholds.decision_ladder.escalate = thresholds.decision_ladder.escalate || {};
    thresholds.decision_ladder.hold.minimum_confidence = proposed.decision_ladder.hold.minimum_confidence;
    thresholds.decision_ladder.hold.medium_findings_min = proposed.decision_ladder.hold.medium_findings_min;
    thresholds.decision_ladder.escalate.minimum_confidence = proposed.decision_ladder.escalate.minimum_confidence;
    writeFileSync(thresholdPath, `${JSON.stringify(thresholds, null, 2)}\n`, "utf8");
  }

  const report = {
    generated_at: new Date().toISOString(),
    repository: `${args.owner}/${args.repo}`,
    window_days: 7,
    metrics: {
      verification_hold_rate: Number(verificationHoldRate.toFixed(4)),
      false_positive_rate: Number(falsePositiveRate.toFixed(4)),
      ci_failure_loop_rate: Number(ciFailureLoopRate.toFixed(4)),
      audit_workload_per_week: auditWorkloadPerWeek,
      target_mean_time_on_hold_minutes: targetHoldMinutes
    },
    counts: {
      pulls_open: pullOpen.length,
      pulls_open_on_hold: holdOpen.length,
      issues_with_hold_label_recent: holdIssues.length,
      issues_with_dismissed_label_recent: dismissedIssues.length,
      issues_escalation_recent: escalationIssues.length,
      workflow_runs_recent: recentRuns.length,
      workflow_runs_failed_recent: failedRuns.length
    },
    previous_thresholds: {
      hold_minimum_confidence: currentHoldConfidence,
      hold_medium_findings_min: Number(thresholds.decision_ladder?.hold?.medium_findings_min || 2),
      escalate_minimum_confidence: currentEscalateConfidence
    },
    proposed_thresholds: proposed,
    applied: args.apply,
    tuning_notes: uniqueBy(tuningNotes.map((text) => ({ text })), (row) => row.text).map((row) => row.text)
  };

  const outputPath = resolve(REPO_ROOT, args.output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  process.stdout.write(`weekly-tune report: ${normalizePath(args.output)}\n`);
  process.stdout.write(`verification_hold_rate: ${report.metrics.verification_hold_rate}\n`);
  process.stdout.write(`false_positive_rate: ${report.metrics.false_positive_rate}\n`);
  process.stdout.write(`ci_failure_loop_rate: ${report.metrics.ci_failure_loop_rate}\n`);
  process.stdout.write(`applied: ${args.apply}\n`);
}

main().catch((error) => {
  process.stderr.write(`weekly-tune failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
