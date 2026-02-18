import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_PROFILE_PATH = resolve(__dirname, "../studio-brain/.env.network.profile");

const PROFILE_ALIASES = {
  local: {
    defaultHost: "127.0.0.1",
    allowedHosts: ["127.0.0.1", "localhost"],
    label: "local loopback",
  },
  "lan-static": {
    defaultHost: "studiobrain.local",
    allowedHosts: ["studiobrain.local", "127.0.0.1"],
    label: "LAN static",
  },
  "lan-dhcp": {
    defaultHost: "studiobrain.local",
    allowedHosts: ["studiobrain.local", "127.0.0.1", "localhost"],
    label: "LAN DHCP fallback",
  },
  ci: {
    defaultHost: "127.0.0.1",
    allowedHosts: ["127.0.0.1", "localhost"],
    label: "CI/local ephemeral",
  },
};

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const text = readFileSync(filePath, "utf8");
  const values = {};

  text.split(/\r?\n/).forEach((rawLine) => {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const hasEq = trimmed.indexOf("=");
    if (hasEq === -1) {
      return;
    }

    const key = trimmed.slice(0, hasEq).trim();
    const value = trimmed.slice(hasEq + 1).trim();
    if (!key) {
      return;
    }

    values[key] = value;
  });

  return values;
}

function normalizePort(value, fallback) {
  const raw = Number.parseInt(String(value || ""), 10);
  if (Number.isInteger(raw) && raw > 0 && raw <= 65535) {
    return raw;
  }

  return fallback;
}

function normalizeProfile(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return PROFILE_ALIASES[normalized] ? normalized : "local";
}

function isLoopback(host) {
  const value = String(host || "").toLowerCase();
  return value === "127.0.0.1" || value === "localhost" || value === "::1";
}

function dedupe(values) {
  return [...new Set(values.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];
}

export function resolveStudioBrainNetworkProfile(options = {}) {
  const env = options.env || process.env;
  const profilePath = options.profilePath || DEFAULT_PROFILE_PATH;
  const networkFile = parseEnvFile(profilePath);
  const requestedProfile = String(
    env.STUDIO_BRAIN_NETWORK_PROFILE || networkFile.STUDIO_BRAIN_NETWORK_PROFILE || "local",
  ).trim().toLowerCase();
  const normalizedProfile = normalizeProfile(requestedProfile);
  const normalizedConfig = PROFILE_ALIASES[normalizedProfile];
  const hasUnknownProfile = requestedProfile && requestedProfile !== normalizedProfile;

  const port = normalizePort(
    env.STUDIO_BRAIN_PORT ?? networkFile.STUDIO_BRAIN_PORT,
    8787,
  );
  const staticIp = String(env.STUDIO_BRAIN_STATIC_IP || networkFile.STUDIO_BRAIN_STATIC_IP || "").trim();
  const requestedHost = String(
    env.STUDIO_BRAIN_HOST || networkFile.STUDIO_BRAIN_HOST || "",
  ).trim();

  const profileHost = String(
    env.STUDIO_BRAIN_LAN_HOST || networkFile.STUDIO_BRAIN_LAN_HOST || normalizedConfig.defaultHost,
  ).trim();
  const resolvedHost = requestedHost || (normalizedProfile === "lan-static" && staticIp ? staticIp : profileHost);
  const baseHost = isLoopback(resolvedHost)
    ? normalizedProfile === "local"
      ? "127.0.0.1"
      : String(env.STUDIO_BRAIN_LAN_HOST || networkFile.STUDIO_BRAIN_LAN_HOST || "studiobrain.local")
    : resolvedHost;

  const baseUrl = String(
    env.STUDIO_BRAIN_BASE_URL || networkFile.STUDIO_BRAIN_BASE_URL || "",
  ).trim();
  const resolvedBaseUrl = baseUrl || `http://${baseHost}:${port}`;

  const allowedHosts = dedupe([
    ...normalizedConfig.allowedHosts,
    baseHost,
    String(env.STUDIO_BRAIN_ALLOWED_HOSTS || networkFile.STUDIO_BRAIN_ALLOWED_HOSTS || "").split(","),
  ]);

  const hostStateFile = String(
    env.STUDIO_BRAIN_HOST_STATE_FILE || networkFile.STUDIO_BRAIN_HOST_STATE_FILE || ".studiobrain-host-state.json",
  ).trim();
  const profileName = env.STUDIO_BRAIN_NETWORK_PROFILE || networkFile.STUDIO_BRAIN_NETWORK_PROFILE || normalizedProfile;

  const warnings = [];
  if (!env.STUDIO_BRAIN_NETWORK_PROFILE && !networkFile.STUDIO_BRAIN_NETWORK_PROFILE) {
    warnings.push("No STUDIO_BRAIN_NETWORK_PROFILE configured, defaulting to local loopback.");
  }
  if (hasUnknownProfile) {
    warnings.push(`Unknown profile "${requestedProfile}", falling back to local loopback.`);
  }
  if (normalizedProfile === "lan-static" && !staticIp) {
    warnings.push("lan-static profile active without STUDIO_BRAIN_STATIC_IP; falling back to studio hostname.");
  }
  if ((normalizedProfile === "lan-static" || normalizedProfile === "lan-dhcp") && isLoopback(baseHost)) {
    warnings.push(`Profile ${normalizedProfile} resolves to loopback host (${baseHost}); confirm this is intentional.`);
  }
  if (!env.STUDIO_BRAIN_HOST && !networkFile.STUDIO_BRAIN_HOST) {
    warnings.push(`STUDIO_BRAIN_HOST derived from profile: ${baseHost}`);
  }

  return {
    requestedProfile: profileName,
    profile: normalizedProfile,
    port,
    host: baseHost,
    profileLabel: normalizedConfig.label,
    baseUrl: resolvedBaseUrl,
    emulatorHost: baseHost,
    hostStateFile,
    warnings,
    allowedStudioBrainHosts: allowedHosts,
    hasLoopbackFallback: isLoopback(baseHost),
    profileConfigFile: profilePath,
    strictness: normalizedProfile === "local" ? "strict-loopback" : "shared-host",
  };
}

export function isStudioBrainHostAllowed(host, profile) {
  return profile.allowedStudioBrainHosts.includes(String(host || "").toLowerCase());
}
