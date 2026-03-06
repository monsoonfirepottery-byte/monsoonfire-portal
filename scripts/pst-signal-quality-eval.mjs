#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isoNow,
  normalizeWhitespace,
  parseCliArgs,
  readJson,
  readJsonlWithRaw,
  readNumberFlag,
  readStringFlag,
  writeJson,
} from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "PST signal quality evaluation pack",
      "",
      "Usage:",
      "  node ./scripts/pst-signal-quality-eval.mjs \\",
      "    --analysis ./output/.../mailbox-analysis-memory.jsonl \\",
      "    --promoted ./output/.../mailbox-promoted-memory.jsonl \\",
      "    --promote-report ./output/.../promote-report.json \\",
      "    --manifest ./output/.../canonical-corpus/manifest.json \\",
      "    --output-dir ./output/.../signal-quality \\",
      "    --pipeline-log ./output/.../pipeline.log",
    ].join("\n")
  );
}

function loadJsonl(path) {
  return readJsonlWithRaw(path)
    .filter((entry) => entry.ok && entry.value && typeof entry.value === "object")
    .map((entry) => entry.value);
}

function groupCount(rows, keyFn) {
  const counts = new Map();
  for (const row of rows) {
    const key = normalizeWhitespace(keyFn(row)) || "unknown";
    counts.set(key, Number(counts.get(key) || 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].sort((a, b) => Number(b[1]) - Number(a[1]) || String(a[0]).localeCompare(String(b[0])))
  );
}

function confidenceBand(value) {
  const score = Number(value || 0);
  if (score >= 0.85) return "0.85-1.00";
  if (score >= 0.7) return "0.70-0.84";
  if (score >= 0.55) return "0.55-0.69";
  if (score >= 0.4) return "0.40-0.54";
  return "0.00-0.39";
}

function temporalSanityRate(rows) {
  const anchored = rows.filter((row) => normalizeWhitespace(row.occurredAt));
  if (anchored.length === 0) return 0;
  const sane = anchored.filter((row) => {
    const ts = Date.parse(String(row.occurredAt || ""));
    if (!Number.isFinite(ts)) return false;
    const year = new Date(ts).getUTCFullYear();
    return year >= 1980 && year <= 2100;
  });
  return Number((sane.length / anchored.length).toFixed(4));
}

function quotaFillRates(promotedRows, quotaPlan) {
  const byFamily = groupCount(promotedRows, (row) => row?.metadata?.signalFamily || "unknown");
  return Object.fromEntries(
    Object.entries(quotaPlan || {}).map(([family, quota]) => {
      const actual = Number(byFamily[family] || 0);
      return [family, { quota, actual, fillRate: quota > 0 ? Number((actual / quota).toFixed(4)) : 0 }];
    })
  );
}

function attritionByFamily(analysisRows, promotedRows, manifestCounts = {}) {
  const analyzed = groupCount(analysisRows, (row) => row?.metadata?.signalFamily || "unknown");
  const promoted = groupCount(promotedRows, (row) => row?.metadata?.signalFamily || "unknown");
  const families = new Set([...Object.keys(analyzed), ...Object.keys(promoted)]);
  const out = {};
  for (const family of families) {
    const analyzedCount = Number(analyzed[family] || 0);
    const promotedCount = Number(promoted[family] || 0);
    out[family] = {
      analyzed: analyzedCount,
      promoted: promotedCount,
      promotionRate: analyzedCount > 0 ? Number((promotedCount / analyzedCount).toFixed(4)) : 0,
      factEvents: family === "unknown" ? 0 : Number(manifestCounts.factEvents || 0),
    };
  }
  return out;
}

function laneCounts(rows, location = "metadata") {
  return groupCount(rows, (row) =>
    location === "metadata" ? row?.metadata?.signalLane || "unknown" : row?.signalLane || "unknown"
  );
}

function buildReviewSection(title, rows, limit) {
  const lines = [`## ${title}`];
  const sliced = rows.slice(0, limit);
  if (sliced.length === 0) {
    lines.push("- None");
    return lines;
  }
  for (const row of sliced) {
    const family = normalizeWhitespace(row?.metadata?.signalFamily || row.signalFamily || "unknown");
    const lane = normalizeWhitespace(row?.metadata?.signalLane || row.signalLane || "unknown");
    const analysisType = normalizeWhitespace(row?.metadata?.analysisType || row.analysisType || "unknown");
    const confidence = Number(row?.metadata?.confidence || 0);
    const score = Number(row?.metadata?.score || row.score || 0);
    const content = normalizeWhitespace(row.content || "");
    lines.push(`- [${family}] [${lane}] [${analysisType}] score=${score} confidence=${confidence}: ${content.slice(0, 220)}`);
  }
  return lines;
}

function laneRows(rows, family, lane) {
  return rows.filter(
    (row) =>
      normalizeWhitespace(row?.metadata?.signalFamily || row.signalFamily || "") === family &&
      normalizeWhitespace(row?.metadata?.signalLane || row.signalLane || "") === lane
  );
}

function familyShare(rows, family) {
  if (rows.length === 0) return 0;
  const count = rows.filter((row) => normalizeWhitespace(row?.metadata?.signalFamily || row.signalFamily || "") === family).length;
  return Number((count / rows.length).toFixed(4));
}

function hasGenericPatternContent(row) {
  const content = normalizeWhitespace(row?.content || "").toLowerCase();
  return /untitled attachment|attachment trend summary|unnamed attachment|attachment pattern: attachment\b/.test(content);
}

function threadSubtypeDistribution(rows) {
  return groupCount(
    rows.filter((row) => normalizeWhitespace(row?.metadata?.signalFamily) === "thread_decision"),
    (row) => row?.metadata?.analysisType
  );
}

function countBadTimeAnchors(rows) {
  return rows.filter((row) => {
    const occurredAt = normalizeWhitespace(row?.occurredAt || "");
    if (!occurredAt) return false;
    const ts = Date.parse(occurredAt);
    if (!Number.isFinite(ts)) return true;
    const year = new Date(ts).getUTCFullYear();
    return year < 1980 || year > 2100;
  }).length;
}

function countTopicPairCorrelations(rows) {
  return rows.filter(
    (row) =>
      normalizeWhitespace(row?.metadata?.analysisType || row.analysisType || "") === "correlation" &&
      normalizeWhitespace(row?.metadata?.correlationType || row.correlationType || "") === "topic_pair"
  ).length;
}

function countSingleThreadDocPatterns(rows, location = "metadata") {
  return rows.filter((row) => {
    const family = normalizeWhitespace(location === "metadata" ? row?.metadata?.signalFamily : row.signalFamily);
    const lane = normalizeWhitespace(location === "metadata" ? row?.metadata?.signalLane : row.signalLane);
    const singleThread = Boolean(location === "metadata" ? row?.metadata?.singleThreadPattern : row.singleThreadPattern);
    return family === "document_attachment" && lane === "pattern" && singleThread;
  }).length;
}

function analyzerMaxRssKbFromLog(logPath) {
  if (!logPath) return null;
  try {
    const text = readFileSync(logPath, "utf8");
    const sections = text.split(/Command being timed:/g);
    for (const section of sections) {
      if (!section.includes("pst-memory-analyze-hybrid.mjs")) continue;
      const match = section.match(/Maximum resident set size \(kbytes\):\s+(\d+)/);
      if (match) return Number(match[1]);
    }
  } catch {
    return null;
  }
  return null;
}

function run() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (flags.help || flags.h) {
    usage();
    return;
  }

  const analysisPath = resolve(REPO_ROOT, readStringFlag(flags, "analysis", ""));
  const promotedPath = resolve(REPO_ROOT, readStringFlag(flags, "promoted", ""));
  const droppedFlag = readStringFlag(flags, "dropped", "").trim();
  const droppedPath = droppedFlag ? resolve(REPO_ROOT, droppedFlag) : "";
  const promoteReportPath = resolve(REPO_ROOT, readStringFlag(flags, "promote-report", ""));
  const manifestPath = resolve(REPO_ROOT, readStringFlag(flags, "manifest", ""));
  const outputDir = resolve(REPO_ROOT, readStringFlag(flags, "output-dir", "./output/memory/signal-quality"));
  const baselineReportFlag = readStringFlag(flags, "baseline-report", "").trim();
  const baselineReportPath = baselineReportFlag ? resolve(REPO_ROOT, baselineReportFlag) : "";
  const pipelineLogFlag = readStringFlag(flags, "pipeline-log", "").trim();
  const pipelineLogPath = pipelineLogFlag ? resolve(REPO_ROOT, pipelineLogFlag) : "";
  const reviewLimit = readNumberFlag(flags, "review-limit", 15, { min: 1, max: 100 });

  if (!analysisPath || !promotedPath || !promoteReportPath || !manifestPath) {
    throw new Error("--analysis, --promoted, --promote-report, and --manifest are required");
  }

  mkdirSync(outputDir, { recursive: true });

  const analysisRows = loadJsonl(analysisPath);
  const promotedRows = loadJsonl(promotedPath);
  const droppedRows = droppedPath ? loadJsonl(droppedPath) : [];
  const promoteReport = readJson(promoteReportPath, {});
  const manifest = readJson(manifestPath, {});
  const baselineReport = baselineReportPath ? readJson(baselineReportPath, null) : null;
  const quotaPlan = promoteReport.quotaPlan || {};
  const promotedDocPatterns = laneRows(promotedRows, "document_attachment", "pattern");
  const promotedDocExemplars = laneRows(promotedRows, "document_attachment", "exemplar");
  const promotedEpisodicDocs = promotedRows.filter(
    (row) =>
      normalizeWhitespace(row?.metadata?.memoryLayer) === "episodic" &&
      normalizeWhitespace(row?.metadata?.signalFamily) === "document_attachment"
  );
  const genericContextPresent =
    analysisRows.some((row) => normalizeWhitespace(row?.metadata?.signalFamily) === "generic_context") ||
    promotedRows.some((row) => normalizeWhitespace(row?.metadata?.signalFamily) === "generic_context") ||
    droppedRows.some((row) => normalizeWhitespace(row.signalFamily) === "generic_context");
  const topDocPatternJunkCount = promotedDocPatterns.slice(0, 10).filter(hasGenericPatternContent).length;
  const analyzerMaxRssKb = analyzerMaxRssKbFromLog(pipelineLogPath);
  const badTimeAnchorCount = countBadTimeAnchors(analysisRows) + countBadTimeAnchors(promotedRows);
  const topicPairCorrelationCount = countTopicPairCorrelations(analysisRows) + countTopicPairCorrelations(promotedRows);
  const singleThreadDocPatternCount = countSingleThreadDocPatterns(analysisRows, "metadata");
  const semanticSingleThreadDocPatternCount = promotedRows.filter(
    (row) =>
      normalizeWhitespace(row?.metadata?.signalFamily) === "document_attachment" &&
      normalizeWhitespace(row?.metadata?.signalLane) === "pattern" &&
      Boolean(row?.metadata?.singleThreadPattern) &&
      normalizeWhitespace(row?.metadata?.memoryLayer) === "semantic"
  ).length;
  const threadSummaryUnknownParticipantCount = promotedRows.filter(
    (row) =>
      normalizeWhitespace(row?.metadata?.analysisType) === "thread_summary" &&
      normalizeWhitespace(row?.metadata?.memoryLayer) === "semantic" &&
      Number(row?.metadata?.participantCount || 0) < 1
  ).length;
  const promotedSemanticRows = promotedRows.filter((row) => normalizeWhitespace(row?.metadata?.memoryLayer) === "semantic");
  const promotedEpisodicRows = promotedRows.filter((row) => normalizeWhitespace(row?.metadata?.memoryLayer) === "episodic");
  const analyzedOnlyRows = analysisRows.filter((row) => {
    const id = normalizeWhitespace(row?.clientRequestId || "");
    return id && !promotedRows.some((candidate) => normalizeWhitespace(candidate?.clientRequestId || "") === id);
  });

  const report = {
    schema: "pst-signal-quality-report.v1",
    generatedAt: isoNow(),
    inputs: {
      analysisPath,
      promotedPath,
      droppedPath: droppedPath || null,
      promoteReportPath,
      manifestPath,
    },
    counts: {
      analysisRows: analysisRows.length,
      promotedRows: promotedRows.length,
      droppedRows: droppedRows.length,
      promotedDocumentAttachment: promotedRows.filter((row) => row?.metadata?.signalFamily === "document_attachment").length,
      promotedIdentityTime: promotedRows.filter((row) => row?.metadata?.signalFamily === "identity_time").length,
    },
    distributions: {
      analysisType: groupCount(analysisRows, (row) => row?.metadata?.analysisType),
      analysisFamily: groupCount(analysisRows, (row) => row?.metadata?.signalFamily),
      analysisLane: laneCounts(analysisRows, "metadata"),
      promotedType: groupCount(promotedRows, (row) => row?.metadata?.analysisType),
      promotedFamily: groupCount(promotedRows, (row) => row?.metadata?.signalFamily),
      promotedLane: laneCounts(promotedRows, "metadata"),
      droppedFamily: groupCount(droppedRows, (row) => row.signalFamily),
      droppedLane: laneCounts(droppedRows, "signalLane"),
      confidenceBands: groupCount(promotedRows, (row) => confidenceBand(row?.metadata?.confidence || 0)),
    },
    quotaFillRates: quotaFillRates(promotedRows, quotaPlan),
    metrics: {
      temporalSanityRate: temporalSanityRate(promotedRows),
      documentPromotionCount: promotedRows.filter((row) => row?.metadata?.signalFamily === "document_attachment").length,
      identityPromotionCount: promotedRows.filter((row) => row?.metadata?.signalFamily === "identity_time").length,
      allSemantic: promotedRows.every((row) => normalizeWhitespace(row?.metadata?.memoryLayer) === "semantic"),
      unknownAnalysisFamilyCount: analysisRows.filter((row) => normalizeWhitespace(row?.metadata?.signalFamily) === "unknown").length,
      episodicPromotionCount: promotedRows.filter((row) => normalizeWhitespace(row?.metadata?.memoryLayer) === "episodic").length,
      docPatternCount: promotedDocPatterns.length,
      docExemplarCount: promotedDocExemplars.length,
      episodicDocumentCount: promotedEpisodicDocs.length,
      genericContextPresent,
      topDocPatternJunkCount,
      analyzedThreadDecisionShare: familyShare(analysisRows, "thread_decision"),
      promotedThreadDecisionShare: familyShare(promotedRows, "thread_decision"),
      badTimeAnchorCount,
      topicPairCorrelationCount,
      singleThreadDocPatternCount,
      semanticSingleThreadDocPatternCount,
      documentEpisodicShortfall: Math.max(0, 5 - promotedEpisodicDocs.length),
      analyzerMaxRssKb,
      threadSummaryUnknownParticipantCount,
    },
    drift: {
      attritionByFamily: attritionByFamily(analysisRows, promotedRows, manifest.counts || {}),
      documentThresholdGapCount: droppedRows.filter(
        (row) => normalizeWhitespace(row.signalFamily) === "document_attachment" && normalizeWhitespace(row.reason) === "below_episodic_min_score"
      ).length,
      patternTooBroadCount: droppedRows.filter(
        (row) => normalizeWhitespace(row.signalFamily) === "document_attachment" && normalizeWhitespace(row.reason) === "pattern_too_broad"
      ).length,
      threadSubtypeDistribution: threadSubtypeDistribution(promotedRows),
      episodicByFamily: groupCount(
        promotedRows.filter((row) => normalizeWhitespace(row?.metadata?.memoryLayer) === "episodic"),
        (row) => row?.metadata?.signalFamily
      ),
    },
    promoteDecisionMatrix: promoteReport.decisionMatrix || {},
    promoteQuotaUsage: promoteReport.quotaUsage || {},
    manifestCounts: manifest.counts || {},
  };
  if (baselineReport) {
    report.baselineDelta = {
      promotedDocumentAttachment:
        report.counts.promotedDocumentAttachment - Number(baselineReport?.counts?.promotedDocumentAttachment || 0),
      promotedIdentityTime:
        report.counts.promotedIdentityTime - Number(baselineReport?.counts?.promotedIdentityTime || 0),
      episodicPromotionCount:
        report.metrics.episodicPromotionCount - Number(baselineReport?.metrics?.episodicPromotionCount || 0),
      analyzedThreadDecisionShare: Number(
        (
          report.metrics.analyzedThreadDecisionShare -
          Number(baselineReport?.metrics?.analyzedThreadDecisionShare || 0)
        ).toFixed(4)
      ),
      promotedThreadDecisionShare: Number(
        (
          report.metrics.promotedThreadDecisionShare -
          Number(baselineReport?.metrics?.promotedThreadDecisionShare || 0)
        ).toFixed(4)
      ),
    };
  }

  const productionChecks = [
    ["unknownAnalysisFamilyCount", report.metrics.unknownAnalysisFamilyCount === 0],
    ["noGenericContext", report.metrics.genericContextPresent === false],
    ["promotedDocumentAttachment", report.counts.promotedDocumentAttachment >= 20],
    ["docPatternCount", report.metrics.docPatternCount >= 12],
    ["docExemplarCount", report.metrics.docExemplarCount <= 8],
    ["episodicPromotionCount", report.metrics.episodicPromotionCount >= 10],
    ["episodicDocumentCount", report.metrics.episodicDocumentCount >= 5],
    ["analyzedThreadDecisionShare", report.metrics.analyzedThreadDecisionShare <= 0.35],
    ["promotedThreadDecisionShare", report.metrics.promotedThreadDecisionShare <= 0.4],
    ["promotedIdentityTime", report.counts.promotedIdentityTime >= 20],
    ["promotedRelationship", Number(report.distributions.promotedFamily.relationship || 0) >= 30],
    ["malformedRows", Number(report.manifestCounts.malformedRows || 0) === 0],
    ["deadLetterRows", Number(report.manifestCounts.deadLetterRows || 0) === 0],
    ["topDocPatternJunkCount", report.metrics.topDocPatternJunkCount === 0],
    ["badTimeAnchorCount", report.metrics.badTimeAnchorCount === 0],
    ["topicPairCorrelationCount", report.metrics.topicPairCorrelationCount === 0],
    ["semanticSingleThreadDocPatternCount", report.metrics.semanticSingleThreadDocPatternCount === 0],
    ["analyzerMaxRssKb", report.metrics.analyzerMaxRssKb === null || report.metrics.analyzerMaxRssKb <= 1500000],
    ["threadSummaryUnknownParticipantCount", report.metrics.threadSummaryUnknownParticipantCount === 0],
  ];
  const failedChecks = productionChecks.filter(([, passed]) => !passed).map(([name]) => name);
  const readiness = {
    schema: "pst-signal-production-gate.v1",
    generatedAt: report.generatedAt,
    passed: failedChecks.length === 0,
    failedChecks,
    checks: Object.fromEntries(productionChecks),
  };

  const byFamily = ["document_attachment", "identity_time", "relationship", "thread_decision", "generic_context"];
  const reviewLines = [
    "# PST Signal Quality Review Pack",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Analysis rows: ${report.counts.analysisRows}`,
    `- Promoted rows: ${report.counts.promotedRows}`,
    `- Dropped rows: ${report.counts.droppedRows}`,
    `- Temporal sanity rate: ${report.metrics.temporalSanityRate}`,
    `- Unknown analysis-family rows: ${report.metrics.unknownAnalysisFamilyCount}`,
    `- Episodic promoted rows: ${report.metrics.episodicPromotionCount}`,
    `- Production gate: ${readiness.passed ? "PASS" : `FAIL (${failedChecks.join(", ")})`}`,
    "",
  ];
  reviewLines.push(...buildReviewSection("Top promoted doc patterns", promotedDocPatterns, 10));
  reviewLines.push("");
  reviewLines.push(...buildReviewSection("Top promoted doc exemplars", promotedDocExemplars, 10));
  reviewLines.push("");
  reviewLines.push(
    ...buildReviewSection(
      "Top episodic promotions",
      promotedEpisodicRows,
      10
    )
  );
  reviewLines.push("");
  reviewLines.push(
    ...buildReviewSection(
      "Semantic single-thread doc patterns",
      promotedRows.filter(
        (row) =>
          normalizeWhitespace(row?.metadata?.signalFamily) === "document_attachment" &&
          normalizeWhitespace(row?.metadata?.signalLane) === "pattern" &&
          Boolean(row?.metadata?.singleThreadPattern) &&
          normalizeWhitespace(row?.metadata?.memoryLayer) === "semantic"
      ),
      10
    )
  );
  reviewLines.push("");
  reviewLines.push(
    ...buildReviewSection(
      "Semantic thread summaries with unknown participants",
      promotedRows.filter(
        (row) =>
          normalizeWhitespace(row?.metadata?.analysisType) === "thread_summary" &&
          normalizeWhitespace(row?.metadata?.memoryLayer) === "semantic" &&
          Number(row?.metadata?.participantCount || 0) < 1
      ),
      10
    )
  );
  reviewLines.push("");
  for (const family of byFamily) {
    reviewLines.push(`## Family: ${family}`);
    reviewLines.push(
      ...buildReviewSection(
        "Top promoted semantic",
        promotedSemanticRows.filter((row) => row?.metadata?.signalFamily === family),
        reviewLimit
      ).slice(1)
    );
    reviewLines.push(
      ...buildReviewSection(
        "Top promoted episodic",
        promotedEpisodicRows.filter((row) => row?.metadata?.signalFamily === family),
        Math.min(10, reviewLimit)
      ).slice(1)
    );
    reviewLines.push(
      ...buildReviewSection(
        "Top analyzed-only",
        analyzedOnlyRows.filter((row) => row?.metadata?.signalFamily === family),
        Math.min(10, reviewLimit)
      ).slice(1)
    );
    reviewLines.push(...buildReviewSection("Top rejected", droppedRows.filter((row) => normalizeWhitespace(row.signalFamily) === family), Math.min(10, reviewLimit)).slice(1));
    reviewLines.push("");
  }

  writeJson(join(outputDir, "report.json"), report);
  writeJson(join(outputDir, "production-readiness.json"), readiness);
  writeFileSync(join(outputDir, "review-pack.md"), `${reviewLines.join("\n")}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

try {
  run();
} catch (error) {
  process.stderr.write(`pst-signal-quality-eval failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
