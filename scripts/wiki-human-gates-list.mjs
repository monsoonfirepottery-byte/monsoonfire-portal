#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_SOURCE = "wiki/00_source_index/extracted-facts.jsonl";
const DEFAULT_ARTIFACT = "output/wiki/human-gates.json";
const DEFAULT_MARKDOWN = "output/wiki/human-gates.md";
const DEFAULT_SNAPSHOT = "wiki/00_source_index/human-gates-snapshot.json";
const DEFAULT_APPROVAL_STATE = "wiki/00_source_index/human-gate-approval-state.json";
const APPROVAL_STATES = new Set(["pending", "approved", "rejected", "superseded"]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function fullHash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function parseArgs(argv) {
  const args = {
    json: false,
    source: DEFAULT_SOURCE,
    artifact: DEFAULT_ARTIFACT,
    markdown: DEFAULT_MARKDOWN,
    snapshot: "",
    approvalState: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--tracked") {
      args.snapshot = DEFAULT_SNAPSHOT;
      args.approvalState = DEFAULT_APPROVAL_STATE;
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
      continue;
    }
    const snapshot = readValue("--snapshot");
    if (snapshot !== null) {
      args.snapshot = snapshot;
      continue;
    }
    const approvalState = readValue("--approval-state");
    if (approvalState !== null) {
      args.approvalState = approvalState;
    }
  }
  return args;
}

function resolveRepoPath(repoRoot, path) {
  return resolve(repoRoot, path);
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

function sourcePathFor(claim) {
  return clean(claim?.sourceRefs?.[0]?.sourcePath) || clean(claim?.sourcePath) || null;
}

function categoryFor(claim) {
  const subjectKey = clean(claim?.subjectKey);
  if (subjectKey.startsWith("policy-doc:") || clean(claim?.claimKind) === "policy") return "policy-doc";
  if (subjectKey.startsWith("package-script:")) return "package-procedure";
  if (subjectKey.startsWith("source-of-truth:")) return "source-of-truth";
  return "other";
}

function summarizeByCategory(items) {
  return items.reduce((summary, item) => {
    summary[item.category] = (summary[item.category] || 0) + 1;
    return summary;
  }, {});
}

function summarizeByApprovalState(items) {
  return items.reduce((summary, item) => {
    summary[item.approvalState] = (summary[item.approvalState] || 0) + 1;
    return summary;
  }, {});
}

function sourceRefsFor(claim) {
  const refs = Array.isArray(claim?.sourceRefs) ? claim.sourceRefs : [];
  return refs.map((ref) => ({
    sourcePath: clean(ref?.sourcePath) || null,
    lineStart: Number.isInteger(ref?.lineStart) ? ref.lineStart : null,
    lineEnd: Number.isInteger(ref?.lineEnd) ? ref.lineEnd : null,
  }));
}

function existingApprovalStateByClaim(path) {
  const state = readJsonIfPresent(path);
  const items = Array.isArray(state?.items) ? state.items : [];
  return new Map(items
    .filter((item) => clean(item?.claimId))
    .map((item) => {
      const approvalState = APPROVAL_STATES.has(clean(item.approvalState)) ? clean(item.approvalState) : "pending";
      return [clean(item.claimId), {
        approvalState,
        decidedBy: clean(item.decidedBy) || null,
        decidedAt: clean(item.decidedAt) || null,
        decisionSource: clean(item.decisionSource) || null,
        notes: clean(item.notes) || "",
      }];
    }));
}

function chooseSafePromotionCandidate(items) {
  return items.find((item) => item.category === "source-of-truth" && item.approvalState === "pending") ||
    items.find((item) => item.category === "package-procedure" && item.approvalState === "pending") ||
    null;
}

function buildApprovalStateArtifact(items, sourcePath) {
  const stateItems = items.map((item) => ({
    claimId: item.claimId,
    category: item.category,
    sourcePath: item.sourcePath,
    approvalState: item.approvalState,
    decidedBy: item.decidedBy || null,
    decidedAt: item.decidedAt || null,
    decisionSource: item.decisionSource || null,
    notes: item.notes || "",
  }));
  const stateHash = fullHash(JSON.stringify(stateItems));
  return {
    schema: "wiki-human-gate-approval-state.v1",
    sourcePath,
    stateHash,
    approvalStates: [...APPROVAL_STATES].sort(),
    approvalEffects: "none",
    promotionGuard: "Approved state records eligibility only; claim promotion requires a separate tracked source/edit with human approval metadata.",
    summary: {
      claims: stateItems.length,
      byState: summarizeByApprovalState(stateItems),
    },
    items: stateItems,
  };
}

function buildTrackedSnapshot(items, sourcePath) {
  const candidate = chooseSafePromotionCandidate(items);
  const snapshotItems = items.map((item) => ({
    claimId: item.claimId,
    category: item.category,
    subjectKey: item.subjectKey,
    sourcePath: item.sourcePath,
    approvalState: item.approvalState,
    owner: item.owner,
    humanApprovalReason: item.humanApprovalReason,
    safePromotionCandidate: candidate?.claimId === item.claimId,
    sourceRefs: item.sourceRefs,
  }));
  const snapshotHash = fullHash(JSON.stringify(snapshotItems));
  return {
    schema: "wiki-human-gates-snapshot.v1",
    sourcePath,
    snapshotHash,
    approvalEffects: "none",
    noPromotionWithoutHumanApproval: true,
    summary: {
      claims: snapshotItems.length,
      byCategory: summarizeByCategory(snapshotItems),
      byState: summarizeByApprovalState(snapshotItems),
      safePromotionCandidateClaimId: candidate?.claimId || null,
      safePromotionCandidateReason: candidate
        ? "Lowest-risk approval workflow fixture candidate; packet generation only, no promotion side effects."
        : null,
    },
    items: snapshotItems,
  };
}

export function listWikiHumanGates(options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const sourcePath = resolveRepoPath(repoRoot, options.source || DEFAULT_SOURCE);
  const artifactPath = resolveRepoPath(repoRoot, options.artifact || DEFAULT_ARTIFACT);
  const markdownPath = resolveRepoPath(repoRoot, options.markdown || DEFAULT_MARKDOWN);
  const snapshotPath = options.snapshot ? resolveRepoPath(repoRoot, options.snapshot) : "";
  const approvalStatePath = options.approvalState ? resolveRepoPath(repoRoot, options.approvalState) : "";
  const existingState = approvalStatePath ? existingApprovalStateByClaim(approvalStatePath) : new Map();
  const claims = parseJsonl(sourcePath);
  const items = claims
    .filter((claim) => Boolean(claim?.requiresHumanApproval))
    .map((claim) => {
      const claimId = clean(claim.claimId);
      const state = existingState.get(claimId) || {};
      return {
        claimId,
        claimKind: clean(claim.claimKind),
        subjectKey: clean(claim.subjectKey),
        category: categoryFor(claim),
        sourcePath: sourcePathFor(claim),
        sourceRefs: sourceRefsFor(claim),
        objectText: clean(claim.objectText),
        owner: clean(claim.owner) || null,
        humanApprovalReason: clean(claim.humanApprovalReason) || null,
        approvalState: state.approvalState || "pending",
        decidedBy: state.decidedBy || null,
        decidedAt: state.decidedAt || null,
        decisionSource: state.decisionSource || null,
        notes: state.notes || "",
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.subjectKey.localeCompare(b.subjectKey));
  const stateArtifact = approvalStatePath ? buildApprovalStateArtifact(items, options.source || DEFAULT_SOURCE) : null;
  const trackedSnapshot = snapshotPath ? buildTrackedSnapshot(items, options.source || DEFAULT_SOURCE) : null;
  const report = {
    schema: "wiki-human-gates-report.v1",
    generatedAt: new Date().toISOString(),
    servesSystem: "studio-brain",
    operatingLayerImpact: "blocked_from_operational_truth_until_human_approved",
    approvalEffects: "none",
    sourcePath,
    artifactPath,
    markdownPath,
    snapshotPath: snapshotPath || null,
    approvalStatePath: approvalStatePath || null,
    summary: {
      claims: items.length,
      byCategory: summarizeByCategory(items),
      byState: summarizeByApprovalState(items),
      safePromotionCandidateClaimId: trackedSnapshot?.summary.safePromotionCandidateClaimId || null,
    },
    items,
    trackedSnapshot,
    approvalState: stateArtifact,
  };

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  mkdirSync(dirname(markdownPath), { recursive: true });
  writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  if (approvalStatePath && stateArtifact) {
    mkdirSync(dirname(approvalStatePath), { recursive: true });
    writeFileSync(approvalStatePath, `${JSON.stringify(stateArtifact, null, 2)}\n`, "utf8");
  }
  if (snapshotPath && trackedSnapshot) {
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, `${JSON.stringify(trackedSnapshot, null, 2)}\n`, "utf8");
  }
  return report;
}

function renderMarkdown(report) {
  const lines = [
    "# Wiki Human-Gated Claims",
    "",
    `Generated: ${report.generatedAt}`,
    `Source: ${report.sourcePath}`,
    `Claims: ${report.summary.claims}`,
    `Serves: ${report.servesSystem}`,
    `Operating layer impact: ${report.operatingLayerImpact}`,
    "Approval effects: none",
    `Approval state: ${report.approvalStatePath || "not written"}`,
    `Tracked snapshot: ${report.snapshotPath || "not written"}`,
    "",
    "## Categories",
    "",
  ];
  for (const [category, count] of Object.entries(report.summary.byCategory).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`- ${category}: ${count}`);
  }
  lines.push("", "## Approval States", "");
  for (const [state, count] of Object.entries(report.summary.byState).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`- ${state}: ${count}`);
  }
  if (report.summary.safePromotionCandidateClaimId) {
    lines.push("", "## First Safe Promotion Candidate", "");
    lines.push(`- ${report.summary.safePromotionCandidateClaimId}`);
    lines.push("- packet-only workflow test candidate; no promotion side effects");
  }
  lines.push("", "## Claims", "");
  for (const item of report.items) {
    lines.push(`- ${item.claimId} [${item.category}; ${item.approvalState}] ${item.subjectKey}`);
    lines.push(`  - source: ${item.sourcePath || "unknown"}`);
    lines.push(`  - text: ${item.objectText || "unknown"}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function printHumanSummary(report) {
  process.stdout.write("Wiki human-gated claims\n");
  process.stdout.write(`  claims: ${report.summary.claims}\n`);
  process.stdout.write(`  states: ${JSON.stringify(report.summary.byState)}\n`);
  for (const [category, count] of Object.entries(report.summary.byCategory).sort(([a], [b]) => a.localeCompare(b))) {
    process.stdout.write(`  ${category}: ${count}\n`);
  }
  if (report.summary.safePromotionCandidateClaimId) {
    process.stdout.write(`  safe promotion candidate: ${report.summary.safePromotionCandidateClaimId}\n`);
  }
  process.stdout.write(`  artifact: ${report.artifactPath}\n`);
  process.stdout.write(`  markdown: ${report.markdownPath}\n`);
  if (report.approvalStatePath) process.stdout.write(`  approval state: ${report.approvalStatePath}\n`);
  if (report.snapshotPath) process.stdout.write(`  snapshot: ${report.snapshotPath}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = listWikiHumanGates(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHumanSummary(report);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
