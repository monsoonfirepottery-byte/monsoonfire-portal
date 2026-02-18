import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isStudioBrainHostAllowed, resolveStudioBrainNetworkProfile } from "./studio-network-profile.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const parsedArgs = parseArgs(process.argv.slice(2));
const includeSmoke = parsedArgs.smoke;

const steps = [
  {
    name: "studio-brain env contract",
    kind: "command",
    command: "npm",
    args: ["--prefix", "studio-brain", "run", "env:validate", "--", "--json"],
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
    name: "studio-brain network runtime contract",
    kind: "command",
    command: "node",
    args: ["./scripts/studiobrain-network-check.mjs", "--gate", "--strict"],
    remediation: "Resolve host drift by refreshing STUDIO_BRAIN_NETWORK_PROFILE and STUDIO_BRAIN_HOST values for LAN workflows.",
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
    command: "node",
    args: ["./scripts/studiobrain-status.mjs", "--json", "--gate"],
    remediation: "Start studio-brain, run env fixes, and rerun this gate.",
    required: true,
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
      const detail = step.check();
      common.ok = detail.ok;
      common.exitCode = detail.ok ? 0 : 1;
      common.output = detail.message || "";
      if (detail.checks && detail.checks.length > 0) {
        common.checks = detail.checks;
      }
      if (common.output) {
        process.stdout.write(`${common.output}\n`);
      }
      return common;
    } catch (error) {
      common.output = error instanceof Error ? error.message : String(error);
      return common;
    }
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
