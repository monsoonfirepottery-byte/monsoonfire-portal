#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_WORKFLOW_NAME = "Portal Automation Health Daily";
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_RUN_LIMIT = 25;
const DEFAULT_ARTIFACT_PREFIX = "portal-automation-health-dashboard-";
const DEFAULT_REPORT_JSON_PATH = resolve(repoRoot, "output", "qa", "portal-automation-weekly-digest.json");
const DEFAULT_REPORT_MARKDOWN_PATH = resolve(repoRoot, "output", "qa", "portal-automation-weekly-digest.md");
const ROLLING_DIGEST_ISSUE = "Portal Automation Weekly Digest (Rolling)";

function parseArgs(argv) {
  const options = {
    workflowName: DEFAULT_WORKFLOW_NAME,
    branch: String(process.env.GITHUB_REF_NAME || "main").trim() || "main",
    lookbackDays: DEFAULT_LOOKBACK_DAYS,
    runLimit: DEFAULT_RUN_LIMIT,
    artifactPrefix: DEFAULT_ARTIFACT_PREFIX,
    reportJsonPath: DEFAULT_REPORT_JSON_PATH,
    reportMarkdownPath: DEFAULT_REPORT_MARKDOWN_PATH,
    apply: false,
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.apply = false;
      continue;
    }
    if (arg === "--json") {
      options.asJson = true;
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
    if (arg === "--branch") {
      options.branch = String(next).trim() || options.branch;
      index += 1;
      continue;
    }
    if (arg === "--lookback-days") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 1) throw new Error("--lookback-days must be >= 1");
      options.lookbackDays = Math.min(30, Math.round(value));
      index += 1;
      continue;
    }
    if (arg === "--run-limit") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 5) throw new Error("--run-limit must be >= 5");
      options.runLimit = Math.min(80, Math.round(value));
      index += 1;
      continue;
    }
    if (arg === "--artifact-prefix") {
      options.artifactPrefix = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--report-json") {
      options.reportJsonPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--report-markdown") {
      options.reportMarkdownPath = resolve(process.cwd(), String(next).trim());
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
  return { ok: code === 0, code, stdout, stderr };
}

function runGh(args, options = {}) {
  return runCommand("gh", args, options);
}

function parseRepoSlug() {
  const fromEnv = String(process.env.GITHUB_REPOSITORY || "").trim();
  if (fromEnv && fromEnv.includes("/")) return fromEnv;

  const remote = runCommand("git", ["remote", "get-url", "origin"], { allowFailure: true });
  if (!remote.ok) return "";

  const raw = remote.stdout.trim();
  const match = raw.match(/github\.com[:/](.+?)(?:\.git)?$/);
  return match ? match[1] : "";
}

function findIssueByTitle(repoSlug, title) {
  const list = runGh(
    [
      "issue",
      "list",
      "--repo",
      repoSlug,
      "--state",
      "open",
      "--search",
      `"${title}" in:title`,
      "--limit",
      "10",
      "--json",
      "number,title,url",
    ],
    { allowFailure: true }
  );
  if (!list.ok) return null;
  try {
    const parsed = JSON.parse(list.stdout || "[]");
    if (!Array.isArray(parsed)) return null;
    return parsed.find((entry) => String(entry?.title || "") === title) || null;
  } catch {
    return null;
  }
}

function parseIssueNumberFromUrl(url) {
  const match = String(url || "").match(/\/issues\/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

async function findFilesRecursive(rootPath, fileName) {
  const matches = [];
  async function walk(dir) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name === fileName) {
        matches.push(fullPath);
      }
    }
  }
  await walk(rootPath);
  return matches;
}

function toTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function short(text, max = 200) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function findWorkflowMetric(snapshot, key) {
  const workflows = Array.isArray(snapshot?.workflows) ? snapshot.workflows : [];
  return workflows.find((entry) => String(entry?.key || "") === key) || null;
}

function buildDigestComment(report) {
  const lines = [];
  lines.push(`## ${report.generatedAtIso} (Portal Automation Weekly Digest)`);
  lines.push("");
  lines.push(`- Snapshot count: ${report.snapshotCount}`);
  lines.push(`- Window: last ${report.lookbackDays} days`);
  lines.push(`- Oldest snapshot: ${report.oldestSnapshot?.generatedAtIso || "n/a"}`);
  lines.push(`- Latest snapshot: ${report.latestSnapshot?.generatedAtIso || "n/a"}`);
  lines.push("");
  lines.push("### Pass-rate deltas");
  if (report.trend.passRateDeltas.length === 0) {
    lines.push("- No comparable snapshots were available.");
  } else {
    for (const delta of report.trend.passRateDeltas) {
      const sign = delta.delta >= 0 ? "+" : "";
      lines.push(
        `- ${delta.label}: ${Math.round(delta.from * 100)}% -> ${Math.round(delta.to * 100)}% (${sign}${Math.round(
          delta.delta * 100
        )} pts)`
      );
    }
  }
  lines.push("");
  lines.push("### Top flaky signatures (latest)");
  if (report.trend.topFlakySignatures.length === 0) {
    lines.push("- None detected.");
  } else {
    for (const signature of report.trend.topFlakySignatures) {
      lines.push(`- [${signature.workflowLabel}] ${signature.label} (count=${signature.count})`);
      if (signature.suggestion) lines.push(`  - remediation: ${signature.suggestion}`);
    }
  }
  lines.push("");
  lines.push("### New remediation candidates");
  if (report.trend.newRemediationCandidates.length === 0) {
    lines.push("- No newly-emerged repeated signatures.");
  } else {
    for (const candidate of report.trend.newRemediationCandidates) {
      lines.push(`- [${candidate.workflowLabel}] ${candidate.label}`);
      if (candidate.runUrl) lines.push(`  - run: ${candidate.runUrl}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Portal Automation Weekly Digest");
  lines.push("");
  lines.push(`Generated at: \`${report.generatedAtIso}\``);
  lines.push(`Mode: \`${report.mode}\``);
  lines.push(`Lookback days: \`${report.lookbackDays}\``);
  lines.push("");
  lines.push("## Snapshot Summary");
  lines.push("");
  lines.push(`- Snapshot count: ${report.snapshotCount}`);
  lines.push(`- Latest snapshot: ${report.latestSnapshot?.generatedAtIso || "n/a"}`);
  lines.push(`- Oldest snapshot: ${report.oldestSnapshot?.generatedAtIso || "n/a"}`);
  lines.push("");
  lines.push("## Pass-rate Deltas");
  lines.push("");
  if (report.trend.passRateDeltas.length === 0) {
    lines.push("- No comparable snapshots were available.");
  } else {
    for (const delta of report.trend.passRateDeltas) {
      const sign = delta.delta >= 0 ? "+" : "";
      lines.push(
        `- ${delta.label}: ${Math.round(delta.from * 100)}% -> ${Math.round(delta.to * 100)}% (${sign}${Math.round(
          delta.delta * 100
        )} pts)`
      );
    }
  }
  lines.push("");
  lines.push("## Top Flaky Signatures");
  lines.push("");
  if (report.trend.topFlakySignatures.length === 0) {
    lines.push("- None.");
  } else {
    for (const signature of report.trend.topFlakySignatures) {
      lines.push(`- [${signature.workflowLabel}] ${signature.label} (count=${signature.count})`);
      if (signature.suggestion) lines.push(`  - Suggested remediation: ${signature.suggestion}`);
    }
  }
  lines.push("");
  lines.push("## New Remediation Candidates");
  lines.push("");
  if (report.trend.newRemediationCandidates.length === 0) {
    lines.push("- None.");
  } else {
    for (const candidate of report.trend.newRemediationCandidates) {
      lines.push(`- [${candidate.workflowLabel}] ${candidate.label}`);
      if (candidate.runUrl) lines.push(`  - Latest run: ${candidate.runUrl}`);
      if (candidate.suggestion) lines.push(`  - Suggested remediation: ${candidate.suggestion}`);
    }
  }
  lines.push("");
  lines.push("## Agent Handoff");
  lines.push("");
  lines.push("- Use deltas to decide whether thresholds should tighten or relax.");
  lines.push("- Any signature that remains in this section for 2+ digests should have a dedicated root-cause issue.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const now = Date.now();
  const lookbackStartMs = now - options.lookbackDays * 24 * 60 * 60 * 1000;
  const report = {
    status: "ok",
    generatedAtIso: new Date().toISOString(),
    mode: options.apply ? "apply" : "dry-run",
    workflowName: options.workflowName,
    branch: options.branch,
    lookbackDays: options.lookbackDays,
    snapshotCount: 0,
    snapshots: [],
    oldestSnapshot: null,
    latestSnapshot: null,
    trend: {
      passRateDeltas: [],
      topFlakySignatures: [],
      newRemediationCandidates: [],
    },
    digestIssue: null,
    notes: [],
  };

  const auth = runGh(["auth", "status"], { allowFailure: true });
  if (!auth.ok) {
    throw new Error("GitHub CLI auth is required for weekly digest.");
  }

  const runList = runGh(
    [
      "run",
      "list",
      "--workflow",
      options.workflowName,
      "--branch",
      options.branch,
      "--limit",
      String(options.runLimit),
      "--json",
      "databaseId,conclusion,status,createdAt,url",
    ],
    { allowFailure: true }
  );
  if (!runList.ok) {
    throw new Error(`Unable to list workflow runs for ${options.workflowName}.`);
  }

  let runs = [];
  try {
    const parsed = JSON.parse(runList.stdout || "[]");
    runs = Array.isArray(parsed) ? parsed : [];
  } catch {
    runs = [];
  }

  const filteredRuns = runs
    .filter((run) => String(run?.status || "").toLowerCase() === "completed")
    .filter((run) => String(run?.conclusion || "").toLowerCase() === "success")
    .filter((run) => toTimestamp(run.createdAt) >= lookbackStartMs)
    .sort((a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt));

  const scratchDir = await mkdtemp(resolve(tmpdir(), "portal-weekly-digest-"));
  try {
    for (const run of filteredRuns) {
      const runId = String(run.databaseId || "").trim();
      if (!runId) continue;
      const artifactName = `${options.artifactPrefix}${runId}`;
      const runDir = resolve(scratchDir, runId);
      await mkdir(runDir, { recursive: true });

      const download = runGh(["run", "download", runId, "-n", artifactName, "-D", runDir], {
        allowFailure: true,
      });
      if (!download.ok) {
        report.notes.push(`Missing artifact for run ${runId}: ${artifactName}`);
        continue;
      }

      const dashboardPaths = await findFilesRecursive(runDir, "portal-automation-health-dashboard.json");
      if (dashboardPaths.length === 0) {
        report.notes.push(`Dashboard JSON not found in run ${runId} artifact.`);
        continue;
      }

      const raw = await readFile(dashboardPaths[0], "utf8");
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        report.notes.push(`Invalid dashboard JSON in run ${runId}.`);
        continue;
      }

      report.snapshots.push({
        runId: Number(run.databaseId || 0),
        runUrl: String(run.url || ""),
        createdAt: String(run.createdAt || ""),
        generatedAtIso: String(parsed?.generatedAtIso || run.createdAt || ""),
        summary: parsed?.summary || {},
        workflows: Array.isArray(parsed?.workflows) ? parsed.workflows : [],
        repeatedFailureSignatures: Array.isArray(parsed?.repeatedFailureSignatures)
          ? parsed.repeatedFailureSignatures
          : [],
      });
    }
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }

  report.snapshots.sort((a, b) => toTimestamp(a.generatedAtIso) - toTimestamp(b.generatedAtIso));
  report.snapshotCount = report.snapshots.length;
  report.oldestSnapshot = report.snapshots[0] || null;
  report.latestSnapshot = report.snapshots[report.snapshots.length - 1] || null;

  if (report.snapshotCount >= 2) {
    const earliest = report.oldestSnapshot;
    const latest = report.latestSnapshot;
    const latestWorkflows = Array.isArray(latest.workflows) ? latest.workflows : [];
    const passRateDeltas = [];

    for (const latestWorkflow of latestWorkflows) {
      const key = String(latestWorkflow?.key || "");
      if (!key) continue;
      const previous = findWorkflowMetric(earliest, key);
      if (!previous) continue;
      const from = Number(previous.passRate || 0);
      const to = Number(latestWorkflow.passRate || 0);
      passRateDeltas.push({
        key,
        label: String(latestWorkflow.label || key),
        from,
        to,
        delta: Number((to - from).toFixed(4)),
      });
    }

    passRateDeltas.sort((a, b) => a.delta - b.delta);
    report.trend.passRateDeltas = passRateDeltas;

    const latestRepeated = Array.isArray(latest.repeatedFailureSignatures) ? latest.repeatedFailureSignatures : [];
    report.trend.topFlakySignatures = latestRepeated.slice(0, 8).map((entry) => ({
      workflowLabel: String(entry.workflowLabel || "unknown"),
      label: String(entry.label || entry.key || "unknown"),
      count: Number(entry.count || 0),
      suggestion: short(entry.suggestion || "", 240),
      runUrl: String(entry.runUrl || ""),
      key: String(entry.key || ""),
      workflowKey: String(entry.workflowKey || ""),
    }));

    const previousKeys = new Set(
      (Array.isArray(earliest.repeatedFailureSignatures) ? earliest.repeatedFailureSignatures : []).map(
        (entry) => `${String(entry.workflowKey || "")}::${String(entry.key || "")}`
      )
    );
    report.trend.newRemediationCandidates = latestRepeated
      .filter((entry) => !previousKeys.has(`${String(entry.workflowKey || "")}::${String(entry.key || "")}`))
      .slice(0, 8)
      .map((entry) => ({
        workflowLabel: String(entry.workflowLabel || "unknown"),
        label: String(entry.label || entry.key || "unknown"),
        runUrl: String(entry.runUrl || ""),
        suggestion: short(entry.suggestion || "", 240),
      }));
  } else {
    report.notes.push("Not enough snapshots for week-over-week delta analysis.");
  }

  const digestComment = buildDigestComment(report);
  if (options.apply) {
    const repoSlug = parseRepoSlug();
    if (!repoSlug) {
      report.notes.push("Could not resolve repository slug; digest issue update skipped.");
    } else {
      let issue = findIssueByTitle(repoSlug, ROLLING_DIGEST_ISSUE);
      if (!issue) {
        const create = runGh(
          [
            "issue",
            "create",
            "--repo",
            repoSlug,
            "--title",
            ROLLING_DIGEST_ISSUE,
            "--body",
            "Rolling weekly digest for portal automation self-improvement loops.",
            "--label",
            "automation",
            "--label",
            "portal-qa",
          ],
          { allowFailure: true }
        );
        if (create.ok) {
          const url = create.stdout.trim();
          const number = parseIssueNumberFromUrl(url);
          issue = { number, url, title: ROLLING_DIGEST_ISSUE };
        } else {
          report.notes.push("Could not create weekly digest rolling issue.");
        }
      }

      if (issue?.number) {
        const comment = runGh(
          ["issue", "comment", String(issue.number), "--repo", repoSlug, "--body", digestComment],
          { allowFailure: true }
        );
        if (comment.ok) {
          report.digestIssue = String(issue.url || "");
        } else {
          report.notes.push("Could not post weekly digest comment.");
        }
      }
    }
  }

  const markdown = buildMarkdown(report);
  await mkdir(dirname(options.reportJsonPath), { recursive: true });
  await mkdir(dirname(options.reportMarkdownPath), { recursive: true });
  await writeFile(options.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(options.reportMarkdownPath, `${markdown}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${report.status}\n`);
    process.stdout.write(`mode: ${report.mode}\n`);
    process.stdout.write(`snapshots: ${String(report.snapshotCount)}\n`);
    process.stdout.write(`digestIssue: ${report.digestIssue || "none"}\n`);
    process.stdout.write(`jsonReport: ${options.reportJsonPath}\n`);
    process.stdout.write(`markdownReport: ${options.reportMarkdownPath}\n`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`portal-automation-weekly-digest failed: ${message}`);
  process.exit(1);
});
