#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clipText,
  ensureParentDir,
  isoNow,
  parseCliArgs,
  readBoolFlag,
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
      "Open Memory production audit sampler",
      "",
      "Usage:",
      "  node ./scripts/open-memory-production-audit.mjs \\",
      "    --wave-root ./output/memory/production-wave-2026-03-06b",
      "",
      "Options:",
      "  --wave-root <path>      Production wave root",
      "  --docs-root <path>      Docs run root (default: docs run discovered from wave catalog)",
      "  --seed <value>          Deterministic sample seed (default: 20260306)",
      "  --mode <single|aggregate|spot>  Audit mode (default: single)",
      "  --seed-count <n>        Aggregate seed count (default: 1)",
      "  --output-json <path>    JSON output path",
      "  --output-md <path>      Markdown output path",
      "  --json                  Print JSON output",
    ].join("\n")
  );
}

function text(value) {
  return String(value ?? "").trim();
}

function readJson(path, fallback = null) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function seededRng(seedInput) {
  let seed = 0;
  for (const char of text(seedInput)) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  if (seed === 0) seed = 0x6d2b79f5;
  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function chooseOne(values, rng) {
  if (!Array.isArray(values) || values.length === 0) return null;
  return values[Math.floor(rng() * values.length)];
}

function sourceRootFromManifest(manifestPath) {
  return text(manifestPath).replace(/\/canonical-corpus\/manifest\.json$/, "");
}

function promotedRows(path) {
  if (!existsSync(path)) return [];
  return readJsonlWithRaw(path)
    .filter((entry) => entry?.ok)
    .map((entry) => entry.value)
    .filter((row) => row?.metadata?.memoryLayer === "semantic");
}

function clip(value) {
  return clipText(text(value), 280);
}

function collectEvidenceIds(metadata) {
  const ids = new Set();
  if (metadata && typeof metadata === "object") {
    if (typeof metadata.sourceClientRequestId === "string" && metadata.sourceClientRequestId.trim()) {
      ids.add(metadata.sourceClientRequestId.trim());
    }
    if (Array.isArray(metadata.sourceClientRequestIds)) {
      for (const value of metadata.sourceClientRequestIds) {
        const normalized = text(value);
        if (normalized) ids.add(normalized);
      }
    }
  }
  return [...ids];
}

function driftAssessment(row) {
  const metadata = row?.metadata || {};
  const score = Number(metadata.score || 0);
  const richness = text(metadata.evidenceRichness || "unknown");
  const attribution = text(metadata.attributionStrength || "unknown");
  const generic = Boolean(metadata.genericAsset);
  const evidenceIds = collectEvidenceIds(metadata);
  let groundedness = "medium";
  let driftRisk = "medium";
  if (!generic && score >= 7 && evidenceIds.length > 0 && (richness === "high" || richness === "medium" || attribution === "strong" || attribution === "moderate")) {
    groundedness = "high";
    driftRisk = "low";
  } else if (generic || score < 5 || richness === "low" || evidenceIds.length === 0) {
    groundedness = "low";
    driftRisk = "high";
  }
  return { groundedness, driftRisk, evidenceIds };
}

function findingFromRow(row, sourceFamily, runRoot, population, seed) {
  const metadata = row?.metadata || {};
  const assessment = driftAssessment(row);
  return {
    sampleSeed: seed,
    population,
    sourceFamily,
    runRoot,
    recordId: text(row.id || row.clientRequestId),
    analysisType: text(metadata.analysisType || metadata.docSignalKind || metadata.twitterSignalFamily || "unknown"),
    source: text(row.source),
    occurredAt: row.occurredAt || metadata.occurredAt || null,
    evidenceIds: assessment.evidenceIds,
    attachmentName: metadata.attachmentName || null,
    path: metadata.path || null,
    tweetId: metadata.tweetId || null,
    snippet: clip(row.content),
    groundedness: assessment.groundedness,
    driftRisk: assessment.driftRisk,
    recommendation:
      assessment.driftRisk === "low"
        ? "Keep as representative evidence."
        : assessment.driftRisk === "medium"
          ? "Spot-check underlying source metadata before using as a summary anchor."
          : "Treat as suspicious and verify against the underlying source unit before relying on it.",
  };
}

function renderMarkdown(report) {
  const lines = [
    `# Production Audit ${report.waveId}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Seed: ${report.seed}`,
    `Mode: ${report.mode}`,
    "",
  ];

  if (report.summary) {
    lines.push("## Aggregate Summary");
    lines.push("");
    lines.push(`- Total findings: ${report.summary.totalFindings}`);
    lines.push(`- High drift findings: ${report.summary.highDriftFindings}`);
    lines.push(`- Mail high drift findings: ${report.summary.mailHighDriftFindings}`);
    lines.push(`- Mail message_insight high drift findings: ${report.summary.mailMessageInsightHighDriftFindings}`);
    lines.push(`- Mail contact_fact high drift findings: ${report.summary.mailContactFactHighDriftFindings}`);
    lines.push(`- Mail relationship_rhythm high drift findings: ${report.summary.mailRelationshipRhythmHighDriftFindings}`);
    lines.push(`- Twitter high drift findings: ${report.summary.twitterHighDriftFindings}`);
    lines.push(`- Docs high drift findings: ${report.summary.docsHighDriftFindings}`);
    lines.push("");
  }

  for (const finding of report.findings) {
    lines.push(`## ${finding.sourceFamily}: ${finding.analysisType}`);
    lines.push("");
    lines.push(`- Record: ${finding.recordId}`);
    lines.push(`- Population: ${finding.population}`);
    lines.push(`- Run root: ${finding.runRoot}`);
    lines.push(`- Groundedness: ${finding.groundedness}`);
    lines.push(`- Drift risk: ${finding.driftRisk}`);
    if (finding.occurredAt) lines.push(`- Occurred at: ${finding.occurredAt}`);
    if (finding.attachmentName) lines.push(`- Attachment: ${finding.attachmentName}`);
    if (finding.tweetId) lines.push(`- Tweet ID: ${finding.tweetId}`);
    if (finding.path) lines.push(`- Path: ${finding.path}`);
    if (finding.evidenceIds.length > 0) lines.push(`- Evidence IDs: ${finding.evidenceIds.join(", ")}`);
    lines.push(`- Snippet: ${finding.snippet}`);
    lines.push(`- Recommendation: ${finding.recommendation}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function buildSingleReport({ waveRoot, docsRoot, seed, catalog }) {
  const rng = seededRng(seed);
  const docsRows = promotedRows(resolve(docsRoot, "document-promoted-memory.jsonl")).filter((row) => {
    const type = text(row?.metadata?.docSignalKind || row?.metadata?.signalSubfamily || "");
    return type && type !== "timeline_anchor";
  });
  if (docsRows.length === 0) throw new Error("No eligible docs semantic rows found for audit");
  const docsFinding = findingFromRow(
    chooseOne(docsRows, rng),
    "docs",
    docsRoot,
    "docs semantic pool excluding timeline anchors",
    seed
  );

  const twitterRun = catalog.runs.find((run) => run.sourceFamily === "twitter");
  const mailRuns = catalog.runs.filter((run) => run.sourceFamily === "mail");
  const twitterRows = twitterRun ? promotedRows(resolve(sourceRootFromManifest(twitterRun.manifestPath), "twitter-promoted-memory.jsonl")) : [];
  const mailRows = mailRuns.flatMap((run) => {
    const root = sourceRootFromManifest(run.manifestPath);
    return promotedRows(resolve(root, "mail-promoted-memory.jsonl")).map((row) => ({ row, root }));
  });

  const families = [];
  if (mailRows.length > 0) families.push("mail");
  if (twitterRows.length > 0) families.push("twitter");
  if (families.length === 0) throw new Error("No eligible mail or twitter semantic rows found for control audit");
  const chosenFamily = chooseOne(families, rng);
  let controlFinding;
  if (chosenFamily === "mail") {
    const chosen = chooseOne(mailRows, rng);
    controlFinding = findingFromRow(chosen.row, "mail", chosen.root, "mail promoted semantic pool", seed);
  } else {
    const chosen = chooseOne(twitterRows, rng);
    controlFinding = findingFromRow(
      chosen,
      "twitter",
      twitterRun ? sourceRootFromManifest(twitterRun.manifestPath) : "",
      "twitter promoted semantic pool",
      seed
    );
  }

  return {
    schema: "open-memory-production-audit.v2",
    generatedAt: isoNow(),
    waveId: text(waveRoot).split("/").filter(Boolean).pop(),
    waveRoot,
    seed,
    mode: "single",
    findings: [docsFinding, controlFinding],
  };
}

function buildAggregateSummary(findings) {
  const summary = {
    totalFindings: findings.length,
    highDriftFindings: 0,
    mailHighDriftFindings: 0,
    mailMessageInsightHighDriftFindings: 0,
    mailContactFactHighDriftFindings: 0,
    mailRelationshipRhythmHighDriftFindings: 0,
    twitterHighDriftFindings: 0,
    docsHighDriftFindings: 0,
    bySourceFamily: {},
    byAnalysisType: {},
    byRunRoot: {},
  };

  for (const finding of findings) {
    const family = text(finding.sourceFamily || "unknown") || "unknown";
    const analysisType = text(finding.analysisType || "unknown") || "unknown";
    const runRoot = text(finding.runRoot || "unknown") || "unknown";
    const isHigh = text(finding.driftRisk) === "high";
    summary.bySourceFamily[family] = Number(summary.bySourceFamily[family] || 0) + (isHigh ? 1 : 0);
    summary.byAnalysisType[analysisType] = Number(summary.byAnalysisType[analysisType] || 0) + (isHigh ? 1 : 0);
    summary.byRunRoot[runRoot] = Number(summary.byRunRoot[runRoot] || 0) + (isHigh ? 1 : 0);
    if (!isHigh) continue;
    summary.highDriftFindings += 1;
    if (family === "mail") summary.mailHighDriftFindings += 1;
    if (family === "twitter") summary.twitterHighDriftFindings += 1;
    if (family === "docs") summary.docsHighDriftFindings += 1;
    if (family === "mail" && analysisType === "message_insight") {
      summary.mailMessageInsightHighDriftFindings += 1;
    }
    if (family === "mail" && analysisType === "contact_fact") {
      summary.mailContactFactHighDriftFindings += 1;
    }
    if (family === "mail" && analysisType === "relationship_rhythm") {
      summary.mailRelationshipRhythmHighDriftFindings += 1;
    }
  }

  summary.topRunRoots = Object.entries(summary.byRunRoot)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([runRoot, count]) => ({ runRoot, count }));

  return summary;
}

function buildSpotReport({ waveRoot, docsRoot, seed, catalog }) {
  const rng = seededRng(seed);
  const mailRuns = catalog.runs.filter((run) => run.sourceFamily === "mail");
  const relationshipRows = mailRuns.flatMap((run) => {
    const root = sourceRootFromManifest(run.manifestPath);
    return promotedRows(resolve(root, "mail-promoted-memory.jsonl"))
      .filter((row) => text(row?.metadata?.analysisType) === "relationship_rhythm")
      .map((row) => ({ row, root }));
  });
  if (relationshipRows.length === 0) throw new Error("No eligible mail relationship_rhythm semantic rows found for spot audit");

  const rankRisk = (value) => (value === "high" ? 2 : value === "medium" ? 1 : 0);
  const targeted = [...relationshipRows]
    .map(({ row, root }) => ({
      root,
      row,
      finding: findingFromRow(row, "mail", root, "targeted mail relationship_rhythm hotspot", seed),
    }))
    .sort((a, b) => {
      const riskDelta = rankRisk(b.finding.driftRisk) - rankRisk(a.finding.driftRisk);
      if (riskDelta !== 0) return riskDelta;
      const evidenceDelta = a.finding.evidenceIds.length - b.finding.evidenceIds.length;
      if (evidenceDelta !== 0) return evidenceDelta;
      return text(a.finding.recordId).localeCompare(text(b.finding.recordId));
    })[0];

  const docsRows = promotedRows(resolve(docsRoot, "document-promoted-memory.jsonl"))
    .filter((row) => text(row?.metadata?.docSignalKind || row?.metadata?.signalSubfamily) !== "timeline_anchor")
    .map((row) => ({ row, root: docsRoot, family: "docs", population: "docs semantic control pool" }));
  const twitterRun = catalog.runs.find((run) => run.sourceFamily === "twitter");
  const twitterRows = twitterRun
    ? promotedRows(resolve(sourceRootFromManifest(twitterRun.manifestPath), "twitter-promoted-memory.jsonl"))
      .map((row) => ({
        row,
        root: sourceRootFromManifest(twitterRun.manifestPath),
        family: "twitter",
        population: "twitter semantic control pool",
      }))
    : [];
  const mailControlRows = mailRuns.flatMap((run) => {
    const root = sourceRootFromManifest(run.manifestPath);
    return promotedRows(resolve(root, "mail-promoted-memory.jsonl"))
      .filter((row) => text(row?.metadata?.analysisType) !== "relationship_rhythm")
      .map((row) => ({
        row,
        root,
        family: "mail",
        population: "mail semantic control pool",
      }));
  }).filter((entry) => entry.root !== targeted.root);
  const controlPools = [
    { family: "mail", rows: mailControlRows },
    { family: "twitter", rows: twitterRows },
    { family: "docs", rows: docsRows },
  ].filter((entry) => entry.rows.length > 0);
  if (controlPools.length === 0) throw new Error("No eligible control rows found for spot audit");
  const chosenPool = chooseOne(controlPools, rng);
  const chosenControl = chooseOne(chosenPool.rows, rng);
  const control = findingFromRow(
    chosenControl.row,
    chosenControl.family,
    chosenControl.root,
    chosenControl.population,
    seed
  );

  return {
    schema: "open-memory-production-audit.v2",
    generatedAt: isoNow(),
    waveId: text(waveRoot).split("/").filter(Boolean).pop(),
    waveRoot,
    seed,
    mode: "spot",
    findings: [targeted.finding, control],
    summary: buildAggregateSummary([targeted.finding, control]),
  };
}

function buildAggregateReport({ waveRoot, docsRoot, seed, seedCount, catalog }) {
  const batches = [];
  const findings = [];
  const safeSeedCount = Math.max(1, seedCount);
  for (let index = 0; index < safeSeedCount; index += 1) {
    const batchSeed = safeSeedCount === 1 ? seed : `${seed}-${String(index).padStart(2, "0")}`;
    const batch = buildSingleReport({ waveRoot, docsRoot, seed: batchSeed, catalog });
    batches.push({ seed: batchSeed, findings: batch.findings });
    findings.push(...batch.findings);
  }
  return {
    schema: "open-memory-production-audit.v2",
    generatedAt: isoNow(),
    waveId: text(waveRoot).split("/").filter(Boolean).pop(),
    waveRoot,
    seed,
    mode: "aggregate",
    seedCount: safeSeedCount,
    findings,
    batches,
    summary: buildAggregateSummary(findings),
  };
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
  const docsRootFlag = readStringFlag(flags, "docs-root", "").trim();
  const seed = readStringFlag(flags, "seed", "20260306").trim();
  const mode = text(readStringFlag(flags, "mode", "single")).toLowerCase() || "single";
  const seedCount = readNumberFlag(flags, "seed-count", 1, { min: 1, max: 100 });
  const defaultJson =
    mode === "aggregate" ? "./expanded-audit.json" : mode === "spot" ? "./spot-audit.json" : "./production-audit.json";
  const defaultMd =
    mode === "aggregate" ? "./expanded-audit.md" : mode === "spot" ? "./spot-audit.md" : "./production-audit.md";
  const outputJson = resolve(waveRoot, readStringFlag(flags, "output-json", defaultJson));
  const outputMd = resolve(waveRoot, readStringFlag(flags, "output-md", defaultMd));
  const printJson = readBoolFlag(flags, "json", false);

  const catalog = readJson(resolve(waveRoot, "ingest-catalog.json"));
  if (!catalog || !Array.isArray(catalog.runs)) throw new Error("ingest-catalog.json missing or invalid");
  const docsRun = catalog.runs.find((run) => run.sourceFamily === "docs");
  const docsRoot = docsRootFlag
    ? resolve(REPO_ROOT, docsRootFlag)
    : docsRun
      ? sourceRootFromManifest(docsRun.manifestPath)
      : resolve(REPO_ROOT, `${waveRootFlag}/sources/docs`);

  const report =
    mode === "aggregate"
      ? buildAggregateReport({ waveRoot, docsRoot, seed, seedCount, catalog })
      : mode === "spot"
        ? buildSpotReport({ waveRoot, docsRoot, seed, catalog })
        : buildSingleReport({ waveRoot, docsRoot, seed, catalog });

  ensureParentDir(outputJson);
  writeJson(outputJson, report);
  ensureParentDir(outputMd);
  writeFileSync(outputMd, renderMarkdown(report), "utf8");

  if (printJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write("open-memory-production-audit complete\n");
}

try {
  main();
} catch (error) {
  process.stderr.write(`open-memory-production-audit failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
