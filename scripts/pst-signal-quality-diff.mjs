#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCliArgs, readJson, readStringFlag, writeJson } from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "PST signal-quality diff helper",
      "",
      "Usage:",
      "  node ./scripts/pst-signal-quality-diff.mjs --target ./output/memory/<run>/signal-quality/report.json",
      "",
      "Options:",
      "  --baseline-config <path>  Baseline config (default: ./config/pst-signal-quality-baseline.json)",
      "  --baseline-report <path>  Override baseline report path",
      "  --target <path>           Target signal-quality report",
      "  --output <path>           Optional JSON output path",
    ].join("\n")
  );
}

function metricPair(baseline, target, key) {
  return {
    baseline: baseline?.[key] ?? null,
    target: target?.[key] ?? null,
    delta:
      Number.isFinite(Number(target?.[key])) && Number.isFinite(Number(baseline?.[key]))
        ? Number((Number(target[key]) - Number(baseline[key])).toFixed(4))
        : null,
  };
}

function familyCount(report, family) {
  return Number(report?.distributions?.promotedFamily?.[family] || 0);
}

function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (flags.help || flags.h) {
    usage();
    return;
  }

  const baselineConfigPath = resolve(REPO_ROOT, readStringFlag(flags, "baseline-config", "./config/pst-signal-quality-baseline.json"));
  const baselineConfig = readJson(baselineConfigPath, {});
  const baselineReportPath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "baseline-report", baselineConfig.reportPath || "")
  );
  const targetReportPath = resolve(REPO_ROOT, readStringFlag(flags, "target", ""));
  const outputPath = readStringFlag(flags, "output", "").trim();

  if (!targetReportPath) {
    throw new Error("--target is required");
  }

  const baseline = readJson(baselineReportPath, {});
  const target = readJson(targetReportPath, {});

  const diff = {
    schema: "pst-signal-quality-diff.v1",
    baselineRunId: baselineConfig.runId || "unknown",
    baselineReportPath,
    targetReportPath,
    checks: {
      baselinePassed: readJson(resolve(REPO_ROOT, baselineConfig.productionReadinessPath || ""), {}).passed ?? null,
    },
    counts: {
      promotedRows: metricPair(baseline?.counts, target?.counts, "promotedRows"),
      promotedDocumentAttachment: metricPair(baseline?.counts, target?.counts, "promotedDocumentAttachment"),
      promotedIdentityTime: metricPair(baseline?.counts, target?.counts, "promotedIdentityTime"),
      promotedRelationship: {
        baseline: familyCount(baseline, "relationship"),
        target: familyCount(target, "relationship"),
        delta: familyCount(target, "relationship") - familyCount(baseline, "relationship"),
      },
      promotedThreadDecision: {
        baseline: familyCount(baseline, "thread_decision"),
        target: familyCount(target, "thread_decision"),
        delta: familyCount(target, "thread_decision") - familyCount(baseline, "thread_decision"),
      },
    },
    metrics: {
      analyzerMaxRssKb: metricPair(baseline?.metrics, target?.metrics, "analyzerMaxRssKb"),
      temporalSanityRate: metricPair(baseline?.metrics, target?.metrics, "temporalSanityRate"),
      topDocPatternJunkCount: metricPair(baseline?.metrics, target?.metrics, "topDocPatternJunkCount"),
      badTimeAnchorCount: metricPair(baseline?.metrics, target?.metrics, "badTimeAnchorCount"),
      topicPairCorrelationCount: metricPair(baseline?.metrics, target?.metrics, "topicPairCorrelationCount"),
      semanticSingleThreadDocPatternCount: metricPair(baseline?.metrics, target?.metrics, "semanticSingleThreadDocPatternCount"),
      threadSummaryUnknownParticipantCount: metricPair(baseline?.metrics, target?.metrics, "threadSummaryUnknownParticipantCount"),
    },
  };

  if (outputPath) {
    writeJson(resolve(REPO_ROOT, outputPath), diff);
  }
  process.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`pst-signal-quality-diff failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
