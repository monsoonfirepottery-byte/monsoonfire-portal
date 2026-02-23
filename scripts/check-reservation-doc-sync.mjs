#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.cwd();
const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const strict = args.has("--strict");

const docPath = "docs/SCHEMA_RESERVATIONS.md";
const doc = readFileSync(resolve(repoRoot, docPath), "utf8");

const requiredFields = [
  "status",
  "loadStatus",
  "stageStatus",
  "stageHistory",
  "queuePositionHint",
  "estimatedWindow",
  "assignedStationId",
  "requiredResources",
  "staffNotes",
  "arrivalStatus",
];

const missing = requiredFields.filter((field) => !doc.includes(`\`${field}\``));

const result = {
  ok: missing.length === 0,
  strict,
  missing,
  checked: requiredFields,
  source: docPath,
};

if (asJson) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else if (missing.length === 0) {
  process.stdout.write("PASS reservation docs sync check\n");
} else {
  process.stdout.write(`FAIL reservation docs sync check: missing ${missing.join(", ")}\n`);
}

if (missing.length > 0) {
  process.exit(1);
}
