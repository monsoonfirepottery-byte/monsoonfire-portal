import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function runNode(scriptPath, args) {
  return spawnSync("node", [scriptPath, "--json", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

function parseJson(text) {
  return JSON.parse(String(text || "").trim());
}

test("sim-runner fails when requested profile is missing", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "intent-sim-test-"));
  try {
    const planPath = join(tempDir, "plan.json");
    const artifactPath = join(tempDir, "sim-report.json");

    writeFileSync(
      planPath,
      JSON.stringify(
        {
          schema: "intent-plan.v1",
          planDigestSha256: "digest",
          intents: [{ intentId: "intent-a" }],
          tasks: [
            {
              taskId: "intent-a::task-1",
              intentId: "intent-a",
              dependsOn: [],
              checks: ['node -e "process.exit(0)"'],
            },
          ],
        },
        null,
        2
      )
    );

    const result = runNode("./scripts/sim-runner.mjs", [
      "--intent-id",
      "intent-a",
      "--plan",
      planPath,
      "--profile",
      "does-not-exist",
      "--artifact",
      artifactPath,
    ]);

    assert.equal(result.status, 1, "missing profile should fail");
    const payload = parseJson(result.stdout);
    assert.equal(payload.status, "fail");
    assert.match(JSON.stringify(payload.findings), /missing_profile/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("eval-runner passes when suite checks are satisfied", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "intent-eval-test-"));
  try {
    const runReportPath = join(tempDir, "run-report.json");
    const suitePath = join(tempDir, "suite.json");
    const artifactPath = join(tempDir, "eval-report.json");

    writeFileSync(
      runReportPath,
      JSON.stringify(
        {
          schema: "intent-run-report.v2",
          runId: "run-1",
          tasks: [
            {
              taskId: "intent-a::task-1",
              intentId: "intent-a",
              status: "succeeded",
              checks: [{ command: 'node -e \"process.exit(0)\"', ok: true, durationMs: 1 }],
            },
          ],
        },
        null,
        2
      )
    );

    writeFileSync(
      suitePath,
      JSON.stringify(
        {
          schema: "intent-eval-suite.v1",
          suiteId: "suite-1",
          intentId: "intent-a",
          cases: [
            {
              id: "check-passed",
              title: "Command succeeded",
              type: "check.succeeded",
              command: 'node -e \"process.exit(0)\"',
              weight: 1,
              required: true,
            },
          ],
        },
        null,
        2
      )
    );

    const result = runNode("./scripts/eval-runner.mjs", [
      "--intent-id",
      "intent-a",
      "--suite",
      suitePath,
      "--run-report",
      runReportPath,
      "--threshold",
      "0.9",
      "--artifact",
      artifactPath,
    ]);

    assert.equal(result.status, 0, result.stderr || "expected eval-runner to pass");
    const payload = parseJson(result.stdout);
    assert.equal(payload.status, "pass");
    assert.equal(payload.score, 1);
    const written = JSON.parse(readFileSync(artifactPath, "utf8"));
    assert.equal(written.status, "pass");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("eval-runner marks deferred when suite file is missing", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "intent-eval-test-"));
  try {
    const runReportPath = join(tempDir, "run-report.json");
    const artifactPath = join(tempDir, "eval-report.json");

    writeFileSync(
      runReportPath,
      JSON.stringify(
        {
          schema: "intent-run-report.v2",
          runId: "run-2",
          tasks: [],
        },
        null,
        2
      )
    );

    const result = runNode("./scripts/eval-runner.mjs", [
      "--intent-id",
      "intent-a",
      "--suite",
      join(tempDir, "missing-suite.json"),
      "--run-report",
      runReportPath,
      "--artifact",
      artifactPath,
    ]);

    assert.equal(result.status, 0, "missing suite should defer, not hard fail");
    const payload = parseJson(result.stdout);
    assert.equal(payload.status, "deferred_missing_eval");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
