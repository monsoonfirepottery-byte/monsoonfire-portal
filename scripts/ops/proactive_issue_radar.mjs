#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildManifest as buildCommandManifest } from "./ops_command_manifest.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "proactive-radar");

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function repoRelative(path) {
  return relative(REPO_ROOT, path).replace(/\\/g, "/");
}

function readJsonFile(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function usage() {
  return `Studio Brain proactive issue radar

Usage:
  node scripts/ops/proactive_issue_radar.mjs [--json] [--write]

Options:
  --json                 Print JSON to stdout.
  --write                Write timestamped JSON and Markdown artifacts.
  --output-dir <path>    Artifact directory. Default: output/ops/proactive-radar.
  --repo <owner/name>    GitHub repo. Default: inferred from origin.
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
  const options = {
    json: false,
    write: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    repo: "",
    runId: ""
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
    const mappings = [
      ["--output-dir", "outputDir"],
      ["--repo", "repo"],
      ["--run-id", "runId"]
    ];
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

function run(command, args, timeout = 30_000) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout,
    env: { ...process.env }
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: clean(result.stdout),
    stderr: clean(result.stderr),
    error: result.error?.message || "",
    status: result.status
  };
}

function runJson(command, args, timeout = 30_000) {
  const result = run(command, args, timeout);
  if (!result.ok) return { ok: false, error: result.error || result.stderr || `exit ${result.status}`, json: null };
  try {
    return { ok: true, error: "", json: JSON.parse(result.stdout || "null") };
  } catch (error) {
    return { ok: false, error: `invalid JSON: ${error.message}`, json: null };
  }
}

function commandExists(command) {
  const result = spawnSync(process.platform === "win32" ? "where" : "sh", process.platform === "win32" ? [command] : ["-lc", `command -v ${shellQuote(command)}`], {
    encoding: "utf8",
    windowsHide: true
  });
  return result.status === 0;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function inferRepoFromRemote() {
  const remote = run("git", ["remote", "get-url", "origin"]);
  const match = remote.stdout.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  return match ? match[1] : "monsoonfirepottery-byte/monsoonfire-portal";
}

function gitStatus() {
  const status = run("git", ["status", "--short", "--branch"]);
  if (!status.ok) return { ok: false, branch: "", dirtyCount: null, error: status.stderr || status.error };
  const lines = status.stdout.split(/\n/).filter(Boolean);
  return {
    ok: true,
    branch: clean(lines[0]?.replace(/^##\s*/, "")),
    dirtyCount: Math.max(0, lines.length - 1),
    error: ""
  };
}

function openPullRequests(repo) {
  if (!commandExists("gh")) return { ok: false, error: "gh unavailable", rows: [] };
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
  ], 45_000);
  if (!result.ok) return { ok: false, error: result.error, rows: [] };
  const rows = Array.isArray(result.json) ? result.json : [];
  const hydrated = hydrateUnknownMergeability(repo, rows);
  return { ok: true, error: hydrated.error, rows: hydrated.rows, hydratedUnknown: hydrated.hydrated, hydrationFailures: hydrated.failures };
}

function hydrateUnknownMergeability(repo, rows) {
  let hydrated = 0;
  let failures = 0;
  const nextRows = rows.map((row) => {
    if (row.isDraft || row.mergeStateStatus !== "UNKNOWN") return row;
    const result = runJson("gh", [
      "pr",
      "view",
      String(row.number),
      "--repo",
      repo,
      "--json",
      "mergeStateStatus"
    ], 20_000);
    if (!result.ok || !result.json?.mergeStateStatus) {
      failures += 1;
      return { ...row, mergeStateHydration: "failed" };
    }
    hydrated += 1;
    return { ...row, mergeStateStatus: result.json.mergeStateStatus, mergeStateHydration: "gh-pr-view" };
  });
  return {
    rows: nextRows,
    hydrated,
    failures,
    error: failures ? `${failures} UNKNOWN mergeability hydration attempt(s) failed` : ""
  };
}

function walkFiles(root, predicate, out = []) {
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(path, predicate, out);
    } else if (predicate(path)) {
      out.push(path);
    }
  }
  return out;
}

function artifactFreshness() {
  const paths = [
    "docs/ops/00-system-inventory.md",
    "docs/ops/01-risk-register.md",
    "docs/ops/02-kanban-backlog.md",
    "docs/ops/03-capacity-plan.md",
    "docs/ops/04-postgres-dba-review.md",
    "docs/ops/05-docker-ops-review.md",
    "docs/ops/06-runbooks.md",
    "docs/ops/07-maintenance-calendar.md",
    "docs/ops/16-effectivity-audit-2026-05-06.md",
    "docs/ops/22-privileged-evidence-capture.md",
    "docs/ops/23-backup-restore-confidence.md"
  ].map((path) => resolve(REPO_ROOT, path));
  const now = Date.now();
  return paths.map((path) => {
    if (!existsSync(path)) return { path: repoRelative(path), exists: false, ageDays: null, stale: true };
    const stat = statSync(path);
    const ageDays = (now - stat.mtimeMs) / 86_400_000;
    return {
      path: repoRelative(path),
      exists: true,
      modifiedAt: stat.mtime.toISOString(),
      ageDays: Number(ageDays.toFixed(1)),
      stale: ageDays > 14
    };
  });
}

function newestFileMtime(root) {
  if (!existsSync(root)) return null;
  let newest = null;
  const visit = (path) => {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) visit(resolve(path, entry));
      return;
    }
    if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { path, mtime: stat.mtime, mtimeMs: stat.mtimeMs };
  };
  visit(root);
  return newest;
}

function producerArtifactFreshness(currentWrite = null) {
  const policyPath = resolve(REPO_ROOT, "docs", "ops", "output-artifact-producers.json");
  const policy = readJsonFile(policyPath, { default: {}, producers: {} });
  const defaults = policy.default || {};
  const producers = policy.producers && typeof policy.producers === "object" ? policy.producers : {};
  const now = Date.now();

  return Object.entries(producers).map(([producer, rawConfig]) => {
    const config = { ...defaults, ...(rawConfig || {}) };
    const outputPath = clean(config.outputPath);
    const freshnessDays = Number.isFinite(Number(config.freshnessDays)) ? Number(config.freshnessDays) : 14;
    const resolvedOutput = outputPath ? resolve(REPO_ROOT, outputPath) : "";
    const latestJson = resolvedOutput ? resolve(resolvedOutput, "latest.json") : "";
    const latestMarkdown = resolvedOutput ? resolve(resolvedOutput, "latest.md") : "";
    const isCurrentWrite = currentWrite && resolvedOutput && resolve(currentWrite.outputDir) === resolvedOutput;
    const latestFile = statFile(latestJson) || statFile(latestMarkdown) || newestFileMtime(resolvedOutput);
    const ageDays = latestFile ? (now - latestFile.mtimeMs) / 86_400_000 : null;

    return {
      producer,
      outputPath: outputPath || "",
      refreshCommand: clean(config.refreshCommand) || "",
      retentionClass: clean(config.retentionClass) || "review",
      cleanupApproval: clean(config.cleanupApproval) || "human",
      freshnessDays,
      exists: Boolean(isCurrentWrite || (resolvedOutput && existsSync(resolvedOutput))),
      latestJson: latestJson && (isCurrentWrite || existsSync(latestJson)) ? repoRelative(latestJson) : "",
      latestMarkdown: latestMarkdown && (isCurrentWrite || existsSync(latestMarkdown)) ? repoRelative(latestMarkdown) : "",
      newestArtifact: isCurrentWrite ? repoRelative(latestJson) : latestFile?.path ? repoRelative(latestFile.path) : "",
      newestAt: isCurrentWrite ? currentWrite.generatedAt : latestFile?.mtime ? latestFile.mtime.toISOString() : "",
      ageDays: isCurrentWrite ? 0 : ageDays === null ? null : Number(ageDays.toFixed(1)),
      stale: isCurrentWrite ? false : ageDays === null || ageDays > freshnessDays
    };
  });
}

function statFile(path) {
  if (!path || !existsSync(path)) return null;
  const stat = statSync(path);
  return { path, mtime: stat.mtime, mtimeMs: stat.mtimeMs };
}

function scriptInventory() {
  const scripts = walkFiles(resolve(REPO_ROOT, "scripts", "ops"), (path) => /\.(sh|mjs|sql)$/i.test(path));
  const makefile = resolve(REPO_ROOT, "Makefile");
  const makeText = existsSync(makefile) ? readFileSync(makefile, "utf8") : "";
  return scripts.map((path) => {
    const rel = repoRelative(path);
    const basename = rel.split("/").at(-1);
    const type = basename.endsWith(".sql") ? "sql" : basename.endsWith(".mjs") ? "node" : "shell";
    return {
      path: rel,
      type,
      operatorFacing: isOperatorFacingScript(basename, type),
      makeTarget: inferMakeTarget(makeText, basename)
    };
  });
}

function commandManifestInventory() {
  try {
    const manifest = buildCommandManifest();
    const npmOnlyCommands = Array.isArray(manifest.npmOnlyCommands) ? manifest.npmOnlyCommands : [];
    return {
      ok: true,
      error: "",
      status: clean(manifest.status) || "unknown",
      npmOnlyCommands,
      unclassifiedNpmOnlyCommands: npmOnlyCommands.filter((command) => command.operatorClass === "unclassified_npm_only")
    };
  } catch (error) {
    return {
      ok: false,
      error: clean(error.message),
      status: "unavailable",
      npmOnlyCommands: [],
      unclassifiedNpmOnlyCommands: []
    };
  }
}

function isOperatorFacingScript(basename, type) {
  if (type === "sql") return false;
  if (/\.test\.mjs$/i.test(basename)) return false;
  return true;
}

function inferMakeTarget(makeText, basename) {
  if (!makeText) return "";
  const escaped = basename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = makeText.match(new RegExp("^(ops-[^:\\s]+):[\\s\\S]{0,160}" + escaped, "m"));
  return match?.[1] || "";
}

function makeFinding(severity, id, title, component, evidence, impact, safeNextStep, rollback) {
  return { severity, id, title, component, evidence, impact, safeNextStep, rollback };
}

function packetApprovalStateForFinding(id) {
  const paths = {
    "non-draft-prs-not-mergeable": resolve(REPO_ROOT, "output", "ops", "pr-conflict-packets", "latest.json"),
    "large-stacked-draft-pr-backlog": resolve(REPO_ROOT, "output", "ops", "pr-backlog-decision-packets", "latest.json")
  };
  const path = paths[id] || "";
  if (!path) return null;
  const report = readJsonFile(path, null);
  if (!report) return { id, packetPath: repoRelative(path), ok: false, packets: 0, approvalRequiredPackets: 0, allPacketsRequireApproval: false };
  const packets = Array.isArray(report.packets) ? report.packets : [];
  const approvalRequiredPackets = packets.filter((packet) => packet.approvalRequired).length;
  return {
    id,
    packetPath: repoRelative(path),
    ok: true,
    status: report.status || "unknown",
    generatedAt: report.generatedAt || "",
    packets: packets.length,
    approvalRequiredPackets,
    allPacketsRequireApproval: packets.length > 0 && approvalRequiredPackets === packets.length
  };
}

function buildFindings({ prs, status, freshness, producerArtifacts, scripts, commandManifest }) {
  const findings = [];
  const rows = prs.rows || [];
  const blockingMergeStates = new Set(["DIRTY", "UNSTABLE", "BEHIND", "BLOCKED"]);
  const dirtyNonDraft = rows.filter((pr) => !pr.isDraft && blockingMergeStates.has(pr.mergeStateStatus));
  const unknownNonDraft = rows.filter((pr) => !pr.isDraft && pr.mergeStateStatus === "UNKNOWN");
  const stackedDrafts = rows.filter((pr) => pr.isDraft && pr.baseRefName && pr.baseRefName !== "main");
  const staleArtifacts = freshness.filter((entry) => entry.stale);
  const staleProducerArtifacts = producerArtifacts.filter((entry) => entry.stale);
  const hiddenScripts = scripts.filter((entry) => entry.operatorFacing && !entry.makeTarget);
  const unclassifiedNpmOnlyCommands = commandManifest.unclassifiedNpmOnlyCommands || [];

  if (!prs.ok) {
    findings.push(makeFinding("high", "github-pr-visibility-unavailable", "GitHub PR visibility is unavailable", "GitHub", prs.error, "Merge and release risk cannot be assessed automatically.", "Restore gh auth/network and rerun the radar.", "No repo rollback; this is read-only."));
  }
  if (dirtyNonDraft.length) {
    findings.push(makeFinding("high", "non-draft-prs-not-mergeable", "Non-draft PRs are not mergeable", "GitHub PR stack", dirtyNonDraft.map((pr) => `#${pr.number} ${pr.mergeStateStatus}`).join(", "), "Ready-looking PRs can remain blocked until release time.", "Create conflict-resolution packets in clean worktrees.", "No mutation required; do not close or rewrite PRs without approval."));
  }
  if (unknownNonDraft.length) {
    findings.push(makeFinding("medium", "non-draft-pr-mergeability-unknown", "Non-draft PR mergeability is unknown", "GitHub PR stack", unknownNonDraft.map((pr) => `#${pr.number} UNKNOWN`).join(", "), "GitHub could not prove whether review-ready PRs are mergeable, so release readiness is uncertain.", "Rerun the radar or inspect each PR with `gh pr view <number> --json mergeStateStatus` before assigning blocker severity.", "No mutation required."));
  }
  if (stackedDrafts.length > 10) {
    findings.push(makeFinding("medium", "large-stacked-draft-pr-backlog", "Large stacked draft PR backlog", "GitHub PR stack", `${stackedDrafts.length} draft PR(s) target non-main bases.`, "Stack depth makes merge order and CI meaning hard to reason about.", "Run `npm run ops:pr-backlog:packets` to generate owner-decision packets, then close, restack, or promote only with owner review.", "Docs/report only."));
  }
  if (status.ok && status.dirtyCount > 0) {
    findings.push(makeFinding("medium", "current-worktree-dirty", "Current worktree has local changes", "Local repository", `${status.dirtyCount} changed path(s) on ${status.branch}.`, "Implementation from this checkout may mix unrelated changes.", "Use a clean worktree from origin/main for ops slices.", "Leave the dirty checkout untouched."));
  }
  if (staleArtifacts.length || staleProducerArtifacts.length) {
    const evidence = [
      staleArtifacts.length ? `${staleArtifacts.length} tracked docs stale/missing` : "",
      staleProducerArtifacts.length ? `${staleProducerArtifacts.length} producer output path(s) stale/missing` : "",
      ...staleArtifacts.slice(0, 3).map((entry) => `${entry.path} ${entry.exists ? `${entry.ageDays}d old` : "missing"}`),
      ...staleProducerArtifacts.slice(0, 5).map((entry) => `${entry.producer} -> ${entry.outputPath || "missing outputPath"} ${entry.ageDays === null ? "missing" : `${entry.ageDays}d old`} threshold=${entry.freshnessDays}d refresh=${entry.refreshCommand || "not listed"}`)
    ].filter(Boolean).join("; ");
    findings.push(makeFinding("medium", "stale-ops-artifacts", "Ops evidence artifacts may be stale", "docs/ops and output/ops", evidence, "Recommendations may be based on outdated evidence.", "Refresh the named docs or producer outputs with read-only scripts.", "Docs/output-only update; git history preserves old evidence."));
  }
  if (hiddenScripts.length) {
    findings.push(makeFinding("low", "ops-scripts-without-make-targets", "Some ops scripts lack Makefile wrappers", "scripts/ops", `${hiddenScripts.length} script(s) do not appear to have make targets.`, "Useful diagnostics may remain hidden from operators.", "Add wrappers or README direct-command entries for high-value scripts.", "Makefile/doc change only."));
  }
  if (!commandManifest.ok) {
    findings.push(makeFinding("medium", "ops-command-manifest-unavailable", "Ops command manifest is unavailable", "ops command surface", commandManifest.error || "command manifest build failed", "The radar cannot prove command safety classifications or detect newly ambiguous npm-only commands.", "Run `npm run ops:command-manifest:check` and fix the reported manifest error.", "No repo rollback; this is read-only evidence generation."));
  } else if (unclassifiedNpmOnlyCommands.length) {
    findings.push(makeFinding("low", "ops-npm-only-commands-unclassified", "Some npm-only ops commands are unclassified", "ops command surface", unclassifiedNpmOnlyCommands.map((command) => `${command.name} (${command.approvalClass || "unknown"})`).join(", "), "Operator-facing commands can appear without an explicit safety posture, making automation harder to trust.", "Classify the npm-only command in `scripts/ops/ops_command_manifest.mjs` or add an intentional Make wrapper/docs entry.", "Manifest-only change; rollback by reverting the classification patch."));
  }
  return findings;
}

function priority(severity) {
  if (severity === "critical") return "P0";
  if (severity === "high") return "P1";
  if (severity === "medium") return "P2";
  return "P3";
}

function recommendationTitle(id, fallback) {
  const titles = {
    "github-pr-visibility-unavailable": "Restore automated PR visibility",
    "non-draft-prs-not-mergeable": "Create conflict-resolution packets for dirty PRs",
    "non-draft-pr-mergeability-unknown": "Refresh unknown non-draft PR mergeability",
    "large-stacked-draft-pr-backlog": "Generate PR backlog decision packets for stacked drafts",
    "current-worktree-dirty": "Enforce clean-worktree lanes for ops slices",
    "stale-ops-artifacts": "Refresh stale ops evidence artifacts",
    "ops-scripts-without-make-targets": "Expose hidden ops scripts through Makefile wrappers",
    "ops-command-manifest-unavailable": "Restore ops command manifest generation",
    "ops-npm-only-commands-unclassified": "Classify npm-only ops commands"
  };
  return titles[id] || `Investigate ${fallback.toLowerCase()}`;
}

function buildRecommendations(findings) {
  return findings.map((finding) => ({
    title: recommendationTitle(finding.id, finding.title),
    type: finding.component.includes("GitHub") ? "reliability" : finding.component.includes("docs") ? "documentation" : "ops",
    priority: priority(finding.severity),
    effort: finding.severity === "high" ? "M" : "S",
    risk: "low",
    suggestedBranchName: `codex/ops-${finding.id}`.slice(0, 80),
    suggestedPrTitle: `[ops] ${recommendationTitle(finding.id, finding.title)}`,
    acceptanceCriteria: [
      "Evidence is captured in JSON and Markdown artifacts.",
      "Safe next step and rollback notes are present.",
      "No destructive command is executed."
    ]
  }));
}

function buildProducerRefreshTasks(producerArtifacts) {
  return producerArtifacts
    .filter((entry) => entry.stale)
    .map((entry) => {
      const freshness = entry.ageDays === null ? "missing" : `${entry.ageDays} days old`;
      const refreshCommand = entry.refreshCommand || "not listed";
      const commandSafetyClass = inferRefreshCommandSafety(refreshCommand);
      const score = producerRefreshScore(entry, commandSafetyClass);
      return {
        rank: 0,
        score,
        title: `[ops] Refresh ${entry.producer} evidence artifact`,
        labels: ["ops", "docs", "reliability"],
        priority: entry.freshnessDays <= 1 ? "P2" : "P3",
        commandSafetyClass,
        problem: `${entry.producer} evidence is ${freshness}; freshness threshold is ${entry.freshnessDays} days.`,
        evidence: `Producer ${entry.producer} expects ${entry.outputPath || "missing outputPath"}; latest artifact ${entry.newestArtifact || "not found"}.`,
        risk: "The ops doctor can recommend stale next actions when producer evidence is missing or outside its freshness window.",
        proposedFix: `Run the read-only refresh command \`${refreshCommand}\`, then rerun \`npm run ops:proactive:radar\` to confirm the artifact is fresh.`,
        acceptanceCriteria: [
          `${entry.outputPath || "producer output path"} exists with latest JSON or Markdown evidence.`,
          `Radar reports ${entry.producer} as fresh.`,
          "No destructive cleanup or host mutation is executed."
        ],
        safetyNotes: `Cleanup approval remains ${entry.cleanupApproval || "human"}; rollback is to discard regenerated ignored output artifacts or revert any docs-only evidence update.`
      };
    })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .map((task, index) => ({ ...task, rank: index + 1 }));
}

function buildApprovalFallbackTasks(producerArtifacts, approvalGateFindings, producerRefreshTasks) {
  if (!approvalGateFindings.length || producerRefreshTasks.length) return [];
  const minimumActionableScore = 10;
  const excluded = new Set(["pr-stack", "pr-conflict-packets", "pr-backlog-decision-packets", "proactive-radar", "next-slice-selector", "privileged-evidence"]);
  return producerArtifacts
    .filter((entry) => !excluded.has(entry.producer))
    .filter((entry) => inferRefreshCommandSafety(entry.refreshCommand) !== "human_approval_required")
    .map((entry) => {
      const commandSafetyClass = inferRefreshCommandSafety(entry.refreshCommand);
      const ageDays = entry.ageDays === null ? entry.freshnessDays : entry.ageDays;
      const freshnessRatio = entry.freshnessDays ? Number((ageDays / entry.freshnessDays).toFixed(2)) : 0;
      const valueSignal = approvalFallbackValueSignal(entry.producer);
      const score = approvalFallbackScore(entry, commandSafetyClass, valueSignal);
      return {
        rank: 0,
        score,
        title: `[ops] Refresh ${entry.producer} evidence while PR gates await approval`,
        labels: ["ops", "reliability", "evidence"],
        priority: "P3",
        command: entry.refreshCommand,
        commandSafetyClass,
        problem: "PR-stack work is currently approval-gated, but the ops loop can still refresh safe operational evidence.",
        evidence: `${approvalGateFindings.length} approval-gated PR-stack finding(s); ${entry.producer} evidence is ${entry.ageDays === null ? "missing" : `${entry.ageDays}d old`} with a ${entry.freshnessDays}d threshold; value signal: ${valueSignal.reason}; freshness ratio: ${freshnessRatio}.`,
        risk: "Without a fallback lane, the loop can spin on human gates and stop producing fresh operational evidence.",
        proposedFix: `Run \`${entry.refreshCommand}\`, then rerun \`npm run ops:next-slice:selector\` to keep the loop moving.`,
        acceptanceCriteria: [
          `${entry.outputPath || "producer output path"} has fresh JSON or Markdown evidence.`,
          "Selector no longer treats the approval-gated PR packets as executable automation work.",
          "No destructive cleanup, PR closure, branch deletion, or host mutation is executed."
        ],
        safetyNotes: `Read-only evidence refresh; cleanup approval remains ${entry.cleanupApproval || "human"}.`
      };
    })
    .filter((task) => task.score >= minimumActionableScore)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, 5)
    .map((task, index) => ({ ...task, rank: index + 1 }));
}

function approvalFallbackValueSignal(producer) {
  const values = {
    "output-retention": { score: 35, reason: "prevents artifact sprawl while keeping cleanup approval-gated" },
    "command-manifest": { score: 32, reason: "keeps operator command inventory discoverable and auditable" },
    "producer-refresh-runner": { score: 30, reason: "audits the evidence producer loop itself" },
    "incidents-v2": { score: 28, reason: "captures broad incident-ready evidence without host mutation" },
    "incidents": { score: 24, reason: "captures incident evidence for older consumers" },
    "dependency-remediation": { score: 22, reason: "turns dependency findings into issue-ready remediation packets" },
    "dependency-upstream-watch": { score: 20, reason: "watches upstream drift without changing dependencies" },
    "ci-validate": { score: 18, reason: "checks ops script and redaction guard health" },
    "dependency-cadence": { score: 16, reason: "rolls up dependency safety producers" },
    "dependency-security-scout": { score: 16, reason: "refreshes security advisory evidence" },
    "dependency-zero-baseline": { score: 14, reason: "checks for newly introduced dependency findings" }
  };
  return values[producer] || { score: 10, reason: "keeps a safe ops evidence lane moving" };
}

function approvalFallbackScore(entry, commandSafetyClass, valueSignal) {
  const safetyScore = commandSafetyClass === "read_only_local" ? 15 : commandSafetyClass === "read_only_specialist" ? 10 : commandSafetyClass === "read_only_live_probe" ? 6 : 0;
  if (entry.ageDays === null) return valueSignal.score + safetyScore + 45;

  const freshnessRatio = entry.freshnessDays ? entry.ageDays / entry.freshnessDays : 0;
  const freshnessScore = Math.round(Math.min(1, Math.max(0, freshnessRatio)) * 40);
  const justRefreshedPenalty = freshnessRatio < 0.05 ? 45 : freshnessRatio < 0.25 ? 20 : 0;
  return Math.max(0, valueSignal.score + safetyScore + freshnessScore - justRefreshedPenalty);
}

function inferRefreshCommandSafety(command) {
  const value = clean(command).toLowerCase();
  if (!value || value === "not listed") return "unknown";
  if (value.includes("privileged-evidence-capture") && !value.includes("smoke")) return "human_approval_required";
  if (value.includes("incident") || value.includes("post-deploy")) return "read_only_live_probe";
  if (value.includes("postgres") || value.includes("docker")) return "read_only_specialist";
  return "read_only_local";
}

function producerRefreshScore(entry, commandSafetyClass) {
  let score = 0;
  if (entry.ageDays === null) score += 40;
  if (entry.freshnessDays <= 1) score += 25;
  else if (entry.freshnessDays <= 7) score += 15;
  else score += 5;
  if (commandSafetyClass === "read_only_local") score += 15;
  if (commandSafetyClass === "read_only_specialist") score += 10;
  if (commandSafetyClass === "read_only_live_probe") score += 5;
  if (commandSafetyClass === "human_approval_required") score -= 30;
  return score;
}

function buildReport(options) {
  const generatedAt = nowIso();
  const runId = clean(options.runId) || `proactive-radar-${generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const repo = clean(options.repo) || inferRepoFromRemote();
  const status = gitStatus();
  const prs = openPullRequests(repo);
  const freshness = artifactFreshness();
  const producerArtifacts = producerArtifactFreshness(options.write ? { outputDir: options.outputDir, generatedAt } : null);
  const scripts = scriptInventory();
  const commandManifest = commandManifestInventory();
  const findings = buildFindings({ prs, status, freshness, producerArtifacts, scripts, commandManifest });
  const approvalGateFindings = findings
    .map((finding) => packetApprovalStateForFinding(finding.id))
    .filter((state) => state?.allPacketsRequireApproval);
  const producerRefreshTasks = buildProducerRefreshTasks(producerArtifacts);
  const approvalFallbackTasks = buildApprovalFallbackTasks(producerArtifacts, approvalGateFindings, producerRefreshTasks);
  return {
    schema: "studio-brain.ops.proactive-radar.v1",
    generatedAt,
    runId,
    readOnly: true,
    redaction: "No environment variables, secrets, or .env values are printed.",
    repo,
    status: findings.some((finding) => finding.severity === "critical" || finding.severity === "high") ? "action_needed" : findings.length ? "watch" : "ok",
    sources: {
      gitStatus: status,
      pullRequests: {
        ok: prs.ok,
        error: prs.error,
        count: prs.rows.length,
        nonDraft: prs.rows.filter((pr) => !pr.isDraft).length,
        draft: prs.rows.filter((pr) => pr.isDraft).length,
        dirty: prs.rows.filter((pr) => pr.mergeStateStatus === "DIRTY").length,
        unstable: prs.rows.filter((pr) => pr.mergeStateStatus === "UNSTABLE").length,
        unknown: prs.rows.filter((pr) => pr.mergeStateStatus === "UNKNOWN").length,
        hydratedUnknown: prs.hydratedUnknown || 0,
        hydrationFailures: prs.hydrationFailures || 0
      },
      artifactFreshness: freshness,
      producerArtifactFreshness: producerArtifacts,
      scriptInventory: {
        count: scripts.length,
        withoutMakeTarget: scripts.filter((script) => script.operatorFacing && !script.makeTarget).map((script) => script.path)
      },
      commandManifest: {
        ok: commandManifest.ok,
        error: commandManifest.error,
        status: commandManifest.status,
        npmOnlyCommands: commandManifest.npmOnlyCommands.length,
        unclassifiedNpmOnlyCommands: commandManifest.unclassifiedNpmOnlyCommands.map((command) => command.name)
      }
    },
    findings,
    approvalGateFindings,
    recommendations: buildRecommendations(findings),
    nextProducerRefreshTask: producerRefreshTasks[0] || null,
    producerRefreshTasks,
    approvalFallbackTasks,
    nextApprovalFallbackTask: approvalFallbackTasks[0] || null
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Studio Brain Proactive Issue Radar",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Run ID: ${report.runId}`,
    `- Status: ${report.status}`,
    `- Repo: ${report.repo}`,
    `- Read-only: ${report.readOnly ? "yes" : "no"}`,
    "",
    "## Summary",
    "",
    `- Open PRs: ${report.sources.pullRequests.count}`,
    `- Non-draft PRs: ${report.sources.pullRequests.nonDraft}`,
    `- Draft PRs: ${report.sources.pullRequests.draft}`,
    `- Dirty PRs: ${report.sources.pullRequests.dirty}`,
    `- Unstable PRs: ${report.sources.pullRequests.unstable}`,
    `- Local dirty paths: ${report.sources.gitStatus.dirtyCount ?? "unknown"}`,
    `- Ops scripts inventoried: ${report.sources.scriptInventory.count}`,
    `- Ops scripts without Makefile target: ${report.sources.scriptInventory.withoutMakeTarget.length}`,
    `- Npm-only ops commands: ${report.sources.commandManifest.npmOnlyCommands}`,
    `- Unclassified npm-only ops commands: ${report.sources.commandManifest.unclassifiedNpmOnlyCommands.length}`,
    `- Producer artifact paths tracked: ${report.sources.producerArtifactFreshness.length}`,
    `- Stale or missing producer artifact paths: ${report.sources.producerArtifactFreshness.filter((entry) => entry.stale).length}`,
    `- Next producer refresh: ${report.nextProducerRefreshTask ? `${report.nextProducerRefreshTask.title} (${report.nextProducerRefreshTask.commandSafetyClass})` : "none"}`,
    `- Approval-gated findings: ${report.approvalGateFindings?.length || 0}`,
    `- Next approval fallback: ${report.nextApprovalFallbackTask ? `${report.nextApprovalFallbackTask.title} (${report.nextApprovalFallbackTask.commandSafetyClass})` : "none"}`,
    "",
    "## Findings",
    ""
  ];
  if (!report.findings.length) {
    lines.push("- No proactive findings from available evidence.");
  }
  for (const finding of report.findings) {
    lines.push(`### ${finding.title}`);
    lines.push("");
    lines.push(`- Severity: ${finding.severity}`);
    lines.push(`- Component: ${finding.component}`);
    lines.push(`- Evidence: ${finding.evidence}`);
    lines.push(`- Impact: ${finding.impact}`);
    lines.push(`- Safe next step: ${finding.safeNextStep}`);
    lines.push(`- Rollback/undo notes: ${finding.rollback}`);
    lines.push("");
  }
  lines.push("## Recommendations");
  lines.push("");
  for (const recommendation of report.recommendations) {
    lines.push(`### ${recommendation.title}`);
    lines.push("");
    lines.push(`- Type: ${recommendation.type}`);
    lines.push(`- Priority: ${recommendation.priority}`);
    lines.push(`- Effort: ${recommendation.effort}`);
    lines.push(`- Risk: ${recommendation.risk}`);
    lines.push(`- Suggested branch: ${recommendation.suggestedBranchName}`);
    lines.push(`- Suggested PR title: ${recommendation.suggestedPrTitle}`);
    lines.push("- Acceptance criteria:");
    for (const item of recommendation.acceptanceCriteria) lines.push(`  - ${item}`);
    lines.push("");
  }
  lines.push("## Producer Refresh Tasks");
  lines.push("");
  if (!report.producerRefreshTasks.length) lines.push("- No stale producer refresh tasks from current policy thresholds.");
  for (const task of report.producerRefreshTasks) {
    lines.push(`### ${task.title}`);
    lines.push("");
    lines.push(`- Rank: ${task.rank}`);
    lines.push(`- Score: ${task.score}`);
    lines.push(`- Labels: ${task.labels.join(", ")}`);
    lines.push(`- Priority: ${task.priority}`);
    lines.push(`- Command safety: ${task.commandSafetyClass}`);
    lines.push(`- Problem: ${task.problem}`);
    lines.push(`- Evidence: ${task.evidence}`);
    lines.push(`- Risk: ${task.risk}`);
    lines.push(`- Proposed fix: ${task.proposedFix}`);
    lines.push("- Acceptance criteria:");
    for (const item of task.acceptanceCriteria) lines.push(`  - ${item}`);
    lines.push(`- Safety notes: ${task.safetyNotes}`);
    lines.push("");
  }
  lines.push("## Approval Fallback Tasks");
  lines.push("");
  if (!report.approvalFallbackTasks?.length) lines.push("- No approval fallback tasks from current evidence.");
  for (const task of report.approvalFallbackTasks || []) {
    lines.push(`### ${task.title}`);
    lines.push("");
    lines.push(`- Rank: ${task.rank}`);
    lines.push(`- Score: ${task.score}`);
    lines.push(`- Labels: ${task.labels.join(", ")}`);
    lines.push(`- Priority: ${task.priority}`);
    lines.push(`- Command safety: ${task.commandSafetyClass}`);
    lines.push(`- Problem: ${task.problem}`);
    lines.push(`- Evidence: ${task.evidence}`);
    lines.push(`- Risk: ${task.risk}`);
    lines.push(`- Proposed fix: ${task.proposedFix}`);
    lines.push("- Acceptance criteria:");
    for (const item of task.acceptanceCriteria) lines.push(`  - ${item}`);
    lines.push(`- Safety notes: ${task.safetyNotes}`);
    lines.push("");
  }
  const stale = report.sources.artifactFreshness.filter((entry) => entry.stale);
  lines.push("## Stale Or Missing Evidence");
  lines.push("");
  if (!stale.length) lines.push("- No stale tracked ops evidence artifacts from this threshold.");
  for (const entry of stale) lines.push(`- ${entry.path}: ${entry.exists ? `${entry.ageDays} days old` : "missing"}`);
  lines.push("");

  const staleProducers = report.sources.producerArtifactFreshness.filter((entry) => entry.stale);
  lines.push("## Producer Artifact Freshness");
  lines.push("");
  if (!staleProducers.length) lines.push("- No stale producer output paths from policy thresholds.");
  for (const entry of staleProducers) {
    const freshness = entry.ageDays === null ? "missing" : `${entry.ageDays} days old`;
    lines.push(`- ${entry.producer}: ${entry.outputPath || "missing outputPath"} (${freshness}; threshold ${entry.freshnessDays} days; refresh \`${entry.refreshCommand || "not listed"}\`; retention ${entry.retentionClass})`);
  }
  lines.push("");
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
    process.stderr.write(`proactive_issue_radar: ${error.message}\n`);
    process.exit(1);
  }
}

main();
