#!/usr/bin/env node

import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isoNow, parseCliArgs, readBoolFlag, readStringFlag, writeJson } from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "PST evidence pruning",
      "",
      "Usage:",
      "  node ./scripts/pst-prune-evidence.mjs --mode manifest-only --root ./output/memory --keep-full pst-signal-quality-run-2026-03-06-gatewayrecover --dry-run",
      "",
      "Options:",
      "  --mode <name>        Cleanup mode (default: manifest-only)",
      "  --root <path>        Evidence root (default: ./output/memory)",
      "  --keep-full <list>   Comma-separated run directory names to preserve fully",
      "  --dry-run            Report only",
      "  --apply              Delete matched paths",
    ].join("\n")
  );
}

function listify(value) {
  return String(value || "")
    .split(/[;,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function fileSize(path) {
  try {
    const stat = lstatSync(path);
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;
    let total = 0;
    for (const entry of readdirSync(path)) {
      total += fileSize(join(path, entry));
    }
    return total;
  } catch {
    return 0;
  }
}

function existing(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function runDirNames(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^pst-signal-quality-run-|^pst-hardening-realrun-|^identity-eval-/.test(name))
    .sort();
}

function removablePaths(runPath) {
  return [
    join(runPath, "canonical-corpus", "source-units.jsonl"),
    join(runPath, "canonical-corpus", "raw-sidecars"),
    join(runPath, "canonical-corpus", "source-index"),
    join(runPath, "canonical-corpus", "fact-events.jsonl"),
    join(runPath, "canonical-corpus", "hypotheses.jsonl"),
    join(runPath, "canonical-corpus", "dossiers.jsonl"),
    join(runPath, "canonical-corpus", "dossiers"),
    join(runPath, "fresh-analysis", "mailbox-analysis-memory.jsonl"),
    join(runPath, "fresh-analysis", "mailbox-promoted-memory.jsonl"),
    join(runPath, "fresh-analysis", "dead-letter.jsonl"),
    join(runPath, "fresh-analysis", "promote-dead-letter.jsonl"),
  ].filter(existing);
}

function retainedPaths(runPath) {
  return [
    join(runPath, "pipeline.log"),
    join(runPath, "fresh-analysis", "report.json"),
    join(runPath, "fresh-analysis", "promote-report.json"),
    join(runPath, "fresh-analysis", "message-gateway-report.json"),
    join(runPath, "canonical-corpus", "manifest.json"),
    join(runPath, "signal-quality", "report.json"),
    join(runPath, "signal-quality", "production-readiness.json"),
    join(runPath, "signal-quality", "review-pack.md"),
  ].filter(existing);
}

function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (flags.help || flags.h) {
    usage();
    return;
  }

  const root = resolve(REPO_ROOT, readStringFlag(flags, "root", "./output/memory"));
  const mode = readStringFlag(flags, "mode", "manifest-only");
  const keepFull = new Set(listify(readStringFlag(flags, "keep-full", "")));
  const apply = readBoolFlag(flags, "apply", false);
  const dryRun = apply ? false : readBoolFlag(flags, "dry-run", true);
  const cleanupDir = join(root, "cleanup");
  mkdirSync(cleanupDir, { recursive: true });

  const report = {
    schema: "pst-evidence-prune-report.v1",
    generatedAt: isoNow(),
    mode,
    root,
    dryRun,
    apply,
    runs: [],
    totals: {
      bytesBefore: 0,
      bytesReclaimed: 0,
      runsTrimmed: 0,
    },
  };

  for (const runName of runDirNames(root)) {
    const runPath = join(root, runName);
    const bytesBefore = fileSize(runPath);
    report.totals.bytesBefore += bytesBefore;
    if (keepFull.has(runName)) {
      report.runs.push({
        runName,
        runPath,
        keptFull: true,
        bytesBefore,
        bytesReclaimed: 0,
        kept: retainedPaths(runPath),
        removed: [],
      });
      continue;
    }
    const removed = removablePaths(runPath);
    const bytesReclaimed = removed.reduce((sum, path) => sum + fileSize(path), 0);
    if (apply) {
      for (const path of removed) rmSync(path, { recursive: true, force: true });
    }
    report.totals.bytesReclaimed += bytesReclaimed;
    report.totals.runsTrimmed += 1;
    report.runs.push({
      runName,
      runPath,
      keptFull: false,
      bytesBefore,
      bytesReclaimed,
      kept: retainedPaths(runPath),
      removed,
    });
  }

  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const outPath = join(cleanupDir, `prune-${stamp}.json`);
  writeJson(outPath, report);
  process.stdout.write(`${JSON.stringify({ reportPath: outPath, totals: report.totals }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`pst-prune-evidence failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
