#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_PRODUCER_POLICY = resolve(REPO_ROOT, "docs", "ops", "output-artifact-producers.json");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "producer-refresh-runner");

function usage() {
  return `Studio Brain ops producer refresh runner

Usage:
  node scripts/ops/producer_refresh_runner.mjs [--json] [--write] [--execute]

Options:
  --json                         Print JSON.
  --write                        Write latest JSON and Markdown artifacts.
  --execute                      Execute selected refresh commands. Default is plan-only.
  --all                          Include fresh producers too. Default selects stale or missing producers.
  --producer <id>                Select one producer. Can be repeated.
  --include-live                 Include read-only live probes such as incident bundles.
  --include-approval-gated       Include commands classified as approval-gated.
  --max-producers <number>       Maximum selected producers. Default: 5.
  --timeout-ms <number>          Per-command timeout when executing. Default: 120000.
  --producer-policy <path>       Producer policy path. Default: docs/ops/output-artifact-producers.json.
  --output-dir <path>            Artifact directory. Default: output/ops/producer-refresh-runner.

This runner is plan-only by default. With --execute it runs only commands listed in docs/ops/output-artifact-producers.json,
captures stdout/stderr snippets, writes ignored output artifacts, and never deletes, prunes, restarts, upgrades, or changes host config.
`;
}

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function repoRelative(path) {
  return relative(REPO_ROOT, path).replace(/\\/g, "/") || ".";
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
    execute: false,
    all: false,
    includeLive: false,
    includeApprovalGated: false,
    producers: [],
    maxProducers: 5,
    timeoutMs: 120_000,
    producerPolicy: DEFAULT_PRODUCER_POLICY,
    outputDir: DEFAULT_OUTPUT_DIR
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
    if (arg === "--execute") {
      options.execute = true;
      continue;
    }
    if (arg === "--all") {
      options.all = true;
      continue;
    }
    if (arg === "--include-live") {
      options.includeLive = true;
      continue;
    }
    if (arg === "--include-approval-gated") {
      options.includeApprovalGated = true;
      continue;
    }
    const mappings = [
      ["--producer", "producer"],
      ["--max-producers", "maxProducers"],
      ["--timeout-ms", "timeoutMs"],
      ["--producer-policy", "producerPolicy"],
      ["--output-dir", "outputDir"]
    ];
    let consumed = false;
    for (const [flag, key] of mappings) {
      const parsed = readFlagValue(argv, index, flag);
      if (!parsed.matched) continue;
      if (key === "producer") options.producers.push(parsed.value);
      else options[key] = parsed.value;
      index = parsed.nextIndex;
      consumed = true;
      break;
    }
    if (consumed) continue;
    throw new Error(`Unknown argument: ${arg}`);
  }

  options.producerPolicy = resolve(REPO_ROOT, options.producerPolicy);
  options.outputDir = resolve(REPO_ROOT, options.outputDir);
  options.maxProducers = Math.max(1, Number(options.maxProducers || 5));
  options.timeoutMs = Math.max(1_000, Number(options.timeoutMs || 120_000));
  options.producers = options.producers.map(clean).filter(Boolean);
  return options;
}

function readJson(path) {
  if (!existsSync(path)) throw new Error(`${repoRelative(path)} is missing.`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function newestArtifact(dir) {
  if (!dir || !existsSync(dir)) return null;
  const entries = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = statSync(path);
      entries.push({ path, modifiedAt: stat.mtime.toISOString(), sizeBytes: stat.size });
    }
  };
  walk(dir);
  entries.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return entries[0] || null;
}

function ageDays(iso) {
  const time = Date.parse(iso || "");
  if (!Number.isFinite(time)) return null;
  return Number(((Date.now() - time) / 86_400_000).toFixed(1));
}

function classifyCommand(command) {
  const value = clean(command).toLowerCase();
  if (!value) return "unknown";
  if (value.includes("privileged-evidence-capture") && !value.includes("smoke")) return "human_approval_required";
  if (value.includes("reset --yes-i-know") || value.includes("rm -") || value.includes("prune")) return "human_approval_required";
  if (value.includes("incident") || value.includes("post-deploy")) return "read_only_live_probe";
  if (value.includes("postgres") || value.includes("docker")) return "read_only_specialist";
  return "read_only_local";
}

function isRunnable(command) {
  const value = clean(command);
  return Boolean(value) && value !== "not listed" && !/[;&|<>]/.test(value);
}

function commandParts(command) {
  const parts = clean(command).split(/\s+/).filter(Boolean);
  if (process.platform === "win32" && parts[0] === "npm") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", ...parts] };
  }
  const executable = parts[0];
  return { command: executable, args: parts.slice(1) };
}

function outputSnippet(value) {
  return clean(value).slice(0, 4000);
}

function executeCommand(command, timeoutMs) {
  const parts = commandParts(command);
  const result = spawnSync(parts.command, parts.args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs,
    env: { ...process.env }
  });
  return {
    status: result.error ? "failed" : result.status === 0 ? "ok" : "failed",
    exitCode: result.status,
    signal: result.signal || "",
    error: result.error?.message || "",
    timedOut: Boolean(result.error && result.error.code === "ETIMEDOUT"),
    stdout: outputSnippet(result.stdout),
    stderr: outputSnippet(result.stderr)
  };
}

function producerEntries(policy) {
  const defaults = policy.default || {};
  return Object.entries(policy.producers || {}).map(([producer, raw]) => {
    const entry = { ...defaults, ...raw, producer };
    const outputPath = resolve(REPO_ROOT, entry.outputPath || "");
    const newest = newestArtifact(outputPath);
    const newestAgeDays = newest ? ageDays(newest.modifiedAt) : null;
    const freshnessDays = Number(entry.freshnessDays || defaults.freshnessDays || 14);
    const stale = !newest || (newestAgeDays !== null && newestAgeDays > freshnessDays);
    const safetyClass = classifyCommand(entry.refreshCommand);
    return {
      producer,
      outputPath: entry.outputPath || "",
      refreshCommand: entry.refreshCommand || "",
      freshnessDays,
      cleanupApproval: entry.cleanupApproval || defaults.cleanupApproval || "human",
      retentionClass: entry.retentionClass || defaults.retentionClass || "review",
      newestArtifact: newest ? repoRelative(newest.path) : "",
      newestAt: newest?.modifiedAt || "",
      newestAgeDays,
      stale,
      commandSafetyClass: safetyClass,
      runnable: isRunnable(entry.refreshCommand)
    };
  });
}

function selectEntries(entries, options) {
  const requested = new Set(options.producers);
  return entries
    .filter((entry) => !requested.size || requested.has(entry.producer))
    .filter((entry) => options.all || entry.stale)
    .map((entry) => {
      let selected = true;
      let skipReason = "";
      if (!entry.runnable) {
        selected = false;
        skipReason = "refresh command is missing or not safely tokenizable";
      } else if (entry.commandSafetyClass === "read_only_live_probe" && !options.includeLive) {
        selected = false;
        skipReason = "live probe skipped; pass --include-live to include";
      } else if (entry.commandSafetyClass === "human_approval_required" && !options.includeApprovalGated) {
        selected = false;
        skipReason = "approval-gated command skipped";
      }
      return { ...entry, selected, skipReason };
    })
    .slice(0, options.maxProducers);
}

function buildReport(options) {
  const generatedAt = nowIso();
  const policy = readJson(options.producerPolicy);
  const entries = producerEntries(policy);
  const selected = selectEntries(entries, options);
  const results = selected.map((entry) => {
    if (!entry.selected) return { ...entry, outcome: "skipped" };
    if (!options.execute) return { ...entry, outcome: "planned" };
    const execution = executeCommand(entry.refreshCommand, options.timeoutMs);
    return { ...entry, outcome: execution.status, execution };
  });
  const failed = results.filter((entry) => entry.outcome === "failed").length;
  const executed = results.filter((entry) => entry.execution).length;
  const planned = results.filter((entry) => entry.outcome === "planned").length;
  const skipped = results.filter((entry) => entry.outcome === "skipped").length;
  const status = failed ? "action_needed" : results.length ? "ok" : "ok";
  return {
    schema: "studio-brain.ops.producer-refresh-runner.v1",
    generatedAt,
    readOnly: true,
    mode: options.execute ? "execute" : "plan",
    status,
    producerPolicy: repoRelative(options.producerPolicy),
    selection: {
      requestedProducers: options.producers,
      all: options.all,
      includeLive: options.includeLive,
      includeApprovalGated: options.includeApprovalGated,
      maxProducers: options.maxProducers,
      timeoutMs: options.timeoutMs
    },
    summary: {
      producerCount: entries.length,
      staleProducerCount: entries.filter((entry) => entry.stale).length,
      selectedCount: results.length,
      planned,
      executed,
      skipped,
      failed
    },
    results,
    safety: [
      "Plan-only by default; pass --execute to run selected refresh commands.",
      "Commands come only from docs/ops/output-artifact-producers.json.",
      "Live probes and approval-gated commands are skipped unless explicitly included.",
      "No cleanup, deletion, restart, upgrade, schema change, secret rotation, or host config mutation is performed by this runner."
    ],
    rollback: "Generated artifacts live under ignored output/ops paths. Revert repo changes to remove the runner."
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Studio Brain Producer Refresh Runner",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Status: ${report.status}`,
    `- Mode: ${report.mode}`,
    `- Read-only: ${report.readOnly ? "yes" : "no"}`,
    `- Producer policy: ${report.producerPolicy}`,
    `- Producers: ${report.summary.producerCount}`,
    `- Stale producers: ${report.summary.staleProducerCount}`,
    `- Selected: ${report.summary.selectedCount}`,
    `- Planned: ${report.summary.planned}`,
    `- Executed: ${report.summary.executed}`,
    `- Skipped: ${report.summary.skipped}`,
    `- Failed: ${report.summary.failed}`,
    "",
    "## Results",
    ""
  ];
  if (!report.results.length) lines.push("- No producers selected.");
  for (const result of report.results) {
    lines.push(`- ${result.producer}: ${result.outcome} (${result.commandSafetyClass})`);
    lines.push(`  - Command: \`${result.refreshCommand || "not listed"}\``);
    lines.push(`  - Output path: ${result.outputPath || "not listed"}`);
    if (result.skipReason) lines.push(`  - Skip reason: ${result.skipReason}`);
    if (result.execution) {
      lines.push(`  - Exit code: ${result.execution.exitCode ?? "unknown"}`);
      if (result.execution.timedOut) lines.push("  - Timed out: yes");
      if (result.execution.stderr) lines.push(`  - Stderr snippet: ${result.execution.stderr.replace(/\n/g, " ").slice(0, 500)}`);
    }
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  for (const note of report.safety) lines.push(`- ${note}`);
  lines.push(`- Rollback: ${report.rollback}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function writeArtifacts(report, outputDir) {
  mkdirSync(outputDir, { recursive: true });
  const jsonPath = resolve(outputDir, "latest.json");
  const markdownPath = resolve(outputDir, "latest.md");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  return { json: repoRelative(jsonPath), markdown: repoRelative(markdownPath) };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = buildReport(options);
    if (options.write) report.paths = writeArtifacts(report, options.outputDir);
    process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report));
    if (report.summary.failed) process.exit(1);
  } catch (error) {
    process.stderr.write(`producer_refresh_runner: ${error.message}\n`);
    process.exit(1);
  }
}

main();
