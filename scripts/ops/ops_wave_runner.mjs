#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "waves");

const STEP_DEFINITIONS = [
  {
    id: "swarm-preflight",
    command: [process.execPath, "scripts/ops/swarm_lane_preflight.mjs", "--lane", "tooling", "--base", "origin/main", "--json", "--write"],
    expectedArtifacts: ["output/ops/swarm-lane-preflight/swarm-lane-preflight-latest.json"],
  },
  {
    id: "tooling-quality",
    command: [process.execPath, "scripts/ops/tooling_quality_report.mjs", "--mode", "all", "--json", "--write"],
    expectedArtifacts: ["output/ops/tooling-quality/tooling-quality-latest.json"],
  },
  {
    id: "tool-inventory",
    command: [process.execPath, "scripts/ops/installed_tool_inventory.mjs", "--json", "--write"],
    expectedArtifacts: ["output/ops/effectivity/installed-tool-inventory-latest.json"],
  },
  {
    id: "admin-effectivity-audit",
    command: [process.execPath, "scripts/ops/admin_effectivity_audit.mjs", "--write", "--json"],
    expectedArtifacts: ["output/ops/effectivity/admin-effectivity-audit-latest.json"],
  },
  {
    id: "work-packet",
    command: [process.execPath, "scripts/studiobrain-ops-work-packet.mjs", "--json", "--write", "--max-packets", "3"],
    expectedArtifacts: ["output/ops/swarm/latest-work-packet.json"],
  },
  {
    id: "artifact-validation-pre",
    command: [process.execPath, "scripts/ops/validate_ops_artifacts.mjs", "--json", "--write"],
    expectedArtifacts: ["output/ops/artifact-validation/artifact-schema-validation-latest.json"],
  },
  {
    id: "pr-readiness",
    command: [process.execPath, "scripts/ops/pr_readiness_packet.mjs", "--json", "--write"],
    expectedArtifacts: ["output/ops/pr-readiness/pr-readiness-latest.md"],
  },
  {
    id: "artifact-validation",
    command: [process.execPath, "scripts/ops/validate_ops_artifacts.mjs", "--json", "--write"],
    expectedArtifacts: ["output/ops/artifact-validation/artifact-schema-validation-latest.json"],
  },
];

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function repoRelative(path) {
  return relative(REPO_ROOT, resolve(REPO_ROOT, path)).replace(/\\/g, "/");
}

function usage() {
  return `Studio Brain safe ops wave runner

Usage:
  node scripts/ops/ops_wave_runner.mjs [--json] [--write]
  node scripts/ops/ops_wave_runner.mjs --dry-run --json

Options:
  --json                  Print JSON manifest.
  --write                 Write timestamped and latest manifests under output/ops/waves.
  --dry-run               Show the ordered plan without executing steps.
  --output-dir <path>     Default: output/ops/waves.
  --run-id <id>           Default: generated from current UTC time.
  --steps <a,b,c>         Restrict to step ids.
  --skip <id>             Skip one step; repeatable.
`;
}

function readFlagValue(argv, index, flag) {
  const value = argv[index];
  if (value === flag) {
    if (!argv[index + 1]) throw new Error(`${flag} requires a value.`);
    return { matched: true, value: argv[index + 1], nextIndex: index + 1 };
  }
  if (String(value).startsWith(`${flag}=`)) return { matched: true, value: String(value).slice(flag.length + 1), nextIndex: index };
  return { matched: false, value: "", nextIndex: index };
}

function parseArgs(argv) {
  const options = {
    json: false,
    write: false,
    dryRun: false,
    runId: "",
    outputDir: DEFAULT_OUTPUT_DIR,
    steps: [],
    skip: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--write") {
      options.write = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    const mappings = [
      ["--run-id", "runId"],
      ["--output-dir", "outputDir"],
      ["--steps", "steps"],
    ];
    let consumed = false;
    for (const [flag, key] of mappings) {
      const parsed = readFlagValue(argv, index, flag);
      if (!parsed.matched) continue;
      options[key] = key === "steps" ? parsed.value.split(",").map(clean).filter(Boolean) : parsed.value;
      index = parsed.nextIndex;
      consumed = true;
      break;
    }
    if (consumed) continue;
    const skip = readFlagValue(argv, index, "--skip");
    if (skip.matched) {
      options.skip.push(skip.value);
      index = skip.nextIndex;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  options.outputDir = resolve(REPO_ROOT, options.outputDir);
  options.runId ||= `ops-wave-${nowIso().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  return options;
}

function buildWavePlan(options = {}) {
  const only = new Set(options.steps || []);
  const skip = new Set(options.skip || []);
  const unknown = [...only, ...skip].filter((id) => !STEP_DEFINITIONS.some((step) => step.id === id));
  if (unknown.length > 0) throw new Error(`Unknown step id(s): ${Array.from(new Set(unknown)).join(", ")}`);
  return STEP_DEFINITIONS
    .filter((step) => (only.size === 0 || only.has(step.id)) && !skip.has(step.id))
    .map((step, index) => ({
      ...step,
      order: index + 1,
      commandText: step.command.map((part, partIndex) => (partIndex === 0 && part === process.execPath ? "node" : part)).join(" "),
    }));
}

function parseJsonObject(stdout) {
  const text = clean(stdout);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function defaultRunner(step) {
  const [cmd, ...args] = step.command;
  const result = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    code: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function statusFromReceipt(receipt) {
  if (receipt.code !== 0) return "fail";
  const jsonStatus = clean(receipt.parsed?.status);
  if (["pass", "warn", "fail"].includes(jsonStatus)) return jsonStatus;
  return "pass";
}

function runWave(options = {}, runner = defaultRunner) {
  const generatedAt = nowIso();
  const plan = buildWavePlan(options);
  const receipts = [];
  for (const step of plan) {
    if (options.dryRun) {
      receipts.push({
        id: step.id,
        order: step.order,
        status: "skipped",
        code: null,
        command: step.commandText,
        expectedArtifacts: step.expectedArtifacts,
        parsedStatus: "",
        stdoutBytes: 0,
        stderrBytes: 0,
      });
      continue;
    }
    const raw = runner(step);
    const parsed = parseJsonObject(raw.stdout);
    const receipt = {
      id: step.id,
      order: step.order,
      status: statusFromReceipt({ ...raw, parsed }),
      code: raw.code,
      command: step.commandText,
      expectedArtifacts: step.expectedArtifacts,
      parsedStatus: clean(parsed?.status),
      stdoutBytes: Buffer.byteLength(raw.stdout || "", "utf8"),
      stderrBytes: Buffer.byteLength(raw.stderr || "", "utf8"),
      stderrPreview: clean(raw.stderr).slice(0, 500),
    };
    receipts.push(receipt);
    if (receipt.status === "fail") break;
  }
  const status = options.dryRun
    ? "planned"
    : receipts.some((receipt) => receipt.status === "fail")
      ? "fail"
      : receipts.some((receipt) => receipt.status === "warn" || receipt.status === "skipped")
        ? "warn"
        : "pass";
  return {
    schema: "studiobrain-ops-wave-runner.v1",
    generatedAt,
    runId: options.runId || "",
    status,
    readOnly: true,
    dryRun: Boolean(options.dryRun),
    safeWriteRoots: ["output/ops"],
    plan: plan.map((step) => ({
      id: step.id,
      order: step.order,
      command: step.commandText,
      expectedArtifacts: step.expectedArtifacts,
    })),
    receipts,
    nextRecommendedAction: status === "fail"
      ? "Inspect the failed receipt before running downstream dependent steps."
      : status === "planned"
        ? "Run without --dry-run to refresh ordered ops artifacts."
        : "Use the latest work packet, artifact validation report, and PR readiness packet for the next safe slice.",
  };
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function run(rawArgs = process.argv.slice(2)) {
  const options = parseArgs(rawArgs);
  const manifest = runWave(options);
  const artifact = resolve(options.outputDir, `${manifest.runId}.json`);
  const latest = resolve(options.outputDir, "ops-wave-runner-latest.json");
  if (options.write) {
    writeJson(artifact, manifest);
    writeJson(latest, manifest);
  }
  const report = {
    ...manifest,
    artifacts: options.write ? { jsonPath: repoRelative(artifact), latestPath: repoRelative(latest) } : null,
  };
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(`ops wave runner: ${manifest.status}\n`);
    process.stdout.write(`steps: ${manifest.receipts.length}/${manifest.plan.length}\n`);
    if (options.write) process.stdout.write(`artifact: ${repoRelative(artifact)}\n`);
  }
  if (manifest.status === "fail") process.exitCode = 1;
  return report;
}

export { buildWavePlan, runWave };

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
