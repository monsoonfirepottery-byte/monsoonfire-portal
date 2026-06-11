import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildReport, renderMarkdown } from "./next_slice_selector.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixturePath(name) {
  const dir = mkdtempSync(resolve(tmpdir(), "next-slice-selector-"));
  return resolve(dir, `${name}.json`);
}

function buildFromFixture(name, radar) {
  const path = fixturePath(name);
  writeJson(path, radar);
  return buildReport({
    refresh: false,
    radar: path,
    outputDir: resolve(REPO_ROOT, "output", "ops", "next-slice-selector")
  });
}

function baseRadar(overrides = {}) {
  return {
    schema: "studio-brain.ops.proactive-radar.v1",
    generatedAt: "2026-05-08T00:00:00.000Z",
    status: "watch",
    sources: { producerArtifactFreshness: [] },
    findings: [],
    recommendations: [],
    producerRefreshTasks: [],
    approvalFallbackTasks: [],
    ...overrides
  };
}

test("selector reports ok when no task evidence is present", () => {
  const report = buildFromFixture("ok", baseRadar());

  assert.equal(report.status, "ok");
  assert.equal(report.actionableTaskCount, 0);
  assert.equal(report.nextTask, null);
});

test("selector reports action_ready when a safe producer command is selected", () => {
  const report = buildFromFixture("action-ready", baseRadar({
    producerRefreshTasks: [{
      rank: 1,
      score: 42,
      title: "[ops] Refresh command-manifest evidence artifact",
      command: "npm run ops:command-manifest",
      commandSafetyClass: "read_only_local"
    }],
    nextProducerRefreshTask: {
      rank: 1,
      score: 42,
      title: "[ops] Refresh command-manifest evidence artifact",
      command: "npm run ops:command-manifest",
      commandSafetyClass: "read_only_local"
    }
  }));

  assert.equal(report.status, "action_ready");
  assert.equal(report.actionableTaskCount, 1);
  assert.equal(report.nextTask.command, "npm run ops:command-manifest");
});

test("selector reports manual_review for commandless planning-only work", () => {
  const report = buildFromFixture("manual-review", baseRadar({
    findings: [{
      id: "current-worktree-dirty",
      severity: "medium",
      title: "Current worktree has local changes",
      component: "Local repository",
      evidence: "1 changed path",
      impact: "Implementation from this checkout may mix unrelated changes.",
      safeNextStep: "Use a clean worktree from origin/main for ops slices.",
      rollback: "Leave the dirty checkout untouched."
    }],
    recommendations: [{
      title: "Enforce clean-worktree lanes for ops slices",
      type: "ops",
      priority: "P2",
      effort: "S",
      risk: "low",
      suggestedBranchName: "codex/ops-current-worktree-dirty",
      suggestedPrTitle: "[ops] Enforce clean-worktree lanes for ops slices",
      acceptanceCriteria: ["No destructive command is executed."]
    }]
  }));

  assert.equal(report.status, "manual_review");
  assert.equal(report.actionableTaskCount, 0);
  assert.equal(report.nextTask.commandSafetyClass, "manual-planning");
});

test("selector reports blocked_on_approval for approval-gated packet reviews", () => {
  const packetPath = fixturePath("pr-conflict-packet");
  writeJson(packetPath, {
    status: "action_needed",
    generatedAt: "2026-05-08T00:00:00.000Z",
    source: { generatedAt: "2026-05-08T00:00:00.000Z" },
    packets: [{ approvalRequired: true }]
  });

  const path = fixturePath("blocked-approval");
  writeJson(path, baseRadar({
    findings: [{
      id: "non-draft-prs-not-mergeable",
      severity: "high",
      title: "Non-draft PRs are not mergeable",
      component: "GitHub PR stack",
      evidence: "#492 DIRTY",
      impact: "Ready-looking PRs can remain blocked until release time.",
      safeNextStep: "Create conflict-resolution packets in clean worktrees.",
      rollback: "No mutation required."
    }],
    recommendations: [{
      title: "Create conflict-resolution packets for dirty PRs",
      type: "reliability",
      priority: "P1",
      effort: "M",
      risk: "low",
      suggestedBranchName: "codex/ops-non-draft-prs-not-mergeable",
      suggestedPrTitle: "[ops] Create conflict-resolution packets for dirty PRs",
      acceptanceCriteria: ["No destructive command is executed."]
    }]
  }));
  const report = buildReport({
    refresh: false,
    radar: path,
    outputDir: resolve(REPO_ROOT, "output", "ops", "next-slice-selector"),
    packetArtifactPaths: {
      "non-draft-prs-not-mergeable": packetPath
    }
  });

  assert.equal(report.status, "blocked_on_approval");
  assert.equal(report.actionableTaskCount, 0);
  assert.equal(report.approvalGates.length, 1);
});

test("selector reports blocked when radar input is missing", () => {
  const report = buildReport({
    refresh: false,
    radar: resolve(tmpdir(), "missing-next-slice-radar.json"),
    outputDir: resolve(REPO_ROOT, "output", "ops", "next-slice-selector")
  });

  assert.equal(report.status, "blocked");
  assert.match(report.safeNextStep, /proactive:radar/);
});

test("renderMarkdown includes selector status", () => {
  const markdown = renderMarkdown(buildFromFixture("markdown", baseRadar()));

  assert.match(markdown, /^# Studio Brain Next Slice Selector/m);
  assert.match(markdown, /- Status: ok/);
});
