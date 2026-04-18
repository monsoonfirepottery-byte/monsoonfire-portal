#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseWorktreeList, readRepoStatus, resolveGitRoot } from "./lib/codex-worktree-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_ARTIFACT = "output/maintenance/ship-workflow-latest.json";
const DEFAULT_MERGE_METHOD = "squash";
const DEFAULT_CHECK_INTERVAL_SECONDS = "15";
const CLEANUP_CONFIRMATION = "CLEAN LOCAL ARTIFACTS";

const LANE_PRESETS = Object.freeze({
  none: null,
  portal: {
    id: "portal",
    label: "Portal Namecheap deploy",
    script: "deploy:namecheap:portal",
  },
  website: {
    id: "website",
    label: "Website Namecheap deploy",
    script: "deploy:namecheap:website",
  },
  studio: {
    id: "studio",
    label: "Studio Brain reconcile",
    script: "studio:ops:reconcile",
  },
});

function clean(value) {
  return String(value ?? "").trim();
}

function clip(value, max = 4000) {
  const normalized = String(value ?? "");
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}\n…`;
}

function quoteArg(value) {
  const normalized = String(value ?? "");
  if (!normalized) return '""';
  if (/[\s"]/u.test(normalized)) {
    return JSON.stringify(normalized);
  }
  return normalized;
}

function formatCommand(command, args = []) {
  return [command, ...args].map((entry) => quoteArg(entry)).join(" ");
}

function npmExecutable() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function ensureInsideRepo(targetPath) {
  const absolute = resolve(REPO_ROOT, targetPath);
  if (absolute === REPO_ROOT || absolute.startsWith(`${REPO_ROOT}\\`) || absolute.startsWith(`${REPO_ROOT}/`)) {
    return absolute;
  }
  throw new Error(`Refusing to write outside repository root: ${targetPath}`);
}

function printUsage() {
  const lines = [
    "Usage: node ./scripts/ship-workflow.mjs [options]",
    "",
    "Purpose:",
    "  Wrap the common PR merge + deploy + sync + cleanup tail-end into one safe command.",
    "",
    "Options:",
    "  --apply                 Execute the workflow. Default is preview/dry-run.",
    "  --lane <id>             Deploy preset: none, portal, website, studio.",
    "  --pr <number>           Pull request number. Defaults to the current branch PR.",
    "  --merge-method <id>     squash (default), merge, or rebase.",
    "  --skip-merge            Skip the PR ready/check/merge/delete flow.",
    "  --skip-deploy           Skip the deploy step even when a lane is set.",
    "  --skip-sync             Skip fetch/prune and safe default-branch sync.",
    "  --skip-cleanup          Skip local artifact cleanup.",
    "  --no-update-branch      Do not rebase/update a behind PR branch before waiting on checks.",
    "  --no-wait-checks        Do not wait for GitHub checks before merging.",
    "  --no-delete-branch      Leave the remote head branch in place after merge.",
    "  --artifact <path>       Write the JSON report to a custom repo-relative path.",
    "  --json                  Emit the report as JSON.",
    "  --help                  Show this help text.",
    "",
    "NPM-safe positional aliases:",
    "  apply, portal, website, studio, 474, pr=474, skip-cleanup, skip-sync, skip-merge",
    "  no-update-branch, no-wait-checks, no-delete-branch, merge-method=squash",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

export function parseArgs(argv) {
  const parsed = {
    apply: false,
    json: false,
    help: false,
    lane: "none",
    pr: "",
    mergeMethod: DEFAULT_MERGE_METHOD,
    merge: true,
    deploy: true,
    sync: true,
    cleanup: true,
    updateBranch: true,
    waitChecks: true,
    deleteBranch: true,
    artifact: DEFAULT_ARTIFACT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    const lowerArg = arg.toLowerCase();
    if (!arg) continue;

    if (arg === "--apply" || lowerArg === "apply") {
      parsed.apply = true;
      continue;
    }
    if (arg === "--json" || lowerArg === "json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h" || lowerArg === "help") {
      parsed.help = true;
      continue;
    }
    if (arg === "--skip-merge" || lowerArg === "skip-merge") {
      parsed.merge = false;
      continue;
    }
    if (arg === "--skip-deploy" || lowerArg === "skip-deploy") {
      parsed.deploy = false;
      continue;
    }
    if (arg === "--skip-sync" || lowerArg === "skip-sync") {
      parsed.sync = false;
      continue;
    }
    if (arg === "--skip-cleanup" || lowerArg === "skip-cleanup") {
      parsed.cleanup = false;
      continue;
    }
    if (arg === "--no-update-branch" || lowerArg === "no-update-branch") {
      parsed.updateBranch = false;
      continue;
    }
    if (arg === "--no-wait-checks" || lowerArg === "no-wait-checks") {
      parsed.waitChecks = false;
      continue;
    }
    if (arg === "--no-delete-branch" || lowerArg === "no-delete-branch") {
      parsed.deleteBranch = false;
      continue;
    }
    if (arg === "--lane" && argv[index + 1]) {
      parsed.lane = clean(argv[index + 1]).toLowerCase();
      index += 1;
      continue;
    }
    if (arg.startsWith("--lane=") || lowerArg.startsWith("lane=")) {
      parsed.lane = clean(arg.slice(arg.indexOf("=") + 1)).toLowerCase();
      continue;
    }
    if (arg === "--pr" && argv[index + 1]) {
      parsed.pr = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--pr=") || lowerArg.startsWith("pr=")) {
      parsed.pr = clean(arg.slice(arg.indexOf("=") + 1));
      continue;
    }
    if (arg === "--merge-method" && argv[index + 1]) {
      parsed.mergeMethod = clean(argv[index + 1]).toLowerCase();
      index += 1;
      continue;
    }
    if (arg.startsWith("--merge-method=") || lowerArg.startsWith("merge-method=")) {
      parsed.mergeMethod = clean(arg.slice(arg.indexOf("=") + 1)).toLowerCase();
      continue;
    }
    if (arg === "--artifact" && argv[index + 1]) {
      parsed.artifact = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=") || lowerArg.startsWith("artifact=")) {
      parsed.artifact = clean(arg.slice(arg.indexOf("=") + 1));
      continue;
    }
    if (!arg.startsWith("--")) {
      if (!parsed.pr && /^\d+$/u.test(arg)) {
        parsed.pr = arg;
        continue;
      }
      if (parsed.lane === "none" && Object.hasOwn(LANE_PRESETS, lowerArg)) {
        parsed.lane = lowerArg;
        continue;
      }
    }
  }

  if (!Object.hasOwn(LANE_PRESETS, parsed.lane)) {
    throw new Error(`Unsupported --lane value "${parsed.lane}". Use none, portal, website, or studio.`);
  }
  if (!["squash", "merge", "rebase"].includes(parsed.mergeMethod)) {
    throw new Error(`Unsupported --merge-method value "${parsed.mergeMethod}". Use squash, merge, or rebase.`);
  }
  if (parsed.lane === "none") {
    parsed.deploy = false;
  }
  return parsed;
}

export function resolveLanePreset(lane) {
  return LANE_PRESETS[clean(lane).toLowerCase()] || null;
}

export function chooseSyncTarget({ repoRoot, defaultBranch, currentStatus, worktrees, statusByPath }) {
  const root = resolve(repoRoot);
  const preferred = worktrees.find((entry) => {
    const target = resolve(entry.path);
    const status = statusByPath[target];
    return target !== root && clean(entry.branch) === clean(defaultBranch) && status && !status.dirty;
  });
  if (preferred) {
    return {
      status: "ready",
      mode: "separate-worktree",
      path: resolve(preferred.path),
      reason: `Using clean ${defaultBranch} worktree.`,
    };
  }

  if (clean(currentStatus?.branch) === clean(defaultBranch) && !currentStatus?.dirty) {
    return {
      status: "ready",
      mode: "current-worktree",
      path: root,
      reason: `Current worktree is already clean on ${defaultBranch}.`,
    };
  }

  const dirtyDefaultBranch = worktrees.find((entry) => {
    const target = resolve(entry.path);
    const status = statusByPath[target];
    return clean(entry.branch) === clean(defaultBranch) && status?.dirty;
  });
  if (dirtyDefaultBranch) {
    return {
      status: "blocked",
      mode: "none",
      path: resolve(dirtyDefaultBranch.path),
      reason: `Default-branch worktree is dirty at ${resolve(dirtyDefaultBranch.path)}.`,
    };
  }

  return {
    status: "blocked",
    mode: "none",
    path: "",
    reason: `No clean ${defaultBranch} worktree is available for sync/deploy.`,
  };
}

function runCommand(command, args, { cwd = REPO_ROOT, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  const exitCode = Number.isFinite(result.status) ? result.status : 1;
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const error = result.error instanceof Error ? result.error.message : "";
  if (!allowFailure && (result.error || exitCode !== 0)) {
    throw new Error(clean(stderr || stdout || error) || `${command} failed with exit code ${exitCode}`);
  }
  return { exitCode, stdout, stderr, error };
}

function readJsonCommand(command, args, options = {}) {
  const result = runCommand(command, args, options);
  const raw = clean(result.stdout);
  if (!raw) {
    throw new Error(`Expected JSON from ${formatCommand(command, args)} but stdout was empty.`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Expected JSON from ${formatCommand(command, args)} but received: ${clip(raw)} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

function listWorktrees(repoRoot) {
  const result = runCommand("git", ["-C", repoRoot, "worktree", "list", "--porcelain"]);
  return parseWorktreeList(result.stdout);
}

function encodeRefSegment(value) {
  return String(value ?? "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function createStep(id, label, command, args, cwd, notes = []) {
  return {
    id,
    label,
    command: formatCommand(command, args),
    cwd,
    notes: [...notes],
    status: "planned",
    exitCode: null,
    stdoutExcerpt: "",
    stderrExcerpt: "",
    reason: "",
  };
}

function appendStep(report, step) {
  report.steps.push(step);
  return step;
}

function markStepSkipped(step, reason) {
  step.status = "skipped";
  step.reason = clean(reason);
  return step;
}

function executeStep(step, { allowFailure = false } = {}) {
  step.startedAt = new Date().toISOString();
  const result = runCommand(step.commandExecutable, step.commandArgs, {
    cwd: step.cwd,
    allowFailure: true,
  });
  step.completedAt = new Date().toISOString();
  step.exitCode = result.exitCode;
  step.stdoutExcerpt = clip(result.stdout);
  step.stderrExcerpt = clip(result.stderr || result.error);
  step.status = result.exitCode === 0 ? "pass" : "fail";
  if (!allowFailure && step.status === "fail") {
    const message = clean(step.stderrExcerpt || step.stdoutExcerpt) || `${step.label} failed`;
    throw new Error(message);
  }
  return result;
}

function attachExecutable(step, command, args) {
  step.commandExecutable = command;
  step.commandArgs = [...args];
  return step;
}

function buildReport(options) {
  return {
    schema: "ship-workflow.v1",
    generatedAt: new Date().toISOString(),
    mode: options.apply ? "apply" : "preview",
    lane: options.lane,
    mergeMethod: options.mergeMethod,
    artifactPath: ensureInsideRepo(options.artifact),
    status: "pass",
    repo: {
      root: REPO_ROOT,
      currentBranch: "",
      currentWorktreeDirty: false,
      defaultBranch: "",
      syncTarget: null,
    },
    pr: null,
    steps: [],
  };
}

function writeReport(report) {
  mkdirSync(dirname(report.artifactPath), { recursive: true });
  writeFileSync(report.artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function renderReport(report) {
  const lines = [
    `Ship workflow (${report.mode})`,
    `  lane: ${report.lane}`,
    `  status: ${report.status}`,
  ];
  if (report.pr?.number) {
    lines.push(`  pr: #${report.pr.number} ${clean(report.pr.title)}`);
  }
  if (report.repo?.syncTarget?.reason) {
    lines.push(`  sync target: ${report.repo.syncTarget.reason}`);
  }
  lines.push(`  artifact: ${report.artifactPath}`);
  for (const step of report.steps) {
    const suffix = step.reason ? ` (${step.reason})` : "";
    lines.push(`  - ${step.id}: ${step.status}${suffix}`);
  }
  return lines.join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const report = buildReport(options);

  try {
    const repoRoot = resolveGitRoot(REPO_ROOT);
    const currentStatus = readRepoStatus(repoRoot);
    const repoMeta = readJsonCommand("gh", ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"], {
      cwd: repoRoot,
    });
    const defaultBranch = clean(repoMeta?.defaultBranchRef?.name || "main");
    const prFields = "number,title,url,isDraft,headRefName,mergedAt,mergeStateStatus,mergeable,state";
    const prArgs = options.pr
      ? ["pr", "view", options.pr, "--json", prFields]
      : ["pr", "view", "--json", prFields];
    const pr = options.merge ? readJsonCommand("gh", prArgs, { cwd: repoRoot }) : null;
    const worktrees = listWorktrees(repoRoot);
    const statusByPath = Object.fromEntries(
      worktrees.map((entry) => {
        const target = resolve(entry.path);
        return [target, readRepoStatus(target)];
      }),
    );
    const syncTarget = chooseSyncTarget({
      repoRoot,
      defaultBranch,
      currentStatus,
      worktrees,
      statusByPath,
    });

    report.repo.root = repoRoot;
    report.repo.currentBranch = currentStatus.branch;
    report.repo.currentWorktreeDirty = currentStatus.dirty;
    report.repo.defaultBranch = defaultBranch;
    report.repo.syncTarget = syncTarget;
    if (pr) {
      report.pr = {
        number: pr.number,
        title: pr.title,
        url: pr.url,
        isDraft: pr.isDraft,
        state: pr.state,
        headRefName: pr.headRefName,
        mergedAt: pr.mergedAt || null,
        mergeStateStatus: pr.mergeStateStatus || "",
        mergeable: pr.mergeable || "",
      };
    }

    if (options.apply && options.deploy && syncTarget.status !== "ready") {
      throw new Error(`Deploy lane "${options.lane}" needs a clean ${defaultBranch} worktree. ${syncTarget.reason}`);
    }

    const plannedSteps = [];

    if (options.merge) {
      plannedSteps.push(
        attachExecutable(
          createStep("gh-auth", "Verify GitHub CLI auth", "gh", ["auth", "status"], repoRoot),
          "gh",
          ["auth", "status"],
        ),
      );

      if (report.pr?.mergedAt) {
        plannedSteps.push(
          markStepSkipped(
            attachExecutable(
              createStep("merge-pr", "Merge pull request", "gh", ["api"], repoRoot),
              "gh",
              ["api"],
            ),
            `PR #${report.pr.number} is already merged.`,
          ),
        );
      } else {
        if (report.pr?.isDraft) {
          plannedSteps.push(
            attachExecutable(
              createStep("ready-pr", "Mark draft PR ready", "gh", ["pr", "ready", String(report.pr.number)], repoRoot),
              "gh",
              ["pr", "ready", String(report.pr.number)],
            ),
          );
        }

        if (options.updateBranch && clean(report.pr?.mergeStateStatus).toUpperCase() === "BEHIND") {
          plannedSteps.push(
            attachExecutable(
              createStep(
                "update-branch",
                "Rebase/update PR branch onto the base branch",
                "gh",
                ["pr", "update-branch", String(report.pr.number), "--rebase"],
                repoRoot,
              ),
              "gh",
              ["pr", "update-branch", String(report.pr.number), "--rebase"],
            ),
          );
        }

        if (options.waitChecks) {
          plannedSteps.push(
            attachExecutable(
              createStep(
                "wait-checks",
                "Wait for GitHub checks",
                "gh",
                ["pr", "checks", String(report.pr.number), "--watch", "--interval", DEFAULT_CHECK_INTERVAL_SECONDS],
                repoRoot,
              ),
              "gh",
              ["pr", "checks", String(report.pr.number), "--watch", "--interval", DEFAULT_CHECK_INTERVAL_SECONDS],
            ),
          );
        }

        plannedSteps.push(
          attachExecutable(
            createStep(
              "merge-pr",
              "Merge pull request remotely",
              "gh",
              [
                "api",
                "-X",
                "PUT",
                `repos/${repoMeta.nameWithOwner}/pulls/${report.pr.number}/merge`,
                "-f",
                `merge_method=${options.mergeMethod}`,
                "-f",
                `commit_title=${report.pr.title}`,
              ],
              repoRoot,
            ),
            "gh",
            [
              "api",
              "-X",
              "PUT",
              `repos/${repoMeta.nameWithOwner}/pulls/${report.pr.number}/merge`,
              "-f",
              `merge_method=${options.mergeMethod}`,
              "-f",
              `commit_title=${report.pr.title}`,
            ],
          ),
        );

        if (options.deleteBranch && clean(report.pr?.headRefName)) {
          plannedSteps.push(
            attachExecutable(
              createStep(
                "delete-remote-branch",
                "Delete remote head branch",
                "gh",
                [
                  "api",
                  "-X",
                  "DELETE",
                  `repos/${repoMeta.nameWithOwner}/git/refs/heads/${encodeRefSegment(report.pr.headRefName)}`,
                ],
                repoRoot,
              ),
              "gh",
              [
                "api",
                "-X",
                "DELETE",
                `repos/${repoMeta.nameWithOwner}/git/refs/heads/${encodeRefSegment(report.pr.headRefName)}`,
              ],
            ),
          );
        }
      }
    }

    if (options.sync) {
      plannedSteps.push(
        attachExecutable(
          createStep("fetch-prune", "Fetch origin and prune deleted refs", "git", ["fetch", "origin", "--prune"], repoRoot),
          "git",
          ["fetch", "origin", "--prune"],
        ),
      );

      if (syncTarget.status === "ready") {
        plannedSteps.push(
          attachExecutable(
            createStep(
              "sync-default-branch",
              `Fast-forward clean ${defaultBranch} worktree`,
              "git",
              ["-C", syncTarget.path, "pull", "--ff-only"],
              repoRoot,
            ),
            "git",
            ["-C", syncTarget.path, "pull", "--ff-only"],
          ),
        );
      } else {
        plannedSteps.push(
          markStepSkipped(
          attachExecutable(
            createStep(
              "sync-default-branch",
              `Fast-forward clean ${defaultBranch} worktree`,
              "git",
              ["pull", "--ff-only"],
              syncTarget.path || repoRoot,
            ),
            "git",
            ["pull", "--ff-only"],
          ),
          syncTarget.reason,
        ));
      }
    }

    if (options.deploy) {
      const preset = resolveLanePreset(options.lane);
      if (preset && syncTarget.status === "ready") {
        plannedSteps.push(
          attachExecutable(
            createStep(
              "deploy",
              preset.label,
              npmExecutable(),
              ["run", preset.script],
              syncTarget.path,
              [`Deploy runs from ${syncTarget.mode === "current-worktree" ? "the current" : "a separate"} clean ${defaultBranch} worktree.`],
            ),
            npmExecutable(),
            ["run", preset.script],
          ),
        );
      } else {
        plannedSteps.push(
          markStepSkipped(
            attachExecutable(
            createStep(
              "deploy",
              preset?.label || "Deploy requested lane",
              npmExecutable(),
              ["run", preset?.script || "deploy"],
              syncTarget.path || repoRoot,
            ),
            npmExecutable(),
            ["run", preset?.script || "deploy"],
          ),
          syncTarget.reason,
        ));
      }
    }

    if (options.cleanup) {
      plannedSteps.push(
        attachExecutable(
          createStep(
            "cleanup-artifacts",
            "Clean local artifacts",
            process.execPath,
            [
              resolve(repoRoot, "scripts", "cleanup-local-artifacts.mjs"),
              "--apply",
              "--confirm",
              CLEANUP_CONFIRMATION,
              "--json",
            ],
            repoRoot,
          ),
          process.execPath,
          [
            resolve(repoRoot, "scripts", "cleanup-local-artifacts.mjs"),
            "--apply",
            "--confirm",
            CLEANUP_CONFIRMATION,
            "--json",
          ],
        ),
      );
    }

    if (!options.apply) {
      for (const step of plannedSteps) {
        appendStep(report, step);
      }
    } else {
      for (const step of plannedSteps) {
        appendStep(report, step);
        if (step.status === "skipped") continue;
        if (step.id === "delete-remote-branch") {
          const result = executeStep(step, { allowFailure: true });
          if (result.exitCode !== 0) {
            const combined = clean(`${result.stderr}\n${result.stdout}`);
            if (/Reference does not exist|Not Found/i.test(combined)) {
              step.status = "skipped";
              step.reason = "Remote branch was already absent.";
            } else {
              throw new Error(combined || "Failed to delete the remote branch.");
            }
          }
          continue;
        }
        executeStep(step);
      }
    }
  } catch (error) {
    report.status = "fail";
    report.error = error instanceof Error ? error.message : String(error);
  }

  writeReport(report);
  if (report.status === "fail") {
    process.exitCode = 1;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderReport(report)}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
