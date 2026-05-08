#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "docker-tag-policy");

const COMPOSE_FILE_NAMES = new Set(["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]);
const DEFAULT_SCAN_FILES = [
  "studio-brain/docker-compose.yml",
  "studio-brain/docker-compose.proxy.yml",
  "config/studiobrain/monitoring/docker-compose.yml",
  "tools/libratom/Dockerfile"
];

function usage() {
  return `Studio Brain Docker floating tag policy report

Usage:
  node scripts/ops/docker_floating_tag_policy.mjs [--json] [--write]

Options:
  --json                 Print JSON to stdout.
  --write                Write JSON and Markdown artifacts under output/ops/docker-tag-policy.
  --output-dir <path>    Artifact directory.
`;
}

function parseArgs(argv) {
  const options = { json: false, write: false, outputDir: DEFAULT_OUTPUT_DIR };
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
    if (arg === "--output-dir") {
      if (!argv[index + 1]) throw new Error("--output-dir requires a value.");
      options.outputDir = resolve(REPO_ROOT, argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      options.outputDir = resolve(REPO_ROOT, arg.slice("--output-dir=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function repoRelative(path) {
  return relative(REPO_ROOT, path).replace(/\\/g, "/");
}

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if ([".git", "node_modules", "output", "dist", "build", ".next"].includes(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function discoverFiles() {
  const known = DEFAULT_SCAN_FILES.map((file) => resolve(REPO_ROOT, file)).filter((file) => existsSync(file));
  const discovered = walk(REPO_ROOT).filter((file) => {
    const name = file.split(/[\\/]/).pop();
    return COMPOSE_FILE_NAMES.has(name) || /^Dockerfile(\..+)?$/.test(name || "");
  });
  return [...new Set([...known, ...discovered])].sort();
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split(/\n/).length;
}

function serviceNameBefore(lines, index) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const match = /^  ([A-Za-z0-9_.-]+):\s*$/.exec(lines[cursor]);
    if (match && !["services", "volumes", "networks", "configs", "secrets"].includes(match[1])) {
      return match[1];
    }
  }
  return "";
}

function imageDefaultFromVariable(raw) {
  const match = /^\$\{[A-Za-z0-9_]+:-([^}]+)\}$/.exec(raw);
  return match ? match[1] : raw;
}

function parseImageRef(raw) {
  const image = imageDefaultFromVariable(String(raw || "").trim().replace(/^['"]|['"]$/g, ""));
  const digest = image.includes("@sha256:");
  const withoutDigest = image.split("@")[0];
  const slashIndex = withoutDigest.lastIndexOf("/");
  const colonIndex = withoutDigest.lastIndexOf(":");
  const hasTag = colonIndex > slashIndex;
  return {
    raw,
    image,
    repository: hasTag ? withoutDigest.slice(0, colonIndex) : withoutDigest,
    tag: hasTag ? withoutDigest.slice(colonIndex + 1) : "",
    digest
  };
}

function classifyImage(raw) {
  const parsed = parseImageRef(raw);
  const tag = parsed.tag.toLowerCase();
  if (parsed.digest) {
    return { ...parsed, severity: "ok", policy: "immutable_digest", recommendedAction: "Keep update cadence and rollback digest notes current." };
  }
  if (!parsed.tag) {
    return { ...parsed, severity: "high", policy: "implicit_latest", recommendedAction: "Pin to an explicit patch tag or digest before the next pull/recreate." };
  }
  if (/^(latest|stable|main|master|dev|edge|nightly|rolling)$/.test(tag)) {
    return { ...parsed, severity: "high", policy: "floating_tag", recommendedAction: "Replace with a reviewed patch tag or digest and record rollback tag/digest." };
  }
  if (/^v?\d+$/.test(tag) || /^v?\d+-(alpine|slim|bookworm|bullseye|trixie)$/.test(tag) || /^pg\d+$/.test(tag)) {
    return { ...parsed, severity: "medium", policy: "broad_major_tag", recommendedAction: "Prefer a patch/minor tag or digest; otherwise document the update window and rollback image ID." };
  }
  if (/^v?\d+\.\d+($|[-.])/.test(tag)) {
    return { ...parsed, severity: "low", policy: "minor_tag_without_digest", recommendedAction: "Accept with scheduled update cadence, or pin to digest for stronger reproducibility." };
  }
  return { ...parsed, severity: "low", policy: "specific_tag_without_digest", recommendedAction: "Keep vulnerability/update cadence and rollback tag documented." };
}

function scanCompose(file, text) {
  const lines = text.split(/\r?\n/);
  const findings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)image:\s*(.+?)\s*(?:#.*)?$/.exec(lines[index]);
    if (!match) continue;
    const image = match[2].trim();
    findings.push({
      sourceType: "compose",
      file: repoRelative(file),
      line: index + 1,
      service: serviceNameBefore(lines, index),
      ...classifyImage(image)
    });
  }
  return findings;
}

function scanDockerfile(file, text) {
  const findings = [];
  const regex = /^\s*FROM\s+([^\s]+)(?:\s+AS\s+\S+)?/gim;
  let match;
  while ((match = regex.exec(text))) {
    findings.push({
      sourceType: "dockerfile",
      file: repoRelative(file),
      line: lineNumberAt(text, match.index),
      service: "",
      ...classifyImage(match[1])
    });
  }
  return findings;
}

function buildIssueTask(finding) {
  return {
    title: `[docker] Review ${finding.image} image tag policy`,
    body: [
      "## Problem",
      `\`${finding.image}\` is classified as \`${finding.policy}\` with \`${finding.severity}\` risk.`,
      "",
      "## Evidence",
      `- File: \`${finding.file}:${finding.line}\``,
      finding.service ? `- Service: \`${finding.service}\`` : "- Source: Dockerfile base image",
      "",
      "## Risk",
      "A future pull or container recreate can change runtime bits without a reviewed patch, rollback digest, or tested update window.",
      "",
      "## Proposed Fix",
      finding.recommendedAction,
      "",
      "## Acceptance Criteria",
      "- The selected tag or digest is documented.",
      "- Rollback tag/digest or image ID is recorded before deployment.",
      "- Any pull/recreate is handled in an approved service window.",
      "",
      "## Safety Notes",
      "- This report is read-only.",
      "- Pulling, pinning, recreating, or restarting containers remains approval-gated."
    ].join("\n"),
    labels: ["ops", "docker", "reliability"]
  };
}

function buildReport() {
  const files = discoverFiles();
  const findings = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const name = file.split(/[\\/]/).pop() || "";
    findings.push(...(COMPOSE_FILE_NAMES.has(name) ? scanCompose(file, text) : scanDockerfile(file, text)));
  }
  const actionable = findings.filter((finding) => ["high", "medium"].includes(finding.severity));
  return {
    schema: "studio-brain.ops.docker-floating-tag-policy.v1",
    generatedAt: new Date().toISOString(),
    readOnly: true,
    status: findings.some((finding) => finding.severity === "high") ? "warning" : "ok",
    summary: {
      scannedFiles: files.length,
      images: findings.length,
      high: findings.filter((finding) => finding.severity === "high").length,
      medium: findings.filter((finding) => finding.severity === "medium").length,
      low: findings.filter((finding) => finding.severity === "low").length,
      ok: findings.filter((finding) => finding.severity === "ok").length
    },
    findings,
    issueReadyTasks: actionable.map(buildIssueTask),
    approvalBoundary: "Do not pull images, recreate containers, change Compose files, or restart services without owner approval."
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Docker Floating Tag Policy Report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Status: ${report.status}`,
    `- Read-only: ${report.readOnly ? "yes" : "no"}`,
    `- Approval boundary: ${report.approvalBoundary}`,
    "",
    "## Summary",
    "",
    `- Scanned files: ${report.summary.scannedFiles}`,
    `- Images: ${report.summary.images}`,
    `- High: ${report.summary.high}`,
    `- Medium: ${report.summary.medium}`,
    `- Low: ${report.summary.low}`,
    `- OK: ${report.summary.ok}`,
    "",
    "## Findings",
    "",
    "| Severity | Policy | Image | Source | Recommended action |",
    "| --- | --- | --- | --- | --- |"
  ];
  for (const finding of report.findings) {
    const source = `${finding.file}:${finding.line}${finding.service ? ` (${finding.service})` : ""}`;
    lines.push(`| ${finding.severity} | ${finding.policy} | \`${finding.image}\` | \`${source}\` | ${finding.recommendedAction} |`);
  }
  lines.push("");
  lines.push("## Issue-Ready Tasks");
  lines.push("");
  if (!report.issueReadyTasks.length) lines.push("- No high or medium tag policy tasks.");
  for (const task of report.issueReadyTasks) {
    lines.push(`### ${task.title}`);
    lines.push("");
    lines.push(task.body);
    lines.push("");
    lines.push(`Labels: ${task.labels.join(", ")}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function writeArtifacts(report, options) {
  mkdirSync(options.outputDir, { recursive: true });
  const jsonPath = resolve(options.outputDir, "latest.json");
  const markdownPath = resolve(options.outputDir, "latest.md");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  report.paths = {
    json: repoRelative(jsonPath),
    markdown: repoRelative(markdownPath)
  };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = buildReport();
    if (options.write) writeArtifacts(report, options);
    process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report));
  } catch (error) {
    process.stderr.write(`docker_floating_tag_policy: ${error.message}\n`);
    process.exit(1);
  }
}

main();
