import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

function clean(value) {
  return String(value ?? "").trim();
}

function quoteForCmd(value) {
  const raw = String(value ?? "");
  if (!raw) return "\"\"";
  if (!/[\s"&()^<>|]/.test(raw)) return raw;
  return `"${raw.replace(/"/g, '\\"')}"`;
}

export function resolvePlatformCommand(command, { platform = process.platform } = {}) {
  const raw = clean(command);
  if (!raw || /[\\/]/.test(raw) || /\.[A-Za-z0-9]+$/.test(raw)) {
    return raw;
  }
  if (platform === "win32" && (raw === "npm" || raw === "npx")) {
    return `${raw}.cmd`;
  }
  return raw;
}

export function buildPlatformCommandInvocation(
  command,
  args = [],
  { platform = process.platform } = {}
) {
  const resolvedCommand = resolvePlatformCommand(command, { platform });
  const normalizedArgs = Array.isArray(args) ? args.map((entry) => String(entry)) : [];
  if (
    platform === "win32" &&
    (resolvedCommand === "npm.cmd" || resolvedCommand === "npx.cmd")
  ) {
    const commandLine = [resolvedCommand, ...normalizedArgs].map(quoteForCmd).join(" ");
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", commandLine],
    };
  }
  return {
    command: resolvedCommand,
    args: normalizedArgs,
  };
}

export function joinPathEntries(entries, existingPath = "", { platform = process.platform } = {}) {
  const pathDelimiter = platform === "win32" ? ";" : ":";
  const unique = [];
  const seen = new Set();
  for (const entry of [...(Array.isArray(entries) ? entries : [entries]), ...String(existingPath || "").split(pathDelimiter)]) {
    const normalized = clean(entry);
    if (!normalized) continue;
    const hashKey = platform === "win32" ? normalized.toLowerCase() : normalized;
    if (seen.has(hashKey)) continue;
    seen.add(hashKey);
    unique.push(normalized);
  }
  return unique.join(pathDelimiter);
}

export function prependPathEntries(entries, env = process.env, { platform = process.platform } = {}) {
  return {
    ...env,
    PATH: joinPathEntries(entries, env.PATH || "", { platform }),
  };
}

export function readCommandPath(command, { env = process.env, platform = process.platform } = {}) {
  const lookup = platform === "win32" ? `where ${command}` : `command -v ${command}`;
  try {
    const output = execSync(lookup, {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return clean(String(output).split(/\r?\n/).find(Boolean) || "");
  } catch {
    return "";
  }
}

export function readAllCommandPaths(command, { env = process.env, platform = process.platform } = {}) {
  const lookup = platform === "win32" ? `where ${command}` : `which -a ${command}`;
  try {
    const output = execSync(lookup, {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return Array.from(new Set(String(output).split(/\r?\n/).map((line) => clean(line)).filter(Boolean)));
  } catch {
    return [];
  }
}

export function resolveLocalNodeBin(repoRoot, binaryName, { platform = process.platform } = {}) {
  const candidates =
    platform === "win32"
      ? [resolve(repoRoot, "node_modules", ".bin", `${binaryName}.cmd`), resolve(repoRoot, "node_modules", ".bin", binaryName)]
      : [resolve(repoRoot, "node_modules", ".bin", binaryName)];
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

export function buildFirebaseCliInvocation(repoRoot, { env = process.env, platform = process.platform } = {}) {
  const localCliPath = resolve(repoRoot, "node_modules", "firebase-tools", "lib", "bin", "firebase.js");
  if (existsSync(localCliPath)) {
    return {
      command: process.execPath,
      args: [localCliPath],
      source: "repo-local-firebase-js",
    };
  }

  const npxPath = readCommandPath(resolvePlatformCommand("npx", { platform }), { env, platform }) ||
    resolvePlatformCommand("npx", { platform });
  return {
    command: npxPath,
    args: ["firebase-tools"],
    source: "npx-fallback",
  };
}

export function runResolved(command, args = [], options = {}) {
  const invocation = buildPlatformCommandInvocation(command, args, {
    platform: options.platform || process.platform,
  });
  return spawnSync(invocation.command, invocation.args, {
    shell: false,
    ...options,
  });
}
