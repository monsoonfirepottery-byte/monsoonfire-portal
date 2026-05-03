#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const scanRoots = ["functions/src", "web/src", "studio-brain/src"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

const writePatterns = [
  { id: "firestore-set", regex: /\.set\s*\(/g },
  { id: "firestore-add", regex: /\.add\s*\(/g },
  { id: "firestore-update", regex: /\.update\s*\(/g },
  { id: "firestore-delete", regex: /\.delete\s*\(/g },
  { id: "firestore-create", regex: /\.create\s*\(/g },
  { id: "admin-batch-write", regex: /\.batch\s*\(|\.commit\s*\(/g },
  { id: "transaction-write", regex: /runTransaction|transaction\.(set|update|delete|create)\s*\(/g },
  { id: "rest-write", regex: /\bfetch\s*\([^)]*\b(method\s*:\s*["'`](POST|PUT|PATCH|DELETE)["'`]|PATCH|DELETE)/gis },
];

const authPatterns = [
  { id: "bearer-token", regex: /authorization|bearer|idToken/gi },
  { id: "staff-check", regex: /requireStaff|assertStaff|isStaff|staffOnly|customClaims|admin/i },
  { id: "auth-context", regex: /request\.auth|context\.auth|onRequest|HttpsError|uid/i },
  { id: "app-check", regex: /appCheck|X-Firebase-AppCheck/i },
];

function parseArgs(argv) {
  const args = {
    json: false,
    artifact: "output/qa/firestore-write-surface-inventory.json",
    markdown: "output/qa/firestore-write-surface-inventory.md",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--artifact" && argv[index + 1]) {
      args.artifact = String(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      args.artifact = arg.slice("--artifact=".length);
      continue;
    }
    if (arg === "--markdown" && argv[index + 1]) {
      args.markdown = String(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--markdown=")) {
      args.markdown = arg.slice("--markdown=".length);
      continue;
    }
    if (arg === "--no-markdown") {
      args.markdown = "";
      continue;
    }
  }

  return args;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "lib" || entry.name === "dist") continue;
      walk(fullPath, out);
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(extname(entry.name).toLowerCase())) {
      out.push(fullPath);
    }
  }
  return out;
}

function countMatches(text, regex) {
  regex.lastIndex = 0;
  let count = 0;
  while (regex.exec(text)) count += 1;
  return count;
}

function collectCollectionHints(text) {
  const hints = new Set();
  const callPattern = /\b(?:collection|doc)\s*\(([^)]{0,240})\)/g;
  for (const match of text.matchAll(callPattern)) {
    const args = String(match[1] || "");
    for (const literal of args.matchAll(/["'`]([^"'`]{2,120})["'`]/g)) {
      const value = literal[1];
      if (/^[A-Za-z0-9_./${}-]+$/.test(value) && !value.includes("http")) {
        hints.add(value);
      }
    }
  }
  return Array.from(hints).slice(0, 24);
}

function inferProductArea(file) {
  const rel = toRepoPath(file);
  if (rel.startsWith("functions/src/")) return "functions";
  if (rel.startsWith("web/src/")) return "portal web";
  if (rel.startsWith("studio-brain/src/")) return "Studio Brain";
  return "unknown";
}

function inferOwnerScope(file) {
  const rel = toRepoPath(file);
  if (rel.includes("reservation")) return "reservations/studio operations";
  if (rel.includes("notification")) return "notifications";
  if (rel.includes("library")) return "library";
  if (rel.includes("event")) return "events/workshops";
  if (rel.includes("billing") || rel.includes("stripe")) return "billing/payments";
  if (rel.includes("community")) return "community/blog/safety";
  if (rel.includes("agent")) return "agent commerce/delegation";
  if (rel.startsWith("studio-brain/src/")) return "Studio Brain ops";
  return inferProductArea(file);
}

function inferVerificationGate(file) {
  const rel = toRepoPath(file);
  if (rel.startsWith("functions/src/")) return "npm --prefix functions run lint && npm --prefix functions run build";
  if (rel.startsWith("web/src/")) return "npm --prefix web run lint && npm --prefix web run build";
  if (rel.startsWith("studio-brain/src/")) return "npm --prefix studio-brain run build";
  return "targeted owner gate";
}

function toRepoPath(path) {
  return relative(repoRoot, path).replace(/\\/g, "/");
}

function scanFile(file) {
  const text = readFileSync(file, "utf8");
  const writes = writePatterns
    .map((pattern) => ({ id: pattern.id, count: countMatches(text, pattern.regex) }))
    .filter((entry) => entry.count > 0);
  const auth = authPatterns
    .map((pattern) => {
      pattern.regex.lastIndex = 0;
      return { id: pattern.id, present: pattern.regex.test(text) };
    })
    .filter((entry) => entry.present)
    .map((entry) => entry.id);

  if (writes.length === 0 && auth.length === 0) return null;

  const writeCount = writes.reduce((sum, entry) => sum + entry.count, 0);
  const authMode = auth.length > 0 ? auth.join(", ") : "no auth signal in file";
  return {
    file: toRepoPath(file),
    productArea: inferProductArea(file),
    ownerScope: inferOwnerScope(file),
    writeCount,
    writes,
    authMode,
    collectionHints: collectCollectionHints(text),
    verificationGate: inferVerificationGate(file),
    priority: writeCount > 0 && auth.length === 0 ? "review-auth-boundary" : writeCount > 0 ? "write-surface" : "auth-surface",
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Firestore/Auth Write Surface Inventory");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Files scanned: ${report.summary.filesScanned}`);
  lines.push(`- Files with write signals: ${report.summary.filesWithWriteSignals}`);
  lines.push(`- Files with auth signals: ${report.summary.filesWithAuthSignals}`);
  lines.push(`- Total write-like matches: ${report.summary.writeSignalCount}`);
  lines.push("");
  lines.push("## Groups");
  lines.push("");
  lines.push("| Owner/scope | Files | Write signals | Verification gate |");
  lines.push("| --- | ---: | ---: | --- |");
  for (const group of report.groups) {
    lines.push(`| ${group.ownerScope} | ${group.files.length} | ${group.writeSignalCount} | ${group.verificationGate} |`);
  }
  lines.push("");
  lines.push("## Highest-Risk Files");
  lines.push("");
  lines.push("| File | Owner/scope | Writes | Auth mode | Collection hints |");
  lines.push("| --- | --- | ---: | --- | --- |");
  for (const file of report.files.filter((entry) => entry.writeCount > 0).sort((a, b) => b.writeCount - a.writeCount).slice(0, 80)) {
    lines.push(`| \`${file.file}\` | ${file.ownerScope} | ${file.writeCount} | ${file.authMode} | ${file.collectionHints.slice(0, 6).join(", ")} |`);
  }
  lines.push("");
  lines.push("Refresh with `npm run audit:write-surfaces`.");
  lines.push("");
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = scanRoots.flatMap((root) => walk(resolve(repoRoot, root)));
  const scanned = files.map(scanFile).filter(Boolean);
  const groupMap = new Map();
  for (const file of scanned) {
    const key = file.ownerScope;
    const existing = groupMap.get(key) || {
      ownerScope: key,
      files: [],
      writeSignalCount: 0,
      authModes: new Set(),
      collectionHints: new Set(),
      verificationGate: file.verificationGate,
    };
    existing.files.push(file.file);
    existing.writeSignalCount += file.writeCount;
    existing.authModes.add(file.authMode);
    for (const hint of file.collectionHints) existing.collectionHints.add(hint);
    groupMap.set(key, existing);
  }

  const groups = Array.from(groupMap.values()).map((group) => ({
    ...group,
    authModes: Array.from(group.authModes),
    collectionHints: Array.from(group.collectionHints).slice(0, 40),
  })).sort((a, b) => b.writeSignalCount - a.writeSignalCount);

  const report = {
    schema: "firestore-write-surface-inventory-v1",
    generatedAt: new Date().toISOString(),
    status: "pass",
    scanRoots,
    summary: {
      filesScanned: files.length,
      filesWithSignals: scanned.length,
      filesWithWriteSignals: scanned.filter((entry) => entry.writeCount > 0).length,
      filesWithAuthSignals: scanned.filter((entry) => entry.authMode !== "no auth signal in file").length,
      writeSignalCount: scanned.reduce((sum, entry) => sum + entry.writeCount, 0),
      groups: groups.length,
    },
    groups,
    files: scanned,
  };

  const artifactPath = resolve(repoRoot, args.artifact);
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (args.markdown) {
    const markdownPath = resolve(repoRoot, args.markdown);
    mkdirSync(dirname(markdownPath), { recursive: true });
    writeFileSync(markdownPath, buildMarkdown(report), "utf8");
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`firestore-write-surface-inventory: ${report.status}\n`);
    process.stdout.write(`files scanned: ${report.summary.filesScanned}\n`);
    process.stdout.write(`write signals: ${report.summary.writeSignalCount}\n`);
    process.stdout.write(`artifact: ${artifactPath}\n`);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`firestore-write-surface-inventory failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
