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
      "Document metadata canonical corpus export",
      "",
      "Usage:",
      "  node ./scripts/document-metadata-corpus-export.mjs \\",
      "    --run-id docs-run-001 \\",
      "    --input ./imports/documents/docs.jsonl",
      "",
      "Options:",
      "  --run-id <id>            Stable run id",
      "  --input <path>           Document metadata JSONL or JSON array file",
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

  const inputFlag = readStringFlag(flags, "input", "").trim();
  if (!inputFlag) throw new Error("--input is required");
  const inputPath = resolve(REPO_ROOT, inputFlag);

  const runRootFlag = readStringFlag(flags, "run-root", "").trim();
  const runRoot = runRootFlag ? resolve(REPO_ROOT, runRootFlag) : resolve(REPO_ROOT, "output/memory", runId);
  const resolveArtifactPath = (flagName, fallbackRelative) => {
    const provided = readStringFlag(flags, flagName, "").trim();
    return provided ? resolve(REPO_ROOT, provided) : resolve(runRoot, fallbackRelative);
  };

  const normalizedPath = resolveArtifactPath("normalized", "document-memory.jsonl");
  const normalizeReportPath = resolveArtifactPath("normalize-report", "document-normalize-report.json");
  const analysisPath = resolveArtifactPath("analysis", "document-analysis-memory.jsonl");
  const analysisReportPath = resolveArtifactPath("analysis-report", "document-analysis-report.json");
  const promotedPath = resolveArtifactPath("promoted", "document-promoted-memory.jsonl");
  const promoteReportPath = resolveArtifactPath("promote-report", "document-promote-report.json");
  const deadLetterPath = resolveArtifactPath("dead-letter", "document-promote-dead-letter.jsonl");
  const corpusDir = resolveArtifactPath("corpus-dir", "canonical-corpus");
  const corpusManifestPath = resolveArtifactPath("corpus-manifest", "canonical-corpus/manifest.json");
  const sqlitePath = resolveArtifactPath("sqlite-path", "canonical-corpus/corpus.sqlite");
  const printJson = readBoolFlag(flags, "json", false);

  const normalizeRun = runCommand(
    process.execPath,
    [
      "./scripts/document-metadata-memory-normalize.mjs",
      "--input",
      inputPath,
      "--output",
      normalizedPath,
      "--json",
    ],
    { cwd: REPO_ROOT, allowFailure: true }
  );
  if (!normalizeRun.ok) {
    throw new Error(String(normalizeRun.stderr || normalizeRun.stdout || "document normalize failed").trim());
  }
  writeJson(normalizeReportPath, JSON.parse(normalizeRun.stdout || "{}"));

  const analysisRun = runCommand(
    process.execPath,
    [
      "./scripts/document-metadata-analyze.mjs",
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
    throw new Error(String(analysisRun.stderr || analysisRun.stdout || "document analysis failed").trim());
  }

  const promoteRun = runCommand(
    process.execPath,
    [
      "./scripts/document-metadata-promote.mjs",
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
    throw new Error(String(promoteRun.stderr || promoteRun.stdout || "document promote failed").trim());
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
    throw new Error(String(corpusRun.stderr || corpusRun.stdout || "document corpus export failed").trim());
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
    schema: "document-metadata-corpus-export-report.v1",
    generatedAt: isoNow(),
    runId,
    inputPath,
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
  writeJson(resolve(runRoot, "document-corpus-export-report.json"), report);

  if (printJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write("document-metadata-corpus-export complete\n");
    process.stdout.write(`report: ${resolve(runRoot, "document-corpus-export-report.json")}\n`);
  }
}

try {
  run();
} catch (error) {
  process.stderr.write(`document-metadata-corpus-export failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
