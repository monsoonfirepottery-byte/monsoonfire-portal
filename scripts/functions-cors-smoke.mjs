#!/usr/bin/env node
/* eslint-disable no-console */

import { printValidationReport, validateEnvContract } from "../studio-brain/scripts/env-contract-validator.mjs";
import { runIntegrityCheck } from "./integrity-check.mjs";

const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
const DEFAULT_WEB_ORIGIN = "https://monsoonfire-portal.web.app";
const DEFAULT_TIMEOUT_MS = 12_000;

const ENDPOINTS = [
  "listIntegrationTokens",
  "listBillingSummary",
  "listEvents",
  "staffListAgentClients",
  "staffGetAgentServiceCatalog",
  "staffListAgentClientAuditLogs",
  "staffGetAgentOpsConfig",
  "listDelegations",
  "apiV1/v1/agent.requests.listStaff",
  "staffListAgentOperations",
  "listSecurityAuditEvents",
  "staffCreateAgentClient",
  "staffReviewAgentReservation",
  "listIntegrationTokens", // intentionally repeated legacy alias in some deploys
];

function parseArg(value, defaultValue) {
  return value && value.trim() ? value.trim() : defaultValue;
}

function parseArgs() {
  const baseUrl = parseArg(process.argv.find((item, idx) => idx > 0 && process.argv[idx - 1] === "--base-url"), DEFAULT_FUNCTIONS_BASE_URL);
  const origin = parseArg(process.argv.find((item, idx) => idx > 0 && process.argv[idx - 1] === "--origin"), DEFAULT_WEB_ORIGIN);
  return {
    baseUrl,
    origin,
  };
}

function assertStudioBrainIntegrity() {
  const report = runIntegrityCheck({ manifest: "studio-brain/.env.integrity.json", strict: false, verbose: false });
  if (!report.ok) {
    process.stderr.write("functions cors smoke: studio-brain integrity check failed before CORS smoke.\n");
    if (report.issues?.length) {
      report.issues.forEach((issue) => {
        const suffix = issue.expected ? ` [expected=${issue.expected}, actual=${issue.actual}]` : "";
        process.stderr.write(`  - ${issue.file}: ${issue.message}${suffix}\n`);
      });
    }
    throw new Error("Studio Brain integrity check failed before functions CORS smoke.");
  }

  if (report.warnings?.length > 0) {
    process.stdout.write("functions cors smoke: studio-brain integrity warnings\n");
    report.warnings.forEach((warning) => process.stdout.write(`  - ${warning.file}: ${warning.message}\n`));
  }
}

function normalizeBase(baseUrl) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_FUNCTIONS_BASE_URL;
}

function normalizeOrigin(origin) {
  return origin.trim() || DEFAULT_WEB_ORIGIN;
}

function normalizeEndpoint(endpoint) {
  return endpoint.replace(/^\/+/, "");
}

function assertStudioBrainContract() {
  const report = validateEnvContract({ strict: false });
  if (!report.ok) {
    printValidationReport(report);
    throw new Error("Studio Brain env contract validation failed before CORS smoke.");
  }
  if (report.warnings.length > 0) {
    process.stdout.write("functions cors smoke: studio-brain env warnings\n");
    report.warnings.forEach((warning) => process.stdout.write(`  - ${warning}\n`));
  }
}

function hasCorsAllowOrigin(headers, origin) {
  const allowOrigin = headers.get("access-control-allow-origin");
  if (!allowOrigin) return false;
  const normalizedOrigin = allowOrigin.trim();
  if (normalizedOrigin === "*") return true;
  return normalizedOrigin === origin;
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function probeEndpoint(baseUrl, origin, endpoint) {
  const normalizedBase = normalizeBase(baseUrl);
  const normalizedEndpoint = normalizeEndpoint(endpoint);
  const url = `${normalizedBase}/${normalizedEndpoint}`;
  const requestHeaders = {
    Origin: origin,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "Content-Type,Authorization,x-admin-token,x-studio-brain-admin-token",
  };

  const requestId = `${normalizedEndpoint}|${Date.now().toString(36)}`;
  const preflight = await fetchWithTimeout(url, {
    method: "OPTIONS",
    headers: requestHeaders,
  });
  if (preflight.status !== 204 && preflight.status !== 200) {
    return {
      endpoint: normalizedEndpoint,
      url,
      preflightStatus: preflight.status,
      failedStep: "preflight",
      passed: false,
      details: `Preflight failed with HTTP ${preflight.status}.`,
    };
  }
  if (!hasCorsAllowOrigin(preflight.headers, origin)) {
    const allowOrigin = preflight.headers.get("access-control-allow-origin") ?? "<missing>";
    return {
      endpoint: normalizedEndpoint,
      url,
      preflightStatus: preflight.status,
      failedStep: "preflight",
      passed: false,
      details: `Preflight returned unexpected Access-Control-Allow-Origin: ${allowOrigin}.`,
    };
  }

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "x-request-id": requestId,
    },
    body: JSON.stringify({}),
  });
  if (response.status === 404) {
    return {
      endpoint: normalizedEndpoint,
      url,
      preflightStatus: preflight.status,
      responseStatus: response.status,
      failedStep: "response",
      passed: false,
      details: "Function endpoint does not exist or is not deployed.",
    };
  }
  if (!hasCorsAllowOrigin(response.headers, origin)) {
    const allowOrigin = response.headers.get("access-control-allow-origin") ?? "<missing>";
    return {
      endpoint: normalizedEndpoint,
      url,
      preflightStatus: preflight.status,
      responseStatus: response.status,
      failedStep: "response",
      passed: false,
      details: `Actual response missing CORS header. Received Access-Control-Allow-Origin: ${allowOrigin}.`,
    };
  }

  return {
    endpoint: normalizedEndpoint,
    url,
    preflightStatus: preflight.status,
    responseStatus: response.status,
    failedStep: null,
    passed: true,
    details: `Preflight ${preflight.status}, response ${response.status}.`,
  };
}

function printSummary(results) {
  const passCount = results.filter((entry) => entry.passed).length;
  const failCount = results.length - passCount;
  console.log(`\nFunctions CORS smoke: ${passCount}/${results.length} endpoint probes passed.`);
  for (const entry of results) {
    if (entry.passed) {
      console.log(`✅ ${entry.endpoint} (${entry.responseStatus})`);
      continue;
    }
    const step = entry.failedStep || "preflight";
    console.log(`❌ ${entry.endpoint} (${step}: ${entry.responseStatus ?? entry.preflightStatus}) - ${entry.details}`);
  }
  if (failCount > 0) {
    throw new Error(`${failCount} function CORS probes failed.`);
  }
}

async function main() {
  assertStudioBrainIntegrity();
  assertStudioBrainContract();
  const { baseUrl, origin } = parseArgs();
  const normalizedBase = normalizeBase(baseUrl);
  const normalizedOrigin = normalizeOrigin(origin);

  console.log(`Checking Cloud Functions CORS gates against ${normalizedBase} for origin ${normalizedOrigin}`);
  const uniqueEndpoints = Array.from(new Set(ENDPOINTS));
  const results = [];

  for (const endpoint of uniqueEndpoints) {
    try {
      const result = await probeEndpoint(normalizedBase, normalizedOrigin, endpoint);
      results.push(result);
      if (!result.passed) {
        continue;
      }
      console.log(`✅ ${result.endpoint}`);
    } catch (error) {
      results.push({
        endpoint,
        url: `${normalizedBase}/${normalizeEndpoint(endpoint)}`,
        preflightStatus: 0,
        failedStep: "response",
        passed: false,
        details: `Unhandled probe error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  printSummary(results);
}

main().catch((error) => {
  console.error(`Functions CORS smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
