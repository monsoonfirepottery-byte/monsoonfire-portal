#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_AUDIT_DIR = resolve(REPO_ROOT, "output", "ops", "effectivity");
const DEFAULT_OUTPUT_DIR = DEFAULT_AUDIT_DIR;

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function repoRelative(path) {
  return relative(REPO_ROOT, resolve(REPO_ROOT, path)).replace(/\\/g, "/");
}

function usage() {
  return `Studio Brain admin effectivity trend

Usage:
  node scripts/ops/admin_effectivity_trend.mjs [--json] [--write]

Options:
  --json              Print JSON report.
  --write             Write timestamped JSON/Markdown and latest artifacts.
  --audit-dir <path>  Directory containing admin-effectivity audit JSON artifacts.
  --output-dir <path> Artifact directory. Default: output/ops/effectivity.
  --limit <number>    Number of recent audits to trend. Default: 10.
  --run-id <id>       Stable run id. Default: admin-effectivity-trend timestamp.
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

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    json: false,
    write: false,
    auditDir: DEFAULT_AUDIT_DIR,
    outputDir: DEFAULT_OUTPUT_DIR,
    limit: 10,
    runId: "",
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
      ["--audit-dir", "auditDir"],
      ["--output-dir", "outputDir"],
      ["--limit", "limit"],
      ["--run-id", "runId"],
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
  options.auditDir = resolve(REPO_ROOT, options.auditDir);
  options.outputDir = resolve(REPO_ROOT, options.outputDir);
  options.limit = Math.max(1, Number(options.limit) || 10);
  return options;
}

function safeNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readAuditArtifacts(auditDir = DEFAULT_AUDIT_DIR) {
  if (!existsSync(auditDir)) return [];
  const rows = [];
  for (const name of readdirSync(auditDir)) {
    if (!/^admin-effectivity.*\.json$/i.test(name)) continue;
    if (/trend/i.test(name)) continue;
    const path = resolve(auditDir, name);
    try {
      const audit = JSON.parse(readFileSync(path, "utf8"));
      if (audit?.schema !== "studiobrain-admin-effectivity-audit.v1") continue;
      rows.push({
        artifact: repoRelative(path),
        audit,
      });
    } catch {
      rows.push({
        artifact: repoRelative(path),
        audit: {
          schema: "studiobrain-admin-effectivity-audit.v1",
          generatedAt: "",
          runId: name,
          status: "invalid_json",
          scores: {},
          sliceWindow: { from: "", to: "", count: 0 },
        },
      });
    }
  }
  const byIdentity = new Map();
  for (const row of rows) {
    const key = `${clean(row.audit.runId)}|${clean(row.audit.generatedAt)}`;
    const prior = byIdentity.get(key);
    if (!prior || /latest/i.test(prior.artifact)) byIdentity.set(key, row);
  }
  return Array.from(byIdentity.values())
    .sort((left, right) => clean(left.audit.generatedAt).localeCompare(clean(right.audit.generatedAt)));
}

function average(values) {
  const numbers = values.map((value) => safeNumber(value)).filter((value) => value !== null);
  if (numbers.length === 0) return null;
  return Number((numbers.reduce((sum, value) => sum + value, 0) / numbers.length).toFixed(3));
}

function statusCounts(audits) {
  return audits.reduce((counts, row) => {
    const status = clean(row.status) || "unknown";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

function pickScores(audit) {
  return {
    usefulness: safeNumber(audit?.scores?.usefulness),
    verification: safeNumber(audit?.scores?.verification),
    noOpRate: safeNumber(audit?.scores?.noOpRate),
    blockedLaneClarity: safeNumber(audit?.scores?.blockedLaneClarity),
    toolInventoryFreshness: safeNumber(audit?.scores?.toolInventoryFreshness),
    workPacketOutcomeHealth: safeNumber(audit?.scores?.workPacketOutcomeHealth),
  };
}

function trendDelta(first, latest, key) {
  const left = safeNumber(first?.scores?.[key]);
  const right = safeNumber(latest?.scores?.[key]);
  if (left === null || right === null) return null;
  return Number((right - left).toFixed(3));
}

function buildTrendReport(inputAudits = [], options = {}) {
  const generatedAt = clean(options.generatedAt) || nowIso();
  const runId = clean(options.runId) || `admin-effectivity-trend-${generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const limit = Math.max(1, Number(options.limit) || 10);
  const selected = inputAudits.slice(-limit).map((row) => ({
    artifact: clean(row.artifact),
    generatedAt: clean(row.audit?.generatedAt),
    runId: clean(row.audit?.runId),
    status: clean(row.audit?.status) || "unknown",
    sliceWindow: {
      from: clean(row.audit?.sliceWindow?.from),
      to: clean(row.audit?.sliceWindow?.to),
      count: safeNumber(row.audit?.sliceWindow?.count, 0),
    },
    scores: pickScores(row.audit),
  }));
  const first = selected[0] || null;
  const latest = selected[selected.length - 1] || null;
  const warnings = [];
  if (selected.length === 0) warnings.push("no admin effectivity audit artifacts found");
  if (latest && latest.status !== "pass") warnings.push(`latest audit status is ${latest.status}`);
  if (latest?.scores?.toolInventoryFreshness !== null && latest.scores.toolInventoryFreshness < 1) warnings.push("latest tool inventory freshness is below pass threshold");
  if (latest?.scores?.workPacketOutcomeHealth !== null && latest.scores.workPacketOutcomeHealth < 1) warnings.push("latest work-packet outcome health is below pass threshold");
  const usefulnessDelta = trendDelta(first, latest, "usefulness");
  const noOpDelta = trendDelta(first, latest, "noOpRate");
  if (usefulnessDelta !== null && usefulnessDelta < -0.1) warnings.push(`usefulness declined by ${Math.abs(usefulnessDelta).toFixed(3)}`);
  if (noOpDelta !== null && noOpDelta > 0.1) warnings.push(`no-op rate increased by ${noOpDelta.toFixed(3)}`);
  return {
    schema: "studiobrain-admin-effectivity-trend.v1",
    generatedAt,
    runId,
    status: warnings.length > 0 ? "warn" : "pass",
    readOnly: true,
    sources: {
      auditDir: clean(options.auditDir) || repoRelative(DEFAULT_AUDIT_DIR),
      limit,
      artifactsConsidered: inputAudits.length,
      auditsIncluded: selected.length,
    },
    summary: {
      audits: selected.length,
      latestStatus: latest?.status || "",
      statusCounts: statusCounts(selected),
      averageUsefulness: average(selected.map((row) => row.scores.usefulness)),
      averageVerification: average(selected.map((row) => row.scores.verification)),
      averageNoOpRate: average(selected.map((row) => row.scores.noOpRate)),
      toolFreshnessPassRate: average(selected.map((row) => row.scores.toolInventoryFreshness)),
      workPacketOutcomePassRate: average(selected.map((row) => row.scores.workPacketOutcomeHealth)),
    },
    trend: {
      fromGeneratedAt: first?.generatedAt || "",
      toGeneratedAt: latest?.generatedAt || "",
      fromSlice: first?.sliceWindow?.from || "",
      toSlice: latest?.sliceWindow?.to || "",
      usefulnessDelta,
      verificationDelta: trendDelta(first, latest, "verification"),
      noOpRateDelta: noOpDelta,
      toolInventoryFreshnessDelta: trendDelta(first, latest, "toolInventoryFreshness"),
      workPacketOutcomeHealthDelta: trendDelta(first, latest, "workPacketOutcomeHealth"),
    },
    warnings,
    audits: selected,
  };
}

function renderMarkdown(report) {
  const warnings = report.warnings.map((warning) => `- ${warning}`).join("\n") || "- None.";
  const rows = report.audits.map((audit) => (
    `| ${audit.generatedAt || "unknown"} | ${audit.status} | ${audit.sliceWindow.from || ""} -> ${audit.sliceWindow.to || ""} | ${audit.scores.usefulness ?? ""} | ${audit.scores.noOpRate ?? ""} | ${audit.scores.toolInventoryFreshness ?? ""} | ${audit.scores.workPacketOutcomeHealth ?? ""} |`
  )).join("\n") || "| none | | | | | | |";
  return `# Admin Effectivity Trend

Generated: ${report.generatedAt}
Status: ${report.status}
Run ID: ${report.runId}

## Summary

- Audits: ${report.summary.audits}
- Latest status: ${report.summary.latestStatus || "unknown"}
- Average usefulness: ${report.summary.averageUsefulness ?? ""}
- Average verification: ${report.summary.averageVerification ?? ""}
- Average no-op rate: ${report.summary.averageNoOpRate ?? ""}
- Tool freshness pass rate: ${report.summary.toolFreshnessPassRate ?? ""}
- Work-packet outcome pass rate: ${report.summary.workPacketOutcomePassRate ?? ""}

## Trend

- From: ${report.trend.fromGeneratedAt || "unknown"} (${report.trend.fromSlice || "unknown"})
- To: ${report.trend.toGeneratedAt || "unknown"} (${report.trend.toSlice || "unknown"})
- Usefulness delta: ${report.trend.usefulnessDelta ?? ""}
- Verification delta: ${report.trend.verificationDelta ?? ""}
- No-op rate delta: ${report.trend.noOpRateDelta ?? ""}
- Tool freshness delta: ${report.trend.toolInventoryFreshnessDelta ?? ""}
- Work-packet outcome delta: ${report.trend.workPacketOutcomeHealthDelta ?? ""}

## Warnings

${warnings}

## Audits

| Generated | Status | Slice window | Usefulness | No-op | Tool fresh | Outcome health |
| --- | --- | --- | ---: | ---: | ---: | ---: |
${rows}
`;
}

function writeArtifacts(options, report) {
  mkdirSync(options.outputDir, { recursive: true });
  const jsonPath = resolve(options.outputDir, `${report.runId}.json`);
  const markdownPath = resolve(options.outputDir, `${report.runId}.md`);
  const latestJson = resolve(options.outputDir, "admin-effectivity-trend-latest.json");
  const latestMarkdown = resolve(options.outputDir, "admin-effectivity-trend-latest.md");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  writeFileSync(latestJson, `${JSON.stringify({ ...report, artifactPath: repoRelative(jsonPath), markdownPath: repoRelative(markdownPath) }, null, 2)}\n`, "utf8");
  writeFileSync(latestMarkdown, renderMarkdown(report), "utf8");
  return {
    jsonPath: repoRelative(jsonPath),
    markdownPath: repoRelative(markdownPath),
    latestJson: repoRelative(latestJson),
    latestMarkdown: repoRelative(latestMarkdown),
  };
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    const report = buildTrendReport(readAuditArtifacts(options.auditDir), {
      auditDir: repoRelative(options.auditDir),
      generatedAt: nowIso(),
      limit: options.limit,
      runId: options.runId,
    });
    if (options.write) report.artifacts = writeArtifacts(options, report);
    if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else process.stdout.write(`admin effectivity trend: ${report.status}, audits=${report.summary.audits}\n`);
    return report;
  } catch (error) {
    process.stderr.write(`admin_effectivity_trend failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return null;
  }
}

export { buildTrendReport, readAuditArtifacts, renderMarkdown };

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
