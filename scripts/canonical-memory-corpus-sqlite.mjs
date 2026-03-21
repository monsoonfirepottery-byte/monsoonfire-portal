#!/usr/bin/env node

import { DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCliArgs,
  readBoolFlag,
  readJson,
  readStringFlag,
  writeJson,
  isoNow,
  stableHash,
  streamJsonlWithRaw,
} from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "Canonical memory corpus SQLite materializer",
      "",
      "Usage:",
      "  node ./scripts/canonical-memory-corpus-sqlite.mjs --manifest ./output/memory/corpus/<run-id>/manifest.json",
      "",
      "Options:",
      "  --manifest <path>  Manifest created by corpus export",
      "  --output <path>    SQLite database output path",
      "  --json             Print report JSON",
    ].join("\n")
  );
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function openManifest(path) {
  const manifest = readJson(path, null);
  if (!manifest || typeof manifest !== "object") {
    throw new Error(`Unable to read manifest at ${path}`);
  }
  return manifest;
}

function flattenEdges(record) {
  const lineage = record?.lineage && typeof record.lineage === "object" ? record.lineage : {};
  const payload = record?.payload && typeof record.payload === "object" ? record.payload : {};
  const edges = [];
  for (const targetId of Array.isArray(lineage.derivedFrom) ? lineage.derivedFrom : []) {
    if (targetId) edges.push({ fromId: record.id, toId: String(targetId), edgeType: "derived_from" });
  }
  for (const targetId of Array.isArray(payload.evidenceIds) ? payload.evidenceIds : []) {
    if (targetId) edges.push({ fromId: record.id, toId: String(targetId), edgeType: "evidence" });
  }
  for (const targetId of Array.isArray(payload.supportingEvidenceIds) ? payload.supportingEvidenceIds : []) {
    if (targetId) edges.push({ fromId: record.id, toId: String(targetId), edgeType: "supports" });
  }
  for (const targetId of Array.isArray(payload.counterEvidenceIds) ? payload.counterEvidenceIds : []) {
    if (targetId) edges.push({ fromId: record.id, toId: String(targetId), edgeType: "counter_evidence" });
  }
  for (const targetId of Array.isArray(payload.subjectIds) ? payload.subjectIds : []) {
    if (targetId) edges.push({ fromId: record.id, toId: String(targetId), edgeType: "subject_of" });
  }
  for (const targetId of Array.isArray(payload.recordRefs) ? payload.recordRefs : []) {
    if (targetId) edges.push({ fromId: record.id, toId: String(targetId), edgeType: "dossier_ref" });
  }
  for (const targetId of Array.isArray(payload.companionThreadIds) ? payload.companionThreadIds : []) {
    if (targetId) edges.push({ fromId: record.id, toId: String(targetId), edgeType: "companion_thread" });
  }
  return edges;
}

function pushEntity(entities, seen, entity) {
  const type = String(entity?.entityType || "").trim();
  const label = String(entity?.entityLabel || "").trim();
  if (!type || !label) return;
  const entityKey = `${type}:${slug(label) || stableHash([label])}`;
  const role = String(entity?.role || "").trim() || null;
  const dedupeKey = `${entityKey}|${role || ""}`;
  if (seen.has(dedupeKey)) return;
  seen.add(dedupeKey);
  entities.push({
    recordId: String(entity.recordId || ""),
    entityKey,
    entityType: type,
    entityLabel: label,
    role,
    occurredAt: String(entity.occurredAt || ""),
    confidence: Number(entity.confidence || 0),
    importance: Number(entity.importance || 0),
    sourceRecordType: String(entity.sourceRecordType || ""),
  });
}

function flattenEntities(record) {
  const entities = [];
  const seen = new Set();
  const payload = record?.payload && typeof record.payload === "object" ? record.payload : {};
  const provenance = record?.provenance && typeof record.provenance === "object" ? record.provenance : {};
  const messageHeaders = payload?.messageHeaders && typeof payload.messageHeaders === "object" ? payload.messageHeaders : {};
  const sourceMetadata =
    payload?.sourceMetadata && typeof payload.sourceMetadata === "object"
      ? payload.sourceMetadata
      : provenance?.sourceMetadata && typeof provenance.sourceMetadata === "object"
        ? provenance.sourceMetadata
        : {};
  const recordBase = {
    recordId: String(record?.id || ""),
    occurredAt: String(record?.occurredAt || ""),
    confidence: Number(record?.confidence || 0),
    importance: Number(record?.importance || 0),
    sourceRecordType: String(record?.recordType || ""),
  };

  for (const actor of Array.isArray(record?.actors) ? record.actors : []) {
    const label = String(actor?.label || "").trim();
    if (!label) continue;
    pushEntity(entities, seen, { ...recordBase, entityType: "actor", entityLabel: label, role: "participant" });
  }
  for (const topic of Array.isArray(record?.topics) ? record.topics : []) {
    const label = String(topic || "").trim();
    if (!label) continue;
    pushEntity(entities, seen, { ...recordBase, entityType: "topic", entityLabel: label, role: "topic" });
  }

  const contact = String(payload.contact || "").trim();
  if (contact) pushEntity(entities, seen, { ...recordBase, entityType: "contact", entityLabel: contact, role: "contact" });

  const attachmentName = String(payload.attachmentName || "").trim();
  if (attachmentName) pushEntity(entities, seen, { ...recordBase, entityType: "document", entityLabel: attachmentName, role: "attachment-name" });

  const attachmentHash = String(payload.attachmentHash || "").trim();
  if (attachmentHash) pushEntity(entities, seen, { ...recordBase, entityType: "document_hash", entityLabel: attachmentHash, role: "attachment-hash" });

  const attachmentMimeType = String(payload.attachmentMimeType || "").trim();
  if (attachmentMimeType) pushEntity(entities, seen, { ...recordBase, entityType: "mime_type", entityLabel: attachmentMimeType, role: "attachment-mime-type" });

  for (const name of Array.isArray(payload?.attachmentMetadata?.attachmentNames) ? payload.attachmentMetadata.attachmentNames : []) {
    const label = String(name || "").trim();
    if (!label) continue;
    pushEntity(entities, seen, { ...recordBase, entityType: "document", entityLabel: label, role: "attachment-list" });
  }

  for (const value of Array.isArray(messageHeaders.cc) ? messageHeaders.cc : []) {
    const label = String(value || "").trim();
    if (!label) continue;
    pushEntity(entities, seen, { ...recordBase, entityType: "actor", entityLabel: label, role: "cc" });
  }
  for (const value of Array.isArray(messageHeaders.bcc) ? messageHeaders.bcc : []) {
    const label = String(value || "").trim();
    if (!label) continue;
    pushEntity(entities, seen, { ...recordBase, entityType: "actor", entityLabel: label, role: "bcc" });
  }
  for (const value of Array.isArray(payload.participantDomains) ? payload.participantDomains : []) {
    const label = String(value || "").trim().toLowerCase();
    if (!label) continue;
    pushEntity(entities, seen, { ...recordBase, entityType: "domain", entityLabel: label, role: "participant-domain" });
  }
  for (const value of Array.isArray(payload.temporalBuckets) ? payload.temporalBuckets : []) {
    const label = String(value || "").trim();
    if (!label) continue;
    pushEntity(entities, seen, { ...recordBase, entityType: "temporal_bucket", entityLabel: label, role: "time-bucket" });
  }
  for (const value of Array.isArray(payload.patternHints) ? payload.patternHints : []) {
    const label = String(value || "").trim();
    if (!label) continue;
    pushEntity(entities, seen, { ...recordBase, entityType: "pattern_hint", entityLabel: label, role: "hint" });
  }
  for (const value of Array.isArray(payload.participantSet) ? payload.participantSet : []) {
    const label = String(value || "").trim();
    if (!label) continue;
    pushEntity(entities, seen, { ...recordBase, entityType: "actor", entityLabel: label, role: "participant-set" });
  }
  for (const value of Array.isArray(payload.topicTokens) ? payload.topicTokens : []) {
    const label = String(value || "").trim();
    if (!label) continue;
    pushEntity(entities, seen, { ...recordBase, entityType: "topic_token", entityLabel: label, role: "topic-token" });
  }

  const twitterSourcePairs = [
    ["twitter_kind", sourceMetadata.twitterKind],
    ["visibility", sourceMetadata.visibility],
    ["sensitivity", sourceMetadata.sensitivity],
    ["tweet_id", sourceMetadata.tweetId],
    ["conversation_id", sourceMetadata.conversationId || messageHeaders.conversationId || provenance?.messageHeaders?.conversationId],
    ["message_id", sourceMetadata.messageId || messageHeaders.messageId || provenance?.messageHeaders?.messageId],
    ["event_type", sourceMetadata.eventType],
  ];
  for (const [entityType, rawValue] of twitterSourcePairs) {
    const label = String(rawValue || "").trim();
    if (!label) continue;
    pushEntity(entities, seen, { ...recordBase, entityType, entityLabel: label, role: "twitter-source" });
  }

  for (const value of Array.isArray(sourceMetadata.hashtags) ? sourceMetadata.hashtags : []) {
    const label = String(value || "").trim();
    if (!label) continue;
    pushEntity(entities, seen, { ...recordBase, entityType: "hashtag", entityLabel: label.replace(/^#/, ""), role: "hashtag" });
  }
  for (const value of Array.isArray(sourceMetadata.mentions) ? sourceMetadata.mentions : []) {
    const label = String(value || "").trim();
    if (!label) continue;
    pushEntity(entities, seen, { ...recordBase, entityType: "actor", entityLabel: label.startsWith("@") ? label : `@${label}`, role: "mention" });
  }
  for (const value of Array.isArray(sourceMetadata.localMediaFiles) ? sourceMetadata.localMediaFiles : []) {
    const label = String(value || "").trim();
    if (!label) continue;
    pushEntity(entities, seen, { ...recordBase, entityType: "document", entityLabel: label, role: "twitter-media-file" });
  }
  for (const value of Array.isArray(sourceMetadata.urls) ? sourceMetadata.urls : []) {
    const label = String(value || "").trim();
    if (!label) continue;
    pushEntity(entities, seen, { ...recordBase, entityType: "url", entityLabel: label, role: "url" });
  }

  const loopState = String(payload.loopState || "").trim();
  if (loopState) pushEntity(entities, seen, { ...recordBase, entityType: "loop_state", entityLabel: loopState, role: "loop-state" });

  const timeWindow = String(payload.timeWindow || "").trim();
  if (timeWindow) pushEntity(entities, seen, { ...recordBase, entityType: "analysis_window", entityLabel: timeWindow, role: "time-window" });

  const headerPairs = [
    ["raw_message_id", messageHeaders.rawMessageId || provenance?.messageHeaders?.rawMessageId],
    ["in_reply_to", messageHeaders.inReplyTo || provenance?.messageHeaders?.inReplyTo],
    ["references", messageHeaders.references || provenance?.messageHeaders?.references],
    ["thread_key", sourceMetadata.threadKey || provenance?.sourceLocation?.threadKey],
    ["mailbox", sourceMetadata.mailbox || provenance?.sourceLocation?.mailbox],
    ["mailbox_path", sourceMetadata.mailboxPath || provenance?.sourceLocation?.mailboxPath],
    ["provider_folder", sourceMetadata.providerFolder || provenance?.sourceLocation?.providerFolder],
  ];
  for (const [entityType, rawValue] of headerPairs) {
    const label = String(rawValue || "").trim();
    if (!label) continue;
    pushEntity(entities, seen, { ...recordBase, entityType, entityLabel: label, role: "header" });
  }

  const hybridPairs = [
    ["project_lane", sourceMetadata.projectLane || provenance?.sourceLocation?.projectLane],
    ["doc_path", sourceMetadata.docPath || provenance?.sourceLocation?.docPath],
    ["heading_path", sourceMetadata.headingPath || provenance?.sourceLocation?.headingPath],
    ["chunk_id", sourceMetadata.chunkId || provenance?.sourceLocation?.chunkId],
    ["content_hash", sourceMetadata.contentHash || provenance?.sourceLocation?.contentHash],
    ["session_file", sourceMetadata.sessionFile || provenance?.sourceLocation?.sessionFile],
    ["conversation_id", sourceMetadata.conversationId || provenance?.sourceLocation?.conversationId],
    ["message_node_id", sourceMetadata.messageNodeId || provenance?.sourceLocation?.messageNodeId],
    ["memory_kind", sourceMetadata.memoryKind],
    ["source_family", sourceMetadata.sourceFamily],
  ];
  for (const [entityType, rawValue] of hybridPairs) {
    const label = String(rawValue || "").trim();
    if (!label) continue;
    pushEntity(entities, seen, { ...recordBase, entityType, entityLabel: label, role: "hybrid-source" });
  }

  for (const value of Array.isArray(payload?.influenceMap) ? payload.influenceMap : []) {
    const label = String(value?.actor || "").trim();
    if (!label) continue;
    pushEntity(entities, seen, {
      ...recordBase,
      entityType: "actor",
      entityLabel: label,
      role: String(value?.role || "influence-node").trim() || "influence-node",
    });
  }

  return entities;
}

function flattenEntityEdgesForRecord(recordId, entityRows) {
  const edges = [];
  const seen = new Set();
  for (let index = 0; index < entityRows.length; index += 1) {
    for (let inner = index + 1; inner < entityRows.length; inner += 1) {
      const left = entityRows[index];
      const right = entityRows[inner];
      if (left.entityKey === right.entityKey) continue;
      const ordered = [left.entityKey, right.entityKey].sort();
      const edgeType =
        left.entityType === "actor" && right.entityType === "actor"
          ? "co_actor"
          : left.entityType.startsWith("document") || right.entityType.startsWith("document")
            ? "document_context"
            : left.entityType.includes("message") ||
                right.entityType.includes("message") ||
                left.entityType === "conversation_id" ||
                right.entityType === "conversation_id" ||
                left.entityType === "thread_key" ||
                right.entityType === "thread_key"
              ? "header_context"
              : "co_occurs";
      const dedupeKey = `${recordId}|${ordered[0]}|${ordered[1]}|${edgeType}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      edges.push({
        leftEntityKey: ordered[0],
        rightEntityKey: ordered[1],
        edgeType,
        recordId,
        occurredAt: String(left.occurredAt || right.occurredAt || ""),
        weight: 1,
      });
    }
  }
  return edges;
}

async function streamArtifactRecords(manifest, visitor) {
  const artifactPaths = [
    manifest?.artifacts?.sourceUnits,
    manifest?.artifacts?.factEvents,
    manifest?.artifacts?.hypotheses,
    manifest?.artifacts?.dossiers,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  for (const path of artifactPaths) {
    for await (const entry of streamJsonlWithRaw(path)) {
      if (!entry.ok || !entry.value || typeof entry.value !== "object") continue;
      await visitor(entry.value);
    }
  }
}

function run() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const manifestPath = resolve(REPO_ROOT, readStringFlag(flags, "manifest", ""));
  if (!readStringFlag(flags, "manifest", "").trim()) throw new Error("--manifest is required");
  const manifest = openManifest(manifestPath);
  const outputPath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "output", resolve(String(manifest.outputDir || "."), "corpus.sqlite"))
  );
  const printJson = readBoolFlag(flags, "json", false);

  const db = new DatabaseSync(outputPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    DROP TABLE IF EXISTS records;
    DROP TABLE IF EXISTS record_edges;
    DROP TABLE IF EXISTS record_entities;
    DROP TABLE IF EXISTS entity_edges;
    CREATE TABLE records (
      id TEXT PRIMARY KEY,
      record_type TEXT NOT NULL,
      run_id TEXT,
      source_type TEXT,
      source_id TEXT,
      occurred_at TEXT,
      time_precision TEXT,
      importance REAL,
      confidence REAL,
      tags_json TEXT,
      actors_json TEXT,
      topics_json TEXT,
      payload_json TEXT,
      provenance_json TEXT,
      lineage_json TEXT,
      raw_json TEXT NOT NULL
    );
    CREATE TABLE record_edges (
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      edge_type TEXT NOT NULL
    );
    CREATE TABLE record_entities (
      record_id TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_label TEXT NOT NULL,
      role TEXT,
      occurred_at TEXT,
      confidence REAL,
      importance REAL,
      source_record_type TEXT
    );
    CREATE TABLE entity_edges (
      left_entity_key TEXT NOT NULL,
      right_entity_key TEXT NOT NULL,
      edge_type TEXT NOT NULL,
      record_id TEXT NOT NULL,
      occurred_at TEXT,
      weight REAL NOT NULL DEFAULT 1
    );
    CREATE INDEX idx_records_record_type ON records(record_type);
    CREATE INDEX idx_records_occurred_at ON records(occurred_at);
    CREATE INDEX idx_records_source_type ON records(source_type);
    CREATE INDEX idx_edges_from_id ON record_edges(from_id);
    CREATE INDEX idx_edges_to_id ON record_edges(to_id);
    CREATE INDEX idx_record_entities_record_id ON record_entities(record_id);
    CREATE INDEX idx_record_entities_entity_key ON record_entities(entity_key);
    CREATE INDEX idx_entity_edges_left_key ON entity_edges(left_entity_key);
    CREATE INDEX idx_entity_edges_right_key ON entity_edges(right_entity_key);
  `);

  const insertRecord = db.prepare(`
    INSERT INTO records (
      id, record_type, run_id, source_type, source_id, occurred_at, time_precision,
      importance, confidence, tags_json, actors_json, topics_json, payload_json,
      provenance_json, lineage_json, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEdge = db.prepare(`INSERT INTO record_edges (from_id, to_id, edge_type) VALUES (?, ?, ?)`);
  const insertEntity = db.prepare(`
    INSERT INTO record_entities (
      record_id, entity_key, entity_type, entity_label, role, occurred_at, confidence, importance, source_record_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEntityEdge = db.prepare(`
    INSERT INTO entity_edges (
      left_entity_key, right_entity_key, edge_type, record_id, occurred_at, weight
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertMany = (records) => {
    db.exec("BEGIN");
    try {
      for (const record of records) {
        insertRecord.run(
          String(record.id || ""),
          String(record.recordType || ""),
          String(record.runId || ""),
          String(record.sourceType || ""),
          String(record.sourceId || ""),
          String(record.occurredAt || ""),
          String(record.timePrecision || ""),
          Number(record.importance || 0),
          Number(record.confidence || 0),
          json(record.tags),
          json(record.actors),
          json(record.topics),
          json(record.payload),
          json(record.provenance),
          json(record.lineage),
          json(record)
        );

        for (const edge of flattenEdges(record)) {
          insertEdge.run(edge.fromId, edge.toId, edge.edgeType);
        }

        const entityRows = flattenEntities(record);
        for (const entityRow of entityRows) {
          insertEntity.run(
            entityRow.recordId,
            entityRow.entityKey,
            entityRow.entityType,
            entityRow.entityLabel,
            entityRow.role,
            entityRow.occurredAt,
            entityRow.confidence,
            entityRow.importance,
            entityRow.sourceRecordType
          );
        }

        if (String(record.recordType || "") !== "source_unit") {
          for (const entityEdge of flattenEntityEdgesForRecord(String(record.id || ""), entityRows)) {
            insertEntityEdge.run(
              entityEdge.leftEntityKey,
              entityEdge.rightEntityKey,
              entityEdge.edgeType,
              entityEdge.recordId,
              entityEdge.occurredAt,
              entityEdge.weight
            );
          }
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  };

  const batch = [];
  const batchSize = 500;
  const runStreaming = async () => {
    await streamArtifactRecords(manifest, async (record) => {
      batch.push(record);
      if (batch.length >= batchSize) {
        insertMany(batch.splice(0, batch.length));
      }
    });
    if (batch.length > 0) insertMany(batch.splice(0, batch.length));
  };

  return runStreaming().then(() => {
    const report = {
      schema: "canonical-memory-corpus-sqlite-report.v1",
      generatedAt: isoNow(),
      manifestPath,
      outputPath,
      counts: {
        records: Number(db.prepare("SELECT COUNT(*) AS count FROM records").get().count || 0),
        edges: Number(db.prepare("SELECT COUNT(*) AS count FROM record_edges").get().count || 0),
        entities: Number(db.prepare("SELECT COUNT(*) AS count FROM record_entities").get().count || 0),
        entityEdges: Number(db.prepare("SELECT COUNT(*) AS count FROM entity_edges").get().count || 0),
      },
    };
    writeJson(resolve(dirname(outputPath), "corpus-sqlite-report.json"), report);
    if (printJson) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write("canonical-memory-corpus-sqlite complete\n");
      process.stdout.write(`db: ${outputPath}\n`);
    }
    db.close();
  }).catch((error) => {
    try { db.close(); } catch {}
    throw error;
  });
}

Promise.resolve()
  .then(run)
  .catch((error) => {
    process.stderr.write(`canonical-memory-corpus-sqlite failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
