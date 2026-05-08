#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_SCAN_DIR = resolve(REPO_ROOT, "output", "ops");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "output-retention");

function usage() {
  return `Ops output retention scanner

Usage:
  node scripts/ops/output_retention_scanner.mjs [--json] [--write]

Options:
  --json                  Print JSON.
  --write                 Write latest JSON and Markdown artifacts.
  --scan-dir <path>       Directory to scan. Default: output/ops.
  --output-dir <path>     Artifact directory. Default: output/ops/output-retention.
  --warn-mb <number>      Warning threshold for total size. Default: 250.
  --critical-mb <number>  Critical threshold for total size. Default: 1000.
  --stale-days <number>   Stale artifact age threshold. Default: 14.

This scanner is read-only except for optional report writes. It never deletes, rotates, compresses, or prunes artifacts.
`;
}

function parseArgs(argv) {
  const options = {
    json: false,
    write: false,
    scanDir: DEFAULT_SCAN_DIR,
    outputDir: DEFAULT_OUTPUT_DIR,
    warnMb: 250,
    criticalMb: 1000,
    staleDays: 14
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--write") {
      options.write = true;
      continue;
    }
    const valueFlags = new Map([
      ["--scan-dir", "scanDir"],
      ["--output-dir", "outputDir"],
      ["--warn-mb", "warnMb"],
      ["--critical-mb", "criticalMb"],
      ["--stale-days", "staleDays"]
    ]);
    let consumed = false;
    for (const [flag, key] of valueFlags.entries()) {
      if (arg === flag) {
        if (!argv[index + 1]) throw new Error(`${flag} requires a value.`);
        options[key] = argv[index + 1];
        index += 1;
        consumed = true;
        break;
      }
      if (arg.startsWith(`${flag}=`)) {
        options[key] = arg.slice(flag.length + 1);
        consumed = true;
        break;
      }
    }
    if (consumed) continue;
    throw new Error(`Unknown argument: ${arg}`);
  }
  options.scanDir = resolve(REPO_ROOT, options.scanDir);
  options.outputDir = resolve(REPO_ROOT, options.outputDir);
  options.warnMb = Number(options.warnMb);
  options.criticalMb = Number(options.criticalMb);
  options.staleDays = Number(options.staleDays);
  return options;
}

function repoRelative(path) {
  return relative(REPO_ROOT, path).replace(/\\/g, "/") || ".";
}

function walk(dir, root = dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path, root, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = statSync(path);
    files.push({
      path,
      relativePath: relative(root, path).replace(/\\/g, "/"),
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString()
    });
  }
  return files;
}

function ageDays(iso) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  return Number(((Date.now() - time) / 86_400_000).toFixed(1));
}

function groupByProducer(files) {
  const groups = new Map();
  for (const file of files) {
    const producer = file.relativePath.split("/")[0] || "(root)";
    const group = groups.get(producer) || {
      producer,
      files: 0,
      sizeBytes: 0,
      newestAt: "",
      oldestAt: "",
      staleFiles: 0
    };
    group.files += 1;
    group.sizeBytes += file.sizeBytes;
    if (!group.newestAt || file.modifiedAt > group.newestAt) group.newestAt = file.modifiedAt;
    if (!group.oldestAt || file.modifiedAt < group.oldestAt) group.oldestAt = file.modifiedAt;
    groups.set(producer, group);
  }
  return [...groups.values()].sort((a, b) => b.sizeBytes - a.sizeBytes);
}

function buildReport(options) {
  const generatedAt = new Date().toISOString();
  if (!existsSync(options.scanDir)) {
    return {
      schema: "studio-brain.ops.output-retention.v1",
      generatedAt,
      readOnly: true,
      status: "ok",
      scanDir: repoRelative(options.scanDir),
      summary: { exists: false, files: 0, totalBytes: 0, totalMb: 0, staleFiles: 0 },
      producers: [],
      findings: [],
      retentionAdvice: ["No output/ops directory exists yet; no retention action needed."]
    };
  }

  const files = walk(options.scanDir);
  const staleCutoff = options.staleDays;
  const filesWithAge = files.map((file) => ({ ...file, ageDays: ageDays(file.modifiedAt) }));
  const staleFiles = filesWithAge.filter((file) => file.ageDays !== null && file.ageDays > staleCutoff);
  const totalBytes = filesWithAge.reduce((acc, file) => acc + file.sizeBytes, 0);
  const totalMb = Number((totalBytes / 1_048_576).toFixed(2));
  const producers = groupByProducer(filesWithAge);
  for (const producer of producers) {
    producer.sizeMb = Number((producer.sizeBytes / 1_048_576).toFixed(2));
    producer.newestAgeDays = ageDays(producer.newestAt);
    producer.oldestAgeDays = ageDays(producer.oldestAt);
    producer.staleFiles = filesWithAge.filter((file) => file.relativePath.startsWith(`${producer.producer}/`) && file.ageDays !== null && file.ageDays > staleCutoff).length;
  }

  const findings = [];
  if (totalMb >= options.criticalMb) {
    findings.push({
      severity: "critical",
      title: "Ops output artifact size exceeds critical threshold",
      evidence: `${totalMb} MB >= ${options.criticalMb} MB`,
      safeNextStep: "Review largest producers and approve a retention policy before deleting artifacts."
    });
  } else if (totalMb >= options.warnMb) {
    findings.push({
      severity: "medium",
      title: "Ops output artifact size exceeds warning threshold",
      evidence: `${totalMb} MB >= ${options.warnMb} MB`,
      safeNextStep: "Review largest producers and document retention expectations."
    });
  }
  if (staleFiles.length) {
    findings.push({
      severity: "low",
      title: "Stale ops output artifacts found",
      evidence: `${staleFiles.length} file(s) older than ${staleCutoff} days`,
      safeNextStep: "Classify artifacts as keep, archive, or cleanup-candidate; do not delete without approval."
    });
  }

  return {
    schema: "studio-brain.ops.output-retention.v1",
    generatedAt,
    readOnly: true,
    status: findings.some((finding) => finding.severity === "critical") ? "critical" : findings.length ? "review" : "ok",
    scanDir: repoRelative(options.scanDir),
    thresholds: {
      warnMb: options.warnMb,
      criticalMb: options.criticalMb,
      staleDays: options.staleDays
    },
    summary: {
      exists: true,
      files: filesWithAge.length,
      totalBytes,
      totalMb,
      staleFiles: staleFiles.length,
      producerCount: producers.length
    },
    producers,
    largestFiles: filesWithAge.sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 20).map((file) => ({
      path: repoRelative(file.path),
      sizeBytes: file.sizeBytes,
      sizeMb: Number((file.sizeBytes / 1_048_576).toFixed(2)),
      modifiedAt: file.modifiedAt,
      ageDays: file.ageDays
    })),
    findings,
    retentionAdvice: [
      "This report is evidence only; it does not delete or rotate artifacts.",
      "Prefer retention by producer directory so incident bundles and trend snapshots keep useful history.",
      "Classify cleanup candidates as approval-required unless the producer has an explicit retention policy."
    ]
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Ops Output Retention Scanner",
    "",
    `Generated: ${report.generatedAt}`,
    `Status: \`${report.status}\``,
    `Read-only: ${report.readOnly ? "yes" : "no"}`,
    `Scan dir: \`${report.scanDir}\``,
    "",
    "## Summary",
    "",
    `- Exists: ${report.summary.exists ? "yes" : "no"}`,
    `- Files: ${report.summary.files}`,
    `- Total size: ${report.summary.totalMb} MB`,
    `- Stale files: ${report.summary.staleFiles}`,
    "",
    "## Findings",
    ""
  ];
  if (!report.findings.length) lines.push("- No retention findings.");
  for (const finding of report.findings) {
    lines.push(`- ${finding.severity.toUpperCase()}: ${finding.title}; ${finding.evidence}; next: ${finding.safeNextStep}`);
  }
  lines.push("", "## Producers", "", "| Producer | Files | Size MB | Newest age | Oldest age | Stale files |", "| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const producer of report.producers || []) {
    lines.push(`| \`${producer.producer}\` | ${producer.files} | ${producer.sizeMb} | ${producer.newestAgeDays ?? "?"} | ${producer.oldestAgeDays ?? "?"} | ${producer.staleFiles} |`);
  }
  if (!(report.producers || []).length) lines.push("| n/a | 0 | 0 | n/a | n/a | 0 |");
  lines.push("", "## Largest Files", "", "| Path | Size MB | Age days |", "| --- | ---: | ---: |");
  for (const file of report.largestFiles || []) {
    lines.push(`| \`${file.path}\` | ${file.sizeMb} | ${file.ageDays ?? "?"} |`);
  }
  if (!(report.largestFiles || []).length) lines.push("| n/a | 0 | n/a |");
  lines.push("", "## Retention Advice", "");
  for (const item of report.retentionAdvice) lines.push(`- ${item}`);
  return `${lines.join("\n")}\n`;
}

function writeArtifacts(report, options) {
  mkdirSync(options.outputDir, { recursive: true });
  const jsonPath = resolve(options.outputDir, "latest.json");
  const markdownPath = resolve(options.outputDir, "latest.md");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  report.paths = {
    json: repoRelative(jsonPath),
    markdown: repoRelative(markdownPath)
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = buildReport(options);
  if (options.write) writeArtifacts(report, options);
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report));
}

try {
  main();
} catch (error) {
  process.stderr.write(`output_retention_scanner: ${error.message}\n`);
  process.exit(1);
}
