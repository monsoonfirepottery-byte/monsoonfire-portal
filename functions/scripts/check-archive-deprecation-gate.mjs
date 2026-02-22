#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const ARCHIVE_FILE = "archive/index_old.ts";
const ARCHIVE_ENABLE_FLAG = "MF_ENABLE_ARCHIVED_FUNCTIONS";

function walkTsFiles(rootPath) {
  const out = [];
  const stack = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (entry.isFile() && absolute.endsWith(".ts")) {
        out.push(absolute);
      }
    }
  }
  return out;
}

function readJson(relativePath) {
  const absolute = resolve(process.cwd(), relativePath);
  return JSON.parse(readFileSync(absolute, "utf8"));
}

const failures = [];
const warnings = [];

const tsconfig = readJson("tsconfig.json");
const include = Array.isArray(tsconfig.include) ? tsconfig.include : [];
const includesArchive = include.some((entry) => String(entry).toLowerCase().includes("archive"));
if (includesArchive) {
  failures.push("tsconfig includes archive paths; archived code must not be part of active functions build.");
}

const sourceRoot = resolve(process.cwd(), "src");
const files = walkTsFiles(sourceRoot);
const archiveImportPattern =
  /(from\s+["'][^"']*archive\/index_old(?:\.ts)?["'])|(require\(\s*["'][^"']*archive\/index_old(?:\.ts)?["']\s*\))/;
for (const absolutePath of files) {
  const content = readFileSync(absolutePath, "utf8");
  if (!archiveImportPattern.test(content)) continue;
  failures.push(`archived route import detected in ${absolutePath.replace(`${process.cwd()}/`, "")}`);
}

const archivePath = resolve(process.cwd(), ARCHIVE_FILE);
const archiveContent = readFileSync(archivePath, "utf8");
if (!archiveContent.includes(ARCHIVE_ENABLE_FLAG)) {
  failures.push(`archive route gate flag ${ARCHIVE_ENABLE_FLAG} is missing from ${ARCHIVE_FILE}`);
}
if (!archiveContent.includes("ARCHIVED_ROUTE_DISABLED")) {
  failures.push(`archive route disable response code is missing from ${ARCHIVE_FILE}`);
}

if (archiveContent.includes(`export const`) && !archiveContent.includes("archived_route_deprecated_used")) {
  warnings.push(`archived exports exist in ${ARCHIVE_FILE} without deprecation usage warning telemetry.`);
}

if (warnings.length > 0) {
  for (const row of warnings) {
    process.stderr.write(`[archive-gate] WARN: ${row}\n`);
  }
}

if (failures.length > 0) {
  for (const row of failures) {
    process.stderr.write(`[archive-gate] FAIL: ${row}\n`);
  }
  process.exit(1);
}

process.stdout.write("[archive-gate] PASS: archived auth routes are build-gated and runtime-gated.\n");
