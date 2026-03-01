#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function parseArgs(argv) {
  const parsed = {
    input: "",
    output: "output/staff/batch-cleanup-preview-latest.json",
    mode: "preview",
    confirm: "",
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const current = String(argv[index] || "");
    if (!current) continue;
    if (current === "--help" || current === "-h") {
      parsed.help = true;
      continue;
    }
    if (current === "--json") {
      parsed.json = true;
      continue;
    }
    if ((current === "--input" || current === "--in") && argv[index + 1]) {
      parsed.input = String(argv[index + 1]);
      index += 1;
      continue;
    }
    if ((current === "--output" || current === "--out") && argv[index + 1]) {
      parsed.output = String(argv[index + 1]);
      index += 1;
      continue;
    }
    if (current === "--mode" && argv[index + 1]) {
      parsed.mode = String(argv[index + 1]);
      index += 1;
      continue;
    }
    if (current === "--confirm" && argv[index + 1]) {
      parsed.confirm = String(argv[index + 1]);
      index += 1;
      continue;
    }
  }
  return parsed;
}

function printHelp() {
  process.stdout.write("Offline-safe staff batch artifact cleanup helper.\n\n");
  process.stdout.write("Usage:\n");
  process.stdout.write("  node ./scripts/staff-batch-artifact-cleanup.mjs --input <payload.json> [options]\n\n");
  process.stdout.write("Options:\n");
  process.stdout.write("  --input, --in <path>      StaffView cleanup payload JSON (required)\n");
  process.stdout.write("  --output, --out <path>    Output artifact path (default: output/staff/batch-cleanup-preview-latest.json)\n");
  process.stdout.write("  --mode <preview|destructive>  Requested intent (default: preview)\n");
  process.stdout.write("  --confirm <phrase>        Confirmation phrase for destructive intent\n");
  process.stdout.write("  --json                    Emit JSON summary to stdout\n");
  process.stdout.write("  --help                    Show this message\n\n");
  process.stdout.write("Safety: this script never mutates Firestore data. It writes review artifacts only.\n");
}

function assertPayloadShape(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Input payload must be a JSON object.");
  }
  const selectedCount = Number(payload.selectedCount);
  if (!Number.isFinite(selectedCount) || selectedCount < 0) {
    throw new Error("Input payload missing selectedCount.");
  }
  const selectedBatchIds = Array.isArray(payload.selectedBatchIds) ? payload.selectedBatchIds : [];
  if (selectedBatchIds.length !== selectedCount) {
    throw new Error(`selectedBatchIds length (${selectedBatchIds.length}) does not match selectedCount (${selectedCount}).`);
  }
  const audit = payload.audit;
  if (!audit || typeof audit !== "object") {
    throw new Error("Input payload missing audit object.");
  }
  if (!String(audit.runId || "").trim()) {
    throw new Error("Input payload audit.runId is required.");
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.input) {
    throw new Error("Missing required --input <payload.json>.");
  }

  const inputPath = resolve(args.input);
  const outputPath = resolve(args.output);
  const raw = readFileSync(inputPath, "utf8");
  const payload = JSON.parse(raw);
  assertPayloadShape(payload);

  const requestedMode = args.mode === "destructive" ? "destructive" : "preview";
  const expectedConfirmationPhrase = `DELETE ${payload.selectedCount} BATCHES`;
  const destructiveConfirmed =
    requestedMode === "destructive" && String(args.confirm || "").trim() === expectedConfirmationPhrase;

  const summary = {
    schema: "staff-batch-artifact-cleanup-preview-v1",
    generatedAt: new Date().toISOString(),
    inputPath,
    outputPath,
    requestedMode,
    destructiveConfirmed,
    destructiveExecuted: false,
    previewOnly: true,
    expectedConfirmationPhrase,
    selectedCount: payload.selectedCount,
    selectedBatchIds: payload.selectedBatchIds,
    selectionMode: payload.selectionMode || "unknown",
    countsByCategory: payload.countsByCategory || {},
    countsByConfidence: payload.countsByConfidence || {},
    countsByDispositionHint: payload.countsByDispositionHint || {},
    audit: {
      runId: payload.audit?.runId || "",
      generatedAt: payload.audit?.generatedAt || "",
      operatorUid: payload.audit?.operatorUid || "",
      operatorEmail: payload.audit?.operatorEmail || null,
      operatorRole: payload.audit?.operatorRole || "",
      reasonCode: payload.audit?.reasonCode || "",
      reason: payload.audit?.reason || "",
      ticketRefs: Array.isArray(payload.audit?.ticketRefs) ? payload.audit.ticketRefs : [],
    },
    notes: [
      "Offline-safe mode: no destructive cleanup mutation is performed by this script.",
      requestedMode === "destructive"
        ? destructiveConfirmed
          ? "Confirmation phrase matched, but this script still writes preview artifacts only."
          : "Destructive mode requested without valid confirmation phrase."
        : "Preview mode requested.",
      "Use generated artifact for human review, approval, and backend handoff.",
    ],
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  process.stdout.write("Staff batch cleanup helper (offline-safe)\n");
  process.stdout.write(`  input: ${inputPath}\n`);
  process.stdout.write(`  output: ${outputPath}\n`);
  process.stdout.write(`  selected batches: ${summary.selectedCount}\n`);
  process.stdout.write(`  requested mode: ${requestedMode}\n`);
  process.stdout.write(`  destructive confirmed: ${destructiveConfirmed ? "yes" : "no"}\n`);
  process.stdout.write("  destructive executed: no (preview-only)\n");
}

try {
  main();
} catch (error) {
  process.stderr.write(`staff-batch-artifact-cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
