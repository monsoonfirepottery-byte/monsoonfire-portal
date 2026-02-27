#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..", "..");

const summaryIssueTitle = "Codex Automation Findings Digest (Rolling)";
const outputDir = resolve(repoRoot, "output", "qa");
const markdownArtifactPath = resolve(outputDir, "codex-automation-findings-summary.md");
const jsonArtifactPath = resolve(outputDir, "codex-automation-findings-summary.json");

const sources = [
  {
    key: "improvement",
    label: "Continuous Improvement",
    issueTitle: "Codex Continuous Improvement (Rolling)",
    workflowName: "Codex Self Improvement",
  },
  {
    key: "interaction",
    label: "Interaction Interrogation",
    issueTitle: "Codex Interaction Interrogation (Rolling)",
    workflowName: "Codex Interaction Interrogation",
  },
  {
    key: "prGreen",
    label: "PR Green Daily",
    issueTitle: "Codex PR Green Daily (Rolling)",
    workflowName: "Codex PR Green Daily",
  },
];

function parseArgs(argv) {
  const options = {
    apply: false,
    dryRun: true,
    asJson: false,
  };

  for (const arg of argv) {
    if (arg === "--apply") {
      options.apply = true;
      options.dryRun = false;
      continue;
    }
    if (arg === "--dry-run") {
      options.apply = false;
      options.dryRun = true;
      continue;
    }
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
  }

  return options;
}

function runCommand(command, args, { allowFailure = false, cwd = repoRoot, env = process.env } = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8" });
  const durationMs = Date.now() - startedAt;
  const code = typeof result.status === "number" ? result.status : 1;
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");

  if (code !== 0 && !allowFailure) {
    throw new Error(`Command failed (${code}): ${command} ${args.join(" ")}\n${stderr || stdout}`);
  }

  return {
    code,
    ok: code === 0,
    stdout,
    stderr,
    durationMs,
  };
}

function runGit(args, options = {}) {
  return runCommand("git", args, options);
}

function runGh(args, options = {}) {
  return runCommand("gh", args, options);
}

function runGhJson(args, { allowFailure = true } = {}) {
  const response = runGh(args, { allowFailure });
  if (!response.ok) {
    return {
      ok: false,
      data: null,
      error: response.stderr || response.stdout || "gh command failed",
    };
  }

  try {
    return {
      ok: true,
      data: response.stdout.trim() ? JSON.parse(response.stdout) : null,
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: `Invalid JSON from gh: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function parseRepoSlug() {
  const fromEnv = String(process.env.GITHUB_REPOSITORY || "").trim();
  if (fromEnv && fromEnv.includes("/")) return fromEnv;

  const remote = runGit(["remote", "get-url", "origin"], { allowFailure: true });
  if (!remote.ok) return "";

  const raw = remote.stdout.trim();
  const match = raw.match(/github\.com[:/](.+?)(?:\.git)?$/);
  return match ? match[1] : "";
}

function normalizeMention(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.startsWith("@") ? raw : `@${raw}`;
}

function uniqueList(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function extractHighlights(markdownBody, maxItems = 5) {
  const lines = String(markdownBody || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const bulletLines = lines
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim());

  const fallbackLines = lines.filter(
    (line) => !line.startsWith("#") && !line.startsWith("<") && !line.startsWith("```")
  );

  return uniqueList(bulletLines.length > 0 ? bulletLines : fallbackLines).slice(0, maxItems);
}

function findIssueByTitle(repoSlug, title) {
  const response = runGhJson([
    "issue",
    "list",
    "--repo",
    repoSlug,
    "--state",
    "open",
    "--search",
    `"${title}" in:title`,
    "--limit",
    "5",
    "--json",
    "number,title,url,updatedAt,body",
  ]);

  if (!response.ok || !Array.isArray(response.data)) return null;
  return response.data.find((issue) => issue.title === title) || null;
}

function fetchLatestIssueComment(repoSlug, issueNumber) {
  const response = runGhJson([
    "api",
    `repos/${repoSlug}/issues/${issueNumber}/comments?per_page=1&sort=created&direction=desc`,
  ]);

  if (!response.ok || !Array.isArray(response.data) || response.data.length === 0) return null;
  const latest = response.data[0];
  return {
    url: String(latest.html_url || ""),
    createdAt: String(latest.created_at || ""),
    body: String(latest.body || ""),
  };
}

function fetchLatestWorkflowRun(repoSlug, workflowName) {
  const response = runGhJson([
    "run",
    "list",
    "--repo",
    repoSlug,
    "--workflow",
    workflowName,
    "--limit",
    "1",
    "--json",
    "databaseId,workflowName,displayTitle,status,conclusion,createdAt,updatedAt,url",
  ]);

  if (!response.ok || !Array.isArray(response.data) || response.data.length === 0) return null;
  return response.data[0];
}

function parseIssueNumberFromUrl(issueUrl) {
  const match = String(issueUrl || "").match(/\/issues\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

async function ensureGhLabel(repoSlug, name, color, description, enabled) {
  if (!enabled) return;
  runGh(
    [
      "label",
      "create",
      name,
      "--repo",
      repoSlug,
      "--color",
      color,
      "--description",
      description,
      "--force",
    ],
    { allowFailure: true }
  );
}

function createSummaryComment({
  generatedAtIso,
  sourceSummaries,
  okCount,
  needsAttentionCount,
  notes,
  mentionTarget,
}) {
  const lines = [];
  lines.push(`## ${generatedAtIso} (Automation Findings Digest)`);
  if (mentionTarget) {
    lines.push(`cc ${mentionTarget}`);
  }
  lines.push("");
  lines.push("### Overall");
  lines.push(`- Sources monitored: ${sourceSummaries.length}`);
  lines.push(`- Healthy workflows: ${okCount}`);
  lines.push(`- Needs attention: ${needsAttentionCount}`);
  lines.push("");

  for (const source of sourceSummaries) {
    lines.push(`### ${source.label}`);
    lines.push(`- Workflow: ${source.workflowStatus}`);
    if (source.workflowUrl) lines.push(`- Latest workflow run: ${source.workflowUrl}`);
    lines.push(`- Rolling issue: ${source.issueUrl || "not found"}`);
    if (source.latestFindingAt) lines.push(`- Latest finding at: ${source.latestFindingAt}`);
    lines.push("- Highlights:");
    if (source.highlights.length === 0) {
      lines.push("  - No highlights captured yet.");
    } else {
      source.highlights.forEach((entry) => lines.push(`  - ${entry}`));
    }
    lines.push("");
  }

  if (notes.length > 0) {
    lines.push("### Notes");
    notes.forEach((note) => lines.push(`- ${note}`));
    lines.push("");
  }

  return lines.join("\n");
}

async function writeArtifacts(markdown, report) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(markdownArtifactPath, `${markdown}\n`, "utf8");
  await writeFile(jsonArtifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const generatedAtIso = new Date().toISOString();
  const repoSlug = parseRepoSlug();
  const repoOwner = repoSlug.includes("/") ? repoSlug.split("/")[0] : "";
  const mentionTarget = normalizeMention(process.env.CODEX_REPORT_MENTION || repoOwner);
  const notes = [];

  const githubAvailable = Boolean(repoSlug) && runGh(["auth", "status"], { allowFailure: true }).ok;
  if (!repoSlug) notes.push("Unable to resolve repository slug.");
  if (!githubAvailable) notes.push("GitHub CLI unavailable or not authenticated; reporting is local-only.");

  const sourceSummaries = [];
  for (const source of sources) {
    const summary = {
      key: source.key,
      label: source.label,
      issueTitle: source.issueTitle,
      workflowName: source.workflowName,
      issueUrl: "",
      workflowUrl: "",
      workflowStatus: "unknown",
      workflowConclusion: "",
      latestFindingAt: "",
      highlights: [],
    };

    if (githubAvailable) {
      const issue = findIssueByTitle(repoSlug, source.issueTitle);
      if (issue) {
        summary.issueUrl = String(issue.url || "");
        const latestComment = fetchLatestIssueComment(repoSlug, issue.number);
        if (latestComment) {
          summary.latestFindingAt = latestComment.createdAt;
          summary.highlights = extractHighlights(latestComment.body);
        } else {
          summary.latestFindingAt = String(issue.updatedAt || "");
          summary.highlights = extractHighlights(issue.body || "");
        }
      } else {
        notes.push(`Rolling issue not found: ${source.issueTitle}`);
      }

      const workflowRun = fetchLatestWorkflowRun(repoSlug, source.workflowName);
      if (workflowRun) {
        summary.workflowUrl = String(workflowRun.url || "");
        const status = String(workflowRun.status || "unknown");
        const conclusion = String(workflowRun.conclusion || "");
        summary.workflowConclusion = conclusion;
        summary.workflowStatus = conclusion ? `${status}/${conclusion}` : status;
      } else {
        notes.push(`No workflow run found for: ${source.workflowName}`);
      }
    }

    sourceSummaries.push(summary);
  }

  const okCount = sourceSummaries.filter((entry) => entry.workflowConclusion === "success").length;
  const needsAttentionCount = sourceSummaries.length - okCount;
  const markdown = createSummaryComment({
    generatedAtIso,
    sourceSummaries,
    okCount,
    needsAttentionCount,
    notes,
    mentionTarget,
  });

  const report = {
    status: options.apply ? "applied" : "dry-run",
    runAtIso: generatedAtIso,
    repo: repoSlug || null,
    githubAvailable,
    summary: {
      sourcesMonitored: sourceSummaries.length,
      healthyWorkflows: okCount,
      workflowsNeedingAttention: needsAttentionCount,
    },
    sources: sourceSummaries,
    notes,
    mentionTarget: mentionTarget || null,
    artifacts: {
      markdown: relative(repoRoot, markdownArtifactPath),
      json: relative(repoRoot, jsonArtifactPath),
    },
  };

  await writeArtifacts(markdown, report);

  let digestIssueUrl = "";
  if (options.apply && githubAvailable) {
    await ensureGhLabel(repoSlug, "automation", "1d76db", "Automation-generated work", true);
    await ensureGhLabel(repoSlug, "epic:codex-reporting", "0e8a16", "Codex automation reporting", true);

    let digestIssue = findIssueByTitle(repoSlug, summaryIssueTitle);
    if (!digestIssue) {
      const createIssue = runGh(
        [
          "issue",
          "create",
          "--repo",
          repoSlug,
          "--title",
          summaryIssueTitle,
          "--body",
          "Rolling consolidated digest of Codex automation findings.",
          "--label",
          "automation",
          "--label",
          "epic:codex-reporting",
        ],
        { allowFailure: true }
      );
      if (createIssue.ok) {
        digestIssueUrl = createIssue.stdout.trim();
        const issueNumber = parseIssueNumberFromUrl(digestIssueUrl);
        if (issueNumber) {
          digestIssue = {
            number: issueNumber,
            url: digestIssueUrl,
          };
        }
      }
      if (!digestIssue) {
        digestIssue = findIssueByTitle(repoSlug, summaryIssueTitle);
      }
    }

    if (digestIssue?.number) {
      digestIssueUrl = digestIssue.url;
      runGh(
        [
          "issue",
          "comment",
          String(digestIssue.number),
          "--repo",
          repoSlug,
          "--body",
          markdown,
        ],
        { allowFailure: true }
      );
    }
  }

  report.digestIssue = digestIssueUrl || null;
  await writeFile(jsonArtifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      [
        `status: ${report.status}`,
        `sources monitored: ${report.summary.sourcesMonitored}`,
        `healthy workflows: ${report.summary.healthyWorkflows}`,
        `needs attention: ${report.summary.workflowsNeedingAttention}`,
        `digest issue: ${report.digestIssue || "none"}`,
        `artifact: ${report.artifacts.markdown}`,
        "",
      ].join("\n")
    );
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`automation-findings-summary failed: ${message}`);
  process.exit(1);
});
