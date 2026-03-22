import { execFileSync, execSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { delimiter, extname, resolve } from "node:path";
import { readAllCommandPaths, readCommandPath } from "./command-runner.mjs";

function normalizeVersionInput(value) {
  const match = String(value || "").match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : "";
}

export function parseVersionOutput(rawOutput) {
  const match = String(rawOutput || "").match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

export function compareSemver(left, right) {
  const toParts = (value) =>
    normalizeVersionInput(value)
      .split(".")
      .map((part) => Number(part || 0));
  const a = toParts(left);
  const b = toParts(right);
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff === 0) continue;
    return diff > 0 ? 1 : -1;
  }
  return 0;
}

function canInspectPath(candidatePath) {
  if (!candidatePath || typeof candidatePath !== "string") return false;
  if (!existsSync(candidatePath)) return false;
  try {
    const stat = lstatSync(candidatePath);
    return stat.isFile() || stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function defaultReadBinaryVersion(binaryPath, env, { platform = process.platform } = {}) {
  try {
    const extension = extname(binaryPath).toLowerCase();
    const requiresCmdShell = platform === "win32" && (extension === ".cmd" || extension === ".bat");
    const output = requiresCmdShell
      ? execSync(`"${binaryPath}" --version`, {
          encoding: "utf8",
          env,
          shell: process.env.ComSpec || true,
          stdio: ["ignore", "pipe", "ignore"],
        }).trim()
      : execFileSync(binaryPath, ["--version"], {
          encoding: "utf8",
          env,
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
    return {
      version: parseVersionOutput(output),
      raw: output,
    };
  } catch {
    return {
      version: null,
      raw: "",
    };
  }
}

function appendUniquePath(target, candidatePath, { platform = process.platform } = {}) {
  const pathValue = String(candidatePath || "").trim();
  if (!pathValue) return;
  const normalizedKey = platform === "win32" ? pathValue.toLowerCase() : pathValue;
  const seen = target.__seen || (target.__seen = new Set());
  if (seen.has(normalizedKey)) return;
  seen.add(normalizedKey);
  target.push(pathValue);
}

export function expandWindowsCommandVariants(binaryPath, { platform = process.platform } = {}) {
  const pathValue = String(binaryPath || "").trim();
  if (!pathValue) return [];
  if (platform !== "win32") return [pathValue];

  const variants = [];
  const extension = extname(pathValue).toLowerCase();
  const hasKnownWindowsExtension = extension === ".cmd" || extension === ".exe" || extension === ".bat";
  if (hasKnownWindowsExtension) {
    appendUniquePath(variants, pathValue, { platform });
    delete variants.__seen;
    return variants;
  }

  appendUniquePath(variants, `${pathValue}.cmd`, { platform });
  appendUniquePath(variants, `${pathValue}.exe`, { platform });
  appendUniquePath(variants, `${pathValue}.bat`, { platform });
  appendUniquePath(variants, pathValue, { platform });
  delete variants.__seen;
  return variants;
}

export function stripNodeModulesBinFromPath(pathValue) {
  return String(pathValue || "")
    .split(delimiter)
    .filter((segment) => !/[\\/]node_modules[\\/]\.bin(?:[\\/]|$)/.test(segment))
    .join(delimiter);
}

function addCandidate(
  candidateMap,
  source,
  binaryPath,
  env,
  repoRoot,
  { platform = process.platform, versionReader = defaultReadBinaryVersion } = {}
) {
  const pathValue = String(binaryPath || "").trim();
  if (!pathValue) return;

  for (const candidatePath of expandWindowsCommandVariants(pathValue, { platform })) {
    if (!canInspectPath(candidatePath)) continue;

    const existing =
      candidateMap.get(candidatePath) ||
      {
        path: candidatePath,
        sources: new Set(),
        version: null,
        rawVersionOutput: "",
        isLocal: false,
      };

    existing.sources.add(source);
    const localPrefix = `${resolve(repoRoot, "node_modules", ".bin")}`;
    if (candidatePath.startsWith(localPrefix) || /[\\/]node_modules[\\/]\.bin[\\/]/.test(candidatePath)) {
      existing.isLocal = true;
    }

    if (!existing.version) {
      const versionResult = versionReader(candidatePath, env, { platform });
      if (versionResult.version) {
        existing.version = versionResult.version;
        existing.rawVersionOutput = versionResult.raw;
      }
    }

    candidateMap.set(candidatePath, existing);
  }
}

export function selectPreferredCodexCandidate(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const withVersion = candidates.filter((candidate) => candidate.version);
  const activeWithVersion = withVersion.find((candidate) => candidate.sources.includes("active-path"));
  if (activeWithVersion) {
    return activeWithVersion;
  }

  if (withVersion.length > 0) {
    const byVersionDesc = [...withVersion].sort((left, right) =>
      compareSemver(right.version || "0.0.0", left.version || "0.0.0"),
    );
    return byVersionDesc[0] || null;
  }

  return candidates.find((candidate) => candidate.sources.includes("active-path")) || candidates[0] || null;
}

export function resolveCodexCliCandidates(repoRoot, env = process.env, options = {}) {
  const platform = options.platform || process.platform;
  const readCommandPathFn = options.readCommandPathFn || readCommandPath;
  const readAllCommandPathsFn = options.readAllCommandPathsFn || readAllCommandPaths;
  const versionReader = options.versionReader || defaultReadBinaryVersion;
  const candidateMap = new Map();
  const localBinaryCandidates =
    platform === "win32"
      ? [resolve(repoRoot, "node_modules", ".bin", "codex.cmd"), resolve(repoRoot, "node_modules", ".bin", "codex")]
      : [resolve(repoRoot, "node_modules", ".bin", "codex")];

  for (const localBinary of localBinaryCandidates) {
    addCandidate(candidateMap, "local-node-modules-bin", localBinary, env, repoRoot, { platform, versionReader });
  }

  const activePath = readCommandPathFn("codex", { env, platform });
  addCandidate(candidateMap, "active-path", activePath, env, repoRoot, { platform, versionReader });

  for (const discoveredPath of readAllCommandPathsFn("codex", { env, platform })) {
    addCandidate(candidateMap, "path-scan", discoveredPath, env, repoRoot, { platform, versionReader });
  }

  const sanitizedPath = stripNodeModulesBinFromPath(env.PATH || "");
  if (sanitizedPath && sanitizedPath !== String(env.PATH || "")) {
    const nonLocalEnv = { ...env, PATH: sanitizedPath };
    const nonLocalPath = readCommandPathFn("codex", { env: nonLocalEnv, platform });
    addCandidate(candidateMap, "non-local-path", nonLocalPath, nonLocalEnv, repoRoot, { platform, versionReader });
  }

  const candidates = [...candidateMap.values()]
    .map((entry) => ({
      ...entry,
      sources: [...entry.sources].sort(),
    }))
    .sort((left, right) => {
      if (left.isLocal !== right.isLocal) return left.isLocal ? -1 : 1;
      const leftVersion = left.version || "0.0.0";
      const rightVersion = right.version || "0.0.0";
      const versionCmp = compareSemver(rightVersion, leftVersion);
      if (versionCmp !== 0) return versionCmp;
      return left.path.localeCompare(right.path);
    });

  const preferred = selectPreferredCodexCandidate(candidates);
  const versionSet = Array.from(new Set(candidates.map((candidate) => candidate.version).filter(Boolean))).sort(
    (left, right) => compareSemver(right, left),
  );

  return {
    candidates,
    preferred,
    versionSet,
    hasVersionAmbiguity: versionSet.length > 1,
  };
}
