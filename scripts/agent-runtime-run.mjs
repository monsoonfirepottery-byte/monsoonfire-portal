#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseArgs(argv) {
  const parsed = {
    runId: "",
    dryRun: false,
    executeVerifier: false,
    webhookUrl: clean(process.env.STUDIO_BRAIN_AGENT_RUNTIME_WEBHOOK || ""),
    bearerToken: clean(process.env.STUDIO_BRAIN_AGENT_RUNTIME_BEARER_TOKEN || process.env.STUDIO_BRAIN_ADMIN_TOKEN || ""),
  };
  const passthrough = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] ?? "").trim();
    if (!arg) continue;
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--execute-verifier") {
      parsed.executeVerifier = true;
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
    if (arg === "--webhook-url" && argv[index + 1]) {
      parsed.webhookUrl = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--webhook-url=")) {
      parsed.webhookUrl = arg.slice("--webhook-url=".length).trim();
      continue;
    }
    if (arg === "--bearer-token" && argv[index + 1]) {
      parsed.bearerToken = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--bearer-token=")) {
      parsed.bearerToken = arg.slice("--bearer-token=".length).trim();
      continue;
    }
    passthrough.push(arg);
  }

  return { parsed, passthrough };
}

function readLatestPointer() {
  const pointerPath = resolve(REPO_ROOT, "output", "agent-runs", "latest.json");
  if (!existsSync(pointerPath)) {
    throw new Error("No agent runtime pointer found. Run agent-harness-prepare with --write first.");
  }
  return JSON.parse(readFileSync(pointerPath, "utf8"));
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function main() {
  const { parsed, passthrough } = parseArgs(process.argv.slice(2));
  const pointer = readLatestPointer();
  const runId = parsed.runId || clean(pointer.runId);
  if (!runId) {
    throw new Error("Unable to resolve an agent runtime run id.");
  }

  const runRoot = resolve(REPO_ROOT, "output", "agent-runs", runId);
  const env = {
    ...process.env,
    PYTHONPATH: resolve(REPO_ROOT, "studio-brain", "agent_runtime", "src"),
  };
  const args = [
    "-m",
    "monsoonfire_agent_runtime.cli",
    "run",
    "--repo-root",
    REPO_ROOT,
    "--run-root",
    runRoot,
  ];
  if (parsed.dryRun) args.push("--dry-run");
  if (parsed.executeVerifier) args.push("--execute-verifier");
  if (parsed.webhookUrl) args.push("--webhook-url", parsed.webhookUrl);
  if (parsed.bearerToken) args.push("--bearer-token", parsed.bearerToken);
  args.push(...passthrough);

  const result = spawnSync("python", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });

  if (result.stdout) process.stdout.write(String(result.stdout));
  if (result.stderr) process.stderr.write(String(result.stderr));

  const summary = readJsonIfExists(resolve(runRoot, "summary.json"));
  if (summary) {
    const blocker = Array.isArray(summary.activeBlockers) && summary.activeBlockers.length > 0 ? summary.activeBlockers[0] : "";
    process.stdout.write(`agent-runtime status: ${clean(summary.status) || "unknown"}\n`);
    if (blocker) process.stdout.write(`blocker: ${blocker}\n`);
    process.stdout.write(`summary: ${resolve(runRoot, "summary.json")}\n`);
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exitCode = result.status;
  }
}

main();
