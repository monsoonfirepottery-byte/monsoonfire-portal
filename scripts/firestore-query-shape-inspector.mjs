#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");
const DEFAULT_SCAN_ROOTS = [
  resolve(repoRoot, "web", "src"),
  resolve(repoRoot, "functions", "src"),
  resolve(repoRoot, "scripts", "rules"),
];
const DEFAULT_REPORT_JSON = resolve(repoRoot, "output", "qa", "portal-firebase-query-inspector.json");
const DEFAULT_REPORT_MARKDOWN = resolve(repoRoot, "output", "qa", "portal-firebase-query-inspector.md");
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const INDEX_RELEVANT_OPERATORS = new Set(["==", "!=", "<", "<=", ">", ">=", "in", "not-in", "array-contains", "array-contains-any"]);
const EQUALITY_OPERATORS = new Set(["==", "in"]);
const ARRAY_OPERATORS = new Set(["array-contains", "array-contains-any"]);
const INEQUALITY_OPERATORS = new Set(["!=", "<", "<=", ">", ">=", "not-in"]);

function clean(value) {
  return String(value ?? "").trim();
}

function normalizePathForReport(path) {
  return relative(repoRoot, resolve(path)).replace(/\\/g, "/");
}

function parseArgs(argv) {
  const options = {
    asJson: false,
    strict: false,
    scanRoots: [...DEFAULT_SCAN_ROOTS],
    collections: [],
    reportJsonPath: DEFAULT_REPORT_JSON,
    reportMarkdownPath: DEFAULT_REPORT_MARKDOWN,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }

    const next = clean(argv[index + 1]);
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--path") {
      options.scanRoots.push(resolve(process.cwd(), next));
      index += 1;
      continue;
    }
    if (arg === "--collection") {
      options.collections.push(next);
      index += 1;
      continue;
    }
    if (arg === "--report-json") {
      options.reportJsonPath = resolve(process.cwd(), next);
      index += 1;
      continue;
    }
    if (arg === "--report-markdown") {
      options.reportMarkdownPath = resolve(process.cwd(), next);
      index += 1;
      continue;
    }
  }

  options.scanRoots = Array.from(new Set(options.scanRoots.map((entry) => resolve(entry))));
  options.collections = Array.from(new Set(options.collections.map((entry) => clean(entry)).filter(Boolean)));
  return options;
}

async function collectSourceFiles(rootPath) {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const fullPath = resolve(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
}

async function listInspectableFiles(scanRoots) {
  const files = [];
  for (const rootPath of scanRoots) {
    try {
      files.push(...(await collectSourceFiles(rootPath)));
    } catch {
      // Ignore missing roots so operators can target narrow paths without setup churn.
    }
  }
  return Array.from(new Set(files)).sort((left, right) => left.localeCompare(right));
}

function getLineNumber(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function extractBalancedSegment(text, openParenIndex) {
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = openParenIndex; index < text.length; index += 1) {
    const char = text[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return {
          content: text.slice(openParenIndex + 1, index),
          endIndex: index,
        };
      }
    }
  }

  return null;
}

function extractStringLiterals(text) {
  const values = [];
  const pattern = /(["'`])((?:\\.|(?!\1)[\s\S])*)\1/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[2] ?? "";
    if (raw.includes("${")) continue;
    values.push(raw.replace(/\\(["'`\\])/g, "$1"));
  }
  return values;
}

function parseCollectionSpecFromExpression(expression) {
  const pattern = /(collectionGroup|collection)\s*\(/g;
  let match;
  let lastSpec = null;

  while ((match = pattern.exec(expression))) {
    const openParenIndex = expression.indexOf("(", match.index);
    if (openParenIndex < 0) continue;
    const segment = extractBalancedSegment(expression, openParenIndex);
    if (!segment) continue;
    const strings = extractStringLiterals(segment.content).filter(Boolean);
    if (match[1] === "collectionGroup") {
      if (strings.length > 0) {
        lastSpec = {
          collectionGroup: strings[0],
          queryScope: "COLLECTION_GROUP",
          source: "collectionGroup",
        };
      }
    } else if (strings.length > 0) {
      lastSpec = {
        collectionGroup: strings[strings.length - 1],
        queryScope: "COLLECTION",
        source: "collection",
      };
    }
    pattern.lastIndex = segment.endIndex + 1;
  }

  return lastSpec;
}

function parseWhereClauses(expression) {
  const clauses = [];
  const pattern = /where\s*\(\s*(["'`])([^"'`]+)\1\s*,\s*(["'`])([^"'`]+)\3/gs;
  for (const match of expression.matchAll(pattern)) {
    clauses.push({
      fieldPath: clean(match[2]),
      op: clean(match[4]),
    });
  }
  return clauses;
}

function parseOrderClauses(expression) {
  const clauses = [];
  const pattern = /orderBy\s*\(\s*(["'`])([^"'`]+)\1(?:\s*,\s*(["'`])([^"'`]+)\3)?/gs;
  for (const match of expression.matchAll(pattern)) {
    const rawDirection = clean(match[4]).toLowerCase();
    clauses.push({
      fieldPath: clean(match[2]),
      direction: rawDirection === "desc" || rawDirection === "descending" ? "DESCENDING" : "ASCENDING",
    });
  }
  return clauses;
}

function parseLimitClause(expression) {
  const match = expression.match(/limit\s*\(\s*(\d+)\s*\)/);
  return match ? Number(match[1]) : null;
}

function normalizeFieldSpec(field) {
  if (field.arrayConfig) {
    return `${field.fieldPath}:array:${field.arrayConfig}`;
  }
  return `${field.fieldPath}:order:${field.order || "ASCENDING"}`;
}

function buildShapeSignature(shape) {
  const parts = [
    normalizePathForReport(shape.filePath),
    String(shape.line),
    shape.collectionGroup,
    shape.queryScope,
    ...shape.filters.map((filter) => `${filter.fieldPath}:${filter.op}`),
    ...shape.orderBys.map((field) => `${field.fieldPath}:${field.direction}`),
  ];
  return parts.join("|");
}

function buildShapeRecord(shapeBase, expression) {
  const collection = parseCollectionSpecFromExpression(expression);
  if (!collection?.collectionGroup) return null;

  const filters = parseWhereClauses(expression);
  const orderBys = parseOrderClauses(expression);
  if (filters.length === 0 && orderBys.length === 0) return null;

  return {
    ...shapeBase,
    collectionGroup: collection.collectionGroup,
    queryScope: collection.queryScope,
    filters,
    orderBys,
    limit: parseLimitClause(expression),
    signature: "",
  };
}

function extractQueryCallShapes(filePath, text) {
  const shapes = [];
  const pattern = /\bquery\s*\(/g;
  let match;
  while ((match = pattern.exec(text))) {
    const openParenIndex = text.indexOf("(", match.index);
    if (openParenIndex < 0) continue;
    const segment = extractBalancedSegment(text, openParenIndex);
    if (!segment) continue;
    const shape = buildShapeRecord(
      {
        filePath,
        line: getLineNumber(text, match.index),
        sourceType: "query-call",
      },
      segment.content
    );
    if (!shape) continue;
    shape.signature = buildShapeSignature(shape);
    shapes.push(shape);
    pattern.lastIndex = segment.endIndex + 1;
  }
  return shapes;
}

function extractChainedQueryShapes(filePath, text) {
  const shapes = [];
  const pattern = /\.collection(?:Group)?\s*\(/g;
  let match;
  while ((match = pattern.exec(text))) {
    const lineStart = text.lastIndexOf("\n", match.index) + 1;
    let endIndex = text.indexOf(";", match.index);
    if (endIndex < 0) endIndex = Math.min(text.length, match.index + 600);
    const expression = text.slice(lineStart, endIndex + 1);
    if (!/\.where\s*\(|\.orderBy\s*\(|\.limit\s*\(/.test(expression)) continue;
    const shape = buildShapeRecord(
      {
        filePath,
        line: getLineNumber(text, match.index),
        sourceType: "admin-chain",
      },
      expression
    );
    if (!shape) continue;
    shape.signature = buildShapeSignature(shape);
    shapes.push(shape);
  }
  return shapes;
}

function deriveRequiredIndex(shape) {
  const relevantFilters = shape.filters.filter((filter) => INDEX_RELEVANT_OPERATORS.has(filter.op));
  if (relevantFilters.length === 0 && shape.orderBys.length <= 1) {
    return null;
  }
  if (relevantFilters.length <= 1 && shape.orderBys.length === 0) {
    return null;
  }

  const fields = [];
  const seen = new Set();

  for (const filter of relevantFilters) {
    if (seen.has(filter.fieldPath)) continue;
    seen.add(filter.fieldPath);
    if (ARRAY_OPERATORS.has(filter.op)) {
      fields.push({
        fieldPath: filter.fieldPath,
        arrayConfig: "CONTAINS",
      });
      continue;
    }
    fields.push({
      fieldPath: filter.fieldPath,
      order: "ASCENDING",
    });
  }

  for (const orderBy of shape.orderBys) {
    if (seen.has(orderBy.fieldPath)) continue;
    seen.add(orderBy.fieldPath);
    fields.push({
      fieldPath: orderBy.fieldPath,
      order: orderBy.direction,
    });
  }

  for (const filter of relevantFilters) {
    if (!INEQUALITY_OPERATORS.has(filter.op) || seen.has(filter.fieldPath)) continue;
    seen.add(filter.fieldPath);
    fields.push({
      fieldPath: filter.fieldPath,
      order: "ASCENDING",
    });
  }

  if (fields.length <= 1) return null;

  return {
    collectionGroup: shape.collectionGroup,
    queryScope: shape.queryScope,
    fields,
  };
}

function loadExistingIndexes(rawIndexes) {
  const indexes = Array.isArray(rawIndexes?.indexes) ? rawIndexes.indexes : [];
  return indexes.map((entry) => ({
    collectionGroup: clean(entry.collectionGroup),
    queryScope: clean(entry.queryScope || "COLLECTION"),
    fields: Array.isArray(entry.fields) ? entry.fields.map((field) => ({ ...field })) : [],
  }));
}

function isExactIndexMatch(requiredIndex, existingIndex) {
  if (!requiredIndex || !existingIndex) return false;
  if (requiredIndex.collectionGroup !== existingIndex.collectionGroup) return false;
  if (requiredIndex.queryScope !== existingIndex.queryScope) return false;
  if (requiredIndex.fields.length !== existingIndex.fields.length) return false;
  return requiredIndex.fields.every(
    (field, index) => normalizeFieldSpec(field) === normalizeFieldSpec(existingIndex.fields[index] || {})
  );
}

function isRelaxedIndexMatch(requiredIndex, existingIndex) {
  if (!requiredIndex || !existingIndex) return false;
  if (requiredIndex.collectionGroup !== existingIndex.collectionGroup) return false;
  if (requiredIndex.queryScope !== existingIndex.queryScope) return false;
  if (requiredIndex.fields.length !== existingIndex.fields.length) return false;
  const left = [...requiredIndex.fields].map(normalizeFieldSpec).sort();
  const right = [...existingIndex.fields].map(normalizeFieldSpec).sort();
  return left.every((value, index) => value === right[index]);
}

function classifyIndexCoverage(shape, existingIndexes) {
  const requiredIndex = deriveRequiredIndex(shape);
  if (!requiredIndex) {
    return {
      status: "not-needed",
      requiredIndex: null,
      matchedIndex: null,
      summary: "No composite index requirement inferred from this query shape.",
    };
  }

  const exactMatch = existingIndexes.find((entry) => isExactIndexMatch(requiredIndex, entry));
  if (exactMatch) {
    return {
      status: "covered",
      requiredIndex,
      matchedIndex: exactMatch,
      summary: "Composite index shape is already present in firestore.indexes.json.",
    };
  }

  const relaxedMatch = existingIndexes.find((entry) => isRelaxedIndexMatch(requiredIndex, entry));
  if (relaxedMatch) {
    return {
      status: "covered-relaxed",
      requiredIndex,
      matchedIndex: relaxedMatch,
      summary: "A compatible composite index exists, but field ordering differs from the local query-shape heuristic.",
    };
  }

  return {
    status: "missing",
    requiredIndex,
    matchedIndex: null,
    summary: "Likely composite index gap for this query shape.",
  };
}

function buildQueryFinding(shape, coverage) {
  const severity = coverage.status === "missing" ? "warning" : "info";
  const collectionLabel = `${shape.collectionGroup} (${shape.queryScope.toLowerCase()})`;
  const filterLabel = shape.filters.length > 0
    ? shape.filters.map((filter) => `${filter.fieldPath} ${filter.op}`).join(", ")
    : "none";
  const orderLabel = shape.orderBys.length > 0
    ? shape.orderBys.map((field) => `${field.fieldPath} ${field.direction.toLowerCase()}`).join(", ")
    : "none";

  return {
    code: coverage.status === "missing" ? "firestore-query-index-gap" : "firestore-query-shape",
    severity,
    file: normalizePathForReport(shape.filePath),
    line: shape.line,
    collectionGroup: shape.collectionGroup,
    queryScope: shape.queryScope,
    sourceType: shape.sourceType,
    filters: shape.filters,
    orderBys: shape.orderBys,
    limit: shape.limit,
    summary: `${collectionLabel} filters=[${filterLabel}] orderBy=[${orderLabel}]`,
    requiredIndex: coverage.requiredIndex,
    matchedIndex: coverage.matchedIndex,
    indexStatus: coverage.status,
    nextAction:
      coverage.status === "missing"
        ? "Add the inferred composite index or confirm the query is intentionally fallback-only before runtime."
        : "No action required unless the query shape changes.",
  };
}

function collectQueriedFields(shapes) {
  const fields = new Set();
  for (const shape of shapes) {
    shape.filters.forEach((filter) => fields.add(filter.fieldPath));
    shape.orderBys.forEach((field) => fields.add(field.fieldPath));
  }
  return fields;
}

function findWriteContext(text, index) {
  const start = Math.max(0, index - 260);
  const end = Math.min(text.length, index + 260);
  return text.slice(start, end);
}

function isFirestoreWriteContext(context) {
  return /(addDoc|setDoc|updateDoc|writeBatch|runTransaction|batch\.(set|update|create)|tx\.(set|update|create))/.test(context)
    || /\.collection\([\s\S]{0,220}?\.(?:add|set|update|create)\s*\(/.test(context);
}

function collectWriteHazards(filePath, text, queriedFields) {
  const findings = [];
  const seen = new Set();

  const undefinedPattern = /\b([A-Za-z0-9_]+)\s*:\s*(?:[^,\n{}]+?\?\?\s*)?undefined\b/g;
  for (const match of text.matchAll(undefinedPattern)) {
    const context = findWriteContext(text, match.index ?? 0);
    if (!isFirestoreWriteContext(context)) continue;
    const key = `${match.index}:undefined`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({
      code: "firestore-undefined-write-risk",
      severity: "warning",
      file: normalizePathForReport(filePath),
      line: getLineNumber(text, match.index ?? 0),
      fieldPath: clean(match[1]),
      summary: `Potential Firestore write includes \`${clean(match[1])}: undefined\`.`,
      nextAction: "Omit the field before write or set null only when the schema explicitly allows it.",
    });
  }

  for (const fieldPath of queriedFields) {
    const escapedField = fieldPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nullablePattern = new RegExp(
      `\\b${escapedField}\\s*:\\s*(?:null\\b|[^,\\n{}]+?(?:\\?\\?|\\|\\|)\\s*null\\b)`,
      "g"
    );
    for (const match of text.matchAll(nullablePattern)) {
      const context = findWriteContext(text, match.index ?? 0);
      if (!isFirestoreWriteContext(context)) continue;
      const key = `${match.index}:nullability`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        code: "firestore-nullability-query-risk",
        severity: "warning",
        file: normalizePathForReport(filePath),
        line: getLineNumber(text, match.index ?? 0),
        fieldPath,
        summary: `Queried field \`${fieldPath}\` is written with null-coalescing or explicit null in Firestore payload construction.`,
        nextAction: "Confirm null is supported for this query field and that downstream reads/indexes tolerate nullable values.",
      });
    }
  }

  return findings;
}

function buildMarkdown(summary) {
  const lines = [
    "# Firestore Query Shape Inspector",
    "",
    `- generatedAt: ${summary.generatedAt}`,
    `- status: ${summary.status}`,
    `- scannedFiles: ${summary.scannedFiles}`,
    `- queryShapes: ${summary.queryShapes.length}`,
    `- findings: ${summary.findings.length}`,
    "",
    "## Missing or risky query findings",
  ];

  const queryFindings = summary.findings.filter((finding) => finding.code === "firestore-query-index-gap");
  if (queryFindings.length === 0) {
    lines.push("- none");
  } else {
    for (const finding of queryFindings) {
      lines.push(`- ${finding.file}:${finding.line} - ${finding.summary}`);
      if (finding.requiredIndex) {
        lines.push(`  requiredIndex: ${JSON.stringify(finding.requiredIndex)}`);
      }
    }
  }

  lines.push("", "## Write hazards");
  const writeFindings = summary.findings.filter((finding) => finding.code !== "firestore-query-index-gap");
  if (writeFindings.length === 0) {
    lines.push("- none");
  } else {
    for (const finding of writeFindings) {
      lines.push(`- ${finding.file}:${finding.line} - ${finding.summary}`);
      lines.push(`  next: ${finding.nextAction}`);
    }
  }

  lines.push("", "## Covered query shapes");
  const covered = summary.queryShapes.filter((shape) => shape.indexStatus !== "missing");
  if (covered.length === 0) {
    lines.push("- none");
  } else {
    for (const shape of covered.slice(0, 20)) {
      lines.push(
        `- ${shape.file}:${shape.line} - ${shape.collectionGroup} (${shape.queryScope.toLowerCase()}) index=${shape.indexStatus}`
      );
    }
    if (covered.length > 20) {
      lines.push(`- ... ${covered.length - 20} additional covered query shapes omitted for brevity`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function runFirestoreQueryShapeInspector(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const inspectableFiles = await listInspectableFiles(options.scanRoots);
  const rawIndexes = JSON.parse(await readFile(resolve(repoRoot, "firestore.indexes.json"), "utf8"));
  const existingIndexes = loadExistingIndexes(rawIndexes);
  const queryShapes = [];
  const allHazards = [];

  for (const filePath of inspectableFiles) {
    const text = await readFile(filePath, "utf8");
    const shapes = [
      ...extractQueryCallShapes(filePath, text),
      ...extractChainedQueryShapes(filePath, text),
    ];
    const uniqueShapes = Array.from(new Map(shapes.map((shape) => [shape.signature, shape])).values());
    const filteredShapes = options.collections.length === 0
      ? uniqueShapes
      : uniqueShapes.filter((shape) => options.collections.includes(shape.collectionGroup));

    const queriedFields = collectQueriedFields(filteredShapes);
    filteredShapes.forEach((shape) => {
      const coverage = classifyIndexCoverage(shape, existingIndexes);
      queryShapes.push({
        file: normalizePathForReport(shape.filePath),
        line: shape.line,
        collectionGroup: shape.collectionGroup,
        queryScope: shape.queryScope,
        filters: shape.filters,
        orderBys: shape.orderBys,
        limit: shape.limit,
        sourceType: shape.sourceType,
        indexStatus: coverage.status,
        summary: coverage.summary,
        requiredIndex: coverage.requiredIndex,
      });
      if (coverage.status === "missing") {
        allHazards.push(buildQueryFinding(shape, coverage));
      }
    });

    allHazards.push(...collectWriteHazards(filePath, text, queriedFields));
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    status: allHazards.some((finding) => finding.severity === "warning") ? "warn" : "passed",
    scannedFiles: inspectableFiles.length,
    scanRoots: options.scanRoots.map(normalizePathForReport),
    collections: options.collections,
    queryShapes,
    findings: allHazards,
    reportJsonPath: options.reportJsonPath,
    reportMarkdownPath: options.reportMarkdownPath,
  };

  await mkdir(dirname(options.reportJsonPath), { recursive: true });
  await mkdir(dirname(options.reportMarkdownPath), { recursive: true });
  await writeFile(options.reportJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(options.reportMarkdownPath, buildMarkdown(summary), "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${summary.status}\n`);
    process.stdout.write(`scannedFiles: ${summary.scannedFiles}\n`);
    process.stdout.write(`queryShapes: ${summary.queryShapes.length}\n`);
    process.stdout.write(`findings: ${summary.findings.length}\n`);
    process.stdout.write(`report: ${basename(summary.reportMarkdownPath)}\n`);
  }

  if (options.strict && summary.status !== "passed") {
    process.exit(1);
  }

  return summary;
}

function isDirectInvocation() {
  return process.argv[1] ? resolve(process.argv[1]) === __filename : false;
}

if (isDirectInvocation()) {
  runFirestoreQueryShapeInspector().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`firestore-query-shape-inspector failed: ${message}`);
    process.exit(1);
  });
}
