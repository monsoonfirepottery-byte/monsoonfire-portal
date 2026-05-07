#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_DOC = resolve(REPO_ROOT, "docs", "ops", "14-post-merge-verification.md");
const DEFAULT_ARTIFACT_VALIDATION = resolve(REPO_ROOT, "output", "ops", "artifact-validation", "artifact-schema-validation-latest.json");
const DEFAULT_WORK_PACKET_QUALITY = resolve(REPO_ROOT, "output", "ops", "swarm", "work-packet-quality-latest.json");
const DEFAULT_STALE_BACKLOG = resolve(REPO_ROOT, "output", "ops", "swarm", "stale-backlog-packets-latest.json");
const DEFAULT_PR_STACK = resolve(REPO_ROOT, "output", "ops", "pr-stack", "pr-stack-audit-latest.json");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "post-merge");

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
  return `Studio Brain post-merge verification packet

Usage:
  node scripts/ops/post_merge_verification_packet.mjs [--json] [--write]

Options:
  --json                         Print JSON.
  --write                        Write timestamped/latest JSON and Markdown artifacts.
  --doc <path>                   Default: docs/ops/14-post-merge-verification.md.
  --artifact-validation <path>   Default: output/ops/artifact-validation/artifact-schema-validation-latest.json.
  --work-packet-quality <path>   Default: output/ops/swarm/work-packet-quality-latest.json.
  --stale-backlog <path>         Default: output/ops/swarm/stale-backlog-packets-latest.json.
  --pr-stack <path>              Default: output/ops/pr-stack/pr-stack-audit-latest.json.
  --output-dir <path>            Default: output/ops/post-merge.
  --run-id <id>                  Stable run id. Default: post-merge timestamp.
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
    doc: DEFAULT_DOC,
    artifactValidation: DEFAULT_ARTIFACT_VALIDATION,
    workPacketQuality: DEFAULT_WORK_PACKET_QUALITY,
    staleBacklog: DEFAULT_STALE_BACKLOG,
    prStack: DEFAULT_PR_STACK,
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
    const flags = {
      "--doc": "doc",
      "--artifact-validation": "artifactValidation",
      "--work-packet-quality": "workPacketQuality",
      "--stale-backlog": "staleBacklog",
      "--pr-stack": "prStack",
      "--output-dir": "outputDir",
      "--run-id": "runId",
    };
    let consumed = false;
    for (const [flag, key] of Object.entries(flags)) {
      const parsed = readFlagValue(argv, index, flag);
      if (!parsed.matched) continue;
      options[key] = key === "runId" ? parsed.value : resolve(REPO_ROOT, parsed.value);
      index = parsed.nextIndex;
      consumed = true;
      break;
    }
    if (consumed) continue;
    throw new Error(`Unknown argument: ${arg}`);
  }
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

function readTextIfExists(path) {
  if (!existsSync(path)) return { exists: false, text: "" };
  return { exists: true, text: readFileSync(path, "utf8") };
}

function gitValue(args) {
  try {
    return clean(execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return "";
  }
}

function currentGitState(options = {}) {
  if (options.gitState) return options.gitState;
  const dirty = gitValue(["status", "--short"]).split(/\n/).map(clean).filter(Boolean);
  return {
    branch: gitValue(["branch", "--show-current"]),
    head: gitValue(["rev-parse", "--short", "HEAD"]),
    dirtyFiles: dirty,
  };
}

function countApprovalGates(markdown) {
  const match = clean(markdown).match(/## Current Approval Gates\s*\n([\s\S]*?)(?:\n## |\n# |$)/);
  if (!match) return 0;
  const rows = match[1].split(/\n/).map(clean).filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line));
  return Math.max(0, rows.length - 1);
}

function summarizeArtifactValidation(report) {
  return {
    status: clean(report.status),
    generatedAt: clean(report.generatedAt),
    checks: Number(report.summary?.checks) || 0,
    passed: Number(report.summary?.passed) || 0,
    warned: Number(report.summary?.warned) || 0,
    missing: Number(report.summary?.missing) || 0,
    failed: Number(report.summary?.failed) || 0,
  };
}

function summarizeWorkPacketQuality(report) {
  return {
    status: clean(report.status),
    generatedAt: clean(report.generatedAt),
    findings: Number(report.summary?.findings) || 0,
    staleBacklogPackets: Number(report.summary?.staleBacklogPackets) || 0,
    missingBacklogStatusPackets: Number(report.summary?.missingBacklogStatusPackets) || 0,
    readyPackets: Number(report.summary?.readyPackets) || 0,
    approvalGatedPackets: Number(report.summary?.approvalGatedPackets) || 0,
  };
}

function summarizeStaleBacklog(report) {
  return {
    status: clean(report.status),
    generatedAt: clean(report.generatedAt),
    candidates: Number(report.summary?.candidates) || 0,
    staleBacklogPackets: Number(report.summary?.staleBacklogPackets) || 0,
    missingBacklogStatusPackets: Number(report.summary?.missingBacklogStatusPackets) || 0,
  };
}

function summarizePrStack(report) {
  const digest = report.steeringDigest || {};
  return {
    status: clean(report.status),
    generatedAt: clean(report.generatedAt),
    openLowerBound: Number(digest.openLowerBound ?? report.summary?.openPullRequests) || 0,
    openCountExact: Boolean(digest.openCountExact),
    mergeReady: Number(digest.mergeReady) || 0,
    mergeBlocked: Number(digest.mergeBlocked) || 0,
    recommendedSteering: clean(digest.recommendedSteering),
  };
}

function buildPostMergeVerificationPacket(inputs = {}, options = {}) {
  const generatedAt = clean(options.generatedAt) || nowIso();
  const runId = clean(options.runId) || `post-merge-verification-${generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const doc = inputs.doc || { exists: false, text: "" };
  const artifactValidation = summarizeArtifactValidation(inputs.artifactValidation || {});
  const workPacketQuality = summarizeWorkPacketQuality(inputs.workPacketQuality || {});
  const staleBacklog = summarizeStaleBacklog(inputs.staleBacklog || {});
  const prStack = summarizePrStack(inputs.prStack || {});
  const gitState = currentGitState(options);
  const approvalGateCount = countApprovalGates(doc.text);
  const warnings = [];
  if (!doc.exists) warnings.push("post-merge verification doc is missing");
  if (gitState.dirtyFiles.length > 0) warnings.push(`working tree has ${gitState.dirtyFiles.length} dirty file(s)`);
  if (artifactValidation.status && artifactValidation.status !== "pass") warnings.push(`artifact validation status=${artifactValidation.status}`);
  if (workPacketQuality.findings > 0) warnings.push(`work-packet quality findings=${workPacketQuality.findings}`);
  if (staleBacklog.candidates > 0) warnings.push(`stale backlog candidates=${staleBacklog.candidates}`);
  if (prStack.openLowerBound > 0 && prStack.mergeReady === 0) warnings.push("PR stack has no merge-ready PRs in the latest steering digest");
  const status = artifactValidation.status === "fail" || !doc.exists ? "fail" : warnings.length > 0 ? "warn" : "pass";
  return {
    schema: "studiobrain-post-merge-verification-packet.v1",
    generatedAt,
    runId,
    status,
    readOnly: true,
    scope: {
      branch: clean(gitState.branch),
      head: clean(gitState.head),
      dirtyFiles: gitState.dirtyFiles.map(clean).filter(Boolean),
    },
    sources: {
      doc: clean(options.docPath) || repoRelative(DEFAULT_DOC),
      artifactValidation: clean(options.artifactValidationPath) || repoRelative(DEFAULT_ARTIFACT_VALIDATION),
      workPacketQuality: clean(options.workPacketQualityPath) || repoRelative(DEFAULT_WORK_PACKET_QUALITY),
      staleBacklog: clean(options.staleBacklogPath) || repoRelative(DEFAULT_STALE_BACKLOG),
      prStack: clean(options.prStackPath) || repoRelative(DEFAULT_PR_STACK),
    },
    summary: {
      docExists: Boolean(doc.exists),
      approvalGates: approvalGateCount,
      dirtyFiles: gitState.dirtyFiles.length,
      artifactValidationStatus: artifactValidation.status || "missing",
      artifactValidationFailed: artifactValidation.failed,
      workPacketQualityFindings: workPacketQuality.findings,
      staleBacklogCandidates: staleBacklog.candidates,
      prStackOpenLowerBound: prStack.openLowerBound,
      prStackMergeReady: prStack.mergeReady,
      recommendedSteering: prStack.recommendedSteering,
    },
    evidence: {
      artifactValidation,
      workPacketQuality,
      staleBacklog,
      prStack,
    },
    warnings,
    safeNextSteps: [
      "Regenerate ops CI validation before relying on this packet for PR review.",
      "Keep deploys, restarts, package updates, firewall changes, cleanup, and database mutations behind explicit owner approval.",
      "Attach this packet to the post-merge verification issue or PR handoff when closing the ready work packet.",
    ],
  };
}

function renderMarkdown(packet) {
  const warnings = packet.warnings.map((warning) => `- ${warning}`).join("\n") || "- None.";
  const dirty = packet.scope.dirtyFiles.map((file) => `- ${file}`).join("\n") || "- None.";
  const next = packet.safeNextSteps.map((step) => `- ${step}`).join("\n");
  return `# Post-Merge Verification Packet

Generated: ${packet.generatedAt}
Status: ${packet.status}
Run ID: ${packet.runId}

## Scope

- Branch: ${packet.scope.branch}
- Head: ${packet.scope.head}
- Dirty files: ${packet.summary.dirtyFiles}

## Summary

- Verification doc exists: ${packet.summary.docExists}
- Approval gates: ${packet.summary.approvalGates}
- Artifact validation: ${packet.summary.artifactValidationStatus} (failed=${packet.summary.artifactValidationFailed})
- Work-packet quality findings: ${packet.summary.workPacketQualityFindings}
- Stale backlog candidates: ${packet.summary.staleBacklogCandidates}
- PR stack lower-bound open PRs: ${packet.summary.prStackOpenLowerBound}
- PR stack merge-ready count: ${packet.summary.prStackMergeReady}
- PR stack steering: ${packet.summary.recommendedSteering || ""}

## Warnings

${warnings}

## Dirty Files

${dirty}

## Safe Next Steps

${next}
`;
}

function writeArtifacts(options, packet) {
  mkdirSync(options.outputDir, { recursive: true });
  const jsonPath = resolve(options.outputDir, `${packet.runId}.json`);
  const markdownPath = resolve(options.outputDir, `${packet.runId}.md`);
  const latestJson = resolve(options.outputDir, "post-merge-verification-latest.json");
  const latestMarkdown = resolve(options.outputDir, "post-merge-verification-latest.md");
  writeFileSync(jsonPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderMarkdown(packet), "utf8");
  writeFileSync(latestJson, `${JSON.stringify({ ...packet, artifactPath: repoRelative(jsonPath), markdownPath: repoRelative(markdownPath) }, null, 2)}\n`, "utf8");
  writeFileSync(latestMarkdown, renderMarkdown(packet), "utf8");
  return {
    jsonPath: repoRelative(jsonPath),
    markdownPath: repoRelative(markdownPath),
    latestJson: repoRelative(latestJson),
    latestMarkdown: repoRelative(latestMarkdown),
  };
}

function run(rawArgs = process.argv.slice(2)) {
  try {
    const options = parseArgs(rawArgs);
    const packet = buildPostMergeVerificationPacket(
      {
        doc: readTextIfExists(options.doc),
        artifactValidation: readJsonIfExists(options.artifactValidation),
        workPacketQuality: readJsonIfExists(options.workPacketQuality),
        staleBacklog: readJsonIfExists(options.staleBacklog),
        prStack: readJsonIfExists(options.prStack),
      },
      {
        runId: options.runId,
        docPath: repoRelative(options.doc),
        artifactValidationPath: repoRelative(options.artifactValidation),
        workPacketQualityPath: repoRelative(options.workPacketQuality),
        staleBacklogPath: repoRelative(options.staleBacklog),
        prStackPath: repoRelative(options.prStack),
      },
    );
    if (options.write) packet.artifacts = writeArtifacts(options, packet);
    if (options.json) process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
    else process.stdout.write(`post-merge verification: ${packet.status}, warnings=${packet.warnings.length}\n`);
    return packet;
  } catch (error) {
    process.stderr.write(`post_merge_verification_packet failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return null;
  }
}

export { buildPostMergeVerificationPacket, renderMarkdown };

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  run();
}
