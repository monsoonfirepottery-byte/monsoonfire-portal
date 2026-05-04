#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_SOURCE = "wiki/00_source_index/extracted-facts.jsonl";
const DEFAULT_APPROVAL_STATE = "wiki/00_source_index/human-gate-approval-state.json";
const DEFAULT_ARTIFACT = "output/wiki/human-gates-approval-packets.json";
const DEFAULT_MARKDOWN = "output/wiki/human-gates-approval-packets.md";
const APPROVAL_STATES = new Set(["pending", "approved", "rejected", "superseded"]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseArgs(argv) {
  const args = {
    json: false,
    source: DEFAULT_SOURCE,
    approvalState: DEFAULT_APPROVAL_STATE,
    artifact: DEFAULT_ARTIFACT,
    markdown: DEFAULT_MARKDOWN,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    const readValue = (name) => {
      if (arg === name && argv[index + 1]) {
        index += 1;
        return argv[index];
      }
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
      return null;
    };
    const source = readValue("--source");
    if (source !== null) {
      args.source = source;
      continue;
    }
    const artifact = readValue("--artifact");
    if (artifact !== null) {
      args.artifact = artifact;
      continue;
    }
    const approvalState = readValue("--approval-state");
    if (approvalState !== null) {
      args.approvalState = approvalState;
      continue;
    }
    const markdown = readValue("--markdown");
    if (markdown !== null) {
      args.markdown = markdown;
    }
  }
  return args;
}

function parseJsonl(path) {
  if (!existsSync(path)) {
    throw new Error(`Human-gates source artifact does not exist: ${path}`);
  }
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at ${path}:${index + 1}: ${error.message}`);
      }
    });
}

function readJsonIfPresent(path) {
  if (!path || !existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function categoryFor(claim) {
  const subjectKey = clean(claim?.subjectKey);
  if (subjectKey.startsWith("policy-doc:") || clean(claim?.claimKind) === "policy") return "policy-doc";
  if (subjectKey.startsWith("package-script:")) return "package-procedure";
  if (subjectKey.startsWith("source-of-truth:")) return "source-of-truth";
  return "other";
}

function sourceRefsFor(claim) {
  const refs = Array.isArray(claim?.sourceRefs) ? claim.sourceRefs : [];
  return refs.map((ref) => ({
    sourcePath: clean(ref?.sourcePath) || null,
    lineStart: Number.isInteger(ref?.lineStart) ? ref.lineStart : null,
    lineEnd: Number.isInteger(ref?.lineEnd) ? ref.lineEnd : null,
    refRole: clean(ref?.refRole) || null,
    sourceId: clean(ref?.sourceId) || null,
    chunkId: clean(ref?.chunkId) || null,
  }));
}

function summarizeByCategory(packets) {
  return packets.reduce((summary, packet) => {
    summary[packet.category] = (summary[packet.category] || 0) + 1;
    return summary;
  }, {});
}

function approvalStateByClaim(path) {
  const artifact = readJsonIfPresent(path);
  const items = Array.isArray(artifact?.items) ? artifact.items : [];
  return new Map(items
    .filter((item) => clean(item?.claimId))
    .map((item) => {
      const approvalState = APPROVAL_STATES.has(clean(item.approvalState)) ? clean(item.approvalState) : "pending";
      return [clean(item.claimId), approvalState];
    }));
}

function buildReviewBundles(packets) {
  const labels = {
    "policy-doc": "Policy Docs",
    "package-procedure": "Package Procedures",
    "source-of-truth": "Source-of-Truth Claim",
    other: "Other",
  };
  return Object.entries(packets.reduce((groups, packet) => {
    groups[packet.category] ||= [];
    groups[packet.category].push(packet);
    return groups;
  }, {}))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, groupedPackets]) => ({
      category,
      label: labels[category] || category,
      claims: groupedPackets.length,
      approvalEffects: "none",
      packetIds: groupedPackets.map((packet) => packet.claimId),
      reviewerChecklist: [
        "Verify the cited source still says this.",
        "Choose pending, approved, rejected, or superseded in the tracked approval-state artifact.",
        "Do not promote the claim from this packet alone.",
      ],
    }));
}

function buildPacket(claim, stateByClaim) {
  const sourceRefs = sourceRefsFor(claim);
  const primarySource = sourceRefs.find((ref) => ref.sourcePath) || null;
  const category = categoryFor(claim);
  const claimId = clean(claim?.claimId);
  return {
    claimId,
    category,
    approvalState: stateByClaim.get(claimId) || "pending",
    reviewStatus: "pending_human_review",
    allowedOutcomes: ["pending", "approved", "rejected", "superseded"],
    nonApprovalGuard: "This packet prepares review context only; it does not approve or promote the claim.",
    claim: {
      kind: clean(claim?.claimKind),
      subjectKey: clean(claim?.subjectKey),
      predicateKey: clean(claim?.predicateKey),
      objectText: clean(claim?.objectText),
      truthStatus: clean(claim?.truthStatus),
      confidence: typeof claim?.confidence === "number" ? claim.confidence : null,
      owner: clean(claim?.owner) || null,
      authorityClass: clean(claim?.authorityClass) || null,
      agentAllowedUse: clean(claim?.agentAllowedUse) || null,
      humanApprovalReason: clean(claim?.humanApprovalReason) || null,
    },
    evidence: {
      primarySourcePath: primarySource?.sourcePath || clean(claim?.sourcePath) || null,
      sourceRefs,
      citationChecklist: [
        "Open every listed source reference and verify the claim text against the cited lines.",
        "Confirm the policy or operational owner is correct for this claim.",
        "Record the human decision separately before any promotion or customer-facing use.",
      ],
    },
    reviewerPrompt: `Review ${claimId} and update the tracked approval state to pending, approved, rejected, or superseded.`,
  };
}

export function buildWikiHumanGateApprovalPackets(options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const sourcePath = resolve(repoRoot, options.source || DEFAULT_SOURCE);
  const approvalStatePath = resolve(repoRoot, options.approvalState || DEFAULT_APPROVAL_STATE);
  const artifactPath = resolve(repoRoot, options.artifact || DEFAULT_ARTIFACT);
  const markdownPath = resolve(repoRoot, options.markdown || DEFAULT_MARKDOWN);
  const claims = parseJsonl(sourcePath);
  const stateByClaim = approvalStateByClaim(approvalStatePath);
  const packets = claims
    .filter((claim) => Boolean(claim?.requiresHumanApproval))
    .map((claim) => buildPacket(claim, stateByClaim))
    .sort((a, b) => a.category.localeCompare(b.category) || a.claim.subjectKey.localeCompare(b.claim.subjectKey));
  const reviewBundles = buildReviewBundles(packets);
  const report = {
    schema: "wiki-human-gates-approval-packets.v1",
    generatedAt: new Date().toISOString(),
    servesSystem: "studio-brain",
    operatingLayerImpact: "prepares_human_review_without_promotion",
    approvalEffects: "none",
    sourcePath,
    approvalStatePath,
    artifactPath,
    markdownPath,
    summary: {
      claims: packets.length,
      byCategory: summarizeByCategory(packets),
      bundles: reviewBundles.length,
      reviewStatus: "pending_human_review",
      approvalEffects: "none",
    },
    reviewBundles,
    packets,
  };

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  mkdirSync(dirname(markdownPath), { recursive: true });
  writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  return report;
}

function renderMarkdown(report) {
  const lines = [
    "# Wiki Human-Gate Approval Packets",
    "",
    `Generated: ${report.generatedAt}`,
    `Source: ${report.sourcePath}`,
    `Approval state: ${report.approvalStatePath}`,
    `Claims: ${report.summary.claims}`,
    `Serves: ${report.servesSystem}`,
    `Operating layer impact: ${report.operatingLayerImpact}`,
    "Approval effects: none",
    "",
    "These packets prepare human review context only. They do not approve, reject, verify, or promote any claim.",
    "",
    "## Categories",
    "",
  ];
  for (const [category, count] of Object.entries(report.summary.byCategory).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`- ${category}: ${count}`);
  }
  lines.push("", "## Review Bundles", "");
  for (const bundle of report.reviewBundles) {
    lines.push(`### ${bundle.label}`);
    lines.push("");
    lines.push(`- claims: ${bundle.claims}`);
    lines.push(`- approval effects: ${bundle.approvalEffects}`);
    lines.push(`- packet ids: ${bundle.packetIds.join(", ")}`);
    lines.push("");
  }
  lines.push("## Packets", "");
  for (const packet of report.packets) {
    lines.push(`### ${packet.claimId}`);
    lines.push("");
    lines.push(`- status: ${packet.reviewStatus}`);
    lines.push(`- approval state: ${packet.approvalState}`);
    lines.push(`- category: ${packet.category}`);
    lines.push(`- subject: ${packet.claim.subjectKey}`);
    lines.push(`- owner: ${packet.claim.owner || "unknown"}`);
    lines.push(`- allowed outcomes: ${packet.allowedOutcomes.join(", ")}`);
    lines.push(`- source: ${packet.evidence.primarySourcePath || "unknown"}`);
    lines.push(`- claim: ${packet.claim.objectText || "unknown"}`);
    lines.push(`- prompt: ${packet.reviewerPrompt}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function printHumanSummary(report) {
  process.stdout.write("Wiki human-gate approval packets\n");
  process.stdout.write(`  claims: ${report.summary.claims}\n`);
  process.stdout.write("  approval effects: none\n");
  process.stdout.write(`  bundles: ${report.summary.bundles}\n`);
  for (const [category, count] of Object.entries(report.summary.byCategory).sort(([a], [b]) => a.localeCompare(b))) {
    process.stdout.write(`  ${category}: ${count}\n`);
  }
  process.stdout.write(`  artifact: ${report.artifactPath}\n`);
  process.stdout.write(`  markdown: ${report.markdownPath}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildWikiHumanGateApprovalPackets(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHumanSummary(report);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
