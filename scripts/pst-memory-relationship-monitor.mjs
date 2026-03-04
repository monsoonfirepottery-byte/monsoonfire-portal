#!/usr/bin/env node

/* eslint-disable no-console */

import crypto from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_DASHBOARD_PATH = resolve(
  repoRoot,
  "output",
  "memory",
  "relationship-quality",
  "dashboard-latest.json"
);
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "pst-relationship-monitor.json");
const ROLLING_ISSUE_TITLE = "PST Relationship Monitoring (Rolling)";

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseArgs(argv) {
  const options = {
    asJson: false,
    apply: false,
    includeGithub: true,
    dashboardPath: DEFAULT_DASHBOARD_PATH,
    reportPath: DEFAULT_REPORT_PATH,
    labels: ["automation", "infra", "codex-autopilot"],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--no-github") {
      options.includeGithub = false;
      continue;
    }
    if (arg.startsWith("--apply=")) {
      options.apply = parseBool(arg.slice("--apply=".length), options.apply);
      continue;
    }
    if (arg.startsWith("--dashboard=")) {
      options.dashboardPath = resolve(process.cwd(), arg.slice("--dashboard=".length));
      continue;
    }
    if (arg.startsWith("--report=")) {
      options.reportPath = resolve(process.cwd(), arg.slice("--report=".length));
      continue;
    }
    if (arg.startsWith("--labels=")) {
      options.labels = arg
        .slice("--labels=".length)
        .split(",")
        .map((entry) => String(entry || "").trim())
        .filter(Boolean);
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
    if (arg === "--report") {
      options.reportPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--labels") {
      options.labels = String(next)
        .split(",")
        .map((entry) => String(entry || "").trim())
        .filter(Boolean);
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
  return { code, ok: code === 0, stdout, stderr };
}

function runGhJson(args, { allowFailure = true } = {}) {
  const response = runCommand("gh", args, { allowFailure });
  if (!response.ok) {
    return { ok: false, data: null, error: response.stderr || response.stdout || "gh failed" };
  }
  try {
    return { ok: true, data: response.stdout.trim() ? JSON.parse(response.stdout) : null, error: "" };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseRepoSlug() {
  const envSlug = String(process.env.GITHUB_REPOSITORY || "").trim();
  if (envSlug) return envSlug;

  const remote = runCommand("git", ["config", "--get", "remote.origin.url"], { allowFailure: true });
  if (!remote.ok) return "";
  const value = remote.stdout.trim();
  if (!value) return "";

  const sshMatch = value.match(/^git@github\.com:([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (sshMatch) return sshMatch[1];

  const httpsMatch = value.match(/^https:\/\/github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (httpsMatch) return httpsMatch[1];

  return "";
}

async function readDashboard(path) {
  if (!existsSync(path)) {
    throw new Error(`Dashboard artifact not found: ${path}`);
  }
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Dashboard artifact is not a JSON object.");
  }
  return parsed;
}

function stableHash(value, len = 20) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, len);
}

function buildSignature(dashboard) {
  const alerts = Array.isArray(dashboard?.alerts)
    ? dashboard.alerts.map((item) => ({
        id: String(item?.id || ""),
        status: String(item?.status || ""),
        value: item?.value ?? null,
      }))
    : [];
  const payload = {
    status: String(dashboard?.status || ""),
    runId: String(dashboard?.runId || ""),
    alerts,
  };
  return stableHash(JSON.stringify(payload), 20);
}

function buildComment(dashboard, marker = "") {
  const alerts = Array.isArray(dashboard?.alerts) ? dashboard.alerts : [];
  const lines = [];
  lines.push(`## ${dashboard?.generatedAt || new Date().toISOString()} — relationship monitor`);
  lines.push("");
  lines.push(`- Status: ${dashboard?.status || "unknown"}`);
  lines.push(`- Run: ${dashboard?.runId || "n/a"}`);
  lines.push("");
  lines.push("### Alerts");
  if (alerts.length === 0) {
    lines.push("- none");
  } else {
    for (const alert of alerts) {
      lines.push(
        `- ${String(alert?.id || "unknown")}: ${String(alert?.status || "unknown")} (value: ${
          alert?.value == null ? "n/a" : String(alert.value)
        })`
      );
    }
  }
  if (marker) {
    lines.push("");
    lines.push(`<!-- ${marker} -->`);
  }
  return `${lines.join("\n")}\n`;
}

function getLatestIssueCommentBody(repoSlug, issueNumber) {
  const response = runGhJson(
    ["issue", "view", String(issueNumber), "--repo", repoSlug, "--json", "comments"],
    { allowFailure: true }
  );
  if (!response.ok || !response.data || typeof response.data !== "object") return "";
  const comments = Array.isArray(response.data.comments) ? response.data.comments : [];
  const latest = comments.length > 0 ? comments[comments.length - 1] : null;
  return String(latest?.body || "");
}

function ensureGhLabel(repoSlug, name, color, description) {
  runCommand(
    "gh",
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

function ensureRollingIssue(repoSlug, labels) {
  const existing = runGhJson([
    "issue",
    "list",
    "--repo",
    repoSlug,
    "--state",
    "open",
    "--search",
    `in:title \"${ROLLING_ISSUE_TITLE}\"`,
    "--limit",
    "10",
    "--json",
    "number,title,url",
  ]);
  if (existing.ok && Array.isArray(existing.data)) {
    const exact = existing.data.find((issue) => String(issue?.title || "") === ROLLING_ISSUE_TITLE);
    if (exact) {
      return { number: Number(exact.number || 0), url: String(exact.url || "") };
    }
  }

  const createArgs = ["issue", "create", "--repo", repoSlug, "--title", ROLLING_ISSUE_TITLE, "--body", "Rolling monitor for PST relationship quality alerts."];
  for (const label of labels) {
    createArgs.push("--label", label);
  }
  const created = runCommand("gh", createArgs, { allowFailure: true });
  if (!created.ok) return { number: 0, url: "" };
  const issueUrl = created.stdout.split(/\s+/).find((token) => token.startsWith("https://github.com/")) || "";
  const match = issueUrl.match(/\/issues\/(\d+)/);
  return { number: match ? Number(match[1]) : 0, url: issueUrl };
}

function postIssueComment(repoSlug, issueNumber, body) {
  runCommand(
    "gh",
    ["issue", "comment", String(issueNumber), "--repo", repoSlug, "--body", body],
    { allowFailure: true }
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dashboard = await readDashboard(options.dashboardPath);
  const dashboardStatus = String(dashboard?.status || "unknown").toLowerCase();
  const shouldAlert = dashboardStatus !== "ok";
  const signature = buildSignature(dashboard);
  const marker = `pst-relationship-monitor-signature:${signature}`;

  const output = {
    status: shouldAlert ? "alert" : "ok",
    dashboardStatus,
    dashboardPath: options.dashboardPath,
    reportPath: options.reportPath,
    apply: options.apply,
    includeGithub: options.includeGithub,
    rollingIssue: {
      number: 0,
      url: "",
      signature,
      commentSkipped: false,
    },
    notes: [],
  };

  if (options.apply && options.includeGithub && shouldAlert) {
    const repoSlug = parseRepoSlug();
    if (!repoSlug) {
      output.notes.push("Repository slug unavailable; skipped GitHub issue update.");
    } else {
      ensureGhLabel(repoSlug, "automation", "1d76db", "Automation-generated work");
      ensureGhLabel(repoSlug, "infra", "5319e7", "Infrastructure and operational controls");
      ensureGhLabel(repoSlug, "codex-autopilot", "0e8a16", "Codex autonomous loops");

      const rollingIssue = ensureRollingIssue(repoSlug, options.labels);
      output.rollingIssue.number = rollingIssue.number;
      output.rollingIssue.url = rollingIssue.url;

      if (rollingIssue.number > 0) {
        const latestBody = getLatestIssueCommentBody(repoSlug, rollingIssue.number);
        const unchanged = latestBody.includes(`<!-- ${marker} -->`);
        output.rollingIssue.commentSkipped = unchanged;
        if (!unchanged) {
          postIssueComment(repoSlug, rollingIssue.number, buildComment(dashboard, marker));
        }
      }
    }
  } else if (!shouldAlert) {
    output.notes.push("Dashboard status is ok; no alert issue update required.");
  }

  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${output.status}\n`);
    process.stdout.write(`dashboard-status: ${dashboardStatus}\n`);
    process.stdout.write(`report: ${relative(repoRoot, options.reportPath)}\n`);
    if (output.rollingIssue.url) {
      process.stdout.write(`rolling-issue: ${output.rollingIssue.url}\n`);
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`pst-memory-relationship-monitor failed: ${message}`);
  process.exit(1);
});

