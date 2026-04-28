#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");
const DEFAULT_RUN_ROOT = resolve(REPO_ROOT, "output", "studio-brain", "idle-worker");
const DEFAULT_JOBS = ["memory", "repo", "harness", "wiki"];
const DEFAULT_OUTPUT_TAIL_CHARS = 2_000;
const WIKI_MODES = new Set(["check", "refresh", "apply"]);
const JOB_ALIASES = new Map([
  ["all", DEFAULT_JOBS],
  ["memory", ["memory"]],
  ["memory-ops", ["memory"]],
  ["consolidation", ["memory"]],
  ["repo", ["repo"]],
  ["repo-health", ["repo"]],
  ["audit", ["repo"]],
  ["harness", ["harness"]],
  ["agent-harness", ["harness"]],
  ["work-packet", ["harness"]],
  ["next-work", ["harness"]],
  ["wiki", ["wiki"]],
  ["agent-wiki", ["wiki"]],
]);

function clean(value) {
  return String(value ?? "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function safeSegment(value) {
  return clean(value)
    .replace(/[^A-Za-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function toRepoRelative(path) {
  return relative(REPO_ROOT, path).replace(/\\/g, "/");
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return Math.round(parsed);
}

function parseNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return parsed;
}

function splitList(value) {
  return clean(value)
    .split(",")
    .map((entry) => clean(entry).toLowerCase())
    .filter(Boolean);
}

function profileDefaults(profile) {
  const cpuCount = Math.max(1, cpus().length || 1);
  if (profile === "overnight") {
    return {
      memoryMode: "overnight",
      memoryMaxCandidates: 240,
      memoryMaxWrites: 45,
      memoryTimeBudgetMs: 300_000,
      memoryTimeoutMs: 420_000,
      repoDepth: "standard",
      wikiMode: "check",
      commandTimeoutMs: 420_000,
      maxLoad1m: Math.max(4, Math.ceil(cpuCount * 0.85)),
      lockStaleMinutes: 360,
    };
  }

  return {
    memoryMode: "idle",
    memoryMaxCandidates: 80,
    memoryMaxWrites: 12,
    memoryTimeBudgetMs: 90_000,
    memoryTimeoutMs: 180_000,
    repoDepth: "quick",
    wikiMode: "check",
    commandTimeoutMs: 180_000,
    maxLoad1m: Math.max(2, Math.ceil(cpuCount * 0.65)),
    lockStaleMinutes: 120,
  };
}

function normalizeJobs(values) {
  const requested = values.length > 0 ? values : DEFAULT_JOBS;
  const expanded = [];
  for (const raw of requested) {
    const key = clean(raw).toLowerCase();
    const aliases = JOB_ALIASES.get(key);
    if (!aliases) {
      throw new Error(`Unknown idle worker job: ${raw}`);
    }
    expanded.push(...aliases);
  }
  return Array.from(new Set(expanded));
}

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  node ./scripts/studiobrain-idle-worker.mjs [options]",
      "",
      "Options:",
      "  --profile <idle|overnight>            Budget profile (default: idle)",
      "  --jobs <memory,repo,harness,wiki>      Job list (default: memory,repo,harness,wiki)",
      "  --job <memory|repo|harness|wiki>       Add one job; repeatable",
      "  --memory-mode <idle|overnight>         Override consolidation mode",
      "  --repo-depth <quick|standard|deep>     Repo audit depth",
      "  --wiki-mode <check|refresh|apply>      Wiki lane mode (default: check)",
      "  --dry-run                              Plan jobs without running commands",
      "  --skip-load-check                      Run even when load is above budget",
      "  --max-load-1m <n>                      Skip when 1m load average is above n",
      "  --run-id <id>                          Run identifier",
      "  --run-root <path>                      Artifact directory",
      "  --artifact <path>                      latest report path",
      "  --lock-path <path>                     lock file path",
      "  --watch                                Repeat on an interval",
      "  --interval-minutes <n>                 Watch interval (default: 240)",
      "  --max-runs <n>                         Watch loop cap",
      "  --fail-fast                            Stop after first failed job",
      "  --strict                               Exit non-zero on degraded/skipped result",
      "  --json                                 Print JSON report",
      "  -h, --help                             Show this help",
      "",
    ].join("\n"),
  );
}

export function parseArgs(argv) {
  const parsed = {
    profile: "idle",
    jobs: [],
    memoryMode: "",
    memoryMaxCandidates: 0,
    memoryMaxWrites: 0,
    memoryTimeBudgetMs: 0,
    memoryTimeoutMs: 0,
    repoDepth: "",
    wikiMode: "",
    commandTimeoutMs: 0,
    maxLoad1m: 0,
    skipLoadCheck: false,
    dryRun: false,
    json: false,
    strict: false,
    failFast: false,
    watch: false,
    intervalMinutes: 240,
    maxRuns: 1,
    runId: "",
    runRoot: DEFAULT_RUN_ROOT,
    artifact: "",
    lockPath: "",
    lockStaleMinutes: 0,
  };
  const specified = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--skip-load-check") {
      parsed.skipLoadCheck = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }
    if (arg === "--fail-fast") {
      parsed.failFast = true;
      continue;
    }
    if (arg === "--watch") {
      parsed.watch = true;
      continue;
    }

    const next = clean(argv[index + 1]);
    if (arg === "--profile") {
      if (next !== "idle" && next !== "overnight") throw new Error("--profile must be idle or overnight.");
      parsed.profile = next;
      index += 1;
      continue;
    }
    if (arg === "--jobs") {
      if (!next) throw new Error("--jobs requires a comma-separated list.");
      parsed.jobs.push(...splitList(next));
      index += 1;
      continue;
    }
    if (arg === "--job") {
      if (!next) throw new Error("--job requires a value.");
      parsed.jobs.push(next);
      index += 1;
      continue;
    }
    if (arg === "--memory-mode") {
      if (next !== "idle" && next !== "overnight") throw new Error("--memory-mode must be idle or overnight.");
      parsed.memoryMode = next;
      specified.add("memoryMode");
      index += 1;
      continue;
    }
    if (arg === "--memory-max-candidates") {
      parsed.memoryMaxCandidates = parsePositiveInteger(next, "--memory-max-candidates");
      specified.add("memoryMaxCandidates");
      index += 1;
      continue;
    }
    if (arg === "--memory-max-writes") {
      parsed.memoryMaxWrites = parsePositiveInteger(next, "--memory-max-writes");
      specified.add("memoryMaxWrites");
      index += 1;
      continue;
    }
    if (arg === "--memory-time-budget-ms") {
      parsed.memoryTimeBudgetMs = parsePositiveInteger(next, "--memory-time-budget-ms");
      specified.add("memoryTimeBudgetMs");
      index += 1;
      continue;
    }
    if (arg === "--memory-timeout-ms") {
      parsed.memoryTimeoutMs = parsePositiveInteger(next, "--memory-timeout-ms");
      specified.add("memoryTimeoutMs");
      index += 1;
      continue;
    }
    if (arg === "--repo-depth") {
      if (!["quick", "standard", "deep"].includes(next)) {
        throw new Error("--repo-depth must be quick, standard, or deep.");
      }
      parsed.repoDepth = next;
      specified.add("repoDepth");
      index += 1;
      continue;
    }
    if (arg === "--wiki-mode") {
      if (!WIKI_MODES.has(next)) {
        throw new Error("--wiki-mode must be check, refresh, or apply.");
      }
      parsed.wikiMode = next;
      specified.add("wikiMode");
      index += 1;
      continue;
    }
    if (arg === "--command-timeout-ms") {
      parsed.commandTimeoutMs = parsePositiveInteger(next, "--command-timeout-ms");
      specified.add("commandTimeoutMs");
      index += 1;
      continue;
    }
    if (arg === "--max-load-1m") {
      parsed.maxLoad1m = parseNumber(next, "--max-load-1m");
      specified.add("maxLoad1m");
      index += 1;
      continue;
    }
    if (arg === "--interval-minutes") {
      parsed.intervalMinutes = parsePositiveInteger(next, "--interval-minutes");
      index += 1;
      continue;
    }
    if (arg === "--max-runs") {
      parsed.maxRuns = parsePositiveInteger(next, "--max-runs");
      index += 1;
      continue;
    }
    if (arg === "--run-id") {
      if (!next) throw new Error("--run-id requires a value.");
      parsed.runId = next;
      index += 1;
      continue;
    }
    if (arg === "--run-root") {
      if (!next) throw new Error("--run-root requires a path.");
      parsed.runRoot = resolve(REPO_ROOT, next);
      index += 1;
      continue;
    }
    if (arg === "--artifact") {
      if (!next) throw new Error("--artifact requires a path.");
      parsed.artifact = resolve(REPO_ROOT, next);
      index += 1;
      continue;
    }
    if (arg === "--lock-path") {
      if (!next) throw new Error("--lock-path requires a path.");
      parsed.lockPath = resolve(REPO_ROOT, next);
      index += 1;
      continue;
    }
    if (arg === "--lock-stale-minutes") {
      parsed.lockStaleMinutes = parsePositiveInteger(next, "--lock-stale-minutes");
      specified.add("lockStaleMinutes");
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  const defaults = profileDefaults(parsed.profile);
  for (const [key, value] of Object.entries(defaults)) {
    if (!specified.has(key)) parsed[key] = value;
  }
  parsed.jobs = normalizeJobs(parsed.jobs);
  parsed.artifact ||= resolve(parsed.runRoot, "latest.json");
  parsed.lockPath ||= resolve(parsed.runRoot, "worker.lock.json");
  if (parsed.watch && parsed.maxRuns === 1) parsed.maxRuns = Number.MAX_SAFE_INTEGER;
  return parsed;
}

function commandDisplay(command) {
  return command.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

function branchGuardedNpmJob({ id, label, script, scriptArgs = [], scriptArtifacts = [], runRoot, timeoutMs }) {
  const guardArtifact = toRepoRelative(resolve(runRoot, `${id}.branch-guard.json`));
  const npmCommand = ["npm", "run", script];
  if (scriptArgs.length > 0) npmCommand.push("--", ...scriptArgs);
  const command = [
    "node",
    "./scripts/repo-audit-branch-guard.mjs",
    "--json",
    "--artifact",
    guardArtifact,
    "--untracked-files",
    "no",
    "--quiet-command",
    "--",
    ...npmCommand,
  ];
  return {
    id,
    label,
    category: "repo",
    command,
    timeoutMs,
    artifacts: [guardArtifact, ...scriptArtifacts],
  };
}

function buildMemoryJob(options, runId) {
  const artifact = "output/studio-brain/memory-consolidation/latest.json";
  return {
    id: "memory-consolidation",
    label: "Studio Brain memory consolidation",
    category: "memory",
    command: [
      "node",
      "./scripts/open-memory-consolidate.mjs",
      "--mode",
      options.memoryMode,
      "--run-id",
      `${runId}:memory`,
      "--max-candidates",
      String(options.memoryMaxCandidates),
      "--max-writes",
      String(options.memoryMaxWrites),
      "--time-budget-ms",
      String(options.memoryTimeBudgetMs),
      "--timeout-ms",
      String(options.memoryTimeoutMs),
      "--focus-area",
      "memory DB stats readiness consolidation review conflicts",
      "--focus-area",
      "pending compactions drained duplicate FK repair",
      "--json",
    ],
    timeoutMs: options.memoryTimeoutMs + 30_000,
    artifacts: [artifact],
  };
}

function buildRepoJobs(options) {
  const timeoutMs = options.commandTimeoutMs;
  const runRoot = options.runRoot;
  const agenticInventoryJson = toRepoRelative(resolve(runRoot, "repo-agentic-health-inventory.json"));
  const agenticInventoryMd = toRepoRelative(resolve(runRoot, "repo-agentic-health-inventory.md"));
  const ephemeralArtifactJson = toRepoRelative(resolve(runRoot, "ephemeral-artifact-tracking-guard.json"));
  const jobs = [
    branchGuardedNpmJob({
      id: "repo-agentic-health-inventory",
      label: "Repo agentic health inventory",
      script: "audit:agentic:inventory",
      scriptArgs: ["--artifact", agenticInventoryJson, "--markdown", agenticInventoryMd],
      scriptArtifacts: [agenticInventoryJson, agenticInventoryMd],
      runRoot,
      timeoutMs,
    }),
    branchGuardedNpmJob({
      id: "repo-ephemeral-artifact-guard",
      label: "Ephemeral artifact tracking guard",
      script: "guard:ephemeral:artifacts",
      scriptArgs: ["--artifact", ephemeralArtifactJson],
      scriptArtifacts: [ephemeralArtifactJson],
      runRoot,
      timeoutMs,
    }),
  ];

  if (options.repoDepth === "standard" || options.repoDepth === "deep") {
    const writeSurfaceJson = toRepoRelative(resolve(runRoot, "firestore-write-surface-inventory.json"));
    const writeSurfaceMd = toRepoRelative(resolve(runRoot, "firestore-write-surface-inventory.md"));
    const destructiveSurfaceJson = toRepoRelative(resolve(runRoot, "destructive-command-surfaces.json"));
    const destructiveSurfaceMd = toRepoRelative(resolve(runRoot, "destructive-command-surfaces.md"));
    jobs.push(
      branchGuardedNpmJob({
        id: "repo-write-surface-inventory",
        label: "Firestore/auth write surface inventory",
        script: "audit:write-surfaces",
        scriptArgs: ["--artifact", writeSurfaceJson, "--markdown", writeSurfaceMd],
        scriptArtifacts: [writeSurfaceJson, writeSurfaceMd],
        runRoot,
        timeoutMs,
      }),
      branchGuardedNpmJob({
        id: "repo-destructive-surface-audit",
        label: "Destructive command surface audit",
        script: "audit:destructive-surfaces",
        scriptArgs: ["--out-json", destructiveSurfaceJson, "--out-md", destructiveSurfaceMd],
        scriptArtifacts: [destructiveSurfaceJson, destructiveSurfaceMd],
        runRoot,
        timeoutMs,
      }),
    );
  }

  if (options.repoDepth === "deep") {
    jobs.push(
      branchGuardedNpmJob({
        id: "repo-security-history-scan",
        label: "Security history marker scan",
        script: "security:history:scan",
        runRoot,
        timeoutMs,
      }),
    );
  }

  return jobs;
}

function buildHarnessJob(options, runId) {
  const runRoot = options.runRoot;
  const timeoutMs = Math.min(options.commandTimeoutMs, 120_000);
  const nextWorkJson = "output/studio-brain/agent-harness/next-work.json";
  const metricsJson = "output/studio-brain/agent-harness/success-metrics.json";
  return branchGuardedNpmJob({
    id: "agent-harness-work-packet",
    label: "Agent harness next-work packet",
    script: "studio:ops:agent-harness",
    scriptArgs: [
      "--run-id",
      `${runId}:harness`,
      "--idle-run-root",
      toRepoRelative(runRoot),
      "--artifact",
      nextWorkJson,
      "--metrics",
      metricsJson,
    ],
    scriptArtifacts: [nextWorkJson, metricsJson],
    runRoot,
    timeoutMs,
  });
}

function wikiJobScript(mode, lane) {
  if (mode === "apply") {
    return {
      sourceIndex: "wiki:source:index:apply",
      extract: "wiki:extract:apply",
      contradictions: "wiki:contradictions:record",
      context: "wiki:context:apply",
      dbProbe: "wiki:db:probe:live",
    }[lane];
  }
  if (mode === "refresh") {
    return {
      sourceIndex: "wiki:source:index",
      extract: "wiki:extract",
      contradictions: "wiki:contradictions:export",
      context: "wiki:context:refresh",
      dbProbe: "wiki:db:probe",
    }[lane];
  }
  return {
    sourceIndex: "wiki:source:index:check",
    extract: "wiki:extract:check",
    contradictions: "wiki:contradictions:scan",
    context: "wiki:context:check",
    dbProbe: "wiki:db:probe",
  }[lane];
}

function buildWikiLaneJob({ id, label, lane, artifactName, options, timeoutMs }) {
  const artifact = toRepoRelative(resolve(options.runRoot, artifactName));
  return branchGuardedNpmJob({
    id,
    label,
    script: wikiJobScript(options.wikiMode || "check", lane),
    scriptArgs: ["--artifact", artifact],
    scriptArtifacts: [artifact],
    runRoot: options.runRoot,
    timeoutMs,
  });
}

function buildWikiJobs(options) {
  const timeoutMs = Math.min(options.commandTimeoutMs, 180_000);
  const mode = options.wikiMode || "check";
  return [
    buildWikiLaneJob({
      id: "wiki-source-index-check",
      label: mode === "check" ? "Wiki source index check" : `Wiki source index ${mode}`,
      lane: "sourceIndex",
      artifactName: "wiki-source-index.json",
      options,
      timeoutMs,
    }),
    buildWikiLaneJob({
      id: "wiki-claim-extraction-check",
      label: mode === "check" ? "Wiki claim extraction check" : `Wiki claim extraction ${mode}`,
      lane: "extract",
      artifactName: "wiki-claim-extraction.json",
      options,
      timeoutMs,
    }),
    buildWikiLaneJob({
      id: "wiki-contradiction-scan",
      label: mode === "check" ? "Wiki contradiction scan" : `Wiki contradiction ${mode}`,
      lane: "contradictions",
      artifactName: "wiki-contradictions.json",
      options,
      timeoutMs,
    }),
    buildWikiLaneJob({
      id: "wiki-context-pack-refresh",
      label: mode === "check" ? "Wiki context pack check" : `Wiki context pack ${mode}`,
      lane: "context",
      artifactName: "wiki-context-pack.json",
      options,
      timeoutMs,
    }),
    buildWikiLaneJob({
      id: "wiki-db-probe-plan",
      label: mode === "apply" ? "Wiki Postgres query probe live" : "Wiki Postgres query probe plan",
      lane: "dbProbe",
      artifactName: "wiki-db-probe.json",
      options,
      timeoutMs,
    }),
  ];
}

export function buildJobPlan(options, runId = "idle-worker-plan") {
  const jobs = [];
  if (options.jobs.includes("memory")) jobs.push(buildMemoryJob(options, runId));
  if (options.jobs.includes("repo")) jobs.push(...buildRepoJobs(options));
  if (options.jobs.includes("harness")) jobs.push(buildHarnessJob(options, runId));
  if (options.jobs.includes("wiki")) jobs.push(...buildWikiJobs(options));
  return jobs;
}

function shouldUseShell(program) {
  return process.platform === "win32" && (program === "npm" || program === "npx" || /\.(cmd|bat)$/i.test(program));
}

function clipOutput(value, maxChars = 8_000) {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

function summarizeJsonPayload(payload) {
  if (!payload || typeof payload !== "object") return {};
  const summary =
    typeof payload.summary === "string"
      ? clean(payload.summary)
      : payload.summary && typeof payload.summary === "object"
        ? JSON.stringify(payload.summary)
        : "";
  return {
    schema: clean(payload.schema || ""),
    status: clean(payload.status || ""),
    summary,
    actionabilityStatus: clean(payload.actionabilityStatus || ""),
    artifactPath: clean(payload.artifactPath || ""),
    markdownPath: clean(payload.markdownPath || ""),
    writes: Number.isFinite(Number(payload.writes)) ? Number(payload.writes) : undefined,
    promotionCount: Number.isFinite(Number(payload.promotionCount)) ? Number(payload.promotionCount) : undefined,
    quarantineCount: Number.isFinite(Number(payload.quarantineCount)) ? Number(payload.quarantineCount) : undefined,
    associationErrorCount: Array.isArray(payload.associationErrors) ? payload.associationErrors.length : undefined,
    dominanceWarningCount: Array.isArray(payload.dominanceWarnings) ? payload.dominanceWarnings.length : undefined,
  };
}

function parseWholeJson(value) {
  const text = clean(value);
  if (!text.startsWith("{") || !text.endsWith("}")) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseJsonFromText(value) {
  const whole = parseWholeJson(value);
  if (whole) return whole;
  const lines = String(value || "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trim().startsWith("{")) continue;
    const parsed = parseWholeJson(lines.slice(index).join("\n"));
    if (parsed) return parsed;
  }
  return null;
}

function nestedCommandPayload(payload) {
  if (payload?.schema !== "repo-audit-branch-guard-v1") return null;
  return parseJsonFromText(payload.command?.stdoutTail || "");
}

function payloadFromJobArtifacts(job) {
  for (const artifact of job.artifacts || []) {
    if (!String(artifact).endsWith(".json") || String(artifact).includes(".branch-guard.")) continue;
    const parsed = readJsonIfPresent(resolve(REPO_ROOT, artifact));
    if (parsed && typeof parsed === "object") return parsed;
  }
  return null;
}

function warningsFromJsonPayload(payload) {
  if (!payload || typeof payload !== "object") return [];
  const warnings = [];
  const status = clean(payload.status).toLowerCase();
  if (["warn", "warning", "passed_with_warnings"].includes(status)) {
    warnings.push(`payload status: ${status}`);
  }
  if (["fail", "failed", "error"].includes(status)) {
    warnings.push(`payload status: ${status}`);
  }
  if (Array.isArray(payload.associationErrors) && payload.associationErrors.length > 0) {
    warnings.push(`${payload.associationErrors.length} association scout error(s)`);
  }
  const actionabilityStatus = clean(payload.actionabilityStatus).toLowerCase();
  if (actionabilityStatus && !["pass", "passed", "success"].includes(actionabilityStatus)) {
    warnings.push(`actionability status: ${actionabilityStatus}`);
  }
  return warnings;
}

function runCommand(job, { runner = spawnSync } = {}) {
  const startedAt = nowIso();
  const startedMs = Date.now();
  const [program, ...args] = job.command;
  const result = runner(program, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: shouldUseShell(program),
    timeout: job.timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  const exitCode = typeof result.status === "number" ? result.status : result.error ? 1 : 0;
  const parsedJson = parseJsonFromText(result.stdout);
  const nestedJson = nestedCommandPayload(parsedJson);
  const artifactJson = parsedJson?.schema === "repo-audit-branch-guard-v1" ? payloadFromJobArtifacts(job) : null;
  const summaryPayload = nestedJson || artifactJson || parsedJson;
  const warnings = warningsFromJsonPayload(summaryPayload);
  return {
    id: job.id,
    label: job.label,
    category: job.category,
    status: exitCode === 0 ? (warnings.length > 0 ? "warning" : "passed") : "failed",
    startedAt,
    completedAt: nowIso(),
    durationMs: Date.now() - startedMs,
    exitCode,
    timedOut: Boolean(result.signal === "SIGTERM" && result.error?.message?.includes("ETIMEDOUT")),
    error: result.error ? result.error.message : "",
    warnings,
    payloadSummary: {
      ...summarizeJsonPayload(summaryPayload),
      guardStatus: parsedJson?.schema === "repo-audit-branch-guard-v1" ? clean(parsedJson.status) : undefined,
    },
    command: commandDisplay(job.command),
    artifacts: job.artifacts,
    stdoutTail: clipOutput(result.stdout, DEFAULT_OUTPUT_TAIL_CHARS),
    stderrTail: clipOutput(result.stderr, DEFAULT_OUTPUT_TAIL_CHARS),
  };
}

function readJsonIfPresent(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function acquireLock(lockPath, options) {
  mkdirSync(dirname(lockPath), { recursive: true });
  const staleMs = options.lockStaleMinutes * 60 * 1000;
  const existing = readJsonIfPresent(lockPath);
  if (existing?.createdAt) {
    const ageMs = Date.now() - Date.parse(String(existing.createdAt));
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < staleMs) {
      return {
        acquired: false,
        reason: `Another idle worker run appears active from ${existing.createdAt}.`,
        existing,
      };
    }
  }
  const lock = {
    schema: "studiobrain-idle-worker-lock-v1",
    runId: options.runId,
    pid: process.pid,
    createdAt: nowIso(),
  };
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  return { acquired: true, lock };
}

function releaseLock(lockPath, runId) {
  const existing = readJsonIfPresent(lockPath);
  if (existing?.runId === runId && existing?.pid === process.pid) {
    rmSync(lockPath, { force: true });
  }
}

function captureLoad() {
  const values = loadavg();
  const load1m = Number(values[0] || 0);
  return {
    load1m,
    load5m: Number(values[1] || 0),
    load15m: Number(values[2] || 0),
    cpuCount: Math.max(1, cpus().length || 1),
    platform: process.platform,
  };
}

function buildBaseReport(options, runId, jobs) {
  return {
    schema: "studiobrain-idle-worker-v1",
    runId,
    generatedAt: nowIso(),
    startedAt: nowIso(),
    completedAt: "",
    status: "running",
    profile: options.profile,
    dryRun: options.dryRun,
    repoRoot: REPO_ROOT,
    runRoot: options.runRoot,
    artifact: options.artifact,
    policy: {
      safeAuto: [
        "memory consolidation",
        "read-only repo inventories",
        "branch/status guarded repo audits",
        "read-only agent harness next-work packet generation",
        "wiki source/extraction/contradiction/context checks in report-only mode",
      ],
      approvalRequired: [
        "service restarts",
        "process kills",
        "database mutation or repair",
        "wiki apply mode or autonomous promotion to operational truth",
        "tracked markdown wiki refreshes unless intentionally requested",
        "deleting files outside ignored report artifacts",
        "autonomous code edits or pull requests",
      ],
    },
    wiki: {
      mode: options.wikiMode,
      reportOnly: options.wikiMode === "check",
    },
    loadGate: {
      skipped: false,
      skipLoadCheck: options.skipLoadCheck,
      maxLoad1m: options.maxLoad1m,
      observed: captureLoad(),
    },
    jobs: jobs.map((job) => ({
      id: job.id,
      label: job.label,
      category: job.category,
      status: "planned",
      command: commandDisplay(job.command),
      artifacts: job.artifacts,
      timeoutMs: job.timeoutMs,
    })),
    summary: {
      planned: jobs.length,
      passed: 0,
      warning: 0,
      failed: 0,
      skipped: 0,
    },
  };
}

function finishReport(report) {
  const statuses = report.jobs.map((job) => job.status);
  report.summary.passed = statuses.filter((status) => status === "passed").length;
  report.summary.warning = statuses.filter((status) => status === "warning").length;
  report.summary.failed = statuses.filter((status) => status === "failed").length;
  report.summary.skipped = statuses.filter((status) => status === "skipped").length;
  if (report.status === "running") {
    report.status =
      report.summary.failed > 0 ? "degraded" : report.summary.warning > 0 ? "passed_with_warnings" : "passed";
  }
  report.completedAt = nowIso();
  return report;
}

function writeReport(report, options) {
  mkdirSync(dirname(options.artifact), { recursive: true });
  writeFileSync(options.artifact, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const runPath = resolve(options.runRoot, `${safeSegment(report.runId)}.json`);
  writeFileSync(runPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export async function runIdleWorker(rawOptions, deps = {}) {
  const options = {
    ...rawOptions,
    jobs: rawOptions.jobs || DEFAULT_JOBS,
    runRoot: rawOptions.runRoot || DEFAULT_RUN_ROOT,
    wikiMode: rawOptions.wikiMode || "check",
  };
  options.runId ||= `idle-worker-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  options.artifact ||= resolve(options.runRoot, "latest.json");
  options.lockPath ||= resolve(options.runRoot, "worker.lock.json");

  const jobs = buildJobPlan(options, options.runId);
  mkdirSync(options.runRoot, { recursive: true });
  const report = buildBaseReport(options, options.runId, jobs);

  if (!options.skipLoadCheck && report.loadGate.observed.load1m > options.maxLoad1m) {
    report.status = "skipped";
    report.loadGate.skipped = true;
    report.jobs = report.jobs.map((job) => ({
      ...job,
      status: "skipped",
      reason: `load1m ${report.loadGate.observed.load1m} exceeded max ${options.maxLoad1m}`,
    }));
    finishReport(report);
    writeReport(report, options);
    return report;
  }

  if (options.dryRun) {
    report.status = "planned";
    finishReport(report);
    writeReport(report, options);
    return report;
  }

  const lockResult = acquireLock(options.lockPath, options);
  if (!lockResult.acquired) {
    report.status = "skipped";
    report.lock = lockResult;
    report.jobs = report.jobs.map((job) => ({ ...job, status: "skipped", reason: lockResult.reason }));
    finishReport(report);
    writeReport(report, options);
    return report;
  }

  try {
    const results = [];
    for (const job of jobs) {
      const result = runCommand(job, deps);
      results.push(result);
      if (result.status === "failed" && options.failFast) {
        const remaining = jobs.slice(results.length).map((remainingJob) => ({
          id: remainingJob.id,
          label: remainingJob.label,
          category: remainingJob.category,
          status: "skipped",
          reason: "fail-fast",
          command: commandDisplay(remainingJob.command),
          artifacts: remainingJob.artifacts,
        }));
        report.jobs = [...results, ...remaining];
        finishReport(report);
        writeReport(report, options);
        return report;
      }
    }
    report.jobs = results;
    finishReport(report);
    writeReport(report, options);
    return report;
  } finally {
    releaseLock(options.lockPath, options.runId);
  }
}

function printReport(report) {
  process.stdout.write(
    [
      `studio brain idle worker: ${report.status}`,
      `run: ${report.runId}`,
      `profile: ${report.profile}`,
      `jobs: ${report.summary.planned} planned, ${report.summary.passed} passed, ${report.summary.warning} warnings, ${report.summary.failed} failed, ${report.summary.skipped} skipped`,
      `artifact: ${report.artifact}`,
    ].join("\n") + "\n",
  );
  for (const job of report.jobs) {
    process.stdout.write(`- ${job.id}: ${job.status}\n`);
    if (Array.isArray(job.warnings) && job.warnings.length > 0) {
      process.stdout.write(`  warnings: ${job.warnings.join("; ")}\n`);
    }
    if (job.payloadSummary?.summary) {
      process.stdout.write(`  summary: ${job.payloadSummary.summary}\n`);
    }
  }
}

async function sleep(ms) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  let runs = 0;
  let lastReport = null;
  while (runs < options.maxRuns) {
    const runOptions = {
      ...options,
      runId:
        runs === 0 && clean(options.runId)
          ? options.runId
          : `${clean(options.runId) || "idle-worker"}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    };
    lastReport = await runIdleWorker(runOptions);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(lastReport, null, 2)}\n`);
    } else {
      printReport(lastReport);
    }
    runs += 1;
    if (!options.watch || runs >= options.maxRuns) break;
    await sleep(options.intervalMinutes * 60 * 1000);
  }

  if (options.strict && lastReport && !["passed", "planned"].includes(lastReport.status)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
