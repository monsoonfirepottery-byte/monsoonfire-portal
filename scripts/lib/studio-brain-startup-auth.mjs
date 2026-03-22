import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { mintStaffIdTokenFromPortalEnv } from "./firebase-auth-token.mjs";
import { inspectTokenFreshness } from "./codex-startup-reliability.mjs";

function clean(value) {
  return String(value ?? "").trim();
}

export function resolvePortalEnvPath(repoRoot, env = process.env) {
  return resolve(clean(env.PORTAL_AUTOMATION_ENV_PATH) || resolve(repoRoot, "secrets", "portal", "portal-automation.env"));
}

export function resolvePortalCredentialsPath(repoRoot, env = process.env) {
  const candidates = [
    clean(env.PORTAL_AGENT_STAFF_CREDENTIALS),
    resolve(repoRoot, "secrets", "portal", "portal-agent-staff.json"),
    resolve(homedir(), ".ssh", "portal-agent-staff.json"),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

function hasPortalAuthInputs(env) {
  return Boolean(
    clean(env.PORTAL_FIREBASE_API_KEY || env.FIREBASE_WEB_API_KEY) ||
      clean(env.PORTAL_STAFF_EMAIL) ||
      clean(env.PORTAL_STAFF_PASSWORD) ||
      clean(env.PORTAL_STAFF_REFRESH_TOKEN) ||
      clean(env.PORTAL_AGENT_STAFF_CREDENTIALS_JSON) ||
      clean(env.PORTAL_AGENT_STAFF_CREDENTIALS)
  );
}

export async function hydrateStudioBrainAuthFromPortal({ repoRoot, env = process.env } = {}) {
  const tokenFreshness = inspectTokenFreshness(
    env.STUDIO_BRAIN_AUTH_TOKEN || env.STUDIO_BRAIN_ID_TOKEN || env.STUDIO_BRAIN_MCP_ID_TOKEN || ""
  );
  if (tokenFreshness.state === "fresh" || tokenFreshness.state === "expiring") {
    return {
      ok: true,
      hydrated: false,
      reason: "",
      source: "existing-token",
      tokenFreshness,
    };
  }

  const credentialsPath = resolvePortalCredentialsPath(repoRoot, env);
  if (credentialsPath && !clean(env.PORTAL_AGENT_STAFF_CREDENTIALS)) {
    env.PORTAL_AGENT_STAFF_CREDENTIALS = credentialsPath;
  }
  if (!hasPortalAuthInputs(env)) {
    return {
      ok: false,
      hydrated: false,
      reason: tokenFreshness.state === "expired" ? "expired_token" : "missing_token",
      source: "missing-portal-auth-inputs",
      tokenFreshness,
    };
  }

  const minted = await mintStaffIdTokenFromPortalEnv({
    env,
    defaultCredentialsPath: credentialsPath || resolve(repoRoot, "secrets", "portal", "portal-agent-staff.json"),
    preferRefreshToken: true,
  });

  if (!minted.ok || !minted.token) {
    return {
      ok: false,
      hydrated: false,
      reason: minted.reason || (tokenFreshness.state === "expired" ? "expired_token" : "missing_token"),
      source: minted.source || "portal-auth-mint-failed",
      tokenFreshness,
    };
  }

  env.STUDIO_BRAIN_ID_TOKEN = minted.token;
  env.STUDIO_BRAIN_AUTH_TOKEN = minted.token;
  env.STUDIO_BRAIN_MCP_ID_TOKEN = minted.token;
  return {
    ok: true,
    hydrated: true,
    reason: "",
    source: minted.source || "portal-auth",
    tokenFreshness: inspectTokenFreshness(minted.token),
  };
}
