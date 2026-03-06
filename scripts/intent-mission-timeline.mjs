#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function parseArgs(argv) {
  const parsed = {
    json: false,
    runId: "",
    ledgerPath: "output/intent/intent-run-ledger.jsonl",
    runArtifactsDir: "",
    outputPath: "",
    summaryPath: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (!arg) continue;
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--run-id" && argv[index + 1]) {
      parsed.runId = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--run-id=")) {
      parsed.runId = arg.slice("--run-id=".length).trim();
      continue;
    }
    if (arg === "--ledger" && argv[index + 1]) {
      parsed.ledgerPath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--ledger=")) {
      parsed.ledgerPath = arg.slice("--ledger=".length).trim();
      continue;
    }
    if ((arg === "--run-artifacts-dir" || arg === "--dir") && argv[index + 1]) {
      parsed.runArtifactsDir = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--run-artifacts-dir=")) {
      parsed.runArtifactsDir = arg.slice("--run-artifacts-dir=".length).trim();
      continue;
    }
    if ((arg === "--output" || arg === "--timeline") && argv[index + 1]) {
      parsed.outputPath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      parsed.outputPath = arg.slice("--output=".length).trim();
      continue;
    }
    if (arg === "--summary" && argv[index + 1]) {
      parsed.summaryPath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--summary=")) {
      parsed.summaryPath = arg.slice("--summary=".length).trim();
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Intent mission timeline",
          "",
          "Usage:",
          "  node ./scripts/intent-mission-timeline.mjs --run-id <id> --ledger <path> --run-artifacts-dir <dir>",
        ].join("\n")
      );
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.runId) throw new Error("--run-id is required.");
  if (!parsed.runArtifactsDir) throw new Error("--run-artifacts-dir is required.");
  if (!parsed.outputPath) parsed.outputPath = `${parsed.runArtifactsDir}/mission-timeline.ndjson`;
  if (!parsed.summaryPath) parsed.summaryPath = `${parsed.runArtifactsDir}/mission-timeline-summary.json`;
  return parsed;
}

function parseJsonl(path) {
  const raw = readFileSync(path, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function collectSupplementalReports(runArtifactsDir) {
  if (!existsSync(runArtifactsDir)) return [];
  const names = readdirSync(runArtifactsDir).filter((name) => name.endsWith(".json"));
  const events = [];
  for (const name of names) {
    const absolute = resolve(runArtifactsDir, name);
    try {
      const payload = readJson(absolute);
      if (!payload || typeof payload !== "object") continue;
      events.push({
        at: payload.generatedAt || new Date().toISOString(),
        eventType: "supplemental_report",
        source: name,
        status: payload.status || "unknown",
        summary: payload.summary || null,
      });
    } catch {
      // Ignore malformed supplemental artifacts.
    }
  }
  return events;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ledgerAbsolutePath = resolve(REPO_ROOT, args.ledgerPath);
  const runArtifactsDir = resolve(REPO_ROOT, args.runArtifactsDir);
  const outputAbsolutePath = resolve(REPO_ROOT, args.outputPath);
  const summaryAbsolutePath = resolve(REPO_ROOT, args.summaryPath);

  const timeline = [];
  if (existsSync(ledgerAbsolutePath)) {
    const ledgerEvents = parseJsonl(ledgerAbsolutePath).filter((event) => event.runId === args.runId);
    for (const event of ledgerEvents) {
      timeline.push({
        at: event.at || new Date().toISOString(),
        eventType: event.eventType || "unknown",
        runId: args.runId,
        intentId: event.intentId || null,
        taskId: event.taskId || null,
        status: event.status || null,
        detail: {
          command: event.command || null,
          reason: event.reason || null,
          mode: event.mode || null,
        },
      });
    }
  }

  const supplemental = collectSupplementalReports(runArtifactsDir);
  for (const event of supplemental) {
    timeline.push({
      at: event.at,
      eventType: event.eventType,
      runId: args.runId,
      intentId: null,
      taskId: null,
      status: event.status,
      detail: {
        source: event.source,
        summary: event.summary,
      },
    });
  }

  timeline.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const ndjson = timeline.map((row) => JSON.stringify(row)).join("\n");

  mkdirSync(dirname(outputAbsolutePath), { recursive: true });
  mkdirSync(dirname(summaryAbsolutePath), { recursive: true });
  writeFileSync(outputAbsolutePath, ndjson ? `${ndjson}\n` : "", "utf8");

  const summary = {
    schema: "intent-mission-timeline-summary.v1",
    generatedAt: new Date().toISOString(),
    runId: args.runId,
    eventCount: timeline.length,
    eventTypeCounts: timeline.reduce((acc, row) => {
      acc[row.eventType] = (acc[row.eventType] || 0) + 1;
      return acc;
    }, {}),
    outputPath: args.outputPath,
    summaryPath: args.summaryPath,
  };
  writeFileSync(summaryAbsolutePath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`intent-mission-timeline runId: ${args.runId}\n`);
    process.stdout.write(`events: ${summary.eventCount}\n`);
    process.stdout.write(`timeline: ${outputAbsolutePath}\n`);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`intent-mission-timeline failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
