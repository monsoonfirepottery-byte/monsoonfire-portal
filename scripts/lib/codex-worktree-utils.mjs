import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function clean(value) {
  return String(value ?? "").trim();
}

function isEnabled(value, defaultValue = true) {
  const raw = clean(value).toLowerCase();
  if (!raw) return defaultValue;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  return defaultValue;
}

export function branchPrefixValid(branch) {
  const normalized = clean(branch);
  if (!normalized || normalized === "HEAD") return false;
  return normalized.startsWith("codex/");
}

export function sanitizeBranchFragment(value) {
  const normalized = clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9/._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "session";
}

export function parseWorktreeList(raw) {
  const entries = [];
  let current = null;
  for (const line of String(raw || "").split(/\r?\n/)) {
    if (!line.trim()) {
      if (current?.path) entries.push(current);
      current = null;
      continue;
    }
    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ").trim();
    if (key === "worktree") {
      if (current?.path) entries.push(current);
      current = { path: value, branch: "", head: "", detached: false, bare: false, locked: false, prunable: false };
      continue;
    }
    if (!current) continue;
    if (key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
    if (key === "HEAD") current.head = value;
    if (key === "detached") current.detached = true;
    if (key === "bare") current.bare = true;
    if (key === "locked") current.locked = true;
    if (key === "prunable") current.prunable = true;
  }
  if (current?.path) entries.push(current);
  return entries;
}

export function parseGitStatus(raw) {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const branchLine = lines[0] || "";
  const detached = /^(##\s+HEAD\b|##\s+\(HEAD detached)/i.test(branchLine);
  const branchMatch = /^##\s+([^.\s]+)/.exec(branchLine);
  const branch = detached ? "HEAD" : clean(branchMatch?.[1]);
  const dirtyCount = Math.max(0, lines.length - 1);
  return {
    branch,
    detached,
    dirtyCount,
    dirty: dirtyCount > 0,
  };
}

function runGit(repoRoot, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(clean(result.stderr || result.stdout) || `git ${args.join(" ")} failed`);
  }
  return result;
}

export function resolveGitRoot(repoRoot) {
  const result = runGit(repoRoot, ["rev-parse", "--show-toplevel"]);
  return clean(result.stdout);
}

export function readRepoStatus(repoRoot) {
  const result = runGit(repoRoot, ["status", "--porcelain", "--branch"]);
  return parseGitStatus(result.stdout);
}

function listWorktrees(repoRoot) {
  const result = runGit(repoRoot, ["worktree", "list", "--porcelain"]);
  return parseWorktreeList(result.stdout);
}

function branchExists(repoRoot, branch) {
  const result = runGit(repoRoot, ["branch", "--list", branch], { allowFailure: true });
  return clean(result.stdout).length > 0;
}

function defaultWorktreeRoot(env = process.env) {
  return resolve(clean(env.CODEX_CLEAN_WORKTREE_ROOT) || resolve(homedir(), ".codex", "worktrees"));
}

function buildCandidateSpec(repoRoot, index = 0, env = process.env) {
  const repoName = sanitizeBranchFragment(basename(repoRoot));
  const root = defaultWorktreeRoot(env);
  const suffix = index > 0 ? `-${index}` : "";
  return {
    worktreeRoot: root,
    worktreePath: resolve(root, `${repoName}${suffix}`),
    branch: `codex/session-${repoName}${suffix}`,
  };
}

export function prepareCodexWorktree({
  repoRoot,
  env = process.env,
  useCurrentWorktree = false,
  requestedPath = "",
} = {}) {
  const gitRoot = resolveGitRoot(repoRoot);
  const repoStatus = readRepoStatus(gitRoot);
  if (useCurrentWorktree || !isEnabled(env.CODEX_SHELL_USE_CLEAN_WORKTREE, true)) {
    return {
      repoRoot: gitRoot,
      workspacePath: gitRoot,
      usingCleanWorktree: false,
      created: false,
      branch: repoStatus.branch,
      branchPrefixValid: branchPrefixValid(repoStatus.branch),
      repoStatus,
      workspaceStatus: repoStatus,
      launcherState: "current-worktree",
    };
  }

  const existingWorktrees = listWorktrees(gitRoot);
  mkdirSync(defaultWorktreeRoot(env), { recursive: true });

  const candidatePaths = [];
  if (clean(requestedPath)) {
    candidatePaths.push({
      worktreeRoot: defaultWorktreeRoot(env),
      worktreePath: resolve(clean(requestedPath)),
      branch: `codex/session-${sanitizeBranchFragment(basename(clean(requestedPath)))}`,
    });
  }
  for (let index = 0; index < 20; index += 1) {
    candidatePaths.push(buildCandidateSpec(gitRoot, index, env));
  }

  for (const candidate of candidatePaths) {
    const registered = existingWorktrees.find((entry) => resolve(entry.path) === resolve(candidate.worktreePath));
    if (registered && existsSync(candidate.worktreePath)) {
      const workspaceStatus = readRepoStatus(candidate.worktreePath);
      if (!workspaceStatus.dirty) {
        return {
          repoRoot: gitRoot,
          workspacePath: candidate.worktreePath,
          usingCleanWorktree: true,
          created: false,
          branch: registered.branch || workspaceStatus.branch,
          branchPrefixValid: branchPrefixValid(registered.branch || workspaceStatus.branch),
          repoStatus,
          workspaceStatus,
          launcherState: "reused-clean-worktree",
        };
      }
      continue;
    }

    if (!registered && existsSync(candidate.worktreePath)) {
      continue;
    }

    let branch = candidate.branch;
    if (branchExists(gitRoot, branch)) {
      continue;
    }

    const addResult = runGit(gitRoot, ["worktree", "add", "-b", branch, candidate.worktreePath, "HEAD"], {
      allowFailure: true,
    });
    if (addResult.status !== 0) {
      continue;
    }

    const workspaceStatus = readRepoStatus(candidate.worktreePath);
    return {
      repoRoot: gitRoot,
      workspacePath: candidate.worktreePath,
      usingCleanWorktree: true,
      created: true,
      branch,
      branchPrefixValid: branchPrefixValid(branch),
      repoStatus,
      workspaceStatus,
      launcherState: "created-clean-worktree",
    };
  }

  throw new Error("Unable to create or reuse a clean Codex worktree without overwriting an existing dirty workspace.");
}
