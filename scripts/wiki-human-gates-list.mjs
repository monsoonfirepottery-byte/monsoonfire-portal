#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_SOURCE = "wiki/00_source_index/extracted-facts.jsonl";
const DEFAULT_ARTIFACT = "output/wiki/human-gates.json";
const DEFAULT_MARKDOWN = "output/wiki/human-gates.md";

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

export function listWikiHumanGates(options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const sourcePath = resolveRepoPath(repoRoot, options.source || DEFAULT_SOURCE);
  const artifactPath = resolveRepoPath(repoRoot, options.artifact || DEFAULT_ARTIFACT);
  const markdownPath = resolveRepoPath(repoRoot, options.markdown || DEFAULT_MARKDOWN);
  const claims = parseJsonl(sourcePath);
  const items = claims
    .filter((claim) => Boolean(claim?.requiresHumanApproval))
    .map((claim) => ({
      claimId: clean(claim.claimId),
      claimKind: clean(claim.claimKind),
      subjectKey: clean(claim.subjectKey),
      category: categoryFor(claim),
      sourcePath: sourcePathFor(claim),
      objectText: clean(claim.objectText),
      owner: clean(claim.owner) || null,
      humanApprovalReason: clean(claim.humanApprovalReason) || null,
    }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.subjectKey.localeCompare(b.subjectKey));
  const report = {
    schema: "wiki-human-gates-report.v1",
    generatedAt: new Date().toISOString(),
    sourcePath,
    artifactPath,
    markdownPath,
    summary: {
      claims: items.length,
      byCategory: summarizeByCategory(items),
    },
    items,
  };

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  mkdirSync(dirname(markdownPath), { recursive: true });
  writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  return report;
}

function renderMarkdown(report) {
  const lines = [
    "# Wiki Human-Gated Claims",
    "",
    `Generated: ${report.generatedAt}`,
    `Source: ${report.sourcePath}`,
    `Claims: ${report.summary.claims}`,
    "",
    "## Categories",
    "",
  ];
  for (const [category, count] of Object.entries(report.summary.byCategory).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`- ${category}: ${count}`);
  }
  lines.push("", "## Claims", "");
  for (const item of report.items) {
    lines.push(`- ${item.claimId} [${item.category}] ${item.subjectKey}`);
    lines.push(`  - source: ${item.sourcePath || "unknown"}`);
    lines.push(`  - text: ${item.objectText || "unknown"}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function printHumanSummary(report) {
  process.stdout.write("Wiki human-gated claims\n");
  process.stdout.write(`  claims: ${report.summary.claims}\n`);
  for (const [category, count] of Object.entries(report.summary.byCategory).sort(([a], [b]) => a.localeCompare(b))) {
    process.stdout.write(`  ${category}: ${count}\n`);
  }
  process.stdout.write(`  artifact: ${report.artifactPath}\n`);
  process.stdout.write(`  markdown: ${report.markdownPath}\n`);
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
