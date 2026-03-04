import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolveStudioBrainNetworkProfile } from "./studio-network-profile.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const args = process.argv.slice(2);

const parseArgs = () => {
  const options = {
    only: "firestore,functions,auth",
    project: "monsoonfire-portal",
    config: "firebase.json",
    host: null,
    networkProfile: null,
    skipNetworkCheck: false,
    skipContractCheck: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (!arg.startsWith("--")) {
      continue;
    }

    if (arg.startsWith("--only=")) {
      options.only = arg.substring("--only=".length);
      continue;
    }

    if (arg === "--only" && args[i + 1]) {
      options.only = args[++i];
      continue;
    }

    if (arg.startsWith("--project=")) {
      options.project = arg.substring("--project=".length);
      continue;
    }

    if (arg === "--project" && args[i + 1]) {
      options.project = args[++i];
      continue;
    }

    if (arg.startsWith("--config=")) {
      options.config = arg.substring("--config=".length);
      continue;
    }

    if (arg === "--config" && args[i + 1]) {
      options.config = args[++i];
      continue;
    }

    if (arg.startsWith("--host=")) {
      options.host = arg.substring("--host=".length);
      continue;
    }

    if (arg === "--host" && args[i + 1]) {
      options.host = args[++i];
      continue;
    }

    if (arg.startsWith("--network-profile=")) {
      options.networkProfile = arg.substring("--network-profile=".length);
      continue;
    }

    if (arg === "--network-profile" && args[i + 1]) {
      options.networkProfile = args[++i];
      continue;
    }

    if (arg === "--no-network-check") {
      options.skipNetworkCheck = true;
      continue;
    }

    if (arg === "--no-contract-check") {
      options.skipContractCheck = true;
      continue;
    }
  }

  return options;
};

const loadDotenv = (filePath, { overwrite = true } = {}) => {
  if (!existsSync(filePath)) {
    console.log(`No ${filePath} found. Using current process environment.`);
    return;
  }

  console.log(`Loading local env from ${filePath}`);
  const text = readFileSync(filePath, "utf8");
  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      return;
    }

    const splitIndex = line.indexOf("=");
    if (splitIndex === -1) {
      return;
    }

    const key = line.slice(0, splitIndex).trim();
    const value = line.slice(splitIndex + 1);
    if (!key) {
      return;
    }

    if (!overwrite && typeof process.env[key] === "string" && process.env[key].trim().length > 0) {
      return;
    }
    process.env[key] = value;
  });
};

const { only, project, config, host, networkProfile, skipNetworkCheck, skipContractCheck } = parseArgs();
const functionsEnvFile = resolve(repoRoot, "functions", ".env.local");
const webEnvFile = resolve(repoRoot, "web", ".env.local");
const resolvedConfig = resolve(repoRoot, config);

loadDotenv(functionsEnvFile, { overwrite: false });
loadDotenv(webEnvFile, { overwrite: false });

const network = resolveStudioBrainNetworkProfile({
  env: {
    ...process.env,
    ...(networkProfile ? { STUDIO_BRAIN_NETWORK_PROFILE: networkProfile } : {}),
  },
});
const emulatorHost = host || network.emulatorHost;
const warnings = network.warnings || [];
const contractCheckEnv = {
  ...process.env,
  ...(networkProfile ? { STUDIO_BRAIN_NETWORK_PROFILE: networkProfile } : {}),
};

if (warnings.length > 0) {
  for (const warning of warnings) {
    console.log(`warn: ${warning}`);
  }
}

if (!skipContractCheck) {
  const contractCheck = spawnSync(
    "node",
    ["./scripts/validate-emulator-contract.mjs", "--strict"],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: contractCheckEnv,
    },
  );
  if (contractCheck.status !== 0) {
    console.error("Aborting emulator startup: emulator contract check failed.");
    process.exit(contractCheck.status || 1);
  }
}

if (!skipNetworkCheck) {
  const networkCheck = spawnSync(
    "node",
    ["./scripts/studiobrain-network-check.mjs", "--gate", "--write-state"],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: contractCheckEnv,
    },
  );
  if (networkCheck.status !== 0) {
    console.error("Aborting emulator startup: studio-brain network profile check failed.");
    process.exit(networkCheck.status || 1);
  }
}

console.log(`Using Studiobrain network profile: ${network.profile} (${network.profileLabel})`);
console.log(`Emulator host: ${emulatorHost}`);

console.log(`Starting Firebase emulators (${only}) for project ${project}...`);

const maybeApplyHostToConfig = (configPath, selectedEmulators, targetHost) => {
  if (!targetHost) return configPath;

  const knownEmulators = new Set([
    "apphosting",
    "auth",
    "functions",
    "firestore",
    "database",
    "hosting",
    "pubsub",
    "storage",
    "eventarc",
    "dataconnect",
    "tasks",
  ]);
  const selected = String(selectedEmulators || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => knownEmulators.has(value));
  if (selected.length === 0) return configPath;

  const configJson = JSON.parse(readFileSync(configPath, "utf8"));
  if (!configJson.emulators || typeof configJson.emulators !== "object") {
    return configPath;
  }

  let patched = false;
  for (const emulator of selected) {
    const current = configJson.emulators[emulator];
    if (!current || typeof current !== "object") continue;
    if (current.host === targetHost) continue;
    configJson.emulators[emulator] = { ...current, host: targetHost };
    patched = true;
  }

  if (!patched) return configPath;

  const runtimeDir = mkdtempSync(join(tmpdir(), "mf-emulators-"));
  const runtimeConfigPath = join(runtimeDir, "firebase.runtime.host.json");
  writeFileSync(runtimeConfigPath, `${JSON.stringify(configJson, null, 2)}\n`, "utf8");
  console.log(`Using runtime emulator config with host bindings: ${runtimeConfigPath}`);
  return runtimeConfigPath;
};

const runtimeConfigPath = maybeApplyHostToConfig(resolvedConfig, only, emulatorHost);

const result = spawnSync(
  "firebase",
  [
    "emulators:start",
    "--config",
    runtimeConfigPath,
    "--project",
    project,
    "--only",
    only,
  ],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
