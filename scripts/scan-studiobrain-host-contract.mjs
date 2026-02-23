#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const SCAN_ROOTS = [
  resolve(repoRoot, "scripts"),
  resolve(repoRoot, "web"),
  resolve(repoRoot, "functions"),
  resolve(repoRoot, "studio-brain"),
];

const FILE_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".json",
  ".yml",
  ".yaml",
  ".ps1",
  ".sh",
]);

const SKIP_DIRS = new Set([
  ".git",
  ".github",
  ".next",
  "dist",
  "build",
  "coverage",
  "node_modules",
  "output",
  "reports",
]);

const RULES = [
  {
    id: "studio-brain-base-url-fallback",
    category: "studio-brain-base-url-fallback",
    severity: "error",
    description: "Loopback fallback for Studio Brain base URL must be explicit-local only.",
    patterns: [
      /\b(?:STUDIO_BRAIN_BASE_URL|SOAK_BASE_URL)\b[^#\r\n]*?(?:\|\||\?\?|=)\s*["'`]?https?:\/\/(?:127\.0\.0\.1|localhost):8787/i,
    ],
  },
  {
    id: "studio-brain-loopback-runtime",
    category: "studio-brain-loopback-runtime",
    severity: "error",
    description: "Hardcoded localhost/loopback Studio Brain endpoint for non-local flows.",
    patterns: [
      /\b127\.0\.0\.1:8787\b/g,
      /\blocalhost:8787\b/g,
      /\[::1\]:8787/g,
    ],
  },
  {
    id: "legacy-host-assumption",
    category: "legacy-host-assumption",
    severity: "warning",
    description: "Legacy host assumptions may drift during workstation migration.",
    patterns: [
      /legacy host assumptions/gi,
    ],
  },
];

const EXCEPTIONS = [
  {
    path: /[\\/]scripts[\\/]new-studio-os-v3-drill-log-entry\.ps1$/,
    ruleIds: ["studio-brain-base-url-fallback", "studio-brain-loopback-runtime"],
    owner: "platform@studio",
    reason: "Template shim for CLI replay; non-production and intentionally local.",
  },
  {
    path: /[\\/]scripts[\\/]portal-playwright-smoke\.mjs$/,
    ruleIds: ["studio-brain-loopback-runtime"],
    owner: "platform@qa",
    reason: "Smoke helper records loopback request patterns for diagnosis.",
  },
  {
    path: /[\\/]scripts[\\/]check-studio-brain-bundle\.mjs$/,
    ruleIds: ["studio-brain-loopback-runtime"],
    owner: "platform@automation",
    reason: "Bundle guard script intentionally asserts no forbidden loopback artifacts in build output.",
  },
  {
    path: /[\\/]scripts[\\/]capture-host-contract-evidence\.mjs$/,
    ruleIds: ["studio-brain-loopback-runtime"],
    owner: "platform@automation",
    reason: "Evidence harness intentionally writes a temporary regression token to verify fail-mode detection.",
    tokenPattern: /127\.0\.0\.1:8787/,
  },
  {
    path: /[\\/]web[\\/]src[\\/].+\.test\.[cm]?[jt]sx?$/,
    ruleIds: ["studio-brain-loopback-runtime", "studio-brain-base-url-fallback"],
    owner: "platform@web",
    reason: "Unit tests are exercising local-to-local behavior and must retain fixtures.",
  },
  {
    path: /[\\/]web[\\/]src[\\/]utils[\\/]studioBrain\.ts$/,
    ruleIds: ["studio-brain-loopback-runtime"],
    owner: "platform@web",
    reason: "Client runtime intentionally supports local host contract and localhost guardrails.",
  },
  {
    path: /[\\/]scripts[\\/]scan-studiobrain-host-contract\.mjs$/,
    ruleIds: ["legacy-host-assumption"],
    owner: "platform@automation",
    reason: "Script documentation intentionally references migration terminology.",
  },
  {
    path: /[\\/]web[\\/]\.env(\..+)?$/,
    ruleIds: ["studio-brain-loopback-runtime"],
    owner: "platform@web",
    reason: "Portal local env files intentionally keep localhost/studio-brain local defaults.",
    tokenPattern: /(?:127\.0\.0\.1|localhost):8787/,
  },
];

const options = parseArgs(process.argv.slice(2));
const startAt = new Date().toISOString();
const report = {
  timestamp: startAt,
  strict: options.strict,
  scannedRoots: SCAN_ROOTS.map((entry) => relative(repoRoot, entry).replace(/\\/g, "/")),
  violations: [],
  allowedMatches: [],
  skippedFiles: 0,
  scannedFiles: 0,
};

for (const root of SCAN_ROOTS) {
  walk(root);
}

const errors = report.violations.filter((entry) => entry.severity === "error");
const warnings = report.violations.filter((entry) => entry.severity === "warning");
const hasFailure = errors.length > 0 || (options.strict && warnings.length > 0);
report.summary = {
  status: hasFailure ? "fail" : "pass",
  errors: errors.length,
  warnings: warnings.length,
};

if (options.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(hasFailure ? 1 : 0);
}

if (hasFailure) {
  process.stderr.write(`FAIL: host-contract scan found ${errors.length} error(s), ${warnings.length} warning(s).\n`);
} else if (warnings.length > 0) {
  process.stdout.write(`PASS (with warnings): host-contract scan found ${warnings.length} warning(s).\n`);
} else {
  process.stdout.write(`PASS: studio-brain host-contract scan clean. Checked ${report.scannedFiles} file(s).\n`);
}

for (const violation of report.violations) {
  const severityLabel = violation.severity.toUpperCase();
  const stream = violation.severity === "error" ? process.stderr : process.stdout;
  const range = violation.rangeEnd
    ? `range:${violation.column}-${violation.rangeEnd}`
    : `column:${violation.column}`;
  stream.write(`[${severityLabel}] ${violation.file}:${violation.line}:${range}\n`);
  stream.write(`  category: ${violation.category}\n`);
  stream.write(`  rule: ${violation.rule}\n`);
  stream.write(`  token: ${violation.token}\n`);
  stream.write(`  owner: ${violation.owner || "unowned"}\n`);
  stream.write(`  reason: ${violation.reason}\n`);
}

if (report.allowedMatches.length > 0) {
  process.stdout.write(`\nAllowed exceptions used: ${report.allowedMatches.length}\n`);
  for (const entry of report.allowedMatches) {
    process.stdout.write(
      `- ${entry.file}:${entry.line}:${entry.column}-${entry.rangeEnd} ${entry.rule} (${entry.owner}) - ${entry.reason}\n`,
    );
  }
}

if (hasFailure) {
  process.exit(1);
}

function walk(targetPath) {
  const stats = statSync(targetPath);
  if (!stats.isDirectory()) {
    checkFile(targetPath);
    return;
  }

  const entries = readdirSync(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") && SKIP_DIRS.has(entry.name)) {
      continue;
    }
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }

    const childPath = resolve(targetPath, entry.name);
    if (entry.isDirectory()) {
      walk(childPath);
      continue;
    }
    if (entry.isFile()) {
      checkFile(childPath);
    }
  }
}

function checkFile(filePath) {
  if (!isScannableFile(filePath)) {
    report.skippedFiles += 1;
    return;
  }

  let content = "";
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    report.skippedFiles += 1;
    return;
  }

  report.scannedFiles += 1;
  const relativePath = relative(repoRoot, filePath).replace(/\\/g, "/");
  const lines = content.split(/\r?\n/);

  for (let lineNumber = 1; lineNumber <= lines.length; lineNumber += 1) {
    const line = lines[lineNumber - 1] ?? "";
    RULES.forEach((rule) => {
      rule.patterns.forEach((pattern) => {
        const globalPattern = toGlobal(pattern);
        let match;
        while ((match = globalPattern.exec(line)) !== null) {
          const token = match[0];
          const column = match.index + 1;
          const rangeEnd = match.index + token.length;
          const exception = getException(relativePath, rule.id, token);
          if (exception) {
            report.allowedMatches.push({
              file: relativePath,
              line: lineNumber,
              column,
              rangeEnd,
              rule: rule.id,
              reason: exception.reason,
              owner: exception.owner,
              token,
            });
            continue;
          }

          report.violations.push({
            file: relativePath,
            line: lineNumber,
            column,
            rangeEnd,
            token: token.trim(),
            rule: rule.id,
            category: rule.category,
            severity: rule.severity,
            owner: null,
            reason: rule.description,
          });
        }
      });
    });
  }
}

function isScannableFile(filePath) {
  const fileBaseName = basename(filePath);
  if (fileBaseName === ".env" || fileBaseName.startsWith(".env.")) {
    return true;
  }

  if (!FILE_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    return false;
  }
  const baseName = relative(repoRoot, filePath);
  const skippedPrefix = baseName.split("/")[0];
  return !SKIP_DIRS.has(skippedPrefix);
}

function getException(relativePath, ruleId, token) {
  const pathForMatch = relativePath.replace(/\\/g, "/");
  const withLeadingSlash = `/${pathForMatch}`;

  for (const exception of EXCEPTIONS) {
    if (!exception.path.test(pathForMatch) && !exception.path.test(withLeadingSlash)) {
      continue;
    }
    if (!exception.ruleIds.includes(ruleId)) {
      continue;
    }
    if (exception.tokenPattern && !exception.tokenPattern.test(token)) {
      continue;
    }
    return exception;
  }

  return null;
}

function parseArgs(args) {
  const parsed = {
    strict: false,
    json: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
  }

  return parsed;
}

function toGlobal(pattern) {
  if (pattern.flags.includes("g")) {
    return new RegExp(pattern.source, pattern.flags);
  }
  return new RegExp(pattern.source, `${pattern.flags}g`);
}
