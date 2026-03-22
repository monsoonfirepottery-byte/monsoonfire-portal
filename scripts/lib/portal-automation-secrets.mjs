import { homedir } from "node:os";
import { resolve } from "node:path";

const HOME_ROOT = homedir();

export const PORTAL_SECRET_SYNC_COMMAND = "npm run secrets:portal:sync";
export const PORTAL_SECRET_PROVIDER_DEFAULT = "1password";
export const PORTAL_1PASSWORD_DEFAULTS = {
  vault: "Monsoon Fire Portal Automation",
  envItem: "portal-automation-env",
  agentStaffItem: "portal-agent-staff",
  staffPasswordItem: "portal-staff-password",
};
export const PORTAL_LOCAL_ONLY_ENV_KEYS = [
  "GOOGLE_APPLICATION_CREDENTIALS",
  "WEBSITE_DEPLOY_KEY",
  "PORTAL_AUTOMATION_ENV_PATH",
  "PORTAL_AGENT_STAFF_CREDENTIALS",
];

function clean(value) {
  return String(value ?? "").trim();
}

export function parseEnvText(raw) {
  const values = {};
  for (const rawLine of String(raw || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim().replace(/^export\s+/, "");
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function formatEnvValue(value) {
  const raw = String(value ?? "");
  if (!raw) return "";
  if (!/[\s#"']/.test(raw)) return raw;
  if (!raw.includes("\"")) return `"${raw}"`;
  if (!raw.includes("'")) return `'${raw}'`;
  return raw;
}

export function serializeEnvText(values, { headerLines = [] } = {}) {
  const lines = headerLines.map((line) => `# ${String(line || "").trim()}`).filter(Boolean);
  const keys = Object.keys(values || {})
    .filter((key) => clean(values[key]))
    .sort((left, right) => left.localeCompare(right));

  for (const key of keys) {
    lines.push(`${key}=${formatEnvValue(values[key])}`);
  }

  return `${lines.join("\n")}\n`;
}

export function validatePortalAutomationEnv(values) {
  const envValues = values && typeof values === "object" ? values : {};
  const missing = [];
  if (!clean(envValues.PORTAL_STAFF_EMAIL)) {
    missing.push("PORTAL_STAFF_EMAIL");
  }
  if (!clean(envValues.FIREBASE_RULES_API_TOKEN)) {
    missing.push("FIREBASE_RULES_API_TOKEN");
  }
  if (!clean(envValues.PORTAL_FIREBASE_API_KEY) && !clean(envValues.FIREBASE_WEB_API_KEY)) {
    missing.push("PORTAL_FIREBASE_API_KEY|FIREBASE_WEB_API_KEY");
  }
  return {
    ok: missing.length === 0,
    missing,
  };
}

export function parsePortalAgentStaffPayload(raw) {
  try {
    const parsed = JSON.parse(String(raw || ""));
    if (!parsed || typeof parsed !== "object") return null;
    return {
      ...parsed,
      email: clean(parsed.email || parsed.staffEmail),
      password: clean(parsed.password || parsed.staffPassword),
      uid: clean(parsed.uid),
      refreshToken: clean(parsed.refreshToken || parsed.tokens?.refresh_token),
    };
  } catch {
    return null;
  }
}

export function validatePortalAgentStaffCredentials(payload) {
  const normalized = payload && typeof payload === "object" ? payload : {};
  const missing = [];
  if (!clean(normalized.email)) missing.push("email");
  if (!clean(normalized.uid)) missing.push("uid");
  if (!clean(normalized.refreshToken)) missing.push("refreshToken");
  return {
    ok: missing.length === 0,
    missing,
  };
}

export function extractOnePasswordLoginCredentials(itemPayload) {
  const fields = Array.isArray(itemPayload?.fields) ? itemPayload.fields : [];
  let email = "";
  let password = "";

  for (const field of fields) {
    const purpose = clean(field?.purpose).toLowerCase();
    const id = clean(field?.id).toLowerCase();
    const label = clean(field?.label).toLowerCase();
    const value = clean(field?.value);

    if (!password && value && (purpose === "password" || id === "password" || label === "password")) {
      password = value;
      continue;
    }

    if (
      !email &&
      value &&
      (purpose === "username" ||
        id === "username" ||
        label === "username" ||
        label === "email" ||
        label === "email address")
    ) {
      email = value;
    }
  }

  if (!password && clean(itemPayload?.notesPlain)) {
    password = clean(itemPayload.notesPlain);
  }

  return { email, password };
}

export function mergePortalAutomationEnv({
  remoteEnvText,
  existingEnvText = "",
  portalAgentStaffPath = resolve(HOME_ROOT, "secrets", "portal", "portal-agent-staff.json"),
  optionalPassword = "",
  optionalEmail = "",
} = {}) {
  const remoteValues = parseEnvText(remoteEnvText);
  const existingValues = parseEnvText(existingEnvText);
  const merged = { ...remoteValues };
  const preservedKeys = [];

  for (const key of PORTAL_LOCAL_ONLY_ENV_KEYS) {
    if (!clean(merged[key]) && clean(existingValues[key])) {
      merged[key] = existingValues[key];
      preservedKeys.push(key);
    }
  }

  if (portalAgentStaffPath) {
    merged.PORTAL_AGENT_STAFF_CREDENTIALS = portalAgentStaffPath;
  }

  if (!clean(merged.PORTAL_STAFF_EMAIL) && clean(optionalEmail)) {
    merged.PORTAL_STAFF_EMAIL = clean(optionalEmail);
  }

  if (clean(optionalPassword)) {
    merged.PORTAL_STAFF_PASSWORD = clean(optionalPassword);
  } else {
    delete merged.PORTAL_STAFF_PASSWORD;
  }

  return {
    envValues: merged,
    envText: serializeEnvText(merged, {
      headerLines: [
        "Generated by npm run secrets:portal:sync from the dedicated 1Password vault.",
        "Local-only path variables are preserved from the previous cache when present.",
      ],
    }),
    preservedKeys,
  };
}

export function resolvePortalSecretProviderConfig(env = process.env) {
  return {
    provider: clean(env.PORTAL_SECRET_PROVIDER) || PORTAL_SECRET_PROVIDER_DEFAULT,
    vault: clean(env.PORTAL_1PASSWORD_VAULT) || PORTAL_1PASSWORD_DEFAULTS.vault,
    envItem: clean(env.PORTAL_1PASSWORD_ENV_ITEM) || PORTAL_1PASSWORD_DEFAULTS.envItem,
    agentStaffItem:
      clean(env.PORTAL_1PASSWORD_AGENT_STAFF_ITEM) || PORTAL_1PASSWORD_DEFAULTS.agentStaffItem,
    staffPasswordItem:
      clean(env.PORTAL_1PASSWORD_STAFF_PASSWORD_ITEM) || PORTAL_1PASSWORD_DEFAULTS.staffPasswordItem,
  };
}
