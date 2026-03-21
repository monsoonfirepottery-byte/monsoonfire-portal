import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");
const HOME_ROOT = homedir();

function clean(value) {
  return String(value ?? "").trim();
}

export function expandHomePath(input) {
  const raw = clean(input);
  if (!raw || raw === "~") return HOME_ROOT;
  if (raw.startsWith("~/")) return resolve(HOME_ROOT, raw.slice(2));
  return raw;
}

function resolveConfiguredPath(filePath) {
  const raw = clean(filePath);
  if (!raw) return "";
  const expanded = expandHomePath(raw);
  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
}

export function resolveHomeOrRepoDefault(...relativeCandidates) {
  const candidates = relativeCandidates.map((candidate) => clean(candidate)).filter(Boolean);
  for (const relativePath of candidates) {
    const homePath = resolve(HOME_ROOT, relativePath);
    if (existsSync(homePath)) return homePath;
    const repoPath = resolve(REPO_ROOT, relativePath);
    if (existsSync(repoPath)) return repoPath;
  }
  return candidates.length > 0 ? resolve(HOME_ROOT, candidates[0]) : HOME_ROOT;
}

export function resolvePortalAutomationEnvPath(env = process.env) {
  const configured = resolveConfiguredPath(env.PORTAL_AUTOMATION_ENV_PATH);
  return configured || resolveHomeOrRepoDefault("secrets/portal/portal-automation.env");
}

export function resolvePortalAgentStaffCredentialsPath(env = process.env) {
  const configured = resolveConfiguredPath(env.PORTAL_AGENT_STAFF_CREDENTIALS);
  return configured || resolveHomeOrRepoDefault("secrets/portal/portal-agent-staff.json");
}

export function loadEnvFileIfPresent(filePath, env = process.env) {
  if (!filePath || !existsSync(filePath)) {
    return { loaded: false, path: filePath };
  }

  const raw = readFileSync(filePath, "utf8");
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim().replace(/^export\s+/, "");
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (clean(env[key])) continue;

    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }

  return { loaded: true, path: filePath };
}

export function loadPortalAutomationEnv(env = process.env) {
  return loadEnvFileIfPresent(resolvePortalAutomationEnvPath(env), env);
}

function extractServerHost(server) {
  const raw = clean(server);
  if (!raw) return "";
  const atIndex = raw.lastIndexOf("@");
  return atIndex >= 0 ? raw.slice(atIndex + 1) : raw;
}

function parseSshConfigBlocks(raw) {
  const blocks = [];
  let current = null;

  const pushCurrent = () => {
    if (current && current.hostPatterns.length > 0) {
      blocks.push(current);
    }
  };

  for (const rawLine of String(raw || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^([A-Za-z][A-Za-z0-9]*)\s+(.*)$/.exec(line);
    if (!match) continue;

    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (!value) continue;

    if (key === "host") {
      pushCurrent();
      current = {
        hostPatterns: value.split(/\s+/).map((part) => clean(part)).filter(Boolean),
        hostName: "",
        identityFiles: [],
      };
      continue;
    }

    if (!current) continue;
    if (key === "hostname") {
      current.hostName = value;
      continue;
    }
    if (key === "identityfile") {
      current.identityFiles.push(expandHomePath(value));
    }
  }

  pushCurrent();
  return blocks;
}

function matchesHostPattern(pattern, candidate) {
  const rawPattern = clean(pattern);
  const rawCandidate = clean(candidate);
  if (!rawPattern || !rawCandidate) return false;
  if (rawPattern === rawCandidate) return true;

  const escaped = rawPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(rawCandidate);
}

function findIdentityFileInSshConfig(configPath, { aliases = [], hostName = "" } = {}) {
  if (!configPath || !existsSync(configPath)) return "";

  const blocks = parseSshConfigBlocks(readFileSync(configPath, "utf8"));
  const hostAliases = aliases.map((value) => clean(value)).filter(Boolean);
  const desiredHostName = clean(hostName);

  for (const block of blocks) {
    const aliasMatch = hostAliases.some((alias) =>
      block.hostPatterns.some((pattern) => matchesHostPattern(pattern, alias))
    );
    const hostNameMatch = desiredHostName && clean(block.hostName).toLowerCase() === desiredHostName.toLowerCase();
    if (!aliasMatch && !hostNameMatch) continue;

    const existingIdentity = block.identityFiles.find((identityFile) => existsSync(identityFile));
    if (existingIdentity) return existingIdentity;
    if (block.identityFiles.length > 0) return block.identityFiles[0];
  }

  return "";
}

export function resolveNamecheapSshKeyPath({ explicitPath = "", server = "", env = process.env } = {}) {
  const configured = resolveConfiguredPath(explicitPath || env.WEBSITE_DEPLOY_KEY);
  if (configured) {
    return {
      path: configured,
      exists: existsSync(configured),
      source: explicitPath ? "cli --key / WEBSITE_DEPLOY_KEY" : "WEBSITE_DEPLOY_KEY",
    };
  }

  const defaultPath = expandHomePath("~/.ssh/namecheap-portal");
  if (existsSync(defaultPath)) {
    return {
      path: defaultPath,
      exists: true,
      source: "default ~/.ssh/namecheap-portal",
    };
  }

  const sshConfigPath = resolve(HOME_ROOT, ".ssh", "config");
  const serverHost = extractServerHost(server || env.WEBSITE_DEPLOY_SERVER);
  const configIdentity = findIdentityFileInSshConfig(sshConfigPath, {
    aliases: ["monsoonfire", serverHost],
    hostName: serverHost,
  });
  if (configIdentity) {
    return {
      path: configIdentity,
      exists: existsSync(configIdentity),
      source: `ssh config (${sshConfigPath})`,
    };
  }

  return {
    path: defaultPath,
    exists: false,
    source: "default ~/.ssh/namecheap-portal",
  };
}
