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
      "Mail canonical corpus export",
      "",
      "Usage:",
      "  node ./scripts/mail-memory-corpus-export.mjs \\",
      "    --run-id mail-run-001 \\",
      "    --snapshot ./imports/mail/runs/mail-run-001/mail-memory-outlook-snapshot.jsonl",
      "",
      "Options:",
      "  --run-id <id>            Stable run id",
      "  --snapshot <path>        Mail snapshot JSONL from open-memory-mail-import",
      "  --run-root <path>        Artifact root (default: parent dir of snapshot)",
      "  --analysis <path>        Analysis JSONL output",
      "  --analysis-report <path> Analysis report JSON output",
      "  --promoted <path>        Promoted JSONL output",
      "  --promote-report <path>  Promote report JSON output",
      "  --dead-letter <path>     Promote dead-letter JSONL",
      "  --ground-message-insights true|false  Improve message_insight evidence grounding during promotion",
      "  --strict-message-insights true|false  Demote weak semantic message_insight rows",
      "  --ground-contact-facts true|false    Improve contact_fact evidence grounding during promotion",
      "  --strict-contact-facts true|false    Demote weak semantic contact_fact rows",
      "  --ground-relationship-rhythms true|false  Improve relationship_rhythm evidence grounding during promotion",
      "  --strict-relationship-rhythms true|false  Demote weak semantic relationship_rhythm rows",
      "  --corpus-dir <path>      Canonical corpus directory",
      "  --corpus-manifest <path> Canonical corpus manifest",
      "  --sqlite-path <path>     Optional SQLite output path",
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

  const snapshotPath = resolve(REPO_ROOT, readStringFlag(flags, "snapshot", ""));
  if (!readStringFlag(flags, "snapshot", "").trim()) throw new Error("--snapshot is required");

  const runRootFlag = readStringFlag(flags, "run-root", "").trim();
  const runRoot = runRootFlag ? resolve(REPO_ROOT, runRootFlag) : dirname(snapshotPath);
  const resolveArtifactPath = (flagName, fallbackRelative) => {
    const provided = readStringFlag(flags, flagName, "").trim();
    return provided ? resolve(REPO_ROOT, provided) : resolve(runRoot, fallbackRelative);
  };
  const analysisPath = resolveArtifactPath("analysis", "mail-analysis-memory.jsonl");
  const analysisReportPath = resolveArtifactPath("analysis-report", "mail-analysis-report.json");
  const promotedPath = resolveArtifactPath("promoted", "mail-promoted-memory.jsonl");
  const promoteReportPath = resolveArtifactPath("promote-report", "mail-promote-report.json");
  const deadLetterPath = resolveArtifactPath("dead-letter", "mail-promote-dead-letter.jsonl");
  const corpusDir = resolveArtifactPath("corpus-dir", "canonical-corpus");
  const corpusManifestPath = resolveArtifactPath("corpus-manifest", "canonical-corpus/manifest.json");
  const sqlitePath = resolveArtifactPath("sqlite-path", "canonical-corpus/corpus.sqlite");
  const groundMessageInsights = readBoolFlag(flags, "ground-message-insights", false);
  const strictMessageInsights = readBoolFlag(flags, "strict-message-insights", false);
  const groundContactFacts = readBoolFlag(flags, "ground-contact-facts", false);
  const strictContactFacts = readBoolFlag(flags, "strict-contact-facts", false);
  const groundRelationshipRhythms = readBoolFlag(flags, "ground-relationship-rhythms", false);
  const strictRelationshipRhythms = readBoolFlag(flags, "strict-relationship-rhythms", false);
  const printJson = readBoolFlag(flags, "json", false);

  const analysisRun = runCommand(
    process.execPath,
    [
      "./scripts/pst-memory-analyze-hybrid.mjs",
      "--input",
      snapshotPath,
      "--output",
      analysisPath,
      "--report",
      analysisReportPath,
      "--json",
    ],
    { cwd: REPO_ROOT, allowFailure: true }
  );
  if (!analysisRun.ok) {
    throw new Error(String(analysisRun.stderr || analysisRun.stdout || "mail analysis failed").trim());
  }

  const promoteRun = runCommand(
    process.execPath,
    [
      "./scripts/pst-memory-promote.mjs",
      "--input",
      analysisPath,
      "--output",
      promotedPath,
      "--dead-letter",
      deadLetterPath,
      "--report",
      promoteReportPath,
      "--source",
      "mail:promoted-memory",
      "--json",
      ...(groundMessageInsights ? ["--ground-message-insights"] : []),
      ...(strictMessageInsights ? ["--strict-message-insights"] : []),
      ...(groundContactFacts ? ["--ground-contact-facts"] : []),
      ...(strictContactFacts ? ["--strict-contact-facts"] : []),
      ...(groundRelationshipRhythms ? ["--ground-relationship-rhythms"] : []),
      ...(strictRelationshipRhythms ? ["--strict-relationship-rhythms"] : []),
    ],
    { cwd: REPO_ROOT, allowFailure: true }
  );
  if (!promoteRun.ok) {
    throw new Error(String(promoteRun.stderr || promoteRun.stdout || "mail promote failed").trim());
  }

  const corpusRun = runCommand(
    process.execPath,
    [
      "./scripts/pst-memory-corpus-export.mjs",
      "--run-id",
      runId,
      "--units",
      snapshotPath,
      "--promoted",
      promotedPath,
      "--output-dir",
      corpusDir,
      "--manifest",
      corpusManifestPath,
      "--allow-empty-promoted",
      "true",
      "--json",
    ],
    { cwd: REPO_ROOT, allowFailure: true }
  );
  if (!corpusRun.ok) {
    throw new Error(String(corpusRun.stderr || corpusRun.stdout || "mail corpus export failed").trim());
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
    schema: "mail-memory-corpus-export-report.v1",
    generatedAt: isoNow(),
    runId,
    snapshotPath,
    analysisPath,
    promotedPath,
    corpusManifestPath,
    sqlitePath,
    sqliteStatus: sqliteRun.ok ? "ok" : "failed",
    options: {
      groundMessageInsights,
      strictMessageInsights,
      groundContactFacts,
      strictContactFacts,
      groundRelationshipRhythms,
      strictRelationshipRhythms,
    },
    warnings: sqliteRun.ok
      ? []
      : [
          {
            stage: "sqlite",
            error: String(sqliteRun.stderr || sqliteRun.stdout || "sqlite materialization failed").trim(),
          },
        ],
  };
  writeJson(resolve(runRoot, "mail-corpus-export-report.json"), report);

  if (printJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write("mail-memory-corpus-export complete\n");
    process.stdout.write(`report: ${resolve(runRoot, "mail-corpus-export-report.json")}\n`);
  }
}

try {
  run();
} catch (error) {
  process.stderr.write(`mail-memory-corpus-export failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
