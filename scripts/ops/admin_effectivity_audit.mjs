#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "effectivity");
const DEFAULT_LEDGER = resolve(DEFAULT_OUTPUT_DIR, "slice-ledger.jsonl");

function usage() {
  return `Studio Brain administrator effectivity audit

Usage:
  node scripts/ops/admin_effectivity_audit.mjs [--json] [--write] [--last 5]

Options:
  --json              Print JSON to stdout.
  --write             Write timestamped JSON and Markdown artifacts.
  --output-dir <path> Artifact directory. Default: output/ops/effectivity.
  --ledger <path>     Slice ledger path. Default: output/ops/effectivity/slice-ledger.jsonl.
  --last <number>     Slice window. Default: 5.
  --slice-run-id <id> Filter slice ledger rows by run id before selecting the window.
  --run-id <id>       Stable run id. Default: admin-effectivity timestamp.
`;
}

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function repoRelative(path) {
  return relative(REPO_ROOT, path).replace(/\\/g, "/");
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
        throw new Error(`Invalid ledger JSONL at ${path}:${index + 1}: ${error.message}`);
      }
    });
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
    outputDir: DEFAULT_OUTPUT_DIR,
    ledger: DEFAULT_LEDGER,
    last: 5,
    sliceRunId: "",
    runId: ""
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
    const mappings = [
      ["--output-dir", "outputDir"],
      ["--ledger", "ledger"],
      ["--last", "last"],
      ["--slice-run-id", "sliceRunId"],
      ["--run-id", "runId"]
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
    throw new Error(`Unknown argument: ${arg}`);
  }
  options.outputDir = resolve(REPO_ROOT, options.outputDir);
  options.ledger = resolve(REPO_ROOT, options.ledger);
  options.last = Math.max(1, Number(options.last) || 5);
  return options;
}

function runJson(command, args) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
    env: { ...process.env }
  });
  const output = clean(result.stdout);
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      error: result.error?.message || clean(result.stderr) || `exit ${result.status}`,
      json: null
    };
  }
  try {
    return { ok: true, error: "", json: JSON.parse(output) };
  } catch (error) {
    return { ok: false, error: `invalid JSON: ${error.message}`, json: null };
  }
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

function summarizeSlices(rows) {
  const commandCount = rows.reduce((sum, row) => sum + (Array.isArray(row.commands) ? row.commands.length : 0), 0);
  const commandFailures = rows.reduce((sum, row) => sum + (Array.isArray(row.commands) ? row.commands.filter((command) => command.status === "fail").length : 0), 0);
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const clearBlocked = blockedRows.filter((row) => row.blocker?.class && row.blocker?.safeNextStep).length;
  const noop = rows.filter((row) => row.status === "noop" || row.noOp?.detected).length;
  const usefulness = rows.length
    ? rows.reduce((sum, row) => sum + (Number(row.usefulness?.score) || 0), 0) / rows.length
    : 0;
  return {
    count: rows.length,
    completed: rows.filter((row) => row.status === "completed").length,
    blocked: blockedRows.length,
    failed: rows.filter((row) => row.status === "failed").length,
    noop,
    commandCount,
    commandFailures,
    clearBlocked,
    usefulness: Number(usefulness.toFixed(3)),
    noOpRate: rows.length ? Number((noop / rows.length).toFixed(3)) : 0,
    verification: commandCount ? Number(((commandCount - commandFailures) / commandCount).toFixed(3)) : 0,
    blockedLaneClarity: blockedRows.length ? Number((clearBlocked / blockedRows.length).toFixed(3)) : 1
  };
}

function rowTimestamp(row) {
  return Date.parse(clean(row.completedAt) || clean(row.startedAt)) || 0;
}

function selectLedgerRows(rows, last, runId = "") {
  const filtered = clean(runId) ? rows.filter((row) => clean(row.runId) === clean(runId)) : rows;
  return filtered
    .map((row, index) => ({ row, index }))
    .sort((left, right) => rowTimestamp(left.row) - rowTimestamp(right.row) || left.index - right.index)
    .slice(-last)
    .map((entry) => entry.row);
}

function tryEffectivityReport() {
  if (!commandExists("bash")) {
    return { ok: false, status: "skipped", reason: "bash unavailable", report: null };
  }
  const result = runJson("bash", ["scripts/ops/effectivity_report.sh", "--json", "--no-write"]);
  if (!result.ok) return { ok: false, status: "unavailable", reason: result.error, report: null };
  return { ok: true, status: result.json?.status || "ok", reason: "", report: summarizeEffectivityReport(result.json) };
}

function summarizeEffectivityReport(report) {
  const sources = {};
  for (const [key, value] of Object.entries(report?.sources || {})) {
    sources[key] = {
      exists: value?.exists === true,
      status: clean(value?.status),
      generatedAt: clean(value?.generatedAt),
      ageMinutes: typeof value?.ageMinutes === "number" ? value.ageMinutes : null,
      stale: value?.stale === true
    };
  }
  const sections = {};
  for (const [key, value] of Object.entries(report?.sections || {})) {
    sections[key] = {
      status: clean(value?.status),
      score: typeof value?.score === "number" ? value.score : null
    };
  }
  return {
    schema: clean(report?.schema),
    generatedAt: clean(report?.generatedAt),
    runId: clean(report?.runId),
    status: clean(report?.status),
    readOnly: report?.readOnly === true,
    redaction: clean(report?.redaction),
    sources,
    sections,
    paths: {
      json: report?.paths?.json ? repoRelative(resolve(REPO_ROOT, report.paths.json)) : "",
      markdown: report?.paths?.markdown ? repoRelative(resolve(REPO_ROOT, report.paths.markdown)) : ""
    }
  };
}

function buildAudit(options) {
  const generatedAt = nowIso();
  const runId = clean(options.runId) || `admin-effectivity-${generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const ledgerRows = readJsonl(options.ledger);
  const selectedRows = selectLedgerRows(ledgerRows, options.last, options.sliceRunId);
  const sliceSummary = summarizeSlices(selectedRows);
  const toolInventory = runJson(process.execPath, ["scripts/ops/installed_tool_inventory.mjs", "--json"]);
  const effectivityReport = tryEffectivityReport();
  const toolFreshness = toolInventory.ok ? 1 : 0;
  const missingRequired = Number(toolInventory.json?.summary?.missingRequired) || 0;
  const usefulness = sliceSummary.count > 0 ? sliceSummary.usefulness : 0;
  const scores = {
    usefulness,
    verification: sliceSummary.verification,
    noOpRate: sliceSummary.noOpRate,
    blockedLaneClarity: sliceSummary.blockedLaneClarity,
    toolInventoryFreshness: toolFreshness
  };
  const status = missingRequired > 0 || sliceSummary.failed > 0
    ? "fail"
    : sliceSummary.count === 0 || sliceSummary.noOpRate > 0.4 || !effectivityReport.ok
      ? "warn"
      : "pass";
  return {
    schema: "studiobrain-admin-effectivity-audit.v1",
    generatedAt,
    runId,
    status,
    sliceWindow: {
      from: selectedRows[0]?.sliceId ?? null,
      to: selectedRows[selectedRows.length - 1]?.sliceId ?? null,
      count: selectedRows.length
    },
    scores,
    sections: {
      sliceLedger: {
        ledgerPath: repoRelative(options.ledger),
        filter: {
          runId: clean(options.sliceRunId)
        },
        summary: sliceSummary,
        rows: selectedRows
      },
      installedTools: toolInventory.ok ? toolInventory.json : { status: "unavailable", error: toolInventory.error },
      effectivityReport
    },
    missionControl: {
      externalId: `admin-effectivity:${runId}:${selectedRows[selectedRows.length - 1]?.sliceId ?? "no-slices"}`,
      taskTitle: `Admin effectivity audit ${selectedRows[0]?.sliceId ?? "no-slices"} to ${selectedRows[selectedRows.length - 1]?.sliceId ?? "no-slices"}`,
      events: [
        {
          type: "admin.audit.completed",
          generatedAt,
          status,
          sliceCount: selectedRows.length,
          usefulness: scores.usefulness,
          noOpRate: scores.noOpRate
        }
      ]
    }
  };
}

function markdown(audit) {
  const lines = [
    "# Studio Brain Administrator Effectivity Audit",
    "",
    `Generated: ${audit.generatedAt}`,
    `Status: ${audit.status}`,
    `Run ID: ${audit.runId}`,
    "",
    "## Slice Window",
    "",
    `- From: ${audit.sliceWindow.from ?? "none"}`,
    `- To: ${audit.sliceWindow.to ?? "none"}`,
    `- Count: ${audit.sliceWindow.count}`,
    "",
    "## Scores",
    "",
    `- Usefulness: ${audit.scores.usefulness}`,
    `- Verification: ${audit.scores.verification}`,
    `- No-op rate: ${audit.scores.noOpRate}`,
    `- Blocked-lane clarity: ${audit.scores.blockedLaneClarity}`,
    `- Tool inventory freshness: ${audit.scores.toolInventoryFreshness}`,
    "",
    "## Installed Tools",
    "",
    `- Status: ${audit.sections.installedTools.status}`,
    `- Installed: ${audit.sections.installedTools.summary?.installed ?? "unknown"}`,
    `- Missing required: ${audit.sections.installedTools.summary?.missingRequired ?? "unknown"}`,
    `- Missing optional: ${audit.sections.installedTools.summary?.missingOptional ?? "unknown"}`,
    `- Shadowed: ${audit.sections.installedTools.summary?.shadowed ?? "unknown"}`,
    "",
    "## Slice Rows",
    ""
  ];
  for (const row of audit.sections.sliceLedger.rows) {
    lines.push(`- ${row.sliceId}: ${row.status} - ${row.title}`);
  }
  if (audit.sections.sliceLedger.rows.length === 0) lines.push("- No slice rows recorded yet.");
  lines.push("", "## Mission Control Import", "", `- External ID: ${audit.missionControl.externalId}`, `- Task title: ${audit.missionControl.taskTitle}`, "");
  return `${lines.join("\n")}\n`;
}

function writeArtifacts(options, audit) {
  mkdirSync(options.outputDir, { recursive: true });
  const base = audit.runId;
  const jsonPath = resolve(options.outputDir, `${base}.json`);
  const markdownPath = resolve(options.outputDir, `${base}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, markdown(audit), "utf8");
  writeFileSync(resolve(options.outputDir, "admin-effectivity-audit-latest.json"), `${JSON.stringify({ ...audit, artifactPath: repoRelative(jsonPath), markdownPath: repoRelative(markdownPath) }, null, 2)}\n`, "utf8");
  return { jsonPath, markdownPath };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const audit = buildAudit(options);
  const artifacts = options.write ? writeArtifacts(options, audit) : null;
  if (options.json || !options.write) {
    process.stdout.write(`${JSON.stringify(artifacts ? { ...audit, artifacts } : audit, null, 2)}\n`);
  } else {
    process.stdout.write(`admin effectivity audit: ${audit.status}, slices=${audit.sliceWindow.count}, usefulness=${audit.scores.usefulness}\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
