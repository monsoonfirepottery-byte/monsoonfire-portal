#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_WORK_PACKET = resolve(REPO_ROOT, "output", "ops", "swarm", "latest-work-packet.json");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "swarm");
const DESTRUCTIVE_TERMS = /\b(delete|drop|prune|rm\s+-rf|restart|rotate secret|flush|truncate|firewall|iptables|ufw)\b/i;

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
  return `Studio Brain work-packet quality lint

Usage:
  node scripts/ops/work_packet_quality_lint.mjs [--json] [--write]

Options:
  --json                Print JSON report.
  --write               Write timestamped JSON/Markdown and latest artifacts.
  --work-packet <path>  Work-packet artifact. Default: output/ops/swarm/latest-work-packet.json.
  --output-dir <path>   Artifact directory. Default: output/ops/swarm.
  --run-id <id>         Stable run id. Default: work-packet-quality timestamp.
`;
}

function readFlagValue(argv, index, name) {
  const arg = argv[index];
  if (arg === name) {
    if (!argv[index + 1]) throw new Error(`${name} requires a value.`);
    return { matched: true, value: argv[index + 1], nextIndex: index + 1 };
  }
  if (arg.startsWith(`${name}=`)) return { matched: true, value: arg.slice(name.length + 1), nextIndex: index };
  return { matched: false, value: "", nextIndex: index };
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    json: false,
    write: false,
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
  options.workPacket = resolve(REPO_ROOT, options.workPacket);
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

function pushFinding(findings, severity, code, packet, message) {
  findings.push({
    severity,
    code,
    packetId: clean(packet?.packetId),
    title: clean(packet?.title),
    message,
  });
}

function lintPacket(packet, findings) {
  if (!/^\[[^\]]+\]\s+\S/.test(clean(packet.title))) pushFinding(findings, "warn", "weak-title-area", packet, "Packet title should start with an [area] prefix.");
  if (!/^P[0-3]$/.test(clean(packet.priority))) pushFinding(findings, "warn", "weak-priority", packet, "Packet priority should be P0, P1, P2, or P3.");
  if (clean(packet.status) === "ready") {
    if (!clean(packet.suggestedBranchName)) pushFinding(findings, "warn", "missing-ready-branch", packet, "Ready packet is missing suggestedBranchName.");
    if (!clean(packet.suggestedPrTitle)) pushFinding(findings, "warn", "missing-ready-pr-title", packet, "Ready packet is missing suggestedPrTitle.");
  }
  if (/[`]/.test(clean(packet.suggestedBranchName))) pushFinding(findings, "warn", "markdown-wrapped-branch", packet, "suggestedBranchName should be plain text, not markdown-wrapped.");
  if (/[`]/.test(clean(packet.suggestedPrTitle))) pushFinding(findings, "warn", "markdown-wrapped-pr-title", packet, "suggestedPrTitle should be plain text, not markdown-wrapped.");
  if (clean(packet.safeNextStep).length < 20) pushFinding(findings, "warn", "weak-safe-next-step", packet, "safeNextStep is too short to steer an operator.");
  if (!Array.isArray(packet.verification) || packet.verification.length < 2) pushFinding(findings, "warn", "weak-verification", packet, "Packet should include at least two verification steps.");
  if (!Array.isArray(packet.sourceSignals) || packet.sourceSignals.length < 3) pushFinding(findings, "warn", "weak-source-signal-count", packet, "Packet should cite at least three source signals.");
  if (!packet.constraints?.readOnlyFirst || !packet.constraints?.noSecrets || !packet.constraints?.noDataMutation) {
    pushFinding(findings, "fail", "unsafe-constraints", packet, "Packet constraints must preserve read-only-first, no-secrets, and no-data-mutation defaults.");
  }
  const gateText = clean(packet.humanGate).toLowerCase();
  const packetText = [packet.safeNextStep, ...(Array.isArray(packet.verification) ? packet.verification : [])].map(clean).join(" ");
  if (DESTRUCTIVE_TERMS.test(packetText) && !gateText && clean(packet.status) !== "approval_gated") {
    pushFinding(findings, "warn", "approval-gate-missing-for-risky-term", packet, "Packet mentions a potentially service-impacting action without an approval gate.");
  }
}

function buildQualityReport(workPacket, options = {}) {
  const generatedAt = clean(options.generatedAt) || nowIso();
  const runId = clean(options.runId) || `work-packet-quality-${generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const findings = [];
  const packets = Array.isArray(workPacket?.packets) ? workPacket.packets : [];
  if (workPacket?.status === "missing") pushFinding(findings, "fail", "work-packet-missing", {}, "Work-packet artifact is missing.");
  if (workPacket?.status === "invalid_json") pushFinding(findings, "fail", "work-packet-invalid-json", {}, `Work-packet JSON is invalid: ${clean(workPacket.parseError)}`);
  const seenIds = new Set();
  for (const packet of packets) {
    const packetId = clean(packet.packetId);
    if (!packetId) pushFinding(findings, "fail", "missing-packet-id", packet, "Packet is missing packetId.");
    if (packetId && seenIds.has(packetId)) pushFinding(findings, "fail", "duplicate-packet-id", packet, `Duplicate packetId: ${packetId}`);
    seenIds.add(packetId);
    lintPacket(packet, findings);
  }
  if (workPacket?.sourceSignalAudit?.status === "warn") {
    pushFinding(findings, "warn", "source-signal-audit-warning", {}, "Work-packet sourceSignalAudit has warnings.");
  }
  if (packets.length === 0 && workPacket?.status !== "missing" && workPacket?.status !== "invalid_json") {
    pushFinding(findings, "warn", "no-packets", {}, "Work-packet artifact contains no packets.");
  }
  const failCount = findings.filter((finding) => finding.severity === "fail").length;
  const warnCount = findings.filter((finding) => finding.severity === "warn").length;
  return {
    schema: "studiobrain-work-packet-quality-lint.v1",
    generatedAt,
    runId,
    status: failCount > 0 ? "fail" : warnCount > 0 ? "warn" : "pass",
    readOnly: true,
    sources: {
      workPacket: clean(options.workPacketPath) || repoRelative(DEFAULT_WORK_PACKET),
      generatedAt: clean(workPacket?.generatedAt),
    },
    summary: {
      packets: packets.length,
      readyPackets: packets.filter((packet) => clean(packet.status) === "ready").length,
      approvalGatedPackets: packets.filter((packet) => clean(packet.status) === "approval_gated").length,
      findings: findings.length,
      warnings: warnCount,
      failures: failCount,
      sourceSignalAuditStatus: clean(workPacket?.sourceSignalAudit?.status),
    },
    findings: findings.slice(0, 100),
  };
}

function renderMarkdown(report) {
  const findings = report.findings.map((finding) => (
    `- ${finding.severity} ${finding.code}${finding.packetId ? ` ${finding.packetId}` : ""}: ${finding.message}`
  )).join("\n") || "- None.";
  return `# Work Packet Quality Lint

Generated: ${report.generatedAt}
Status: ${report.status}
Run ID: ${report.runId}

## Summary

- Packets: ${report.summary.packets}
- Ready: ${report.summary.readyPackets}
- Approval gated: ${report.summary.approvalGatedPackets}
- Findings: ${report.summary.findings}
- Warnings: ${report.summary.warnings}
- Failures: ${report.summary.failures}
- Source signal audit: ${report.summary.sourceSignalAuditStatus || "unknown"}

## Findings

${findings}
`;
}

function writeArtifacts(options, report) {
  mkdirSync(options.outputDir, { recursive: true });
  const jsonPath = resolve(options.outputDir, `${report.runId}.json`);
  const markdownPath = resolve(options.outputDir, `${report.runId}.md`);
  const latestJson = resolve(options.outputDir, "work-packet-quality-latest.json");
  const latestMarkdown = resolve(options.outputDir, "work-packet-quality-latest.md");
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
    const report = buildQualityReport(readJsonIfExists(options.workPacket), {
      generatedAt: nowIso(),
      runId: options.runId,
      workPacketPath: repoRelative(options.workPacket),
    });
    if (options.write) report.artifacts = writeArtifacts(options, report);
    if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else process.stdout.write(`work-packet quality lint: ${report.status}, findings=${report.summary.findings}\n`);
    return report;
  } catch (error) {
    process.stderr.write(`work_packet_quality_lint failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return null;
  }
}

export { buildQualityReport, renderMarkdown };

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
