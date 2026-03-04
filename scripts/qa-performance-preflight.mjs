#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_RETRY_WAIT_SECONDS = 75;
const LOAD_JSON_PATH = resolve(repoRoot, "output", "qa", "portal-load-test-quick.json");
const LOAD_MD_PATH = resolve(repoRoot, "output", "qa", "portal-load-test-quick.md");
const PREFLIGHT_REPORT_PATH = resolve(repoRoot, "output", "qa", "performance-preflight.json");

function parseArgs(argv) {
  const options = {
    retryWaitSeconds: DEFAULT_RETRY_WAIT_SECONDS,
    asJson: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--retry-wait-seconds" && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0) {
        options.retryWaitSeconds = Math.min(600, Math.round(value));
      }
      i += 1;
      continue;
    }
    if (arg.startsWith("--retry-wait-seconds=")) {
      const value = Number(arg.slice("--retry-wait-seconds=".length));
      if (Number.isFinite(value) && value >= 0) {
        options.retryWaitSeconds = Math.min(600, Math.round(value));
      }
    }
  }
  return options;
}

function runCommand(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8" });
  const code = typeof result.status === "number" ? result.status : 1;
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  if (!allowFailure && code !== 0) {
    throw new Error(`Command failed (${code}): ${command} ${args.join(" ")}\n${stderr || stdout}`);
  }
  return { ok: code === 0, code, stdout, stderr };
}

async function sleep(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function flattenThresholdBreaches(report) {
  const scenarios = Array.isArray(report?.scenarios) ? report.scenarios : [];
  return scenarios.flatMap((scenario) =>
    Array.isArray(scenario?.thresholdBreaches)
      ? scenario.thresholdBreaches.map((entry) => ({
          scenario: String(scenario?.name || "unknown"),
          entry: String(entry || "").trim(),
        }))
      : []
  );
}

function looksLikeRateLimitSaturation(report) {
  if (!report || typeof report !== "object") return false;
  if (String(report.status || "") !== "fail") return false;

  const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
  if (scenarios.length === 0) return false;

  const totalNetworkErrors = scenarios.reduce((sum, item) => sum + Number(item?.networkErrors || 0), 0);
  const totalServerErrors = scenarios.reduce((sum, item) => sum + Number(item?.serverErrors || 0), 0);
  if (totalNetworkErrors > 0 || totalServerErrors > 0) return false;

  const totalRateLimited = scenarios.reduce((sum, item) => sum + Number(item?.rateLimitedCount || 0), 0);
  if (totalRateLimited <= 0) return false;

  const breaches = flattenThresholdBreaches(report).map((entry) => entry.entry.toLowerCase());
  if (breaches.length === 0) return false;

  return breaches.every((entry) =>
    entry.includes("expectedrate") ||
    entry.includes("ratelimitedrate") ||
    entry.includes("ratelimitedcount") ||
    entry.includes("p95")
  );
}

async function runLoadAttempt(attemptLabel) {
  const run = runCommand(
    process.execPath,
    [
      "./scripts/portal-load-test.mjs",
      "--profile",
      "quick",
      "--write",
      "--json",
      "--report-json",
      LOAD_JSON_PATH,
      "--report-markdown",
      LOAD_MD_PATH,
    ],
    { allowFailure: true }
  );

  let report = null;
  try {
    const parsed = JSON.parse(run.stdout || "{}");
    if (parsed && typeof parsed === "object" && parsed.scenarios) {
      report = parsed;
    }
  } catch {}

  if (!report) {
    try {
      const raw = await readFile(LOAD_JSON_PATH, "utf8");
      report = JSON.parse(raw);
    } catch {}
  }

  if (!report || typeof report !== "object") {
    throw new Error(`Could not parse load report for attempt "${attemptLabel}"`);
  }

  return {
    attempt: attemptLabel,
    commandOk: run.ok,
    report,
  };
}

function summarizeLoadAttempt(attempt) {
  const report = attempt.report || {};
  const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
  return {
    attempt: attempt.attempt,
    status: String(report.status || "unknown"),
    profile: String(report.profile || "unknown"),
    scenarioStatuses: scenarios.map((entry) => ({
      name: String(entry?.name || "unknown"),
      status: String(entry?.status || "unknown"),
      rateLimitedCount: Number(entry?.rateLimitedCount || 0),
      rateLimitedRate: Number(entry?.rateLimitedRate || 0),
      p95Ms: Number(entry?.latency?.p95Ms || 0) || null,
      thresholdBreaches: Array.isArray(entry?.thresholdBreaches) ? entry.thresholdBreaches : [],
    })),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = {
    status: "pass",
    generatedAtIso: new Date().toISOString(),
    retryWaitSeconds: options.retryWaitSeconds,
    steps: [],
    loadAttempts: [],
    notes: [],
    artifacts: {
      loadJson: LOAD_JSON_PATH,
      loadMarkdown: LOAD_MD_PATH,
      reportJson: PREFLIGHT_REPORT_PATH,
    },
  };

  const coldstart = runCommand("npm", ["run", "functions:profile:coldstart:strict"], { allowFailure: true });
  report.steps.push({
    name: "functions:profile:coldstart:strict",
    status: coldstart.ok ? "pass" : "fail",
    exitCode: coldstart.code,
  });
  if (!coldstart.ok) {
    report.status = "fail";
  }

  const firstAttempt = await runLoadAttempt("initial");
  report.loadAttempts.push(summarizeLoadAttempt(firstAttempt));

  const firstStatus = String(firstAttempt.report?.status || "unknown");
  if (firstStatus !== "pass") {
    if (looksLikeRateLimitSaturation(firstAttempt.report) && options.retryWaitSeconds > 0) {
      report.notes.push(
        `Initial quick load failure matched saturation signature; retrying once after ${options.retryWaitSeconds}s cooldown.`
      );
      await sleep(options.retryWaitSeconds * 1000);
      const retryAttempt = await runLoadAttempt("retry-after-cooldown");
      report.loadAttempts.push(summarizeLoadAttempt(retryAttempt));
      if (String(retryAttempt.report?.status || "unknown") !== "pass") {
        report.status = "fail";
      } else {
        report.notes.push("Retry attempt passed.");
      }
    } else {
      report.status = "fail";
    }
  }

  await mkdir(dirname(PREFLIGHT_REPORT_PATH), { recursive: true });
  await writeFile(PREFLIGHT_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${report.status}\n`);
    process.stdout.write(`report: ${PREFLIGHT_REPORT_PATH}\n`);
  }

  if (report.status !== "pass") {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`qa-performance-preflight failed: ${message}`);
  process.exit(1);
});
