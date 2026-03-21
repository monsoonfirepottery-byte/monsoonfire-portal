#!/usr/bin/env node

import { readFileSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCliArgs,
  readBoolFlag,
  readNumberFlag,
  readStringFlag,
  writeJson,
  isoNow,
} from "./lib/pst-memory-utils.mjs";
import {
  DEFAULT_MARKDOWN_EXCLUDE_PATTERNS,
  buildContextSignals,
  chunkMarkdownDocument,
  detectPoisoning,
  extractStructuredCandidates,
  inferProjectLane,
  listGitTrackedMarkdownPaths,
  normalizeLine,
  redactLikelySecrets,
  stableContentHash,
} from "./lib/hybrid-memory-utils.mjs";
import {
  defaultRunRoot,
  joinRunPath,
  loadFactRecordsBySourceId,
  runCanonicalCorpusPipeline,
  writeJsonlFile,
} from "./lib/hybrid-memory-pipeline-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "Repo markdown canonical corpus export",
      "",
      "Usage:",
      "  node ./scripts/repo-markdown-corpus-export.mjs --run-id repo-md-run-001",
      "",
      "Options:",
      "  --run-id <id>              Stable run id",
      "  --repo-root <path>         Repo root to scan (default: current repo)",
      "  --run-root <path>          Artifact root (default: ./output/memory/<run-id>)",
      "  --units <path>             Source-unit JSONL output",
      "  --promoted <path>          Promoted JSONL output",
      "  --adapter-output <path>    Studio Brain adapter JSONL output",
      "  --corpus-dir <path>        Canonical corpus directory",
      "  --corpus-manifest <path>   Canonical corpus manifest",
      "  --sqlite-path <path>       SQLite output path",
      "  --max-files <n>            Optional cap on markdown files",
      "  --max-chunks <n>           Optional cap on chunks",
      "  --max-section-chars <n>    Max chars per markdown section chunk (default: 2200)",
      "  --skip-sqlite <t/f>        Skip SQLite materialization",
      "  --json                     Print final report JSON",
    ].join("\n")
  );
}

function defaultArtifact(runRoot, flagValue, relativePath) {
  return flagValue ? resolve(REPO_ROOT, flagValue) : joinRunPath(runRoot, relativePath);
}

function scoreForSummary(headingPath, summary) {
  const text = `${headingPath} ${summary}`.toLowerCase();
  if (/\b(decision|approved|final|confirmed)\b/.test(text)) return 0.92;
  if (/\b(open loop|pending|follow up|todo|next step|blocked)\b/.test(text)) return 0.9;
  if (/\b(runbook|contract|schema|policy)\b/.test(text)) return 0.84;
  return 0.78;
}

function baseMetadata({
  lane,
  docPath,
  headingPath,
  chunkId,
  contentHash,
  sourceClientRequestId,
  sourceClientRequestIds,
  occurredAt,
  summary,
}) {
  const contextSignals = buildContextSignals(summary);
  const patternHints = [`lane:${lane}`, `doc:${docPath}`, `heading:${headingPath}`];
  if (contextSignals.urgentLike) patternHints.push("priority:urgent");
  if (contextSignals.reopenedLike) patternHints.push("state:reopened");
  if (contextSignals.correctionLike) patternHints.push("state:superseded");
  if (contextSignals.decisionLike && !contextSignals.blockerLike) patternHints.push("state:resolved");
  if (contextSignals.actionLike || contextSignals.blockerLike) patternHints.push("state:open-loop");
  return {
    projectLane: lane,
    docPath,
    headingPath,
    chunkId,
    contentHash,
    sourceClientRequestId,
    sourceClientRequestIds,
    sourceFamily: "repo-markdown",
    sourceKind: "markdown-section",
    contextSignals,
    patternHints,
    confidence: scoreForSummary(headingPath, summary),
    memoryLayer: "semantic",
    importance: 0.82,
    sourceCapturedAt: occurredAt,
  };
}

function buildAdapterRows({ promotedRows, manifestPath, runId }) {
  const { facts, sourceUnits } = loadFactRecordsBySourceId(manifestPath);
  const adapterRows = [];
  for (const row of promotedRows) {
    const fact = facts.get(String(row.clientRequestId || "").trim());
    if (!fact) continue;
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const sourceId = String(metadata.sourceClientRequestId || "").trim();
    const sourceUnit = sourceId ? sourceUnits.get(sourceId) : null;
    adapterRows.push({
      content: row.content,
      source: "repo-markdown",
      tags: Array.isArray(row.tags) ? row.tags : [],
      metadata: {
        ...metadata,
        corpusRecordId: fact.id,
        corpusRecordType: "fact_event",
        corpusSourceUnitId: sourceUnit?.id || null,
        corpusManifestPath: manifestPath,
        corpusRunId: runId,
      },
      agentId: "agent:repo-markdown",
      runId: `repo-markdown:${metadata.projectLane || "unknown"}`.slice(0, 128),
      clientRequestId: String(row.clientRequestId || "").trim() || undefined,
      occurredAt: typeof row.occurredAt === "string" ? row.occurredAt : undefined,
      status: "accepted",
      memoryType: "semantic",
      sourceConfidence: Number(metadata.confidence || 0.84),
      importance: Number(metadata.importance || 0.82),
    });
  }
  return adapterRows;
}

function run() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const runId = readStringFlag(flags, "run-id", "").trim();
  if (!runId) throw new Error("--run-id is required");

  const repoRoot = resolve(REPO_ROOT, readStringFlag(flags, "repo-root", "."));
  const runRoot = defaultArtifact(defaultRunRoot(runId), readStringFlag(flags, "run-root", "").trim(), "");
  const unitsPath = defaultArtifact(runRoot, readStringFlag(flags, "units", "").trim(), "repo-markdown-units.jsonl");
  const promotedPath = defaultArtifact(runRoot, readStringFlag(flags, "promoted", "").trim(), "repo-markdown-promoted.jsonl");
  const adapterOutputPath = defaultArtifact(runRoot, readStringFlag(flags, "adapter-output", "").trim(), "repo-markdown-adapter.jsonl");
  const corpusDir = defaultArtifact(runRoot, readStringFlag(flags, "corpus-dir", "").trim(), "canonical-corpus");
  const manifestPath = defaultArtifact(runRoot, readStringFlag(flags, "corpus-manifest", "").trim(), "canonical-corpus/manifest.json");
  const sqlitePath = defaultArtifact(runRoot, readStringFlag(flags, "sqlite-path", "").trim(), "canonical-corpus/corpus.sqlite");
  const maxFiles = readNumberFlag(flags, "max-files", 0, { min: 0 });
  const maxChunks = readNumberFlag(flags, "max-chunks", 0, { min: 0 });
  const maxSectionChars = readNumberFlag(flags, "max-section-chars", 2200, { min: 400, max: 20_000 });
  const skipSQLite = readBoolFlag(flags, "skip-sqlite", false);
  const printJson = readBoolFlag(flags, "json", false);

  const units = [];
  const promoted = [];
  const seenPromoted = new Set();
  const markdownPaths = listGitTrackedMarkdownPaths(repoRoot, { excludePatterns: DEFAULT_MARKDOWN_EXCLUDE_PATTERNS });
  const limitedPaths = maxFiles > 0 ? markdownPaths.slice(0, maxFiles) : markdownPaths;

  let filesScanned = 0;
  let chunksEmitted = 0;
  let quarantined = 0;

  for (const relativePath of limitedPaths) {
    const absolutePath = resolve(repoRoot, relativePath);
    const raw = readFileSync(absolutePath, "utf8");
    const stats = statSync(absolutePath);
    const lane = inferProjectLane({ text: raw.slice(0, 4000), title: basename(relativePath), path: relativePath });
    const chunks = chunkMarkdownDocument(raw, { docPath: relativePath, maxChars: maxSectionChars });
    filesScanned += 1;

    for (const chunk of chunks) {
      if (maxChunks > 0 && chunksEmitted >= maxChunks) break;
      const cleanedText = redactLikelySecrets(chunk.text);
      if (!cleanedText || detectPoisoning(cleanedText)) {
        quarantined += 1;
        continue;
      }
      const occurredAt = stats.mtime.toISOString();
      const unitClientRequestId = `repo-md-src-${stableContentHash(`${relativePath}|${chunk.chunkId}`, 24)}`;
      const unitMetadata = {
        projectLane: lane,
        docPath: relativePath,
        headingPath: chunk.headingPath,
        chunkId: chunk.chunkId,
        contentHash: chunk.contentHash,
        sectionLevel: chunk.level,
        title: basename(relativePath),
        sectionSummary: chunk.summary,
        corpusFamily: "repo-markdown",
      };
      units.push({
        content: cleanedText,
        source: "repo-markdown",
        tags: ["repo-markdown", lane, "markdown", "full-text"],
        metadata: unitMetadata,
        clientRequestId: unitClientRequestId,
        unitId: chunk.chunkId,
        occurredAt,
      });

      const summary = normalizeLine(chunk.summary || chunk.headingPath);
      if (summary) {
        const metadata = baseMetadata({
          lane,
          docPath: relativePath,
          headingPath: chunk.headingPath,
          chunkId: chunk.chunkId,
          contentHash: chunk.contentHash,
          sourceClientRequestId: unitClientRequestId,
          sourceClientRequestIds: [unitClientRequestId],
          occurredAt,
          summary,
        });
        const clientRequestId = `repo-md-prom-${stableContentHash(`${unitClientRequestId}|summary`, 24)}`;
        const dedupeKey = `${metadata.projectLane}|${summary.toLowerCase()}`;
        if (!seenPromoted.has(dedupeKey)) {
          seenPromoted.add(dedupeKey);
          promoted.push({
            content: `Doc summary: ${summary}`,
            source: "repo-markdown",
            tags: ["repo-markdown", "summary", lane],
            metadata: {
              ...metadata,
              analysisType: "markdown_section_summary",
              sourceClientRequestId: unitClientRequestId,
              sourceClientRequestIds: [unitClientRequestId],
            },
            clientRequestId,
            occurredAt,
          });
        }
      }

      for (const candidate of extractStructuredCandidates(cleanedText, { title: chunk.headingPath, maxCandidates: 4 })) {
        const metadata = {
          ...baseMetadata({
            lane,
            docPath: relativePath,
            headingPath: chunk.headingPath,
            chunkId: chunk.chunkId,
            contentHash: chunk.contentHash,
            sourceClientRequestId: unitClientRequestId,
            sourceClientRequestIds: [unitClientRequestId],
            occurredAt,
            summary: candidate.summary,
          }),
          analysisType: candidate.analysisType,
          contextSignals: candidate.contextSignals,
          patternHints: Array.from(new Set([...(candidate.patternHints || []), `lane:${lane}`, `doc:${relativePath}`])),
          confidence: candidate.score,
        };
        const dedupeKey = `${candidate.kind}|${relativePath}|${candidate.summary.toLowerCase()}`;
        if (seenPromoted.has(dedupeKey)) continue;
        seenPromoted.add(dedupeKey);
        promoted.push({
          content: candidate.summary,
          source: "repo-markdown",
          tags: ["repo-markdown", lane, candidate.kind],
          metadata,
          clientRequestId: `repo-md-prom-${stableContentHash(`${unitClientRequestId}|${candidate.kind}|${candidate.summary}`, 24)}`,
          occurredAt,
        });
      }

      chunksEmitted += 1;
    }
    if (maxChunks > 0 && chunksEmitted >= maxChunks) break;
  }

  writeJsonlFile(unitsPath, units);
  writeJsonlFile(promotedPath, promoted);

  const corpusResult = runCanonicalCorpusPipeline({
    repoRoot: REPO_ROOT,
    runId,
    unitsPath,
    promotedPath,
    outputDir: corpusDir,
    manifestPath,
    sqlitePath,
    skipSQLite,
  });

  const adapterRows = buildAdapterRows({ promotedRows: promoted, manifestPath, runId });
  writeJsonlFile(adapterOutputPath, adapterRows);

  const report = {
    schema: "repo-markdown-corpus-export-report.v1",
    generatedAt: isoNow(),
    runId,
    repoRoot,
    unitsPath,
    promotedPath,
    adapterOutputPath,
    manifestPath,
    sqlitePath,
    counts: {
      filesScanned,
      markdownFiles: limitedPaths.length,
      sourceUnits: units.length,
      promoted: promoted.length,
      adapterRows: adapterRows.length,
      chunksEmitted,
      quarantined,
    },
    sqliteStatus: corpusResult.sqliteStatus,
    warnings: corpusResult.warnings,
  };
  writeJson(joinRunPath(runRoot, "repo-markdown-corpus-export-report.json"), report);

  if (printJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write("repo-markdown-corpus-export complete\n");
    process.stdout.write(`report: ${joinRunPath(runRoot, "repo-markdown-corpus-export-report.json")}\n`);
  }
}

try {
  run();
} catch (error) {
  process.stderr.write(`repo-markdown-corpus-export failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
