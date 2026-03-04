#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FUNCTIONS_DIR = resolve(ROOT, "functions");
const FUNCTIONS_LIB_DIR = resolve(FUNCTIONS_DIR, "lib");
const DEFAULT_ARTIFACT = resolve(ROOT, "output/functions-coldstart-profile/latest.json");
const DEFAULT_MARKDOWN_ARTIFACT = resolve(ROOT, "output/functions-coldstart-profile/latest.md");
const DEFAULT_MAX_P95_MS = 1500;
const DEFAULT_TARGET_P95_BUDGETS = {
  index: 1200,
  apiV1: 1200,
  events: 900,
  stripeConfig: 900,
  reports: 900,
  index_plus_apiV1: 1600,
};

const defaultRuns = 7;
const args = parseArgs(process.argv.slice(2));
const runs = Number.isFinite(args.runs) && args.runs > 0 ? Math.floor(args.runs) : defaultRuns;
const artifactPath = args.artifact || DEFAULT_ARTIFACT;
const markdownPath = args.reportMarkdown || DEFAULT_MARKDOWN_ARTIFACT;
const targetBudgets = {
  ...DEFAULT_TARGET_P95_BUDGETS,
  ...args.targetBudgets,
};

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

const breaches = [];
for (const row of profileRows) {
  const maxP95Ms = Number(targetBudgets[row.id] ?? args.maxP95Ms);
  if (Number.isFinite(maxP95Ms) && row.p95Ms > maxP95Ms) {
    breaches.push({
      id: row.id,
      metric: "p95Ms",
      observedMs: row.p95Ms,
      budgetMs: maxP95Ms,
      deltaMs: row.p95Ms - maxP95Ms,
    });
  }
}
const status = breaches.length === 0 ? "pass" : "fail";

const payload = {
  generatedAt: new Date().toISOString(),
  status,
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cwd: ROOT,
  },
  command: process.argv.join(" "),
  runs,
  thresholds: {
    defaultMaxP95Ms: args.maxP95Ms,
    targetMaxP95Ms: targetBudgets,
  },
  rows: profileRows,
  breaches,
  artifacts: {
    json: relativePath(artifactPath),
    markdown: relativePath(markdownPath),
  },
};

mkdirSync(dirname(artifactPath), { recursive: true });
mkdirSync(dirname(markdownPath), { recursive: true });
writeFileSync(artifactPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
writeFileSync(markdownPath, buildMarkdown(payload), "utf8");

process.stdout.write(`functions-coldstart-profile (runs=${runs}, status=${status})\n`);
for (const row of profileRows) {
  const budget = Number(targetBudgets[row.id] ?? args.maxP95Ms);
  const budgetLabel = Number.isFinite(budget) ? `${format(budget)}ms` : "n/a";
  process.stdout.write(
    `${row.id.padEnd(20)} p95=${format(row.p95Ms)}ms avg=${format(row.avgMs)}ms min=${format(
      row.minMs
    )}ms max=${format(row.maxMs)}ms budget=${budgetLabel}\n`
  );
}
process.stdout.write(`artifact: ${relativePath(artifactPath)}\n`);
process.stdout.write(`markdown: ${relativePath(markdownPath)}\n`);
if (breaches.length > 0) {
  process.stdout.write("breaches:\n");
  for (const breach of breaches) {
    process.stdout.write(
      `- ${breach.id} p95 ${format(breach.observedMs)}ms > ${format(breach.budgetMs)}ms (+${format(
        breach.deltaMs
      )}ms)\n`
    );
  }
}

if (args.asJson) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
if (args.strict && status !== "pass") {
  process.exit(1);
}

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

function buildMarkdown(payload) {
  const lines = [];
  lines.push("# Functions Coldstart Profile");
  lines.push("");
  lines.push(`- Generated at: ${payload.generatedAt}`);
  lines.push(`- Status: ${payload.status}`);
  lines.push(`- Runs per target: ${payload.runs}`);
  lines.push(`- Default max p95: ${payload.thresholds.defaultMaxP95Ms}ms`);
  lines.push("");
  lines.push("## Rows");
  lines.push("| Target | p95 (ms) | avg (ms) | min (ms) | max (ms) | Budget (ms) |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const row of payload.rows) {
    const budget = Number(payload.thresholds.targetMaxP95Ms?.[row.id] ?? payload.thresholds.defaultMaxP95Ms);
    lines.push(
      `| ${row.id} | ${format(row.p95Ms)} | ${format(row.avgMs)} | ${format(row.minMs)} | ${format(
        row.maxMs
      )} | ${Number.isFinite(budget) ? format(budget) : "n/a"} |`
    );
  }
  lines.push("");
  lines.push("## Breaches");
  if (!Array.isArray(payload.breaches) || payload.breaches.length === 0) {
    lines.push("- None");
  } else {
    for (const breach of payload.breaches) {
      lines.push(
        `- ${breach.id}: p95 ${format(breach.observedMs)}ms > ${format(breach.budgetMs)}ms (+${format(
          breach.deltaMs
        )}ms)`
      );
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const parsed = {
    runs: defaultRuns,
    artifact: DEFAULT_ARTIFACT,
    reportMarkdown: DEFAULT_MARKDOWN_ARTIFACT,
    strict: false,
    asJson: false,
    maxP95Ms: DEFAULT_MAX_P95_MS,
    targetBudgets: {},
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }
    if (arg === "--json") {
      parsed.asJson = true;
      continue;
    }
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
    if (arg === "--report-markdown" && argv[i + 1]) {
      parsed.reportMarkdown = resolve(ROOT, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--max-p95-ms" && argv[i + 1]) {
      parsed.maxP95Ms = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--budget" && argv[i + 1]) {
      const [idRaw, valueRaw] = String(argv[i + 1]).split("=");
      const id = String(idRaw || "").trim();
      const value = Number(valueRaw);
      if (id && Number.isFinite(value) && value > 0) {
        parsed.targetBudgets[id] = value;
      }
      i += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      parsed.artifact = resolve(ROOT, arg.slice("--artifact=".length));
      continue;
    }
    if (arg.startsWith("--report-markdown=")) {
      parsed.reportMarkdown = resolve(ROOT, arg.slice("--report-markdown=".length));
      continue;
    }
    if (arg.startsWith("--max-p95-ms=")) {
      parsed.maxP95Ms = Number(arg.slice("--max-p95-ms=".length));
      continue;
    }
    if (arg.startsWith("--budget=")) {
      const [idRaw, valueRaw] = arg.slice("--budget=".length).split("=");
      const id = String(idRaw || "").trim();
      const value = Number(valueRaw);
      if (id && Number.isFinite(value) && value > 0) {
        parsed.targetBudgets[id] = value;
      }
      continue;
    }
  }
  if (!Number.isFinite(parsed.maxP95Ms) || parsed.maxP95Ms <= 0) {
    parsed.maxP95Ms = DEFAULT_MAX_P95_MS;
  }
  return parsed;
}
