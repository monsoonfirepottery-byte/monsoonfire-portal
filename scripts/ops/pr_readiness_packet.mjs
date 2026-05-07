#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "pr-readiness");
const DEFAULT_ARTIFACT_VALIDATION = resolve(REPO_ROOT, "output", "ops", "artifact-validation", "artifact-schema-validation-latest.json");
const DEFAULT_WORK_PACKET = resolve(REPO_ROOT, "output", "ops", "swarm", "latest-work-packet.json");
const DEFAULT_WORK_PACKET_QUALITY = resolve(REPO_ROOT, "output", "ops", "swarm", "work-packet-quality-latest.json");
const DEFAULT_SLICE_LEDGER = resolve(REPO_ROOT, "output", "ops", "effectivity", "slice-ledger-latest.json");
const DEFAULT_TOOL_INSTALL_RECOMMENDATIONS = resolve(REPO_ROOT, "output", "ops", "effectivity", "tool-install-recommendations-latest.json");
const DEFAULT_WAVE_RUNNER = resolve(REPO_ROOT, "output", "ops", "waves", "ops-wave-runner-latest.json");
const DEFAULT_PACKET_OUTCOME_REPORT = resolve(REPO_ROOT, "output", "ops", "swarm", "packet-outcome-report-latest.json");

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function repoRelative(path) {
  const raw = clean(path);
  if (!raw) return "";
  return relative(REPO_ROOT, resolve(REPO_ROOT, raw)).replace(/\\/g, "/");
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      schema: "invalid-json",
      status: "invalid_json",
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function gitLines(args, fallback = []) {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/)
      .map(clean)
      .filter(Boolean);
  } catch {
    return fallback;
  }
}

function firstLine(args, fallback = "") {
  return gitLines(args, [fallback])[0] || fallback;
}

function collectGitState(options = {}) {
  const base = clean(options.base) || "origin/main";
  const branch = clean(options.branch) || firstLine(["rev-parse", "--abbrev-ref", "HEAD"], "unknown");
  return {
    base,
    branch,
    head: firstLine(["rev-parse", "--short", "HEAD"], ""),
    changedFiles: gitLines(["diff", "--name-only", `${base}...HEAD`]),
    dirtyFiles: gitLines(["status", "--short"]),
  };
}

function summarizeArtifactValidation(report) {
  if (!report) return { status: "missing", checks: 0, passed: 0, warned: 0, failed: 0, missing: 0, generatedAt: "", problems: ["artifact validation report is missing"] };
  if (report.status === "invalid_json") return { status: "invalid_json", checks: 0, passed: 0, warned: 0, failed: 1, missing: 0, generatedAt: "", problems: [report.parseError || "artifact validation JSON is invalid"] };
  const failing = Array.isArray(report.checks)
    ? report.checks.filter((check) => ["fail", "missing", "warn"].includes(clean(check.status))).map((check) => `${check.id}: ${check.status}`)
    : [];
  return {
    status: clean(report.status) || "unknown",
    generatedAt: clean(report.generatedAt),
    checks: report.summary?.checks ?? 0,
    passed: report.summary?.passed ?? 0,
    warned: report.summary?.warned ?? 0,
    failed: report.summary?.failed ?? 0,
    missing: report.summary?.missing ?? 0,
    problems: failing,
  };
}

function emptyNextExecutablePacket() {
  return {
    status: "",
    packetId: "",
    title: "",
    priority: "",
    risk: "",
    recommendedOwner: "",
    safeNextStep: "",
    suggestedBranchName: "",
    suggestedPrTitle: "",
    verification: [],
    sourceSignalCount: 0,
    totalPackets: 0,
    approvalGatedCount: 0,
  };
}

function summarizeNextExecutablePacket(packet) {
  const next = packet?.nextExecutablePacket;
  if (!next || typeof next !== "object") return emptyNextExecutablePacket();
  return {
    status: clean(next.status),
    packetId: clean(next.packetId),
    title: clean(next.title),
    priority: clean(next.priority),
    risk: clean(next.risk),
    recommendedOwner: clean(next.recommendedOwner),
    safeNextStep: clean(next.safeNextStep),
    suggestedBranchName: clean(next.suggestedBranchName),
    suggestedPrTitle: clean(next.suggestedPrTitle),
    verification: Array.isArray(next.verification) ? next.verification.map(clean).filter(Boolean).slice(0, 3) : [],
    sourceSignalCount: Number(next.sourceSignalCount) || 0,
    totalPackets: Number(next.totalPackets) || 0,
    approvalGatedCount: Number(next.approvalGatedCount) || 0,
  };
}

function summarizeWorkPacket(packet) {
  if (!packet) return { status: "missing", generatedAt: "", packets: 0, freshSources: 0, staleSources: 0, topPacket: "", readyPackets: 0, approvalGatedPackets: 0, topPackets: [], nextExecutablePacket: emptyNextExecutablePacket(), humanGates: 0, effectivityEvidenceLanes: null, effectivityApprovalRequiredLanes: null, effectivityHighSeverityLanes: null };
  if (packet.status === "invalid_json") return { status: "invalid_json", generatedAt: "", packets: 0, freshSources: 0, staleSources: 0, topPacket: "", readyPackets: 0, approvalGatedPackets: 0, topPackets: [], nextExecutablePacket: emptyNextExecutablePacket(), humanGates: 0, effectivityEvidenceLanes: null, effectivityApprovalRequiredLanes: null, effectivityHighSeverityLanes: null, parseError: packet.parseError || "" };
  const packets = Array.isArray(packet.packets) ? packet.packets : [];
  return {
    status: packets.length > 0 ? "present" : "empty",
    generatedAt: clean(packet.generatedAt),
    packets: packets.length,
    freshSources: packet.evidenceSummary?.freshSources ?? null,
    staleSources: packet.evidenceSummary?.staleSources ?? null,
    topPacket: clean(packets[0]?.title),
    readyPackets: packets.filter((entry) => clean(entry.status) === "ready").length,
    approvalGatedPackets: packets.filter((entry) => clean(entry.status) === "approval_gated").length,
    topPackets: packets.slice(0, 5).map((entry) => ({
      packetId: clean(entry.packetId),
      title: clean(entry.title),
      status: clean(entry.status),
      priority: clean(entry.priority),
    })),
    nextExecutablePacket: summarizeNextExecutablePacket(packet),
    humanGates: packets.filter((entry) => clean(entry.humanGate)).length,
    toolInstallNowCandidates: packet.evidenceSummary?.toolInstallNowCandidates ?? null,
    toolInstallApprovalRequired: packet.evidenceSummary?.toolInstallApprovalRequired ?? null,
    effectivityEvidenceLanes: packet.evidenceSummary?.effectivityEvidenceLanes ?? null,
    effectivityApprovalRequiredLanes: packet.evidenceSummary?.effectivityApprovalRequiredLanes ?? null,
    effectivityHighSeverityLanes: packet.evidenceSummary?.effectivityHighSeverityLanes ?? null,
  };
}

function summarizePacketOutcome(report) {
  if (!report) return { status: "missing", generatedAt: "", total: 0, maturity: "", score: null, orphanedRate: null, resetRecommended: false, warnings: [] };
  if (report.status === "invalid_json") return { status: "invalid_json", generatedAt: "", total: 0, maturity: "", score: null, orphanedRate: null, resetRecommended: false, warnings: [report.parseError || "packet outcome report JSON is invalid"] };
  return {
    status: clean(report.status) || "unknown",
    generatedAt: clean(report.generatedAt),
    total: report.outcomeSummary?.total ?? 0,
    maturity: clean(report.outcomeHealth?.maturity),
    score: report.outcomeHealth?.score ?? null,
    orphanedRate: report.packetChurn?.orphanedRate ?? null,
    resetRecommended: Boolean(report.packetChurn?.resetRecommended),
    warnings: Array.isArray(report.outcomeHealth?.warnings) ? report.outcomeHealth.warnings.map(clean).filter(Boolean) : [],
  };
}

function summarizeWorkPacketQuality(report) {
  if (!report) return { status: "missing", generatedAt: "", runId: "", findings: 0, warnings: 0, failures: 0, sourceSignalAuditStatus: "", topFindings: [] };
  if (report.status === "invalid_json") {
    return {
      status: "invalid_json",
      generatedAt: "",
      runId: "",
      findings: 1,
      warnings: 0,
      failures: 1,
      sourceSignalAuditStatus: "",
      topFindings: [{ severity: "fail", code: "invalid_json", packetId: "", title: "", message: report.parseError || "work-packet quality JSON is invalid" }],
      parseError: report.parseError || "",
    };
  }
  return {
    status: clean(report.status) || "unknown",
    generatedAt: clean(report.generatedAt),
    runId: clean(report.runId),
    findings: report.summary?.findings ?? 0,
    warnings: report.summary?.warnings ?? 0,
    failures: report.summary?.failures ?? 0,
    sourceSignalAuditStatus: clean(report.summary?.sourceSignalAuditStatus),
    topFindings: Array.isArray(report.findings)
      ? report.findings.slice(0, 5).map((finding) => ({
          severity: clean(finding.severity),
          code: clean(finding.code),
          packetId: clean(finding.packetId),
          title: clean(finding.title),
          message: clean(finding.message),
        }))
      : [],
  };
}

function buildOutcomeLedger(options = {}, evidence = {}) {
  const packetId = clean(options.packetId);
  const pr = clean(options.pr);
  const suggestedPacketIds = Array.isArray(evidence.workPacket?.topPackets)
    ? evidence.workPacket.topPackets.map((packet) => clean(packet.packetId)).filter(Boolean)
    : [];
  const notes = pr ? `PR ${pr} used this packet` : "PR readiness used this packet";
  const packetIdInSuggestedWindow = packetId ? suggestedPacketIds.includes(packetId) : null;
  const validationStatus = packetId
    ? packetIdInSuggestedWindow
      ? "suggested"
      : "outside_window"
    : "not_requested";
  return {
    packetId,
    suggestedPacketIds,
    packetIdInSuggestedWindow,
    validationStatus,
    recordCommand: packetId
      ? `node scripts/studiobrain-ops-work-packet.mjs --record-outcome ${packetId} --outcome used --notes "${notes}"`
      : "",
  };
}

function parseMaxPackets(command) {
  const match = clean(command).match(/--max-packets\s+(\d+)/);
  return match ? Number(match[1]) : null;
}

function summarizeWaveRunner(report) {
  if (!report) return { status: "missing", generatedAt: "", runId: "", workPacketMaxPackets: null, workPacketCommand: "" };
  if (report.status === "invalid_json") return { status: "invalid_json", generatedAt: "", runId: "", workPacketMaxPackets: null, workPacketCommand: "", parseError: report.parseError || "" };
  const workPacketStep = [...(Array.isArray(report.plan) ? report.plan : []), ...(Array.isArray(report.receipts) ? report.receipts : [])]
    .find((step) => clean(step.id) === "work-packet");
  const command = clean(workPacketStep?.command);
  return {
    status: clean(report.status) || "unknown",
    generatedAt: clean(report.generatedAt),
    runId: clean(report.runId),
    workPacketMaxPackets: parseMaxPackets(command),
    workPacketCommand: command,
  };
}

function summarizeSliceLedger(summary) {
  const requestedCoverage = { status: "not_requested", requested: [], covered: [], missing: [], windowFrom: "", windowTo: "" };
  if (!summary) return { status: "missing", generatedAt: "", window: null, verification: null, usefulness: null, commandFailures: null, requestedCoverage };
  if (summary.status === "invalid_json") return { status: "invalid_json", generatedAt: "", window: null, verification: null, usefulness: null, commandFailures: null, requestedCoverage, parseError: summary.parseError || "" };
  return {
    status: (summary.counts?.failed ?? 0) > 0 || (summary.counts?.commandFailures ?? 0) > 0 ? "fail" : "present",
    generatedAt: clean(summary.generatedAt),
    window: summary.window || null,
    verification: summary.scores?.verification ?? null,
    usefulness: summary.scores?.usefulness ?? null,
    commandFailures: summary.counts?.commandFailures ?? null,
    requestedCoverage,
  };
}

function parseSliceIds(value) {
  return clean(value).split(/[\s,]+/).map(clean).filter(Boolean);
}

function sliceNumber(sliceId) {
  const match = clean(sliceId).match(/(\d+)$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function summarizeSliceCoverage(sliceIds, sliceLedger) {
  const requested = parseSliceIds(sliceIds);
  const windowFrom = clean(sliceLedger.window?.from);
  const windowTo = clean(sliceLedger.window?.to);
  const base = { requested, covered: [], missing: [], windowFrom, windowTo };
  if (requested.length === 0) return { status: "not_requested", ...base };
  if (!sliceLedger.window) return { status: "unknown", ...base, missing: requested };
  const from = sliceNumber(windowFrom);
  const to = sliceNumber(windowTo);
  if (from === null || to === null) return { status: "unknown", ...base, missing: requested };
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  const covered = [];
  const missing = [];
  for (const sliceId of requested) {
    const number = sliceNumber(sliceId);
    if (number !== null && number >= low && number <= high) covered.push(sliceId);
    else missing.push(sliceId);
  }
  return { status: missing.length ? "outside_window" : "covered", ...base, covered, missing };
}

function summarizeToolInstall(report) {
  if (!report) return { status: "missing", generatedAt: "", recommendations: 0, installNowCandidates: 0, approvalRequired: 0, topRecommendations: [] };
  if (report.status === "invalid_json") return { status: "invalid_json", generatedAt: "", recommendations: 0, installNowCandidates: 0, approvalRequired: 0, topRecommendations: [], parseError: report.parseError || "" };
  return {
    status: clean(report.status) || "unknown",
    generatedAt: clean(report.generatedAt),
    recommendations: report.summary?.recommendations ?? 0,
    installNowCandidates: report.summary?.installNowCandidates ?? 0,
    approvalRequired: report.summary?.approvalRequired ?? 0,
    topRecommendations: Array.isArray(report.recommendations)
      ? report.recommendations.slice(0, 3).map((item) => ({
          tool: clean(item.tool),
          priority: clean(item.priority),
          acquisitionClass: clean(item.acquisitionClass),
          validationCommand: clean(item.validationCommand),
          approvalRequired: Boolean(item.approvalRequired),
        }))
      : [],
  };
}

function readinessStatus(packet) {
  if (packet.evidence.artifactValidation.status === "fail" || packet.evidence.artifactValidation.status === "invalid_json") return "fail";
  if (packet.evidence.workPacketQuality.status === "fail" || packet.evidence.workPacketQuality.status === "invalid_json") return "fail";
  if (packet.evidence.sliceLedger.status === "fail") return "fail";
  if (packet.warnings.length > 0) return "warn";
  return "pass";
}

function buildWarnings({ gitState, evidence, outcomeLedger }) {
  const warnings = [];
  if (gitState.dirtyFiles.length > 0) warnings.push(`${gitState.dirtyFiles.length} dirty file(s) in local worktree`);
  if (outcomeLedger?.validationStatus === "outside_window") {
    warnings.push(`packet id ${outcomeLedger.packetId} is not in the latest suggested packet window`);
  }
  if (evidence.artifactValidation.status === "missing") warnings.push("artifact validation report is missing");
  if (evidence.artifactValidation.warned > 0 || evidence.artifactValidation.missing > 0) warnings.push("artifact validation has warnings or missing artifacts");
  if (evidence.waveRunner.status === "missing") warnings.push("wave runner latest artifact is missing");
  if (evidence.waveRunner.status === "planned") warnings.push("wave runner latest artifact is a dry-run plan, not executable wave evidence");
  if (evidence.waveRunner.workPacketMaxPackets === null) warnings.push("wave runner packet window is unknown");
  if (
    evidence.waveRunner.workPacketMaxPackets !== null &&
    evidence.workPacket.packets > evidence.waveRunner.workPacketMaxPackets
  ) {
    warnings.push("latest work packet contains more packets than the wave runner packet window; refresh executable wave evidence");
  }
  if (evidence.workPacket.status === "missing") warnings.push("work-packet latest artifact is missing");
  if ((evidence.workPacket.staleSources ?? 0) > 0) warnings.push("work packet has stale evidence sources");
  if (evidence.workPacketQuality.status === "missing") warnings.push("work-packet quality latest artifact is missing");
  else if (evidence.workPacketQuality.status === "warn") warnings.push("work-packet quality lint has warnings");
  else if (evidence.workPacketQuality.status !== "pass") warnings.push(`work-packet quality lint status is ${evidence.workPacketQuality.status}`);
  for (const finding of evidence.workPacketQuality.topFindings.slice(0, 3)) {
    warnings.push(`work-packet quality ${finding.severity} ${finding.code}${finding.packetId ? ` ${finding.packetId}` : ""}: ${finding.message}`);
  }
  if (evidence.sliceLedger.requestedCoverage.status === "outside_window") {
    warnings.push(`slice ids outside latest slice-ledger window: ${evidence.sliceLedger.requestedCoverage.missing.join(", ")}`);
  } else if (evidence.sliceLedger.requestedCoverage.status === "unknown") {
    warnings.push("requested slice ids could not be matched to the latest slice-ledger window");
  }
  if (evidence.packetOutcome.status === "missing") warnings.push("packet outcome report is missing");
  else if (evidence.packetOutcome.status === "warn") warnings.push("packet outcome report has warnings");
  else if (evidence.packetOutcome.status !== "pass") warnings.push(`packet outcome report status is ${evidence.packetOutcome.status}`);
  for (const warning of evidence.packetOutcome.warnings.slice(0, 3)) {
    warnings.push(`packet outcome report warning: ${warning}`);
  }
  if (evidence.packetOutcome.resetRecommended) warnings.push("packet outcome report recommends recording fresh current packet outcomes");
  if ((evidence.toolInstall.approvalRequired ?? 0) > 0) warnings.push(`${evidence.toolInstall.approvalRequired} tool recommendation(s) require approval before use`);
  return warnings;
}

export function buildPrReadinessPacket(inputs = {}, options = {}) {
  const generatedAt = options.generatedAt || nowIso();
  const gitState = inputs.gitState || collectGitState(options);
  const evidence = {
    artifactValidation: summarizeArtifactValidation(inputs.artifactValidation),
    waveRunner: summarizeWaveRunner(inputs.waveRunner),
    workPacket: summarizeWorkPacket(inputs.workPacket),
    workPacketQuality: summarizeWorkPacketQuality(inputs.workPacketQuality),
    packetOutcome: summarizePacketOutcome(inputs.packetOutcomeReport),
    sliceLedger: summarizeSliceLedger(inputs.sliceLedger),
    toolInstall: summarizeToolInstall(inputs.toolInstallRecommendations),
  };
  evidence.sliceLedger.requestedCoverage = summarizeSliceCoverage(options.sliceIds, evidence.sliceLedger);
  const outcomeLedger = buildOutcomeLedger(options, evidence);
  const warnings = buildWarnings({ gitState, evidence, outcomeLedger });
  const packet = {
    schema: "studiobrain-ops-pr-readiness-packet.v1",
    generatedAt,
    readOnly: true,
    pr: clean(options.pr),
    owner: clean(options.owner) || "Codex",
    sliceIds: clean(options.sliceIds),
    outcomeLedger,
    scope: {
      branch: gitState.branch,
      base: gitState.base,
      head: gitState.head,
      changedFiles: gitState.changedFiles,
      dirtyFiles: gitState.dirtyFiles,
      nonScope: [
        "no service restarts",
        "no deploys",
        "no package upgrades",
        "no firewall, SSH, sudoers, systemd, Docker, PostgreSQL, or secret changes",
      ],
    },
    evidence,
    warnings,
    status: "pass",
    rollback: "Revert the PR commit(s), then regenerate ignored output/ops artifacts if a local latest file used the reverted schema.",
  };
  packet.status = readinessStatus(packet);
  return packet;
}

function renderMarkdown(packet) {
  const topRecommendations = packet.evidence.toolInstall.topRecommendations
    .map((item) => `- ${item.priority} ${item.tool}: ${item.acquisitionClass}; validate with \`${item.validationCommand}\`; approvalRequired=${item.approvalRequired}`)
    .join("\n") || "- None recorded.";
  const topPackets = packet.evidence.workPacket.topPackets
    .map((item) => `- ${item.priority || "P?"} ${item.status || "unknown"} ${item.packetId || ""}: ${item.title}`)
    .join("\n") || "- None recorded.";
  const nextPacket = packet.evidence.workPacket.nextExecutablePacket;
  const nextPacketVerification = nextPacket.verification.map((item) => `- ${item}`).join("\n") || "- None recorded.";
  const outcomeCommand = packet.outcomeLedger.recordCommand
    ? `\`${packet.outcomeLedger.recordCommand}\``
    : "Pass `--packet-id <ops-wp-id>` to include a ready-to-run outcome command.";
  const warnings = packet.warnings.map((warning) => `- ${warning}`).join("\n") || "- None.";
  const changedFiles = packet.scope.changedFiles.slice(0, 20).map((file) => `- ${file}`).join("\n") || "- None detected from base.";
  const dirtyFiles = packet.scope.dirtyFiles.map((file) => `- ${file}`).join("\n") || "- Clean.";
  return `# Ops PR Readiness Packet

Generated: ${packet.generatedAt}
Status: ${packet.status}

## Scope

- PR: ${packet.pr || ""}
- Branch: ${packet.scope.branch}
- Base: ${packet.scope.base}
- Head: ${packet.scope.head}
- Owner: ${packet.owner}
- Slice IDs: ${packet.sliceIds || ""}

### Changed Files

${changedFiles}

### Dirty Files

${dirtyFiles}

## Evidence

| Check | Status | Detail |
| --- | --- | --- |
| Artifact validation | ${packet.evidence.artifactValidation.status} | checks=${packet.evidence.artifactValidation.checks}, warned=${packet.evidence.artifactValidation.warned}, missing=${packet.evidence.artifactValidation.missing}, failed=${packet.evidence.artifactValidation.failed} |
| Wave runner | ${packet.evidence.waveRunner.status} | run=${packet.evidence.waveRunner.runId}, workPacketMaxPackets=${packet.evidence.waveRunner.workPacketMaxPackets ?? ""} |
| Slice ledger | ${packet.evidence.sliceLedger.status} | window=${packet.evidence.sliceLedger.window?.from || ""}..${packet.evidence.sliceLedger.window?.to || ""}, requestedCoverage=${packet.evidence.sliceLedger.requestedCoverage.status}, missing=${packet.evidence.sliceLedger.requestedCoverage.missing.join(", ")}, verification=${packet.evidence.sliceLedger.verification ?? ""}, usefulness=${packet.evidence.sliceLedger.usefulness ?? ""} |
| Work packet | ${packet.evidence.workPacket.status} | packets=${packet.evidence.workPacket.packets}, ready=${packet.evidence.workPacket.readyPackets}, approvalGated=${packet.evidence.workPacket.approvalGatedPackets}, freshSources=${packet.evidence.workPacket.freshSources ?? ""}, staleSources=${packet.evidence.workPacket.staleSources ?? ""}, lanes=${packet.evidence.workPacket.effectivityEvidenceLanes ?? ""}, approvalLanes=${packet.evidence.workPacket.effectivityApprovalRequiredLanes ?? ""}, highLanes=${packet.evidence.workPacket.effectivityHighSeverityLanes ?? ""}, top="${packet.evidence.workPacket.topPacket}" |
| Work packet quality | ${packet.evidence.workPacketQuality.status} | findings=${packet.evidence.workPacketQuality.findings}, warnings=${packet.evidence.workPacketQuality.warnings}, failures=${packet.evidence.workPacketQuality.failures}, sourceSignalAudit=${packet.evidence.workPacketQuality.sourceSignalAuditStatus || ""} |
| Packet outcomes | ${packet.evidence.packetOutcome.status} | total=${packet.evidence.packetOutcome.total}, maturity=${packet.evidence.packetOutcome.maturity}, score=${packet.evidence.packetOutcome.score ?? ""}, orphanedRate=${packet.evidence.packetOutcome.orphanedRate ?? ""}, resetRecommended=${packet.evidence.packetOutcome.resetRecommended} |
| Tool install recommendations | ${packet.evidence.toolInstall.status} | recommendations=${packet.evidence.toolInstall.recommendations}, installNow=${packet.evidence.toolInstall.installNowCandidates}, approvalRequired=${packet.evidence.toolInstall.approvalRequired} |

## Work Packet Window

${topPackets}

## Next Executable Packet

- Status: ${nextPacket.status || ""}
- Packet ID: ${nextPacket.packetId || ""}
- Title: ${nextPacket.title || ""}
- Priority: ${nextPacket.priority || ""}
- Owner: ${nextPacket.recommendedOwner || ""}
- Safe next step: ${nextPacket.safeNextStep || ""}
- Branch: ${nextPacket.suggestedBranchName || ""}
- PR title: ${nextPacket.suggestedPrTitle || ""}
- Source signals: ${nextPacket.sourceSignalCount}

### Next Packet Verification

${nextPacketVerification}

## Outcome Ledger

- Packet ID: ${packet.outcomeLedger.packetId || ""}
- Suggested packet IDs: ${packet.outcomeLedger.suggestedPacketIds.join(", ") || "none"}
- Packet ID validation: ${packet.outcomeLedger.validationStatus}
- Record command: ${outcomeCommand}

## Tool Recommendation Summary

${topRecommendations}

## Warnings

${warnings}

## Safety

- Read-only packet generation only.
- Generated outputs stay under ignored \`output/ops/pr-readiness\`.
- Tool recommendations expose validation commands only; install commands are intentionally omitted.

## Rollback

${packet.rollback}
`;
}

function parseArgs(argv) {
  const options = {
    json: false,
    write: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    base: "origin/main",
    branch: "",
    pr: "",
    owner: "Codex",
    sliceIds: "",
    packetId: "",
    artifactValidation: DEFAULT_ARTIFACT_VALIDATION,
    waveRunner: DEFAULT_WAVE_RUNNER,
    workPacket: DEFAULT_WORK_PACKET,
    workPacketQuality: DEFAULT_WORK_PACKET_QUALITY,
    packetOutcomeReport: DEFAULT_PACKET_OUTCOME_REPORT,
    sliceLedger: DEFAULT_SLICE_LEDGER,
    toolInstallRecommendations: DEFAULT_TOOL_INSTALL_RECOMMENDATIONS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (arg === "--help" || arg === "-h") {
      printUsage();
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
    const next = clean(argv[index + 1]);
    const read = (flag) => {
      if (arg === flag) {
        if (!next) throw new Error(`${flag} requires a value.`);
        index += 1;
        return next;
      }
      if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
      return null;
    };
    const flags = {
      "--output-dir": "outputDir",
      "--base": "base",
      "--branch": "branch",
      "--pr": "pr",
      "--owner": "owner",
      "--slice-ids": "sliceIds",
      "--packet-id": "packetId",
      "--artifact-validation": "artifactValidation",
      "--wave-runner": "waveRunner",
      "--work-packet": "workPacket",
      "--work-packet-quality": "workPacketQuality",
      "--packet-outcome-report": "packetOutcomeReport",
      "--slice-ledger": "sliceLedger",
      "--tool-install-recommendations": "toolInstallRecommendations",
    };
    let matched = false;
    for (const [flag, key] of Object.entries(flags)) {
      const value = read(flag);
      if (value === null) continue;
      options[key] = ["outputDir", "artifactValidation", "waveRunner", "workPacket", "workPacketQuality", "packetOutcomeReport", "sliceLedger", "toolInstallRecommendations"].includes(key)
        ? resolve(REPO_ROOT, value)
        : value;
      matched = true;
      break;
    }
    if (matched) continue;
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printUsage() {
  process.stdout.write(`Studio Brain ops PR readiness packet

Usage:
  node scripts/ops/pr_readiness_packet.mjs --write [--json]

Options:
  --base <ref>                         Default: origin/main.
  --pr <id-or-url>                     Optional PR number or URL.
  --slice-ids <ids>                    Optional slice id list.
  --packet-id <ops-wp-id>              Optional work packet id used by this PR.
  --artifact-validation <path>         Default: output/ops/artifact-validation/artifact-schema-validation-latest.json.
  --wave-runner <path>                 Default: output/ops/waves/ops-wave-runner-latest.json.
  --work-packet <path>                 Default: output/ops/swarm/latest-work-packet.json.
  --work-packet-quality <path>         Default: output/ops/swarm/work-packet-quality-latest.json.
  --packet-outcome-report <path>       Default: output/ops/swarm/packet-outcome-report-latest.json.
  --slice-ledger <path>                Default: output/ops/effectivity/slice-ledger-latest.json.
  --tool-install-recommendations <path> Default: output/ops/effectivity/tool-install-recommendations-latest.json.
`);
}

function writeOutputs(packet, outputDir) {
  mkdirSync(outputDir, { recursive: true });
  const stamp = packet.generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const jsonPath = resolve(outputDir, `pr-readiness-${stamp}.json`);
  const markdownPath = resolve(outputDir, `pr-readiness-${stamp}.md`);
  const latestJson = resolve(outputDir, "pr-readiness-latest.json");
  const latestMarkdown = resolve(outputDir, "pr-readiness-latest.md");
  writeFileSync(jsonPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderMarkdown(packet), "utf8");
  writeFileSync(latestJson, `${JSON.stringify({ ...packet, artifactPath: repoRelative(jsonPath), markdownPath: repoRelative(markdownPath) }, null, 2)}\n`, "utf8");
  writeFileSync(latestMarkdown, renderMarkdown({ ...packet, artifactPath: repoRelative(jsonPath), markdownPath: repoRelative(markdownPath) }), "utf8");
  return {
    jsonPath: repoRelative(jsonPath),
    markdownPath: repoRelative(markdownPath),
    latestJson: repoRelative(latestJson),
    latestMarkdown: repoRelative(latestMarkdown),
  };
}

function run(rawArgs = process.argv.slice(2)) {
  const options = parseArgs(rawArgs);
  const packet = buildPrReadinessPacket({
    artifactValidation: readJsonIfExists(options.artifactValidation),
    waveRunner: readJsonIfExists(options.waveRunner),
    workPacket: readJsonIfExists(options.workPacket),
    workPacketQuality: readJsonIfExists(options.workPacketQuality),
    packetOutcomeReport: readJsonIfExists(options.packetOutcomeReport),
    sliceLedger: readJsonIfExists(options.sliceLedger),
    toolInstallRecommendations: readJsonIfExists(options.toolInstallRecommendations),
  }, options);
  const report = {
    ...packet,
    artifacts: options.write ? writeOutputs(packet, options.outputDir) : null,
  };
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(`ops PR readiness: ${packet.status}\n`);
    if (options.write) process.stdout.write(`artifact: ${report.artifacts.latestMarkdown}\n`);
  }
  if (packet.status === "fail") process.exitCode = 1;
  return report;
}

export { renderMarkdown };

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
