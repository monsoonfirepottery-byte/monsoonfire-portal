#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PHASE_SMOKE_PROFILES = createPhaseProfiles();

const args = parseArgs(process.argv.slice(2));
const strict = args.strict;
const run = args.execute;
const artifactPath = resolve(ROOT, args.artifact || "output/phased-smoke-gate/latest.json");
const phases = args.phases.length > 0 ? args.phases : Object.keys(PHASE_SMOKE_PROFILES);

const report = {
  timestamp: new Date().toISOString(),
  strict,
  execute: run,
  phases,
  checks: [],
  phaseSummaries: {},
  summary: {
    status: "pass",
    pass: 0,
    warn: 0,
    error: 0,
  },
};

for (const phase of phases) {
  const profile = PHASE_SMOKE_PROFILES[phase];
  if (!profile) {
    addFinding("error", phase, "missing-profile", `Unknown phase "${phase}".`);
    report.phaseSummaries[phase] = buildPhaseSummary();
    continue;
  }

  report.phaseSummaries[phase] = buildPhaseSummary();
  const phaseChecks = profile.checks || [];
  for (const check of phaseChecks) {
    const exists = commandExists(check.command || "");
    const details = {
      category: check.category || deriveCategory(check.id),
      file: normalizePathHint(check.file || inferCommandFile(check.command)),
      line: Number.isFinite(check.line) && check.line > 0 ? check.line : 1,
    };

    if (!exists) {
      const status = check.severity || "error";
      const message = check.message || "missing precondition";
      addFinding(status, phase, check.id, message, check.command || check.file, {
        ...details,
        artifact: undefined,
      });
      report.phaseSummaries[phase].error += 1;
      continue;
    }

    if (!run) {
      const message = `Plan-only check: ${check.message}`;
      addFinding("pass", phase, check.id, message, check.command, details);
      report.phaseSummaries[phase].pass += 1;
      report.phaseSummaries[phase].checks += 1;
      continue;
    }

    const configuredCommand = buildCheckCommand(check, phase);
    const result = executeCommand(configuredCommand, check, phase);
    report.phaseSummaries[phase].checks += 1;
    if (result.ok) {
      const message = `${result.message} (${configuredCommand})`;
      addFinding("pass", phase, check.id, message, configuredCommand, {
        ...details,
        artifact: result.artifact,
        output: result.output,
      });
      report.phaseSummaries[phase].pass += 1;
    } else {
      const summary = `${result.message} (${configuredCommand})`;
      addFinding(
        parseNestedFailStatus(result, check),
        phase,
        check.id,
        summary,
        configuredCommand,
        {
          ...details,
          artifact: result.artifact,
          output: result.output,
        },
      );
      if (parseNestedFailStatus(result, check) === "error") {
        report.phaseSummaries[phase].error += 1;
      } else {
        report.phaseSummaries[phase].warn += 1;
      }
    }
  }
}

{
  const hasErrors = report.checks.some((entry) => entry.status === "error");
  if (hasErrors) {
    report.summary.status = "fail";
  }
}
if (report.checks.some((entry) => entry.status === "warning") && strict) {
  report.summary.status = "fail";
}

report.summary.pass = report.checks.filter((entry) => entry.status === "pass").length;
report.summary.error = report.checks.filter((entry) => entry.status === "error").length;
report.summary.warn = report.checks.filter((entry) => entry.status === "warning").length;

if (args.json) {
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const severityOrder = {
    pass: 0,
    warn: 1,
    error: 2,
  };
  report.checks.sort((a, b) => {
    if (severityOrder[a.status] !== severityOrder[b.status]) {
      return severityOrder[a.status] - severityOrder[b.status];
    }
    return `${a.phase}:${a.id}`.localeCompare(`${b.phase}:${b.id}`);
  });
  for (const item of report.checks) {
    const prefix =
      item.status === "pass" ? "[PASS]" : item.status === "warning" ? "[WARN]" : "[ERROR]";
    process.stdout.write(`${prefix} [${item.phase}] ${item.id}\n`);
    process.stdout.write(`  ${item.message}\n`);
    if (item.category) {
      process.stdout.write(`  category: ${item.category}\n`);
    }
    if (item.file) {
      const line = Number.isFinite(item.line) && item.line > 0 ? `:${item.line}` : "";
      process.stdout.write(`  source: ${item.file}${line}\n`);
    }
    if (item.artifact) {
      process.stdout.write(`  artifact: ${item.artifact}\n`);
    }
    if (item.target) {
      process.stdout.write(`  command: ${item.target}\n`);
    }
    if (item.status === "error" && item.output) {
      process.stdout.write(`  output: ${item.output.split("\n")[0]}\n`);
    }
  }
  process.stdout.write(`phased-smoke-gate: ${report.summary.status.toUpperCase()}\n`);
}

process.exit(report.summary.status === "pass" ? 0 : 1);

function addFinding(status, phase, id, message, target = "") {
  const normalized = status === "pass" ? "pass" : status === "error" ? "error" : "warning";
  const details = arguments.length > 5 && typeof arguments[5] === "object" ? arguments[5] : {};
  report.checks.push({
    phase,
    id,
    status: normalized,
    severity: normalized,
    message,
    target,
    category: details.category || "smoke-check",
    file: details.file || "",
    line: Number.isFinite(details.line) ? details.line : null,
    artifact: details.artifact,
    output: details.output,
  });
}

function executeCommand(command) {
  const result = spawnSync(command, {
    cwd: ROOT,
    encoding: "utf8",
    shell: true,
    stdio: "pipe",
    env: process.env,
  });
  const stdout = String(result.stdout || "").trim();
  const stderr = String(result.stderr || "").trim();
  const combined = `${stdout}\n${stderr}`.trim();
  const parsed = parseJsonOutput(stdout) || parseJsonOutput(stderr);
  const nestedStatus = parseStatusToken(parsed?.status);
  const nestedSeverity = deriveNestedSeverity(parsed);
  const artifact = typeof parsed?.artifact === "string" && parsed.artifact.length > 0 ? parsed.artifact : null;
  if (result.status === 0) {
    const statusMessage = nestedStatus ? `PASS (${nestedStatus})` : "PASS";
    return {
      ok: nestedSeverity !== "error" && nestedSeverity !== "warn",
      message: statusMessage,
      output: combined,
      nested: parsed,
      nestedStatus: nestedStatus || "pass",
      nestedSeverity: nestedSeverity || "pass",
      artifact,
    };
  }
  return {
    ok: false,
    message: `${command} failed with ${result.status}: ${stderr || stdout || "unknown failure"}`,
    output: combined,
    nested: parsed,
    nestedStatus: nestedStatus || "fail",
    nestedSeverity: nestedSeverity || "error",
    artifact,
  };
}

function parseStatusToken(value) {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "ok") {
    return "pass";
  }
  return normalized;
}

function deriveNestedSeverity(payload) {
  const primary = parseStatusToken(payload?.status || payload?.summary?.status);
  if (primary === "pass") {
    return "pass";
  }
  if (primary === "warning" || primary === "warn") {
    return "warn";
  }
  if (primary === "fail" || primary === "failed" || primary === "error") {
    return "error";
  }

  const checks = Array.isArray(payload?.checks) ? payload.checks : [];
  for (const item of checks) {
    const itemStatus = parseStatusToken(item?.status || item?.severity);
    if (itemStatus === "fail" || itemStatus === "failed" || itemStatus === "error") {
      return "error";
    }
    if (itemStatus === "warning" || itemStatus === "warn") {
      return "warn";
    }
  }

  if (Array.isArray(payload?.issues) && payload.issues.length > 0) {
    return "error";
  }
  if (Array.isArray(payload?.warnings) && payload.warnings.length > 0) {
    return "warn";
  }
  if (payload && Object.prototype.hasOwnProperty.call(payload, "ok")) {
    if (payload.ok === true) {
      return "pass";
    }
    if (payload.ok === false) {
      return "error";
    }
  }
  return "";
}

function parseArgs(argv) {
  const options = {
    strict: false,
    execute: false,
    json: false,
    phases: [],
    artifact: "output/phased-smoke-gate/latest.json",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--execute" || arg === "--run") {
      options.execute = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--artifact") {
      options.artifact = argv[index + 1] || options.artifact;
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      options.artifact = arg.substring("--artifact=".length);
      continue;
    }
    if (arg === "--phase") {
      options.phases = parsePhaseList(argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg.startsWith("--phase=")) {
      options.phases = parsePhaseList(arg.substring("--phase=".length));
      continue;
    }
  }
  return options;
}

function parsePhaseList(raw) {
  const parts = String(raw || "")
    .toLowerCase()
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const expanded = [];
  for (const part of parts) {
    if (part === "all") {
      expanded.push("staging", "beta-pilot", "production", "store-readiness");
      continue;
    }
    if (part === "store") {
      expanded.push("store-readiness");
      continue;
    }
    expanded.push(part);
  }
  return [...new Set(expanded)];
}

function commandExists(command) {
  if (typeof command !== "string" || command.trim() === "") {
    return false;
  }
  const trimmed = command.trim();
  if (!trimmed.startsWith("node ")) {
    if (trimmed.startsWith("npm run ")) {
      const scriptName = trimmed.replace(/^npm run /, "").split(/\s+/)[0];
      const pkg = readPackageJson();
      return Boolean(pkg?.scripts?.[scriptName]);
    }
    return true;
  }

  const scriptPath = trimmed.replace(/^node\s+/, "").split(/\s+/)[0];
  return existsSync(resolve(ROOT, scriptPath));
}

function parseJsonOutput(payload) {
  const text = String(payload || "").trim();
  if (!text) {
    return null;
  }

  const first = text.indexOf("{");
  if (first === -1) {
    return null;
  }

  const last = text.lastIndexOf("}");
  if (last < first) {
    return null;
  }

  try {
    return JSON.parse(text.slice(first, last + 1));
  } catch {
    return null;
  }
}

function buildPhaseSummary() {
  return {
    checks: 0,
    pass: 0,
    warn: 0,
    error: 0,
  };
}

function parseNestedFailStatus(result, check) {
  if (result?.nestedSeverity) {
    if (result.nestedSeverity === "error") {
      return "error";
    }
    if (result.nestedSeverity === "warn") {
      return check.severity || "warning";
    }
    if (result.nestedSeverity === "pass") {
      return "pass";
    }
  }

  if (result.ok) {
    return "pass";
  }
  return check.severity || "error";
}

function deriveCategory(id) {
  if (id.startsWith("staging-")) return "staging";
  if (id.startsWith("beta-")) return "beta-pilot";
  if (id.startsWith("production-")) return "production";
  if (id.startsWith("store-readiness-")) return "store-readiness";
  return "smoke-check";
}

function normalizePathHint(rawPath) {
  if (!rawPath) return "";
  return String(rawPath).replace(/^\.\//, "");
}

function inferCommandFile(command) {
  const match = /^\s*node\s+\S*\/([^/\s]+\.mjs)(?:\s|$)/.exec(command);
  if (!match) return "";
  return match[0].split(/\s+/)[1];
}

function buildCheckCommand(check, phase) {
  if (!check.artifact) return check.command;

  const artifactTemplate = resolveTemplate(check.artifact, phase, check.id);
  const normalized = resolve(ROOT, artifactTemplate);
  const artifactPath = normalizePathHint(normalized);

  if (check.command.includes("--artifact")) {
    return check.command;
  }
  if (check.command.startsWith("node ")) {
    return `${check.command} --artifact ${artifactPath}`;
  }
  if (check.command.startsWith("npm run ")) {
    return `${check.command} -- --artifact ${artifactPath}`;
  }
  return check.command;
}

function resolveTemplate(value, phase, checkId) {
  return String(value || "")
    .replace(/\{phase\}/gi, phase)
    .replace(/\{checkId\}/gi, checkId)
    .replace(/\$phase/g, phase)
    .trim();
}

function readPackageJson() {
  try {
    const raw = readFileSync(resolve(ROOT, "package.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function createPhaseProfiles() {
  return {
  staging: {
    checks: [
      {
        id: "staging-test-full",
        command: "npm run test:full",
        severity: "error",
        category: "automated-tests",
        commandExists: true,
        message: "Run full automation suite before proceeding to release branches.",
        file: "package.json",
        line: 37,
      },
      {
        id: "staging-contract-matrix",
        command: "node ./scripts/source-of-truth-contract-matrix.mjs --strict --json",
        severity: "error",
        category: "contract-gate",
        artifact: "output/phased-smoke-gate/staging/source-of-truth-contract-matrix.json",
        commandExists: true,
        file: "scripts/source-of-truth-contract-matrix.mjs",
        line: 1,
        message: "Run source-of-truth contract matrix before smoke.",
      },
      {
        id: "staging-emulator-contract",
        command: "node ./scripts/validate-emulator-contract.mjs --strict --json",
        severity: "error",
        category: "contract-gate",
        commandExists: true,
        file: "scripts/validate-emulator-contract.mjs",
        line: 1,
        message: "Validate emulator contract before PR and smoke handoff.",
      },
      {
        id: "staging-host-contract-scan",
        command: "node ./scripts/scan-studiobrain-host-contract.mjs --strict --json",
        severity: "warning",
        category: "host-contract",
        artifact: "output/phased-smoke-gate/staging/host-contract-scan.json",
        commandExists: true,
        file: "scripts/scan-studiobrain-host-contract.mjs",
        line: 1,
        message: "Run host-contract scan for loopback drift before release decisions.",
      },
      {
        id: "staging-network-contract",
        command: "node ./scripts/studiobrain-network-check.mjs --gate --strict --json",
        severity: "warning",
        category: "network-contract",
        artifact: "output/phased-smoke-gate/staging/network-check.json",
        commandExists: true,
        file: "scripts/studiobrain-network-check.mjs",
        line: 1,
        message: "Validate network profile contract and host drift for staging.",
      },
      {
        id: "staging-portal-smoke",
        command: "node ./scripts/portal-playwright-smoke.mjs --output-dir output/phased-smoke-gate/staging/portal",
        severity: "warning",
        category: "smoke",
        commandExists: true,
        file: "scripts/portal-playwright-smoke.mjs",
        line: 1,
        message: "Run local portal smoke path for quick smoke signal.",
      },
    ],
  },
  "beta-pilot": {
    checks: [
      {
        id: "beta-pilot-full-suite",
        command: "npm run test:full",
        severity: "error",
        category: "automated-tests",
        commandExists: true,
        file: "package.json",
        line: 37,
        message: "Beta pilot requires full suite.",
      },
      {
        id: "beta-pilot-phase-gate",
        command: "node ./scripts/source-of-truth-deployment-gates.mjs --phase beta-pilot --strict --json",
        severity: "error",
        category: "deployment-gate",
        artifact: "output/phased-smoke-gate/beta/source-of-truth-deployment-gates-beta.json",
        commandExists: true,
        file: "scripts/source-of-truth-deployment-gates.mjs",
        line: 1,
        message: "Validate beta-pilot deployment gate matrix before pilot.",
      },
      {
        id: "beta-pilot-portal-smoke",
        command: "node ./scripts/portal-playwright-smoke.mjs --output-dir output/phased-smoke-gate/beta/portal",
        severity: "warning",
        category: "smoke",
        commandExists: true,
        file: "scripts/portal-playwright-smoke.mjs",
        line: 1,
        message: "Run portal smoke for beta.",
      },
      {
        id: "beta-pilot-website-smoke",
        command: "node ./scripts/website-playwright-smoke.mjs --output-dir output/phased-smoke-gate/beta/website",
        severity: "warning",
        category: "smoke",
        commandExists: true,
        file: "scripts/website-playwright-smoke.mjs",
        line: 1,
        message: "Run website smoke for beta.",
      },
      {
        id: "beta-pilot-network-contract",
        command: "node ./scripts/studiobrain-network-check.mjs --gate --strict --json",
        severity: "warning",
        category: "network-contract",
        artifact: "output/phased-smoke-gate/beta/network-check.json",
        commandExists: true,
        file: "scripts/studiobrain-network-check.mjs",
        line: 1,
        message: "Validate network profile contract and host drift for beta rollout.",
      },
    ],
  },
  production: {
    checks: [
      {
        id: "production-deployment-gate",
        command: "node ./scripts/source-of-truth-deployment-gates.mjs --phase production --strict --json",
        severity: "error",
        category: "deployment-gate",
        artifact: "output/phased-smoke-gate/production/source-of-truth-deployment-gates-production.json",
        commandExists: true,
        file: "scripts/source-of-truth-deployment-gates.mjs",
        line: 1,
        message: "Validate production deployment gate matrix before production smoke.",
      },
      {
        id: "production-portal-smoke-command",
        command: "node ./scripts/portal-playwright-smoke.mjs --base-url https://monsoonfire-portal.web.app --output-dir output/playwright/prod-smoke",
        severity: "error",
        category: "smoke",
        commandExists: true,
        file: "scripts/portal-playwright-smoke.mjs",
        line: 1,
        artifact: "output/phased-smoke-gate/production/portal-smoke.json",
        message: "Run production portal smoke command surface.",
      },
      {
        id: "production-website-smoke-command",
        command: "node ./scripts/website-playwright-smoke.mjs --base-url https://monsoonfire.com --output-dir output/playwright/prod-smoke",
        severity: "error",
        category: "smoke",
        commandExists: true,
        file: "scripts/website-playwright-smoke.mjs",
        line: 1,
        artifact: "output/phased-smoke-gate/production/website-smoke.json",
        message: "Run production website smoke command surface.",
      },
      {
        id: "production-network-contract",
        command: "node ./scripts/studiobrain-network-check.mjs --gate --strict --json",
        severity: "warning",
        category: "network-contract",
        artifact: "output/phased-smoke-gate/production/network-check.json",
        commandExists: true,
        file: "scripts/studiobrain-network-check.mjs",
        line: 1,
        message: "Validate network contract and host drift for production readiness checks.",
      },
      {
        id: "production-bundle-check",
        command: "npm run check:studio-brain:bundle",
        severity: "warning",
        category: "bundle",
        commandExists: true,
        file: "scripts/check-studio-brain-bundle.mjs",
        line: 1,
        message: "Check production bundle for forbidden loopback artifacts.",
      },
    ],
  },
  "store-readiness": {
    checks: [
      {
        id: "store-readiness-deployment-gate",
        command: "node ./scripts/source-of-truth-deployment-gates.mjs --phase store-readiness --strict --json",
        severity: "error",
        category: "deployment-gate",
        artifact: "output/phased-smoke-gate/store-readiness/source-of-truth-deployment-gates-store.json",
        commandExists: true,
        file: "scripts/source-of-truth-deployment-gates.mjs",
        line: 1,
        message: "Validate store-readiness deployment gate matrix.",
      },
      {
        id: "store-readiness-well-known",
        command: "node ./scripts/validate-well-known.mjs --strict --json",
        severity: "error",
        category: "store-artifact",
        artifact: "output/phased-smoke-gate/store-readiness/well-known.json",
        commandExists: true,
        file: "scripts/validate-well-known.mjs",
        line: 1,
        message: "Validate production-like .well-known files for store submission.",
      },
      {
        id: "store-readiness-mobile",
        command: "node ./scripts/mobile-store-readiness-gate.mjs --strict --json",
        severity: "error",
        category: "store-artifact",
        artifact: "output/phased-smoke-gate/store-readiness/mobile-store-readiness.json",
        commandExists: true,
        file: "scripts/mobile-store-readiness-gate.mjs",
        line: 1,
        message: "Validate mobile readiness gate for app-link parity.",
      },
      {
        id: "store-readiness-network-contract",
        command: "node ./scripts/studiobrain-network-check.mjs --gate --strict --json",
        severity: "warning",
        category: "network-contract",
        artifact: "output/phased-smoke-gate/store-readiness/network-check.json",
        commandExists: true,
        file: "scripts/studiobrain-network-check.mjs",
        line: 1,
        message: "Validate network contract and host drift while evaluating store-readiness posture.",
      },
      {
        id: "store-readiness-deployment-gate-output",
        command: "node ./scripts/source-of-truth-deployment-gates.mjs --phase store-readiness --strict --json",
        severity: "warning",
        category: "deployment-gate",
        artifact: "output/phased-smoke-gate/store-readiness/source-of-truth-deployment-gates-store-output-check.json",
        commandExists: true,
        file: "scripts/source-of-truth-deployment-gates.mjs",
        line: 1,
        message: "Verify store-readiness deployment gate matrix also passes.",
      },
    ],
  },
  };
}
