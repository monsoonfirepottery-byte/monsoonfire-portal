#!/usr/bin/env node

/* eslint-disable no-console */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  defaultReportsDir,
  parseNumber,
  pick,
  readCsvRows,
  resolveBaselineDir,
  writeReportArtifacts,
} from "./lib/website-ga-utils.mjs";

const REQUIRED_EVENTS = [
  "reservation_created",
  "reservation_station_assigned",
  "kiln_load_started",
  "status_transition",
  "pickup_ready",
  "pickup_completed",
];

function parseArgs(argv) {
  const options = {
    baselineDir: "",
    eventsCsv: "",
    outputDir: defaultReportsDir,
    strict: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--baseline-dir") {
      options.baselineDir = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (arg === "--events-csv") {
      options.eventsCsv = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (arg === "--output-dir") {
      options.outputDir = String(argv[index + 1] || "").trim() || defaultReportsDir;
      index += 1;
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
    }
  }

  return options;
}

function asLower(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeEventRows(rows) {
  return rows
    .map((row) => {
      const eventName = asLower(pick(row, ["event_name", "event", "eventname", "name"]));
      if (!eventName) return null;
      const eventCount = parseNumber(
        pick(row, ["event_count", "events", "count", "eventtotal", "total_events"])
      );
      return {
        eventName,
        eventCount: Number.isFinite(eventCount) ? Number(eventCount) : 1,
        transitionDomain: pick(row, ["transition_domain", "domain", "transitiondomain"]) || null,
        transitionAction: pick(row, ["transition_action", "action", "transitionaction"]) || null,
        transitionOutcome: pick(row, ["transition_outcome", "outcome", "transitionoutcome"]) || null,
        errorCode: pick(row, ["error_code", "errorcode", "code"]) || null,
      };
    })
    .filter(Boolean);
}

function countByEvent(rows) {
  const counts = Object.fromEntries(REQUIRED_EVENTS.map((name) => [name, 0]));
  for (const row of rows) {
    if (!(row.eventName in counts)) continue;
    counts[row.eventName] += row.eventCount;
  }
  return counts;
}

function toPct(part, whole) {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
  return Number(((part / whole) * 100).toFixed(2));
}

function buildFunnel(eventCounts) {
  const steps = [
    { eventName: "reservation_created", label: "Reservation created" },
    { eventName: "reservation_station_assigned", label: "Station assigned" },
    { eventName: "kiln_load_started", label: "Kiln load started" },
    { eventName: "pickup_ready", label: "Pickup ready" },
    { eventName: "pickup_completed", label: "Pickup completed" },
  ];
  const firstCount = Number(eventCounts.reservation_created || 0);
  return steps.map((step, index) => {
    const count = Number(eventCounts[step.eventName] || 0);
    const previousCount = index > 0 ? Number(eventCounts[steps[index - 1].eventName] || 0) : firstCount;
    return {
      step: index + 1,
      eventName: step.eventName,
      label: step.label,
      count,
      stepConversionPct: index === 0 ? 100 : toPct(count, previousCount),
      fromCreatePct: toPct(count, firstCount),
    };
  });
}

function summarizeExceptions(rows) {
  const exceptionRows = rows.filter((row) => row.eventName === "status_transition_exception");
  const byReason = new Map();
  for (const row of exceptionRows) {
    const key = [
      row.transitionDomain || "unknown-domain",
      row.transitionAction || "unknown-action",
      row.errorCode || "unknown-code",
    ].join("|");
    const next = (byReason.get(key) || 0) + row.eventCount;
    byReason.set(key, next);
  }

  const topReasons = [...byReason.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => {
      const [transitionDomain, transitionAction, errorCode] = key.split("|");
      return {
        transitionDomain,
        transitionAction,
        errorCode,
        count,
      };
    });

  return {
    exceptionCount: exceptionRows.reduce((sum, row) => sum + row.eventCount, 0),
    topReasons,
  };
}

function summarizeRollbacks(rows) {
  return rows
    .filter(
      (row) =>
        row.eventName === "status_transition" &&
        asLower(row.transitionOutcome || "") === "rollback"
    )
    .reduce((sum, row) => sum + row.eventCount, 0);
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Studio GA Monthly Review");
  lines.push("");
  lines.push(`- generatedAtUtc: ${report.generatedAtUtc}`);
  lines.push(`- eventsCsvPath: ${report.eventsCsvPath}`);
  lines.push(`- status: ${report.status}`);
  lines.push("");
  lines.push("## Funnel");
  lines.push("");
  for (const step of report.funnel) {
    lines.push(
      `- ${step.step}. ${step.label} (${step.eventName}): ${step.count} | step conversion ${step.stepConversionPct}% | from create ${step.fromCreatePct}%`
    );
  }
  lines.push("");
  lines.push("## Coverage");
  lines.push("");
  lines.push(`- requiredEventsSeen: ${report.coverage.requiredEventsSeen}`);
  lines.push(`- requiredEventsMissing: ${report.coverage.requiredEventsMissing}`);
  if (report.coverage.missing.length > 0) {
    lines.push(`- missing: ${report.coverage.missing.join(", ")}`);
  }
  lines.push("");
  lines.push("## Exceptions + Rollbacks");
  lines.push("");
  lines.push(`- statusTransitionExceptionCount: ${report.exceptions.exceptionCount}`);
  lines.push(`- rollbackCount: ${report.rollbacks.rollbackCount}`);
  if (report.exceptions.topReasons.length === 0) {
    lines.push("- topExceptionReasons: none");
  } else {
    for (const reason of report.exceptions.topReasons) {
      lines.push(
        `- ${reason.transitionDomain}/${reason.transitionAction}/${reason.errorCode}: ${reason.count}`
      );
    }
  }
  lines.push("");
  lines.push("## Cadence");
  lines.push("");
  lines.push("- Owner: Website + Analytics Team");
  lines.push("- Rhythm: monthly");
  lines.push("- Inputs: GA event export CSV for the prior full month");
  lines.push("- Follow-up: route remediation tickets for any funnel step conversion < 70%.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baselineDir = await resolveBaselineDir(options.baselineDir);
  const eventsCsvPath = options.eventsCsv
    ? options.eventsCsv
    : join(baselineDir, "event-audit.csv");

  if (!existsSync(eventsCsvPath)) {
    const missingMessage = `Events CSV not found: ${eventsCsvPath}`;
    if (options.strict) throw new Error(missingMessage);
    const report = {
      generatedAtUtc: new Date().toISOString(),
      status: "needs_data",
      baselineSnapshot: baselineDir.split("/").pop() || "",
      baselineDir,
      eventsCsvPath,
      funnel: buildFunnel(
        Object.fromEntries(REQUIRED_EVENTS.map((name) => [name, 0]))
      ),
      coverage: {
        requiredEventsSeen: 0,
        requiredEventsMissing: REQUIRED_EVENTS.length,
        missing: REQUIRED_EVENTS,
      },
      exceptions: {
        exceptionCount: 0,
        topReasons: [],
      },
      rollbacks: {
        rollbackCount: 0,
      },
      warnings: [missingMessage],
    };
    const markdown = buildMarkdown(report);
    const artifacts = await writeReportArtifacts({
      outputDir: options.outputDir,
      reportBasename: "studio-ga-monthly-review",
      report,
      markdown,
    });
    const output = { ok: true, report, artifacts };
    if (options.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(markdown.trimEnd());
      console.log(`\nArtifacts written:\n- ${artifacts.latestJsonPath}\n- ${artifacts.latestMdPath}`);
    }
    return;
  }

  const csvText = await readFile(eventsCsvPath, "utf8");
  const rawRows = readCsvRows(csvText);
  const rows = normalizeEventRows(rawRows);
  const eventCounts = countByEvent(rows);
  const funnel = buildFunnel(eventCounts);
  const missing = REQUIRED_EVENTS.filter((eventName) => Number(eventCounts[eventName] || 0) <= 0);
  const exceptions = summarizeExceptions(rows);
  const rollbackCount = summarizeRollbacks(rows);

  const report = {
    generatedAtUtc: new Date().toISOString(),
    status: missing.length === 0 ? "ok" : "partial",
    baselineSnapshot: baselineDir.split("/").pop() || "",
    baselineDir,
    eventsCsvPath,
    funnel,
    eventCounts,
    coverage: {
      requiredEventsSeen: REQUIRED_EVENTS.length - missing.length,
      requiredEventsMissing: missing.length,
      missing,
    },
    exceptions,
    rollbacks: {
      rollbackCount,
    },
  };

  if (options.strict) {
    const failures = [];
    if (rows.length === 0) failures.push("event export is empty");
    if (missing.length > 0) failures.push(`missing required events: ${missing.join(", ")}`);
    if (failures.length > 0) {
      const error = new Error(`Studio GA monthly review strict check failed: ${failures.join("; ")}`);
      error.report = report;
      throw error;
    }
  }

  const markdown = buildMarkdown(report);
  const artifacts = await writeReportArtifacts({
    outputDir: options.outputDir,
    reportBasename: "studio-ga-monthly-review",
    report,
    markdown,
  });

  const output = { ok: true, report, artifacts };
  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  console.log(markdown.trimEnd());
  console.log(`\nArtifacts written:\n- ${artifacts.latestJsonPath}\n- ${artifacts.latestMdPath}`);
}

main().catch((error) => {
  if (error && typeof error === "object" && "report" in error) {
    console.error(JSON.stringify({ ok: false, error: String(error), report: error.report }, null, 2));
    process.exitCode = 1;
    return;
  }
  console.error(String(error instanceof Error ? error.message : error));
  process.exitCode = 1;
});
