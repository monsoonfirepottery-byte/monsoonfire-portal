#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..", "..");

const defaultOutputDir = resolve(repoRoot, "output", "qa");
const defaultToolcallPath = resolve(repoRoot, ".codex", "toolcalls.ndjson");
const defaultJsonPath = resolve(defaultOutputDir, "codex-telemetry-random-audit.json");
const defaultMarkdownPath = resolve(defaultOutputDir, "codex-telemetry-random-audit.md");

const allowedActors = new Set(["codex", "github-action", "user"]);

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  node ./scripts/codex/telemetry-random-audit.mjs [options]",
      "",
      "Options:",
      "  --toolcalls <path>           NDJSON log path (default: .codex/toolcalls.ndjson)",
      "  --window-hours <n>           Sampling window (default: 72)",
      "  --sample-size <n>            Random sample size (default: 25)",
      "  --seed <number>              Random seed for reproducible samples",
      "  --max-anomaly-rate <ratio>   Strict fail threshold (default: 0.15)",
      "  --strict                     Exit non-zero when anomaly rate exceeds threshold",
      "  --write                      Write JSON + markdown artifacts",
      "  --report-json <path>         JSON artifact path",
      "  --report-markdown <path>     Markdown artifact path",
      "  --json                       Print JSON output",
      "  --help                       Show help",
      "",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const options = {
    toolcallPath: defaultToolcallPath,
    windowHours: 72,
    sampleSize: 25,
    seed: null,
    maxAnomalyRate: 0.15,
    strict: false,
    writeArtifacts: false,
    reportJsonPath: defaultJsonPath,
    reportMarkdownPath: defaultMarkdownPath,
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--write") {
      options.writeArtifacts = true;
      continue;
    }
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }

    const next = argv[index + 1];
    if (!arg.startsWith("--")) continue;
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--toolcalls") {
      options.toolcallPath = resolve(process.cwd(), String(next));
      index += 1;
      continue;
    }
    if (arg === "--window-hours") {
      const value = Number(next);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid --window-hours value: ${next}`);
      }
      options.windowHours = Math.max(1, Math.round(value));
      index += 1;
      continue;
    }
    if (arg === "--sample-size") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 1) {
        throw new Error(`Invalid --sample-size value: ${next}`);
      }
      options.sampleSize = Math.max(1, Math.floor(value));
      index += 1;
      continue;
    }
    if (arg === "--seed") {
      const value = Number(next);
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid --seed value: ${next}`);
      }
      options.seed = Math.floor(value);
      index += 1;
      continue;
    }
    if (arg === "--max-anomaly-rate") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`Invalid --max-anomaly-rate value: ${next}`);
      }
      options.maxAnomalyRate = value;
      index += 1;
      continue;
    }
    if (arg === "--report-json") {
      options.reportJsonPath = resolve(process.cwd(), String(next));
      index += 1;
      continue;
    }
    if (arg === "--report-markdown") {
      options.reportMarkdownPath = resolve(process.cwd(), String(next));
      index += 1;
      continue;
    }
  }

  return options;
}

function toMs(value) {
  if (!value) return null;
  const parsed = new Date(value);
  const millis = parsed.getTime();
  return Number.isFinite(millis) ? millis : null;
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed);
}

function pct(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  return Number((value * 100).toFixed(digits));
}

async function readNdjson(path) {
  let raw = "";
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { entries: [], invalidLines: 0 };
  }

  const entries = [];
  let invalidLines = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      invalidLines += 1;
    }
  }
  return { entries, invalidLines };
}

function xorshift32(seedInput) {
  let state = seedInput | 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
}

function sampleWithoutReplacement(items, size, seed) {
  if (size >= items.length) return items.slice();
  const random = xorshift32(seed);
  const pool = items.slice();
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const j = Math.floor(random() * (index + 1));
    [pool[index], pool[j]] = [pool[j], pool[index]];
  }
  return pool.slice(0, size);
}

function validateUsageShape(usage, findingPrefix) {
  const findings = [];
  if (!usage || typeof usage !== "object") return findings;

  const input = toPositiveInteger(usage.inputTokens);
  const output = toPositiveInteger(usage.outputTokens);
  const reasoning = toPositiveInteger(usage.reasoningTokens);
  const cacheRead = toPositiveInteger(usage.cacheReadTokens);
  const cacheWrite = toPositiveInteger(usage.cacheWriteTokens);
  const total = toPositiveInteger(usage.totalTokens);

  if (total != null && total > 2_000_000) {
    findings.push(`${findingPrefix}: totalTokens outlier (${total})`);
  }
  if (input != null && input > 1_500_000) {
    findings.push(`${findingPrefix}: inputTokens outlier (${input})`);
  }
  if (output != null && output > 1_500_000) {
    findings.push(`${findingPrefix}: outputTokens outlier (${output})`);
  }
  if (total != null && input != null && output != null && total < input + output) {
    findings.push(`${findingPrefix}: totalTokens < input+output (${total} < ${input + output})`);
  }
  if (reasoning != null && total != null && reasoning > total) {
    findings.push(`${findingPrefix}: reasoningTokens > totalTokens (${reasoning} > ${total})`);
  }
  if (cacheRead != null && cacheRead > 2_000_000) {
    findings.push(`${findingPrefix}: cacheReadTokens outlier (${cacheRead})`);
  }
  if (cacheWrite != null && cacheWrite > 2_000_000) {
    findings.push(`${findingPrefix}: cacheWriteTokens outlier (${cacheWrite})`);
  }

  return findings;
}

function validateEntry(entry, index) {
  const findings = [];
  const prefix = `sample[${index}]`;
  const tsMs = toMs(entry?.tsIso);

  if (tsMs == null) {
    findings.push(`${prefix}: invalid tsIso`);
  }
  if (!allowedActors.has(String(entry?.actor || ""))) {
    findings.push(`${prefix}: actor not in allowlist (${String(entry?.actor || "missing")})`);
  }
  if (!String(entry?.tool || "").trim()) {
    findings.push(`${prefix}: missing tool`);
  }
  if (!String(entry?.action || "").trim()) {
    findings.push(`${prefix}: missing action`);
  }
  if (typeof entry?.ok !== "boolean") {
    findings.push(`${prefix}: ok must be boolean`);
  }

  const durationMs = toFiniteNumber(entry?.durationMs);
  if (durationMs != null) {
    if (durationMs < 0) {
      findings.push(`${prefix}: negative durationMs (${durationMs})`);
    }
    if (durationMs > 30 * 60 * 1000) {
      findings.push(`${prefix}: durationMs outlier (${Math.round(durationMs)}ms)`);
    }
  }

  const errorType = String(entry?.errorType || "").trim();
  const errorMessage = String(entry?.errorMessage || "").trim();
  if (entry?.ok === false && !errorType && !errorMessage) {
    findings.push(`${prefix}: failed entry missing errorType/errorMessage`);
  }
  if (entry?.ok === true && errorType) {
    findings.push(`${prefix}: successful entry still has errorType (${errorType})`);
  }

  const usageFindings = validateUsageShape(entry?.usage || entry?.context?.usage || null, prefix);
  findings.push(...usageFindings);

  return findings;
}

function detectDuplicateClusters(entries) {
  const counts = {};
  for (const entry of entries) {
    const key = `${entry.tsIso}|${entry.actor}|${entry.tool}|${entry.action}|${entry.ok}|${entry.durationMs ?? "n/a"}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts)
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count);
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Codex Telemetry Random Audit");
  lines.push("");
  lines.push(`- Generated at: ${report.generatedAtIso}`);
  lines.push(`- Window: ${report.windowHours}h`);
  lines.push(`- Sample size requested: ${report.sampleSizeRequested}`);
  lines.push(`- Sample size actual: ${report.sampleSizeActual}`);
  lines.push(`- Anomaly rate: ${pct(report.anomalyRate, 1) ?? "n/a"}%`);
  lines.push(`- Status: ${report.status}`);
  lines.push("");

  lines.push("## High-Level");
  lines.push(`- Valid entries in window: ${report.windowEntries}`);
  lines.push(`- Invalid NDJSON lines: ${report.invalidLines}`);
  lines.push(`- Duplicate clusters detected: ${report.duplicateClusters.length}`);
  lines.push("");

  lines.push("## Findings");
  if (report.findings.length === 0) {
    lines.push("- No sampled anomalies detected.");
  } else {
    report.findings.slice(0, 40).forEach((finding) => lines.push(`- ${finding}`));
  }
  lines.push("");

  lines.push("## Duplicate Cluster Samples");
  if (report.duplicateClusters.length === 0) {
    lines.push("- None");
  } else {
    report.duplicateClusters.slice(0, 10).forEach((cluster) => lines.push(`- ${cluster.count}x ${cluster.key}`));
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}

async function writeArtifacts(options, report, markdown) {
  await mkdir(dirname(options.reportJsonPath), { recursive: true });
  await mkdir(dirname(options.reportMarkdownPath), { recursive: true });
  await writeFile(options.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(options.reportMarkdownPath, markdown, "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const generatedAtIso = new Date().toISOString();
  const nowMs = Date.now();
  const startMs = nowMs - options.windowHours * 60 * 60 * 1000;

  const raw = await readNdjson(options.toolcallPath);
  const windowEntries = raw.entries.filter((entry) => {
    const tsMs = toMs(entry?.tsIso);
    return tsMs != null && tsMs >= startMs;
  });

  const seed = Number.isInteger(options.seed)
    ? options.seed
    : Math.floor(nowMs / 1000) ^ windowEntries.length ^ raw.invalidLines;
  const sample = sampleWithoutReplacement(windowEntries, options.sampleSize, seed);

  const findings = [];
  sample.forEach((entry, index) => {
    const entryFindings = validateEntry(entry, index);
    findings.push(...entryFindings);
  });

  const duplicateClusters = detectDuplicateClusters(windowEntries);
  if (duplicateClusters.length > 0) {
    findings.push(`window duplicates: ${duplicateClusters.length} duplicate key clusters found`);
  }

  const anomalyRate = sample.length === 0 ? 0 : findings.length / sample.length;
  const status = anomalyRate > options.maxAnomalyRate ? "needs-attention" : "healthy";

  const report = {
    generatedAtIso,
    windowHours: options.windowHours,
    sampleSizeRequested: options.sampleSize,
    sampleSizeActual: sample.length,
    seed,
    maxAnomalyRate: options.maxAnomalyRate,
    anomalyRate,
    status,
    windowEntries: windowEntries.length,
    invalidLines: raw.invalidLines,
    findings,
    duplicateClusters,
    artifacts: {
      toolcallsPath: relative(repoRoot, options.toolcallPath),
      reportJsonPath: relative(repoRoot, options.reportJsonPath),
      reportMarkdownPath: relative(repoRoot, options.reportMarkdownPath),
    },
  };

  const markdown = buildMarkdown(report);
  if (options.writeArtifacts) {
    await writeArtifacts(options, report, markdown);
  }

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      [
        `status: ${status}`,
        `anomalyRate: ${pct(anomalyRate, 1) ?? "n/a"}%`,
        `sampleSize: ${sample.length}`,
        "",
      ].join("\n")
    );
  }

  if (options.strict && anomalyRate > options.maxAnomalyRate) {
    throw new Error(
      `Anomaly rate ${pct(anomalyRate, 1)}% exceeded threshold ${pct(options.maxAnomalyRate, 1)}%.`
    );
  }
  if (options.strict && windowEntries.length === 0) {
    throw new Error("No telemetry entries found in selected window.");
  }
  if (options.strict && raw.invalidLines > 0) {
    throw new Error(`Found ${raw.invalidLines} invalid NDJSON line(s) in telemetry log.`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`telemetry-random-audit failed: ${message}`);
  process.exit(1);
});
