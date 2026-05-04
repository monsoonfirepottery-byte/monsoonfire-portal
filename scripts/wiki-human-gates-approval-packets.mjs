#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_SOURCE = "wiki/00_source_index/extracted-facts.jsonl";
const DEFAULT_ARTIFACT = "output/wiki/human-gates-approval-packets.json";
const DEFAULT_MARKDOWN = "output/wiki/human-gates-approval-packets.md";

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseArgs(argv) {
  const args = {
    json: false,
    source: DEFAULT_SOURCE,
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

function buildPacket(claim) {
  const sourceRefs = sourceRefsFor(claim);
  const primarySource = sourceRefs.find((ref) => ref.sourcePath) || null;
  const category = categoryFor(claim);
  return {
    claimId: clean(claim?.claimId),
    category,
    reviewStatus: "pending_human_review",
    allowedOutcomes: ["approve_with_citation", "reject", "keep_gated"],
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
    reviewerPrompt: `Review ${clean(claim?.claimId)} and choose approve_with_citation, reject, or keep_gated.`,
  };
}

export function buildWikiHumanGateApprovalPackets(options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const sourcePath = resolve(repoRoot, options.source || DEFAULT_SOURCE);
  const artifactPath = resolve(repoRoot, options.artifact || DEFAULT_ARTIFACT);
  const markdownPath = resolve(repoRoot, options.markdown || DEFAULT_MARKDOWN);
  const claims = parseJsonl(sourcePath);
  const packets = claims
    .filter((claim) => Boolean(claim?.requiresHumanApproval))
    .map(buildPacket)
    .sort((a, b) => a.category.localeCompare(b.category) || a.claim.subjectKey.localeCompare(b.claim.subjectKey));
  const report = {
    schema: "wiki-human-gates-approval-packets.v1",
    generatedAt: new Date().toISOString(),
    servesSystem: "studio-brain",
    operatingLayerImpact: "prepares_human_review_without_promotion",
    approvalEffects: "none",
    sourcePath,
    artifactPath,
    markdownPath,
    summary: {
      claims: packets.length,
      byCategory: summarizeByCategory(packets),
      reviewStatus: "pending_human_review",
      approvalEffects: "none",
    },
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
  lines.push("", "## Packets", "");
  for (const packet of report.packets) {
    lines.push(`### ${packet.claimId}`);
    lines.push("");
    lines.push(`- status: ${packet.reviewStatus}`);
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
