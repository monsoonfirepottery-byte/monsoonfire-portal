#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_RUNS_ROOT = "output/agent-runs";
const DEFAULT_HANDOFF_ROOT = "output/codex-handoff";

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringList(value, maxItems = 32) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const output = [];
  for (const entry of value) {
    const normalized = clean(entry);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= maxItems) break;
  }
  return output;
}

function parseArgs(argv) {
  const parsed = {
    json: false,
    runId: "",
    title: "",
    goal: "",
    runsRoot: DEFAULT_RUNS_ROOT,
    artifactDir: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--run-id" && argv[index + 1]) {
      parsed.runId = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--run-id=")) {
      parsed.runId = clean(arg.slice("--run-id=".length));
      continue;
    }
    if (arg === "--title" && argv[index + 1]) {
      parsed.title = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--title=")) {
      parsed.title = clean(arg.slice("--title=".length));
      continue;
    }
    if (arg === "--goal" && argv[index + 1]) {
      parsed.goal = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--goal=")) {
      parsed.goal = clean(arg.slice("--goal=".length));
      continue;
    }
    if (arg === "--runs-root" && argv[index + 1]) {
      parsed.runsRoot = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--runs-root=")) {
      parsed.runsRoot = clean(arg.slice("--runs-root=".length));
      continue;
    }
    if (arg === "--artifact-dir" && argv[index + 1]) {
      parsed.artifactDir = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact-dir=")) {
      parsed.artifactDir = clean(arg.slice("--artifact-dir=".length));
    }
  }
  return parsed;
}

function readJsonIfExists(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function repoRelative(repoRoot, path) {
  if (!path) return "";
  return relative(repoRoot, path).replaceAll("\\", "/");
}

function runGit(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 4,
  });
  return {
    ok: result.status === 0,
    stdout: clean(result.stdout),
    stderr: clean(result.stderr),
  };
}

function collectGitSnapshot(repoRoot) {
  const branch = runGit(repoRoot, ["branch", "--show-current"]);
  const status = runGit(repoRoot, ["status", "--short"]);
  const changedFiles = status.stdout ? status.stdout.split(/\r?\n/).filter(Boolean) : [];
  return {
    branch: branch.ok ? branch.stdout : "",
    dirtyCount: changedFiles.length,
    changedFiles: changedFiles.slice(0, 80),
    truncated: changedFiles.length > 80,
    statusCommandOk: status.ok,
  };
}

function resolveRunArtifacts(repoRoot, runsRoot, runId) {
  const runsRootPath = resolve(repoRoot, runsRoot);
  const pointerPath = resolve(runsRootPath, "latest.json");
  const pointer = readJsonIfExists(pointerPath);
  const selectedRunId = clean(runId) || clean(pointer?.runId);
  const runRoot = selectedRunId ? resolve(runsRootPath, selectedRunId) : null;
  const pathFromPointer = (field, fallback) => {
    const pointed = clean(pointer?.[field]);
    if (pointed && (!selectedRunId || selectedRunId === clean(pointer?.runId))) return resolve(repoRoot, pointed);
    return runRoot ? resolve(runRoot, fallback) : null;
  };
  return {
    pointerPath: existsSync(pointerPath) ? pointerPath : null,
    pointer,
    runId: selectedRunId,
    runRoot,
    missionEnvelopePath: pathFromPointer("missionEnvelopePath", "mission-envelope.json"),
    contextPackPath: pathFromPointer("contextPackPath", "context-pack.json"),
    summaryPath: pathFromPointer("summaryPath", "summary.json"),
    ledgerPath: pathFromPointer("ledgerPath", "run-ledger.jsonl"),
  };
}

function buildMemoryCandidates({ summary, missionEnvelope, repo }) {
  const status = clean(summary?.status || "unknown");
  const goal = clean(summary?.goal || missionEnvelope?.goal);
  const blockers = normalizeStringList(summary?.activeBlockers || [], 6);
  const next = clean(summary?.boardRow?.next || "");
  const statementParts = [
    goal ? `Goal: ${goal}` : "",
    `Status: ${status}`,
    blockers.length > 0 ? `Blockers: ${blockers.join("; ")}` : "",
    next ? `Next: ${next}` : "",
    repo?.branch ? `Branch: ${repo.branch}` : "",
  ].filter(Boolean);
  if (statementParts.length === 0) return [];
  return [
    {
      kind: status === "blocked" ? "blocker" : "handoff",
      confidence: "high",
      statement: statementParts.join(" | "),
    },
  ];
}

export function buildHandoffPack({
  repoRoot = REPO_ROOT,
  runsRoot = DEFAULT_RUNS_ROOT,
  runId = "",
  title = "",
  goal = "",
  generatedAt = new Date().toISOString(),
  repoSnapshot = null,
} = {}) {
  const artifacts = resolveRunArtifacts(repoRoot, runsRoot, runId);
  const missionEnvelope = readJsonIfExists(artifacts.missionEnvelopePath) || null;
  const contextPack = readJsonIfExists(artifacts.contextPackPath) || null;
  const summary = readJsonIfExists(artifacts.summaryPath) || null;
  const repo = repoSnapshot || collectGitSnapshot(repoRoot);
  const resolvedTitle = clean(title || summary?.title || missionEnvelope?.missionTitle || "Codex handoff");
  const resolvedGoal = clean(goal || summary?.goal || missionEnvelope?.goal || "");
  const activeBlockers = normalizeStringList(summary?.activeBlockers || contextPack?.memory?.blockers || [], 12);
  const nextAction = clean(summary?.boardRow?.next || contextPack?.memory?.recommendedNextActions?.[0] || "");
  const requiredChecks = normalizeStringList(missionEnvelope?.verifierSpec?.requiredChecks || [], 24);
  const requiredArtifacts = normalizeStringList(missionEnvelope?.verifierSpec?.requiredArtifacts || [], 24);

  return {
    schema: "codex-handoff-pack.v1",
    generatedAt,
    title: resolvedTitle,
    goal: resolvedGoal,
    run: {
      runId: artifacts.runId || clean(summary?.runId) || "",
      status: clean(summary?.status || "unknown"),
      riskLane: clean(summary?.riskLane || missionEnvelope?.riskLane || ""),
      missionId: clean(summary?.missionId || missionEnvelope?.missionId || ""),
    },
    boardRow: summary?.boardRow || null,
    repo,
    verification: {
      acceptance: summary?.acceptance || null,
      requiredChecks,
      requiredArtifacts,
      gateVisualVerification: Boolean(missionEnvelope?.verifierSpec?.gateVisualVerification),
      gateLiveDeploy: Boolean(missionEnvelope?.verifierSpec?.gateLiveDeploy),
    },
    blockers: activeBlockers,
    nextAction,
    memoriesInfluencingRun: normalizeStringList(summary?.memoriesInfluencingRun || contextPack?.memoriesInfluencingRun || [], 12),
    memoryCandidates: buildMemoryCandidates({
      summary: summary || { status: "unknown", goal: resolvedGoal, activeBlockers, boardRow: { next: nextAction } },
      missionEnvelope,
      repo,
    }),
    artifacts: {
      pointerPath: repoRelative(repoRoot, artifacts.pointerPath),
      missionEnvelopePath: repoRelative(repoRoot, artifacts.missionEnvelopePath),
      contextPackPath: repoRelative(repoRoot, artifacts.contextPackPath),
      summaryPath: repoRelative(repoRoot, artifacts.summaryPath),
      ledgerPath: repoRelative(repoRoot, artifacts.ledgerPath),
    },
  };
}

function renderMarkdown(pack) {
  const lines = [
    `# ${pack.title}`,
    "",
    `- Generated: ${pack.generatedAt}`,
    `- Run: ${pack.run.runId || "none"} (${pack.run.status})`,
    `- Goal: ${pack.goal || "unspecified"}`,
    `- Branch: ${pack.repo.branch || "unknown"}`,
    `- Dirty files: ${pack.repo.dirtyCount}`,
    `- Next: ${pack.nextAction || "inspect latest run state"}`,
    "",
    "## Blockers",
    ...(pack.blockers.length > 0 ? pack.blockers.map((blocker) => `- ${blocker}`) : ["- none"]),
    "",
    "## Verification",
    `- Required checks: ${pack.verification.requiredChecks.length}`,
    `- Required artifacts: ${pack.verification.requiredArtifacts.length}`,
    `- Visual gate: ${pack.verification.gateVisualVerification ? "yes" : "no"}`,
    `- Live deploy gate: ${pack.verification.gateLiveDeploy ? "yes" : "no"}`,
    "",
    "## Changed Files",
    ...(pack.repo.changedFiles.length > 0 ? pack.repo.changedFiles.slice(0, 24).map((file) => `- ${file}`) : ["- none"]),
    "",
    "## Memory Candidates",
    ...(pack.memoryCandidates.length > 0
      ? pack.memoryCandidates.map((item) => `- ${item.kind}: ${item.statement}`)
      : ["- none"]),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export function writeHandoffPack(repoRoot, pack, { artifactDir = "" } = {}) {
  const runRoot = clean(artifactDir)
    ? resolve(repoRoot, artifactDir)
    : pack.run.runId
      ? resolve(repoRoot, DEFAULT_RUNS_ROOT, pack.run.runId)
      : resolve(repoRoot, DEFAULT_HANDOFF_ROOT);
  mkdirSync(runRoot, { recursive: true });
  const jsonPath = resolve(runRoot, "handoff.json");
  const markdownPath = resolve(runRoot, "handoff.md");
  writeFileSync(jsonPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderMarkdown(pack), "utf8");
  return {
    jsonPath,
    markdownPath,
  };
}

function printHumanSummary(pack, paths) {
  process.stdout.write("Codex handoff pack\n");
  process.stdout.write(`  status: ${pack.run.status}\n`);
  process.stdout.write(`  run: ${pack.run.runId || "none"}\n`);
  process.stdout.write(`  goal: ${pack.goal || "unspecified"}\n`);
  process.stdout.write(`  dirty files: ${pack.repo.dirtyCount}\n`);
  process.stdout.write(`  next: ${pack.nextAction || "inspect latest run state"}\n`);
  process.stdout.write(`  artifact: ${paths.jsonPath}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pack = buildHandoffPack({
    runId: args.runId,
    runsRoot: args.runsRoot,
    title: args.title,
    goal: args.goal,
  });
  const paths = writeHandoffPack(REPO_ROOT, pack, {
    artifactDir: args.artifactDir,
  });
  const payload = {
    ok: true,
    pack,
    paths,
  };
  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    printHumanSummary(pack, paths);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
