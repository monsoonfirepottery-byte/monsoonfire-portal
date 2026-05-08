#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "dependency-upstream-watch");

function usage() {
  return `Dependency upstream watch

Usage:
  node scripts/ops/dependency_upstream_watch.mjs [--json] [--write]

Options:
  --json                 Print JSON.
  --write                Write latest JSON and Markdown artifacts.
  --workspace <path>     Workspace to audit. Default: repo root.
  --output-dir <path>    Artifact directory. Default: output/ops/dependency-upstream-watch.
  --skip-npm-view        Skip read-only npm registry version lookups.
`;
}

function parseArgs(argv) {
  const options = {
    json: false,
    write: false,
    workspace: ".",
    outputDir: DEFAULT_OUTPUT_DIR,
    npmView: true
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
    if (arg === "--skip-npm-view") {
      options.npmView = false;
      continue;
    }
    if (arg === "--workspace" || arg === "--output-dir") {
      if (!argv[index + 1]) throw new Error(`${arg} requires a value.`);
      options[arg === "--workspace" ? "workspace" : "outputDir"] = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--workspace=")) {
      options.workspace = arg.slice("--workspace=".length);
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      options.outputDir = arg.slice("--output-dir=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  options.workspaceDir = resolve(REPO_ROOT, options.workspace);
  options.outputDir = resolve(REPO_ROOT, options.outputDir);
  return options;
}

function windowsCommand(command) {
  if (process.platform !== "win32") return command;
  if (command === "npm") return "npm.cmd";
  return command;
}

function windowsShellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function run(command, args, options = {}) {
  const resolved = windowsCommand(command);
  const useCmdShim = process.platform === "win32" && /\.cmd$/i.test(resolved);
  const actualCommand = useCmdShim ? "cmd.exe" : resolved;
  const actualArgs = useCmdShim ? ["/d", "/s", "/c", [resolved, ...args].map(windowsShellQuote).join(" ")] : args;
  const result = spawnSync(actualCommand, actualArgs, {
    cwd: options.cwd || REPO_ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeoutMs || 120_000
  });
  return {
    status: result.status ?? null,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error?.message || ""
  };
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw || "");
  } catch {
    return fallback;
  }
}

function repoRelative(path) {
  return relative(REPO_ROOT, path).replace(/\\/g, "/") || ".";
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return safeJsonParse(readFileSync(path, "utf8"), fallback);
}

function auditWorkspace(workspaceDir) {
  const result = run("npm", ["audit", "--package-lock-only", "--json"], {
    cwd: workspaceDir,
    timeoutMs: 120_000
  });
  const audit = safeJsonParse(result.stdout, {});
  return {
    status: result.status === 0 ? "clean" : audit.vulnerabilities ? "vulnerabilities_found" : "audit_error",
    exitStatus: result.status,
    audit,
    error: result.status === 0 || audit.vulnerabilities ? "" : firstLines(result.stderr || result.error)
  };
}

function firstLines(text, maxLines = 4) {
  return String(text || "").split(/\r?\n/).filter(Boolean).slice(0, maxLines).join("\n");
}

function packageNameFromPath(path) {
  if (!path) return "(root)";
  const parts = path.split("node_modules/");
  const last = parts[parts.length - 1];
  if (!last) return "";
  const segments = last.split("/");
  return last.startsWith("@") ? `${segments[0]}/${segments[1]}` : segments[0];
}

function buildLockGraph(lock) {
  const packages = lock.packages && typeof lock.packages === "object" ? lock.packages : {};
  const nodes = Object.entries(packages).map(([path, meta]) => ({
    path,
    name: path ? meta.name || packageNameFromPath(path) : "(root)",
    version: meta.version || "",
    dependencies: {
      ...(meta.dependencies || {}),
      ...(meta.devDependencies || {}),
      ...(meta.optionalDependencies || {}),
      ...(meta.peerDependencies || {})
    }
  }));
  const byName = new Map();
  for (const node of nodes) {
    if (!byName.has(node.name)) byName.set(node.name, []);
    byName.get(node.name).push(node);
  }
  return { nodes, byName };
}

function shortestChainTo(graph, targetName) {
  const root = graph.nodes.find((node) => node.path === "");
  if (!root) return [];
  const queue = [{ node: root, chain: [root] }];
  const visited = new Set([root.path]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (current.node.name === targetName && current.node.path !== "") return current.chain;
    for (const depName of Object.keys(current.node.dependencies || {})) {
      for (const candidate of graph.byName.get(depName) || []) {
        if (visited.has(candidate.path)) continue;
        visited.add(candidate.path);
        queue.push({ node: candidate, chain: [...current.chain, candidate] });
      }
    }
  }
  return [];
}

function majorOf(version) {
  const match = String(version || "").match(/^v?(\d+)/);
  return match ? Number(match[1]) : null;
}

function compareVersions(a, b) {
  const left = String(a || "").split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const right = String(b || "").split(/[.-]/).map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const l = Number.isFinite(left[index]) ? left[index] : 0;
    const r = Number.isFinite(right[index]) ? right[index] : 0;
    if (l !== r) return l - r;
  }
  return 0;
}

function requestedMajorRange(spec) {
  const match = String(spec || "").trim().match(/(?:\^|~|>=|>|=)?\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

function registryVersions(packageName, enabled) {
  if (!enabled || !packageName || packageName === "(root)") return { status: "skipped", versions: [] };
  const result = run("npm", ["view", packageName, "versions", "--json"], { timeoutMs: 60_000 });
  if (result.status !== 0) {
    return { status: "unavailable", versions: [], error: firstLines(result.stderr || result.error, 2) };
  }
  const parsed = safeJsonParse(result.stdout, []);
  return { status: "ok", versions: (Array.isArray(parsed) ? parsed : [parsed]).map(String).sort(compareVersions) };
}

function versionFacts(node, parent, registry) {
  const versions = registry.versions || [];
  const latest = versions.at(-1) || "";
  const currentMajor = majorOf(node.version);
  const requestedMajor = requestedMajorRange(parent?.dependencies?.[node.name] || "");
  const latestSameMajor = versions.filter((version) => majorOf(version) === currentMajor).at(-1) || "";
  const latestRequestedMajor = versions.filter((version) => majorOf(version) === requestedMajor).at(-1) || "";
  return {
    name: node.name,
    currentVersion: node.version || "",
    requestedBy: parent?.name || "",
    requestedRange: parent?.dependencies?.[node.name] || "",
    registryStatus: registry.status,
    latest,
    latestSameMajor,
    latestRequestedMajor,
    latestMajor: majorOf(latest),
    requestedMajor,
    majorMismatch: latest && requestedMajor !== null && majorOf(latest) !== requestedMajor
  };
}

function advisoryUrls(vulnerability) {
  return (Array.isArray(vulnerability.via) ? vulnerability.via : [])
    .filter((item) => item && typeof item === "object")
    .map((item) => item.url)
    .filter(Boolean)
    .slice(0, 5);
}

function watchItems(audit, lock, options) {
  const graph = buildLockGraph(lock);
  const vulnerabilities = audit.vulnerabilities && typeof audit.vulnerabilities === "object" ? audit.vulnerabilities : {};
  return Object.values(vulnerabilities)
    .filter((vulnerability) => vulnerability.severity === "high" || vulnerability.severity === "critical")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((vulnerability) => {
      const chain = shortestChainTo(graph, vulnerability.name);
      const registryByName = new Map(chain.slice(1).map((node) => [node.name, registryVersions(node.name, options.npmView)]));
      const facts = chain.slice(1).map((node, index) => versionFacts(node, chain[index], registryByName.get(node.name) || { status: "skipped", versions: [] }));
      const vulnerableFact = facts.find((fact) => fact.name === vulnerability.name);
      const blockingFacts = facts.filter((fact) => fact.majorMismatch);
      let classification = "unknown";
      if (!options.npmView) classification = "registry_lookup_skipped";
      else if (vulnerableFact?.latestRequestedMajor && compareVersions(vulnerableFact.latestRequestedMajor, vulnerableFact.currentVersion) > 0) classification = "lockfile_refresh_candidate";
      else if (blockingFacts.length > 0) classification = "override_or_upstream_wait";
      else if (vulnerableFact?.latest && compareVersions(vulnerableFact.latest, vulnerableFact.currentVersion) > 0) classification = "normal_update_candidate";
      else classification = "no_safe_upstream_candidate";
      return {
        name: vulnerability.name,
        severity: vulnerability.severity,
        range: vulnerability.range || "",
        fixAvailable: vulnerability.fixAvailable ?? false,
        advisories: advisoryUrls(vulnerability),
        classification,
        chain: chain.map((node, index) => ({
          name: node.name,
          version: node.version || "",
          requested: chain[index - 1]?.dependencies?.[node.name] || ""
        })),
        versionFacts: facts,
        safeNextStep: safeNextStep(classification)
      };
    });
}

function safeNextStep(classification) {
  if (classification === "normal_update_candidate") {
    return "Open a small dependency PR for the owner package and verify npm audit plus relevant tool smoke checks.";
  }
  if (classification === "lockfile_refresh_candidate") {
    return "Open a small lockfile-only transitive refresh PR and verify npm audit plus relevant owner-tool smoke checks.";
  }
  if (classification === "override_or_upstream_wait") {
    return "Do not apply a blind override. Track upstream parent-package movement or test an override only in a throwaway branch with owner-tool smoke checks.";
  }
  if (classification === "registry_lookup_skipped") {
    return "Re-run without --skip-npm-view when registry access is available.";
  }
  return "Keep this as an accepted-risk watch item until upstream exposes a compatible patched path.";
}

function statusFor(items, auditResult) {
  if (auditResult.status === "audit_error") return "unknown";
  if (items.length === 0) return "ok";
  if (items.some((item) => item.classification === "normal_update_candidate" || item.classification === "lockfile_refresh_candidate")) return "actionable";
  return "watch";
}

function markdown(report) {
  const lines = [
    "# Dependency Upstream Watch",
    "",
    `Generated: ${report.generatedAt}`,
    `Workspace: \`${report.workspace}\``,
    `Status: \`${report.status}\``,
    "",
    "This packet is read-only. It does not install, update, override, or remove dependencies.",
    ""
  ];
  if (report.items.length === 0) {
    lines.push("No high or critical upstream watch items were found.");
    return `${lines.join("\n")}\n`;
  }
  for (const item of report.items) {
    lines.push(`## ${item.severity.toUpperCase()}: ${item.name}`);
    lines.push("");
    lines.push(`- Classification: \`${item.classification}\``);
    lines.push(`- Affected range: \`${item.range || "unknown"}\``);
    lines.push(`- Safe next step: ${item.safeNextStep}`);
    lines.push("");
    lines.push("Dependency chain:");
    lines.push("");
    for (const [index, node] of item.chain.entries()) {
      const requested = node.requested ? ` requested \`${node.requested}\`` : "";
      lines.push(`${index + 1}. \`${node.name}@${node.version || "unknown"}\`${requested}`);
    }
    lines.push("");
    lines.push("Registry watch:");
    lines.push("");
    for (const fact of item.versionFacts) {
      lines.push(`- \`${fact.name}\`: current \`${fact.currentVersion || "unknown"}\`, requested \`${fact.requestedRange || "n/a"}\`, latest \`${fact.latest || fact.registryStatus}\`, latest same major \`${fact.latestSameMajor || "none"}\`${fact.majorMismatch ? ", major mismatch" : ""}`);
    }
    lines.push("");
    lines.push("Rollback notes: revert any future dependency PR or override PR; this watcher itself has no host or lockfile side effects.");
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packageLockPath = resolve(options.workspaceDir, "package-lock.json");
  if (!existsSync(packageLockPath)) throw new Error(`No package-lock.json found in ${repoRelative(options.workspaceDir)}.`);
  const auditResult = auditWorkspace(options.workspaceDir);
  const lock = readJson(packageLockPath, {});
  const items = watchItems(auditResult.audit || {}, lock, options);
  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    workspace: repoRelative(options.workspaceDir),
    packageLock: repoRelative(packageLockPath),
    auditStatus: auditResult.status,
    auditExitStatus: auditResult.exitStatus,
    auditError: auditResult.error,
    status: statusFor(items, auditResult),
    items
  };
  const reportMarkdown = markdown(report);
  if (options.write) {
    mkdirSync(options.outputDir, { recursive: true });
    writeFileSync(resolve(options.outputDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(resolve(options.outputDir, "latest.md"), reportMarkdown);
  }
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(reportMarkdown);
}

try {
  main();
} catch (error) {
  process.stderr.write(`dependency upstream watch failed: ${error.message}\n`);
  process.exit(1);
}
