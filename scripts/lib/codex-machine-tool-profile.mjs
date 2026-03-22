import { existsSync } from "node:fs";
import { homedir, hostname as osHostname } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { codexHomePath } from "./codex-session-memory-utils.mjs";
import { readJson, stableHash, writeJson } from "./pst-memory-utils.mjs";

export const TOOL_PROFILE_SUBJECT_KEY = "codex-machine-tool-profile";
export const TOOL_PROFILE_SCHEMA = "codex-machine-tool-profile.v1";
export const TOOL_PROFILE_CACHE_SCHEMA = "codex-machine-tool-profile-cache.v1";
export const TOOL_PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const TOOL_REQUEST_TIMEOUT_MS = 4_000;
const HOME_DIR = homedir();
const CORE_CLI_TOOLS = [
  { name: "pwsh", purpose: "PowerShell shell and automation host" },
  { name: "bash", purpose: "POSIX shell for repo scripts and portability checks" },
  { name: "rg", purpose: "Fast text and file search" },
  { name: "rsync", purpose: "Directory sync and copy with delta behavior" },
  { name: "git", purpose: "Version control and diff inspection" },
  { name: "node", purpose: "JavaScript runtime for scripts and MCP servers" },
  { name: "python", purpose: "Python runtime for utilities and data work" },
  { name: "gh", purpose: "GitHub CLI for PRs, issues, and checks" },
  { name: "npx", purpose: "One-off Node package execution" },
  { name: "cargo", purpose: "Rust package manager and build tool" },
  { name: "uv", purpose: "Fast Python package and venv manager" },
];

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeForHash(value, platform = process.platform) {
  const normalized = clean(value);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function normalizePathEntries(pathValue, platform = process.platform) {
  const delimiter = platform === "win32" ? ";" : ":";
  const out = [];
  const seen = new Set();
  for (const entry of String(pathValue ?? "").split(delimiter)) {
    const normalized = clean(entry);
    if (!normalized || normalized === "%PATH%") continue;
    const hashKey = normalizeForHash(normalized, platform);
    if (seen.has(hashKey)) continue;
    seen.add(hashKey);
    out.push(normalized);
  }
  return out;
}

function resolveCandidateExtensions(commandName, env, platform) {
  if (platform !== "win32") {
    return [""];
  }
  const explicitExtension = /\.[a-z0-9]+$/i.test(commandName);
  if (explicitExtension) {
    return [""];
  }
  const rawExtensions = String(env?.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((entry) => clean(entry).toLowerCase())
    .filter(Boolean);
  const extensions = ["", ...rawExtensions];
  return [...new Set(extensions)];
}

function resolveCommandPath(commandName, { env = process.env, platform = process.platform, pathEntries = null } = {}) {
  const entries = Array.isArray(pathEntries) ? pathEntries : normalizePathEntries(env.PATH, platform);
  const extensions = resolveCandidateExtensions(commandName, env, platform);
  for (const entry of entries) {
    for (const extension of extensions) {
      const candidate = resolve(entry, `${commandName}${extension}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return "";
}

function resolveShellLabel(shell, env, platform) {
  const explicit = clean(shell);
  if (explicit) return basename(explicit);
  if (platform === "win32") {
    if (clean(env?.PSModulePath)) return "powershell";
    const comSpec = clean(env?.ComSpec || env?.COMSPEC);
    if (comSpec) return basename(comSpec);
    return "powershell";
  }
  return basename(clean(env?.SHELL || "sh"));
}

function inferSourceHint(pathValue, platform = process.platform) {
  const normalized = clean(pathValue);
  if (!normalized) return "unavailable";
  const lower = normalized.toLowerCase();
  const homeLower = HOME_DIR.toLowerCase();
  if (platform === "win32") {
    if (lower.includes("\\program files\\git\\")) return "Git for Windows";
    if (lower.includes("\\msys64\\")) return "MSYS2";
    if (lower.includes("\\appdata\\roaming\\npm\\")) return "npm shim";
    if (lower.includes("\\program files\\github cli\\")) return "GitHub CLI";
    if (lower.includes("\\program files\\powershell\\") || lower.includes("microsoft.powershell")) return "PowerShell";
    if (lower.includes("\\windowsapps\\")) return "Windows app alias";
    if (lower.includes("\\appdata\\local\\programs\\python\\")) return "User Python install";
    if (lower.includes("\\cargo\\bin\\")) return "Rustup";
    if (lower.startsWith("c:\\nvm4w\\")) return "nvm4w";
    if (lower.startsWith("c:\\windows\\")) return "Windows system";
    if (lower.startsWith(homeLower)) return "User install";
    if (lower.includes("\\program files\\")) return "Program Files";
  } else {
    if (lower.includes("/.cargo/bin/")) return "Rustup";
    if (lower.includes("/.local/bin/")) return "User local bin";
    if (lower.startsWith("/usr/local/")) return "usr-local";
    if (lower.startsWith("/usr/bin/")) return "system";
    if (lower.startsWith("/opt/homebrew/")) return "Homebrew";
  }
  return basename(dirname(normalized)) || "path entry";
}

function buildPresentList(tools) {
  return tools.filter((tool) => tool.status === "present").map((tool) => tool.name);
}

function buildMissingList(tools) {
  return tools.filter((tool) => tool.status === "missing").map((tool) => tool.name);
}

export function buildMachineToolProfileNote(profile, maxChars = 320) {
  const present = buildPresentList(profile.tools || []);
  const missing = buildMissingList(profile.tools || []);
  const parts = [
    `Tooling baseline: present ${present.length > 0 ? present.join(", ") : "none"}.`,
    `Missing ${missing.length > 0 ? missing.join(", ") : "none"}.`,
  ];
  return parts.join(" ").slice(0, maxChars);
}

export function buildMachineToolProfileSummary(profile) {
  return `Core CLI profile for ${clean(profile.hostname || "this machine")} on ${clean(profile.os || process.platform)}. ${buildMachineToolProfileNote(profile, 220)}`;
}

export function buildMachineToolProfileContent(profile) {
  const lines = [
    `Core CLI profile for ${clean(profile.hostname || "this machine")} on ${clean(profile.os || process.platform)} using ${clean(profile.shell || "unknown-shell")}.`,
    buildMachineToolProfileNote(profile, 240),
    "",
    ...(profile.tools || []).map((tool) => {
      const status = tool.status === "present" ? "present" : "missing";
      const location = tool.path ? ` at ${tool.path}` : "";
      return `- ${tool.name}: ${status}${location} (${tool.sourceHint}) - ${tool.purpose}`;
    }),
  ];
  return lines.join("\n").trim();
}

export function probeMachineToolProfile({
  env = process.env,
  platform = process.platform,
  hostname = osHostname(),
  shell = "",
  now = new Date(),
} = {}) {
  const pathEntries = normalizePathEntries(env.PATH, platform);
  const capturedAt = new Date(now).toISOString();
  const tools = CORE_CLI_TOOLS.map((definition) => {
    const pathValue = resolveCommandPath(definition.name, { env, platform, pathEntries });
    return {
      name: definition.name,
      status: pathValue ? "present" : "missing",
      path: pathValue,
      purpose: definition.purpose,
      sourceHint: inferSourceHint(pathValue, platform),
    };
  });
  const pathFingerprint = stableHash(
    pathEntries.map((entry) => normalizeForHash(entry, platform)).join("|"),
    24
  );
  const toolFingerprint = stableHash(
    JSON.stringify(
      tools.map((tool) => ({
        name: tool.name,
        status: tool.status,
        path: normalizeForHash(tool.path, platform),
      }))
    ),
    24
  );
  const shellLabel = resolveShellLabel(shell, env, platform);
  const profile = {
    schema: TOOL_PROFILE_SCHEMA,
    subjectKey: TOOL_PROFILE_SUBJECT_KEY,
    capturedAt,
    hostname: clean(hostname || "unknown-host"),
    os: clean(platform || process.platform),
    shell: shellLabel,
    pathFingerprint,
    toolFingerprint,
    tags: ["codex", "tool-profile", "startup", "cli"],
    scopeClass: "personal",
    tools,
  };
  return {
    ...profile,
    summary: buildMachineToolProfileSummary(profile),
    content: buildMachineToolProfileContent(profile),
  };
}

export function sharedMachineToolProfileCachePath() {
  return codexHomePath("memory", "runtime", "tool-profile-cache.json");
}

export function readMachineToolProfileCache(path = sharedMachineToolProfileCachePath()) {
  return readJson(path, null);
}

export function buildMachineToolProfileCache(profile, previousCache = {}) {
  return {
    schema: TOOL_PROFILE_CACHE_SCHEMA,
    subjectKey: TOOL_PROFILE_SUBJECT_KEY,
    cachedAt: clean(profile.capturedAt),
    lastMemoryWriteAt: clean(previousCache?.lastMemoryWriteAt),
    lastRefreshReason: clean(previousCache?.lastRefreshReason),
    memoryId: clean(previousCache?.memoryId),
    ...profile,
  };
}

export function machineToolProfileRefreshDecision(
  previousCache,
  nextProfile,
  { nowMs = Date.now(), ttlMs = TOOL_PROFILE_TTL_MS } = {}
) {
  if (!previousCache || typeof previousCache !== "object") {
    return { refresh: true, reason: "missing-cache" };
  }
  if (clean(previousCache.toolFingerprint) !== clean(nextProfile.toolFingerprint)) {
    return { refresh: true, reason: "fingerprint-changed" };
  }
  const referenceTimestamp = clean(
    previousCache.lastMemoryWriteAt || previousCache.capturedAt || previousCache.cachedAt
  );
  const referenceMs = Date.parse(referenceTimestamp);
  if (!Number.isFinite(referenceMs)) {
    return { refresh: true, reason: "missing-capture" };
  }
  if (nowMs - referenceMs > ttlMs) {
    return { refresh: true, reason: "stale" };
  }
  return { refresh: false, reason: "fresh" };
}

export function buildMachineToolProfileMemoryRequest(profile) {
  return {
    content: profile.content,
    source: "manual",
    status: "accepted",
    memoryType: "semantic",
    tags: profile.tags,
    metadata: {
      capturedFrom: "codex-startup-tool-profile",
      subjectKey: TOOL_PROFILE_SUBJECT_KEY,
      scopeClass: "personal",
      profileClass: "tooling",
      startupEligible: true,
      rememberForStartup: true,
      rememberKind: "checkpoint",
      hostname: profile.hostname,
      os: profile.os,
      shell: profile.shell,
      capturedAt: profile.capturedAt,
      pathFingerprint: profile.pathFingerprint,
      toolFingerprint: profile.toolFingerprint,
      tools: profile.tools,
    },
    clientRequestId: `tool-profile-${profile.toolFingerprint}`.slice(0, 120),
    importance: 0.72,
    occurredAt: profile.capturedAt,
  };
}

export function buildMachineToolProfileStartupRow(profile) {
  return {
    id: `tool-profile-${clean(profile.toolFingerprint)}`,
    source: "manual",
    status: "accepted",
    score: 0.42,
    content: buildMachineToolProfileNote(profile, 320),
    tags: profile.tags,
    occurredAt: clean(profile.capturedAt),
    metadata: {
      subjectKey: TOOL_PROFILE_SUBJECT_KEY,
      scopeClass: "personal",
      profileClass: "tooling",
      startupEligible: true,
      rememberForStartup: true,
      rememberKind: "checkpoint",
      hostname: clean(profile.hostname),
      os: clean(profile.os),
      shell: clean(profile.shell),
      capturedAt: clean(profile.capturedAt),
      pathFingerprint: clean(profile.pathFingerprint),
      toolFingerprint: clean(profile.toolFingerprint),
      tools: Array.isArray(profile.tools) ? profile.tools : [],
      label: TOOL_PROFILE_SUBJECT_KEY,
      memoryId: clean(profile.memoryId),
    },
  };
}

function includesToolProfileItem(items) {
  return (Array.isArray(items) ? items : []).some((item) => {
    const metadata = item && typeof item.metadata === "object" ? item.metadata : {};
    return clean(metadata.subjectKey) === TOOL_PROFILE_SUBJECT_KEY;
  });
}

export function isHomeScopedCwd(cwd) {
  const normalized = clean(cwd).toLowerCase();
  if (!normalized) return false;
  if (normalized.includes("monsoonfire-portal")) return false;
  const normalizedHome = HOME_DIR.toLowerCase();
  return normalized === normalizedHome || normalized.startsWith(`${normalizedHome}\\`) || normalized.startsWith(`${normalizedHome}/`);
}

export function shouldAttachMachineToolProfile({ threadInfo, continuityState }) {
  return isHomeScopedCwd(threadInfo?.cwd) || clean(continuityState).toLowerCase() !== "ready";
}

export function attachMachineToolProfileContext(
  contextPayload,
  profile,
  { include = false, maxSummaryChars = 8_000 } = {}
) {
  if (!include || !profile || typeof profile !== "object") {
    return contextPayload;
  }
  const root =
    contextPayload && typeof contextPayload === "object" ? { ...contextPayload } : { schema: "codex-startup-bootstrap-context.v1" };
  const context =
    root.context && typeof root.context === "object"
      ? { ...root.context }
      : { ...root };
  const items = Array.isArray(context.items) ? [...context.items] : [];
  if (!includesToolProfileItem(items)) {
    items.push(buildMachineToolProfileStartupRow(profile));
  }
  const note = buildMachineToolProfileNote(profile, 320);
  const summary = clean(context.summary);
  context.items = items;
  context.summary = !summary ? note : summary.includes(note) ? summary : `${summary}\n\n${note}`.slice(0, maxSummaryChars);
  if (root.context && typeof root.context === "object") {
    root.context = context;
    root.items = context.items;
    root.summary = context.summary;
    return root;
  }
  return context;
}

export async function syncMachineToolProfile({
  env = process.env,
  platform = process.platform,
  hostname = osHostname(),
  shell = "",
  now = new Date(),
  sharedCachePath = sharedMachineToolProfileCachePath(),
  threadSnapshotPath = "",
  requestJson = null,
  baseUrl,
  timeoutMs = TOOL_REQUEST_TIMEOUT_MS,
  awaitRemoteWrite = false,
} = {}) {
  const profile = probeMachineToolProfile({ env, platform, hostname, shell, now });
  const previousCache = readMachineToolProfileCache(sharedCachePath);
  const refresh = machineToolProfileRefreshDecision(previousCache, profile, {
    nowMs: new Date(now).getTime(),
  });
  const initialCache = {
    ...buildMachineToolProfileCache(profile, previousCache),
    lastRefreshReason: refresh.reason,
  };
  writeJson(sharedCachePath, initialCache);
  if (threadSnapshotPath) {
    writeJson(threadSnapshotPath, initialCache);
  }

  const remoteWritePromise =
    refresh.refresh && typeof requestJson === "function"
      ? Promise.resolve(
          requestJson({
            method: "POST",
            path: "/api/memory/capture",
            body: buildMachineToolProfileMemoryRequest(profile),
            env,
            baseUrl,
            timeoutMs,
          })
        ).then((response) => {
          const memoryId = clean(response?.memory?.id || response?.result?.results?.[0]?.id);
          const refreshedCache = {
            ...buildMachineToolProfileCache(profile, initialCache),
            lastMemoryWriteAt: clean(profile.capturedAt),
            lastRefreshReason: refresh.reason,
            memoryId: memoryId || clean(initialCache.memoryId),
          };
          writeJson(sharedCachePath, refreshedCache);
          if (threadSnapshotPath) {
            writeJson(threadSnapshotPath, refreshedCache);
          }
          return {
            ok: true,
            memoryId,
            cache: refreshedCache,
          };
        })
      : Promise.resolve({
          ok: true,
          skipped: true,
          cache: initialCache,
        });

  if (awaitRemoteWrite) {
    const remoteWrite = await remoteWritePromise;
    return {
      profile: remoteWrite.cache || initialCache,
      refresh,
      remoteWrite,
    };
  }

  return {
    profile: initialCache,
    refresh,
    remoteWritePromise,
  };
}
