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

function compactPrLabel(pr) {
  return `#${pr.number} ${pr.head || pr.title || "(unknown)"}`;
}

function ageRange(prs) {
  const ages = prs.map((pr) => pr.ageDays).filter((age) => Number.isFinite(age));
  if (!ages.length) return { oldestDays: null, newestDays: null };
  return { oldestDays: Math.max(...ages), newestDays: Math.min(...ages) };
}

function findRoot(pr, byNumber) {
  let current = pr;
  const seen = new Set();
  while (current?.dependsOnPr && !seen.has(current.number)) {
    seen.add(current.number);
    const parent = byNumber.get(current.dependsOnPr);
    if (!parent) break;
    current = parent;
  }
  return current || pr;
}

function cohortAction(cohort) {
  if (cohort.dirtyNonDrafts > 0) return "Handle dirty non-draft blockers before stack work.";
  if (cohort.root?.base === "main" && cohort.root?.isDraft && cohort.root.ageDays !== null && cohort.root.ageDays > 7) {
    return "Decide whether the stale main-based root should be kept, rebuilt, superseded, or closed.";
  }
  if (cohort.stackedDrafts > 20) return "Pick one fresh, current-main rebuild slice instead of trying to revive the full stack.";
  return "Review the root and first two descendants, then mark the rest keep, rebuild, supersede, or close.";
}

function buildStackCohorts(prs) {
  const byNumber = new Map(prs.map((pr) => [pr.number, pr]));
  const groups = new Map();
  for (const pr of prs) {
    if (!pr.isDraft || pr.base === "main") continue;
    const root = findRoot(pr, byNumber);
    const key = String(root.number || pr.dependsOnPr || pr.base || "unknown");
    if (!groups.has(key)) groups.set(key, { root, prs: [] });
    groups.get(key).prs.push(pr);
  }
  return Array.from(groups.values())
    .map((group) => {
      const sorted = group.prs.sort((a, b) => a.number - b.number);
      const ages = ageRange(sorted);
      const cohort = {
        root: group.root ? {
          number: group.root.number,
          title: group.root.title || "",
          head: group.root.head || "",
          base: group.root.base || "",
          url: group.root.url || "",
          isDraft: Boolean(group.root.isDraft),
          ageDays: group.root.ageDays ?? null,
          disposition: group.root.disposition?.action || "unknown"
        } : null,
        prCount: sorted.length,
        stackedDrafts: sorted.filter((pr) => pr.isDraft && pr.base !== "main").length,
        staleOver7Days: sorted.filter((pr) => pr.ageDays !== null && pr.ageDays > 7).length,
        dirtyNonDrafts: sorted.filter((pr) => !pr.isDraft && pr.mergeStateStatus === "DIRTY").length,
        oldestDays: ages.oldestDays,
        newestDays: ages.newestDays,
        firstPr: sorted[0] ? { number: sorted[0].number, head: sorted[0].head, base: sorted[0].base, dependsOnPr: sorted[0].dependsOnPr } : null,
        lastPr: sorted.at(-1) ? { number: sorted.at(-1).number, head: sorted.at(-1).head, base: sorted.at(-1).base, dependsOnPr: sorted.at(-1).dependsOnPr } : null,
        samplePrs: sorted.slice(0, 8).map((pr) => ({ number: pr.number, head: pr.head, base: pr.base, dependsOnPr: pr.dependsOnPr, ageDays: pr.ageDays, disposition: pr.disposition?.action || "unknown" }))
      };
      cohort.safeNextStep = cohortAction(cohort);
      return cohort;
    })
    .sort((a, b) => b.prCount - a.prCount || (a.root?.number || 0) - (b.root?.number || 0));
}

function cohortLine(cohort) {
  const root = cohort.root ? `root #${cohort.root.number} ${cohort.root.head || cohort.root.title || "(unknown)"}` : "root unknown";
  const age = cohort.oldestDays === null ? "age unknown" : `oldest ${cohort.oldestDays}d`;
  const first = cohort.firstPr ? `first ${compactPrLabel(cohort.firstPr)}` : "first unknown";
  const last = cohort.lastPr ? `last ${compactPrLabel(cohort.lastPr)}` : "last unknown";
  return `- ${root}: ${cohort.prCount} stacked draft(s), ${age}; ${first}; ${last}; next=${cohort.safeNextStep}`;
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
  const stackCohorts = buildStackCohorts(prs);
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
      evidence: [
        ...limitEvidence(stackCohorts.map(cohortLine), 12),
        "",
        "Dependency sample:",
        ...limitEvidence(stackedDrafts.map(dependencyLine), 18)
      ],
      problem: `${stackedDrafts.length} draft PR(s) target non-main branches, creating a stacked backlog that is hard to resume safely.`,
      risk: "Large draft stacks make merge order unclear, increase conflict risk, and can keep obsolete work looking operationally current.",
      proposedFix: "Choose one cohort at a time, identify the current-main slice worth salvaging, rebuild it as a small PR, then mark remaining stack items keep, supersede, or close after review.",
      acceptanceCriteria: ["Stacked drafts are grouped into root cohorts with counts, ages, sample PRs, and safe next steps.", "The next executable PR-stack slice is identified from current main.", "No force-push, close, or branch delete happens without human approval."],
      safetyNotes: ["This packet is read-only and decision-only.", "Use clean worktrees for any future rebuilds.", "Rollback for a bad decision is reopening/restoring the affected PR branch if preserved."],
      nextStep: stackCohorts[0] ? `Start with root #${stackCohorts[0].root?.number || "unknown"}; ${stackCohorts[0].safeNextStep}` : "Pick one stack root to revalidate from current main before touching any draft branches."
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
      stackCohorts: stackCohorts.length,
      staleMainDrafts: staleMainDrafts.length,
      unstableNonDrafts: unstableNonDrafts.length,
      dirtyNonDrafts: dirtyNonDrafts.length,
      packets: packets.length
    },
    stackCohorts
  };
}

function emptySummary() {
  return { open: 0, drafts: 0, nonDraft: 0, staleDrafts: 0, closeCandidates: 0, stackedDrafts: 0, stackCohorts: 0, staleMainDrafts: 0, unstableNonDrafts: 0, dirtyNonDrafts: 0, packets: 0 };
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
  const { packets, summary, stackCohorts } = buildPackets(prs, sourceReport);
  return {
    schema: "studio-brain.ops.pr-backlog-decision-packets.v1",
    generatedAt,
    readOnly: true,
    status: packets.length ? "action_needed" : "ok",
    source: { refreshed: options.refresh, ok: true, error: "", input: repoRelative(options.input), generatedAt: sourceReport.generatedAt || "", status: sourceReport.status || "unknown" },
    summary,
    stackCohorts,
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
    `- Stack cohorts: ${report.summary.stackCohorts || 0}`,
    `- Close candidates: ${report.summary.closeCandidates}`,
    `- Dirty non-draft PRs: ${report.summary.dirtyNonDrafts}`,
    "",
    "## Safety",
    "",
    "This packet is read-only. It does not close PRs, rebase branches, force-push, delete branches, check out worktrees, or modify repository state.",
    "",
    "## Stack Cohorts",
    ""
  ];
  if (!report.stackCohorts?.length) {
    lines.push("No stacked draft cohorts detected.", "");
  } else {
    lines.push("| Root | Count | Oldest | Newest | First | Last | Safe next step |");
    lines.push("| --- | ---: | ---: | ---: | --- | --- | --- |");
    for (const cohort of report.stackCohorts) {
      const root = cohort.root ? `#${cohort.root.number} \`${cohort.root.head || "unknown"}\`` : "unknown";
      const first = cohort.firstPr ? `#${cohort.firstPr.number} \`${cohort.firstPr.head || "unknown"}\`` : "";
      const last = cohort.lastPr ? `#${cohort.lastPr.number} \`${cohort.lastPr.head || "unknown"}\`` : "";
      lines.push(`| ${root} | ${cohort.prCount} | ${cohort.oldestDays ?? "?"} | ${cohort.newestDays ?? "?"} | ${first} | ${last} | ${cohort.safeNextStep} |`);
    }
    lines.push("");
  }
  lines.push(
    "## Packets",
    ""
  );
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
