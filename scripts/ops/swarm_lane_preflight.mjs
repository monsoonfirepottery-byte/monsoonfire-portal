#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "swarm-lane-preflight");
const LANE_SCOPES = {
  docs: ["docs/ops/**"],
  tooling: ["scripts/ops/**", "scripts/studiobrain-ops-work-packet.mjs", "scripts/studiobrain-ops-work-packet.test.mjs", "schemas/ops/**", "docs/ops/**", "Makefile", "package.json", ".github/workflows/**"],
  "swarm-infra": ["scripts/ops/**", "scripts/studiobrain-ops-work-packet.mjs", "scripts/studiobrain-ops-work-packet.test.mjs", "schemas/ops/**", "docs/ops/**", "Makefile"],
  "ci-sre": [".github/workflows/**", "scripts/ops/**", "schemas/ops/**", "docs/ops/**", "Makefile", "package.json", "package-lock.json"],
  "mission-control": ["src/mission-control/**", "server/mission/**", "scripts/mission-control/**", "docs/ops/**", "package.json"],
};

function usage() {
  return `Studio Brain swarm lane preflight

Usage:
  node scripts/ops/swarm_lane_preflight.mjs --lane tooling [--json]

Options:
  --lane <name>         docs, tooling, swarm-infra, ci-sre, mission-control. Default: tooling.
  --base <ref>          Base ref for changed-file scope. Default: upstream merge-base, then origin/main.
  --allowed <pattern>   Additional allowed path pattern; repeatable. Supports exact paths and prefix/**.
  --fail-on-dirty       Treat uncommitted files as failure instead of warning.
  --json                Print JSON report.
  --write               Write timestamped and latest reports under output/ops/swarm-lane-preflight.
  --output-dir <path>   Default: output/ops/swarm-lane-preflight.
`;
}

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function repoRelative(path) {
  return relative(REPO_ROOT, resolve(REPO_ROOT, path)).replace(/\\/g, "/");
}

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    stdout: String(result.stdout ?? "").replace(/\r/g, "").trimEnd(),
    stderr: clean(result.stderr),
    status: result.status,
  };
}

function readFlagValue(argv, index, flag) {
  const value = argv[index];
  if (value === flag) {
    if (!argv[index + 1]) throw new Error(`${flag} requires a value.`);
    return { matched: true, value: argv[index + 1], nextIndex: index + 1 };
  }
  if (value.startsWith(`${flag}=`)) return { matched: true, value: value.slice(flag.length + 1), nextIndex: index };
  return { matched: false, value: "", nextIndex: index };
}

function parseArgs(argv) {
  const options = {
    lane: "tooling",
    base: "",
    allowed: [],
    failOnDirty: false,
    json: false,
    write: false,
    outputDir: DEFAULT_OUTPUT_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--write") {
      options.write = true;
      continue;
    }
    if (arg === "--fail-on-dirty") {
      options.failOnDirty = true;
      continue;
    }
    const mappings = [
      ["--lane", "lane"],
      ["--base", "base"],
      ["--output-dir", "outputDir"],
    ];
    let consumed = false;
    for (const [flag, key] of mappings) {
      const parsed = readFlagValue(argv, index, flag);
      if (!parsed.matched) continue;
      options[key] = parsed.value;
      index = parsed.nextIndex;
      consumed = true;
      break;
    }
    if (consumed) continue;
    const allowed = readFlagValue(argv, index, "--allowed");
    if (allowed.matched) {
      options.allowed.push(allowed.value);
      index = allowed.nextIndex;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  options.outputDir = resolve(REPO_ROOT, options.outputDir);
  return options;
}

function normalizePath(path) {
  return clean(path).replace(/\\/g, "/").replace(/^\.\//, "");
}

function matchesPattern(path, pattern) {
  const normalizedPath = normalizePath(path);
  const normalizedPattern = normalizePath(pattern);
  if (!normalizedPattern) return false;
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }
  if (normalizedPattern.endsWith("/*")) {
    const prefix = normalizedPattern.slice(0, -2);
    return normalizedPath.startsWith(`${prefix}/`) && !normalizedPath.slice(prefix.length + 1).includes("/");
  }
  return normalizedPath === normalizedPattern;
}

function allowedForLane(lane, extraAllowed = []) {
  return [...(LANE_SCOPES[lane] || []), ...extraAllowed].map(normalizePath);
}

function parseStatusPorcelain(output) {
  return output
    .split(/\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .flatMap((line) => {
      const pathPart = line.slice(3);
      if (pathPart.includes(" -> ")) return pathPart.split(" -> ").map(normalizePath);
      return [normalizePath(pathPart)];
    });
}

function resolveBase(explicitBase = "", git = runGit) {
  if (clean(explicitBase)) return clean(explicitBase);
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (upstream.ok && upstream.stdout) return upstream.stdout;
  return "origin/main";
}

function changedFilesSince(base, git = runGit) {
  const result = git(["diff", "--name-only", "--no-renames", `${base}...HEAD`]);
  if (!result.ok) return { ok: false, files: [], error: result.stderr || `git diff exited ${result.status}` };
  return { ok: true, files: result.stdout.split(/\n/).map(normalizePath).filter(Boolean), error: "" };
}

function inspectIntegrationBase(base, git = runGit) {
  const mainBase = "origin/main";
  if (base === mainBase) return { ref: mainBase, differs: false, files: [], error: "" };
  const changed = changedFilesSince(mainBase, git);
  return {
    ref: mainBase,
    differs: true,
    files: changed.files || [],
    error: changed.error || "",
  };
}

function buildPreflightReport(options = {}, git = runGit) {
  const generatedAt = nowIso();
  const lane = clean(options.lane || "tooling");
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const base = resolveBase(options.base, git);
  const changed = changedFilesSince(base, git);
  const integrationBase = inspectIntegrationBase(base, git);
  const dirty = git(["status", "--short"]);
  const dirtyFiles = dirty.ok ? parseStatusPorcelain(dirty.stdout) : [];
  const allowed = allowedForLane(lane, options.allowed || []);
  const writeSet = Array.from(new Set([...(changed.files || []), ...(integrationBase.files || []), ...dirtyFiles])).sort();
  const outsideScope = writeSet.filter((path) => !allowed.some((pattern) => matchesPattern(path, pattern)));
  const problems = [];
  const warnings = [];
  if (!LANE_SCOPES[lane]) problems.push(`unknown lane: ${lane}`);
  if (!branch.ok) problems.push(branch.stderr || "could not determine branch");
  if (!changed.ok) problems.push(changed.error);
  if (integrationBase.error) problems.push(`could not inspect ${integrationBase.ref}: ${integrationBase.error}`);
  if (!dirty.ok) problems.push(dirty.stderr || "could not inspect dirty state");
  if (outsideScope.length > 0) problems.push(`write scope has ${outsideScope.length} file(s) outside lane ownership`);
  if (dirtyFiles.length > 0 && options.failOnDirty) problems.push(`dirty worktree has ${dirtyFiles.length} file(s)`);
  if (integrationBase.differs) warnings.push(`base ${base} differs from ${integrationBase.ref}; integration-base files are included in scope checks`);
  if (branch.stdout === "HEAD" || branch.stdout === "main") warnings.push(`branch ${branch.stdout} is not a normal feature branch for delegated work`);
  const status = problems.length > 0 ? "fail" : dirtyFiles.length > 0 || warnings.length > 0 ? "warn" : "pass";
  const runId = `swarm-lane-preflight-${generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  return {
    schema: "studiobrain-swarm-lane-preflight.v1",
    generatedAt,
    runId,
    status,
    readOnly: true,
    lane,
    branch: branch.stdout || "",
    base,
    integrationBase,
    allowed,
    changedFiles: changed.files || [],
    dirtyFiles,
    outsideScope,
    problems,
    warnings,
    recommendation: status === "pass"
      ? "lane is ready for scoped work"
      : status === "warn"
        ? "commit, stash, or intentionally account for dirty files before delegating"
        : "do not delegate this lane until the scope or branch issue is fixed",
  };
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function run(rawArgs = process.argv.slice(2)) {
  const options = parseArgs(rawArgs);
  const report = buildPreflightReport(options);
  const artifact = resolve(options.outputDir, `${report.runId}.json`);
  const latest = resolve(options.outputDir, "swarm-lane-preflight-latest.json");
  if (options.write) {
    writeJson(artifact, report);
    writeJson(latest, report);
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify({
      ...report,
      artifacts: options.write ? { jsonPath: repoRelative(artifact), latestPath: repoRelative(latest) } : null,
    }, null, 2)}\n`);
  } else {
    process.stdout.write(`swarm lane preflight: ${report.status}\n`);
    process.stdout.write(`lane=${report.lane} branch=${report.branch} base=${report.base}\n`);
    if (report.problems.length > 0) report.problems.forEach((problem) => process.stdout.write(`- ${problem}\n`));
  }
  if (report.status === "fail") process.exitCode = 1;
  return report;
}

export { buildPreflightReport, matchesPattern };

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
