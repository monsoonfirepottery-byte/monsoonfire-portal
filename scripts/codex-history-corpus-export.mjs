#!/usr/bin/env node

import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCliArgs,
  readBoolFlag,
  readJson,
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
      "Codex historical conversation corpus export",
      "",
      "Usage:",
      "  node ./scripts/codex-history-corpus-export.mjs --run-id codex-history-001",
      "",
      "Options:",
      "  --run-id <id>              Stable run id",
      "  --input <path>             Primary conversations JSON (default: ~/.codex/memory/raw/conversations.json)",
      "  --shared-input <path>      Optional shared conversations JSON",
      "  --run-root <path>          Artifact root (default: ./output/memory/<run-id>)",
      "  --units <path>             Source-unit JSONL output",
      "  --promoted <path>          Promoted JSONL output",
      "  --adapter-output <path>    Studio Brain adapter JSONL output",
      "  --corpus-dir <path>        Canonical corpus directory",
      "  --corpus-manifest <path>   Canonical corpus manifest",
      "  --sqlite-path <path>       SQLite output path",
      "  --include-assistant <t/f>  Include assistant messages (default: true)",
      "  --max-conversations <n>    Optional cap on conversations",
      "  --max-items <n>            Optional cap on source messages",
      "  --skip-sqlite <t/f>        Skip SQLite materialization",
      "  --json                     Print final report JSON",
    ].join("\n")
  );
}

function defaultArtifact(runRoot, flagValue, relativePath) {
  return flagValue ? resolve(REPO_ROOT, flagValue) : joinRunPath(runRoot, relativePath);
}

function normalizeConversationArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.conversations)) return value.conversations;
  return [];
}

function nodeTimestampToIso(value, fallback = null) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const ms = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return fallback;
}

function conversationMessages(conversation, includeAssistant) {
  const mapping = conversation?.mapping && typeof conversation.mapping === "object" ? conversation.mapping : {};
  return Object.entries(mapping)
    .map(([nodeId, node]) => {
      const message = node?.message;
      if (!message || typeof message !== "object") return null;
      const authorRole = String(message?.author?.role || "").trim().toLowerCase();
      if (authorRole !== "user" && !(includeAssistant && authorRole === "assistant")) return null;
      const parts = Array.isArray(message?.content?.parts) ? message.content.parts : [];
      const content = parts
        .map((part) => (typeof part === "string" ? part : typeof part?.text === "string" ? part.text : ""))
        .filter(Boolean)
        .join("\n");
      if (!content.trim()) return null;
      const occurredAt =
        nodeTimestampToIso(message.create_time) ||
        nodeTimestampToIso(node.create_time) ||
        nodeTimestampToIso(conversation.update_time) ||
        nodeTimestampToIso(conversation.create_time);
      return {
        nodeId,
        role: authorRole,
        content,
        occurredAt,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftTs = Date.parse(String(left.occurredAt || "")) || 0;
      const rightTs = Date.parse(String(right.occurredAt || "")) || 0;
      return leftTs - rightTs;
    });
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
    analysisType: "codex_history_summary",
    summary: `History summary: ${text.slice(0, 220)}`,
    score: 0.68,
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
        source: "codex-history-export",
        tags: Array.isArray(row.tags) ? row.tags : [],
        metadata: {
          ...metadata,
          corpusRecordId: fact.id,
          corpusRecordType: "fact_event",
          corpusSourceUnitId: sourceUnit?.id || null,
          corpusManifestPath: manifestPath,
          corpusRunId: runId,
        },
        agentId: "agent:codex-history",
        runId: `codex-history:${metadata.projectLane || "unknown"}`.slice(0, 128),
        clientRequestId: String(row.clientRequestId || "").trim() || undefined,
        occurredAt: typeof row.occurredAt === "string" ? row.occurredAt : undefined,
        status: "accepted",
        memoryType: ["decision", "preference", "evidence"].includes(kind) ? "semantic" : "episodic",
        sourceConfidence: Number(metadata.confidence || 0.72),
        importance: Number(metadata.importance || 0.74),
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

  const primaryInput = resolve(readStringFlag(flags, "input", codexPath("memory", "raw", "conversations.json")));
  const sharedInputFlag = readStringFlag(flags, "shared-input", "").trim();
  const sharedInput = sharedInputFlag ? resolve(sharedInputFlag) : codexPath("memory", "raw", "shared_conversations.json");
  const includeAssistant = readBoolFlag(flags, "include-assistant", true);
  const maxConversations = readNumberFlag(flags, "max-conversations", 0, { min: 0 });
  const maxItems = readNumberFlag(flags, "max-items", 0, { min: 0 });
  const skipSQLite = readBoolFlag(flags, "skip-sqlite", false);
  const printJson = readBoolFlag(flags, "json", false);

  const runRoot = defaultArtifact(defaultRunRoot(runId), readStringFlag(flags, "run-root", "").trim(), "");
  const unitsPath = defaultArtifact(runRoot, readStringFlag(flags, "units", "").trim(), "codex-history-units.jsonl");
  const promotedPath = defaultArtifact(runRoot, readStringFlag(flags, "promoted", "").trim(), "codex-history-promoted.jsonl");
  const adapterOutputPath = defaultArtifact(runRoot, readStringFlag(flags, "adapter-output", "").trim(), "codex-history-adapter.jsonl");
  const corpusDir = defaultArtifact(runRoot, readStringFlag(flags, "corpus-dir", "").trim(), "canonical-corpus");
  const manifestPath = defaultArtifact(runRoot, readStringFlag(flags, "corpus-manifest", "").trim(), "canonical-corpus/manifest.json");
  const sqlitePath = defaultArtifact(runRoot, readStringFlag(flags, "sqlite-path", "").trim(), "canonical-corpus/corpus.sqlite");

  const primaryConversations = normalizeConversationArray(readJson(primaryInput, []));
  const sharedConversations = normalizeConversationArray(readJson(sharedInput, []));
  const conversations = [...primaryConversations, ...sharedConversations];
  const limitedConversations = maxConversations > 0 ? conversations.slice(0, maxConversations) : conversations;

  const units = [];
  const promoted = [];
  const promotedSeen = new Set();

  let conversationsScanned = 0;
  let messagesScanned = 0;
  let devMessages = 0;
  let skippedNonDev = 0;
  let quarantined = 0;

  for (const conversation of limitedConversations) {
    conversationsScanned += 1;
    const title = String(conversation?.title || "").trim() || "Untitled conversation";
    const conversationId = String(conversation?.id || conversation?.conversation_id || `conv-${conversationsScanned}`).trim();
    for (const message of conversationMessages(conversation, includeAssistant)) {
      if (maxItems > 0 && units.length >= maxItems) break;
      const normalized = normalizeHybridText(message.content);
      if (!normalized) continue;
      messagesScanned += 1;
      const cleanedText = redactLikelySecrets(normalized);
      if (!cleanedText || detectPoisoning(cleanedText)) {
        quarantined += 1;
        continue;
      }
      const scope = classifyDevelopmentScope({ text: cleanedText, title, path: primaryInput });
      if (!scope.isDevelopment || scope.isPersonal) {
        skippedNonDev += 1;
        continue;
      }
      devMessages += 1;
      const lane = inferProjectLane({ text: cleanedText, title, path: primaryInput });
      const occurredAt =
        message.occurredAt ||
        nodeTimestampToIso(conversation.update_time) ||
        nodeTimestampToIso(conversation.create_time) ||
        new Date().toISOString();
      const contentHash = stableContentHash(cleanedText, 32);
      const unitClientRequestId = `codex-history-src-${stableContentHash(`${conversationId}|${message.nodeId}|${contentHash}`, 24)}`;

      units.push({
        content: cleanedText,
        source: "codex-history-export",
        tags: ["codex", "history-export", message.role, lane],
        metadata: {
          projectLane: lane,
          conversationId,
          conversationTitle: title,
          messageNodeId: message.nodeId,
          role: message.role,
          docPath: basename(primaryInput),
          headingPath: title,
          chunkId: unitClientRequestId,
          contentHash,
          sourceFamily: "codex-history-export",
          corpusFamily: "codex-history-export",
        },
        clientRequestId: unitClientRequestId,
        unitId: unitClientRequestId,
        occurredAt,
      });

      const candidates = extractStructuredCandidates(cleanedText, { title, maxCandidates: 4 });
      const fallback = candidates.length === 0 ? fallbackCandidate(cleanedText, lane) : null;
      const allCandidates = fallback ? [...candidates, fallback] : candidates;

      for (const candidate of allCandidates) {
        const dedupeKey = `${lane}|${candidate.kind}|${candidate.summary.toLowerCase()}`;
        if (promotedSeen.has(dedupeKey)) continue;
        promotedSeen.add(dedupeKey);
        const confidence = Number(candidate.score || 0.72);
        promoted.push({
          content: candidate.summary,
          source: "codex-history-export",
          tags: ["codex", "history-export", lane, candidate.kind],
          metadata: {
            projectLane: lane,
            conversationId,
            conversationTitle: title,
            messageNodeId: message.nodeId,
            role: message.role,
            docPath: basename(primaryInput),
            headingPath: title,
            chunkId: unitClientRequestId,
            contentHash,
            sourceFamily: "codex-history-export",
            sourceClientRequestId: unitClientRequestId,
            sourceClientRequestIds: [unitClientRequestId],
            analysisType: candidate.analysisType,
            memoryKind: candidate.kind,
            contextSignals: candidate.contextSignals,
            patternHints: Array.from(new Set([...(candidate.patternHints || []), `lane:${lane}`])),
            confidence,
            memoryLayer: ["decision", "preference", "evidence"].includes(candidate.kind) ? "semantic" : "episodic",
            importance: ["decision", "open_loop"].includes(candidate.kind) ? 0.84 : 0.72,
          },
          clientRequestId: `codex-history-prom-${stableContentHash(`${unitClientRequestId}|${candidate.kind}|${candidate.summary}`, 24)}`,
          occurredAt,
        });
      }
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
    schema: "codex-history-corpus-export-report.v1",
    generatedAt: isoNow(),
    runId,
    inputs: {
      primaryInput,
      sharedInput,
    },
    unitsPath,
    promotedPath,
    adapterOutputPath,
    manifestPath,
    sqlitePath,
    counts: {
      conversationsScanned,
      messagesScanned,
      devMessages,
      sourceUnits: units.length,
      promoted: promoted.length,
      adapterRows: adapterRows.length,
      skippedNonDev,
      quarantined,
    },
    sqliteStatus: corpusResult.sqliteStatus,
    warnings: corpusResult.warnings,
  };
  writeJson(joinRunPath(runRoot, "codex-history-corpus-export-report.json"), report);

  if (printJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write("codex-history-corpus-export complete\n");
    process.stdout.write(`report: ${joinRunPath(runRoot, "codex-history-corpus-export-report.json")}\n`);
  }
}

try {
  run();
} catch (error) {
  process.stderr.write(`codex-history-corpus-export failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
