import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { chooseSyncTarget, parseArgs, resolveLanePreset } from "./ship-workflow.mjs";

test("parseArgs defaults to preview mode with merge, sync, and cleanup enabled", () => {
  const parsed = parseArgs([]);
  assert.equal(parsed.apply, false);
  assert.equal(parsed.lane, "none");
  assert.equal(parsed.merge, true);
  assert.equal(parsed.sync, true);
  assert.equal(parsed.cleanup, true);
  assert.equal(parsed.deploy, false);
});

test("parseArgs accepts lane, apply, and skip flags", () => {
  const parsed = parseArgs(["--apply", "--lane", "portal", "--skip-cleanup", "--no-update-branch"]);
  assert.equal(parsed.apply, true);
  assert.equal(parsed.lane, "portal");
  assert.equal(parsed.deploy, true);
  assert.equal(parsed.cleanup, false);
  assert.equal(parsed.updateBranch, false);
});

test("parseArgs accepts npm-safe positional aliases", () => {
  const parsed = parseArgs(["apply", "portal", "474", "skip-cleanup", "skip-sync", "no-update-branch"]);
  assert.equal(parsed.apply, true);
  assert.equal(parsed.lane, "portal");
  assert.equal(parsed.pr, "474");
  assert.equal(parsed.deploy, true);
  assert.equal(parsed.cleanup, false);
  assert.equal(parsed.sync, false);
  assert.equal(parsed.updateBranch, false);
});

test("parseArgs accepts positional key=value aliases", () => {
  const parsed = parseArgs(["pr=474", "merge-method=merge", "artifact=output/custom-report.json"]);
  assert.equal(parsed.pr, "474");
  assert.equal(parsed.mergeMethod, "merge");
  assert.equal(parsed.artifact, "output/custom-report.json");
});

test("resolveLanePreset maps studio lane to reconcile script", () => {
  const preset = resolveLanePreset("studio");
  assert.equal(preset.script, "studio:ops:reconcile");
  assert.match(preset.label, /Studio Brain/i);
});

test("chooseSyncTarget prefers a separate clean default-branch worktree", () => {
  const repoRoot = resolve("D:/repo");
  const mainWorktree = resolve("D:/repo-main");
  const syncTarget = chooseSyncTarget({
    repoRoot,
    defaultBranch: "main",
    currentStatus: { branch: "codex/feature", dirty: true },
    worktrees: [
      { path: "D:/repo", branch: "codex/feature" },
      { path: "D:/repo-main", branch: "main" },
    ],
    statusByPath: {
      [repoRoot]: { branch: "codex/feature", dirty: true },
      [mainWorktree]: { branch: "main", dirty: false },
    },
  });

  assert.equal(syncTarget.status, "ready");
  assert.equal(syncTarget.mode, "separate-worktree");
  assert.equal(syncTarget.path, mainWorktree);
});

test("chooseSyncTarget blocks when the only default-branch worktree is dirty", () => {
  const mainWorktree = resolve("D:/repo-main");
  const syncTarget = chooseSyncTarget({
    repoRoot: "D:/repo",
    defaultBranch: "main",
    currentStatus: { branch: "codex/feature", dirty: false },
    worktrees: [{ path: "D:/repo-main", branch: "main" }],
    statusByPath: {
      [mainWorktree]: { branch: "main", dirty: true },
    },
  });

  assert.equal(syncTarget.status, "blocked");
  assert.match(syncTarget.reason, /dirty/i);
});
