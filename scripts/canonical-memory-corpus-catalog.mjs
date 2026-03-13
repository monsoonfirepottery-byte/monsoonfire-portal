#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureParentDir,
  isoNow,
  parseCliArgs,
  readBoolFlag,
  readJson,
  readStringFlag,
  writeJson,
} from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "Canonical memory corpus catalog builder",
      "",
      "Usage:",
      "  node ./scripts/canonical-memory-corpus-catalog.mjs \\",
      "    --root ./output/memory \\",
      "    --output ./output/memory/ingest-catalog.json",
      "",
      "Options:",
      "  --root <path>            Root directory to scan (default: ./output/memory)",
      "  --output <path>          Catalog output JSON path",
      "  --json                   Print catalog JSON",
    ].join("\n")
  );
}

function inferSourceFamily(manifestPath, manifest) {
  const runId = String(manifest?.runId || "").toLowerCase();
  const unitsPath = String(manifest?.inputs?.unitsPath || "").toLowerCase();
  if (runId.startsWith("mail-") || unitsPath.includes("/imports/mail/")) return "mail";
  if (runId.startsWith("twitter-") || unitsPath.includes("twitter")) return "twitter";
  if (runId.startsWith("docs-") || unitsPath.includes("document")) return "docs";
  if (runId.startsWith("pst-") || unitsPath.includes("/imports/pst/")) return "pst";
  return "unknown";
}

function collectManifestPaths(rootPath, depth = 0, maxDepth = 6) {
  const entries = [];
  if (depth > maxDepth) return entries;
  for (const child of readdirSync(rootPath, { withFileTypes: true })) {
    if (!child.isDirectory()) continue;
    const childPath = join(rootPath, child.name);
    const manifestPath = join(childPath, "canonical-corpus", "manifest.json");
    if (existsSync(manifestPath)) {
      entries.push(manifestPath);
    }
    entries.push(...collectManifestPaths(childPath, depth + 1, maxDepth));
  }
  return Array.from(new Set(entries)).sort();
}

function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const rootPath = resolve(REPO_ROOT, readStringFlag(flags, "root", "./output/memory"));
  const outputPath = resolve(REPO_ROOT, readStringFlag(flags, "output", "./output/memory/ingest-catalog.json"));
  const printJson = readBoolFlag(flags, "json", false);

  const manifestPaths = collectManifestPaths(rootPath);
  const runs = manifestPaths
    .map((manifestPath) => {
      const manifest = readJson(manifestPath, null);
      if (!manifest || typeof manifest !== "object") return null;
      const manifestDir = dirname(manifestPath);
      return {
        runId: manifest.runId || null,
        sourceFamily: inferSourceFamily(manifestPath, manifest),
        manifestPath,
        sqlitePath: join(manifestDir, "corpus.sqlite"),
        status: manifest.status || "unknown",
        generatedAt: manifest.generatedAt || null,
        counts: manifest.counts || {},
      };
    })
    .filter(Boolean);

  const catalog = {
    schema: "canonical-memory-corpus-catalog.v1",
    generatedAt: isoNow(),
    rootPath,
    runCount: runs.length,
    runs,
  };

  ensureParentDir(outputPath);
  writeJson(outputPath, catalog);

  if (printJson) {
    process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`);
    return;
  }

  process.stdout.write("canonical-memory-corpus-catalog complete\n");
  process.stdout.write(`output: ${outputPath}\n`);
  process.stdout.write(`runs: ${runs.length}\n`);
}

main();
