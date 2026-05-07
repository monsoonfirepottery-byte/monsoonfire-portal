#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "pr-stack");
const DEFAULT_REPOS = [
  { id: "portal", label: "Monsoon Fire Portal", repo: "monsoonfirepottery-byte/monsoonfire-portal" },
  { id: "mission-control", label: "Studio Brain Mission Control", repo: "monsoonfirepottery-byte/studio-brain-mission-control" },
];
const OPEN_FIELDS = "number,title,headRefName,baseRefName,isDraft,mergeStateStatus,updatedAt,url,author";
const MERGED_FIELDS = "number,title,headRefName,baseRefName,mergedAt,mergeCommit,url,author";

function usage() {
  return `Studio Brain ops PR stack audit

Usage:
  node scripts/ops/pr_stack_audit.mjs [--json] [--write]

Options:
  --json                  Print JSON.
  --write                 Write timestamped/latest JSON and Markdown artifacts.
  --output-dir <path>     Artifact directory. Default: output/ops/pr-stack.
  --open-limit <n>        Open PRs per repo. Default: 40.
  --merged-limit <n>      Recently merged PRs per repo. Default: 12.
  --repo <id=owner/name>  Add or override a repository. Repeatable.
`;
}

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function repoRelative(path) {
  return relative(REPO_ROOT, resolve(path)).replace(/\\/g, "/");
}

function readFlagValue(argv, index, flag) {
  const value = argv[index];
  if (value === flag) {
    if (!argv[index + 1]) throw new Error(`${flag} requires a value.`);
    return { matched: true, value: argv[index + 1], nextIndex: index + 1 };
  }
  if (value.startsWith(`${flag}=`)) {
    return { matched: true, value: value.slice(flag.length + 1), nextIndex: index };
  }
  return { matched: false, value: "", nextIndex: index };
}

function parseRepo(value) {
  const text = clean(value);
  const separator = text.indexOf("=");
  if (separator === -1) {
    const id = text.split("/").pop() || text;
    return { id, label: id, repo: text };
  }
  const id = clean(text.slice(0, separator));
  const repo = clean(text.slice(separator + 1));
  return { id, label: id, repo };
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    json: false,
    write: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    openLimit: 40,
    mergedLimit: 12,
    repos: [...DEFAULT_REPOS],
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
    const outputDir = readFlagValue(argv, index, "--output-dir");
    if (outputDir.matched) {
      options.outputDir = resolve(REPO_ROOT, outputDir.value);
      index = outputDir.nextIndex;
      continue;
    }
    const openLimit = readFlagValue(argv, index, "--open-limit");
    if (openLimit.matched) {
      options.openLimit = Number(openLimit.value);
      index = openLimit.nextIndex;
      continue;
    }
    const mergedLimit = readFlagValue(argv, index, "--merged-limit");
    if (mergedLimit.matched) {
      options.mergedLimit = Number(mergedLimit.value);
      index = mergedLimit.nextIndex;
      continue;
    }
    const repo = readFlagValue(argv, index, "--repo");
    if (repo.matched) {
      const parsed = parseRepo(repo.value);
      options.repos = options.repos.filter((entry) => entry.id !== parsed.id).concat(parsed);
      index = repo.nextIndex;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(options.openLimit) || options.openLimit < 1) throw new Error("--open-limit must be a positive number.");
  if (!Number.isFinite(options.mergedLimit) || options.mergedLimit < 0) throw new Error("--merged-limit must be zero or greater.");
  return options;
}

function readJsonFixture(path) {
  if (!path || !existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function runGhJson(args) {
  const result = spawnSync("gh", args, { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true });
  if (result.error) {
    return { ok: false, data: [], error: result.error.message };
  }
  if (result.status !== 0) {
    return { ok: false, data: [], error: clean(result.stderr) || `gh exited ${result.status}` };
  }
  try {
    return { ok: true, data: JSON.parse(result.stdout || "[]"), error: "" };
  } catch (error) {
    return { ok: false, data: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function collectRepo(repoConfig, options = {}) {
  const fixture = options.fixtures?.[repoConfig.id];
  const openResult = fixture?.open
    ? { ok: true, data: fixture.open, error: "" }
    : runGhJson([
      "pr",
      "list",
      "--repo",
      repoConfig.repo,
      "--state",
      "open",
      "--limit",
      String(options.openLimit ?? 40),
      "--json",
      OPEN_FIELDS,
    ]);
  const mergedResult = fixture?.merged
    ? { ok: true, data: fixture.merged, error: "" }
    : runGhJson([
      "pr",
      "list",
      "--repo",
      repoConfig.repo,
      "--state",
      "merged",
      "--limit",
      String(options.mergedLimit ?? 12),
      "--json",
      MERGED_FIELDS,
    ]);
  return {
    id: repoConfig.id,
    label: repoConfig.label,
    repo: repoConfig.repo,
    openPullRequests: Array.isArray(openResult.data) ? openResult.data : [],
    recentlyMerged: Array.isArray(mergedResult.data) ? mergedResult.data : [],
    collection: {
      openStatus: openResult.ok ? "pass" : "warn",
      mergedStatus: mergedResult.ok ? "pass" : "warn",
      openError: clean(openResult.error),
      mergedError: clean(mergedResult.error),
    },
  };
}

function authorLogin(author) {
  return clean(author?.login) || clean(author?.name);
}

function categoryFor(pr) {
  const title = clean(pr.title).toLowerCase();
  const head = clean(pr.headRefName).toLowerCase();
  const base = clean(pr.baseRefName).toLowerCase();
  const mergeState = clean(pr.mergeStateStatus).toLowerCase();
  if (head.includes("dependabot/") || authorLogin(pr.author).toLowerCase() === "dependabot") return "dependency";
  if (mergeState.includes("dirty")) return "conflict";
  if (base && base !== "main") return "stacked";
  if (pr.isDraft) {
    if (title.includes("preview") || head.includes("preview") || title.includes("website")) return "preview_draft";
    return "draft";
  }
  if (mergeState.includes("behind")) return "behind";
  if (title.includes("[ops]") || head.includes("ops-")) return "ops";
  return "open";
}

function dispositionFor(pr, category) {
  if (category === "dependency") return "Rebase/update and run the scoped dependency checks before merging.";
  if (category === "conflict") return "Do not merge until conflicts are reviewed in a clean worktree.";
  if (category === "preview_draft") return "Preserve preview-only boundary until the owner approves production website work.";
  if (category === "draft") return "Owner decision needed: refresh, supersede, or close before merge work.";
  if (category === "stacked") return "Merge only after its base PR lands and checks are green.";
  if (category === "behind") return "Refresh from main and rerun the relevant focused checks.";
  if (category === "ops") return "Review as a normal low-risk ops PR after checks pass.";
  return "Review scope and checks before deciding merge order.";
}

function normalizeOpenPr(pr, repoId) {
  const category = categoryFor(pr);
  return {
    repoId,
    number: Number(pr.number),
    title: clean(pr.title),
    url: clean(pr.url),
    headRefName: clean(pr.headRefName),
    baseRefName: clean(pr.baseRefName),
    isDraft: Boolean(pr.isDraft),
    mergeStateStatus: clean(pr.mergeStateStatus),
    updatedAt: clean(pr.updatedAt),
    author: authorLogin(pr.author),
    category,
    recommendedDisposition: dispositionFor(pr, category),
  };
}

function normalizeMergedPr(pr, repoId) {
  return {
    repoId,
    number: Number(pr.number),
    title: clean(pr.title),
    url: clean(pr.url),
    headRefName: clean(pr.headRefName),
    baseRefName: clean(pr.baseRefName),
    mergedAt: clean(pr.mergedAt),
    mergeCommit: clean(pr.mergeCommit?.oid || pr.mergeCommit?.abbreviatedOid || pr.mergeCommit),
    author: authorLogin(pr.author),
  };
}

function stackEdges(openPrs) {
  const heads = new Map(openPrs.map((pr) => [pr.headRefName, pr]));
  return openPrs
    .filter((pr) => pr.baseRefName && heads.has(pr.baseRefName))
    .map((pr) => ({
      repoId: pr.repoId,
      basePr: heads.get(pr.baseRefName).number,
      baseHead: pr.baseRefName,
      childPr: pr.number,
      childHead: pr.headRefName,
    }));
}

function countBy(items, field) {
  return items.reduce((acc, item) => {
    const key = clean(item[field]) || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function buildPrStackAudit(inputs = {}, options = {}) {
  const generatedAt = clean(options.generatedAt) || nowIso();
  const repos = (options.repos || DEFAULT_REPOS).map((repoConfig) => {
    const source = inputs.repos?.find((entry) => entry.id === repoConfig.id) || collectRepo(repoConfig, options);
    const openPullRequests = source.openPullRequests.map((pr) => normalizeOpenPr(pr, source.id));
    const recentlyMerged = source.recentlyMerged.map((pr) => normalizeMergedPr(pr, source.id));
    const openLimit = Number.isFinite(options.openLimit) ? options.openLimit : null;
    return {
      id: source.id,
      label: source.label || repoConfig.label,
      repo: source.repo || repoConfig.repo,
      collection: source.collection || { openStatus: "pass", mergedStatus: "pass", openError: "", mergedError: "" },
      openPullRequests,
      recentlyMerged,
      summary: {
        open: openPullRequests.length,
        recentlyMerged: recentlyMerged.length,
        openLimit,
        openLimitReached: openLimit !== null && openPullRequests.length >= openLimit,
        categories: countBy(openPullRequests, "category"),
        mergeStates: countBy(openPullRequests, "mergeStateStatus"),
      },
    };
  });
  const allOpen = repos.flatMap((repo) => repo.openPullRequests);
  const allMerged = repos.flatMap((repo) => repo.recentlyMerged);
  const collectionWarnings = repos.flatMap((repo) => [
    repo.collection.openStatus !== "pass" ? `${repo.id} open PR collection: ${repo.collection.openError || repo.collection.openStatus}` : "",
    repo.collection.mergedStatus !== "pass" ? `${repo.id} merged PR collection: ${repo.collection.mergedError || repo.collection.mergedStatus}` : "",
  ].filter(Boolean));
  const warnings = [
    ...collectionWarnings,
    ...repos.filter((repo) => repo.summary.openLimitReached).map((repo) => `${repo.id} open PR collection reached limit ${repo.summary.openLimit}; rerun with a larger --open-limit for a complete audit`),
    allOpen.some((pr) => pr.category === "conflict") ? "one or more PRs have dirty/conflicted merge state" : "",
    allOpen.some((pr) => pr.category === "dependency") ? "dependency PRs require separate scoped validation" : "",
    allOpen.some((pr) => pr.category === "preview_draft") ? "preview-only draft PRs require owner disposition" : "",
  ].filter(Boolean);
  return {
    schema: "studiobrain-ops-pr-stack-audit.v1",
    generatedAt,
    runId: clean(options.runId) || `ops-pr-stack-${generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`,
    status: collectionWarnings.length || repos.some((repo) => repo.summary.openLimitReached) ? "warn" : "pass",
    readOnly: true,
    purpose: "Inventory open ops-adjacent PRs, stacked branches, stale drafts, and recently merged PRs without mutating GitHub state.",
    repos,
    stackEdges: stackEdges(allOpen),
    summary: {
      repos: repos.length,
      open: allOpen.length,
      recentlyMerged: allMerged.length,
      categories: countBy(allOpen, "category"),
      warnings: warnings.length,
    },
    warnings,
    operatorNotes: [
      "This report is metadata only; it does not merge, close, rebase, or rerun checks.",
      "Treat dependency and preview-draft PRs as separate lanes from ops-doctor stack work.",
      "Stacked PRs should merge from the bottom of their base/head chain upward.",
    ],
  };
}

function renderMarkdown(report) {
  const warnings = report.warnings.map((warning) => `- ${warning}`).join("\n") || "- None.";
  const repoSections = report.repos.map((repo) => {
    const openRows = repo.openPullRequests.map((pr) =>
      `| [#${pr.number}](${pr.url}) | ${pr.headRefName} | ${pr.baseRefName} | ${pr.isDraft ? "yes" : "no"} | ${pr.mergeStateStatus || ""} | ${pr.category} | ${pr.recommendedDisposition} |`,
    ).join("\n") || "| _none_ |  |  |  |  |  |  |";
    const mergedRows = repo.recentlyMerged.slice(0, 8).map((pr) =>
      `| [#${pr.number}](${pr.url}) | ${pr.title} | ${pr.mergeCommit || ""} | ${pr.mergedAt || ""} |`,
    ).join("\n") || "| _none_ |  |  |  |";
    return `## ${repo.label}

- Repo: \`${repo.repo}\`
- Open PRs: ${repo.summary.open}
- Recently merged captured: ${repo.summary.recentlyMerged}
- Open limit reached: ${repo.summary.openLimitReached}
- Collection: open=${repo.collection.openStatus}, merged=${repo.collection.mergedStatus}

### Open PRs

| PR | Head | Base | Draft | Merge state | Category | Recommended disposition |
| --- | --- | --- | --- | --- | --- | --- |
${openRows}

### Recently Merged

| PR | Title | Merge commit | Merged at |
| --- | --- | --- | --- |
${mergedRows}
`;
  }).join("\n");
  const edges = report.stackEdges.map((edge) =>
    `- ${edge.repoId}: #${edge.basePr} (${edge.baseHead}) -> #${edge.childPr} (${edge.childHead})`,
  ).join("\n") || "- None detected.";
  return `# Ops PR Stack Audit

Generated: ${report.generatedAt}
Status: ${report.status}
Run ID: ${report.runId}

## Summary

- Repos: ${report.summary.repos}
- Open PRs: ${report.summary.open}
- Recently merged captured: ${report.summary.recentlyMerged}
- Categories: ${JSON.stringify(report.summary.categories)}

## Warnings

${warnings}

## Stacked Edges

${edges}

${repoSections}
## Notes

${report.operatorNotes.map((note) => `- ${note}`).join("\n")}
`;
}

function writeArtifacts(options, report) {
  mkdirSync(options.outputDir, { recursive: true });
  const jsonPath = resolve(options.outputDir, `${report.runId}.json`);
  const markdownPath = resolve(options.outputDir, `${report.runId}.md`);
  const latestJson = resolve(options.outputDir, "pr-stack-audit-latest.json");
  const latestMarkdown = resolve(options.outputDir, "pr-stack-audit-latest.md");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  writeFileSync(latestJson, `${JSON.stringify({ ...report, artifactPath: repoRelative(jsonPath), markdownPath: repoRelative(markdownPath) }, null, 2)}\n`, "utf8");
  writeFileSync(latestMarkdown, renderMarkdown(report), "utf8");
  return {
    jsonPath: repoRelative(jsonPath),
    markdownPath: repoRelative(markdownPath),
    latestJson: repoRelative(latestJson),
    latestMarkdown: repoRelative(latestMarkdown),
  };
}

function run(rawArgs = process.argv.slice(2)) {
  const options = parseArgs(rawArgs);
  const report = buildPrStackAudit({}, options);
  const artifacts = options.write ? writeArtifacts(options, report) : null;
  if (options.json) process.stdout.write(`${JSON.stringify({ ...report, artifacts }, null, 2)}\n`);
  else {
    process.stdout.write(`ops PR stack audit: ${report.status}, open=${report.summary.open}\n`);
    if (artifacts) process.stdout.write(`artifact: ${artifacts.latestMarkdown}\n`);
  }
  return { ...report, artifacts };
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export { buildPrStackAudit, renderMarkdown };
