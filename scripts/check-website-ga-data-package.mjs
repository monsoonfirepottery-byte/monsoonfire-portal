#!/usr/bin/env node

/* eslint-disable no-console */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const repoRoot = process.cwd();
const DEFAULT_BASELINE_ROOT = join(repoRoot, "artifacts", "ga", "baseline");
const DEFAULT_OUTPUT_DIR = join(repoRoot, "artifacts", "ga", "reports");
const REQUIRED_EXPORTS = [
  "top-acquisition-channels.csv",
  "landing-pages.csv",
  "path-to-conversion.csv",
  "event-audit.csv",
  "goal-table.csv",
  "analyst-note.md",
];

function parseArgs(argv) {
  const options = {
    baselineDir: "",
    outputDir: DEFAULT_OUTPUT_DIR,
    strict: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--baseline-dir") {
      options.baselineDir = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (arg === "--output-dir") {
      options.outputDir = String(argv[index + 1] || "").trim() || options.outputDir;
      index += 1;
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
    }
  }
  return options;
}

async function resolveBaselineDir(explicitDir) {
  if (explicitDir) {
    const full = resolve(repoRoot, explicitDir);
    if (!existsSync(full)) {
      throw new Error(`Baseline directory not found: ${full}`);
    }
    return full;
  }
  if (!existsSync(DEFAULT_BASELINE_ROOT)) {
    throw new Error(`Baseline root not found: ${DEFAULT_BASELINE_ROOT}`);
  }
  const entries = await readdir(DEFAULT_BASELINE_ROOT, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(DEFAULT_BASELINE_ROOT, entry.name))
    .sort();
  if (dirs.length === 0) {
    throw new Error(`No baseline snapshots found under: ${DEFAULT_BASELINE_ROOT}`);
  }
  return dirs[dirs.length - 1];
}

function hasMetadataKey(noteText, label) {
  return new RegExp(`^\\s*${label}\\s*:`, "im").test(noteText);
}

async function checkCsvHasHeaderAndRow(path) {
  try {
    const source = await readFile(path, "utf8");
    const lines = source.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length < 2) {
      return { ok: false, reason: "expected header + at least one data row" };
    }
    return { ok: true, reason: null };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Website GA Data Package Check");
  lines.push("");
  lines.push(`- generatedAtUtc: ${report.generatedAtUtc}`);
  lines.push(`- baselineSnapshot: ${report.baselineSnapshot}`);
  lines.push(`- status: ${report.status}`);
  lines.push("");
  lines.push("## Required Exports");
  lines.push("");
  lines.push("| Export | Present | Notes |");
  lines.push("| --- | --- | --- |");
  for (const row of report.exports) {
    lines.push(`| ${row.name} | ${row.present ? "yes" : "no"} | ${row.notes || ""} |`);
  }
  lines.push("");
  lines.push("## Metadata Checks");
  lines.push("");
  lines.push("| Check | Pass |");
  lines.push("| --- | --- |");
  for (const row of report.metadataChecks) {
    lines.push(`| ${row.key} | ${row.ok ? "yes" : "no"} |`);
  }
  lines.push("");
  lines.push("## Missing / Blocked");
  lines.push("");
  if (report.missing.length === 0) {
    lines.push("- None");
  } else {
    for (const item of report.missing) {
      lines.push(`- ${item}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baselineDir = await resolveBaselineDir(options.baselineDir);
  const exportsStatus = [];
  const missing = [];

  for (const exportName of REQUIRED_EXPORTS) {
    const filePath = join(baselineDir, exportName);
    const present = existsSync(filePath);
    const status = {
      name: exportName,
      present,
      notes: "",
    };
    if (!present) {
      missing.push(exportName);
      exportsStatus.push(status);
      continue;
    }
    if (exportName.endsWith(".csv")) {
      const csvCheck = await checkCsvHasHeaderAndRow(filePath);
      if (!csvCheck.ok) {
        status.notes = csvCheck.reason || "invalid csv";
        missing.push(`${exportName} (invalid)`);
      } else {
        status.notes = "ok";
      }
    } else {
      status.notes = "ok";
    }
    exportsStatus.push(status);
  }

  const analystNotePath = join(baselineDir, "analyst-note.md");
  const analystNoteText = existsSync(analystNotePath) ? await readFile(analystNotePath, "utf8") : "";
  const metadataChecks = [
    { key: "Retrieval date (UTC)", ok: hasMetadataKey(analystNoteText, "Retrieval date \\(UTC\\)") },
    { key: "GA property", ok: hasMetadataKey(analystNoteText, "GA property") },
    { key: "Export owner", ok: hasMetadataKey(analystNoteText, "Export owner") },
    { key: "Date windows exported", ok: hasMetadataKey(analystNoteText, "Date windows exported") },
  ];
  for (const check of metadataChecks) {
    if (!check.ok) {
      missing.push(`analyst-note metadata: ${check.key}`);
    }
  }

  const report = {
    generatedAtUtc: new Date().toISOString(),
    baselineDir,
    baselineSnapshot: basename(baselineDir),
    status: missing.length === 0 ? "ok" : "degraded",
    exports: exportsStatus,
    metadataChecks,
    missing,
  };

  await mkdir(options.outputDir, { recursive: true });
  const runId = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const jsonPath = join(options.outputDir, `website-ga-data-package-check-${runId}.json`);
  const mdPath = join(options.outputDir, `website-ga-data-package-check-${runId}.md`);
  const latestJsonPath = join(options.outputDir, "website-ga-data-package-check-latest.json");
  const latestMdPath = join(options.outputDir, "website-ga-data-package-check-latest.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, buildMarkdown(report), "utf8");
  await writeFile(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(latestMdPath, buildMarkdown(report), "utf8");

  const result = {
    status: report.status,
    baselineSnapshot: report.baselineSnapshot,
    missing,
    outputs: {
      jsonPath,
      mdPath,
      latestJsonPath,
      latestMdPath,
    },
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`baselineSnapshot=${result.baselineSnapshot}\n`);
    process.stdout.write(`status=${result.status}\n`);
    process.stdout.write(`latest=${latestJsonPath}\n`);
  }

  if (options.strict && missing.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`check-website-ga-data-package failed: ${message}`);
  process.exit(1);
});

