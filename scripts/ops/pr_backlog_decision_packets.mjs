#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_INPUT = resolve(REPO_ROOT, "output", "ops", "pr-stack", "latest.json");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "pr-backlog-decision-packets");

function usage() {
  return `PR backlog decision packet generator

Usage:
  node scripts/ops/pr_backlog_decision_packets.mjs [--json] [--write] [--refresh]

Options:
  --json                 Print JSON.
  --write                Write latest JSON and Markdown artifacts.
  --refresh              Refresh output/ops/pr-stack/latest.json first.
  --input <path>         PR-stack JSON input. Default: output/ops/pr-stack/latest.json.
  --output-dir <path>    Artifact directory. Default: output/ops/pr-backlog-decision-packets.

This command is read-only. It never closes PRs, rebases branches, force-pushes,
deletes branches, checks out worktrees, or edits repository state.
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
  const options = { json: false, write: false, refresh: false, input: DEFAULT_INPUT, outputDir: DEFAULT_OUTPUT_DIR };
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
  const result = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true, timeout: 120_000 });
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
  if (!result.ok) return { ok: false, error: result.error || result.stderr.trim() || `exit ${result.status}` };
  return { ok: true, error: "" };
}

function prLine(pr) {
  const age = pr.ageDays === null || pr.ageDays === undefined ? "age unknown" : `${pr.ageDays} days old`;
  return `- #${pr.number} ${pr.title || "(untitled)"} (${age}): ${pr.url || "URL unavailable"}`;
}

function dependencyLine(pr) {
  const children = Array.isArray(pr.childPrs) && pr.childPrs.length ? pr.childPrs.map((child) => `#${child}`).join(", ") : "none";
  return `- #${pr.number} ${pr.head || "unknown"} -> ${pr.base || "unknown"}; dependsOn=${pr.dependsOnPr ? `#${pr.dependsOnPr}` : "none"}; children=${children}`;
}

function limitEvidence(lines, limit = 30) {
  if (lines.length <= limit) return lines;
  return [...lines.slice(0, limit), `- ...and ${lines.length - limit} more.`];
}

function makePacket({ title, priority, labels, prCount, evidence, problem, risk, proposedFix, acceptanceCriteria, safetyNotes, nextStep }) {
  return {
    title,
    labels,
    approvalRequired: true,
    priority,
    prCount,
    safeNextStep: nextStep,
    body: [
      "## Problem",
      problem,
      "",
      "## Evidence",
      ...evidence,
      "",
      "## Risk",
      risk,
      "",
      "## Proposed Fix",
      proposedFix,
      "",
      "## Acceptance Criteria",
      ...acceptanceCriteria.map((item) => `- ${item}`),
      "",
      "## Safety Notes",
      ...safetyNotes.map((item) => `- ${item}`)
    ].join("\n")
  };
}

function buildPackets(prs, sourceReport) {
  const packets = [];
  const staleDrafts = prs.filter((pr) => pr.isDraft && pr.ageDays !== null && pr.ageDays > 7);
  const closeCandidates = prs.filter((pr) => pr.disposition?.action === "close_candidate");
  const stackedDrafts = prs.filter((pr) => pr.isDraft && pr.base !== "main");
  const staleMainDrafts = prs.filter((pr) => pr.isDraft && pr.base === "main" && pr.ageDays !== null && pr.ageDays > 7);
  const unstableNonDrafts = prs.filter((pr) => !pr.isDraft && pr.mergeStateStatus === "UNSTABLE");
  const dirtyNonDrafts = prs.filter((pr) => !pr.isDraft && pr.mergeStateStatus === "DIRTY");

  if (closeCandidates.length) {
    packets.push(makePacket({
      title: "[ops] Decide stale draft PR close candidates",
      priority: "P2",
      labels: ["ops", "cleanup", "docs"],
      prCount: closeCandidates.length,
      evidence: limitEvidence(closeCandidates.map(prLine)),
      problem: `${closeCandidates.length} draft PR(s) are stale enough to be close candidates, but closing is a human decision.`,
      risk: "Stale drafts make the PR queue look more active than it is and can hide the next actually shippable slice.",
      proposedFix: "Review each candidate, mark keep/supersede/close, and close only after the useful work is captured elsewhere.",
      acceptanceCriteria: ["Each PR is marked keep, supersede, or close.", "Useful work is copied into a fresh main-based slice or backlog item before closure.", "Closed PRs include a comment with the rationale or replacement link."],
      safetyNotes: ["Human approval required before closing PRs.", "Do not delete remote branches in this packet.", "Rollback is reopening the PR if the branch still exists."],
      nextStep: "Review the close-candidate packet and choose keep, supersede, or close for each PR."
    }));
  }

  if (stackedDrafts.length) {
    packets.push(makePacket({
      title: "[ops] Collapse or restack draft PR chains",
      priority: "P2",
      labels: ["ops", "reliability", "cleanup"],
      prCount: stackedDrafts.length,
      evidence: limitEvidence(stackedDrafts.map(dependencyLine)),
      problem: `${stackedDrafts.length} draft PR(s) target non-main branches, creating a stacked backlog that is hard to resume safely.`,
      risk: "Large draft stacks make merge order unclear, increase conflict risk, and can keep obsolete work looking operationally current.",
      proposedFix: "Identify the next useful slice from current main, rebuild it as a small PR, then mark remaining stack items keep, supersede, or close after review.",
      acceptanceCriteria: ["The next executable PR-stack slice is identified from current main.", "Stack roots and child PRs are documented with dependency evidence.", "No force-push, close, or branch delete happens without human approval."],
      safetyNotes: ["This packet is read-only and decision-only.", "Use clean worktrees for any future rebuilds.", "Rollback for a bad decision is reopening/restoring the affected PR branch if preserved."],
      nextStep: "Pick one stack root to revalidate from current main before touching any draft branches."
    }));
  }

  if (staleMainDrafts.length) {
    packets.push(makePacket({
      title: "[ops] Review stale main-based draft PRs",
      priority: "P3",
      labels: ["ops", "cleanup"],
      prCount: staleMainDrafts.length,
      evidence: limitEvidence(staleMainDrafts.map(prLine)),
      problem: `${staleMainDrafts.length} main-based draft PR(s) are stale and need a keep/supersede/close decision.`,
      risk: "Old main-based drafts can be mistaken for current review-ready work or can duplicate already-merged slices.",
      proposedFix: "Compare each draft against current main, then either promote it, rebuild the useful part, or close with a rationale.",
      acceptanceCriteria: ["Each stale main-based draft has an owner disposition.", "Promoted drafts have fresh checks.", "Superseded drafts point at replacement work or backlog evidence."],
      safetyNotes: ["Human approval required before closing PRs.", "Do not force-push or rebase stale branches from this packet.", "Use a clean branch for replacement work."],
      nextStep: "Review stale main-based drafts after dirty non-draft PRs and stacked roots."
    }));
  }

  if (unstableNonDrafts.length) {
    packets.push(makePacket({
      title: "[ops] Triage unstable non-draft PRs",
      priority: "P1",
      labels: ["ops", "reliability"],
      prCount: unstableNonDrafts.length,
      evidence: limitEvidence(unstableNonDrafts.map((pr) => `${prLine(pr)}; mergeState=${pr.mergeStateStatus}; blockers=${(pr.blockers || []).join(", ") || "none"}`)),
      problem: `${unstableNonDrafts.length} non-draft PR(s) are not cleanly ready and may need review before release work.`,
      risk: "Non-draft PRs imply review readiness, so unstable mergeability can mislead release decisions.",
      proposedFix: "Inspect each PR in a clean review lane, decide whether to update, rebuild, supersede, or convert back to draft.",
      acceptanceCriteria: ["Each unstable non-draft PR has a documented disposition.", "Any replacement PR is based on current main.", "Checks are green before merge."],
      safetyNotes: ["Do not force-push without owner approval.", "Do not close non-draft PRs without human approval.", "Rollback is restoring or reopening the PR branch if preserved."],
      nextStep: "Inspect unstable non-draft PRs before promoting any draft stack work."
    }));
  }

  if (dirtyNonDrafts.length) {
    packets.push(makePacket({
      title: "[ops] Follow dirty non-draft conflict packets",
      priority: "P1",
      labels: ["ops", "reliability", "cleanup"],
      prCount: dirtyNonDrafts.length,
      evidence: limitEvidence(dirtyNonDrafts.map((pr) => `${prLine(pr)}; mergeState=${pr.mergeStateStatus}`)),
      problem: `${dirtyNonDrafts.length} non-draft PR(s) are dirty and should be handled through the dedicated conflict packet lane.`,
      risk: "Dirty non-draft PRs block reliable release planning and can conceal whether the work is still useful.",
      proposedFix: "Run `npm run ops:pr-conflict:packets` and use those focused conflict packets for the file-level review.",
      acceptanceCriteria: ["Conflict packets exist under output/ops/pr-conflict-packets.", "Each dirty PR has a keep/rebuild/supersede/close decision.", "No destructive git operation occurs without approval."],
      safetyNotes: ["Human approval required before closing PRs or deleting branches.", "Use a clean worktree for any rebuild.", "This packet links to evidence; it does not resolve conflicts."],
      nextStep: "Open the generated PR conflict packet for the dirty non-draft PR before stack cleanup."
    }));
  }

  return {
    packets,
    summary: {
      open: sourceReport.summary?.open ?? prs.length,
      drafts: sourceReport.summary?.drafts ?? prs.filter((pr) => pr.isDraft).length,
      nonDraft: sourceReport.summary?.nonDraft ?? prs.filter((pr) => !pr.isDraft).length,
      staleDrafts: staleDrafts.length,
      closeCandidates: closeCandidates.length,
      stackedDrafts: stackedDrafts.length,
      staleMainDrafts: staleMainDrafts.length,
      unstableNonDrafts: unstableNonDrafts.length,
      dirtyNonDrafts: dirtyNonDrafts.length,
      packets: packets.length
    }
  };
}

function emptySummary() {
  return { open: 0, drafts: 0, nonDraft: 0, staleDrafts: 0, closeCandidates: 0, stackedDrafts: 0, staleMainDrafts: 0, unstableNonDrafts: 0, dirtyNonDrafts: 0, packets: 0 };
}

function buildReport(options) {
  const generatedAt = new Date().toISOString();
  const refresh = options.refresh ? refreshPrStack() : { ok: true, error: "" };
  if (!refresh.ok) {
    return {
      schema: "studio-brain.ops.pr-backlog-decision-packets.v1",
      generatedAt,
      readOnly: true,
      status: "blocked",
      source: { refreshed: true, ok: false, error: refresh.error, input: repoRelative(options.input) },
      summary: emptySummary(),
      packets: []
    };
  }
  if (!existsSync(options.input)) {
    return {
      schema: "studio-brain.ops.pr-backlog-decision-packets.v1",
      generatedAt,
      readOnly: true,
      status: "missing_input",
      source: { refreshed: options.refresh, ok: false, error: "PR-stack latest.json not found", input: repoRelative(options.input) },
      summary: emptySummary(),
      packets: [],
      safeNextStep: "Run npm run ops:pr-stack:readiness, then rerun this command."
    };
  }
  const sourceReport = safeJsonParse(readFileSync(options.input, "utf8"), {});
  const prs = Array.isArray(sourceReport.pullRequests) ? sourceReport.pullRequests : [];
  const { packets, summary } = buildPackets(prs, sourceReport);
  return {
    schema: "studio-brain.ops.pr-backlog-decision-packets.v1",
    generatedAt,
    readOnly: true,
    status: packets.length ? "action_needed" : "ok",
    source: { refreshed: options.refresh, ok: true, error: "", input: repoRelative(options.input), generatedAt: sourceReport.generatedAt || "", status: sourceReport.status || "unknown" },
    summary,
    packets,
    safeNextStep: packets.length ? "Use these packets to make keep, rebuild, supersede, or close decisions; do not mutate PRs without human approval." : "No PR backlog decision packets are currently needed."
  };
}

function renderMarkdown(report) {
  const lines = [
    "# PR Backlog Decision Packets",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Status: ${report.status}`,
    `- Source: ${report.source.input}`,
    `- Open PRs: ${report.summary.open}`,
    `- Draft PRs: ${report.summary.drafts}`,
    `- Stacked drafts: ${report.summary.stackedDrafts}`,
    `- Close candidates: ${report.summary.closeCandidates}`,
    `- Dirty non-draft PRs: ${report.summary.dirtyNonDrafts}`,
    "",
    "## Safety",
    "",
    "This packet is read-only. It does not close PRs, rebase branches, force-push, delete branches, check out worktrees, or modify repository state.",
    "",
    "## Packets",
    ""
  ];
  if (!report.packets.length) {
    lines.push("No PR backlog decision packets are currently needed.", "");
    return `${lines.join("\n")}\n`;
  }
  for (const packet of report.packets) {
    lines.push(`### ${packet.title}`, "", `- Priority: ${packet.priority}`, `- PR count: ${packet.prCount}`, `- Safe next step: ${packet.safeNextStep}`, "", packet.body, "");
  }
  return `${lines.join("\n")}\n`;
}

function writeArtifacts(report, outputDir) {
  mkdirSync(outputDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = resolve(outputDir, `pr-backlog-decision-packets-${stamp}.json`);
  const markdownPath = resolve(outputDir, `pr-backlog-decision-packets-${stamp}.md`);
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
