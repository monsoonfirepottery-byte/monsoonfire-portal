import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  isoNow,
  readJson,
  runCommand,
  writeJson,
} from "./pst-memory-utils.mjs";

export function codexPath(...parts) {
  return resolve(homedir(), ".codex", ...parts);
}

export function writeJsonlFile(path, rows) {
  mkdirSync(dirname(path), { recursive: true });
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  writeFileSync(path, body ? `${body}\n` : "", "utf8");
}

export function readJsonlFile(path) {
  return String(readFileSync(path, "utf8") || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function runCanonicalCorpusPipeline({
  repoRoot,
  runId,
  unitsPath,
  promotedPath,
  outputDir,
  manifestPath,
  sqlitePath,
  skipSQLite = false,
  allowEmptyPromoted = true,
}) {
  const corpusRun = runCommand(
    process.execPath,
    [
      "./scripts/pst-memory-corpus-export.mjs",
      "--run-id",
      runId,
      "--units",
      unitsPath,
      "--promoted",
      promotedPath,
      "--output-dir",
      outputDir,
      "--manifest",
      manifestPath,
      "--allow-empty-promoted",
      allowEmptyPromoted ? "true" : "false",
      "--json",
    ],
    { cwd: repoRoot, allowFailure: true }
  );
  if (!corpusRun.ok) {
    throw new Error(String(corpusRun.stderr || corpusRun.stdout || "canonical corpus export failed").trim());
  }

  const warnings = [];
  let sqliteStatus = "skipped";
  if (!skipSQLite) {
    const sqliteRun = runCommand(
      process.execPath,
      [
        "./scripts/canonical-memory-corpus-sqlite.mjs",
        "--manifest",
        manifestPath,
        "--output",
        sqlitePath,
        "--json",
      ],
      { cwd: repoRoot, allowFailure: true }
    );
    sqliteStatus = sqliteRun.ok ? "ok" : "failed";
    if (!sqliteRun.ok) {
      warnings.push({
        stage: "sqlite",
        error: String(sqliteRun.stderr || sqliteRun.stdout || "sqlite materialization failed").trim(),
      });
    }
  }

  return {
    manifest: readJson(manifestPath, null),
    sqliteStatus,
    warnings,
  };
}

export function loadFactRecordsBySourceId(manifestPath) {
  const manifest = readJson(manifestPath, null);
  const factEventPath = String(manifest?.artifacts?.factEvents || "").trim();
  const sourceUnitPath = String(manifest?.artifacts?.sourceUnits || "").trim();
  const facts = new Map();
  const sourceUnits = new Map();

  if (factEventPath) {
    for (const row of readJsonlFile(factEventPath)) {
      const sourceId = String(row?.sourceId || "").trim();
      if (!sourceId) continue;
      facts.set(sourceId, row);
    }
  }
  if (sourceUnitPath) {
    for (const row of readJsonlFile(sourceUnitPath)) {
      const sourceId = String(row?.sourceId || "").trim();
      if (!sourceId) continue;
      sourceUnits.set(sourceId, row);
    }
  }

  return {
    manifest,
    facts,
    sourceUnits,
  };
}

export function mergeJsonlArtifacts(paths, outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const parts = [];
  for (const path of paths) {
    const raw = String(readFileSync(path, "utf8") || "").trim();
    if (raw) parts.push(raw);
  }
  writeFileSync(outputPath, parts.length > 0 ? `${parts.join("\n")}\n` : "", "utf8");
}

export function buildCombinedManifest({
  runId,
  manifestPath,
  outputDir,
  sourceUnitsPath,
  factEventsPath,
  hypothesesPath,
  dossiersPath,
  sourceManifests,
  counts,
}) {
  const manifest = {
    schema: "canonical-corpus-manifest.v3",
    generatedAt: isoNow(),
    status: "completed",
    runId,
    outputDir,
    counts,
    sourceManifests,
    artifacts: {
      sourceUnits: sourceUnitsPath,
      factEvents: factEventsPath,
      hypotheses: hypothesesPath,
      dossiers: dossiersPath,
    },
  };
  writeJson(manifestPath, manifest);
  return manifest;
}

export function defaultRunRoot(runId) {
  return resolve("output", "memory", runId);
}

export function joinRunPath(runRoot, ...parts) {
  return resolve(runRoot, ...parts);
}
