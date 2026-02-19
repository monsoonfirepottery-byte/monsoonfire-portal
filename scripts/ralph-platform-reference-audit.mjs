#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const scanRoots = [
  "docs",
  "tickets",
  "scripts",
  "website",
  "web",
  "functions",
  "studio-brain",
];

const skipDirs = new Set([
  ".git",
  ".next",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "output",
  ".cache",
  "lib",
]);

const includeExt = new Set([
  ".md",
  ".txt",
  ".ps1",
  ".psm1",
  ".bat",
  ".cmd",
  ".js",
  ".mjs",
  ".ts",
  ".tsx",
  ".json",
  ".yml",
  ".yaml",
  ".sh",
  ".shx",
  ".env",
  ".example",
]);

const windowsPatterns = [
  /\bpwsh\b/i,
  /\bPowerShell\b/i,
  /\bWindows\b/i,
  /\bwuff-laptop\b/i,
];

const actionableContextPatterns = [
  /\bpwsh\b/i,
  /\bpowershell\b/i,
  /\b\.ps1\b/i,
  /\b\.psm1\b/i,
  /\b\.cmd\b/i,
  /\bwuff-laptop\b/i,
  /\bwindows (host|machine|desktop|installer|path)\b/i,
  /\bD:\\|C:\\|E:\\|F:\\|G:\\/i,
  /\bPowerShell\b/i,
];

const EXEMPT_FILES = new Set(["docs/RALPH_LOOP_PLATFORM_REFERENCE_AUDIT_2026-02-18.md"]);

const repoPath = new URL("..", import.meta.url);

const args = process.argv.slice(2);
const argSet = new Set(args);
const outputJson = argSet.has("--json");
const strictMode = argSet.has("--strict");
const maxActionable = parseMaxActionableArg(args) ?? 0;
const strictThreshold = strictMode ? maxActionable : 0;
const skipTickets = argSet.has("--skip-tickets");
const exemptionsFile = getArgValue(args, "--exemptions", "scripts/ralph-platform-reference-exemptions.json");
const exemptions = loadExemptions(exemptionsFile);

const report = {
  timestamp: new Date().toISOString(),
  roots: scanRoots,
  scannedFiles: 0,
  skippedFiles: 0,
  skippedMarkers: 0,
  actionableWindowsMarkerFindings: [],
  windowsMarkerFindings: [],
  exemptedWindowsMarkerFindings: [],
  ps1Files: [],
  ps1CompatibilityCount: 0,
  ps1ReviewCount: 0,
  strictMode,
  maxActionable: strictThreshold,
  strictExemptions: exemptionsFile,
  wuffLaptopFindings: [],
};

for (const root of scanRoots) {
  if (skipTickets && root === "tickets") {
    continue;
  }
  walk(new URL(root + "/", repoPath));
}

report.summary = {
  windowsMarkerFindings: report.windowsMarkerFindings.length,
  actionableWindowsMarkerFindings: report.actionableWindowsMarkerFindings.length,
  wuffLaptopFindings: report.wuffLaptopFindings.length,
  ps1Files: report.ps1Files.length,
  ps1Compatibility: report.ps1CompatibilityCount,
  ps1ReviewCandidate: report.ps1ReviewCount,
};

if (!outputJson) {
  const totalMarkers = report.windowsMarkerFindings.length;
  process.stdout.write(`Ralph Platform Reference Audit\n`);
  process.stdout.write(`Scanned files: ${report.scannedFiles}\n`);
  process.stdout.write(`Total marker hits: ${totalMarkers}\n`);
  process.stdout.write(`Actionable platform hits: ${report.actionableWindowsMarkerFindings.length}\n`);
  process.stdout.write(`Skipped marker hits: ${report.skippedMarkers}\n`);
  process.stdout.write(`Windows/wuff-laptop references: ${report.wuffLaptopFindings.length}\n`);
  process.stdout.write(`.ps1 files: ${report.ps1Files.length}\n`);
  process.stdout.write(`  - compatibility shims: ${report.ps1CompatibilityCount}\n`);
  process.stdout.write(`  - review candidates: ${report.ps1ReviewCount}\n`);
  process.stdout.write(`\nTop actionable windows/powershell references:\n`);

  for (const hit of report.actionableWindowsMarkerFindings.slice(0, 40)) {
    const marker = hit.marker || "marker";
    process.stdout.write(`${hit.file}:${hit.line}:${hit.column}: ${marker} (${hit.context})\n`);
  }

  if (report.actionableWindowsMarkerFindings.length > 40) {
    process.stdout.write(`... and ${report.actionableWindowsMarkerFindings.length - 40} more\n`);
  }

  process.stdout.write(`\n.ps1 review candidate inventory:\n`);
  for (const file of report.ps1Files.filter((entry) => entry.classification === "review")) {
    const suffix = file.isPotentiallyReviewCandidate
      ? "potential review candidate"
      : "non-shim wrapper/automation path";
    process.stdout.write(`${file.file} (${file.classification}, ${suffix})\n`);
  }

  if (report.exemptedWindowsMarkerFindings.length > 0) {
    process.stdout.write(`\nExempted windows platform refs (not blocking): ${report.exemptedWindowsMarkerFindings.length}\n`);
    for (const hit of report.exemptedWindowsMarkerFindings.slice(0, 20)) {
      process.stdout.write(`${hit.file}:${hit.line}:${hit.column} ${hit.marker}: ${hit.context}\n`);
    }
    if (report.exemptedWindowsMarkerFindings.length > 20) {
      process.stdout.write(`... and ${report.exemptedWindowsMarkerFindings.length - 20} more\n`);
    }
  }
} else {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (strictMode && report.actionableWindowsMarkerFindings.length > strictThreshold) {
  process.stderr.write(
    `Strict mode failed: actionable windows refs (${report.actionableWindowsMarkerFindings.length}) exceed configured max (${strictThreshold}).\n`,
  );
  process.exitCode = 1;
}

function isExemptedFinding(hit) {
  if (exemptions.length === 0) {
    return false;
  }

  const normalizedContext = hit.context.toLowerCase();
  for (const entry of exemptions) {
    if (entry.file && entry.file !== hit.file) {
      continue;
    }
    if (typeof entry.line === "number" && entry.line !== hit.line) {
      continue;
    }
    if (entry.marker) {
      try {
        const markerMatch = new RegExp(entry.marker, "i");
        if (!markerMatch.test(hit.marker)) {
          continue;
        }
      } catch {
        if (!String(hit.marker).toLowerCase().includes(String(entry.marker).toLowerCase())) {
          continue;
        }
      }
    }
    if (
      entry.contextContains &&
      !normalizedContext.includes(String(entry.contextContains).toLowerCase())
    ) {
      continue;
    }

    return true;
  }

  return false;
}

function walk(urlPath) {
  let stats;
  try {
    stats = statSync(urlPath);
  } catch {
    report.skippedFiles += 1;
    return;
  }

  if (!stats.isDirectory()) {
    scanFile(urlPath);
    return;
  }

  let entries;
  try {
    entries = readdirSync(urlPath, { withFileTypes: true });
  } catch {
    report.skippedFiles += 1;
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") && skipDirs.has(entry.name)) {
      continue;
    }
    if (skipDirs.has(entry.name)) {
      continue;
    }

    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), urlPath);
    if (entry.isDirectory()) {
      walk(child);
    } else {
      scanFile(child);
    }
  }
}

function scanFile(fileUrl) {
  const filePath = relative(REPO_ROOT, fileURLToPath(fileUrl)).replace(/\\/g, "/");
  const extension = extname(filePath).toLowerCase();

  if (filePath === "scripts/ralph-platform-reference-audit.mjs") {
    return;
  }
  if (filePath.startsWith("docs/RALPH_LOOP_PLATFORM_REFERENCE_") && filePath.endsWith(".json")) {
    return;
  }

  if (extension === "" && !/AGENTS\.md$/.test(filePath)) {
    return;
  }

  if (!includeExt.has(extension) && !/AGENTS\.md$/i.test(filePath) && !/\.env(\..+)?$/i.test(filePath)) {
    return;
  }

  let content;
  try {
    content = readFileSync(fileURLToPath(fileUrl), "utf8");
  } catch {
    report.skippedFiles += 1;
    return;
  }

  report.scannedFiles += 1;
  const lines = content.split(/\r?\n/);

  if (extension === ".ps1" || extension === ".psm1") {
    const classification = classifyPs1(filePath, content);
    const fileEntry = {
      file: filePath,
      classification,
      isCompatibilityShim: classification === "compatibility-shim",
      lineCount: lines.length,
      isPotentiallyReviewCandidate: classification === "review",
    };
    report.ps1Files.push(fileEntry);

    if (classification === "compatibility-shim") {
      report.ps1CompatibilityCount += 1;
    } else {
      report.ps1ReviewCount += 1;
    }
  }

  for (let lineNumber = 1; lineNumber <= lines.length; lineNumber += 1) {
    const line = lines[lineNumber - 1] ?? "";
    for (const pattern of windowsPatterns) {
      const matcher = toGlobal(pattern);
      let match;
      while ((match = matcher.exec(line)) !== null) {
        const token = match[0];
        if (EXEMPT_FILES.has(filePath)) {
          report.skippedMarkers += 1;
          continue;
        }
        if (token.toLowerCase() === "windows" && !isActionableWindowsMarker(line, token)) {
          report.skippedMarkers += 1;
          continue;
        }

        const hit = {
          file: filePath,
          line: lineNumber,
          column: match.index + 1,
          marker: token,
          actionable: token.toLowerCase() !== "windows" || isActionableWindowsMarker(line, token),
          category: isWindowsAction(line) ? "actionable" : "contextual",
          context: line.trim(),
        };

        report.windowsMarkerFindings.push(hit);
        if (isExemptedFinding(hit)) {
          report.exemptedWindowsMarkerFindings.push(hit);
          continue;
        }
        if (isActionableWindowsMarker(line, token) || isWindowsAction(line)) {
          report.actionableWindowsMarkerFindings.push(hit);
        }
        if (/\bwuff-laptop\b/i.test(token)) {
          report.wuffLaptopFindings.push(hit);
        }
      }
    }
  }
}

function classifyPs1(filePath, content) {
  const hasCompatibilitySignal = /compatibility\s+shim/i.test(content) && /\bnode\b/i.test(content);
  const isRootWrapper = /^scripts\//.test(filePath) && /(serve|deploy|start|watch|watchdog|cutover|emulator)/i.test(filePath);

  if (hasCompatibilitySignal) {
    return "compatibility-shim";
  }

  if (isRootWrapper) {
    return "review";
  }

  if (/\bparam\(/i.test(content) && /\bWrite-/.test(content)) {
    return "automation";
  }

  return "automation";
}

function toGlobal(pattern) {
  if (pattern.flags.includes("g")) {
    return pattern;
  }
  return new RegExp(pattern.source, `${pattern.flags}g`);
}

function isWindowsAction(line) {
  return actionableContextPatterns.some((pattern) => pattern.test(line));
}

function isActionableWindowsMarker(line, marker) {
  if (/\bwuff-laptop\b/i.test(marker)) {
    return true;
  }
  if (/\b(pwsh|powershell)\b/i.test(line) || /\b\.ps1\b/i.test(line) || /\b\.psm1\b/i.test(line)) {
    return true;
  }
  if (/\bcmd\b/i.test(line) || /\b\.cmd\b/i.test(line)) {
    return true;
  }
  return isWindowsAction(line);
}

function loadExemptions(rawPath) {
  const resolvedPath = resolve(fileURLToPath(repoPath), rawPath);
  if (!existsSync(resolvedPath)) {
    return [];
  }

  try {
    const fileData = readFileSync(resolvedPath, "utf8");
    const parsed = JSON.parse(fileData);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry) => entry && typeof entry === "object");
  } catch {
    return [];
  }
}

function getArgValue(args, name, fallback) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === name && index + 1 < args.length) {
      return args[index + 1];
    }
    if (arg.startsWith(`${name}=`)) {
      return arg.substring(`${name}=`.length);
    }
  }

  return fallback;
}

function parseMaxActionableArg(args) {
  const raw = getArgValue(args, "--max-actionable", null);
  if (!raw) {
    return 0;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}
