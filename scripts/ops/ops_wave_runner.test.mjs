import test from "node:test";
import assert from "node:assert/strict";

import { buildWavePlan, runWave } from "./ops_wave_runner.mjs";

test("buildWavePlan keeps dependent ops steps ordered", () => {
  const plan = buildWavePlan({ steps: ["swarm-preflight", "work-packet", "artifact-validation"] });

  assert.deepEqual(plan.map((step) => step.id), ["swarm-preflight", "work-packet", "artifact-validation"]);
  assert.equal(plan[0].order, 1);
  assert.ok(plan[0].commandText.includes("swarm_lane_preflight.mjs"));
});

test("buildWavePlan runs PR readiness between preflight validation and final validation", () => {
  const plan = buildWavePlan();
  const preArtifactIndex = plan.findIndex((step) => step.id === "artifact-validation-pre");
  const artifactIndex = plan.findIndex((step) => step.id === "artifact-validation");
  const readinessIndex = plan.findIndex((step) => step.id === "pr-readiness");

  assert.ok(preArtifactIndex >= 0);
  assert.ok(artifactIndex >= 0);
  assert.ok(readinessIndex > preArtifactIndex);
  assert.ok(artifactIndex > readinessIndex);
  assert.ok(plan[readinessIndex].commandText.includes("pr_readiness_packet.mjs"));
});

test("runWave dry-run records skipped receipts without executing", () => {
  const manifest = runWave({ dryRun: true, runId: "unit-wave", steps: ["swarm-preflight", "work-packet"] }, () => {
    throw new Error("runner should not execute in dry-run mode");
  });

  assert.equal(manifest.status, "planned");
  assert.equal(manifest.dryRun, true);
  assert.deepEqual(manifest.receipts.map((receipt) => receipt.status), ["skipped", "skipped"]);
});

test("runWave stops on failed step and keeps downstream artifacts untouched", () => {
  const manifest = runWave(
    { runId: "unit-wave", steps: ["swarm-preflight", "work-packet", "artifact-validation"] },
    (step) => ({
      code: step.id === "work-packet" ? 1 : 0,
      stdout: JSON.stringify({ status: step.id === "work-packet" ? "fail" : "pass" }),
      stderr: step.id === "work-packet" ? "packet failed" : "",
    }),
  );

  assert.equal(manifest.status, "fail");
  assert.deepEqual(manifest.receipts.map((receipt) => receipt.id), ["swarm-preflight", "work-packet"]);
  assert.equal(manifest.receipts[1].stderrPreview, "packet failed");
});

test("runWave reports warn when a read-only step warns", () => {
  const manifest = runWave(
    { runId: "unit-wave", steps: ["tooling-quality", "tool-inventory"] },
    (step) => ({
      code: 0,
      stdout: JSON.stringify({ status: step.id === "tooling-quality" ? "warn" : "pass" }),
      stderr: "",
    }),
  );

  assert.equal(manifest.status, "warn");
  assert.deepEqual(manifest.receipts.map((receipt) => receipt.status), ["warn", "pass"]);
});
