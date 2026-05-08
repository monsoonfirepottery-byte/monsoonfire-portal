#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_INPUT = resolve(REPO_ROOT, "output", "ops", "pr-stack", "latest.json");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "pr-conflict-packets");

function usage() {
  return `PR conflict-resolution packet generator

Usage:
  node scripts/ops/pr_conflict_packets.mjs [--json] [--write] [--refresh]

Options:
  --json                 Print JSON.
  --write                Write latest JSON and Markdown artifacts.
  --refresh              Refresh output/ops/pr-stack/latest.json first.
  --input <path>         PR-stack JSON input. Default: output/ops/pr-stack/latest.json.
  --output-dir <path>    Artifact directory. Default: output/ops/pr-conflict-packets.

This command is read-only. It never rebases, force-pushes, closes PRs, or edits
branches; it only turns current PR-stack evidence into issue-ready packets.
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
  const options = {
    json: false,
    write: false,
    refresh: false,
    input: DEFAULT_INPUT,
    outputDir: DEFAULT_OUTPUT_DIR
  };
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
    if (arg === "--refresh") {
      options.refresh = true;
      continue;
    }
    let consumed = false;
    for (const [flag, key] of [["--input", "input"], ["--output-dir", "outputDir"]]) {
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
  options.input = resolve(REPO_ROOT, options.input);
  options.outputDir = resolve(REPO_ROOT, options.outputDir);
  return options;
}

function repoRelative(path) {
  return relative(REPO_ROOT, path).replace(/\\/g, "/") || ".";
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw || "");
  } catch {
    return fallback;
  }
}

function runNode(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 120_000
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error?.message || ""
  };
}

function refreshPrStack() {
  const result = runNode(["scripts/ops/pr_stack_readiness.mjs", "--write", "--json"]);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error || result.stderr.trim() || `exit ${result.status}`
    };
  }
  return { ok: true, error: "" };
}

function flattenPrs(report) {
  if (Array.isArray(report.pullRequests)) return report.pullRequests;
  const rows = [];
  for (const chain of Array.isArray(report.chains) ? report.chains : []) {
    for (const pr of Array.isArray(chain) ? chain : []) rows.push(pr);
  }
  for (const pr of Array.isArray(report.orphans) ? report.orphans : []) rows.push(pr);
  const seen = new Set();
  return rows.filter((pr) => {
    const key = pr?.number;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isDirtyNonDraft(pr) {
  return !pr.isDraft && (pr.mergeStateStatus === "DIRTY" || (pr.blockers || []).some((item) => String(item).includes("DIRTY")));
}

function packetFor(pr) {
  return {
    title: `[ops] Resolve merge conflicts for PR #${pr.number}`,
    labels: ["ops", "reliability", "cleanup"],
    approvalRequired: true,
    priority: "P1",
    owner: "Codex with human review",
    branch: `codex/pr-${pr.number}-conflict-review`,
    pr: {
      number: pr.number,
      title: pr.title || "",
      url: pr.url || "",
      head: pr.head || "",
      base: pr.base || "",
      mergeStateStatus: pr.mergeStateStatus || "",
      updatedAt: pr.updatedAt || "",
      ageDays: pr.ageDays ?? null
    },
    body: `## Problem
PR #${pr.number} is non-draft but currently not mergeable because GitHub reports ${pr.mergeStateStatus || "a dirty merge state"}.

## Evidence
- PR: ${pr.url || `#${pr.number}`}
- Head/base: ${pr.head || "unknown"} -> ${pr.base || "unknown"}
- Blockers: ${(pr.blockers || []).join(", ") || "DIRTY mergeability"}
- Last updated: ${pr.updatedAt || "unknown"}

## Risk
Leaving a non-draft dirty PR open creates release noise and can hide whether the work should be merged, rebuilt from current main, or superseded.

## Proposed Fix
Create a clean conflict-review worktree, inspect the diff against current main, and decide whether to rebuild the useful changes as a small fresh PR or close/supersede the stale PR.

## Acceptance Criteria
- Conflict source is documented with file-level evidence.
- Human owner decides keep, rebuild, supersede, or close.
- Any replacement PR is based on current main and has passing checks.
- No force-push, branch deletion, or PR close happens without explicit approval.

## Safety Notes
- Human approval required before closing the PR or deleting the branch.
- Rollback is reopening the PR or restoring the remote branch if preserved.
- Do not use destructive git commands against the primary worktree.`
  };
}

function buildReport(options) {
  const generatedAt = new Date().toISOString();
  const refresh = options.refresh ? refreshPrStack() : { ok: true, error: "" };
  if (!refresh.ok) {
    return {
      schema: "studio-brain.ops.pr-conflict-packets.v1",
      generatedAt,
      readOnly: true,
      status: "blocked",
      source: { refreshed: true, ok: false, error: refresh.error, input: repoRelative(options.input) },
      summary: { dirtyNonDraft: 0, packets: 0 },
      packets: []
    };
  }
  if (!existsSync(options.input)) {
    return {
      schema: "studio-brain.ops.pr-conflict-packets.v1",
      generatedAt,
      readOnly: true,
      status: "missing_input",
      source: { refreshed: options.refresh, ok: false, error: "PR-stack latest.json not found", input: repoRelative(options.input) },
      summary: { dirtyNonDraft: 0, packets: 0 },
      packets: [],
      safeNextStep: "Run npm run ops:pr-stack:readiness, then rerun this command."
    };
  }
  const sourceReport = safeJsonParse(readFileSync(options.input, "utf8"), {});
  const dirty = flattenPrs(sourceReport).filter(isDirtyNonDraft);
  const packets = dirty.map(packetFor);
  return {
    schema: "studio-brain.ops.pr-conflict-packets.v1",
    generatedAt,
    readOnly: true,
    status: packets.length ? "action_needed" : "ok",
    source: {
      refreshed: options.refresh,
      ok: true,
      error: "",
      input: repoRelative(options.input),
      generatedAt: sourceReport.generatedAt || ""
    },
    summary: {
      dirtyNonDraft: dirty.length,
      packets: packets.length
    },
    packets,
    safeNextStep: packets.length
      ? "Open one clean conflict-review lane for the highest-priority packet; do not force-push or close PRs without approval."
      : "No dirty non-draft PR conflict packets are needed."
  };
}

function renderMarkdown(report) {
  const lines = [
    "# PR Conflict Packets",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Status: ${report.status}`,
    `- Source: ${report.source.input}`,
    `- Dirty non-draft PRs: ${report.summary.dirtyNonDraft}`,
    "",
    "## Safety",
    "",
    "This packet is read-only. It does not rebase, force-push, close PRs, delete branches, or modify worktrees.",
    ""
  ];
  if (!report.packets.length) {
    lines.push("## Packets", "", "No conflict packets are currently needed.", "");
    return `${lines.join("\n")}\n`;
  }
  lines.push("## Packets", "");
  for (const packet of report.packets) {
    lines.push(`### ${packet.title}`, "", packet.body, "");
  }
  return `${lines.join("\n")}\n`;
}

function writeArtifacts(report, outputDir) {
  mkdirSync(outputDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = resolve(outputDir, `pr-conflict-packets-${stamp}.json`);
  const markdownPath = resolve(outputDir, `pr-conflict-packets-${stamp}.md`);
  const latestJson = resolve(outputDir, "latest.json");
  const latestMarkdown = resolve(outputDir, "latest.md");
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderMarkdown(report);
  for (const [path, body] of [[jsonPath, json], [latestJson, json], [markdownPath, markdown], [latestMarkdown, markdown]]) {
    writeFileSync(path, body, "utf8");
  }
  return { jsonPath: repoRelative(jsonPath), markdownPath: repoRelative(markdownPath), latestJson: repoRelative(latestJson), latestMarkdown: repoRelative(latestMarkdown) };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const report = buildReport(options);
  if (options.write) report.artifacts = writeArtifacts(report, options.outputDir);
  if (options.json || !options.write) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${renderMarkdown(report)}\n`);
  process.exit(report.status === "blocked" ? 1 : 0);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
