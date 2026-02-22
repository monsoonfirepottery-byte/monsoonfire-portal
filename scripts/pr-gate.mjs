import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isStudioBrainHostAllowed, resolveStudioBrainNetworkProfile } from "./studio-network-profile.mjs";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const parsedArgs = parseArgs(process.argv.slice(2));
const includeSmoke = parsedArgs.smoke;

const REQUIRED_NODE_ENTRYPOINTS = [
  "scripts/start-emulators.mjs",
  "scripts/portal-playwright-smoke.mjs",
  "scripts/website-playwright-smoke.mjs",
  "scripts/scan-studiobrain-host-contract.mjs",
  "scripts/validate-emulator-contract.mjs",
  "scripts/studio-stack-profile-snapshot.mjs",
  "scripts/studiobrain-status.mjs",
  "scripts/studiobrain-network-check.mjs",
  "scripts/check-agent-surfaces.mjs",
  "website/scripts/serve.mjs",
  "website/scripts/deploy.mjs",
  "website/ncsitebuilder/scripts/serve.mjs",
  "scripts/ps1-run.mjs",
];

const steps = [
  {
    name: "required node entrypoints",
    kind: "check",
    check: checkRequiredNodeEntrypoints,
    remediation: "Restore missing script files before running PR gate. This should be a repo-level integrity blocker, not an environment issue.",
    required: true,
  },
  {
    name: "studio-brain env contract",
    kind: "command",
    command: "npm",
    args: ["--prefix", "studio-brain", "run", "env:validate", "--", "--strict", "--json"],
    remediation: "Fix variables in studio-brain/.env.local or run dotenv load for PR profile.",
    required: true,
  },
  {
    name: "studio-brain host profile consistency",
    kind: "check",
    check: checkStudioBrainHostProfile,
    remediation: "Align STUDIO_BRAIN_BASE_URL, STUDIO_BRAIN_HOST, and STUDIO_BRAIN_PORT before continuing.",
    required: true,
  },
  {
    name: "platform reference drift (non-essential OS/tooling markers)",
    kind: "command",
    command: "node",
    args: [
      "./scripts/ralph-platform-reference-audit.mjs",
      "--strict",
      "--skip-tickets",
      "--max-actionable",
      "0",
      "--json",
    ],
    remediation: "Reduce non-essential OS/tooling assumptions. Add only reviewed compatibility exceptions to `scripts/ralph-platform-reference-exemptions.json` with owner/reason.",
    required: true,
  },
  {
    name: "studio-brain network runtime contract",
    kind: "command",
    command: "node",
    args: [
      "./scripts/studiobrain-network-check.mjs",
      "--gate",
      "--strict",
      "--write-state",
      "--artifact",
      "output/studio-network-check/pr-gate.json",
    ],
    remediation: "Resolve host drift by refreshing STUDIO_BRAIN_NETWORK_PROFILE and STUDIO_BRAIN_HOST values for LAN workflows.",
    required: true,
  },
  {
    name: "studio-brain stability guardrails",
    kind: "command",
    command: "node",
    args: ["./scripts/stability-guardrails.mjs", "--strict", "--json"],
    remediation: "Review warning details and apply `npm run guardrails:check:strict` in the same environment before merging.",
    required: false,
  },
  {
    name: "studio-brain emulator contract",
    kind: "command",
    command: "npm",
    args: ["run", "studio:emulator:contract:check", "--", "--strict", "--json"],
    remediation: "Fix portal emulator contracts in web/.env.local (auth/firestore/functions host and port toggles) before PR gate checks.",
    required: true,
  },
  {
    name: "studio stack profile snapshot",
    kind: "command",
    command: "npm",
    args: ["run", "studio:stack:profile:snapshot:strict", "--", "--json", "--artifact", "output/studio-stack-profile/latest.json"],
    remediation: "Resolve Vite/Firebase stack host and deploy contract before PR merge.",
    required: true,
  },
  {
    name: "source-of-truth API contract matrix",
    kind: "command",
    command: "node",
    args: ["./scripts/source-of-truth-contract-matrix.mjs", "--strict", "--json"],
    remediation: "Resolve API contract parity issues in web/native/backend source files.",
    required: true,
  },
  {
    name: "source-of-truth deployment gates (all profiles)",
    kind: "command",
    command: "node",
    args: ["./scripts/source-of-truth-deployment-gates.mjs", "--phase", "all", "--strict", "--json", "--artifact", "output/source-of-truth-deployment-gates/pr-gate.json"],
    remediation: "Resolve deployment source-of-truth drift before PR merge.",
    required: true,
  },
  {
    name: "source-of-truth index registry audit",
    kind: "command",
    command: "node",
    args: ["./scripts/source-of-truth-index-audit.mjs", "--strict", "--json"],
    remediation: "Update docs/SOURCE_OF_TRUTH_INDEX.md and .codex/config.toml source entries before PR merge.",
    required: true,
  },
  {
    name: "agent-readable surfaces check",
    kind: "command",
    command: "node",
    args: ["./scripts/check-agent-surfaces.mjs", "--strict", "--json"],
    remediation: "Update website/portal llms.txt, ai.txt, agent docs, and public contracts artifact so checks pass without exposing sensitive data.",
    required: true,
  },
  {
    name: "studio-brain preflight",
    kind: "command",
    command: "npm",
    args: ["--prefix", "studio-brain", "run", "preflight"],
    remediation: "Start required services (Postgres/Redis/MinIO) and retry.",
    required: true,
  },
  {
    name: "studio-brain status gate",
    kind: "command",
    command: "npm",
    args: ["run", "studio:check:safe", "--", "--json"],
    remediation: "Start studio-brain, run env fixes, and rerun this gate.",
    required: true,
  },
  {
    name: "well-known deployment file validation",
    kind: "command",
    command: "node",
    args: ["./scripts/validate-well-known.mjs", "--strict", "--json"],
    remediation: "Fix placeholder and host/package mismatches in .well-known files.",
    required: false,
  },
];

if (includeSmoke) {
  steps.push(
    {
      name: "portal smoke",
      kind: "command",
      command: "npm",
      args: ["run", "portal:smoke:playwright"],
      remediation: "Fix portal Playwright failures and rerun `npm run portal:smoke:playwright` locally.",
      required: true,
    },
    {
      name: "website smoke",
      kind: "command",
      command: "npm",
      args: ["run", "website:smoke:playwright"],
      remediation: "Fix website Playwright failures and rerun `npm run website:smoke:playwright` locally.",
      required: true,
    },
    {
      name: "phased smoke gate",
      kind: "command",
      command: "node",
      args: [
        "./scripts/phased-smoke-gate.mjs",
        "--phase",
        "staging",
        "--execute",
        "--strict",
        "--json",
        "--artifact",
        "output/phased-smoke-gate/pr-gate.json",
      ],
      remediation: "Resolve phase-specific smoke failures before merge with smoke mode enabled.",
      required: true,
    },
  );
}

const summary = {
  startedAt: new Date().toISOString(),
  repoRoot,
  includeSmoke,
  steps: [],
  status: "pass",
  failedStep: null,
};

for (const step of steps) {
  process.stdout.write(`\n== ${step.name} ==\n`);
  const result = executeStep(step);
  summary.steps.push(result);

  if (!result.ok) {
    summary.status = "fail";
    summary.failedStep = step.name;
    if (step.required) {
      process.stderr.write(`FAILED: ${step.name}\n`);
      process.stderr.write(`REMEDIATION: ${step.remediation}\n`);
      break;
    }
  }
}

const artifactPath = resolveArtifactPath(parsedArgs.artifact);
const output = `${JSON.stringify(summary, null, 2)}\n`;
writeArtifact(artifactPath, output);
if (parsedArgs.json) {
  process.stdout.write(output);
}

process.stdout.write(`\nPR gate completed: ${summary.status.toUpperCase()}\n`);
if (summary.status === "fail") {
  process.exitCode = 1;
}

function executeStep(step) {
  const common = {
    name: step.name,
    ok: false,
    required: Boolean(step.required),
    command: `${step.command || "check"} ${step.args ? step.args.join(" ") : ""}`.trim(),
    remediation: step.remediation,
    output: "",
    exitCode: 1,
  };

  if (step.kind === "check") {
    try {
      const checkResult = step.check();
      common.ok = checkResult.ok;
      common.exitCode = checkResult.ok ? 0 : 1;
      common.output = checkResult.message;
      if (checkResult.details?.length > 0) {
        common.checks = checkResult.details;
      }
      if (common.output) {
        process.stdout.write(`${common.output}\n`);
      }
    } catch (error) {
      common.output = error instanceof Error ? error.message : String(error);
    }
    return common;
  }

  const result = spawnSync(step.command, step.args, {
    cwd: repoRoot,
    stdio: "pipe",
    encoding: "utf8",
    env: process.env,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  common.output = String(result.stdout || "").trim();
  common.error = result.error ? result.error.message : "";
  if (result.error) {
    common.output = `${common.output}\n${common.error}`.trim();
    return common;
  }

  common.exitCode = result.status ?? 1;
  common.ok = result.status === 0;
  if (!common.ok) {
    return common;
  }

  if (step.command === "node" && step.args[0] === "./scripts/studiobrain-status.mjs") {
    try {
      const statusReport = JSON.parse(common.output || "{}");
      common.checks = statusReport.checks || [];
      common.contract = statusReport.contract || null;
    } catch {
      // keep lightweight summary in artifact; raw output already captured
    }
  }

  return common;
}

function checkRequiredNodeEntrypoints() {
  const missing = [];
  for (const rel of REQUIRED_NODE_ENTRYPOINTS) {
    const abs = resolve(repoRoot, rel);
    if (!existsSync(abs)) {
      missing.push(rel);
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      message: `Missing required node entrypoint(s): ${missing.join(", ")}`,
      details: missing,
    };
  }

  return {
    ok: true,
    message: `Required node entrypoints present (${REQUIRED_NODE_ENTRYPOINTS.length}).`,
    details: [],
  };
}

function checkStudioBrainHostProfile() {
  const network = resolveStudioBrainNetworkProfile();
  const host = process.env.STUDIO_BRAIN_HOST?.trim() || "127.0.0.1";
  const portText = process.env.STUDIO_BRAIN_PORT?.trim() || "8787";
  const rawBase = process.env.STUDIO_BRAIN_BASE_URL?.trim() || "";

  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return {
      ok: false,
      message: `Invalid STUDIO_BRAIN_PORT: ${portText}. Expected integer 1-65535.`,
    };
  }

  const baseUrl = rawBase || `http://${host}:${port}`;
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return {
      ok: false,
      message: `Invalid STUDIO_BRAIN_BASE_URL: ${baseUrl}`,
    };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return {
      ok: false,
      message: `STUDIO_BRAIN_BASE_URL must start with http or https: ${baseUrl}`,
    };
  }

  if (!isStudioBrainHostAllowed(parsed.hostname, network)) {
    return {
      ok: false,
      message: `Host mismatch: STUDIO_BRAIN_BASE_URL host (${parsed.hostname}) not in allowed hosts (${network.allowedStudioBrainHosts.join(", ")}).`,
    };
  }

  const effectivePort = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
  if (effectivePort !== port) {
    return {
      ok: false,
      message: `Port mismatch: STUDIO_BRAIN_PORT (${port}) != STUDIO_BRAIN_BASE_URL port (${effectivePort}).`,
    };
  }

  return {
    ok: true,
    message: `Host contract aligned: ${baseUrl}`,
    checks: [
      `base-url: ${baseUrl}`,
      `host-env: ${host}`,
      `port-env: ${port}`,
    ],
  };
}

function normalizeHost(host) {
  return (host || "").trim().toLowerCase();
}

function areLoopbackAliases(left, right) {
  const normalized = [normalizeHost(left), normalizeHost(right)];
  return (normalized[0] === "127.0.0.1" && normalized[1] === "localhost")
    || (normalized[0] === "localhost" && normalized[1] === "127.0.0.1");
}

function parseArgs(args) {
  const parsed = {
    smoke: false,
    json: false,
    artifact: "artifacts/pr-gate.json",
  };

  for (let i = 0; i < args.length; i += 1) {
    const current = args[i];
    if (current === "--smoke" || current === "--extended") {
      parsed.smoke = true;
      continue;
    }
    if (current === "--json") {
      parsed.json = true;
      continue;
    }
    if (current === "--artifact") {
      parsed.artifact = args[i + 1] || parsed.artifact;
      i += 1;
      continue;
    }
    if (current.startsWith("--artifact=")) {
      parsed.artifact = current.substring("--artifact=".length);
      continue;
    }
  }

  return parsed;
}

function resolveArtifactPath(path) {
  if (!path) {
    return resolve(repoRoot, "artifacts", "pr-gate.json");
  }

  const resolved = isAbsolute(path) ? path : resolve(repoRoot, path);
  mkdirSync(dirname(resolved), { recursive: true });
  return resolved;
}

function writeArtifact(path, content) {
  try {
    writeFileSync(path, content, "utf8");
  } catch (error) {
    process.stderr.write(`failed to write artifact ${path}: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}
