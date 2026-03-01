import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export const repoRoot = process.cwd();
export const defaultBaselineRoot = join(repoRoot, "artifacts", "ga", "baseline");
export const defaultReportsDir = join(repoRoot, "artifacts", "ga", "reports");

export function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function parseNumber(value) {
  const text = String(value ?? "").trim().replace(/[,$%]/g, "");
  if (!text) return null;
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

export function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
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

export function readCsvRows(csvText) {
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

export function pick(row, keys) {
  for (const key of keys) {
    const normalized = normalizeKey(key);
    if (normalized in row && String(row[normalized]).trim().length > 0) {
      return String(row[normalized]).trim();
    }
  }
  return "";
}

export function nowRunId() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\./g, "").replace("Z", "Z");
}

export async function resolveBaselineDir(explicitBaselineDir = "") {
  if (explicitBaselineDir) {
    const full = resolve(repoRoot, explicitBaselineDir);
    if (!existsSync(full)) {
      throw new Error(`Baseline directory not found: ${full}`);
    }
    return full;
  }

  if (!existsSync(defaultBaselineRoot)) {
    throw new Error(`Baseline root not found: ${defaultBaselineRoot}`);
  }

  const entries = await readdir(defaultBaselineRoot, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(defaultBaselineRoot, entry.name))
    .sort();

  if (directories.length === 0) {
    throw new Error(`No baseline snapshots found under: ${defaultBaselineRoot}`);
  }

  return directories[directories.length - 1];
}

export async function writeReportArtifacts({
  outputDir = defaultReportsDir,
  reportBasename,
  report,
  markdown,
}) {
  await mkdir(outputDir, { recursive: true });
  const runId = nowRunId();
  const jsonPath = join(outputDir, `${reportBasename}-${runId}.json`);
  const mdPath = join(outputDir, `${reportBasename}-${runId}.md`);
  const latestJsonPath = join(outputDir, `${reportBasename}-latest.json`);
  const latestMdPath = join(outputDir, `${reportBasename}-latest.md`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, markdown, "utf8");
  await writeFile(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(latestMdPath, markdown, "utf8");
  return {
    jsonPath,
    mdPath,
    latestJsonPath,
    latestMdPath,
    runId,
    baselineSnapshot: report?.baselineSnapshot || basename(String(report?.baselineDir || "")),
  };
}
