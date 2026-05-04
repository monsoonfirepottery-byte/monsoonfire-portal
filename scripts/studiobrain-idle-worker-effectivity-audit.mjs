#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_RUN_ROOT = "output/studio-brain/idle-worker";
const DEFAULT_ARTIFACT = "output/studio-brain/audits/idle-worker-effectivity-latest.json";
const DEFAULT_MARKDOWN = "output/studio-brain/audits/idle-worker-effectivity-latest.md";
const DEFAULT_MAX_AGE_MINUTES = 180;
const DEFAULT_MIN_READY_TASKS = 5;
const DEFAULT_MIN_PASS_RATE = 0.95;
const DEFAULT_MAX_RUNS = 20;

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(argv) {
  const args = {
    json: false,
    strict: false,
    includeDryRuns: false,
    runRoot: DEFAULT_RUN_ROOT,
    history: null,
    latest: null,
    wikiIdleTasks: null,
    artifact: DEFAULT_ARTIFACT,
    markdown: DEFAULT_MARKDOWN,
    maxAgeMinutes: DEFAULT_MAX_AGE_MINUTES,
    minReadyTasks: DEFAULT_MIN_READY_TASKS,
    minPassRate: DEFAULT_MIN_PASS_RATE,
    maxRuns: DEFAULT_MAX_RUNS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--strict") {
      args.strict = true;
      continue;
    }
    if (arg === "--include-dry-runs") {
      args.includeDryRuns = true;
      continue;
    }
    const readValue = (name) => {
      if (arg === name && argv[index + 1]) {
        index += 1;
        return argv[index];
      }
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
      return null;
    };
    const stringOptions = {
      "--run-root": "runRoot",
      "--history": "history",
      "--latest": "latest",
      "--wiki-idle-tasks": "wikiIdleTasks",
      "--artifact": "artifact",
      "--markdown": "markdown",
    };
    let matched = false;
    for (const [flag, key] of Object.entries(stringOptions)) {
      const value = readValue(flag);
      if (value !== null) {
        args[key] = value;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const numericOptions = {
      "--max-age-minutes": "maxAgeMinutes",
      "--min-ready-tasks": "minReadyTasks",
      "--min-pass-rate": "minPassRate",
      "--max-runs": "maxRuns",
    };
    for (const [flag, key] of Object.entries(numericOptions)) {
      const value = readValue(flag);
      if (value !== null) {
        args[key] = parseNumber(value, args[key]);
        break;
      }
    }
  }
  return args;
}

function readJsonIfPresent(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function resolveInputPath(repoRoot, path) {
  return resolve(repoRoot, path);
}

function pushFinding(findings, severity, code, message, details = {}) {
  findings.push({ severity, code, message, details });
}

function ageMinutes(isoDate) {
  const parsed = Date.parse(clean(isoDate));
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round((Date.now() - parsed) / 60000));
}

function isCleanPassedRun(run) {
  const summary = run?.summary || {};
  return (
    clean(run?.status) === "passed" &&
    Number(summary.failed || 0) === 0 &&
    Number(summary.warning || 0) === 0 &&
    Number(summary.skipped || 0) === 0
  );
}

function collectProblemIds(run) {
  const utilization = run?.utilization || {};
  return [
    ...(Array.isArray(utilization.failedJobIds) ? utilization.failedJobIds : []),
    ...(Array.isArray(utilization.warningJobIds) ? utilization.warningJobIds : []),
    ...(Array.isArray(utilization.skippedJobIds) ? utilization.skippedJobIds : []),
  ].map(clean).filter(Boolean);
}

function buildProblemClusters(runs) {
  const counts = new Map();
  for (const run of runs) {
    for (const jobId of new Set(collectProblemIds(run))) {
      counts.set(jobId, (counts.get(jobId) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([jobId, count]) => ({ jobId, count }))
    .filter((entry) => entry.count >= 2)
    .sort((a, b) => b.count - a.count || a.jobId.localeCompare(b.jobId));
}

function latestResolvedWarnings(runs) {
  const latest = runs[0] || {};
  const latestProblemIds = new Set(collectProblemIds(latest));
  const olderProblemIds = new Set(runs.slice(1).flatMap((run) => collectProblemIds(run)));
  return [...olderProblemIds].filter((jobId) => !latestProblemIds.has(jobId)).sort();
}

function summarizeQueue(wikiIdleTasks) {
  const tasks = Array.isArray(wikiIdleTasks?.tasks) ? wikiIdleTasks.tasks : [];
  const summary = wikiIdleTasks?.summary || {};
  const humanGateTask = tasks.find((task) => clean(task?.taskKey) === "wiki-human-approval-triage");
  return {
    present: Boolean(wikiIdleTasks),
    tasks: Number(summary.tasks ?? tasks.length ?? 0),
    ready: Number(summary.ready ?? tasks.filter((task) => clean(task?.status) === "ready").length ?? 0),
    blocked: Number(summary.blocked ?? tasks.filter((task) => clean(task?.status) === "blocked").length ?? 0),
    readOnly: Number(summary.readOnly ?? tasks.filter((task) => task?.readOnly !== false).length ?? 0),
    writeCapable: Number(summary.writeCapable ?? tasks.filter((task) => task?.readOnly === false).length ?? 0),
    humanApprovalClaims: Number(humanGateTask?.metadata?.claims || 0),
    topTasks: tasks.slice(0, 7).map((task) => ({
      taskKey: clean(task?.taskKey),
      title: clean(task?.title),
      status: clean(task?.status),
      priority: Number(task?.priority || 0),
      readOnly: task?.readOnly !== false,
      metadata: task?.metadata || {},
    })),
  };
}

function calculateScore(metrics, findings, thresholds) {
  let score = 100;
  if (metrics.runsAudited === 0) score -= 60;
  if (metrics.latestAgeMinutes === null || metrics.stale) score -= 20;
  if (metrics.passRate < thresholds.minPassRate) {
    score -= Math.min(25, Math.round((thresholds.minPassRate - metrics.passRate) * 100));
  }
  score -= Math.min(30, metrics.failedRuns * 15);
  score -= Math.min(20, metrics.warningRuns * 6);
  score -= Math.min(15, metrics.skippedRuns * 5);
  score -= Math.min(20, metrics.repeatedProblemClusters.length * 10);
  if (metrics.queue.present && metrics.queue.ready < thresholds.minReadyTasks) score -= 10;
  if (metrics.queue.writeCapable > 0) score -= 25;
  if (metrics.queue.humanApprovalClaims > 0) score -= 3;
  if (findings.some((finding) => finding.severity === "error")) score -= 20;
  return Math.max(0, Math.min(100, score));
}

function deriveStatus(score, findings, strict) {
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  if (errors > 0 || (strict && warnings > 0)) return "fail";
  if (warnings > 0 || score < 85) return "warn";
  return "pass";
}

export function auditIdleWorkerEffectivity(options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const runRoot = resolveInputPath(repoRoot, options.runRoot || DEFAULT_RUN_ROOT);
  const historyPath = resolveInputPath(repoRoot, options.history || `${options.runRoot || DEFAULT_RUN_ROOT}/history.json`);
  const latestPath = resolveInputPath(repoRoot, options.latest || `${options.runRoot || DEFAULT_RUN_ROOT}/latest.json`);
  const wikiIdleTasksPath = resolveInputPath(
    repoRoot,
    options.wikiIdleTasks || `${options.runRoot || DEFAULT_RUN_ROOT}/wiki-idle-tasks.json`,
  );
  const artifactPath = resolveInputPath(repoRoot, options.artifact || DEFAULT_ARTIFACT);
  const markdownPath = resolveInputPath(repoRoot, options.markdown || DEFAULT_MARKDOWN);
  const maxRuns = Math.max(1, Math.round(Number(options.maxRuns || DEFAULT_MAX_RUNS)));
  const maxAgeMinutes = Math.max(1, Math.round(Number(options.maxAgeMinutes || DEFAULT_MAX_AGE_MINUTES)));
  const minReadyTasks = Math.max(0, Math.round(Number(options.minReadyTasks || DEFAULT_MIN_READY_TASKS)));
  const minPassRate = Number(options.minPassRate ?? DEFAULT_MIN_PASS_RATE);
  const includeDryRuns = Boolean(options.includeDryRuns);

  const findings = [];
  const history = readJsonIfPresent(historyPath);
  const latest = readJsonIfPresent(latestPath);
  const wikiIdleTasks = readJsonIfPresent(wikiIdleTasksPath);
  const candidateRuns = Array.isArray(history?.runs) ? history.runs : latest ? [latest] : [];
  const runs = candidateRuns.filter((run) => includeDryRuns || !run?.dryRun).slice(0, maxRuns);
  const latestRun = includeDryRuns || !latest?.dryRun ? latest || runs[0] || null : runs[0] || null;
  const completedAt = clean(latestRun?.completedAt);
  const latestAge = ageMinutes(completedAt);
  const stale = latestAge === null || latestAge > maxAgeMinutes;
  const cleanPassedRuns = runs.filter(isCleanPassedRun).length;
  const failedRuns = runs.filter((run) => Number(run?.summary?.failed || 0) > 0 || clean(run?.status) === "degraded").length;
  const warningRuns = runs.filter((run) => Number(run?.summary?.warning || 0) > 0 || clean(run?.status) === "passed_with_warnings").length;
  const skippedRuns = runs.filter((run) => Number(run?.summary?.skipped || 0) > 0 || clean(run?.status) === "skipped").length;
  const repeatedProblemClusters = buildProblemClusters(runs);
  const resolvedProblemIds = latestResolvedWarnings(runs);
  const queue = summarizeQueue(wikiIdleTasks);
  const passRate = runs.length > 0 ? cleanPassedRuns / runs.length : 0;
  const latestUtilization = latestRun?.utilization || {};

  if (!history && !latest) {
    pushFinding(findings, "error", "missing-idle-worker-artifacts", "No idle-worker latest or history artifact was found.", {
      historyPath,
      latestPath,
    });
  }
  if (candidateRuns.length > 0 && runs.length === 0) {
    pushFinding(findings, "error", "missing-executed-idle-worker-runs", "Only dry-run idle-worker artifacts were found.", {
      candidateRuns: candidateRuns.length,
      includeDryRuns,
    });
  }
  if (stale) {
    pushFinding(findings, "warning", "stale-idle-worker-evidence", "Latest idle-worker evidence is stale or missing a completedAt value.", {
      completedAt,
      latestAgeMinutes: latestAge,
      maxAgeMinutes,
    });
  }
  if (failedRuns > 0) {
    pushFinding(findings, "error", "failed-idle-worker-runs", "One or more audited idle-worker runs failed.", { failedRuns });
  }
  if (warningRuns > 0) {
    pushFinding(findings, "warning", "warning-idle-worker-runs", "One or more audited idle-worker runs reported warnings.", {
      warningRuns,
      resolvedProblemIds,
    });
  }
  if (repeatedProblemClusters.length > 0) {
    pushFinding(findings, "warning", "repeated-idle-worker-problems", "A job appears repeatedly in failed, warning, or skipped sets.", {
      repeatedProblemClusters,
    });
  }
  if (!queue.present) {
    pushFinding(findings, "warning", "missing-wiki-idle-task-queue", "Wiki idle-task queue artifact was not available.", {
      wikiIdleTasksPath,
    });
  } else {
    if (queue.ready < minReadyTasks) {
      pushFinding(findings, "warning", "thin-idle-task-queue", "Wiki idle-task queue has fewer ready read-only tasks than expected.", {
        ready: queue.ready,
        minReadyTasks,
      });
    }
    if (queue.writeCapable > 0) {
      pushFinding(findings, "error", "write-capable-idle-tasks", "Wiki idle-task queue includes write-capable work.", {
        writeCapable: queue.writeCapable,
      });
    }
    if (queue.humanApprovalClaims > 0) {
      pushFinding(findings, "warning", "human-gated-wiki-claims", "Wiki queue includes claims that require human approval.", {
        claims: queue.humanApprovalClaims,
      });
    }
  }

  const metrics = {
    runsAudited: runs.length,
    latestRunId: clean(latestRun?.runId) || null,
    latestStatus: clean(latestRun?.status) || null,
    latestCompletedAt: completedAt || null,
    latestAgeMinutes: latestAge,
    stale,
    plannedJobs: Number(latestRun?.summary?.planned || 0),
    attemptedJobs: Number(latestUtilization.attemptedJobs || 0),
    activeJobDurationMs: Number(latestUtilization.activeJobDurationMs || 0),
    runDurationMs: latestUtilization.runDurationMs ?? null,
    averageJobDurationMs: latestUtilization.averageJobDurationMs ?? null,
    longestJob: latestUtilization.longestJob || null,
    passRate,
    cleanPassedRuns,
    warningRuns,
    failedRuns,
    skippedRuns,
    repeatedProblemClusters,
    resolvedProblemIds,
    nextRecommendedJob: clean(latestUtilization.nextRecommendedJob) || null,
    idleReason: clean(latestUtilization.idleReason) || null,
    queue,
  };
  const thresholds = {
    maxAgeMinutes,
    minReadyTasks,
    minPassRate,
    maxRuns,
    includeDryRuns,
  };
  const score = calculateScore(metrics, findings, thresholds);
  const report = {
    schema: "studiobrain-idle-worker-effectivity-audit.v1",
    generatedAt: new Date().toISOString(),
    status: deriveStatus(score, findings, Boolean(options.strict)),
    strict: Boolean(options.strict),
    score,
    thresholds,
    paths: {
      runRoot,
      historyPath,
      latestPath,
      wikiIdleTasksPath,
      artifactPath,
      markdownPath,
    },
    metrics,
    findings,
  };

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  mkdirSync(dirname(markdownPath), { recursive: true });
  writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  return report;
}

function renderMarkdown(report) {
  const metrics = report.metrics;
  const lines = [
    "# Studio Brain Idle-Worker Effectivity Audit",
    "",
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status}`,
    `Score: ${report.score}`,
    "",
    "## Summary",
    "",
    `- Runs audited: ${metrics.runsAudited}`,
    `- Latest run: ${metrics.latestRunId || "unknown"} (${metrics.latestStatus || "unknown"})`,
    `- Latest age: ${metrics.latestAgeMinutes === null ? "unknown" : `${metrics.latestAgeMinutes} minutes`}`,
    `- Pass rate: ${(metrics.passRate * 100).toFixed(1)}%`,
    `- Latest jobs: ${metrics.plannedJobs} planned, ${metrics.attemptedJobs} attempted`,
    `- Queue: ${metrics.queue.ready} ready / ${metrics.queue.tasks} tasks, write-capable=${metrics.queue.writeCapable}`,
    `- Human-gated claims: ${metrics.queue.humanApprovalClaims}`,
    `- Next recommended job: ${metrics.nextRecommendedJob || "none"}`,
    "",
    "## Findings",
    "",
  ];
  if (report.findings.length === 0) {
    lines.push("- None.");
  } else {
    for (const finding of report.findings) {
      lines.push(`- ${finding.severity}: ${finding.code} - ${finding.message}`);
    }
  }
  lines.push("", "## Top Queue Tasks", "");
  for (const task of metrics.queue.topTasks) {
    lines.push(`- ${task.taskKey}: ${task.title} (${task.status}, priority ${task.priority})`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function printHumanSummary(report) {
  process.stdout.write("Studio Brain idle-worker effectivity audit\n");
  process.stdout.write(`  status: ${report.status}\n`);
  process.stdout.write(`  score: ${report.score}\n`);
  process.stdout.write(`  runs audited: ${report.metrics.runsAudited}\n`);
  process.stdout.write(`  latest: ${report.metrics.latestRunId || "unknown"} (${report.metrics.latestStatus || "unknown"})\n`);
  process.stdout.write(`  queue ready: ${report.metrics.queue.ready}\n`);
  process.stdout.write(`  human-gated claims: ${report.metrics.queue.humanApprovalClaims}\n`);
  process.stdout.write(`  artifact: ${report.paths.artifactPath}\n`);
  process.stdout.write(`  markdown: ${report.paths.markdownPath}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = auditIdleWorkerEffectivity(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHumanSummary(report);
  }
  if (report.status === "fail") process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
