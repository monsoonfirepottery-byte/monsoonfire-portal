#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

function parseArgs(argv) {
  const separator = argv.indexOf("--");
  const ownArgs = separator >= 0 ? argv.slice(0, separator) : argv;
  const command = separator >= 0 ? argv.slice(separator + 1) : [];
  const options = {
    json: false,
    artifact: "output/qa/repo-audit-branch-guard.json",
    allowStatusChange: false,
    allowHeadChange: false,
    allowBranchChange: false,
    untrackedFiles: "all",
    quietCommand: false,
    command,
  };

  for (let index = 0; index < ownArgs.length; index += 1) {
    const arg = String(ownArgs[index] || "");
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--allow-status-change") {
      options.allowStatusChange = true;
      continue;
    }
    if (arg === "--allow-head-change") {
      options.allowHeadChange = true;
      continue;
    }
    if (arg === "--allow-branch-change") {
      options.allowBranchChange = true;
      continue;
    }
    if (arg === "--ignore-untracked") {
      options.untrackedFiles = "no";
      continue;
    }
    if (arg === "--quiet-command") {
      options.quietCommand = true;
      continue;
    }
    if (arg === "--untracked-files" && ownArgs[index + 1]) {
      options.untrackedFiles = normalizeUntrackedFiles(ownArgs[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--untracked-files=")) {
      options.untrackedFiles = normalizeUntrackedFiles(arg.slice("--untracked-files=".length));
      continue;
    }
    if (arg === "--artifact" && ownArgs[index + 1]) {
      options.artifact = String(ownArgs[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      options.artifact = arg.slice("--artifact=".length);
      continue;
    }
  }

  return options;
}

function normalizeUntrackedFiles(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["all", "normal", "no"].includes(normalized) ? normalized : "all";
}

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  };
}

function captureGitState(label, options) {
  const branch = runGit(["branch", "--show-current"]);
  const head = runGit(["rev-parse", "HEAD"]);
  const status = runGit(["status", "--short", "--branch", `--untracked-files=${options.untrackedFiles}`]);
  return {
    label,
    branch: branch.stdout,
    head: head.stdout,
    statusShortBranch: status.stdout,
    gitOk: branch.ok && head.ok && status.ok,
    errors: [branch, head, status].filter((entry) => !entry.ok).map((entry) => entry.stderr),
  };
}

function commandDisplay(command) {
  return command.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

function spawnTarget(command) {
  const [program, ...args] = command;
  if (process.platform === "win32" && (program === "npm" || program === "npx" || /\.(cmd|bat)$/i.test(program))) {
    return {
      program: "cmd.exe",
      args: ["/d", "/s", "/c", commandDisplay(command)],
    };
  }
  return { program, args };
}

function tailText(value, maxLength = 4000) {
  const text = String(value || "");
  return text.length > maxLength ? text.slice(-maxLength) : text;
}

function runCommand(command, options) {
  if (command.length === 0) {
    return {
      skipped: true,
      status: 0,
      command: [],
    };
  }

  const target = spawnTarget(command);
  const result = spawnSync(target.program, target.args, {
    cwd: repoRoot,
    stdio: options.quietCommand ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: options.quietCommand ? "utf8" : undefined,
  });
  return {
    skipped: false,
    status: typeof result.status === "number" ? result.status : 1,
    error: result.error ? result.error.message : "",
    stdoutTail: options.quietCommand ? tailText(result.stdout) : "",
    stderrTail: options.quietCommand ? tailText(result.stderr) : "",
    command,
  };
}

function compareStates(before, after, options) {
  const violations = [];
  if (!options.allowBranchChange && before.branch !== after.branch) {
    violations.push(`Branch changed from ${before.branch || "(detached)"} to ${after.branch || "(detached)"}.`);
  }
  if (!options.allowHeadChange && before.head !== after.head) {
    violations.push(`HEAD changed from ${before.head} to ${after.head}.`);
  }
  if (!options.allowStatusChange && before.statusShortBranch !== after.statusShortBranch) {
    violations.push("Git status changed during guarded audit command.");
  }
  return violations;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const before = captureGitState("before", options);
  const commandResult = runCommand(options.command, options);
  const after = captureGitState("after", options);
  const violations = compareStates(before, after, options);
  const commandFailed = commandResult.status !== 0;
  const status = before.gitOk && after.gitOk && !commandFailed && violations.length === 0 ? "pass" : "fail";
  const report = {
    schema: "repo-audit-branch-guard-v1",
    generatedAt: new Date().toISOString(),
    status,
    options: {
      allowStatusChange: options.allowStatusChange,
      allowHeadChange: options.allowHeadChange,
      allowBranchChange: options.allowBranchChange,
      untrackedFiles: options.untrackedFiles,
      quietCommand: options.quietCommand,
    },
    before,
    after,
    command: commandResult,
    violations,
  };

  const artifactPath = resolve(repoRoot, options.artifact);
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`repo-audit-branch-guard: ${status}\n`);
    process.stdout.write(`before: ${before.branch} ${before.head}\n`);
    process.stdout.write(`after: ${after.branch} ${after.head}\n`);
    for (const violation of violations) {
      process.stdout.write(`- ${violation}\n`);
    }
    process.stdout.write(`artifact: ${artifactPath}\n`);
  }

  if (status !== "pass") {
    process.exitCode = commandFailed ? commandResult.status : 1;
  }
}

main();
