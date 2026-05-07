#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_REPO = REPO_ROOT;
const DEFAULT_ALLOWLIST = resolve(REPO_ROOT, "studio-brain", "host-drift-allowlist.json");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "host-drift");

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function repoRelative(path) {
  return relative(REPO_ROOT, resolve(REPO_ROOT, path)).replace(/\\/g, "/");
}

function normalizePath(value) {
  return clean(value)
    .replace(/^"|"$/g, "")
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    json: false,
    write: false,
    repo: DEFAULT_REPO,
    statusFile: "",
    allowlist: DEFAULT_ALLOWLIST,
    outputDir: DEFAULT_OUTPUT_DIR,
    runId: "",
    maxEntries: 1000,
    showSensitivePaths: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
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
    if (arg === "--show-sensitive-paths") {
      options.showSensitivePaths = true;
      continue;
    }
    const next = clean(argv[index + 1]);
    const read = (flag) => {
      if (arg === flag) {
        if (!next) throw new Error(`${flag} requires a value.`);
        index += 1;
        return next;
      }
      if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
      return null;
    };
    const flags = {
      "--repo": "repo",
      "--status-file": "statusFile",
      "--allowlist": "allowlist",
      "--output-dir": "outputDir",
      "--run-id": "runId",
      "--max-entries": "maxEntries",
    };
    let matched = false;
    for (const [flag, key] of Object.entries(flags)) {
      const value = read(flag);
      if (value === null) continue;
      options[key] = key === "maxEntries" ? Number(value) : value;
      matched = true;
      break;
    }
    if (matched) continue;
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(options.maxEntries) || options.maxEntries < 1) throw new Error("--max-entries must be a positive number.");
  options.repo = resolve(REPO_ROOT, options.repo);
  options.statusFile = options.statusFile ? resolve(REPO_ROOT, options.statusFile) : "";
  options.allowlist = resolve(REPO_ROOT, options.allowlist);
  options.outputDir = resolve(REPO_ROOT, options.outputDir);
  return options;
}

function usage() {
  return `Studio Brain host drift manifest

Usage:
  node scripts/ops/host_drift_manifest.mjs [--json] [--write]

Options:
  --repo <path>          Git checkout to inspect. Default: current repo.
  --status-file <path>   Parse a captured git status --porcelain=v1 file instead of running git.
  --allowlist <path>     Host drift allowlist JSON. Default: studio-brain/host-drift-allowlist.json.
  --output-dir <path>    Artifact directory. Default: output/ops/host-drift.
  --run-id <id>          Stable run id. Default: host-drift-manifest timestamp.
  --max-entries <n>      Maximum path rows to keep in JSON. Default: 1000.
  --show-sensitive-paths Include sensitive-looking path names. Default redacts them.

Safety:
  Read-only. Captures path names and Git metadata only. Does not read file contents,
  reset, clean, checkout, stash, delete, move, chmod, restart, or modify host state.
`;
}

function git(repo, args, fallback = "", trimOutput = true) {
  try {
    const output = execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return trimOutput ? output.trim() : output;
  } catch {
    return fallback;
  }
}

function readStatusLines(options) {
  if (options.statusFile) {
    if (!existsSync(options.statusFile)) return { source: repoRelative(options.statusFile), lines: [], readStatus: "missing", error: "status file is missing" };
    return {
      source: repoRelative(options.statusFile),
      lines: readFileSync(options.statusFile, "utf8").split(/\r?\n/).filter(Boolean),
      readStatus: "present",
      error: "",
    };
  }
  const inside = git(options.repo, ["rev-parse", "--is-inside-work-tree"], "");
  if (inside !== "true") return { source: options.repo, lines: [], readStatus: "not_git_checkout", error: "repo is not a Git checkout" };
  return {
    source: options.repo,
    lines: git(options.repo, ["status", "--porcelain=v1", "--untracked-files=all"], "", false).split(/\r?\n/).filter(Boolean),
    readStatus: "present",
    error: "",
  };
}

function parsePorcelainLine(line) {
  const raw = String(line ?? "");
  const status = raw.slice(0, 2);
  const body = raw.slice(3);
  const path = body.includes(" -> ") ? body.split(" -> ").pop() : body;
  return {
    status: clean(status),
    path: normalizePath(path),
    rawStatus: status,
  };
}

function classifyPath(path) {
  const low = normalizePath(path).toLowerCase();
  if (/(^|\/)(\.env|\.env\.|id_rsa|id_ed25519|secrets?|credentials?|firebase|service-account|private-key)/.test(low)) return "sensitive_path_name";
  if (/\.(pem|key|p12|pfx|kdbx)$/.test(low)) return "sensitive_path_name";
  if (/^(output|dist|build|coverage|\.next|node_modules|tmp|logs|\.turbo|\.cache)\//.test(low)) return "generated_or_artifact";
  if (/\.(log|tmp|cache|tgz|zip|gz)$/.test(low)) return "generated_or_artifact";
  if (/(^|\/)(\.gitignore|makefile|dockerfile|caddyfile(\..*)?)$/.test(low)) return "source_or_config";
  if (/(^|\/)(compose|docker-compose)\./.test(low)) return "source_or_config";
  if (/\.(md|ts|tsx|js|jsx|mjs|cjs|json|sql|sh|ps1|yml|yaml|toml|css|html|py|service|timer|conf)$/.test(low)) return "source_or_config";
  return "unknown";
}

function loadAllowlist(path, generatedAt) {
  if (!existsSync(path)) return { status: "missing", path: repoRelative(path), entries: [], errors: ["allowlist file is missing"] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const entries = Array.isArray(parsed.entries) ? parsed.entries.map((entry) => {
      const expiresAt = clean(entry.expiresAt);
      const expired = expiresAt ? Date.parse(expiresAt) < Date.parse(generatedAt) : false;
      return {
        path: normalizePath(entry.path),
        owner: clean(entry.owner),
        reason: clean(entry.reason),
        expiresAt,
        expired,
      };
    }).filter((entry) => entry.path) : [];
    return {
      status: parsed.schemaVersion === "studio-brain-host-drift-allowlist.v1" ? "present" : "warn",
      path: repoRelative(path),
      generatedAt: clean(parsed.generatedAt),
      entries,
      errors: parsed.schemaVersion === "studio-brain-host-drift-allowlist.v1" ? [] : ["unexpected allowlist schemaVersion"],
    };
  } catch (error) {
    return {
      status: "invalid_json",
      path: repoRelative(path),
      entries: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function matchAllowlist(path, allowlist) {
  const normalized = normalizePath(path);
  const entry = allowlist.entries.find((item) => normalized === item.path || normalized.startsWith(`${item.path}/`));
  if (!entry) return { status: "unmatched", path: "", owner: "", reason: "", expiresAt: "", expired: false };
  return {
    status: entry.expired ? "expired" : "active",
    path: entry.path,
    owner: entry.owner,
    reason: entry.reason,
    expiresAt: entry.expiresAt,
    expired: entry.expired,
  };
}

function approvalClass(pathClass, allowlistMatch) {
  if (pathClass === "sensitive_path_name") return "do_not_touch_security_review";
  if (allowlistMatch.status === "active") return "allowlisted_review_before_cleanup";
  if (allowlistMatch.status === "expired") return "requires_human_approval";
  if (pathClass === "generated_or_artifact") return "safe_with_backup";
  return "requires_human_approval";
}

function increment(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function collectGitMetadata(options) {
  if (options.statusFile) {
    return { repo: options.repo, branch: "", head: "", upstream: "", upstreamStatus: "status_file_only", aheadBehind: "" };
  }
  const branch = git(options.repo, ["branch", "--show-current"], "");
  const upstream = branch ? git(options.repo, ["for-each-ref", "--format=%(upstream:short)", `refs/heads/${branch}`], "") : "";
  const upstreamStatus = upstream
    ? git(options.repo, ["show-ref", "--verify", "--quiet", `refs/remotes/${upstream}`], "__missing__") === "__missing__"
      ? "gone_or_not_fetched"
      : "present"
    : "unavailable";
  const aheadBehind = upstream && upstreamStatus === "present"
    ? git(options.repo, ["rev-list", "--left-right", "--count", `HEAD...${upstream}`], "")
    : "";
  return {
    repo: options.repo,
    branch,
    head: git(options.repo, ["rev-parse", "--short", "HEAD"], ""),
    upstream,
    upstreamStatus,
    aheadBehind,
  };
}

function buildHostDriftManifest(inputs = {}, options = {}) {
  const generatedAt = clean(options.generatedAt) || nowIso();
  const runId = clean(options.runId) || `host-drift-manifest-${generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const allowlist = inputs.allowlist || loadAllowlist(options.allowlist || DEFAULT_ALLOWLIST, generatedAt);
  const statusLines = inputs.statusLines || [];
  const maxEntries = Number(options.maxEntries) || 1000;
  const entries = [];
  const classificationCounts = {};
  const statusCounts = {};
  const approvalCounts = {};
  const allowlistCounts = {};
  for (const line of statusLines) {
    const parsed = parsePorcelainLine(line);
    if (!parsed.path) continue;
    const pathClass = classifyPath(parsed.path);
    const allowlistMatch = matchAllowlist(parsed.path, allowlist);
    const approval = approvalClass(pathClass, allowlistMatch);
    increment(classificationCounts, pathClass);
    increment(statusCounts, parsed.status || "unknown");
    increment(approvalCounts, approval);
    increment(allowlistCounts, allowlistMatch.status);
    if (entries.length < maxEntries) {
      const pathRedacted = pathClass === "sensitive_path_name" && !options.showSensitivePaths;
      entries.push({
        status: parsed.status,
        pathClass,
        approval,
        path: pathRedacted ? "[redacted-sensitive-path-name]" : parsed.path,
        pathRedacted,
        allowlist: allowlistMatch,
      });
    }
  }
  const dirtyPaths = statusLines.filter(Boolean).length;
  const errors = [];
  if (allowlist.errors?.length) errors.push(...allowlist.errors.map((error) => `allowlist: ${error}`));
  if (inputs.statusRead?.error) errors.push(inputs.statusRead.error);
  const expiredAllowlistMatches = allowlistCounts.expired || 0;
  const status = inputs.statusRead?.readStatus && inputs.statusRead.readStatus !== "present"
    ? "warn"
    : allowlist.status === "invalid_json"
      ? "fail"
      : dirtyPaths > 0 || errors.length > 0 || expiredAllowlistMatches > 0
        ? "warn"
        : "pass";
  return {
    schema: "studiobrain-host-drift-manifest.v1",
    generatedAt,
    runId,
    status,
    readOnly: true,
    safety: {
      pathNamesOnly: true,
      readsFileContents: false,
      mutatesHost: false,
      destructiveActions: false,
      sensitivePathNamesRedacted: !options.showSensitivePaths,
    },
    sources: {
      repo: clean(options.repo) || DEFAULT_REPO,
      statusSource: clean(inputs.statusRead?.source) || "",
      statusReadStatus: clean(inputs.statusRead?.readStatus) || "present",
      allowlistPath: allowlist.path || repoRelative(options.allowlist || DEFAULT_ALLOWLIST),
      allowlistStatus: allowlist.status,
      allowlistGeneratedAt: clean(allowlist.generatedAt),
    },
    git: inputs.gitMetadata || {},
    summary: {
      dirtyPaths,
      entriesKept: entries.length,
      truncated: dirtyPaths > entries.length,
      classificationCounts,
      statusCounts,
      approvalCounts,
      allowlistCounts,
      allowlistEntries: allowlist.entries.length,
      expiredAllowlistMatches,
      errors,
    },
    entries,
    safeNextSteps: [
      "Save the manifest with restricted permissions before review.",
      "Create a host backup branch or restricted patch bundle before any cleanup.",
      "Review sensitive path names without printing values into tickets.",
      "Convert accepted source/config drift into small PRs; leave cleanup/reset approval-gated.",
    ],
  };
}

function renderMarkdown(report) {
  const counts = (items) => Object.entries(items || {}).map(([key, value]) => `- ${key}: ${value}`).join("\n") || "- None.";
  const entries = report.entries.slice(0, 80).map((entry) => (
    `| ${entry.status} | ${entry.pathClass} | ${entry.approval} | ${entry.allowlist.status}${entry.allowlist.path ? `:${entry.allowlist.path}` : ""} | \`${entry.path}\` |`
  )).join("\n") || "|  |  |  |  | No drift paths captured. |";
  return `# Host Drift Manifest

Generated: ${report.generatedAt}
Status: ${report.status}
Run ID: ${report.runId}

## Safety

- Path names only: ${report.safety.pathNamesOnly}
- Reads file contents: ${report.safety.readsFileContents}
- Mutates host: ${report.safety.mutatesHost}
- Destructive actions: ${report.safety.destructiveActions}

## Sources

- Repo: ${report.sources.repo}
- Status source: ${report.sources.statusSource}
- Status read status: ${report.sources.statusReadStatus}
- Allowlist: ${report.sources.allowlistPath}
- Allowlist status: ${report.sources.allowlistStatus}

## Summary

- Dirty paths: ${report.summary.dirtyPaths}
- Entries kept: ${report.summary.entriesKept}
- Truncated: ${report.summary.truncated}
- Allowlist entries: ${report.summary.allowlistEntries}
- Expired allowlist matches: ${report.summary.expiredAllowlistMatches}

### Path Classes

${counts(report.summary.classificationCounts)}

### Approval Classes

${counts(report.summary.approvalCounts)}

### Allowlist Matches

${counts(report.summary.allowlistCounts)}

## Drift Entries

| Git | Class | Approval | Allowlist | Path |
| --- | --- | --- | --- | --- |
${entries}

## Safe Next Steps

${report.safeNextSteps.map((step) => `- ${step}`).join("\n")}
`;
}

function writeArtifacts(options, report) {
  mkdirSync(options.outputDir, { recursive: true });
  const jsonPath = resolve(options.outputDir, `${report.runId}.json`);
  const markdownPath = resolve(options.outputDir, `${report.runId}.md`);
  const latestJson = resolve(options.outputDir, "host-drift-manifest-latest.json");
  const latestMarkdown = resolve(options.outputDir, "host-drift-manifest-latest.md");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  writeFileSync(latestJson, `${JSON.stringify({ ...report, artifactPath: repoRelative(jsonPath), markdownPath: repoRelative(markdownPath) }, null, 2)}\n`, "utf8");
  writeFileSync(latestMarkdown, renderMarkdown(report), "utf8");
  return {
    jsonPath: repoRelative(jsonPath),
    markdownPath: repoRelative(markdownPath),
    latestJson: repoRelative(latestJson),
    latestMarkdown: repoRelative(latestMarkdown),
  };
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    const generatedAt = nowIso();
    const statusRead = readStatusLines(options);
    const report = buildHostDriftManifest({
      allowlist: loadAllowlist(options.allowlist, generatedAt),
      statusLines: statusRead.lines,
      statusRead,
      gitMetadata: collectGitMetadata(options),
    }, {
      generatedAt,
      runId: options.runId,
      repo: options.repo,
      allowlist: options.allowlist,
      maxEntries: options.maxEntries,
      showSensitivePaths: options.showSensitivePaths,
    });
    if (options.write) report.artifacts = writeArtifacts(options, report);
    if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else process.stdout.write(`host drift manifest: ${report.status}, dirtyPaths=${report.summary.dirtyPaths}\n`);
    if (report.status === "fail") process.exitCode = 1;
    return report;
  } catch (error) {
    process.stderr.write(`host_drift_manifest failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return null;
  }
}

export { buildHostDriftManifest, classifyPath, parsePorcelainLine, renderMarkdown };

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
