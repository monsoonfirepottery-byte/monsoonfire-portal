import { resolveStudioBrainNetworkProfile } from "./studio-network-profile.mjs";

const DEFAULT_FALLBACK_VARS = ["STUDIO_BRAIN_BASE_URL"];

const normalizeValue = (value) => String(value || "").trim();

function firstEnvValue(env, candidateVars = []) {
  for (const key of candidateVars) {
    const value = normalizeValue(env?.[key]);
    if (value) {
      return value;
    }
  }
  return "";
}

export function resolveStudioBrainBaseHostFromEnv({ env = process.env } = {}) {
  const profile = resolveStudioBrainNetworkProfile({ env });
  return profile.host || "127.0.0.1";
}

function normalizeBaseUrl(candidate) {
  const trimmed = normalizeValue(candidate);
  if (!trimmed) {
    return "";
  }

  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `http://${trimmed}`;
}

export function resolveStudioBrainBaseUrlFromEnv({
  env = process.env,
  fallbackVars = [],
} = {}) {
  const orderedFallbacks = Array.from(new Set([...fallbackVars, ...DEFAULT_FALLBACK_VARS]));
  const explicitBaseUrl = firstEnvValue(env, orderedFallbacks);
  if (explicitBaseUrl) {
    return normalizeBaseUrl(explicitBaseUrl).replace(/\/$/, "");
  }

  const profile = resolveStudioBrainNetworkProfile({ env });
  return `http://${profile.host}:${profile.port}`.replace(/\/$/, "");
}
