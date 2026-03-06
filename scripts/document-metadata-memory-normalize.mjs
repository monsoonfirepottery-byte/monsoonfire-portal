#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clipText,
  ensureParentDir,
  isoNow,
  parseCliArgs,
  readBoolFlag,
  readStringFlag,
  stableHash,
} from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "Document metadata -> memory normalizer",
      "",
      "Usage:",
      "  node ./scripts/document-metadata-memory-normalize.mjs \\",
      "    --input ./imports/documents/docs.jsonl \\",
      "    --output ./imports/documents/document-memory.jsonl",
      "",
      "Options:",
      "  --input <path>            Document metadata JSONL or JSON array file",
      "  --output <path>           Output JSONL path",
      "  --source <value>          Source tag (default: docs:metadata-export)",
      "  --max-text-chars <n>      Clip long text fields (default: 2200)",
      "  --json                    Print summary JSON",
    ].join("\n")
  );
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseInputFile(path) {
  if (!existsSync(path)) throw new Error(`input not found: ${path}`);
  const raw = readFileSync(path, "utf8");
  if (path.endsWith(".json")) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.rows)) return parsed.rows;
    throw new Error("JSON input must be an array or an object with rows[]");
  }
  return raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function toIso(value) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return normalized;
  return parsed.toISOString();
}

function pickTitle(row) {
  return (
    normalizeText(row.title) ||
    normalizeText(row.name) ||
    normalizeText(row.fileName) ||
    normalizeText(row.filename) ||
    normalizeText(row.path ? basename(row.path) : "") ||
    "Untitled document"
  );
}

function pickMime(row) {
  return (
    normalizeText(row.mimeType) ||
    normalizeText(row.mime) ||
    normalizeText(row.contentType) ||
    (row.path ? `application/${extname(row.path).replace(/^\./, "").toLowerCase() || "octet-stream"}` : "") ||
    "application/octet-stream"
  );
}

function normalizeRow(row, { source, maxTextChars }) {
  const title = pickTitle(row);
  const pathValue = normalizeText(row.path || row.filePath || row.uri || row.url || "");
  const urlValue = normalizeText(row.url || row.uri || "");
  const mimeType = pickMime(row);
  const attachmentHash =
    normalizeText(row.sha256) ||
    normalizeText(row.hash) ||
    normalizeText(row.contentHash) ||
    normalizeText(row.etag) ||
    null;
  const occurredAt =
    toIso(row.updatedAt || row.modifiedAt || row.lastModifiedAt || row.createdAt || row.date || "") || undefined;
  const owner = normalizeText(row.owner || row.author || row.createdBy || row.modifiedBy || "");
  const authors = safeArray(row.authors || row.owners).map((entry) => normalizeText(entry)).filter(Boolean);
  const tags = safeArray(row.tags).map((entry) => normalizeText(entry)).filter(Boolean);
  const relatedPeople = safeArray(row.relatedPeople || row.people).map((entry) => normalizeText(entry)).filter(Boolean);
  const relatedOrganizations = safeArray(row.relatedOrganizations || row.organizations)
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
  const sourceEvidence = safeArray(row.sourceEvidence || row.evidence).map((entry) => normalizeText(entry)).filter(Boolean);
  const collection = normalizeText(row.collection || row.folder || row.group || "");
  const docKind = normalizeText(row.docKind || row.kind || row.documentType || "");
  const eraLabel = normalizeText(row.eraLabel || row.era || row.period || "");
  const excerpt = clipText(
    normalizeText(row.excerpt || row.summary || row.description || row.text || row.content || ""),
    maxTextChars
  );
  const sizeBytes = Number(row.sizeBytes || row.size || row.bytes || 0) || 0;
  const recordKey = attachmentHash || pathValue || title;
  const clientRequestId = `doc-meta-${stableHash(`${recordKey}|${occurredAt || ""}|${mimeType}`)}`;

  const content = [
    "Document metadata export item.",
    `Title: ${title}.`,
    pathValue ? `Path: ${pathValue}.` : "",
    urlValue && urlValue !== pathValue ? `URL: ${urlValue}.` : "",
    mimeType ? `MIME: ${mimeType}.` : "",
    sizeBytes > 0 ? `Size: ${sizeBytes} bytes.` : "",
    attachmentHash ? `Hash: ${attachmentHash}.` : "",
    owner ? `Owner: ${owner}.` : "",
    authors.length > 0 ? `Authors: ${authors.join(", ")}.` : "",
    collection ? `Collection: ${collection}.` : "",
    docKind ? `Type: ${docKind}.` : "",
    eraLabel ? `Era: ${eraLabel}.` : "",
    tags.length > 0 ? `Tags: ${tags.join(", ")}.` : "",
    relatedPeople.length > 0 ? `People: ${relatedPeople.join(", ")}.` : "",
    relatedOrganizations.length > 0 ? `Organizations: ${relatedOrganizations.join(", ")}.` : "",
    occurredAt ? `Updated: ${occurredAt}.` : "",
    excerpt ? `Excerpt: ${excerpt}` : "",
    sourceEvidence.length > 0 ? `Source evidence: ${sourceEvidence.join(" | ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    unitType: "attachment",
    content,
    source,
    tags: ["document", "metadata", "docs"],
    clientRequestId,
    occurredAt,
    metadata: {
      type: "document_metadata",
      attachmentName: title,
      attachmentFileName: title,
      mimeType,
      attachmentMimeType: mimeType,
      attachmentHash,
      sha256: attachmentHash,
      sizeBytes,
      path: pathValue || null,
      url: urlValue || null,
      owner: owner || null,
      authors,
      tags,
      collection: collection || null,
      docKind: docKind || null,
      eraLabel: eraLabel || null,
      relatedPeople,
      relatedOrganizations,
      sourceEvidence,
      createdAt: toIso(row.createdAt || row.created || "") || null,
      updatedAt: toIso(row.updatedAt || row.modifiedAt || row.lastModifiedAt || row.date || "") || null,
      sourceSentAt: toIso(row.createdAt || row.created || "") || null,
      sourceReceivedAt: toIso(row.updatedAt || row.modifiedAt || row.lastModifiedAt || row.date || "") || null,
      excerpt,
      hasText: Boolean(excerpt),
      extractionStatus: "metadata_only",
      extractionReason: "document_metadata_import",
      attachmentTextCharCount: excerpt.length,
    },
  };
}

function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const inputPathFlag = readStringFlag(flags, "input", "").trim();
  if (!inputPathFlag) throw new Error("--input is required");
  const inputPath = resolve(REPO_ROOT, inputPathFlag);
  const outputPath = resolve(REPO_ROOT, readStringFlag(flags, "output", "./imports/documents/document-memory.jsonl"));
  const source = readStringFlag(flags, "source", "docs:metadata-export");
  const maxTextChars = Math.max(200, Number(readStringFlag(flags, "max-text-chars", "2200")) || 2200);
  const printJson = readBoolFlag(flags, "json", false);

  const inputRows = parseInputFile(inputPath);
  const normalizedRows = inputRows
    .filter((row) => row && typeof row === "object")
    .map((row) => normalizeRow(row, { source, maxTextChars }));

  ensureParentDir(outputPath);
  const body = normalizedRows.map((row) => JSON.stringify(row)).join("\n");
  writeFileSync(outputPath, body ? `${body}\n` : "", "utf8");

  const summary = {
    schema: "document-metadata-memory-normalize-report.v1",
    generatedAt: isoNow(),
    inputPath,
    outputPath,
    source,
    totals: {
      inputRows: inputRows.length,
      rows: normalizedRows.length,
    },
  };

  if (printJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  process.stdout.write("document-metadata-memory-normalize complete\n");
  process.stdout.write(`input: ${inputPath}\n`);
  process.stdout.write(`output: ${outputPath}\n`);
  process.stdout.write(`rows: ${normalizedRows.length}\n`);
}

main();
