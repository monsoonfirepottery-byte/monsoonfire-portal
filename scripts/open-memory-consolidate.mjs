#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCodexAutomationEnv } from "./lib/codex-automation-env.mjs";
import { studioBrainRequestJson } from "./lib/studio-brain-memory-write.mjs";
import { hydrateStudioBrainAuthFromPortal } from "./lib/studio-brain-startup-auth.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");
const LOCAL_ARTIFACT_PATH = resolve(REPO_ROOT, "output", "studio-brain", "memory-consolidation", "latest.json");
const DEFAULT_TIMEOUT_MS = 180_000;

function clean(value) {
  return String(value ?? "").trim();
}

function ensureArtifactPath(result) {
  mkdirSync(dirname(LOCAL_ARTIFACT_PATH), { recursive: true });
  writeFileSync(LOCAL_ARTIFACT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  node ./scripts/open-memory-consolidate.mjs [options]",
      "",
      "Options:",
      "  --mode <idle|overnight>               Consolidation mode (default: idle)",
      "  --run-id <id>                         Run identifier",
      "  --tenant-id <tenant>                  Tenant override",
      "  --max-candidates <n>                  Candidate cap (default: 100)",
      "  --max-writes <n>                      Write cap (default: 25)",
      "  --time-budget-ms <n>                  Time budget in ms (default: 120000)",
      "  --focus-area <text>                   Focus area; repeatable",
      "  --timeout-ms <n>                      HTTP request timeout in ms (default: 180000)",
      "  --json                                Print JSON result",
      "  -h, --help                            Show this help",
      "",
    ].join("\n")
  );
}

function parseInteger(value, label, fallback) {
  if (value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label} value: ${value}`);
  }
  return Math.round(parsed);
}

export function parseArgs(argv) {
  const options = {
    mode: "idle",
    runId: "",
    tenantId: "",
    maxCandidates: 100,
    maxWrites: 25,
    timeBudgetMs: 120_000,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    focusAreas: [],
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--focus-area") {
      const next = clean(argv[index + 1]);
      if (!next) throw new Error("Missing value for --focus-area");
      options.focusAreas.push(next);
      index += 1;
      continue;
    }
    if (!arg.startsWith("--")) continue;
    const next = clean(argv[index + 1]);
    if (!next) throw new Error(`Missing value for ${arg}`);
    if (arg === "--mode") {
      if (next !== "idle" && next !== "overnight") {
        throw new Error(`Invalid --mode value: ${next}`);
      }
      options.mode = next;
      index += 1;
      continue;
    }
    if (arg === "--run-id") {
      options.runId = next;
      index += 1;
      continue;
    }
    if (arg === "--tenant-id") {
      options.tenantId = next;
      index += 1;
      continue;
    }
    if (arg === "--max-candidates") {
      options.maxCandidates = parseInteger(next, "--max-candidates", options.maxCandidates);
      index += 1;
      continue;
    }
    if (arg === "--max-writes") {
      options.maxWrites = parseInteger(next, "--max-writes", options.maxWrites);
      index += 1;
      continue;
    }
    if (arg === "--time-budget-ms") {
      options.timeBudgetMs = parseInteger(next, "--time-budget-ms", options.timeBudgetMs);
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = parseInteger(next, "--timeout-ms", options.timeoutMs);
      index += 1;
    }
  }

  return options;
}

function buildRequestBody(options) {
  return {
    mode: options.mode,
    runId: clean(options.runId) || undefined,
    tenantId: clean(options.tenantId) || undefined,
    maxCandidates: options.maxCandidates,
    maxWrites: options.maxWrites,
    timeBudgetMs: options.timeBudgetMs,
    focusAreas: options.focusAreas,
  };
}

function normalizeConsolidationResult(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Studio Brain consolidation endpoint returned an empty payload.");
  }
  const result =
    payload.result && typeof payload.result === "object" && !Array.isArray(payload.result)
      ? payload.result
      : payload;
  return {
    transport: "http",
    ...result,
  };
}

export async function runConsolidation(options, { env = process.env } = {}) {
  await hydrateStudioBrainAuthFromPortal({ repoRoot: REPO_ROOT, env }).catch(() => null);

  const payload = await studioBrainRequestJson({
    method: "POST",
    path: "/api/memory/consolidate",
    body: {
      ...buildRequestBody(options),
      requestOrigin: "scripts/open-memory-consolidate.mjs",
    },
    env,
    timeoutMs: options.timeoutMs,
  });

  const result = normalizeConsolidationResult(payload);
  ensureArtifactPath(result);
  return result;
}

function printSummary(result) {
  process.stdout.write(
    [
      `transport: ${clean(result?.transport || "http")}`,
      `status: ${clean(result?.status || "unknown")}`,
      "artifact: output/studio-brain/memory-consolidation/latest.json",
      `summary: ${clean(result?.summary || "")}`,
    ].join("\n") + "\n"
  );
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  loadCodexAutomationEnv({ repoRoot: REPO_ROOT, env: process.env, overwrite: false });
  const result = await runConsolidation(options);
  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  printSummary(result);
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
