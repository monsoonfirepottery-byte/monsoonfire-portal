#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { defaultArtifactRegistry } from "./artifact_registry.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "waves");
const DEFAULT_WORK_PACKET_MAX_PACKETS = 3;

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
    id: "tooling-findings",
    command: [process.execPath, "scripts/ops/tooling_findings_export.mjs", "--json", "--write"],
    expectedArtifacts: ["output/ops/tooling-quality/tooling-findings-latest.json"],
  },
  {
    id: "tool-inventory",
    command: [process.execPath, "scripts/ops/installed_tool_inventory.mjs", "--json", "--write"],
    expectedArtifacts: ["output/ops/effectivity/installed-tool-inventory-latest.json"],
  },
  {
    id: "tool-install-recommendations",
    command: [process.execPath, "scripts/ops/tool_install_recommendations.mjs", "--json", "--write"],
    expectedArtifacts: ["output/ops/effectivity/tool-install-recommendations-latest.json"],
  },
  {
    id: "admin-effectivity-audit",
    command: [process.execPath, "scripts/ops/admin_effectivity_audit.mjs", "--write", "--json"],
    expectedArtifacts: ["output/ops/effectivity/admin-effectivity-audit-latest.json"],
  },
  {
    id: "host-drift-manifest",
    command: [process.execPath, "scripts/ops/host_drift_manifest.mjs", "--json", "--write"],
    expectedArtifacts: ["output/ops/host-drift/host-drift-manifest-latest.json"],
  },
  {
    id: "pr-stack-audit",
    command: [process.execPath, "scripts/ops/pr_stack_audit.mjs", "--json", "--write"],
    expectedArtifacts: ["output/ops/pr-stack/pr-stack-audit-latest.json"],
  },
  {
    id: "work-packet",
    command: [process.execPath, "scripts/studiobrain-ops-work-packet.mjs", "--json", "--write"],
    expectedArtifacts: ["output/ops/swarm/latest-work-packet.json"],
  },
  {
    id: "packet-outcome-report",
    command: [process.execPath, "scripts/ops/packet_outcome_report.mjs", "--json", "--write"],
    expectedArtifacts: ["output/ops/swarm/packet-outcome-report-latest.json"],
  },
  {
    id: "artifact-validation-pre",
    command: [process.execPath, "scripts/ops/validate_ops_artifacts.mjs", "--json", "--write"],
    expectedArtifacts: ["output/ops/artifact-validation/artifact-schema-validation-latest.json"],
  },
  {
    id: "pr-readiness",
    command: [process.execPath, "scripts/ops/pr_readiness_packet.mjs", "--json", "--write"],
    expectedArtifacts: ["output/ops/pr-readiness/pr-readiness-latest.json"],
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
  --from-step <id>        Resume from a step id and run downstream steps.
  --skip <id>             Skip one step; repeatable.
  --allow-tool-install    Allow tooling-quality to use its ephemeral validator runners.
  --max-packets <n>       Number of work packets to generate. Default: ${DEFAULT_WORK_PACKET_MAX_PACKETS}.
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
    allowToolInstall: false,
    runId: "",
    outputDir: DEFAULT_OUTPUT_DIR,
    steps: [],
    fromStep: "",
    skip: [],
    maxPackets: DEFAULT_WORK_PACKET_MAX_PACKETS,
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
    if (arg === "--allow-tool-install") {
      options.allowToolInstall = true;
      continue;
    }
    const mappings = [
      ["--run-id", "runId"],
      ["--output-dir", "outputDir"],
      ["--steps", "steps"],
      ["--from-step", "fromStep"],
      ["--max-packets", "maxPackets"],
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
  options.maxPackets = Math.max(1, Number(options.maxPackets) || DEFAULT_WORK_PACKET_MAX_PACKETS);
  options.runId ||= `ops-wave-${nowIso().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  return options;
}

function buildWavePlan(options = {}) {
  const only = new Set(options.steps || []);
  const skip = new Set(options.skip || []);
  const fromStep = clean(options.fromStep);
  const unknown = [...only, ...skip, fromStep].filter(Boolean).filter((id) => !STEP_DEFINITIONS.some((step) => step.id === id));
  if (unknown.length > 0) throw new Error(`Unknown step id(s): ${Array.from(new Set(unknown)).join(", ")}`);
  const fromIndex = fromStep ? STEP_DEFINITIONS.findIndex((step) => step.id === fromStep) : 0;
  return STEP_DEFINITIONS
    .filter((step, definitionIndex) => definitionIndex >= fromIndex && (only.size === 0 || only.has(step.id)) && !skip.has(step.id))
    .map((step, index) => {
      let command = step.command;
      if (step.id === "tooling-quality" && options.allowToolInstall) command = [...command, "--allow-install"];
      if (step.id === "work-packet") command = [...command, "--max-packets", String(options.maxPackets || DEFAULT_WORK_PACKET_MAX_PACKETS)];
      return {
        ...step,
        command,
        order: index + 1,
        commandText: command.map((part, partIndex) => (partIndex === 0 && part === process.execPath ? "node" : part)).join(" "),
      };
  });
}

function checkRegistryConsistency(plan, options = {}, registry = defaultArtifactRegistry()) {
  const registeredArtifacts = new Map(registry.map((entry) => [repoRelative(entry.artifact), entry]));
  const plannedArtifacts = new Set(plan.flatMap((step) => step.expectedArtifacts.map((artifact) => repoRelative(artifact))));
  const waveStepIds = new Set(STEP_DEFINITIONS.map((step) => step.id));
  const restrictedPlan = Boolean((options.steps || []).length > 0 || (options.skip || []).length > 0 || clean(options.fromStep));
  const unregisteredExpectedArtifacts = [...plannedArtifacts]
    .filter((artifact) => !registeredArtifacts.has(artifact))
    .sort();
  const managedRegistryArtifactsMissingFromPlan = restrictedPlan
    ? []
    : registry
        .filter((entry) => waveStepIds.has(entry.producerStep))
        .map((entry) => repoRelative(entry.artifact))
        .filter((artifact) => !plannedArtifacts.has(artifact))
        .sort();
  const externalRegistryArtifacts = registry
    .filter((entry) => !waveStepIds.has(entry.producerStep))
    .map((entry) => ({
      id: entry.id,
      artifact: repoRelative(entry.artifact),
      producerStep: clean(entry.producerStep),
      producerCommand: clean(entry.producerCommand),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const warnings = [
    ...unregisteredExpectedArtifacts.map((artifact) => `planned artifact is not registered: ${artifact}`),
    ...managedRegistryArtifactsMissingFromPlan.map((artifact) => `registry artifact claims a wave producer but is not in the plan: ${artifact}`),
  ];
  return {
    status: warnings.length > 0 ? "warn" : "pass",
    restrictedPlan,
    registeredArtifacts: registry.length,
    plannedArtifacts: plannedArtifacts.size,
    unregisteredExpectedArtifacts,
    managedRegistryArtifactsMissingFromPlan,
    externalRegistryArtifacts,
    warnings,
  };
}

function quoteCommandArg(value) {
  const text = String(value ?? "");
  return /^[A-Za-z0-9._:/\\=-]+$/.test(text) ? text : JSON.stringify(text);
}

function buildResumeCommand(options = {}, failedStepId = "") {
  if (!failedStepId) return "";
  const args = ["scripts/ops/ops_wave_runner.mjs", "--json", "--write", "--from-step", failedStepId];
  const outputDir = resolve(REPO_ROOT, options.outputDir || DEFAULT_OUTPUT_DIR);
  if (outputDir !== DEFAULT_OUTPUT_DIR) args.push("--output-dir", repoRelative(outputDir));
  if (Array.isArray(options.steps) && options.steps.length > 0) args.push("--steps", options.steps.join(","));
  for (const skipped of options.skip || []) args.push("--skip", skipped);
  if (options.allowToolInstall) args.push("--allow-tool-install");
  const maxPackets = Math.max(1, Number(options.maxPackets) || DEFAULT_WORK_PACKET_MAX_PACKETS);
  if (maxPackets !== DEFAULT_WORK_PACKET_MAX_PACKETS) args.push("--max-packets", String(maxPackets));
  return ["node", ...args].map(quoteCommandArg).join(" ");
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
  const registryConsistency = checkRegistryConsistency(plan, options);
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
  const failedReceipt = receipts.find((receipt) => receipt.status === "fail");
  const resumeCommand = buildResumeCommand(options, failedReceipt?.id || "");
  return {
    schema: "studiobrain-ops-wave-runner.v1",
    generatedAt,
    runId: options.runId || "",
    status,
    readOnly: true,
    dryRun: Boolean(options.dryRun),
    safeWriteRoots: ["output/ops"],
    registryConsistency,
    plan: plan.map((step) => ({
      id: step.id,
      order: step.order,
      command: step.commandText,
      expectedArtifacts: step.expectedArtifacts,
    })),
    receipts,
    resumeCommand,
    nextRecommendedAction: status === "fail"
      ? `Inspect the failed receipt before running downstream dependent steps. Resume with: ${resumeCommand}`
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
  const shouldUpdateLatest = options.write && !options.dryRun;
  if (options.write) {
    writeJson(artifact, manifest);
    if (shouldUpdateLatest) writeJson(latest, manifest);
  }
  const report = {
    ...manifest,
    artifacts: options.write
      ? {
          jsonPath: repoRelative(artifact),
          latestPath: shouldUpdateLatest ? repoRelative(latest) : "",
          latestUpdated: shouldUpdateLatest,
        }
      : null,
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

export { buildWavePlan, checkRegistryConsistency, runWave };

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
