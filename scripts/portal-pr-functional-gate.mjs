#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  buildFirebaseCliInvocation,
  prependPathEntries,
  resolvePlatformCommand,
} from "./lib/command-runner.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_PROJECT_ID = "monsoonfire-portal";
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "portal-pr-functional-gate.json");

const RULE_TESTS = [
  "scripts/rules/myPieces.rules.test.mjs",
  "scripts/rules/notifications.rules.test.mjs",
  "scripts/rules/directMessages.rules.test.mjs",
  "scripts/rules/reservations.rules.test.mjs",
];

function parseArgs(argv) {
  const options = {
    projectId: process.env.PORTAL_PROJECT_ID || DEFAULT_PROJECT_ID,
    reportPath: process.env.PORTAL_PR_FUNCTIONAL_GATE_REPORT || DEFAULT_REPORT_PATH,
    feedbackPath: String(process.env.PORTAL_PR_FUNCTIONAL_FEEDBACK_PATH || "").trim(),
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--project") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --project");
      options.projectId = String(next).trim();
      index += 1;
      continue;
    }

    if (arg === "--report") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --report");
      options.reportPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }

    if (arg === "--feedback") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --feedback");
      options.feedbackPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
  }

  return options;
}

async function readJsonSafe(path) {
  if (!path) return null;
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function truncate(value, max = 16000) {
  if (typeof value !== "string") return "";
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n...[truncated ${value.length - max} chars]`;
}

function runStep(label, command, args, env = {}, remediation = "") {
  const startedAt = Date.now();
  const resolvedCommand = resolvePlatformCommand(command);
  const result = spawnSync(resolvedCommand, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf8",
  });

  const durationMs = Date.now() - startedAt;
  const exitCode = typeof result.status === "number" ? result.status : 1;
  const status = exitCode === 0 ? "passed" : "failed";

  return {
    label,
    status,
    exitCode,
    durationMs,
    remediation,
    command: [resolvedCommand, ...args].join(" "),
    stdout: truncate(result.stdout || ""),
    stderr: truncate(result.stderr || ""),
  };
}

function resolveJavaRuntime(remediation = "") {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, ["./scripts/ensure-java-runtime.mjs", "--json"], {
    cwd: repoRoot,
    env: {
      ...process.env,
    },
    encoding: "utf8",
  });

  const stdout = truncate(result.stdout || "");
  const stderr = truncate(result.stderr || "");
  let parsed = null;
  try {
    parsed = stdout ? JSON.parse(stdout) : null;
  } catch {
    parsed = null;
  }

  const ok = result.status === 0 && parsed?.status === "ok" && parsed?.javaHome && parsed?.javaBin;
  const javaHome = ok ? String(parsed.javaHome) : "";
  const javaBin = ok ? String(parsed.javaBin) : "";

  return {
    step: {
      label: "java runtime bootstrap",
      status: ok ? "passed" : "failed",
      exitCode: typeof result.status === "number" ? result.status : 1,
      durationMs: Date.now() - startedAt,
      remediation: remediation || "Ensure scripts/ensure-java-runtime.mjs can download/extract a Java runtime.",
      command: `${process.execPath} ./scripts/ensure-java-runtime.mjs --json`,
      stdout,
      stderr,
    },
    ok,
    javaHome,
    javaBin,
  };
}

function isMissingJavaRuntime(step) {
  const combined = `${String(step.stdout || "")}\n${String(step.stderr || "")}`.toLowerCase();
  return combined.includes("could not spawn `java -version`") || combined.includes("java is installed and on your system path");
}

function printHuman(summary) {
  process.stdout.write(`status: ${summary.status}\n`);
  process.stdout.write(`project: ${summary.projectId}\n`);
  summary.steps.forEach((step) => {
    process.stdout.write(`- ${step.label}: ${step.status} (${step.durationMs}ms, exit=${step.exitCode})\n`);
    if ((step.status === "failed" || step.status === "skipped") && step.remediation) {
      process.stdout.write(`  remediation: ${step.remediation}\n`);
    }
  });
  process.stdout.write(`report: ${summary.reportPath}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const feedbackProfile = await readJsonSafe(options.feedbackPath);
  const startedAtIso = new Date().toISOString();
  const stepRemediation =
    feedbackProfile?.feedback && typeof feedbackProfile.feedback.stepRemediation === "object"
      ? feedbackProfile.feedback.stepRemediation
      : {};

  const remediationFor = (label) => String(stepRemediation[label] || "").trim();

  const testCommand = `node --test ${RULE_TESTS.join(" ")}`;

  const steps = [];
  const javaRuntime = resolveJavaRuntime(remediationFor("java runtime bootstrap"));
  steps.push(javaRuntime.step);

  const javaEnv = javaRuntime.ok
    ? prependPathEntries([resolve(javaRuntime.javaHome, "bin")], {
        ...process.env,
        JAVA_HOME: javaRuntime.javaHome,
      })
    : {};
  const firebaseCli = buildFirebaseCliInvocation(repoRoot, { env: javaEnv });

  const firestoreSuiteStep = runStep("firestore emulator functional rules suite", firebaseCli.command, [
      ...firebaseCli.args,
      "emulators:exec",
      "--config",
      "firebase.emulators.local.json",
      "--project",
      options.projectId,
      "--only",
      "firestore",
      testCommand,
    ], javaEnv, remediationFor("firestore emulator functional rules suite"));

  if (firestoreSuiteStep.status === "failed" && isMissingJavaRuntime(firestoreSuiteStep)) {
    firestoreSuiteStep.status = "skipped";
    firestoreSuiteStep.exitCode = 0;
    firestoreSuiteStep.remediation =
      firestoreSuiteStep.remediation ||
      "Install a Java runtime on this runner (or use a runner image with Java) to execute Firestore emulator rules tests.";
  }

  steps.push(firestoreSuiteStep);

  steps.push(
    runStep("firestore index contract guard", "node", [
      "./scripts/firestore-index-contract-guard.mjs",
      "--json",
      "--strict",
      "--no-github",
      "--report",
      "output/qa/firestore-index-contract-guard-pr.json",
    ], {}, remediationFor("firestore index contract guard"))
  );

  steps.push(
    runStep(
      "functions build (continueJourney runtime precheck)",
      "npm",
      ["--prefix", "functions", "run", "build"],
      {},
      remediationFor("functions build (continueJourney runtime precheck)")
    )
  );

  steps.push(
    runStep(
      "continueJourney endpoint runtime checks",
      "node",
      ["--test", "functions/lib/continueJourneyEndpoint.test.js"],
      {},
      remediationFor("continueJourney endpoint runtime checks")
    )
  );

  const failedSteps = steps.filter((step) => step.status === "failed");
  const warningSteps = steps.filter((step) => step.status === "skipped");
  const status = failedSteps.length > 0 ? "failed" : "passed";
  const finishedAtIso = new Date().toISOString();

  const summary = {
    status,
    projectId: options.projectId,
    startedAtIso,
    finishedAtIso,
    reportPath: options.reportPath,
    feedback: {
      enabled: Boolean(options.feedbackPath),
      loaded: Boolean(feedbackProfile),
      profilePath: options.feedbackPath || "",
      priorityFailureSteps: Array.isArray(feedbackProfile?.feedback?.priorityFailureSteps)
        ? feedbackProfile.feedback.priorityFailureSteps
        : [],
    },
    checks: {
      seededFixtures: "Deterministic fixtures are seeded by each rules test before assertions.",
      requiredSuites: RULE_TESTS,
    },
    warnings: warningSteps.map((step) => `${step.label}: ${step.remediation || "step skipped"}`),
    steps,
  };

  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    printHuman(summary);
  }

  if (status !== "passed") {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`portal-pr-functional-gate failed: ${message}`);
  process.exit(1);
});
