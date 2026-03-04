#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isoNow,
  parseCliArgs,
  readBoolFlag,
  readJson,
  readNumberFlag,
  readStringFlag,
  writeJson,
} from "./lib/pst-memory-utils.mjs";
import { buildRelationshipMonitoringArtifact } from "./lib/pst-memory-continuity.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const defaultQualityPath = resolve(REPO_ROOT, "./output/memory/relationship-quality/latest.json");
const defaultContinuityPath = resolve(REPO_ROOT, "./output/memory/continuity/latest.json");
const defaultOutPath = resolve(REPO_ROOT, "./output/memory/relationship-quality/dashboard-latest.json");

function usage() {
  process.stdout.write(
    [
      "PST memory relationship dashboard",
      "",
      "Usage:",
      "  node ./scripts/pst-memory-relationship-dashboard.mjs --json",
      "",
      "Options:",
      "  --quality <path>                     Relationship quality artifact path",
      "  --continuity <path>                  Continuity artifact path",
      "  --out <path>                         Dashboard output path",
      "  --stale-intent-warn-hours <n>        Warn threshold for stale intent age (default: 72)",
      "  --stale-intent-critical-hours <n>    Critical threshold for stale intent age (default: 168)",
      "  --orphan-ratio-warn <n>              Warn threshold for orphan ratio (default: 1)",
      "  --orphan-ratio-critical <n>          Critical threshold for orphan ratio (default: 2)",
      "  --open-loop-handoff-warn <n>         Warn threshold for open-loop handoff count (default: 2)",
      "  --open-loop-handoff-critical <n>     Critical threshold for open-loop handoff count (default: 6)",
      "  --strict                             Exit non-zero when dashboard status is not ok",
      "  --json                               Print dashboard JSON",
      "  --help                               Show this message",
      "",
    ].join("\n")
  );
}

function run() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const qualityPath = resolve(REPO_ROOT, readStringFlag(flags, "quality", defaultQualityPath));
  const continuityPath = resolve(REPO_ROOT, readStringFlag(flags, "continuity", defaultContinuityPath));
  const outPath = resolve(REPO_ROOT, readStringFlag(flags, "out", defaultOutPath));
  const strict = readBoolFlag(flags, "strict", false);
  const asJson = readBoolFlag(flags, "json", false);

  const quality = readJson(qualityPath, null);
  if (!quality || typeof quality !== "object") {
    throw new Error(`Relationship-quality artifact missing or invalid: ${qualityPath}`);
  }
  const continuity = readJson(continuityPath, null);
  if (!continuity || typeof continuity !== "object") {
    throw new Error(`Continuity artifact missing or invalid: ${continuityPath}`);
  }

  const generatedAt = isoNow();
  const runId = String(quality.runId || continuity.runId || `pst-dashboard-${generatedAt}`).trim();
  const dashboard = buildRelationshipMonitoringArtifact({
    runId,
    generatedAt,
    relationshipQualityArtifact: quality,
    continuityArtifact: continuity,
    thresholds: {
      staleIntentWarnHours: readNumberFlag(flags, "stale-intent-warn-hours", 72, { min: 1, max: 24 * 90 }),
      staleIntentCriticalHours: readNumberFlag(flags, "stale-intent-critical-hours", 168, {
        min: 1,
        max: 24 * 120,
      }),
      orphanRatioWarn: readNumberFlag(flags, "orphan-ratio-warn", 1, { min: 0, max: 20 }),
      orphanRatioCritical: readNumberFlag(flags, "orphan-ratio-critical", 2, { min: 0, max: 40 }),
      openLoopHandoffWarn: readNumberFlag(flags, "open-loop-handoff-warn", 2, { min: 0, max: 200 }),
      openLoopHandoffCritical: readNumberFlag(flags, "open-loop-handoff-critical", 6, {
        min: 0,
        max: 500,
      }),
    },
  });

  writeJson(outPath, dashboard);

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ ...dashboard, artifactPath: outPath }, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${dashboard.status}\n`);
    process.stdout.write(`runId: ${dashboard.runId}\n`);
    process.stdout.write(`artifact: ${outPath}\n`);
    process.stdout.write(
      `alerts: critical=${dashboard.summary.alertCounts.critical}, warn=${dashboard.summary.alertCounts.warn}, ok=${dashboard.summary.alertCounts.ok}\n`
    );
  }

  if (strict && dashboard.status !== "ok") {
    process.exit(1);
  }
}

try {
  run();
} catch (error) {
  process.stderr.write(
    `pst-memory-relationship-dashboard failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}
