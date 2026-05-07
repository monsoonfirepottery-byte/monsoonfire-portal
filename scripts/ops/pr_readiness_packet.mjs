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
const DEFAULT_SLICE_LEDGER = resolve(REPO_ROOT, "output", "ops", "effectivity", "slice-ledger-latest.json");
const DEFAULT_TOOL_INSTALL_RECOMMENDATIONS = resolve(REPO_ROOT, "output", "ops", "effectivity", "tool-install-recommendations-latest.json");
const DEFAULT_WAVE_RUNNER = resolve(REPO_ROOT, "output", "ops", "waves", "ops-wave-runner-latest.json");

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

function summarizeWorkPacket(packet) {
  if (!packet) return { status: "missing", generatedAt: "", packets: 0, freshSources: 0, staleSources: 0, topPacket: "", readyPackets: 0, approvalGatedPackets: 0, topPackets: [], humanGates: 0, effectivityEvidenceLanes: null, effectivityApprovalRequiredLanes: null, effectivityHighSeverityLanes: null };
  if (packet.status === "invalid_json") return { status: "invalid_json", generatedAt: "", packets: 0, freshSources: 0, staleSources: 0, topPacket: "", readyPackets: 0, approvalGatedPackets: 0, topPackets: [], humanGates: 0, effectivityEvidenceLanes: null, effectivityApprovalRequiredLanes: null, effectivityHighSeverityLanes: null, parseError: packet.parseError || "" };
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
      title: clean(entry.title),
      status: clean(entry.status),
      priority: clean(entry.priority),
    })),
    humanGates: packets.filter((entry) => clean(entry.humanGate)).length,
    toolInstallNowCandidates: packet.evidenceSummary?.toolInstallNowCandidates ?? null,
    toolInstallApprovalRequired: packet.evidenceSummary?.toolInstallApprovalRequired ?? null,
    effectivityEvidenceLanes: packet.evidenceSummary?.effectivityEvidenceLanes ?? null,
    effectivityApprovalRequiredLanes: packet.evidenceSummary?.effectivityApprovalRequiredLanes ?? null,
    effectivityHighSeverityLanes: packet.evidenceSummary?.effectivityHighSeverityLanes ?? null,
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
  if (!summary) return { status: "missing", generatedAt: "", window: null, verification: null, usefulness: null, commandFailures: null };
  if (summary.status === "invalid_json") return { status: "invalid_json", generatedAt: "", window: null, verification: null, usefulness: null, commandFailures: null, parseError: summary.parseError || "" };
  return {
    status: (summary.counts?.failed ?? 0) > 0 || (summary.counts?.commandFailures ?? 0) > 0 ? "fail" : "present",
    generatedAt: clean(summary.generatedAt),
    window: summary.window || null,
    verification: summary.scores?.verification ?? null,
    usefulness: summary.scores?.usefulness ?? null,
    commandFailures: summary.counts?.commandFailures ?? null,
  };
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
  if (packet.evidence.sliceLedger.status === "fail") return "fail";
  if (packet.warnings.length > 0) return "warn";
  return "pass";
}

function buildWarnings({ gitState, evidence }) {
  const warnings = [];
  if (gitState.dirtyFiles.length > 0) warnings.push(`${gitState.dirtyFiles.length} dirty file(s) in local worktree`);
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
    sliceLedger: summarizeSliceLedger(inputs.sliceLedger),
    toolInstall: summarizeToolInstall(inputs.toolInstallRecommendations),
  };
  const warnings = buildWarnings({ gitState, evidence });
  const packet = {
    schema: "studiobrain-ops-pr-readiness-packet.v1",
    generatedAt,
    readOnly: true,
    pr: clean(options.pr),
    owner: clean(options.owner) || "Codex",
    sliceIds: clean(options.sliceIds),
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
    .map((item) => `- ${item.priority || "P?"} ${item.status || "unknown"}: ${item.title}`)
    .join("\n") || "- None recorded.";
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
| Slice ledger | ${packet.evidence.sliceLedger.status} | window=${packet.evidence.sliceLedger.window?.from || ""}..${packet.evidence.sliceLedger.window?.to || ""}, verification=${packet.evidence.sliceLedger.verification ?? ""}, usefulness=${packet.evidence.sliceLedger.usefulness ?? ""} |
| Work packet | ${packet.evidence.workPacket.status} | packets=${packet.evidence.workPacket.packets}, ready=${packet.evidence.workPacket.readyPackets}, approvalGated=${packet.evidence.workPacket.approvalGatedPackets}, freshSources=${packet.evidence.workPacket.freshSources ?? ""}, staleSources=${packet.evidence.workPacket.staleSources ?? ""}, lanes=${packet.evidence.workPacket.effectivityEvidenceLanes ?? ""}, approvalLanes=${packet.evidence.workPacket.effectivityApprovalRequiredLanes ?? ""}, highLanes=${packet.evidence.workPacket.effectivityHighSeverityLanes ?? ""}, top="${packet.evidence.workPacket.topPacket}" |
| Tool install recommendations | ${packet.evidence.toolInstall.status} | recommendations=${packet.evidence.toolInstall.recommendations}, installNow=${packet.evidence.toolInstall.installNowCandidates}, approvalRequired=${packet.evidence.toolInstall.approvalRequired} |

## Work Packet Window

${topPackets}

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
    artifactValidation: DEFAULT_ARTIFACT_VALIDATION,
    waveRunner: DEFAULT_WAVE_RUNNER,
    workPacket: DEFAULT_WORK_PACKET,
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
      "--artifact-validation": "artifactValidation",
      "--wave-runner": "waveRunner",
      "--work-packet": "workPacket",
      "--slice-ledger": "sliceLedger",
      "--tool-install-recommendations": "toolInstallRecommendations",
    };
    let matched = false;
    for (const [flag, key] of Object.entries(flags)) {
      const value = read(flag);
      if (value === null) continue;
      options[key] = ["outputDir", "artifactValidation", "waveRunner", "workPacket", "sliceLedger", "toolInstallRecommendations"].includes(key)
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
  --artifact-validation <path>         Default: output/ops/artifact-validation/artifact-schema-validation-latest.json.
  --wave-runner <path>                 Default: output/ops/waves/ops-wave-runner-latest.json.
  --work-packet <path>                 Default: output/ops/swarm/latest-work-packet.json.
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
