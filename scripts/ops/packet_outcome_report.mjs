#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildOutcomeSummary, outcomeHealthFromSummary } from "../studiobrain-ops-work-packet.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "swarm");
const DEFAULT_OUTCOMES = resolve(DEFAULT_OUTPUT_DIR, "outcomes.jsonl");
const DEFAULT_WORK_PACKET = resolve(DEFAULT_OUTPUT_DIR, "latest-work-packet.json");

function usage() {
  return `Studio Brain packet outcome report

Usage:
  node scripts/ops/packet_outcome_report.mjs [--json] [--write]

Options:
  --json                 Print JSON report.
  --write                Write timestamped JSON/Markdown and latest artifacts.
  --outcomes <path>      Outcome JSONL path. Default: output/ops/swarm/outcomes.jsonl.
  --work-packet <path>   Latest work-packet artifact. Default: output/ops/swarm/latest-work-packet.json.
  --output-dir <path>    Artifact directory. Default: output/ops/swarm.
  --run-id <id>          Stable run id. Default: packet-outcome timestamp.
`;
}

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function repoRelative(path) {
  return relative(REPO_ROOT, resolve(REPO_ROOT, path)).replace(/\\/g, "/");
}

function readFlagValue(argv, index, flag) {
  const value = argv[index];
  if (value === flag) {
    if (!argv[index + 1]) throw new Error(`${flag} requires a value.`);
    return { matched: true, value: argv[index + 1], nextIndex: index + 1 };
  }
  if (value.startsWith(`${flag}=`)) {
    return { matched: true, value: value.slice(flag.length + 1), nextIndex: index };
  }
  return { matched: false, value: "", nextIndex: index };
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    json: false,
    write: false,
    outcomes: DEFAULT_OUTCOMES,
    workPacket: DEFAULT_WORK_PACKET,
    outputDir: DEFAULT_OUTPUT_DIR,
    runId: "",
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
    const mappings = [
      ["--outcomes", "outcomes"],
      ["--work-packet", "workPacket"],
      ["--output-dir", "outputDir"],
      ["--run-id", "runId"],
    ];
    let consumed = false;
    for (const [flag, key] of mappings) {
      const parsed = readFlagValue(argv, index, flag);
      if (!parsed.matched) continue;
      options[key] = parsed.value;
      index = parsed.nextIndex;
      consumed = true;
      break;
    }
    if (consumed) continue;
    throw new Error(`Unknown argument: ${arg}`);
  }
  options.outcomes = resolve(REPO_ROOT, options.outcomes);
  options.workPacket = resolve(REPO_ROOT, options.workPacket);
  options.outputDir = resolve(REPO_ROOT, options.outputDir);
  return options;
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid outcome JSONL at ${repoRelative(path)}:${index + 1}: ${error.message}`);
      }
    });
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { status: "invalid_json", parseError: error instanceof Error ? error.message : String(error) };
  }
}

function currentPacketWindow(workPacket) {
  const packets = Array.isArray(workPacket?.packets) ? workPacket.packets : [];
  return packets.map((packet) => ({
    packetId: clean(packet.packetId),
    title: clean(packet.title),
    status: clean(packet.status),
    priority: clean(packet.priority),
  })).filter((packet) => packet.packetId);
}

function annotateOutcomes(outcomes, currentPacketIds) {
  return outcomes.map((entry) => ({
    packetId: clean(entry.packetId),
    outcome: clean(entry.outcome),
    recordedAt: clean(entry.recordedAt),
    notes: clean(entry.notes),
    inCurrentWindow: currentPacketIds.has(clean(entry.packetId)),
  }));
}

function buildPacketOutcomeReport(inputs = {}, options = {}) {
  const generatedAt = clean(options.generatedAt) || nowIso();
  const runId = clean(options.runId) || `packet-outcome-${generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const outcomes = Array.isArray(inputs.outcomes) ? inputs.outcomes : [];
  const workPacket = inputs.workPacket || null;
  const currentPackets = currentPacketWindow(workPacket);
  const currentPacketIds = new Set(currentPackets.map((packet) => packet.packetId));
  const summary = buildOutcomeSummary(outcomes);
  const health = outcomeHealthFromSummary(summary);
  const latestByPacket = annotateOutcomes(summary.latestByPacket || [], currentPacketIds);
  const orphanedLatestOutcomes = latestByPacket.filter((entry) => entry.packetId && !entry.inCurrentWindow);
  const status = workPacket?.status === "invalid_json"
    ? "fail"
    : health.status === "warn"
      ? "warn"
      : "pass";

  return {
    schema: "studiobrain-ops-packet-outcome-report.v1",
    generatedAt,
    runId,
    status,
    readOnly: true,
    sources: {
      outcomes: clean(options.outcomesPath) || repoRelative(DEFAULT_OUTCOMES),
      workPacket: clean(options.workPacketPath) || repoRelative(DEFAULT_WORK_PACKET),
    },
    currentPacketWindow: {
      generatedAt: clean(workPacket?.generatedAt),
      packets: currentPackets.length,
      packetIds: currentPackets.map((packet) => packet.packetId),
      topPackets: currentPackets.slice(0, 8),
      readStatus: workPacket ? clean(workPacket.status) || "present" : "missing",
      parseError: clean(workPacket?.parseError),
    },
    outcomeSummary: summary,
    outcomeHealth: health,
    latestByPacket,
    orphanedLatestOutcomes,
    operatorNotes: [
      "Read-only outcome ledger summary; no packet execution occurs here.",
      "Orphaned outcomes usually mean packet ids changed after evidence refresh; use current packet ids for new PR readiness packets.",
    ],
  };
}

function renderMarkdown(report) {
  const warnings = report.outcomeHealth.warnings.map((warning) => `- ${warning}`).join("\n") || "- None.";
  const topPackets = report.currentPacketWindow.topPackets
    .map((packet) => `- ${packet.priority || "P?"} ${packet.status || "unknown"} ${packet.packetId}: ${packet.title}`)
    .join("\n") || "- None.";
  const orphaned = report.orphanedLatestOutcomes
    .map((entry) => `- ${entry.packetId}: ${entry.outcome}${entry.notes ? ` - ${entry.notes}` : ""}`)
    .join("\n") || "- None.";
  return `# Packet Outcome Report

Generated: ${report.generatedAt}
Status: ${report.status}
Run ID: ${report.runId}

## Outcome Health

- Total outcomes: ${report.outcomeSummary.total}
- Unique packets: ${report.outcomeSummary.uniquePackets}
- Helpful rate: ${report.outcomeSummary.helpfulRate}
- Stale/misleading rate: ${report.outcomeSummary.staleOrMisleadingRate}
- Maturity: ${report.outcomeHealth.maturity}
- Score: ${report.outcomeHealth.score}

### Warnings

${warnings}

## Current Packet Window

- Work-packet generated: ${report.currentPacketWindow.generatedAt || "unknown"}
- Packets: ${report.currentPacketWindow.packets}

${topPackets}

## Orphaned Latest Outcomes

${orphaned}

## Notes

${report.operatorNotes.map((note) => `- ${note}`).join("\n")}
`;
}

function writeArtifacts(options, report) {
  mkdirSync(options.outputDir, { recursive: true });
  const jsonPath = resolve(options.outputDir, `${report.runId}.json`);
  const markdownPath = resolve(options.outputDir, `${report.runId}.md`);
  const latestJson = resolve(options.outputDir, "packet-outcome-report-latest.json");
  const latestMarkdown = resolve(options.outputDir, "packet-outcome-report-latest.md");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  writeFileSync(latestJson, `${JSON.stringify({ ...report, artifactPath: repoRelative(jsonPath), markdownPath: repoRelative(markdownPath) }, null, 2)}\n`, "utf8");
  writeFileSync(latestMarkdown, renderMarkdown(report), "utf8");
  return {
    jsonPath: repoRelative(jsonPath),
    markdownPath: repoRelative(markdownPath),
    latestJson: repoRelative(latestJson),
    latestMarkdown: repoRelative(latestMarkdown),
  };
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    const report = buildPacketOutcomeReport(
      {
        outcomes: readJsonl(options.outcomes),
        workPacket: readJsonIfExists(options.workPacket),
      },
      {
        runId: options.runId,
        outcomesPath: repoRelative(options.outcomes),
        workPacketPath: repoRelative(options.workPacket),
      },
    );
    const artifacts = options.write ? writeArtifacts(options, report) : null;
    if (options.json || !options.write) {
      process.stdout.write(`${JSON.stringify(artifacts ? { ...report, artifacts } : report, null, 2)}\n`);
    } else {
      process.stdout.write(`packet outcome report: ${report.status}, outcomes=${report.outcomeSummary.total}\n`);
    }
    return report;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
    return null;
  }
}

export {
  buildPacketOutcomeReport,
  main,
  parseArgs,
  renderMarkdown,
};

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
