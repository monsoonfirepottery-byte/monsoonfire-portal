#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const mode = readArgValue(args, "--mode") || "fast";
const strict = args.includes("--strict");
const json = args.includes("--json");
const artifactArg = readArgValue(args, "--artifact");
const artifactPath = artifactArg
  ? resolve(ROOT, artifactArg)
  : resolve(ROOT, "output", "journey-tests", `${mode}.json`);

const hasAgentToken = Boolean(
  (process.env.MF_AGENT_TOKEN || process.env.MF_PAT || process.env.PAT || "").trim()
);
const reservationsPlaywrightEnabled = envEnabled("MF_RUN_RESERVATIONS_PLAYWRIGHT");
const reservationsPlaywrightRequired = envEnabled("MF_REQUIRE_RESERVATIONS_PLAYWRIGHT");
const hasReservationsJourneyCredentials = Boolean(
  (process.env.PORTAL_CLIENT_PASSWORD || process.env.PORTAL_STAFF_PASSWORD || "").trim()
);
const hasReservationsJourneyPlaywright =
  reservationsPlaywrightEnabled && hasReservationsJourneyCredentials;

const steps = buildSteps(mode);
const summary = {
  generatedAt: new Date().toISOString(),
  mode,
  strict,
  status: "pass",
  steps: [],
};

for (const step of steps) {
  if (step.optional && !step.when()) {
    summary.steps.push({
      name: step.name,
      command: `${step.command} ${step.args.join(" ")}`.trim(),
      required: false,
      optional: true,
      skipped: true,
      ok: true,
      reason: step.skipReason,
    });
    continue;
  }

  process.stdout.write(`\n== ${step.name} ==\n`);
  const result = spawnSync(step.command, step.args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "pipe",
    env: process.env,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const ok = (result.status ?? 1) === 0;
  const row = {
    name: step.name,
    command: `${step.command} ${step.args.join(" ")}`.trim(),
    required: step.required,
    optional: Boolean(step.optional),
    skipped: false,
    ok,
    exitCode: result.status ?? 1,
  };
  summary.steps.push(row);

  if (!ok) {
    summary.status = "fail";
    if (step.required || strict) {
      break;
    }
  }
}

mkdirSync(dirname(artifactPath), { recursive: true });
writeFileSync(artifactPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

if (json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  process.stdout.write(`\njourney suite (${mode}) => ${summary.status.toUpperCase()}\n`);
}

if (summary.status !== "pass" && strict) {
  process.exitCode = 1;
}

function buildSteps(currentMode) {
  const common = [
    {
      name: "functions build",
      command: "npm",
      args: ["--prefix", "functions", "run", "build"],
      required: true,
    },
    {
      name: "stripe negative contract tests",
      command: "node",
      args: ["--test", "functions/lib/stripeConfig.test.js"],
      required: true,
    },
    {
      name: "reservation journey contract tests (targeted)",
      command: "node",
      args: [
        "--test",
        "--test-name-pattern",
        "(reservations\\.create|reservations\\.update|reservations\\.list|dropoff|pickup|lifecycle|loadStatus)",
        "functions/lib/apiV1.test.js",
      ],
      required: true,
    },
    {
      name: "continueJourney contract consistency check",
      command: "node",
      args: ["./scripts/check-continue-journey-contract.mjs", "--strict", "--json"],
      required: true,
    },
    {
      name: "journey fixture contract check",
      command: "node",
      args: ["./scripts/check-journey-fixtures.mjs", "--strict", "--json"],
      required: true,
    },
  ];

  if (currentMode === "fast") {
    return common;
  }

  if (currentMode === "deep") {
    return [
      ...common,
      {
        name: "full functions tests",
        command: "npm",
        args: ["--prefix", "functions", "run", "test"],
        required: true,
      },
      {
        name: "web journey contract unit tests",
        command: "npm",
        args: [
          "--prefix",
          "web",
          "run",
          "test:run",
          "src/api/functionsClient.test.ts",
          "src/views/ReservationsView.test.ts",
        ],
        required: true,
      },
      {
        name: "portal reservations journey playwright",
        command: "npm",
        args: ["--prefix", "web", "run", "check:reservations-journey-playwright"],
        required: reservationsPlaywrightRequired,
        optional: !reservationsPlaywrightRequired,
        when: () => hasReservationsJourneyPlaywright,
        skipReason:
          "Set MF_RUN_RESERVATIONS_PLAYWRIGHT=1 with PORTAL_CLIENT_PASSWORD (or PORTAL_STAFF_PASSWORD) and a valid PORTAL_URL target",
      },
      {
        name: "agent commerce strict smoke",
        command: "npm",
        args: [
          "--prefix",
          "functions",
          "run",
          "agent:commerce:smoke",
          "--",
          "--strict",
          "--json",
          "--fixture",
          "scripts/fixtures/agent-commerce-smoke.base.json",
        ],
        required: false,
        optional: true,
        when: () => hasAgentToken,
        skipReason: "No MF_AGENT_TOKEN/MF_PAT/PAT provided",
      },
    ];
  }

  throw new Error(`Unknown mode "${currentMode}". Use --mode fast|deep`);
}

function readArgValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

function envEnabled(name) {
  const raw = (process.env[name] || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
