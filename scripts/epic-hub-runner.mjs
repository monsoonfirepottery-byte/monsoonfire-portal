#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const EPIC_HUB_PATH = resolve(REPO_ROOT, "scripts", "epic-hub.mjs");
const DEFAULT_EPIC_SELECTION = "1-8";
const DEFAULT_ARTIFACT_BASE = resolve(REPO_ROOT, "output", "epic-hub-runner");

const args = parseArgs(process.argv.slice(2));

if (args.mode !== "agentic") {
  console.error(`Unsupported mode for runner: ${args.mode}. Use --mode agentic.`);
  process.exit(1);
}

if (args.help) {
  printUsage();
  process.exit(0);
}

if (!existsSync(EPIC_HUB_PATH)) {
  console.error(`Missing required hub script: ${EPIC_HUB_PATH}`);
  process.exit(1);
}

const runId = args.runId || `epic-hub-run-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
const hubPayload = runEpicHub(args);

if (!hubPayload || !Array.isArray(hubPayload.manifest)) {
  console.error("Epic-hub did not return an agentic manifest. Ensure --mode=agentic is supported.");
  process.exit(1);
}

const tasks = buildDispatchTasks(hubPayload.manifest, runId);
const artifactBase = buildArtifactBasePath(args.out, runId);
const groupedByOwner = buildOwnerBuckets(tasks);

const artifact = {
  generatedAt: new Date().toISOString(),
  runId,
  command: "epic-hub-runner",
  sourceEpicHub: {
    generatedAt: hubPayload.generatedAt,
    command: hubPayload.command,
    status: hubPayload.epicStatus || "ok",
  },
  mode: args.mode,
  selection: args.epic,
  includeCompleted: args.includeCompleted,
  ownerFilter: args.owner || null,
  limit: args.limit,
  taskCount: tasks.length,
  manifestVersion: hubPayload.agenticManifestVersion || null,
  epics: hubPayload.epics || [],
  queue: hubPayload.queue || [],
  tasks,
  ownerBuckets: Array.from(groupedByOwner, ([owner, bucket]) => ({ owner, count: bucket.length })),
};

if (args.writeArtifacts) {
  writeArtifacts(artifactBase, artifact, groupedByOwner);
}

if (args.json) {
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
  process.exit(0);
}

if (args.jsonl) {
  process.stdout.write(`${JSON.stringify({
    kind: "meta",
    generatedAt: artifact.generatedAt,
    runId,
    command: "epic-hub-runner",
    taskCount: tasks.length,
  })}\n`);
  for (const task of tasks) {
    process.stdout.write(`${JSON.stringify({ kind: "epic-agentic-task", command: "epic-hub-runner", ...task })}\n`);
  }
  process.exit(0);
}

console.log("Epic Hub Runner (agentic dispatch)");
console.log(`Run ID: ${runId}`);
console.log(`Selection: ${args.epic}`);
console.log(`Manifest version: ${artifact.manifestVersion || "n/a"}`);
if (tasks.length === 0) {
  console.log("No open tasks found for the selected epics.");
  process.exit(0);
}

for (const [owner, bucket] of groupedByOwner) {
  const ownerLabel = owner || "unassigned";
  console.log(`\nOwner: ${ownerLabel}`);
  for (const task of bucket) {
    const status = task.ticketStatusNormalized === "blocked" ? "[blocked]" : "[open]";
    const blockerInfo = task.blockerDependencies.length > 0
      ? ` blocked-by: ${task.blockerDependencies.join(", ")}`
      : "";
    console.log(`- ${status} ${task.ticketRef} (${task.ticketTitle})`);
    console.log(`  ${task.epic} / ${task.ticketPriority} / ${task.epicPriority}${blockerInfo}`);
  }
}

if (args.writeArtifacts) {
  console.log(`\nArtifacts written to: ${artifactBase}`);
}

function buildOwnerBuckets(tasksToGroup) {
  const map = new Map();
  for (const task of tasksToGroup) {
    const owner = task.owner || "unassigned";
    if (!map.has(owner)) {
      map.set(owner, []);
    }
    map.get(owner).push(task);
  }

  return new Map(
    Array.from(map.entries()).map(([owner, ticketRows]) => [
      owner,
      sortTasks(ticketRows),
    ]),
  );
}

function sortTasks(input) {
  return [...input].sort((a, b) => {
    const epicPriority = comparePriority(a.epicPriority, b.epicPriority);
    if (epicPriority !== 0) {
      return epicPriority;
    }
    const ticketPriority = comparePriority(a.ticketPriority, b.ticketPriority);
    if (ticketPriority !== 0) {
      return ticketPriority;
    }
    return a.ticketRef.localeCompare(b.ticketRef);
  });
}

function writeArtifacts(basePath, artifactPayload, grouped) {
  const baseDirectory = isDirectory(basePath) ? basePath : resolve(basePath);
  const manifestPath = resolve(baseDirectory, "manifest.json");
  const ownersDir = resolve(baseDirectory, "owners");

  mkdirSync(baseDirectory, { recursive: true });
  mkdirSync(ownersDir, { recursive: true });

  writeFileSync(manifestPath, `${JSON.stringify(artifactPayload, null, 2)}\n`, "utf8");

  for (const [owner, bucket] of grouped) {
    const ownerFileName = `${sanitizeOwnerFile(owner)}.json`;
    const ownerManifest = {
      owner,
      generatedAt: artifactPayload.generatedAt,
      runId: artifactPayload.runId,
      count: bucket.length,
      tasks: bucket,
    };
    writeFileSync(resolve(ownersDir, ownerFileName), `${JSON.stringify(ownerManifest, null, 2)}\n`, "utf8");

    const markdownPath = resolve(ownersDir, `${sanitizeOwnerFile(owner)}.md`);
    const mdLines = [
      `# Epic Agentic Dispatch for ${owner}`,
      `Run ID: ${artifactPayload.runId}`,
      `Task count: ${bucket.length}`,
      "",
    ];
    for (const task of bucket) {
      mdLines.push(`- ${task.ticketRef} — ${task.ticketTitle}`);
      mdLines.push(`  - Epic: ${task.epic} (${task.epicPriority})`);
      mdLines.push(`  - Ticket priority: ${task.ticketPriority}`);
      if (task.acceptanceCriteria.length > 0) {
        mdLines.push(`  - Acceptance: ${task.acceptanceCriteria.slice(0, 2).join(" | ")}`);
      }
      if (task.suggestedRunbook.length > 0) {
        mdLines.push(`  - Runbook: ${task.suggestedRunbook[0]}`);
      }
      mdLines.push("");
    }
    writeFileSync(markdownPath, `${mdLines.join("\n")}\n`, "utf8");
  }
}

function runEpicHub({ mode, epic, owner, limit, includeCompleted }) {
  const hubArgs = [mode, "--jsonl", "--epic", epic];
  if (owner) {
    hubArgs.push("--owner", owner);
  }
  if (Number.isInteger(limit) && limit > 0) {
    hubArgs.push("--limit", `${limit}`);
  }
  if (includeCompleted) {
    hubArgs.push("--include-completed");
  }

  const result = spawnSync(process.execPath, [EPIC_HUB_PATH, ...hubArgs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  if (result.error) {
    console.error(`Failed to invoke epic-hub: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    const message = String(result.stdout || "").trim() || String(result.stderr || "").trim();
    console.error("epic-hub returned an error:");
    console.error(message || "unknown");
    process.exit(result.status || 1);
  }

  const output = String(result.stdout || "").trim();
  if (!output) {
    return {
      generatedAt: new Date().toISOString(),
      command: mode,
      epics: [],
      queue: [],
      manifest: [],
      warnings: ["Epic hub returned empty output."],
    };
  }

  try {
    return parseEpicHubJsonOutput(output, mode);
  } catch (error) {
    console.error("Failed to parse epic-hub JSONL output.");
    console.error(output);
    throw error;
  }
}

function parseEpicHubJsonOutput(output, fallbackCommand) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const tasks = [];
  let manifestTaskCount = 0;
  let meta = null;
  let rawPayload = null;

  for (const line of lines) {
    if (!line.startsWith("{")) {
      continue;
    }
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.kind === "meta") {
      meta = entry;
      continue;
    }
    if (entry.kind === "agentic-task") {
      tasks.push(entry);
      manifestTaskCount += 1;
      continue;
    }
    if (entry.manifest && Array.isArray(entry.manifest)) {
      rawPayload = entry;
    }
  }

  if (rawPayload?.manifest?.length) {
    return rawPayload;
  }
  if (rawPayload && Array.isArray(rawPayload.tasks)) {
    return {
      ...rawPayload,
      manifest: rawPayload.tasks,
      taskCount: rawPayload.taskCount || rawPayload.tasks.length,
    };
  }

  return {
    command: fallbackCommand,
    generatedAt: meta?.generatedAt || new Date().toISOString(),
    epics: meta?.epics || [],
    queue: meta?.queue || [],
    manifest: tasks,
    manifestVersion: meta?.manifestVersion || null,
    taskCount: manifestTaskCount,
  };
}

function buildDispatchTasks(manifestTasks, dispatchRunId) {
  return manifestTasks.map((task, index) => ({
    ...task,
    dispatchId: `${dispatchRunId}-${String(index + 1).padStart(4, "0")}`,
    runId: dispatchRunId,
    runHints: task.runHints || [],
    priorityVector: {
      epic: task.epicPriority || "P3",
      ticket: task.ticketPriority || "P3",
    },
    handoff: [
      `Open ${task.ticketRef} and execute its ticket tasks in priority order.`,
      "Update acceptance criteria and definition-of-done evidence in PR/commit notes.",
      "Do not close this ticket without explicit evidence links in the ticket evidence section.",
    ],
    owner: task.owner || "unassigned",
  }));
}

function buildArtifactBasePath(rawOut, runIdValue) {
  const base = resolve(REPO_ROOT, rawOut || DEFAULT_ARTIFACT_BASE);
  const extension = basename(base).split(".").pop();
  if (extension === "json" || extension === "jsonl" || extension === "md") {
    const directory = resolve(base, "..");
    return directory;
  }

  const defaultBase = resolve(REPO_ROOT, DEFAULT_ARTIFACT_BASE);
  if (base === defaultBase) {
    return resolve(base, runIdValue);
  }

  return base;
}

function isDirectory(pathValue) {
  try {
    return statSync(pathValue).isDirectory();
  } catch {
    return false;
  }
}

function sanitizeOwnerFile(value) {
  return String(value || "unassigned")
    .toLowerCase()
    .replace(/\.[^a-z0-9]+/g, "-")
    .replace(/[^a-z0-9-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/(^_+|_+$)/g, "");
}

function parseArgs(argv) {
  const options = {
    mode: "agentic",
    epic: DEFAULT_EPIC_SELECTION,
    out: DEFAULT_ARTIFACT_BASE,
    writeArtifacts: true,
    includeCompleted: false,
    help: false,
    json: false,
    jsonl: false,
    limit: null,
    owner: null,
    runId: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--jsonl") {
      options.jsonl = true;
      continue;
    }
    if (arg === "--mode") {
      options.mode = argv[index + 1] || options.mode;
      index += 1;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      options.mode = arg.slice("--mode=".length);
      continue;
    }
    if (arg === "--epic") {
      options.epic = argv[index + 1] || options.epic;
      index += 1;
      continue;
    }
    if (arg.startsWith("--epic=")) {
      options.epic = arg.slice("--epic=".length);
      continue;
    }
    if (arg === "--owner") {
      options.owner = argv[index + 1] || options.owner;
      index += 1;
      continue;
    }
    if (arg === "--out") {
      const value = argv[index + 1] || options.out;
      options.out = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      options.out = arg.slice("--out=".length);
      continue;
    }
    if (arg === "--include-completed") {
      options.includeCompleted = true;
      continue;
    }
    if (arg === "--limit") {
      const parsed = Number.parseInt(argv[index + 1], 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        options.limit = parsed;
      }
      index += 1;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const parsed = Number.parseInt(arg.slice("--limit=".length), 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        options.limit = parsed;
      }
      continue;
    }
    if (arg === "--run-id") {
      options.runId = argv[index + 1] || options.runId;
      index += 1;
      continue;
    }
    if (arg === "--no-artifacts") {
      options.writeArtifacts = false;
      continue;
    }

    if (!arg.startsWith("--")) {
      console.warn(`Unknown positional argument: ${arg}`);
    }
  }

  return options;
}

function comparePriority(rawA, rawB) {
  const priorityA = parsePriority(rawA);
  const priorityB = parsePriority(rawB);
  return priorityA - priorityB;
}

function parsePriority(raw) {
  const match = String(raw || "P3").match(/P(\d)/i);
  if (!match) {
    return 99;
  }
  return Number.parseInt(match[1], 10);
}

function printUsage() {
  const examples = [
    "node ./scripts/epic-hub-runner.mjs",
    "node ./scripts/epic-hub-runner.mjs --epic 1-8 --limit 40",
    "node ./scripts/epic-hub-runner.mjs --epic 7 --owner ralph --jsonl",
  ];

  console.log("Epic Hub Runner");
  console.log("Defaults to blocker chain: P1-EPIC-01 through P1-EPIC-08 (default --epic 1-8)");
  console.log("Usage: node ./scripts/epic-hub-runner.mjs [options]");
  console.log("Options:");
  console.log("  --epic <range|name>   Epic filter (default: 1-8)");
  console.log("  --owner <name>         Filter by ticket owner in resulting queue");
  console.log("  --limit <n>            Limit tasks in dispatch payload");
  console.log("  --mode <agentic>       Epic-hub mode to execute (default: agentic)");
  console.log("  --out <path>           Base path for run artifacts (default: output/epic-hub-runner)");
  console.log("  --run-id <id>          Stable run identifier");
  console.log("  --json / --jsonl       Emit machine-readable output");
  console.log("  --include-completed    Include completed tickets in queue");
  console.log("  --no-artifacts         Skip writing artifact files");
  console.log("Examples:");
  for (const line of examples) {
    console.log(`  ${line}`);
  }
}
