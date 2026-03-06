#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const STUDIO_BRAIN_ROOT = resolve(REPO_ROOT, "studio-brain");
const DEFAULT_COMPOSE_FILE = resolve(STUDIO_BRAIN_ROOT, "docker-compose.yml");
const DEFAULT_OUTPUT_PATH = resolve(REPO_ROOT, "output", "open-memory", "postgres-embedding-normalize-latest.json");
const DEFAULT_TABLE = "swarm_memory";
const DEFAULT_VECTOR_COLUMN = "embedding";
const DEFAULT_LEGACY_COLUMN = "embedding_legacy_array";
const DEFAULT_INDEX_NAME = "idx_swarm_memory_embedding_ivfflat_cosine";

const flags = parseArgs(process.argv.slice(2));
if (toBool(flags.help, false)) {
  printHelp();
  process.exit(0);
}

const runtime = {
  transport: String(flags.transport || "docker").trim().toLowerCase(),
  composeFile: resolve(REPO_ROOT, String(flags["compose-file"] || DEFAULT_COMPOSE_FILE)),
  postgresService: String(flags["postgres-service"] || "postgres"),
  host: String(flags.host || process.env.PGHOST || "127.0.0.1"),
  port: clampInt(flags.port, 1, 65535, Number.parseInt(String(process.env.PGPORT || "5433"), 10)),
  user: String(flags.user || process.env.PGUSER || "postgres"),
  database: String(flags.database || process.env.PGDATABASE || "monsoonfire_studio_os"),
};

const apply = toBool(flags.apply, false);
const rollback = toBool(flags.rollback, false);
const jsonOut = toBool(flags.json, false);
const strict = toBool(flags.strict, false);
const createIndex = toBool(flags["create-index"], false);
const rollbackDropVectorBackup = toBool(flags["rollback-drop-vector-backup"], false);
const batchSize = clampInt(flags["batch-size"], 50, 50000, 5000);
const maxBatches = clampInt(flags["max-batches"], 0, 1_000_000, 0);
const vectorIndexLists = clampInt(flags["vector-index-lists"], 1, 8192, 200);
const forcedDimension = clampInt(flags.dimension, 0, 65535, 0);
const outputPath = resolve(REPO_ROOT, String(flags.out || DEFAULT_OUTPUT_PATH));
const table = String(flags.table || DEFAULT_TABLE).trim();
const vectorColumn = String(flags["vector-column"] || DEFAULT_VECTOR_COLUMN).trim();
const legacyColumn = String(flags["legacy-column"] || DEFAULT_LEGACY_COLUMN).trim();
const configuredIndexName = String(flags["index-name"] || DEFAULT_INDEX_NAME).trim();
const rollbackBackupColumn = String(flags["rollback-backup-column"] || "").trim();

const generatedAt = new Date().toISOString();
const actions = [];
const warnings = [];
const errors = [];

if (runtime.transport !== "docker" && runtime.transport !== "host") {
  errors.push(`Unsupported transport "${runtime.transport}" (expected docker|host).`);
}
if (apply && rollback) {
  errors.push("Choose either --apply true or --rollback true, not both.");
}
if (!isSafeIdentifier(vectorColumn)) {
  errors.push(`Invalid --vector-column "${vectorColumn}". Use a SQL-safe identifier.`);
}
if (!isSafeIdentifier(legacyColumn)) {
  errors.push(`Invalid --legacy-column "${legacyColumn}". Use a SQL-safe identifier.`);
}
if (!isSafeIdentifier(configuredIndexName)) {
  errors.push(`Invalid --index-name "${configuredIndexName}". Use a SQL-safe identifier.`);
}

const tableRef = parseQualifiedTable(table);
if (!tableRef.ok) {
  errors.push(tableRef.error);
}

let inspection = null;
if (errors.length === 0) {
  inspection = inspectEmbeddingLayout(runtime, {
    schema: tableRef.schema,
    table: tableRef.table,
    vectorColumn,
    legacyColumn,
  });
  if (!inspection.ok) {
    errors.push(`inspect-failed: ${inspection.error}`);
  }
}

let selectedDimension = forcedDimension > 0 ? forcedDimension : 0;
if (inspection?.ok && selectedDimension <= 0) {
  const histogram = Array.isArray(inspection.arrayDimensionHistogram) ? inspection.arrayDimensionHistogram : [];
  const dominant = histogram.find((row) => Number(row.dim) > 0);
  selectedDimension = dominant ? Number(dominant.dim) : 0;
}

if ((apply || rollback) && inspection?.ok && !inspection.vectorExtensionInstalled) {
  errors.push("pgvector extension is not installed in the target database.");
}

if (apply && selectedDimension <= 0) {
  errors.push(
    "Could not infer embedding dimension from legacy array rows; pass --dimension <n> to apply normalization."
  );
}

let mode = "plan";
let summary = {
  selectedDimension,
  migratedRows: 0,
  batches: 0,
  stoppedByMaxBatches: false,
  vectorRowsAfter: null,
  pendingConvertibleRowsAfter: null,
  incompatibleRowsAfter: null,
};

if (errors.length === 0 && inspection?.ok) {
  if (rollback) {
    mode = "rollback";
    const rollbackResult = runRollback(runtime, {
      schema: tableRef.schema,
      table: tableRef.table,
      vectorColumn,
      legacyColumn,
      rollbackBackupColumn,
      rollbackDropVectorBackup,
    });
    actions.push(...rollbackResult.actions);
    warnings.push(...rollbackResult.warnings);
    errors.push(...rollbackResult.errors);
    if (!rollbackResult.errors.length) {
      summary = {
        ...summary,
        rollbackBackupColumn: rollbackResult.backupColumn,
      };
    }
  } else if (apply) {
    mode = "apply";
    const applyResult = runApply(runtime, {
      schema: tableRef.schema,
      table: tableRef.table,
      vectorColumn,
      legacyColumn,
      selectedDimension,
      createIndex,
      indexName: configuredIndexName,
      vectorIndexLists,
      batchSize,
      maxBatches,
      inspection,
    });
    actions.push(...applyResult.actions);
    warnings.push(...applyResult.warnings);
    errors.push(...applyResult.errors);
    summary = {
      ...summary,
      migratedRows: applyResult.totalMigratedRows,
      batches: applyResult.batches,
      stoppedByMaxBatches: applyResult.stoppedByMaxBatches,
      vectorRowsAfter: applyResult.postSummary?.vectorNonNullRows ?? null,
      pendingConvertibleRowsAfter: applyResult.postSummary?.pendingConvertibleRows ?? null,
      incompatibleRowsAfter: applyResult.postSummary?.incompatibleRows ?? null,
      sourceArrayColumn: applyResult.sourceArrayColumn || null,
      indexName: applyResult.indexName || null,
      indexCreated: applyResult.indexCreated === true,
    };
  } else {
    mode = "plan";
    if (inspection.detectedMode === "vector-ready") {
      warnings.push("Embedding column already uses vector type; no normalization action required.");
    } else if (inspection.detectedMode === "unknown") {
      warnings.push("Could not map current embedding layout to a supported normalization mode.");
    } else {
      warnings.push("Dry run only. Re-run with --apply true to execute migration steps.");
    }
  }
}

const status = errors.length > 0 ? "fail" : apply || rollback ? (warnings.length > 0 ? "warn" : "pass") : "dry-run";
const payload = {
  ok: errors.length === 0,
  status,
  generatedAt,
  mode,
  apply,
  rollback,
  runtime,
  target: {
    table: tableRef?.qualified || table,
    schema: tableRef?.schema || null,
    tableName: tableRef?.table || null,
    vectorColumn,
    legacyColumn,
  },
  inspection: inspection?.ok
    ? {
        tableExists: inspection.tableExists,
        vectorExtensionInstalled: inspection.vectorExtensionInstalled,
        vectorColumnType: inspection.vectorColumnType,
        legacyColumnType: inspection.legacyColumnType,
        detectedMode: inspection.detectedMode,
        arraySourceColumn: inspection.arraySourceColumn,
        arrayDimensionHistogram: inspection.arrayDimensionHistogram,
        rowCounts: inspection.rowCounts,
      }
    : null,
  selectedDimension,
  config: {
    batchSize,
    maxBatches,
    createIndex,
    vectorIndexLists,
    indexName: configuredIndexName,
    rollbackDropVectorBackup,
  },
  summary,
  actions,
  warnings,
  errors,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

emit({ ...payload, outputPath }, jsonOut);
if (strict && status !== "pass" && status !== "dry-run") {
  process.exit(1);
}
if (status === "fail") {
  process.exit(1);
}

function runApply(runtimeConfig, options) {
  const result = {
    actions: [],
    warnings: [],
    errors: [],
    totalMigratedRows: 0,
    batches: 0,
    stoppedByMaxBatches: false,
    sourceArrayColumn: "",
    postSummary: null,
    indexName: null,
    indexCreated: false,
  };
  const tableSql = `${quoteIdent(options.schema)}.${quoteIdent(options.table)}`;
  let sourceArrayColumn = "";
  let expectedVectorColumnType = options.inspection.vectorColumnType || "";

  if (options.inspection.detectedMode === "legacy-in-place") {
    if (options.inspection.legacyColumnType) {
      result.errors.push(
        `Legacy column ${options.legacyColumn} already exists while vector column is still array; resolve manually before apply.`
      );
      return result;
    }
    const renameSql = `ALTER TABLE ${tableSql} RENAME COLUMN ${quoteIdent(options.vectorColumn)} TO ${quoteIdent(options.legacyColumn)}`;
    const renameRes = runSql(renameSql, { runtime: runtimeConfig, allowFail: true });
    result.actions.push({
      step: "rename-legacy-array-column",
      ok: renameRes.ok,
      output: truncate(renameRes.output),
    });
    if (!renameRes.ok) {
      result.errors.push(`Failed renaming ${options.vectorColumn} -> ${options.legacyColumn}.`);
      return result;
    }

    const addVectorSql = `ALTER TABLE ${tableSql} ADD COLUMN IF NOT EXISTS ${quoteIdent(options.vectorColumn)} vector(${options.selectedDimension})`;
    const addVectorRes = runSql(addVectorSql, { runtime: runtimeConfig, allowFail: true });
    result.actions.push({
      step: "add-vector-column",
      ok: addVectorRes.ok,
      output: truncate(addVectorRes.output),
    });
    if (!addVectorRes.ok) {
      const restoreSql = `ALTER TABLE ${tableSql} RENAME COLUMN ${quoteIdent(options.legacyColumn)} TO ${quoteIdent(options.vectorColumn)}`;
      const restoreRes = runSql(restoreSql, { runtime: runtimeConfig, allowFail: true });
      result.actions.push({
        step: "restore-original-column-name",
        ok: restoreRes.ok,
        output: truncate(restoreRes.output),
      });
      if (!restoreRes.ok) {
        result.errors.push(
          `Failed adding vector column ${options.vectorColumn}, and restore rename ${options.legacyColumn} -> ${options.vectorColumn} also failed.`
        );
        return result;
      }
      result.errors.push(`Failed adding vector column ${options.vectorColumn}.`);
      return result;
    }
    sourceArrayColumn = options.legacyColumn;
    expectedVectorColumnType = `vector(${options.selectedDimension})`;
  } else if (options.inspection.detectedMode === "legacy-only") {
    const addVectorSql = `ALTER TABLE ${tableSql} ADD COLUMN IF NOT EXISTS ${quoteIdent(options.vectorColumn)} vector(${options.selectedDimension})`;
    const addVectorRes = runSql(addVectorSql, { runtime: runtimeConfig, allowFail: true });
    result.actions.push({
      step: "add-vector-column",
      ok: addVectorRes.ok,
      output: truncate(addVectorRes.output),
    });
    if (!addVectorRes.ok) {
      result.errors.push(`Failed adding vector column ${options.vectorColumn}.`);
      return result;
    }
    sourceArrayColumn = options.legacyColumn;
    expectedVectorColumnType = `vector(${options.selectedDimension})`;
  } else if (options.inspection.detectedMode === "staged") {
    sourceArrayColumn = options.legacyColumn;
  } else if (options.inspection.detectedMode === "vector-ready") {
    result.warnings.push("Vector column already present and legacy array column unavailable. Skipping migration.");
    return result;
  } else {
    result.errors.push("Unsupported embedding layout for apply.");
    return result;
  }

  result.sourceArrayColumn = sourceArrayColumn;
  const backfill = backfillVectorColumn(runtimeConfig, {
    schema: options.schema,
    table: options.table,
    vectorColumn: options.vectorColumn,
    sourceArrayColumn,
    selectedDimension: options.selectedDimension,
    batchSize: options.batchSize,
    maxBatches: options.maxBatches,
  });
  result.actions.push(...backfill.actions);
  result.totalMigratedRows = backfill.totalUpdatedRows;
  result.batches = backfill.batches;
  result.stoppedByMaxBatches = backfill.stoppedByMaxBatches;
  if (backfill.errors.length > 0) {
    result.errors.push(...backfill.errors);
    return result;
  }

  if (options.createIndex) {
    const indexName = options.indexName || DEFAULT_INDEX_NAME;
    const indexSql = `CREATE INDEX IF NOT EXISTS ${quoteIdent(indexName)} ON ${tableSql} USING ivfflat (${quoteIdent(options.vectorColumn)} vector_cosine_ops) WITH (lists = ${Math.max(1, options.vectorIndexLists)}) WHERE ${quoteIdent(options.vectorColumn)} IS NOT NULL`;
    const indexRes = runSql(indexSql, { runtime: runtimeConfig, allowFail: true });
    result.actions.push({
      step: "create-ivfflat-index",
      ok: indexRes.ok,
      output: truncate(indexRes.output),
    });
    result.indexName = indexName;
    result.indexCreated = indexRes.ok;
    if (!indexRes.ok) {
      result.warnings.push(`Failed creating ivfflat index ${indexName}; migration data copy still completed.`);
    }
  }

  const post = fetchBackfillSummary(runtimeConfig, {
    schema: options.schema,
    table: options.table,
    vectorColumn: options.vectorColumn,
    sourceArrayColumn,
    selectedDimension: options.selectedDimension,
  });
  if (!post.ok) {
    result.warnings.push(`Unable to fetch post-migration summary: ${post.error}`);
  } else {
    result.postSummary = post.summary;
  }

  if (expectedVectorColumnType && !String(expectedVectorColumnType).toLowerCase().includes("vector")) {
    result.warnings.push("Vector column type confirmation inconclusive after apply.");
  }

  return result;
}

function runRollback(runtimeConfig, options) {
  const result = {
    actions: [],
    warnings: [],
    errors: [],
    backupColumn: "",
  };
  const inspection = inspectEmbeddingLayout(runtimeConfig, {
    schema: options.schema,
    table: options.table,
    vectorColumn: options.vectorColumn,
    legacyColumn: options.legacyColumn,
  });
  if (!inspection.ok) {
    result.errors.push(`rollback-inspection-failed: ${inspection.error}`);
    return result;
  }

  const vectorType = String(inspection.vectorColumnType || "").toLowerCase();
  const legacyType = String(inspection.legacyColumnType || "").toLowerCase();
  if (!vectorType.includes("vector")) {
    result.errors.push(`Rollback requires ${options.vectorColumn} to be vector-typed, found "${inspection.vectorColumnType || "missing"}".`);
    return result;
  }
  if (!legacyType.includes("double precision[]") && !legacyType.includes("real[]")) {
    result.errors.push(`Rollback requires ${options.legacyColumn} to be array-typed, found "${inspection.legacyColumnType || "missing"}".`);
    return result;
  }

  const backupColumn = options.rollbackBackupColumn || `${options.vectorColumn}_vector_backup_${timestampId()}`;
  if (!isSafeIdentifier(backupColumn)) {
    result.errors.push(`Invalid rollback backup column "${backupColumn}".`);
    return result;
  }
  result.backupColumn = backupColumn;

  const tableSql = `${quoteIdent(options.schema)}.${quoteIdent(options.table)}`;
  const renameVectorSql = `ALTER TABLE ${tableSql} RENAME COLUMN ${quoteIdent(options.vectorColumn)} TO ${quoteIdent(backupColumn)}`;
  const renameVectorRes = runSql(renameVectorSql, { runtime: runtimeConfig, allowFail: true });
  result.actions.push({
    step: "rollback-rename-vector-to-backup",
    ok: renameVectorRes.ok,
    output: truncate(renameVectorRes.output),
  });
  if (!renameVectorRes.ok) {
    result.errors.push(`Failed renaming ${options.vectorColumn} -> ${backupColumn}.`);
    return result;
  }

  const renameLegacySql = `ALTER TABLE ${tableSql} RENAME COLUMN ${quoteIdent(options.legacyColumn)} TO ${quoteIdent(options.vectorColumn)}`;
  const renameLegacyRes = runSql(renameLegacySql, { runtime: runtimeConfig, allowFail: true });
  result.actions.push({
    step: "rollback-promote-legacy-array",
    ok: renameLegacyRes.ok,
    output: truncate(renameLegacyRes.output),
  });
  if (!renameLegacyRes.ok) {
    result.errors.push(`Failed renaming ${options.legacyColumn} -> ${options.vectorColumn}.`);
    return result;
  }

  if (options.rollbackDropVectorBackup) {
    const dropSql = `ALTER TABLE ${tableSql} DROP COLUMN IF EXISTS ${quoteIdent(backupColumn)}`;
    const dropRes = runSql(dropSql, { runtime: runtimeConfig, allowFail: true });
    result.actions.push({
      step: "rollback-drop-vector-backup",
      ok: dropRes.ok,
      output: truncate(dropRes.output),
    });
    if (!dropRes.ok) {
      result.warnings.push(`Unable to drop backup vector column ${backupColumn}; leaving it in place.`);
    }
  } else {
    result.warnings.push(`Vector backup column retained as ${backupColumn}.`);
  }

  return result;
}

function backfillVectorColumn(runtimeConfig, options) {
  const out = {
    actions: [],
    errors: [],
    totalUpdatedRows: 0,
    batches: 0,
    stoppedByMaxBatches: false,
  };
  const tableSql = `${quoteIdent(options.schema)}.${quoteIdent(options.table)}`;
  const batchLimit = Math.max(1, options.batchSize);
  const maxBatches = Math.max(0, options.maxBatches);

  while (true) {
    if (maxBatches > 0 && out.batches >= maxBatches) {
      out.stoppedByMaxBatches = true;
      break;
    }
    const sql = `
WITH batch AS (
  SELECT ctid
    FROM ${tableSql}
   WHERE ${quoteIdent(options.vectorColumn)} IS NULL
     AND ${quoteIdent(options.sourceArrayColumn)} IS NOT NULL
     AND COALESCE(array_length(${quoteIdent(options.sourceArrayColumn)}, 1), 0) = ${Math.max(1, options.selectedDimension)}
   LIMIT ${batchLimit}
)
UPDATE ${tableSql} t
   SET ${quoteIdent(options.vectorColumn)} = t.${quoteIdent(options.sourceArrayColumn)}::vector
  FROM batch
 WHERE t.ctid = batch.ctid
`;
    const res = runSql(sql, { runtime: runtimeConfig, allowFail: true });
    if (!res.ok) {
      out.actions.push({
        step: "backfill-batch",
        ok: false,
        batch: out.batches + 1,
        output: truncate(res.output),
      });
      out.errors.push("Backfill batch failed while casting arrays to vector.");
      break;
    }
    const updated = parseUpdateCount(res.output);
    out.batches += 1;
    out.totalUpdatedRows += updated;
    if (out.actions.length < 20 || updated === 0) {
      out.actions.push({
        step: "backfill-batch",
        ok: true,
        batch: out.batches,
        updated,
      });
    }
    if (updated <= 0) {
      break;
    }
  }

  return out;
}

function fetchBackfillSummary(runtimeConfig, options) {
  const tableSql = `${quoteIdent(options.schema)}.${quoteIdent(options.table)}`;
  const sql = `
SELECT json_build_object(
  'totalRows', count(*)::bigint,
  'sourceNonNullRows', count(*) FILTER (WHERE ${quoteIdent(options.sourceArrayColumn)} IS NOT NULL)::bigint,
  'vectorNonNullRows', count(*) FILTER (WHERE ${quoteIdent(options.vectorColumn)} IS NOT NULL)::bigint,
  'convertibleRows', count(*) FILTER (
    WHERE ${quoteIdent(options.sourceArrayColumn)} IS NOT NULL
      AND COALESCE(array_length(${quoteIdent(options.sourceArrayColumn)}, 1), 0) = ${Math.max(1, options.selectedDimension)}
  )::bigint,
  'pendingConvertibleRows', count(*) FILTER (
    WHERE ${quoteIdent(options.vectorColumn)} IS NULL
      AND ${quoteIdent(options.sourceArrayColumn)} IS NOT NULL
      AND COALESCE(array_length(${quoteIdent(options.sourceArrayColumn)}, 1), 0) = ${Math.max(1, options.selectedDimension)}
  )::bigint,
  'incompatibleRows', count(*) FILTER (
    WHERE ${quoteIdent(options.sourceArrayColumn)} IS NOT NULL
      AND COALESCE(array_length(${quoteIdent(options.sourceArrayColumn)}, 1), 0) <> ${Math.max(1, options.selectedDimension)}
  )::bigint
)::text
FROM ${tableSql}
`;
  const parsed = runJsonSql(sql, runtimeConfig);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") {
    return { ok: false, error: parsed.error || "summary-unavailable", summary: null };
  }
  return {
    ok: true,
    error: "",
    summary: {
      totalRows: toInt(parsed.value.totalRows, 0),
      sourceNonNullRows: toInt(parsed.value.sourceNonNullRows, 0),
      vectorNonNullRows: toInt(parsed.value.vectorNonNullRows, 0),
      convertibleRows: toInt(parsed.value.convertibleRows, 0),
      pendingConvertibleRows: toInt(parsed.value.pendingConvertibleRows, 0),
      incompatibleRows: toInt(parsed.value.incompatibleRows, 0),
    },
  };
}

function inspectEmbeddingLayout(runtimeConfig, options) {
  const tableExistsSql = `
SELECT EXISTS (
  SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = '${escapeLiteral(options.schema)}'
     AND c.relname = '${escapeLiteral(options.table)}'
     AND c.relkind IN ('r', 'p')
)::text
`;
  const tableExistsRes = runSql(tableExistsSql, { runtime: runtimeConfig, allowFail: true });
  if (!tableExistsRes.ok) {
    return { ok: false, error: tableExistsRes.output };
  }
  const tableExists = /\btrue\b/i.test(tableExistsRes.output || "");
  if (!tableExists) {
    return { ok: false, error: `table-not-found:${options.schema}.${options.table}` };
  }

  const vectorExtensionRes = runSql(
    "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')::text",
    { runtime: runtimeConfig, allowFail: true }
  );
  if (!vectorExtensionRes.ok) {
    return { ok: false, error: vectorExtensionRes.output };
  }
  const vectorExtensionInstalled = /\btrue\b/i.test(vectorExtensionRes.output || "");

  const vectorColumnType = fetchColumnType(runtimeConfig, options, options.vectorColumn);
  const legacyColumnType = fetchColumnType(runtimeConfig, options, options.legacyColumn);
  const detectedMode = detectEmbeddingMode(vectorColumnType, legacyColumnType);

  const arraySourceColumn =
    isArrayColumnType(vectorColumnType)
      ? options.vectorColumn
      : isArrayColumnType(legacyColumnType)
        ? options.legacyColumn
        : "";
  const arrayDimensionHistogram = arraySourceColumn
    ? fetchArrayDimensionHistogram(runtimeConfig, options, arraySourceColumn)
    : [];
  const rowCounts = arraySourceColumn
    ? fetchArraySourceCounts(runtimeConfig, options, arraySourceColumn)
    : {
        totalRows: 0,
        arraySourceNonNullRows: 0,
      };

  return {
    ok: true,
    error: "",
    tableExists,
    vectorExtensionInstalled,
    vectorColumnType,
    legacyColumnType,
    detectedMode,
    arraySourceColumn: arraySourceColumn || null,
    arrayDimensionHistogram,
    rowCounts,
  };
}

function fetchColumnType(runtimeConfig, options, columnName) {
  const sql = `
SELECT format_type(a.atttypid, a.atttypmod)::text
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = '${escapeLiteral(options.schema)}'
   AND c.relname = '${escapeLiteral(options.table)}'
   AND a.attname = '${escapeLiteral(columnName)}'
   AND a.attnum > 0
   AND NOT a.attisdropped
 LIMIT 1
`;
  const res = runSql(sql, { runtime: runtimeConfig, allowFail: true });
  if (!res.ok) return "";
  return String(res.output || "").trim() || "";
}

function fetchArrayDimensionHistogram(runtimeConfig, options, arrayColumn) {
  const tableSql = `${quoteIdent(options.schema)}.${quoteIdent(options.table)}`;
  const sql = `
SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)::text
FROM (
  SELECT
    COALESCE(array_length(${quoteIdent(arrayColumn)}, 1), 0) AS dim,
    count(*)::bigint AS rows
  FROM ${tableSql}
  WHERE ${quoteIdent(arrayColumn)} IS NOT NULL
  GROUP BY 1
  ORDER BY rows DESC, dim DESC
  LIMIT 32
) t
`;
  const parsed = runJsonSql(sql, runtimeConfig);
  if (!parsed.ok || !Array.isArray(parsed.value)) return [];
  return parsed.value.map((row) => ({
    dim: toInt(row?.dim, 0),
    rows: toInt(row?.rows, 0),
  }));
}

function fetchArraySourceCounts(runtimeConfig, options, arrayColumn) {
  const tableSql = `${quoteIdent(options.schema)}.${quoteIdent(options.table)}`;
  const sql = `
SELECT json_build_object(
  'totalRows', count(*)::bigint,
  'arraySourceNonNullRows', count(*) FILTER (WHERE ${quoteIdent(arrayColumn)} IS NOT NULL)::bigint
)::text
FROM ${tableSql}
`;
  const parsed = runJsonSql(sql, runtimeConfig);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") {
    return {
      totalRows: 0,
      arraySourceNonNullRows: 0,
    };
  }
  return {
    totalRows: toInt(parsed.value.totalRows, 0),
    arraySourceNonNullRows: toInt(parsed.value.arraySourceNonNullRows, 0),
  };
}

function runJsonSql(sql, runtimeConfig) {
  const res = runSql(sql, { runtime: runtimeConfig, allowFail: true });
  if (!res.ok) return { ok: false, value: null, error: res.output };
  const parsed = parseLastJsonLine(res.output);
  if (!parsed.ok) return { ok: false, value: null, error: parsed.error };
  return { ok: true, value: parsed.value, error: "" };
}

function runSql(sql, { runtime, allowFail }) {
  if (runtime.transport === "docker") {
    return runCompose(
      [
        "exec",
        "-T",
        runtime.postgresService,
        "psql",
        "-X",
        "-A",
        "-t",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        runtime.user,
        "-d",
        runtime.database,
        "-c",
        String(sql || ""),
      ],
      { runtime, allowFail }
    );
  }
  return runProcess(
    "psql",
    [
      "-X",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-h",
      runtime.host,
      "-p",
      String(runtime.port),
      "-U",
      runtime.user,
      "-d",
      runtime.database,
      "-c",
      String(sql || ""),
    ],
    { cwd: REPO_ROOT, env: process.env, allowFail }
  );
}

function runCompose(args, { runtime, allowFail }) {
  return runProcess("docker", ["compose", "-f", runtime.composeFile, ...args], {
    cwd: STUDIO_BRAIN_ROOT,
    env: process.env,
    allowFail,
  });
}

function runProcess(cmd, argv, { cwd, env, allowFail }) {
  const result = spawnSync(cmd, argv, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${String(result.stdout || "")}${String(result.stderr || "")}`.trim();
  const ok = result.status === 0;
  if (!ok && !allowFail) {
    throw new Error(`${cmd} ${argv.join(" ")} failed (${result.status ?? "unknown"}): ${output || "no output"}`);
  }
  return {
    ok,
    status: result.status ?? 1,
    output,
  };
}

function detectEmbeddingMode(vectorColumnType, legacyColumnType) {
  if (isArrayColumnType(vectorColumnType) && !legacyColumnType) return "legacy-in-place";
  if (isVectorColumnType(vectorColumnType) && isArrayColumnType(legacyColumnType)) return "staged";
  if (!vectorColumnType && isArrayColumnType(legacyColumnType)) return "legacy-only";
  if (isVectorColumnType(vectorColumnType) && !legacyColumnType) return "vector-ready";
  return "unknown";
}

function isVectorColumnType(typeName) {
  return String(typeName || "").trim().toLowerCase().includes("vector");
}

function isArrayColumnType(typeName) {
  const normalized = String(typeName || "").trim().toLowerCase();
  return normalized.includes("double precision[]") || normalized.includes("real[]");
}

function parseQualifiedTable(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    return { ok: false, error: "Missing --table value.", schema: "", table: "", qualified: "" };
  }
  const parts = trimmed.split(".");
  if (parts.length > 2) {
    return { ok: false, error: `Invalid --table "${trimmed}". Use table or schema.table.`, schema: "", table: "", qualified: "" };
  }
  const schema = parts.length === 2 ? parts[0].trim() : "public";
  const table = parts.length === 2 ? parts[1].trim() : parts[0].trim();
  if (!isSafeIdentifier(schema) || !isSafeIdentifier(table)) {
    return { ok: false, error: `Invalid --table "${trimmed}". Identifiers must be SQL-safe.`, schema: "", table: "", qualified: "" };
  }
  return {
    ok: true,
    error: "",
    schema,
    table,
    qualified: `${schema}.${table}`,
  };
}

function isSafeIdentifier(value) {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(value || ""));
}

function quoteIdent(value) {
  return `"${String(value || "").replace(/"/g, "\"\"")}"`;
}

function escapeLiteral(value) {
  return String(value || "").replace(/'/g, "''");
}

function parseUpdateCount(output) {
  const match = String(output || "").match(/UPDATE\s+(\d+)/i);
  if (!match) return 0;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseLastJsonLine(output) {
  const lines = String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!(line.startsWith("{") || line.startsWith("["))) continue;
    try {
      return { ok: true, value: JSON.parse(line), error: "" };
    } catch {}
  }
  return { ok: false, value: null, error: "json-not-found-in-sql-output" };
}

function truncate(text, max = 320) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "");
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).trim().toLowerCase();
    const next = argv[index + 1];
    if (!next || String(next).startsWith("--")) {
      out[key] = "true";
      continue;
    }
    out[key] = String(next);
    index += 1;
  }
  return out;
}

function toBool(value, fallback) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampInt(value, min, max, fallback) {
  const parsed = toInt(value, fallback);
  return Math.max(min, Math.min(max, parsed));
}

function timestampId() {
  const now = new Date();
  const iso = now.toISOString().replace(/[^0-9]/g, "");
  return iso.slice(0, 14);
}

function emit(payload, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  const lines = [];
  lines.push(`open-memory embedding normalize status: ${String(payload.status || "unknown").toUpperCase()}`);
  lines.push(`generatedAt: ${payload.generatedAt || "n/a"}`);
  lines.push(`mode: ${payload.mode || "plan"}`);
  if (payload.target?.table) lines.push(`table: ${payload.target.table}`);
  if (payload.inspection?.detectedMode) lines.push(`detectedMode: ${payload.inspection.detectedMode}`);
  lines.push(`selectedDimension: ${Number(payload.selectedDimension || 0)}`);
  if (payload.summary) {
    lines.push(`migratedRows: ${Number(payload.summary.migratedRows || 0)} (batches=${Number(payload.summary.batches || 0)})`);
    if (payload.summary.pendingConvertibleRowsAfter !== null) {
      lines.push(`pendingConvertibleRowsAfter: ${Number(payload.summary.pendingConvertibleRowsAfter || 0)}`);
    }
  }
  if (Array.isArray(payload.warnings) && payload.warnings.length > 0) {
    lines.push("warnings:");
    payload.warnings.forEach((entry) => lines.push(`  - ${entry}`));
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    lines.push("errors:");
    payload.errors.forEach((entry) => lines.push(`  - ${entry}`));
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

function printHelp() {
  const lines = [
    "Open Memory DB Embedding Normalization Utility",
    "",
    "Purpose:",
    "  Normalize swarm_memory embeddings from array storage to pgvector storage with dry-run/apply/rollback modes.",
    "",
    "Usage:",
    "  node ./scripts/open-memory-db-embedding-normalize.mjs --json true",
    "  node ./scripts/open-memory-db-embedding-normalize.mjs --apply true --dimension 1536 --json true",
    "  node ./scripts/open-memory-db-embedding-normalize.mjs --rollback true --json true",
    "",
    "Options:",
    "  --transport docker|host                DB transport (default: docker)",
    "  --compose-file <path>                  docker compose file (default: studio-brain/docker-compose.yml)",
    "  --postgres-service <name>              compose postgres service (default: postgres)",
    "  --host <host>                          host transport PG host (default: 127.0.0.1)",
    "  --port <port>                          host transport PG port (default: 5433)",
    "  --user <user>                          database user (default: postgres)",
    "  --database <name>                      database name (default: monsoonfire_studio_os)",
    "  --table <table|schema.table>           target table (default: swarm_memory)",
    "  --vector-column <name>                 vector column name (default: embedding)",
    "  --legacy-column <name>                 legacy array column name (default: embedding_legacy_array)",
    "  --dimension <n>                        vector dimension override (auto-detect if omitted)",
    "  --batch-size <n>                       batch size for backfill updates (default: 5000)",
    "  --max-batches <n>                      cap backfill batches (0 = no cap; default: 0)",
    "  --create-index true|false              create ivfflat index after migration (default: false)",
    "  --index-name <name>                    ivfflat index name (default: idx_swarm_memory_embedding_ivfflat_cosine)",
    "  --vector-index-lists <n>               ivfflat lists value (default: 200)",
    "  --apply true|false                     execute normalization",
    "  --rollback true|false                  rollback normalization by promoting legacy array column",
    "  --rollback-backup-column <name>        custom backup name for current vector column during rollback",
    "  --rollback-drop-vector-backup true|false  drop backup vector column after rollback (default: false)",
    "  --json true|false                      JSON output (default: false)",
    "  --strict true|false                    exit non-zero when status != pass (default: false)",
    "  --out <path>                           report artifact path",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}
