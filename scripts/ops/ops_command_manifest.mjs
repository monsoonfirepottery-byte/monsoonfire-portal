#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseMakefile,
  parsePackageScripts,
  parseReadme,
  referencedOpsScripts
} from "./command_surface_guard.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "command-manifest");

function nowIso() {
  return new Date().toISOString();
}

function repoRelative(path) {
  return relative(REPO_ROOT, path).replace(/\\/g, "/");
}

function readText(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readText(path));
  } catch {
    return fallback;
  }
}

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function usage() {
  return `Studio Brain ops command manifest

Usage:
  node scripts/ops/ops_command_manifest.mjs [--json] [--write] [--check]

Options:
  --json                 Print JSON to stdout.
  --write                Write timestamped JSON and Markdown artifacts.
  --check                Exit non-zero only for manifest integrity failures.
  --output-dir <path>    Artifact directory. Default: output/ops/command-manifest.
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
    check: false,
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
    if (arg === "--check") {
      options.check = true;
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
  options.runId ||= `command-manifest-${nowIso().replace(/[:.]/g, "-")}`;
  return options;
}

function parseMakeRecipes(makeText, targets) {
  const recipes = new Map();
  const targetSet = new Set(targets);
  let current = "";
  let lines = [];

  function flush() {
    if (current) recipes.set(current, lines.join("\n"));
    current = "";
    lines = [];
  }

  for (const rawLine of makeText.split(/\n/)) {
    const line = rawLine.replace(/\r$/, "");
    const targetMatch = line.match(/^([A-Za-z0-9_.:-]+):(?:\s|$)/);
    if (targetMatch) {
      flush();
      current = targetSet.has(targetMatch[1]) ? targetMatch[1] : "";
      lines = [];
      continue;
    }
    if (current) lines.push(line);
  }
  flush();
  return recipes;
}

function inferApprovalClass(command, recipe, scriptRefs) {
  const text = `${command} ${recipe} ${scriptRefs.join(" ")}`.toLowerCase();
  if (text.includes("privileged_evidence_capture.sh") && !text.includes("--smoke")) {
    return "human_approval_required";
  }
  if (text.includes("post_deploy_verify") || text.includes("incident_bundle")) {
    return "read_only_live_probe";
  }
  if (text.includes("psql") || text.includes("postgres_")) {
    return "read_only_database";
  }
  if (text.includes("docker")) {
    return "read_only_docker";
  }
  if (text.includes("backup") || text.includes("restore")) {
    return "read_only_backup_evidence";
  }
  return "read_only_local";
}

function inferLane(command, recipe, scriptRefs) {
  const text = `${command} ${recipe} ${scriptRefs.join(" ")}`.toLowerCase();
  if (text.includes("postgres") || text.includes("pg_")) return "postgres";
  if (text.includes("docker")) return "docker";
  if (text.includes("backup") || text.includes("restore") || text.includes("redis") || text.includes("minio")) return "backup";
  if (text.includes("dependency") || text.includes("npm_audit")) return "dependency";
  if (text.includes("privileged") || text.includes("sudo") || text.includes("host") || text.includes("systemd") || text.includes("ubuntu") || text.includes("network") || text.includes("time_sync")) return "ubuntu";
  if (text.includes("incident") || text.includes("post_deploy") || text.includes("evidence") || text.includes("effectivity")) return "sre";
  if (text.includes("pr-stack") || text.includes("proactive") || text.includes("work-packet") || text.includes("slice")) return "automation";
  return "ops";
}

function normalizeProducerPolicies(raw) {
  if (Array.isArray(raw?.producers)) return raw.producers;
  if (raw?.producers && typeof raw.producers === "object") {
    return Object.entries(raw.producers).map(([id, value]) => ({ id, ...value }));
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw).map(([id, value]) => ({ id, ...value }));
  }
  return [];
}

function buildManifest() {
  const makePath = resolve(REPO_ROOT, "Makefile");
  const packagePath = resolve(REPO_ROOT, "package.json");
  const readmePath = resolve(REPO_ROOT, "docs", "ops", "README.md");
  const producerPath = resolve(REPO_ROOT, "docs", "ops", "output-artifact-producers.json");

  const makeText = readText(makePath);
  const packageText = readText(packagePath);
  const readmeText = readText(readmePath);
  const producers = normalizeProducerPolicies(readJson(producerPath, { producers: [] }));

  const makefile = parseMakefile(makeText);
  const packageScripts = parsePackageScripts(packageText);
  const readme = parseReadme(readmeText);
  const recipes = parseMakeRecipes(makeText, makefile.targets);
  const packageScriptByName = new Map((packageScripts.scripts || []).map((script) => [script.name, script]));
  const readmeMake = new Set(readme.makeCommands);
  const readmeNpm = new Set(readme.npmCommands);
  const readmeDirect = new Set(readme.directCommands);
  const findings = [];

  const commands = makefile.targets.map((target) => {
    const recipe = recipes.get(target) || "";
    const scriptRefs = referencedOpsScripts(recipe);
    const npmWrappers = (packageScripts.scripts || [])
      .filter((script) => scriptRefs.some((ref) => script.command.includes(ref)))
      .map((script) => script.name)
      .sort();
    const producerMatches = producers
      .filter((producer) => {
        const haystack = `${target} ${recipe} ${scriptRefs.join(" ")}`.toLowerCase();
        return haystack.includes(String(producer.id || "").toLowerCase());
      })
      .map((producer) => ({
        id: producer.id,
        outputPath: producer.outputPath || producer.path || "",
        refreshCommand: producer.refreshCommand || "",
        freshnessDays: producer.freshnessDays ?? null,
        retentionClass: producer.retentionClass || producer.retention || "unspecified"
      }));

    return {
      name: target,
      lane: inferLane(target, recipe, scriptRefs),
      sources: ["Makefile"],
      documented: readmeMake.has(target),
      npmWrappers,
      directScriptRefs: scriptRefs,
      directScriptsDocumented: scriptRefs.filter((ref) => readmeDirect.has(ref)),
      approvalClass: inferApprovalClass(target, recipe, scriptRefs),
      producerPolicies: producerMatches
    };
  });

  const makeCommandByName = new Map(commands.map((command) => [command.name, command]));
  for (const npmCommand of readme.npmCommands) {
    if (!packageScriptByName.has(npmCommand)) {
      findings.push({
        severity: "high",
        id: "documented-npm-command-missing",
        title: "Documented npm command is absent from package.json",
        evidence: npmCommand,
        recommendedAction: "Add the package.json script or remove the stale docs entry."
      });
    }
  }

  for (const target of readme.makeCommands) {
    if (!makeCommandByName.has(target)) {
      findings.push({
        severity: "high",
        id: "documented-make-command-missing",
        title: "Documented Make command is absent from Makefile",
        evidence: target,
        recommendedAction: "Add the Make target or remove the stale docs entry."
      });
    }
  }

  for (const directCommand of readme.directCommands) {
    if (!existsSync(resolve(REPO_ROOT, directCommand))) {
      findings.push({
        severity: "high",
        id: "documented-direct-script-missing",
        title: "Documented direct ops script is missing",
        evidence: directCommand,
        recommendedAction: "Restore the script or update docs/ops/README.md."
      });
    }
  }

  const undocumentedMakeTargets = commands.filter((command) => !command.documented);
  const approvalGated = commands.filter((command) => command.approvalClass === "human_approval_required");
  const byLane = {};
  for (const command of commands) {
    byLane[command.lane] ||= 0;
    byLane[command.lane] += 1;
  }

  const status = findings.some((finding) => finding.severity === "high") ? "warning" : "ok";
  return {
    schema: "studio-brain-ops-command-manifest.v1",
    generatedAt: nowIso(),
    status,
    summary: {
      makeTargets: commands.length,
      npmOpsScripts: packageScripts.scripts?.length || 0,
      documentedMakeTargets: commands.filter((command) => command.documented).length,
      undocumentedMakeTargets: undocumentedMakeTargets.length,
      documentedNpmCommands: readme.npmCommands.length,
      documentedDirectCommands: readme.directCommands.length,
      approvalGatedCommands: approvalGated.length,
      producerPolicies: producers.length,
      highFindings: findings.filter((finding) => finding.severity === "high").length,
      byLane
    },
    commands,
    npmOnlyCommands: (packageScripts.scripts || [])
      .filter((script) => !commands.some((command) => command.npmWrappers.includes(script.name)))
      .map((script) => ({
        name: script.name,
        documented: readmeNpm.has(script.name),
        directScriptRefs: referencedOpsScripts(script.command)
      })),
    producerPolicies: producers.map((producer) => ({
      id: producer.id,
      outputPath: producer.outputPath || producer.path || "",
      refreshCommand: producer.refreshCommand || "",
      freshnessDays: producer.freshnessDays ?? null,
      retentionClass: producer.retentionClass || producer.retention || "unspecified"
    })),
    findings
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Ops Command Manifest",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Status: ${report.status}`,
    "",
    "## Summary",
    "",
    `- Make targets: ${report.summary.makeTargets}`,
    `- npm ops scripts: ${report.summary.npmOpsScripts}`,
    `- documented Make targets: ${report.summary.documentedMakeTargets}`,
    `- undocumented Make targets: ${report.summary.undocumentedMakeTargets}`,
    `- documented npm commands: ${report.summary.documentedNpmCommands}`,
    `- documented direct commands: ${report.summary.documentedDirectCommands}`,
    `- approval-gated commands: ${report.summary.approvalGatedCommands}`,
    `- producer policies: ${report.summary.producerPolicies}`,
    `- high findings: ${report.summary.highFindings}`,
    "",
    "## Lanes",
    ""
  ];

  for (const [lane, count] of Object.entries(report.summary.byLane).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`- ${lane}: ${count}`);
  }

  lines.push("", "## Commands", "");
  for (const command of report.commands) {
    const docs = command.documented ? "documented" : "not in quick docs";
    const scripts = command.directScriptRefs.length ? command.directScriptRefs.join(", ") : "none";
    const wrappers = command.npmWrappers.length ? command.npmWrappers.join(", ") : "none";
    lines.push(`- \`${command.name}\` (${command.lane}, ${command.approvalClass}, ${docs})`);
    lines.push(`  - scripts: ${scripts}`);
    lines.push(`  - npm wrappers: ${wrappers}`);
  }

  lines.push("", "## Findings", "");
  if (!report.findings.length) {
    lines.push("No manifest integrity findings.");
  } else {
    for (const finding of report.findings) {
      lines.push(`### [${finding.severity.toUpperCase()}] ${finding.title}`);
      lines.push("");
      lines.push(`- Evidence: ${finding.evidence}`);
      lines.push(`- Recommended action: ${finding.recommendedAction}`);
      lines.push("");
    }
  }

  lines.push("", "## Safety Notes", "");
  lines.push("- This manifest is read-only and does not run host, Docker, PostgreSQL, package, deploy, cleanup, or privileged commands.");
  lines.push("- Approval-gated commands are cataloged so they remain visible, not so agents can execute them.");
  lines.push("- Rollback is reverting the script, wrappers, and generated output artifacts.");
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

export { buildManifest, renderMarkdown };

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = buildManifest();
  if (options.write) report.artifacts = writeArtifacts(report, options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(renderMarkdown(report));
  }
  if (options.check && report.status !== "ok") process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`ops command manifest failed: ${clean(error.message)}\n`);
    process.exitCode = 2;
  }
}
