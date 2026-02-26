#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const ROLLING_ISSUE_TITLE = "Branch Divergence / Force-Push Guard (Rolling)";
const ALERT_ISSUE_TITLE = "[Branch Guard] Non-fast-forward update detected";
const STATE_START = "<!-- branch-divergence-state:start -->";
const STATE_END = "<!-- branch-divergence-state:end -->";
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "branch-divergence-guard.json");

function parseArgs(argv) {
  const options = {
    asJson: false,
    apply: true,
    includeGithub: true,
    reportPath: DEFAULT_REPORT_PATH,
    maxBranches: 200,
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

    if (arg === "--report") {
      options.reportPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--max-branches") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 1) throw new Error("--max-branches must be >= 1");
      options.maxBranches = Math.floor(value);
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

function ensureGhLabel(repoSlug, name, color, description) {
  runCommand(
    "gh",
    ["label", "create", name, "--repo", repoSlug, "--color", color, "--description", description, "--force"],
    { allowFailure: true }
  );
}

function ensureIssue(repoSlug, title, body, labels) {
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
      `in:title \"${title}\"`,
      "--json",
      "number,title,url",
    ],
    { allowFailure: true }
  );

  if (existing.ok) {
    try {
      const parsed = JSON.parse(existing.stdout || "[]");
      const match = parsed.find((item) => String(item?.title || "") === title);
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

  const args = ["issue", "create", "--repo", repoSlug, "--title", title, "--body", body];
  for (const label of labels) {
    args.push("--label", label);
  }

  const created = runCommand("gh", args, { allowFailure: true });
  if (!created.ok) return { number: 0, url: "" };

  const issueUrl = created.stdout.split(/\s+/).find((token) => token.startsWith("https://github.com/")) || "";
  const issueNumberMatch = issueUrl.match(/\/issues\/(\d+)/);
  return {
    number: issueNumberMatch ? Number(issueNumberMatch[1]) : 0,
    url: issueUrl,
  };
}

function postIssueComment(repoSlug, issueNumber, body) {
  runCommand(
    "gh",
    ["issue", "comment", String(issueNumber), "--repo", repoSlug, "--body", body],
    { allowFailure: true }
  );
}

function loadPreviousStateFromIssue(repoSlug, issueNumber) {
  if (!repoSlug || !issueNumber) {
    return { capturedAtIso: "", branches: {} };
  }

  const view = runCommand(
    "gh",
    ["issue", "view", String(issueNumber), "--repo", repoSlug, "--json", "comments"],
    { allowFailure: true }
  );
  if (!view.ok) {
    return { capturedAtIso: "", branches: {} };
  }

  try {
    const parsed = JSON.parse(view.stdout || "{}");
    const comments = Array.isArray(parsed.comments) ? parsed.comments : [];

    for (let index = comments.length - 1; index >= 0; index -= 1) {
      const body = String(comments[index]?.body || "");
      const start = body.indexOf(STATE_START);
      const end = body.indexOf(STATE_END);
      if (start < 0 || end < 0 || end <= start) continue;
      const jsonBlock = body.slice(start + STATE_START.length, end).trim();
      if (!jsonBlock) continue;
      try {
        const state = JSON.parse(jsonBlock);
        if (state && typeof state === "object" && state.branches && typeof state.branches === "object") {
          return {
            capturedAtIso: String(state.capturedAtIso || ""),
            branches: state.branches,
          };
        }
      } catch {
        // continue scanning older comments
      }
    }
  } catch {
    // ignore
  }

  return { capturedAtIso: "", branches: {} };
}

function listRemoteBranches(maxBranches) {
  const refs = runCommand("git", ["ls-remote", "--heads", "origin"]);
  const branches = [];
  for (const line of refs.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [sha, ref] = trimmed.split(/\s+/);
    const prefix = "refs/heads/";
    if (!ref || !ref.startsWith(prefix)) continue;
    const branch = ref.slice(prefix.length);
    if (branch !== "main" && !branch.startsWith("codex/")) continue;
    branches.push({ branch, sha: String(sha || "").trim() });
  }
  branches.sort((a, b) => a.branch.localeCompare(b.branch));
  return branches.slice(0, maxBranches);
}

function isAncestor(olderSha, newerSha) {
  if (!olderSha || !newerSha) return false;
  const result = runCommand("git", ["merge-base", "--is-ancestor", olderSha, newerSha], { allowFailure: true });
  return result.code === 0;
}

function compareStates(previousState, currentBranches) {
  const currentMap = Object.fromEntries(currentBranches.map((entry) => [entry.branch, entry.sha]));
  const previousMap = previousState.branches || {};

  const rewrites = [];
  const fastForwards = [];
  const newBranches = [];
  const deletedBranches = [];

  for (const [branch, currentSha] of Object.entries(currentMap)) {
    const previousSha = String(previousMap[branch] || "").trim();
    if (!previousSha) {
      newBranches.push({ branch, currentSha });
      continue;
    }
    if (previousSha === currentSha) {
      continue;
    }

    if (isAncestor(previousSha, currentSha)) {
      fastForwards.push({ branch, previousSha, currentSha });
    } else {
      rewrites.push({ branch, previousSha, currentSha });
    }
  }

  for (const [branch, previousSha] of Object.entries(previousMap)) {
    if (!currentMap[branch]) {
      deletedBranches.push({ branch, previousSha });
    }
  }

  return {
    rewrites,
    fastForwards,
    newBranches,
    deletedBranches,
  };
}

function buildRollingComment(summary, statePayload) {
  const lines = [];
  lines.push(`## ${summary.timestampIso} — branch divergence guard`);
  lines.push("");
  lines.push(`- Status: ${summary.status}`);
  lines.push(`- Monitored branches: ${summary.monitoredBranchCount}`);
  lines.push(`- Non-fast-forward rewrites: ${summary.rewrites.length}`);
  lines.push(`- Deleted branches: ${summary.deletedBranches.length}`);
  lines.push(`- Fast-forward updates: ${summary.fastForwards.length}`);
  lines.push(`- New branches: ${summary.newBranches.length}`);
  lines.push("");

  if (summary.rewrites.length > 0) {
    lines.push("### Rewrites");
    for (const item of summary.rewrites) {
      lines.push(`- ${item.branch}: ${item.previousSha} -> ${item.currentSha}`);
    }
    lines.push("");
  }

  if (summary.deletedBranches.length > 0) {
    lines.push("### Deleted branches");
    for (const item of summary.deletedBranches) {
      lines.push(`- ${item.branch} (previous ${item.previousSha})`);
    }
    lines.push("");
  }

  lines.push(STATE_START);
  lines.push(JSON.stringify(statePayload, null, 2));
  lines.push(STATE_END);
  return lines.join("\n");
}

function buildAlertComment(summary) {
  const lines = [];
  lines.push(`## ${summary.timestampIso} — non-fast-forward update detected`);
  lines.push("");
  lines.push(`Detected ${summary.rewrites.length} branch rewrite(s) and ${summary.deletedBranches.length} deletion(s).`);
  lines.push("");
  if (summary.rewrites.length > 0) {
    lines.push("### Rewrites");
    for (const item of summary.rewrites) {
      lines.push(`- ${item.branch}: ${item.previousSha} -> ${item.currentSha}`);
    }
    lines.push("");
  }
  if (summary.deletedBranches.length > 0) {
    lines.push("### Deleted branches");
    for (const item of summary.deletedBranches) {
      lines.push(`- ${item.branch} (previous ${item.previousSha})`);
    }
    lines.push("");
  }
  lines.push("Recommended action: notify active branch users to fetch/rebase before continuing local work.");
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  runCommand("git", ["fetch", "--prune", "origin", "+refs/heads/*:refs/remotes/origin/*"], {
    allowFailure: false,
  });

  const currentBranches = listRemoteBranches(options.maxBranches);
  const currentMap = Object.fromEntries(currentBranches.map((entry) => [entry.branch, entry.sha]));

  const summary = {
    status: "passed",
    timestampIso: new Date().toISOString(),
    monitoredBranchCount: currentBranches.length,
    rewrites: [],
    fastForwards: [],
    newBranches: [],
    deletedBranches: [],
    previousStateCapturedAtIso: "",
    rollingIssue: { number: 0, url: "" },
    alertIssue: { number: 0, url: "" },
    reportPath: options.reportPath,
  };

  const repoSlug = options.includeGithub ? parseRepoSlug() : "";
  const rollingIssue = repoSlug && options.apply
    ? ensureIssue(
        repoSlug,
        ROLLING_ISSUE_TITLE,
        "Rolling branch divergence and force-push monitoring log.",
        ["automation", "infra"]
      )
    : { number: 0, url: "" };
  summary.rollingIssue = rollingIssue;

  const previousState = repoSlug && rollingIssue.number > 0
    ? loadPreviousStateFromIssue(repoSlug, rollingIssue.number)
    : { capturedAtIso: "", branches: {} };
  summary.previousStateCapturedAtIso = previousState.capturedAtIso;

  const diff = compareStates(previousState, currentBranches);
  summary.rewrites = diff.rewrites;
  summary.fastForwards = diff.fastForwards;
  summary.newBranches = diff.newBranches;
  summary.deletedBranches = diff.deletedBranches;

  if (summary.rewrites.length > 0 || summary.deletedBranches.length > 0) {
    summary.status = "failed";
  }

  if (repoSlug && options.apply && options.includeGithub) {
    ensureGhLabel(repoSlug, "automation", "0e8a16", "Automated monitoring and remediation.");
    ensureGhLabel(repoSlug, "infra", "5319e7", "Infrastructure and operational controls.");

    const statePayload = {
      capturedAtIso: summary.timestampIso,
      branches: currentMap,
    };

    if (rollingIssue.number > 0) {
      postIssueComment(repoSlug, rollingIssue.number, buildRollingComment(summary, statePayload));
    }

    if (summary.status === "failed") {
      const alertIssue = ensureIssue(
        repoSlug,
        ALERT_ISSUE_TITLE,
        "Automated alert when branch history appears rewritten (non-fast-forward).",
        ["automation", "infra"]
      );
      summary.alertIssue = alertIssue;
      if (alertIssue.number > 0) {
        postIssueComment(repoSlug, alertIssue.number, buildAlertComment(summary));
      }
    }
  }

  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${summary.status}\n`);
    process.stdout.write(`monitored branches: ${String(summary.monitoredBranchCount)}\n`);
    process.stdout.write(`rewrites: ${String(summary.rewrites.length)}\n`);
    process.stdout.write(`deleted: ${String(summary.deletedBranches.length)}\n`);
    process.stdout.write(`report: ${options.reportPath}\n`);
    if (summary.rollingIssue.url) {
      process.stdout.write(`rolling issue: ${summary.rollingIssue.url}\n`);
    }
    if (summary.alertIssue.url) {
      process.stdout.write(`alert issue: ${summary.alertIssue.url}\n`);
    }
  }

  if (summary.status === "failed") {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`branch-divergence-guard failed: ${message}`);
  process.exit(1);
});
