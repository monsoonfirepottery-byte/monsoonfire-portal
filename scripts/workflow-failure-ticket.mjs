#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAutomationFamilyBody,
  getAutomationFamily,
  getWorkflowFailureFamilyKey,
} from "./lib/automation-issue-families.mjs";
import {
  closeIssue,
  commentIssue,
  ensureGhLabels,
  ensureIssueWithMarker,
  fetchLatestIssueCommentBody,
  listRepoIssues,
  markerComment,
  parseRepoSlug,
} from "./lib/github-issues.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "workflow-failure-ticket.json");

function parseArgs(argv) {
  const options = {
    workflowName: "",
    runId: String(process.env.GITHUB_RUN_ID || "").trim(),
    runUrl: "",
    title: "",
    reportPath: DEFAULT_REPORT_PATH,
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

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
    if (arg === "--run-id") {
      options.runId = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--run-url") {
      options.runUrl = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--title") {
      options.title = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--report") {
      options.reportPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
  }

  if (!options.workflowName) {
    throw new Error("Missing required --workflow-name.");
  }

  return options;
}

function normalizeTitle(workflowName, overrideTitle) {
  if (overrideTitle) return overrideTitle;
  return `${workflowName} Failures (Rolling)`;
}

function short(value, max = 280) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function createIssueBody({ workflowName, runUrl, runId }) {
  const lines = [];
  lines.push(`# ${workflowName}`);
  lines.push("");
  lines.push("Rolling issue for workflow failures. The automation loop comments here on each failed run.");
  lines.push("");
  lines.push("## Latest Failure");
  lines.push("");
  lines.push(`- Run: ${runUrl || "n/a"}`);
  lines.push(`- Run ID: ${runId || "n/a"}`);
  lines.push(`- Event: ${process.env.GITHUB_EVENT_NAME || "n/a"}`);
  lines.push(`- Branch: ${process.env.GITHUB_REF_NAME || "n/a"}`);
  lines.push(`- SHA: ${process.env.GITHUB_SHA || "n/a"}`);
  lines.push(`- Actor: ${process.env.GITHUB_ACTOR || "n/a"}`);
  lines.push("");
  lines.push("## Agent Checklist");
  lines.push("");
  lines.push("- [ ] Inspect failed step logs and identify deterministic root cause.");
  lines.push("- [ ] Land a fix and reference commit/run evidence.");
  lines.push("- [ ] Close this issue when failure is resolved and stable.");
  lines.push("");
  return lines.join("\n");
}

function createFailureComment({ workflowName, runUrl, runId, runMarker }) {
  const lines = [];
  lines.push(`## ${new Date().toISOString()} — workflow failure`);
  lines.push("");
  lines.push(`- Workflow: ${workflowName}`);
  lines.push(`- Run: ${runUrl || "n/a"}`);
  lines.push(`- Run ID: ${runId || "n/a"}`);
  lines.push(`- Event: ${process.env.GITHUB_EVENT_NAME || "n/a"}`);
  lines.push(`- Branch: ${process.env.GITHUB_REF_NAME || "n/a"}`);
  lines.push(`- SHA: ${process.env.GITHUB_SHA || "n/a"}`);
  lines.push(`- Actor: ${process.env.GITHUB_ACTOR || "n/a"}`);
  lines.push(`- Attempt: ${process.env.GITHUB_RUN_ATTEMPT || "1"}`);
  lines.push("");
  lines.push("Action:");
  lines.push("- Inspect failing step logs and artifacts.");
  lines.push("- Capture root-cause + mitigation in this thread.");
  lines.push("");
  lines.push(markerComment(runMarker));
  lines.push("");
  return lines.join("\n");
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoSlug = parseRepoSlug({ cwd: repoRoot });
  if (!repoSlug) {
    throw new Error("Could not resolve repository slug from environment or git remote.");
  }
  const title = normalizeTitle(options.workflowName, options.title);
  const openIssuesResp = listRepoIssues(repoSlug, { state: "open", maxPages: 2, cwd: repoRoot });
  if (!openIssuesResp.ok) {
    throw new Error(`Could not read open issues: ${openIssuesResp.error}`);
  }

  const familyKey = getWorkflowFailureFamilyKey(options.workflowName);
  const family = familyKey ? getAutomationFamily(familyKey) : null;
  const marker = family ? family.marker : `workflow-failure-title:${slugify(title)}`;
  const runMarker = `workflow-failure-run:${slugify(options.workflowName)}:${options.runId || "manual"}`;

  const labels = family
    ? family.labels
    : [
        { name: "automation", color: "0e8a16", description: "Automated monitoring and remediation." },
        { name: "portal-qa", color: "0e8a16", description: "Portal QA automation" },
      ];
  ensureGhLabels(repoSlug, labels, { cwd: repoRoot });

  const issueBody = family ? buildAutomationFamilyBody(family) : `${createIssueBody(options)}\n\n${markerComment(marker)}\n`;
  const ensured = ensureIssueWithMarker(
    repoSlug,
    {
      title: family ? family.title : title,
      body: issueBody,
      labels: labels.map((item) => item.name),
      marker,
      preferredNumber: family?.preferredNumber || 0,
      openIssues: openIssuesResp.data,
    },
    { cwd: repoRoot }
  );
  if (!ensured.ok || !ensured.issue) {
    throw new Error(`Could not resolve issue target: ${ensured.error || "unknown error"}`);
  }

  for (const duplicate of ensured.duplicates) {
    closeIssue(
      repoSlug,
      duplicate.number,
      {
        commentBody: `Superseded by #${ensured.issue.number} (${ensured.issue.title}). Closing duplicate rolling thread.`,
        stateReason: "not_planned",
      },
      { cwd: repoRoot }
    );
  }

  const report = {
    status: "ok",
    generatedAtIso: new Date().toISOString(),
    repo: repoSlug,
    workflowName: options.workflowName,
    issueTitle: ensured.issue.title,
    runId: options.runId,
    runUrl: options.runUrl,
    action: "comment",
    issueUrl: ensured.issue.url || "",
    issueNumber: ensured.issue.number || 0,
    notes: [],
    familyKey: family?.key || "",
    duplicatesClosed: ensured.duplicates.map((duplicate) => duplicate.url),
  };

  const latestComment = fetchLatestIssueCommentBody(repoSlug, ensured.issue.number, { cwd: repoRoot });
  if (latestComment.includes(markerComment(runMarker))) {
    report.result = "unchanged-skip";
  } else {
    const commented = commentIssue(
      repoSlug,
      ensured.issue.number,
      createFailureComment({ ...options, runMarker }),
      { cwd: repoRoot }
    );
    if (!commented.ok) {
      throw new Error(`Issue comment failed: ${short(commented.stderr || commented.stdout, 400)}`);
    }
    report.result = "commented";
  }

  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${report.status}\n`);
    process.stdout.write(`action: ${report.action}\n`);
    process.stdout.write(`result: ${report.result}\n`);
    process.stdout.write(`issue: ${report.issueUrl || "n/a"}\n`);
    process.stdout.write(`report: ${options.reportPath}\n`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`workflow-failure-ticket failed: ${message}`);
  process.exit(1);
});
