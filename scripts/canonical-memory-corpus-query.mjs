#!/usr/bin/env node

import { DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCliArgs, readBoolFlag, readStringFlag, readNumberFlag } from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "Canonical memory corpus query helper",
      "",
      "Usage:",
      "  node ./scripts/canonical-memory-corpus-query.mjs --db ./path/to/corpus.sqlite --record-type hypothesis --text launch",
      "",
      "Options:",
      "  --db <path>             SQLite database path",
      "  --record-type <type>    Optional record type filter",
      "  --text <term>           Optional raw JSON LIKE filter",
      "  --record-id <id>        Fetch one record and its neighborhood",
      "  --neighbors <id>        Alias for --record-id",
      "  --entity <label>        Lookup records/entities by entity label",
      "  --entity-type <type>    Optional entity type filter",
      "  --edge-type <type>      Optional edge filter for neighborhood/entity queries",
      "  --limit <n>             Result limit (default: 20)",
      "  --json                  Print JSON rows",
    ].join("\n")
  );
}

function parseRawRow(row, printJson) {
  return {
    ...row,
    raw_json: printJson ? JSON.parse(String(row.raw_json || "{}")) : String(row.raw_json || ""),
  };
}

function fetchRecord(db, recordId, printJson) {
  const row = db
    .prepare(
      `SELECT id, record_type, occurred_at, source_type, confidence, importance, raw_json
       FROM records
       WHERE id = ?
       LIMIT 1`
    )
    .get(recordId);
  return row ? parseRawRow(row, printJson) : null;
}

function fetchNeighborhood(db, recordId, edgeType, limit, printJson) {
  const params = { recordId };
  const edgeClause = edgeType ? "AND edge_type = :edgeType" : "";
  if (edgeType) params.edgeType = edgeType;

  const linkedRecords = db
    .prepare(
      `SELECT edge_type, to_id AS neighbor_id
       FROM record_edges
       WHERE from_id = :recordId ${edgeClause}
       UNION ALL
       SELECT edge_type, from_id AS neighbor_id
       FROM record_edges
       WHERE to_id = :recordId ${edgeClause}
       LIMIT ${limit}`
    )
    .all(params)
    .map((row) => {
      const record = fetchRecord(db, row.neighbor_id, printJson);
      return record ? { edgeType: row.edge_type, record } : null;
    })
    .filter(Boolean);

  const entities = db
    .prepare(
      `SELECT entity_key, entity_type, entity_label, role, occurred_at
       FROM record_entities
       WHERE record_id = ?
       ORDER BY entity_type, entity_label
       LIMIT ${limit}`
    )
    .all(recordId);

  const relatedByEntity = db
    .prepare(
      `SELECT re.entity_key, re.entity_type, re.entity_label, re.role,
              r.id, r.record_type, r.occurred_at, r.source_type, r.confidence, r.importance, r.raw_json
       FROM record_entities seed
       JOIN record_entities re ON re.entity_key = seed.entity_key
       JOIN records r ON r.id = re.record_id
       WHERE seed.record_id = ?
         AND re.record_id <> ?
       ORDER BY r.occurred_at DESC, r.confidence DESC
       LIMIT ${limit}`
    )
    .all(recordId, recordId)
    .map((row) => ({
      entityKey: row.entity_key,
      entityType: row.entity_type,
      entityLabel: row.entity_label,
      role: row.role,
      record: parseRawRow(row, printJson),
    }));

  return {
    seed: fetchRecord(db, recordId, printJson),
    linkedRecords,
    entities,
    relatedByEntity,
  };
}

function fetchEntityView(db, entityLabel, entityType, edgeType, limit, printJson) {
  const clauses = ["entity_label LIKE :entityLabel"];
  const params = { entityLabel: `%${entityLabel}%` };
  if (entityType) {
    clauses.push("entity_type = :entityType");
    params.entityType = entityType;
  }

  const matchedEntities = db
    .prepare(
      `SELECT entity_key, entity_type, entity_label, role, COUNT(*) AS record_count
       FROM record_entities
       WHERE ${clauses.join(" AND ")}
       GROUP BY entity_key, entity_type, entity_label, role
       ORDER BY record_count DESC, entity_label
       LIMIT ${limit}`
    )
    .all(params);

  const records = db
    .prepare(
      `SELECT DISTINCT r.id, r.record_type, r.occurred_at, r.source_type, r.confidence, r.importance, r.raw_json
       FROM record_entities re
       JOIN records r ON r.id = re.record_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY r.occurred_at DESC, r.confidence DESC
       LIMIT ${limit}`
    )
    .all(params)
    .map((row) => parseRawRow(row, printJson));

  const edgeFilter = edgeType ? "AND ee.edge_type = :edgeType" : "";
  if (edgeType) params.edgeType = edgeType;
  const neighboringEntities = db
    .prepare(
      `SELECT base.entity_key AS seed_entity_key,
              CASE
                WHEN ee.left_entity_key = base.entity_key THEN ee.right_entity_key
                ELSE ee.left_entity_key
              END AS neighbor_entity_key,
              ee.edge_type,
              COUNT(*) AS weight,
              neighbor.entity_type AS neighbor_entity_type,
              neighbor.entity_label AS neighbor_entity_label
       FROM (
         SELECT DISTINCT entity_key
         FROM record_entities
         WHERE ${clauses.join(" AND ")}
       ) base
       JOIN entity_edges ee
         ON ee.left_entity_key = base.entity_key OR ee.right_entity_key = base.entity_key
       JOIN record_entities neighbor
         ON neighbor.entity_key = CASE
           WHEN ee.left_entity_key = base.entity_key THEN ee.right_entity_key
           ELSE ee.left_entity_key
         END
       WHERE 1 = 1 ${edgeFilter}
       GROUP BY seed_entity_key, neighbor_entity_key, ee.edge_type, neighbor.entity_type, neighbor.entity_label
       ORDER BY weight DESC, neighbor_entity_label
       LIMIT ${limit}`
    )
    .all(params);

  return { matchedEntities, records, neighboringEntities };
}

function run() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const dbPath = resolve(REPO_ROOT, readStringFlag(flags, "db", ""));
  if (!readStringFlag(flags, "db", "").trim()) throw new Error("--db is required");
  const recordType = readStringFlag(flags, "record-type", "").trim();
  const text = readStringFlag(flags, "text", "").trim();
  const recordId = readStringFlag(flags, "record-id", readStringFlag(flags, "neighbors", "")).trim();
  const entity = readStringFlag(flags, "entity", "").trim();
  const entityType = readStringFlag(flags, "entity-type", "").trim();
  const edgeType = readStringFlag(flags, "edge-type", "").trim();
  const limit = readNumberFlag(flags, "limit", 20, { min: 1, max: 200 });
  const printJson = readBoolFlag(flags, "json", false);

  const db = new DatabaseSync(dbPath, { readonly: true });
  if (recordId) {
    const result = fetchNeighborhood(db, recordId, edgeType, limit, printJson);
    if (printJson) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    process.stdout.write(`seed: ${result.seed ? result.seed.id : "not-found"}\n`);
    for (const item of result.linkedRecords) {
      process.stdout.write(`edge ${item.edgeType} -> [${item.record.record_type}] ${item.record.id}\n`);
    }
    for (const item of result.entities) {
      process.stdout.write(`entity ${item.entity_type}:${item.entity_label} role=${item.role || "n/a"}\n`);
    }
    for (const item of result.relatedByEntity.slice(0, limit)) {
      process.stdout.write(
        `shared ${item.entityType}:${item.entityLabel} -> [${item.record.record_type}] ${item.record.id}\n`
      );
    }
    return;
  }

  if (entity) {
    const result = fetchEntityView(db, entity, entityType, edgeType, limit, printJson);
    if (printJson) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    for (const item of result.matchedEntities) {
      process.stdout.write(
        `entity ${item.entity_type}:${item.entity_label} role=${item.role || "n/a"} records=${item.record_count}\n`
      );
    }
    for (const row of result.neighboringEntities.slice(0, limit)) {
      process.stdout.write(
        `neighbor ${row.edge_type} ${row.neighbor_entity_type}:${row.neighbor_entity_label} weight=${row.weight}\n`
      );
    }
    for (const row of result.records.slice(0, limit)) {
      process.stdout.write(`[${row.record_type}] ${row.id} ${row.occurred_at || "n/a"}\n`);
    }
    return;
  }

  const clauses = [];
  const params = {};
  if (recordType) {
    clauses.push("record_type = :recordType");
    params.recordType = recordType;
  }
  if (text) {
    clauses.push("raw_json LIKE :text");
    params.text = `%${text}%`;
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT id, record_type, occurred_at, source_type, confidence, importance, raw_json
       FROM records
       ${where}
       ORDER BY COALESCE(occurred_at, '') DESC, confidence DESC
       LIMIT ${limit}`
    )
    .all(params)
    .map((row) => parseRawRow(row, printJson));

  if (printJson) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return;
  }

  for (const row of rows) {
    process.stdout.write(`[${row.record_type}] ${row.id} ${row.occurred_at || "n/a"} conf=${row.confidence}\n`);
  }
}

try {
  run();
} catch (error) {
  process.stderr.write(
    `canonical-memory-corpus-query failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}
