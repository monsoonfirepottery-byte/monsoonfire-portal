#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "tooling-quality");
const MODES = new Set(["all", "shell-lf", "shellcheck", "powershell", "sqlfluff", "actionlint", "compose-config"]);

function usage() {
  return `Studio Brain ops tooling quality report

Usage:
  node scripts/ops/tooling_quality_report.mjs [--mode all] [--json] [--write]

Options:
  --mode <mode>       all, shell-lf, shellcheck, powershell, sqlfluff, actionlint, compose-config. Default: all.
  --json              Print JSON to stdout.
  --write             Write JSON and Markdown artifacts under output/ops/tooling-quality.
  --output-dir <path> Artifact directory.
  --allow-install     Allow npx/uv tool runners when a validator is not already on PATH.
  --limit <number>    Limit files per mode for quick smoke checks.
`;
}

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function repoRelative(path) {
  return relative(REPO_ROOT, path).replace(/\\/g, "/");
}

function parseArgs(argv) {
  const options = {
    mode: "all",
    json: false,
    write: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    allowInstall: false,
    limit: 0
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
    if (arg === "--allow-install") {
      options.allowInstall = true;
      continue;
    }
    if (arg === "--mode") {
      options.mode = clean(argv[++index]);
      continue;
    }
    if (arg.startsWith("--mode=")) {
      options.mode = clean(arg.slice("--mode=".length));
      continue;
    }
    if (arg === "--output-dir") {
      options.outputDir = resolve(REPO_ROOT, clean(argv[++index]));
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      options.outputDir = resolve(REPO_ROOT, clean(arg.slice("--output-dir=".length)));
      continue;
    }
    if (arg === "--limit") {
      options.limit = Math.max(0, Number(argv[++index]) || 0);
      continue;
    }
    if (arg.startsWith("--limit=")) {
      options.limit = Math.max(0, Number(arg.slice("--limit=".length)) || 0);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!MODES.has(options.mode)) throw new Error(`Invalid mode: ${options.mode}`);
  return options;
}

function run(command, args, options = {}) {
  const invocation = commandInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeoutMs ?? 30_000
  });
  return {
    command: [command, ...args].join(" "),
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: clean(result.stdout).slice(0, options.maxOutput ?? 8000),
    stderr: clean(result.stderr).slice(0, options.maxOutput ?? 8000),
    error: result.error?.message || ""
  };
}

function commandInvocation(command, args) {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", ["call", cmdQuote(command), ...args.map(cmdQuote)].join(" ")]
    };
  }
  return { command, args };
}

function cmdQuote(value) {
  const raw = String(value);
  if (/^[A-Za-z0-9_./:\\=+-]+$/.test(raw)) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

function commandPaths(command) {
  const probe = process.platform === "win32"
    ? run("where", [command], { timeoutMs: 5000 })
    : run("sh", ["-lc", `command -v ${shellQuote(command)}`], { timeoutMs: 5000 });
  if (!probe.ok) return [];
  return `${probe.stdout}\n${probe.stderr}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function commandExists(command) {
  return commandPaths(command).length > 0;
}

function commandExecutable(command) {
  const paths = commandPaths(command);
  if (paths.length === 0) return command;
  if (process.platform === "win32") {
    return paths.find((path) => /\.(exe|cmd|bat)$/i.test(path)) || paths[0];
  }
  return paths[0] || command;
}

function gitFiles(predicate) {
  const result = run("git", ["ls-files"], { timeoutMs: 10_000, maxOutput: 200_000 });
  if (!result.ok) throw new Error(result.stderr || result.error || "git ls-files failed");
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).filter(predicate);
}

function limited(files, limit) {
  return limit > 0 ? files.slice(0, limit) : files;
}

function shellLfReport(options) {
  const files = limited(gitFiles((file) => file.endsWith(".sh")), options.limit);
  const offenders = [];
  for (const file of files) {
    const content = readFileSync(resolve(REPO_ROOT, file));
    if (content.includes(13)) offenders.push(file);
  }
  return {
    id: "shell-lf",
    status: offenders.length > 0 ? "fail" : "pass",
    tool: "node",
    checkedFiles: files.length,
    findings: offenders.map((file) => ({ file, code: "CRLF", message: "Shell script contains CRLF bytes; Ubuntu scripts should be LF-only." }))
  };
}

function shellcheckReport(options) {
  const files = limited(gitFiles((file) => file.endsWith(".sh")), options.limit);
  if (files.length === 0) return { id: "shellcheck", status: "pass", tool: "shellcheck", checkedFiles: 0, findings: [] };
  let command = "";
  let args = [];
  if (commandExists("shellcheck")) {
    command = commandExecutable("shellcheck");
    args = ["-f", "json", "-S", "warning", ...files];
  } else if (options.allowInstall && commandExists("npx")) {
    command = commandExecutable("npx");
    args = ["--yes", "shellcheck", "-f", "json", "-S", "warning", ...files];
  } else {
    return {
      id: "shellcheck",
      status: "skipped",
      tool: "shellcheck",
      checkedFiles: 0,
      findings: [{ code: "tool_missing", message: "shellcheck is not installed; rerun with --allow-install to use npx shellcheck." }]
    };
  }
  const result = run(command, args, { timeoutMs: 120_000, maxOutput: 30_000 });
  const findings = parseShellCheckJson(result.stdout || result.stderr);
  if (!result.ok && findings.length === 0) {
    findings.push({ code: "shellcheck_failed", message: result.error || `shellcheck exited ${result.status} without output` });
  }
  return {
    id: "shellcheck",
    status: result.ok ? "pass" : "warn",
    tool: args[0] === "--yes" ? "npx shellcheck" : "shellcheck",
    checkedFiles: files.length,
    command: result.command,
    findings,
    ...(result.ok || findings.length > 0 ? {} : { outputPreview: (result.stdout || result.stderr).slice(0, 12000) })
  };
}

function parseShellCheckOutput(output) {
  const lines = clean(output).split(/\r?\n/);
  const findings = [];
  let current = null;
  for (const line of lines) {
    const location = /^In (.+) line (\d+):$/.exec(line.trim());
    if (location) {
      current = { file: location[1], line: Number(location[2]) };
      continue;
    }
    const diagnostic = /SC(\d+)\s+\(([^)]+)\):\s+(.+)$/.exec(line);
    if (!diagnostic) continue;
    findings.push({
      file: current?.file,
      line: current?.line,
      code: `SC${diagnostic[1]}`,
      severity: diagnostic[2],
      message: diagnostic[3]
    });
    if (findings.length >= 200) break;
  }
  return findings;
}

function parseShellCheckJson(output) {
  const value = clean(output);
  if (!value) return [];
  try {
    return JSON.parse(value).slice(0, 200).map((finding) => ({
      file: finding.file,
      line: finding.line,
      column: finding.column,
      code: `SC${finding.code}`,
      severity: finding.level,
      message: finding.message
    }));
  } catch {
    return parseShellCheckOutput(value);
  }
}

function powershellSyntaxReport(options) {
  const files = limited(gitFiles((file) => file.endsWith(".ps1")), options.limit);
  const shell = commandExists("pwsh") ? commandExecutable("pwsh") : commandExists("powershell") ? commandExecutable("powershell") : "";
  if (!shell) {
    return {
      id: "powershell",
      status: "skipped",
      tool: "pwsh",
      checkedFiles: 0,
      findings: [{ code: "tool_missing", message: "pwsh or powershell is not installed." }]
    };
  }
  const findings = [];
  for (const file of files) {
    const pathLiteral = resolve(REPO_ROOT, file).replace(/'/g, "''");
    const result = run(shell, [
      "-NoProfile",
      "-Command",
      `$ErrorActionPreference='Stop'; [scriptblock]::Create([IO.File]::ReadAllText('${pathLiteral}')) > $null`
    ], { timeoutMs: 10_000, maxOutput: 6000 });
    if (!result.ok) findings.push({ file, code: "parse_error", message: result.stderr || result.stdout || result.error || "PowerShell parse failed." });
  }
  return {
    id: "powershell",
    status: findings.length > 0 ? "fail" : "pass",
    tool: shell,
    checkedFiles: files.length,
    findings
  };
}

function sqlfluffReport(options) {
  const files = limited(gitFiles((file) => file.endsWith(".sql")), options.limit);
  if (files.length === 0) return { id: "sqlfluff", status: "pass", tool: "sqlfluff", checkedFiles: 0, findings: [] };
  let command = "";
  let baseArgs = [];
  if (commandExists("sqlfluff")) {
    command = commandExecutable("sqlfluff");
    baseArgs = ["parse", "--dialect", "postgres", "--format", "none"];
  } else if (options.allowInstall && commandExists("uv")) {
    command = commandExecutable("uv");
    baseArgs = ["tool", "run", "--from", "sqlfluff", "sqlfluff", "parse", "--dialect", "postgres", "--format", "none"];
  } else {
    return {
      id: "sqlfluff",
      status: "skipped",
      tool: "sqlfluff",
      checkedFiles: 0,
      findings: [{ code: "tool_missing", message: "sqlfluff is not installed; rerun with --allow-install to use uv tool run." }]
    };
  }
  const findings = [];
  for (const file of files) {
    const result = run(command, [...baseArgs, file], { timeoutMs: 60_000, maxOutput: 8000 });
    if (!result.ok) findings.push({ file, code: "parse_error", message: result.stderr || result.stdout || result.error || "SQL parse failed." });
  }
  return {
    id: "sqlfluff",
    status: findings.length > 0 ? "warn" : "pass",
    tool: baseArgs[0] === "tool" ? "uv sqlfluff" : "sqlfluff",
    checkedFiles: files.length,
    findings
  };
}

function parseActionlintOutput(output) {
  const findings = [];
  for (const line of clean(output).split(/\r?\n/)) {
    const match = /^(.+?):(\d+):(\d+):\s+(.+?)(?:\s+\[([^\]]+)])?$/.exec(line.trim());
    if (!match) continue;
    findings.push({
      file: match[1],
      line: Number(match[2]),
      column: Number(match[3]),
      code: match[5] || "actionlint",
      message: match[4]
    });
    if (findings.length >= 200) break;
  }
  return findings;
}

function actionlintReport(options) {
  const files = limited(gitFiles((file) => /^\.github\/workflows\/.+\.ya?ml$/i.test(file)), options.limit);
  if (files.length === 0) return { id: "actionlint", status: "pass", tool: "actionlint", checkedFiles: 0, findings: [] };
  let command = "";
  let args = [];
  let tool = "actionlint";
  if (commandExists("actionlint")) {
    command = commandExecutable("actionlint");
    args = files;
  } else if (options.allowInstall && commandExists("go")) {
    command = commandExecutable("go");
    args = ["run", "github.com/rhysd/actionlint/cmd/actionlint@latest", ...files];
    tool = "go run actionlint";
  } else {
    return {
      id: "actionlint",
      status: "skipped",
      tool: "actionlint",
      checkedFiles: 0,
      findings: [{ code: "tool_missing", message: "actionlint is not installed; rerun with --allow-install to use go run actionlint when Go is available." }]
    };
  }
  const result = run(command, args, { timeoutMs: 120_000, maxOutput: 40_000 });
  const findings = parseActionlintOutput(`${result.stdout}\n${result.stderr}`);
  if (!result.ok && findings.length === 0) {
    findings.push({ code: "actionlint_failed", message: result.error || `actionlint exited ${result.status} without parseable findings` });
  }
  return {
    id: "actionlint",
    status: findings.length > 0 ? "warn" : "pass",
    tool,
    checkedFiles: files.length,
    command: result.command,
    findings,
    ...(result.ok || findings.length > 0 ? {} : { outputPreview: (result.stdout || result.stderr).slice(0, 12000) })
  };
}

function composeConfigReport(options) {
  const files = limited(gitFiles((file) => /(^|\/)(docker-compose|compose)(\.[^/]+)?\.ya?ml$/i.test(file)), options.limit);
  if (files.length === 0) return { id: "compose-config", status: "pass", tool: "docker compose", checkedFiles: 0, findings: [] };
  if (!commandExists("docker")) {
    return {
      id: "compose-config",
      status: "skipped",
      tool: "docker compose",
      checkedFiles: 0,
      findings: [{ code: "tool_missing", message: `docker is not installed; ${files.length} compose file(s) were not rendered.` }]
    };
  }
  const command = commandExecutable("docker");
  const findings = [];
  for (const file of files) {
    const result = run(command, ["compose", "-f", file, "config", "--quiet"], { timeoutMs: 60_000, maxOutput: 12_000 });
    if (!result.ok) {
      findings.push({
        file,
        code: "compose_config_failed",
        message: result.stderr || result.stdout || result.error || "docker compose config failed."
      });
    }
  }
  return {
    id: "compose-config",
    status: findings.length > 0 ? "warn" : "pass",
    tool: "docker compose config --quiet",
    checkedFiles: files.length,
    findings
  };
}

function statusFromSections(sections) {
  if (sections.some((section) => section.status === "fail")) return "fail";
  if (sections.some((section) => section.status === "warn" || section.status === "skipped")) return "warn";
  return "pass";
}

function markdown(report) {
  const lines = [
    "# Studio Brain Ops Tooling Quality Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status}`,
    `Mode: ${report.mode}`,
    `Allow install: ${report.allowInstall}`,
    "",
    "## Summary",
    "",
    `- Checked files: ${report.summary.checkedFiles}`,
    `- Findings: ${report.summary.findings}`,
    `- Skipped sections: ${report.summary.skipped}`,
    ""
  ];
  for (const section of report.sections) {
    lines.push(`## ${section.id}`, "", `- Status: ${section.status}`, `- Tool: ${section.tool}`, `- Checked files: ${section.checkedFiles}`, `- Findings: ${section.findings.length}`, "");
    for (const finding of section.findings.slice(0, 20)) {
      lines.push(`- ${finding.file ? `${finding.file}: ` : ""}${finding.code}: ${clean(finding.message)}`);
    }
    if (section.findings.length > 20) lines.push(`- ... ${section.findings.length - 20} more findings omitted from Markdown preview.`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function writeArtifacts(options, report) {
  mkdirSync(options.outputDir, { recursive: true });
  const timestamp = report.generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const jsonPath = resolve(options.outputDir, `tooling-quality-${timestamp}.json`);
  const markdownPath = resolve(options.outputDir, `tooling-quality-${timestamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, markdown(report), "utf8");
  writeFileSync(resolve(options.outputDir, "tooling-quality-latest.json"), `${JSON.stringify({ ...report, artifactPath: repoRelative(jsonPath), markdownPath: repoRelative(markdownPath) }, null, 2)}\n`, "utf8");
  return { jsonPath, markdownPath };
}

function buildReport(options) {
  const sections = [];
  if (options.mode === "all" || options.mode === "shell-lf") sections.push(shellLfReport(options));
  if (options.mode === "all" || options.mode === "shellcheck") sections.push(shellcheckReport(options));
  if (options.mode === "all" || options.mode === "powershell") sections.push(powershellSyntaxReport(options));
  if (options.mode === "all" || options.mode === "sqlfluff") sections.push(sqlfluffReport(options));
  if (options.mode === "all" || options.mode === "actionlint") sections.push(actionlintReport(options));
  if (options.mode === "all" || options.mode === "compose-config") sections.push(composeConfigReport(options));
  const summary = {
    checkedFiles: sections.reduce((sum, section) => sum + section.checkedFiles, 0),
    findings: sections.reduce((sum, section) => sum + section.findings.length, 0),
    skipped: sections.filter((section) => section.status === "skipped").length
  };
  return {
    schema: "studiobrain-ops-tooling-quality-report.v1",
    generatedAt: nowIso(),
    mode: options.mode,
    allowInstall: options.allowInstall,
    status: statusFromSections(sections),
    summary,
    sections
  };
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    const report = buildReport(options);
    const artifacts = options.write ? writeArtifacts(options, report) : null;
    if (options.json || !options.write) {
      process.stdout.write(`${JSON.stringify(artifacts ? { ...report, artifacts } : report, null, 2)}\n`);
    } else {
      process.stdout.write(`tooling quality report: ${report.status}, findings=${report.summary.findings}, skipped=${report.summary.skipped}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

export {
  buildReport,
  main,
  parseArgs,
  parseActionlintOutput,
  parseShellCheckJson,
  statusFromSections
};

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
