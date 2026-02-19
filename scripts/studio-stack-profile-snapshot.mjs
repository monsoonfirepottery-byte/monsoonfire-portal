#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStudioBrainNetworkProfile } from "./studio-network-profile.mjs";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");
const DEFAULT_ARTIFACT = resolve(ROOT, "output", "studio-stack-profile", "latest.json");

const args = parseArgs(process.argv.slice(2));
const strictMode = args.strict;
const jsonMode = args.json;
const artifactPath = resolveArtifactPath(args.artifact);
const requestedProfileOverride = args.profile;

const network = resolveStudioBrainNetworkProfile({
  env: requestedProfileOverride
    ? {
      ...process.env,
      STUDIO_BRAIN_NETWORK_PROFILE: requestedProfileOverride,
    }
    : process.env,
});

const webEnv = parseEnvFile(resolve(ROOT, "web/.env.local"));
const websiteEnv = parseEnvFile(resolve(ROOT, "website/.env.local"));
const webResolvedEnv = { ...webEnv, ...process.env };
const websiteResolvedEnv = { ...websiteEnv, ...process.env };

const useAuthEmulator = parseBoolean(webResolvedEnv.VITE_USE_AUTH_EMULATOR);
const useFirestoreEmulator = parseBoolean(webResolvedEnv.VITE_FIRESTORE_EMULATOR);
const useEmulators = parseBoolean(webResolvedEnv.VITE_USE_EMULATORS);
const emulatorModeSummary = {
  useAuthEmulator,
  useFirestoreEmulator,
  useLegacyCatchall: useEmulators,
  enabled: useAuthEmulator.value || useFirestoreEmulator.value || useEmulators.value,
};

const checks = [];
const warnings = [];
const errors = [];
const isRemoteProfile = network.profile === "lan-dhcp" || network.profile === "lan-static";

const vite = {
  devHost: webResolvedEnv.VITE_DEV_HOST || network.host || "127.0.0.1",
  allowedHosts: splitCsv(webResolvedEnv.VITE_ALLOWED_HOSTS),
  functionsBaseUrl: webResolvedEnv.VITE_FUNCTIONS_BASE_URL || "",
  authEmulatorHost: webResolvedEnv.VITE_AUTH_EMULATOR_HOST || "",
  authEmulatorPort: webResolvedEnv.VITE_AUTH_EMULATOR_PORT || "",
  firestoreEmulatorHost: webResolvedEnv.VITE_FIRESTORE_EMULATOR_HOST || webResolvedEnv.FIRESTORE_EMULATOR_HOST || "",
  firestoreEmulatorPort: webResolvedEnv.VITE_FIRESTORE_EMULATOR_PORT || webResolvedEnv.FIRESTORE_EMULATOR_PORT || "",
  emulatorEnabled: useEmulators.value || useAuthEmulator.value || useFirestoreEmulator.value,
};

const website = {
  deployServer: websiteResolvedEnv.WEBSITE_DEPLOY_SERVER || "",
  deployPort: parseInt(websiteResolvedEnv.WEBSITE_DEPLOY_PORT || "", 10) || 21098,
  deployRemotePath: websiteResolvedEnv.WEBSITE_DEPLOY_REMOTE_PATH || "public_html/",
};

const snapshot = {
  timestamp: new Date().toISOString(),
  networkProfile: {
    requestedProfile: network.requestedProfile,
    resolvedProfile: network.profile,
    profileLabel: network.profileLabel,
    resolvedHost: network.host,
    baseUrl: network.baseUrl,
    allowedHosts: network.allowedStudioBrainHosts || [],
    hasLoopbackFallback: network.hasLoopbackFallback,
  },
  vite,
  website,
  effectiveContracts: {
    emulatorMode: useEmulators.value ? "legacy-catchall" : useAuthEmulator.value || useFirestoreEmulator.value ? "split-flag" : "off",
    canonicalEmulatorBootstrap: `npm run emulators:start -- --network-profile ${network.profile} --only firestore,functions,auth`,
    canonicalPortalSmoke: "npm run portal:smoke:playwright",
    canonicalWebsiteSmoke: "npm run website:smoke:playwright",
  },
  checks: {
    errors: 0,
    warnings: 0,
    details: [],
  },
  gateFindings: [],
};

const add = (severity, category, message, value = "") => {
  const finding = {
    severity,
    category,
    message,
    value,
  };
  snapshot.gateFindings.push(finding);
  if (severity === "error") {
    errors.push(finding);
    return;
  }
  if (severity !== "warning") {
    return;
  }
  warnings.push(finding);
};

const isLoopbackHost = (host) => {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(String(host || "").toLowerCase());
};

const normalizeUrlHost = (value) => {
  const candidate = String(value || "").trim();
  if (!candidate) {
    return "";
  }
  try {
    const parsed = candidate.startsWith("http")
      ? new URL(candidate)
      : new URL(`http://${candidate}`);
    return String(parsed.hostname || "").toLowerCase();
  } catch {
    return candidate.split("/")[0].split(":")[0].toLowerCase();
  }
};

const setCheck = ({ status, category, message, value }) => {
  checks.push({
    status,
    category,
    message,
    value,
  });
};

const evaluateProfileBinding = () => {
  setCheck({
    status: isRemoteProfile ? "expected-remote" : "expected-local",
    category: "network-profile",
    message: `Resolved ${network.profile} (${network.profileLabel}).`,
    value: network.host,
  });

  if (isRemoteProfile && !webResolvedEnv.VITE_DEV_HOST && !network.host.startsWith("http")) {
    add("pass", "vite-dev-host", `Vite dev host defaults to profile host ${network.host}.`);
  }

  if (isRemoteProfile && isLoopbackHost(vite.devHost)) {
    add(
      "error",
      "vite-dev-host",
      "Remote profile should not use loopback dev host. Set VITE_DEV_HOST or STUDIO_BRAIN_NETWORK_PROFILE accordingly.",
      vite.devHost,
    );
  }
  if (!isRemoteProfile && isLoopbackHost(vite.devHost)) {
    add("pass", "vite-dev-host", "Local profile allows loopback Vite host.", vite.devHost);
  }

  const functionsHost = normalizeUrlHost(vite.functionsBaseUrl);
  if (vite.functionsBaseUrl) {
    if (isRemoteProfile && isLoopbackHost(functionsHost)) {
      add(
        "error",
        "functions-base-url",
        "Remote profile requires non-loopback FUNCTIONS base URL in active host contract.",
        vite.functionsBaseUrl,
      );
    } else if (!isRemoteProfile && !isLoopbackHost(functionsHost)) {
      add("warning", "functions-base-url", "Local profile sees non-loopback functions base URL. Confirm this is intentional for this workspace.", vite.functionsBaseUrl);
    }
  } else if (vite.emulatorEnabled) {
    add("error", "functions-base-url", "VITE_FUNCTIONS_BASE_URL is required when emulator mode is enabled.");
  }

  const emulatorEnabled = vite.emulatorEnabled;
  if (emulatorEnabled) {
    if (!vite.authEmulatorHost && !vite.firestoreEmulatorHost) {
      add("warning", "emulator-hosts", "Emulator mode appears enabled but emulator host values are not fully defined.");
    }
    if (vite.authEmulatorHost) {
      if (isRemoteProfile && isLoopbackHost(vite.authEmulatorHost)) {
        add("error", "auth-host", "Remote profile requires auth emulator host to use profile reachable hostname/IP.", vite.authEmulatorHost);
      }
    } else if (isRemoteProfile) {
      add("error", "auth-host", "Auth emulator host must be set for remote profiles with emulator mode enabled.");
    }

    if (vite.firestoreEmulatorHost) {
      if (isRemoteProfile && isLoopbackHost(vite.firestoreEmulatorHost)) {
        add(
          "error",
          "firestore-host",
          "Remote profile requires firestore emulator host to use profile reachable hostname/IP.",
          vite.firestoreEmulatorHost,
        );
      }
    } else if (isRemoteProfile) {
      add("error", "firestore-host", "Firestore emulator host must be set for remote profiles with emulator mode enabled.");
    }
  } else if (vite.authEmulatorHost || vite.firestoreEmulatorHost) {
    add("warning", "emulator-toggle", "Emulator host variables are present while emulator toggle is disabled.");
  }
};

evaluateProfileBinding();

setCheck({
  status: "pass",
  category: "emulator-toggle",
  message: "Vite emulator toggles parsed.",
  value: JSON.stringify(emulatorModeSummary),
});

snapshot.checks.errors = errors.length;
snapshot.checks.warnings = warnings.length;
snapshot.checks.details = checks;
snapshot.profile = network.profile;
snapshot.status = strictMode ? (errors.length > 0 || warnings.length > 0 ? "fail" : "pass") : (errors.length > 0 ? "fail" : "pass");
snapshot.strict = strictMode;

writeFileSync(artifactPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

if (jsonMode) {
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
} else {
  process.stdout.write(`studio-stack-profile: ${snapshot.status.toUpperCase()}\n`);
  process.stdout.write(`  resolvedProfile: ${snapshot.networkProfile.resolvedProfile} (${snapshot.networkProfile.profileLabel})\n`);
  process.stdout.write(`  resolvedHost: ${snapshot.networkProfile.resolvedHost}\n`);
  process.stdout.write(`  viteDevHost: ${vite.devHost}\n`);
  if (vite.functionsBaseUrl) {
    process.stdout.write(`  viteFunctionsBaseUrl: ${vite.functionsBaseUrl}\n`);
  }
  if (snapshot.gateFindings.length > 0) {
    process.stdout.write("  gateFindings:\n");
    for (const finding of snapshot.gateFindings) {
      process.stdout.write(`    - ${finding.severity.toUpperCase()} [${finding.category}] ${finding.message}\n`);
    }
  } else {
    process.stdout.write("  no gate findings.\n");
  }
}

if (snapshot.status === "fail") {
  process.stderr.write("studio stack profile snapshot failed.\n");
  process.exit(1);
}

process.stdout.write(`artifact: ${artifactPath}\n`);
process.exit(0);

function parseArgs(argv) {
  const options = {
    strict: false,
    json: false,
    artifact: DEFAULT_ARTIFACT,
    profile: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--artifact") {
      options.artifact = argv[i + 1] || options.artifact;
      i += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      options.artifact = arg.slice("--artifact=".length);
      continue;
    }
    if (arg === "--profile") {
      options.profile = argv[i + 1] || options.profile;
      i += 1;
      continue;
    }
    if (arg.startsWith("--profile=")) {
      options.profile = arg.slice("--profile=".length);
      continue;
    }
  }

  return options;
}

function resolveArtifactPath(value) {
  const resolved = isAbsolute(value) ? value : resolve(ROOT, value);
  mkdirSync(resolve(resolved, ".."), { recursive: true });
  return resolved;
}

function parseBoolean(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return { set: true, value: true };
  }
  if (["0", "false", "off", "no"].includes(normalized)) {
    return { set: true, value: false };
  }
  return { set: false, value: false };
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const text = readFileSync(filePath, "utf8");
  const values = {};
  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      return;
    }
    const index = line.indexOf("=");
    if (index === -1) {
      return;
    }
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key) {
      values[key] = value;
    }
  });
  return values;
}
