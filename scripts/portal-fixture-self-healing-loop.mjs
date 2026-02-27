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

const DEFAULT_WORKFLOW_NAME = "Portal Daily Authenticated Canary";
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "portal-fixture-self-healing.json");
const DEFAULT_ARTIFACT_PREFIX = "portal-authenticated-canary-";
const DEFAULT_LIMIT = 12;

const SIGNALS = [
  {
    id: "my_pieces_fixture_gap",
    label: "dashboard piece click-through opens my pieces detail",
    matchers: [
      /fixture seeding may be missing/i,
      /no selectable rows/i,
      /no piece thumb/i,
      /did not surface rows/i,
    ],
    hint: "seed_batch_piece",
  },
  {
    id: "notifications_fixture_gap",
    label: "notifications mark read gives user feedback",
    matchers: [
      /mark read failed/i,
      /could not complete that request/i,
    ],
    hint: "seed_notification",
  },
  {
    id: "messages_fixture_gap",
    label: "messages page loads without index\/precondition errors",
    matchers: [
      /direct messages failed/i,
      /requires an index/i,
      /failed-precondition/i,
    ],
    hint: "seed_direct_messages",
  },
];

function parseArgs(argv) {
  const options = {
    workflowName: DEFAULT_WORKFLOW_NAME,
    branch: String(process.env.GITHUB_REF_NAME || "main").trim(),
    runId: String(process.env.GITHUB_RUN_ID || "").trim(),
    artifactPrefix: DEFAULT_ARTIFACT_PREFIX,
    reportPath: DEFAULT_REPORT_PATH,
    limit: DEFAULT_LIMIT,
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
    if (arg === "--artifact-prefix") {
      options.artifactPrefix = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--report") {
      options.reportPath = resolve(process.cwd(), String(next).trim());
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
  return {
    ok: code === 0,
    code,
    stdout,
    stderr,
  };
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

  const report = await readJsonSafe(resolve(runDir, "portal-authenticated-canary.json"));
  if (!report) {
    return {
      hasReport: false,
      report: null,
      downloadError: "portal-authenticated-canary.json missing or invalid",
    };
  }

  return {
    hasReport: true,
    report,
    downloadError: "",
  };
}

function analyze(records) {
  const runsWithReports = records
    .filter((item) => item.hasReport && item.report)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const signalHits = [];
  const hints = new Set();

  for (const run of runsWithReports) {
    const checks = Array.isArray(run.report?.checks) ? run.report.checks : [];
    for (const check of checks) {
      if (String(check?.status || "") !== "failed") continue;
      const label = String(check?.label || "").trim();
      const message = String(check?.message || "").trim();

      for (const signal of SIGNALS) {
        if (signal.label !== label) continue;
        if (!signal.matchers.some((pattern) => pattern.test(message))) continue;
        signalHits.push({
          signalId: signal.id,
          runId: run.databaseId,
          createdAt: run.createdAt,
          label,
          message,
          hint: signal.hint,
        });
        hints.add(signal.hint);
      }
    }
  }

  const recentHits = signalHits.filter((item) => {
    const createdAt = new Date(item.createdAt).getTime();
    const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
    return Number.isFinite(createdAt) && createdAt >= recentCutoff;
  });

  const shouldSeedFixturesBeforeCanary = recentHits.length > 0;
  const reasonCodes = Array.from(new Set(recentHits.map((item) => item.signalId)));

  return {
    sourceRunCount: runsWithReports.length,
    signalHits,
    feedback: {
      shouldSeedFixturesBeforeCanary,
      reasonCodes,
      fixtureHints: {
        seedBatchPiece: hints.has("seed_batch_piece"),
        seedNotification: hints.has("seed_notification"),
        seedDirectMessages: hints.has("seed_direct_messages"),
      },
      suggestedTtlDays: 21,
    },
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
    signalHits: [],
    feedback: {
      shouldSeedFixturesBeforeCanary: false,
      reasonCodes: [],
      fixtureHints: {
        seedBatchPiece: false,
        seedNotification: false,
        seedDirectMessages: false,
      },
      suggestedTtlDays: 21,
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
    report.notes.push("Could not query run history via gh.");
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

    const scratchDir = await mkdtemp(resolve(tmpdir(), "portal-fixture-loop-"));
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
  report.signalHits = analysis.signalHits;
  report.feedback = analysis.feedback;

  report.sourceRuns = report.sourceRuns.map((item) => ({
    databaseId: item.databaseId,
    conclusion: item.conclusion,
    status: item.status,
    createdAt: item.createdAt,
    url: item.url,
    hasReport: item.hasReport,
    downloadError: item.downloadError,
  }));

  if (!report.feedback.shouldSeedFixturesBeforeCanary) {
    report.notes.push("No recent fixture-like canary failures detected.");
  }

  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${report.status}\n`);
    process.stdout.write(`sourceRuns: ${String(report.sourceRunCount)}\n`);
    process.stdout.write(`shouldSeedFixturesBeforeCanary: ${String(report.feedback.shouldSeedFixturesBeforeCanary)}\n`);
    process.stdout.write(`report: ${options.reportPath}\n`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`portal-fixture-self-healing-loop failed: ${message}`);
  process.exit(1);
});
