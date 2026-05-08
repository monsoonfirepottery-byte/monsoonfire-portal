#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "dependency-remediation");

function usage() {
  return `Dependency remediation packet

Usage:
  node scripts/ops/dependency_remediation_packet.mjs [--json] [--write]

Options:
  --json                 Print JSON.
  --write                Write latest JSON and Markdown artifacts.
  --workspace <path>     Workspace to audit. Default: repo root.
  --output-dir <path>    Artifact directory. Default: output/ops/dependency-remediation.
  --include-moderate     Include moderate vulnerabilities. Default: high and critical only.
  --skip-npm-view        Skip read-only npm registry latest-version hints.
`;
}

function parseArgs(argv) {
  const options = {
    json: false,
    write: false,
    workspace: ".",
    outputDir: DEFAULT_OUTPUT_DIR,
    includeModerate: false,
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
    if (arg === "--include-moderate") {
      options.includeModerate = true;
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

function firstLines(text, maxLines = 4) {
  return String(text || "").split(/\r?\n/).filter(Boolean).slice(0, maxLines).join("\n");
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
    error: result.status === 0 || audit.vulnerabilities ? "" : firstLines(result.stderr || result.error),
    audit
  };
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

function npmLatest(packageName, enabled) {
  if (!enabled || !packageName || packageName === "(root)") return { status: "skipped", version: "" };
  const result = run("npm", ["view", packageName, "version", "--json"], { timeoutMs: 60_000 });
  if (result.status !== 0) {
    return { status: "unavailable", version: "", error: firstLines(result.stderr || result.error, 2) };
  }
  const parsed = safeJsonParse(result.stdout, "");
  return { status: "ok", version: Array.isArray(parsed) ? parsed.at(-1) || "" : String(parsed || "").replace(/^"|"$/g, "") };
}

function normalizeVia(via) {
  return (Array.isArray(via) ? via : []).map((item) => {
    if (typeof item === "string") return { name: item };
    return {
      name: item.name || "",
      title: item.title || "",
      url: item.url || "",
      severity: item.severity || "",
      range: item.range || "",
      cwe: item.cwe || []
    };
  });
}

function majorOf(version) {
  const match = String(version || "").match(/^v?(\d+)/);
  return match ? Number(match[1]) : null;
}

function requestedMajorRange(spec) {
  const text = String(spec || "").trim();
  const match = text.match(/(?:\^|~|>=|>|=)?\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

function compatibilityNotes(chain, latestHints) {
  const notes = [];
  for (let index = 1; index < chain.length; index += 1) {
    const node = chain[index];
    const parent = chain[index - 1];
    const requested = parent?.dependencies?.[node.name] || "";
    const hint = latestHints[node.name];
    const latestMajor = majorOf(hint?.version);
    const requestedMajor = requestedMajorRange(requested);
    if (hint?.status !== "ok" || latestMajor === null || requestedMajor === null) continue;
    if (latestMajor !== requestedMajor) {
      notes.push({
        package: node.name,
        currentVersion: node.version || "",
        latestVersion: hint.version,
        requestedBy: parent.name,
        requestedRange: requested,
        risk: "major_mismatch",
        note: `Latest ${node.name}@${hint.version} is outside ${parent.name}'s requested range ${requested}. Treat overrides as higher risk and require owner-tool smoke tests.`
      });
    }
  }
  return notes;
}

function buildFindings(audit, lock, options) {
  const graph = buildLockGraph(lock);
  const allowed = new Set(options.includeModerate ? ["moderate", "high", "critical"] : ["high", "critical"]);
  return Object.values(audit.vulnerabilities || {})
    .filter((vulnerability) => allowed.has(vulnerability.severity))
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.name.localeCompare(b.name))
    .map((vulnerability) => {
      const chain = shortestChainTo(graph, vulnerability.name);
      const directOwner = chain.find((node, index) => index > 0 && (chain[0].dependencies || {})[node.name]) || chain[1] || null;
      const nearestParent = chain.length > 1 ? chain[chain.length - 2] : null;
      const packagesForHints = [...new Set([directOwner?.name, nearestParent?.name, vulnerability.name].filter(Boolean))];
      const latestHints = Object.fromEntries(packagesForHints.map((name) => [name, npmLatest(name, options.npmView)]));
      const compatibility = compatibilityNotes(chain, latestHints);
      return {
        name: vulnerability.name,
        severity: vulnerability.severity,
        isDirect: Boolean(vulnerability.isDirect),
        range: vulnerability.range || "",
        fixAvailable: vulnerability.fixAvailable ?? false,
        nodes: vulnerability.nodes || [],
        via: normalizeVia(vulnerability.via),
        chain: chain.map((node, index) => ({
          name: node.name,
          version: node.version,
          path: node.path || "(root)",
          requested: chain[index - 1]?.dependencies?.[node.name] || ""
        })),
        directOwner: directOwner ? { name: directOwner.name, version: directOwner.version } : null,
        nearestParent: nearestParent ? { name: nearestParent.name, version: nearestParent.version } : null,
        latestHints,
        compatibility
      };
    });
}

function severityRank(severity) {
  return { low: 1, moderate: 2, high: 3, critical: 4 }[severity] || 0;
}

function statusFor(findings, auditResult) {
  if (auditResult.status === "audit_error") return "unknown";
  if (findings.some((finding) => finding.severity === "critical")) return "critical";
  if (findings.some((finding) => finding.severity === "high")) return "warning";
  return "ok";
}

function markdown(report) {
  const lines = [
    "# Dependency Remediation Packet",
    "",
    `Generated: ${report.generatedAt}`,
    `Workspace: \`${report.workspace}\``,
    `Status: \`${report.status}\``,
    "",
    "This packet is read-only. It does not install, update, override, or remove dependencies.",
    ""
  ];
  if (report.findings.length === 0) {
    lines.push("No high or critical dependency remediation candidates were found.");
    return `${lines.join("\n")}\n`;
  }
  for (const finding of report.findings) {
    lines.push(`## ${finding.severity.toUpperCase()}: ${finding.name}`);
    lines.push("");
    lines.push(`- Affected range: \`${finding.range || "unknown"}\``);
    lines.push(`- Direct dependency: \`${finding.isDirect ? "yes" : "no"}\``);
    lines.push(`- npm fixAvailable: \`${JSON.stringify(finding.fixAvailable)}\``);
    if (finding.directOwner) lines.push(`- Root-level owner candidate: \`${finding.directOwner.name}@${finding.directOwner.version || "unknown"}\``);
    if (finding.nearestParent) lines.push(`- Nearest parent candidate: \`${finding.nearestParent.name}@${finding.nearestParent.version || "unknown"}\``);
    lines.push("");
    lines.push("### Evidence");
    lines.push("");
    for (const via of finding.via) {
      if (via.title) lines.push(`- ${via.title} (${via.url || "no advisory URL"})`);
    }
    lines.push("");
    lines.push("Dependency chain:");
    lines.push("");
    for (const [index, node] of finding.chain.entries()) {
      const request = node.requested ? ` requested \`${node.requested}\`` : "";
      lines.push(`${index + 1}. \`${node.name}@${node.version || "unknown"}\`${request}`);
    }
    lines.push("");
    lines.push("Latest-version hints:");
    lines.push("");
    for (const [name, hint] of Object.entries(finding.latestHints)) {
      lines.push(`- \`${name}\`: ${hint.status === "ok" ? `latest \`${hint.version}\`` : `\`${hint.status}\``}`);
    }
    lines.push("");
    if (finding.compatibility?.length) {
      lines.push("Compatibility notes:");
      lines.push("");
      for (const note of finding.compatibility) {
        lines.push(`- \`${note.package}\`: ${note.note}`);
      }
      lines.push("");
    }
    lines.push("### Recommended Safe Next Step");
    lines.push("");
    if (finding.isDirect) {
      lines.push("- Open a small dependency PR updating the direct dependency to a patched version, then run the relevant workspace tests and `npm audit --package-lock-only --json`.");
    } else {
      lines.push("- Prefer an upstream owner-package bump first. If the chain remains vulnerable, test an npm `overrides` candidate in a throwaway branch and verify the owning tool still works before proposing a PR.");
    }
    lines.push("");
    lines.push("### Rollback Notes");
    lines.push("");
    lines.push("- Revert the dependency PR or remove the tested override and restore the prior lockfile. No host mutation is required.");
    lines.push("");
    lines.push("### Issue-Ready Acceptance Criteria");
    lines.push("");
    lines.push("- `npm audit --package-lock-only --json` no longer reports this package in the audited workspace.");
    lines.push("- The dependency chain is documented in the PR body.");
    lines.push("- Relevant tool smoke checks pass, especially for the root-level owner package.");
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packageLockPath = resolve(options.workspaceDir, "package-lock.json");
  if (!existsSync(packageLockPath)) {
    throw new Error(`No package-lock.json found in ${repoRelative(options.workspaceDir)}.`);
  }
  const auditResult = auditWorkspace(options.workspaceDir);
  const lock = readJson(packageLockPath, {});
  const findings = buildFindings(auditResult.audit || {}, lock, options);
  const report = {
    generatedAt: new Date().toISOString(),
    workspace: repoRelative(options.workspaceDir),
    packageLock: repoRelative(packageLockPath),
    auditStatus: auditResult.status,
    auditExitStatus: auditResult.exitStatus,
    auditError: auditResult.error,
    status: statusFor(findings, auditResult),
    findings
  };
  const reportMarkdown = markdown(report);
  if (options.write) {
    mkdirSync(options.outputDir, { recursive: true });
    writeFileSync(resolve(options.outputDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(resolve(options.outputDir, "latest.md"), reportMarkdown);
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(reportMarkdown);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`dependency remediation packet failed: ${error.message}\n`);
  process.exit(1);
}
