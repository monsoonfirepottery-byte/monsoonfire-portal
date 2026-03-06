#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clipText,
  isoNow,
  normalizeWhitespace,
  parseCliArgs,
  readBoolFlag,
  readJsonlWithRaw,
  readStringFlag,
  stableHash,
  writeJson,
  writeJsonl,
} from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const GENERIC_ASSET_PATTERN =
  /\b(image\d+|img\d+|photo\d+|logo|background|header|footer|signature|banner|spacer|untitled|scan\d*|clip[_ -]?image)\b/i;
const TRANSPORT_ARTIFACT_PATTERN =
  /^(att\d+(\.[a-z0-9]{1,8})?|invite(\.ics)?|winmail\.dat|mime-attachment|attachment(\.[a-z0-9]{1,8})?|@)$/i;
const CREATIVE_CONTEXT_PATTERN = /\b(creative|design|brand|branding|photo|photography|art|marketing|collateral|asset|media)\b/i;
const RELATIONSHIP_PATTERN = /\b(vcard|resume|hiring|contact|family|person|relationship|directory|reference)\b/i;
const WORKSTREAM_PATTERN =
  /\b(project|services|marketing|product|delivery|proposal|statement[- ]of[- ]work|sow|checklist|enablement|roadmap|collateral|training|playbook)\b/i;
const IDENTITY_PATTERN = /\b(career|training|creative|life-admin|family|health|finance|resume|bio|profile)\b/i;

function usage() {
  process.stdout.write(
    [
      "Document metadata analysis stage",
      "",
      "Usage:",
      "  node ./scripts/document-metadata-analyze.mjs \\",
      "    --input ./output/memory/docs/document-memory.jsonl \\",
      "    --output ./output/memory/docs/document-analysis-memory.jsonl",
      "",
      "Options:",
      "  --input <path>     Normalized document-memory JSONL",
      "  --output <path>    Analysis JSONL output",
      "  --report <path>    Analysis report JSON output",
      "  --json             Print report JSON",
    ].join("\n")
  );
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function dedupe(values) {
  return [...new Set(values.map((value) => normalizeWhitespace(value)).filter(Boolean))];
}

function stem(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .replace(/[_\-]+/g, " ")
    .replace(/\b(final|draft|copy|latest|revised|revision|v\d+)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function quarterFromTimestamp(value) {
  const raw = normalizeWhitespace(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${year}-Q${quarter}`;
}

function monthFromTimestamp(value) {
  const raw = normalizeWhitespace(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function docContextText(doc) {
  return [doc.docKind, doc.collection, doc.title, doc.attachmentStem, ...doc.tags, ...doc.relatedPeople, ...doc.relatedOrganizations].join(" ");
}

function isCreativeAsset(doc) {
  return CREATIVE_CONTEXT_PATTERN.test(docContextText(doc));
}

function isTransportArtifact(doc) {
  const title = normalizeWhitespace(doc.title);
  const attachmentStem = normalizeWhitespace(doc.attachmentStem);
  const titleStem = stem(title);
  const pathValue = normalizeWhitespace(doc.path || "");
  if (TRANSPORT_ARTIFACT_PATTERN.test(title)) return true;
  if (TRANSPORT_ARTIFACT_PATTERN.test(attachmentStem)) return true;
  if (TRANSPORT_ARTIFACT_PATTERN.test(titleStem)) return true;
  if (/\batt\d+\.(htm|html|txt)\b/i.test(pathValue)) return true;
  if (/\.(ics|htm|html)$/i.test(title) && !doc.excerpt && sourceSignalStrength(doc) < 3) return true;
  return false;
}

function isGenericAsset(doc) {
  if (isTransportArtifact(doc)) return true;
  if (/^image\//i.test(doc.mimeType || '') && !isCreativeAsset(doc)) return true;
  if (!GENERIC_ASSET_PATTERN.test(`${doc.title} ${doc.attachmentStem}`)) return false;
  return !isCreativeAsset(doc);
}

function sourceSignalStrength(doc) {
  return (
    Number(Boolean(doc.owner)) +
    Number(doc.authors.length > 0) +
    Number(doc.relatedPeople.length > 0) +
    Number(doc.relatedOrganizations.length > 0) +
    Number(doc.sourceEvidence.length > 0)
  );
}

function scoreProfile(doc) {
  let score = 4;
  if (doc.excerpt) score += 1;
  if (doc.owner) score += 1;
  if (doc.authors.length > 0) score += 1;
  if (doc.tags.length >= 3) score += 1;
  if (doc.relatedPeople.length > 0) score += 1;
  if (doc.relatedOrganizations.length > 0) score += 1;
  if (doc.docKind) score += 1;
  if (doc.collection) score += 1;
  if (doc.occurredAt) score += 1;
  if (doc.sourceEvidence.length > 0) score += 1;
  if (isGenericAsset(doc)) score -= 4;
  if (isCreativeAsset(doc)) score += 1;
  return Math.max(1, Math.min(score, 12));
}

function typeScoreBoost(type) {
  if (type === "relationship_artifact") return 3;
  if (type === "workstream_artifact") return 3;
  if (type === "identity_artifact") return 2;
  if (type === "document_profile") return 1;
  if (type === "document_family") return 1;
  if (type === "timeline_anchor") return 0;
  return 0;
}

function evidenceRichnessFor(doc) {
  const richness =
    Number(Boolean(doc.excerpt)) +
    Number(Boolean(doc.owner)) +
    Number(doc.authors.length > 0) +
    Number(doc.tags.length >= 2) +
    Number(doc.relatedPeople.length > 0) +
    Number(doc.relatedOrganizations.length > 0) +
    Number(doc.sourceEvidence.length > 0);
  if (richness >= 5) return "high";
  if (richness >= 3) return "medium";
  return "low";
}

function attributionStrengthFor(doc) {
  if (doc.owner || doc.authors.length > 0) return "strong";
  if (doc.relatedPeople.length > 0 || doc.relatedOrganizations.length > 0 || doc.sourceEvidence.length > 0) return "moderate";
  return "weak";
}

function buildAnalysisRow(doc, { analysisType, signalLane, score, summary, topicTokens, extra = {} }) {
  return {
    content: clipText(summary, 1800),
    source: "docs:metadata-export:analysis-memory",
    tags: dedupe(["document", "metadata", "docs", ...doc.tags]),
    clientRequestId: `doc-analysis-${stableHash(`${analysisType}|${doc.clientRequestId}|${summary}`)}`,
    occurredAt: doc.occurredAt || undefined,
    metadata: {
      analysisType,
      signalFamily: "document_attachment",
      signalLane,
      score,
      attachmentName: doc.title,
      attachmentFileName: doc.title,
      attachmentStem: doc.attachmentStem,
      attachmentHash: doc.attachmentHash,
      mimeType: doc.mimeType,
      path: doc.path || null,
      url: doc.url || null,
      owner: doc.owner || null,
      authors: doc.authors,
      tags: doc.tags,
      collection: doc.collection || null,
      docKind: doc.docKind || null,
      eraLabel: doc.eraLabel || null,
      relatedPeople: doc.relatedPeople,
      relatedOrganizations: doc.relatedOrganizations,
      sourceEvidence: doc.sourceEvidence,
      sourceClientRequestIds: [doc.clientRequestId],
      evidenceRichness: evidenceRichnessFor(doc),
      attributionStrength: attributionStrengthFor(doc),
      topicTokens,
      participantSet: dedupe([...doc.relatedPeople, ...doc.relatedOrganizations, doc.owner, ...doc.authors]),
      eraQuarter: doc.eraQuarter || null,
      eraMonth: doc.eraMonth || null,
      timeWindow: doc.eraQuarter || doc.eraMonth || doc.eraLabel || null,
      contextBreadth: Number(extra.contextBreadth || 1),
      patternSpecificityScore: Number(extra.patternSpecificityScore || 1),
      singleThreadPattern: false,
      genericAsset: Boolean(extra.genericAsset ?? isGenericAsset(doc)),
      ...extra,
    },
    score,
  };
}

function rankDocs(docs, type, predicate, cap, scorer) {
  return docs
    .filter(predicate)
    .map((doc) => ({ doc, score: scorer(doc) + typeScoreBoost(type) }))
    .sort((a, b) => b.score - a.score || b.doc.relatedPeople.length - a.doc.relatedPeople.length || a.doc.title.localeCompare(b.doc.title))
    .slice(0, cap);
}

function analyzeDocuments(rows) {
  const docs = rows
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const occurredAt = normalizeWhitespace(row.occurredAt || metadata.updatedAt || metadata.createdAt || "");
      const tags = dedupe(safeArray(metadata.tags));
      const relatedPeople = dedupe(safeArray(metadata.relatedPeople));
      const relatedOrganizations = dedupe(safeArray(metadata.relatedOrganizations));
      const authors = dedupe(safeArray(metadata.authors));
      const sourceEvidence = dedupe(safeArray(metadata.sourceEvidence));
      const title = normalizeWhitespace(metadata.attachmentName || metadata.attachmentFileName || "Untitled document");
      return {
        row,
        metadata,
        clientRequestId: normalizeWhitespace(row.clientRequestId),
        title,
        attachmentStem: stem(metadata.attachmentStem || title),
        attachmentHash: normalizeWhitespace(metadata.attachmentHash || metadata.sha256 || ""),
        mimeType: normalizeWhitespace(metadata.mimeType || "application/octet-stream"),
        path: normalizeWhitespace(metadata.path || ""),
        url: normalizeWhitespace(metadata.url || ""),
        owner: normalizeWhitespace(metadata.owner || ""),
        authors,
        tags,
        collection: normalizeWhitespace(metadata.collection || ""),
        docKind: normalizeWhitespace(metadata.docKind || ""),
        eraLabel: normalizeWhitespace(metadata.eraLabel || ""),
        relatedPeople,
        relatedOrganizations,
        sourceEvidence,
        excerpt: normalizeWhitespace(metadata.excerpt || ""),
        occurredAt: occurredAt || null,
        eraQuarter: quarterFromTimestamp(occurredAt) || normalizeWhitespace(metadata.eraLabel || ""),
        eraMonth: monthFromTimestamp(occurredAt),
      };
    });

  const docsSignalReady = docs.filter((doc) => !isTransportArtifact(doc));
  const rowsOut = [];

  const strongProfiles = rankDocs(docsSignalReady, "document_profile", (doc) => scoreProfile(doc) >= 5, 36, (doc) => scoreProfile(doc));
  for (const { doc, score } of strongProfiles) {
    const topicTokens = dedupe([doc.docKind, doc.collection, ...doc.tags, ...doc.relatedOrganizations].slice(0, 10));
    rowsOut.push(
      buildAnalysisRow(doc, {
        analysisType: "attachment_insight_document_profile",
        signalLane: "exemplar",
        score: Math.min(11, Math.max(5, score)),
        topicTokens,
        summary: `Document profile: ${doc.title}${doc.collection ? ` in ${doc.collection}` : ""}${doc.docKind ? ` (${doc.docKind})` : ""}${doc.eraQuarter ? ` around ${doc.eraQuarter}` : ""}. ${doc.excerpt || "Metadata-rich document with timeline or context value."}`,
        extra: {
          signalSubfamily: "document_profile",
          docSignalKind: "document_profile",
          docFamilyKey: doc.attachmentHash || doc.attachmentStem,
          contextSliceKey: dedupe([doc.collection, doc.docKind, doc.eraQuarter]).join("|"),
        },
      })
    );
  }

  const relationshipDocs = rankDocs(
    docsSignalReady,
    "relationship_artifact",
    (doc) =>
      !isGenericAsset(doc) &&
      (doc.relatedPeople.length > 0 ||
        RELATIONSHIP_PATTERN.test(`${doc.docKind} ${doc.tags.join(" ")} ${doc.collection}`) ||
        sourceSignalStrength(doc) >= 3),
    28,
    (doc) => scoreProfile(doc) + doc.relatedPeople.length + sourceSignalStrength(doc)
  );
  for (const { doc, score } of relationshipDocs) {
    rowsOut.push(
      buildAnalysisRow(doc, {
        analysisType: "attachment_insight_relationship_artifact",
        signalLane: "exemplar",
        score: Math.min(11, Math.max(6, score)),
        topicTokens: dedupe(["relationship", doc.docKind, ...doc.relatedPeople, ...doc.tags].slice(0, 10)),
        summary: `Relationship artifact: ${doc.title}${doc.relatedPeople.length > 0 ? ` tied to ${doc.relatedPeople.join(", ")}` : ""}${doc.eraQuarter ? ` in ${doc.eraQuarter}` : ""}. ${doc.excerpt || "Document preserves relationship or contact context."}`,
        extra: {
          signalSubfamily: "relationship_artifact",
          docSignalKind: "relationship_artifact",
          docFamilyKey: doc.attachmentHash || doc.attachmentStem,
        },
      })
    );
  }

  const workstreamDocs = rankDocs(
    docsSignalReady,
    "workstream_artifact",
    (doc) =>
      !isGenericAsset(doc) &&
      (WORKSTREAM_PATTERN.test(`${doc.docKind} ${doc.collection} ${doc.tags.join(" ")}`) ||
        doc.relatedOrganizations.length > 0 ||
        sourceSignalStrength(doc) >= 3),
    36,
    (doc) => scoreProfile(doc) + doc.relatedOrganizations.length + sourceSignalStrength(doc)
  );
  for (const { doc, score } of workstreamDocs) {
    rowsOut.push(
      buildAnalysisRow(doc, {
        analysisType: "attachment_insight_workstream_artifact",
        signalLane: "exemplar",
        score: Math.min(11, Math.max(6, score)),
        topicTokens: dedupe(["workstream", doc.docKind, doc.collection, ...doc.relatedOrganizations, ...doc.tags].slice(0, 10)),
        summary: `Workstream artifact: ${doc.title}${doc.relatedOrganizations.length > 0 ? ` for ${doc.relatedOrganizations.join(", ")}` : ""}${doc.eraQuarter ? ` in ${doc.eraQuarter}` : ""}. ${doc.excerpt || "Document anchors project or workstream context."}`,
        extra: {
          signalSubfamily: "workstream_artifact",
          docSignalKind: "workstream_artifact",
          docFamilyKey: doc.attachmentHash || doc.attachmentStem,
        },
      })
    );
  }

  const identityDocs = rankDocs(
    docsSignalReady,
    "identity_artifact",
    (doc) =>
      !isGenericAsset(doc) &&
      (IDENTITY_PATTERN.test(`${doc.docKind} ${doc.collection} ${doc.tags.join(" ")}`) ||
        /resume|bio|family|health|finance/i.test(doc.title) ||
        sourceSignalStrength(doc) >= 2),
    28,
    (doc) => scoreProfile(doc) + sourceSignalStrength(doc)
  );
  for (const { doc, score } of identityDocs) {
    rowsOut.push(
      buildAnalysisRow(doc, {
        analysisType: "attachment_insight_identity_artifact",
        signalLane: "exemplar",
        score: Math.min(11, Math.max(5, score)),
        topicTokens: dedupe(["identity", doc.docKind, doc.collection, ...doc.tags].slice(0, 10)),
        summary: `Identity artifact: ${doc.title}${doc.eraQuarter ? ` around ${doc.eraQuarter}` : ""}. ${doc.excerpt || "Document contributes identity, career, or life-context signal."}`,
        extra: {
          signalSubfamily: "identity_artifact",
          docSignalKind: "identity_artifact",
          docFamilyKey: doc.attachmentHash || doc.attachmentStem,
        },
      })
    );
  }

  const timelineDocs = rankDocs(
    docsSignalReady,
    "timeline_anchor",
    (doc) => Boolean(doc.occurredAt) && !isGenericAsset(doc),
    14,
    (doc) => scoreProfile(doc) + Number(Boolean(doc.eraQuarter)) + Number(sourceSignalStrength(doc) >= 2)
  );
  for (const { doc, score } of timelineDocs) {
    rowsOut.push(
      buildAnalysisRow(doc, {
        analysisType: "attachment_insight_timeline_anchor",
        signalLane: "pattern",
        score: Math.min(9, Math.max(5, score - 1)),
        topicTokens: dedupe(["timeline", doc.eraQuarter, doc.docKind, ...doc.tags].slice(0, 10)),
        summary: `Timeline anchor: ${doc.title}${doc.occurredAt ? ` dated ${doc.occurredAt}` : ""}${doc.collection ? ` in ${doc.collection}` : ""}. ${doc.excerpt || "Document provides time-localized context."}`,
        extra: {
          signalSubfamily: "timeline_anchor",
          docSignalKind: "timeline_anchor",
          docFamilyKey: doc.attachmentHash || doc.attachmentStem,
          contextBreadth: 2,
          patternSpecificityScore: 3,
        },
      })
    );
  }

  const familyMap = new Map();
  for (const doc of docsSignalReady) {
    const key = [doc.collection || "misc", doc.docKind || "document", doc.attachmentStem || doc.title].join("|");
    const existing = familyMap.get(key) || {
      key,
      docs: [],
      eras: new Set(),
      collections: new Set(),
      organizations: new Set(),
      people: new Set(),
      tags: new Set(),
    };
    existing.docs.push(doc);
    if (doc.eraQuarter) existing.eras.add(doc.eraQuarter);
    if (doc.collection) existing.collections.add(doc.collection);
    for (const org of doc.relatedOrganizations) existing.organizations.add(org);
    for (const person of doc.relatedPeople) existing.people.add(person);
    for (const tag of doc.tags) existing.tags.add(tag);
    familyMap.set(key, existing);
  }

  const families = [...familyMap.values()]
    .filter((entry) => {
      const doc = entry.docs[0];
      return !isGenericAsset(doc) && !isTransportArtifact(doc) && (entry.docs.length >= 2 || entry.eras.size >= 2 || entry.organizations.size >= 1 || entry.people.size >= 1);
    })
    .sort((a, b) => {
      const aBreadth = Math.max(a.eras.size, a.collections.size, a.organizations.size, a.people.size, 1);
      const bBreadth = Math.max(b.eras.size, b.collections.size, b.organizations.size, b.people.size, 1);
      return bBreadth - aBreadth || b.docs.length - a.docs.length || a.key.localeCompare(b.key);
    })
    .slice(0, 24);

  for (const family of families) {
    const doc = family.docs[0];
    const contextBreadth = Math.max(family.eras.size, family.collections.size, family.organizations.size, family.people.size, 1);
    const specificity = Math.min(
      5,
      1 +
        Number(Boolean(doc.docKind)) +
        Number(Boolean(doc.collection)) +
        Number(family.eras.size >= 2) +
        Number(family.organizations.size >= 1 || family.people.size >= 1)
    );
    rowsOut.push(
      buildAnalysisRow(doc, {
        analysisType: "attachment_trend_document_family",
        signalLane: "pattern",
        score: Math.min(11, Math.max(5, 4 + family.docs.length + Math.min(contextBreadth, 3) + typeScoreBoost("document_family"))),
        topicTokens: dedupe([doc.docKind, doc.collection, ...family.tags].slice(0, 10)),
        summary: `Document family: ${doc.title} recurs as a ${doc.docKind || "document"} family across ${family.docs.length} curated records${family.eras.size > 0 ? ` spanning ${family.eras.size} era buckets` : ""}${family.organizations.size > 0 ? ` and ${family.organizations.size} related organizations` : ""}${family.people.size > 0 ? ` with ${family.people.size} linked people` : ""}.`,
        extra: {
          signalSubfamily: "document_family",
          docSignalKind: "document_family",
          docFamilyKey: family.key,
          contextSliceKey: dedupe([...family.collections, ...family.eras]).join("|"),
          crossContextCount: contextBreadth,
          quarterSpread: family.eras.size,
          contextBreadth,
          patternSpecificityScore: specificity,
        },
      })
    );
  }

  return { docs, rowsOut };
}

function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const inputPath = resolve(REPO_ROOT, readStringFlag(flags, "input", "").trim());
  const outputPath = resolve(REPO_ROOT, readStringFlag(flags, "output", "").trim());
  const reportPath = resolve(REPO_ROOT, readStringFlag(flags, "report", "").trim());
  const printJson = readBoolFlag(flags, "json", false);

  if (!inputPath) throw new Error("--input is required");
  if (!outputPath) throw new Error("--output is required");
  if (!reportPath) throw new Error("--report is required");

  const rows = readJsonlWithRaw(inputPath).filter((entry) => entry && entry.ok).map((entry) => entry.value);
  const { docs, rowsOut } = analyzeDocuments(rows);

  writeJsonl(outputPath, rowsOut);

  const countsByType = rowsOut.reduce((acc, row) => {
    const key = normalizeWhitespace(row?.metadata?.analysisType || "unknown");
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});

  const report = {
    schema: "document-metadata-analyze-report.v2",
    generatedAt: isoNow(),
    inputPath,
    outputPath,
    counts: {
      inputRows: rows.length,
      validDocs: docs.length,
      analyzedRows: rowsOut.length,
    },
    analysisTypes: countsByType,
  };
  writeJson(reportPath, report);

  if (printJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write("document-metadata-analyze complete\n");
}

main();
