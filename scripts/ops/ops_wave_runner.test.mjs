import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildWavePlan, checkRegistryConsistency, runWave } from "./ops_wave_runner.mjs";

test("buildWavePlan keeps dependent ops steps ordered", () => {
  const plan = buildWavePlan({ steps: ["swarm-preflight", "host-drift-manifest", "work-packet", "artifact-validation"] });

  assert.deepEqual(plan.map((step) => step.id), ["swarm-preflight", "host-drift-manifest", "work-packet", "artifact-validation"]);
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

test("buildWavePlan only enables ephemeral validator runners when requested", () => {
  const defaultPlan = buildWavePlan({ steps: ["tooling-quality"] });
  const installPlan = buildWavePlan({ steps: ["tooling-quality"], allowToolInstall: true });

  assert.equal(defaultPlan[0].commandText.includes("--allow-install"), false);
  assert.equal(installPlan[0].commandText.includes("--allow-install"), true);
});

test("buildWavePlan lets callers widen the work-packet window", () => {
  const defaultPlan = buildWavePlan({ steps: ["work-packet"] });
  const widenedPlan = buildWavePlan({ steps: ["work-packet"], maxPackets: 12 });

  assert.match(defaultPlan[0].commandText, /--max-packets 3$/);
  assert.match(widenedPlan[0].commandText, /--max-packets 12$/);
});

test("buildWavePlan resumes from a named step and keeps downstream order", () => {
  const plan = buildWavePlan({ fromStep: "packet-outcome-report" });

  assert.deepEqual(plan.slice(0, 4).map((step) => step.id), [
    "packet-outcome-report",
    "artifact-validation-pre",
    "pr-readiness",
    "artifact-validation",
  ]);
  assert.equal(plan[0].order, 1);
});

test("buildWavePlan refreshes packet outcome report after work packets", () => {
  const plan = buildWavePlan();
  const workPacketIndex = plan.findIndex((step) => step.id === "work-packet");
  const outcomeIndex = plan.findIndex((step) => step.id === "packet-outcome-report");
  const validationIndex = plan.findIndex((step) => step.id === "artifact-validation-pre");

  assert.ok(workPacketIndex >= 0);
  assert.ok(outcomeIndex > workPacketIndex);
  assert.ok(validationIndex > outcomeIndex);
  assert.ok(plan[outcomeIndex].commandText.includes("packet_outcome_report.mjs"));
});

test("buildWavePlan exports tooling findings after tooling quality", () => {
  const plan = buildWavePlan();
  const qualityIndex = plan.findIndex((step) => step.id === "tooling-quality");
  const findingsIndex = plan.findIndex((step) => step.id === "tooling-findings");

  assert.ok(qualityIndex >= 0);
  assert.ok(findingsIndex > qualityIndex);
  assert.ok(plan[findingsIndex].commandText.includes("tooling_findings_export.mjs"));
});

test("buildWavePlan refreshes tool-install recommendations before work packets", () => {
  const plan = buildWavePlan();
  const inventoryIndex = plan.findIndex((step) => step.id === "tool-inventory");
  const recommendationIndex = plan.findIndex((step) => step.id === "tool-install-recommendations");
  const workPacketIndex = plan.findIndex((step) => step.id === "work-packet");

  assert.ok(inventoryIndex >= 0);
  assert.ok(recommendationIndex > inventoryIndex);
  assert.ok(workPacketIndex > recommendationIndex);
  assert.ok(plan[recommendationIndex].commandText.includes("tool_install_recommendations.mjs"));
});

test("buildWavePlan refreshes host drift manifest before work packets", () => {
  const plan = buildWavePlan();
  const hostDriftIndex = plan.findIndex((step) => step.id === "host-drift-manifest");
  const workPacketIndex = plan.findIndex((step) => step.id === "work-packet");

  assert.ok(hostDriftIndex >= 0);
  assert.ok(workPacketIndex > hostDriftIndex);
  assert.ok(plan[hostDriftIndex].commandText.includes("host_drift_manifest.mjs"));
});

test("checkRegistryConsistency verifies planned artifacts against the shared registry", () => {
  const plan = buildWavePlan();
  const consistency = checkRegistryConsistency(plan);

  assert.equal(consistency.status, "pass");
  assert.equal(consistency.restrictedPlan, false);
  assert.equal(consistency.unregisteredExpectedArtifacts.length, 0);
  assert.ok(consistency.externalRegistryArtifacts.some((entry) => entry.id === "pr-stack-audit"));
});

test("checkRegistryConsistency warns on unregistered planned artifacts", () => {
  const consistency = checkRegistryConsistency([
    { id: "unit", expectedArtifacts: ["output/ops/unit/unregistered-latest.json"] },
  ]);

  assert.equal(consistency.status, "warn");
  assert.deepEqual(consistency.unregisteredExpectedArtifacts, ["output/ops/unit/unregistered-latest.json"]);
});

test("checkRegistryConsistency treats from-step plans as intentionally restricted", () => {
  const plan = buildWavePlan({ fromStep: "packet-outcome-report" });
  const consistency = checkRegistryConsistency(plan, { fromStep: "packet-outcome-report" });

  assert.equal(consistency.restrictedPlan, true);
  assert.equal(consistency.managedRegistryArtifactsMissingFromPlan.length, 0);
});

test("runWave dry-run records skipped receipts without executing", () => {
  const manifest = runWave({ dryRun: true, runId: "unit-wave", steps: ["swarm-preflight", "host-drift-manifest", "work-packet"] }, () => {
    throw new Error("runner should not execute in dry-run mode");
  });

  assert.equal(manifest.status, "planned");
  assert.equal(manifest.dryRun, true);
  assert.equal(manifest.registryConsistency.status, "pass");
  assert.equal(manifest.registryConsistency.restrictedPlan, true);
  assert.deepEqual(manifest.receipts.map((receipt) => receipt.status), ["skipped", "skipped", "skipped"]);
});

test("dry-run write does not replace the latest executable wave artifact", () => {
  const dir = mkdtempSync(join(tmpdir(), "ops-wave-runner-"));
  try {
    const output = execFileSync(
      process.execPath,
      [
        resolve("scripts/ops/ops_wave_runner.mjs"),
        "--dry-run",
        "--json",
        "--write",
        "--output-dir",
        dir,
        "--steps",
        "swarm-preflight,host-drift-manifest,work-packet",
      ],
      { encoding: "utf8" },
    );
    const report = JSON.parse(output);

    assert.equal(report.status, "planned");
    assert.equal(report.artifacts.latestUpdated, false);
    assert.equal(report.artifacts.latestPath, "");
    assert.equal(existsSync(join(dir, "ops-wave-runner-latest.json")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runWave stops on failed step and keeps downstream artifacts untouched", () => {
  const manifest = runWave(
    { runId: "unit-wave", steps: ["swarm-preflight", "host-drift-manifest", "work-packet", "artifact-validation"] },
    (step) => ({
      code: step.id === "work-packet" ? 1 : 0,
      stdout: JSON.stringify({ status: step.id === "work-packet" ? "fail" : "pass" }),
      stderr: step.id === "work-packet" ? "packet failed" : "",
    }),
  );

  assert.equal(manifest.status, "fail");
  assert.deepEqual(manifest.receipts.map((receipt) => receipt.id), ["swarm-preflight", "host-drift-manifest", "work-packet"]);
  assert.equal(manifest.receipts[2].stderrPreview, "packet failed");
  assert.match(manifest.resumeCommand, /--from-step work-packet/);
  assert.match(manifest.nextRecommendedAction, /Resume with:/);
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
  assert.equal(manifest.resumeCommand, "");
});

test("runWave resume command preserves material runner options", () => {
  const manifest = runWave(
    {
      runId: "unit-wave",
      steps: ["tooling-quality", "work-packet"],
      skip: ["tool-inventory"],
      allowToolInstall: true,
      maxPackets: 8,
    },
    (step) => ({
      code: step.id === "work-packet" ? 1 : 0,
      stdout: JSON.stringify({ status: step.id === "work-packet" ? "fail" : "pass" }),
      stderr: "",
    }),
  );

  assert.match(manifest.resumeCommand, /--from-step work-packet/);
  assert.match(manifest.resumeCommand, /--steps "tooling-quality,work-packet"/);
  assert.match(manifest.resumeCommand, /--skip tool-inventory/);
  assert.match(manifest.resumeCommand, /--allow-tool-install/);
  assert.match(manifest.resumeCommand, /--max-packets 8/);
});
