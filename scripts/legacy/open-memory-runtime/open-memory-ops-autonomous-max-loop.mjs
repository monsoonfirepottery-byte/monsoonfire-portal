#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_OUTPUT_PATH = resolve(REPO_ROOT, "output", "open-memory", "ops-autonomous-max-loop-latest.json");

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "");
    if (!token.startsWith("--")) continue;
    const keyRaw = token.slice(2).trim();
    if (!keyRaw) continue;
    if (keyRaw.includes("=")) {
      const [left, ...rest] = keyRaw.split("=");
      flags[String(left || "").toLowerCase()] = rest.join("=");
      continue;
    }
    const next = argv[index + 1];
    if (next && !String(next).startsWith("--")) {
      flags[keyRaw.toLowerCase()] = String(next);
      index += 1;
    } else {
      flags[keyRaw.toLowerCase()] = "true";
    }
  }
  return flags;
}

function readString(flags, key, fallback = "") {
  const value = String(flags[key] ?? "").trim();
  return value || fallback;
}

function readBool(flags, key, fallback = false) {
  const raw = String(flags[key] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function readInt(flags, key, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(flags[key] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runCommand(command, { timeoutMs = 20 * 60 * 1000 } = {}) {
  const startedAt = nowIso();
  const result = spawnSync("bash", ["-lc", command], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 40 * 1024 * 1024,
    timeout: timeoutMs,
  });
  const finishedAt = nowIso();
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const combined = `${stdout}\n${stderr}`.trim();
  const ok = result.status === 0 && !result.error;

  return {
    ok,
    command,
    timeoutMs,
    startedAt,
    finishedAt,
    durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    status: result.status ?? 1,
    signal: result.signal || null,
    stdout,
    stderr,
    combined,
  };
}

function extractJsonPayload(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {}

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!(line.startsWith("{") || line.startsWith("["))) continue;
    try {
      return JSON.parse(line);
    } catch {}
  }

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
    } catch {}
  }
  return null;
}

function normalizeStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "pass" || status === "warn" || status === "fail") return status;
  return "unknown";
}

function buildAutopilotCommand({
  baseUrl,
  indexMaxWrites,
  indexCaptureWriteRetries,
  indexCaptureSpoolReplayMax,
  qosRounds,
  qosBurst,
  lifecycleAllowDropIndexes,
}) {
  const args = [
    "node ./scripts/open-memory-signal-autopilot.mjs",
    "--json true",
    "--apply true",
    `--index-max-writes ${indexMaxWrites}`,
    `--index-capture-write-retries ${indexCaptureWriteRetries}`,
    `--index-capture-spool-replay-max ${indexCaptureSpoolReplayMax}`,
    `--qos-rounds ${qosRounds}`,
    `--qos-burst ${qosBurst}`,
  ];
  if (lifecycleAllowDropIndexes) {
    args.push(`--db-index-lifecycle-allow-drop-indexes ${shellQuote(lifecycleAllowDropIndexes)}`);
  }
  if (baseUrl) {
    args.push(`--base-url ${shellQuote(baseUrl)}`);
  }
  return args.join(" ");
}

function buildLifecycleCommand({
  apply,
  minAgeHours,
  minBytes,
  maxDropPerRun,
  allowDropIndexes,
}) {
  const args = [
    "node ./scripts/open-memory-db-index-lifecycle.mjs",
    "--json true",
    apply ? "--apply true" : "--apply false",
    `--min-age-hours ${minAgeHours}`,
    `--min-bytes ${minBytes}`,
    `--max-drop-per-run ${maxDropPerRun}`,
  ];
  if (allowDropIndexes) {
    args.push(`--allow-drop-indexes ${shellQuote(allowDropIndexes)}`);
  }
  return args.join(" ");
}

function shellQuote(value) {
  return `'${String(value || "").replace(/'/g, `'\"'\"'`)}'`;
}

function summarizeCycle({
  autopilotPayload,
  dbAuditPayload,
  dbPlanPayload,
  lifecycleProbePayload,
  lifecycleApplyPayload,
}) {
  const autopilotStatus = normalizeStatus(autopilotPayload?.status);
  const dbAuditStatus = normalizeStatus(dbAuditPayload?.status);
  const dbPlanStatus = normalizeStatus(dbPlanPayload?.status);
  const lifecycleStatus = normalizeStatus(lifecycleProbePayload?.status);
  const lifecycleEligible = Number(lifecycleProbePayload?.summary?.eligibleForDrop ?? 0);
  const lifecycleDrops = Array.isArray(lifecycleApplyPayload?.actions)
    ? lifecycleApplyPayload.actions.filter((action) => action?.step === "drop-index" && action?.ok).length
    : 0;
  const indexWriteErrors = Array.isArray(autopilotPayload?.applyResults?.indexApply?.payload?.errors)
    ? autopilotPayload.applyResults.indexApply.payload.errors.length
    : 0;
  const capturesAttempted = Number(
    autopilotPayload?.applyResults?.indexApply?.payload?.totals?.capturesAttempted ?? 0
  );
  const capturesWritten = Number(
    autopilotPayload?.applyResults?.indexApply?.payload?.totals?.capturesWritten ?? 0
  );
  const qosDeferredRate = Number(autopilotPayload?.metrics?.qosDeferredRate ?? 0);
  const qosDegradedRate = Number(autopilotPayload?.metrics?.qosDegradedEmptyRate ?? 0);
  const qosInteractiveDeferredRate = Number(autopilotPayload?.metrics?.qosInteractiveDeferredRate ?? 0);
  const qosInteractiveDegradedEmptyRate = Number(autopilotPayload?.metrics?.qosInteractiveDegradedEmptyRate ?? 0);
  const actionPlan = Array.isArray(autopilotPayload?.actionPlan) ? autopilotPayload.actionPlan : [];

  const converged =
    autopilotStatus === "pass"
    && dbAuditStatus === "pass"
    && dbPlanStatus === "pass"
    && lifecycleStatus === "pass"
    && lifecycleEligible <= 0
    && lifecycleDrops <= 0
    && indexWriteErrors <= 0
    && capturesAttempted === capturesWritten
    && qosDeferredRate <= 0
    && qosDegradedRate <= 0
    && qosInteractiveDeferredRate <= 0
    && qosInteractiveDegradedEmptyRate <= 0;

  return {
    autopilotStatus,
    dbAuditStatus,
    dbPlanStatus,
    lifecycleStatus,
    lifecycleEligible,
    lifecycleDrops,
    indexWriteErrors,
    capturesAttempted,
    capturesWritten,
    qosDeferredRate,
    qosDegradedRate,
    qosInteractiveDeferredRate,
    qosInteractiveDegradedEmptyRate,
    actionPlan,
    converged,
  };
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (readBool(flags, "help", false)) {
    process.stdout.write(
      [
        "Open Memory Ops Autonomous Max Loop",
        "",
        "Usage:",
        "  node ./scripts/open-memory-ops-autonomous-max-loop.mjs --json true",
        "",
        "Options:",
        "  --max-cycles <n>                        Maximum cycles to execute (default: 12)",
        "  --converged-streak-target <n>           Stop after N consecutive converged cycles (default: 2)",
        "  --sleep-ms <n>                          Delay between cycles (default: 1500)",
        "  --index-max-writes <n>                  Autopilot index write budget (default: 140)",
        "  --qos-rounds <n>                        QoS probe rounds per cycle (default: 2)",
        "  --qos-burst <n>                         QoS burst per cycle (default: 3)",
        "  --index-capture-write-retries <n>       Base capture write retries (default: 4)",
        "  --index-capture-spool-replay-max <n>    Base spool replay max (default: 36)",
        "  --adaptive-index-control true|false     Auto-tune write budget/retries from error feedback (default: true)",
        "  --adaptive-downshift-factor <n>         Write-budget multiplier on error cycles (default: 0.65)",
        "  --adaptive-recovery-step <n>            Write-budget increment on clean cycles (default: 8)",
        "  --adaptive-min-index-max-writes <n>     Minimum adaptive write budget (default: 40)",
        "  --adaptive-max-index-capture-retries <n> Max adaptive capture retries (default: 8)",
        "  --adaptive-max-spool-replay <n>         Max adaptive spool replay (default: 80)",
        "  --lifecycle-min-age-hours <n>           Lifecycle candidate age gate (default: 3)",
        "  --lifecycle-min-bytes <n>               Lifecycle candidate minimum bytes (default: 33554432)",
        "  --lifecycle-max-drop-per-run <n>        Max lifecycle drops per apply run (default: 8)",
        "  --lifecycle-allow-drop-indexes <csv>    Optional drop allowlist for lifecycle apply",
        "  --lifecycle-apply true|false            Apply lifecycle drops when eligible (default: true)",
        "  --base-url <url>                        Optional Studio Brain base URL override",
        "  --out <path|false>                      Report path (default: output/open-memory/ops-autonomous-max-loop-latest.json)",
        "  --json true|false                       Emit JSON report (default: true)",
        "  --strict true|false                     Exit non-zero if final status != pass (default: false)",
      ].join("\n") + "\n"
    );
    return;
  }

  const startedAt = nowIso();
  const maxCycles = readInt(flags, "max-cycles", 12, { min: 1, max: 1000 });
  const convergedStreakTarget = readInt(flags, "converged-streak-target", 2, { min: 1, max: 100 });
  const sleepMs = readInt(flags, "sleep-ms", 1500, { min: 0, max: 300_000 });
  const indexMaxWrites = readInt(flags, "index-max-writes", 140, { min: 20, max: 500 });
  const baseIndexCaptureWriteRetries = readInt(flags, "index-capture-write-retries", 4, { min: 1, max: 16 });
  const baseIndexCaptureSpoolReplayMax = readInt(flags, "index-capture-spool-replay-max", 36, { min: 0, max: 400 });
  const qosRounds = readInt(flags, "qos-rounds", 2, { min: 1, max: 12 });
  const qosBurst = readInt(flags, "qos-burst", 3, { min: 1, max: 12 });
  const adaptiveIndexControl = readBool(flags, "adaptive-index-control", true);
  const adaptiveDownshiftFactorRaw = Number.parseFloat(readString(flags, "adaptive-downshift-factor", "0.65"));
  const adaptiveDownshiftFactor = Number.isFinite(adaptiveDownshiftFactorRaw)
    ? Math.max(0.2, Math.min(0.95, adaptiveDownshiftFactorRaw))
    : 0.65;
  const adaptiveRecoveryStep = readInt(flags, "adaptive-recovery-step", 8, { min: 1, max: 80 });
  const adaptiveMinIndexMaxWrites = readInt(flags, "adaptive-min-index-max-writes", 40, { min: 20, max: 240 });
  const adaptiveMaxIndexCaptureRetries = readInt(flags, "adaptive-max-index-capture-retries", 8, { min: 1, max: 24 });
  const adaptiveMaxSpoolReplay = readInt(flags, "adaptive-max-spool-replay", 80, { min: 8, max: 800 });
  const lifecycleMinAgeHours = readInt(flags, "lifecycle-min-age-hours", 3, { min: 0, max: 720 });
  const lifecycleMinBytes = readInt(flags, "lifecycle-min-bytes", 33_554_432, { min: 1_048_576, max: 5_368_709_120 });
  const lifecycleMaxDropPerRun = readInt(flags, "lifecycle-max-drop-per-run", 8, { min: 1, max: 100 });
  const lifecycleAllowDropIndexes = readString(flags, "lifecycle-allow-drop-indexes", "");
  const lifecycleApply = readBool(flags, "lifecycle-apply", true);
  const strict = readBool(flags, "strict", false);
  const outputJson = readBool(flags, "json", true);
  const baseUrl = readString(flags, "base-url", "");
  const outRaw = readString(flags, "out", DEFAULT_OUTPUT_PATH);
  const outEnabled = !["false", "0", "no", "off"].includes(outRaw.toLowerCase());
  const outPath = resolve(REPO_ROOT, outRaw || DEFAULT_OUTPUT_PATH);

  const cycles = [];
  let convergedStreak = 0;
  let stopReason = "max-cycles-reached";
  let workingIndexMaxWrites = indexMaxWrites;
  let workingIndexCaptureWriteRetries = baseIndexCaptureWriteRetries;
  let workingIndexCaptureSpoolReplayMax = baseIndexCaptureSpoolReplayMax;

  for (let cycleNumber = 1; cycleNumber <= maxCycles; cycleNumber += 1) {
    const cycleStartedAt = nowIso();
    const autopilotCommand = buildAutopilotCommand({
      baseUrl,
      indexMaxWrites: workingIndexMaxWrites,
      indexCaptureWriteRetries: workingIndexCaptureWriteRetries,
      indexCaptureSpoolReplayMax: workingIndexCaptureSpoolReplayMax,
      qosRounds,
      qosBurst,
      lifecycleAllowDropIndexes,
    });
    const autopilotRun = runCommand(autopilotCommand, { timeoutMs: 18 * 60 * 1000 });
    const autopilotPayload = extractJsonPayload(autopilotRun.stdout);

    const dbAuditRun = runCommand("node ./scripts/open-memory-db-audit.mjs --json true", { timeoutMs: 6 * 60 * 1000 });
    const dbAuditPayload = extractJsonPayload(dbAuditRun.stdout);

    const dbPlanRun = runCommand("node ./scripts/open-memory-db-query-plan-probe.mjs --json true --out false", {
      timeoutMs: 8 * 60 * 1000,
    });
    const dbPlanPayload = extractJsonPayload(dbPlanRun.stdout);

    const lifecycleProbeCommand = buildLifecycleCommand({
      apply: false,
      minAgeHours: lifecycleMinAgeHours,
      minBytes: lifecycleMinBytes,
      maxDropPerRun: lifecycleMaxDropPerRun,
      allowDropIndexes: lifecycleAllowDropIndexes,
    });
    const lifecycleProbeRun = runCommand(lifecycleProbeCommand, { timeoutMs: 5 * 60 * 1000 });
    const lifecycleProbePayload = extractJsonPayload(lifecycleProbeRun.stdout);

    let lifecycleApplyRun = null;
    let lifecycleApplyPayload = null;
    const lifecycleEligible = Number(lifecycleProbePayload?.summary?.eligibleForDrop ?? 0);
    if (lifecycleApply && lifecycleEligible > 0) {
      const lifecycleApplyCommand = buildLifecycleCommand({
        apply: true,
        minAgeHours: lifecycleMinAgeHours,
        minBytes: lifecycleMinBytes,
        maxDropPerRun: lifecycleMaxDropPerRun,
        allowDropIndexes: lifecycleAllowDropIndexes,
      });
      lifecycleApplyRun = runCommand(lifecycleApplyCommand, { timeoutMs: 8 * 60 * 1000 });
      lifecycleApplyPayload = extractJsonPayload(lifecycleApplyRun.stdout);
    }

    const summary = summarizeCycle({
      autopilotPayload,
      dbAuditPayload,
      dbPlanPayload,
      lifecycleProbePayload,
      lifecycleApplyPayload,
    });

    const adaptiveControl = {
      enabled: adaptiveIndexControl,
      before: {
        indexMaxWrites: workingIndexMaxWrites,
        indexCaptureWriteRetries: workingIndexCaptureWriteRetries,
        indexCaptureSpoolReplayMax: workingIndexCaptureSpoolReplayMax,
      },
      reason: "none",
    };
    if (adaptiveIndexControl) {
      if (summary.indexWriteErrors > 0) {
        workingIndexMaxWrites = Math.max(
          adaptiveMinIndexMaxWrites,
          Math.floor(workingIndexMaxWrites * adaptiveDownshiftFactor)
        );
        workingIndexCaptureWriteRetries = Math.min(
          adaptiveMaxIndexCaptureRetries,
          workingIndexCaptureWriteRetries + 1
        );
        workingIndexCaptureSpoolReplayMax = Math.min(
          adaptiveMaxSpoolReplay,
          workingIndexCaptureSpoolReplayMax + 8
        );
        adaptiveControl.reason = "capture-write-errors-downshift";
      } else {
        if (workingIndexMaxWrites < indexMaxWrites) {
          workingIndexMaxWrites = Math.min(indexMaxWrites, workingIndexMaxWrites + adaptiveRecoveryStep);
          adaptiveControl.reason = "clean-cycle-recovery";
        } else if (
          workingIndexCaptureWriteRetries > baseIndexCaptureWriteRetries
          || workingIndexCaptureSpoolReplayMax > baseIndexCaptureSpoolReplayMax
        ) {
          workingIndexCaptureWriteRetries = Math.max(
            baseIndexCaptureWriteRetries,
            workingIndexCaptureWriteRetries - 1
          );
          workingIndexCaptureSpoolReplayMax = Math.max(
            baseIndexCaptureSpoolReplayMax,
            workingIndexCaptureSpoolReplayMax - 4
          );
          adaptiveControl.reason = "clean-cycle-normalize";
        }
      }
    }
    adaptiveControl.after = {
      indexMaxWrites: workingIndexMaxWrites,
      indexCaptureWriteRetries: workingIndexCaptureWriteRetries,
      indexCaptureSpoolReplayMax: workingIndexCaptureSpoolReplayMax,
    };

    if (summary.converged) {
      convergedStreak += 1;
    } else {
      convergedStreak = 0;
    }

    const cycle = {
      cycleNumber,
      startedAt: cycleStartedAt,
      finishedAt: nowIso(),
      convergedStreak,
      summary,
      adaptiveControl,
      commands: {
        autopilot: {
          command: autopilotCommand,
          ok: autopilotRun.ok,
          status: autopilotRun.status,
        },
        dbAudit: {
          command: "node ./scripts/open-memory-db-audit.mjs --json true",
          ok: dbAuditRun.ok,
          status: dbAuditRun.status,
        },
        dbPlan: {
          command: "node ./scripts/open-memory-db-query-plan-probe.mjs --json true --out false",
          ok: dbPlanRun.ok,
          status: dbPlanRun.status,
        },
        lifecycleProbe: {
          command: lifecycleProbeCommand,
          ok: lifecycleProbeRun.ok,
          status: lifecycleProbeRun.status,
        },
        lifecycleApply: lifecycleApplyRun
          ? {
              command: lifecycleApplyRun.command,
              ok: lifecycleApplyRun.ok,
              status: lifecycleApplyRun.status,
            }
          : null,
      },
      payloads: {
        autopilot: autopilotPayload,
        dbAudit: dbAuditPayload,
        dbPlan: dbPlanPayload,
        lifecycleProbe: lifecycleProbePayload,
        lifecycleApply: lifecycleApplyPayload,
      },
    };
    cycles.push(cycle);

    if (convergedStreak >= convergedStreakTarget) {
      stopReason = "converged-streak-reached";
      break;
    }
    if (cycleNumber < maxCycles && sleepMs > 0) sleep(sleepMs);
  }

  const lastCycle = cycles[cycles.length - 1] || null;
  const finalStatus = lastCycle?.summary?.converged ? "pass" : "warn";
  const report = {
    schemaVersion: "1",
    startedAt,
    finishedAt: nowIso(),
    status: finalStatus,
    stopReason,
    config: {
      maxCycles,
      convergedStreakTarget,
      sleepMs,
      indexMaxWrites,
      baseIndexCaptureWriteRetries,
      baseIndexCaptureSpoolReplayMax,
      qosRounds,
      qosBurst,
      adaptiveIndexControl,
      adaptiveDownshiftFactor,
      adaptiveRecoveryStep,
      adaptiveMinIndexMaxWrites,
      adaptiveMaxIndexCaptureRetries,
      adaptiveMaxSpoolReplay,
      lifecycleMinAgeHours,
      lifecycleMinBytes,
      lifecycleMaxDropPerRun,
      lifecycleAllowDropIndexes: lifecycleAllowDropIndexes || null,
      lifecycleApply,
      baseUrl: baseUrl || null,
    },
    aggregate: {
      cyclesExecuted: cycles.length,
      convergedStreakFinal: convergedStreak,
      totalLifecycleDrops: cycles.reduce(
        (sum, cycle) => sum + Number(cycle?.summary?.lifecycleDrops ?? 0),
        0
      ),
      totalCapturesWritten: cycles.reduce(
        (sum, cycle) => sum + Number(cycle?.summary?.capturesWritten ?? 0),
        0
      ),
      totalCaptureWriteErrors: cycles.reduce(
        (sum, cycle) => sum + Number(cycle?.summary?.indexWriteErrors ?? 0),
        0
      ),
    },
    cycles,
  };

  if (outEnabled) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  if (outputJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const lines = [];
    lines.push("Open Memory Ops Autonomous Max Loop");
    lines.push(`Status: ${report.status}`);
    lines.push(`Stop reason: ${report.stopReason}`);
    lines.push(`Cycles executed: ${report.aggregate.cyclesExecuted}`);
    lines.push(`Total captures written: ${report.aggregate.totalCapturesWritten}`);
    lines.push(`Total lifecycle drops: ${report.aggregate.totalLifecycleDrops}`);
    if (outEnabled) lines.push(`Report: ${outPath}`);
    process.stdout.write(`${lines.join("\n")}\n`);
  }

  if (strict && report.status !== "pass") {
    process.exit(1);
  }
}

main();
