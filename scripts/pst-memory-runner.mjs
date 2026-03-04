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
      "  --force-stage <name>          Re-run specific stage (repeatable)",
      "  --skip-extract <t/f>          Skip libratom report stage if DB exists",
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
}) {
  const prior = checkpoint.stageStatus[name];
  const alreadyCompleted = prior?.status === "completed";
  if (resume && alreadyCompleted && !forced) {
    return { skipped: true, reason: "already_completed" };
  }
  appendStageStatus(checkpoint, name, "running", { command, args });
  const result = runCommand(command, args, { cwd: REPO_ROOT, allowFailure: true });
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
  const skipExtract = readBoolFlag(flags, "skip-extract", false);
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
  writeJson(paths.relationshipQualityArtifact, relationshipQualityArtifact);
  writeJson(paths.continuityArtifact, continuityArtifact);
  writeJson(paths.relationshipMonitoringArtifact, relationshipMonitoringArtifact);
  report.artifacts = {
    continuity: paths.continuityArtifact,
    relationshipQuality: paths.relationshipQualityArtifact,
    relationshipMonitoring: paths.relationshipMonitoringArtifact,
  };
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
  }
}

try {
  run();
} catch (error) {
  process.stderr.write(`pst-memory-runner failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
