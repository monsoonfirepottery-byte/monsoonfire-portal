#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

const DEFAULT_TARGET_DIRS = ["docs", "web", "functions", "ios", "android", "codex-agents"];
const EXCLUDED_PATH_PREFIXES = new Set([
  "automation",
  "artifacts",
  "docs/library",
  "output",
  "tickets",
]);
const EXCLUDED_SEGMENTS = new Set([".git", "node_modules"]);

function parseArgs(argv) {
  const args = {
    strict: false,
    json: false,
  };

  for (const token of argv) {
    if (token === "--strict") {
      args.strict = true;
    } else if (token === "--json") {
      args.json = true;
    }
  }
  return args;
}

function listMarkdownFiles() {
  const files = [];
  for (const start of DEFAULT_TARGET_DIRS) {
    const absolute = resolve(ROOT, start);
    if (!existsSync(absolute)) continue;
    walk(absolute, files);
  }
  const rootMarkdown = ["AGENTS.md", "PROJECT_SNAPSHOT.md", "REVIEW_ACTION_PLAN.md", "WORKLOG.md"];
  for (const file of rootMarkdown) {
    const absolute = resolve(ROOT, file);
    if (existsSync(absolute)) files.push(absolute);
  }
  return Array.from(new Set(files));
}

function walk(dir, files) {
  const relativeDir = relative(ROOT, dir).replace(/\\/g, "/");
  if (isExcluded(relativeDir)) return;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name);
    const rel = relative(ROOT, absolute).replace(/\\/g, "/");
    if (isExcluded(rel)) continue;
    if (entry.isDirectory()) {
      walk(absolute, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (extname(entry.name).toLowerCase() !== ".md") continue;
    files.push(absolute);
  }
}

function isExcluded(pathRelativeToRoot) {
  const normalized = String(pathRelativeToRoot || "").replace(/\\/g, "/");
  for (const prefix of EXCLUDED_PATH_PREFIXES) {
    if (!prefix) continue;
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) return true;
  }
  const segments = normalized.split("/").filter(Boolean);
  for (const segment of segments) {
    if (EXCLUDED_SEGMENTS.has(segment)) return true;
  }
  return false;
}

function loadPackageScriptMap() {
  const map = new Map();
  const packageDirs = [".", "web", "functions", "studio-brain"];
  for (const dir of packageDirs) {
    const absolutePackagePath = resolve(ROOT, dir, "package.json");
    if (!existsSync(absolutePackagePath)) continue;
    const parsed = JSON.parse(readFileSync(absolutePackagePath, "utf8"));
    map.set(resolve(ROOT, dir), new Set(Object.keys(parsed.scripts || {})));
  }
  return map;
}

function nearestPackageDir(fileDir, scriptMap) {
  let current = resolve(fileDir);
  const rootResolved = resolve(ROOT);
  while (current.startsWith(rootResolved)) {
    if (scriptMap.has(current)) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(ROOT);
}

function parseCommandReferences(line) {
  const refs = [];
  const seen = new Set();

  function pushRef(ref) {
    const key = `${ref.type}|${ref.prefix || ""}|${ref.script || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  }

  const prefixPattern = /npm\s+(?:run\s+)?--prefix\s+([^\s`]+)\s+run\s+([a-zA-Z0-9:_\-.]+)/g;
  for (const match of line.matchAll(prefixPattern)) {
    pushRef({ type: "prefix", prefix: match[1], script: match[2] });
  }

  const prefixPattern2 = /npm\s+--prefix\s+([^\s`]+)\s+run\s+([a-zA-Z0-9:_\-.]+)/g;
  for (const match of line.matchAll(prefixPattern2)) {
    pushRef({ type: "prefix", prefix: match[1], script: match[2] });
  }

  const cdRunPattern = /cd\s+([^\s&;`]+)\s*(?:&&|;)\s*npm\s+run\s+([a-zA-Z0-9:_\-.]+)/g;
  for (const match of line.matchAll(cdRunPattern)) {
    pushRef({ type: "prefix", prefix: match[1], script: match[2] });
  }

  const runPattern = /\bnpm\s+run\s+([a-zA-Z0-9:_\-.]+)/g;
  for (const match of line.matchAll(runPattern)) {
    const script = match[1];
    if (script.startsWith("-")) continue;
    pushRef({ type: "local", script });
  }

  return refs;
}

function parseMarkdownLinks(line) {
  const links = [];
  const pattern = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const match of line.matchAll(pattern)) {
    const raw = String(match[1] || "").trim();
    if (!raw) continue;
    if (
      raw.startsWith("http://") ||
      raw.startsWith("https://") ||
      raw.startsWith("mailto:") ||
      raw.startsWith("#")
    ) {
      continue;
    }
    const withoutAnchor = raw.split("#")[0].split("?")[0];
    if (!withoutAnchor) continue;
    links.push(withoutAnchor);
  }
  return links;
}

function addFinding(state, severity, type, file, line, message, details = {}) {
  const finding = {
    severity,
    type,
    file: relative(ROOT, file).replace(/\\/g, "/"),
    line,
    message,
    details,
  };
  state.findings.push(finding);
  state.summary[severity] += 1;
}

function audit() {
  const args = parseArgs(process.argv.slice(2));
  const files = listMarkdownFiles();
  const scriptMap = loadPackageScriptMap();
  const state = {
    filesScanned: files.length,
    findings: [],
    summary: { error: 0, warning: 0, info: 0 },
    strict: args.strict,
  };

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    const packageDir = nearestPackageDir(dirname(file), scriptMap);
    let contextualPrefix = "";
    let contextualPrefixTtl = 0;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const lineNumber = index + 1;
      const cdMatch = line.match(/\bcd\s+([^\s`;&]+)/);
      if (cdMatch && !cdMatch[1].includes("$")) {
        contextualPrefix = cdMatch[1];
        contextualPrefixTtl = 3;
      }
      if (/\brepo root\b/i.test(line)) {
        contextualPrefix = ".";
        contextualPrefixTtl = 20;
      }

      if (/\bdepricated\b/i.test(line)) {
        addFinding(state, "error", "spelling", file, lineNumber, "Found typo `depricated`; use `deprecated`.");
      }

      for (const linkPath of parseMarkdownLinks(line)) {
        const target = isAbsolute(linkPath) ? resolve(linkPath) : resolve(dirname(file), linkPath);
        if (!existsSync(target)) {
          addFinding(state, "warning", "missing-link-target", file, lineNumber, `Link target does not exist: ${linkPath}`, {
            target: relative(ROOT, target).replace(/\\/g, "/"),
          });
        }
      }

      const commandRefs = parseCommandReferences(line);
      for (const ref of commandRefs) {
        if (!ref.script || ref.script.startsWith("<")) continue;
        let checkDir = packageDir;
        if (ref.type === "prefix") {
          if (ref.prefix.includes("$")) continue;
          if (isAbsolute(ref.prefix)) {
            checkDir = resolve(ref.prefix);
          } else if (ref.prefix.startsWith(".")) {
            checkDir = resolve(dirname(file), ref.prefix);
          } else {
            checkDir = resolve(ROOT, ref.prefix);
          }
        } else if (contextualPrefixTtl > 0 && contextualPrefix) {
          const contextualDir = resolve(ROOT, contextualPrefix);
          if (scriptMap.has(contextualDir)) {
            checkDir = contextualDir;
          }
        }
        const scripts = scriptMap.get(checkDir);
        if (!scripts) {
          addFinding(
            state,
            "warning",
            "unknown-package-dir",
            file,
            lineNumber,
            `Referenced npm package directory does not contain package.json: ${relative(ROOT, checkDir).replace(/\\/g, "/") || "."}`,
          );
          continue;
        }
        if (!scripts.has(ref.script)) {
          addFinding(
            state,
            "warning",
            "missing-npm-script",
            file,
            lineNumber,
            `Script \`${ref.script}\` not found in ${relative(ROOT, checkDir).replace(/\\/g, "/") || "."}/package.json`,
          );
        }
      }

      if (contextualPrefixTtl > 0 && line.trim()) {
        contextualPrefixTtl -= 1;
      }
      if (contextualPrefixTtl <= 0) {
        contextualPrefix = "";
        contextualPrefixTtl = 0;
      }
    }
  }

  const hasErrors = state.summary.error > 0;
  const hasWarnings = state.summary.warning > 0;
  const status = hasErrors || (args.strict && hasWarnings) ? "fail" : "pass";
  const report = {
    schema: "docs-hygiene-audit-v1",
    generatedAt: new Date().toISOString(),
    status,
    strict: args.strict,
    filesScanned: state.filesScanned,
    summary: state.summary,
    findings: state.findings,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`docs hygiene: ${status}\n`);
    process.stdout.write(`files scanned: ${report.filesScanned}\n`);
    process.stdout.write(`errors: ${report.summary.error}\n`);
    process.stdout.write(`warnings: ${report.summary.warning}\n`);
    for (const finding of report.findings) {
      process.stdout.write(`- [${finding.severity}] ${finding.file}:${finding.line} ${finding.message}\n`);
    }
  }

  if (status !== "pass") {
    process.exitCode = 1;
  }
}

audit();
