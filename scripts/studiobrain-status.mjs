#!/usr/bin/env node
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout as setAbortTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

import { validateEnvContract } from "../studio-brain/scripts/env-contract-validator.mjs";
import { resolveStudioBrainNetworkProfile } from "./studio-network-profile.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const args = parseArgs(process.argv.slice(2));
const network = resolveStudioBrainNetworkProfile();
const baseUrl = resolveBaseUrl();
const timeoutMs = Number(process.env.STUDIO_BRAIN_STATUS_TIMEOUT_MS || "5000");
const enforceContractStrict = args.strict || process.env.STUDIO_BRAIN_STATUS_STRICT === "true";

const hostCheck = evaluateHostContractRisk(network);
const contractReport = validateEnvContract({ strict: enforceContractStrict });
const integrityReport = runIntegrityReport(enforceContractStrict);
const hostContractReport = args.skipHostScan ? null : runHostContractScan(enforceContractStrict);
const endpointResults = await probeEndpoints();
const evidence = args.skipEvidence ? [] : collectEvidence();
const snapshotReport = buildSnapshotReport(endpointResults);
const checks = buildChecks({
  network,
  contract: contractReport,
  integrityReport,
  hostContractReport,
  hostCheck,
  endpointResults,
  snapshotReport,
  evidence,
});
  const hardFailCount = checks.filter((entry) => entry.severity === "error" && !entry.ok).length;
  const warningCount = checks.filter((entry) => entry.severity === "warning" && !entry.ok).length;
  const status = hardFailCount > 0 || (args.strict && warningCount > 0) ? "fail" : warningCount > 0 ? "warn" : "pass";

const payload = {
  status,
  timestamp: new Date().toISOString(),
  profile: {
    requestedProfile: network.requestedProfile,
    profile: network.profile,
    strictness: network.strictness,
    host: network.host,
    hostMode: hostCheck.mode,
    baseUrl,
    baseHostAllowed: network.allowedStudioBrainHosts,
    hasLoopbackFallback: network.hasLoopbackFallback,
  },
  posture: {
    safeToRunHighRisk: status === "pass",
    blockers: checks.filter((entry) => entry.severity === "error" && !entry.ok),
    warnings: checks.filter((entry) => entry.severity === "warning" && !entry.ok),
    summary: {
      errors: hardFailCount,
      warnings: warningCount,
    },
    checks: checks.length,
  },
  contract: {
    ok: contractReport.ok,
    status: contractReport.status,
    checked: contractReport.checked,
    schema: contractReport.schema,
    errors: contractReport.errors,
    warnings: contractReport.warnings,
  },
  integrity: {
    ok: integrityReport.ok,
    status: integrityReport.status,
    manifestPath: integrityReport.manifestPath || "studio-brain/.env.integrity.json",
    issues: (integrityReport.issues || []).slice(0, 25),
    warnings: (integrityReport.warnings || []).slice(0, 25),
    checked: integrityReport.checked || 0,
  },
  hostContract: hostContractReport
    ? {
        ok: hostContractReport.ok,
        status: hostContractReport.status,
        summary: hostContractReport.summary || {},
        violations: (hostContractReport.violations || []).slice(0, 25),
        allowedMatches: (hostContractReport.allowedMatches || []).slice(0, 25),
      }
    : null,
  endpoints: endpointResults,
  snapshot: snapshotReport,
  evidence,
  checks: checks.map((entry) => ({
    name: entry.name,
    category: entry.category,
    severity: entry.severity,
    ok: entry.ok,
    status: entry.status,
    message: entry.message,
    details: entry.details,
  })),
};

if (args.json) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} else {
  printTextSummary(payload);
}

if (args.artifactPath) {
  writeArtifact(args.artifactPath, payload);
}

if ((args.gate && status === "fail") || (args.requireSafe && status !== "pass")) {
  process.exit(1);
}

function resolveBaseUrl() {
  const raw = process.env.STUDIO_BRAIN_BASE_URL?.trim();
  if (raw) return raw.replace(/\/+$/, "");
  return `${network.baseUrl.replace(/\/+$/, "")}`;
}

function parseArgs(rawArgs) {
  const parsed = {
    json: false,
    gate: false,
    requireSafe: false,
    strict: false,
    skipHostScan: false,
    skipEvidence: false,
    includeMetrics: false,
    artifactPath: "",
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--gate") {
      parsed.gate = true;
      continue;
    }

    if (arg === "--require-safe") {
      parsed.requireSafe = true;
      continue;
    }

    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }

    if (arg === "--no-host-scan") {
      parsed.skipHostScan = true;
      continue;
    }

    if (arg === "--no-evidence") {
      parsed.skipEvidence = true;
      continue;
    }

    if (arg === "--include-metrics") {
      parsed.includeMetrics = true;
      continue;
    }

    if (arg === "--artifact") {
      parsed.artifactPath = rawArgs[index + 1] || parsed.artifactPath;
      index += 1;
      continue;
    }

    if (arg.startsWith("--artifact=")) {
      parsed.artifactPath = arg.substring("--artifact=".length);
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      process.stdout.write("Usage: node ./scripts/studiobrain-status.mjs [flags]\n");
      process.stdout.write("  --json\n");
      process.stdout.write("  --gate\n");
      process.stdout.write("  --require-safe    require status === pass (includes warnings)\n");
      process.stdout.write("  --strict\n");
      process.stdout.write("  --include-metrics\n");
      process.stdout.write("  --no-host-scan\n");
      process.stdout.write("  --no-evidence\n");
      process.stdout.write("  --artifact [path]\n");
      process.exit(0);
    }
  }

  return parsed;
}

async function probeEndpoints() {
  const endpointPlan = [
    {
      name: "healthz",
      path: "/healthz",
      category: "liveness",
      expect: (payload) => payload?.ok === true,
    },
    {
      name: "dependencies",
      path: "/health/dependencies",
      category: "dependencies",
      expect: (payload) => {
        if (payload?.ok !== true) {
          return false;
        }
        const checks = Array.isArray(payload?.checks) ? payload.checks : [];
        return !checks.some((entry) => entry.status === "error" || entry.status === "degraded");
      },
    },
    {
      name: "readyz",
      path: "/readyz",
      category: "readiness",
      expect: (payload) => payload?.ok === true,
    },
    {
      name: "api-status",
      path: "/api/status",
      category: "runtime",
      expect: (payload) => payload?.ok === true,
      optional: false,
    },
    {
      name: "api-metrics",
      path: "/api/metrics",
      category: "metrics",
      expect: (payload) => payload?.ok === true,
      optional: args.includeMetrics,
    },
  ];

  const results = await Promise.all(
    endpointPlan.map(async (entry) => {
      const result = await probeEndpoint(entry);
      if (result.payload && entry.name === "api-status") {
        result.apiStatus = pick(result.payload, ["snapshot", "runtime", "jobRuns", "at"]);
      }
      if (result.payload && entry.name === "readyz") {
        result.readyCheck = pick(result.payload, ["checks", "at", "ok"]);
      }
      return result;
    }),
  );

  return results.filter((entry) => entry.skip !== true);
}

async function probeEndpoint(plan) {
  if (plan.optional === false && plan.name === "api-metrics") {
    return {
      name: plan.name,
      category: plan.category,
      status: "skip",
      ok: true,
      severity: "warning",
      message: "api-metrics not requested",
      latencyMs: 0,
      code: 0,
      body: "",
      payload: null,
    };
  }

  const endpointUrl = `${baseUrl}${plan.path}`;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setAbortTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpointUrl, { signal: controller.signal });
    const bodyText = await response.text();
    clearTimeout(timeout);
    const payload = parseJson(bodyText);
    const code = response.status;
    const protocolOk = code >= 200 && code < 400;
    const expectation = plan.expect ? plan.expect(payload) : true;
    const ok = protocolOk && expectation;
    return {
      name: plan.name,
      category: plan.category,
      ok,
      status: ok ? "pass" : "fail",
      severity: "error",
      message: ok ? "ok" : `unexpected payload at ${plan.name}`,
      code,
      latencyMs: Date.now() - startedAt,
      body: bodyText.length > 0 ? bodyText.slice(0, 200) : "",
      payload,
    };
  } catch (error) {
    clearTimeout(timeout);
    return {
      name: plan.name,
      category: plan.category,
      ok: false,
      status: "fail",
      severity: "error",
      message: error instanceof Error ? error.message : String(error),
      code: 0,
      latencyMs: Date.now() - startedAt,
      body: "",
      payload: null,
    };
  }
}

function runIntegrityReport(strict) {
  const script = resolve(REPO_ROOT, "scripts", "integrity-check.mjs");
  const command = [script, "--json"];
  if (strict) {
    command.push("--strict");
  }

  const result = runJsonCommand({
    command: [process.execPath, ...command],
    path: "integrity-check",
    timeoutMs: 30_000,
  });

  if (result.ok) {
    return result.payload;
  }

  return {
    ok: false,
    status: "fail",
    issues: [{ file: "integrity-check", kind: "command", message: result.message }],
    warnings: [],
    checked: 0,
    manifestPath: "studio-brain/.env.integrity.json",
    output: result.output,
  };
}

function runHostContractScan(strict) {
  const script = resolve(REPO_ROOT, "scripts", "scan-studiobrain-host-contract.mjs");
  const command = [script, "--json"];
  if (strict) {
    command.push("--strict");
  }
  const result = runJsonCommand({
    command: [process.execPath, ...command],
    path: "host-contract-scan",
    timeoutMs: 30_000,
  });

  if (!result.payload) {
    return {
      ok: false,
      status: "fail",
      summary: { status: "fail", errors: 0, warnings: 0 },
      violations: [],
      allowedMatches: [],
      output: result.output,
    };
  }

  const summary = result.payload.summary || {};
  const errors = Array.isArray(result.payload.violations)
    ? result.payload.violations.filter((entry) => entry.severity === "error").length
    : 0;
  const warnings = Array.isArray(result.payload.violations)
    ? result.payload.violations.filter((entry) => entry.severity === "warning").length
    : 0;

  const status = result.payload.summary?.status || (result.payload.failFast ? "fail" : "pass");
  return {
    ok: status === "pass",
    status: result.payload.summary?.status || (result.payload.failFast ? "fail" : "pass"),
    summary: {
      status,
      errors,
      warnings,
      scannedFiles: result.payload.scannedFiles || 0,
      scannedRoots: result.payload.scannedRoots || [],
    },
    violations: Array.isArray(result.payload.violations) ? result.payload.violations : [],
    allowedMatches: Array.isArray(result.payload.allowedMatches) ? result.payload.allowedMatches : [],
    output: result.payload,
  };
}

function runJsonCommand({ command, path: sourcePath, timeoutMs = 30_000 }) {
  const result = spawnSync(command[0], command.slice(1), {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
    stdio: "pipe",
    timeout: timeoutMs,
  });

  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (result.error) {
    return {
      ok: false,
      output,
      message: result.error.message,
      payload: null,
    };
  }

  const payload = parseJson(output);
  if (!payload) {
    return {
      ok: false,
      output,
      message: `${sourcePath} returned non-json output`,
      payload: null,
    };
  }

  return {
    ok: result.status === 0,
    output,
    payload,
    message: result.status === 0 ? "ok" : `non-zero exit: ${result.status}`,
  };
}

function buildChecks({
  network,
  contract,
  integrityReport,
  hostContractReport,
  hostCheck,
  endpointResults,
  snapshotReport,
  evidence,
}) {
  const checks = [];
  checks.push({
    name: "env contract",
    category: "contract",
    severity: "error",
    ok: Boolean(contract.ok),
    status: contract.ok ? "pass" : "fail",
    message: contract.ok ? "contract validation passed" : `contract failed with ${contract.errors.length} error(s)`,
    details: {
      checked: contract.checked,
      schema: contract.schema,
    },
  });

  checks.push({
    name: "env contract warnings",
    category: "contract",
    severity: "warning",
    ok: contract.warnings.length === 0,
    status: contract.warnings.length === 0 ? "pass" : "warn",
    message: contract.warnings.length === 0 ? "no warnings" : `${contract.warnings.length} warning(s)`,
    details: {
      warnings: contract.warnings,
    },
  });

  checks.push({
    name: "integrity manifest",
    category: "integrity",
    severity: "error",
    ok: Boolean(integrityReport.ok),
    status: integrityReport.ok ? "pass" : "fail",
    message: integrityReport.ok ? "integrity match" : `integrity check failed (${integrityReport.issues?.length || 0} issue(s))`,
    details: {
      issues: integrityReport.issues || [],
      warnings: integrityReport.warnings || [],
      checked: integrityReport.checked || 0,
      manifestPath: integrityReport.manifestPath || "studio-brain/.env.integrity.json",
    },
  });

  checks.push({
    name: "profile contract",
    category: "network",
    severity: hostCheck.ok ? "error" : "error",
    ok: hostCheck.ok,
    status: hostCheck.ok ? "pass" : "fail",
    message: hostCheck.ok ? "profile/routings appear aligned" : hostCheck.message,
    details: {
      requestedProfile: network.requestedProfile,
      activeProfile: network.profile,
      host: network.host,
      hasLoopbackFallback: network.hasLoopbackFallback,
      profileWarnings: network.warnings,
    },
  });

  if (hostContractReport) {
    const contractErrors = Number(hostContractReport.summary?.errors || 0);
    const contractWarnings = Number(hostContractReport.summary?.warnings || 0);
    checks.push({
      name: "host contract scan",
      category: "network",
      severity: "error",
      ok: hostContractReport.ok === true && contractErrors === 0,
      status:
        hostContractReport.ok === true && contractErrors === 0 && contractWarnings === 0
          ? "pass"
          : contractErrors > 0
            ? "fail"
            : contractWarnings > 0
              ? "warn"
              : "pass",
      message:
        contractErrors === 0 && contractWarnings === 0
          ? "host-contract scan clean"
          : contractErrors > 0
            ? `${contractErrors} hard violation(s)`
            : `${contractWarnings} warning(s)`,
      details: {
        summary: hostContractReport.summary,
      },
    });
  }

  for (const endpoint of endpointResults) {
    checks.push({
      name: endpoint.name,
      category: endpoint.category,
      severity: endpoint.severity || "error",
      ok: endpoint.ok,
      status: endpoint.status,
      message: endpoint.message,
      details: {
        latencyMs: endpoint.latencyMs,
        code: endpoint.code,
      },
    });
  }

  checks.push({
    name: "snapshot freshness",
    category: "snapshot",
    severity: "warning",
    ok: snapshotReport.ok,
    status: snapshotReport.ok ? "pass" : "warn",
    message: snapshotReport.message,
    details: snapshotReport.details,
  });

  const smokeState = summarizeSmokeState(evidence);
  checks.push({
    name: "smoke/heartbeat evidence",
    category: "evidence",
    severity: "warning",
    ok: smokeState.ok,
    status: smokeState.ok ? "pass" : "warn",
    message: smokeState.message,
    details: smokeState.details,
  });

  return checks;
}

function evaluateHostContractRisk(profile) {
  const networkProfile = String(profile.profile || "").toLowerCase();
  const isRemoteProfile = networkProfile === "lan-dhcp" || networkProfile === "lan-static";
  if (isRemoteProfile && profile.hasLoopbackFallback) {
    return {
      ok: false,
      mode: "remote-loopback-drift",
      message:
        `Resolved host "${profile.host}" still points to loopback while profile is "${networkProfile}".` +
        " Update STUDIO_BRAIN_NETWORK_PROFILE/STUDIO_BRAIN_HOST to a LAN-compatible host.",
    };
  }

  return {
    ok: true,
    mode: isRemoteProfile ? "remote-expected" : "local",
    message: "host contract risk check passed",
  };
}

function buildSnapshotReport(endpointResults) {
  const readyCheck = endpointResults.find((entry) => entry.name === "readyz")?.readyCheck;
  const statusCheck = endpointResults.find((entry) => entry.name === "api-status")?.apiStatus;

  const fromReady = readyCheck?.checks?.snapshot;
  const fromStatus = statusCheck?.snapshot;

  const generatedAt =
    fromReady?.generatedAt || fromStatus?.generatedAt || fromStatus?.snapshotDate || null;
  const ageMinutes = generatedAt ? Math.floor((Date.now() - Date.parse(generatedAt)) / 60000) : null;
  const maxAgeMinutes = typeof fromReady?.maxAgeMinutes === "number" ? fromReady.maxAgeMinutes : null;
  const requireFresh = Boolean(fromReady?.requireFresh);
  const freshnessOk = !fromReady || !requireFresh ? true : Boolean(fromReady.fresh);

  const isStale = requireFresh && maxAgeMinutes !== null && ageMinutes !== null && ageMinutes > maxAgeMinutes;
  const hasSnapshot = Boolean(fromReady?.exists || fromStatus);

  const warn = !hasSnapshot || (requireFresh && isStale) || !freshnessOk;
  return {
    ok: !warn,
    message: hasSnapshot
      ? freshnessOk
        ? "snapshot available and freshness gate satisfied"
        : "snapshot stale or missing required freshness metadata"
      : "snapshot unavailable from readiness/status endpoints",
    details: {
      hasSnapshot,
      generatedAt,
      ageMinutes,
      maxAgeMinutes,
      freshnessOk,
      readyRequireFresh: fromReady?.requireFresh,
      snapshotExistsReady: fromReady ? Boolean(fromReady.exists) : false,
      snapshotExistsStatus: Boolean(fromStatus),
      jobRuns: Array.isArray(statusCheck?.jobRuns) ? statusCheck.jobRuns.length : 0,
      runtimeKeys: statusCheck?.runtime && typeof statusCheck.runtime === "object" ? Object.keys(statusCheck.runtime).length : 0,
    },
  };
}

function collectEvidence() {
  const collected = [];
  const staticCandidates = [
    resolve(REPO_ROOT, "output", "stability", "heartbeat-summary.json"),
    resolve(REPO_ROOT, "output", "cutover-gate", "smoke-check.json"),
    resolve(REPO_ROOT, "output", "cutover-gate", "summary.json"),
    resolve(REPO_ROOT, "output", "playwright", "smoke-summary.json"),
    resolve(REPO_ROOT, "output", "playwright", "portal", "portal-smoke-summary.json"),
    resolve(REPO_ROOT, "output", "playwright", "prod-smoke-check", "smoke-summary.json"),
    resolve(REPO_ROOT, "output", "playwright", "prod-post-deploy", "smoke-summary.json"),
  ];

  for (const candidate of staticCandidates) {
    const payload = readJsonIfAvailable(candidate);
    if (!payload) continue;
    const status = computeArtifactStatus(payload);
    collected.push({
      path: candidate,
      artifact: guessArtifactName(candidate),
      status,
      timestamp: payload.startedAt || payload.createdAt || payload.timestamp || null,
      payload,
    });
  }

  const nestedCandidates = [
    resolve(REPO_ROOT, "output", "smoke"),
    resolve(REPO_ROOT, "output", "playwright"),
  ];

  for (const directory of nestedCandidates) {
    collectLatestFromDirectory(directory, "summary.json", 4).forEach((entry) => {
      collected.push(entry);
    });
  }

  return collected.sort((left, right) => {
    const leftTime = new Date(left.timestamp || 0).getTime();
    const rightTime = new Date(right.timestamp || 0).getTime();
    return rightTime - leftTime;
  });
}

function collectLatestFromDirectory(baseDir, filename, limit = 5) {
  if (!existsSync(baseDir)) {
    return [];
  }

  const directoryEntries = readdirSync(baseDir, { withFileTypes: true });
  const matches = [];
  for (const entry of directoryEntries) {
    const candidatePath = resolve(baseDir, entry.name);
    if (entry.isDirectory()) {
      const maybe = resolve(candidatePath, filename);
      const payload = readJsonIfAvailable(maybe);
      if (!payload) continue;
      const status = computeArtifactStatus(payload);
      matches.push({
        path: maybe,
        artifact: guessArtifactName(candidatePath),
        status,
        timestamp: payload.startedAt || payload.createdAt || payload.timestamp || null,
        payload,
      });
      continue;
    }
  }

  return matches
    .sort((left, right) => {
      const leftTime = Date.parse(left.timestamp || 0);
      const rightTime = Date.parse(right.timestamp || 0);
      return rightTime - leftTime;
    })
    .slice(0, limit);
}

function summarizeSmokeState(evidence) {
  const warnings = [];
  const failures = evidence.filter((entry) => {
    const status = String(entry.status || "").toLowerCase();
    return status === "fail" || status === "failed";
  });

  if (evidence.length === 0) {
    warnings.push("No stability/smoke/heartbeat artifacts found.");
  }
  for (const failure of failures) {
    warnings.push(`${failure.artifact} indicates ${failure.status} at ${failure.path}`);
  }

  return {
    ok: warnings.length === 0,
    message: warnings.length === 0 ? "evidence checks clear" : `${warnings.length} evidence warning(s)`,
    details: {
      count: evidence.length,
      failures: failures.length,
      latest: evidence[0] || null,
      warnings,
    },
  };
}

function computeArtifactStatus(payload) {
  const candidate = (payload?.status || payload?.state || "").toString().toLowerCase();
  if (candidate === "pass" || candidate === "passed" || candidate === "ok") return "pass";
  if (candidate === "warn" || candidate === "warning") return "warn";
  if (candidate === "fail" || candidate === "failed" || candidate === "error") return "fail";
  return "unknown";
}

function guessArtifactName(filePath) {
  if (!filePath) return "artifact";
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}

function pick(payload, keys) {
  if (!payload || typeof payload !== "object") return null;
  const out = {};
  for (const key of keys) {
    if (Object.hasOwn(payload, key)) {
      out[key] = payload[key];
    }
  }
  return out;
}

function parseJson(value) {
  if (!value || typeof value !== "string") return null;
  const direct = tryParseJson(value);
  if (direct) return direct;

  const normalized = value.trim();
  return (
    extractBalancedJson(normalized, "{", "}") ||
    extractBalancedJson(normalized, "[", "]")
  );
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractBalancedJson(input, open, close) {
  const start = input.indexOf(open);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === open) {
      depth += 1;
      continue;
    }

    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return tryParseJson(input.slice(start, index + 1));
      }
      if (depth < 0) {
        return null;
      }
    }
  }

  return null;
}

function readJsonIfAvailable(path) {
  if (!existsSync(path)) return null;
  try {
    const payload = parseJson(readFileSync(path, "utf8"));
    const stat = statSync(path);
    if (payload && typeof payload === "object") {
      return {
        ...payload,
        _artifactPath: path,
        _artifactUpdatedAt: stat.mtime.toISOString(),
      };
    }
    return payload;
  } catch {
    return null;
  }
}

function writeArtifact(artifactPath, payload) {
  const resolved = resolve(REPO_ROOT, artifactPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function printTextSummary(payload) {
  process.stdout.write(`studio-brain status: ${payload.status.toUpperCase()}\n`);
  process.stdout.write(`  profile: ${payload.profile.profile} (${payload.profile.requestedProfile})\n`);
  process.stdout.write(`  host: ${payload.profile.host}\n`);
  process.stdout.write(`  baseUrl: ${baseUrl}\n`);
  process.stdout.write(`  safe-to-run-high-risk: ${payload.posture.safeToRunHighRisk ? "yes" : "no"}\n`);
  process.stdout.write(`  contract: ${payload.contract.ok ? "pass" : "fail"} (${payload.contract.schema || "unknown"})\n`);
  if (payload.contract.errors.length > 0) {
    process.stdout.write("    errors:\n");
    payload.contract.errors.forEach((entry) => process.stdout.write(`      - ${entry}\n`));
  }
  if (payload.contract.warnings.length > 0) {
    process.stdout.write("    warnings:\n");
    payload.contract.warnings.forEach((entry) => process.stdout.write(`      - ${entry}\n`));
  }
  process.stdout.write(`  safe-to-run-high-risk: ${payload.posture.safeToRunHighRisk ? "yes" : "no"}\n`);

  if (payload.posture.blockers.length > 0) {
    process.stdout.write("  blockers:\n");
    for (const blocker of payload.posture.blockers) {
      process.stdout.write(`    - [${blocker.category}] ${blocker.name}: ${blocker.message}\n`);
    }
  }

  if (payload.posture.warnings.length > 0) {
    process.stdout.write("  warnings:\n");
    for (const warn of payload.posture.warnings) {
      process.stdout.write(`    - [${warn.category}] ${warn.name}: ${warn.message}\n`);
    }
  }

  process.stdout.write("  checks:\n");
  for (const entry of payload.checks) {
    const status = entry.status.toUpperCase().padEnd(6);
    process.stdout.write(`    - ${status} ${entry.category}:${entry.name}`);
    if (entry.message) {
      process.stdout.write(` :: ${entry.message}`);
    }
    process.stdout.write("\n");
  }

  if (payload.snapshot) {
    process.stdout.write("  snapshot:\n");
    process.stdout.write(`    - status: ${payload.snapshot.ok ? "ok" : "warn"}\n`);
    process.stdout.write(`    - generatedAt: ${payload.snapshot.details?.generatedAt || "n/a"}\n`);
    process.stdout.write(`    - ageMinutes: ${String(payload.snapshot.details?.ageMinutes ?? "n/a")}\n`);
  }

  if (payload.evidence.length > 0) {
    process.stdout.write("  evidence:\n");
    const latest = payload.evidence.slice(0, 5);
    for (const entry of latest) {
      process.stdout.write(`    - ${entry.artifact} :: ${entry.status} (${entry.path})\n`);
    }
  }

  process.stdout.write(`  endpoints: ${payload.endpoints.length} checked\n`);
}
