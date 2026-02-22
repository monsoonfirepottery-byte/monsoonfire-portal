#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FUNCTIONS_DIR = resolve(ROOT, "functions");
const FUNCTIONS_LIB_DIR = resolve(FUNCTIONS_DIR, "lib");
const DEFAULT_ARTIFACT = resolve(ROOT, "output/functions-coldstart-profile/latest.json");

const defaultRuns = 7;
const args = parseArgs(process.argv.slice(2));
const runs = Number.isFinite(args.runs) && args.runs > 0 ? Math.floor(args.runs) : defaultRuns;
const artifactPath = args.artifact || DEFAULT_ARTIFACT;

const moduleTargets = [
  { id: "index", path: resolve(FUNCTIONS_LIB_DIR, "index.js") },
  { id: "apiV1", path: resolve(FUNCTIONS_LIB_DIR, "apiV1.js") },
  { id: "events", path: resolve(FUNCTIONS_LIB_DIR, "events.js") },
  { id: "stripeConfig", path: resolve(FUNCTIONS_LIB_DIR, "stripeConfig.js") },
  { id: "reports", path: resolve(FUNCTIONS_LIB_DIR, "reports.js") },
];

const missing = moduleTargets.filter((entry) => !existsSync(entry.path)).map((entry) => entry.path);
if (missing.length > 0) {
  process.stderr.write("Missing compiled functions artifacts.\n");
  for (const path of missing) process.stderr.write(`- ${path}\n`);
  process.stderr.write("Run `npm --prefix functions run build` and retry.\n");
  process.exit(1);
}

const profileRows = [];
for (const target of moduleTargets) {
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    samples.push(sampleImport([target.path]));
  }
  profileRows.push(makeStatsRow(target.id, samples, {
    mode: "single-import",
    targetPath: relativePath(target.path),
  }));
}

const compositeSamples = [];
for (let i = 0; i < runs; i += 1) {
  compositeSamples.push(
    sampleImport([
      resolve(FUNCTIONS_LIB_DIR, "index.js"),
      resolve(FUNCTIONS_LIB_DIR, "apiV1.js"),
    ])
  );
}
profileRows.push(
  makeStatsRow("index_plus_apiV1", compositeSamples, {
    mode: "composite-import",
    targetPath: `${relativePath(resolve(FUNCTIONS_LIB_DIR, "index.js"))} + ${relativePath(
      resolve(FUNCTIONS_LIB_DIR, "apiV1.js")
    )}`,
    note:
      "Approximate legacy eager-load path: index module import plus immediate apiV1 module import in same cold process.",
  })
);

profileRows.sort((a, b) => b.p95Ms - a.p95Ms);

const payload = {
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cwd: ROOT,
  },
  command: `node ./scripts/functions-coldstart-profile.mjs --runs ${runs} --artifact ${relativePath(
    artifactPath
  )}`,
  runs,
  rows: profileRows,
};

mkdirSync(dirname(artifactPath), { recursive: true });
writeFileSync(artifactPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

process.stdout.write(`functions-coldstart-profile (runs=${runs})\n`);
for (const row of profileRows) {
  process.stdout.write(
    `${row.id.padEnd(20)} p95=${format(row.p95Ms)}ms avg=${format(row.avgMs)}ms min=${format(
      row.minMs
    )}ms max=${format(row.maxMs)}ms\n`
  );
}
process.stdout.write(`artifact: ${relativePath(artifactPath)}\n`);

function sampleImport(paths) {
  const imports = paths.map((path) => pathToFileURL(path).href);
  const script = `
import { performance } from "node:perf_hooks";
const targets = JSON.parse(process.argv[1]);
const start = performance.now();
for (const target of targets) {
  await import(target);
}
const end = performance.now();
process.stdout.write(String(end - start));
`;

  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script, JSON.stringify(imports)], {
    cwd: FUNCTIONS_DIR,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const errorText = result.stderr || result.stdout || `exit ${result.status}`;
    throw new Error(`Cold import probe failed: ${errorText}`);
  }

  const value = Number.parseFloat((result.stdout || "").trim());
  if (!Number.isFinite(value)) {
    throw new Error(`Cold import probe returned non-numeric output: ${result.stdout}`);
  }
  return value;
}

function makeStatsRow(id, samples, meta) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    id,
    ...meta,
    sampleCount: sorted.length,
    minMs: sorted[0],
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    avgMs: sum / sorted.length,
    maxMs: sorted[sorted.length - 1],
    samplesMs: sorted,
  };
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0;
  const rank = Math.ceil((p / 100) * sortedValues.length) - 1;
  const index = Math.max(0, Math.min(sortedValues.length - 1, rank));
  return sortedValues[index];
}

function relativePath(path) {
  if (path.startsWith(`${ROOT}/`)) return path.slice(ROOT.length + 1);
  return path;
}

function format(value) {
  return Number(value).toFixed(2);
}

function parseArgs(argv) {
  const parsed = { runs: defaultRuns, artifact: DEFAULT_ARTIFACT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--runs" && argv[i + 1]) {
      parsed.runs = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--runs=")) {
      parsed.runs = Number(arg.slice("--runs=".length));
      continue;
    }
    if (arg === "--artifact" && argv[i + 1]) {
      parsed.artifact = resolve(ROOT, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      parsed.artifact = resolve(ROOT, arg.slice("--artifact=".length));
    }
  }
  return parsed;
}
