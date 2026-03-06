#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function parseArgs(argv) {
  const parsed = {
    json: false,
    strict: false,
    ledgerPath: "output/intent/intent-run-ledger.jsonl",
    artifact: "output/intent/replay-determinism-report.json",
    runId: "",
    minScore: 0.9,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (!arg) continue;
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }
    if (arg === "--ledger" && argv[index + 1]) {
      parsed.ledgerPath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--ledger=")) {
      parsed.ledgerPath = arg.slice("--ledger=".length).trim();
      continue;
    }
    if (arg === "--artifact" && argv[index + 1]) {
      parsed.artifact = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      parsed.artifact = arg.slice("--artifact=".length).trim();
      continue;
    }
    if (arg === "--run-id" && argv[index + 1]) {
      parsed.runId = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--run-id=")) {
      parsed.runId = arg.slice("--run-id=".length).trim();
      continue;
    }
    if (arg === "--min-score" && argv[index + 1]) {
      parsed.minScore = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--min-score=")) {
      parsed.minScore = Number(arg.slice("--min-score=".length));
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Intent replay determinism",
          "",
          "Usage:",
          "  node ./scripts/intent-replay-determinism.mjs --json --run-id <id>",
        ].join("\n")
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(parsed.minScore) || parsed.minScore < 0 || parsed.minScore > 1) {
    throw new Error("--min-score must be in [0, 1].");
  }
  return parsed;
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ledgerAbsolutePath = resolve(REPO_ROOT, args.ledgerPath);
  const artifactAbsolutePath = resolve(REPO_ROOT, args.artifact);

  if (!existsSync(ledgerAbsolutePath)) {
    throw new Error(`Ledger file not found: ${ledgerAbsolutePath}`);
  }

  const rows = readJsonl(ledgerAbsolutePath).filter((row) => (args.runId ? row?.runId === args.runId : true));
  if (rows.length === 0) {
    throw new Error(`No ledger rows found${args.runId ? ` for runId=${args.runId}` : ""}.`);
  }

  let penalties = 0;
  const findings = [];
  let previousSequence = null;
  let previousHash = null;

  for (const row of rows) {
    if (!Number.isInteger(Number(row?.sequence))) {
      penalties += 0.15;
      findings.push({ severity: "warning", code: "missing_sequence", eventType: row?.eventType || null });
    } else if (previousSequence !== null && Number(row.sequence) !== previousSequence + 1) {
      penalties += 0.2;
      findings.push({
        severity: "error",
        code: "sequence_gap",
        message: `Sequence gap detected: expected ${previousSequence + 1}, received ${row.sequence}.`,
      });
    }

    if (typeof row?.eventHash !== "string" || row.eventHash.length < 16) {
      penalties += 0.25;
      findings.push({ severity: "error", code: "missing_event_hash", eventType: row?.eventType || null });
    }

    const expectedPreviousHash = previousHash || null;
    const observedPreviousHash = row?.previousEventHash || null;
    if (previousHash !== null && expectedPreviousHash !== observedPreviousHash) {
      penalties += 0.2;
      findings.push({
        severity: "error",
        code: "hash_chain_break",
        message: "Ledger previousEventHash did not match prior eventHash.",
      });
    }

    previousSequence = Number.isInteger(Number(row?.sequence)) ? Number(row.sequence) : previousSequence;
    previousHash = typeof row?.eventHash === "string" ? row.eventHash : previousHash;
  }

  const score = Math.max(0, 1 - penalties);
  const status = score >= args.minScore ? "pass" : "fail";
  const report = {
    schema: "intent-replay-determinism-report.v1",
    generatedAt: new Date().toISOString(),
    status,
    runId: args.runId || null,
    ledgerPath: args.ledgerPath,
    score,
    minScore: args.minScore,
    summary: {
      rows: rows.length,
      penalties,
      findings: findings.length,
    },
    findings,
  };

  mkdirSync(dirname(artifactAbsolutePath), { recursive: true });
  writeFileSync(artifactAbsolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`intent-replay-determinism status: ${report.status}\n`);
    process.stdout.write(`score: ${report.score.toFixed(3)} (min=${report.minScore.toFixed(3)})\n`);
    process.stdout.write(`report: ${artifactAbsolutePath}\n`);
  }

  if (status !== "pass") {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`intent-replay-determinism failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
