#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_DASHBOARD_PATH = resolve(repoRoot, "output", "qa", "portal-automation-health-dashboard.json");
const DEFAULT_REPORT_JSON_PATH = resolve(repoRoot, "output", "qa", "portal-automation-issue-loop.json");
const DEFAULT_REPORT_MARKDOWN_PATH = resolve(repoRoot, "output", "qa", "portal-automation-issue-loop.md");
const DEFAULT_REPEATED_THRESHOLD = 2;
const DEFAULT_MAX_ISSUES = 12;
const TUNING_ROLLING_ISSUE = "Portal Automation Threshold Tuning (Rolling)";
const CANARY_ROLLING_ISSUE = "Portal Authenticated Canary Failures (Rolling)";

function parseArgs(argv) {
  const options = {
    dashboardPath: DEFAULT_DASHBOARD_PATH,
    reportJsonPath: DEFAULT_REPORT_JSON_PATH,
    reportMarkdownPath: DEFAULT_REPORT_MARKDOWN_PATH,
    apply: false,
    repeatedThreshold: DEFAULT_REPEATED_THRESHOLD,
    maxIssues: DEFAULT_MAX_ISSUES,
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

    if (arg === "--dashboard") {
      options.dashboardPath = resolve(process.cwd(), String(next).trim());
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
    if (arg === "--repeated-threshold") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 1) throw new Error("--repeated-threshold must be >= 1");
      options.repeatedThreshold = Math.min(8, Math.round(value));
      index += 1;
      continue;
    }
    if (arg === "--max-issues") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 1) throw new Error("--max-issues must be >= 1");
      options.maxIssues = Math.min(30, Math.round(value));
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

function issueTitleForSignature(signature) {
  const label = String(signature.label || signature.key || "repeated failure").trim();
  const shortened = label.length > 120 ? `${label.slice(0, 117).trim()}...` : label;
  return `Portal Automation Repeated Failure: ${signature.workflowLabel} / ${shortened}`;
}

function short(text, max = 220) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function parseIssueNumberFromUrl(url) {
  const match = String(url || "").match(/\/issues\/(\d+)$/);
  return match ? Number(match[1]) : 0;
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

function ensureLabel(repoSlug, name, color, description, enabled) {
  if (!enabled) return;
  runGh(
    ["label", "create", name, "--repo", repoSlug, "--color", color, "--description", description, "--force"],
    { allowFailure: true }
  );
}

function createIssueBody(signature, dashboard) {
  const lines = [];
  lines.push(`# ${signature.workflowLabel}`);
  lines.push("");
  lines.push(`Detected repeated automation failure signature: **${signature.label}**`);
  lines.push("");
  lines.push("## Why This Opened");
  lines.push("");
  lines.push(`- Count in lookback window: ${signature.count}`);
  lines.push(`- Dashboard window: last ${dashboard.lookbackHours} hours`);
  lines.push(`- Latest run: ${signature.runUrl || "n/a"}`);
  if (signature.evidence) lines.push(`- Evidence: ${short(signature.evidence, 320)}`);
  lines.push("");
  lines.push("## Suggested Remediation");
  lines.push("");
  lines.push(`- ${signature.suggestion || "Inspect latest artifact and encode deterministic remediation."}`);
  lines.push("");
  lines.push("## Agent Checklist");
  lines.push("");
  lines.push("- [ ] Reproduce in deterministic local or emulator mode.");
  lines.push("- [ ] Add/adjust feedback-loop logic if this is a transient class.");
  lines.push("- [ ] Update related runbook and close this issue with a concrete prevention note.");
  lines.push("");
  lines.push("## Source");
  lines.push("");
  lines.push(`- Dashboard: \`output/qa/portal-automation-health-dashboard.json\``);
  lines.push(`- Signature key: \`${signature.workflowKey}::${signature.key}\``);
  lines.push("");
  return lines.join("\n");
}

function createIssueComment(signature, dashboard) {
  const lines = [];
  lines.push(`## ${dashboard.generatedAtIso} (Repeated Signature Update)`);
  lines.push("");
  lines.push(`- Signature: **${signature.label}**`);
  lines.push(`- Count in lookback: ${signature.count}`);
  lines.push(`- Latest run: ${signature.runUrl || "n/a"}`);
  if (signature.evidence) lines.push(`- Evidence: ${short(signature.evidence, 280)}`);
  if (signature.suggestion) lines.push(`- Suggested remediation: ${signature.suggestion}`);
  lines.push("");
  return lines.join("\n");
}

function createTuningComment(dashboard) {
  const tuning = dashboard.tuning?.recommendations || {};
  const lines = [];
  lines.push(`## ${dashboard.generatedAtIso} (Threshold Tuning Snapshot)`);
  lines.push("");
  lines.push(`Window: last ${dashboard.lookbackHours} hours`);
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(tuning, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("Agent handoff:");
  lines.push("- Apply recommendations only when they reduce flakiness without hiding persistent regressions.");
  lines.push("- Keep deterministic repro steps attached to any signature that reaches this thread repeatedly.");
  lines.push("");
  return lines.join("\n");
}

function createCanaryDirectiveComment(dashboard) {
  const canary = dashboard.tuning?.recommendations?.canary || {};
  const directives = canary.directiveCandidates && typeof canary.directiveCandidates === "object"
    ? canary.directiveCandidates
    : {};

  const timeoutMs = Number(directives["mypieces-timeout-ms"] || 0);
  const reloadRetries = Number(directives["mypieces-reload-retries"] || 0);
  const markReadRetries = Number(directives["mark-read-retries"] || 0);

  const lines = [];
  lines.push(`## ${dashboard.generatedAtIso} (Canary Directive Refresh)`);
  lines.push("");
  lines.push("Automated directive refresh from portal automation dashboard.");
  lines.push("");
  if (timeoutMs > 0) lines.push(`canary-feedback: mypieces-timeout-ms=${timeoutMs}`);
  lines.push(`canary-feedback: mypieces-reload-retries=${Math.max(0, reloadRetries)}`);
  lines.push(`canary-feedback: mark-read-retries=${Math.max(0, markReadRetries)}`);
  lines.push("");
  lines.push("Use these only as adaptive controls, not as a substitute for root-cause fixes.");
  lines.push("");
  return lines.join("\n");
}

function parseDashboard(jsonText) {
  const parsed = JSON.parse(jsonText);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Dashboard payload is not a JSON object.");
  }
  return parsed;
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Portal Automation Issue Loop");
  lines.push("");
  lines.push(`Generated at: \`${report.generatedAtIso}\``);
  lines.push(`Mode: \`${report.mode}\``);
  lines.push(`Dashboard: \`${report.dashboardPath}\``);
  lines.push("");
  lines.push("## Repeated Signature Actions");
  lines.push("");
  if (report.signatureActions.length === 0) {
    lines.push("- No repeated signatures met the issue threshold.");
  } else {
    for (const action of report.signatureActions) {
      lines.push(
        `- ${action.action}: ${action.title} (${action.result || "no-op"})${action.url ? ` -> ${action.url}` : ""}`
      );
    }
  }
  lines.push("");
  lines.push("## Rolling Threads");
  lines.push("");
  for (const item of report.rollingUpdates) {
    lines.push(`- ${item.title}: ${item.result}${item.url ? ` -> ${item.url}` : ""}`);
  }
  lines.push("");
  if (report.notes.length > 0) {
    lines.push("## Notes");
    lines.push("");
    for (const note of report.notes) lines.push(`- ${note}`);
    lines.push("");
  }
  lines.push("## Agent Handoff");
  lines.push("");
  lines.push("- Keep this loop focused on repeated signatures, not one-off flakes.");
  lines.push("- Every issue should include deterministic remediation guidance and artifact links.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dashboardRaw = await readFile(options.dashboardPath, "utf8");
  const dashboard = parseDashboard(dashboardRaw);

  const report = {
    status: "ok",
    generatedAtIso: new Date().toISOString(),
    mode: options.apply ? "apply" : "dry-run",
    dashboardPath: options.dashboardPath,
    signatureThreshold: options.repeatedThreshold,
    maxIssues: options.maxIssues,
    signatureActions: [],
    rollingUpdates: [],
    notes: [],
  };

  const repoSlug = parseRepoSlug();
  if (!repoSlug) {
    throw new Error("Could not resolve repository slug from environment or git remote.");
  }
  report.repo = repoSlug;

  const auth = runGh(["auth", "status"], { allowFailure: true });
  if (!auth.ok) {
    throw new Error("GitHub CLI auth is required for issue loop.");
  }

  ensureLabel(repoSlug, "automation", "1d76db", "Automation-generated work", options.apply);
  ensureLabel(repoSlug, "portal-qa", "0e8a16", "Portal QA automation", options.apply);
  ensureLabel(repoSlug, "self-improvement", "5319e7", "Self-improving feedback loops", options.apply);

  const signatures = Array.isArray(dashboard.repeatedFailureSignatures)
    ? dashboard.repeatedFailureSignatures
        .filter((entry) => Number(entry?.count || 0) >= options.repeatedThreshold)
        .slice(0, options.maxIssues)
    : [];

  for (const signature of signatures) {
    const title = issueTitleForSignature(signature);
    const existing = findIssueByTitle(repoSlug, title);
    const action = {
      action: existing ? "update-issue" : "create-issue",
      title,
      signatureKey: `${signature.workflowKey}::${signature.key}`,
      result: options.apply ? "pending" : "dry-run",
      url: existing?.url || "",
    };

    if (!options.apply) {
      report.signatureActions.push(action);
      continue;
    }

    if (!existing) {
      const body = createIssueBody(signature, dashboard);
      const created = runGh(
        [
          "issue",
          "create",
          "--repo",
          repoSlug,
          "--title",
          title,
          "--body",
          body,
          "--label",
          "automation",
          "--label",
          "portal-qa",
          "--label",
          "self-improvement",
        ],
        { allowFailure: true }
      );
      if (created.ok) {
        action.result = "created";
        action.url = created.stdout.trim();
      } else {
        action.result = "failed-create";
        report.notes.push(`Issue create failed for ${title}: ${short(created.stderr || created.stdout, 180)}`);
      }
    } else {
      const commentBody = createIssueComment(signature, dashboard);
      const commented = runGh(
        [
          "issue",
          "comment",
          String(existing.number),
          "--repo",
          repoSlug,
          "--body",
          commentBody,
        ],
        { allowFailure: true }
      );
      if (commented.ok) {
        action.result = "commented";
        action.url = existing.url;
      } else {
        action.result = "failed-comment";
        report.notes.push(`Issue comment failed for ${title}: ${short(commented.stderr || commented.stdout, 180)}`);
      }
    }

    report.signatureActions.push(action);
  }

  const rollingConfigs = [
    {
      title: TUNING_ROLLING_ISSUE,
      labels: ["automation", "portal-qa", "self-improvement"],
      commentBody: createTuningComment(dashboard),
    },
    {
      title: CANARY_ROLLING_ISSUE,
      labels: ["automation", "portal-qa"],
      commentBody: createCanaryDirectiveComment(dashboard),
    },
  ];

  for (const config of rollingConfigs) {
    const existing = findIssueByTitle(repoSlug, config.title);
    const update = {
      title: config.title,
      result: options.apply ? "pending" : "dry-run",
      url: existing?.url || "",
    };

    if (!options.apply) {
      report.rollingUpdates.push(update);
      continue;
    }

    let issueNumber = existing?.number || 0;
    let issueUrl = existing?.url || "";
    if (!issueNumber) {
      const created = runGh(
        [
          "issue",
          "create",
          "--repo",
          repoSlug,
          "--title",
          config.title,
          "--body",
          "Rolling thread for portal automation loop updates.",
          ...config.labels.flatMap((label) => ["--label", label]),
        ],
        { allowFailure: true }
      );
      if (created.ok) {
        issueUrl = created.stdout.trim();
        issueNumber = parseIssueNumberFromUrl(issueUrl);
      } else {
        update.result = "failed-create";
        report.notes.push(`Could not create rolling issue "${config.title}".`);
      }
    }

    if (issueNumber) {
      const commented = runGh(
        ["issue", "comment", String(issueNumber), "--repo", repoSlug, "--body", config.commentBody],
        { allowFailure: true }
      );
      if (commented.ok) {
        update.result = "commented";
        update.url = issueUrl || existing?.url || "";
      } else {
        update.result = "failed-comment";
        report.notes.push(`Could not comment on rolling issue "${config.title}".`);
      }
    }

    report.rollingUpdates.push(update);
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
    process.stdout.write(`signatureActions: ${String(report.signatureActions.length)}\n`);
    process.stdout.write(`rollingUpdates: ${String(report.rollingUpdates.length)}\n`);
    process.stdout.write(`jsonReport: ${options.reportJsonPath}\n`);
    process.stdout.write(`markdownReport: ${options.reportMarkdownPath}\n`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`portal-automation-issue-loop failed: ${message}`);
  process.exit(1);
});
