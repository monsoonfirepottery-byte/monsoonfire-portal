#!/usr/bin/env node
import dns from "node:dns/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { resolveStudioBrainNetworkProfile } from "./studio-network-profile.mjs";

const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const gate = args.has("--gate");
const strict = args.has("--strict");
const writeState = args.has("--write-state") || args.has("--persist-state");
const parseArgs = process.argv.slice(2);
let artifactPath = null;

for (let index = 0; index < parseArgs.length; index += 1) {
  if (parseArgs[index] === "--artifact") {
    artifactPath = parseArgs[index + 1] || null;
    index += 1;
    continue;
  }

  if (parseArgs[index]?.startsWith("--artifact=")) {
    artifactPath = parseArgs[index].substring("--artifact=".length);
  }
}

const network = resolveStudioBrainNetworkProfile();
const nowIso = new Date().toISOString();

function isLoopback(host) {
  const value = String(host || "").toLowerCase();
  return value === "127.0.0.1" || value === "localhost" || value === "::1";
}

function validateIPv4(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (part === "") return false;
    const n = Number.parseInt(part, 10);
    return Number.isInteger(n) && n >= 0 && n <= 255 && String(n) === part;
  });
}

async function resolveHost(host) {
  if (isLoopback(host)) {
    return {
      mode: "loopback",
      addresses: [host],
      resolved: true,
      entries: [{ address: host, family: 0 }],
    };
  }

  try {
    const entries = await dns.lookup(host, { all: true });
    return {
      mode: "dns",
      addresses: entries.map((entry) => entry.address),
      resolved: entries.length > 0,
      entries,
    };
  } catch (error) {
    return {
      mode: "dns",
      addresses: [],
      resolved: false,
      error: error?.message || String(error),
      entries: [],
    };
  }
}

function loadHostState(stateFile) {
  if (!stateFile || !existsSync(stateFile)) {
    return { ok: true, state: null, missing: true };
  }

  try {
    const raw = readFileSync(stateFile, "utf8");
    const state = JSON.parse(raw);
    return { ok: true, state };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error),
      state: null,
    };
  }
}

function saveHostState(stateFile, payload) {
  if (!stateFile) {
    return { ok: false, reason: "Missing host state file path." };
  }

  const parent = dirname(stateFile);
  if (parent && parent !== "." && parent !== "..") {
    mkdirSync(parent, { recursive: true });
  }

  const payloadWithMeta = { ...payload, updatedAt: nowIso, schemaVersion: "1" };
  writeFileSync(stateFile, `${JSON.stringify(payloadWithMeta, null, 2)}\n`, "utf8");
  return { ok: true };
}

function summary(lines) {
  return lines.filter(Boolean).map((line) => `  - ${line}`).join("\n");
}

async function main() {
  const issues = [];
  const warnings = [];

  if (!network.baseUrl) {
    issues.push("No base URL resolved from network profile.");
  }

  if (network.networkTargetMode === "static" && !network.staticIpEnabled) {
    issues.push("LAN static profile is active but STUDIO_BRAIN_STATIC_IP is not configured.");
  }

  if (network.networkTargetMode === "dhcp" && network.hostSource?.includes("STUDIO_BRAIN_STATIC_IP")) {
    warnings.push("Static IP source was provided while profile is DHCP-oriented; confirm this is intentional.");
  }

  if (network.profileSource && network.profileSource !== "environment" && network.profileSource !== "network profile file") {
    warnings.push(`Host profile source is ${network.profileSource}; verify this is expected.`);
  }

  if (network.requestedProfile && network.requestedProfile !== network.profile) {
    warnings.push(`Requested profile "${network.requestedProfile}" normalized to "${network.profile}".`);
  }

  if ((network.profile === "lan-static" || network.profile === "lan-dhcp") && isLoopback(network.host)) {
    issues.push(
      `Profile ${network.profile} is using loopback host "${network.host}".` +
        ` Use ${network.profile === "lan-static" ? "STUDIO_BRAIN_STATIC_IP" : "a stable hostname"} for remote workflows.`,
    );
  }

  if (network.profile === "lan-static" && network.host && !validateIPv4(network.host)) {
    issues.push(`lan-static profile host "${network.host}" is not a valid IPv4 address.`);
  }

  network.warnings.forEach((entry) => warnings.push(entry));

  const hostResolution = await resolveHost(network.host);
  if (!hostResolution.resolved) {
    issues.push(`Unable to resolve host "${network.host}". ${hostResolution.error || "No DNS result."}`);
  }

  const state = loadHostState(network.hostStateFile);
  if (!state.ok) {
    warnings.push(`Host state file "${network.hostStateFile}" exists but cannot be read: ${state.error}`);
  }
  if (state.state && state.state.host && state.state.profile) {
    if (
      state.state.profile === network.profile &&
      String(state.state.host || "").toLowerCase() !== String(network.host || "").toLowerCase()
    ) {
      warnings.push(
        `Host drift detected for profile "${network.profile}":` +
          ` previous="${state.state.host}" current="${network.host}".`,
      );
    }
  }

  const statePersistRequested = writeState;
  const preStateHardFail = issues.length > 0 || (strict && warnings.length > 0);
  const lease = {
    enabled: Boolean(state.state),
    lastProfile: state.state?.profile || "",
    lastRequestedProfile: state.state?.requestedProfile || "",
    lastHost: state.state?.host || "",
    lastBaseUrl: state.state?.baseUrl || "",
    lastUpdatedAt: state.state?.updatedAt || "",
    changed: Boolean(
      state.state &&
      (state.state.profile === network.profile) &&
      String(state.state.host || "").toLowerCase() !== String(network.host || "").toLowerCase(),
    ),
  };

  if (lease.enabled && lease.changed && !strict) {
    warnings.push(`Host identity changed for ${network.profile} profile: previous=${lease.lastHost}; current=${network.host}.`);
  }

  let stateSaved = false;
  const stateSaveWarning = [];
  if (statePersistRequested && !preStateHardFail) {
    const statePayload = {
      profile: network.profile,
      requestedProfile: network.requestedProfile,
      host: network.host,
      hostMode: hostResolution.mode,
      addresses: hostResolution.addresses,
      baseUrl: network.baseUrl,
    };

    try {
      const stateResult = saveHostState(network.hostStateFile, statePayload);
      stateSaved = stateResult.ok;
      if (!stateResult.ok) {
        stateSaveWarning.push(`Host state not persisted: ${stateResult.reason}`);
      }
    } catch (error) {
      stateSaved = false;
      stateSaveWarning.push(`Host state persistence failed: ${error?.message || String(error)}`);
    }
  } else if (!statePersistRequested) {
    stateSaved = false;
  }

  stateSaveWarning.forEach((entry) => warnings.push(entry));

  const hardFail = issues.length > 0 || (strict && warnings.length > 0);

  const result = {
    timestamp: nowIso,
    status: hardFail ? "fail" : "pass",
    strictMode: strict,
    networkProfile: network.profile,
    networkTargetMode: network.networkTargetMode,
    profileSource: network.profileSource,
    hostSource: network.hostSource,
    staticIpEnabled: network.staticIpEnabled,
    requestedProfile: network.requestedProfile,
    host: network.host,
    baseUrl: network.baseUrl,
    hostMode: hostResolution.mode,
    hostAddresses: hostResolution.addresses,
    lease,
    hostStateFile: network.hostStateFile,
    stateSaved,
    issues,
    warnings,
  };

  if (artifactPath) {
    const artifactDir = dirname(resolve(process.cwd(), artifactPath));
    if (artifactDir) {
      mkdirSync(artifactDir, { recursive: true });
    }
    writeFileSync(resolve(process.cwd(), artifactPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    result.artifact = resolve(process.cwd(), artifactPath);
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`studiobrain network check: ${hardFail ? "FAIL" : "PASS"}\n`);
    process.stdout.write(`  profile: ${network.profile}\n`);
    process.stdout.write(`  requestedProfile: ${network.requestedProfile || network.profile}\n`);
    process.stdout.write(`  host: ${network.host}\n`);
    process.stdout.write(`  baseUrl: ${network.baseUrl}\n`);
    process.stdout.write(`  host mode: ${hostResolution.mode}\n`);
    if (hostResolution.addresses.length > 0) {
      process.stdout.write(`  addresses: ${hostResolution.addresses.join(", ")}\n`);
    }
    if (hostResolution.error) {
      process.stdout.write(`  resolve error: ${hostResolution.error}\n`);
    }
    if (statePersistRequested) {
      process.stdout.write(`  state file: ${stateSaved ? "updated" : "not updated"} (${network.hostStateFile})\n`);
    }

    if (issues.length > 0) {
      process.stdout.write("  issues:\n");
      process.stdout.write(`${summary(issues)}\n`);
    }

    if (warnings.length > 0) {
      process.stdout.write("  warnings:\n");
      process.stdout.write(`${summary(warnings)}\n`);
    }

    if (hardFail && strict && warnings.length > 0) {
      process.stdout.write("  strict mode: warnings are treated as failures.\n");
    }
  }

  if (hardFail && gate) process.exit(1);
}

void main().catch((error) => {
  process.stderr.write(`studiobrain network check failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
