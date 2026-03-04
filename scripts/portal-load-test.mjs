#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
const DEFAULT_PATH = "websiteKilnBoard";
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_PROFILE = "default";
const DEFAULT_REPORT_JSON = resolve(repoRoot, "output", "qa", "portal-load-test.json");
const DEFAULT_REPORT_MARKDOWN = resolve(repoRoot, "output", "qa", "portal-load-test.md");

const PROFILE_SCENARIOS = {
  quick: [
    {
      name: "baseline",
      requests: 20,
      concurrency: 2,
      expectedStatuses: [200],
      maxP95Ms: 3500,
      maxNetworkErrorRate: 0.02,
      maxServerErrorRate: 0.02,
      minExpectedRate: 0.9,
    },
    {
      name: "peak",
      requests: 40,
      concurrency: 6,
      expectedStatuses: [200, 429],
      maxP95Ms: 5000,
      maxNetworkErrorRate: 0.03,
      maxServerErrorRate: 0.03,
      minExpectedRate: 0.9,
    },
  ],
  default: [
    {
      name: "baseline",
      requests: 25,
      concurrency: 3,
      expectedStatuses: [200],
      maxP95Ms: 3500,
      maxNetworkErrorRate: 0.02,
      maxServerErrorRate: 0.02,
      minExpectedRate: 0.9,
    },
    {
      name: "peak",
      requests: 45,
      concurrency: 8,
      expectedStatuses: [200, 429],
      maxP95Ms: 6000,
      maxNetworkErrorRate: 0.03,
      maxServerErrorRate: 0.03,
      minExpectedRate: 0.9,
    },
    {
      name: "saturation-guard",
      requests: 70,
      concurrency: 12,
      expectedStatuses: [200, 429],
      maxP95Ms: 7000,
      maxNetworkErrorRate: 0.04,
      maxServerErrorRate: 0.04,
      minExpectedRate: 0.9,
      minRateLimitedCount: 1,
    },
  ],
  deep: [
    {
      name: "baseline",
      requests: 40,
      concurrency: 4,
      expectedStatuses: [200],
      maxP95Ms: 4000,
      maxNetworkErrorRate: 0.03,
      maxServerErrorRate: 0.03,
      minExpectedRate: 0.9,
    },
    {
      name: "peak",
      requests: 80,
      concurrency: 12,
      expectedStatuses: [200, 429],
      maxP95Ms: 7000,
      maxNetworkErrorRate: 0.04,
      maxServerErrorRate: 0.04,
      minExpectedRate: 0.9,
    },
    {
      name: "saturation-guard",
      requests: 120,
      concurrency: 18,
      expectedStatuses: [200, 429],
      maxP95Ms: 9000,
      maxNetworkErrorRate: 0.05,
      maxServerErrorRate: 0.05,
      minExpectedRate: 0.9,
      minRateLimitedCount: 1,
    },
  ],
  soak: [
    {
      name: "sustained",
      requests: 180,
      concurrency: 4,
      expectedStatuses: [200, 429],
      maxP95Ms: 4500,
      maxNetworkErrorRate: 0.03,
      maxServerErrorRate: 0.03,
      minExpectedRate: 0.95,
      maxRateLimitedRate: 0.35,
    },
    {
      name: "sustained-peak",
      requests: 120,
      concurrency: 6,
      expectedStatuses: [200, 429],
      maxP95Ms: 5500,
      maxNetworkErrorRate: 0.04,
      maxServerErrorRate: 0.04,
      minExpectedRate: 0.95,
      maxRateLimitedRate: 0.5,
    },
  ],
};

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  node ./scripts/portal-load-test.mjs [options]",
      "",
      "Options:",
      "  --base-url <url>            Cloud Functions base URL",
      "  --path <path>               Endpoint path (default: websiteKilnBoard)",
      "  --profile quick|default|deep|soak  Scenario profile (default: default)",
      "  --timeout-ms <n>            Per-request timeout in ms (default: 12000)",
      "  --strict                    Exit non-zero when scenario thresholds fail",
      "  --write                     Write report artifacts",
      "  --report-json <path>        JSON report path",
      "  --report-markdown <path>    Markdown report path",
      "  --json                      Print JSON report",
      "  --help                      Show help",
      "",
      "Env:",
      "  PORTAL_LOAD_BEARER_TOKEN      Optional bearer token for authenticated tests",
      "  PORTAL_LOAD_ADMIN_TOKEN       Optional x-admin-token header",
      "",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    path: DEFAULT_PATH,
    profile: DEFAULT_PROFILE,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    strict: false,
    writeArtifacts: false,
    reportJsonPath: DEFAULT_REPORT_JSON,
    reportMarkdownPath: DEFAULT_REPORT_MARKDOWN,
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--write") {
      options.writeArtifacts = true;
      continue;
    }
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }

    const next = argv[index + 1];
    if (!arg.startsWith("--")) continue;
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--base-url") {
      options.baseUrl = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--path") {
      options.path = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--profile") {
      options.profile = String(next).trim().toLowerCase();
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 100) {
        throw new Error(`Invalid --timeout-ms value: ${next}`);
      }
      options.timeoutMs = Math.round(value);
      index += 1;
      continue;
    }
    if (arg === "--report-json") {
      options.reportJsonPath = resolve(process.cwd(), String(next));
      index += 1;
      continue;
    }
    if (arg === "--report-markdown") {
      options.reportMarkdownPath = resolve(process.cwd(), String(next));
      index += 1;
      continue;
    }
  }

  if (!PROFILE_SCENARIOS[options.profile]) {
    throw new Error(`Unknown --profile '${options.profile}'. Use one of: ${Object.keys(PROFILE_SCENARIOS).join(", ")}`);
  }

  return options;
}

function normalizeBaseUrl(url) {
  const trimmed = String(url || "").trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_BASE_URL;
}

function normalizePath(pathValue) {
  return String(pathValue || DEFAULT_PATH).trim().replace(/^\/+/, "");
}

function pct(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  return Number((value * 100).toFixed(digits));
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .slice()
    .sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const rank = Math.max(0, Math.min(1, p)) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  const weight = rank - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

function buildRequestHeaders() {
  const headers = {
    Accept: "application/json",
  };
  const bearer = String(process.env.PORTAL_LOAD_BEARER_TOKEN || "").trim();
  if (bearer) {
    headers.Authorization = bearer.startsWith("Bearer ") ? bearer : `Bearer ${bearer}`;
  }
  const adminToken = String(process.env.PORTAL_LOAD_ADMIN_TOKEN || "").trim();
  if (adminToken) {
    headers["x-admin-token"] = adminToken;
  }
  return headers;
}

async function requestOnce({ url, timeoutMs, headers }) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    return {
      ok: true,
      status: response.status,
      durationMs: performance.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: null,
      durationMs: performance.now() - startedAt,
      errorMessage: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runScenario({ scenario, url, timeoutMs, headers }) {
  const results = [];
  let nextRequest = 0;
  const workers = [];
  const startedAtIso = new Date().toISOString();

  for (let index = 0; index < scenario.concurrency; index += 1) {
    workers.push(
      (async () => {
        while (true) {
          const requestIndex = nextRequest;
          nextRequest += 1;
          if (requestIndex >= scenario.requests) break;
          const result = await requestOnce({ url, timeoutMs, headers });
          results.push(result);
        }
      })()
    );
  }

  await Promise.all(workers);
  const completed = results.length;
  const latencySamples = results
    .map((entry) => entry.durationMs)
    .filter((value) => Number.isFinite(value));

  const statusCounts = {};
  let networkErrors = 0;
  let serverErrors = 0;
  for (const item of results) {
    if (!item.ok || item.status == null) {
      networkErrors += 1;
      continue;
    }
    const key = String(item.status);
    statusCounts[key] = (statusCounts[key] || 0) + 1;
    if (item.status >= 500) {
      serverErrors += 1;
    }
  }

  const expectedSet = new Set((scenario.expectedStatuses || []).map((value) => Number(value)));
  let expectedCount = 0;
  for (const [statusKey, count] of Object.entries(statusCounts)) {
    const status = Number(statusKey);
    if (expectedSet.has(status)) {
      expectedCount += Number(count || 0);
    }
  }

  const total = Math.max(1, scenario.requests);
  const expectedRate = expectedCount / total;
  const networkErrorRate = networkErrors / total;
  const serverErrorRate = serverErrors / total;
  const rateLimitedCount = Number(statusCounts["429"] || 0);
  const rateLimitedRate = rateLimitedCount / total;
  const p50Ms = percentile(latencySamples, 0.5);
  const p95Ms = percentile(latencySamples, 0.95);
  const p99Ms = percentile(latencySamples, 0.99);

  const thresholdBreaches = [];
  if (Number.isFinite(scenario.maxP95Ms) && Number.isFinite(p95Ms) && p95Ms > scenario.maxP95Ms) {
    thresholdBreaches.push(`p95 ${Math.round(p95Ms)}ms > ${scenario.maxP95Ms}ms`);
  }
  if (Number.isFinite(scenario.maxNetworkErrorRate) && networkErrorRate > scenario.maxNetworkErrorRate) {
    thresholdBreaches.push(
      `networkErrorRate ${pct(networkErrorRate)}% > ${pct(scenario.maxNetworkErrorRate)}%`
    );
  }
  if (Number.isFinite(scenario.maxServerErrorRate) && serverErrorRate > scenario.maxServerErrorRate) {
    thresholdBreaches.push(
      `serverErrorRate ${pct(serverErrorRate)}% > ${pct(scenario.maxServerErrorRate)}%`
    );
  }
  if (Number.isFinite(scenario.minExpectedRate) && expectedRate < scenario.minExpectedRate) {
    thresholdBreaches.push(
      `expectedRate ${pct(expectedRate)}% < ${pct(scenario.minExpectedRate)}%`
    );
  }
  if (Number.isFinite(scenario.minRateLimitedCount) && rateLimitedCount < scenario.minRateLimitedCount) {
    thresholdBreaches.push(
      `rateLimitedCount ${rateLimitedCount} < ${scenario.minRateLimitedCount}`
    );
  }
  if (Number.isFinite(scenario.maxRateLimitedRate) && rateLimitedRate > scenario.maxRateLimitedRate) {
    thresholdBreaches.push(
      `rateLimitedRate ${pct(rateLimitedRate)}% > ${pct(scenario.maxRateLimitedRate)}%`
    );
  }
  if (completed !== scenario.requests) {
    thresholdBreaches.push(`completed ${completed} != planned ${scenario.requests}`);
  }

  const status = thresholdBreaches.length === 0 ? "pass" : "fail";

  return {
    name: scenario.name,
    status,
    startedAtIso,
    requestsPlanned: scenario.requests,
    concurrency: scenario.concurrency,
    expectedStatuses: Array.from(expectedSet.values()).sort((left, right) => left - right),
    statusCounts,
    networkErrors,
    serverErrors,
    expectedRate,
    networkErrorRate,
    serverErrorRate,
    rateLimitedCount,
    rateLimitedRate,
    latency: {
      sampleCount: latencySamples.length,
      p50Ms,
      p95Ms,
      p99Ms,
    },
    thresholds: {
      maxP95Ms: scenario.maxP95Ms ?? null,
      maxNetworkErrorRate: scenario.maxNetworkErrorRate ?? null,
      maxServerErrorRate: scenario.maxServerErrorRate ?? null,
      minExpectedRate: scenario.minExpectedRate ?? null,
      minRateLimitedCount: scenario.minRateLimitedCount ?? null,
      maxRateLimitedRate: scenario.maxRateLimitedRate ?? null,
    },
    thresholdBreaches,
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Portal Load Test Report");
  lines.push("");
  lines.push(`- Generated at: ${report.generatedAtIso}`);
  lines.push(`- Profile: ${report.profile}`);
  lines.push(`- Target URL: ${report.target.url}`);
  lines.push(`- Overall status: ${report.status}`);
  lines.push("");

  lines.push("## Scenario Summary");
  lines.push("| Scenario | Status | Requests | Concurrency | p95 (ms) | Expected Rate | Network Error Rate | Server Error Rate | 429 Count | 429 Rate |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const scenario of report.scenarios) {
    lines.push(
      `| ${scenario.name} | ${scenario.status} | ${scenario.requestsPlanned} | ${scenario.concurrency} | ${
        scenario.latency.p95Ms == null ? "n/a" : Math.round(scenario.latency.p95Ms)
      } | ${pct(scenario.expectedRate) ?? "n/a"}% | ${pct(scenario.networkErrorRate) ?? "n/a"}% | ${
        pct(scenario.serverErrorRate) ?? "n/a"
      }% | ${scenario.rateLimitedCount} | ${pct(scenario.rateLimitedRate) ?? "n/a"}% |`
    );
  }
  lines.push("");

  lines.push("## Breaches");
  const breaches = report.scenarios.flatMap((scenario) =>
    scenario.thresholdBreaches.map((entry) => `${scenario.name}: ${entry}`)
  );
  if (breaches.length === 0) {
    lines.push("- None");
  } else {
    breaches.forEach((entry) => lines.push(`- ${entry}`));
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}

async function writeArtifacts(options, report, markdown) {
  await mkdir(dirname(options.reportJsonPath), { recursive: true });
  await mkdir(dirname(options.reportMarkdownPath), { recursive: true });
  await writeFile(options.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(options.reportMarkdownPath, markdown, "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const path = normalizePath(options.path);
  const url = `${baseUrl}/${path}`;
  const scenarios = PROFILE_SCENARIOS[options.profile];
  const headers = buildRequestHeaders();
  const generatedAtIso = new Date().toISOString();

  const scenarioReports = [];
  for (const scenario of scenarios) {
    const report = await runScenario({
      scenario,
      url,
      timeoutMs: options.timeoutMs,
      headers,
    });
    scenarioReports.push(report);
  }

  const status = scenarioReports.some((entry) => entry.status === "fail") ? "fail" : "pass";
  const report = {
    generatedAtIso,
    status,
    profile: options.profile,
    target: {
      baseUrl,
      path,
      url,
    },
    requestHeaders: {
      hasAuthorization: Boolean(headers.Authorization),
      hasAdminToken: Boolean(headers["x-admin-token"]),
    },
    scenarios: scenarioReports,
    artifacts: {
      json: relative(repoRoot, options.reportJsonPath),
      markdown: relative(repoRoot, options.reportMarkdownPath),
    },
  };

  const markdown = buildMarkdown(report);
  if (options.writeArtifacts) {
    await writeArtifacts(options, report, markdown);
  }

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      [
        `status: ${status}`,
        `profile: ${options.profile}`,
        `target: ${url}`,
        "",
      ].join("\n")
    );
  }

  if (options.strict && status !== "pass") {
    throw new Error("One or more load scenarios breached thresholds.");
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`portal-load-test failed: ${message}`);
  process.exit(1);
});
