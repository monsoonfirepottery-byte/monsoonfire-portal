#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_WIKI_OUTCOMES_PATH,
  repoRelative,
  summarizeWikiOutcomeUsefulness,
} from "./lib/wiki-postgres-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");
const DEFAULT_ARTIFACT = "output/wiki/outcome-record.json";
const WIKI_RELEVANCE_PATTERN = /\b(wiki|context pack|context-pack|contradiction|source drift)\b/i;
const OUTCOME_VALUES = new Set([
  "used",
  "helpful",
  "resolved",
  "not_used",
  "stale",
  "misleading",
  "blocked",
  "superseded",
]);
const CLASSIFICATION_VALUES = new Set(["test", "organic"]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function slug(value, maxLength = 56) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength) || "outcome";
}

function resolveRepoPath(path) {
  return resolve(REPO_ROOT, String(path || ""));
}

function readJsonlFileIfExists(path) {
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid outcome JSONL at ${path}:${index + 1}: ${error.message}`);
      }
    });
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readValue(argv, index, name) {
  const arg = clean(argv[index]);
  if (arg === name) {
    if (!argv[index + 1]) throw new Error(`${name} requires a value.`);
    return { matched: true, value: argv[index + 1], nextIndex: index + 1 };
  }
  if (arg.startsWith(`${name}=`)) {
    return { matched: true, value: arg.slice(name.length + 1), nextIndex: index };
  }
  return { matched: false, value: null, nextIndex: index };
}

export function parseArgs(argv) {
  const args = {
    json: false,
    dryRun: false,
    summary: false,
    trend: false,
    outcomesPath: DEFAULT_WIKI_OUTCOMES_PATH,
    artifactPath: resolveRepoPath(DEFAULT_ARTIFACT),
    artifactExplicit: false,
    packetId: "",
    title: "",
    outcome: "",
    minutesSaved: 0,
    usedBy: clean(process.env.USERNAME) || clean(process.env.USER) || "codex",
    notes: "",
    source: "wiki-outcome-recorder",
    classification: "",
    sourceCommand: "",
    evidenceArtifactPath: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--summary") {
      args.summary = true;
      continue;
    }
    if (arg === "--trend") {
      args.summary = true;
      args.trend = true;
      continue;
    }

    const mappings = [
      ["--outcomes", "outcomesPath"],
      ["--artifact", "artifactPath"],
      ["--packet-id", "packetId"],
      ["--packet", "packetId"],
      ["--title", "title"],
      ["--outcome", "outcome"],
      ["--minutes-saved", "minutesSaved"],
      ["--used-by", "usedBy"],
      ["--notes", "notes"],
      ["--note", "notes"],
      ["--source", "source"],
      ["--classification", "classification"],
      ["--source-command", "sourceCommand"],
      ["--evidence-artifact", "evidenceArtifactPath"],
    ];
    let consumed = false;
    for (const [flag, key] of mappings) {
      const parsed = readValue(argv, index, flag);
      if (!parsed.matched) continue;
      args[key] = parsed.value;
      if (key === "artifactPath") args.artifactExplicit = true;
      index = parsed.nextIndex;
      consumed = true;
      break;
    }
    if (consumed) continue;
    throw new Error(`Unknown argument: ${arg}`);
  }

  args.outcomesPath = resolveRepoPath(args.outcomesPath);
  args.artifactPath = args.artifactPath ? resolveRepoPath(args.artifactPath) : "";
  args.evidenceArtifactPath = clean(args.evidenceArtifactPath);
  args.minutesSaved = Number(args.minutesSaved) || 0;
  return args;
}

function defaultClassification(options) {
  const hint = `${options.source || ""} ${options.packetId || ""} ${options.title || ""}`;
  return /\b(test|fixture|e2e|unit)\b/i.test(hint) ? "test" : "organic";
}

export function buildWikiOutcomeEntry(options = {}, deps = {}) {
  const now = deps.now || (() => new Date().toISOString());
  const recordedAt = clean(options.recordedAt) || now();
  const outcome = clean(options.outcome);
  const title = clean(options.title);
  const notes = clean(options.notes);
  const packetId = clean(options.packetId) || `wiki-outcome-${slug(title || notes || outcome)}-${recordedAt.replace(/[:.]/g, "-")}`;
  const minutesSaved = Number(options.minutesSaved) || 0;
  const classification = clean(options.classification) || defaultClassification({ ...options, packetId, title });

  if (!outcome) throw new Error("--outcome is required.");
  if (!OUTCOME_VALUES.has(outcome)) {
    throw new Error(`Unsupported --outcome value: ${outcome}. Expected one of ${[...OUTCOME_VALUES].join(", ")}.`);
  }
  if (!CLASSIFICATION_VALUES.has(classification)) {
    throw new Error(`Unsupported --classification value: ${classification}. Expected one of ${[...CLASSIFICATION_VALUES].join(", ")}.`);
  }
  if (!title && !notes) throw new Error("--title or --notes is required.");
  if (minutesSaved < 0) throw new Error("--minutes-saved must be zero or greater.");
  if (!WIKI_RELEVANCE_PATTERN.test(`${packetId} ${title} ${notes}`)) {
    throw new Error("Wiki outcome records must mention wiki, context pack, contradiction, or source drift in the packet id, title, or notes.");
  }

  return {
    schema: "studiobrain-agent-harness-outcome.v1",
    recordedAt,
    packetId,
    title,
    outcome,
    minutesSaved,
    usedBy: clean(options.usedBy) || "codex",
    notes,
    source: clean(options.source) || "wiki-outcome-recorder",
    classification,
    organicEligible: classification === "organic",
    provenance: {
      sourceCommand: clean(options.sourceCommand) || null,
      artifactPath: clean(options.evidenceArtifactPath) || null,
      classification,
    },
  };
}

export function recordWikiOutcome(options = {}, deps = {}) {
  const outcomesPath = resolveRepoPath(options.outcomesPath || options.outcomes || DEFAULT_WIKI_OUTCOMES_PATH);
  const artifactPath = options.artifactPath === "" ? "" : resolveRepoPath(options.artifactPath || DEFAULT_ARTIFACT);
  const entry = buildWikiOutcomeEntry(options, deps);
  const priorOutcomes = readJsonlFileIfExists(outcomesPath);
  const outcomeUsefulness = summarizeWikiOutcomeUsefulness([...priorOutcomes, entry]);
  const report = {
    schema: "wiki-outcome-record-report.v1",
    generatedAt: entry.recordedAt,
    status: options.dryRun ? "planned" : "pass",
    dryRun: Boolean(options.dryRun),
    outcomesPath,
    outcomesPathRelative: repoRelative(outcomesPath),
    entry,
    summary: outcomeUsefulness,
  };

  if (!options.dryRun) {
    mkdirSync(dirname(outcomesPath), { recursive: true });
    appendFileSync(outcomesPath, `${JSON.stringify(entry)}\n`, "utf8");
  }
  if (artifactPath) {
    report.artifactPath = artifactPath;
    report.artifactPathRelative = repoRelative(artifactPath);
    writeJson(artifactPath, report);
  }
  return report;
}

export function summarizeWikiOutcomes(options = {}) {
  const outcomesPath = resolveRepoPath(options.outcomesPath || options.outcomes || DEFAULT_WIKI_OUTCOMES_PATH);
  const outcomes = readJsonlFileIfExists(outcomesPath);
  const summary = summarizeWikiOutcomeUsefulness(outcomes);
  const report = {
    schema: options.trend ? "wiki-outcome-trend-report.v1" : "wiki-outcome-summary-report.v1",
    generatedAt: new Date().toISOString(),
    status: summary.verdict === "useful" ? "pass" : "warning",
    outcomesPath,
    outcomesPathRelative: repoRelative(outcomesPath),
    summary,
    trend: {
      totals: {
        outcomes: summary.total,
        helpful: summary.helpful,
        staleOrMisleading: summary.staleOrMisleading,
        staleOrMisleadingRate: summary.staleOrMisleadingRate,
        organic: summary.organic,
        test: summary.test,
      },
      verdict: summary.verdict,
      recentRecords: summary.recentRecords,
    },
  };
  const defaultArtifactPath = options.trend ? "output/wiki/outcome-trend.json" : "output/wiki/outcome-summary.json";
  const artifactPath = options.artifactPath === ""
    ? ""
    : resolveRepoPath(options.artifactExplicit ? options.artifactPath : defaultArtifactPath);
  if (artifactPath) {
    report.artifactPath = artifactPath;
    report.artifactPathRelative = repoRelative(artifactPath);
    writeJson(artifactPath, report);
  }
  return report;
}

function printHuman(report) {
  process.stdout.write(`wiki outcome ${report.schema}: ${report.status}\n`);
  process.stdout.write(`  outcomes: ${report.summary.total}\n`);
  process.stdout.write(`  helpful: ${report.summary.helpful}\n`);
  process.stdout.write(`  staleOrMisleading: ${report.summary.staleOrMisleading}\n`);
  process.stdout.write(`  organic: ${report.summary.organic}\n`);
  process.stdout.write(`  test: ${report.summary.test}\n`);
  process.stdout.write(`  minutesSaved: ${report.summary.totalMinutesSaved}\n`);
  process.stdout.write(`  verdict: ${report.summary.verdict}\n`);
  if (report.entry) process.stdout.write(`  recorded: ${report.entry.packetId} ${report.entry.outcome}\n`);
  process.stdout.write(`  ledger: ${report.outcomesPathRelative || report.outcomesPath}\n`);
}

export function runWikiOutcomeRecorder(rawArgs = process.argv.slice(2)) {
  const args = parseArgs(rawArgs);
  const report = args.summary ? summarizeWikiOutcomes(args) : recordWikiOutcome(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHuman(report);
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  try {
    runWikiOutcomeRecorder();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
