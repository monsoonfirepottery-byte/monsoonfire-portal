#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
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
  buildContextSignals,
  classifyDevelopmentScope,
  detectPoisoning,
  extractStructuredCandidates,
  inferProjectLane,
  normalizeHybridText,
  redactLikelySecrets,
  stableContentHash,
} from "./lib/hybrid-memory-utils.mjs";
import {
  codexPath,
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
      "Codex resumable-session canonical corpus export",
      "",
      "Usage:",
      "  node ./scripts/codex-session-corpus-export.mjs --run-id codex-sessions-001",
      "",
      "Options:",
      "  --run-id <id>              Stable run id",
      "  --sessions-root <path>     Session root (default: ~/.codex/sessions)",
      "  --run-root <path>          Artifact root (default: ./output/memory/<run-id>)",
      "  --units <path>             Source-unit JSONL output",
      "  --promoted <path>          Promoted JSONL output",
      "  --adapter-output <path>    Studio Brain adapter JSONL output",
      "  --corpus-dir <path>        Canonical corpus directory",
      "  --corpus-manifest <path>   Canonical corpus manifest",
      "  --sqlite-path <path>       SQLite output path",
      "  --include-assistant <t/f>  Include assistant messages (default: true)",
      "  --exclude-recent-minutes <n> Skip very recent session files (default: 15)",
      "  --max-items <n>            Optional cap on source messages",
      "  --skip-sqlite <t/f>        Skip SQLite materialization",
      "  --json                     Print final report JSON",
    ].join("\n")
  );
}

function defaultArtifact(runRoot, flagValue, relativePath) {
  return flagValue ? resolve(REPO_ROOT, flagValue) : joinRunPath(runRoot, relativePath);
}

function collectJsonlFiles(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && full.endsWith(".jsonl")) files.push(full);
    }
  }
  return files.sort();
}

function parseLines(filePath) {
  return String(readFileSync(filePath, "utf8") || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function shouldSkipText(text) {
  const trimmed = normalizeHybridText(text);
  if (!trimmed) return true;
  const boilerplatePatterns = [
    /^<permissions instructions>/i,
    /^# AGENTS\.md instructions/i,
    /^<environment_context>/i,
    /^<collaboration_mode>/i,
    /^<INSTRUCTIONS>/i,
    /^## JavaScript REPL/i,
    /^## Skills/i,
    /^## Apps/i,
    /^You are Codex, a coding agent/i,
    /^<subagent_notification>/i,
  ];
  return boilerplatePatterns.some((pattern) => pattern.test(trimmed));
}

function fallbackCandidate(text, lane) {
  const signals = buildContextSignals(text);
  if (!Object.values(signals).some(Boolean)) return null;
  const patternHints = [`lane:${lane}`];
  if (signals.urgentLike) patternHints.push("priority:urgent");
  if (signals.reopenedLike) patternHints.push("state:reopened");
  if (signals.correctionLike) patternHints.push("state:superseded");
  if (signals.decisionLike && !signals.blockerLike) patternHints.push("state:resolved");
  if (signals.actionLike || signals.blockerLike) patternHints.push("state:open-loop");
  return {
    kind: "summary",
    analysisType: "codex_session_summary",
    summary: `Session summary: ${text.slice(0, 220)}`,
    score: 0.7,
    contextSignals: signals,
    patternHints,
  };
}

function buildAdapterRows({ promotedRows, manifestPath, runId }) {
  const { facts, sourceUnits } = loadFactRecordsBySourceId(manifestPath);
  return promotedRows
    .map((row) => {
      const fact = facts.get(String(row.clientRequestId || "").trim());
      if (!fact) return null;
      const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const sourceId = String(metadata.sourceClientRequestId || "").trim();
      const sourceUnit = sourceId ? sourceUnits.get(sourceId) : null;
      const kind = String(metadata.memoryKind || "summary").trim();
      return {
        content: row.content,
        source: "codex-resumable-session",
        tags: Array.isArray(row.tags) ? row.tags : [],
        metadata: {
          ...metadata,
          corpusRecordId: fact.id,
          corpusRecordType: "fact_event",
          corpusSourceUnitId: sourceUnit?.id || null,
          corpusManifestPath: manifestPath,
          corpusRunId: runId,
        },
        agentId: "agent:codex-resumable",
        runId: `codex:${metadata.projectLane || "unknown"}`.slice(0, 128),
        clientRequestId: String(row.clientRequestId || "").trim() || undefined,
        occurredAt: typeof row.occurredAt === "string" ? row.occurredAt : undefined,
        status: "accepted",
        memoryType: ["decision", "preference", "evidence"].includes(kind) ? "semantic" : "episodic",
        sourceConfidence: Number(metadata.confidence || 0.76),
        importance: Number(metadata.importance || 0.76),
      };
    })
    .filter(Boolean);
}

function run() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const runId = readStringFlag(flags, "run-id", "").trim();
  if (!runId) throw new Error("--run-id is required");

  const sessionsRoot = resolve(readStringFlag(flags, "sessions-root", codexPath("sessions")));
  const runRoot = defaultArtifact(defaultRunRoot(runId), readStringFlag(flags, "run-root", "").trim(), "");
  const unitsPath = defaultArtifact(runRoot, readStringFlag(flags, "units", "").trim(), "codex-session-units.jsonl");
  const promotedPath = defaultArtifact(runRoot, readStringFlag(flags, "promoted", "").trim(), "codex-session-promoted.jsonl");
  const adapterOutputPath = defaultArtifact(runRoot, readStringFlag(flags, "adapter-output", "").trim(), "codex-session-adapter.jsonl");
  const corpusDir = defaultArtifact(runRoot, readStringFlag(flags, "corpus-dir", "").trim(), "canonical-corpus");
  const manifestPath = defaultArtifact(runRoot, readStringFlag(flags, "corpus-manifest", "").trim(), "canonical-corpus/manifest.json");
  const sqlitePath = defaultArtifact(runRoot, readStringFlag(flags, "sqlite-path", "").trim(), "canonical-corpus/corpus.sqlite");
  const includeAssistant = readBoolFlag(flags, "include-assistant", true);
  const excludeRecentMinutes = readNumberFlag(flags, "exclude-recent-minutes", 15, { min: 0, max: 1440 });
  const maxItems = readNumberFlag(flags, "max-items", 0, { min: 0 });
  const skipSQLite = readBoolFlag(flags, "skip-sqlite", false);
  const printJson = readBoolFlag(flags, "json", false);

  const nowMs = Date.now();
  const recentCutoffMs = nowMs - excludeRecentMinutes * 60_000;
  const units = [];
  const promoted = [];
  const promotedSeen = new Set();

  let filesScanned = 0;
  let filesSkippedRecent = 0;
  let messagesScanned = 0;
  let devMessages = 0;
  let skippedBoilerplate = 0;
  let skippedNonDev = 0;
  let quarantined = 0;

  for (const filePath of collectJsonlFiles(sessionsRoot)) {
    const modifiedAt = statSync(filePath).mtimeMs;
    if (excludeRecentMinutes > 0 && modifiedAt >= recentCutoffMs) {
      filesSkippedRecent += 1;
      continue;
    }
    filesScanned += 1;
    const sessionFile = relative(sessionsRoot, filePath).replace(/\\/g, "/");
    for (const event of parseLines(filePath)) {
      if (!event || event.type !== "response_item" || event.payload?.type !== "message") continue;
      const role = String(event.payload.role || "").trim().toLowerCase();
      if (role !== "user" && !(includeAssistant && role === "assistant")) continue;
      const parts = Array.isArray(event.payload.content) ? event.payload.content : [];
      for (const part of parts) {
        if (maxItems > 0 && units.length >= maxItems) break;
        const rawText = typeof part?.text === "string" ? part.text : "";
        const normalized = normalizeHybridText(rawText);
        if (shouldSkipText(normalized)) {
          skippedBoilerplate += 1;
          continue;
        }
        messagesScanned += 1;
        const cleanedText = redactLikelySecrets(normalized);
        if (!cleanedText || detectPoisoning(cleanedText)) {
          quarantined += 1;
          continue;
        }
        const scope = classifyDevelopmentScope({ text: cleanedText, path: sessionFile });
        if (!scope.isDevelopment || scope.isPersonal) {
          skippedNonDev += 1;
          continue;
        }
        devMessages += 1;
        const lane = inferProjectLane({ text: cleanedText, path: sessionFile });
        const occurredAt =
          typeof event.timestamp === "string" && event.timestamp.trim()
            ? event.timestamp
            : new Date(modifiedAt).toISOString();
        const contentHash = stableContentHash(cleanedText, 32);
        const unitClientRequestId = `codex-session-src-${stableContentHash(`${sessionFile}|${occurredAt}|${role}|${contentHash}`, 24)}`;

        units.push({
          content: cleanedText,
          source: "codex-resumable-session",
          tags: ["codex", "resumable-session", role, lane],
          metadata: {
            projectLane: lane,
            sessionFile,
            headingPath: sessionFile,
            docPath: sessionFile,
            chunkId: unitClientRequestId,
            contentHash,
            role,
            sourceFamily: "codex-resumable-session",
            corpusFamily: "codex-resumable-session",
          },
          clientRequestId: unitClientRequestId,
          unitId: unitClientRequestId,
          occurredAt,
        });

        const candidates = extractStructuredCandidates(cleanedText, { title: sessionFile, maxCandidates: 4 });
        const fallback = candidates.length === 0 ? fallbackCandidate(cleanedText, lane) : null;
        const allCandidates = fallback ? [...candidates, fallback] : candidates;

        for (const candidate of allCandidates) {
          const dedupeKey = `${lane}|${candidate.kind}|${candidate.summary.toLowerCase()}`;
          if (promotedSeen.has(dedupeKey)) continue;
          promotedSeen.add(dedupeKey);
          const confidence = Number(candidate.score || 0.76);
          promoted.push({
            content: candidate.summary,
            source: "codex-resumable-session",
            tags: ["codex", "resumable-session", lane, candidate.kind],
            metadata: {
              projectLane: lane,
              sessionFile,
              docPath: sessionFile,
              headingPath: sessionFile,
              chunkId: unitClientRequestId,
              contentHash,
              role,
              sourceFamily: "codex-resumable-session",
              sourceClientRequestId: unitClientRequestId,
              sourceClientRequestIds: [unitClientRequestId],
              analysisType: candidate.analysisType,
              memoryKind: candidate.kind,
              contextSignals: candidate.contextSignals,
              patternHints: Array.from(new Set([...(candidate.patternHints || []), `lane:${lane}`])),
              confidence,
              memoryLayer: ["decision", "preference", "evidence"].includes(candidate.kind) ? "semantic" : "episodic",
              importance: ["decision", "open_loop"].includes(candidate.kind) ? 0.86 : 0.74,
            },
            clientRequestId: `codex-session-prom-${stableContentHash(`${unitClientRequestId}|${candidate.kind}|${candidate.summary}`, 24)}`,
            occurredAt,
          });
        }
      }
      if (maxItems > 0 && units.length >= maxItems) break;
    }
    if (maxItems > 0 && units.length >= maxItems) break;
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
    schema: "codex-session-corpus-export-report.v1",
    generatedAt: isoNow(),
    runId,
    sessionsRoot,
    unitsPath,
    promotedPath,
    adapterOutputPath,
    manifestPath,
    sqlitePath,
    counts: {
      filesScanned,
      filesSkippedRecent,
      messagesScanned,
      devMessages,
      sourceUnits: units.length,
      promoted: promoted.length,
      adapterRows: adapterRows.length,
      skippedBoilerplate,
      skippedNonDev,
      quarantined,
    },
    sqliteStatus: corpusResult.sqliteStatus,
    warnings: corpusResult.warnings,
  };
  writeJson(joinRunPath(runRoot, "codex-session-corpus-export-report.json"), report);

  if (printJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write("codex-session-corpus-export complete\n");
    process.stdout.write(`report: ${joinRunPath(runRoot, "codex-session-corpus-export-report.json")}\n`);
  }
}

try {
  run();
} catch (error) {
  process.stderr.write(`codex-session-corpus-export failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
