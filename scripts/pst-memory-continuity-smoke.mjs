#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function parseArgs(argv) {
  const options = {
    artifact: resolve(REPO_ROOT, "./output/memory/continuity/latest.json"),
    strict: false,
    asJson: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--artifact" && argv[index + 1]) {
      options.artifact = resolve(REPO_ROOT, argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      options.artifact = resolve(REPO_ROOT, arg.slice("--artifact=".length));
      continue;
    }
  }
  return options;
}

function parseArtifact(path) {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

function normalize(value) {
  return String(value || "").trim();
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const artifact = parseArtifact(options.artifact);

  const identityAnchors = Array.isArray(artifact?.identityAnchors) ? artifact.identityAnchors : [];
  const workstreams = Array.isArray(artifact?.activeWorkstreams) ? artifact.activeWorkstreams : [];
  const recentIntentTrajectory = Array.isArray(artifact?.recentIntentTrajectory)
    ? artifact.recentIntentTrajectory
    : [];
  const handoff = artifact?.activeHandoff && typeof artifact.activeHandoff === "object"
    ? artifact.activeHandoff
    : {};
  const resumeHints = Array.isArray(handoff.resumeHints) ? handoff.resumeHints : [];

  const checks = [
    {
      id: "identity",
      ok: identityAnchors.length > 0,
      detail: `identity anchors: ${identityAnchors.length}`,
    },
    {
      id: "workstream",
      ok: workstreams.length > 0,
      detail: `active workstreams: ${workstreams.length}`,
    },
    {
      id: "intent",
      ok: recentIntentTrajectory.length > 0,
      detail: `recent intent trajectory rows: ${recentIntentTrajectory.length}`,
    },
    {
      id: "handoff",
      ok: true,
      detail: `handoff owner: ${normalize(handoff.handoffOwner) || "n/a"}`,
    },
  ];

  const topWorkstream = normalize(workstreams[0]?.workstream) || "n/a";
  const latestIntent = normalize(recentIntentTrajectory[0]?.summary) || "n/a";
  const summary = {
    status: checks.every((check) => check.ok) ? "pass" : "warn",
    runId: normalize(artifact?.runId) || null,
    generatedAt: normalize(artifact?.generatedAt) || null,
    artifact: options.artifact,
    checks,
    resumeInProgress: {
      owner: normalize(handoff.handoffOwner) || null,
      sourceShell: normalize(handoff.handoffSourceShellId) || null,
      targetShell: normalize(handoff.handoffTargetShellId) || null,
      topWorkstream,
      latestIntent,
      resumeHints,
    },
  };

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write("pst-memory-continuity-smoke\n");
    process.stdout.write(`status: ${summary.status}\n`);
    for (const check of checks) {
      process.stdout.write(`- ${check.id}: ${check.ok ? "ok" : "missing"} (${check.detail})\n`);
    }
    process.stdout.write("resume in progress summary:\n");
    process.stdout.write(`- owner: ${summary.resumeInProgress.owner || "n/a"}\n`);
    process.stdout.write(`- source shell: ${summary.resumeInProgress.sourceShell || "n/a"}\n`);
    process.stdout.write(`- target shell: ${summary.resumeInProgress.targetShell || "n/a"}\n`);
    process.stdout.write(`- top workstream: ${summary.resumeInProgress.topWorkstream}\n`);
    process.stdout.write(`- latest intent: ${summary.resumeInProgress.latestIntent}\n`);
    process.stdout.write(
      `- resume hints: ${summary.resumeInProgress.resumeHints.length > 0 ? summary.resumeInProgress.resumeHints.join(", ") : "n/a"}\n`
    );
  }

  if (options.strict && !checks.every((check) => check.ok)) {
    process.exitCode = 1;
  }
}

try {
  run();
} catch (error) {
  process.stderr.write(
    `pst-memory-continuity-smoke failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}
