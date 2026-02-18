#!/usr/bin/env node
import dns from "node:dns/promises";
import { existsSync, readFileSync } from "node:fs";

import { resolveStudioBrainNetworkProfile } from "./studio-network-profile.mjs";

const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const gate = args.has("--gate");
const strict = args.has("--strict");

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

function summary(lines) {
  return lines.filter(Boolean).map((line) => `  - ${line}`).join("\n");
}

async function main() {
  const issues = [];
  const warnings = [];

  if (!network.baseUrl) {
    issues.push("No base URL resolved from network profile.");
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
        `Host drift detected for profile "${network.profile}":`
          + ` previous="${state.state.host}" current="${network.host}".`,
      );
    }
  }

  const result = {
    timestamp: nowIso,
    status: issues.length === 0 ? "pass" : "fail",
    strictMode: strict,
    networkProfile: network.profile,
    requestedProfile: network.requestedProfile,
    host: network.host,
    baseUrl: network.baseUrl,
    hostMode: hostResolution.mode,
    hostAddresses: hostResolution.addresses,
    hostStateFile: network.hostStateFile,
    issues,
    warnings,
  };

  const hardFail = issues.length > 0 || (strict && warnings.length > 0);
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
