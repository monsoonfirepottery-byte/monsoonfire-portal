#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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

function parseIssueNumberFromUrl(url) {
  const match = String(url || "").match(/\/issues\/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function findOpenIssueByTitle(repoSlug, title) {
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
      "number,title,url,updatedAt",
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

function ensureLabel(repoSlug, name, color, description) {
  runGh(
    ["label", "create", name, "--repo", repoSlug, "--color", color, "--description", description, "--force"],
    { allowFailure: true }
  );
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

function createFailureComment({ workflowName, runUrl, runId }) {
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
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoSlug = parseRepoSlug();
  if (!repoSlug) {
    throw new Error("Could not resolve repository slug from environment or git remote.");
  }

  const auth = runGh(["auth", "status"], { allowFailure: true });
  if (!auth.ok) {
    throw new Error("GitHub CLI auth is required.");
  }

  ensureLabel(repoSlug, "automation", "1d76db", "Automation-generated work");
  ensureLabel(repoSlug, "portal-qa", "0e8a16", "Portal QA automation");
  ensureLabel(repoSlug, "self-improvement", "5319e7", "Self-improving feedback loops");

  const title = normalizeTitle(options.workflowName, options.title);
  const existing = findOpenIssueByTitle(repoSlug, title);

  const report = {
    status: "ok",
    generatedAtIso: new Date().toISOString(),
    repo: repoSlug,
    workflowName: options.workflowName,
    issueTitle: title,
    runId: options.runId,
    runUrl: options.runUrl,
    action: existing ? "comment" : "create",
    issueUrl: existing?.url || "",
    issueNumber: existing?.number || 0,
    notes: [],
  };

  if (!existing) {
    const created = runGh(
      [
        "issue",
        "create",
        "--repo",
        repoSlug,
        "--title",
        title,
        "--body",
        createIssueBody(options),
        "--label",
        "automation",
        "--label",
        "portal-qa",
        "--label",
        "self-improvement",
      ],
      { allowFailure: true }
    );
    if (!created.ok) {
      throw new Error(`Issue create failed: ${short(created.stderr || created.stdout, 400)}`);
    }
    report.issueUrl = created.stdout.trim();
    report.issueNumber = parseIssueNumberFromUrl(report.issueUrl);
    report.result = "created";
  } else {
    const commented = runGh(
      [
        "issue",
        "comment",
        String(existing.number),
        "--repo",
        repoSlug,
        "--body",
        createFailureComment(options),
      ],
      { allowFailure: true }
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
