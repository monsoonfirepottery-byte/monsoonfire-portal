#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_CONTEXT_CANDIDATES = ["output/wiki/context-refresh.json", "output/wiki/context-check.json"];
const DEFAULT_CLAIMS = "wiki/00_source_index/extracted-facts.jsonl";
const DEFAULT_HUMAN_GATES = "output/wiki/human-gates.json";
const DEFAULT_ARTIFACT = "output/studio-brain/audits/wiki-startup-pack-audit-latest.json";
const DEFAULT_MARKDOWN = "output/studio-brain/audits/wiki-startup-pack-audit-latest.md";
const DEFAULT_MAX_CHARS = 4000;
const DEFAULT_MAX_WARNING_ITEMS = 50;

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(argv) {
  const args = {
    json: false,
    strict: false,
    context: "",
    claims: DEFAULT_CLAIMS,
    humanGates: DEFAULT_HUMAN_GATES,
    artifact: DEFAULT_ARTIFACT,
    markdown: DEFAULT_MARKDOWN,
    maxChars: DEFAULT_MAX_CHARS,
    maxWarningItems: DEFAULT_MAX_WARNING_ITEMS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--strict") {
      args.strict = true;
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
    for (const [flag, key] of Object.entries({
      "--context": "context",
      "--claims": "claims",
      "--human-gates": "humanGates",
      "--artifact": "artifact",
      "--markdown": "markdown",
    })) {
      const value = readValue(flag);
      if (value !== null) {
        args[key] = value;
        break;
      }
    }
    const maxChars = readValue("--max-chars");
    if (maxChars !== null) args.maxChars = parsePositiveInteger(maxChars, args.maxChars);
    const maxWarningItems = readValue("--max-warning-items");
    if (maxWarningItems !== null) args.maxWarningItems = parsePositiveInteger(maxWarningItems, args.maxWarningItems);
  }
  return args;
}

function resolveRepoPath(repoRoot, path) {
  return resolve(repoRoot, path);
}

function readJson(path, findings, code) {
  if (!existsSync(path)) {
    findings.push({
      severity: "error",
      code,
      message: "Required JSON artifact is missing.",
      details: { path },
    });
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    findings.push({
      severity: "error",
      code: `${code}-malformed`,
      message: "Required JSON artifact is malformed.",
      details: { path, error: error instanceof Error ? error.message : String(error) },
    });
    return null;
  }
}

function readJsonl(path, findings) {
  if (!existsSync(path)) {
    findings.push({
      severity: "error",
      code: "missing-extracted-facts",
      message: "Extracted facts artifact is missing.",
      details: { path },
    });
    return [];
  }
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        findings.push({
          severity: "error",
          code: "malformed-extracted-facts",
          message: "Extracted facts JSONL contains a malformed row.",
          details: { path, line: index + 1, error: error instanceof Error ? error.message : String(error) },
        });
        return null;
      }
    })
    .filter(Boolean);
}

function findDefaultContextPath(repoRoot) {
  for (const candidate of DEFAULT_CONTEXT_CANDIDATES) {
    const path = resolveRepoPath(repoRoot, candidate);
    if (existsSync(path)) return path;
  }
  return resolveRepoPath(repoRoot, DEFAULT_CONTEXT_CANDIDATES[0]);
}

function contextPackFrom(contextArtifact) {
  if (!contextArtifact || typeof contextArtifact !== "object") return null;
  return contextArtifact.contextPack && typeof contextArtifact.contextPack === "object"
    ? contextArtifact.contextPack
    : contextArtifact;
}

function sourceRefsFor(claim) {
  return Array.isArray(claim?.sourceRefs) ? claim.sourceRefs.filter((ref) => clean(ref?.sourcePath)) : [];
}

function deriveHumanGateCount(humanGatesArtifact, claims) {
  const explicit = Number(humanGatesArtifact?.summary?.claims);
  if (Number.isFinite(explicit)) return explicit;
  return claims.filter((claim) => Boolean(claim?.requiresHumanApproval)).length;
}

function deriveStatus(findings) {
  if (findings.some((finding) => finding.severity === "error")) return "fail";
  if (findings.some((finding) => finding.severity === "warning")) return "warn";
  return "pass";
}

export function auditWikiStartupPack(options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const findings = [];
  const contextPath = options.context
    ? resolveRepoPath(repoRoot, options.context)
    : findDefaultContextPath(repoRoot);
  const claimsPath = resolveRepoPath(repoRoot, options.claims || DEFAULT_CLAIMS);
  const humanGatesPath = resolveRepoPath(repoRoot, options.humanGates || DEFAULT_HUMAN_GATES);
  const artifactPath = resolveRepoPath(repoRoot, options.artifact || DEFAULT_ARTIFACT);
  const markdownPath = resolveRepoPath(repoRoot, options.markdown || DEFAULT_MARKDOWN);
  const maxChars = parsePositiveInteger(options.maxChars, DEFAULT_MAX_CHARS);
  const maxWarningItems = parsePositiveInteger(options.maxWarningItems, DEFAULT_MAX_WARNING_ITEMS);

  const contextArtifact = readJson(contextPath, findings, "missing-context-pack-artifact");
  const claims = readJsonl(claimsPath, findings);
  const humanGatesArtifact = existsSync(humanGatesPath) ? readJson(humanGatesPath, findings, "malformed-human-gates-artifact") : null;
  const pack = contextPackFrom(contextArtifact);
  if (!pack) {
    findings.push({
      severity: "error",
      code: "missing-context-pack",
      message: "Context artifact did not contain a context pack.",
      details: { contextPath },
    });
  }

  const claimById = new Map(claims.map((claim) => [claim.claimId, claim]));
  const items = Array.isArray(pack?.items) ? pack.items : [];
  const generatedText = clean(pack?.generatedText);
  const chars = Number(pack?.budget?.chars ?? generatedText.length);
  const includedClaims = items
    .map((item) => claimById.get(clean(item?.itemId)))
    .filter(Boolean);
  const includedUnverified = includedClaims.filter((claim) => !["VERIFIED", "OPERATIONAL_TRUTH"].includes(clean(claim.status)));
  const includedHumanGated = includedClaims.filter((claim) => Boolean(claim.requiresHumanApproval));
  const includedMissingSources = includedClaims.filter((claim) => sourceRefsFor(claim).length === 0);
  const verifiedClaims = Number(pack?.budget?.verifiedClaims ?? items.length);
  const totalWarningItems = Number(pack?.budget?.totalWarningItems ?? pack?.warnings?.length ?? 0);
  const warningCount = Number(pack?.budget?.warningCount ?? pack?.warnings?.length ?? 0);
  const humanGatedClaims = deriveHumanGateCount(humanGatesArtifact, claims);
  const activeContradictions = Number(pack?.budget?.activeContradictionCount ?? 0);
  const outcomeVerdict = clean(pack?.budget?.outcomeVerdict) || "unknown";

  if (includedUnverified.length > 0) {
    findings.push({
      severity: "error",
      code: "context-pack-includes-unverified-claims",
      message: "Context pack includes claims that are not VERIFIED or OPERATIONAL_TRUTH.",
      details: { claimIds: includedUnverified.map((claim) => claim.claimId) },
    });
  }
  if (includedHumanGated.length > 0) {
    findings.push({
      severity: "error",
      code: "context-pack-includes-human-gated-claims",
      message: "Context pack includes claims requiring human approval.",
      details: { claimIds: includedHumanGated.map((claim) => claim.claimId) },
    });
  }
  if (includedMissingSources.length > 0) {
    findings.push({
      severity: "error",
      code: "context-pack-claim-source-refs-missing",
      message: "Included context-pack claims are missing source references.",
      details: { claimIds: includedMissingSources.map((claim) => claim.claimId) },
    });
  }
  if (chars > maxChars) {
    findings.push({
      severity: "error",
      code: "context-pack-too-large-for-startup",
      message: "Context pack exceeds the startup character budget.",
      details: { chars, maxChars },
    });
  }
  if (verifiedClaims === 0) {
    findings.push({
      severity: "warning",
      code: "no-verified-startup-claims",
      message: "Context pack has no verified claims; startup should use repo/source reads instead.",
      details: { verifiedClaims },
    });
  }
  if (totalWarningItems > maxWarningItems) {
    findings.push({
      severity: "warning",
      code: "startup-warning-volume-too-high",
      message: "Context pack warning volume is too broad for startup use.",
      details: { totalWarningItems, maxWarningItems },
    });
  }
  if (humanGatedClaims > 0) {
    findings.push({
      severity: "warning",
      code: "human-gated-claims-await-approval",
      message: "Human-gated claims are present and must remain approval-only.",
      details: { humanGatedClaims },
    });
  }
  if (["insufficient_real_usage", "needs_tuning"].includes(outcomeVerdict)) {
    findings.push({
      severity: "warning",
      code: "wiki-usefulness-not-proven",
      message: "Wiki usefulness signals are not strong enough to widen startup use.",
      details: { outcomeVerdict },
    });
  }

  const failCount = findings.filter((finding) => finding.severity === "error").length;
  const startupEligible = failCount === 0 && verifiedClaims > 0 && warningCount <= maxWarningItems;
  const report = {
    schema: "wiki-startup-pack-audit.v1",
    generatedAt: new Date().toISOString(),
    status: deriveStatus(findings),
    startupEligible,
    packKey: clean(pack?.packKey) || null,
    contextPackId: clean(pack?.contextPackId) || null,
    snapshotHash: clean(pack?.snapshotHash) || null,
    paths: {
      contextPath,
      claimsPath,
      humanGatesPath,
      artifactPath,
      markdownPath,
    },
    thresholds: {
      maxChars,
      maxWarningItems,
    },
    operatingLayer: {
      role: clean(pack?.operatingLayerRole) || "compiled_operating_layer",
      servesSystem: clean(pack?.servesSystem) || "studio-brain",
      memoryRelationship: clean(pack?.memoryRelationship) || "not_a_competing_memory_source",
      sourceOfTruthMode: clean(pack?.sourceOfTruthMode) || "compiled_from_repo_and_postgres_claims",
    },
    metrics: {
      chars,
      verifiedClaims,
      warningCount,
      totalWarningItems,
      humanGatedClaims,
      activeContradictions,
      includedUnverifiedClaims: includedUnverified.length,
      includedHumanGatedClaims: includedHumanGated.length,
      includedMissingSourceRefs: includedMissingSources.length,
      outcomeVerdict,
    },
    findings,
  };

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  mkdirSync(dirname(markdownPath), { recursive: true });
  writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  return report;
}

function renderMarkdown(report) {
  const lines = [
    "# Wiki Startup Pack Audit",
    "",
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status}`,
    `Startup eligible: ${report.startupEligible}`,
    `Pack: ${report.packKey || "unknown"}`,
    `Snapshot: ${report.snapshotHash || "unknown"}`,
    "",
    "## Operating Layer",
    "",
    `- role: ${report.operatingLayer.role}`,
    `- serves: ${report.operatingLayer.servesSystem}`,
    `- memory relationship: ${report.operatingLayer.memoryRelationship}`,
    `- source mode: ${report.operatingLayer.sourceOfTruthMode}`,
    "",
    "## Metrics",
    "",
    `- chars: ${report.metrics.chars}`,
    `- verified claims: ${report.metrics.verifiedClaims}`,
    `- warning items: ${report.metrics.totalWarningItems}`,
    `- human-gated claims: ${report.metrics.humanGatedClaims}`,
    `- included unverified claims: ${report.metrics.includedUnverifiedClaims}`,
    "",
    "## Findings",
    "",
  ];
  if (report.findings.length === 0) {
    lines.push("- None.");
  } else {
    for (const finding of report.findings) {
      lines.push(`- ${finding.severity}: ${finding.code} - ${finding.message}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function printHumanSummary(report) {
  process.stdout.write("Wiki startup pack audit\n");
  process.stdout.write(`  status: ${report.status}\n`);
  process.stdout.write(`  startup eligible: ${report.startupEligible}\n`);
  process.stdout.write(`  verified claims: ${report.metrics.verifiedClaims}\n`);
  process.stdout.write(`  warning items: ${report.metrics.totalWarningItems}\n`);
  process.stdout.write(`  human-gated claims: ${report.metrics.humanGatedClaims}\n`);
  process.stdout.write(`  artifact: ${report.paths.artifactPath}\n`);
  process.stdout.write(`  markdown: ${report.paths.markdownPath}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = auditWikiStartupPack(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHumanSummary(report);
  }
  if (args.strict && report.status !== "pass") process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
