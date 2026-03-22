import test from "node:test";
import assert from "node:assert/strict";

import {
  branchPrefixValid,
  parseGitStatus,
  parseWorktreeList,
  sanitizeBranchFragment,
} from "./codex-worktree-utils.mjs";

test("sanitizeBranchFragment yields codex-safe fragments", () => {
  assert.equal(sanitizeBranchFragment("Monsoon Fire Portal"), "monsoon-fire-portal");
  assert.equal(sanitizeBranchFragment(""), "session");
});

test("branchPrefixValid only accepts codex-prefixed branches", () => {
  assert.equal(branchPrefixValid("codex/session-monsoonfire"), true);
  assert.equal(branchPrefixValid("main"), false);
  assert.equal(branchPrefixValid("HEAD"), false);
});

test("parseWorktreeList reads porcelain output", () => {
  const rows = parseWorktreeList([
    "worktree C:/repo",
    "HEAD abc123",
    "branch refs/heads/main",
    "",
    "worktree C:/repo-clean",
    "HEAD def456",
    "branch refs/heads/codex/session-repo",
    "",
  ].join("\n"));
  assert.equal(rows.length, 2);
  assert.equal(rows[1].branch, "codex/session-repo");
});

test("parseGitStatus identifies dirty counts and detached heads", () => {
  const cleanStatus = parseGitStatus("## codex/session-repo\n");
  assert.equal(cleanStatus.branch, "codex/session-repo");
  assert.equal(cleanStatus.dirty, false);

  const dirtyStatus = parseGitStatus("## main\n M package.json\n?? temp.txt\n");
  assert.equal(dirtyStatus.branch, "main");
  assert.equal(dirtyStatus.dirtyCount, 2);
  assert.equal(dirtyStatus.dirty, true);
});
