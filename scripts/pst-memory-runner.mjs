#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isoNow,
  parseCliArgs,
  readBoolFlag,
  readNumberFlag,
  readStringFlag,
  runCommand,
  writeJson,
  readJson,
  readJsonlWithRaw,
} from "./lib/pst-memory-utils.mjs";
import {
  buildContinuityArtifact,
  buildRelationshipMonitoringArtifact,
  buildRelationshipQualityArtifact,
} from "./lib/pst-memory-continuity.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "PST memory runner",
      "",
      "Usage:",
      "  node ./scripts/pst-memory-runner.mjs --pst ./imports/pst/archive.pst --run-id pst-run-001",
      "",
      "Options:",
      "  --run-id <id>                 Required stable run id",
      "  --pst <path>                  PST file path",
      "  --run-dir <path>              Run artifacts directory (default: imports/pst/runs/<run-id>)",
      "  --resume <t/f>                Resume from existing runner checkpoint (default: true)",
      "  --fresh <t/f>                 Rebuild canonical corpus outputs from scratch",
      "  --force-stage <name>          Re-run specific stage (repeatable)",
      "  --skip-extract <t/f>          Skip libratom report stage if DB exists",
      "  --extract-timeout-ms <ms>     Timeout for libratom report extraction (default: 7200000)",
      "  --libratom-memory <value>     Docker memory limit for libratom stages (default: 6g)",
      "  --libratom-memory-swap <value> Docker memory+swap ceiling for libratom stages",
      "  --libratom-cpus <value>       Docker CPU limit for libratom stages (default: 2)",
      "  --libratom-jobs <n>           ratom report concurrency (default: 1)",
      "  --chunk-size <n>              Import chunk size (default: 300)",
      "  --max-retries <n>             Import retries per chunk (default: 3)",
      "  --llm-enrich <t/f>            Enable hybrid analysis LLM enrich",
      "  --open-memory-script <path>   Custom open-memory CLI/wrapper for import stage",
      "  --reconcile-stats <t/f>       Probe open-memory stats during reconcile (default: true)",
      "  --handoff-owner <value>       Continuity handoff owner (optional)",
      "  --handoff-source-shell-id <id> Continuity source shell id (optional)",
      "  --handoff-target-shell-id <id> Continuity target shell id (optional)",
      "  --resume-hints <csv>          Continuity resume hints (comma separated)",
      "  --json                        Print final report JSON",
      "",
      "Stages:",
      "  extract_report -> export_messages -> extract_attachments -> normalize -> analyze -> promote -> import -> reconcile",
    ].join("\n")
  );
}

function relPath(absPath) {
  const rel = relative(REPO_ROOT, absPath);
  if (!rel || rel.startsWith("..")) return absPath;
  return rel;
}

function stageForced(stageName, forcedStages) {
  return forcedStages.has(stageName);
}

function appendStageStatus(checkpoint, stage, status, extra = {}) {
  checkpoint.stageStatus[stage] = {
    status,
    at: isoNow(),
    ...extra,
  };
  checkpoint.updatedAt = isoNow();
}

function runStage({
  name,
  forced,
  checkpoint,
  resume,
  command,
  args,
  env,
  timeoutMs,
}) {
  const prior = checkpoint.stageStatus[name];
  const alreadyCompleted = prior?.status === "completed";
  if (resume && alreadyCompleted && !forced) {
    return { skipped: true, reason: "already_completed" };
  }
  appendStageStatus(checkpoint, name, "running", {
    command,
    args,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : null,
    envOverrides: env || {},
  });
  const result = runCommand(command, args, {
    cwd: REPO_ROOT,
    env: env ? { ...process.env, ...env } : process.env,
    allowFailure: true,
    timeoutMs,
  });
  if (!result.ok) {
    appendStageStatus(checkpoint, name, "failed", {
      error: String(result.stderr || result.stdout || "unknown stage failure").trim(),
    });
    return { skipped: false, ok: false, result };
  }
  appendStageStatus(checkpoint, name, "completed");
  return { skipped: false, ok: true, result };
}

function saveCheckpoint(path, checkpoint) {
  writeJson(path, checkpoint);
}

function normalizeLabel(value) {
  return String(value || "").trim();
}

function parseCsvFlag(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => normalizeLabel(entry))
    .filter(Boolean);
}

function readPromotedRows(path) {
  if (!existsSync(path)) return [];
  return readJsonlWithRaw(path)
    .filter((entry) => entry.ok && entry.value && typeof entry.value === "object")
    .map((entry) => entry.value);
}

function run() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const runId = readStringFlag(flags, "run-id", "").trim();
  if (!runId) {
    throw new Error("--run-id is required");
  }
  const pstPath = resolve(REPO_ROOT, readStringFlag(flags, "pst", ""));
  if (!pstPath) {
    throw new Error("--pst is required");
  }
  const runDir = resolve(REPO_ROOT, readStringFlag(flags, "run-dir", `./imports/pst/runs/${runId}`));
  const resume = readBoolFlag(flags, "resume", true);
  const fresh = readBoolFlag(flags, "fresh", false);
  const skipExtract = readBoolFlag(flags, "skip-extract", false);
  const extractTimeoutMs = readNumberFlag(flags, "extract-timeout-ms", 7_200_000, {
    min: 60_000,
    max: 86_400_000,
  });
  const libratomMemory = readStringFlag(
    flags,
    "libratom-memory",
    process.env.LIBRATOM_DOCKER_MEMORY || "6g"
  ).trim();
  const libratomMemorySwap = readStringFlag(
    flags,
    "libratom-memory-swap",
    process.env.LIBRATOM_DOCKER_MEMORY_SWAP || ""
  ).trim();
  const libratomCpus = readStringFlag(
    flags,
    "libratom-cpus",
    process.env.LIBRATOM_DOCKER_CPUS || "2"
  ).trim();
  const libratomJobsDefault = Number.parseInt(process.env.LIBRATOM_REPORT_JOBS || "1", 10);
  const libratomJobs = readNumberFlag(
    flags,
    "libratom-jobs",
    Number.isFinite(libratomJobsDefault) && libratomJobsDefault > 0 ? libratomJobsDefault : 1,
    { min: 1, max: 32 }
  );
  const llmEnrich = readBoolFlag(flags, "llm-enrich", false);
  const reconcileStats = readBoolFlag(flags, "reconcile-stats", true);
  const chunkSize = readNumberFlag(flags, "chunk-size", 300, { min: 1, max: 500 });
  const maxRetries = readNumberFlag(flags, "max-retries", 3, { min: 0, max: 20 });
  const openMemoryScript = readStringFlag(flags, "open-memory-script", "").trim();
  const handoffOwner = readStringFlag(flags, "handoff-owner", "").trim();
  const handoffSourceShellId = readStringFlag(flags, "handoff-source-shell-id", "").trim();
  const handoffTargetShellId = readStringFlag(flags, "handoff-target-shell-id", "").trim();
  const resumeHints = parseCsvFlag(readStringFlag(flags, "resume-hints", ""));
  const printJson = readBoolFlag(flags, "json", false);
  const forceStages = new Set(
    String(flags["force-stage"] || "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
  );

  if (!existsSync(pstPath)) {
    throw new Error(`PST not found: ${pstPath}`);
  }
  if (skipExtract) {
    const assumedReportDb = resolve(runDir, "mailbox-report.sqlite3");
    if (!existsSync(assumedReportDb)) {
      throw new Error(`--skip-extract was set but report DB does not exist: ${assumedReportDb}`);
    }
  }

  const libratomEnv = {};
  if (libratomMemory) libratomEnv.LIBRATOM_DOCKER_MEMORY = libratomMemory;
  if (libratomMemorySwap) libratomEnv.LIBRATOM_DOCKER_MEMORY_SWAP = libratomMemorySwap;
  if (libratomCpus) libratomEnv.LIBRATOM_DOCKER_CPUS = libratomCpus;
  libratomEnv.LIBRATOM_REPORT_JOBS = String(libratomJobs);

  const paths = {
    reportDb: resolve(runDir, "mailbox-report.sqlite3"),
    rawMessages: resolve(runDir, "mailbox-raw-memory.jsonl"),
    attachments: resolve(runDir, "mailbox-attachments.jsonl"),
    attachmentsDeadLetter: resolve(runDir, "mailbox-attachments-dead-letter.jsonl"),
    units: resolve(runDir, "mailbox-units.jsonl"),
    unitsDeadLetter: resolve(runDir, "mailbox-units-dead-letter.jsonl"),
    analysis: resolve(runDir, "mailbox-analysis-memory.jsonl"),
    analysisDeadLetter: resolve(runDir, "mailbox-analysis-dead-letter.jsonl"),
    promoted: resolve(runDir, "mailbox-promoted-memory.jsonl"),
    promoteDeadLetter: resolve(runDir, "mailbox-promote-dead-letter.jsonl"),
    importCheckpoint: resolve(runDir, "import-checkpoint.json"),
    importLedger: resolve(runDir, "import-ledger.jsonl"),
    importDeadLetter: resolve(runDir, "import-dead-letter.jsonl"),
    runnerCheckpoint: resolve(runDir, "runner-checkpoint.json"),
    runnerReport: resolve(runDir, "runner-report.json"),
    attachmentReport: resolve(runDir, "attachment-report.json"),
    normalizeReport: resolve(runDir, "normalize-report.json"),
    analyzeReport: resolve(runDir, "analyze-report.json"),
    promoteReport: resolve(runDir, "promote-report.json"),
    importReport: resolve(runDir, "import-report.json"),
    reconcileReport: resolve(runDir, "reconcile-report.json"),
    continuityArtifact: resolve(REPO_ROOT, "./output/memory/continuity/latest.json"),
    relationshipQualityArtifact: resolve(REPO_ROOT, "./output/memory/relationship-quality/latest.json"),
    relationshipMonitoringArtifact: resolve(
      REPO_ROOT,
      "./output/memory/relationship-quality/dashboard-latest.json"
    ),
    canonicalCorpusDir: resolve(runDir, "canonical-corpus"),
    canonicalCorpusManifest: resolve(runDir, "canonical-corpus/manifest.json"),
    canonicalCorpusCheckpointDir: resolve(runDir, "canonical-corpus/checkpoints"),
    canonicalCorpusDeadLetterDir: resolve(runDir, "canonical-corpus/dead-letter"),
    canonicalCorpusRawSidecarDir: resolve(runDir, "canonical-corpus/raw-sidecars"),
    canonicalCorpusSourceIndexDir: resolve(runDir, "canonical-corpus/source-index"),
  };

  const checkpoint = readJson(paths.runnerCheckpoint, null) || {
    schema: "pst-memory-runner-checkpoint.v1",
    runId,
    createdAt: isoNow(),
    updatedAt: isoNow(),
    status: "running",
    stageStatus: {},
    paths,
  };
  checkpoint.paths = paths;
  checkpoint.runId = runId;
  checkpoint.status = "running";
  saveCheckpoint(paths.runnerCheckpoint, checkpoint);

  const stages = [
    {
      name: "extract_report",
      command: "bash",
      args: [
        "./scripts/libratom.sh",
        "report",
        "-m",
        "-o",
        relPath(paths.reportDb),
        relPath(pstPath),
      ],
      enabled: !skipExtract || !existsSync(paths.reportDb),
      env: libratomEnv,
      timeoutMs: extractTimeoutMs,
    },
    {
      name: "export_messages",
      command: "bash",
      args: [
        "./scripts/libratom-export-jsonl.sh",
        relPath(paths.reportDb),
        relPath(paths.rawMessages),
        "1200",
      ],
      enabled: true,
      env: libratomEnv,
    },
    {
      name: "extract_attachments",
      command: process.execPath,
      args: [
        "./scripts/pst-attachment-extract.mjs",
        "--report-db",
        relPath(paths.reportDb),
        "--output",
        relPath(paths.attachments),
        "--dead-letter",
        relPath(paths.attachmentsDeadLetter),
        "--report",
        relPath(paths.attachmentReport),
      ],
      enabled: true,
    },
    {
      name: "normalize",
      command: process.execPath,
      args: [
        "./scripts/pst-memory-normalize.mjs",
        "--messages",
        relPath(paths.rawMessages),
        "--attachments",
        relPath(paths.attachments),
        "--output",
        relPath(paths.units),
        "--dead-letter",
        relPath(paths.unitsDeadLetter),
        "--report",
        relPath(paths.normalizeReport),
        "--run-id",
        runId,
      ],
      enabled: true,
    },
    {
      name: "analyze",
      command: process.execPath,
      args: [
        "./scripts/pst-memory-analyze-hybrid.mjs",
        "--input",
        relPath(paths.units),
        "--output",
        relPath(paths.analysis),
        "--dead-letter",
        relPath(paths.analysisDeadLetter),
        "--report",
        relPath(paths.analyzeReport),
        "--llm-enrich",
        llmEnrich ? "true" : "false",
      ],
      enabled: true,
    },
    {
      name: "promote",
      command: process.execPath,
      args: [
        "./scripts/pst-memory-promote.mjs",
        "--input",
        relPath(paths.analysis),
        "--output",
        relPath(paths.promoted),
        "--dead-letter",
        relPath(paths.promoteDeadLetter),
        "--report",
        relPath(paths.promoteReport),
      ],
      enabled: true,
    },
    {
      name: "import",
      command: process.execPath,
      args: [
        "./scripts/pst-memory-import-resumable.mjs",
        "--input",
        relPath(paths.promoted),
        "--run-id",
        runId,
        "--chunk-size",
        String(chunkSize),
        "--max-retries",
        String(maxRetries),
        "--checkpoint",
        relPath(paths.importCheckpoint),
        "--ledger",
        relPath(paths.importLedger),
        "--dead-letter",
        relPath(paths.importDeadLetter),
        "--report",
        relPath(paths.importReport),
        ...(openMemoryScript ? ["--open-memory-script", openMemoryScript] : []),
      ],
      enabled: true,
    },
    {
      name: "reconcile",
      command: process.execPath,
      args: [
        "./scripts/pst-memory-reconcile.mjs",
        "--run-id",
        runId,
        "--checkpoint",
        relPath(paths.importCheckpoint),
        "--ledger",
        relPath(paths.importLedger),
        "--dead-letter",
        relPath(paths.importDeadLetter),
        "--report",
        relPath(paths.reconcileReport),
        "--stats",
        reconcileStats ? "true" : "false",
      ],
      enabled: true,
    },
  ];

  for (const stage of stages) {
    if (!stage.enabled) {
      appendStageStatus(checkpoint, stage.name, "skipped", { reason: "stage_disabled" });
      saveCheckpoint(paths.runnerCheckpoint, checkpoint);
      continue;
    }
    const forced = stageForced(stage.name, forceStages);
    const result = runStage({
      name: stage.name,
      forced,
      checkpoint,
      resume,
      command: stage.command,
      args: stage.args,
      env: stage.env,
      timeoutMs: stage.timeoutMs,
    });
    saveCheckpoint(paths.runnerCheckpoint, checkpoint);
    if (result.ok === false) {
      checkpoint.status = "failed";
      checkpoint.updatedAt = isoNow();
      saveCheckpoint(paths.runnerCheckpoint, checkpoint);
      const report = {
        schema: "pst-memory-runner-report.v1",
        generatedAt: isoNow(),
        runId,
        status: "failed",
        failedStage: stage.name,
        checkpointPath: paths.runnerCheckpoint,
        stageStatus: checkpoint.stageStatus,
      };
      writeJson(paths.runnerReport, report);
      if (printJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      else {
        process.stderr.write(`pst-memory-runner failed at stage: ${stage.name}\n`);
        process.stderr.write(`checkpoint: ${paths.runnerCheckpoint}\n`);
      }
      process.exit(1);
    }
  }

  checkpoint.status = "completed";
  checkpoint.updatedAt = isoNow();
  saveCheckpoint(paths.runnerCheckpoint, checkpoint);
  const report = {
    schema: "pst-memory-runner-report.v1",
    generatedAt: isoNow(),
    runId,
    status: "completed",
    checkpointPath: paths.runnerCheckpoint,
    runnerReportPath: paths.runnerReport,
    stageStatus: checkpoint.stageStatus,
    paths,
    options: {
      resume,
      skipExtract,
      extractTimeoutMs,
      libratomMemory,
      libratomMemorySwap,
      libratomCpus,
      libratomJobs,
      llmEnrich,
      chunkSize,
      maxRetries,
      handoffOwner: handoffOwner || null,
      handoffSourceShellId: handoffSourceShellId || null,
      handoffTargetShellId: handoffTargetShellId || null,
      resumeHints,
    },
  };
  const promotedRows = readPromotedRows(paths.promoted);
  const generatedAt = isoNow();
  const relationshipQualityArtifact = buildRelationshipQualityArtifact({
    runId,
    promotedRows,
    generatedAt,
  });
  const continuityArtifact = buildContinuityArtifact({
    runId,
    promotedRows,
    generatedAt,
    handoffOwner,
    handoffSourceShellId,
    handoffTargetShellId,
    resumeHints,
  });
  const relationshipMonitoringArtifact = buildRelationshipMonitoringArtifact({
    runId,
    generatedAt,
    relationshipQualityArtifact,
    continuityArtifact,
  });
  const canonicalCorpusExport = runCommand(
    process.execPath,
    [
      "./scripts/pst-memory-corpus-export.mjs",
      "--run-id",
      runId,
      "--units",
      relPath(paths.units),
      "--promoted",
      relPath(paths.promoted),
      "--output-dir",
      relPath(paths.canonicalCorpusDir),
      "--manifest",
      relPath(paths.canonicalCorpusManifest),
      "--checkpoint-dir",
      relPath(paths.canonicalCorpusCheckpointDir),
      "--dead-letter-dir",
      relPath(paths.canonicalCorpusDeadLetterDir),
      "--raw-sidecar-dir",
      relPath(paths.canonicalCorpusRawSidecarDir),
      "--resume",
      resume ? "true" : "false",
      "--fresh",
      fresh ? "true" : "false",
      "--json",
    ],
    { cwd: REPO_ROOT, allowFailure: true }
  );
  const canonicalCorpusManifest = readJson(paths.canonicalCorpusManifest, null);
  writeJson(paths.relationshipQualityArtifact, relationshipQualityArtifact);
  writeJson(paths.continuityArtifact, continuityArtifact);
  writeJson(paths.relationshipMonitoringArtifact, relationshipMonitoringArtifact);
  report.artifacts = {
    continuity: paths.continuityArtifact,
    relationshipQuality: paths.relationshipQualityArtifact,
    relationshipMonitoring: paths.relationshipMonitoringArtifact,
  };
  if (canonicalCorpusExport.ok && canonicalCorpusManifest) {
    report.artifacts.canonicalCorpus = {
      dir: paths.canonicalCorpusDir,
      manifest: paths.canonicalCorpusManifest,
      status: canonicalCorpusManifest.status || "completed",
      checkpointDir: paths.canonicalCorpusCheckpointDir,
      deadLetterDir: paths.canonicalCorpusDeadLetterDir,
      rawSidecarDir: paths.canonicalCorpusRawSidecarDir,
      sourceIndexDir: paths.canonicalCorpusSourceIndexDir,
      resumeMode: canonicalCorpusManifest.resumeMode || (fresh ? "fresh" : resume ? "resume" : "fresh-start"),
      freshWipePerformed: Boolean(canonicalCorpusManifest.freshWipePerformed),
    };
    if (canonicalCorpusManifest.status && canonicalCorpusManifest.status !== "completed") {
      report.warnings = [
        ...(Array.isArray(report.warnings) ? report.warnings : []),
        {
          artifact: "canonicalCorpus",
          status: canonicalCorpusManifest.status,
          message: "canonical corpus export finished without a clean completed status",
        },
      ];
    }
  } else {
    report.warnings = [
      ...(Array.isArray(report.warnings) ? report.warnings : []),
      {
        artifact: "canonicalCorpus",
        error: String(canonicalCorpusExport.stderr || canonicalCorpusExport.stdout || "export failed").trim(),
      },
    ];
  }
  writeJson(paths.runnerReport, report);
  if (printJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write("pst-memory-runner complete\n");
    process.stdout.write(`run-id: ${runId}\n`);
    process.stdout.write(`checkpoint: ${paths.runnerCheckpoint}\n`);
    process.stdout.write(`report: ${paths.runnerReport}\n`);
    process.stdout.write(`continuity: ${paths.continuityArtifact}\n`);
    process.stdout.write(`relationship-quality: ${paths.relationshipQualityArtifact}\n`);
    process.stdout.write(`relationship-monitoring: ${paths.relationshipMonitoringArtifact}\n`);
    if (canonicalCorpusExport.ok) {
      process.stdout.write(`canonical-corpus: ${paths.canonicalCorpusManifest}\n`);
    } else {
      process.stdout.write("canonical-corpus: export failed (see runner report warnings)\n");
    }
  }
}

try {
  run();
} catch (error) {
  process.stderr.write(`pst-memory-runner failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
