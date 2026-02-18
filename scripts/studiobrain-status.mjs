#!/usr/bin/env node
import { setTimeout as setAbortTimeout } from "node:timers";
import { validateEnvContract } from "../studio-brain/scripts/env-contract-validator.mjs";
import { runIntegrityCheck } from "./integrity-check.mjs";
import { resolveStudioBrainNetworkProfile } from "./studio-network-profile.mjs";

const args = new Set(process.argv.slice(2));
const outputJson = args.has("--json");
const failFast = args.has("--gate");

const network = resolveStudioBrainNetworkProfile();
const baseUrl = (() => {
  const rawBase = process.env.STUDIO_BRAIN_BASE_URL?.trim();
  if (rawBase) return rawBase.replace(/\/$/, "");
  return `${network.baseUrl.replace(/\/+$/, "")}`;
})();

const timeoutMs = Number(process.env.STUDIO_BRAIN_STATUS_TIMEOUT_MS || "5000");

const endpoints = [
  { name: "healthz", path: "/healthz" },
  { name: "dependencies", path: "/health/dependencies" },
  { name: "readyz", path: "/readyz" },
];

async function probe(url, label) {
  const controller = new AbortController();
  const timer = setAbortTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    clearTimeout(timer);
    return {
      name: label,
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      body: text.length > 0 ? text.slice(0, 200) : "",
    };
  } catch (error) {
    clearTimeout(timer);
    return {
      name: label,
      ok: false,
      status: 0,
      body: error?.message || String(error),
    };
  }
}

function assertStudioBrainIntegrity() {
  const report = runIntegrityCheck({ manifest: "studio-brain/.env.integrity.json", strict: false, verbose: false });
  if (!report.ok) {
    process.stderr.write("studio-brain status: integrity check failed.\n");
    if (report.issues?.length) {
      report.issues.forEach((issue) => {
        const suffix = issue.expected ? ` [expected=${issue.expected}, actual=${issue.actual}]` : "";
        process.stderr.write(`  - ${issue.file}: ${issue.message}${suffix}\n`);
      });
    }
    return false;
  }

  if (report.warnings?.length > 0) {
    process.stdout.write("studio-brain status: integrity warnings\n");
    report.warnings.forEach((warning) => process.stdout.write(`  - ${warning.file}: ${warning.message}\n`));
  }

  return true;
}

async function main() {
  const enforceContractStrict = failFast || process.env.STUDIO_BRAIN_STATUS_STRICT === "true";
  const contract = validateEnvContract({ strict: enforceContractStrict });
  const integrityOk = assertStudioBrainIntegrity();
  const checks = await Promise.all(endpoints.map((entry) => probe(`${baseUrl}${entry.path}`, entry.name)));

  const fail = !integrityOk || !contract.ok || checks.some((entry) => !entry.ok);
  const payload = {
    status: fail ? "fail" : "pass",
    timestamp: new Date().toISOString(),
    baseUrl,
    contract: {
      ok: contract.ok,
      errors: contract.errors,
      warnings: contract.warnings,
      checked: contract.checked,
    },
    checks: checks.map((entry) => ({ name: entry.name, ok: entry.ok, status: entry.status })),
  };

  if (outputJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`studio-brain status: ${payload.status.toUpperCase()}\n`);
    process.stdout.write(`  baseUrl: ${baseUrl}\n`);
    process.stdout.write(`  contractOk: ${contract.ok}\n`);
    if (contract.errors.length > 0) {
      process.stdout.write("  errors:\n");
      contract.errors.forEach((entry) => process.stdout.write(`    - ${entry}\n`));
    }
    process.stdout.write("  checks:\n");
    checks.forEach((entry) => {
      process.stdout.write(`    - ${entry.name}: ${entry.ok ? "PASS" : "FAIL"} (${entry.status})\n`);
    });
  }

  if (fail && failFast) process.exit(1);
}

void main().catch((error) => {
  process.stderr.write(`studio-brain status failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
