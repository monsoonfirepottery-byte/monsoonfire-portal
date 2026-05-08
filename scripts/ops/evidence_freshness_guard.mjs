#!/usr/bin/env node

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "evidence-freshness");

const TRACKED_EVIDENCE = [
  {
    id: "system-inventory",
    path: "docs/ops/00-system-inventory.md",
    owner: "Codex",
    warningDays: 14,
    criticalDays: 30,
    refreshCommand: "make ops-inventory",
    reason: "Host, Docker, PostgreSQL, and application inventory should stay current enough to guide triage."
  },
  {
    id: "risk-register",
    path: "docs/ops/01-risk-register.md",
    owner: "Codex",
    warningDays: 14,
    criticalDays: 30,
    refreshCommand: "make ops-report",
    reason: "Risk recommendations should not outlive their evidence."
  },
  {
    id: "kanban-backlog",
    path: "docs/ops/02-kanban-backlog.md",
    owner: "Codex",
    warningDays: 21,
    criticalDays: 45,
    refreshCommand: "make ops-backlog",
    reason: "Issue-ready backlog should reflect the current approval gates and safe PR candidates."
  },
  {
    id: "capacity-plan",
    path: "docs/ops/03-capacity-plan.md",
    owner: "Codex",
    warningDays: 14,
    criticalDays: 30,
    refreshCommand: "make ops-capacity",
    reason: "Disk, log, backup, Docker, and database capacity evidence can drift quickly."
  },
  {
    id: "postgres-dba-review",
    path: "docs/ops/04-postgres-dba-review.md",
    owner: "DBA review",
    warningDays: 14,
    criticalDays: 30,
    refreshCommand: "make ops-postgres-review",
    reason: "DBA conclusions depend on current sizes, locks, statistics, and backup posture."
  },
  {
    id: "docker-ops-review",
    path: "docs/ops/05-docker-ops-review.md",
    owner: "Codex",
    warningDays: 14,
    criticalDays: 30,
    refreshCommand: "make ops-docker-posture",
    reason: "Docker healthcheck, restart policy, image, volume, and log posture can drift after deploys."
  },
  {
    id: "runbooks",
    path: "docs/ops/06-runbooks.md",
    owner: "human",
    warningDays: 45,
    criticalDays: 90,
    refreshCommand: "make ops-docs",
    reason: "Runbooks should be rechecked after operational tooling or deploy flow changes."
  },
  {
    id: "maintenance-calendar",
    path: "docs/ops/07-maintenance-calendar.md",
    owner: "human",
    warningDays: 45,
    criticalDays: 90,
    refreshCommand: "make ops-docs",
    reason: "Recurring checks should match the current evidence surfaces."
  },
  {
    id: "backup-confidence",
    path: "docs/ops/23-backup-restore-confidence.md",
    owner: "DBA review",
    warningDays: 7,
    criticalDays: 14,
    refreshCommand: "make ops-backup-evidence",
    reason: "Backup confidence ages faster than documentation because restore confidence depends on fresh artifacts."
  },
  {
    id: "privileged-evidence",
    path: "docs/ops/22-privileged-evidence-capture.md",
    owner: "human",
    warningDays: 30,
    criticalDays: 60,
    refreshCommand: "make ops-privileged-evidence-read",
    reason: "Privileged evidence gaps should stay explicit when sudo is unavailable to agents."
  }
];

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function repoRelative(path) {
  return relative(REPO_ROOT, path).replace(/\\/g, "/");
}

function usage() {
  return `Studio Brain ops evidence freshness guard

Usage:
  node scripts/ops/evidence_freshness_guard.mjs [--json] [--write] [--strict]

Options:
  --json                 Print JSON to stdout.
  --write                Write timestamped JSON and Markdown artifacts.
  --strict               Exit nonzero on critical stale or missing evidence.
  --output-dir <path>    Artifact directory. Default: output/ops/evidence-freshness.
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
  const options = { json: false, write: false, strict: false, outputDir: DEFAULT_OUTPUT_DIR, runId: "" };
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
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    const mappings = [["--output-dir", "outputDir"], ["--run-id", "runId"]];
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

function classify(entry, nowMs) {
  const absolute = resolve(REPO_ROOT, entry.path);
  if (!existsSync(absolute)) {
    return {
      ...entry,
      exists: false,
      status: "critical",
      modifiedAt: "",
      ageDays: null,
      evidence: `${entry.path} is missing.`
    };
  }
  const stat = statSync(absolute);
  const ageDays = Number(((nowMs - stat.mtimeMs) / 86_400_000).toFixed(1));
  const status = ageDays >= entry.criticalDays ? "critical" : ageDays >= entry.warningDays ? "warning" : "ok";
  return {
    ...entry,
    exists: true,
    status,
    modifiedAt: stat.mtime.toISOString(),
    ageDays,
    evidence: `${entry.path} is ${ageDays} days old; warning >= ${entry.warningDays}, critical >= ${entry.criticalDays}.`
  };
}

function buildIssueTask(item) {
  return {
    title: `[ops] Refresh ${item.id} evidence`,
    body: [
      "## Problem",
      `${item.path} is ${item.exists ? `${item.ageDays} days old` : "missing"}, so the administrator may be reasoning from stale or absent evidence.`,
      "",
      "## Evidence",
      item.evidence,
      "",
      "## Risk",
      item.reason,
      "",
      "## Proposed Fix",
      `Run or adapt \`${item.refreshCommand}\` and update the evidence artifact with current read-only findings.`,
      "",
      "## Acceptance Criteria",
      "- Evidence artifact has a current timestamp or updated observation date.",
      "- Any unknown or approval-gated evidence remains explicit.",
      "- No destructive host action is performed.",
      "",
      "## Safety Notes",
      "- Rollback is a git revert of the documentation/report update.",
      "- Live host mutation remains approval-gated.",
      `- Recommended owner: ${item.owner}.`
    ].join("\n"),
    labels: ["ops", "docs", "reliability"]
  };
}

function buildReport(options) {
  const generatedAt = nowIso();
  const runId = clean(options.runId) || `evidence-freshness-${generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const items = TRACKED_EVIDENCE.map((entry) => classify(entry, Date.now()));
  const critical = items.filter((item) => item.status === "critical");
  const warning = items.filter((item) => item.status === "warning");
  return {
    schema: "studio-brain.ops.evidence-freshness.v1",
    generatedAt,
    runId,
    readOnly: true,
    status: critical.length ? "critical" : warning.length ? "warning" : "ok",
    thresholds: "Per-artifact warning and critical age thresholds are encoded in this script.",
    summary: {
      tracked: items.length,
      ok: items.filter((item) => item.status === "ok").length,
      warning: warning.length,
      critical: critical.length,
      missing: items.filter((item) => !item.exists).length
    },
    items,
    issueReadyTasks: [...critical, ...warning].map(buildIssueTask)
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Studio Brain Ops Evidence Freshness",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Run ID: ${report.runId}`,
    `- Status: ${report.status}`,
    `- Read-only: ${report.readOnly ? "yes" : "no"}`,
    "",
    "## Summary",
    "",
    `- Tracked artifacts: ${report.summary.tracked}`,
    `- OK: ${report.summary.ok}`,
    `- Warning: ${report.summary.warning}`,
    `- Critical: ${report.summary.critical}`,
    `- Missing: ${report.summary.missing}`,
    "",
    "## Artifact Status",
    ""
  ];
  for (const item of report.items) {
    lines.push(`### ${item.id}`);
    lines.push("");
    lines.push(`- Status: ${item.status}`);
    lines.push(`- Path: ${item.path}`);
    lines.push(`- Age days: ${item.ageDays ?? "missing"}`);
    lines.push(`- Warning days: ${item.warningDays}`);
    lines.push(`- Critical days: ${item.criticalDays}`);
    lines.push(`- Refresh command: \`${item.refreshCommand}\``);
    lines.push(`- Evidence: ${item.evidence}`);
    lines.push(`- Safety: read-only refresh first; host mutation remains approval-gated.`);
    lines.push("");
  }
  lines.push("## Issue-Ready Tasks");
  lines.push("");
  if (!report.issueReadyTasks.length) lines.push("- No stale or missing evidence tasks.");
  for (const task of report.issueReadyTasks) {
    lines.push(`### ${task.title}`);
    lines.push("");
    lines.push(task.body);
    lines.push("");
    lines.push(`Labels: ${task.labels.join(", ")}`);
    lines.push("");
  }
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
    if (options.strict && report.status === "critical") process.exit(2);
  } catch (error) {
    process.stderr.write(`evidence_freshness_guard: ${error.message}\n`);
    process.exit(1);
  }
}

main();
