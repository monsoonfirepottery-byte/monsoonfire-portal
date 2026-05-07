#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_WORK_PACKET = resolve(REPO_ROOT, "output", "ops", "swarm", "latest-work-packet.json");
const DEFAULT_QUALITY = resolve(REPO_ROOT, "output", "ops", "swarm", "work-packet-quality-latest.json");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "swarm");

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function repoRelative(path) {
  return relative(REPO_ROOT, resolve(REPO_ROOT, path)).replace(/\\/g, "/");
}

function usage() {
  return `Studio Brain stale backlog packet report

Usage:
  node scripts/ops/stale_backlog_packet_report.mjs [--json] [--write]

Options:
  --json                 Print JSON.
  --write                Write timestamped JSON/Markdown and latest artifacts.
  --work-packet <path>   Default: output/ops/swarm/latest-work-packet.json.
  --quality <path>       Default: output/ops/swarm/work-packet-quality-latest.json.
  --output-dir <path>    Default: output/ops/swarm.
  --run-id <id>          Stable run id. Default: stale-backlog timestamp.
`;
}

function readFlagValue(argv, index, flag) {
  const arg = argv[index];
  if (arg === flag) {
    if (!argv[index + 1]) throw new Error(`${flag} requires a value.`);
    return { matched: true, value: argv[index + 1], nextIndex: index + 1 };
  }
  if (arg.startsWith(`${flag}=`)) return { matched: true, value: arg.slice(flag.length + 1), nextIndex: index };
  return { matched: false, value: "", nextIndex: index };
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    json: false,
    write: false,
    workPacket: DEFAULT_WORK_PACKET,
    quality: DEFAULT_QUALITY,
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
    const flags = [
      ["--work-packet", "workPacket"],
      ["--quality", "quality"],
      ["--output-dir", "outputDir"],
      ["--run-id", "runId"],
    ];
    let consumed = false;
    for (const [flag, key] of flags) {
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
  options.workPacket = resolve(REPO_ROOT, options.workPacket);
  options.quality = resolve(REPO_ROOT, options.quality);
  options.outputDir = resolve(REPO_ROOT, options.outputDir);
  return options;
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return { status: "missing", parseError: "" };
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { status: "invalid_json", parseError: error instanceof Error ? error.message : String(error) };
  }
}

function backlogSignal(packet) {
  return (Array.isArray(packet?.sourceSignals) ? packet.sourceSignals : []).find((signal) => clean(signal.source) === "backlog") || null;
}

function classifyCandidate(packet, qualityFindingsByPacket) {
  const backlog = backlogSignal(packet);
  const findings = qualityFindingsByPacket.get(clean(packet.packetId)) || [];
  const staleBacklogStatus = Boolean(backlog?.staleBacklogStatus) || findings.some((finding) => finding.code === "stale-backlog-status");
  const missingBacklogStatus = !clean(backlog?.status) || findings.some((finding) => finding.code === "missing-backlog-status");
  if (!staleBacklogStatus && !missingBacklogStatus) return null;
  return {
    packetId: clean(packet.packetId),
    title: clean(packet.title),
    priority: clean(packet.priority),
    status: clean(packet.status),
    backlogStatus: clean(backlog?.status),
    staleBacklogStatus,
    missingBacklogStatus,
    humanGate: clean(packet.humanGate),
    safeNextStep: clean(packet.safeNextStep),
    suggestedAction: staleBacklogStatus ? "refresh_or_retire_backlog_item" : "add_backlog_status_evidence",
    suggestedBranchName: clean(packet.suggestedBranchName),
    suggestedPrTitle: clean(packet.suggestedPrTitle),
  };
}

function buildIssuePacket(candidate) {
  const action = clean(candidate.suggestedAction);
  const stale = action === "refresh_or_retire_backlog_item";
  const titlePrefix = stale ? "Refresh or retire stale backlog item" : "Add backlog status evidence";
  const problem = stale
    ? "The work-packet generator found a backlog item whose status looks completed, merged, shipped, superseded, or otherwise stale, so it is no longer safe to treat as ready work."
    : "The work-packet generator found a backlog-derived packet without explicit status evidence, so it cannot distinguish ready work from stale or approval-gated work.";
  const proposedFix = stale
    ? "Review the source backlog item, then either refresh it with current evidence and a concrete next step or move it to a retired/waiting section with a short reason."
    : "Add explicit backlog status evidence, including whether the item is ready, approval-gated, waiting on a human, already handled, or blocked by privileged/destructive action.";
  const acceptanceCriteria = stale
    ? [
        "The backlog item has a current status with date or evidence reference.",
        "If still needed, the item has a concrete safe next step and owner.",
        "If no longer needed, the item is marked retired/superseded/waiting with rollback or re-open notes.",
        "A regenerated stale backlog packet report no longer classifies this item as stale without explanation.",
      ]
    : [
        "The backlog item includes explicit status evidence.",
        "Approval-gated or destructive follow-up remains clearly separated from executable work.",
        "A regenerated work-packet quality report no longer flags the item as missing backlog status.",
      ];
  const safetyNotes = [
    "Documentation-only backlog triage; do not run cleanup, restarts, package updates, firewall changes, schema changes, or destructive commands.",
    "If the backlog item refers to production-impacting work, leave the action approval-gated and only update the evidence/status text.",
    "Rollback is a git revert of the backlog documentation patch.",
  ];
  return {
    title: `[ops] ${titlePrefix}: ${candidate.title}`,
    problem,
    evidence: [
      `packetId=${candidate.packetId}`,
      `packetStatus=${candidate.status}`,
      `backlogStatus=${candidate.backlogStatus || "missing"}`,
      `staleBacklogStatus=${candidate.staleBacklogStatus}`,
      `missingBacklogStatus=${candidate.missingBacklogStatus}`,
    ],
    risk: "Stale or underspecified backlog rows can send agents into no-op loops, duplicate merged work, or blur approval-gated operations into ready work.",
    proposedFix,
    acceptanceCriteria,
    safetyNotes,
    labels: ["ops", "docs", "reliability", "cleanup"],
  };
}

function buildStaleBacklogPacketReport(inputs = {}, options = {}) {
  const generatedAt = clean(options.generatedAt) || nowIso();
  const runId = clean(options.runId) || `stale-backlog-packets-${generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const workPacket = inputs.workPacket || {};
  const quality = inputs.quality || {};
  const packets = Array.isArray(workPacket.packets) ? workPacket.packets : [];
  const findings = Array.isArray(quality.findings) ? quality.findings : [];
  const qualityFindingsByPacket = new Map();
  for (const finding of findings) {
    const packetId = clean(finding.packetId);
    if (!packetId) continue;
    const current = qualityFindingsByPacket.get(packetId) || [];
    current.push({
      severity: clean(finding.severity),
      code: clean(finding.code),
      message: clean(finding.message),
    });
    qualityFindingsByPacket.set(packetId, current);
  }
  const candidates = packets
    .map((packet) => classifyCandidate(packet, qualityFindingsByPacket))
    .filter(Boolean)
    .map((candidate) => ({
      ...candidate,
      issuePacket: buildIssuePacket(candidate),
    }));
  const sourceWarnings = [];
  if (workPacket.status === "missing") sourceWarnings.push("work-packet artifact is missing");
  if (workPacket.status === "invalid_json") sourceWarnings.push(`work-packet artifact is invalid JSON: ${clean(workPacket.parseError)}`);
  if (quality.status === "missing") sourceWarnings.push("work-packet quality artifact is missing");
  if (quality.status === "invalid_json") sourceWarnings.push(`work-packet quality artifact is invalid JSON: ${clean(quality.parseError)}`);
  return {
    schema: "studiobrain-stale-backlog-packet-report.v1",
    generatedAt,
    runId,
    status: sourceWarnings.length > 0 ? "warn" : candidates.length > 0 ? "warn" : "pass",
    readOnly: true,
    sources: {
      workPacket: clean(options.workPacketPath) || repoRelative(DEFAULT_WORK_PACKET),
      workPacketGeneratedAt: clean(workPacket.generatedAt),
      quality: clean(options.qualityPath) || repoRelative(DEFAULT_QUALITY),
      qualityGeneratedAt: clean(quality.generatedAt),
    },
    summary: {
      packets: packets.length,
      candidates: candidates.length,
      staleBacklogPackets: candidates.filter((candidate) => candidate.staleBacklogStatus).length,
      missingBacklogStatusPackets: candidates.filter((candidate) => candidate.missingBacklogStatus).length,
      readyPackets: packets.filter((packet) => clean(packet.status) === "ready").length,
      approvalGatedPackets: packets.filter((packet) => clean(packet.status) === "approval_gated").length,
      nextExecutableStatus: clean(workPacket.nextExecutablePacket?.status),
      sourceWarnings: sourceWarnings.length,
    },
    candidates,
    sourceWarnings,
  };
}

function renderMarkdown(report) {
  const rows = report.candidates.map((candidate) =>
    `| ${candidate.priority || ""} | ${candidate.status || ""} | ${candidate.packetId} | ${candidate.title} | ${candidate.staleBacklogStatus} | ${candidate.missingBacklogStatus} | ${candidate.suggestedAction} |`,
  ).join("\n") || "|  |  | _none_ |  |  |  |  |";
  const warnings = report.sourceWarnings.map((warning) => `- ${warning}`).join("\n") || "- None.";
  const issuePackets = report.candidates.map((candidate) => {
    const issue = candidate.issuePacket || buildIssuePacket(candidate);
    const evidence = issue.evidence.map((item) => `- ${item}`).join("\n");
    const acceptance = issue.acceptanceCriteria.map((item) => `- ${item}`).join("\n");
    const safety = issue.safetyNotes.map((item) => `- ${item}`).join("\n");
    return `### ${issue.title}

## Problem
${issue.problem}

## Evidence
${evidence}

## Risk
${issue.risk}

## Proposed Fix
${issue.proposedFix}

## Acceptance Criteria
${acceptance}

## Safety Notes
${safety}

Labels: ${issue.labels.join(", ")}
`;
  }).join("\n") || "_No issue packets needed._";
  return `# Stale Backlog Packet Report

Generated: ${report.generatedAt}
Status: ${report.status}
Run ID: ${report.runId}

## Summary

- Packets: ${report.summary.packets}
- Candidates: ${report.summary.candidates}
- Stale backlog packets: ${report.summary.staleBacklogPackets}
- Missing backlog status packets: ${report.summary.missingBacklogStatusPackets}
- Ready packets: ${report.summary.readyPackets}
- Approval-gated packets: ${report.summary.approvalGatedPackets}
- Next executable status: ${report.summary.nextExecutableStatus || ""}

## Candidates

| Priority | Packet status | Packet ID | Title | Stale status | Missing status | Suggested action |
| --- | --- | --- | --- | --- | --- | --- |
${rows}

## Source Warnings

${warnings}

## Issue-Ready Action Packets

${issuePackets}
`;
}

function writeArtifacts(options, report) {
  mkdirSync(options.outputDir, { recursive: true });
  const jsonPath = resolve(options.outputDir, `${report.runId}.json`);
  const markdownPath = resolve(options.outputDir, `${report.runId}.md`);
  const latestJson = resolve(options.outputDir, "stale-backlog-packets-latest.json");
  const latestMarkdown = resolve(options.outputDir, "stale-backlog-packets-latest.md");
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
    const report = buildStaleBacklogPacketReport(
      {
        workPacket: readJsonIfExists(options.workPacket),
        quality: readJsonIfExists(options.quality),
      },
      {
        generatedAt: nowIso(),
        runId: options.runId,
        workPacketPath: repoRelative(options.workPacket),
        qualityPath: repoRelative(options.quality),
      },
    );
    if (options.write) report.artifacts = writeArtifacts(options, report);
    if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else process.stdout.write(`stale backlog packets: ${report.status}, candidates=${report.summary.candidates}\n`);
    return report;
  } catch (error) {
    process.stderr.write(`stale_backlog_packet_report failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return null;
  }
}

export { buildStaleBacklogPacketReport, renderMarkdown };

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
