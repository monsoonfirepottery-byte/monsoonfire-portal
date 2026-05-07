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

function latestRowIso(rows) {
  const timestamp = rows.reduce((latest, row) => Math.max(latest, rowTimestamp(row)), 0);
  return timestamp > 0 ? new Date(timestamp).toISOString() : "";
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

function selectLedgerRows(rows, last, runId = "") {
  const filtered = clean(runId) ? rows.filter((row) => clean(row.runId) === clean(runId)) : rows;
  return filtered
    .map((row, index) => ({ row, index }))
    .sort(compareRows)
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

function sourceFreshness(generatedAt, options = {}) {
  const generated = Date.parse(clean(generatedAt));
  const now = Date.parse(clean(options.now) || nowIso());
  const minGeneratedAt = clean(options.minGeneratedAt);
  const minGenerated = minGeneratedAt ? Date.parse(minGeneratedAt) : 0;
  const maxAgeHours = Number(options.maxAgeHours ?? 24);
  if (!clean(generatedAt)) return { status: "missing", score: 0, generatedAt: "", ageHours: null, minGeneratedAt, maxAgeHours };
  if (Number.isNaN(generated) || Number.isNaN(now) || (minGeneratedAt && Number.isNaN(minGenerated))) {
    return { status: "invalid_timestamp", score: 0, generatedAt: clean(generatedAt), ageHours: null, minGeneratedAt, maxAgeHours };
  }
  const ageHours = Number(Math.max(0, (now - generated) / 3_600_000).toFixed(2));
  if (minGenerated && generated < minGenerated) {
    return { status: "older_than_slice_window", score: 0, generatedAt: clean(generatedAt), ageHours, minGeneratedAt, maxAgeHours };
  }
  if (maxAgeHours > 0 && ageHours > maxAgeHours) {
    return { status: "stale", score: 0, generatedAt: clean(generatedAt), ageHours, minGeneratedAt, maxAgeHours };
  }
  return { status: "fresh", score: 1, generatedAt: clean(generatedAt), ageHours, minGeneratedAt, maxAgeHours };
}

function buildInstalledToolsFreshness(toolInventory, options = {}) {
  if (!toolInventory?.schema) {
    return {
      status: "unavailable",
      score: 0,
      inventory: sourceFreshness("", options),
      toolingQuality: sourceFreshness("", options)
    };
  }
  const inventory = sourceFreshness(toolInventory.generatedAt, options);
  const toolingQuality = sourceFreshness(toolInventory.effectivitySource?.generatedAt, options);
  const score = inventory.score === 1 && toolingQuality.score === 1 ? 1 : 0;
  return {
    status: score === 1 ? "fresh" : "stale_source",
    score,
    inventory,
    toolingQuality,
    effectivitySourceStatus: clean(toolInventory.effectivitySource?.status) || "unknown"
  };
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
    },
    evidenceLanes: classifyEffectivityLanes(report)
  };
}

function evidenceLane(id, status, title, evidence, safeNextStep, options = {}) {
  return {
    id,
    status,
    severity: clean(options.severity) || "medium",
    approvalRequired: Boolean(options.approvalRequired),
    title,
    evidence: evidence.filter(Boolean).map(clean),
    safeNextStep,
  };
}

function classifyEffectivityLanes(report) {
  const sections = report?.sections || {};
  const sources = report?.sources || {};
  const lanes = [];
  const liveStatus = clean(sections.live?.status).toLowerCase();
  const idleStatus = clean(sections.idleWorker?.status).toLowerCase();
  const harnessStatus = clean(sections.harness?.status).toLowerCase();
  const backupStatus = clean(sections.backup?.status).toLowerCase();
  const failedUnitsStatus = clean(sections.failedUnits?.status).toLowerCase();
  const privilegedStatus = clean(sections.privilegedEvidence?.status).toLowerCase();

  if (liveStatus && liveStatus !== "pass") {
    lanes.push(evidenceLane(
      "live_health",
      liveStatus,
      "Live health is not fully passing",
      [
        `studioBrain=${clean(sections.live?.studioBrain?.commandStatus || sections.live?.studioBrain?.ok)}`,
        `missionControl=${clean(sections.live?.missionControl?.commandStatus || sections.live?.missionControl?.ok)}`,
      ],
      "Refresh read-only Studio Brain and Mission Control health probes before treating this as an outage.",
      { severity: liveStatus === "fail" ? "high" : "medium" },
    ));
  }

  if (idleStatus && idleStatus !== "pass" && idleStatus !== "passed") {
    lanes.push(evidenceLane(
      "idle_worker_effectivity",
      idleStatus,
      "Idle-worker effectivity evidence is degraded or unavailable",
      [
        sources.idleAudit?.exists === false ? "idle-worker latest artifact missing" : "",
        sources.idleAudit?.stale ? "idle-worker latest artifact stale" : "",
        `commandStatus=${clean(sections.idleWorker?.commandStatus)}`,
      ],
      "Run the read-only idle-worker effectivity audit and attach the latest artifact before diagnosing worker behavior.",
      { severity: idleStatus === "fail" ? "high" : "medium" },
    ));
  }

  if (harnessStatus && harnessStatus !== "pass") {
    lanes.push(evidenceLane(
      "mission_harness_coverage",
      harnessStatus,
      "Mission Control harness coverage needs attention",
      [
        `missingTickets=${sections.harness?.missingTickets ?? ""}`,
        `openTickets=${sections.harness?.openTickets ?? ""}`,
        `commandStatus=${clean(sections.harness?.commandStatus)}`,
      ],
      "Run the read-only Mission Control harness learner and convert missing coverage into issue-ready tasks.",
      { severity: "medium" },
    ));
  }

  if (backupStatus && backupStatus !== "pass") {
    lanes.push(evidenceLane(
      "backup_confidence",
      backupStatus,
      "Backup confidence has unresolved evidence gaps",
      Array.isArray(sections.backup?.gaps) ? sections.backup.gaps : [],
      "Refresh backup evidence and classify each missing family before proposing any backup or restore change.",
      { severity: "high" },
    ));
  }

  if (failedUnitsStatus && failedUnitsStatus !== "pass") {
    lanes.push(evidenceLane(
      "failed_units",
      failedUnitsStatus,
      "Failed-unit classifier found units needing triage",
      [
        `trueFailedUnits=${sections.failedUnits?.trueFailedUnits ?? ""}`,
        `commandStatus=${clean(sections.failedUnits?.commandStatus)}`,
      ],
      "Inspect the failed-unit classifier output and collect approval-gated journals for true failed services.",
      { severity: (Number(sections.failedUnits?.trueFailedUnits) || 0) > 0 ? "high" : "medium" },
    ));
  }

  if (privilegedStatus && privilegedStatus !== "pass") {
    lanes.push(evidenceLane(
      "privileged_evidence",
      privilegedStatus,
      "Privileged host evidence is blocked by approval or sudo availability",
      [
        clean(sections.privilegedEvidence?.note),
        sections.privilegedEvidence?.summaryPresent === false ? "privileged evidence summary missing" : "",
      ],
      clean(sections.privilegedEvidence?.safeNextStep) || "Use the approval-gated privileged capture path; do not grant broad agent sudo.",
      { approvalRequired: true, severity: "medium" },
    ));
  }

  return lanes;
}

function buildAudit(options) {
  const generatedAt = nowIso();
  const runId = clean(options.runId) || `admin-effectivity-${generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const ledgerRows = readJsonl(options.ledger);
  const selectedRows = selectLedgerRows(ledgerRows, options.last, options.sliceRunId);
  const sliceSummary = summarizeSlices(selectedRows);
  const toolInventory = runJson(process.execPath, ["scripts/ops/installed_tool_inventory.mjs", "--json"]);
  const effectivityReport = tryEffectivityReport();
  const installedToolsFreshness = buildInstalledToolsFreshness(toolInventory.json, {
    now: generatedAt,
    minGeneratedAt: latestRowIso(selectedRows),
    maxAgeHours: 24
  });
  const toolFreshness = toolInventory.ok ? installedToolsFreshness.score : 0;
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
    : sliceSummary.count === 0 || sliceSummary.noOpRate > 0.4 || !effectivityReport.ok || toolFreshness < 1
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
      installedToolsFreshness,
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
    `- Freshness status: ${audit.sections.installedToolsFreshness?.status ?? "unknown"}`,
    `- Tooling quality source freshness: ${audit.sections.installedToolsFreshness?.toolingQuality?.status ?? "unknown"}`,
    "",
    "## Slice Rows",
    ""
  ];
  for (const row of audit.sections.sliceLedger.rows) {
    lines.push(`- ${row.sliceId}: ${row.status} - ${row.title}`);
  }
  if (audit.sections.sliceLedger.rows.length === 0) lines.push("- No slice rows recorded yet.");
  lines.push("", "## Effectivity Evidence Lanes", "");
  const evidenceLanes = audit.sections.effectivityReport?.report?.evidenceLanes || [];
  if (evidenceLanes.length === 0) {
    lines.push("- No degraded effectivity lanes reported.");
  } else {
    for (const lane of evidenceLanes) {
      lines.push(`- ${lane.id}: ${lane.status}, severity=${lane.severity}, approvalRequired=${lane.approvalRequired} - ${lane.safeNextStep}`);
    }
  }
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

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
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
}

export {
  buildAudit,
  classifyEffectivityLanes,
  buildInstalledToolsFreshness,
  main,
  parseArgs,
  sourceFreshness
};

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
