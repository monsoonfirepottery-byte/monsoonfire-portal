#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildOutcomeSummary, outcomeHealthFromSummary } from "../studiobrain-ops-work-packet.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "swarm");
const DEFAULT_OUTCOMES = resolve(DEFAULT_OUTPUT_DIR, "outcomes.jsonl");
const DEFAULT_WORK_PACKET = resolve(DEFAULT_OUTPUT_DIR, "latest-work-packet.json");
const DEFAULT_PR_READINESS = resolve(REPO_ROOT, "output", "ops", "pr-readiness", "pr-readiness-latest.json");
const OUTCOME_COMMAND_TEMPLATES = [
  {
    outcome: "used",
    when: "The packet materially guided a PR, patch, or reviewed artifact.",
    notes: "used by PR or slice; replace with concrete evidence",
  },
  {
    outcome: "helpful",
    when: "The packet saved operator time or prevented scope drift.",
    notes: "helpful; replace with concrete time saved or drift avoided",
  },
  {
    outcome: "blocked",
    when: "The packet is still valid but needs approval, credentials, sudo, or a service window.",
    notes: "blocked; replace with approval or credential gate",
  },
  {
    outcome: "stale",
    when: "The packet was superseded by fresher evidence or a newer packet id.",
    notes: "stale; replace with superseding artifact or packet id",
  },
  {
    outcome: "misleading",
    when: "The packet sent work toward the wrong evidence or wrong next step.",
    notes: "misleading; replace with correction evidence",
  },
];

function usage() {
  return `Studio Brain packet outcome report

Usage:
  node scripts/ops/packet_outcome_report.mjs [--json] [--write]

Options:
  --json                 Print JSON report.
  --write                Write timestamped JSON/Markdown and latest artifacts.
  --outcomes <path>      Outcome JSONL path. Default: output/ops/swarm/outcomes.jsonl.
  --work-packet <path>   Latest work-packet artifact. Default: output/ops/swarm/latest-work-packet.json.
  --pr-readiness <path>  Latest PR readiness artifact. Default: output/ops/pr-readiness/pr-readiness-latest.json.
  --output-dir <path>    Artifact directory. Default: output/ops/swarm.
  --run-id <id>          Stable run id. Default: packet-outcome timestamp.
`;
}

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function quoteCommandArg(value) {
  const text = clean(value);
  return /^[A-Za-z0-9._:/\\=-]+$/.test(text) ? text : JSON.stringify(text);
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
    prReadiness: DEFAULT_PR_READINESS,
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
      ["--pr-readiness", "prReadiness"],
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
  options.prReadiness = resolve(REPO_ROOT, options.prReadiness);
  options.outputDir = resolve(REPO_ROOT, options.outputDir);
  return options;
}

function readOutcomeLedger(path) {
  if (!existsSync(path)) return { outcomes: [], metadata: { exists: false, bytes: 0, lineCount: 0 } };
  const text = readFileSync(path, "utf8");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const outcomes = lines.map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid outcome JSONL at ${repoRelative(path)}:${index + 1}: ${error.message}`);
      }
    });
  return { outcomes, metadata: { exists: true, bytes: statSync(path).size, lineCount: lines.length } };
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

function outcomeLedgerRetention(outcomes, metadata = {}, summary = {}) {
  const recorded = outcomes.map((entry) => clean(entry.recordedAt)).filter(Boolean).sort();
  const totalOutcomes = outcomes.length;
  const latestOutcomePackets = Array.isArray(summary.latestByPacket) ? summary.latestByPacket.length : 0;
  const historicalEntries = Math.max(0, totalOutcomes - latestOutcomePackets);
  const bytes = Number.isFinite(metadata.bytes) ? metadata.bytes : null;
  const lineCount = Number.isFinite(metadata.lineCount) ? metadata.lineCount : totalOutcomes;
  const sizeWarn = bytes !== null && bytes > 1024 * 1024;
  const historyWarn = historicalEntries > 200;
  const lineWarn = lineCount > 1000;
  const compactionRecommended = sizeWarn || historyWarn || lineWarn;
  return {
    status: compactionRecommended ? "warn" : "pass",
    exists: Boolean(metadata.exists) || totalOutcomes > 0,
    bytes,
    lineCount,
    totalOutcomes,
    uniquePackets: summary.uniquePackets ?? 0,
    latestOutcomePackets,
    historicalEntries,
    oldestRecordedAt: recorded[0] || "",
    newestRecordedAt: recorded[recorded.length - 1] || "",
    compactionRecommended,
    guidance: compactionRecommended
      ? "Keep the append-only ledger for audit history, but consider a reviewed compaction/export that preserves latest outcomes plus archived history."
      : "No retention action is currently suggested; keep recording outcomes against current packet ids.",
  };
}

function outcomeAdoption(summary = {}, currentPackets = [], prReadiness = null) {
  const totalOutcomes = summary.total ?? 0;
  const prReadinessGeneratedAt = clean(prReadiness?.generatedAt);
  const readinessPacketId = clean(prReadiness?.outcomeLedger?.packetId);
  const hasReadinessEvidence = Boolean(prReadinessGeneratedAt || readinessPacketId);
  const currentWindowPackets = currentPackets.length;
  const currentPacketIds = new Set(currentPackets.map((packet) => clean(packet.packetId)).filter(Boolean));
  const readinessPacketInCurrentWindow = Boolean(readinessPacketId && currentPacketIds.has(readinessPacketId));
  const recommendedPacket = readinessPacketInCurrentWindow
    ? currentPackets.find((packet) => packet.packetId === readinessPacketId)
    : currentPackets.find((packet) => packet.status === "ready") || currentPackets[0] || null;
  const recommendedPacketId = clean(recommendedPacket?.packetId);
  const recommendedPacketTitle = clean(recommendedPacket?.title);
  const recordCommands = recommendedPacketId
    ? OUTCOME_COMMAND_TEMPLATES.map((template) => ({
        outcome: template.outcome,
        when: template.when,
        command: [
          "node",
          "scripts/studiobrain-ops-work-packet.mjs",
          "--record-outcome",
          quoteCommandArg(recommendedPacketId),
          "--outcome",
          quoteCommandArg(template.outcome),
          "--notes",
          quoteCommandArg(template.notes),
        ].join(" "),
      }))
    : [];
  const needsRecords = hasReadinessEvidence && currentWindowPackets > 0 && totalOutcomes === 0;
  const status = needsRecords
    ? "needs_records"
    : totalOutcomes > 0
      ? "active"
      : hasReadinessEvidence
        ? "warming_up"
        : "not_observed";
  return {
    status,
    hasReadinessEvidence,
    prReadinessGeneratedAt,
    readinessPacketId,
    readinessPacketInCurrentWindow,
    recommendedPacketId,
    recommendedPacketTitle,
    currentWindowPackets,
    totalOutcomes,
    recordCommands,
    guidance: needsRecords
      ? "Record at least one packet outcome after using a PR readiness packet so the loop can learn whether generated work packets were useful."
      : "Continue recording packet outcomes whenever a packet materially steers a PR or is found stale, misleading, blocked, or superseded.",
  };
}

function buildPacketOutcomeReport(inputs = {}, options = {}) {
  const generatedAt = clean(options.generatedAt) || nowIso();
  const runId = clean(options.runId) || `packet-outcome-${generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const outcomes = Array.isArray(inputs.outcomes) ? inputs.outcomes : [];
  const workPacket = inputs.workPacket || null;
  const prReadiness = inputs.prReadiness || null;
  const currentPackets = currentPacketWindow(workPacket);
  const currentPacketIds = new Set(currentPackets.map((packet) => packet.packetId));
  const summary = buildOutcomeSummary(outcomes);
  const health = outcomeHealthFromSummary(summary);
  const ledgerRetention = outcomeLedgerRetention(outcomes, inputs.outcomeMetadata || inputs.metadata || {}, summary);
  const adoption = outcomeAdoption(summary, currentPackets, prReadiness);
  const latestByPacket = annotateOutcomes(summary.latestByPacket || [], currentPacketIds);
  const orphanedLatestOutcomes = latestByPacket.filter((entry) => entry.packetId && !entry.inCurrentWindow);
  const latestOutcomePackets = latestByPacket.length;
  const orphanedRate = latestOutcomePackets > 0 ? Number((orphanedLatestOutcomes.length / latestOutcomePackets).toFixed(3)) : 0;
  const packetChurn = {
    status: latestOutcomePackets >= 3 && orphanedRate > 0.5 ? "warn" : "pass",
    latestOutcomePackets,
    orphanedLatestOutcomes: orphanedLatestOutcomes.length,
    orphanedRate,
    resetRecommended: latestOutcomePackets >= 3 && orphanedRate > 0.5,
    guidance: "When most latest outcomes refer to packet ids outside the current window, keep the ledger for history but record new outcomes against current packet ids before using rates for steering.",
  };
  const status = workPacket?.status === "invalid_json"
    ? "fail"
    : health.status === "warn" || packetChurn.status === "warn" || ledgerRetention.status === "warn" || adoption.status === "needs_records"
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
      prReadiness: clean(options.prReadinessPath) || repoRelative(DEFAULT_PR_READINESS),
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
    ledgerRetention,
    outcomeAdoption: adoption,
    packetChurn,
    latestByPacket,
    orphanedLatestOutcomes,
    operatorNotes: [
      "Read-only outcome ledger summary; no packet execution occurs here.",
      "Orphaned outcomes usually mean packet ids changed after evidence refresh; use current packet ids for new PR readiness packets.",
    ],
  };
}

function renderMarkdown(report) {
  const warnings = [
    ...report.outcomeHealth.warnings,
    report.ledgerRetention.status === "warn" ? "outcome ledger retention review is recommended" : "",
    report.outcomeAdoption.status === "needs_records" ? "packet outcome adoption needs at least one recorded outcome" : "",
  ].filter(Boolean).map((warning) => `- ${warning}`).join("\n") || "- None.";
  const topPackets = report.currentPacketWindow.topPackets
    .map((packet) => `- ${packet.priority || "P?"} ${packet.status || "unknown"} ${packet.packetId}: ${packet.title}`)
    .join("\n") || "- None.";
  const orphaned = report.orphanedLatestOutcomes
    .map((entry) => `- ${entry.packetId}: ${entry.outcome}${entry.notes ? ` - ${entry.notes}` : ""}`)
    .join("\n") || "- None.";
  const recordCommands = Array.isArray(report.outcomeAdoption.recordCommands) && report.outcomeAdoption.recordCommands.length > 0
    ? report.outcomeAdoption.recordCommands
        .map((entry) => `- ${entry.outcome}: \`${entry.command}\`\n  - When: ${entry.when}`)
        .join("\n")
    : "- No current packet command is available.";
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
- Packet churn: ${report.packetChurn.status} (${report.packetChurn.orphanedLatestOutcomes}/${report.packetChurn.latestOutcomePackets} latest outcomes orphaned)
- Reset recommended: ${report.packetChurn.resetRecommended}

## Ledger Retention

- Exists: ${report.ledgerRetention.exists}
- Bytes: ${report.ledgerRetention.bytes ?? ""}
- Lines: ${report.ledgerRetention.lineCount}
- Historical entries: ${report.ledgerRetention.historicalEntries}
- Oldest recorded: ${report.ledgerRetention.oldestRecordedAt || "unknown"}
- Newest recorded: ${report.ledgerRetention.newestRecordedAt || "unknown"}
- Compaction recommended: ${report.ledgerRetention.compactionRecommended}
- Guidance: ${report.ledgerRetention.guidance}

## Outcome Adoption

- Status: ${report.outcomeAdoption.status}
- PR readiness evidence: ${report.outcomeAdoption.hasReadinessEvidence}
- PR readiness generated: ${report.outcomeAdoption.prReadinessGeneratedAt || "unknown"}
- Readiness packet ID: ${report.outcomeAdoption.readinessPacketId || "none"}
- Readiness packet current: ${report.outcomeAdoption.readinessPacketInCurrentWindow}
- Recommended packet ID: ${report.outcomeAdoption.recommendedPacketId || "none"}
- Recommended packet title: ${report.outcomeAdoption.recommendedPacketTitle || "none"}
- Current window packets: ${report.outcomeAdoption.currentWindowPackets}
- Total outcomes: ${report.outcomeAdoption.totalOutcomes}
- Guidance: ${report.outcomeAdoption.guidance}

### Suggested Record Commands

${recordCommands}

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
        ...readOutcomeLedger(options.outcomes),
        workPacket: readJsonIfExists(options.workPacket),
        prReadiness: readJsonIfExists(options.prReadiness),
      },
      {
        runId: options.runId,
        outcomesPath: repoRelative(options.outcomes),
        workPacketPath: repoRelative(options.workPacket),
        prReadinessPath: repoRelative(options.prReadiness),
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
