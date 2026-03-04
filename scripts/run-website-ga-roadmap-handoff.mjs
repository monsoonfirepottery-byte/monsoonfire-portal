#!/usr/bin/env node

/* eslint-disable no-console */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const strict = args.has("--strict");

const requiredArtifacts = [
  "artifacts/ga/reports/website-ga-data-package-check-latest.json",
  "artifacts/ga/reports/website-ga-acquisition-quality-latest.json",
  "artifacts/ga/reports/website-ga-funnel-friction-latest.json",
  "artifacts/ga/reports/website-ga-experiment-backlog-latest.json",
  "artifacts/ga/reports/website-ga-content-opportunities-latest.json",
  "artifacts/ga/reports/website-ga-weekly-dashboard-latest.json",
];

function runNode(argsList) {
  const result = spawnSync("node", argsList, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return {
    ok: result.status === 0,
    code: typeof result.status === "number" ? result.status : 1,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
  };
}

function readReadinessStatus() {
  const result = runNode(["./scripts/check-website-ga-roadmap-readiness.mjs", "--json"]);
  if (!result.ok) {
    return {
      ok: false,
      raw: null,
      reason: result.stderr || result.stdout || `exit ${result.code}`,
    };
  }
  try {
    const parsed = JSON.parse(result.stdout || "{}");
    return {
      ok: Boolean(parsed?.ok),
      raw: parsed,
      reason: "",
    };
  } catch (error) {
    return {
      ok: false,
      raw: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildChecklist(readiness) {
  const artifactChecks = requiredArtifacts.map((path) => ({
    id: `artifact:${path}`,
    ok: existsSync(resolve(repoRoot, path)),
    detail: path,
  }));
  const missingArtifacts = artifactChecks.filter((item) => !item.ok).map((item) => item.detail);
  const checks = [
    {
      id: "roadmap-readiness-contract",
      ok: readiness.ok,
      detail: readiness.ok ? "roadmap readiness checker passed" : `checker failed: ${readiness.reason}`,
    },
    ...artifactChecks,
  ];
  return { checks, missingArtifacts };
}

function main() {
  const readiness = readReadinessStatus();
  const { checks, missingArtifacts } = buildChecklist(readiness);
  const status = checks.every((check) => check.ok) ? "ready-for-owner-handoff" : "needs-owner-input";

  const result = {
    generatedAtUtc: new Date().toISOString(),
    status,
    checks,
    missingArtifacts,
    commands: [
      "npm run website:ga:data-package:check -- --strict",
      "npm run website:ga:baseline:report -- --strict",
      "npm run website:ga:funnel:report -- --strict",
      "npm run website:ga:experiments:backlog -- --strict",
      "npm run website:ga:content:opportunities -- --strict",
      "npm run website:ga:dashboard:weekly -- --strict",
      "npm run website:ga:roadmap:readiness -- --strict",
    ],
  };

  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`status=${status}\n`);
    for (const check of checks) {
      process.stdout.write(`${check.ok ? "PASS" : "FAIL"} ${check.id}: ${check.detail}\n`);
    }
  }

  if (strict && status !== "ready-for-owner-handoff") {
    process.exit(1);
  }
}

main();
