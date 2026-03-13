#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCliArgs, readBoolFlag, readNumberFlag, readStringFlag } from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "Open Memory production wave query helper",
      "",
      "Usage:",
      "  node ./scripts/open-memory-production-query.mjs \\",
      "    --wave-root ./output/memory/production-wave-2026-03-06b \\",
      "    --mode summary",
      "",
      "Options:",
      "  --wave-root <path>      Production wave root",
      "  --mode <value>          summary | cross-source | micah | runs | source | mail (default: summary)",
      "  --micah-root <path>     Micah bundle root relative to wave root (default: ./micah)",
      "  --source <family>       Source family for mode=source",
      "  --limit <n>             Limit for run listings (default: 10)",
      "  --json                  Print JSON",
    ].join("\n")
  );
}

function readJson(path) {
  if (!existsSync(path)) throw new Error(`missing file: ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function groupRuns(runs) {
  return runs.reduce((acc, run) => {
    const key = String(run.sourceFamily || "unknown");
    if (!acc[key]) acc[key] = [];
    acc[key].push(run);
    return acc;
  }, {});
}

function toSummary({ waveRoot, waveSummary, review, catalog, crossSource }) {
  const grouped = groupRuns(catalog.runs || []);
  return {
    waveRoot,
    waveId: waveSummary.waveId,
    state: waveSummary.state,
    counts: {
      totalRuns: catalog.runCount || catalog.runs.length,
      pst: (grouped.pst || []).length,
      mail: (grouped.mail || []).length,
      twitter: (grouped.twitter || []).length,
      docs: (grouped.docs || []).length,
    },
    mailOutcome: waveSummary.summary,
    weakSpots: review.weakSpots || [],
    recommendedNextWork: review.recommendedNextWork || [],
    crossSource: crossSource ? {
      people: Array.isArray(crossSource.people) ? crossSource.people.slice(0, 5) : [],
      organizations: Array.isArray(crossSource.organizations) ? crossSource.organizations.slice(0, 5) : [],
      workstreams: Array.isArray(crossSource.workstreams) ? crossSource.workstreams.slice(0, 5) : [],
      eras: Array.isArray(crossSource.eras) ? crossSource.eras.slice(0, 5) : [],
    } : null,
  };
}

function toCrossSourceSummary(crossSource) {
  return {
    coverage: crossSource.coverage || {},
    people: crossSource.people || [],
    organizations: crossSource.organizations || [],
    workstreams: crossSource.workstreams || [],
    eras: crossSource.eras || [],
  };
}

function toMailSummary(review) {
  const mail = (review.sourceSummaries || []).find((entry) => String(entry.sourceFamily) === "mail") || {};
  return {
    status: mail.status || "unknown",
    weakSpots: mail.weakSpots || [],
    representativeRuns: mail.representativeRuns || [],
    densestRuns: mail.densestRuns || [],
    mirroredRuns: mail.mirroredRuns || [],
  };
}

function toMicahSummary(bundle, report) {
  return {
    summary: bundle.summary || {},
    bundleVersion: bundle.bundleVersion || 'v1',
    stableProfile: bundle.stableProfile || [],
    relationshipChannels: bundle.relationshipChannels || [],
    organizationWorkstreams: bundle.organizationWorkstreams || [],
    eraAnchors: bundle.eraAnchors || [],
    openLoops: bundle.openLoops || [],
    warnings: report?.warnings || [],
    reviewPath: report?.reviewMd || null,
    importLedgerPath: report?.importLedgerPath || null,
    importStatus: report?.importStatus || null,
  };
}

function renderText(mode, payload) {
  if (mode === "summary") {
    return [
      `Wave: ${payload.waveId}`,
      `State: ${payload.state}`,
      `Runs: total=${payload.counts.totalRuns} pst=${payload.counts.pst} mail=${payload.counts.mail} twitter=${payload.counts.twitter} docs=${payload.counts.docs}`,
      `Mail: queued=${payload.mailOutcome.mailFoldersQueued} completed=${payload.mailOutcome.mailFoldersCompleted} failed=${payload.mailOutcome.mailFoldersFailed}`,
      `Weak spots: ${(payload.weakSpots || []).join("; ")}`,
      `Next work: ${(payload.recommendedNextWork || []).join("; ")}`,
      ...(payload.crossSource ? [
        `Top people: ${(payload.crossSource.people || []).map((item) => item.label).join(", ")}`,
        `Top orgs: ${(payload.crossSource.organizations || []).map((item) => item.label).join(", ")}`,
        `Top workstreams: ${(payload.crossSource.workstreams || []).map((item) => item.label).join(", ")}`,
      ] : []),
    ].join("\n");
  }
  if (mode === "cross-source") {
    return [
      `People:`,
      ...(payload.people || []).map((item) => `- ${item.label}: ${item.count} (${(item.sourceFamilies || []).join(", ")})`),
      `Organizations:`,
      ...(payload.organizations || []).map((item) => `- ${item.label}: ${item.count} (${(item.sourceFamilies || []).join(", ")})`),
      `Workstreams:`,
      ...(payload.workstreams || []).map((item) => `- ${item.label}: ${item.count} (${(item.sourceFamilies || []).join(", ")})`),
      `Eras:`,
      ...(payload.eras || []).map((item) => `- ${item.label}: ${item.count} (${(item.sourceFamilies || []).join(", ")})`),
    ].join("\n");
  }
  if (mode === "runs") {
    return payload
      .map((run) => `${run.sourceFamily} ${run.runId} :: ${run.status} :: ${run.manifestPath}`)
      .join("\n");
  }
  if (mode === "mail") {
    return [
      `Mail status: ${payload.status}`,
      `Weak spots: ${(payload.weakSpots || []).join("; ")}`,
      "Representative runs:",
      ...(payload.representativeRuns || []).map((run) => `- ${run.runId}: units=${run.sourceUnitCount} facts=${run.factEvents} hyps=${run.hypotheses}`),
      "Highest fact-density runs:",
      ...(payload.densestRuns || []).map((run) => `- ${run.runId}: density=${run.factDensity} facts=${run.factEvents} units=${run.sourceUnitCount}`),
      "Mirrored folders:",
      ...(payload.mirroredRuns || []).map((entry) => `- ${entry.label}: ${entry.runIds.join(" | ")}`),
    ].join("\n");
  }
  if (mode === 'micah') {
    return [
      `Micah candidate count: ${payload.summary.totalCandidates}`,
      `Bundle version: ${payload.bundleVersion}`,
      `Stable profile: ${payload.summary.stableProfile}`,
      `Relationship channels: ${payload.summary.relationshipChannels}`,
      `Organizations/workstreams: ${payload.summary.organizationWorkstreams}`,
      `Era anchors: ${payload.summary.eraAnchors}`,
      `Open loops: ${payload.summary.openLoops}`,
      `Warnings: ${(payload.warnings || []).join('; ') || 'none'}`,
      `Import status: ${payload.importStatus || 'not staged'}`,
      'Top stable profile:',
      ...(payload.stableProfile || []).slice(0, 5).map((item) => `- ${item.statement}`),
      'Top relationship channels:',
      ...(payload.relationshipChannels || []).slice(0, 5).map((item) => `- ${item.statement}`),
      'Top open loops:',
      ...(payload.openLoops || []).slice(0, 5).map((item) => `- ${item.statement}`),
    ].join('\n');
  }
  return payload
    .map((run) => `${run.runId} :: ${run.status} :: ${run.manifestPath}`)
    .join("\n");
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
  const mode = readStringFlag(flags, "mode", "summary").trim() || "summary";
  const source = readStringFlag(flags, "source", "").trim();
  const limit = readNumberFlag(flags, "limit", 10, { min: 1, max: 500 });
  const printJson = readBoolFlag(flags, "json", false);
  const micahRootFlag = readStringFlag(flags, 'micah-root', './micah').trim() || './micah';

  const waveSummary = readJson(resolve(waveRoot, "wave-summary.json"));
  const review = readJson(resolve(waveRoot, "production-review.json"));
  const catalog = readJson(resolve(waveRoot, "ingest-catalog.json"));
  const crossSourcePath = resolve(waveRoot, "cross-source-review.json");
  const crossSource = existsSync(crossSourcePath) ? readJson(crossSourcePath) : null;
  const micahBundlePath = resolve(waveRoot, micahRootFlag, 'micah-memory-bundle.json');
  const micahReportPath = resolve(waveRoot, micahRootFlag, 'micah-import-report.json');
  const micahLedgerPath = resolve(waveRoot, micahRootFlag, 'micah-import-ledger.json');
  const micahBundle = existsSync(micahBundlePath) ? readJson(micahBundlePath) : null;
  const micahReport = existsSync(micahReportPath) ? readJson(micahReportPath) : null;
  const micahLedger = existsSync(micahLedgerPath) ? readJson(micahLedgerPath) : null;

  let payload;
  if (mode === "summary") {
    payload = toSummary({ waveRoot, waveSummary, review, catalog, crossSource });
  } else if (mode === "cross-source") {
    if (!crossSource) throw new Error(`missing file: ${crossSourcePath}`);
    payload = toCrossSourceSummary(crossSource);
  } else if (mode === "mail") {
    payload = toMailSummary(review);
  } else if (mode === 'micah') {
    if (!micahBundle) throw new Error(`missing file: ${micahBundlePath}`);
    payload = toMicahSummary(micahBundle, {
      ...(micahReport || {}),
      importLedgerPath: existsSync(micahLedgerPath) ? micahLedgerPath : null,
      importStatus: micahLedger ? `imported=${micahLedger.imported} alreadyProposed=${micahLedger.alreadyProposed} alreadyAccepted=${micahLedger.alreadyAccepted}` : null,
    });
  } else if (mode === "runs") {
    payload = (catalog.runs || []).slice(0, limit);
  } else if (mode === "source") {
    if (!source) throw new Error("--source is required for --mode source");
    payload = (catalog.runs || []).filter((run) => String(run.sourceFamily) === source).slice(0, limit);
  } else {
    throw new Error(`unsupported mode: ${mode}`);
  }

  if (printJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${renderText(mode, payload)}\n`);
}

main();
