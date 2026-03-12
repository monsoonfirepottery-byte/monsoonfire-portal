#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");

const args = parseArgs(process.argv.slice(2));
const artifactPath = resolve(ROOT, args.artifact);
const strict = args.strict;
const isJson = args.json;

const WELL_KNOWN_ROOTS = [
  {
    id: "website",
    label: "website",
    apple: resolve(ROOT, "website/.well-known/apple-app-site-association"),
    android: resolve(ROOT, "website/.well-known/assetlinks.json"),
  },
  {
    id: "websiteNcsitebuilder",
    label: "website/ncsitebuilder",
    apple: resolve(ROOT, "website/ncsitebuilder/.well-known/apple-app-site-association"),
    android: resolve(ROOT, "website/ncsitebuilder/.well-known/assetlinks.json"),
  },
];

const PORTAL_OPENAPI = resolve(ROOT, "web/public/.well-known/openapi.json");
const PORTAL_APIS_JSON = resolve(ROOT, "web/public/apis.json");
const ANDROID_MANIFEST = resolve(ROOT, "android/app/src/main/AndroidManifest.xml");
const REQUIRED_PUBLIC_API_PATHS = [
  "/v1/reservations.create",
  "/v1/reservations.get",
  "/v1/reservations.list",
  "/v1/reservations.lookupArrival",
  "/v1/reservations.checkIn",
  "/v1/reservations.rotateArrivalToken",
  "/v1/reservations.pickupWindow",
  "/v1/memberships.summary",
  "/v1/memberships.changePlan",
];

const report = {
  timestamp: new Date().toISOString(),
  strict,
  status: "pass",
  findings: [],
  files: {
    roots: WELL_KNOWN_ROOTS.map((root) => ({
      id: root.id,
      label: root.label,
      aasa: root.apple,
      assetlinks: root.android,
    })),
    manifest: ANDROID_MANIFEST,
    portalOpenApi: PORTAL_OPENAPI,
    portalApisJson: PORTAL_APIS_JSON,
  },
  evidence: {
    portalHost: args.portalHost,
    androidPackage: null,
    appleBundleId: null,
    rootParity: {
      aasa: false,
      assetlinks: false,
    },
    placeholders: {},
    portalOpenApiPaths: [],
  },
};

const manifestRaw = readTextFile(ANDROID_MANIFEST, "AndroidManifest.xml");
const rootPayloads = WELL_KNOWN_ROOTS.map((root) => ({
  ...root,
  applePayload: readJsonFile(root.apple, `${root.label} apple-app-site-association`),
  androidPayload: readJsonFile(root.android, `${root.label} assetlinks.json`),
}));

for (const root of rootPayloads) {
  validateAasa(root, root.applePayload);
  validateAssetlinks(root, root.androidPayload, manifestRaw);
}

validateManifest(manifestRaw, args.portalHost, args.requiredAndroidPackage);
compareMirrors(rootPayloads);

const openApiPayload = readJsonFile(PORTAL_OPENAPI, "portal OpenAPI JSON");
validatePortalOpenApi(openApiPayload);

const apisPayload = readJsonFile(PORTAL_APIS_JSON, "portal apis.json");
validateApisJson(apisPayload);

const errors = report.findings.filter((finding) => finding.severity === "error");
const warnings = report.findings.filter((finding) => finding.severity === "warning");
if (errors.length > 0 || (strict && warnings.length > 0)) {
  report.status = "fail";
}

if (isJson) {
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  for (const finding of report.findings) {
    const prefix = finding.severity === "error" ? "[ERROR]" : "[WARN]";
    process.stdout.write(`${prefix} ${finding.target}\n`);
    process.stdout.write(`  message: ${finding.message}\n`);
    if (finding.path) {
      process.stdout.write(`  path: ${finding.path}\n`);
    }
    if (finding.value !== undefined && finding.value !== "") {
      process.stdout.write(`  value: ${typeof finding.value === "string" ? finding.value : JSON.stringify(finding.value)}\n`);
    }
  }
  if (report.status === "pass") {
    process.stdout.write("PASS: well-known and portal discovery files valid.\n");
  } else {
    process.stdout.write(`FAIL: ${errors.length} error(s), ${warnings.length} warning(s).\n`);
  }
}

process.exit(report.status === "pass" ? 0 : 1);

function validateAasa(root, payload) {
  const target = `${root.label} apple-app-site-association`;
  if (!payload || typeof payload !== "object") {
    markPlaceholder(root.id, "aasa", true);
    addFinding("error", target, "File must be a JSON object.", root.apple);
    return;
  }

  const details = Array.isArray(payload.applinks?.details) ? payload.applinks.details : [];
  if (details.length === 0) {
    addFinding("error", target, "Missing applinks.details array.", root.apple);
    return;
  }

  let hasPlaceholder = false;
  const seenAppIds = new Set();
  const expectedHostPathPrefixes = new Set(["/materials", "/events", "/kiln", "/pieces"]);

  for (const entry of details) {
    if (!entry || typeof entry !== "object") continue;
    const appId = String(entry.appID || "");
    if (!appId || !appId.includes(".")) {
      addFinding("error", target, "Each applinks detail must include a valid appID.", root.apple, appId);
    }
    if (containsPlaceholder(appId)) {
      hasPlaceholder = true;
      addFinding("error", target, `Placeholder detected in appID: ${appId}`, root.apple, appId);
    }
    if (appId) {
      seenAppIds.add(appId);
    }

    const paths = Array.isArray(entry.paths) ? entry.paths : [];
    if (paths.length === 0) {
      addFinding("error", target, `No paths defined for appID ${appId || "<unknown>"}.`, root.apple, paths);
      continue;
    }

    for (const item of paths) {
      if (typeof item !== "string") {
        addFinding("error", target, "Path entries must be strings.", root.apple, item);
        continue;
      }
      if (containsPlaceholder(item)) {
        hasPlaceholder = true;
        addFinding("error", target, `Placeholder detected in paths: ${item}`, root.apple, item);
      }
    }

    if (!paths.some((path) => expectedHostPathPrefixes.has(stripWildcard(path)))) {
      addFinding(
        "warning",
        target,
        `No core deep-link prefix found for appID ${appId || "<unknown>"}.`,
        root.apple,
        paths,
      );
    }
  }

  markPlaceholder(root.id, "aasa", hasPlaceholder);

  if (seenAppIds.size === 1 && !report.evidence.appleBundleId) {
    const [only] = [...seenAppIds];
    const [teamId, ...bundleParts] = only.split(".");
    const bundleId = bundleParts.join(".");
    if (teamId && bundleId) {
      report.evidence.appleBundleId = bundleId;
    }
  }
}

function validateAssetlinks(root, payload, manifestText) {
  const target = `${root.label} assetlinks.json`;
  if (!Array.isArray(payload)) {
    markPlaceholder(root.id, "assetlinks", true);
    addFinding("error", target, "assetlinks must be a JSON array.", root.android);
    return;
  }
  if (payload.length === 0) {
    addFinding("error", target, "assetlinks array is empty.", root.android);
  }

  const manifestPackage = parseManifestPackage(manifestText);
  let hasPlaceholder = false;

  for (const rawEntry of payload) {
    if (!rawEntry || typeof rawEntry !== "object") {
      addFinding("error", target, "Each item must be an object.", root.android);
      continue;
    }

    if (!Array.isArray(rawEntry.relation) || rawEntry.relation.length === 0) {
      addFinding("warning", target, "relation should include at least one target relation.", root.android);
    }

    const packageName = String(rawEntry.target?.package_name || "");
    if (!packageName) {
      addFinding("error", target, "target.package_name is missing.", root.android);
    }
    if (containsPlaceholder(packageName)) {
      hasPlaceholder = true;
      addFinding("error", target, `Placeholder detected in package_name: ${packageName}`, root.android, packageName);
    }
    if (manifestPackage && packageName && manifestPackage !== packageName) {
      addFinding(
        "error",
        target,
        `Package mismatch: manifest=${manifestPackage} assetlinks=${packageName}`,
        root.android,
        packageName,
      );
    }

    const fingerprints = Array.isArray(rawEntry.target?.sha256_cert_fingerprints)
      ? rawEntry.target.sha256_cert_fingerprints
      : [];
    if (fingerprints.length === 0) {
      addFinding("error", target, `Missing sha256_cert_fingerprints for package ${packageName || "<unknown>"}.`, root.android);
    }
    for (const fingerprint of fingerprints) {
      if (typeof fingerprint !== "string" || !fingerprint.trim()) {
        addFinding("error", target, "Each fingerprint must be a non-empty string.", root.android, fingerprint);
        continue;
      }
      if (containsPlaceholder(fingerprint)) {
        hasPlaceholder = true;
        addFinding("error", target, `Placeholder detected in fingerprint: ${fingerprint}`, root.android, fingerprint);
      }
    }

    if (manifestPackage === packageName) {
      report.evidence.androidPackage = packageName;
    }
  }

  markPlaceholder(root.id, "assetlinks", hasPlaceholder);
}

function validateManifest(raw, expectedHost, expectedPackage) {
  const target = "AndroidManifest.xml";
  if (!raw) {
    addFinding("error", target, "Manifest missing or unreadable.", ANDROID_MANIFEST);
    return;
  }

  const packageName = parseManifestPackage(raw);
  if (!packageName) {
    addFinding("error", target, "Could not parse package name from <manifest> tag.", ANDROID_MANIFEST);
  } else if (expectedPackage && packageName !== expectedPackage) {
    addFinding(
      "error",
      target,
      `Expected package ${expectedPackage}, but manifest defines ${packageName}.`,
      ANDROID_MANIFEST,
      packageName,
    );
  }

  const hosts = Array.from(raw.matchAll(/android:host="([^"]+)"/g), (match) => match[1]);
  if (hosts.length === 0) {
    addFinding("warning", target, "No intent filters with android:host found.", ANDROID_MANIFEST);
    return;
  }

  if (!hosts.includes(expectedHost)) {
    addFinding(
      "error",
      target,
      `Expected portal host ${expectedHost} in VIEW intent filter data hosts.`,
      ANDROID_MANIFEST,
      hosts,
    );
  }

  const pathPrefixes = Array.from(raw.matchAll(/android:pathPrefix="([^"]+)"/g), (match) => match[1]);
  const requiredPrefixes = new Set(["/materials", "/events", "/kiln", "/pieces"]);
  for (const required of requiredPrefixes) {
    if (!pathPrefixes.includes(required)) {
      addFinding("warning", target, `Missing pathPrefix ${required} for deep-link handling.`, ANDROID_MANIFEST, required);
    }
  }
}

function compareMirrors(rootPayloads) {
  if (rootPayloads.length < 2) {
    return;
  }
  const primary = rootPayloads[0];
  let aasaParity = true;
  let assetlinksParity = true;

  for (const mirror of rootPayloads.slice(1)) {
    if (stableJson(primary.applePayload) !== stableJson(mirror.applePayload)) {
      aasaParity = false;
      addFinding(
        "error",
        "well-known mirror parity",
        `${mirror.label} apple-app-site-association does not match ${primary.label}.`,
        mirror.apple,
      );
    }
    if (stableJson(primary.androidPayload) !== stableJson(mirror.androidPayload)) {
      assetlinksParity = false;
      addFinding(
        "error",
        "well-known mirror parity",
        `${mirror.label} assetlinks.json does not match ${primary.label}.`,
        mirror.android,
      );
    }
  }

  report.evidence.rootParity.aasa = aasaParity;
  report.evidence.rootParity.assetlinks = assetlinksParity;
}

function validatePortalOpenApi(payload) {
  const target = "portal OpenAPI";
  if (!payload || typeof payload !== "object") {
    addFinding("error", target, "Portal OpenAPI file must be a JSON object.", PORTAL_OPENAPI);
    return;
  }

  const openapiVersion = String(payload.openapi || "");
  if (!/^3\./.test(openapiVersion)) {
    addFinding("error", target, `Expected OpenAPI 3.x document, received ${openapiVersion || "<missing>"}.`, PORTAL_OPENAPI, openapiVersion);
  }

  const info = payload.info && typeof payload.info === "object" ? payload.info : {};
  if (!String(info.title || "").trim()) {
    addFinding("error", target, "info.title is required.", PORTAL_OPENAPI);
  }
  if (!String(info.version || "").trim()) {
    addFinding("error", target, "info.version is required.", PORTAL_OPENAPI);
  }

  const servers = Array.isArray(payload.servers) ? payload.servers : [];
  if (servers.length === 0) {
    addFinding("error", target, "At least one server entry is required.", PORTAL_OPENAPI);
  } else if (!servers.some((server) => typeof server?.url === "string" && server.url.includes("/apiV1"))) {
    addFinding("error", target, "Expected a server URL that targets the apiV1 gateway.", PORTAL_OPENAPI, servers);
  }

  const paths = payload.paths && typeof payload.paths === "object" ? Object.keys(payload.paths) : [];
  report.evidence.portalOpenApiPaths = [...paths].sort();
  if (paths.length === 0) {
    addFinding("error", target, "OpenAPI document must define paths.", PORTAL_OPENAPI);
  }
  for (const route of REQUIRED_PUBLIC_API_PATHS) {
    if (!paths.includes(route)) {
      addFinding("error", target, `Missing required public API path: ${route}`, PORTAL_OPENAPI, route);
    }
  }

  const bearerAuth = payload.components?.securitySchemes?.bearerAuth;
  if (!bearerAuth || typeof bearerAuth !== "object") {
    addFinding("error", target, "components.securitySchemes.bearerAuth is required.", PORTAL_OPENAPI);
  } else {
    if (bearerAuth.type !== "http") {
      addFinding("error", target, "bearerAuth.type must be http.", PORTAL_OPENAPI, bearerAuth);
    }
    if (bearerAuth.scheme !== "bearer") {
      addFinding("error", target, "bearerAuth.scheme must be bearer.", PORTAL_OPENAPI, bearerAuth);
    }
  }
}

function validateApisJson(payload) {
  const target = "portal apis.json";
  if (!payload || typeof payload !== "object") {
    addFinding("error", target, "apis.json must be a JSON object.", PORTAL_APIS_JSON);
    return;
  }

  const apis = Array.isArray(payload.apis) ? payload.apis : [];
  if (apis.length === 0) {
    addFinding("error", target, "apis.json must define at least one API entry.", PORTAL_APIS_JSON);
    return;
  }

  const publicApi = apis.find((entry) => entry && typeof entry === "object" && entry.accessURL === "https://portal.monsoonfire.com/.well-known/openapi.json");
  if (!publicApi) {
    addFinding(
      "error",
      target,
      "apis.json must point to the canonical portal OpenAPI URL.",
      PORTAL_APIS_JSON,
      apis,
    );
    return;
  }

  if (publicApi.documentationURL !== "https://portal.monsoonfire.com/agent-docs/") {
    addFinding(
      "warning",
      target,
      "documentationURL should point to the portal agent docs surface.",
      PORTAL_APIS_JSON,
      publicApi.documentationURL,
    );
  }
}

function markPlaceholder(rootId, field, value) {
  if (!report.evidence.placeholders[rootId]) {
    report.evidence.placeholders[rootId] = {
      aasa: false,
      assetlinks: false,
    };
  }
  report.evidence.placeholders[rootId][field] = value;
}

function addFinding(severity, target, message, path = "", value = "") {
  report.findings.push({ severity, target, path, message, value });
}

function parseManifestPackage(raw) {
  const match = /<manifest[^>]*package="([^"]+)"/.exec(raw || "");
  return match ? match[1] : "";
}

function readTextFile(filePath, label) {
  if (!existsSync(filePath)) {
    addFinding("error", basename(filePath), `Missing ${label}.`, filePath);
    return "";
  }
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    addFinding("error", basename(filePath), `Failed to read ${label}: ${error instanceof Error ? error.message : String(error)}`, filePath);
    return "";
  }
}

function readJsonFile(filePath, label) {
  const raw = readTextFile(filePath, label);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    addFinding("error", basename(filePath), `Failed to parse ${label}: ${error instanceof Error ? error.message : String(error)}`, filePath);
    return null;
  }
}

function containsPlaceholder(value = "") {
  return /<[^>]+>|\$\{[^}]+\}/.test(value);
}

function stripWildcard(path) {
  if (!path) return "";
  return String(path).replace(/[*?].*$/, "");
}

function stableJson(value) {
  return JSON.stringify(normalizeValue(value));
}

function normalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = normalizeValue(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    strict: false,
    json: false,
    artifact: "output/well-known/latest.json",
    portalHost: "portal.monsoonfire.com",
    requiredAndroidPackage: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--portal-host") {
      options.portalHost = argv[index + 1] || options.portalHost;
      index += 1;
      continue;
    }
    if (arg === "--android-package") {
      options.requiredAndroidPackage = argv[index + 1] || options.requiredAndroidPackage;
      index += 1;
      continue;
    }
    if (arg === "--artifact") {
      options.artifact = argv[index + 1] || options.artifact;
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      options.artifact = arg.substring("--artifact=".length);
      continue;
    }
    if (arg.startsWith("--portal-host=")) {
      options.portalHost = arg.substring("--portal-host=".length);
      continue;
    }
    if (arg.startsWith("--android-package=")) {
      options.requiredAndroidPackage = arg.substring("--android-package=".length);
    }
  }

  return options;
}
