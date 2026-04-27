#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const generatedPolicy = [
  {
    prefix: "output/",
    policy: "ignored-with-tracked-legacy",
    reason: "Routine QA, smoke, audit, and local verification output is ignored; existing tracked output/ evidence is legacy and should not grow.",
  },
  {
    prefix: "web/.lighthouseci/",
    policy: "ignored",
    reason: "Local Lighthouse cache.",
  },
  {
    prefix: ".tmp/",
    policy: "ignored",
    reason: "Local scratch output.",
  },
  {
    prefix: "studio-brain/lib/",
    policy: "tracked-intentional",
    reason: "Compiled Studio Brain runtime mirror. Build checks can update it, so run branch-moving checks separately.",
  },
  {
    prefix: "docs/generated/",
    policy: "tracked-intentional",
    reason: "Generated docs that act as reviewed source-of-truth snapshots.",
  },
  {
    prefix: "artifacts/",
    policy: "tracked-selective",
    reason: "Only stable latest/evidence snapshots should be tracked; run-scoped artifacts stay ignored.",
  },
  {
    prefix: "test-results/",
    policy: "tracked-legacy-review",
    reason: "Tracked historical visual evidence. New test output should prefer ignored output/ paths.",
  },
];

const packageDirs = [".", "web", "functions", "studio-brain", "codex-agents"];
const workflowDir = resolve(repoRoot, ".github", "workflows");

function parseArgs(argv) {
  const args = {
    json: false,
    strict: false,
    artifact: "output/qa/repo-agentic-health-inventory.json",
    markdown: "output/qa/repo-agentic-health-inventory.md",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--strict") {
      args.strict = true;
      continue;
    }
    if (arg === "--artifact" && argv[index + 1]) {
      args.artifact = String(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      args.artifact = arg.slice("--artifact=".length);
      continue;
    }
    if (arg === "--markdown" && argv[index + 1]) {
      args.markdown = String(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--markdown=")) {
      args.markdown = arg.slice("--markdown=".length);
      continue;
    }
    if (arg === "--no-markdown") {
      args.markdown = "";
      continue;
    }
  }

  return args;
}

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr || "").trim()}`);
  }
  return String(result.stdout || "");
}

function parseNulPaths(raw) {
  return String(raw || "").split("\0").map((entry) => entry.trim()).filter(Boolean);
}

function toRepoPath(path) {
  return relative(repoRoot, path).replace(/\\/g, "/");
}

function classifySurface(path) {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("web/src/") || normalized.startsWith("functions/src/") || normalized.startsWith("studio-brain/src/")) {
    return "production source";
  }
  if (normalized.startsWith("website/") || normalized.startsWith("web/public/")) {
    return "production source";
  }
  if (normalized.startsWith(".github/") || normalized.startsWith("scripts/") || normalized.startsWith("functions/scripts/") || normalized.startsWith("website/scripts/") || normalized.startsWith("studio-brain/scripts/")) {
    return "ops automation";
  }
  if (normalized.startsWith("codex-agents/") || normalized.includes("/codex/") || normalized.startsWith(".codex/")) {
    return "agentic/harness tooling";
  }
  if (normalized.startsWith("docs/") || normalized.startsWith("tickets/") || normalized.startsWith("contracts/") || normalized.endsWith(".md")) {
    return "docs/tickets/contracts";
  }
  if (generatedPolicy.some((entry) => normalized.startsWith(entry.prefix))) {
    return "generated artifact";
  }
  if (normalized.includes("/archive/") || normalized.startsWith("archive/")) {
    return "archive";
  }
  return "unknown-owner";
}

function classifyGeneratedPolicy(path) {
  const normalized = path.replace(/\\/g, "/");
  return generatedPolicy.find((entry) => normalized.startsWith(entry.prefix)) || null;
}

function loadPackageScripts() {
  const scripts = [];
  for (const dir of packageDirs) {
    const packagePath = resolve(repoRoot, dir, "package.json");
    if (!existsSync(packagePath)) continue;
    const parsed = JSON.parse(readFileSync(packagePath, "utf8"));
    for (const [name, command] of Object.entries(parsed.scripts || {})) {
      scripts.push(classifyScript(dir, name, String(command || "")));
    }
  }
  return scripts;
}

function classifyScript(packageDir, name, command) {
  const text = `${name} ${command}`.toLowerCase();
  const sideEffects = [];
  if (/\bdeploy\b|firebase-tools deploy|\bscp\b|\bssh\b|namecheap/.test(text)) sideEffects.push("deploy/live remote");
  if (/--live-(write|mutation)\b|:prod\b/.test(text)) sideEffects.push("live data write/probe");
  if (/--apply\b|:apply\b|\bapply\b/.test(text)) sideEffects.push("apply mode");
  if (/github|gh issue|issues?: write|pull-requests?: write|open-issue|close-issue/.test(text)) sideEffects.push("github write");
  if (/git push|git checkout|git switch|update-branch|branch:|worktree/.test(text)) sideEffects.push("branch/remote");
  if (/rm -rf|cleanup|delete|prune|remove/.test(text)) sideEffects.push("cleanup/delete");
  if (/secret|credential|token|oauth|auth-provider|service-account/.test(text)) sideEffects.push("secret/auth");
  if (/import|ingest|sync|seed|write-state|persist/.test(text)) sideEffects.push("data import/sync");

  const defaultMode = command.includes("--dry-run")
    ? "dry-run"
    : command.includes("--apply")
      ? "apply"
      : /deploy|:live|:prod|:apply/.test(name)
        ? "live/apply"
        : "read-only-or-build";

  return {
    packageDir,
    name,
    command,
    owner: inferOwner(name, command, packageDir),
    surface: inferSurface(name, command, packageDir),
    defaultMode,
    sideEffects: Array.from(new Set(sideEffects)),
    hasDryRunFlag: /--dry-run|--no-github|--no-apply|--no-live|--skip/.test(command),
  };
}

function inferOwner(name, command, packageDir) {
  const text = `${packageDir} ${name} ${command}`.toLowerCase();
  if (text.includes("studio") || text.includes("studiobrain")) return "Studio Brain";
  if (text.includes("website") || text.includes("marketing") || text.includes("ga:")) return "website";
  if (text.includes("portal") || text.includes("web")) return "portal";
  if (text.includes("functions") || text.includes("firestore") || text.includes("firebase")) return "functions/firestore";
  if (text.includes("codex") || text.includes("open-memory") || text.includes("mail:")) return "agentic harness";
  return packageDir === "." ? "repo root" : packageDir;
}

function inferSurface(name, command, packageDir) {
  const text = `${packageDir} ${name} ${command}`.toLowerCase();
  if (text.includes("deploy")) return "deploy";
  if (text.includes("smoke") || text.includes("canary") || text.includes("gate")) return "qa gate";
  if (text.includes("secret") || text.includes("credential") || text.includes("auth")) return "auth/secrets";
  if (text.includes("codex") || text.includes("open-memory") || text.includes("automation")) return "agentic automation";
  if (text.includes("build") || text.includes("lint") || text.includes("test")) return "build/test";
  return "general";
}

function listWorkflowFiles() {
  if (!existsSync(workflowDir)) return [];
  return readdirSync(workflowDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ya?ml)$/i.test(entry.name))
    .map((entry) => resolve(workflowDir, entry.name));
}

function scanWorkflows() {
  return listWorkflowFiles().map((file) => {
    const text = readFileSync(file, "utf8");
    const permissions = [];
    const dispatchInputs = [];
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const permissionMatch = line.match(/^\s{2,}([a-z-]+):\s*(read|write|none)\s*$/);
      if (permissionMatch) {
        permissions.push({ line: index + 1, scope: permissionMatch[1], access: permissionMatch[2] });
      }
      if (/^\s{6,}[a-zA-Z0-9_-]+:\s*$/.test(line)) {
        dispatchInputs.push({ line: index + 1, raw: line.trim().replace(/:$/, "") });
      }
    }

    const mutatingTokens = [];
    if (text.includes("--apply")) mutatingTokens.push("--apply");
    if (text.includes("contents: write")) mutatingTokens.push("contents: write");
    if (text.includes("issues: write")) mutatingTokens.push("issues: write");
    if (text.includes("pull-requests: write")) mutatingTokens.push("pull-requests: write");
    if (/workflow_dispatch:/m.test(text)) mutatingTokens.push("workflow_dispatch");
    const dryRunDefault = /default:\s*false/.test(text) && /apply:/.test(text);
    const sideEffectComment = /side-effects?:/i.test(text) || /mutates?:/i.test(text);

    return {
      file: toRepoPath(file),
      workflowDispatch: /workflow_dispatch:/m.test(text),
      permissions,
      writePermissions: permissions.filter((entry) => entry.access === "write"),
      mutatingTokens: Array.from(new Set(mutatingTokens)),
      dryRunDefault,
      sideEffectComment,
      dispatchInputs,
    };
  });
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Repo Agentic Health Inventory");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Tracked Surface Summary");
  lines.push("");
  lines.push("| Surface | Files |");
  lines.push("| --- | ---: |");
  for (const [surface, count] of Object.entries(report.summary.surfaces)) {
    lines.push(`| ${surface} | ${count} |`);
  }
  lines.push("");
  lines.push("## Generated Artifact Policy Classes");
  lines.push("");
  lines.push("| Prefix | Policy | Tracked files | Reason |");
  lines.push("| --- | --- | ---: | --- |");
  for (const row of report.generatedArtifacts.policy) {
    lines.push(`| \`${row.prefix}\` | ${row.policy} | ${row.trackedCount} | ${row.reason} |`);
  }
  lines.push("");
  lines.push("## Root Script Side Effects");
  lines.push("");
  lines.push("| Script | Default | Side effects | Owner |");
  lines.push("| --- | --- | --- | --- |");
  for (const script of report.packageScripts.rootHighRisk.slice(0, 80)) {
    lines.push(`| \`${script.name}\` | ${script.defaultMode} | ${script.sideEffects.join(", ")} | ${script.owner} |`);
  }
  lines.push("");
  lines.push("## Workflow Mutation Review");
  lines.push("");
  lines.push("| Workflow | Write permissions | Mutating tokens | Dry-run default | Side-effect metadata |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const workflow of report.workflows.highRisk) {
    lines.push(
      `| \`${workflow.file}\` | ${workflow.writePermissions.map((entry) => `${entry.scope}: ${entry.access}`).join(", ") || "none"} | ${workflow.mutatingTokens.join(", ") || "none"} | ${workflow.dryRunDefault ? "yes" : "no/unknown"} | ${workflow.sideEffectComment ? "yes" : "no"} |`
    );
  }
  lines.push("");
  lines.push("Refresh with `npm run audit:agentic:inventory`.");
  lines.push("");
  return `${lines.join("\n")}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const trackedFiles = parseNulPaths(runGit(["ls-files", "-z"]));
  const surfaces = {};
  const generatedRows = generatedPolicy.map((entry) => ({ ...entry, trackedCount: 0, examples: [] }));

  for (const file of trackedFiles) {
    const surface = classifySurface(file);
    surfaces[surface] = (surfaces[surface] || 0) + 1;
    const policy = classifyGeneratedPolicy(file);
    if (policy) {
      const row = generatedRows.find((entry) => entry.prefix === policy.prefix);
      row.trackedCount += 1;
      if (row.examples.length < 12) row.examples.push(file);
    }
  }

  const scripts = loadPackageScripts();
  const rootScripts = scripts.filter((script) => script.packageDir === ".");
  const workflows = scanWorkflows();

  const report = {
    schema: "repo-agentic-health-inventory-v1",
    generatedAt: new Date().toISOString(),
    status: "pass",
    strict: args.strict,
    summary: {
      trackedFiles: trackedFiles.length,
      surfaces,
      packageScripts: scripts.length,
      rootPackageScripts: rootScripts.length,
      highRiskRootScripts: rootScripts.filter((script) => script.sideEffects.length > 0).length,
      workflows: workflows.length,
      highRiskWorkflows: workflows.filter((workflow) => workflow.writePermissions.length > 0 || workflow.mutatingTokens.includes("--apply")).length,
    },
    generatedArtifacts: {
      policy: generatedRows,
    },
    packageScripts: {
      all: scripts,
      rootHighRisk: rootScripts.filter((script) => script.sideEffects.length > 0),
      commonAuditSafeCommands: [
        "npm run guard:ephemeral:artifacts",
        "npm run audit:agentic:inventory",
        "npm run audit:write-surfaces",
        "npm run audit:branch-guard",
        "npm run portal:index:guard",
        "npm run firestore:rules:sync:check",
      ],
    },
    workflows: {
      all: workflows,
      highRisk: workflows.filter((workflow) => workflow.writePermissions.length > 0 || workflow.mutatingTokens.includes("--apply")),
    },
  };

  const artifactPath = resolve(repoRoot, args.artifact);
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (args.markdown) {
    const markdownPath = resolve(repoRoot, args.markdown);
    mkdirSync(dirname(markdownPath), { recursive: true });
    writeFileSync(markdownPath, buildMarkdown(report), "utf8");
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`repo-agentic-health-inventory: ${report.status}\n`);
    process.stdout.write(`tracked files: ${report.summary.trackedFiles}\n`);
    process.stdout.write(`root scripts: ${report.summary.rootPackageScripts}\n`);
    process.stdout.write(`high-risk workflows: ${report.summary.highRiskWorkflows}\n`);
    process.stdout.write(`artifact: ${artifactPath}\n`);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`repo-agentic-health-inventory failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
