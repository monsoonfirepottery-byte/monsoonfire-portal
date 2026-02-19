#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { resolveStudioBrainNetworkProfile } from "./studio-network-profile.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_ARTIFACT_DIR = resolve(REPO_ROOT, "output", "stability");
const DEFAULT_INTERVAL_MS = 60_000;

const COMMAND_SEVERITY = {
  PASS: "pass",
  WARN: "warn",
  FAIL: "fail",
};

export async function runReliabilityHub(rawArgs = process.argv.slice(2), options = {}) {
  const args = parseArgs(rawArgs);
  const commandName = options.commandName || "reliability-hub";

  if (args.help) {
    printUsage(commandName);
    process.exit(0);
  }

  if (args.mode === "report") {
    return printReport(args);
  }

  const artifactDir = resolve(String(args.artifactDir || DEFAULT_ARTIFACT_DIR));
  const summaryPath = resolve(artifactDir, "heartbeat-summary.json");
  const eventLogPath = resolve(artifactDir, "heartbeat-events.log");
  ensureDirectory(artifactDir);

  let sequence = getSequence(summaryPath);
  if (args.watch || args.maxIterations > 1) {
    process.stdout.write(`reliability-hub watch enabled (${(args.intervalMs / 1000).toFixed(1)}s intervals)\n`);
  }

  const runResult = async () => {
    sequence += 1;
    const runAt = new Date().toISOString();
    const checks = [];
    const profile = resolveStudioBrainNetworkProfile();
    const startedAt = Date.now();

    for (const step of buildChecks(profile, args)) {
      const checkResult = executeCheck(step);
      checks.push(checkResult);
    }

    const failCount = checks.filter((entry) => entry.status === COMMAND_SEVERITY.FAIL).length;
    const warnCount = checks.filter((entry) => entry.status === COMMAND_SEVERITY.WARN).length;
    const passCount = checks.length - failCount - warnCount;
    const failed = checks.filter((entry) => entry.status !== COMMAND_SEVERITY.PASS);
    const criticalFail = failed.some((entry) => entry.status === COMMAND_SEVERITY.FAIL && entry.severity === "critical");
    const status = criticalFail || failed.some((entry) => entry.status === COMMAND_SEVERITY.FAIL && entry.required === true)
      ? "fail"
      : failed.length > 0
        ? "warn"
        : "pass";

    const summary = {
      command: commandName,
      status,
      startedAt: runAt,
      sequence,
      mode: args.watch ? "watch" : "once",
      durationMs: Date.now() - startedAt,
      network: {
        profile: profile.profile,
        requestedProfile: profile.requestedProfile,
        host: profile.host,
        baseUrl: profile.baseUrl,
        hasLoopbackFallback: profile.hasLoopbackFallback,
        warnings: profile.warnings,
      },
      checks,
      stats: {
        total: checks.length,
        pass: passCount,
        warn: warnCount,
        fail: failCount,
      },
      failedChecks: checks
        .filter((entry) => entry.status !== COMMAND_SEVERITY.PASS)
        .map((entry) => ({
          name: entry.name,
          severity: entry.severity,
          status: entry.status,
          message: entry.message,
        })),
    };

    const event = {
      timestamp: runAt,
      command: commandName,
      sequence,
      status,
      failedChecks: summary.failedChecks,
      durationMs: summary.durationMs,
    };

    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    appendFileSync(eventLogPath, `${JSON.stringify(event)}\n`, "utf8");

    if (args.json) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
      printSummary(summary);
    }

    return summary;
  };

  if (!args.watch) {
    const one = await runResult();
    if (args.failOnFailure && one.status !== "pass") {
      process.exit(1);
    }
    return one;
  }

  let remaining = args.maxIterations || Number.POSITIVE_INFINITY;
  while (remaining > 0) {
    const report = await runResult();
    if (args.failOnFailure && report.status !== "pass") {
      process.exitCode = 1;
      if (args.stopOnFailure) {
        break;
      }
    }

    remaining -= 1;
    if (remaining <= 0) {
      break;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, Math.max(1_000, args.intervalMs));
    });
  }
}

function executeCheck(step) {
  const startedAt = Date.now();
  const command = `${step.command} ${step.args.join(" ")}`;
  const result = spawnSync(step.command, step.args, {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: "pipe",
    encoding: "utf8",
    timeout: step.timeoutMs,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  const elapsedMs = Date.now() - startedAt;

  if (result.error) {
    return buildCheckFailure({
      name: step.name,
      severity: step.severity,
      required: Boolean(step.required),
      status: COMMAND_SEVERITY.FAIL,
      command,
      durationMs: elapsedMs,
      message: result.error.message,
      output: truncateOutput(output),
    });
  }

  if (step.parseOutput) {
    return step.parseOutput({
      name: step.name,
      severity: step.severity,
      required: Boolean(step.required),
      statusCode: result.status,
      command,
      output,
      durationMs: elapsedMs,
    });
  }

  return buildCheckResult({
    name: step.name,
    severity: step.severity,
    required: Boolean(step.required),
    statusCode: result.status,
    command,
    durationMs: elapsedMs,
    message: output || "ok",
    output,
  });
}

function buildCheckFailure(entry) {
  return {
    name: entry.name,
    severity: entry.severity || "warning",
    required: entry.required,
    command: entry.command,
    status: entry.status,
    durationMs: entry.durationMs,
    message: entry.message,
    output: entry.output,
  };
}

function buildCheckResult({
  name,
  severity,
  required,
  statusCode,
  command,
  durationMs,
  message,
  output,
  extra,
}) {
  const pass = statusCode === 0;
  return {
    name,
    severity: severity || "warning",
    required,
    command,
    status: pass ? COMMAND_SEVERITY.PASS : COMMAND_SEVERITY.FAIL,
    durationMs,
    message: message || (pass ? "pass" : "fail"),
    output: output || "",
    ...(extra ? { extra } : {}),
  };
}

function parseStatusJson(args) {
  const payload = safeJson(args.output);
  if (!payload) {
    return null;
  }

  return {
    ok: payload.status === "pass",
    status: payload.status || "unknown",
    data: payload,
    message: `status=${payload.status || "unknown"}`,
  };
}

function buildChecks(profile, args) {
  const checks = [
    {
      name: "studio-brain env contract",
      command: "npm",
      args: ["--prefix", "studio-brain", "run", "env:validate", "--", "--strict", "--json"],
      required: true,
      severity: "critical",
      parseOutput: ({ output, command, durationMs, statusCode, name }) => {
        const parsed = parseStatusJson({ output });
        if (!parsed) {
          return {
            ...buildCheckFailure({
              name,
              severity: "critical",
              required: true,
              status: COMMAND_SEVERITY.FAIL,
              command,
              durationMs,
              message: "Unable to parse env contract JSON output.",
              output: truncateOutput(output),
            }),
            status: COMMAND_SEVERITY.FAIL,
          };
        }

        if (parsed.ok) {
          return {
            name,
            severity: "critical",
            required: true,
            status: COMMAND_SEVERITY.PASS,
            command,
            durationMs,
            message: parsed.message,
            output: truncateOutput(output),
            parsed,
          };
        }

        return buildCheckFailure({
          name,
          severity: "critical",
          required: true,
          command,
          status: COMMAND_SEVERITY.FAIL,
          durationMs,
          message: parsed.message,
          output: truncateOutput(output),
        });
      },
    },
    {
      name: "studio-brain infra integrity",
      command: "npm",
      args: ["run", "integrity:check", "--", "--strict", "--json"],
      required: true,
      severity: "critical",
      parseOutput: ({ output, command, durationMs, statusCode, name }) => {
        const parsed = safeJson({ output });
        if (!parsed) {
          return {
            ...buildCheckFailure({
              name,
              severity: "critical",
              required: true,
              status: COMMAND_SEVERITY.FAIL,
              command,
              durationMs,
              message: "Unable to parse integrity check JSON output.",
              output: truncateOutput(output),
            }),
            status: COMMAND_SEVERITY.FAIL,
          };
        }

        return {
          name,
          severity: "critical",
          required: true,
          status: statusCode === 0 ? COMMAND_SEVERITY.PASS : COMMAND_SEVERITY.FAIL,
          command,
          durationMs,
          message: `infra integrity ${parsed.status || (statusCode === 0 ? "pass" : "fail")}`,
          output: truncateOutput(output),
          parsed,
        };
      },
    },
    {
      name: "stability guardrails",
      command: "npm",
      args: ["run", "guardrails:check", "--", "--strict", "--json"],
      required: false,
      severity: "warning",
      parseOutput: ({ output, command, durationMs, name }) => {
        const parsed = safeJson({ output });
        if (!parsed) {
          return buildCheckFailure({
            name,
            severity: "warning",
            required: false,
            command,
            durationMs,
            status: COMMAND_SEVERITY.WARN,
            message: "Unable to parse guardrails JSON output.",
            output: truncateOutput(output),
          });
        }
        const checkStatus = parsed.status === "pass" ? "pass" : "warn";
        return {
          name,
          severity: "warning",
          required: false,
          status: checkStatus === "pass" ? COMMAND_SEVERITY.PASS : COMMAND_SEVERITY.WARN,
          command,
          durationMs,
          message: `stability guardrails ${parsed.status}`,
          output: truncateOutput(output),
          extra: {
            strict: parsed.strict,
            summary: parsed.summary,
          },
        };
      },
    },
    {
      name: "studio-brain host contract",
      command: "npm",
      args: ["run", "studio:host:contract:scan", "--", "--strict", "--json"],
      required: true,
      severity: "critical",
      parseOutput: ({ output, command, durationMs, name }) => {
        const parsed = safeJson({ output });
        if (!parsed) {
          return {
            ...buildCheckFailure({
              name,
              severity: "critical",
              required: true,
              status: COMMAND_SEVERITY.FAIL,
              command,
              durationMs,
              message: "Unable to parse host contract JSON output.",
              output: truncateOutput(output),
            }),
            status: COMMAND_SEVERITY.FAIL,
          };
        }
        const status = parsed.summary?.status === "pass" || parsed.status === "pass" ? "pass" : "fail";
        return {
          name,
          severity: "critical",
          required: true,
          command,
          status: status === "pass" ? COMMAND_SEVERITY.PASS : COMMAND_SEVERITY.FAIL,
          durationMs,
          message: `host contract ${status}`,
          output: truncateOutput(output),
          parsed,
        };
      },
    },
    {
      name: "studio-brain network profile",
      command: "npm",
      args: ["run", "studio:network:check", "--", "--json", "--gate", "--strict"],
      required: true,
      severity: "critical",
      parseOutput: ({ output, command, durationMs, name }) => {
        const parsed = safeJson({ output });
        if (!parsed) {
          return buildCheckFailure({
            name,
            severity: "critical",
            required: true,
            command,
            durationMs,
            status: COMMAND_SEVERITY.FAIL,
            message: "Unable to parse network check JSON output.",
            output: truncateOutput(output),
          });
        }
        const status = parsed.status === "pass" ? "pass" : "fail";
        return {
          name,
          severity: "critical",
          required: true,
          command,
          status: status === "pass" ? COMMAND_SEVERITY.PASS : COMMAND_SEVERITY.FAIL,
          durationMs,
          message: `network check ${status}`,
          output: truncateOutput(output),
          parsed,
        };
      },
    },
    {
      name: "studio-brain emulator contract",
      command: "npm",
      args: ["run", "studio:emulator:contract:check", "--", "--strict", "--json"],
      required: true,
      severity: "critical",
      parseOutput: ({ output, command, durationMs, name }) => {
        const parsed = safeJson({ output });
        if (!parsed) {
          return buildCheckFailure({
            name,
            severity: "critical",
            required: true,
            status: COMMAND_SEVERITY.FAIL,
            command,
            durationMs,
            message: "Unable to parse emulator contract JSON output.",
            output: truncateOutput(output),
          });
        }
        const status = parsed.status === "pass" ? "pass" : "fail";
        return {
          name,
          severity: "critical",
          required: true,
          command,
          status: status === "pass" ? COMMAND_SEVERITY.PASS : COMMAND_SEVERITY.FAIL,
          durationMs,
          message: `emulator contract ${status}`,
          output: truncateOutput(output),
          parsed,
        };
      },
    },
    {
      name: "studio-brain status gate",
      command: "npm",
      args: ["run", "studio:check", "--", "--json", "--gate"],
      required: true,
      severity: "critical",
      parseOutput: ({ output, command, durationMs, name }) => {
        const parsed = safeJson({ output });
        if (!parsed) {
          return buildCheckFailure({
            name,
            severity: "critical",
            required: true,
            command,
            durationMs,
            status: COMMAND_SEVERITY.FAIL,
            message: "Unable to parse studio status JSON output.",
            output: truncateOutput(output),
          });
        }
        const status = parsed.status === "pass" ? "pass" : "fail";
        return {
          name,
          severity: "critical",
          required: true,
          command,
          status: status === "pass" ? COMMAND_SEVERITY.PASS : COMMAND_SEVERITY.FAIL,
          durationMs,
          message: `studio status ${status}`,
          output: truncateOutput(output),
          parsed,
        };
      },
    },
  ];

  if (args.includePreflight) {
    checks.push({
      name: "studio-brain preflight",
      command: "npm",
      args: ["--prefix", "studio-brain", "run", "preflight"],
      required: false,
      severity: "warning",
      timeoutMs: 15_000,
      parseOutput: ({ statusCode, command, durationMs, name, output }) => {
        return buildCheckResult({
          name,
          severity: "warning",
          required: false,
          statusCode,
          command,
          durationMs,
          message: statusCode === 0 ? "preflight pass" : "preflight warning",
          output,
        });
      },
    });
  }

  if (profile.warnings.length > 0 && args.profileWarningsAsWarn) {
    checks.push({
      name: "network profile warning posture",
      command: "node",
      args: ["-e", `console.log("profile warnings detected")`],
      required: false,
      severity: "warning",
      parseOutput: ({ command, durationMs, name }) => {
        return {
          name,
          severity: "warning",
          required: false,
          status: COMMAND_SEVERITY.WARN,
          command,
          durationMs,
          message: `profile has ${profile.warnings.length} warning(s)`,
          output: profile.warnings.join("; "),
        };
      },
    });
  }

  if (args.includeSmoke || args.includePortalSmoke) {
    checks.push({
      name: "portal smoke (optional)",
      command: "npm",
      args: [
        "run",
        "portal:smoke:playwright",
        "--",
        "--output-dir",
        resolve(artifactDirForChecks(), "portal"),
      ],
      required: false,
      severity: "warning",
      timeoutMs: 180_000,
      parseOutput: ({ statusCode, output, command, durationMs, name }) => buildCheckResult({
        name,
        severity: "warning",
        required: false,
        statusCode,
        command,
        durationMs,
        message: statusCode === 0 ? "portal smoke pass" : "portal smoke failed",
        output,
      }),
    });
  }

  if (args.includeSmoke || args.includeWebsiteSmoke) {
    checks.push({
      name: "website smoke (optional)",
      command: "npm",
      args: [
        "run",
        "website:smoke:playwright",
        "--",
        "--output-dir",
        resolve(artifactDirForChecks(), "website"),
      ],
      required: false,
      severity: "warning",
      timeoutMs: 180_000,
      parseOutput: ({ statusCode, output, command, durationMs, name }) => buildCheckResult({
        name,
        severity: "warning",
        required: false,
        statusCode,
        command,
        durationMs,
        message: statusCode === 0 ? "website smoke pass" : "website smoke failed",
        output,
      }),
    });
  }

  return checks;
}

function artifactDirForChecks() {
  return resolve(REPO_ROOT, "output", "stability", "smoke");
}

function safeJson(input) {
  if (!input) return null;
  const normalized = String(input.output || input).trim();
  if (!normalized) return null;
  const jsonStart = normalized.indexOf("{");
  if (jsonStart < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = jsonStart; index < normalized.length; index += 1) {
    const char = normalized[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const candidate = normalized.slice(jsonStart, index + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
      if (depth < 0) {
        return null;
      }
    }
  }

  return null;
}

function ensureDirectory(directory) {
  mkdirSync(directory, { recursive: true });
}

function getSequence(summaryPath) {
  if (!existsSync(summaryPath)) {
    return 0;
  }

  try {
    const raw = readFileSync(summaryPath, "utf8");
    const parsed = JSON.parse(raw);
    return Number(parsed.sequence || 0);
  } catch {
    return 0;
  }
}

function truncateOutput(value, max = 3_000) {
  const normalized = String(value || "");
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function printSummary(summary) {
  process.stdout.write(`\nReliability hub: ${summary.status.toUpperCase()}\n`);
  process.stdout.write(`run: ${summary.sequence}\n`);
  process.stdout.write(`durationMs: ${summary.durationMs}\n`);
  process.stdout.write(`checks: pass=${summary.stats.pass}, warn=${summary.stats.warn}, fail=${summary.stats.fail}\n`);
  summary.checks.forEach((check) => {
    process.stdout.write(
      `  [${check.status.toUpperCase()}:${check.severity}] ${check.name}` +
        (check.message ? ` - ${check.message}` : "") + "\n",
    );
  });
}

function printReport(args) {
  const artifactDir = resolve(String(args.artifactDir || DEFAULT_ARTIFACT_DIR));
  const summaryPath = resolve(artifactDir, "heartbeat-summary.json");
  const eventLogPath = resolve(artifactDir, "heartbeat-events.log");
  if (!existsSync(summaryPath)) {
    process.stderr.write(`No heartbeat summary found at ${summaryPath}\n`);
    process.exit(1);
  }

  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const topFailures = summary.failedChecks.slice(0, 3);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  process.stdout.write(`\nReliability latest report (${summary.startedAt})\n`);
  process.stdout.write(`status: ${summary.status.toUpperCase()} (run ${summary.sequence})\n`);
  process.stdout.write(`checks: pass=${summary.stats.pass}, warn=${summary.stats.warn}, fail=${summary.stats.fail}\n`);
  process.stdout.write(`network: profile=${summary.network.profile} host=${summary.network.host}\n`);
  process.stdout.write(`artifact dir: ${artifactDir}\n`);
  if (summary.failedChecks.length > 0) {
    process.stdout.write("top unresolved checks:\n");
    topFailures.forEach((entry) => {
      process.stdout.write(`  - ${entry.severity}/${entry.status}: ${entry.name} (${entry.message})\n`);
    });
  }
  process.stdout.write(`event log: ${eventLogPath}\n`);
}

function parseArgs(argv) {
  const parsed = {
    mode: "once",
    artifactDir: DEFAULT_ARTIFACT_DIR,
    json: false,
    watch: false,
    includePreflight: false,
    includeSmoke: false,
    profileWarningsAsWarn: false,
    failOnFailure: false,
    stopOnFailure: false,
    intervalMs: DEFAULT_INTERVAL_MS,
    maxIterations: Number.POSITIVE_INFINITY,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "watch") {
      parsed.watch = true;
      parsed.mode = "watch";
      continue;
    }
    if (arg === "report") {
      parsed.mode = "report";
      continue;
    }
    if (arg === "once" || arg === "--once") {
      parsed.watch = false;
      parsed.mode = "once";
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--watch") {
      parsed.watch = true;
      parsed.mode = "watch";
      continue;
    }
    if (arg === "--include-preflight") {
      parsed.includePreflight = true;
      continue;
    }
    if (arg === "--include-smoke") {
      parsed.includeSmoke = true;
      parsed.includePortalSmoke = true;
      parsed.includeWebsiteSmoke = true;
      continue;
    }
    if (arg === "--include-portal-smoke") {
      parsed.includeSmoke = true;
      parsed.includePortalSmoke = true;
      continue;
    }
    if (arg === "--include-website-smoke") {
      parsed.includeSmoke = true;
      parsed.includeWebsiteSmoke = true;
      continue;
    }
    if (arg === "--no-profile-warning") {
      parsed.profileWarningsAsWarn = false;
      continue;
    }
    if (arg === "--profile-warnings") {
      parsed.profileWarningsAsWarn = true;
      continue;
    }
    if (arg === "--fail-on-failure") {
      parsed.failOnFailure = true;
      continue;
    }
    if (arg === "--stop-on-failure") {
      parsed.stopOnFailure = true;
      parsed.failOnFailure = true;
      continue;
    }
    if ((arg === "--interval" || arg === "--interval-ms") && argv[index + 1]) {
      parsed.intervalMs = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }
    if (arg === "--iterations" && argv[index + 1]) {
      parsed.maxIterations = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }
    if ((arg === "--artifact-dir" || arg === "--output-dir") && argv[index + 1]) {
      parsed.artifactDir = resolve(REPO_ROOT, argv[index + 1]);
      index += 1;
      continue;
    }
  }

  if (!Number.isInteger(parsed.maxIterations) || parsed.maxIterations < 1) {
    parsed.maxIterations = Number.POSITIVE_INFINITY;
  }
  if (!Number.isInteger(parsed.intervalMs) || parsed.intervalMs < 1_000) {
    parsed.intervalMs = DEFAULT_INTERVAL_MS;
  }

  return parsed;
}

function printUsage(commandName) {
  process.stdout.write(`Usage:\n`);
  process.stdout.write(`  node ./scripts/${commandName}.mjs [once|watch|report]\n`);
  process.stdout.write("Core modes:\n");
  process.stdout.write("  once       run one heartbeat and write artifacts\n");
  process.stdout.write("  watch      run continuously; use --interval-ms and --iterations\n");
  process.stdout.write("  report     print latest heartbeat status card\n\n");
  process.stdout.write("Common flags:\n");
  process.stdout.write("  --json                 print machine-readable output\n");
  process.stdout.write("  --artifact-dir <path>   output directory for heartbeat artifacts\n");
  process.stdout.write("  --interval-ms <ms>      interval for watch mode\n");
  process.stdout.write("  --iterations <n>        hard stop after N runs in watch mode\n");
  process.stdout.write("  --include-preflight     add studio-brain preflight check (optional warning)\n");
  process.stdout.write("  --include-smoke         add optional portal + website smoke checks\n");
  process.stdout.write("  --fail-on-failure       exit with non-zero if final status is not pass\n");
  process.stdout.write("  --stop-on-failure       stop watch on first non-pass status and exit non-zero\n");
}

if (process.argv[1] === __filename) {
  runReliabilityHub().catch((error) => {
    process.stderr.write(`reliability-hub failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
