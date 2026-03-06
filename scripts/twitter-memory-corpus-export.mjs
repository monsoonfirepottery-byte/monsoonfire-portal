#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCliArgs,
  readBoolFlag,
  readStringFlag,
  runCommand,
  writeJson,
  isoNow,
} from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "Twitter canonical corpus export",
      "",
      "Usage:",
      "  node ./scripts/twitter-memory-corpus-export.mjs \\",
      "    --run-id twitter-run-001 \\",
      "    --input-dir ./imports/zips-extracted/twitter-.../data",
      "",
      "Options:",
      "  --run-id <id>            Stable run id",
      "  --input-dir <path>       Twitter export data directory",
      "  --run-root <path>        Artifact root (default: ./output/memory/<run-id>)",
      "  --normalized <path>      Normalized JSONL output",
      "  --normalize-report <path> Normalize report JSON output",
      "  --analysis <path>        Analysis JSONL output",
      "  --analysis-report <path> Analysis report JSON output",
      "  --promoted <path>        Promoted JSONL output",
      "  --promote-report <path>  Promote report JSON output",
      "  --dead-letter <path>     Promote dead-letter JSONL",
      "  --corpus-dir <path>      Canonical corpus directory",
      "  --corpus-manifest <path> Canonical corpus manifest",
      "  --sqlite-path <path>     SQLite output path",
      "  --json                   Print final report JSON",
    ].join("\n")
  );
}

function run() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const runId = readStringFlag(flags, "run-id", "").trim();
  if (!runId) throw new Error("--run-id is required");

  const inputDirFlag = readStringFlag(flags, "input-dir", "").trim();
  if (!inputDirFlag) throw new Error("--input-dir is required");
  const inputDir = resolve(REPO_ROOT, inputDirFlag);

  const runRootFlag = readStringFlag(flags, "run-root", "").trim();
  const runRoot = runRootFlag ? resolve(REPO_ROOT, runRootFlag) : resolve(REPO_ROOT, "output/memory", runId);
  const resolveArtifactPath = (flagName, fallbackRelative) => {
    const provided = readStringFlag(flags, flagName, "").trim();
    return provided ? resolve(REPO_ROOT, provided) : resolve(runRoot, fallbackRelative);
  };

  const normalizedPath = resolveArtifactPath("normalized", "twitter-memory.jsonl");
  const normalizeReportPath = resolveArtifactPath("normalize-report", "twitter-normalize-report.json");
  const analysisPath = resolveArtifactPath("analysis", "twitter-analysis-memory.jsonl");
  const analysisReportPath = resolveArtifactPath("analysis-report", "twitter-analysis-report.json");
  const promotedPath = resolveArtifactPath("promoted", "twitter-promoted-memory.jsonl");
  const promoteReportPath = resolveArtifactPath("promote-report", "twitter-promote-report.json");
  const deadLetterPath = resolveArtifactPath("dead-letter", "twitter-promote-dead-letter.jsonl");
  const corpusDir = resolveArtifactPath("corpus-dir", "canonical-corpus");
  const corpusManifestPath = resolveArtifactPath("corpus-manifest", "canonical-corpus/manifest.json");
  const sqlitePath = resolveArtifactPath("sqlite-path", "canonical-corpus/corpus.sqlite");
  const printJson = readBoolFlag(flags, "json", false);

  const normalizeRun = runCommand(
    process.execPath,
    [
      "./scripts/twitter-export-memory-normalize.mjs",
      "--input-dir",
      inputDir,
      "--output",
      normalizedPath,
      "--json",
    ],
    { cwd: REPO_ROOT, allowFailure: true }
  );
  if (!normalizeRun.ok) {
    throw new Error(String(normalizeRun.stderr || normalizeRun.stdout || "twitter normalize failed").trim());
  }
  writeJson(normalizeReportPath, JSON.parse(normalizeRun.stdout || "{}"));

  const analysisRun = runCommand(
    process.execPath,
    [
      "./scripts/twitter-memory-analyze.mjs",
      "--input",
      normalizedPath,
      "--output",
      analysisPath,
      "--report",
      analysisReportPath,
      "--json",
    ],
    { cwd: REPO_ROOT, allowFailure: true }
  );
  if (!analysisRun.ok) {
    throw new Error(String(analysisRun.stderr || analysisRun.stdout || "twitter analysis failed").trim());
  }

  const promoteRun = runCommand(
    process.execPath,
    [
      "./scripts/twitter-memory-promote.mjs",
      "--input",
      analysisPath,
      "--output",
      promotedPath,
      "--dead-letter",
      deadLetterPath,
      "--report",
      promoteReportPath,
      "--json",
    ],
    { cwd: REPO_ROOT, allowFailure: true }
  );
  if (!promoteRun.ok) {
    throw new Error(String(promoteRun.stderr || promoteRun.stdout || "twitter promote failed").trim());
  }

  const corpusRun = runCommand(
    process.execPath,
    [
      "./scripts/pst-memory-corpus-export.mjs",
      "--run-id",
      runId,
      "--units",
      normalizedPath,
      "--promoted",
      promotedPath,
      "--output-dir",
      corpusDir,
      "--manifest",
      corpusManifestPath,
      "--json",
    ],
    { cwd: REPO_ROOT, allowFailure: true }
  );
  if (!corpusRun.ok) {
    throw new Error(String(corpusRun.stderr || corpusRun.stdout || "twitter corpus export failed").trim());
  }

  const sqliteRun = runCommand(
    process.execPath,
    [
      "./scripts/canonical-memory-corpus-sqlite.mjs",
      "--manifest",
      corpusManifestPath,
      "--output",
      sqlitePath,
      "--json",
    ],
    { cwd: REPO_ROOT, allowFailure: true }
  );

  const report = {
    schema: "twitter-memory-corpus-export-report.v1",
    generatedAt: isoNow(),
    runId,
    inputDir,
    normalizedPath,
    normalizeReportPath,
    analysisPath,
    promotedPath,
    corpusManifestPath,
    sqlitePath,
    sqliteStatus: sqliteRun.ok ? "ok" : "failed",
    warnings: sqliteRun.ok
      ? []
      : [
          {
            stage: "sqlite",
            error: String(sqliteRun.stderr || sqliteRun.stdout || "sqlite materialization failed").trim(),
          },
        ],
  };
  writeJson(resolve(runRoot, "twitter-corpus-export-report.json"), report);

  if (printJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write("twitter-memory-corpus-export complete\n");
    process.stdout.write(`report: ${resolve(runRoot, "twitter-corpus-export-report.json")}\n`);
  }
}

try {
  run();
} catch (error) {
  process.stderr.write(`twitter-memory-corpus-export failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
