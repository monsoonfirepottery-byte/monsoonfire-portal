#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const DEFAULT_SUMMARY_ARTIFACT = "output/studio-brain/audits/studio-doctor-latest.json";
const DEFAULT_RAW_ARTIFACT = "output/studio-brain/audits/studio-status-latest.json";
const DEFAULT_MARKDOWN_ARTIFACT = "output/studio-brain/audits/studio-doctor-latest.md";

export function parseDoctorArgs(rawArgs = []) {
  const args = {
    json: false,
    pretty: false,
    mode: "live_host_authoritative",
    gate: true,
    requireSafe: true,
    approvedRemoteRunner: true,
    summaryArtifact: DEFAULT_SUMMARY_ARTIFACT,
    rawArtifact: DEFAULT_RAW_ARTIFACT,
    markdownArtifact: DEFAULT_MARKDOWN_ARTIFACT,
    writeMarkdown: true,
    statusPassthrough: [],
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--pretty") {
      args.pretty = true;
      continue;
    }
    if (arg === "--mode") {
      args.mode = rawArgs[index + 1] || args.mode;
      index += 1;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      args.mode = arg.substring("--mode=".length);
      continue;
    }
    if (arg === "--artifact") {
      args.summaryArtifact = rawArgs[index + 1] || args.summaryArtifact;
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      args.summaryArtifact = arg.substring("--artifact=".length);
      continue;
    }
    if (arg === "--raw-artifact") {
      args.rawArtifact = rawArgs[index + 1] || args.rawArtifact;
      index += 1;
      continue;
    }
    if (arg.startsWith("--raw-artifact=")) {
      args.rawArtifact = arg.substring("--raw-artifact=".length);
      continue;
    }
    if (arg === "--markdown") {
      args.markdownArtifact = rawArgs[index + 1] || args.markdownArtifact;
      args.writeMarkdown = true;
      index += 1;
      continue;
    }
    if (arg.startsWith("--markdown=")) {
      args.markdownArtifact = arg.substring("--markdown=".length);
      args.writeMarkdown = true;
      continue;
    }
    if (arg === "--no-markdown") {
      args.writeMarkdown = false;
      continue;
    }
    if (arg === "--no-gate") {
      args.gate = false;
      continue;
    }
    if (arg === "--no-require-safe") {
      args.requireSafe = false;
      continue;
    }
    if (arg === "--no-approved-remote-runner") {
      args.approvedRemoteRunner = false;
      continue;
    }
    if (
      [
        "--strict",
        "--include-metrics",
        "--no-host-scan",
        "--no-evidence",
        "--no-auth-probe",
        "--no-backup",
      ].includes(arg)
    ) {
      args.statusPassthrough.push(arg);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

export function buildStatusArgs(args) {
  const statusArgs = ["./scripts/studiobrain-status.mjs", "--json", "--mode", args.mode];
  if (args.gate) statusArgs.push("--gate");
  if (args.requireSafe) statusArgs.push("--require-safe");
  if (args.approvedRemoteRunner) statusArgs.push("--approved-remote-runner");
  if (args.rawArtifact) statusArgs.push("--artifact", args.rawArtifact);
  statusArgs.push(...args.statusPassthrough);
  return statusArgs;
}

export function buildDoctorSummary(statusPayload, options = {}) {
  const checks = Array.isArray(statusPayload?.checks) ? statusPayload.checks : [];
  const blockers = checks
    .filter((entry) => entry?.severity === "error" && entry.ok !== true)
    .map(summarizeCheck);
  const warnings = checks
    .filter((entry) => entry?.severity === "warning" && entry.ok !== true)
    .map(summarizeCheck);
  const endpoints = Array.isArray(statusPayload?.endpoints)
    ? statusPayload.endpoints.map((entry) => ({
        name: entry.name,
        category: entry.category,
        ok: entry.ok === true,
        status: entry.status || (entry.ok ? "pass" : "fail"),
        latencyMs: entry.latencyMs ?? null,
        message: entry.message || "",
      }))
    : [];
  const safeToRunHighRisk = statusPayload?.posture?.safeToRunHighRisk === true;
  const mode = statusPayload?.environment?.mode || options.mode || "unknown";
  const status = statusPayload?.status || "unknown";

  return {
    schema: "studio-brain-doctor.v1",
    status,
    generatedAt: new Date().toISOString(),
    source: {
      command: "node ./scripts/studiobrain-status.mjs",
      mode,
      rawArtifact: options.rawArtifact || null,
      generator: "scripts/studiobrain-doctor.mjs",
    },
    posture: {
      safeToRunHighRisk,
      summary: {
        blockers: blockers.length,
        warnings: warnings.length,
        endpoints: endpoints.length,
      },
      blockers,
      warnings,
    },
    endpoints,
    evidence: {
      contract: summarizeNamedStatus(statusPayload?.contract),
      integrity: summarizeNamedStatus(statusPayload?.integrity),
      hostContract: summarizeNamedStatus(statusPayload?.hostContract),
      hostDriftAllowlist: summarizeNamedStatus(statusPayload?.hostDriftAllowlist),
      backupFreshness: summarizeNamedStatus(statusPayload?.backupFreshness),
      authProbe: summarizeNamedStatus(statusPayload?.authProbe),
      evidenceGovernance: summarizeNamedStatus(statusPayload?.evidenceGovernance),
    },
    recommendedNextActions: buildNextActions({ status, safeToRunHighRisk, blockers, warnings }),
    exitPolicy: {
      gateFailure: status === "fail",
      requireSafeFailure: status !== "pass",
      expectedExitCode: status === "pass" ? 0 : 1,
    },
  };
}

export function renderMarkdown(summary) {
  const lines = [
    "# Studio Brain Doctor",
    "",
    `- Status: ${summary.status}`,
    `- Safe to run high-risk ops: ${summary.posture.safeToRunHighRisk ? "yes" : "no"}`,
    `- Mode: ${summary.source.mode}`,
    `- Raw artifact: ${summary.source.rawArtifact || "n/a"}`,
    "",
    "## Blockers",
    "",
  ];

  if (summary.posture.blockers.length === 0) {
    lines.push("- None");
  } else {
    for (const blocker of summary.posture.blockers) {
      lines.push(`- ${blocker.name}: ${blocker.message || blocker.status}`);
    }
  }

  lines.push("", "## Warnings", "");
  if (summary.posture.warnings.length === 0) {
    lines.push("- None");
  } else {
    for (const warning of summary.posture.warnings) {
      lines.push(`- ${warning.name}: ${warning.message || warning.status}`);
    }
  }

  lines.push("", "## Endpoints", "");
  for (const endpoint of summary.endpoints) {
    lines.push(`- ${endpoint.name}: ${endpoint.status} (${endpoint.latencyMs ?? "n/a"}ms)`);
  }

  lines.push("", "## Next Actions", "");
  for (const action of summary.recommendedNextActions) {
    lines.push(`- ${action}`);
  }

  return `${lines.join("\n")}\n`;
}

function summarizeCheck(entry) {
  return {
    name: entry.name || "unknown",
    category: entry.category || "unknown",
    severity: entry.severity || "unknown",
    status: entry.status || (entry.ok ? "pass" : "fail"),
    message: entry.message || "",
    details: summarizeDetails(entry.details),
  };
}

function summarizeDetails(details) {
  if (!details || typeof details !== "object") return null;
  if (details.freshness?.summary) {
    return {
      summary: details.freshness.summary,
      services: Object.fromEntries(
        Object.entries(details.freshness.services || {}).map(([name, value]) => [
          name,
          {
            status: value?.status || "unknown",
            message: value?.message || "",
            ageMinutes: value?.ageMinutes ?? null,
          },
        ]),
      ),
    };
  }
  if (details.summary && typeof details.summary === "object") {
    return details.summary;
  }
  if (typeof details.message === "string") {
    return { message: details.message };
  }
  return null;
}

function summarizeNamedStatus(value) {
  if (!value || typeof value !== "object") return null;
  return {
    ok: value.ok === true || value.status === "pass",
    status: value.status || (value.ok ? "pass" : "unknown"),
    message: value.message || value.summary?.status || value.freshness?.summary || "",
  };
}

function buildNextActions({ status, safeToRunHighRisk, blockers, warnings }) {
  const actions = [];
  const blockerText = blockers.map((entry) => `${entry.name} ${entry.message}`.toLowerCase()).join(" ");
  if (blockerText.includes("authoritative") || blockerText.includes(".env.example") || blockerText.includes("fallback")) {
    actions.push("Run the doctor on the Studio Brain host or provide the real Studio Brain env file before trusting live_host_authoritative output.");
  }
  if (blockerText.includes("backup")) {
    actions.push("Refresh backup evidence or run the restore-confidence workflow before high-risk operations.");
  }
  if (blockers.length > 0 && !actions.length) {
    actions.push("Resolve the listed blockers, then rerun npm run studio:doctor.");
  }
  if (warnings.length > 0) {
    actions.push("Review warnings after blockers are cleared; warnings still keep strict doctor runs noisy.");
  }
  if (status === "pass" && safeToRunHighRisk) {
    actions.push("Doctor gate is green for normal guarded operations.");
  }
  if (!safeToRunHighRisk && blockers.length === 0) {
    actions.push("Confirm execution authority and warning policy before treating the host as safe for high-risk operations.");
  }
  return actions.length ? actions : ["No action required."];
}

function writeJsonArtifact(path, payload, pretty = true) {
  const resolved = resolve(REPO_ROOT, path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(payload, null, pretty ? 2 : 0)}\n`, "utf8");
}

function writeTextArtifact(path, content) {
  const resolved = resolve(REPO_ROOT, path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, content, "utf8");
}

function parseJsonOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    const firstBrace = stdout.indexOf("{");
    const lastBrace = stdout.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(stdout.slice(firstBrace, lastBrace + 1));
    }
    throw new Error("studiobrain-status did not emit parseable JSON");
  }
}

function printHelp() {
  process.stdout.write("Usage: node ./scripts/studiobrain-doctor.mjs [flags]\n");
  process.stdout.write("  --json                         print compact doctor JSON\n");
  process.stdout.write("  --mode <mode>                   default live_host_authoritative\n");
  process.stdout.write("  --artifact <path>               compact doctor artifact path\n");
  process.stdout.write("  --raw-artifact <path>           raw studiobrain-status artifact path\n");
  process.stdout.write("  --markdown <path>               markdown artifact path\n");
  process.stdout.write("  --no-markdown                   skip markdown artifact\n");
  process.stdout.write("  --no-gate                       do not ask status checker to gate failures\n");
  process.stdout.write("  --no-require-safe               allow warn/fail without safe-run exit policy\n");
  process.stdout.write("  --no-approved-remote-runner     do not mark this runner as approved\n");
  process.stdout.write("  --strict --include-metrics --no-host-scan --no-evidence --no-auth-probe --no-backup\n");
}

export function runDoctor(rawArgs = process.argv.slice(2)) {
  const args = parseDoctorArgs(rawArgs);
  if (args.help) {
    printHelp();
    return 0;
  }

  const statusArgs = buildStatusArgs(args);
  const result = spawnSync(process.execPath, statusArgs, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  const statusPayload = parseJsonOutput(result.stdout || "");
  const summary = buildDoctorSummary(statusPayload, {
    mode: args.mode,
    rawArtifact: args.rawArtifact,
  });
  summary.source.statusExitCode = result.status ?? 0;
  summary.source.stderrPresent = Boolean(result.stderr && result.stderr.trim());

  if (args.summaryArtifact) {
    writeJsonArtifact(args.summaryArtifact, summary, true);
  }
  if (args.writeMarkdown && args.markdownArtifact) {
    writeTextArtifact(args.markdownArtifact, renderMarkdown(summary));
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, args.pretty ? 2 : 0)}\n`);
  } else {
    process.stdout.write(renderMarkdown(summary));
  }

  return summary.exitPolicy.expectedExitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = runDoctor();
  } catch (error) {
    process.stderr.write(`studio doctor failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
