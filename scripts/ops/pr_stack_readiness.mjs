#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "pr-stack");
const DEFAULT_REPO = "monsoonfirepottery-byte/monsoonfire-portal";

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function repoRelative(path) {
  return relative(REPO_ROOT, path).replace(/\\/g, "/");
}

function usage() {
  return `Studio Brain PR stack readiness packet

Usage:
  node scripts/ops/pr_stack_readiness.mjs [--json] [--write]

Options:
  --json                 Print JSON to stdout.
  --write                Write timestamped JSON and Markdown artifacts.
  --repo <owner/name>    GitHub repo. Default: ${DEFAULT_REPO}.
  --output-dir <path>    Artifact directory. Default: output/ops/pr-stack.
  --run-id <id>          Stable run id.
`;
}

function readFlagValue(argv, index, name) {
  const arg = argv[index];
  if (arg === name) {
    if (!argv[index + 1]) throw new Error(`${name} requires a value.`);
    return { matched: true, value: argv[index + 1], nextIndex: index + 1 };
  }
  if (arg.startsWith(`${name}=`)) {
    return { matched: true, value: arg.slice(name.length + 1), nextIndex: index };
  }
  return { matched: false, value: "", nextIndex: index };
}

function parseArgs(argv) {
  const options = { json: false, write: false, repo: DEFAULT_REPO, outputDir: DEFAULT_OUTPUT_DIR, runId: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--write") {
      options.write = true;
      continue;
    }
    const mappings = [["--repo", "repo"], ["--output-dir", "outputDir"], ["--run-id", "runId"]];
    let consumed = false;
    for (const [flag, key] of mappings) {
      const parsed = readFlagValue(argv, index, flag);
      if (!parsed.matched) continue;
      options[key] = parsed.value;
      index = parsed.nextIndex;
      consumed = true;
      break;
    }
    if (consumed) continue;
    throw new Error(`Unknown argument: ${arg}`);
  }
  options.outputDir = resolve(REPO_ROOT, options.outputDir);
  return options;
}

function runJson(command, args) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 45_000,
    env: { ...process.env }
  });
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      error: result.error?.message || clean(result.stderr) || `exit ${result.status}`,
      json: null
    };
  }
  try {
    return { ok: true, error: "", json: JSON.parse(clean(result.stdout) || "null") };
  } catch (error) {
    return { ok: false, error: `invalid JSON: ${error.message}`, json: null };
  }
}

function fetchPullRequests(repo) {
  const result = runJson("gh", [
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    "number,title,isDraft,mergeStateStatus,headRefName,baseRefName,updatedAt,url"
  ]);
  if (!result.ok) return { ok: false, error: result.error, rows: [] };
  return { ok: true, error: "", rows: Array.isArray(result.json) ? result.json : [] };
}

function ageDays(updatedAt) {
  const time = Date.parse(updatedAt);
  if (!Number.isFinite(time)) return null;
  return Number(((Date.now() - time) / 86_400_000).toFixed(1));
}

function freshnessFor(age) {
  if (age === null) {
    return {
      bucket: "unknown",
      recommendedAction: "Confirm the PR updatedAt timestamp from GitHub."
    };
  }
  if (age > 7) {
    return {
      bucket: "old_7d",
      recommendedAction: "Review for close, supersede, or explicit keep decision."
    };
  }
  if (age > 3) {
    return {
      bucket: "stale_72h",
      recommendedAction: "Refresh evidence before promoting or stacking more work."
    };
  }
  if (age > 1) {
    return {
      bucket: "watch_24h",
      recommendedAction: "Keep visible; refresh if it blocks merge order."
    };
  }
  return {
    bucket: "fresh",
    recommendedAction: "No freshness action needed."
  };
}

function classify(pr) {
  const age = ageDays(pr.updatedAt);
  const blockers = [];
  if (!pr.isDraft && pr.mergeStateStatus === "DIRTY") blockers.push("non-draft DIRTY");
  if (!pr.isDraft && pr.mergeStateStatus === "UNSTABLE") blockers.push("checks pending or unstable");
  if (!pr.isDraft && pr.mergeStateStatus === "BEHIND") blockers.push("behind main");
  if (!pr.isDraft && pr.mergeStateStatus === "BLOCKED") blockers.push("blocked by merge requirements");
  if (!pr.isDraft && pr.mergeStateStatus === "UNKNOWN") blockers.push("unknown mergeability");
  if (pr.isDraft) blockers.push("draft");
  if (pr.baseRefName !== "main") blockers.push(`stacked on ${pr.baseRefName}`);
  if (age !== null && age > 7) blockers.push(`${age} days since update`);
  const row = {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    head: pr.headRefName,
    base: pr.baseRefName,
    isDraft: pr.isDraft,
    mergeStateStatus: pr.mergeStateStatus,
    updatedAt: pr.updatedAt,
    ageDays: age,
    freshness: freshnessFor(age),
    blockers,
    readiness: blockers.length === 0 ? "ready_to_review" : blockers.some((item) => item.includes("DIRTY")) ? "blocked" : "needs_triage"
  };
  row.disposition = dispositionFor(row);
  return row;
}

function dispositionFor(pr) {
  if (!pr.isDraft && pr.mergeStateStatus === "DIRTY") {
    return {
      action: "rebase_or_conflict_review",
      approval: "codex_with_human_review",
      reason: "Non-draft PR has merge conflicts or dirty state; resolve in a clean worktree before merge."
    };
  }
  if (!pr.isDraft && pr.mergeStateStatus === "UNSTABLE") {
    return {
      action: "wait_for_checks",
      approval: "codex",
      reason: "Non-draft PR is waiting on checks or has an unstable status; do not restack until checks settle."
    };
  }
  if (!pr.isDraft && pr.mergeStateStatus === "BEHIND") {
    return {
      action: "update_branch_or_rebase",
      approval: "codex",
      reason: "Non-draft PR is behind main; update from current main and rerun checks before merge."
    };
  }
  if (!pr.isDraft && pr.mergeStateStatus === "BLOCKED") {
    return {
      action: "wait_for_required_checks_or_policy",
      approval: "codex",
      reason: "Non-draft PR is blocked by required checks, review policy, or merge requirements."
    };
  }
  if (!pr.isDraft && pr.mergeStateStatus === "UNKNOWN") {
    return {
      action: "refresh_mergeability",
      approval: "codex",
      reason: "GitHub has not resolved mergeability; refresh the packet before acting."
    };
  }
  if (!pr.isDraft && pr.blockers.length === 0) {
    return {
      action: "keep_ready",
      approval: "codex",
      reason: "Non-draft PR has no current readiness blockers."
    };
  }
  if (pr.isDraft && pr.ageDays !== null && pr.ageDays > 7) {
    return {
      action: "close_candidate",
      approval: "human",
      reason: "Draft is older than 7 days; close only after confirming it has been superseded or captured in backlog."
    };
  }
  if (pr.isDraft && pr.base !== "main") {
    return {
      action: "supersede_or_restack",
      approval: "human",
      reason: "Draft is stacked on another branch; prefer rebuilding useful pieces from current main over reviving the whole chain."
    };
  }
  if (pr.isDraft) {
    return {
      action: "keep_for_review",
      approval: "human",
      reason: "Draft targets main; review scope and decide whether to promote, supersede, or close."
    };
  }
  return {
    action: "needs_manual_triage",
    approval: "human",
    reason: "The PR state did not match a known readiness bucket."
  };
}

function attachDependencyMap(rows) {
  const byHead = new Map(rows.map((pr) => [pr.head, pr]));
  const childrenByNumber = new Map();
  for (const pr of rows) {
    const parent = byHead.get(pr.base);
    pr.dependsOnPr = parent ? parent.number : null;
    if (parent) {
      const children = childrenByNumber.get(parent.number) || [];
      children.push(pr.number);
      childrenByNumber.set(parent.number, children);
    }
  }
  for (const pr of rows) {
    pr.childPrs = childrenByNumber.get(pr.number) || [];
  }
  return rows;
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = selector(row) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function cleanupTasks(rows) {
  const tasks = [];
  const closeCandidates = rows.filter((pr) => pr.disposition?.action === "close_candidate");
  if (closeCandidates.length) {
    tasks.push({
      title: "[ops] Review stale draft PR close candidates",
      labels: ["ops", "cleanup", "docs"],
      approvalRequired: true,
      body: [
        "## Problem",
        `${closeCandidates.length} draft PR(s) are older than 7 days and still open.`,
        "",
        "## Evidence",
        ...closeCandidates.map((pr) => `- #${pr.number} ${pr.title} (${pr.ageDays} days old): ${pr.url}`),
        "",
        "## Risk",
        "Stale drafts add noise to PR readiness and can be mistaken for active work.",
        "",
        "## Proposed Fix",
        "Confirm whether each draft has been superseded or captured in backlog, then close only with human approval.",
        "",
        "## Acceptance Criteria",
        "- Each close candidate is marked keep, supersede, or close.",
        "- Any useful work is copied into a fresh main-based slice or backlog item.",
        "- Closed PRs have a comment pointing to the replacement or rationale.",
        "",
        "## Safety Notes",
        "- Human approval required.",
        "- Do not delete branches until the owner approves cleanup.",
        "- Rollback is reopening the PR if the branch still exists."
      ].join("\n")
    });
  }

  const supersedeCandidates = rows.filter((pr) => pr.disposition?.action === "supersede_or_restack");
  if (supersedeCandidates.length) {
    const evidenceLines = supersedeCandidates.slice(0, 30).map((pr) => `- #${pr.number} ${pr.head} -> ${pr.base}; dependsOn=${pr.dependsOnPr ? `#${pr.dependsOnPr}` : "unknown"}`);
    if (supersedeCandidates.length > 30) evidenceLines.push(`- ...and ${supersedeCandidates.length - 30} more.`);
    tasks.push({
      title: "[ops] Collapse or restack stacked draft PR chain",
      labels: ["ops", "cleanup", "reliability"],
      approvalRequired: true,
      body: [
        "## Problem",
        `${supersedeCandidates.length} draft PR(s) are stacked on non-main branches.`,
        "",
        "## Evidence",
        ...evidenceLines,
        "",
        "## Risk",
        "Large stacked draft chains make merge order hard to reason about and can hide stale or superseded work.",
        "",
        "## Proposed Fix",
        "Promote only the next useful slice from current main, then supersede or close obsolete drafts after human review.",
        "",
        "## Acceptance Criteria",
        "- One next executable slice is identified from current main.",
        "- Stale stacked drafts are marked keep, supersede, or close.",
        "- No force-push, branch deletion, or PR closing happens without explicit approval.",
        "",
        "## Safety Notes",
        "- Human approval required for closing PRs or deleting branches.",
        "- Rollback is reopening a PR or restoring from the remote branch if preserved."
      ].join("\n")
    });
  }
  return tasks;
}

function buildChains(rows) {
  const byBase = new Map();
  for (const pr of rows) {
    if (!byBase.has(pr.base)) byBase.set(pr.base, []);
    byBase.get(pr.base).push(pr);
  }
  for (const list of byBase.values()) list.sort((a, b) => a.number - b.number);

  const roots = byBase.get("main") || [];
  const visited = new Set();
  const chains = [];
  for (const root of roots) {
    const chain = [];
    let current = root;
    while (current && !visited.has(current.number)) {
      chain.push(current);
      visited.add(current.number);
      const children = byBase.get(current.head) || [];
      current = children[0] || null;
    }
    chains.push(chain);
  }
  const orphans = rows.filter((pr) => !visited.has(pr.number));
  return { chains, orphans };
}

function buildReport(options) {
  const generatedAt = nowIso();
  const runId = clean(options.runId) || `pr-stack-${generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const prs = fetchPullRequests(options.repo);
  const classified = attachDependencyMap(prs.rows.map(classify).sort((a, b) => a.number - b.number));
  const { chains, orphans } = buildChains(classified);
  const dirtyNonDraft = classified.filter((pr) => !pr.isDraft && pr.mergeStateStatus === "DIRTY");
  const unstableNonDraft = classified.filter((pr) => !pr.isDraft && pr.mergeStateStatus === "UNSTABLE");
  const stackedDrafts = classified.filter((pr) => pr.isDraft && pr.base !== "main");
  const stale = classified.filter((pr) => pr.ageDays !== null && pr.ageDays > 7);
  const recommendations = [];
  if (dirtyNonDraft.length) {
    recommendations.push({
      priority: "P1",
      title: "Resolve dirty non-draft PRs before release work",
      evidence: dirtyNonDraft.map((pr) => `#${pr.number} ${pr.mergeStateStatus}`).join(", "),
      safeNextStep: "Create conflict-resolution worktrees and issue-ready packets; do not force-push without owner review."
    });
  }
  if (stackedDrafts.length) {
    recommendations.push({
      priority: "P2",
      title: "Collapse or restack large draft chains",
      evidence: `${stackedDrafts.length} draft PR(s) target non-main bases.`,
      safeNextStep: "Promote only the next base-ready slice; close or supersede stale drafts after human review."
    });
  }
  if (stale.length) {
    recommendations.push({
      priority: "P3",
      title: "Review stale open PRs",
      evidence: `${stale.length} PR(s) have not been updated in more than 7 days.`,
      safeNextStep: "Mark as keep, supersede, restack, or close in a review packet."
    });
  }
  return {
    schema: "studio-brain.ops.pr-stack-readiness.v1",
    generatedAt,
    runId,
    readOnly: true,
    repo: options.repo,
    status: prs.ok ? dirtyNonDraft.length ? "blocked" : stackedDrafts.length ? "triage_needed" : "ok" : "unavailable",
    source: { ok: prs.ok, error: prs.error, count: classified.length },
    summary: {
      open: classified.length,
      nonDraft: classified.filter((pr) => !pr.isDraft).length,
      drafts: classified.filter((pr) => pr.isDraft).length,
      dirtyNonDraft: dirtyNonDraft.length,
      unstableNonDraft: unstableNonDraft.length,
      stackedDrafts: stackedDrafts.length,
      staleOver7Days: stale.length,
      chainCount: chains.length,
      orphanCount: orphans.length,
      dispositions: countBy(classified, (pr) => pr.disposition?.action),
      freshnessBuckets: countBy(classified, (pr) => pr.freshness?.bucket)
    },
    chains: chains.map((chain) => chain.map((pr) => ({ number: pr.number, head: pr.head, base: pr.base, dependsOnPr: pr.dependsOnPr, childPrs: pr.childPrs, readiness: pr.readiness, blockers: pr.blockers, disposition: pr.disposition }))),
    orphans: orphans.map((pr) => ({ number: pr.number, head: pr.head, base: pr.base, dependsOnPr: pr.dependsOnPr, childPrs: pr.childPrs, readiness: pr.readiness, blockers: pr.blockers, disposition: pr.disposition })),
    pullRequests: classified,
    recommendations,
    cleanupTasks: cleanupTasks(classified)
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Studio Brain PR Stack Readiness",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Run ID: ${report.runId}`,
    `- Status: ${report.status}`,
    `- Repo: ${report.repo}`,
    `- Read-only: ${report.readOnly ? "yes" : "no"}`,
    "",
    "## Summary",
    "",
    `- Open PRs: ${report.summary.open}`,
    `- Non-draft PRs: ${report.summary.nonDraft}`,
    `- Draft PRs: ${report.summary.drafts}`,
    `- Dirty non-draft PRs: ${report.summary.dirtyNonDraft}`,
    `- Unstable non-draft PRs: ${report.summary.unstableNonDraft}`,
    `- Stacked draft PRs: ${report.summary.stackedDrafts}`,
    `- Stale over 7 days: ${report.summary.staleOver7Days}`,
    `- Chain count: ${report.summary.chainCount}`,
    `- Orphan count: ${report.summary.orphanCount}`,
    "",
    "## Disposition Summary",
    ""
  ];
  for (const [action, count] of Object.entries(report.summary.dispositions || {}).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${action}: ${count}`);
  }
  lines.push(
    "",
    "## Freshness Summary",
    ""
  );
  for (const [bucket, count] of Object.entries(report.summary.freshnessBuckets || {}).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${bucket}: ${count}`);
  }
  lines.push(
    "",
    "## Triage Packet",
    "",
    "| PR | Draft | Age | Freshness | Base | Depends on | Children | Disposition | Approval | Reason |",
    "| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |"
  );
  for (const pr of report.pullRequests) {
    lines.push(`| #${pr.number} | ${pr.isDraft ? "yes" : "no"} | ${pr.ageDays ?? "?"} | ${pr.freshness?.bucket || "unknown"} | \`${pr.base}\` | ${pr.dependsOnPr ? `#${pr.dependsOnPr}` : ""} | ${pr.childPrs.length ? pr.childPrs.map((child) => `#${child}`).join(", ") : ""} | ${pr.disposition?.action || "unknown"} | ${pr.disposition?.approval || "unknown"} | ${pr.disposition?.reason || ""} |`);
  }
  lines.push(
    "",
    "## Cleanup Tasks",
    ""
  );
  if (!report.cleanupTasks?.length) {
    lines.push("- No cleanup tasks from current evidence.");
  }
  for (const task of report.cleanupTasks || []) {
    lines.push(`### ${task.title}`);
    lines.push("");
    lines.push(`- Approval required: ${task.approvalRequired ? "yes" : "no"}`);
    lines.push(`- Labels: ${task.labels.join(", ")}`);
    lines.push("");
    lines.push(task.body);
    lines.push("");
  }
  lines.push(
    "",
    "## Recommendations",
    ""
  );
  if (!report.recommendations.length) lines.push("- No PR-stack recommendations from current evidence.");
  for (const rec of report.recommendations) {
    lines.push(`### ${rec.title}`);
    lines.push("");
    lines.push(`- Priority: ${rec.priority}`);
    lines.push(`- Evidence: ${rec.evidence}`);
    lines.push(`- Safe next step: ${rec.safeNextStep}`);
    lines.push("");
  }
  lines.push("## Chains");
  lines.push("");
  for (const [index, chain] of report.chains.entries()) {
    lines.push(`### Chain ${index + 1}`);
    lines.push("");
    for (const pr of chain) {
      lines.push(`- #${pr.number} ${pr.head} -> ${pr.base}: ${pr.readiness}${pr.blockers.length ? ` (${pr.blockers.join("; ")})` : ""}`);
    }
    lines.push("");
  }
  if (report.orphans.length) {
    lines.push("## Orphans");
    lines.push("");
    for (const pr of report.orphans) {
      lines.push(`- #${pr.number} ${pr.head} -> ${pr.base}: ${pr.readiness}${pr.blockers.length ? ` (${pr.blockers.join("; ")})` : ""}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function writeArtifacts(report, options) {
  mkdirSync(options.outputDir, { recursive: true });
  const jsonPath = resolve(options.outputDir, `${report.runId}.json`);
  const markdownPath = resolve(options.outputDir, `${report.runId}.md`);
  const latestJson = resolve(options.outputDir, "latest.json");
  const latestMarkdown = resolve(options.outputDir, "latest.md");
  const markdown = renderMarkdown(report);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, markdown, "utf8");
  writeFileSync(latestJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(latestMarkdown, markdown, "utf8");
  return {
    json: repoRelative(jsonPath),
    markdown: repoRelative(markdownPath),
    latestJson: repoRelative(latestJson),
    latestMarkdown: repoRelative(latestMarkdown)
  };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = buildReport(options);
    if (options.write) report.paths = writeArtifacts(report, options);
    process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report));
  } catch (error) {
    process.stderr.write(`pr_stack_readiness: ${error.message}\n`);
    process.exit(1);
  }
}

main();
