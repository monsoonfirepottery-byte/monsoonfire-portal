#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const repoRoot = process.cwd();

const REQUIRED_BASELINE_EXPORTS = [
  "top-acquisition-channels.csv",
  "landing-pages.csv",
  "path-to-conversion.csv",
  "event-audit.csv",
  "goal-table.csv",
];

function parseArgs(argv) {
  const options = {
    baselineDir: "",
    outputDir: join(repoRoot, "artifacts", "ga", "reports"),
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

function parseNumber(value) {
  const text = String(value ?? "").trim().replace(/[,$%]/g, "");
  if (!text) return null;
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function readCsvRows(csvText) {
  const lines = String(csvText || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);

  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]).map((header) => normalizeKey(header));
  const rows = [];
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const values = parseCsvLine(lines[lineIndex]);
    if (values.every((value) => String(value).trim().length === 0)) continue;
    const row = {};
    for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      row[headers[columnIndex]] = String(values[columnIndex] ?? "").trim();
    }
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function pick(row, keys) {
  for (const key of keys) {
    const normalized = normalizeKey(key);
    if (normalized in row && String(row[normalized]).trim().length > 0) {
      return String(row[normalized]).trim();
    }
  }
  return "";
}

async function resolveBaselineDir(explicitBaselineDir) {
  if (explicitBaselineDir) {
    const full = resolve(repoRoot, explicitBaselineDir);
    if (!existsSync(full)) {
      throw new Error(`Baseline directory not found: ${full}`);
    }
    return full;
  }

  const baselineRoot = resolve(repoRoot, "artifacts", "ga", "baseline");
  if (!existsSync(baselineRoot)) {
    throw new Error(`Baseline root not found: ${baselineRoot}`);
  }

  const entries = await readdir(baselineRoot, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(baselineRoot, entry.name))
    .sort();

  if (directories.length === 0) {
    throw new Error(`No baseline snapshots found under: ${baselineRoot}`);
  }

  return directories[directories.length - 1];
}

function summarizeAcquisition(topAcquisitionRows) {
  const normalizedRows = topAcquisitionRows.map((row) => {
    const sourceMedium = pick(row, ["source_medium", "source/medium", "source_medium_"]);
    const sourceType = pick(row, ["source_type", "channel_grouping", "channel"]);
    const sessions = parseNumber(pick(row, ["sessions"])) || 0;
    const goalConversions = parseNumber(pick(row, ["goal_conversions", "conversions"])) || 0;
    const explicitConversionRate = parseNumber(pick(row, ["conversion_rate", "goal_conversion_rate"]));
    const assistedRevenue = parseNumber(
      pick(row, ["assisted_revenue", "assisted_revenue_usd", "assisted_value", "assisted_revenue_cents"])
    );
    const conversionRatePct =
      explicitConversionRate !== null
        ? explicitConversionRate
        : sessions > 0
          ? Number(((goalConversions / sessions) * 100).toFixed(2))
          : 0;

    let performance = "steady";
    if (conversionRatePct >= 3) performance = "high_intent";
    else if (sessions >= 50 && conversionRatePct < 1) performance = "low_intent";
    else if (sessions < 20 && conversionRatePct >= 2) performance = "small_sample_high_intent";

    return {
      sourceMedium: sourceMedium || "(unknown)",
      sourceType: sourceType || "(unclassified)",
      sessions,
      goalConversions,
      conversionRatePct,
      assistedRevenue,
      performance,
      remediationHint:
        performance === "low_intent"
          ? "Review landing-page match and tighten UTM campaign intent."
          : performance === "small_sample_high_intent"
            ? "Scale test traffic with consistent UTM tagging to validate signal."
            : "Maintain and monitor.",
    };
  });

  const top10 = [...normalizedRows].sort((a, b) => b.sessions - a.sessions).slice(0, 10);
  const bySourceType = {};
  for (const row of normalizedRows) {
    const bucket = (bySourceType[row.sourceType] ||= {
      sourceType: row.sourceType,
      sessions: 0,
      goalConversions: 0,
      assistedRevenue: 0,
      rowCount: 0,
    });
    bucket.sessions += row.sessions;
    bucket.goalConversions += row.goalConversions;
    bucket.assistedRevenue += row.assistedRevenue ?? 0;
    bucket.rowCount += 1;
  }

  const sourceTypeSummary = Object.values(bySourceType)
    .map((bucket) => ({
      sourceType: bucket.sourceType,
      sessions: bucket.sessions,
      goalConversions: bucket.goalConversions,
      conversionRatePct: bucket.sessions > 0 ? Number(((bucket.goalConversions / bucket.sessions) * 100).toFixed(2)) : 0,
      assistedRevenue: bucket.assistedRevenue,
      rowCount: bucket.rowCount,
    }))
    .sort((a, b) => b.sessions - a.sessions);

  return {
    top10,
    sourceTypeSummary,
    totalRows: normalizedRows.length,
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Website GA Acquisition Quality Report");
  lines.push("");
  lines.push(`- generatedAtUtc: ${report.generatedAtUtc}`);
  lines.push(`- baselineSnapshot: ${report.baselineSnapshot}`);
  lines.push(`- topAcquisitionRows: ${report.acquisition.totalRows}`);
  lines.push("");
  lines.push("## Top 10 Source/Medium");
  lines.push("");
  lines.push("| Source / Medium | Source Type | Sessions | Goal Conversions | Conversion Rate (%) | Assisted Revenue | Performance |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | --- |");
  for (const row of report.acquisition.top10) {
    lines.push(
      `| ${row.sourceMedium} | ${row.sourceType} | ${row.sessions} | ${row.goalConversions} | ${row.conversionRatePct} | ${row.assistedRevenue ?? 0} | ${row.performance} |`
    );
  }
  lines.push("");
  lines.push("## Source Type Summary");
  lines.push("");
  lines.push("| Source Type | Sessions | Goal Conversions | Conversion Rate (%) | Assisted Revenue |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  for (const row of report.acquisition.sourceTypeSummary) {
    lines.push(`| ${row.sourceType} | ${row.sessions} | ${row.goalConversions} | ${row.conversionRatePct} | ${row.assistedRevenue} |`);
  }
  lines.push("");
  lines.push("## Missing / Blocked");
  lines.push("");
  if (report.missingRequiredExports.length === 0) {
    lines.push("- None");
  } else {
    for (const item of report.missingRequiredExports) {
      lines.push(`- ${item}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baselineDir = await resolveBaselineDir(options.baselineDir);

  const missingRequiredExports = [];
  for (const requiredExport of REQUIRED_BASELINE_EXPORTS) {
    if (!existsSync(join(baselineDir, requiredExport))) {
      missingRequiredExports.push(requiredExport);
    }
  }

  if (options.strict && missingRequiredExports.length > 0) {
    throw new Error(`Missing required GA baseline exports: ${missingRequiredExports.join(", ")}`);
  }

  const topAcquisitionPath = join(baselineDir, "top-acquisition-channels.csv");
  const topAcquisitionRows = existsSync(topAcquisitionPath)
    ? readCsvRows(await readFile(topAcquisitionPath, "utf8"))
    : [];

  const report = {
    generatedAtUtc: new Date().toISOString(),
    baselineDir,
    baselineSnapshot: basename(baselineDir),
    missingRequiredExports,
    acquisition: summarizeAcquisition(topAcquisitionRows),
  };

  await mkdir(options.outputDir, { recursive: true });
  const runId = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const jsonPath = join(options.outputDir, `website-ga-acquisition-quality-${runId}.json`);
  const mdPath = join(options.outputDir, `website-ga-acquisition-quality-${runId}.md`);
  const latestJsonPath = join(options.outputDir, "website-ga-acquisition-quality-latest.json");
  const latestMdPath = join(options.outputDir, "website-ga-acquisition-quality-latest.md");

  const markdown = buildMarkdown(report);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, markdown, "utf8");
  await writeFile(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(latestMdPath, markdown, "utf8");

  const result = {
    status: "ok",
    generatedAtUtc: report.generatedAtUtc,
    baselineSnapshot: report.baselineSnapshot,
    missingRequiredExports,
    outputs: {
      jsonPath,
      mdPath,
      latestJsonPath,
      latestMdPath,
    },
    top10Count: report.acquisition.top10.length,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`GA acquisition report created for ${report.baselineSnapshot}\n`);
    process.stdout.write(`- ${latestJsonPath}\n`);
    process.stdout.write(`- ${latestMdPath}\n`);
    if (missingRequiredExports.length > 0) {
      process.stdout.write(`Missing exports: ${missingRequiredExports.join(", ")}\n`);
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`build-website-ga-baseline-report failed: ${message}`);
  process.exit(1);
});
