#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const parsedArgs = parseArgs(process.argv.slice(2));
const artifactPath = resolveArtifactPath(parsedArgs.artifact);
const startedAt = new Date().toISOString();

const steps = buildSteps(parsedArgs);
const results = [];
const optionalFailures = [];
let status = "pass";
let failedRequiredStep = null;

for (const step of steps) {
  const detail = runStep(step);
  results.push(detail);

  if (!detail.ok) {
    if (step.required) {
      failedRequiredStep = detail.name;
      status = "fail";
      break;
    }
    optionalFailures.push(detail.name);
    if (status === "pass") {
      status = "pass-with-warnings";
    }
  }
}

const payload = {
  status,
  startedAt,
  completedAt: new Date().toISOString(),
  includeSmoke: parsedArgs.smoke,
  steps: results,
  warningCount: optionalFailures.length,
  optionalFailures,
  failedStep: failedRequiredStep,
  artifactVersion: "v1",
};

mkdirSync(resolve(artifactPath, ".."), { recursive: true });
writeFileSync(artifactPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
process.stdout.write(`\nCutover gate completed: ${status.toUpperCase()}\n`);
if (status === "pass-with-warnings") {
  process.stdout.write("Optional checks failed and were not treated as hard blockers.\n");
}
process.stdout.write(`Summary artifact: ${artifactPath}\n`);

if (status === "fail") {
  process.exit(1);
}

function buildSteps(config) {
  const steps = [
    {
      name: "studio-brain infra integrity",
      command: "npm",
      args: ["run", "integrity:check"],
      required: true,
      note: "Checks tracked script and config hash manifest.",
      remediation: "Review manifest drift and run `npm run integrity:update` if intentional.",
    },
    {
      name: "studio-brain env contract",
      command: "npm",
      args: ["--prefix", "studio-brain", "run", "env:validate", "--", "--json"],
      required: true,
      note: "Validates Studio Brain environment variables and contract defaults.",
      remediation: "Update `studio-brain/.env.local` and re-run this gate.",
    },
    {
      name: "studio-brain host-contract scan",
      command: "npm",
      args: ["run", "studio:host:contract:scan", "--", "--strict"],
      required: true,
      note: "Fails fast on unsupported localhost-only references in profile-mandated paths.",
      remediation: "Resolve cross-machine host assumptions or add a reviewed local exception with owner/reason.",
    },
    {
      name: "studio-brain network gate",
      command: "npm",
      args: ["run", "studio:network:check", "--", "--gate", "--strict", "--json"],
      required: true,
      note: "Validates host profile and persistence state.",
      remediation: "Fix host profile configuration and rerun `studio-brain-network` checks.",
    },
    {
      name: "studio-brain preflight",
      command: "npm",
      args: ["--prefix", "studio-brain", "run", "preflight"],
      required: true,
      note: "Checks DB/Redis/MinIO reachability.",
      remediation: "Start required services (Postgres/Redis/MinIO) and rerun.",
    },
    {
      name: "studio-brain status gate",
      command: "npm",
      args: ["run", "studio:check"],
      required: true,
      note: "Checks Studio Brain contract + endpoints are healthy.",
      remediation: "Start studio-brain and rerun gate.",
    },
  ];

  if (config.smoke) {
    steps.push(
      {
        name: "portal smoke",
        command: "npm",
        args: buildPortalSmokeArgs(config),
        required: true,
        note: "Portal + API runtime smoke with host drift guardrails.",
        remediation: "Fix portal smoke failures and rerun.",
      },
      {
        name: "website smoke",
        command: "npm",
        args: buildWebsiteSmokeArgs(config),
        required: false,
        note: "Marketing website smoke against specified target (if configured).",
        remediation: "Review website smoke output and rerun once fixed.",
      },
    );
  }

  return steps;
}

function runStep(step) {
  const commandLine = `${step.command} ${step.args.join(" ")}`.trim();
  process.stdout.write(`\n== ${step.name} ==\n`);
  process.stdout.write(`${step.note}\n`);
  process.stdout.write(`command: ${commandLine}\n`);

  const result = spawnSync(step.command, step.args, {
    cwd: repoRoot,
    stdio: "pipe",
    encoding: "utf8",
    env: process.env,
  });

  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  const detail = {
    name: step.name,
    command: commandLine,
    required: Boolean(step.required),
    remediation: step.remediation,
    ok: false,
    exitCode: 1,
    output: `${stdout}\n${stderr}`.trim(),
    error: "",
  };

  if (result.error) {
    detail.error = result.error.message;
    return detail;
  }

  detail.ok = result.status === 0;
  detail.exitCode = result.status ?? 1;
  return detail;
}

function buildPortalSmokeArgs(config) {
  const args = ["run", "portal:smoke:playwright", "--", "--output-dir", config.portalOutputDir];
  if (config.portalDeep) {
    args.push("--deep");
  }
  if (config.portalBaseUrl) {
    args.push("--base-url", config.portalBaseUrl);
  }
  return args;
}

function buildWebsiteSmokeArgs(config) {
  const args = ["run", "website:smoke:playwright", "--", "--output-dir", config.websiteOutputDir];
  if (config.websiteBaseUrl) {
    args.push("--base-url", config.websiteBaseUrl);
  }
  return args;
}

function parseArgs(rawArgs) {
  const parsed = {
    artifact: resolve(repoRoot, "output/cutover-gate/summary.json"),
    smoke: true,
    portalDeep: false,
    portalBaseUrl: "",
    websiteBaseUrl: "",
    portalOutputDir: resolve(repoRoot, "output/cutover-gate/portal"),
    websiteOutputDir: resolve(repoRoot, "output/cutover-gate/website"),
  };

  for (let i = 0; i < rawArgs.length; i += 1) {
    const current = rawArgs[i];

    if (current === "--no-smoke") {
      parsed.smoke = false;
      continue;
    }
    if (current === "--portal-deep") {
      parsed.portalDeep = true;
      continue;
    }
    if (current === "--portal-base-url") {
      parsed.portalBaseUrl = rawArgs[i + 1] || "";
      i += 1;
      continue;
    }
    if (current === "--website-base-url") {
      parsed.websiteBaseUrl = rawArgs[i + 1] || "";
      i += 1;
      continue;
    }
    if (current === "--portal-output-dir") {
      parsed.portalOutputDir = resolveInputPath(rawArgs[i + 1], "output/cutover-gate/portal");
      i += 1;
      continue;
    }
    if (current === "--website-output-dir") {
      parsed.websiteOutputDir = resolveInputPath(rawArgs[i + 1], "output/cutover-gate/website");
      i += 1;
      continue;
    }
    if (current === "--artifact") {
      parsed.artifact = resolveInputPath(rawArgs[i + 1], "output/cutover-gate/summary.json");
      i += 1;
      continue;
    }
    if (current === "--help") {
      printUsage();
      process.exit(0);
    }
  }

  return parsed;
}

function resolveInputPath(value, fallbackRelative) {
  if (!value) {
    return resolve(repoRoot, fallbackRelative);
  }
  if (isAbsolute(value)) {
    return value;
  }
  return resolve(repoRoot, value);
}

function resolveArtifactPath(path) {
  const resolved = resolveInputPath(path, "output/cutover-gate/summary.json");
  mkdirSync(resolve(resolved, ".."), { recursive: true });
  return resolved;
}

function printUsage() {
  const output = [
    "Usage: node ./scripts/studio-cutover-gate.mjs [options]",
    "",
    "Options:",
    "  --no-smoke                   Skip portal + website smoke checks.",
    "  --portal-deep                Run portal smoke in deep mode.",
    "  --portal-base-url <url>      Override portal smoke base URL.",
    "  --website-base-url <url>     Override website smoke base URL.",
    "  --portal-output-dir <path>    Directory for portal smoke screenshots/reports.",
    "  --website-output-dir <path>   Directory for website smoke screenshots/reports.",
    "  --artifact <path>            Write JSON artifact to this path.",
    "  --help                       Show this help text.",
    "",
    "Examples:",
    "  node ./scripts/studio-cutover-gate.mjs",
    "  node ./scripts/studio-cutover-gate.mjs --no-smoke --artifact output/cutover-gate/local-summary.json",
    "  node ./scripts/studio-cutover-gate.mjs --portal-deep --portal-base-url https://monsoonfire-portal.web.app",
  ];
  process.stdout.write(`${output.join("\n")}\n`);
}
