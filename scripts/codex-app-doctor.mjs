#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compareSemver, resolveCodexCliCandidates } from "./lib/codex-cli-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_ARTIFACT = "output/codex-app-doctor/latest.json";
const RECOMMENDED_MIN_CLI = "0.124.0";
const RECOMMENDED_MIN_APP_PREFIX = "26.415";

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanProcessOutput(value) {
  return clean(String(value || "").replace(/\0/g, ""));
}

function parseArgs(argv) {
  const parsed = {
    json: false,
    strict: false,
    artifact: DEFAULT_ARTIFACT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }
    if (arg === "--artifact" && argv[index + 1]) {
      parsed.artifact = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      parsed.artifact = arg.slice("--artifact=".length);
      continue;
    }
  }

  return parsed;
}

function safeReadText(path) {
  if (!path || !existsSync(path)) return "";
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function safeListDir(path) {
  if (!path || !existsSync(path)) return [];
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

function findFirstExisting(paths) {
  return paths.find((path) => path && existsSync(path)) || null;
}

function compareDottedVersion(left, right) {
  const leftParts = clean(left).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = clean(right).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] || 0;
    const rightPart = rightParts[index] || 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  return 0;
}

function listMatchingDescendants(root, matcher, limit = 24) {
  const output = [];
  const stack = [root];
  const seen = new Set();
  while (stack.length > 0 && output.length < limit) {
    const current = stack.pop();
    if (!current || seen.has(current) || !existsSync(current)) continue;
    seen.add(current);
    for (const entry of safeListDir(current)) {
      const child = join(current, entry.name);
      if (matcher(child, entry)) output.push(child);
      if (entry.isDirectory() && output.length < limit) stack.push(child);
    }
  }
  return output;
}

function readWindowsAppPackageInfo({ platform = process.platform } = {}) {
  if (platform !== "win32") {
    return {
      available: false,
      reason: "not_windows",
      package: null,
    };
  }

  try {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Get-AppxPackage -Name OpenAI.Codex | Select-Object Name,Version,PackageFullName,InstallLocation | ConvertTo-Json -Compress",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      },
    );
    const parsed = JSON.parse(clean(output) || "null");
    if (!parsed) {
      return {
        available: false,
        reason: "package_not_found",
        package: null,
      };
    }
    return {
      available: true,
      reason: "",
      package: {
        name: clean(parsed.Name),
        version: clean(parsed.Version),
        packageFullName: clean(parsed.PackageFullName),
        installLocation: clean(parsed.InstallLocation),
      },
    };
  } catch (error) {
    return {
      available: false,
      reason: "package_query_failed",
      error: error instanceof Error ? error.message : String(error),
      package: null,
    };
  }
}

function inspectCodexConfigs({ repoRoot = REPO_ROOT, home = homedir() } = {}) {
  const configPaths = [
    resolve(home, ".codex", "config.toml"),
    resolve(repoRoot, ".codex", "config.toml"),
  ];
  const servers = new Set();
  const findings = [];
  for (const configPath of configPaths) {
    const content = safeReadText(configPath);
    if (!content) {
      findings.push({ path: configPath, exists: false, servers: [] });
      continue;
    }
    const matches = [
      ...new Set(
        [...content.matchAll(/^\s*\[mcp_servers\.([^\]\s]+)\]\s*$/gm)]
          .map((match) => clean(match[1]).replace(/^"([^"]+)"(?:\..*)?$/u, "$1").split(".")[0])
          .filter(Boolean),
      ),
    ];
    for (const match of matches) servers.add(match);
    findings.push({ path: configPath, exists: true, servers: matches });
  }
  return {
    configPaths,
    servers: [...servers].sort(),
    hasStudioBrainMemory:
      servers.has("studio-brain-memory") || servers.has("studio_brain_memory") || servers.has("open_memory"),
    hasContext7: servers.has("context7"),
    findings,
  };
}

function inspectCodexCapabilities({ repoRoot = REPO_ROOT, home = homedir() } = {}) {
  const skillRoots = [
    resolve(home, ".codex", "skills"),
    resolve(home, ".agents", "skills"),
  ];
  const pluginCacheRoots = [
    resolve(home, ".codex", "plugins", "cache"),
    resolve(repoRoot, ".codex", "plugins", "cache"),
  ];
  const browserSkill = findFirstExisting([
    resolve(home, ".codex", "plugins", "cache", "openai-bundled", "browser-use"),
    resolve(home, ".codex", "plugins", "cache", "openai-bundled", "browser-use", "0.1.0-alpha1"),
  ]);
  const browserSkillMd = findFirstExisting(
    skillRoots.map((root) => resolve(root, ".system", "browser-use", "SKILL.md")),
  );
  const openaiDocsSkill = findFirstExisting(
    [
      ...skillRoots.map((root) => resolve(root, ".system", "openai-docs", "SKILL.md")),
      ...skillRoots.map((root) => resolve(root, "openai-docs", "SKILL.md")),
    ],
  );
  const pluginRoots = pluginCacheRoots.flatMap((root) =>
    safeListDir(root)
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name)),
  );
  const installedSkillFiles = skillRoots.flatMap((root) =>
    listMatchingDescendants(root, (path, entry) => entry.isFile() && entry.name === "SKILL.md", 96),
  );

  return {
    browserUse: {
      available: Boolean(browserSkill || browserSkillMd),
      pluginPath: browserSkill,
      skillPath: browserSkillMd,
    },
    openaiDocs: {
      available: Boolean(openaiDocsSkill),
      skillPath: openaiDocsSkill,
    },
    skillRoots: skillRoots.map((root) => ({ path: root, exists: existsSync(root) })),
    installedSkillCount: installedSkillFiles.length,
    pluginCacheRoots: pluginCacheRoots.map((root) => ({ path: root, exists: existsSync(root) })),
    pluginFamilies: pluginRoots.map((path) => ({ path, name: path.split(/[\\/]/).pop() })).slice(0, 32),
  };
}

function inspectThreadArtifacts({ repoRoot = REPO_ROOT } = {}) {
  const latestRunPointerPath = resolve(repoRoot, "output", "agent-runs", "latest.json");
  const latestNativeBrowserPortal = resolve(repoRoot, "output", "native-browser", "portal", "prod", "shadow-summary.json");
  const latestNativeBrowserWebsite = resolve(repoRoot, "output", "native-browser", "website", "prod", "shadow-summary.json");
  const statOrNull = (path) => {
    if (!existsSync(path)) return null;
    try {
      const stat = statSync(path);
      return {
        path,
        updatedAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
      };
    } catch {
      return null;
    }
  };
  return {
    latestRunPointer: statOrNull(latestRunPointerPath),
    nativeBrowser: {
      portal: statOrNull(latestNativeBrowserPortal),
      website: statOrNull(latestNativeBrowserWebsite),
    },
  };
}

function inspectShell({ env = process.env, platform = process.platform } = {}) {
  const activeShell = clean(env.SHELL || env.ComSpec || env.COMSPEC || "");
  const psModulePath = clean(env.PSModulePath);
  const wslProbe =
    platform === "win32"
      ? spawnSync("wsl.exe", ["--status"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          timeout: 2500,
        })
      : null;
  return {
    platform,
    activeShell,
    powershellLikelyAvailable: platform === "win32" || Boolean(psModulePath),
    wslAvailable: Boolean(wslProbe && (wslProbe.status === 0 || /default distribution|wsl/i.test(String(wslProbe.stdout || wslProbe.stderr)))),
    wslStatus: wslProbe
      ? {
          ok: wslProbe.status === 0,
          exitCode: wslProbe.status,
          output: cleanProcessOutput(wslProbe.stdout || wslProbe.stderr).slice(0, 1000),
        }
      : null,
  };
}

function createCheckCollector() {
  const checks = [];
  const push = (id, severity, ok, message, details = {}) => {
    checks.push({
      id,
      severity,
      ok,
      status: ok ? "pass" : "fail",
      message,
      details,
    });
  };
  const summary = () => {
    const errors = checks.filter((check) => !check.ok && check.severity === "error").length;
    const warnings = checks.filter((check) => !check.ok && check.severity === "warning").length;
    const infos = checks.filter((check) => check.ok || check.severity === "info").length;
    return { checks: checks.length, errors, warnings, infos };
  };
  return { checks, push, summary };
}

export function runCodexAppDoctor({
  strict = false,
  artifact = DEFAULT_ARTIFACT,
  repoRoot = REPO_ROOT,
  home = homedir(),
  env = process.env,
  platform = process.platform,
  codexCli = resolveCodexCliCandidates(repoRoot, env, { platform }),
  appPackage = readWindowsAppPackageInfo({ platform }),
  configInspection = inspectCodexConfigs({ repoRoot, home }),
  capabilityInspection = inspectCodexCapabilities({ repoRoot, home }),
  shellInspection = inspectShell({ env, platform }),
  artifactInspection = inspectThreadArtifacts({ repoRoot }),
} = {}) {
  const artifactPath = resolve(repoRoot, artifact);
  const collector = createCheckCollector();
  const appVersion = appPackage.package?.version || "";
  const cliVersion = codexCli.preferred?.version || "";

  const appModernEnough = appVersion && appPackage.available === true
    ? compareDottedVersion(appVersion, RECOMMENDED_MIN_APP_PREFIX) >= 0
    : false;
  collector.push(
    "codex-app-package",
    appPackage.available ? (appModernEnough ? "info" : "warning") : "warning",
    appPackage.available && appModernEnough,
    appPackage.available
      ? appModernEnough
        ? `Codex Windows app package is available (${appVersion}).`
        : `Codex app package is available (${appVersion || "unknown"}) but may predate the app-browser/automation feature wave.`
      : `Codex Windows app package was not detected (${appPackage.reason || "unknown"}).`,
    appPackage,
  );

  const cliModernEnough = Boolean(cliVersion) && compareSemver(cliVersion, RECOMMENDED_MIN_CLI) >= 0;
  collector.push(
    "codex-cli-version",
    cliModernEnough ? "info" : "warning",
    cliModernEnough,
    cliModernEnough
      ? `Codex CLI is current enough for app-harness integration (${cliVersion}).`
      : `Codex CLI version is missing or older than ${RECOMMENDED_MIN_CLI} (${cliVersion || "unknown"}).`,
    {
      preferred: codexCli.preferred,
      candidates: codexCli.candidates,
      versionSet: codexCli.versionSet,
      hasVersionAmbiguity: codexCli.hasVersionAmbiguity,
      recommendedMinimum: RECOMMENDED_MIN_CLI,
    },
  );

  collector.push(
    "codex-cli-ambiguity",
    codexCli.hasVersionAmbiguity ? "warning" : "info",
    !codexCli.hasVersionAmbiguity,
    codexCli.hasVersionAmbiguity
      ? `Multiple Codex CLI versions are visible (${codexCli.versionSet.join(", ")}).`
      : "No Codex CLI version ambiguity detected.",
    {
      versionSet: codexCli.versionSet,
      candidates: codexCli.candidates,
    },
  );

  collector.push(
    "codex-browser-use",
    capabilityInspection.browserUse.available ? "info" : "warning",
    capabilityInspection.browserUse.available,
    capabilityInspection.browserUse.available
      ? "Browser-use plugin or skill cache is present for app browser workflows."
      : "Browser-use plugin or skill cache was not found; app browser handoff may still work, but this harness cannot prove it locally.",
    capabilityInspection.browserUse,
  );

  collector.push(
    "codex-openai-docs-skill",
    capabilityInspection.openaiDocs.available ? "info" : "warning",
    capabilityInspection.openaiDocs.available,
    capabilityInspection.openaiDocs.available
      ? "OpenAI docs skill is installed for official documentation lookups."
      : "OpenAI docs skill was not found in local skill roots.",
    capabilityInspection.openaiDocs,
  );

  collector.push(
    "codex-studio-brain-memory-mcp",
    configInspection.hasStudioBrainMemory ? "info" : "warning",
    configInspection.hasStudioBrainMemory,
    configInspection.hasStudioBrainMemory
      ? "Studio Brain memory MCP entry is present in a Codex config."
      : "Studio Brain memory MCP entry was not found in home or repo Codex config.",
    configInspection,
  );

  collector.push(
    "codex-shell-posture",
    shellInspection.platform === "win32" ? "info" : "warning",
    shellInspection.platform === "win32",
    shellInspection.platform === "win32"
      ? "Harness is running in the native Windows shell posture expected for the desktop app."
      : `Harness is running on ${shellInspection.platform}; Windows app checks are advisory only.`,
    shellInspection,
  );

  const nativeBrowserArtifactsAvailable = Boolean(
    artifactInspection.nativeBrowser.portal || artifactInspection.nativeBrowser.website,
  );
  collector.push(
    "codex-native-browser-artifacts",
    nativeBrowserArtifactsAvailable ? "info" : "warning",
    nativeBrowserArtifactsAvailable,
    nativeBrowserArtifactsAvailable
      ? "At least one native-browser shadow artifact exists."
      : "No native-browser shadow artifacts exist yet; run a browser handoff before relying on visual app evidence.",
    artifactInspection.nativeBrowser,
  );

  const summary = collector.summary();
  const status = summary.errors > 0 || (strict && summary.warnings > 0) ? "fail" : summary.warnings > 0 ? "warn" : "pass";
  const report = {
    schema: "codex-app-doctor.v1",
    generatedAt: new Date().toISOString(),
    strict,
    status,
    artifactPath,
    app: appPackage,
    codexCli,
    config: configInspection,
    capabilities: capabilityInspection,
    shell: shellInspection,
    artifacts: artifactInspection,
    checks: collector.checks,
    summary,
  };

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

function printHumanSummary(report) {
  process.stdout.write("Codex app doctor\n");
  process.stdout.write(`  status: ${report.status}\n`);
  process.stdout.write(`  app: ${report.app.package?.version || report.app.reason || "unknown"}\n`);
  process.stdout.write(`  cli: ${report.codexCli.preferred?.version || "unknown"}\n`);
  process.stdout.write(`  browser-use: ${report.capabilities.browserUse.available ? "yes" : "unknown"}\n`);
  process.stdout.write(`  studio-brain-memory mcp: ${report.config.hasStudioBrainMemory ? "yes" : "no"}\n`);
  process.stdout.write(`  warnings: ${report.summary.warnings}\n`);
  process.stdout.write(`  artifact: ${report.artifactPath}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = runCodexAppDoctor({
    strict: args.strict,
    artifact: args.artifact,
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHumanSummary(report);
  }
  if (report.status === "fail") process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
