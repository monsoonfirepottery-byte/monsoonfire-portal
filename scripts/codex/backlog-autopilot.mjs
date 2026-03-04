#!/usr/bin/env node

/* eslint-disable no-console */

import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..", "..");

const epicHubRunnerPath = resolve(repoRoot, "scripts", "epic-hub-runner.mjs");
const codexDir = resolve(repoRoot, ".codex");
const toolcallPath = resolve(codexDir, "toolcalls.ndjson");
const ticketsDir = resolve(repoRoot, "tickets");
const defaultOutputDir = resolve(repoRoot, "output", "qa");
const defaultReportJsonPath = resolve(defaultOutputDir, "codex-backlog-autopilot.json");
const defaultReportMarkdownPath = resolve(defaultOutputDir, "codex-backlog-autopilot.md");

const rollingIssueTitle = "Codex Backlog Autopilot (Rolling)";
const defaultLendingLibraryExclusionRegex =
  "(lending[ -]?library|tickets/p1-epic-16|tickets/p1-library-|tickets/p2-library-|tickets/p1-lending-library-|tickets/p2-lending-library-)";

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  node ./scripts/codex/backlog-autopilot.mjs [options]",
      "",
      "Options:",
      "  --apply                       Create/update GitHub issues (requires gh auth)",
      "  --dry-run                     Analyze only (default)",
      "  --json                        Print JSON output",
      "  --write                       Write markdown/json artifacts",
      "  --strict                      Fail when no queue items remain after filtering",
      "  --no-github                   Disable GitHub operations",
      "  --epic <selection>            Epic filter for epic-hub-runner (default: 1-20)",
      "  --owner <value>               Optional owner filter passed to epic-hub-runner",
      "  --limit <n>                   Max dispatch tasks from epic-hub-runner (default: 48)",
      "  --max-issues <n>              Max issue creates per run (default: 8)",
      "  --exclude-regex <regex>       Regex used to filter queue items",
      "  --include-lending-library     Disable lending-library exclusion default",
      "  --report-json <path>          JSON artifact path",
      "  --report-markdown <path>      Markdown artifact path",
      "  --run-id <id>                 Explicit run id for traceability",
      "  --help                        Show help",
      "",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const options = {
    apply: false,
    dryRun: true,
    asJson: false,
    writeArtifacts: false,
    strict: false,
    includeGithub: true,
    epicSelection: "1-20",
    ownerFilter: "",
    limit: 48,
    maxIssueCreates: 8,
    excludeRegexRaw: defaultLendingLibraryExclusionRegex,
    includeLendingLibrary: false,
    reportJsonPath: defaultReportJsonPath,
    reportMarkdownPath: defaultReportMarkdownPath,
    runId: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

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
    if (arg === "--write") {
      options.writeArtifacts = true;
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--no-github") {
      options.includeGithub = false;
      continue;
    }
    if (arg === "--include-lending-library") {
      options.includeLendingLibrary = true;
      continue;
    }

    const next = argv[index + 1];
    if (!arg.startsWith("--")) continue;
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--epic") {
      options.epicSelection = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--owner") {
      options.ownerFilter = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 1) {
        throw new Error(`Invalid --limit value: ${next}`);
      }
      options.limit = Math.floor(value);
      index += 1;
      continue;
    }
    if (arg === "--max-issues") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid --max-issues value: ${next}`);
      }
      options.maxIssueCreates = Math.floor(value);
      index += 1;
      continue;
    }
    if (arg === "--exclude-regex") {
      options.excludeRegexRaw = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--report-json") {
      options.reportJsonPath = resolve(process.cwd(), String(next));
      index += 1;
      continue;
    }
    if (arg === "--report-markdown") {
      options.reportMarkdownPath = resolve(process.cwd(), String(next));
      index += 1;
      continue;
    }
    if (arg === "--run-id") {
      options.runId = String(next).trim();
      index += 1;
      continue;
    }
  }

  if (options.includeLendingLibrary && options.excludeRegexRaw === defaultLendingLibraryExclusionRegex) {
    options.excludeRegexRaw = "";
  }

  return options;
}

function runCommand(command, args, { allowFailure = false, cwd = repoRoot, env = process.env } = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
  });
  const durationMs = Date.now() - startedAt;
  const code = typeof result.status === "number" ? result.status : 1;
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");

  if (code !== 0 && !allowFailure) {
    throw new Error(`Command failed (${code}): ${command} ${args.join(" ")}\n${stderr || stdout}`);
  }

  return { code, ok: code === 0, stdout, stderr, durationMs };
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

function compileExcludeRegex(raw) {
  if (!raw || !String(raw).trim()) return null;
  try {
    return new RegExp(raw, "i");
  } catch (error) {
    throw new Error(`Invalid --exclude-regex: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeRunId(raw) {
  if (raw) return raw;
  return `backlog-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
}

function matchLine(content, regex, fallback = "") {
  const match = String(content || "").match(regex);
  return match && match[1] ? String(match[1]).trim() : fallback;
}

function normalizeTicketStatus(raw = "Unknown") {
  const value = String(raw || "").toLowerCase();
  if (value.includes("complete") || value.includes("done")) {
    return "done";
  }
  if (value.includes("blocked") || value.includes("hold")) {
    return "blocked";
  }
  return "open";
}

function parsePriorityValue(value = "P3") {
  const match = String(value || "P3").match(/P(\d)/i);
  if (!match) return 99;
  return Number.parseInt(match[1], 10);
}

function extractSectionLines(content, headingRegex, maxItems = 8) {
  const lines = String(content || "").split(/\r?\n/);
  const start = lines.findIndex((line) => headingRegex.test(line));
  if (start < 0) return [];

  const output = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##\s+/.test(line)) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^-\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const cleaned = trimmed.replace(/^[-\d\.\s]+/, "").trim();
      if (cleaned) {
        output.push(cleaned);
        if (output.length >= maxItems) break;
      }
    }
  }
  return output;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function toOwnerCounts(tasks) {
  const counts = {};
  for (const task of tasks) {
    const owner = String(task.owner || "unassigned").trim() || "unassigned";
    counts[owner] = (counts[owner] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([owner, count]) => ({ owner, count }))
    .sort((left, right) => right.count - left.count);
}

function buildIssueBody(task, runId, marker, ticketRefUrl) {
  const lines = [];
  lines.push(`<!-- ${marker} -->`);
  lines.push(`Run: ${runId}`);
  lines.push(`Ticket: ${task.ticketRef}`);
  lines.push("");
  lines.push("## Why This Was Auto-Queued");
  lines.push("- Backlog autopilot selected this ticket based on epic/ticket priority.");
  lines.push("- Goal: reduce operator prompt overhead and keep queue moving.");
  lines.push("");
  lines.push("## Task Context");
  lines.push(`- Epic: ${task.epicTitle} (${task.epic})`);
  lines.push(`- Priority: ${task.epicPriority} / ${task.ticketPriority}`);
  lines.push(`- Owner hint: ${task.owner || "unassigned"}`);
  lines.push(`- Ticket source: ${ticketRefUrl}`);
  lines.push("");

  const acceptance = ensureArray(task.acceptanceCriteria).slice(0, 6);
  lines.push("## Acceptance Criteria");
  if (acceptance.length === 0) {
    lines.push("- Use ticket definition-of-done in source file.");
  } else {
    acceptance.forEach((entry) => lines.push(`- ${entry}`));
  }
  lines.push("");

  lines.push("## Execution Notes");
  lines.push("- Keep changes small and verifiable.");
  lines.push("- No direct push to main.");
  lines.push("- Link implementation evidence in this issue when complete.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function buildRollingComment({
  generatedAtIso,
  runId,
  queueTotal,
  includedCount,
  excludedCount,
  ownerCounts,
  createdIssueUrls,
  linkedIssueUrls,
  topTasks,
  notes,
}) {
  const lines = [];
  lines.push(`## ${generatedAtIso} (run ${runId})`);
  lines.push("");
  lines.push("### Queue Summary");
  lines.push(`- Dispatch tasks discovered: ${queueTotal}`);
  lines.push(`- Included after filters: ${includedCount}`);
  lines.push(`- Excluded by policy: ${excludedCount}`);
  lines.push("");

  lines.push("### Owner Buckets");
  if (ownerCounts.length === 0) {
    lines.push("- No owner buckets.");
  } else {
    ownerCounts.slice(0, 10).forEach((bucket) => {
      lines.push(`- ${bucket.owner}: ${bucket.count}`);
    });
  }
  lines.push("");

  lines.push("### Top Dispatch Candidates");
  if (topTasks.length === 0) {
    lines.push("- None");
  } else {
    topTasks.slice(0, 12).forEach((task) => {
      lines.push(`- ${task.ticketRef} | ${task.ticketTitle} | ${task.epicPriority}/${task.ticketPriority}`);
    });
  }
  lines.push("");

  lines.push("### Issue Actions");
  lines.push(`- Created this run: ${createdIssueUrls.length}`);
  lines.push(`- Linked existing: ${linkedIssueUrls.length}`);
  [...createdIssueUrls, ...linkedIssueUrls].slice(0, 12).forEach((url) => lines.push(`- ${url}`));
  lines.push("");

  if (notes.length > 0) {
    lines.push("### Notes");
    notes.forEach((note) => lines.push(`- ${note}`));
    lines.push("");
  }

  return lines.join("\n");
}

function buildMarkdownReport(report) {
  const lines = [];
  lines.push("# Codex Backlog Autopilot");
  lines.push("");
  lines.push(`- Generated at: ${report.generatedAtIso}`);
  lines.push(`- Status: ${report.status}`);
  lines.push(`- Run ID: ${report.runId}`);
  lines.push(`- Epic selection: ${report.settings.epicSelection}`);
  lines.push(`- Exclusion regex: ${report.settings.excludeRegex || "(none)"}`);
  lines.push("");

  lines.push("## Queue Summary");
  lines.push(`- Tasks discovered: ${report.queueSummary.discovered}`);
  lines.push(`- Included: ${report.queueSummary.included}`);
  lines.push(`- Excluded: ${report.queueSummary.excluded}`);
  lines.push("");

  lines.push("## Owner Buckets");
  if (report.queueSummary.ownerBuckets.length === 0) {
    lines.push("- None");
  } else {
    report.queueSummary.ownerBuckets.forEach((bucket) => lines.push(`- ${bucket.owner}: ${bucket.count}`));
  }
  lines.push("");

  lines.push("## Top Candidates");
  if (report.topCandidates.length === 0) {
    lines.push("- None");
  } else {
    report.topCandidates.forEach((task) => {
      lines.push(`- ${task.ticketRef} | ${task.ticketTitle}`);
      lines.push(`  - Epic: ${task.epicTitle}`);
      lines.push(`  - Priority: ${task.epicPriority}/${task.ticketPriority}`);
      lines.push(`  - Owner: ${task.owner || "unassigned"}`);
    });
  }
  lines.push("");

  lines.push("## Issue Actions");
  lines.push(`- Created: ${report.issueActions.created.length}`);
  lines.push(`- Linked existing: ${report.issueActions.linked.length}`);
  [...report.issueActions.created, ...report.issueActions.linked].forEach((url) => lines.push(`- ${url}`));
  lines.push("");

  if (report.notes.length > 0) {
    lines.push("## Notes");
    report.notes.forEach((note) => lines.push(`- ${note}`));
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function appendToolcall({
  actor,
  tool,
  action,
  ok,
  durationMs,
  errorType = null,
  errorMessage = null,
  context = null,
}) {
  await mkdir(codexDir, { recursive: true });
  const payload = {
    tsIso: new Date().toISOString(),
    actor,
    tool,
    action,
    ok,
    durationMs: durationMs == null ? null : Math.round(durationMs),
    errorType,
    errorMessage,
    context,
  };
  await appendFile(toolcallPath, `${JSON.stringify(payload)}\n`, "utf8");
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

async function collectStandaloneBacklogTasks(limit = 48) {
  let entries = [];
  try {
    entries = await readdir(ticketsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
  const docs = [];
  for (const file of files) {
    const absolutePath = resolve(ticketsDir, file.name);
    let content = "";
    try {
      content = await readFile(absolutePath, "utf8");
    } catch {
      continue;
    }

    const type = matchLine(content, /^Type:\s*(.+)$/m, "Ticket");
    if (String(type).toLowerCase().includes("epic")) {
      continue;
    }

    const status = matchLine(content, /^Status:\s*(.+)$/m, "Unknown");
    const statusNormalized = normalizeTicketStatus(status);
    if (statusNormalized === "done") {
      continue;
    }

    const priority = matchLine(content, /^Priority:\s*(.+)$/m, "P3");
    const owner = matchLine(content, /^Owner:\s*(.+)$/m, "unassigned");
    const title = matchLine(content, /^#\s*(.+)$/m, file.name.replace(/\.md$/i, ""));
    const parentEpic = matchLine(content, /^Parent Epic:\s*(.+)$/m, "standalone-backlog");
    const ticketRef = `tickets/${file.name}`;

    docs.push({
      dispatchId: `standalone-${ticketRef.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
      ticketRef,
      ticketTitle: title,
      ticketStatus: status,
      ticketStatusNormalized: statusNormalized,
      ticketPriority: priority,
      owner,
      epic: parentEpic || "standalone-backlog",
      epicTitle: parentEpic || "Standalone Backlog",
      epicPriority: priority,
      acceptanceCriteria: extractSectionLines(content, /^##\s*Acceptance Criteria/i, 8),
      definitionOfDone: extractSectionLines(content, /^##\s*Definition of Done/i, 8),
      taskOutline: extractSectionLines(content, /^##\s*Tasks/i, 12),
      runHints: [
        `Run task ordering: ${priority}`,
        "Update ticket status + evidence links after implementation.",
      ],
    });
  }

  const sorted = docs.sort((left, right) => {
    const priorityOrder = parsePriorityValue(left.ticketPriority) - parsePriorityValue(right.ticketPriority);
    if (priorityOrder !== 0) return priorityOrder;
    return left.ticketRef.localeCompare(right.ticketRef);
  });

  return sorted.slice(0, Math.max(1, limit));
}

async function main() {
  const runStartedAt = Date.now();
  const options = parseArgs(process.argv.slice(2));
  const generatedAtIso = new Date().toISOString();
  const runId = normalizeRunId(options.runId);
  const notes = [];

  const excludeRegex = compileExcludeRegex(options.excludeRegexRaw);
  const runnerArgs = [
    epicHubRunnerPath,
    "--mode",
    "agentic",
    "--epic",
    options.epicSelection,
    "--limit",
    String(options.limit),
    "--json",
  ];
  if (options.ownerFilter) {
    runnerArgs.push("--owner", options.ownerFilter);
  }

  const runner = runCommand(process.execPath, runnerArgs, { allowFailure: true });
  if (!runner.ok) {
    throw new Error(`epic-hub-runner failed: ${runner.stderr || runner.stdout}`);
  }

  let runnerPayload = {};
  try {
    runnerPayload = runner.stdout.trim() ? JSON.parse(runner.stdout) : {};
  } catch (error) {
    throw new Error(
      `Could not parse epic-hub-runner JSON output: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const epicHubTasks = ensureArray(runnerPayload.tasks);
  const fallbackTasks = await collectStandaloneBacklogTasks(options.limit);
  const mergedByRef = new Map();
  for (const task of epicHubTasks) {
    if (!task?.ticketRef) continue;
    mergedByRef.set(task.ticketRef, task);
  }
  for (const task of fallbackTasks) {
    if (!task?.ticketRef) continue;
    if (!mergedByRef.has(task.ticketRef)) {
      mergedByRef.set(task.ticketRef, task);
    }
  }
  const discoveredTasks = Array.from(mergedByRef.values()).sort((left, right) => {
    const epicPriority = parsePriorityValue(left.epicPriority) - parsePriorityValue(right.epicPriority);
    if (epicPriority !== 0) return epicPriority;
    const ticketPriority = parsePriorityValue(left.ticketPriority) - parsePriorityValue(right.ticketPriority);
    if (ticketPriority !== 0) return ticketPriority;
    return String(left.ticketRef || "").localeCompare(String(right.ticketRef || ""));
  });
  if (fallbackTasks.length > 0) {
    notes.push(`Added ${fallbackTasks.length} standalone backlog task(s) outside epic-hub manifest.`);
  }
  const excludedTasks = [];
  const includedTasks = [];

  for (const task of discoveredTasks) {
    const sample = `${task.ticketRef || ""} ${task.ticketTitle || ""} ${task.epic || ""} ${task.epicTitle || ""}`;
    if (excludeRegex && excludeRegex.test(sample)) {
      excludedTasks.push(task);
      continue;
    }
    includedTasks.push(task);
  }

  if (options.strict && includedTasks.length === 0) {
    throw new Error("Strict mode failed: no queue items left after filtering.");
  }

  const repoSlug = parseRepoSlug();
  const githubAvailable =
    options.includeGithub &&
    Boolean(repoSlug) &&
    runGh(["auth", "status"], { allowFailure: true }).ok;

  if (!repoSlug && options.includeGithub) {
    notes.push("Repository slug could not be resolved; GitHub actions disabled.");
  }
  if (!githubAvailable && options.includeGithub) {
    notes.push("GitHub CLI unavailable/auth missing; GitHub issue automation skipped.");
  }
  if (excludedTasks.length > 0) {
    notes.push(`${excludedTasks.length} tasks excluded by policy regex.`);
  }

  const ownerBuckets = toOwnerCounts(includedTasks);
  const topCandidates = includedTasks.slice(0, Math.max(0, options.maxIssueCreates));

  const issueActions = {
    created: [],
    linked: [],
  };
  let rollingIssueUrl = "";

  if (options.apply && githubAvailable) {
    await ensureGhLabel(repoSlug, "automation", "1d76db", "Automation-generated work", true);
    await ensureGhLabel(repoSlug, "backlog", "5319e7", "Backlog dispatch and hygiene work", true);
    await ensureGhLabel(repoSlug, "codex-autopilot", "0e8a16", "Codex autonomous backlog loop", true);

    for (const task of topCandidates) {
      const marker = `codex-backlog:${task.ticketRef}`;
      const existingResp = runGhJson([
        "issue",
        "list",
        "--repo",
        repoSlug,
        "--state",
        "open",
        "--search",
        `"${marker}" in:body`,
        "--limit",
        "1",
        "--json",
        "number,url,title",
      ]);

      if (existingResp.ok && Array.isArray(existingResp.data) && existingResp.data.length > 0) {
        issueActions.linked.push(existingResp.data[0].url);
        continue;
      }

      const ticketRefUrl = `https://github.com/${repoSlug}/blob/main/${task.ticketRef}`;
      const issueBody = buildIssueBody(task, runId, marker, ticketRefUrl);
      const title = `[Codex Backlog] ${task.ticketRef} — ${task.ticketTitle}`;
      const created = runGh(
        [
          "issue",
          "create",
          "--repo",
          repoSlug,
          "--title",
          title,
          "--body",
          issueBody,
          "--label",
          "automation",
          "--label",
          "backlog",
          "--label",
          "codex-autopilot",
        ],
        { allowFailure: true }
      );
      if (created.ok) {
        const url = created.stdout.trim();
        if (url) issueActions.created.push(url);
      }
    }

    const rollingResp = runGhJson([
      "issue",
      "list",
      "--repo",
      repoSlug,
      "--state",
      "open",
      "--search",
      `"${rollingIssueTitle}" in:title`,
      "--limit",
      "5",
      "--json",
      "number,title,url",
    ]);

    let rollingIssueNumber = null;
    if (rollingResp.ok && Array.isArray(rollingResp.data)) {
      const exact = rollingResp.data.find((issue) => issue.title === rollingIssueTitle);
      if (exact) {
        rollingIssueNumber = exact.number;
        rollingIssueUrl = exact.url;
      }
    }

    if (!rollingIssueNumber) {
      const createRolling = runGh(
        [
          "issue",
          "create",
          "--repo",
          repoSlug,
          "--title",
          rollingIssueTitle,
          "--body",
          "Rolling summary for Codex autonomous backlog dispatch.",
          "--label",
          "automation",
          "--label",
          "backlog",
          "--label",
          "codex-autopilot",
        ],
        { allowFailure: true }
      );
      if (createRolling.ok) {
        rollingIssueUrl = createRolling.stdout.trim();
        const match = rollingIssueUrl.match(/\/issues\/(\d+)$/);
        rollingIssueNumber = match ? Number(match[1]) : null;
      }
    }

    if (rollingIssueNumber) {
      const comment = buildRollingComment({
        generatedAtIso,
        runId,
        queueTotal: discoveredTasks.length,
        includedCount: includedTasks.length,
        excludedCount: excludedTasks.length,
        ownerCounts: ownerBuckets,
        createdIssueUrls: issueActions.created,
        linkedIssueUrls: issueActions.linked,
        topTasks: topCandidates,
        notes,
      });

      runGh(
        [
          "issue",
          "comment",
          String(rollingIssueNumber),
          "--repo",
          repoSlug,
          "--body",
          comment,
        ],
        { allowFailure: true }
      );
    }
  }

  const output = {
    status: options.apply ? "applied" : "dry-run",
    generatedAtIso,
    runId,
    settings: {
      epicSelection: options.epicSelection,
      ownerFilter: options.ownerFilter || null,
      limit: options.limit,
      maxIssueCreates: options.maxIssueCreates,
      excludeRegex: excludeRegex ? excludeRegex.source : null,
      includeLendingLibrary: options.includeLendingLibrary,
    },
    queueSummary: {
      discovered: discoveredTasks.length,
      included: includedTasks.length,
      excluded: excludedTasks.length,
      ownerBuckets,
    },
    topCandidates: topCandidates.map((task) => ({
      dispatchId: task.dispatchId,
      ticketRef: task.ticketRef,
      ticketTitle: task.ticketTitle,
      epic: task.epic,
      epicTitle: task.epicTitle,
      epicPriority: task.epicPriority,
      ticketPriority: task.ticketPriority,
      owner: task.owner || "unassigned",
    })),
    issueActions,
    rollingIssueUrl: rollingIssueUrl || null,
    notes,
    artifacts: {
      reportJsonPath: relative(repoRoot, options.reportJsonPath),
      reportMarkdownPath: relative(repoRoot, options.reportMarkdownPath),
      toolcallPath: relative(repoRoot, toolcallPath),
    },
  };

  const markdown = buildMarkdownReport(output);

  if (options.writeArtifacts) {
    await mkdir(dirname(options.reportJsonPath), { recursive: true });
    await mkdir(dirname(options.reportMarkdownPath), { recursive: true });
    await writeFile(options.reportJsonPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    await writeFile(options.reportMarkdownPath, markdown, "utf8");
  }

  await appendToolcall({
    actor: process.env.GITHUB_ACTIONS === "true" ? "github-action" : "codex",
    tool: "backlog-autopilot",
    action: "dispatch",
    ok: true,
    durationMs: Date.now() - runStartedAt,
    context: {
      runId,
      discovered: discoveredTasks.length,
      included: includedTasks.length,
      excluded: excludedTasks.length,
      issuesCreated: issueActions.created.length,
      issuesLinked: issueActions.linked.length,
      rollingIssueUrl: rollingIssueUrl || null,
      apply: options.apply,
      githubAvailable,
    },
  });

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    [
      `status: ${output.status}`,
      `runId: ${output.runId}`,
      `included: ${output.queueSummary.included}`,
      `issuesCreated: ${output.issueActions.created.length}`,
      `rollingIssue: ${output.rollingIssueUrl || "none"}`,
      "",
    ].join("\n")
  );
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await appendToolcall({
      actor: process.env.GITHUB_ACTIONS === "true" ? "github-action" : "codex",
      tool: "backlog-autopilot",
      action: "dispatch",
      ok: false,
      durationMs: null,
      errorType: "runtime_error",
      errorMessage: message,
      context: null,
    });
  } catch {
    // Ignore nested logging failures.
  }

  console.error(`backlog-autopilot failed: ${message}`);
  process.exit(1);
});
