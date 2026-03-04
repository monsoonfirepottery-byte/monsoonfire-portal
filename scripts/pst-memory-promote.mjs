#!/usr/bin/env node

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clipText,
  isoNow,
  normalizeWhitespace,
  parseCliArgs,
  readNumberFlag,
  readStringFlag,
  readBoolFlag,
  readJsonlWithRaw,
  stableHash,
  writeJson,
  writeJsonl,
} from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "PST memory promote stage",
      "",
      "Usage:",
      "  node ./scripts/pst-memory-promote.mjs \\",
      "    --input ./imports/pst/mailbox-analysis-memory.jsonl \\",
      "    --output ./imports/pst/mailbox-promoted-memory.jsonl",
      "",
      "Options:",
      "  --dead-letter <path>      Dropped/deferred rows",
      "  --report <path>           JSON report path",
      "  --semantic-min-score <n>  Promote to semantic layer threshold (default: 7)",
      "  --episodic-min-score <n>  Keep as episodic threshold (default: 3)",
      "  --max-output <n>          Max promoted rows (default: 300)",
      "  --max-content-chars <n>   Clip content size (default: 1800)",
      "  --source <name>           source override for promoted rows (default: pst:promoted-memory)",
      "  --json                    Print report JSON",
    ].join("\n")
  );
}

function confidenceFromScore(score) {
  const normalized = Math.max(0, Math.min(1, Number(score) / 12));
  return Number(normalized.toFixed(3));
}

function normalizeTenant(value) {
  const tenant = String(value || "").trim();
  return tenant || null;
}

function deriveMemoryId({ tenantId, clientRequestId }) {
  const scope = normalizeTenant(tenantId) || "none";
  return `mem_req_${stableHash(`${scope}|${String(clientRequestId || "")}`)}`;
}

const RELATIONSHIP_POLICY_VERSION = "pst-memory-relationships.v1";

function normalizeRelationType(value, fallback = "context_related") {
  const normalized = normalizeWhitespace(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function relationshipTtlDays(type) {
  if (type === "source_reference") return 3650;
  if (type === "thread_neighbor") return 3650;
  if (type === "semantic_conflict") return 180;
  return 730;
}

function createRelationshipEdge({
  fromMemoryId,
  toMemoryId,
  relationType,
  confidence,
  reason,
  signal,
  occurredAt,
  generatedAt,
}) {
  const type = normalizeRelationType(relationType);
  const toId = String(toMemoryId || "").trim();
  const fromId = String(fromMemoryId || "").trim();
  if (!toId || !fromId) return null;
  const confidenceScore = Number.isFinite(Number(confidence))
    ? Number(Math.max(0, Math.min(1, Number(confidence))).toFixed(3))
    : 0.5;
  const edgeId = `edge_${stableHash(`${fromId}|${type}|${toId}`, 32)}`;
  return {
    edgeId,
    schema: "pst-memory-relationship-edge.v1",
    direction: "outbound",
    fromMemoryId: fromId,
    toMemoryId: toId,
    type,
    confidence: confidenceScore,
    reason: clipText(reason, 220),
    provenance: {
      stage: "promote",
      signal: normalizeWhitespace(signal || "derived"),
      policyVersion: RELATIONSHIP_POLICY_VERSION,
    },
    createdAt: generatedAt,
    observedAt: String(occurredAt || "").trim() || null,
    ttlPolicy: {
      mode: "expire_after_days",
      days: relationshipTtlDays(type),
    },
  };
}

function mergeRelationshipEdges(existingEdges, newEdges) {
  const out = [];
  const seen = new Set();
  const collect = (edge) => {
    if (!edge || typeof edge !== "object") return;
    const toMemoryId = String(edge.toMemoryId || edge.id || "").trim();
    if (!toMemoryId) return;
    const type = normalizeRelationType(edge.type || edge.relationType || "");
    const direction = String(edge.direction || "outbound")
      .trim()
      .toLowerCase() || "outbound";
    const key = `${direction}|${type}|${toMemoryId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      ...edge,
      direction,
      type,
      toMemoryId,
    });
  };
  for (const edge of existingEdges) collect(edge);
  for (const edge of newEdges) collect(edge);
  return out;
}

function collectSourceRequestIds(metadata) {
  const ids = new Set();
  const values = [];

  if (metadata && typeof metadata === "object") {
    if (typeof metadata.sourceClientRequestId === "string") {
      values.push(metadata.sourceClientRequestId);
    }
    if (Array.isArray(metadata.sourceClientRequestIds)) {
      values.push(...metadata.sourceClientRequestIds);
    }
  }

  for (const value of values) {
    if (value === null || value === undefined) continue;
    const normalized = String(value).trim();
    if (normalized) ids.add(normalized);
  }

  return [...ids];
}

function deriveReinforcementKey(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const analysisType = normalizeWhitespace(metadata.analysisType || "unknown");
  const threadKey = normalizeWhitespace(metadata.threadKey || "");
  const subject = normalizeWhitespace(metadata.subject || "");
  const mimeType = normalizeWhitespace(metadata.mimeType || "");
  const attachmentHash = normalizeWhitespace(metadata.attachmentHash || "");
  if (threadKey) return `${analysisType}|thread:${threadKey}`;
  if (attachmentHash) return `${analysisType}|att:${attachmentHash}`;
  if (subject) return `${analysisType}|subject:${subject.toLowerCase()}`;
  if (mimeType) return `${analysisType}|mime:${mimeType.toLowerCase()}`;
  return `${analysisType}|content:${stableHash(row?.content || "")}`;
}

function shouldPreferSemantic(row, score, reinforcementCount, semanticMinScore) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const analysisType = normalizeWhitespace(metadata.analysisType || "");
  if (score >= semanticMinScore) return true;
  if (reinforcementCount >= 2) return true;
  if (["thread_summary", "trend_summary", "correlation", "contact_fact"].includes(analysisType)) return true;
  return false;
}

function run() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const inputPath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "input", "./imports/pst/mailbox-analysis-memory.jsonl")
  );
  const outputPath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "output", "./imports/pst/mailbox-promoted-memory.jsonl")
  );
  const deadLetterPath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "dead-letter", "./imports/pst/mailbox-promote-dead-letter.jsonl")
  );
  const reportPath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "report", "./output/open-memory/pst-memory-promote-latest.json")
  );

  const semanticMinScore = readNumberFlag(flags, "semantic-min-score", 7, { min: 0, max: 1000 });
  const episodicMinScore = readNumberFlag(flags, "episodic-min-score", 3, { min: 0, max: 1000 });
  const maxOutput = readNumberFlag(flags, "max-output", 300, { min: 1, max: 5000 });
  const maxContentChars = readNumberFlag(flags, "max-content-chars", 1800, { min: 200, max: 20000 });
  const sourceOverride = readStringFlag(flags, "source", "pst:promoted-memory");
  const printJson = readBoolFlag(flags, "json", false);

  const rows = readJsonlWithRaw(inputPath);
  const malformed = [];
  const valid = [];
  for (const row of rows) {
    if (!row.ok || !row.value || typeof row.value !== "object") {
      malformed.push({
        stage: "promote",
        reason: "malformed_jsonl_row",
        raw: row.raw,
      });
      continue;
    }
    const value = row.value;
    const content = normalizeWhitespace(value.content || "");
    if (!content) {
      malformed.push({
        stage: "promote",
        reason: "missing_content",
        raw: row.raw,
      });
      continue;
    }
    valid.push(value);
  }

  const reinforcementCounts = new Map();
  for (const row of valid) {
    const key = deriveReinforcementKey(row);
    reinforcementCounts.set(key, (reinforcementCounts.get(key) || 0) + 1);
  }

  const seenNovelty = new Set();
  const promoted = [];
  const dropped = [...malformed];
  let semanticCount = 0;
  let episodicCount = 0;

  const ranked = [...valid]
    .map((row) => {
      const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const score = Number.isFinite(Number(metadata.score)) ? Number(metadata.score) : 0;
      const reinforcementKey = deriveReinforcementKey(row);
      const reinforcementCount = reinforcementCounts.get(reinforcementKey) || 1;
      const rank = score * 10 + reinforcementCount;
      return {
        row,
        score,
        reinforcementKey,
        reinforcementCount,
        rank,
      };
    })
    .sort((a, b) => b.rank - a.rank);

  for (const item of ranked) {
    if (promoted.length >= maxOutput) {
      dropped.push({
        stage: "promote",
        reason: "max_output_exceeded",
        content: item.row.content,
        metadata: item.row.metadata || {},
      });
      continue;
    }
    const contentNorm = normalizeWhitespace(item.row.content || "").toLowerCase();
    const noveltyKey = stableHash(contentNorm);
    if (seenNovelty.has(noveltyKey)) {
      dropped.push({
        stage: "promote",
        reason: "duplicate_novelty_key",
        content: item.row.content,
        metadata: item.row.metadata || {},
      });
      continue;
    }

    if (item.score < episodicMinScore) {
      dropped.push({
        stage: "promote",
        reason: "below_episodic_min_score",
        score: item.score,
        threshold: episodicMinScore,
        content: item.row.content,
        metadata: item.row.metadata || {},
      });
      continue;
    }

    const memoryLayer = shouldPreferSemantic(
      item.row,
      item.score,
      item.reinforcementCount,
      semanticMinScore
    )
      ? "semantic"
      : "episodic";

    const confidence = confidenceFromScore(item.score + (item.reinforcementCount - 1));
    const metadata = {
      ...(item.row.metadata && typeof item.row.metadata === "object" ? item.row.metadata : {}),
      memoryLayer,
      confidence,
      reinforcementCount: item.reinforcementCount,
      reinforcementKey: item.reinforcementKey,
      analysisVersion: "pst-analysis-hybrid.v1",
      policyVersion: "pst-memory-promotion.v1",
    };

    const tenantId = normalizeTenant(item.row.tenantId);
    const clientRequestId =
      String(item.row.clientRequestId || "").trim() ||
      `pst-promoted-${stableHash(`${item.reinforcementKey}|${item.row.content}`)}`;
    const memoryId = deriveMemoryId({ tenantId, clientRequestId });

    const promotedRow = {
      id: memoryId,
      content: clipText(item.row.content, maxContentChars),
      source: sourceOverride,
      tags: Array.isArray(item.row.tags) ? item.row.tags.map((tag) => String(tag)) : [],
      metadata,
      tenantId: tenantId || undefined,
      occurredAt: item.row.occurredAt || undefined,
      clientRequestId,
    };

    promoted.push(promotedRow);
    seenNovelty.add(noveltyKey);
    if (memoryLayer === "semantic") semanticCount += 1;
    else episodicCount += 1;
  }

  const threadBuckets = new Map();
  for (const row of promoted) {
    const threadKey = normalizeWhitespace(row?.metadata?.threadKey || "");
    if (!threadKey) continue;
    const current = threadBuckets.get(threadKey) || [];
    current.push(row);
    threadBuckets.set(threadKey, current);
  }

  for (const row of promoted) {
    const generatedAt = isoNow();
    const relatedIds = new Set();
    const existingRelatedIds = Array.isArray(row?.metadata?.relatedMemoryIds)
      ? row.metadata.relatedMemoryIds
      : [];
    for (const relatedId of existingRelatedIds) {
      const normalized = String(relatedId || "").trim();
      if (normalized) relatedIds.add(normalized);
    }

    const derivedEdges = [];
    const sourceRequestIds = collectSourceRequestIds(row.metadata);
    for (const sourceRequestId of sourceRequestIds) {
      const targetId = deriveMemoryId({ tenantId: row.tenantId, clientRequestId: sourceRequestId });
      relatedIds.add(targetId);
      const edge = createRelationshipEdge({
        fromMemoryId: row.id,
        toMemoryId: targetId,
        relationType: "source_reference",
        confidence: 0.93,
        reason: "Derived from sourceClientRequestId linkage during PST promotion.",
        signal: "source-client-request-id",
        occurredAt: row.occurredAt,
        generatedAt,
      });
      if (edge) derivedEdges.push(edge);
    }

    const threadKey = normalizeWhitespace(row?.metadata?.threadKey || "");
    if (threadKey) {
      const siblings = threadBuckets.get(threadKey) || [];
      for (const sibling of siblings) {
        if (sibling?.id) {
          relatedIds.add(sibling.id);
          const edge = createRelationshipEdge({
            fromMemoryId: row.id,
            toMemoryId: sibling.id,
            relationType: "thread_neighbor",
            confidence: 0.78,
            reason: `Shared thread key: ${threadKey}`,
            signal: "thread-key",
            occurredAt: row.occurredAt,
            generatedAt,
          });
          if (edge) derivedEdges.push(edge);
        }
      }
    }

    relatedIds.delete(row.id);
    const existingEdges = Array.isArray(row?.metadata?.relationships) ? row.metadata.relationships : [];
    const relationships = mergeRelationshipEdges(existingEdges, derivedEdges);
    const relationTypes = new Set(
      Array.isArray(row?.metadata?.relationTypes)
        ? row.metadata.relationTypes.map((item) => normalizeRelationType(item)).filter(Boolean)
        : []
    );
    for (const relationship of relationships) {
      relationTypes.add(normalizeRelationType(relationship?.type));
    }

    if (relatedIds.size > 0 || relationships.length > 0) {
      row.metadata = {
        ...(row.metadata && typeof row.metadata === "object" ? row.metadata : {}),
        relatedMemoryIds: [...relatedIds],
        relationTypes: [...relationTypes],
        relationships,
        relationshipModel: {
          schema: "pst-memory-relationship-edge.v1",
          policyVersion: RELATIONSHIP_POLICY_VERSION,
          appendOnly: true,
          lastUpdatedAt: generatedAt,
        },
      };
    }
  }

  writeJsonl(outputPath, promoted);
  writeJsonl(deadLetterPath, dropped);

  const report = {
    schema: "pst-memory-promote-report.v1",
    generatedAt: isoNow(),
    inputPath,
    outputPath,
    deadLetterPath,
    options: {
      semanticMinScore,
      episodicMinScore,
      maxOutput,
      sourceOverride,
      maxContentChars,
    },
    counts: {
      inputRows: rows.length,
      validRows: valid.length,
      promotedRows: promoted.length,
      semanticRows: semanticCount,
      episodicRows: episodicCount,
      droppedRows: dropped.length,
      malformedRows: malformed.length,
    },
  };
  writeJson(reportPath, report);

  if (printJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write("pst-memory-promote complete\n");
    process.stdout.write(`input: ${inputPath}\n`);
    process.stdout.write(`output: ${outputPath}\n`);
    process.stdout.write(`dead-letter: ${deadLetterPath}\n`);
    process.stdout.write(`report: ${reportPath}\n`);
    process.stdout.write(`promoted: ${promoted.length} (semantic ${semanticCount}, episodic ${episodicCount})\n`);
  }
}

try {
  run();
} catch (error) {
  process.stderr.write(`pst-memory-promote failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
