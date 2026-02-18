#!/usr/bin/env node
import { resolveStudioBrainNetworkProfile } from "./studio-network-profile.mjs";

const { argv, env, exit } = process;
const args = new Set(argv.slice(2));

const strictMode = args.has("--strict");
const jsonMode = args.has("--json");

const TRUE_VALUES = new Set(["true", "1", "yes", "on", "y"]);
const FALSE_VALUES = new Set(["false", "0", "no", "off"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const MIN_PORT = 1;
const MAX_PORT = 65_535;

const network = resolveStudioBrainNetworkProfile();
const profile = network.profile;
const profileHost = String(network.host || "").toLowerCase();
const isRemoteFlow = profile === "lan-dhcp" || profile === "lan-static";

const errors = [];
const warnings = [];
const findings = [];
const checks = {
  useAuthEmulator: false,
  useFirestoreEmulator: false,
  useLegacyCatchall: false,
  useAuthConfiguredBy: "off",
  useFirestoreConfiguredBy: "off",
  authHostConfigured: false,
  firestoreHostConfigured: false,
  functionsBaseUrlConfigured: false,
};

function addFinding(level, category, field, message, value = "") {
  const finding = {
    level,
    category,
    field,
    value,
    message,
  };
  findings.push(finding);

  if (level === "error") {
    errors.push(message);
    return;
  }
  warnings.push(message);
}

function normalize(value) {
  return String(value || "").trim();
}

function normalizeHost(value) {
  return normalize(value).toLowerCase();
}

function isLoopbackHost(value) {
  return LOOPBACK_HOSTS.has(normalizeHost(value));
}

function parseBoolean(name, { required = false } = {}) {
  const raw = normalize(env[name]);
  if (!raw) {
    if (required) {
      addFinding("error", "emulator-toggle", name, `${name} is required.`);
    }
    return { set: false, value: false };
  }

  const normalized = raw.toLowerCase();
  if (TRUE_VALUES.has(normalized)) return { set: true, value: true };
  if (FALSE_VALUES.has(normalized)) return { set: true, value: false };

  addFinding(
    "error",
    "emulator-toggle",
    name,
    `${name} must be boolean-like (true/false/1/0/yes/no/on/off). Received: ${raw}`,
    raw,
  );
  return { set: false, value: false };
}

function parsePort(raw, field) {
  const value = normalize(raw);
  if (!value) {
    return "";
  }

  if (!/^\d+$/.test(value)) {
    addFinding(
      "error",
      "emulator-port",
      field,
      `${field} must be an integer. Received: ${value}`,
      value,
    );
    return "";
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
    addFinding(
      "error",
      "emulator-port",
      field,
      `${field} must be between ${MIN_PORT} and ${MAX_PORT}. Received: ${value}`,
      value,
    );
    return "";
  }

  return String(parsed);
}

function parseHost(raw, field, { required = false } = {}) {
  const value = normalize(raw);
  if (!value) {
    if (required) {
      addFinding(
        "error",
        "emulator-host",
        field,
        `${field} is required when emulator mode is enabled.`,
        value,
      );
    }
    return { host: "", port: "", configured: false };
  }

  let host = "";
  let port = "";
  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      host = normalizeHost(parsed.hostname);
      port = parsed.port ? parsePort(parsed.port, `${field} port`) : "";
    } catch {
      addFinding(
        "error",
        "emulator-host",
        field,
        `${field} has invalid URL format. Received: ${value}`,
        value,
      );
      return { host: "", port: "", configured: true };
    }
  } else if (value.startsWith("[")) {
    const close = value.indexOf("]");
    if (close === -1) {
      addFinding("error", "emulator-host", field, `${field} has malformed IPv6 host.`, value);
      return { host: "", port: "", configured: true };
    }
    host = normalizeHost(value.slice(1, close));
    if (value.length > close + 1) {
      if (value[close + 1] !== ":") {
        addFinding(
          "error",
          "emulator-host",
          field,
          `${field} must use [ipv6]:port format when including a port. Received: ${value}`,
          value,
        );
        return { host: "", port: "", configured: true };
      }
      const candidatePort = value.slice(close + 2);
      if (candidatePort) {
        port = parsePort(candidatePort, `${field} port`);
      }
    }
  } else {
    const split = value.lastIndexOf(":");
    if (split > -1 && split < value.length - 1) {
      const candidatePort = value.slice(split + 1);
      if (!/^\d+$/.test(candidatePort)) {
        addFinding("error", "emulator-host", field, `${field} has invalid host:port format. Received: ${value}`, value);
        return { host: "", port: "", configured: true };
      }
      host = normalizeHost(value.slice(0, split));
      port = parsePort(candidatePort, `${field} port`);
    } else if (split === -1) {
      host = normalizeHost(value);
    } else if (split === value.length - 1) {
      addFinding("error", "emulator-host", field, `${field} has missing port. Received: ${value}`, value);
      return { host: "", port: "", configured: true };
    }
  }

  if (!host) {
    addFinding("error", "emulator-host", field, `${field} contains no usable host.`);
    return { host: "", port, configured: true };
  }

  if (isRemoteFlow && isLoopbackHost(host)) {
    addFinding(
      "error",
      "profile-mismatch",
      field,
      `${field} is loopback (${host}) while profile is ${profile}; remote flows require non-loopback host.`,
      host,
    );
  } else if (!isRemoteFlow && !isLoopbackHost(host) && host !== profileHost) {
    addFinding(
      "warning",
      "profile-mismatch",
      field,
      `${field} uses non-loopback host "${host}" while profile is ${profile}. Ensure this is intentional.`,
      host,
    );
  }

  return { host, port, configured: true };
}

function parseFunctionsBaseUrl(raw) {
  const value = normalize(raw);
  if (!value) {
    return;
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    try {
      parsed = new URL(`http://${value}`);
    } catch {
      addFinding(
        "error",
        "functions-base-url",
        "VITE_FUNCTIONS_BASE_URL",
        `VITE_FUNCTIONS_BASE_URL is not a valid URL: ${value}`,
        value,
      );
      return;
    }
  }

  const host = normalizeHost(parsed.hostname);
  if (!host) {
    addFinding("error", "functions-base-url", "VITE_FUNCTIONS_BASE_URL", "VITE_FUNCTIONS_BASE_URL is missing a hostname.", value);
    return;
  }

  if (isRemoteFlow && isLoopbackHost(host)) {
    addFinding(
      "error",
      "profile-mismatch",
      "VITE_FUNCTIONS_BASE_URL",
      `VITE_FUNCTIONS_BASE_URL is loopback (${host}) while profile is ${profile}; use a reachable host for remote profiles.`,
      host,
    );
    return;
  }

  if (!isRemoteFlow && !isLoopbackHost(host) && profileHost && host !== profileHost) {
    addFinding(
      "warning",
      "profile-mismatch",
      "VITE_FUNCTIONS_BASE_URL",
      `VITE_FUNCTIONS_BASE_URL uses non-loopback host "${host}" while profile is ${profile}; ensure this is intentional.`,
      host,
    );
  }
}

function parseTogglePlan() {
  const useEmulators = parseBoolean("VITE_USE_EMULATORS");
  const useAuth = parseBoolean("VITE_USE_AUTH_EMULATOR");
  const useFirestore = parseBoolean("VITE_USE_FIRESTORE_EMULATOR");

  checks.useLegacyCatchall = useEmulators.set ? useEmulators.value : false;
  const useAuthConfiguredBySplit = useAuth.set;
  const useFirestoreConfiguredBySplit = useFirestore.set;
  checks.useAuthConfiguredBy = useAuthConfiguredBySplit ? "split-flag" : checks.useLegacyCatchall ? "legacy-catchall" : "off";
  checks.useFirestoreConfiguredBy = useFirestoreConfiguredBySplit
    ? "split-flag"
    : checks.useLegacyCatchall
      ? "legacy-catchall"
      : "off";

  if (useEmulators.set && (useAuth.set || useFirestore.set)) {
    if (useAuth.set && useAuth.value !== useEmulators.value) {
      addFinding(
        "warning",
        "emulator-toggle",
        "VITE_USE_AUTH_EMULATOR",
        "VITE_USE_EMULATORS differs from VITE_USE_AUTH_EMULATOR. Split flag takes precedence.",
        `${useEmulators.value}/${useAuth.value}`,
      );
    }
    if (useFirestore.set && useFirestore.value !== useEmulators.value) {
      addFinding(
        "warning",
        "emulator-toggle",
        "VITE_USE_FIRESTORE_EMULATOR",
        "VITE_USE_EMULATORS differs from VITE_USE_FIRESTORE_EMULATOR. Split flag takes precedence.",
        `${useEmulators.value}/${useFirestore.value}`,
      );
    }
  }

  checks.useAuthEmulator = useAuth.set ? useAuth.value : useEmulators.value;
  checks.useFirestoreEmulator = useFirestore.set ? useFirestore.value : useEmulators.value;
}

function validateToggleAlignment() {
  const authHost = parseHost(env.VITE_AUTH_EMULATOR_HOST || "", "VITE_AUTH_EMULATOR_HOST", {
    required: checks.useAuthEmulator,
  });
  checks.authHostConfigured = Boolean(env.VITE_AUTH_EMULATOR_HOST);

  if (checks.useAuthEmulator && normalize(env.VITE_AUTH_EMULATOR_PORT)) {
    parsePort(env.VITE_AUTH_EMULATOR_PORT, "VITE_AUTH_EMULATOR_PORT");
  }

  const firestoreHost = parseHost(env.VITE_FIRESTORE_EMULATOR_HOST || "", "VITE_FIRESTORE_EMULATOR_HOST", {
    required: checks.useFirestoreEmulator,
  });
  const firestoreLegacyHost = parseHost(env.FIRESTORE_EMULATOR_HOST || "", "FIRESTORE_EMULATOR_HOST", {
    required: false,
  });
  checks.firestoreHostConfigured = Boolean(env.VITE_FIRESTORE_EMULATOR_HOST || env.FIRESTORE_EMULATOR_HOST);

  if (checks.useFirestoreEmulator && !env.VITE_FIRESTORE_EMULATOR_HOST && !env.FIRESTORE_EMULATOR_HOST) {
    addFinding(
      "error",
      "emulator-host",
      "FIRESTORE_EMULATOR_HOST",
      "Either VITE_FIRESTORE_EMULATOR_HOST or FIRESTORE_EMULATOR_HOST must be configured when Firestore emulator mode is enabled.",
    );
  }

  if (checks.useFirestoreEmulator && normalize(env.VITE_FIRESTORE_EMULATOR_PORT)) {
    parsePort(env.VITE_FIRESTORE_EMULATOR_PORT, "VITE_FIRESTORE_EMULATOR_PORT");
  }

  if (env.VITE_FIRESTORE_EMULATOR_HOST && env.FIRESTORE_EMULATOR_HOST && env.VITE_FIRESTORE_EMULATOR_HOST !== env.FIRESTORE_EMULATOR_HOST) {
    const message = "VITE_FIRESTORE_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST differ; prefer VITE_FIRESTORE_EMULATOR_HOST.";
    if (strictMode) {
      addFinding("error", "legacy-compat", "FIRESTORE_EMULATOR_HOST", message, env.FIRESTORE_EMULATOR_HOST);
    } else {
      addFinding("warning", "legacy-compat", "FIRESTORE_EMULATOR_HOST", message, env.FIRESTORE_EMULATOR_HOST);
    }
  }

  if (strictMode && !checks.useAuthEmulator && !checks.useFirestoreEmulator) {
    if (firestoreHost.configured || firestoreLegacyHost.configured || checks.authHostConfigured) {
      addFinding(
        "warning",
        "disabled-emulator",
        "VITE_USE_*_EMULATOR",
        "Emulator host variables are present while emulator mode is disabled.",
      );
    }
  }

  if (authHost.host) {
    checks.authHost = authHost.host;
  }
  if (firestoreHost.host || firestoreLegacyHost.host) {
    checks.firestoreHost = firestoreHost.host || firestoreLegacyHost.host;
  }
  if (firestoreHost.port || firestoreLegacyHost.port) {
    checks.firestorePort = firestoreHost.port || firestoreLegacyHost.port;
  }
}

function validateFunctions() {
  if (checks.useAuthEmulator || checks.useFirestoreEmulator) {
    checks.functionsBaseUrlConfigured = Boolean(env.VITE_FUNCTIONS_BASE_URL);
    if (!env.VITE_FUNCTIONS_BASE_URL) {
      addFinding(
        "error",
        "functions-base-url",
        "VITE_FUNCTIONS_BASE_URL",
        "VITE_FUNCTIONS_BASE_URL is required when any emulator mode is enabled.",
      );
      return;
    }
  }

  if (env.VITE_FUNCTIONS_BASE_URL) {
    parseFunctionsBaseUrl(env.VITE_FUNCTIONS_BASE_URL);
  }
}

parseTogglePlan();
validateToggleAlignment();
validateFunctions();

const hardFail = errors.length > 0 || (strictMode && warnings.length > 0);
const payload = {
  status: hardFail ? "fail" : "pass",
  strict: strictMode,
  profile,
  requestedProfile: network.requestedProfile,
  resolvedHost: profileHost,
  checks,
  findings,
  errors,
  warnings,
};

if (jsonMode) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} else {
  process.stdout.write(`emulator contract: ${payload.status.toUpperCase()}\n`);
  process.stdout.write(`  profile: ${payload.profile} (${payload.requestedProfile})\n`);
  process.stdout.write(`  resolvedHost: ${payload.resolvedHost}\n`);
  process.stdout.write("  checks:\n");
  process.stdout.write(`    - auth emulator: ${payload.checks.useAuthEmulator} (configured by ${payload.checks.useAuthConfiguredBy})\n`);
  process.stdout.write(
    `    - firestore emulator: ${payload.checks.useFirestoreEmulator} (configured by ${payload.checks.useFirestoreConfiguredBy})\n`,
  );
  process.stdout.write(`    - functions base URL configured: ${payload.checks.functionsBaseUrlConfigured}\n`);
  process.stdout.write(`    - auth host: ${payload.checks.authHost || "not configured"}\n`);
  process.stdout.write(`    - firestore host: ${payload.checks.firestoreHost || "not configured"}\n`);
  if (payload.errors.length > 0) {
    process.stdout.write("  errors:\n");
    payload.errors.forEach((entry) => process.stdout.write(`    - ${entry}\n`));
  }
  if (payload.warnings.length > 0) {
    process.stdout.write("  warnings:\n");
    payload.warnings.forEach((entry) => process.stdout.write(`    - ${entry}\n`));
  }
}

if (hardFail) {
  process.stderr.write("emulator contract validation failed.\n");
  exit(1);
}

exit(0);
