#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const requiredProfiles = [
  'docs_research',
  'infra_docs',
  'home_automation',
  'apple_home',
  'cloudflare',
];
const cloudflareManagedIds = ['cloudflare_docs', 'cloudflare_browser_rendering'];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const docsPath = path.join(repoRoot, 'docs', 'SOURCE_OF_TRUTH_INDEX.md');
const codexConfigPath = path.join(os.homedir(), '.codex', 'config.toml');

const errors = [];

function parseTomlValue(rawValue) {
  const value = rawValue.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  return value;
}

function readCanonicalSetFromDocs(markdown) {
  const sectionMatch = markdown.match(/## 3\) MCP & External Sources([\s\S]*?)(?:\n## \d+\)|$)/);
  if (!sectionMatch) {
    throw new Error('Could not find section "## 3) MCP & External Sources" in docs/SOURCE_OF_TRUTH_INDEX.md');
  }

  const sectionBody = sectionMatch[1];
  const canonical = new Set();
  for (const match of sectionBody.matchAll(/mcp_servers\.([a-zA-Z0-9_]+)/g)) {
    const key = match[1];
    const offset = (match.index ?? -1) + match[0].length;
    const hasWildcardSuffix = offset >= 0 && sectionBody[offset] === '*';
    if (hasWildcardSuffix) continue;
    canonical.add(key);
  }

  if (canonical.size === 0) {
    throw new Error('No canonical MCP keys were extracted from docs section 3.');
  }

  return canonical;
}

function parseCodexConfigToml(toml) {
  const topServers = new Map();
  const profileServers = new Map();

  let current = null;
  const lines = toml.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const tableMatch = line.match(/^\[([^\]]+)\]$/);
    if (tableMatch) {
      const tablePath = tableMatch[1];

      if (tablePath.startsWith('mcp_servers.')) {
        const serverId = tablePath.slice('mcp_servers.'.length);
        current = { kind: 'top', serverId };
        if (!topServers.has(serverId)) topServers.set(serverId, {});
      } else {
        const profileMatch = tablePath.match(/^profiles\.([^.]+)\.mcp_servers\.([^.]+)$/);
        if (profileMatch) {
          const profileName = profileMatch[1];
          const serverId = profileMatch[2];
          current = { kind: 'profile', profileName, serverId };
          if (!profileServers.has(profileName)) profileServers.set(profileName, new Map());
          const profileMap = profileServers.get(profileName);
          if (!profileMap.has(serverId)) profileMap.set(serverId, {});
        } else {
          current = null;
        }
      }
      continue;
    }

    const keyValueMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!keyValueMatch || !current) continue;

    const [, key, rawValue] = keyValueMatch;
    const parsedValue = parseTomlValue(rawValue);

    if (current.kind === 'top') {
      const existing = topServers.get(current.serverId);
      existing[key] = parsedValue;
      topServers.set(current.serverId, existing);
    } else if (current.kind === 'profile') {
      const profileMap = profileServers.get(current.profileName);
      const existing = profileMap.get(current.serverId);
      existing[key] = parsedValue;
      profileMap.set(current.serverId, existing);
      profileServers.set(current.profileName, profileMap);
    }
  }

  return { topServers, profileServers };
}

function addError(message) {
  errors.push(`- ${message}`);
}

function hasDeprecatedModelConfig(toml) {
  const hasLegacyProviders = /^\s*\[\[?model_providers(?:[.\]])/m.test(toml);
  const hasLegacyModels = /^\s*\[\[?models(?:[.\]])/m.test(toml);
  return hasLegacyProviders || hasLegacyModels;
}

function main() {
  if (!fs.existsSync(docsPath)) {
    console.error('FAIL');
    console.error(`- Missing docs file: ${docsPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(codexConfigPath)) {
    console.error('FAIL');
    console.error(`- Missing config file: ${codexConfigPath}`);
    process.exit(1);
  }

  const docsMarkdown = fs.readFileSync(docsPath, 'utf8');
  const canonicalSet = readCanonicalSetFromDocs(docsMarkdown);
  const codexToml = fs.readFileSync(codexConfigPath, 'utf8');

  if (codexToml.toLowerCase().includes('/sse')) {
    addError('Found deprecated /sse endpoint string in ~/.codex/config.toml. Use streamable HTTP /mcp endpoints only.');
  }

  if (hasDeprecatedModelConfig(codexToml)) {
    addError(
      'Found deprecated model config blocks (`model_providers` / `models`) in ~/.codex/config.toml. Codex CLI 0.106.0+ expects top-level `model` + optional `model_provider`.'
    );
  }

  const { topServers, profileServers } = parseCodexConfigToml(codexToml);

  for (const serverId of topServers.keys()) {
    if (!canonicalSet.has(serverId)) {
      addError(`Non-canonical top-level MCP key detected: mcp_servers.${serverId}`);
    }
  }

  for (const canonicalId of canonicalSet) {
    if (!topServers.has(canonicalId)) {
      addError(`Missing canonical top-level MCP block: [mcp_servers.${canonicalId}]`);
    }
  }

  for (const [serverId, serverConfig] of topServers.entries()) {
    const hasUrl = typeof serverConfig.url === 'string' && serverConfig.url.length > 0;
    const hasCommand = typeof serverConfig.command === 'string' && serverConfig.command.length > 0;

    if (serverConfig.enabled === true) {
      addError(`Top-level mcp_servers.${serverId}.enabled is true. Keep all top-level MCP servers disabled by default.`);
    }

    if (serverConfig.enabled !== false) {
      addError(`Top-level mcp_servers.${serverId}.enabled must be false (found: ${String(serverConfig.enabled)}).`);
    }

    if (hasUrl === hasCommand) {
      addError(`Top-level [mcp_servers.${serverId}] must define exactly one transport field (url XOR command).`);
    }
  }

  for (const cloudflareId of cloudflareManagedIds) {
    const cloudflareConfig = topServers.get(cloudflareId);
    if (!cloudflareConfig) {
      addError(`Missing Cloudflare managed MCP block: [mcp_servers.${cloudflareId}]`);
      continue;
    }

    if (typeof cloudflareConfig.url !== 'string') {
      addError(`Cloudflare managed MCP ${cloudflareId} must define a remote url ending with /mcp.`);
      continue;
    }

    if (!cloudflareConfig.url.endsWith('/mcp')) {
      addError(`Cloudflare managed MCP ${cloudflareId} url must end with /mcp exactly (found: ${cloudflareConfig.url}).`);
    }
  }

  for (const requiredProfile of requiredProfiles) {
    if (!profileServers.has(requiredProfile)) {
      addError(`Missing required profile MCP section: profiles.${requiredProfile}.mcp_servers.*`);
    }
  }

  for (const [profileName, serverMap] of profileServers.entries()) {
    for (const [serverId, profileConfig] of serverMap.entries()) {
      if (!canonicalSet.has(serverId)) {
        addError(`Profile ${profileName} references non-canonical MCP key: mcp_servers.${serverId}`);
      }

      const keys = Object.keys(profileConfig);
      if (keys.length !== 1 || keys[0] !== 'enabled') {
        addError(`Profile block profiles.${profileName}.mcp_servers.${serverId} must only set enabled=true.`);
      }

      if (profileConfig.enabled !== true) {
        addError(`Profile block profiles.${profileName}.mcp_servers.${serverId}.enabled must be true (found: ${String(profileConfig.enabled)}).`);
      }
    }
  }

  if (errors.length > 0) {
    console.error('FAIL');
    for (const error of errors) {
      console.error(error);
    }
    process.exit(1);
  }

  console.log('PASS');
  console.log(`- Canonical keys: ${canonicalSet.size}`);
  console.log(`- Top-level MCP servers: ${topServers.size}`);
  console.log(`- Profiles checked: ${requiredProfiles.join(', ')}`);
  console.log(`- Config path: ${codexConfigPath}`);
}

main();
