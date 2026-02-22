#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");

const args = parseArgs(process.argv.slice(2));
const strict = args.strict;
const emitJson = args.json;
const artifactPath = resolve(ROOT, args.artifact || "output/agent-surfaces-check/latest.json");

const REQUIRED_FILES = [
  "website/llms.txt",
  "website/ai.txt",
  "website/robots.txt",
  "website/sitemap.xml",
  "website/agent-docs/index.html",
  "website/ncsitebuilder/llms.txt",
  "website/ncsitebuilder/ai.txt",
  "website/ncsitebuilder/robots.txt",
  "website/ncsitebuilder/sitemap.xml",
  "website/ncsitebuilder/agent-docs/index.html",
  "web/public/llms.txt",
  "web/public/ai.txt",
  "web/public/robots.txt",
  "web/public/sitemap.xml",
  "web/public/agent-docs/index.html",
  "web/public/contracts/portal-contracts.json",
];

const LINK_SURFACES = [
  { path: "website/llms.txt", localRoot: "website" },
  { path: "website/ai.txt", localRoot: "website" },
  { path: "website/ncsitebuilder/llms.txt", localRoot: "website/ncsitebuilder" },
  { path: "website/ncsitebuilder/ai.txt", localRoot: "website/ncsitebuilder" },
  { path: "web/public/llms.txt", localRoot: "web/public" },
  { path: "web/public/ai.txt", localRoot: "web/public" },
];

const LLMS_FILES = [
  "website/llms.txt",
  "website/ncsitebuilder/llms.txt",
  "web/public/llms.txt",
];

const SECRET_SCAN_FILES = [
  "website/llms.txt",
  "website/ai.txt",
  "website/agent-docs/index.html",
  "website/ncsitebuilder/llms.txt",
  "website/ncsitebuilder/ai.txt",
  "website/ncsitebuilder/agent-docs/index.html",
  "web/public/llms.txt",
  "web/public/ai.txt",
  "web/public/agent-docs/index.html",
  "web/public/contracts/portal-contracts.json",
];

const REQUIRED_DOC_LINK_TOKENS = [
  "docs/API_CONTRACTS.md",
  "docs/DEEP_LINK_CONTRACT.md",
  "docs/SOURCE_OF_TRUTH_INDEX.md",
  "docs/runbooks/AGENT_SURFACES.md",
];

const ALLOWED_HTTPS_HOSTS = new Set([
  "monsoonfire.com",
  "www.monsoonfire.com",
  "portal.monsoonfire.com",
  "monsoonfire-portal.web.app",
  "monsoonfire-portal.firebaseapp.com",
  "github.com",
]);

const GITHUB_PATH_PREFIX = "/monsoonfirepottery-byte/monsoonfire-portal/blob/main/";

const SECRET_PATTERNS = [
  { id: "private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/i },
  { id: "stripe-live-key", pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{10,}\b/ },
  { id: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { id: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "jwt-like-token", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/ },
];

const FORBIDDEN_TERMS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  ".local",
  "studiobrain.local",
  "admin_token=",
  "firebase_token",
  "authorization: bearer",
  "x-admin-token:",
];

const report = {
  timestamp: new Date().toISOString(),
  strict,
  status: "pass",
  checks: [],
  summary: {
    errors: 0,
    warnings: 0,
    filesChecked: 0,
    linksChecked: 0,
  },
};

checkRequiredFiles();
checkLlmsQuality();
checkSecrets();
checkLinks();

const errors = report.checks.filter((entry) => entry.severity === "error");
const warnings = report.checks.filter((entry) => entry.severity === "warning");
report.summary.errors = errors.length;
report.summary.warnings = warnings.length;
report.status = errors.length > 0 || (strict && warnings.length > 0) ? "fail" : "pass";

if (emitJson) {
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  for (const entry of report.checks) {
    if (entry.severity === "pass") {
      continue;
    }
    const label = entry.severity === "error" ? "[ERROR]" : "[WARN]";
    process.stdout.write(`${label} ${entry.id} — ${entry.message}\n`);
    if (entry.value !== undefined) {
      process.stdout.write(`  value: ${JSON.stringify(entry.value)}\n`);
    }
  }
  process.stdout.write(`agent-surfaces-check: ${report.status.toUpperCase()}\n`);
}

process.exit(report.status === "pass" ? 0 : 1);

function checkRequiredFiles() {
  for (const relativePath of REQUIRED_FILES) {
    const fullPath = resolve(ROOT, relativePath);
    const exists = existsSync(fullPath);
    report.summary.filesChecked += 1;
    addFinding(
      exists ? "pass" : "error",
      "required-file",
      `${exists ? "Found" : "Missing"} required agent surface file: ${relativePath}`,
      relativePath,
      "present",
    );
  }
}

function checkLlmsQuality() {
  for (const relativePath of LLMS_FILES) {
    const fullPath = resolve(ROOT, relativePath);
    if (!existsSync(fullPath)) {
      continue;
    }
    const content = readFile(fullPath);
    const lower = content.toLowerCase();

    const startHereCount = countStartHereLinks(content);
    addFinding(
      startHereCount >= 8 && startHereCount <= 15 ? "pass" : "error",
      "llms-start-here",
      `Start Here links in ${relativePath}: ${startHereCount} (expected 8-15).`,
      { file: relativePath, count: startHereCount },
      "8-15",
    );

    addFinding(
      lower.includes("authoritative") ? "pass" : "error",
      "llms-authoritative-label",
      `Authority label "authoritative" ${lower.includes("authoritative") ? "present" : "missing"} in ${relativePath}.`,
      relativePath,
      "contains authoritative",
    );

    addFinding(
      lower.includes("advisory") ? "pass" : "error",
      "llms-advisory-label",
      `Authority label "advisory" ${lower.includes("advisory") ? "present" : "missing"} in ${relativePath}.`,
      relativePath,
      "contains advisory",
    );

    for (const token of REQUIRED_DOC_LINK_TOKENS) {
      addFinding(
        content.includes(token) ? "pass" : "error",
        "llms-doc-link",
        `${content.includes(token) ? "Found" : "Missing"} required contract/runbook reference (${token}) in ${relativePath}.`,
        { file: relativePath, token },
        "present",
      );
    }
  }
}

function checkSecrets() {
  for (const relativePath of SECRET_SCAN_FILES) {
    const fullPath = resolve(ROOT, relativePath);
    if (!existsSync(fullPath)) {
      continue;
    }
    const content = readFile(fullPath);

    for (const rule of SECRET_PATTERNS) {
      if (rule.pattern.test(content)) {
        addFinding(
          "error",
          "secret-pattern",
          `Potential secret pattern (${rule.id}) detected in ${relativePath}.`,
          { file: relativePath, rule: rule.id },
          "no secret patterns",
        );
      } else {
        addFinding(
          "pass",
          "secret-pattern",
          `No ${rule.id} pattern in ${relativePath}.`,
          { file: relativePath, rule: rule.id },
          "none",
        );
      }
    }

    const lower = content.toLowerCase();
    for (const term of FORBIDDEN_TERMS) {
      const found = lower.includes(term.toLowerCase());
      addFinding(
        found ? "error" : "pass",
        "forbidden-term",
        `${found ? "Forbidden" : "Allowed"} term check (${term}) for ${relativePath}.`,
        { file: relativePath, term },
        "term absent",
      );
    }
  }
}

function checkLinks() {
  for (const surface of LINK_SURFACES) {
    const fullPath = resolve(ROOT, surface.path);
    if (!existsSync(fullPath)) {
      continue;
    }

    const content = readFile(fullPath);
    const links = extractLinks(content);

    addFinding(
      links.length > 0 ? "pass" : "warning",
      "link-extract",
      `Extracted ${links.length} links from ${surface.path}.`,
      { file: surface.path, links: links.length },
      ">= 1",
    );

    for (const link of links) {
      report.summary.linksChecked += 1;
      validateLink(surface, link);
    }
  }
}

function validateLink(surface, rawLink) {
  const link = normalizeLink(rawLink);
  if (!link) {
    return;
  }

  if (link.startsWith("https://")) {
    let parsed;
    try {
      parsed = new URL(link);
    } catch {
      addFinding(
        "error",
        "link-parse",
        `Invalid URL in ${surface.path}: ${link}`,
        { file: surface.path, link },
        "valid https URL",
      );
      return;
    }

    const hostAllowed = ALLOWED_HTTPS_HOSTS.has(parsed.hostname);
    addFinding(
      hostAllowed ? "pass" : "error",
      "link-host",
      `${hostAllowed ? "Allowed" : "Disallowed"} host in ${surface.path}: ${parsed.hostname}`,
      { file: surface.path, host: parsed.hostname, link },
      Array.from(ALLOWED_HTTPS_HOSTS),
    );

    if (!hostAllowed) {
      return;
    }

    if (parsed.hostname === "github.com") {
      const githubPathOk = parsed.pathname.startsWith(GITHUB_PATH_PREFIX);
      addFinding(
        githubPathOk ? "pass" : "warning",
        "link-github-prefix",
        `${githubPathOk ? "Expected" : "Unexpected"} GitHub path in ${surface.path}: ${parsed.pathname}`,
        { file: surface.path, link },
        `path starts with ${GITHUB_PATH_PREFIX}`,
      );
      return;
    }

    const mappedRoot = mapHostToLocalRoot(parsed.hostname);
    if (!mappedRoot) {
      return;
    }

    const exists = localPathExists(mappedRoot, `${parsed.pathname}${parsed.search}${parsed.hash}`);
    addFinding(
      exists ? "pass" : "warning",
      "link-local-shape",
      `Link target ${exists ? "maps" : "does not map"} to local deploy shape for ${surface.path}: ${link}`,
      { file: surface.path, link, mappedRoot },
      "path resolvable in deploy root",
    );
    return;
  }

  if (link.startsWith("http://")) {
    addFinding(
      "error",
      "link-insecure",
      `Insecure http link in ${surface.path}: ${link}`,
      { file: surface.path, link },
      "https://",
    );
    return;
  }

  if (link.startsWith("/")) {
    const exists = localPathExists(surface.localRoot, link);
    addFinding(
      exists ? "pass" : "warning",
      "link-relative-shape",
      `Relative link ${exists ? "resolved" : "not resolved"} in ${surface.path}: ${link}`,
      { file: surface.path, link, localRoot: surface.localRoot },
      "path resolvable in local root",
    );
  }
}

function localPathExists(localRoot, rawPath) {
  const rootDir = resolve(ROOT, localRoot);
  const cleaned = String(rawPath || "").split("#")[0].split("?")[0] || "/";

  if (localRoot === "web/public" && cleaned === "/") {
    // Portal root is provided by Vite's generated dist index, not by web/public.
    return true;
  }

  if (cleaned === "/") {
    return existsSync(resolve(rootDir, "index.html"));
  }

  const withoutSlash = cleaned.replace(/^\/+/, "");
  if (!withoutSlash) {
    return existsSync(resolve(rootDir, "index.html"));
  }

  const direct = resolve(rootDir, withoutSlash);
  if (!isInsideRoot(direct, rootDir)) {
    return false;
  }

  if (existsSync(direct)) {
    const stats = statSync(direct);
    if (stats.isDirectory()) {
      return existsSync(resolve(direct, "index.html"));
    }
    return stats.isFile();
  }

  const indexCandidate = resolve(rootDir, withoutSlash, "index.html");
  if (isInsideRoot(indexCandidate, rootDir) && existsSync(indexCandidate)) {
    return true;
  }

  return false;
}

function mapHostToLocalRoot(hostname) {
  if (hostname === "monsoonfire.com" || hostname === "www.monsoonfire.com") {
    return "website";
  }
  if (
    hostname === "portal.monsoonfire.com" ||
    hostname === "monsoonfire-portal.web.app" ||
    hostname === "monsoonfire-portal.firebaseapp.com"
  ) {
    return "web/public";
  }
  return null;
}

function extractLinks(content) {
  const regex = /(https?:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+|\/[A-Za-z0-9._~\-/?#[\]@!$&'()*+,;=%]*)/g;
  const matches = content.match(regex) || [];
  return Array.from(new Set(matches.map(normalizeLink).filter(Boolean)));
}

function normalizeLink(link) {
  const normalized = String(link || "").trim().replace(/[)>.,;]+$/g, "");
  if (!normalized) {
    return "";
  }
  if (normalized === "/") {
    return normalized;
  }
  if (normalized.startsWith("//")) {
    return "";
  }
  return normalized;
}

function countStartHereLinks(content) {
  const lines = content.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => /^##\s*Start Here/i.test(line.trim()));
  if (startIndex < 0) {
    return 0;
  }

  let count = 0;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^##\s+/i.test(line.trim())) {
      break;
    }
    if (/^\s*-\s+/.test(line)) {
      count += 1;
    }
  }

  return count;
}

function isInsideRoot(candidatePath, rootPath) {
  const normalizedRoot = `${rootPath}${rootPath.endsWith("/") ? "" : "/"}`;
  return candidatePath === rootPath || candidatePath.startsWith(normalizedRoot);
}

function readFile(path) {
  return readFileSync(path, "utf8");
}

function addFinding(severity, id, message, value, expected) {
  report.checks.push({
    severity,
    id,
    message,
    value,
    expected,
  });
}

function parseArgs(argv) {
  const parsed = {
    strict: false,
    json: false,
    artifact: "output/agent-surfaces-check/latest.json",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--strict") {
      parsed.strict = true;
      continue;
    }
    if (current === "--json") {
      parsed.json = true;
      continue;
    }
    if (current === "--artifact") {
      parsed.artifact = argv[index + 1] || parsed.artifact;
      index += 1;
      continue;
    }
    if (current === "--help") {
      process.stdout.write(
        "Usage: node ./scripts/check-agent-surfaces.mjs [--strict] [--json] [--artifact output/agent-surfaces-check/latest.json]\n",
      );
      process.exit(0);
    }
  }

  return parsed;
}
