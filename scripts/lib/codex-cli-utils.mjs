import { execFileSync, execSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { delimiter, resolve } from "node:path";

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

function readCommandPath(command, env) {
  const lookup = process.platform === "win32" ? `where ${command}` : `command -v ${command}`;
  try {
    const output = execSync(lookup, {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    return output[0] || "";
  } catch {
    return "";
  }
}

function readAllCommandPaths(command, env) {
  const lookup = process.platform === "win32" ? `where ${command}` : `which -a ${command}`;
  try {
    const output = execSync(lookup, {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return Array.from(new Set(output.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean)));
  } catch {
    return [];
  }
}

function readBinaryVersion(binaryPath, env) {
  try {
    const output = execFileSync(binaryPath, ["--version"], {
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

export function stripNodeModulesBinFromPath(pathValue) {
  return String(pathValue || "")
    .split(delimiter)
    .filter((segment) => !/[\\/]node_modules[\\/]\.bin(?:[\\/]|$)/.test(segment))
    .join(delimiter);
}

function addCandidate(candidateMap, source, binaryPath, env, repoRoot) {
  const pathValue = String(binaryPath || "").trim();
  if (!pathValue || !canInspectPath(pathValue)) return;

  const existing =
    candidateMap.get(pathValue) ||
    {
      path: pathValue,
      sources: new Set(),
      version: null,
      rawVersionOutput: "",
      isLocal: false,
    };

  existing.sources.add(source);
  const localPrefix = `${resolve(repoRoot, "node_modules", ".bin")}`;
  if (pathValue.startsWith(localPrefix) || /[\\/]node_modules[\\/]\.bin[\\/]/.test(pathValue)) {
    existing.isLocal = true;
  }

  if (!existing.version) {
    const versionResult = readBinaryVersion(pathValue, env);
    if (versionResult.version) {
      existing.version = versionResult.version;
      existing.rawVersionOutput = versionResult.raw;
    }
  }

  candidateMap.set(pathValue, existing);
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

export function resolveCodexCliCandidates(repoRoot, env = process.env) {
  const candidateMap = new Map();
  const localBinaryCandidates =
    process.platform === "win32"
      ? [resolve(repoRoot, "node_modules", ".bin", "codex.cmd"), resolve(repoRoot, "node_modules", ".bin", "codex")]
      : [resolve(repoRoot, "node_modules", ".bin", "codex")];

  for (const localBinary of localBinaryCandidates) {
    addCandidate(candidateMap, "local-node-modules-bin", localBinary, env, repoRoot);
  }

  const activePath = readCommandPath("codex", env);
  addCandidate(candidateMap, "active-path", activePath, env, repoRoot);

  for (const discoveredPath of readAllCommandPaths("codex", env)) {
    addCandidate(candidateMap, "path-scan", discoveredPath, env, repoRoot);
  }

  const sanitizedPath = stripNodeModulesBinFromPath(env.PATH || "");
  if (sanitizedPath && sanitizedPath !== String(env.PATH || "")) {
    const nonLocalEnv = { ...env, PATH: sanitizedPath };
    const nonLocalPath = readCommandPath("codex", nonLocalEnv);
    addCandidate(candidateMap, "non-local-path", nonLocalPath, nonLocalEnv, repoRoot);
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
