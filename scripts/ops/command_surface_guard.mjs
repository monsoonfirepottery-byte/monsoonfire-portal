#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "command-surface-guard");

function nowIso() {
  return new Date().toISOString();
}

function repoRelative(path) {
  return relative(REPO_ROOT, path).replace(/\\/g, "/");
}

function readText(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function usage() {
  return `Studio Brain ops command surface guard

Usage:
  node scripts/ops/command_surface_guard.mjs [--json] [--write]

Options:
  --json                 Print JSON to stdout.
  --write                Write timestamped JSON and Markdown artifacts.
  --output-dir <path>    Artifact directory. Default: output/ops/command-surface-guard.
  --run-id <id>          Stable run id.
`;
}

function readFlagValue(argv, index, name) {
  const arg = argv[index];
  if (arg === name) {
    if (!argv[index + 1]) throw new Error(`${name} requires a value.`);
    return { matched: true, value: argv[index + 1], nextIndex: index + 1 };
  }
  if (arg.startsWith(`${name}=`)) {
    return { matched: true, value: arg.slice(name.length + 1), nextIndex: index };
  }
  return { matched: false, value: "", nextIndex: index };
}

function parseArgs(argv) {
  const options = {
    json: false,
    write: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    runId: ""
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
    const mappings = [["--output-dir", "outputDir"], ["--run-id", "runId"]];
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
    throw new Error(`Unknown argument: ${arg}`);
  }
  options.outputDir = resolve(REPO_ROOT, options.outputDir);
  options.runId ||= `command-surface-${nowIso().replace(/[:.]/g, "-")}`;
  return options;
}

export function parseMakefile(text) {
  const targets = new Set();
  const phony = new Set();
  for (const rawLine of text.split(/\n/)) {
    const line = rawLine.replace(/\r$/, "");
    const phonyMatch = line.match(/^\.PHONY:\s*(.+)$/);
    if (phonyMatch) {
      for (const token of phonyMatch[1].trim().split(/\s+/)) {
        if (token.startsWith("ops-")) phony.add(token);
      }
      continue;
    }
    const targetMatch = line.match(/^([A-Za-z0-9_.:-]+):(?:\s|$)/);
    if (targetMatch && targetMatch[1].startsWith("ops-")) {
      targets.add(targetMatch[1]);
    }
  }
  return { targets: [...targets].sort(), phony: [...phony].sort() };
}

export function parsePackageScripts(text) {
  if (!text) return { ok: false, error: "package.json missing", scripts: [] };
  try {
    const parsed = JSON.parse(text);
    const scripts = Object.entries(parsed.scripts || {})
      .filter(([name]) => name.startsWith("ops:"))
      .map(([name, command]) => ({ name, command: String(command) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, error: "", scripts };
  } catch (error) {
    return { ok: false, error: error.message, scripts: [] };
  }
}

export function parseReadme(text) {
  const makeCommands = new Set();
  const npmCommands = new Set();
  const directCommands = new Set();
  for (const line of text.split(/\n/)) {
    const makeMatch = line.match(/\bmake\s+(ops-[A-Za-z0-9_.:-]+)/);
    if (makeMatch) makeCommands.add(makeMatch[1]);
    const npmMatch = line.match(/\bnpm\s+run\s+([A-Za-z0-9_.:-]+)/);
    if (npmMatch) npmCommands.add(npmMatch[1]);
    const directMatch = line.match(/\b(?:bash|node)\s+((?:\.\/)?scripts\/ops\/[A-Za-z0-9_.:/-]+\.(?:sh|mjs|sql))/);
    if (directMatch) directCommands.add(directMatch[1].replace(/^\.\//, ""));
  }
  return {
    makeCommands: [...makeCommands].sort(),
    npmCommands: [...npmCommands].sort(),
    directCommands: [...directCommands].sort()
  };
}

export function referencedOpsScripts(text) {
  const refs = new Set();
  const pattern = /(?:\.\/)?scripts\/ops\/[A-Za-z0-9_.:/-]+\.(?:sh|mjs|sql)/g;
  for (const match of text.matchAll(pattern)) {
    refs.add(match[0].replace(/^\.\//, ""));
  }
  return [...refs].sort();
}

function makeFinding(severity, id, title, component, evidence, impact, action) {
  return { severity, id, title, component, evidence, impact, recommendedAction: action };
}

function buildReport() {
  const makePath = resolve(REPO_ROOT, "Makefile");
  const packagePath = resolve(REPO_ROOT, "package.json");
  const readmePath = resolve(REPO_ROOT, "docs", "ops", "README.md");

  const makeText = readText(makePath);
  const packageText = readText(packagePath);
  const readmeText = readText(readmePath);

  const makefile = parseMakefile(makeText);
  const packageScripts = parsePackageScripts(packageText);
  const readme = parseReadme(readmeText);

  const findings = [];
  const makeTargets = new Set(makefile.targets);
  const makePhony = new Set(makefile.phony);
  const readmeMake = new Set(readme.makeCommands);
  const readmeNpm = new Set(readme.npmCommands);

  for (const target of makefile.targets) {
    if (!makePhony.has(target)) {
      findings.push(makeFinding("high", "make-target-not-phony", "Ops Make target is missing from .PHONY", "Makefile", `${target} has a recipe but is not listed in .PHONY.`, "A file with the same name can shadow the command and confuse operators.", "Add the target to the .PHONY ops command list."));
    }
  }

  for (const target of makefile.phony) {
    if (!makeTargets.has(target)) {
      findings.push(makeFinding("high", "phony-target-missing-recipe", "Ops .PHONY target has no recipe", "Makefile", `${target} is listed in .PHONY but has no target recipe.`, "Operators may see a documented command that make cannot execute.", "Add the recipe or remove the stale .PHONY entry."));
    }
  }

  for (const command of readme.makeCommands) {
    if (!makeTargets.has(command)) {
      findings.push(makeFinding("high", "readme-make-command-missing", "README documents missing Make target", "docs/ops/README.md", `${command} is listed in docs but is not defined in Makefile.`, "Operators may copy a command that fails immediately.", "Add the Make target or update the README command list."));
    }
  }

  if (!packageScripts.ok) {
    findings.push(makeFinding("high", "package-json-unreadable", "package.json scripts cannot be inspected", "package.json", packageScripts.error, "Documented npm commands cannot be verified.", "Fix package.json parsing before changing documented npm commands."));
  }

  const npmOpsNames = new Set(packageScripts.scripts.map((script) => script.name));
  for (const command of readme.npmCommands) {
    if (!npmOpsNames.has(command)) {
      findings.push(makeFinding("high", "readme-npm-command-missing", "README documents missing npm script", "docs/ops/README.md", `${command} is listed in docs but is not defined in package.json scripts.`, "Windows-friendly operator commands can fail immediately.", "Add the package.json script or update the README npm command list."));
    }
  }

  const internalMakeTargets = new Set(["ops-postgres-sql", "ops-docs", "ops-backlog"]);
  for (const target of makefile.targets) {
    if (!readmeMake.has(target) && !internalMakeTargets.has(target)) {
      findings.push(makeFinding("medium", "make-target-undocumented", "Ops Make target is not listed in docs", "Makefile/docs/ops/README.md", `${target} is defined in Makefile but absent from the README command list.`, "Useful diagnostics can be hidden from the operator runbook.", "Add the target to docs/ops/README.md or classify it as internal in this guard."));
    }
  }

  const references = [
    ...referencedOpsScripts(makeText).map((path) => ({ source: "Makefile", path })),
    ...referencedOpsScripts(packageText).map((path) => ({ source: "package.json", path })),
    ...readme.directCommands.map((path) => ({ source: "docs/ops/README.md", path }))
  ];
  const seenReference = new Set();
  for (const reference of references) {
    const key = `${reference.source}:${reference.path}`;
    if (seenReference.has(key)) continue;
    seenReference.add(key);
    if (!existsSync(resolve(REPO_ROOT, reference.path))) {
      findings.push(makeFinding("high", "referenced-script-missing", "Command surface references a missing ops script", reference.source, `${reference.path} does not exist.`, "Operators or CI can fail on stale command references.", "Fix the path or remove the stale command reference."));
    }
  }

  for (const script of packageScripts.scripts) {
    const directRefs = referencedOpsScripts(script.command);
    if (directRefs.length === 0) continue;
    const hasMakeWrapper = makefile.targets.some((target) => {
      const recipePattern = new RegExp(`^${target}:\\s*$[\\s\\S]*?\\n(?=\\S|$)`, "m");
      const block = makeText.match(recipePattern)?.[0] || "";
      return directRefs.some((ref) => block.includes(ref));
    });
    if (!hasMakeWrapper) {
      findings.push(makeFinding("medium", "npm-ops-script-without-make-wrapper", "npm ops script has no obvious Make wrapper", "package.json/Makefile", `${script.name} calls ${directRefs.join(", ")} without an obvious Make target wrapper.`, "The documented operator interface can drift toward npm-only commands.", "Add a Make wrapper when this command should be part of the standard ops surface."));
    }
  }

  for (const command of readmeNpm) {
    const script = packageScripts.scripts.find((candidate) => candidate.name === command);
    if (!script) continue;
    for (const ref of referencedOpsScripts(script.command)) {
      if (!existsSync(resolve(REPO_ROOT, ref))) {
        findings.push(makeFinding("high", "documented-npm-script-target-missing", "Documented npm command references a missing ops script", "package.json/docs/ops/README.md", `${command} references ${ref}, which does not exist.`, "The documented npm fallback can fail even though the script name exists.", "Fix the package.json command path or restore the referenced script."));
      }
    }
  }

  const status = findings.some((finding) => finding.severity === "high")
    ? "warning"
    : findings.some((finding) => finding.severity === "medium")
      ? "advisory"
      : "ok";

  return {
    schema: "studio-brain-ops-command-surface-guard.v1",
    generatedAt: nowIso(),
    status,
    summary: {
      makeTargets: makefile.targets.length,
      makePhony: makefile.phony.length,
      npmOpsScripts: npmOpsNames.size,
      readmeMakeCommands: readme.makeCommands.length,
      readmeNpmCommands: readme.npmCommands.length,
      readmeDirectCommands: readme.directCommands.length,
      highFindings: findings.filter((finding) => finding.severity === "high").length,
      mediumFindings: findings.filter((finding) => finding.severity === "medium").length
    },
    surfaces: {
      makefile,
      packageScripts,
      readme
    },
    findings
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Ops Command Surface Guard",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Status: ${report.status}`,
    "",
    "## Summary",
    "",
    `- Make targets: ${report.summary.makeTargets}`,
    `- .PHONY ops entries: ${report.summary.makePhony}`,
    `- npm ops scripts: ${report.summary.npmOpsScripts}`,
    `- README make commands: ${report.summary.readmeMakeCommands}`,
    `- README npm commands: ${report.summary.readmeNpmCommands}`,
    `- README direct commands: ${report.summary.readmeDirectCommands}`,
    `- High findings: ${report.summary.highFindings}`,
    `- Medium findings: ${report.summary.mediumFindings}`,
    "",
    "## Findings",
    ""
  ];

  if (report.findings.length === 0) {
    lines.push("No command-surface drift found.");
  } else {
    for (const finding of report.findings) {
      lines.push(`### [${finding.severity.toUpperCase()}] ${finding.title}`);
      lines.push("");
      lines.push(`- Component: ${finding.component}`);
      lines.push(`- Evidence: ${finding.evidence}`);
      lines.push(`- Likely impact: ${finding.impact}`);
      lines.push(`- Recommended action: ${finding.recommendedAction}`);
      lines.push("");
    }
  }

  lines.push("## Safety Notes");
  lines.push("");
  lines.push("- This check is read-only and does not run host, Docker, PostgreSQL, package update, or deploy commands.");
  lines.push("- Findings are documentation and wrapper drift only; fixes should stay in small PRs.");
  lines.push("- Rollback is removing the generated output artifacts or reverting the wrapper/doc edits.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function writeArtifacts(report, options) {
  mkdirSync(options.outputDir, { recursive: true });
  const jsonPath = resolve(options.outputDir, `${options.runId}.json`);
  const mdPath = resolve(options.outputDir, `${options.runId}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, renderMarkdown(report));
  writeFileSync(resolve(options.outputDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolve(options.outputDir, "latest.md"), renderMarkdown(report));
  return { jsonPath: repoRelative(jsonPath), markdownPath: repoRelative(mdPath) };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = buildReport();
  if (options.write) {
    report.artifacts = writeArtifacts(report, options);
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(renderMarkdown(report));
  }
  if (report.status === "warning") process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`command surface guard failed: ${clean(error.message)}\n`);
    process.exitCode = 2;
  }
}
