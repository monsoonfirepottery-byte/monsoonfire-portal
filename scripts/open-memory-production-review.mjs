#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureParentDir,
  isoNow,
  parseCliArgs,
  readBoolFlag,
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
      "Open Memory production wave review pack builder",
      "",
      "Usage:",
      "  node ./scripts/open-memory-production-review.mjs \\",
      "    --wave-root ./output/memory/production-wave-2026-03-06b",
      "",
      "Options:",
      "  --wave-root <path>      Production wave root",
      "  --output-json <path>    Review JSON output (default: <wave-root>/production-review.json)",
      "  --output-md <path>      Review Markdown output (default: <wave-root>/production-review.md)",
      "  --mail-sample <n>       Number of representative mail runs to include (default: 8)",
      "  --json                  Print review JSON",
    ].join("\n")
  );
}

function readJsonFile(path, fallback = null) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function inferWaveId(waveRoot) {
  return normalizeText(waveRoot).split("/").filter(Boolean).pop() || "production-wave";
}

function inferSourceRoot(manifestPath) {
  const normalized = normalizeText(manifestPath);
  const marker = "/canonical-corpus/manifest.json";
  const index = normalized.indexOf(marker);
  return index >= 0 ? normalized.slice(0, index) : dirname(normalized);
}

function derivePstGatePath(manifestPath) {
  const sourceRoot = inferSourceRoot(manifestPath);
  return resolve(sourceRoot, "signal-quality/production-readiness.json");
}

function derivePstReviewPackPath(manifestPath) {
  const sourceRoot = inferSourceRoot(manifestPath);
  return resolve(sourceRoot, "signal-quality/review-pack.md");
}

function deriveMailReportPath(manifestPath) {
  return resolve(inferSourceRoot(manifestPath), "mail-corpus-export-report.json");
}

function deriveTwitterReportPaths(manifestPath) {
  const sourceRoot = inferSourceRoot(manifestPath);
  return {
    exportReportPath: resolve(sourceRoot, "twitter-corpus-export-report.json"),
    analysisReportPath: resolve(sourceRoot, "twitter-analysis-report.json"),
    promoteReportPath: resolve(sourceRoot, "twitter-promote-report.json"),
  };
}

function deriveDocsReportPaths(manifestPath) {
  const sourceRoot = inferSourceRoot(manifestPath);
  return {
    exportReportPath: resolve(sourceRoot, "document-corpus-export-report.json"),
    normalizeReportPath: resolve(sourceRoot, "document-normalize-report.json"),
    analysisReportPath: resolve(sourceRoot, "document-analysis-report.json"),
    promoteReportPath: resolve(sourceRoot, "document-promote-report.json"),
  };
}

function summarizeMailRun(run) {
  const manifest = readJsonFile(run.manifestPath, {});
  const report = readJsonFile(deriveMailReportPath(run.manifestPath), {});
  const sourceUnitCount = Number(manifest?.counts?.sourceUnits || 0);
  const factEvents = Number(manifest?.counts?.factEvents || 0);
  const hypotheses = Number(manifest?.counts?.hypotheses || 0);
  return {
    runId: run.runId,
    manifestPath: run.manifestPath,
    sqlitePath: run.sqlitePath,
    sourceUnitCount,
    factEvents,
    hypotheses,
    factDensity: sourceUnitCount > 0 ? Number((factEvents / sourceUnitCount).toFixed(4)) : 0,
    hypothesisDensity: sourceUnitCount > 0 ? Number((hypotheses / sourceUnitCount).toFixed(4)) : 0,
    sqliteStatus: normalizeText(report?.sqliteStatus) || "unknown",
  };
}

function canonicalMailRunLabel(runId) {
  return normalizeText(runId)
    .replace(/^mail-production-wave-\d{4}-\d{2}-\d{2}[a-z]-/, "")
    .replace(/^\d{4}-/, "")
    .replace(/^inbox-import-inbox-/, "inbox-")
    .replace(/^inbox-import-/, "inbox-")
    .trim();
}

function detectMirroredMailRuns(mailRuns) {
  const groups = new Map();
  for (const run of mailRuns) {
    const label = canonicalMailRunLabel(run.runId);
    const existing = groups.get(label) || [];
    existing.push(run);
    groups.set(label, existing);
  }
  return [...groups.entries()]
    .map(([label, runs]) => ({
      label,
      runIds: runs.map((run) => run.runId),
      runs,
    }))
    .filter((entry) => entry.runs.length > 1 && entry.runIds.some((id) => id.includes("-inbox-import-")))
    .sort((a, b) => b.runs.length - a.runs.length || a.label.localeCompare(b.label));
}

function buildMarkdown(review) {
  const lines = [
    `# Production Review ${review.waveId}`,
    "",
    `Generated: ${review.generatedAt}`,
    "",
    "## Coverage",
    "",
    `- PST runs: ${review.coverage.pstRuns}`,
    `- Mail runs: ${review.coverage.mailRuns}`,
    `- Twitter runs: ${review.coverage.twitterRuns}`,
    `- Docs runs: ${review.coverage.docsRuns}`,
    `- Total runs: ${review.coverage.totalRuns}`,
    "",
    "## Source Summaries",
    "",
  ];

  for (const source of review.sourceSummaries) {
    lines.push(`### ${source.sourceFamily}`);
    lines.push("");
    lines.push(`- Status: ${source.status}`);
    if (source.runCount != null) lines.push(`- Run count: ${source.runCount}`);
    if (source.summary) lines.push(`- Summary: ${source.summary}`);
    if (Array.isArray(source.strengths) && source.strengths.length > 0) lines.push(`- Strengths: ${source.strengths.join("; ")}`);
    if (Array.isArray(source.weakSpots) && source.weakSpots.length > 0) lines.push(`- Weak spots: ${source.weakSpots.join("; ")}`);
    if (Array.isArray(source.keyArtifacts) && source.keyArtifacts.length > 0) {
      lines.push("- Key artifacts:");
      for (const artifact of source.keyArtifacts) lines.push(`  - ${artifact}`);
    }
    if (source.sourceFamily === "mail" && Array.isArray(source.representativeRuns) && source.representativeRuns.length > 0) {
      lines.push("- Representative mail runs:");
      for (const run of source.representativeRuns) {
        lines.push(
          `  - ${run.runId}: ${run.sourceUnitCount} source units, ${run.factEvents} facts, ${run.hypotheses} hypotheses, sqlite=${run.sqliteStatus}`
        );
      }
    }
    if (source.sourceFamily === "mail" && Array.isArray(source.densestRuns) && source.densestRuns.length > 0) {
      lines.push("- Highest fact-density mail runs:");
      for (const run of source.densestRuns) {
        lines.push(`  - ${run.runId}: fact-density=${run.factDensity}, facts=${run.factEvents}, sourceUnits=${run.sourceUnitCount}`);
      }
    }
    if (source.sourceFamily === "mail" && Array.isArray(source.mirroredRuns) && source.mirroredRuns.length > 0) {
      lines.push("- Mirrored mail folders:");
      for (const entry of source.mirroredRuns) {
        lines.push(`  - ${entry.label}: ${entry.runIds.join(" | ")}`);
      }
    }
    lines.push("");
  }

  lines.push("## Recommended Next Work");
  lines.push("");
  for (const item of review.recommendedNextWork) lines.push(`- ${item}`);

  return `${lines.join("\n")}\n`;
}

function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const waveRootFlag = readStringFlag(flags, "wave-root", "").trim();
  if (!waveRootFlag) throw new Error("--wave-root is required");

  const waveRoot = resolve(REPO_ROOT, waveRootFlag);
  const waveId = inferWaveId(waveRoot);
  const outputJsonPath = resolve(waveRoot, readStringFlag(flags, "output-json", "./production-review.json"));
  const outputMdPath = resolve(waveRoot, readStringFlag(flags, "output-md", "./production-review.md"));
  const mailSample = readNumberFlag(flags, "mail-sample", 8, { min: 1, max: 50 });
  const printJson = readBoolFlag(flags, "json", false);

  const catalog = readJsonFile(resolve(waveRoot, "ingest-catalog.json"));
  const waveSummary = readJsonFile(resolve(waveRoot, "wave-summary.json"));
  if (!catalog || !Array.isArray(catalog.runs)) throw new Error(`ingest-catalog.json missing or invalid at ${waveRoot}`);
  if (!waveSummary || typeof waveSummary !== "object") throw new Error(`wave-summary.json missing or invalid at ${waveRoot}`);

  const runsByFamily = catalog.runs.reduce((acc, run) => {
    const key = normalizeText(run.sourceFamily) || "unknown";
    if (!acc[key]) acc[key] = [];
    acc[key].push(run);
    return acc;
  }, {});

  const pstRun = (runsByFamily.pst || [])[0];
  const twitterRun = (runsByFamily.twitter || [])[0];
  const docsRun = (runsByFamily.docs || [])[0];
  const mailRuns = runsByFamily.mail || [];

  const pstGate = pstRun ? readJsonFile(derivePstGatePath(pstRun.manifestPath), {}) : {};
  const pstReviewPackPath = pstRun ? derivePstReviewPackPath(pstRun.manifestPath) : null;
  const twitterPaths = twitterRun ? deriveTwitterReportPaths(twitterRun.manifestPath) : {};
  const twitterPromoteReport = twitterRun ? readJsonFile(twitterPaths.promoteReportPath, {}) : {};
  const twitterExportReport = twitterRun ? readJsonFile(twitterPaths.exportReportPath, {}) : {};
  const docsPaths = docsRun ? deriveDocsReportPaths(docsRun.manifestPath) : {};
  const docsNormalizeReport = docsRun ? readJsonFile(docsPaths.normalizeReportPath, {}) : {};
  const docsExportReport = docsRun ? readJsonFile(docsPaths.exportReportPath, {}) : {};
  const docsAnalysisReport = docsRun ? readJsonFile(docsPaths.analysisReportPath, {}) : {};
  const docsPromoteReport = docsRun ? readJsonFile(docsPaths.promoteReportPath, {}) : {};

  const representativeMailRuns = mailRuns
    .map(summarizeMailRun)
    .sort((a, b) => b.sourceUnitCount - a.sourceUnitCount || b.factEvents - a.factEvents)
    .slice(0, mailSample);
  const densestMailRuns = mailRuns
    .map(summarizeMailRun)
    .filter((run) => run.sourceUnitCount >= 25)
    .sort((a, b) => b.factDensity - a.factDensity || b.factEvents - a.factEvents)
    .slice(0, mailSample);
  const mirroredMailRuns = detectMirroredMailRuns(mailRuns).slice(0, mailSample);

  const review = {
    schema: "open-memory-production-review.v1",
    generatedAt: isoNow(),
    waveId,
    waveRoot,
    catalogPath: resolve(waveRoot, "ingest-catalog.json"),
    summaryPath: resolve(waveRoot, "wave-summary.json"),
    coverage: {
      totalRuns: Number(catalog.runCount || catalog.runs.length || 0),
      pstRuns: (runsByFamily.pst || []).length,
      mailRuns: mailRuns.length,
      twitterRuns: (runsByFamily.twitter || []).length,
      docsRuns: (runsByFamily.docs || []).length,
    },
    sourceSummaries: [
      {
        sourceFamily: "pst",
        status: normalizeText(pstGate?.passed ? "production-passing baseline" : "baseline missing gate"),
        runCount: (runsByFamily.pst || []).length,
        summary: pstRun ? "Pinned production baseline for high-signal timeline, identity, and relationship modeling." : "PST baseline missing from catalog.",
        strengths: pstRun
          ? [
              "Production gate already passed.",
              "Strong identity and relationship signal coverage.",
              "Current operational reference for corpus quality.",
            ]
          : [],
        weakSpots: pstRun ? ["Cross-context semantic document recovery remains the main known quality gap."] : ["No PST baseline run found."],
        keyArtifacts: [pstRun?.manifestPath, pstRun?.sqlitePath, pstReviewPackPath].filter(Boolean),
      },
      {
        sourceFamily: "mail",
        status: `${waveSummary?.summary?.mailFoldersCompleted || 0}/${waveSummary?.summary?.mailFoldersQueued || 0} completed`,
        runCount: mailRuns.length,
        summary: "Breadth-first Outlook production sweep across unread/non-empty folders with per-folder canonical corpora.",
        strengths: [
          "Full folder sweep completed successfully after sparse-folder recovery.",
          "Good provenance and per-folder isolation.",
          "Attachments, headers, routing, and contact metadata flow through the lane.",
        ],
        weakSpots: [
          "Reviewing 87 successful runs manually is noisy without a higher-level review surface.",
          "Signal quality is fragmented across many small folder-level corpora.",
          "Mirrored /Inbox/import/... folders make some high-signal slices appear twice until reviewed at a higher level.",
        ],
        keyArtifacts: [resolve(waveRoot, "sources/mail"), resolve(waveRoot, "wave-summary.json")],
        representativeRuns: representativeMailRuns,
        densestRuns: densestMailRuns,
        mirroredRuns: mirroredMailRuns,
      },
      {
        sourceFamily: "twitter",
        status: normalizeText(twitterExportReport?.sqliteStatus) === "ok" ? "completed with sqlite" : "completed",
        runCount: (runsByFamily.twitter || []).length,
        summary: "Twitter production lane is operational and now preserves public, affinity, DM relationship, conversation, and identity signal families.",
        strengths: [
          `Promoted ${Number(twitterPromoteReport?.counts?.promotedRows || 0)} rows from ${Number(twitterPromoteReport?.counts?.inputRows || 0)} analyzed rows.`,
          "Clean runtime completion and SQLite materialization.",
          "DM readability and retweet recovery are materially better than earlier canaries.",
        ],
        weakSpots: [
          "Still needs a dedicated operator-facing review pack for deeper source-level inspection.",
          "Affinity and retweet weighting may still benefit from later quality tuning.",
        ],
        keyArtifacts: [twitterRun?.manifestPath, twitterRun?.sqlitePath, twitterPaths.promoteReportPath].filter(Boolean),
      },
      {
        sourceFamily: "docs",
        status: normalizeText(docsExportReport?.sqliteStatus) === "ok" ? "completed with sqlite" : "completed",
        runCount: (runsByFamily.docs || []).length,
        summary:
          Number(docsNormalizeReport?.totals?.rows || 0) >= 500
            ? "Current docs lane is operational on a production-scale curated manifest, but it still needs stronger semantic breadth before it matches mail or PST depth."
            : "Current docs lane is operational on a curated starter manifest, but it still needs more breadth before it becomes a production-deep corpus.",
        strengths: [
          "Standalone docs metadata ingestion works end to end.",
          "The manifest-driven posture is already compatible with the current normalizer.",
          Number(docsNormalizeReport?.totals?.rows || 0) >= 500
            ? `The current curated production manifest contains ${Number(docsNormalizeReport?.totals?.rows || 0)} rows.`
            : `The current curated starter manifest contains ${Number(docsNormalizeReport?.totals?.rows || 0)} rows.`,
          `Docs-native analysis promoted ${Number(docsPromoteReport?.counts?.promotedRows || 0)} rows from ${Number(docsAnalysisReport?.counts?.analyzedRows || 0)} analyzed rows.`,
        ],
        weakSpots: [
          Number(docsNormalizeReport?.totals?.rows || 0) >= 500
            ? "The docs lane is materially stronger now, but still under-indexes relationship and identity artifacts relative to workstream artifacts."
            : "The docs lane is still narrower than mail, PST, or Twitter and needs another expansion pass.",
          Number(docsNormalizeReport?.totals?.rows || 0) >= 500
            ? "Cross-source review still needs a stronger docs-aware synthesis layer so the larger manifest translates into easier operator insight."
            : "The current starter set is useful, but not yet broad enough to represent the full document corpus.",
        ],
        keyArtifacts: [docsRun?.manifestPath, docsRun?.sqlitePath, docsPaths.normalizeReportPath, docsPaths.promoteReportPath].filter(Boolean),
      },
    ],
    weakSpots: [
      "Docs now have a real starter manifest, but they still need another expansion pass to reach production depth.",
      "Mail needs a higher-level review surface over its 87 folder corpora, especially for high-density folders and mirrored import paths.",
      "Cross-source comparisons are now easier, but they still summarize separate corpora rather than a merged cross-source store.",
    ],
    recommendedNextWork: [
      Number(docsNormalizeReport?.totals?.rows || 0) >= 500
        ? `Use the ${Number(docsNormalizeReport?.totals?.rows || 0)}-row docs manifest as the new baseline and deepen its relationship/identity coverage before more breadth-first ingest.`
        : `Expand docs from the current ${Number(docsNormalizeReport?.totals?.rows || 0)}-row starter manifest to a broader curated production manifest.`,
      "Use this review pack and the wave catalog as the default operator entrypoint before any new ingest breadth.",
      "Use the mail density and mirrored-folder slices before planning any broader mail ingest changes.",
      "Add deeper cross-source review slices only after the docs manifest becomes production-real.",
    ],
  };

  ensureParentDir(outputJsonPath);
  writeJson(outputJsonPath, review);
  writeFileSync(outputMdPath, buildMarkdown(review), "utf8");

  if (printJson) {
    process.stdout.write(`${JSON.stringify(review, null, 2)}\n`);
    return;
  }

  process.stdout.write(`production review written\njson: ${outputJsonPath}\nmarkdown: ${outputMdPath}\n`);
}

main();
