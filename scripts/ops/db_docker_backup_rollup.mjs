#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "db-docker-backup");

const CHECKS = [
  {
    id: "docker-posture",
    title: "Docker posture",
    area: "docker",
    command: ["bash", ["scripts/ops/docker_posture_review.sh"]],
    timeoutMs: 90_000,
    approvalBoundary: "No prune, pull, restart, recreate, or delete. Cleanup and live compose changes remain approval-gated."
  },
  {
    id: "postgres-readonly-snapshot",
    title: "PostgreSQL read-only snapshot",
    area: "postgres",
    command: ["bash", ["scripts/ops/postgres_readonly_snapshot_runner.sh"]],
    timeoutMs: 90_000,
    approvalBoundary: "No schema changes, VACUUM, ANALYZE, REINDEX, session termination, or restore."
  },
  {
    id: "backup-evidence",
    title: "Unified backup evidence",
    area: "backup",
    command: ["bash", ["scripts/ops/backup_evidence.sh"]],
    timeoutMs: 90_000,
    approvalBoundary: "No backup creation, restore, deletion, retention change, or secret read."
  },
  {
    id: "postgres-backup-artifacts",
    title: "PostgreSQL backup artifact verifier",
    area: "backup",
    command: ["bash", ["scripts/ops/backup_postgres_artifact_verifier.sh"]],
    timeoutMs: 90_000,
    approvalBoundary: "No restore over production. Metadata-only artifact inspection."
  },
  {
    id: "redis-minio-backup-evidence",
    title: "Redis and MinIO backup evidence",
    area: "backup",
    command: ["bash", ["scripts/ops/redis_minio_evidence_verifier.sh"]],
    timeoutMs: 90_000,
    approvalBoundary: "No object deletion, bucket mutation, or Redis writes."
  },
  {
    id: "restore-prerequisites",
    title: "Restore prerequisite packet",
    area: "backup",
    command: ["bash", ["scripts/ops/backup_restore_prerequisite_drill.sh"]],
    timeoutMs: 90_000,
    approvalBoundary: "Disposable-target restore planning only. Production restore remains approval-gated."
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
  return `Studio Brain DB/Docker/backup proactive rollup

Usage:
  node scripts/ops/db_docker_backup_rollup.mjs [--json] [--write]

Options:
  --json                 Print JSON to stdout.
  --write                Write timestamped JSON and Markdown artifacts.
  --output-dir <path>    Artifact directory. Default: output/ops/db-docker-backup.
  --run-id <id>          Stable run id.
  --no-run               Do not execute packets; report command inventory only.
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
  const options = { json: false, write: false, run: true, outputDir: DEFAULT_OUTPUT_DIR, runId: "" };
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
    if (arg === "--no-run") {
      options.run = false;
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

function sanitizeOutput(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/(Authorization:?\s*Bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)[A-Z0-9_]*[=:\s]+)[^,\s"']+/gi, "$1[redacted]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, "$1[redacted]@");
}

function runCheck(check, outputDir, options) {
  const artifactPath = resolve(outputDir, `${check.id}.txt`);
  if (!options.run) {
    const output = `status: not_run\nreason: --no-run was supplied\ncommand: ${check.command[0]} ${check.command[1].join(" ")}\n`;
    writeFileSync(artifactPath, output, "utf8");
    return summarizeCheck(check, output, 0, "", artifactPath, "not_run");
  }
  const [command, args] = check.command;
  if (!commandExists(command)) {
    const output = `status: skipped\nreason: ${command} unavailable\ncommand: ${command} ${args.join(" ")}\n`;
    writeFileSync(artifactPath, output, "utf8");
    return summarizeCheck(check, output, 0, "", artifactPath, "skipped");
  }
  const startedAt = nowIso();
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: check.timeoutMs,
    env: { ...process.env }
  });
  const output = [
    `# ${check.title}`,
    `generated_at: ${startedAt}`,
    `command: ${command} ${args.join(" ")}`,
    `exit_status: ${result.status ?? "unknown"}`,
    `timed_out_or_error: ${result.error?.message || ""}`,
    "",
    sanitizeOutput(result.stdout),
    sanitizeOutput(result.stderr)
  ].join("\n");
  writeFileSync(artifactPath, output, "utf8");
  return summarizeCheck(check, output, result.status, result.error?.message || "", artifactPath, "");
}

function summarizeCheck(check, output, exitStatus, error, artifactPath, forcedStatus) {
  const text = output.toLowerCase();
  const signals = [];
  if (text.includes("approval_gated") || text.includes("requires an approved sudo")) signals.push("approval_gated");
  if (/(^|\n)[a-z0-9_ -]*(status|freshness|manifest_status|latest_status):\s*(missing|missing_directory|missing_or_unreadable|no_matching_files_or_permission_denied)\b/im.test(text)) {
    signals.push("missing_evidence");
  }
  if (/(^|\n)[a-z0-9_ -]*(freshness|status):\s*stale\b/im.test(text)) signals.push("stale_evidence");
  if (/(^|\n)[a-z0-9_ -]*status:\s*(skipped|docker_unavailable|unavailable)\b/im.test(text) || text.includes(" unavailable;")) {
    signals.push("skipped_or_unavailable");
  }
  if (text.includes("warn:") || text.includes("warning")) signals.push("warning");
  if (exitStatus && exitStatus !== 0) signals.push("nonzero_exit");
  if (error) signals.push("runtime_error");
  const status = forcedStatus ||
    (signals.includes("nonzero_exit") || signals.includes("runtime_error") ? "error" :
      signals.includes("missing_evidence") || signals.includes("stale_evidence") ? "warning" :
        signals.includes("approval_gated") || signals.includes("skipped_or_unavailable") ? "degraded" : "ok");
  return {
    id: check.id,
    title: check.title,
    area: check.area,
    command: `${check.command[0]} ${check.command[1].join(" ")}`,
    status,
    signals: [...new Set(signals)],
    exitStatus: exitStatus ?? null,
    artifactPath: repoRelative(artifactPath),
    approvalBoundary: check.approvalBoundary
  };
}

function buildIssueTask(summary) {
  return {
    title: `[${summary.area}] Review ${summary.title.toLowerCase()} evidence`,
    body: [
      "## Problem",
      `${summary.title} reported \`${summary.status}\` with signals: ${summary.signals.join(", ") || "none"}.`,
      "",
      "## Evidence",
      `Artifact: \`${summary.artifactPath}\``,
      `Command: \`${summary.command}\``,
      "",
      "## Risk",
      "The administrator may be missing current Docker, PostgreSQL, or backup posture evidence.",
      "",
      "## Proposed Fix",
      "Review the artifact, rerun the read-only packet on the correct host if needed, and update the relevant ops docs or backlog.",
      "",
      "## Acceptance Criteria",
      "- Evidence is current or the missing/approval-gated lane is explicitly documented.",
      "- Any production-impacting action remains approval-gated.",
      "- Rollback notes are recorded for any follow-up PR.",
      "",
      "## Safety Notes",
      `- ${summary.approvalBoundary}`,
      "- This packet is read-only and does not approve cleanup, restarts, restores, or schema changes."
    ].join("\n"),
    labels: ["ops", summary.area, "reliability"]
  };
}

function buildReport(options) {
  const generatedAt = nowIso();
  const runId = clean(options.runId) || `db-docker-backup-${generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const runDir = resolve(options.outputDir, runId);
  mkdirSync(runDir, { recursive: true });
  const summaries = CHECKS.map((check) => runCheck(check, runDir, options));
  const degraded = summaries.filter((summary) => ["warning", "degraded", "error", "skipped"].includes(summary.status));
  return {
    schema: "studio-brain.ops.db-docker-backup-rollup.v1",
    generatedAt,
    runId,
    readOnly: true,
    redaction: "Bearer tokens, token/secret/password/API key patterns, and PostgreSQL URL passwords are redacted from captured output.",
    status: summaries.some((summary) => summary.status === "error") ? "error" : degraded.length ? "degraded" : "ok",
    summary: {
      checks: summaries.length,
      ok: summaries.filter((summary) => summary.status === "ok").length,
      degraded: summaries.filter((summary) => summary.status === "degraded").length,
      warning: summaries.filter((summary) => summary.status === "warning").length,
      error: summaries.filter((summary) => summary.status === "error").length,
      skipped: summaries.filter((summary) => summary.status === "skipped").length
    },
    checks: summaries,
    issueReadyTasks: degraded.map(buildIssueTask)
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Studio Brain DB/Docker/Backup Proactive Rollup",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Run ID: ${report.runId}`,
    `- Status: ${report.status}`,
    `- Read-only: ${report.readOnly ? "yes" : "no"}`,
    "",
    "## Summary",
    "",
    `- Checks: ${report.summary.checks}`,
    `- OK: ${report.summary.ok}`,
    `- Degraded: ${report.summary.degraded}`,
    `- Warning: ${report.summary.warning}`,
    `- Error: ${report.summary.error}`,
    `- Skipped: ${report.summary.skipped}`,
    "",
    "## Checks",
    ""
  ];
  for (const check of report.checks) {
    lines.push(`### ${check.title}`);
    lines.push("");
    lines.push(`- Area: ${check.area}`);
    lines.push(`- Status: ${check.status}`);
    lines.push(`- Signals: ${check.signals.join(", ") || "none"}`);
    lines.push(`- Command: \`${check.command}\``);
    lines.push(`- Artifact: \`${check.artifactPath}\``);
    lines.push(`- Approval boundary: ${check.approvalBoundary}`);
    lines.push("");
  }
  lines.push("## Issue-Ready Tasks");
  lines.push("");
  if (!report.issueReadyTasks.length) lines.push("- No degraded evidence tasks.");
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
  } catch (error) {
    process.stderr.write(`db_docker_backup_rollup: ${error.message}\n`);
    process.exit(1);
  }
}

main();
