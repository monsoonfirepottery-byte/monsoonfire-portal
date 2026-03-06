#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isoNow,
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
const POLICY_VERSION = "docs-memory-promotion.v1";

const TIMELINE_CAP = 8;
const TIMELINE_TOTAL_CAP = 12;
const SEMANTIC_MAX = 48;
const EPISODIC_MAX = 16;
const TOTAL_MAX = 64;
const SEMANTIC_FLOORS = {
  workstream_artifact: 6,
  relationship_artifact: 4,
  identity_artifact: 6,
  document_profile: 6,
  document_family: 6,
};

const GENERIC_ASSET_PATTERN =
  /\b(image\d+|img\d+|photo\d+|logo|background|header|footer|signature|banner|spacer|untitled|scan\d*|clip[_ -]?image)\b/i;
const TRANSPORT_ARTIFACT_PATTERN =
  /^(att\d+(\.[a-z0-9]{1,8})?|invite(\.ics)?|winmail\.dat|mime-attachment|attachment(\.[a-z0-9]{1,8})?|@)$/i;
const CREATIVE_CONTEXT_PATTERN = /\b(creative|design|brand|branding|photo|photography|art|marketing|collateral|asset|media)\b/i;

function usage() {
  process.stdout.write(
    [
      "Document metadata promote stage",
      "",
      "Usage:",
      "  node ./scripts/document-metadata-promote.mjs \\",
      "    --input ./output/memory/docs/document-analysis-memory.jsonl \\",
      "    --output ./output/memory/docs/document-promoted-memory.jsonl",
      "",
      "Options:",
      "  --input <path>       Analysis JSONL input",
      "  --output <path>      Promoted JSONL output",
      "  --dead-letter <path> Dropped JSONL output",
      "  --report <path>      Promote report path",
      "  --json               Print report JSON",
    ].join("\n")
  );
}

function text(value) {
  return String(value ?? "").trim();
}

function dedupe(values) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))];
}

function isGenericAsset(metadata) {
  const stem = text(metadata?.attachmentStem || metadata?.attachmentName || metadata?.attachmentFileName);
  if (/^image\//i.test(text(metadata?.mimeType)) && !CREATIVE_CONTEXT_PATTERN.test([
    text(metadata?.docKind),
    text(metadata?.collection),
    ...((Array.isArray(metadata?.tags) ? metadata.tags : []).map((value) => text(value))),
  ].join(' '))) return true;
  if (TRANSPORT_ARTIFACT_PATTERN.test(stem)) return true;
  if (/\.(ics|htm|html)$/i.test(stem) && !text(metadata?.excerpt || "")) return true;
  if (!GENERIC_ASSET_PATTERN.test(stem)) return false;
  const context = [
    text(metadata?.docKind),
    text(metadata?.collection),
    ...((Array.isArray(metadata?.tags) ? metadata.tags : []).map((value) => text(value))),
  ].join(" ");
  return !CREATIVE_CONTEXT_PATTERN.test(context);
}

function confidenceFor(row, layer) {
  const score = Number(row?.metadata?.score || row?.score || 0);
  const kind = text(row?.metadata?.docSignalKind || row?.metadata?.signalSubfamily);
  const base = layer === "semantic" ? 0.68 : 0.54;
  const typeBonus =
    kind === "workstream_artifact" ? 0.12 :
    kind === "relationship_artifact" ? 0.1 :
    kind === "identity_artifact" ? 0.08 :
    kind === "document_family" ? 0.08 :
    kind === "document_profile" ? 0.06 :
    0.03;
  return Math.max(0.5, Math.min(0.94, Number((base + Math.min(score, 11) * 0.02 + typeBonus).toFixed(3))));
}

function buildPromotedRow(row, layer) {
  return {
    id: `mem_req_${stableHash(`${layer}|${text(row.clientRequestId)}|${text(row.metadata?.analysisType)}`)}`,
    content: text(row.content),
    source: "docs:metadata-export:promoted-memory",
    tags: dedupe([...(Array.isArray(row.tags) ? row.tags : []), "docs-promoted", layer]),
    metadata: {
      ...(row.metadata && typeof row.metadata === "object" ? row.metadata : {}),
      memoryLayer: layer,
      confidence: confidenceFor(row, layer),
      reinforcementCount: 1,
      reinforcementKey: `${text(row.metadata?.analysisType)}|att:${text(row.metadata?.attachmentHash || row.metadata?.docFamilyKey || row.clientRequestId)}`,
      analysisVersion: "document-metadata-analyze.v2",
      policyVersion: POLICY_VERSION,
      docsQuotaPlan: {
        semanticMax: SEMANTIC_MAX,
        episodicMax: EPISODIC_MAX,
        timelineSemanticCap: TIMELINE_CAP,
        semanticFloors: SEMANTIC_FLOORS,
      },
    },
    occurredAt: row.occurredAt || row.metadata?.occurredAt || undefined,
    clientRequestId: text(row.clientRequestId),
  };
}

function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const inputPath = resolve(REPO_ROOT, readStringFlag(flags, "input", "").trim());
  const outputPath = resolve(REPO_ROOT, readStringFlag(flags, "output", "").trim());
  const deadLetterPath = resolve(REPO_ROOT, readStringFlag(flags, "dead-letter", "").trim());
  const reportPath = resolve(REPO_ROOT, readStringFlag(flags, "report", "").trim());
  const printJson = readBoolFlag(flags, "json", false);

  if (!inputPath) throw new Error("--input is required");
  if (!outputPath) throw new Error("--output is required");
  if (!deadLetterPath) throw new Error("--dead-letter is required");
  if (!reportPath) throw new Error("--report is required");

  const inputRows = readJsonlWithRaw(inputPath).filter((entry) => entry?.ok).map((entry) => entry.value);
  const prepared = inputRows.map((row) => {
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const kind = text(metadata.docSignalKind || metadata.signalSubfamily || metadata.analysisType).replace(/^attachment_(insight|trend)_/, "");
    return {
      row,
      metadata,
      kind,
      score: Number(metadata.score || row.score || 0),
      genericAsset: Boolean(metadata.genericAsset) || isGenericAsset(metadata),
      key: text(metadata.docFamilyKey || metadata.attachmentHash || metadata.attachmentStem || row.clientRequestId),
    };
  });

  const semantic = [];
  const episodic = [];
  const dropped = [];
  const semanticKeys = new Set();
  const episodicKeys = new Set();
  const semanticCounts = {};
  const totalCounts = {};

  const sortedByKind = (kind, extraFilter = () => true) =>
    prepared
      .filter((entry) => entry.kind === kind && extraFilter(entry))
      .sort((a, b) => b.score - a.score || text(a.metadata.attachmentName).localeCompare(text(b.metadata.attachmentName)));

  function tryPushSemantic(entry, reason = "selected_semantic") {
    if (semantic.length >= SEMANTIC_MAX) return false;
    if (semanticKeys.has(`${entry.kind}|${entry.key}`)) return false;
    if (entry.genericAsset) return false;
    if (entry.kind === "timeline_anchor" && Number(semanticCounts.timeline_anchor || 0) >= TIMELINE_CAP) return false;
    semantic.push(buildPromotedRow(entry.row, "semantic"));
    semanticKeys.add(`${entry.kind}|${entry.key}`);
    semanticCounts[entry.kind] = Number(semanticCounts[entry.kind] || 0) + 1;
    totalCounts[entry.kind] = Number(totalCounts[entry.kind] || 0) + 1;
    entry._decision = reason;
    return true;
  }

  function tryPushEpisodic(entry, reason = "selected_episodic") {
    if (episodic.length >= EPISODIC_MAX) return false;
    if (semanticKeys.has(`${entry.kind}|${entry.key}`) || episodicKeys.has(`${entry.kind}|${entry.key}`)) return false;
    if (entry.genericAsset && entry.score < 7) return false;
    if (entry.kind === "timeline_anchor" && Number(totalCounts.timeline_anchor || 0) >= TIMELINE_TOTAL_CAP) return false;
    episodic.push(buildPromotedRow(entry.row, "episodic"));
    episodicKeys.add(`${entry.kind}|${entry.key}`);
    totalCounts[entry.kind] = Number(totalCounts[entry.kind] || 0) + 1;
    entry._decision = reason;
    return true;
  }

  for (const [kind, minCount] of Object.entries(SEMANTIC_FLOORS)) {
    for (const entry of sortedByKind(kind, (candidate) => candidate.score >= 5)) {
      if (Number(semanticCounts[kind] || 0) >= minCount) break;
      tryPushSemantic(entry, "floor_semantic");
    }
  }

  for (const kind of ["workstream_artifact", "relationship_artifact", "identity_artifact", "document_profile", "document_family"]) {
    for (const entry of sortedByKind(kind, (candidate) => candidate.score >= 5)) {
      if (semantic.length >= SEMANTIC_MAX) break;
      tryPushSemantic(entry, "overflow_semantic");
    }
  }

  for (const entry of sortedByKind("timeline_anchor", (candidate) => candidate.score >= 6)) {
    if (semantic.length >= SEMANTIC_MAX) break;
    tryPushSemantic(entry, "timeline_semantic");
  }

  for (const kind of ["timeline_anchor", "document_profile", "document_family", "relationship_artifact", "workstream_artifact", "identity_artifact"]) {
    for (const entry of sortedByKind(kind, (candidate) => candidate.score >= 3)) {
      if (episodic.length >= EPISODIC_MAX) break;
      tryPushEpisodic(entry, "overflow_episodic");
    }
  }

  for (const entry of prepared) {
    if (semanticKeys.has(`${entry.kind}|${entry.key}`) || episodicKeys.has(`${entry.kind}|${entry.key}`)) continue;
    const dropReason =
      entry.genericAsset ? "generic_asset_filtered" :
      entry.score < 3 ? "below_episodic_min_score" :
      TOTAL_MAX <= semantic.length + episodic.length ? "overall_cap_reached" :
      `under_quota_threshold_${entry.kind || "unknown"}`;
    dropped.push({
      ...entry.row,
      metadata: {
        ...(entry.metadata || {}),
        dropReason,
        docsPolicyVersion: POLICY_VERSION,
      },
    });
  }

  const promotedRows = [...semantic, ...episodic];
  writeJsonl(outputPath, promotedRows);
  writeJsonl(deadLetterPath, dropped);

  const countsByType = promotedRows.reduce((acc, row) => {
    const key = text(row.metadata?.analysisType || "unknown");
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});

  const report = {
    schema: "document-metadata-promote-report.v2",
    generatedAt: isoNow(),
    inputPath,
    outputPath,
    deadLetterPath,
    counts: {
      inputRows: inputRows.length,
      promotedRows: promotedRows.length,
      semanticRows: semantic.length,
      episodicRows: episodic.length,
      droppedRows: dropped.length,
    },
    promotedAnalysisTypes: countsByType,
    semanticByKind: semantic.reduce((acc, row) => {
      const key = text(row.metadata?.docSignalKind || row.metadata?.signalSubfamily || "unknown");
      acc[key] = Number(acc[key] || 0) + 1;
      return acc;
    }, {}),
    droppedReasons: dropped.reduce((acc, row) => {
      const key = text(row.metadata?.dropReason || "unknown");
      acc[key] = Number(acc[key] || 0) + 1;
      return acc;
    }, {}),
    quotaPlan: {
      semanticMax: SEMANTIC_MAX,
      episodicMax: EPISODIC_MAX,
      totalMax: TOTAL_MAX,
      timelineSemanticCap: TIMELINE_CAP,
      timelineTotalCap: TIMELINE_TOTAL_CAP,
      semanticFloors: SEMANTIC_FLOORS,
    },
  };
  writeJson(reportPath, report);

  if (printJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write("document-metadata-promote complete\n");
}

main();
