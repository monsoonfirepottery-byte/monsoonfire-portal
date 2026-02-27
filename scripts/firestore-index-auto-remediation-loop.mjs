#!/usr/bin/env node

/* eslint-disable no-console */

import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_WORKFLOW_NAME = "Firestore Index Contract Guard";
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "firestore-index-auto-remediation.json");
const DEFAULT_INDEXES_PATH = resolve(repoRoot, "firestore.indexes.json");
const DEFAULT_ARTIFACT_PREFIX = "firestore-index-contract-guard-";
const DEFAULT_LIMIT = 12;

function parseArgs(argv) {
  const options = {
    workflowName: DEFAULT_WORKFLOW_NAME,
    branch: String(process.env.GITHUB_REF_NAME || "main").trim(),
    runId: String(process.env.GITHUB_RUN_ID || "").trim(),
    reportPath: DEFAULT_REPORT_PATH,
    indexesPath: DEFAULT_INDEXES_PATH,
    artifactPrefix: DEFAULT_ARTIFACT_PREFIX,
    limit: DEFAULT_LIMIT,
    patchedIndexesPath: "",
    currentReportPath: "",
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--workflow-name") {
      options.workflowName = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--branch") {
      options.branch = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--run-id") {
      options.runId = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--report") {
      options.reportPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--indexes") {
      options.indexesPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--artifact-prefix") {
      options.artifactPrefix = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 1) throw new Error("--limit must be >= 1");
      options.limit = Math.min(30, Math.round(value));
      index += 1;
      continue;
    }
    if (arg === "--emit-patched-indexes") {
      options.patchedIndexesPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--current-report") {
      options.currentReportPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
  }

  return options;
}

function runCommand(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8" });
  const code = typeof result.status === "number" ? result.status : 1;
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  if (!allowFailure && code !== 0) {
    throw new Error(`Command failed (${code}): ${command} ${args.join(" ")}\n${stderr || stdout}`);
  }
  return { ok: code === 0, code, stdout, stderr };
}

async function readJsonSafe(path) {
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function indexSignature(indexDef) {
  const group = String(indexDef.collectionGroup || "").trim();
  const scope = String(indexDef.queryScope || "COLLECTION").trim();
  const fields = Array.isArray(indexDef.fields)
    ? indexDef.fields.map((field) => {
        if (field.arrayConfig) {
          return `${field.fieldPath}:array:${field.arrayConfig}`;
        }
        return `${field.fieldPath}:order:${field.order || "ASCENDING"}`;
      })
    : [];
  return `${group}|${scope}|${fields.join(",")}`;
}

async function loadRunReport(run, options, scratchDir) {
  const runId = String(run.databaseId || "").trim();
  const artifactName = `${options.artifactPrefix}${runId}`;
  const runDir = resolve(scratchDir, runId);
  await mkdir(runDir, { recursive: true });

  const download = runCommand(
    "gh",
    ["run", "download", runId, "-n", artifactName, "-D", runDir],
    { allowFailure: true }
  );
  if (!download.ok) {
    return {
      hasReport: false,
      report: null,
      downloadError: `artifact ${artifactName} unavailable`,
    };
  }

  const report = await readJsonSafe(resolve(runDir, "firestore-index-contract-guard.json"));
  if (!report) {
    return {
      hasReport: false,
      report: null,
      downloadError: "firestore-index-contract-guard.json missing or invalid",
    };
  }

  return { hasReport: true, report, downloadError: "" };
}

function analyze(records) {
  const runsWithReports = records
    .filter((item) => item.hasReport && item.report)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const missingById = new Map();
  const latest = runsWithReports[runsWithReports.length - 1] || null;

  for (const run of runsWithReports) {
    const missing = Array.isArray(run.report?.missing) ? run.report.missing : [];
    for (const indexDef of missing) {
      const id = String(indexDef?.id || "").trim();
      if (!id) continue;
      const prev = missingById.get(id) || { count: 0, latestRunId: 0, definition: indexDef };
      prev.count += 1;
      prev.latestRunId = Number(run.databaseId || 0);
      prev.definition = indexDef;
      missingById.set(id, prev);
    }
  }

  const failureRunsDesc = [...runsWithReports].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  let consecutiveFailureCount = 0;
  for (const run of failureRunsDesc) {
    const missing = Array.isArray(run.report?.missing) ? run.report.missing : [];
    if (missing.length === 0) break;
    consecutiveFailureCount += 1;
  }

  const latestMissingIds = new Set(
    Array.isArray(latest?.report?.missing) ? latest.report.missing.map((item) => String(item?.id || "").trim()).filter(Boolean) : []
  );

  const candidateIds = [];
  for (const [id, entry] of missingById.entries()) {
    if (entry.count >= 2 || latestMissingIds.has(id)) {
      candidateIds.push(id);
    }
  }

  const candidateIndexes = candidateIds
    .map((id) => {
      const entry = missingById.get(id);
      return entry?.definition || null;
    })
    .filter(Boolean);

  return {
    sourceRunCount: runsWithReports.length,
    consecutiveFailureCount,
    latestMissingCount: latestMissingIds.size,
    candidateIds,
    candidateIndexes,
    missingFrequency: Array.from(missingById.entries()).map(([id, value]) => ({
      id,
      count: value.count,
      latestRunId: value.latestRunId,
    })),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = {
    status: "ok",
    generatedAtIso: new Date().toISOString(),
    workflowName: options.workflowName,
    branch: options.branch,
    sourceRunCount: 0,
    sourceRuns: [],
    signals: {
      consecutiveFailureCount: 0,
      latestMissingCount: 0,
      missingFrequency: [],
    },
    feedback: {
      shouldProposePatch: false,
      candidateMissingIds: [],
      candidateIndexCount: 0,
      shouldKeepStrictMode: true,
      shouldEnableApplyMode: false,
    },
    remediation: {
      patchedIndexesPath: options.patchedIndexesPath || "",
      proposedAdditions: [],
      proposedAdditionCount: 0,
    },
    notes: [],
  };

  const runsResponse = runCommand(
    "gh",
    [
      "run",
      "list",
      "--workflow",
      options.workflowName,
      "--branch",
      options.branch,
      "--limit",
      String(options.limit),
      "--json",
      "databaseId,conclusion,url,createdAt,status",
    ],
    { allowFailure: true }
  );

  if (!runsResponse.ok) {
    report.status = "github_unavailable";
    report.notes.push("Could not query index guard history via gh.");
  } else {
    let runs = [];
    try {
      const parsed = JSON.parse(runsResponse.stdout || "[]");
      runs = Array.isArray(parsed) ? parsed : [];
    } catch {
      runs = [];
      report.status = "parse_warning";
      report.notes.push("Could not parse gh run list JSON output.");
    }

    const filteredRuns = runs
      .filter((run) => String(run?.status || "").toLowerCase() === "completed")
      .filter((run) => {
        const runId = String(run?.databaseId || "").trim();
        if (!runId) return false;
        if (options.runId && runId === options.runId) return false;
        return true;
      });

    const scratchDir = await mkdtemp(resolve(tmpdir(), "index-auto-remediation-"));
    try {
      for (const run of filteredRuns) {
        const loaded = await loadRunReport(run, options, scratchDir);
        report.sourceRuns.push({
          databaseId: Number(run.databaseId || 0),
          conclusion: String(run.conclusion || ""),
          status: String(run.status || "").toLowerCase(),
          createdAt: String(run.createdAt || ""),
          url: String(run.url || ""),
          hasReport: loaded.hasReport,
          downloadError: loaded.downloadError,
          report: loaded.report,
        });
      }
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  }

  const analysis = analyze(report.sourceRuns);
  report.sourceRunCount = analysis.sourceRunCount;
  report.signals.consecutiveFailureCount = analysis.consecutiveFailureCount;
  report.signals.latestMissingCount = analysis.latestMissingCount;
  report.signals.missingFrequency = analysis.missingFrequency;

  report.feedback.shouldProposePatch = analysis.candidateIndexes.length > 0;
  report.feedback.candidateMissingIds = analysis.candidateIds;
  report.feedback.candidateIndexCount = analysis.candidateIndexes.length;
  report.feedback.shouldKeepStrictMode = analysis.consecutiveFailureCount < 3;
  report.feedback.shouldEnableApplyMode = analysis.consecutiveFailureCount >= 2 || analysis.latestMissingCount > 0;

  const indexesDoc = await readJsonSafe(options.indexesPath);
  if (!indexesDoc || !Array.isArray(indexesDoc.indexes)) {
    report.status = report.status === "ok" ? "indexes_parse_warning" : report.status;
    report.notes.push(`Could not parse indexes file at ${options.indexesPath}.`);
  } else {
    const currentSignatures = new Set(indexesDoc.indexes.map((entry) => indexSignature(entry)));
    const additions = analysis.candidateIndexes.filter((entry) => !currentSignatures.has(indexSignature(entry)));
    report.remediation.proposedAdditions = additions;
    report.remediation.proposedAdditionCount = additions.length;

    if (options.patchedIndexesPath && additions.length > 0) {
      const patched = {
        ...indexesDoc,
        indexes: [...indexesDoc.indexes, ...additions],
      };
      await mkdir(dirname(options.patchedIndexesPath), { recursive: true });
      await writeFile(options.patchedIndexesPath, `${JSON.stringify(patched, null, 2)}\n`, "utf8");
      report.notes.push(`Wrote patched indexes candidate to ${options.patchedIndexesPath}.`);
    }
  }

  report.sourceRuns = report.sourceRuns.map((item) => ({
    databaseId: item.databaseId,
    conclusion: item.conclusion,
    status: item.status,
    createdAt: item.createdAt,
    url: item.url,
    hasReport: item.hasReport,
    downloadError: item.downloadError,
  }));

  if (options.currentReportPath) {
    const currentReport = await readJsonSafe(options.currentReportPath);
    if (currentReport) {
      report.notes.push(`Included current report context from ${options.currentReportPath}.`);
      report.signals.latestMissingCount = Array.isArray(currentReport.missing) ? currentReport.missing.length : report.signals.latestMissingCount;
      if (Array.isArray(currentReport.missing) && currentReport.missing.length > 0) {
        const ids = currentReport.missing.map((item) => String(item?.id || "").trim()).filter(Boolean);
        report.feedback.candidateMissingIds = Array.from(new Set([...report.feedback.candidateMissingIds, ...ids]));
        report.feedback.candidateIndexCount = report.feedback.candidateMissingIds.length;
        report.feedback.shouldProposePatch = true;
      }
    }
  }

  if (!report.feedback.shouldProposePatch) {
    report.notes.push("No repeated missing-index pattern found.");
  }

  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${report.status}\n`);
    process.stdout.write(`sourceRuns: ${String(report.sourceRunCount)}\n`);
    process.stdout.write(`candidateMissingIds: ${report.feedback.candidateMissingIds.join(",") || "none"}\n`);
    process.stdout.write(`proposedAdditions: ${String(report.remediation.proposedAdditionCount)}\n`);
    process.stdout.write(`report: ${options.reportPath}\n`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`firestore-index-auto-remediation-loop failed: ${message}`);
  process.exit(1);
});
