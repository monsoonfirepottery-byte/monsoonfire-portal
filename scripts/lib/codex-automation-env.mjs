import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function clean(value) {
  return String(value ?? "").trim();
}

export function loadEnvFileIntoEnv(relativePath, { repoRoot, env = process.env, overwrite = false } = {}) {
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
  const content = String(readFileSync(envFile, "utf8"));
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex < 0) continue;

    const key = line.slice(0, eqIndex).trim().replace(/^export\s+/, "");
    let value = line.slice(eqIndex + 1).trim();
    if (!key || /\s/.test(key)) continue;

    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
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

export function loadCodexAutomationEnv({ repoRoot, env = process.env, overwrite = false } = {}) {
  return [
    loadEnvFileIntoEnv("secrets/studio-brain/studio-brain-automation.env", { repoRoot, env, overwrite }),
    loadEnvFileIntoEnv("studio-brain/.env", { repoRoot, env, overwrite }),
    loadEnvFileIntoEnv("studio-brain/.env.local", { repoRoot, env, overwrite }),
    loadEnvFileIntoEnv("secrets/portal/portal-automation.env", { repoRoot, env, overwrite }),
  ];
}
