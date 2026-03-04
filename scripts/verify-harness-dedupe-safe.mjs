#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");
const defaultOutDir = resolve(repoRoot, "output", "qa", "loop-verify-safe");

function parseArgs(argv) {
  const options = {
    outDir: defaultOutDir,
    strict: false,
    asJson: false,
    timeoutMs: 120000,
    only: null,
    skip: new Set(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--apply" || arg === "--dry-run") {
      // Accepted as no-op compatibility flags so npm wrappers can forward them safely.
      continue;
    }

    if (!arg.startsWith("--")) continue;
    if (arg.startsWith("--out-dir=")) {
      options.outDir = resolve(process.cwd(), arg.slice("--out-dir=".length).trim());
      continue;
    }
    if (arg.startsWith("--timeout-ms=")) {
      const parsed = Number.parseInt(arg.slice("--timeout-ms=".length), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--timeout-ms must be a positive integer");
      }
      options.timeoutMs = parsed;
      continue;
    }
    if (arg.startsWith("--only=")) {
      const raw = arg.slice("--only=".length);
      const selected = raw
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      options.only = selected.length > 0 ? new Set(selected) : null;
      continue;
    }
    if (arg.startsWith("--skip=")) {
      const raw = arg.slice("--skip=".length);
      const skipped = raw
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      for (const name of skipped) {
        options.skip.add(name);
      }
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--out-dir") {
      options.outDir = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      const parsed = Number.parseInt(String(next).trim(), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--timeout-ms must be a positive integer");
      }
      options.timeoutMs = parsed;
      index += 1;
      continue;
    }
    if (arg === "--only") {
      const selected = String(next)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      options.only = selected.length > 0 ? new Set(selected) : null;
      index += 1;
      continue;
    }
    if (arg === "--skip") {
      const skipped = String(next)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      for (const name of skipped) {
        options.skip.add(name);
      }
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function runCommand(command, args, timeoutMs) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  const timedOut = Boolean(result.error && result.error.code === "ETIMEDOUT");
  const code = timedOut ? 124 : typeof result.status === "number" ? result.status : 1;
  return {
    code,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    timedOut,
  };
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

function extractSkip(payload) {
  if (!payload || typeof payload !== "object") return "n/a";
  const top = payload;
  if (top.rollingCommentSkipped !== undefined) return String(top.rollingCommentSkipped);
  if (top.digestCommentSkipped !== undefined) return String(top.digestCommentSkipped);
  if (top.digestIssueCommentSkipped !== undefined) return String(top.digestIssueCommentSkipped);
  if (Array.isArray(top.rollingUpdates) && top.rollingUpdates.length > 0) {
    const allUnchanged = top.rollingUpdates.every((item) => String(item?.result || "") === "unchanged-skip");
    return String(allUnchanged);
  }
  if (top.rollingIssue && typeof top.rollingIssue === "object" && top.rollingIssue.commentSkipped !== undefined) {
    return String(top.rollingIssue.commentSkipped);
  }
  return "n/a";
}

function extractSignature(payload) {
  if (!payload || typeof payload !== "object") return "n/a";
  const top = payload;
  if (top.rollingCommentSignature) return String(top.rollingCommentSignature);
  if (top.digestCommentSignature) return String(top.digestCommentSignature);
  if (top.digestIssueSignature) return String(top.digestIssueSignature);
  if (top.rollingIssue && typeof top.rollingIssue === "object" && top.rollingIssue.signature) {
    return String(top.rollingIssue.signature);
  }
  return "n/a";
}

function toTsv(rows) {
  const lines = ["name\tfirst_exit\tsecond_exit\tfirst_timeout\tsecond_timeout\tfirst_skip\tsecond_skip\tsecond_sig"];
  for (const row of rows) {
    lines.push(
      [
        row.name,
        String(row.firstExit),
        String(row.secondExit),
        String(row.firstTimedOut),
        String(row.secondTimedOut),
        row.firstSkip,
        row.secondSkip,
        row.secondSig,
      ].join("\t")
    );
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(options.outDir, { recursive: true });

  const excludeRegex =
    "^(Codex (Backlog Autopilot|Automation Findings Digest|Interaction Interrogation|Continuous Improvement|PR Green Daily|Branch Divergence / Force-Push Guard|Portal Automation Weekly Digest|Portal Automation Threshold Tuning|Portal Authenticated Canary Failures|Portal Credential Health|Portal Firestore Index Guard))( \\(Rolling\\))?$";

  const tasks = [
    {
      name: "portal-weekly-digest",
      command: "node",
      args: ["./scripts/portal-automation-weekly-digest.mjs", "--apply", "--json"],
    },
    {
      name: "codex-findings-digest",
      command: "node",
      args: ["./scripts/codex/automation-findings-summary.mjs", "--apply", "--json"],
    },
    {
      name: "codex-pr-green",
      command: "node",
      args: ["./scripts/codex/daily-pr-green.mjs", "--apply", "--force", "--max-reruns", "0", "--json"],
    },
    {
      name: "codex-daily-improvement",
      command: "node",
      args: [
        "./scripts/codex/daily-improvement.mjs",
        "--apply",
        "--allow-dirty",
        "--force",
        "--max-issues",
        "0",
        "--json",
      ],
    },
    {
      name: "codex-daily-interaction",
      command: "node",
      args: ["./scripts/codex/daily-interaction.mjs", "--apply", "--allow-dirty", "--force", "--json"],
    },
    {
      name: "codex-backlog-autopilot",
      command: "node",
      args: [
        "./scripts/codex/backlog-autopilot.mjs",
        "--apply",
        "--json",
        "--write",
        "--limit",
        "200",
        "--max-issues",
        "0",
        "--exclude-regex",
        excludeRegex,
      ],
    },
    {
      name: "branch-divergence-guard",
      command: "node",
      args: ["./scripts/branch-divergence-guard.mjs", "--json"],
    },
    {
      name: "firestore-index-guard",
      command: "node",
      args: ["./scripts/firestore-index-contract-guard.mjs", "--apply", "--json"],
    },
    {
      name: "portal-issue-loop",
      command: "node",
      args: [
        "./scripts/portal-automation-issue-loop.mjs",
        "--apply",
        "--json",
        "--repeated-threshold",
        "999",
      ],
    },
    {
      name: "credential-health",
      command: "node",
      args: ["./scripts/credentials-health-check.mjs", "--apply", "--rules-probe-optional", "--json"],
    },
  ];

  const filteredTasks = tasks.filter((task) => {
    if (options.only && !options.only.has(task.name)) {
      return false;
    }
    if (options.skip.has(task.name)) {
      return false;
    }
    return true;
  });

  if (filteredTasks.length === 0) {
    throw new Error("No tasks selected after applying --only/--skip filters");
  }

  const rows = [];
  for (let index = 0; index < filteredTasks.length; index += 1) {
    const task = filteredTasks[index];
    console.error(`[verify-harness-dedupe-safe] ${index + 1}/${filteredTasks.length} first pass: ${task.name}`);
    const first = runCommand(task.command, task.args, options.timeoutMs);
    console.error(`[verify-harness-dedupe-safe] ${index + 1}/${filteredTasks.length} second pass: ${task.name}`);
    const second = runCommand(task.command, task.args, options.timeoutMs);

    const firstJson = parseJsonSafe(first.stdout);
    const secondJson = parseJsonSafe(second.stdout);

    await writeFile(resolve(options.outDir, `${task.name}-first.json`), first.stdout, "utf8");
    await writeFile(resolve(options.outDir, `${task.name}-first.err`), first.stderr, "utf8");
    await writeFile(resolve(options.outDir, `${task.name}-second.json`), second.stdout, "utf8");
    await writeFile(resolve(options.outDir, `${task.name}-second.err`), second.stderr, "utf8");

    rows.push({
      name: task.name,
      firstExit: first.code,
      secondExit: second.code,
      firstTimedOut: first.timedOut,
      secondTimedOut: second.timedOut,
      firstSkip: extractSkip(firstJson),
      secondSkip: extractSkip(secondJson),
      secondSig: extractSignature(secondJson),
    });
  }

  const tsv = toTsv(rows);
  await writeFile(resolve(options.outDir, "summary.tsv"), tsv, "utf8");
  await writeFile(resolve(options.outDir, "summary.json"), `${JSON.stringify(rows, null, 2)}\n`, "utf8");

  const hasFailures = rows.some((row) => row.firstExit !== 0 || row.secondExit !== 0);
  const output = {
    status: hasFailures ? "completed_with_failures" : "completed",
    outDir: options.outDir,
    strict: options.strict,
    timeoutMs: options.timeoutMs,
    tasksRequested: options.only ? Array.from(options.only.values()) : "all",
    tasksSkipped: Array.from(options.skip.values()),
    rows,
  };

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    process.stdout.write(tsv);
    process.stdout.write(`status: ${output.status}\n`);
    process.stdout.write(`outDir: ${options.outDir}\n`);
  }

  if (options.strict && hasFailures) {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`verify-harness-dedupe-safe failed: ${message}`);
  process.exit(1);
});
