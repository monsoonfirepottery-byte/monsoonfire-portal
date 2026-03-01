#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const DEFAULT_MEMORY_ROOT = "memory";
const DEFAULT_ARTIFACT = "output/codex-memory/latest.json";

function parseArgs(argv) {
  const parsed = {
    command: "status",
    json: false,
    root: DEFAULT_MEMORY_ROOT,
    artifact: DEFAULT_ARTIFACT,
    statement: "",
    source: "manual",
    confidence: null,
    input: "",
    ids: [],
    acceptAll: false,
  };

  const commands = new Set(["init", "status", "propose", "ingest", "accept"]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (!arg) continue;

    if (commands.has(arg)) {
      parsed.command = arg;
      continue;
    }

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--root" && argv[index + 1]) {
      parsed.root = String(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--root=")) {
      parsed.root = arg.slice("--root=".length);
      continue;
    }

    if ((arg === "--artifact" || arg === "--out") && argv[index + 1]) {
      parsed.artifact = String(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--artifact=")) {
      parsed.artifact = arg.slice("--artifact=".length);
      continue;
    }

    if (arg === "--statement" && argv[index + 1]) {
      parsed.statement = String(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--statement=")) {
      parsed.statement = arg.slice("--statement=".length);
      continue;
    }

    if (arg === "--source" && argv[index + 1]) {
      parsed.source = String(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--source=")) {
      parsed.source = arg.slice("--source=".length);
      continue;
    }

    if (arg === "--confidence" && argv[index + 1]) {
      parsed.confidence = Number(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--confidence=")) {
      parsed.confidence = Number(arg.slice("--confidence=".length));
      continue;
    }

    if (arg === "--input" && argv[index + 1]) {
      parsed.input = String(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--input=")) {
      parsed.input = arg.slice("--input=".length);
      continue;
    }

    if (arg === "--id" && argv[index + 1]) {
      parsed.ids.push(String(argv[index + 1]));
      index += 1;
      continue;
    }

    if (arg.startsWith("--id=")) {
      parsed.ids.push(arg.slice("--id=".length));
      continue;
    }

    if (arg === "--all") {
      parsed.acceptAll = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (parsed.confidence !== null && !Number.isFinite(parsed.confidence)) {
    throw new Error("--confidence must be a number when provided.");
  }

  return parsed;
}

function printUsage() {
  process.stdout.write("Codex memory pipeline (local-only workspace)\n\n");
  process.stdout.write("Usage:\n");
  process.stdout.write("  node ./scripts/codex-memory-pipeline.mjs status [--json]\n");
  process.stdout.write("  node ./scripts/codex-memory-pipeline.mjs init [--json]\n");
  process.stdout.write("  node ./scripts/codex-memory-pipeline.mjs propose --statement \"...\" [--source ...] [--confidence 0.9]\n");
  process.stdout.write("  node ./scripts/codex-memory-pipeline.mjs ingest --input ./path/to/export.jsonl [--source ...]\n");
  process.stdout.write("  node ./scripts/codex-memory-pipeline.mjs accept --id <memory-id> [--id <memory-id> ...]\n");
  process.stdout.write("  node ./scripts/codex-memory-pipeline.mjs accept --all\n\n");
  process.stdout.write("Notes:\n");
  process.stdout.write("  - Default local root: memory/\n");
  process.stdout.write("  - Proposed file: memory/proposed/proposed.jsonl\n");
  process.stdout.write("  - Accepted file: memory/accepted/accepted.jsonl\n");
}

function derivePaths(rootArg) {
  const memoryRoot = resolve(REPO_ROOT, rootArg || DEFAULT_MEMORY_ROOT);
  const proposedDir = resolve(memoryRoot, "proposed");
  const acceptedDir = resolve(memoryRoot, "accepted");
  const proposedFile = resolve(proposedDir, "proposed.jsonl");
  const acceptedFile = resolve(acceptedDir, "accepted.jsonl");
  return {
    memoryRoot,
    proposedDir,
    acceptedDir,
    proposedFile,
    acceptedFile,
  };
}

function ensureLayout(paths) {
  mkdirSync(paths.proposedDir, { recursive: true });
  mkdirSync(paths.acceptedDir, { recursive: true });
  if (!existsSync(paths.proposedFile)) {
    writeFileSync(paths.proposedFile, "", "utf8");
  }
  if (!existsSync(paths.acceptedFile)) {
    writeFileSync(paths.acceptedFile, "", "utf8");
  }
}

function readJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const parsed = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      parsed.push({ malformedLine: line });
    }
  }
  return parsed;
}

function writeJsonl(filePath, records) {
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  writeFileSync(filePath, body.length > 0 ? `${body}\n` : "", "utf8");
}

function appendJsonl(filePath, records) {
  if (!records.length) return;
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  appendFileSync(filePath, `${body}\n`, "utf8");
}

function normalizeIngestEntry(raw, fallbackSource) {
  if (raw && typeof raw === "object") {
    const statement =
      String(raw.statement || raw.memory || raw.summary || raw.note || raw.text || "").trim();
    if (!statement) return null;

    const confidence = Number(raw.confidence);
    return {
      id: String(raw.id || `mem_${Date.now()}_${randomUUID().slice(0, 8)}`),
      statement,
      source: String(raw.source || fallbackSource || "ingest"),
      confidence: Number.isFinite(confidence) ? confidence : null,
      tags: Array.isArray(raw.tags) ? raw.tags.map((tag) => String(tag)) : [],
      createdAt: new Date().toISOString(),
      provenance: {
        ingest: true,
      },
    };
  }

  const statement = String(raw || "").trim();
  if (!statement) return null;
  return {
    id: `mem_${Date.now()}_${randomUUID().slice(0, 8)}`,
    statement,
    source: String(fallbackSource || "ingest"),
    confidence: null,
    tags: [],
    createdAt: new Date().toISOString(),
    provenance: {
      ingest: true,
    },
  };
}

function buildStatus(paths) {
  const proposed = readJsonl(paths.proposedFile);
  const accepted = readJsonl(paths.acceptedFile);
  const malformedProposed = proposed.filter((entry) => Object.prototype.hasOwnProperty.call(entry, "malformedLine"));
  const malformedAccepted = accepted.filter((entry) => Object.prototype.hasOwnProperty.call(entry, "malformedLine"));

  return {
    memoryRoot: paths.memoryRoot,
    proposedFile: paths.proposedFile,
    acceptedFile: paths.acceptedFile,
    layoutReady:
      existsSync(paths.memoryRoot) &&
      existsSync(paths.proposedDir) &&
      existsSync(paths.acceptedDir) &&
      existsSync(paths.proposedFile) &&
      existsSync(paths.acceptedFile),
    proposedCount: proposed.length - malformedProposed.length,
    acceptedCount: accepted.length - malformedAccepted.length,
    malformed: {
      proposed: malformedProposed.length,
      accepted: malformedAccepted.length,
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const paths = derivePaths(args.root);
  const artifactPath = resolve(REPO_ROOT, args.artifact || DEFAULT_ARTIFACT);

  const report = {
    schema: "codex-memory-pipeline-v1",
    generatedAt: new Date().toISOString(),
    command: args.command,
    status: "pass",
    artifactPath,
    operations: [],
    memory: buildStatus(paths),
  };

  if (args.command === "init") {
    ensureLayout(paths);
    report.operations.push({ type: "init", message: "Created local memory layout if missing." });
    report.memory = buildStatus(paths);
  }

  if (args.command === "status") {
    report.operations.push({ type: "status", message: "Read current memory layout and entry counts." });
  }

  if (args.command === "propose") {
    const statement = String(args.statement || "").trim();
    if (!statement) {
      throw new Error("propose requires --statement \"...\".");
    }
    ensureLayout(paths);
    const entry = {
      id: `mem_${Date.now()}_${randomUUID().slice(0, 8)}`,
      statement,
      source: String(args.source || "manual"),
      confidence: Number.isFinite(args.confidence) ? args.confidence : null,
      tags: [],
      createdAt: new Date().toISOString(),
      provenance: {
        ingest: false,
      },
    };
    appendJsonl(paths.proposedFile, [entry]);
    report.operations.push({ type: "propose", added: 1, entryId: entry.id });
    report.memory = buildStatus(paths);
  }

  if (args.command === "ingest") {
    if (!args.input) {
      throw new Error("ingest requires --input <path-to-jsonl-or-ndjson>.");
    }
    const inputPath = resolve(REPO_ROOT, args.input);
    if (!existsSync(inputPath)) {
      throw new Error(`Ingest input not found: ${inputPath}`);
    }

    ensureLayout(paths);
    const rawLines = readFileSync(inputPath, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const entries = [];
    for (const line of rawLines) {
      let parsedLine = line;
      try {
        parsedLine = JSON.parse(line);
      } catch {
        // line stays as plain text input
      }
      const normalized = normalizeIngestEntry(parsedLine, args.source || `ingest:${basename(inputPath)}`);
      if (normalized) {
        entries.push(normalized);
      }
    }

    appendJsonl(paths.proposedFile, entries);
    report.operations.push({ type: "ingest", inputPath, scannedLines: rawLines.length, added: entries.length });
    report.memory = buildStatus(paths);
  }

  if (args.command === "accept") {
    ensureLayout(paths);
    const proposedEntries = readJsonl(paths.proposedFile).filter(
      (entry) => !Object.prototype.hasOwnProperty.call(entry, "malformedLine"),
    );
    const acceptedEntries = readJsonl(paths.acceptedFile).filter(
      (entry) => !Object.prototype.hasOwnProperty.call(entry, "malformedLine"),
    );

    const selectedIds = args.acceptAll
      ? proposedEntries.map((entry) => String(entry.id || "")).filter(Boolean)
      : Array.from(new Set(args.ids.map((id) => String(id || "").trim()).filter(Boolean)));

    if (selectedIds.length === 0) {
      throw new Error("accept requires at least one --id <memory-id> or --all.");
    }

    const selectedSet = new Set(selectedIds);
    const toAccept = proposedEntries.filter((entry) => selectedSet.has(String(entry.id || "")));
    const remaining = proposedEntries.filter((entry) => !selectedSet.has(String(entry.id || "")));

    const acceptanceStamp = new Date().toISOString();
    const acceptedPayload = toAccept.map((entry) => ({
      ...entry,
      acceptedAt: acceptanceStamp,
      status: "accepted",
    }));

    writeJsonl(paths.proposedFile, remaining);
    appendJsonl(paths.acceptedFile, acceptedPayload);

    report.operations.push({
      type: "accept",
      selectedIds,
      accepted: acceptedPayload.length,
      missingIds: selectedIds.filter((id) => !toAccept.some((entry) => String(entry.id || "") === id)),
    });
    report.memory = buildStatus(paths);
  }

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`Codex memory pipeline: ${report.command}\n`);
    process.stdout.write(`  status: ${report.status}\n`);
    process.stdout.write(`  memory root: ${report.memory.memoryRoot}\n`);
    process.stdout.write(`  proposed entries: ${report.memory.proposedCount}\n`);
    process.stdout.write(`  accepted entries: ${report.memory.acceptedCount}\n`);
    process.stdout.write(`  artifact: ${artifactPath}\n`);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`codex-memory-pipeline failed: ${message}\n`);
  process.exit(1);
}
