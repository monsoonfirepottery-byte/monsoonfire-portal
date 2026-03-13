#!/usr/bin/env node

import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clipText,
  countJsonlRows,
  createJsonlWriter,
  isoNow,
  normalizeWhitespace,
  parseCliArgs,
  readBoolFlag,
  readJson,
  readJsonlWithRaw,
  readNumberFlag,
  readStringFlag,
  stableHash,
  streamJsonlWithRaw,
  writeJson,
} from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "PST canonical corpus export",
      "",
      "Usage:",
      "  node ./scripts/pst-memory-corpus-export.mjs \\",
      "    --units ./imports/pst/runs/pst-run-001/mailbox-units.jsonl \\",
      "    --promoted ./imports/pst/runs/pst-run-001/mailbox-promoted-memory.jsonl",
      "",
      "Options:",
      "  --run-id <id>            Stable run id used in lineage records (default: derived from output dir or units path)",
      "  --units <path>           Normalized mailbox unit JSONL",
      "  --promoted <path>        Promoted PST memory JSONL",
      "  --output-dir <path>      Output directory (default: ./output/memory/corpus/<run-id>)",
      "  --manifest <path>        Manifest path (default: <output-dir>/manifest.json)",
      "  --resume <t/f>           Resume from completed export stages (default: true)",
      "  --fresh <t/f>            Ignore existing checkpoint and rebuild all stages",
      "  --checkpoint-dir <path>  Checkpoint directory (default: <output-dir>/checkpoints)",
      "  --dead-letter-dir <path> Dead-letter output dir (default: <output-dir>/dead-letter)",
      "  --raw-sidecar-dir <path> Raw sidecar dir (default: <output-dir>/raw-sidecars)",
      "  --preflight-only <t/f>   Validate inputs and exit",
      "  --allow-empty-promoted <t/f> Allow zero-byte promoted input and emit empty derived layers",
      "  --sample-lines <n>       Preflight sample lines per input (default: 100)",
      "  --max-errors <n>         Max malformed rows per stage before hard fail (default: 500)",
      "  --json                   Print manifest JSON",
    ].join("\n")
  );
}

function normalizeLabel(value) {
  return String(value || "").trim();
}

function parseDelimitedList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeLabel(item)).filter(Boolean);
  }
  const raw = normalizeLabel(value);
  if (!raw) return [];
  return raw
    .split(/[;,]/g)
    .map((item) => normalizeLabel(item))
    .filter(Boolean);
}

function dedupeStrings(values) {
  return [...new Set(values.map((value) => normalizeLabel(value)).filter(Boolean))];
}

function parseTimestamp(value) {
  const raw = normalizeLabel(value);
  if (!raw) return { value: null, precision: "unknown", sane: false };
  const parsed = new Date(raw);
  const ms = parsed.getTime();
  if (!Number.isFinite(ms)) return { value: raw, precision: "unknown", sane: false };
  const sane = ms >= Date.parse("1970-01-01T00:00:00Z") && ms <= Date.parse("2100-01-01T00:00:00Z");
  let precision = "date";
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}/i.test(raw) || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)) {
    precision = "second";
  } else if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/i.test(raw) || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw)) {
    precision = "minute";
  }
  return {
    value: new Date(ms).toISOString(),
    precision,
    sane,
  };
}

function isEraTimestampSane(value) {
  const raw = normalizeLabel(value);
  if (!raw) return false;
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return false;
  const year = new Date(ts).getUTCFullYear();
  return year >= 1980 && year <= 2100;
}

function safeEraKey(value) {
  return isEraTimestampSane(value) ? String(value).slice(0, 7) : "unknown-era";
}

function safeEraKeyFromFact(fact) {
  const timeWindow = normalizeLabel(fact?.payload?.timeWindow);
  const quarterMatch = timeWindow.match(/\b(19|20)\d{2}-Q[1-4]\b/i);
  if (quarterMatch) return quarterMatch[0].toUpperCase();
  const direct = safeEraKey(fact?.occurredAt);
  if (direct !== "unknown-era") return direct;
  const match = timeWindow.match(/\b(19|20)\d{2}-\d{2}\b/);
  return match ? match[0] : "unknown-era";
}

function collectParticipants(metadata = {}) {
  const direct = [
    metadata.from,
    metadata.fromAddress,
    metadata.fromName,
    metadata.sender,
    metadata.senderAddress,
    metadata.senderName,
  ];
  const grouped = [
    ...parseDelimitedList(metadata.to),
    ...parseDelimitedList(metadata.cc),
    ...parseDelimitedList(metadata.bcc),
    ...parseDelimitedList(metadata.recipients),
    ...parseDelimitedList(metadata.participants),
    ...parseDelimitedList(metadata.mentions),
    metadata.senderId,
    metadata.recipientId,
    metadata.initiatingUserId,
  ];
  return dedupeStrings([...direct, ...grouped]);
}

function collectTopics(metadata = {}, tags = []) {
  return dedupeStrings([
    metadata.subject,
    metadata.threadKey,
    metadata.topic,
    metadata.mailboxName,
    metadata.mailboxPath,
    metadata.twitterKind,
    ...(Array.isArray(metadata.hashtags) ? metadata.hashtags.map((tag) => `#${tag}`) : []),
    ...(Array.isArray(metadata.mentions) ? metadata.mentions.map((mention) => `@${mention}`) : []),
    ...parseDelimitedList(metadata.themes),
    ...parseDelimitedList(metadata.tags),
    ...(Array.isArray(tags) ? tags : []),
  ]);
}

function collectSourceRequestIds(metadata = {}) {
  return dedupeStrings([
    metadata.sourceClientRequestId,
    ...(Array.isArray(metadata.sourceClientRequestIds) ? metadata.sourceClientRequestIds : []),
  ]);
}

function deriveRecordId(prefix, parts) {
  return `${prefix}_${stableHash(parts.join("|"))}`;
}

function deriveEventType(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const analysisType = normalizeLabel(metadata.analysisType).toLowerCase();
  const content = normalizeWhitespace(row?.content || "").toLowerCase();

  if (analysisType === "twitter_public_expression") return "public_expression";
  if (analysisType === "twitter_affinity_pattern") return "affinity_signal";
  if (analysisType === "twitter_dm_relationship") return "relationship_signal";
  if (analysisType === "twitter_dm_conversation") return "conversation_signal";
  if (analysisType === "twitter_activity_rhythm") return "identity_rhythm";
  if (analysisType === "twitter_media_summary") return "media_signal";
  if (analysisType === "attachment_insight_document_profile") return "document_profile";
  if (analysisType === "attachment_trend_document_family") return "document_family";
  if (analysisType === "attachment_insight_timeline_anchor") return "timeline_anchor";
  if (analysisType === "attachment_insight_relationship_artifact") return "relationship_artifact";
  if (analysisType === "attachment_insight_workstream_artifact") return "workstream_artifact";
  if (analysisType === "attachment_insight_identity_artifact") return "identity_artifact";
  if (analysisType === "style_cadence") return "cadence_pattern";
  if (analysisType === "style_urgency_posture") return "urgency_pattern";
  if (analysisType === "style_followthrough") return "followthrough_pattern";
  if (analysisType === "style_correction_pattern") return "correction_pattern";
  if (analysisType === "style_context_switch") return "context_switch";
  if (analysisType === "style_attachment_dependence") return "document_dependency";
  if (analysisType === "identity_mode_shift") return "identity_shift";
  if (analysisType === "relationship_rhythm") return "relationship_rhythm";
  if (analysisType === "domain_drift") return "domain_shift";
  if (analysisType === "narrative_revision") return "narrative_revision";
  if (analysisType.includes("attachment_insight")) return "document_evidence";
  if (analysisType.includes("attachment_trend")) return "document_pattern";
  if (analysisType.includes("attachment_correlation")) return "document_reuse";
  if (analysisType.includes("thread_summary") || /\bdecision\b/.test(content)) return "decision";
  if (/\baction item\b|\bnext step\b|\bwill\b/.test(content)) return "commitment";
  if (/\bblocker\b|\brisk\b|\bincident\b/.test(content)) return "blocker";
  if (/\bapproved\b|\bapproval\b|\bsigned off\b/.test(content)) return "approval";
  if (/\bask\b|\brequest\b|\bneed\b/.test(content)) return "ask";
  if (/\bhandoff\b|\bresume\b/.test(content)) return "handoff";
  if (analysisType.includes("contact_fact")) return "relationship_transition";
  if (analysisType.includes("correlation")) return "influence_signal";
  if (/\bgoal\b|\baspiration\b|\bwant to\b/.test(content)) return "goal_signal";
  return "observation";
}

function deriveDecisionState(content) {
  const normalized = normalizeWhitespace(content).toLowerCase();
  if (!normalized) return null;
  if (/\bblocked\b|\bblocker\b|\brisk accepted\b/.test(normalized)) return "blocked";
  if (/\bapproved\b|\baccepted\b|\bconfirmed\b|\bkeep\b/.test(normalized)) return "accepted";
  if (/\bneed decision\b|\bopen\b|\bpending\b/.test(normalized)) return "open";
  return null;
}

function usageError(message) {
  throw new Error(message);
}

function initCheckpoint(path, base) {
  const existing = readJson(path, null);
  if (existing && typeof existing === "object") return existing;
  return {
    schema: "pst-corpus-export-checkpoint.v1",
    createdAt: isoNow(),
    updatedAt: isoNow(),
    status: "running",
    stageStatus: {},
    counts: {},
    warnings: [],
    errors: [],
    ...base,
  };
}

function wipeManagedOutputs(paths) {
  for (const target of [
    paths.sourceUnitsPath,
    paths.factEventsPath,
    paths.hypothesesPath,
    paths.dossiersPath,
    paths.sourceUnitsDeadLetterPath,
    paths.factEventsDeadLetterPath,
    paths.rawSourceUnitsPath,
    paths.rawPromotedPath,
    paths.sourceIndexDir,
    paths.dossierDir,
    paths.checkpointPath,
    paths.manifestPath,
  ]) {
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  }
}

function wipeSourceStageOutputs(paths) {
  for (const target of [
    paths.sourceUnitsPath,
    paths.sourceUnitsDeadLetterPath,
    paths.rawSourceUnitsPath,
    paths.sourceIndexDir,
  ]) {
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  }
}

function wipeDerivedStageOutputs(paths) {
  for (const target of [
    paths.factEventsPath,
    paths.hypothesesPath,
    paths.dossiersPath,
    paths.factEventsDeadLetterPath,
    paths.rawPromotedPath,
    paths.dossierDir,
  ]) {
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  }
}

function sourceIndexShardName(clientRequestId) {
  return `${stableHash(clientRequestId, 2)}.jsonl`;
}

function sourceIndexShardPath(sourceIndexDir, clientRequestId) {
  return resolve(sourceIndexDir, sourceIndexShardName(clientRequestId));
}

async function loadSourceIdLookupFromShards(sourceIndexDir, neededIds) {
  const wanted = new Set((Array.isArray(neededIds) ? neededIds : []).map((id) => normalizeLabel(id)).filter(Boolean));
  const shardToIds = new Map();
  for (const sourceId of wanted) {
    const shard = sourceIndexShardName(sourceId);
    const existing = shardToIds.get(shard) || new Set();
    existing.add(sourceId);
    shardToIds.set(shard, existing);
  }
  const lookup = new Map();
  for (const [shard, ids] of shardToIds.entries()) {
    const shardPath = resolve(sourceIndexDir, shard);
    if (!existsSync(shardPath)) continue;
    for await (const entry of streamJsonlWithRaw(shardPath)) {
      if (!entry.ok || !entry.value || typeof entry.value !== "object") continue;
      const sourceId = normalizeLabel(entry.value.sourceId);
      if (!ids.has(sourceId)) continue;
      lookup.set(sourceId, normalizeLabel(entry.value.recordId));
      if (lookup.size >= wanted.size) break;
    }
  }
  return lookup;
}

async function sourceStageCountsMatchCheckpoint(paths, checkpoint) {
  const expected = Number(checkpoint?.stageStatus?.source_units?.emitted || 0);
  const actual = await countJsonlRows(paths.sourceUnitsPath);
  return expected > 0 && actual === expected;
}

async function collectPromotedEntries(promotedPath, { maxErrors }) {
  const rows = [];
  const neededSourceIds = new Set();
  let malformedRows = 0;
  for await (const entry of streamJsonlWithRaw(promotedPath)) {
    if (!entry.ok || !entry.value || typeof entry.value !== "object") {
      malformedRows += 1;
      if (malformedRows >= maxErrors) throw new Error(`fact_events exceeded max malformed rows (${maxErrors})`);
      rows.push({ malformed: true, lineNumber: entry.lineNumber, raw: entry.raw });
      continue;
    }
    const row = entry.value;
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    for (const sourceId of collectSourceRequestIds(metadata)) neededSourceIds.add(sourceId);
    rows.push({ malformed: false, lineNumber: entry.lineNumber, raw: entry.raw, value: row });
  }
  return { rows, neededSourceIds: [...neededSourceIds], malformedRows };
}

function appendStageStatus(checkpoint, stage, status, extra = {}) {
  checkpoint.stageStatus[stage] = {
    status,
    at: isoNow(),
    ...extra,
  };
  checkpoint.updatedAt = isoNow();
}

function memorySnapshot() {
  const usage = process.memoryUsage();
  return {
    rss: Number(usage.rss || 0),
    heapUsed: Number(usage.heapUsed || 0),
    heapTotal: Number(usage.heapTotal || 0),
    external: Number(usage.external || 0),
  };
}

async function preflightJsonl(path, { sampleLines, maxInvalidLines = 5 }) {
  if (!existsSync(path)) {
    return { ok: false, reason: "missing_file", path };
  }
  const sizeBytes = Number(statSync(path).size || 0);
  if (sizeBytes <= 0) {
    return { ok: false, reason: "zero_byte_file", path, sizeBytes };
  }
  let sampled = 0;
  let valid = 0;
  let invalid = 0;
  for await (const entry of streamJsonlWithRaw(path)) {
    sampled += 1;
    if (entry.ok) valid += 1;
    else invalid += 1;
    if (sampled >= sampleLines) break;
  }
  return {
    ok: valid > 0 && invalid <= maxInvalidLines,
    path,
    sizeBytes,
    sampled,
    valid,
    invalid,
    reason: valid <= 0 ? "no_valid_jsonl_rows_in_sample" : invalid > maxInvalidLines ? "too_many_invalid_jsonl_rows_in_sample" : null,
  };
}

function sourceRawSidecarId(runId, clientRequestId) {
  return deriveRecordId("rawsrc", [runId, clientRequestId]);
}

function promotedRawSidecarId(runId, clientRequestId) {
  return deriveRecordId("rawprom", [runId, clientRequestId]);
}

function toSourceUnitRecord({ runId, row, lineNumber }) {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const clientRequestId =
    normalizeLabel(row.clientRequestId) ||
    deriveRecordId("src_req", [runId, normalizeLabel(row.unitId), normalizeWhitespace(row.content || "")]);
  const occurred = parseTimestamp(row.occurredAt || metadata.messageDate || metadata.sourceSentAt);
  const id = deriveRecordId("src", [runId, clientRequestId]);
  const rawSidecarId = sourceRawSidecarId(runId, clientRequestId);
  return {
    rawSidecar: {
      id: rawSidecarId,
      recordType: "raw_source_metadata",
      runId,
      sourceId: clientRequestId,
      lineNumber,
      rawMetadata: metadata,
      rawRow: row,
    },
    record: {
      id,
      recordType: "source_unit",
      schemaVersion: "canonical-corpus.v1",
      runId,
      sourceType: normalizeLabel(row.source) || "pst:libratom",
      sourceId: clientRequestId,
      occurredAt: occurred.value,
      timePrecision: occurred.precision,
      importance: 0.3,
      confidence: occurred.sane ? 1 : 0.6,
      tags: dedupeStrings(Array.isArray(row.tags) ? row.tags : []),
      actors: collectParticipants(metadata).map((label) => ({ label })),
      entities: [],
      topics: collectTopics(metadata, row.tags),
      provenance: {
        sourceLocation: {
          clientRequestId,
          unitId: normalizeLabel(row.unitId) || null,
          threadKey: normalizeLabel(metadata.threadKey) || null,
          mailboxPath: normalizeLabel(metadata.mailboxPath) || null,
          mailbox: normalizeLabel(metadata.mailbox) || null,
          providerFolder: normalizeLabel(metadata.providerFolder) || null,
          lineNumber,
        },
        rawMetadataRef: rawSidecarId,
        timestamps: {
          occurredAtRaw: normalizeLabel(row.occurredAt) || null,
          messageDate: normalizeLabel(metadata.messageDate) || null,
          sourceSentAt: normalizeLabel(metadata.sourceSentAt) || null,
          sentAt: normalizeLabel(metadata.sentAt) || null,
          receivedAt: normalizeLabel(metadata.receivedAt) || null,
        },
        messageHeaders: {
          rawMessageId: normalizeLabel(metadata.rawMessageId) || null,
          messageId: normalizeLabel(metadata.messageId) || null,
          inReplyTo: normalizeLabel(metadata.inReplyTo) || null,
          references: normalizeLabel(metadata.references) || null,
          conversationId: normalizeLabel(metadata.conversationId) || null,
        },
        sanity: {
          occurredAtSane: occurred.sane,
        },
      },
      lineage: {
        derivedFrom: [],
        extractedByStage: "pst-memory-normalize",
        chainOfCustody: [
          {
            stage: "normalize",
            sourceType: normalizeLabel(row.source) || "pst:libratom",
            sourceId: clientRequestId,
          },
        ],
      },
      payload: {
        rawText: normalizeWhitespace(row.content || ""),
        bodyExcerpt: clipText(row.content || "", 500),
        participants: collectParticipants(metadata),
        sourceMetadata: {
          unitType: normalizeLabel(row.unitType) || null,
          twitterKind: normalizeLabel(metadata.twitterKind) || null,
          visibility: normalizeLabel(metadata.visibility) || null,
          sensitivity: normalizeLabel(metadata.sensitivity) || null,
          tweetId: normalizeLabel(metadata.tweetId) || null,
          conversationId: normalizeLabel(metadata.conversationId) || null,
          messageId: normalizeLabel(metadata.messageId) || null,
          eventType: normalizeLabel(metadata.eventType) || null,
          hashtags: Array.isArray(metadata.hashtags) ? metadata.hashtags : [],
          mentions: Array.isArray(metadata.mentions) ? metadata.mentions : [],
          urls: Array.isArray(metadata.urls) ? metadata.urls : [],
          localMediaFiles: Array.isArray(metadata.localMediaFiles) ? metadata.localMediaFiles : [],
          endorsementWeight: Number(metadata.endorsementWeight || 0) || 0,
          affinityWeight: Number(metadata.affinityWeight || 0) || 0,
        },
        attachmentRefs: Array.isArray(metadata.attachmentRefs)
          ? metadata.attachmentRefs
          : Array.isArray(metadata.attachmentNames)
            ? metadata.attachmentNames
            : [],
        attachmentMetadata: {
          attachmentProcessingMode: normalizeLabel(metadata.attachmentProcessingMode) || null,
          attachmentCount: Number(metadata.attachmentCount || 0) || 0,
          attachmentInlineCount: Number(metadata.attachmentInlineCount || 0) || 0,
          attachmentExtractedCount: Number(metadata.attachmentExtractedCount || 0) || 0,
          attachmentMetadataOnlyCount: Number(metadata.attachmentMetadataOnlyCount || 0) || 0,
          attachmentSkippedCount: Number(metadata.attachmentSkippedCount || 0) || 0,
          attachmentFetchErrorCount: Number(metadata.attachmentFetchErrorCount || 0) || 0,
          attachmentTextCharCount: Number(metadata.attachmentTextCharCount || metadata.attachmentTextChars || 0) || 0,
          attachmentNames: Array.isArray(metadata.attachmentNames) ? metadata.attachmentNames : [],
          attachmentMimeTypes: Array.isArray(metadata.attachmentMimeTypes) ? metadata.attachmentMimeTypes : [],
          attachmentTruncated: Boolean(metadata.attachmentTruncated),
          attachmentError: normalizeLabel(metadata.attachmentError) || null,
        },
        messageHeaders: {
          rawMessageId: normalizeLabel(metadata.rawMessageId) || null,
          messageId: normalizeLabel(metadata.messageId) || null,
          inReplyTo: normalizeLabel(metadata.inReplyTo) || null,
          references: normalizeLabel(metadata.references) || null,
          conversationId: normalizeLabel(metadata.conversationId) || null,
          cc: Array.isArray(metadata.cc) ? metadata.cc : [],
          bcc: Array.isArray(metadata.bcc) ? metadata.bcc : [],
        },
        sourceTimestampFields: {
          occurredAt: normalizeLabel(row.occurredAt) || null,
          messageDate: normalizeLabel(metadata.messageDate) || null,
          sourceSentAt: normalizeLabel(metadata.sourceSentAt) || null,
          sourceReceivedAt: normalizeLabel(metadata.sourceReceivedAt) || null,
          sentAt: normalizeLabel(metadata.sentAt) || null,
          receivedAt: normalizeLabel(metadata.receivedAt) || null,
        },
        importWarnings: occurred.sane ? [] : ["timestamp_out_of_sane_range_or_unparseable"],
      },
    },
  };
}

function toFactEventRecord({ runId, row, lineNumber, sourceIdByClientRequestId }) {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const clientRequestId =
    normalizeLabel(row.clientRequestId) || deriveRecordId("fact_req", [runId, normalizeWhitespace(row.content || "")]);
  const occurred = parseTimestamp(row.occurredAt || metadata.sourceSentAt || metadata.sourceReceivedAt);
  const evidenceIds = collectSourceRequestIds(metadata)
    .map((id) => sourceIdByClientRequestId.get(id))
    .filter(Boolean);
  const eventType = deriveEventType(row);
  const id = deriveRecordId("fact", [runId, clientRequestId, eventType]);
  const actors = collectParticipants(metadata).map((label) => ({ label }));
  const rawSidecarId = promotedRawSidecarId(runId, clientRequestId);
  return {
    rawSidecar: {
      id: rawSidecarId,
      recordType: "raw_promoted_metadata",
      runId,
      sourceId: clientRequestId,
      lineNumber,
      rawMetadata: metadata,
      rawRow: row,
    },
    record: {
      id,
      recordType: "fact_event",
      schemaVersion: "canonical-corpus.v1",
      runId,
      sourceType: normalizeLabel(row.source) || "pst:promoted-memory",
      sourceId: clientRequestId,
      occurredAt: occurred.value,
      timePrecision: occurred.precision,
      importance: Number(metadata.score || 0),
      confidence: Number(metadata.confidence || 0.6),
      tags: dedupeStrings(Array.isArray(row.tags) ? row.tags : []),
      actors,
      entities: [],
      topics: collectTopics(metadata, row.tags),
      provenance: {
        sourceLocation: {
          threadKey: normalizeLabel(metadata.threadKey) || null,
          sourceClientRequestIds: collectSourceRequestIds(metadata),
          lineNumber,
        },
        rawMetadataRef: rawSidecarId,
        quotedEvidence: clipText(row.content || "", 260),
      },
      lineage: {
        derivedFrom: evidenceIds,
        extractedByStage: "pst-memory-promote",
        chainOfCustody: [
          {
            stage: "promote",
            sourceType: normalizeLabel(row.source) || "pst:promoted-memory",
            sourceId: clientRequestId,
          },
        ],
      },
      payload: {
        eventType,
        summary: clipText(row.content || "", 240),
        claimText: normalizeWhitespace(row.content || ""),
        polarity: eventType === "blocker" ? "negative" : "neutral",
        decisionState: deriveDecisionState(row.content || ""),
        beneficiaries: [],
        affectedParties: actors.map((actor) => actor.label),
        evidenceIds,
        companionThreadIds: Array.isArray(metadata.relatedMemoryIds) ? metadata.relatedMemoryIds : [],
        analysisType: normalizeLabel(metadata.analysisType) || null,
        memoryLayer: normalizeLabel(metadata.memoryLayer) || null,
        attachmentName: normalizeLabel(metadata.attachmentName || metadata.attachmentFileName) || null,
        attachmentMimeType: normalizeLabel(metadata.mimeType || metadata.attachmentMimeType) || null,
        attachmentHash: normalizeLabel(metadata.attachmentHash) || null,
        attachmentMetadata: {
          attachmentCount: Number(metadata.attachmentCount || 0) || 0,
          attachmentNames: Array.isArray(metadata.attachmentNames) ? metadata.attachmentNames : [],
          attachmentMimeTypes: Array.isArray(metadata.attachmentMimeTypes) ? metadata.attachmentMimeTypes : [],
          attachmentTextChars: Number(metadata.attachmentTextCharCount || metadata.attachmentTextChars || 0) || 0,
        },
        contact: normalizeLabel(metadata.contact) || null,
        contactThreadCount: Number(metadata.threadCount || 0) || null,
        cc: Array.isArray(metadata.cc) ? metadata.cc : [],
        bcc: Array.isArray(metadata.bcc) ? metadata.bcc : [],
        timeWindow: normalizeLabel(metadata.timeWindow) || null,
        participantSet: Array.isArray(metadata.participantSet) ? metadata.participantSet : [],
        topicTokens: Array.isArray(metadata.topicTokens) ? metadata.topicTokens : [],
        patternHints: Array.isArray(metadata.patternHints) ? metadata.patternHints : [],
        loopState: normalizeLabel(metadata.loopState) || null,
        participantDomains: Array.isArray(metadata.participantDomains) ? metadata.participantDomains : [],
        temporalBuckets: Array.isArray(metadata.temporalBuckets) ? metadata.temporalBuckets : [],
        signalFamily: normalizeLabel(metadata.signalFamily) || null,
        signalSubfamily: normalizeLabel(metadata.signalSubfamily) || normalizeLabel(metadata.analysisType) || null,
        signalLane: normalizeLabel(metadata.signalLane) || null,
        temporalGrain: normalizeLabel(metadata.temporalGrain) || null,
        eraMonth: normalizeLabel(metadata.eraMonth) || null,
        eraQuarter: normalizeLabel(metadata.eraQuarter) || null,
        evidenceRichness: normalizeLabel(metadata.evidenceRichness) || null,
        attributionStrength: normalizeLabel(metadata.attributionStrength) || null,
        provisional: normalizeLabel(metadata.memoryLayer) === "episodic",
        qualifiedRate: Number(metadata.qualifiedRate || 0) || null,
        shiftScore: Number(metadata.shiftScore || 0) || null,
        belowThresholdCandidate: Boolean(metadata.belowThresholdCandidate),
        contextSignals: metadata.contextSignals && typeof metadata.contextSignals === "object" ? metadata.contextSignals : {},
        structureSignalCount: Number(metadata.structureSignalCount || 0) || 0,
        rawMetadataRef: rawSidecarId,
      },
    },
  };
}

function sortByOccurredAt(rows) {
  return rows
    .slice()
    .sort((left, right) => {
      const leftMs = Date.parse(String(left?.occurredAt || "")) || 0;
      const rightMs = Date.parse(String(right?.occurredAt || "")) || 0;
      return leftMs - rightMs;
    });
}

function buildHypotheses({ runId, factEvents }) {
  const supportedTypes = new Set([
    "decision",
    "commitment",
    "blocker",
    "approval",
    "influence_signal",
    "relationship_transition",
    "cadence_pattern",
    "urgency_pattern",
    "followthrough_pattern",
    "correction_pattern",
    "context_switch",
    "identity_shift",
    "relationship_rhythm",
    "domain_shift",
    "narrative_revision",
    "document_dependency",
    "document_evidence",
    "document_pattern",
    "document_reuse",
    "document_profile",
    "document_family",
    "timeline_anchor",
    "relationship_artifact",
    "workstream_artifact",
    "identity_artifact",
  ]);
  const hypotheses = [];

  for (const fact of factEvents) {
    const eventType = normalizeLabel(fact?.payload?.eventType);
    if (!supportedTypes.has(eventType)) continue;
    const actors = Array.isArray(fact.actors) ? fact.actors.map((actor) => normalizeLabel(actor?.label)).filter(Boolean) : [];
    const topics = Array.isArray(fact.topics) ? fact.topics.slice(0, 4) : [];
    const statementParts = [];
    if (eventType === "decision" || eventType === "commitment") statementParts.push("This outcome was likely shaped by the active decision thread");
    else if (eventType === "blocker") statementParts.push("This outcome was likely constrained by a blocker or unresolved risk");
    else if (eventType === "approval") statementParts.push("This outcome was likely unlocked by approval or sign-off");
    else if (eventType === "cadence_pattern") statementParts.push("This pattern suggests a recurring cadence or time-based rhythm in how Micah operated");
    else if (eventType === "urgency_pattern") statementParts.push("This pattern suggests a recognizable urgency or crisis-response posture");
    else if (eventType === "followthrough_pattern") statementParts.push("This pattern suggests a recurring followthrough style around completion, reopening, or drift");
    else if (eventType === "correction_pattern" || eventType === "narrative_revision") statementParts.push("This pattern suggests a recurring habit of publicly revising or clarifying prior understanding");
    else if (eventType === "context_switch") statementParts.push("This pattern suggests frequent switching across contexts, topics, or social spheres");
    else if (eventType === "identity_shift" || eventType === "domain_shift") statementParts.push("This pattern suggests a change in Micah's operating mode across eras rather than a static baseline");
    else if (eventType === "relationship_rhythm") statementParts.push("This recurring contact pattern suggests a durable relationship rhythm that shaped how life or work was experienced");
    else if (eventType === "document_dependency") statementParts.push("This pattern suggests decisions or actions repeatedly depended on document trails and attachments");
    else if (eventType === "relationship_transition") statementParts.push("This recurring contact likely represents a meaningful relationship or influence channel over time");
    else if (eventType === "document_evidence" || eventType === "document_pattern" || eventType === "document_reuse") statementParts.push("This attachment or document likely carries context that shaped later decisions or interpretations");
    else statementParts.push("This pattern suggests recurring influence across the same people or topics");
    if (actors.length > 0) statementParts.push(`involving ${actors.slice(0, 4).join(", ")}`);
    if (topics.length > 0) statementParts.push(`around ${topics.join(", ")}`);

    hypotheses.push({
      id: deriveRecordId("hyp", [runId, fact.id]),
      recordType: "hypothesis",
      schemaVersion: "canonical-corpus.v1",
      runId,
      sourceType: fact.sourceType,
      sourceId: fact.sourceId,
      occurredAt: fact.occurredAt,
      timePrecision: fact.timePrecision,
      importance: Number(fact.importance || 0),
      confidence: Number(Math.max(0.25, Math.min(0.95, Number(fact.confidence || 0.6) * 0.85)).toFixed(3)),
      tags: dedupeStrings(["provisional", eventType, ...(Array.isArray(fact.tags) ? fact.tags : [])]),
      actors: Array.isArray(fact.actors) ? fact.actors : [],
      entities: [],
      topics: Array.isArray(fact.topics) ? fact.topics : [],
      provenance: {
        quotedEvidence: fact?.payload?.summary || null,
      },
      lineage: {
        derivedFrom: [fact.id, ...(Array.isArray(fact?.payload?.evidenceIds) ? fact.payload.evidenceIds : [])],
        extractedByStage: "pst-memory-corpus-export",
        chainOfCustody: [
          {
            stage: "corpus-export",
            sourceType: fact.sourceType,
            sourceId: fact.sourceId,
          },
        ],
      },
      payload: {
        hypothesisType:
          eventType === "influence_signal"
            ? "influence_pattern"
            : eventType === "relationship_rhythm"
              ? "relationship_intensity"
              : eventType === "followthrough_pattern"
                ? "followthrough_reliability"
                : eventType === "correction_pattern" || eventType === "narrative_revision"
                  ? "narrative_self_correction"
                  : eventType === "cadence_pattern" || eventType === "urgency_pattern" || eventType === "context_switch"
                    ? "identity_style_pattern"
                    : eventType === "identity_shift" || eventType === "domain_shift"
                      ? "identity_mode"
                      : eventType === "document_dependency"
                        ? "document_dependency"
                        : "decision_driver",
        statement: `${statementParts.join(" ")}.`,
        subjectIds: [fact.id],
        influenceMap: actors.map((label) => ({ actor: label, role: "participant" })),
        supportingEvidenceIds: [fact.id, ...(Array.isArray(fact?.payload?.evidenceIds) ? fact.payload.evidenceIds : [])],
        counterEvidenceIds: [],
        reasoningMethod: "heuristic:event-and-thread-patterns.v1",
        status: "provisional",
        reviewNotes: "Aggressive inference is allowed, but hypotheses remain distinct from fact records.",
      },
    });

    if (actors.length > 1) {
      hypotheses.push({
        id: deriveRecordId("hyp", [runId, fact.id, "beneficiary-map"]),
        recordType: "hypothesis",
        schemaVersion: "canonical-corpus.v1",
        runId,
        sourceType: fact.sourceType,
        sourceId: fact.sourceId,
        occurredAt: fact.occurredAt,
        timePrecision: fact.timePrecision,
        importance: Number(fact.importance || 0),
        confidence: Number(Math.max(0.2, Math.min(0.85, Number(fact.confidence || 0.6) * 0.7)).toFixed(3)),
        tags: dedupeStrings(["beneficiary-map", eventType, ...(Array.isArray(fact.tags) ? fact.tags : [])]),
        actors: Array.isArray(fact.actors) ? fact.actors : [],
        entities: [],
        topics: Array.isArray(fact.topics) ? fact.topics : [],
        provenance: {
          quotedEvidence: fact?.payload?.summary || null,
        },
        lineage: {
          derivedFrom: [fact.id, ...(Array.isArray(fact?.payload?.evidenceIds) ? fact.payload.evidenceIds : [])],
          extractedByStage: "pst-memory-corpus-export",
          chainOfCustody: [{ stage: "corpus-export", sourceType: fact.sourceType, sourceId: fact.sourceId }],
        },
        payload: {
          hypothesisType: "beneficiary_map",
          statement: "The participants in this event likely had unequal upside or downside depending on the outcome, so this should be reviewed as a beneficiary map rather than a neutral event.",
          subjectIds: [fact.id],
          influenceMap: actors.map((label, index) => ({ actor: label, role: index === 0 ? "possible-driver" : "possible-affected-party" })),
          supportingEvidenceIds: [fact.id, ...(Array.isArray(fact?.payload?.evidenceIds) ? fact.payload.evidenceIds : [])],
          counterEvidenceIds: [],
          reasoningMethod: "heuristic:participant-benefit-scan.v1",
          status: "provisional",
          reviewNotes: "Use this for deeper later investigation of incentives and impact.",
        },
      });
    }

    if (eventType === "relationship_transition" && actors.length > 0) {
      hypotheses.push({
        id: deriveRecordId("hyp", [runId, fact.id, "relationship-channel"]),
        recordType: "hypothesis",
        schemaVersion: "canonical-corpus.v1",
        runId,
        sourceType: fact.sourceType,
        sourceId: fact.sourceId,
        occurredAt: fact.occurredAt,
        timePrecision: fact.timePrecision,
        importance: Number(fact.importance || 0),
        confidence: Number(Math.max(0.25, Math.min(0.9, Number(fact.confidence || 0.6) * 0.8)).toFixed(3)),
        tags: dedupeStrings(["relationship-channel", ...(Array.isArray(fact.tags) ? fact.tags : [])]),
        actors: Array.isArray(fact.actors) ? fact.actors : [],
        entities: [],
        topics: Array.isArray(fact.topics) ? fact.topics : [],
        provenance: { quotedEvidence: fact?.payload?.summary || null },
        lineage: {
          derivedFrom: [fact.id, ...(Array.isArray(fact?.payload?.evidenceIds) ? fact.payload.evidenceIds : [])],
          extractedByStage: "pst-memory-corpus-export",
          chainOfCustody: [{ stage: "corpus-export", sourceType: fact.sourceType, sourceId: fact.sourceId }],
        },
        payload: {
          hypothesisType: "relationship_channel",
          statement: "This recurring contact pattern should be reviewed as a durable relationship channel that may have shaped opportunities, decisions, or constraints over time.",
          subjectIds: [fact.id],
          influenceMap: actors.map((label) => ({ actor: label, role: "relationship-node" })),
          supportingEvidenceIds: [fact.id, ...(Array.isArray(fact?.payload?.evidenceIds) ? fact.payload.evidenceIds : [])],
          counterEvidenceIds: [],
          reasoningMethod: "heuristic:recurrent-contact-patterns.v1",
          status: "provisional",
          reviewNotes: "Useful for mapping who entered, exited, or repeatedly influenced the story.",
        },
      });
    }

    if (
      eventType === "document_evidence" ||
      eventType === "document_pattern" ||
      eventType === "document_reuse" ||
      eventType === "document_dependency" ||
      eventType === "document_profile" ||
      eventType === "document_family" ||
      eventType === "timeline_anchor" ||
      eventType === "relationship_artifact" ||
      eventType === "workstream_artifact" ||
      eventType === "identity_artifact"
    ) {
      hypotheses.push({
        id: deriveRecordId("hyp", [runId, fact.id, "document-context"]),
        recordType: "hypothesis",
        schemaVersion: "canonical-corpus.v1",
        runId,
        sourceType: fact.sourceType,
        sourceId: fact.sourceId,
        occurredAt: fact.occurredAt,
        timePrecision: fact.timePrecision,
        importance: Number(fact.importance || 0),
        confidence: Number(Math.max(0.2, Math.min(0.88, Number(fact.confidence || 0.6) * 0.78)).toFixed(3)),
        tags: dedupeStrings(["document-context", ...(Array.isArray(fact.tags) ? fact.tags : [])]),
        actors: Array.isArray(fact.actors) ? fact.actors : [],
        entities: [],
        topics: Array.isArray(fact.topics) ? fact.topics : [],
        provenance: { quotedEvidence: fact?.payload?.summary || null },
        lineage: {
          derivedFrom: [fact.id, ...(Array.isArray(fact?.payload?.evidenceIds) ? fact.payload.evidenceIds : [])],
          extractedByStage: "pst-memory-corpus-export",
          chainOfCustody: [{ stage: "corpus-export", sourceType: fact.sourceType, sourceId: fact.sourceId }],
        },
        payload: {
          hypothesisType: "document_context",
          statement:
            eventType === "timeline_anchor"
              ? "This document likely acts as a reliable chronology anchor for surrounding decisions, relationships, or workstreams."
              : eventType === "relationship_artifact"
                ? "This document likely preserves relationship context that would be easy to miss if we only followed correspondence."
                : eventType === "workstream_artifact"
                  ? "This document likely captures workstream structure, scope, or delivery assumptions more directly than surrounding messages."
                  : eventType === "identity_artifact"
                    ? "This document likely exposes identity, career, creative, or life-context signal that matters beyond operational correspondence."
                    : eventType === "document_family"
                      ? "This document family likely represents a recurring context pattern rather than an isolated artifact."
                      : "This document trail likely contains rationale, requirements, or hidden state that matters as much as the surrounding correspondence.",
          subjectIds: [fact.id],
          influenceMap: [],
          supportingEvidenceIds: [fact.id, ...(Array.isArray(fact?.payload?.evidenceIds) ? fact.payload.evidenceIds : [])],
          counterEvidenceIds: [],
          reasoningMethod: "heuristic:attachment-context-scan.v1",
          status: "provisional",
          reviewNotes: "Treat attachments, docs, and their metadata as primary context sources.",
        },
      });
    }

    if (eventType === "identity_shift" || eventType === "domain_shift") {
      hypotheses.push({
        id: deriveRecordId("hyp", [runId, fact.id, "identity-shift-driver"]),
        recordType: "hypothesis",
        schemaVersion: "canonical-corpus.v1",
        runId,
        sourceType: fact.sourceType,
        sourceId: fact.sourceId,
        occurredAt: fact.occurredAt,
        timePrecision: fact.timePrecision,
        importance: Number(fact.importance || 0),
        confidence: Number(Math.max(0.22, Math.min(0.9, Number(fact.confidence || 0.6) * 0.82)).toFixed(3)),
        tags: dedupeStrings(["identity-shift", ...(Array.isArray(fact.tags) ? fact.tags : [])]),
        actors: Array.isArray(fact.actors) ? fact.actors : [],
        entities: [],
        topics: Array.isArray(fact.topics) ? fact.topics : [],
        provenance: { quotedEvidence: fact?.payload?.summary || null },
        lineage: {
          derivedFrom: [fact.id, ...(Array.isArray(fact?.payload?.evidenceIds) ? fact.payload.evidenceIds : [])],
          extractedByStage: "pst-memory-corpus-export",
          chainOfCustody: [{ stage: "corpus-export", sourceType: fact.sourceType, sourceId: fact.sourceId }],
        },
        payload: {
          hypothesisType: "identity_shift_driver",
          statement: "This shift likely reflects a change in operating mode, social context, or external obligations rather than mere thread noise.",
          subjectIds: [fact.id],
          influenceMap: actors.map((label) => ({ actor: label, role: "identity-context" })),
          supportingEvidenceIds: [fact.id, ...(Array.isArray(fact?.payload?.evidenceIds) ? fact.payload.evidenceIds : [])],
          counterEvidenceIds: [],
          reasoningMethod: "heuristic:era-local-identity-shift.v1",
          status: "provisional",
          reviewNotes: "Treat identity as era-local and allow conflicting modes across time.",
        },
      });
    }

    const bccParticipants = Array.isArray(fact?.payload?.bcc) ? fact.payload.bcc.map((value) => normalizeLabel(value)).filter(Boolean) : [];
    if (bccParticipants.length > 0) {
      hypotheses.push({
        id: deriveRecordId("hyp", [runId, fact.id, "bcc-pressure"]),
        recordType: "hypothesis",
        schemaVersion: "canonical-corpus.v1",
        runId,
        sourceType: fact.sourceType,
        sourceId: fact.sourceId,
        occurredAt: fact.occurredAt,
        timePrecision: fact.timePrecision,
        importance: Number(fact.importance || 0),
        confidence: Number(Math.max(0.2, Math.min(0.82, Number(fact.confidence || 0.6) * 0.68)).toFixed(3)),
        tags: dedupeStrings(["bcc-pressure", "politics", ...(Array.isArray(fact.tags) ? fact.tags : [])]),
        actors: Array.isArray(fact.actors) ? fact.actors : [],
        entities: [],
        topics: Array.isArray(fact.topics) ? fact.topics : [],
        provenance: { quotedEvidence: fact?.payload?.summary || null },
        lineage: {
          derivedFrom: [fact.id, ...(Array.isArray(fact?.payload?.evidenceIds) ? fact.payload.evidenceIds : [])],
          extractedByStage: "pst-memory-corpus-export",
          chainOfCustody: [{ stage: "corpus-export", sourceType: fact.sourceType, sourceId: fact.sourceId }],
        },
        payload: {
          hypothesisType: "social_pressure_signal",
          statement: "BCC usage here may indicate hidden audience management, social pressure, or political signaling beyond the visible thread.",
          subjectIds: [fact.id],
          influenceMap: bccParticipants.map((actor) => ({ actor, role: "hidden-audience" })),
          supportingEvidenceIds: [fact.id, ...(Array.isArray(fact?.payload?.evidenceIds) ? fact.payload.evidenceIds : [])],
          counterEvidenceIds: [],
          reasoningMethod: "heuristic:bcc-political-signal.v1",
          status: "provisional",
          reviewNotes: "Treat BCC as a soft signal of hidden audience or pressure, not proof of intent.",
        },
      });
    }
  }

  return sortByOccurredAt(hypotheses);
}

function linesOrFallback(title, lines, fallback) {
  return [title, "", ...(lines.length > 0 ? lines : [fallback])];
}

function buildDossiers({ runId, sourceUnitCount, factEvents, hypotheses }) {
  const dossierSlug = (value) =>
    String(value || "unknown")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "unknown";
  const decisions = factEvents.filter((fact) => ["decision", "commitment", "blocker"].includes(normalizeLabel(fact?.payload?.eventType)));
  const topHypotheses = hypotheses.slice().sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0)).slice(0, 15);
  const actorCounts = new Map();
  for (const fact of factEvents) {
    for (const actor of Array.isArray(fact.actors) ? fact.actors : []) {
      const label = normalizeLabel(actor?.label);
      if (!label) continue;
      actorCounts.set(label, Number(actorCounts.get(label) || 0) + 1);
    }
  }
  const topActors = Array.from(actorCounts.entries()).sort((a, b) => Number(b[1]) - Number(a[1]) || String(a[0]).localeCompare(String(b[0]))).slice(0, 12);

  const overviewLines = [
    "# Canonical Corpus Overview",
    "",
    `- Run ID: \`${runId}\``,
    `- Source units: ${sourceUnitCount}`,
    `- Fact events: ${factEvents.length}`,
    `- Hypotheses: ${hypotheses.length}`,
    `- Primary mining lens: decisions + influence`,
    "",
    "## Top Actors",
    ...(topActors.length > 0 ? topActors.map(([label, count]) => `- ${label}: ${count} high-signal references`) : ["- No actors surfaced in promoted records."]),
  ];

  const decisionLines = linesOrFallback(
    "# Decision Timeline",
    decisions.slice(-25).reverse().map((fact) => `- ${normalizeLabel(fact.occurredAt) || "unknown-time"}: ${fact.payload.summary} (\`${fact.id}\`)`),
    "- No decision or blocker records were promoted in this run."
  );

  const influenceLines = linesOrFallback(
    "# Influence Hypotheses",
    topHypotheses.map((hypothesis) => {
      const supporting = Array.isArray(hypothesis?.payload?.supportingEvidenceIds) ? hypothesis.payload.supportingEvidenceIds.join(", ") : "";
      return `- ${hypothesis.payload.statement} Confidence ${hypothesis.confidence}. Evidence: ${supporting}`;
    }),
    "- No influence hypotheses were emitted in this run."
  );

  const relationshipLines = linesOrFallback(
    "# Relationship Channels",
    factEvents.filter((fact) => normalizeLabel(fact?.payload?.eventType) === "relationship_transition").slice(-25).reverse().map((fact) => `- ${fact.payload.summary} (\`${fact.id}\`)`),
    "- No relationship-transition facts were promoted in this run."
  );

  const documentLines = linesOrFallback(
    "# Document And Attachment Signals",
    factEvents
      .filter((fact) =>
        [
          "document_evidence",
          "document_pattern",
          "document_reuse",
          "document_dependency",
          "document_profile",
          "document_family",
          "timeline_anchor",
          "relationship_artifact",
          "workstream_artifact",
          "identity_artifact",
        ].includes(normalizeLabel(fact?.payload?.eventType))
      )
      .slice(-25)
      .reverse()
      .map((fact) => `- ${fact.payload.summary} (\`${fact.id}\`)`),
    "- No document or attachment signals were promoted in this run."
  );

  const headerSignalFacts = factEvents.filter((fact) => {
    const cc = Array.isArray(fact?.payload?.cc) ? fact.payload.cc : [];
    const bcc = Array.isArray(fact?.payload?.bcc) ? fact.payload.bcc : [];
    return cc.length > 0 || bcc.length > 0;
  });
  const headerLines = linesOrFallback(
    "# Header And Routing Signals",
    headerSignalFacts.slice(-25).reverse().map((fact) => {
      const ccCount = Array.isArray(fact?.payload?.cc) ? fact.payload.cc.length : 0;
      const bccCount = Array.isArray(fact?.payload?.bcc) ? fact.payload.bcc.length : 0;
      return `- ${fact.payload.summary} [${[ccCount ? `cc=${ccCount}` : null, bccCount ? `bcc=${bccCount}` : null].filter(Boolean).join(", ") || "header-topology"}] (\`${fact.id}\`)`;
    }),
    "- No header/routing signal facts were promoted in this run."
  );

  const actorState = new Map();
  for (const fact of factEvents) {
    for (const actor of Array.isArray(fact.actors) ? fact.actors : []) {
      const label = normalizeLabel(actor?.label) || normalizeLabel(actor?.id);
      if (!label) continue;
      const existing = actorState.get(label) || { label, count: 0, firstSeen: null, lastSeen: null, topics: new Map() };
      existing.count += 1;
      if (isEraTimestampSane(fact.occurredAt)) {
        if (!existing.firstSeen || fact.occurredAt < existing.firstSeen) existing.firstSeen = fact.occurredAt;
        if (!existing.lastSeen || fact.occurredAt > existing.lastSeen) existing.lastSeen = fact.occurredAt;
      }
      for (const topic of Array.isArray(fact.topics) ? fact.topics : []) {
        const topicLabel = normalizeLabel(topic?.label) || normalizeLabel(topic?.id) || normalizeLabel(topic);
        if (!topicLabel) continue;
        existing.topics.set(topicLabel, Number(existing.topics.get(topicLabel) || 0) + 1);
      }
      actorState.set(label, existing);
    }
  }

  const peopleLines = linesOrFallback(
    "# People Arcs",
    Array.from(actorState.values())
      .sort((a, b) => Number(b.count) - Number(a.count) || String(a.label).localeCompare(String(b.label)))
      .slice(0, 25)
      .map((entry) => {
        const topTopics = Array.from(entry.topics.entries()).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 3).map(([label]) => label).join(", ");
        return `- ${entry.label}: ${entry.count} linked events from ${entry.firstSeen || "unknown-time"} to ${entry.lastSeen || "unknown-time"}${topTopics ? `; recurring topics: ${topTopics}` : ""}`;
      }),
    "- No people arcs surfaced in promoted records."
  );

  const influenceArcHypotheses = hypotheses.filter((hypothesis) => ["decision_driver", "influence_pattern", "beneficiary_map", "relationship_channel"].includes(normalizeLabel(hypothesis?.payload?.hypothesisType)));
  const influenceArcLines = linesOrFallback(
    "# Influence Arcs",
    influenceArcHypotheses.slice().sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0)).slice(0, 25).map((hypothesis) => {
      const supporting = Array.isArray(hypothesis?.payload?.supportingEvidenceIds) ? hypothesis.payload.supportingEvidenceIds.length : 0;
      return `- ${hypothesis.payload.statement} Confidence ${hypothesis.confidence}. Supporting evidence count: ${supporting}. (\`${hypothesis.id}\`)`;
    }),
    "- No influence arcs were emitted in this run."
  );

  const pressureHypotheses = hypotheses.filter((hypothesis) => normalizeLabel(hypothesis?.payload?.hypothesisType) === "social_pressure_signal");
  const pressureLines = linesOrFallback(
    "# Political And Social Pressure Signals",
    pressureHypotheses.slice().sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0)).slice(0, 25).map((hypothesis) => {
      const hiddenAudience = Array.isArray(hypothesis?.payload?.influenceMap) ? hypothesis.payload.influenceMap.length : 0;
      return `- ${hypothesis.payload.statement} Confidence ${hypothesis.confidence}. Hidden audience count: ${hiddenAudience}. (\`${hypothesis.id}\`)`;
    }),
    "- No social-pressure hypotheses were emitted in this run."
  );

  const personDossiers = Array.from(actorState.values())
    .sort((a, b) => Number(b.count) - Number(a.count) || String(a.label).localeCompare(String(b.label)))
    .slice(0, 12)
    .map((entry) => {
      const relatedFacts = factEvents.filter((fact) => (Array.isArray(fact.actors) ? fact.actors : []).some((actor) => (normalizeLabel(actor?.label) || normalizeLabel(actor?.id)) === entry.label));
      const relatedHypotheses = hypotheses.filter((hypothesis) => (Array.isArray(hypothesis.actors) ? hypothesis.actors : []).some((actor) => (normalizeLabel(actor?.label) || normalizeLabel(actor?.id)) === entry.label));
      const counterparties = new Map();
      for (const fact of relatedFacts) {
        for (const actor of Array.isArray(fact.actors) ? fact.actors : []) {
          const label = normalizeLabel(actor?.label) || normalizeLabel(actor?.id);
          if (!label || label === entry.label) continue;
          counterparties.set(label, Number(counterparties.get(label) || 0) + 1);
        }
      }
      const transitions = relatedFacts.filter((fact) => ["relationship_transition", "decision", "commitment"].includes(normalizeLabel(fact?.payload?.eventType))).slice(-12).reverse().map((fact) => `- ${fact.occurredAt || "unknown-time"}: ${fact.payload.summary} (\`${fact.id}\`)`);
      const topCounterparties = Array.from(counterparties.entries()).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 5).map(([label, count]) => `- ${label}: ${count} co-appearances`);
      const strongestHypotheses = relatedHypotheses.slice().sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0)).slice(0, 6).map((hypothesis) => `- ${hypothesis.payload.statement} Confidence ${hypothesis.confidence}. (\`${hypothesis.id}\`)`);
      const body = [
        `# Person Arc: ${entry.label}`,
        "",
        `- Linked events: ${entry.count}`,
        `- First seen: ${entry.firstSeen || "unknown-time"}`,
        `- Last seen: ${entry.lastSeen || "unknown-time"}`,
        "",
        "## Strongest Counterparties",
        ...(topCounterparties.length > 0 ? topCounterparties : ["- No repeated counterparties were detected."]),
        "",
        "## Recent Transitions",
        ...(transitions.length > 0 ? transitions : ["- No decision or relationship transitions were promoted for this person."]),
        "",
        "## Strongest Hypotheses",
        ...(strongestHypotheses.length > 0 ? strongestHypotheses : ["- No influence or pressure hypotheses were linked to this person in this run."]),
      ];
      return {
        id: deriveRecordId("dos", [runId, "person-arc", entry.label]),
        dossierType: "person_arc",
        path: `dossiers/person-${dossierSlug(entry.label)}.md`,
        body: `${body.join("\n")}\n`,
        subjectLabel: entry.label,
        recordRefs: [...relatedFacts.map((fact) => fact.id), ...relatedHypotheses.map((hypothesis) => hypothesis.id)],
        keySignals: relatedFacts.slice(-10).reverse().map((fact) => fact.payload.summary),
      };
    });

  const influenceWindowState = new Map();
  for (const hypothesis of influenceArcHypotheses) {
    const windowKey = safeEraKey(hypothesis.occurredAt).replace(/^unknown-era$/, "unknown-window");
    const primaryTopic = normalizeLabel(hypothesis?.topics?.[0]?.label) || normalizeLabel(hypothesis?.topics?.[0]?.id) || normalizeLabel(hypothesis?.topics?.[0]) || "untagged";
    const key = `${windowKey}::${primaryTopic}`;
    const existing = influenceWindowState.get(key) || { windowKey, primaryTopic, count: 0, confidenceTotal: 0, actors: new Map(), recordIds: new Set() };
    existing.count += 1;
    existing.confidenceTotal += Number(hypothesis.confidence || 0);
    existing.recordIds.add(hypothesis.id);
    for (const actor of Array.isArray(hypothesis.actors) ? hypothesis.actors : []) {
      const label = normalizeLabel(actor?.label) || normalizeLabel(actor?.id);
      if (!label) continue;
      existing.actors.set(label, Number(existing.actors.get(label) || 0) + 1);
    }
    influenceWindowState.set(key, existing);
  }
  const influenceWindowClusters = Array.from(influenceWindowState.values()).sort((a, b) => Number(b.count) - Number(a.count)).slice(0, 20);
  const influenceWindowLines = linesOrFallback(
    "# Influence Windows",
    influenceWindowClusters.map((cluster) => {
      const avgConfidence = cluster.count > 0 ? (cluster.confidenceTotal / cluster.count).toFixed(3) : "0.000";
      const topActors = Array.from(cluster.actors.entries()).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 4).map(([label]) => label).join(", ");
      return `- ${cluster.windowKey} | topic=${cluster.primaryTopic}: ${cluster.count} influence records, avg confidence ${avgConfidence}${topActors ? `, top actors: ${topActors}` : ""}`;
    }),
    "- No influence windows were emitted in this run."
  );

  const identityFacts = factEvents.filter((fact) => ["cadence_pattern", "urgency_pattern", "followthrough_pattern", "correction_pattern", "context_switch", "document_dependency", "identity_shift", "domain_shift", "narrative_revision", "relationship_rhythm"].includes(normalizeLabel(fact?.payload?.eventType)));
  const identityRhythmLines = linesOrFallback(
    "# Identity Rhythms",
    identityFacts
      .filter((fact) => ["cadence_pattern", "urgency_pattern", "followthrough_pattern", "correction_pattern", "context_switch", "document_dependency"].includes(normalizeLabel(fact?.payload?.eventType)))
      .slice(-25)
      .reverse()
      .map((fact) => {
        const rate = Number(fact?.payload?.qualifiedRate || 0);
        const timeWindow = normalizeLabel(fact?.payload?.timeWindow);
        const detail = normalizeLabel(fact?.payload?.eventType) === "urgency_pattern" && rate > 0
          ? ` rate=${(rate * 100).toFixed(1)}%${timeWindow ? `, window=${timeWindow}` : ""}`
          : "";
        return `- ${fact.payload.summary}${detail} (\`${fact.id}\`)`;
      }),
    "- No qualifying identity rhythm records were promoted in this run."
  );
  const shiftFacts = identityFacts.filter(
    (fact) =>
      ["identity_shift", "domain_shift"].includes(normalizeLabel(fact?.payload?.eventType)) &&
      safeEraKeyFromFact(fact) !== "unknown-era" &&
      !Boolean(fact?.payload?.belowThresholdCandidate)
  );
  const nearShiftFacts = identityFacts.filter(
    (fact) =>
      ["identity_shift", "domain_shift"].includes(normalizeLabel(fact?.payload?.eventType)) &&
      Boolean(fact?.payload?.belowThresholdCandidate)
  );
  const identityShiftLines = linesOrFallback(
    "# Identity Shift Points",
    shiftFacts.length > 0
      ? shiftFacts.slice(-25).reverse().map((fact) => `- ${fact.payload.summary} (\`${fact.id}\`)`)
      : nearShiftFacts.slice(0, 3).map((fact) => `- Below threshold: ${fact.payload.summary} (\`${fact.id}\`)`),
    "- No identity shift points crossed the current evidence threshold."
  );
  const relationshipRhythmLines = linesOrFallback(
    "# Relationship Rhythm Channels",
    identityFacts.filter((fact) => normalizeLabel(fact?.payload?.eventType) === "relationship_rhythm").slice(-25).reverse().map((fact) => `- ${fact.payload.summary} (\`${fact.id}\`)`),
    "- No relationship rhythm channels were promoted in this run."
  );
  const revisionLines = linesOrFallback(
    "# Identity Revision Chains",
    identityFacts.filter((fact) => ["correction_pattern", "narrative_revision"].includes(normalizeLabel(fact?.payload?.eventType))).slice(-25).reverse().map((fact) => `- ${fact.payload.summary} (\`${fact.id}\`)`),
    "- No identity revision chains were promoted in this run."
  );
  const quarterlyIdentityEraState = new Map();
  const monthlyIdentityEraState = new Map();
  let unplacedIdentityFacts = 0;
  for (const fact of identityFacts) {
    const eraKey = safeEraKeyFromFact(fact);
    if (eraKey === "unknown-era") {
      unplacedIdentityFacts += 1;
      continue;
    }
    const target = /^\d{4}-Q[1-4]$/i.test(eraKey) ? quarterlyIdentityEraState : monthlyIdentityEraState;
    const existing = target.get(eraKey) || { count: 0, eventTypes: new Map(), topics: new Map() };
    existing.count += 1;
    const eventType = normalizeLabel(fact?.payload?.eventType) || "unknown";
    existing.eventTypes.set(eventType, Number(existing.eventTypes.get(eventType) || 0) + 1);
    for (const topic of Array.isArray(fact.topics) ? fact.topics : []) {
      const label = normalizeLabel(topic?.label) || normalizeLabel(topic?.id) || normalizeLabel(topic);
      if (!label) continue;
      existing.topics.set(label, Number(existing.topics.get(label) || 0) + 1);
    }
    target.set(eraKey, existing);
  }
  const formatEraLines = (entries) =>
    entries.map(([eraKey, info]) => {
      const topEventType = Array.from(info.eventTypes.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";
      const topTopic = Array.from(info.topics.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "untagged";
      return `- ${eraKey}: ${info.count} identity-linked records; dominant mode ${topEventType}; dominant topic ${topTopic}`;
    });
  const identityEraLines = linesOrFallback(
    "# Identity Eras",
    [
      "## Quarterly Macro View",
      ...(
        formatEraLines(Array.from(quarterlyIdentityEraState.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0])))).length > 0
          ? formatEraLines(Array.from(quarterlyIdentityEraState.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
          : ["- No quarterly identity eras qualified in this run."]
      ),
      "",
      "## Monthly Micro View",
      ...(
        formatEraLines(Array.from(monthlyIdentityEraState.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0])))).length > 0
          ? formatEraLines(Array.from(monthlyIdentityEraState.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
          : ["- No monthly identity eras qualified in this run."]
      ),
      "",
      `- Unplaced evidence: ${unplacedIdentityFacts} identity-linked records lacked a sane era anchor`,
    ],
    "- No identity-era buckets qualified for this run."
  );

  return [
    { id: deriveRecordId("dos", [runId, "overview"]), dossierType: "overview", path: "dossiers/overview.md", body: `${overviewLines.join("\n")}\n` },
    { id: deriveRecordId("dos", [runId, "decision-timeline"]), dossierType: "decision_timeline", path: "dossiers/decision-timeline.md", body: `${decisionLines.join("\n")}\n` },
    { id: deriveRecordId("dos", [runId, "influence-hypotheses"]), dossierType: "influence_hypotheses", path: "dossiers/influence-hypotheses.md", body: `${influenceLines.join("\n")}\n` },
    { id: deriveRecordId("dos", [runId, "relationship-channels"]), dossierType: "relationship_channels", path: "dossiers/relationship-channels.md", body: `${relationshipLines.join("\n")}\n` },
    { id: deriveRecordId("dos", [runId, "document-signals"]), dossierType: "document_signals", path: "dossiers/document-signals.md", body: `${documentLines.join("\n")}\n` },
    { id: deriveRecordId("dos", [runId, "header-signals"]), dossierType: "header_signals", path: "dossiers/header-signals.md", body: `${headerLines.join("\n")}\n` },
    { id: deriveRecordId("dos", [runId, "people-arcs"]), dossierType: "people_arcs", path: "dossiers/people-arcs.md", body: `${peopleLines.join("\n")}\n` },
    { id: deriveRecordId("dos", [runId, "influence-arcs"]), dossierType: "influence_arcs", path: "dossiers/influence-arcs.md", body: `${influenceArcLines.join("\n")}\n` },
    { id: deriveRecordId("dos", [runId, "pressure-signals"]), dossierType: "pressure_signals", path: "dossiers/pressure-signals.md", body: `${pressureLines.join("\n")}\n` },
    { id: deriveRecordId("dos", [runId, "influence-windows"]), dossierType: "influence_windows", path: "dossiers/influence-windows.md", body: `${influenceWindowLines.join("\n")}\n`, recordRefs: influenceWindowClusters.flatMap((cluster) => [...cluster.recordIds]), keySignals: influenceWindowClusters.map((cluster) => `${cluster.windowKey}:${cluster.primaryTopic}`) },
    { id: deriveRecordId("dos", [runId, "identity-rhythms"]), dossierType: "identity_rhythms", path: "dossiers/identity-rhythms.md", body: `${identityRhythmLines.join("\n")}\n`, recordRefs: identityFacts.filter((fact) => ["cadence_pattern", "urgency_pattern", "followthrough_pattern", "correction_pattern", "context_switch", "document_dependency"].includes(normalizeLabel(fact?.payload?.eventType))).map((fact) => fact.id) },
    { id: deriveRecordId("dos", [runId, "identity-shift-points"]), dossierType: "identity_shift_points", path: "dossiers/identity-shift-points.md", body: `${identityShiftLines.join("\n")}\n`, recordRefs: [...shiftFacts, ...nearShiftFacts].map((fact) => fact.id) },
    { id: deriveRecordId("dos", [runId, "relationship-rhythm-channels"]), dossierType: "relationship_rhythm_channels", path: "dossiers/relationship-rhythm-channels.md", body: `${relationshipRhythmLines.join("\n")}\n`, recordRefs: identityFacts.filter((fact) => normalizeLabel(fact?.payload?.eventType) === "relationship_rhythm").map((fact) => fact.id) },
    { id: deriveRecordId("dos", [runId, "identity-revision-chains"]), dossierType: "identity_revision_chains", path: "dossiers/identity-revision-chains.md", body: `${revisionLines.join("\n")}\n`, recordRefs: identityFacts.filter((fact) => ["correction_pattern", "narrative_revision"].includes(normalizeLabel(fact?.payload?.eventType))).map((fact) => fact.id) },
    { id: deriveRecordId("dos", [runId, "identity-eras"]), dossierType: "identity_eras", path: "dossiers/identity-eras.md", body: `${identityEraLines.join("\n")}\n`, recordRefs: identityFacts.map((fact) => fact.id) },
    ...personDossiers,
  ];
}

function toWritableDossierRecord({ runId, dossier, factEvents, hypotheses }) {
  const recordRefs = new Set(Array.isArray(dossier.recordRefs) ? dossier.recordRefs : []);
  if (dossier.dossierType === "decision_timeline") {
    for (const fact of factEvents) if (["decision", "commitment", "blocker"].includes(normalizeLabel(fact?.payload?.eventType))) recordRefs.add(fact.id);
  } else if (dossier.dossierType === "influence_hypotheses") {
    for (const hypothesis of hypotheses.slice(0, 15)) recordRefs.add(hypothesis.id);
  } else if (dossier.dossierType === "relationship_channels") {
    for (const fact of factEvents) if (normalizeLabel(fact?.payload?.eventType) === "relationship_transition") recordRefs.add(fact.id);
  } else if (dossier.dossierType === "document_signals") {
    for (const fact of factEvents) {
      if (
        [
          "document_evidence",
          "document_pattern",
          "document_reuse",
          "document_dependency",
          "document_profile",
          "document_family",
          "timeline_anchor",
          "relationship_artifact",
          "workstream_artifact",
          "identity_artifact",
        ].includes(normalizeLabel(fact?.payload?.eventType))
      ) {
        recordRefs.add(fact.id);
      }
    }
  } else if (dossier.dossierType === "header_signals") {
    for (const fact of factEvents) {
      const cc = Array.isArray(fact?.payload?.cc) ? fact.payload.cc : [];
      const bcc = Array.isArray(fact?.payload?.bcc) ? fact.payload.bcc : [];
      if (cc.length > 0 || bcc.length > 0) recordRefs.add(fact.id);
    }
  } else if (dossier.dossierType === "people_arcs") {
    for (const fact of factEvents) if (Array.isArray(fact.actors) && fact.actors.length > 0) recordRefs.add(fact.id);
  } else if (dossier.dossierType === "influence_arcs") {
    for (const hypothesis of hypotheses) if (["decision_driver", "influence_pattern", "beneficiary_map", "relationship_channel"].includes(normalizeLabel(hypothesis?.payload?.hypothesisType))) recordRefs.add(hypothesis.id);
  } else if (dossier.dossierType === "pressure_signals") {
    for (const hypothesis of hypotheses) if (normalizeLabel(hypothesis?.payload?.hypothesisType) === "social_pressure_signal") recordRefs.add(hypothesis.id);
  }
  return {
    id: dossier.id,
    recordType: "dossier",
    schemaVersion: "canonical-corpus.v1",
    runId,
    sourceType: "pst:canonical-corpus",
    sourceId: dossier.id,
    occurredAt: isoNow(),
    timePrecision: "second",
    importance: 1,
    confidence: 1,
    tags: [dossier.dossierType, "markdown"],
    actors: [],
    entities: [],
    topics: [],
    provenance: { sourceLocation: { dossierPath: dossier.path } },
    lineage: {
      derivedFrom: [...recordRefs],
      extractedByStage: "pst-memory-corpus-export",
      chainOfCustody: [{ stage: "corpus-export", sourceType: "pst:canonical-corpus", sourceId: dossier.id }],
    },
    payload: {
      dossierType: dossier.dossierType,
      timeRange: null,
      keySignals: Array.isArray(dossier.keySignals) ? dossier.keySignals : [],
      notableTransitions: [],
      openQuestions: [],
      recordRefs: [...recordRefs],
      markdownPath: dossier.path,
      subjectLabel: dossier.subjectLabel || null,
    },
  };
}

function loadExistingRecords(path) {
  if (!existsSync(path)) return [];
  return readJsonlWithRaw(path).filter((entry) => entry.ok && entry.value && typeof entry.value === "object").map((entry) => entry.value);
}

function buildManifest({ status, runId, paths, checkpoint, counts, warnings }) {
  return {
    schema: "canonical-corpus-manifest.v3",
    generatedAt: isoNow(),
    runId,
    status,
    inputs: {
      unitsPath: paths.unitsPath,
      promotedPath: paths.promotedPath,
      unitsSizeBytes: existsSync(paths.unitsPath) ? Number(statSync(paths.unitsPath).size || 0) : 0,
      promotedSizeBytes: existsSync(paths.promotedPath) ? Number(statSync(paths.promotedPath).size || 0) : 0,
    },
    outputDir: paths.outputDir,
    artifacts: {
      sourceUnits: paths.sourceUnitsPath,
      factEvents: paths.factEventsPath,
      hypotheses: paths.hypothesesPath,
      dossiers: paths.dossiersPath,
      dossierDir: paths.dossierDir,
      sourceIndexDir: paths.sourceIndexDir,
      rawSidecarDir: paths.rawSidecarDir,
      checkpointPath: paths.checkpointPath,
      deadLetterDir: paths.deadLetterDir,
    },
    counts,
    stageStatus: checkpoint.stageStatus,
    warnings,
    memory: memorySnapshot(),
    resumeMode: checkpoint.resumeMode || "fresh-start",
    freshWipePerformed: Boolean(checkpoint.freshWipePerformed),
    sourceIndex: checkpoint.sourceIndex || { strategy: "hash-sharded-jsonl", shardCount: 256, shardRows: {} },
    posture: {
      primaryLens: "decisions-and-influence",
      timeModel: "global-timeline-plus-local-threads",
      inferenceModel: "evidence-plus-hypotheses",
      durability: "append-only-layers",
      rawMetadataStrategy: "sidecar-records",
      exportMode: "best-effort-with-checkpoints",
    },
  };
}

async function run() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const unitsPath = resolve(REPO_ROOT, readStringFlag(flags, "units", "./imports/pst/mailbox-units.jsonl"));
  const promotedPath = resolve(REPO_ROOT, readStringFlag(flags, "promoted", "./imports/pst/mailbox-promoted-memory.jsonl"));
  const outputDirFlag = readStringFlag(flags, "output-dir", "").trim();
  const runId =
    readStringFlag(flags, "run-id", "").trim() ||
    normalizeLabel(outputDirFlag.split("/").filter(Boolean).at(-1)) ||
    normalizeLabel(unitsPath.split("/").filter(Boolean).at(-2)) ||
    "pst-corpus-run";
  const outputDir = resolve(REPO_ROOT, outputDirFlag || `./output/memory/corpus/${runId}`);
  const manifestPath = resolve(REPO_ROOT, readStringFlag(flags, "manifest", join(outputDir, "manifest.json")));
  const checkpointDir = resolve(REPO_ROOT, readStringFlag(flags, "checkpoint-dir", join(outputDir, "checkpoints")));
  const deadLetterDir = resolve(REPO_ROOT, readStringFlag(flags, "dead-letter-dir", join(outputDir, "dead-letter")));
  const rawSidecarDir = resolve(REPO_ROOT, readStringFlag(flags, "raw-sidecar-dir", join(outputDir, "raw-sidecars")));
  const resume = readBoolFlag(flags, "resume", true);
  const fresh = readBoolFlag(flags, "fresh", false);
  const preflightOnly = readBoolFlag(flags, "preflight-only", false);
  const allowEmptyPromoted = readBoolFlag(flags, "allow-empty-promoted", false);
  const sampleLines = readNumberFlag(flags, "sample-lines", 100, { min: 1, max: 1000 });
  const maxErrors = readNumberFlag(flags, "max-errors", 500, { min: 1, max: 100000 });
  const printJson = readBoolFlag(flags, "json", false);

  mkdirSync(outputDir, { recursive: true });
  mkdirSync(checkpointDir, { recursive: true });
  mkdirSync(deadLetterDir, { recursive: true });
  mkdirSync(rawSidecarDir, { recursive: true });
  mkdirSync(resolve(outputDir, "dossiers"), { recursive: true });

  const paths = {
    unitsPath,
    promotedPath,
    outputDir,
    manifestPath,
    checkpointPath: resolve(checkpointDir, "export-checkpoint.json"),
    deadLetterDir,
    rawSidecarDir,
    sourceUnitsPath: resolve(outputDir, "source-units.jsonl"),
    factEventsPath: resolve(outputDir, "fact-events.jsonl"),
    hypothesesPath: resolve(outputDir, "hypotheses.jsonl"),
    dossiersPath: resolve(outputDir, "dossiers.jsonl"),
    dossierDir: resolve(outputDir, "dossiers"),
    sourceIndexDir: resolve(outputDir, "source-index"),
    sourceUnitsDeadLetterPath: resolve(deadLetterDir, "source-units.dead-letter.jsonl"),
    factEventsDeadLetterPath: resolve(deadLetterDir, "fact-events.dead-letter.jsonl"),
    rawSourceUnitsPath: resolve(rawSidecarDir, "source-unit-raw.jsonl"),
    rawPromotedPath: resolve(rawSidecarDir, "promoted-raw.jsonl"),
  };

  if (fresh) wipeManagedOutputs(paths);

  const checkpoint = initCheckpoint(paths.checkpointPath, {
    runId,
    paths,
    sourceIndex: { strategy: "hash-sharded-jsonl", shardCount: 256, shardRows: {} },
  });
  checkpoint.paths = paths;
  checkpoint.runId = runId;
  checkpoint.status = "running";
  checkpoint.resumeMode = fresh ? "fresh" : resume ? "resume" : "fresh-start";
  checkpoint.freshWipePerformed = fresh;
  checkpoint.sourceIndex = checkpoint.sourceIndex || { strategy: "hash-sharded-jsonl", shardCount: 256, shardRows: {} };
  writeJson(paths.checkpointPath, checkpoint);

  const preflight = {
    units: await preflightJsonl(unitsPath, { sampleLines, maxInvalidLines: Math.min(5, sampleLines) }),
    promoted: await preflightJsonl(promotedPath, { sampleLines, maxInvalidLines: Math.min(5, sampleLines) }),
  };

  const warnings = [];
  if (allowEmptyPromoted && preflight.promoted && preflight.promoted.reason === "zero_byte_file") {
    preflight.promoted = {
      ...preflight.promoted,
      ok: true,
      reason: null,
      allowedEmpty: true,
      valid: 0,
      invalid: 0,
      sampled: 0,
    };
    warnings.push({ stage: "preflight", warning: "allow_empty_promoted_applied", path: promotedPath });
  }
  checkpoint.preflight = preflight;
  checkpoint.updatedAt = isoNow();
  writeJson(paths.checkpointPath, checkpoint);

  if (!preflight.units.ok) usageError(`Units preflight failed: ${preflight.units.reason}`);
  if (!preflight.promoted.ok) usageError(`Promoted preflight failed: ${preflight.promoted.reason}`);
  const counts = {
    sourceUnits: 0,
    factEvents: 0,
    hypotheses: 0,
    dossiers: 0,
    deadLetterRows: 0,
    malformedRows: 0,
  };

  if (preflightOnly) {
    const manifest = buildManifest({ status: "preflight_only", runId, paths, checkpoint, counts, warnings });
    writeJson(manifestPath, manifest);
    if (printJson) process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    else process.stdout.write(`preflight complete: ${manifestPath}\n`);
    return;
  }

  let factEvents = [];
  let hypotheses = [];

  try {
    if (!(resume && !fresh && checkpoint.stageStatus.preflight?.status === "completed")) {
      appendStageStatus(checkpoint, "preflight", "completed", { memory: memorySnapshot(), preflight });
      writeJson(paths.checkpointPath, checkpoint);
    }

    if (resume && !fresh && checkpoint.stageStatus.source_units?.status === "completed") {
      counts.sourceUnits = Number(checkpoint.counts?.sourceUnits || checkpoint.stageStatus.source_units?.emitted || 0);
    } else {
      const priorSourceStage = checkpoint.stageStatus.source_units || {};
      const canResumeSource =
        resume &&
        !fresh &&
        normalizeLabel(priorSourceStage.status) === "running" &&
        Number(priorSourceStage.lastCommittedLine || 0) > 0 &&
        (await sourceStageCountsMatchCheckpoint(paths, checkpoint));
      if (!canResumeSource && priorSourceStage.status) {
        wipeSourceStageOutputs(paths);
      }
      appendStageStatus(checkpoint, "source_units", "running", { memory: memorySnapshot() });
      writeJson(paths.checkpointPath, checkpoint);
      mkdirSync(paths.sourceIndexDir, { recursive: true });
      const sourceWriter = createJsonlWriter(paths.sourceUnitsPath, { append: canResumeSource });
      const rawWriter = createJsonlWriter(paths.rawSourceUnitsPath, { append: canResumeSource });
      const deadWriter = createJsonlWriter(paths.sourceUnitsDeadLetterPath, { append: canResumeSource });
      const shardWriters = new Map();
      const getShardWriter = (sourceId) => {
        const shard = sourceIndexShardName(sourceId);
        if (!shardWriters.has(shard)) {
          shardWriters.set(shard, createJsonlWriter(sourceIndexShardPath(paths.sourceIndexDir, sourceId), { append: canResumeSource }));
        }
        return { shard, writer: shardWriters.get(shard) };
      };
      const batchSize = 1000;
      let malformedRows = Number(priorSourceStage.malformedRows || 0);
      let sourceRows = Number(priorSourceStage.emitted || 0);
      let lastCommittedLine = Number(priorSourceStage.lastCommittedLine || 0);
      let batchRecords = [];
      let batchRawSidecars = [];
      let batchIndexRows = [];
      const shardRows =
        checkpoint.sourceIndex?.shardRows && typeof checkpoint.sourceIndex.shardRows === "object"
          ? checkpoint.sourceIndex.shardRows
          : {};
      const flushBatch = async () => {
        if (batchRecords.length === 0) return;
        for (let index = 0; index < batchRecords.length; index += 1) {
          await sourceWriter.writeRow(batchRecords[index]);
          await rawWriter.writeRow(batchRawSidecars[index]);
          const indexRow = batchIndexRows[index];
          const { shard, writer } = getShardWriter(indexRow.sourceId);
          await writer.writeRow(indexRow);
          shardRows[shard] = Number(shardRows[shard] || 0) + 1;
        }
        sourceRows += batchRecords.length;
        lastCommittedLine = Number(batchRecords[batchRecords.length - 1]?.provenance?.sourceLocation?.lineNumber || lastCommittedLine);
        checkpoint.counts.sourceUnits = sourceRows;
        checkpoint.sourceIndex = { strategy: "hash-sharded-jsonl", shardCount: 256, shardRows };
        appendStageStatus(checkpoint, "source_units", "running", {
          emitted: sourceRows,
          malformedRows,
          lastCommittedLine,
          batchSize,
          memory: memorySnapshot(),
        });
        writeJson(paths.checkpointPath, checkpoint);
        batchRecords = [];
        batchRawSidecars = [];
        batchIndexRows = [];
      };
      for await (const entry of streamJsonlWithRaw(unitsPath)) {
        if (canResumeSource && entry.lineNumber <= lastCommittedLine) continue;
        if (!entry.ok || !entry.value || typeof entry.value !== "object") {
          malformedRows += 1;
          await deadWriter.writeRow({ stage: "source_units", reason: "malformed_jsonl_row", lineNumber: entry.lineNumber, raw: entry.raw });
          if (malformedRows >= maxErrors) throw new Error(`source_units exceeded max malformed rows (${maxErrors})`);
          continue;
        }
        const converted = toSourceUnitRecord({ runId, row: entry.value, lineNumber: entry.lineNumber });
        batchRawSidecars.push(converted.rawSidecar);
        batchRecords.push(converted.record);
        batchIndexRows.push({
          sourceId: converted.record.sourceId,
          recordId: converted.record.id,
          occurredAt: converted.record.occurredAt,
          threadKey: normalizeLabel(converted.record?.provenance?.sourceLocation?.threadKey) || null,
          lineNumber: entry.lineNumber,
        });
        if (batchRecords.length >= batchSize) await flushBatch();
      }
      await flushBatch();
      await sourceWriter.close();
      await rawWriter.close();
      await deadWriter.close();
      for (const writer of shardWriters.values()) await writer.close();
      const sourceRowsOnDisk = await countJsonlRows(paths.sourceUnitsPath);
      if (sourceRowsOnDisk !== sourceRows) {
        throw new Error(`source_units integrity mismatch: expected ${sourceRows} rows, found ${sourceRowsOnDisk}`);
      }
      counts.sourceUnits = sourceRows;
      counts.deadLetterRows += malformedRows;
      counts.malformedRows += malformedRows;
      checkpoint.counts.sourceUnits = sourceRows;
      checkpoint.sourceIndex = { strategy: "hash-sharded-jsonl", shardCount: 256, shardRows };
      appendStageStatus(checkpoint, "source_units", "completed", {
        emitted: sourceRows,
        malformedRows,
        lastCommittedLine,
        batchSize,
        memory: memorySnapshot(),
      });
      writeJson(paths.checkpointPath, checkpoint);
    }

    if (resume && !fresh && checkpoint.stageStatus.fact_events?.status === "completed") {
      factEvents = loadExistingRecords(paths.factEventsPath);
      counts.factEvents = factEvents.length;
    } else {
      wipeDerivedStageOutputs(paths);
      appendStageStatus(checkpoint, "fact_events", "running", { memory: memorySnapshot() });
      writeJson(paths.checkpointPath, checkpoint);
      const factWriter = createJsonlWriter(paths.factEventsPath);
      const rawWriter = createJsonlWriter(paths.rawPromotedPath);
      const deadWriter = createJsonlWriter(paths.factEventsDeadLetterPath);
      const promotedEntries = await collectPromotedEntries(promotedPath, { maxErrors });
      const sourceIdByClientRequestId = await loadSourceIdLookupFromShards(paths.sourceIndexDir, promotedEntries.neededSourceIds);
      let malformedRows = 0;
      for (const entry of promotedEntries.rows) {
        if (entry.malformed) {
          malformedRows += 1;
          await deadWriter.writeRow({ stage: "fact_events", reason: "malformed_jsonl_row", lineNumber: entry.lineNumber, raw: entry.raw });
          continue;
        }
        const converted = toFactEventRecord({ runId, row: entry.value, lineNumber: entry.lineNumber, sourceIdByClientRequestId });
        await rawWriter.writeRow(converted.rawSidecar);
        await factWriter.writeRow(converted.record);
        factEvents.push(converted.record);
      }
      await factWriter.close();
      await rawWriter.close();
      await deadWriter.close();
      factEvents = sortByOccurredAt(factEvents);
      counts.factEvents = factEvents.length;
      counts.deadLetterRows += malformedRows;
      counts.malformedRows += malformedRows;
      checkpoint.counts.factEvents = factEvents.length;
      appendStageStatus(checkpoint, "fact_events", "completed", {
        emitted: factEvents.length,
        malformedRows,
        resolvedEvidenceIds: sourceIdByClientRequestId.size,
        memory: memorySnapshot(),
      });
      writeJson(paths.checkpointPath, checkpoint);
    }

    if (resume && !fresh && checkpoint.stageStatus.hypotheses?.status === "completed") {
      hypotheses = loadExistingRecords(paths.hypothesesPath);
      counts.hypotheses = hypotheses.length;
    } else {
      appendStageStatus(checkpoint, "hypotheses", "running", { memory: memorySnapshot() });
      writeJson(paths.checkpointPath, checkpoint);
      hypotheses = buildHypotheses({ runId, factEvents });
      const writer = createJsonlWriter(paths.hypothesesPath);
      for (const row of hypotheses) await writer.writeRow(row);
      await writer.close();
      counts.hypotheses = hypotheses.length;
      checkpoint.counts.hypotheses = hypotheses.length;
      appendStageStatus(checkpoint, "hypotheses", "completed", { emitted: hypotheses.length, memory: memorySnapshot() });
      writeJson(paths.checkpointPath, checkpoint);
    }

    appendStageStatus(checkpoint, "dossiers", "running", { memory: memorySnapshot() });
    writeJson(paths.checkpointPath, checkpoint);
    const dossierFiles = buildDossiers({ runId, sourceUnitCount: counts.sourceUnits, factEvents, hypotheses });
    const dossierRecords = dossierFiles.map((dossier) => toWritableDossierRecord({ runId, dossier, factEvents, hypotheses }));
    const dossierWriter = createJsonlWriter(paths.dossiersPath);
    for (const row of dossierRecords) await dossierWriter.writeRow(row);
    await dossierWriter.close();
    for (const dossier of dossierFiles) {
      writeJson(resolve(outputDir, dossier.path.replace(/\.md$/, ".json")), { path: dossier.path, id: dossier.id });
      writeJson(resolve(outputDir, `${dossier.path}.refs.jsonl`.replace(/\.jsonl$/, ".json")), { dossierId: dossier.id, refCount: Array.isArray(dossier.recordRefs) ? dossier.recordRefs.length : 0 });
      const markdownPath = resolve(outputDir, dossier.path);
      mkdirSync(dirname(markdownPath), { recursive: true });
      writeFileSync(markdownPath, dossier.body, "utf8");
      const refsWriter = createJsonlWriter(resolve(outputDir, `${dossier.path}.refs.jsonl`));
      for (const recordId of Array.isArray(dossier.recordRefs) ? dossier.recordRefs : []) {
        await refsWriter.writeRow({ dossierId: dossier.id, recordId });
      }
      await refsWriter.close();
    }
    const dossierRowsOnDisk = await countJsonlRows(paths.dossiersPath);
    if (dossierRowsOnDisk !== dossierRecords.length) {
      throw new Error(`dossiers integrity mismatch: expected ${dossierRecords.length} rows, found ${dossierRowsOnDisk}`);
    }
    counts.dossiers = dossierRecords.length;
    checkpoint.counts.dossiers = dossierRecords.length;
    appendStageStatus(checkpoint, "dossiers", "completed", { emitted: dossierRecords.length, memory: memorySnapshot() });
    checkpoint.status = counts.deadLetterRows > 0 ? "completed_with_warnings" : "completed";
    writeJson(paths.checkpointPath, checkpoint);

    const manifest = buildManifest({ status: counts.deadLetterRows > 0 ? "completed_with_warnings" : "completed", runId, paths, checkpoint, counts, warnings });
    writeJson(manifestPath, manifest);
    if (printJson) process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    else {
      process.stdout.write("pst-memory-corpus-export complete\n");
      process.stdout.write(`manifest: ${manifestPath}\n`);
      process.stdout.write(`output-dir: ${outputDir}\n`);
    }
  } catch (error) {
    checkpoint.status = "partial";
    checkpoint.errors = [...(Array.isArray(checkpoint.errors) ? checkpoint.errors : []), { at: isoNow(), message: String(error instanceof Error ? error.message : error) }];
    writeJson(paths.checkpointPath, checkpoint);
    const manifest = buildManifest({ status: "partial", runId, paths, checkpoint, counts, warnings: [...warnings, ...(checkpoint.errors || [])] });
    writeJson(manifestPath, manifest);
    throw error;
  }
}

run().catch((error) => {
  process.stderr.write(`pst-memory-corpus-export failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
