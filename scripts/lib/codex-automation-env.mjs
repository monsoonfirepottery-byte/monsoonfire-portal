import { existsSync, readFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { resolveStudioBrainNetworkProfile } from "../studio-network-profile.mjs";

function clean(value) {
  return String(value ?? "").trim();
}

const DEFAULT_MINIO_API_PORT = "9010";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const NETWORK_PROFILE_ENV_KEYS = [
  "STUDIO_BRAIN_BASE_URL",
  "STUDIO_BRAIN_NETWORK_PROFILE",
  "STUDIO_BRAIN_HOST",
  "STUDIO_BRAIN_LOCAL_HOST",
  "STUDIO_BRAIN_LAN_HOST",
  "STUDIO_BRAIN_DHCP_HOST",
  "STUDIO_BRAIN_STATIC_IP",
  "STUDIO_BRAIN_PORT",
  "STUDIO_BRAIN_ALLOWED_HOSTS",
  "STUDIO_BRAIN_HOST_STATE_FILE",
];
const NETWORK_RUNTIME_BINDING_KEYS = [
  ...NETWORK_PROFILE_ENV_KEYS,
  "PGHOST",
  "REDIS_HOST",
  "MINIO_API_PORT",
  "STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT",
];

function isLoopbackHost(value) {
  return LOOPBACK_HOSTS.has(clean(value).toLowerCase());
}

function normalizeUrl(value) {
  const candidate = clean(value);
  if (!candidate) return "";
  return /^[a-z][a-z\d+\-.]*:\/\//i.test(candidate) ? candidate : `http://${candidate}`;
}

function resolveArtifactEndpointHost(endpointValue) {
  const normalized = normalizeUrl(endpointValue);
  if (!normalized) return "";
  try {
    return new URL(normalized).hostname;
  } catch {
    return "";
  }
}

function buildArtifactEndpoint(host, port) {
  return `http://${clean(host)}:${clean(port) || DEFAULT_MINIO_API_PORT}`;
}

function collectLocalAddresses() {
  return Object.values(networkInterfaces())
    .flatMap((entries) => Array.isArray(entries) ? entries : [])
    .map((entry) => clean(entry?.address).toLowerCase())
    .filter(Boolean);
}

function machineOwnsResolvedHost(host, localAddresses) {
  const normalizedHost = clean(host).toLowerCase();
  if (!normalizedHost) return false;
  return localAddresses.includes(normalizedHost);
}

function applyResolvedNetworkBindings({ env, explicitOverrides, localAddresses }) {
  const initialProfile = resolveStudioBrainNetworkProfile({ env });
  if (initialProfile.profile === "local") {
    return initialProfile;
  }

  const resolutionEnv = { ...env };
  if (!explicitOverrides.has("STUDIO_BRAIN_HOST") && isLoopbackHost(resolutionEnv.STUDIO_BRAIN_HOST)) {
    delete resolutionEnv.STUDIO_BRAIN_HOST;
  }
  if (!explicitOverrides.has("STUDIO_BRAIN_BASE_URL") && isLoopbackHost(resolveArtifactEndpointHost(resolutionEnv.STUDIO_BRAIN_BASE_URL))) {
    delete resolutionEnv.STUDIO_BRAIN_BASE_URL;
  }

  const profile = resolveStudioBrainNetworkProfile({ env: resolutionEnv });
  const host = clean(profile.host);
  if (!host) {
    return profile;
  }

  if (!explicitOverrides.has("STUDIO_BRAIN_HOST")) {
    env.STUDIO_BRAIN_HOST = host;
  }
  if (!explicitOverrides.has("STUDIO_BRAIN_BASE_URL")) {
    env.STUDIO_BRAIN_BASE_URL = `http://${host}:${profile.port}`;
  }

  const currentMachineOwnsResolvedHost = machineOwnsResolvedHost(host, localAddresses);
  if (!currentMachineOwnsResolvedHost) {
    if (!explicitOverrides.has("PGHOST")) {
      env.PGHOST = host;
    }
    if (!explicitOverrides.has("REDIS_HOST")) {
      env.REDIS_HOST = host;
    }
    if (!explicitOverrides.has("STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT")) {
      env.STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT = buildArtifactEndpoint(host, env.MINIO_API_PORT);
    }
  }

  return profile;
}

export function loadEnvFileIntoEnv(
  relativePath,
  {
    repoRoot,
    env = process.env,
    overwrite = false,
    includeKeys = null,
    preserveKeys = null,
  } = {}
) {
  const envFile = resolve(repoRoot, relativePath);
  if (!existsSync(envFile)) {
    return {
      attempted: true,
      loaded: false,
      path: envFile,
      keysLoaded: 0,
      missing: true,
    };
  }

  let keysLoaded = 0;
  const includeSet = Array.isArray(includeKeys) ? new Set(includeKeys.map((key) => clean(key)).filter(Boolean)) : null;
  const preserveSet = preserveKeys instanceof Set
    ? preserveKeys
    : Array.isArray(preserveKeys)
      ? new Set(preserveKeys.map((key) => clean(key)).filter(Boolean))
      : new Set();
  const content = String(readFileSync(envFile, "utf8"));
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex < 0) continue;

    const key = line.slice(0, eqIndex).trim().replace(/^export\s+/, "");
    let value = line.slice(eqIndex + 1).trim();
    if (!key || /\s/.test(key)) continue;
    if (includeSet && !includeSet.has(key)) continue;
    if (preserveSet.has(key)) continue;

    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!clean(value)) {
      continue;
    }

    if (!overwrite && clean(env[key])) {
      continue;
    }

    env[key] = value;
    keysLoaded += 1;
  }

  return {
    attempted: true,
    loaded: true,
    path: envFile,
    keysLoaded,
    missing: false,
  };
}

export function loadCodexAutomationEnv({ repoRoot, env = process.env, overwrite = false, localAddresses = null } = {}) {
  const explicitRuntimeOverrides = new Set(
    NETWORK_RUNTIME_BINDING_KEYS.filter((key) => clean(env[key]))
  );

  const results = [
    loadEnvFileIntoEnv("secrets/studio-brain/studio-brain-mcp.env", { repoRoot, env, overwrite }),
    loadEnvFileIntoEnv("secrets/studio-brain/studio-brain-automation.env", { repoRoot, env, overwrite }),
    loadEnvFileIntoEnv(resolve(homedir(), "secrets", "studio-brain", "studio-brain-mcp.env"), { repoRoot, env, overwrite }),
    loadEnvFileIntoEnv(resolve(homedir(), "secrets", "studio-brain", "studio-brain-automation.env"), { repoRoot, env, overwrite }),
    loadEnvFileIntoEnv("studio-brain/.env", { repoRoot, env, overwrite }),
    // Re-apply the repo network profile after local .env defaults so startup and
    // automation flows honor the intended Studio Brain target unless the shell
    // explicitly supplied an override.
    loadEnvFileIntoEnv("studio-brain/.env.network.profile", {
      repoRoot,
      env,
      overwrite: true,
      includeKeys: NETWORK_PROFILE_ENV_KEYS,
      preserveKeys: explicitRuntimeOverrides,
    }),
    loadEnvFileIntoEnv("studio-brain/.env.local", { repoRoot, env, overwrite }),
    loadEnvFileIntoEnv("secrets/portal/portal-automation.env", { repoRoot, env, overwrite }),
  ];

  const mcpAdminToken = clean(env.STUDIO_BRAIN_MCP_ADMIN_TOKEN);
  const adminToken = clean(env.STUDIO_BRAIN_ADMIN_TOKEN);
  if (mcpAdminToken) {
    env.STUDIO_BRAIN_MCP_ADMIN_TOKEN = mcpAdminToken;
    env.STUDIO_BRAIN_ADMIN_TOKEN = mcpAdminToken;
  } else if (adminToken) {
    env.STUDIO_BRAIN_MCP_ADMIN_TOKEN = adminToken;
    env.STUDIO_BRAIN_ADMIN_TOKEN = adminToken;
  }

  applyResolvedNetworkBindings({
    env,
    explicitOverrides: explicitRuntimeOverrides,
    localAddresses: Array.isArray(localAddresses) ? localAddresses.map((value) => clean(value).toLowerCase()).filter(Boolean) : collectLocalAddresses(),
  });
  return results;
}
