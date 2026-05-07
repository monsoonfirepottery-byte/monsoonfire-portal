#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_LEDGER = resolve(REPO_ROOT, "output", "ops", "effectivity", "slice-ledger.jsonl");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "work-verification");

function usage() {
  return `Studio Brain ops work verification packet

Usage:
  node scripts/ops/work_verification_packet.mjs [--last 5] [--json] [--write]

Options:
  --ledger <path>      Slice ledger JSONL path. Default: output/ops/effectivity/slice-ledger.jsonl.
  --last <number>      Number of latest slice rows to include. Default: 5.
  --base <ref>         Git base ref for changed-file summary. Default: origin/main.
  --output-dir <path>  Artifact directory. Default: output/ops/work-verification.
  --json               Print JSON.
  --write              Write timestamped JSON/Markdown and latest JSON artifacts.
  --no-write           Explicitly avoid writing artifacts.
`;
}

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function repoRelative(root, path) {
  const raw = clean(path);
  if (!raw) return "";
  return relative(root, resolve(root, raw)).replace(/\\/g, "/");
}

function normalPath(value) {
  return clean(value).replace(/\\/g, "/");
}

function sensitivePathReason(path) {
  const value = normalPath(path).toLowerCase();
  if (/(^|\/)\.env($|[./-])/.test(value)) return "env_file";
  if (/(^|\/)(secrets?|credentials?|tokens?|private)(\/|$)/.test(value)) return "sensitive_directory";
  if (/(password|secret|token|credential|api[_-]?key)/.test(value)) return "sensitive_name";
  if (/\.(pem|key|p12|pfx)$/i.test(value)) return "private_key_material";
  return "";
}

function redactPath(path) {
  const value = normalPath(path);
  const reason = sensitivePathReason(value);
  if (!reason) return value;
  return `[redacted-sensitive-path:${sha256(Buffer.from(value)).slice(0, 12)}]`;
}

function sanitizePathList(paths) {
  const source = paths.map(normalPath).filter(Boolean);
  const sensitive = source.map(sensitivePathReason).filter(Boolean);
  return {
    paths: unique(source.map(redactPath)),
    sensitiveCount: sensitive.length,
    sensitiveClasses: unique(sensitive)
  };
}

function parseArgs(argv) {
  const options = {
    ledger: DEFAULT_LEDGER,
    last: 5,
    base: "origin/main",
    outputDir: DEFAULT_OUTPUT_DIR,
    json: false,
    write: false,
    includeGit: true,
    repoRoot: REPO_ROOT
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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
    if (arg === "--no-write") {
      options.write = false;
      continue;
    }
    if (arg === "--ledger") {
      options.ledger = argv[++index];
      continue;
    }
    if (arg.startsWith("--ledger=")) {
      options.ledger = arg.slice("--ledger=".length);
      continue;
    }
    if (arg === "--last") {
      options.last = Number(argv[++index]) || 5;
      continue;
    }
    if (arg.startsWith("--last=")) {
      options.last = Number(arg.slice("--last=".length)) || 5;
      continue;
    }
    if (arg === "--base") {
      options.base = clean(argv[++index]);
      continue;
    }
    if (arg.startsWith("--base=")) {
      options.base = clean(arg.slice("--base=".length));
      continue;
    }
    if (arg === "--output-dir") {
      options.outputDir = argv[++index];
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      options.outputDir = arg.slice("--output-dir=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  options.repoRoot = resolve(options.repoRoot);
  options.ledger = resolve(options.repoRoot, options.ledger);
  options.outputDir = resolve(options.repoRoot, options.outputDir);
  options.last = Math.max(1, options.last);
  return options;
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at ${path}:${index + 1}: ${error.message}`);
      }
    });
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function artifactEvidence(path, repoRoot) {
  const originalRelativePath = repoRelative(repoRoot, path);
  const relativePath = redactPath(originalRelativePath);
  const absolutePath = resolve(repoRoot, originalRelativePath);
  const shareable = normalPath(originalRelativePath).startsWith("output/ops/") && !sensitivePathReason(originalRelativePath);
  if (!existsSync(absolutePath)) {
    return {
      path: relativePath,
      exists: false,
      sizeBytes: 0,
      sha256: null,
      schema: null,
      status: null,
      generatedAt: null,
      shareable
    };
  }
  const stat = statSync(absolutePath);
  if (!shareable) {
    return {
      path: relativePath,
      exists: true,
      sizeBytes: stat.size,
      sha256: null,
      schema: null,
      status: null,
      generatedAt: null,
      shareable
    };
  }
  const bytes = readFileSync(absolutePath);
  let parsed = null;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    parsed = null;
  }
  return {
    path: relativePath,
    exists: true,
    sizeBytes: stat.size,
    sha256: sha256(bytes),
    schema: typeof parsed?.schema === "string" ? parsed.schema : null,
    status: typeof parsed?.status === "string" ? parsed.status : null,
    generatedAt: typeof parsed?.generatedAt === "string" ? parsed.generatedAt : null,
    shareable
  };
}

function runGit(args, repoRoot) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: clean(result.stdout),
    stderr: clean(result.stderr),
    error: result.error?.message || ""
  };
}

function gitSnapshot(options) {
  if (!options.includeGit) return null;
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"], options.repoRoot);
  const head = runGit(["rev-parse", "HEAD"], options.repoRoot);
  const diff = runGit(["diff", "--name-only", `${options.base}..HEAD`], options.repoRoot);
  const status = runGit(["status", "--short"], options.repoRoot);
  const changed = sanitizePathList(diff.ok ? diff.stdout.split(/\r?\n/) : []);
  const dirty = sanitizePathList(status.ok ? status.stdout.split(/\r?\n/) : []);
  return {
    branch: branch.ok ? branch.stdout : null,
    head: head.ok ? head.stdout : null,
    base: options.base,
    changedFilesSinceBase: changed.paths,
    dirtyFiles: dirty.paths,
    sensitivePathCount: changed.sensitiveCount + dirty.sensitiveCount,
    sensitivePathClasses: unique([...changed.sensitiveClasses, ...dirty.sensitiveClasses]),
    warnings: [
      ...(branch.ok ? [] : [{ code: "git_branch_unavailable", message: branch.stderr || branch.error }]),
      ...(head.ok ? [] : [{ code: "git_head_unavailable", message: head.stderr || head.error }]),
      ...(diff.ok ? [] : [{ code: "git_diff_unavailable", message: diff.stderr || diff.error }]),
      ...(status.ok ? [] : [{ code: "git_status_unavailable", message: status.stderr || status.error }])
    ]
  };
}

function statusFromSummary(summary) {
  if (summary.commandFailures > 0 || summary.artifactFailures > 0) return "fail";
  if (summary.missingArtifacts > 0 || summary.artifactWarnings > 0 || summary.commandWarnings > 0 || summary.commandSkipped > 0 || summary.noOpRows > 0 || summary.gitDirtyFiles > 0 || summary.sensitivePathCount > 0) return "warn";
  return "pass";
}

function buildPacket(options) {
  const rows = readJsonl(options.ledger);
  const selected = rows.slice(-options.last);
  const commands = selected.flatMap((row) => (row.commands || []).map((command) => ({
    sliceId: row.sliceId,
    command: command.command,
    status: command.status
  })));
  const artifactPaths = unique(selected.flatMap((row) => (row.artifacts || []).map((artifact) => artifact.path)));
  const artifacts = artifactPaths.map((path) => artifactEvidence(path, options.repoRoot));
  const git = gitSnapshot(options);
  const changed = sanitizePathList(selected.flatMap((row) => row.changedFiles || []));
  const summary = {
    sliceCount: selected.length,
    commandCount: commands.length,
    commandFailures: commands.filter((command) => command.status === "fail").length,
    commandWarnings: commands.filter((command) => command.status === "warn").length,
    commandSkipped: commands.filter((command) => command.status === "skipped").length,
    artifactCount: artifacts.length,
    missingArtifacts: artifacts.filter((artifact) => !artifact.exists).length,
    artifactWarnings: artifacts.filter((artifact) => artifact.status === "warn" || artifact.status === "skipped").length,
    artifactFailures: artifacts.filter((artifact) => artifact.status === "fail").length,
    changedFileCount: changed.paths.length,
    sensitivePathCount: changed.sensitiveCount + (git?.sensitivePathCount ?? 0),
    sensitivePathClasses: unique([...changed.sensitiveClasses, ...(git?.sensitivePathClasses || [])]),
    noOpRows: selected.filter((row) => row.status === "noop" || row.noOp?.detected).length,
    gitDirtyFiles: git?.dirtyFiles?.length ?? 0
  };
  const warnings = [
    ...(selected.length === 0 ? [{ code: "no_slice_rows", message: "No slice rows were available in the selected ledger window." }] : []),
    ...artifacts.filter((artifact) => !artifact.exists).map((artifact) => ({ code: "missing_artifact", path: artifact.path, message: "Ledger artifact path does not exist in this checkout." })),
    ...(summary.artifactWarnings > 0 ? [{ code: "artifact_warnings", message: `${summary.artifactWarnings} referenced artifact(s) report warn/skipped status.` }] : []),
    ...(summary.commandWarnings > 0 ? [{ code: "command_warnings", message: `${summary.commandWarnings} verification command(s) were recorded as warn.` }] : []),
    ...(summary.commandSkipped > 0 ? [{ code: "command_skipped", message: `${summary.commandSkipped} verification command(s) were recorded as skipped.` }] : []),
    ...(summary.noOpRows > 0 ? [{ code: "noop_rows", message: `${summary.noOpRows} selected slice row(s) were no-op.` }] : []),
    ...(summary.gitDirtyFiles > 0 ? [{ code: "dirty_worktree", message: `${summary.gitDirtyFiles} working-tree file(s) are dirty while packet was generated.` }] : []),
    ...(summary.sensitivePathCount > 0 ? [{ code: "sensitive_paths_redacted", message: `${summary.sensitivePathCount} sensitive-looking path(s) were redacted.` }] : []),
    ...(git?.warnings || [])
  ];
  const failures = commands
    .filter((command) => command.status === "fail")
    .map((command) => ({ code: "command_failed", sliceId: command.sliceId, message: command.command }));
  failures.push(...artifacts
    .filter((artifact) => artifact.status === "fail")
    .map((artifact) => ({ code: "artifact_failed", message: artifact.path })));
  return {
    schema: "studiobrain-ops-work-verification-packet.v1",
    generatedAt: nowIso(),
    status: statusFromSummary(summary),
    redaction: "metadata_only_no_file_contents",
    inputs: {
      ledgerPath: repoRelative(options.repoRoot, options.ledger),
      last: options.last
    },
    sliceWindow: {
      from: selected[0]?.sliceId ?? null,
      to: selected[selected.length - 1]?.sliceId ?? null,
      rows: selected.map((row) => ({
        sliceId: row.sliceId,
        runId: row.runId,
        lane: row.lane,
        title: row.title,
        status: row.status,
        usefulnessScore: Number(row.usefulness?.score) || 0
      }))
    },
    summary,
    commands,
    changedFiles: changed.paths,
    artifacts,
    git,
    warnings,
    failures
  };
}

function markdown(packet) {
  const lines = [
    "# Studio Brain Ops Work Verification Packet",
    "",
    `Generated: ${packet.generatedAt}`,
    `Status: ${packet.status}`,
    `Redaction: ${packet.redaction}`,
    "",
    "## Summary",
    "",
    `- Slices: ${packet.summary.sliceCount}`,
    `- Commands: ${packet.summary.commandCount}`,
    `- Command failures: ${packet.summary.commandFailures}`,
    `- Artifacts: ${packet.summary.artifactCount}`,
    `- Missing artifacts: ${packet.summary.missingArtifacts}`,
    `- Artifact warnings: ${packet.summary.artifactWarnings}`,
    `- Artifact failures: ${packet.summary.artifactFailures}`,
    `- Changed files from ledger: ${packet.summary.changedFileCount}`,
    `- Dirty files at generation: ${packet.summary.gitDirtyFiles}`,
    "",
    "## Slice Window",
    ""
  ];
  for (const row of packet.sliceWindow.rows) {
    lines.push(`- ${row.sliceId}: ${row.status} - ${row.title}`);
  }
  lines.push("", "## Warnings", "");
  if (packet.warnings.length === 0) {
    lines.push("- none");
  } else {
    for (const warning of packet.warnings) lines.push(`- ${warning.code}${warning.path ? ` (${warning.path})` : ""}: ${warning.message}`);
  }
  lines.push("", "## Artifacts", "");
  if (packet.artifacts.length === 0) {
    lines.push("- none");
  } else {
    for (const artifact of packet.artifacts) {
      lines.push(`- ${artifact.path}: ${artifact.exists ? "exists" : "missing"}${artifact.schema ? `, schema=${artifact.schema}` : ""}${artifact.status ? `, status=${artifact.status}` : ""}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function writeArtifacts(options, packet) {
  mkdirSync(options.outputDir, { recursive: true });
  const timestamp = packet.generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const jsonPath = resolve(options.outputDir, `work-verification-${timestamp}.json`);
  const markdownPath = resolve(options.outputDir, `work-verification-${timestamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, markdown(packet), "utf8");
  writeFileSync(resolve(options.outputDir, "work-verification-latest.json"), `${JSON.stringify({ ...packet, artifactPath: repoRelative(options.repoRoot, jsonPath), markdownPath: repoRelative(options.repoRoot, markdownPath) }, null, 2)}\n`, "utf8");
  return { jsonPath, markdownPath };
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    const packet = buildPacket(options);
    const artifacts = options.write ? writeArtifacts(options, packet) : null;
    if (options.json || !options.write) {
      process.stdout.write(`${JSON.stringify(artifacts ? { ...packet, artifacts: packet.artifacts, outputArtifacts: artifacts } : packet, null, 2)}\n`);
    } else {
      process.stdout.write(`work verification packet: ${packet.status}, slices=${packet.summary.sliceCount}, warnings=${packet.warnings.length}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

export {
  artifactEvidence,
  buildPacket,
  main,
  parseArgs,
  statusFromSummary
};

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
