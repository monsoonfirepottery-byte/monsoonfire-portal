#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_LEDGER = resolve(REPO_ROOT, "output", "ops", "effectivity", "slice-ledger.jsonl");
const DEFAULT_LATEST = resolve(REPO_ROOT, "output", "ops", "effectivity", "slice-ledger-latest.json");
const STATUSES = new Set(["completed", "blocked", "noop", "failed"]);
const COMMAND_STATUSES = new Set(["pass", "warn", "fail", "skipped"]);
const BLOCKER_CLASSES = new Set([
  "",
  "approval_required",
  "missing_auth",
  "sudo_unavailable",
  "dirty_worktree",
  "merge_conflict",
  "cross_repo_boundary",
  "missing_tool",
  "live_endpoint_down",
  "test_failure",
  "data_safety_gate",
  "external_service",
  "unclear_owner"
]);

function usage() {
  return `Studio Brain administrator slice ledger

Usage:
  node scripts/ops/slice_ledger.mjs --append --slice-id <id> --run-id <id> --lane <lane> --title <title> [options]
  node scripts/ops/slice_ledger.mjs --summary [--last 5] [--json]

Options:
  --ledger <path>             Ledger JSONL path. Default: output/ops/effectivity/slice-ledger.jsonl.
  --latest <path>             Latest summary JSON path.
  --audit-interval <n>        Countable slices between audits. Default: 5.
  --append                    Append one row.
  --summary                   Summarize the last rows. Default when --append is absent.
  --dry-run                   Print the row or summary without writing.
  --json                      Print JSON instead of text.
  --slice-id <id>             Stable slice id.
  --run-id <id>               Run id for grouping slices; filters summaries when --append is absent.
  --lane <name>               Lane such as portal-ops, mission-control, host-readonly.
  --title <text>              Slice title.
  --intent <text>             Intended operational improvement.
  --status <value>            completed, blocked, noop, or failed. Default: completed.
  --started-at <iso>          Start time. Default: now.
  --completed-at <iso>        Completion time. Default: now.
  --changed-file <path>       Repeatable changed file.
  --artifact <path>           Repeatable artifact path.
  --command "status:command"  Repeatable command record, status in pass,warn,fail,skipped.
  --usefulness-score <0..1>   Utility score.
  --minutes-saved <number>    Estimated operator minutes saved.
  --operator-signal <text>    Human or observed usefulness signal.
  --noop-reason <text>        Mark intentional no-op reason.
  --blocker-class <class>     Fixed blocker class.
  --blocker-owner <owner>     Owner for blocker.
  --safe-next-step <text>     Safe next action.
`;
}

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function repoRelative(path) {
  const raw = clean(path);
  if (!raw) return "";
  return relative(REPO_ROOT, resolve(REPO_ROOT, raw)).replace(/\\/g, "/");
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at ${path}:${index + 1}: ${error.message}`);
      }
    });
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendJsonl(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
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
    append: false,
    summary: false,
    dryRun: false,
    json: false,
    ledger: DEFAULT_LEDGER,
    latest: DEFAULT_LATEST,
    last: 5,
    auditInterval: 5,
    sliceId: "",
    runId: "",
    lane: "",
    title: "",
    intent: "",
    status: "completed",
    startedAt: "",
    completedAt: "",
    changedFiles: [],
    artifacts: [],
    commands: [],
    usefulnessScore: 0,
    minutesSaved: 0,
    operatorSignal: "unknown",
    noopReason: "",
    blockerClass: "",
    blockerOwner: "",
    safeNextStep: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (arg === "--append") {
      options.append = true;
      continue;
    }
    if (arg === "--summary") {
      options.summary = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    const mappings = [
      ["--ledger", "ledger"],
      ["--latest", "latest"],
      ["--last", "last"],
      ["--audit-interval", "auditInterval"],
      ["--slice-id", "sliceId"],
      ["--run-id", "runId"],
      ["--lane", "lane"],
      ["--title", "title"],
      ["--intent", "intent"],
      ["--status", "status"],
      ["--started-at", "startedAt"],
      ["--completed-at", "completedAt"],
      ["--usefulness-score", "usefulnessScore"],
      ["--minutes-saved", "minutesSaved"],
      ["--operator-signal", "operatorSignal"],
      ["--noop-reason", "noopReason"],
      ["--blocker-class", "blockerClass"],
      ["--blocker-owner", "blockerOwner"],
      ["--safe-next-step", "safeNextStep"]
    ];
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
    const changed = readFlagValue(argv, index, "--changed-file");
    if (changed.matched) {
      options.changedFiles.push(changed.value);
      index = changed.nextIndex;
      continue;
    }
    const artifact = readFlagValue(argv, index, "--artifact");
    if (artifact.matched) {
      options.artifacts.push(artifact.value);
      index = artifact.nextIndex;
      continue;
    }
    const command = readFlagValue(argv, index, "--command");
    if (command.matched) {
      options.commands.push(command.value);
      index = command.nextIndex;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  options.ledger = resolve(REPO_ROOT, options.ledger);
  options.latest = resolve(REPO_ROOT, options.latest);
  options.last = Math.max(1, Number(options.last) || 5);
  options.auditInterval = Math.max(1, Number(options.auditInterval) || 5);
  options.usefulnessScore = Math.max(0, Math.min(1, Number(options.usefulnessScore) || 0));
  options.minutesSaved = Math.max(0, Number(options.minutesSaved) || 0);
  return options;
}

function commandRecord(value) {
  const raw = clean(value);
  const firstColon = raw.indexOf(":");
  const status = firstColon > 0 ? raw.slice(0, firstColon) : "skipped";
  const command = firstColon > 0 ? raw.slice(firstColon + 1) : raw;
  if (!COMMAND_STATUSES.has(status)) throw new Error(`Invalid command status: ${status}`);
  return { command: clean(command), status };
}

function buildRow(options) {
  if (!STATUSES.has(options.status)) throw new Error(`Invalid status: ${options.status}`);
  if (!BLOCKER_CLASSES.has(options.blockerClass)) throw new Error(`Invalid blocker class: ${options.blockerClass}`);
  for (const field of ["sliceId", "runId", "lane", "title"]) {
    if (!clean(options[field])) throw new Error(`--${field.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)} is required.`);
  }
  const changedFiles = options.changedFiles.map(repoRelative).filter(Boolean);
  const artifacts = options.artifacts.map((path) => ({ path: repoRelative(path) })).filter((item) => item.path);
  const noOpDetected = options.status === "noop" || (changedFiles.length === 0 && artifacts.length === 0 && options.commands.length === 0);
  return {
    schema: "studiobrain-admin-slice-ledger.v1",
    sliceId: clean(options.sliceId),
    runId: clean(options.runId),
    lane: clean(options.lane),
    title: clean(options.title),
    intent: clean(options.intent),
    startedAt: clean(options.startedAt) || nowIso(),
    completedAt: clean(options.completedAt) || nowIso(),
    status: options.status,
    changedFiles,
    commands: options.commands.map(commandRecord),
    artifacts,
    usefulness: {
      score: options.usefulnessScore,
      minutesSaved: options.minutesSaved,
      operatorSignal: clean(options.operatorSignal) || "unknown"
    },
    noOp: {
      detected: noOpDetected,
      reason: clean(options.noopReason) || (noOpDetected ? "no changed file, artifact, or command evidence recorded" : null)
    },
    blocker: {
      class: clean(options.blockerClass) || null,
      owner: clean(options.blockerOwner) || null,
      safeNextStep: clean(options.safeNextStep) || null
    }
  };
}

function rowTimestamp(row) {
  return Date.parse(clean(row.completedAt) || clean(row.startedAt)) || 0;
}

function sliceSequence(row) {
  const match = clean(row.sliceId).match(/-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function compareRows(left, right) {
  const leftSequence = sliceSequence(left.row);
  const rightSequence = sliceSequence(right.row);
  if (leftSequence !== null && rightSequence !== null && leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }
  return rowTimestamp(left.row) - rowTimestamp(right.row) || left.index - right.index;
}

function orderedRows(rows, runId = "") {
  const filtered = clean(runId) ? rows.filter((row) => clean(row.runId) === clean(runId)) : rows;
  return filtered
    .map((row, index) => ({ row, index }))
    .sort(compareRows)
    .map((entry) => entry.row);
}

function selectRecentRows(rows, last, runId = "") {
  return orderedRows(rows, runId).slice(-last);
}

function auditCadence(rows, interval = 5) {
  const countable = rows.filter((row) => row.status !== "noop" && !row.noOp?.detected);
  const total = countable.length;
  const remainder = total % interval;
  const slicesSinceLastAudit = total === 0 ? 0 : remainder === 0 ? interval : remainder;
  const auditDue = total > 0 && remainder === 0;
  return {
    interval,
    countedSlices: total,
    slicesSinceLastAudit,
    auditDue,
    nextAuditAt: auditDue ? total : total + (interval - slicesSinceLastAudit)
  };
}

function summarize(rows, last, runId = "", auditInterval = 5) {
  const ordered = orderedRows(rows, runId);
  const selected = ordered.slice(-last);
  const completed = selected.filter((row) => row.status === "completed").length;
  const blocked = selected.filter((row) => row.status === "blocked").length;
  const failed = selected.filter((row) => row.status === "failed").length;
  const noop = selected.filter((row) => row.status === "noop" || row.noOp?.detected).length;
  const commandCount = selected.reduce((sum, row) => sum + (Array.isArray(row.commands) ? row.commands.length : 0), 0);
  const commandFailures = selected.reduce((sum, row) => sum + (Array.isArray(row.commands) ? row.commands.filter((command) => command.status === "fail").length : 0), 0);
  const usefulness = selected.length
    ? selected.reduce((sum, row) => sum + (Number(row.usefulness?.score) || 0), 0) / selected.length
    : 0;
  return {
    schema: "studiobrain-admin-slice-ledger-summary.v1",
    generatedAt: nowIso(),
    ledgerPath: repoRelative(rows.ledgerPath || DEFAULT_LEDGER),
    filters: {
      runId: clean(runId)
    },
    window: {
      count: selected.length,
      from: selected[0]?.sliceId ?? null,
      to: selected[selected.length - 1]?.sliceId ?? null
    },
    auditCadence: auditCadence(ordered, auditInterval),
    counts: {
      completed,
      blocked,
      failed,
      noop,
      commandCount,
      commandFailures
    },
    scores: {
      usefulness: Number(usefulness.toFixed(3)),
      noOpRate: selected.length ? Number((noop / selected.length).toFixed(3)) : 0,
      verification: commandCount ? Number(((commandCount - commandFailures) / commandCount).toFixed(3)) : 0
    },
    rows: selected
  };
}

function printTextSummary(summary) {
  process.stdout.write(`slice ledger: ${summary.window.count} row(s), ${summary.counts.completed} completed, ${summary.counts.blocked} blocked, ${summary.counts.failed} failed\n`);
  process.stdout.write(`usefulness=${summary.scores.usefulness} noOpRate=${summary.scores.noOpRate} verification=${summary.scores.verification}\n`);
  process.stdout.write(`auditDue=${summary.auditCadence.auditDue} slicesSinceLastAudit=${summary.auditCadence.slicesSinceLastAudit} nextAuditAt=${summary.auditCadence.nextAuditAt}\n`);
  for (const row of summary.rows) {
    process.stdout.write(`- ${row.sliceId} [${row.status}] ${row.title}\n`);
  }
}

function run(rawArgs = process.argv.slice(2)) {
  const options = parseArgs(rawArgs);
  if (options.append) {
    const row = buildRow(options);
    if (!options.dryRun) appendJsonl(options.ledger, row);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(row, null, 2)}\n`);
    } else {
      process.stdout.write(`${options.dryRun ? "dry-run " : ""}recorded ${row.sliceId}: ${row.title}\n`);
    }
  } else {
    const rows = readJsonl(options.ledger);
    rows.ledgerPath = options.ledger;
    const summary = summarize(rows, options.last, options.runId, options.auditInterval);
    if (!options.dryRun) writeJson(options.latest, summary);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
      printTextSummary(summary);
    }
  }
}

export { auditCadence, buildRow, run, selectRecentRows, summarize };

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
