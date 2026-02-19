#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");

const args = parseArgs(process.argv.slice(2));
const artifactPath = resolve(ROOT, args.artifact);
const strict = args.strict;
const isJson = args.json;

const WELL_KNOWN_FILES = {
  apple: resolve(ROOT, "website/.well-known/apple-app-site-association"),
  android: resolve(ROOT, "website/.well-known/assetlinks.json"),
};
const ANDROID_MANIFEST = resolve(ROOT, "android/app/src/main/AndroidManifest.xml");

const report = {
  timestamp: new Date().toISOString(),
  strict,
  status: "pass",
  findings: [],
  files: {
    aasa: WELL_KNOWN_FILES.apple,
    assetlinks: WELL_KNOWN_FILES.android,
    manifest: ANDROID_MANIFEST,
  },
  evidence: {
    portalHost: args.portalHost,
    androidPackage: null,
    appleBundleId: null,
    aasaHasPlaceholders: false,
    assetlinksHasPlaceholders: false,
  },
};

const aasaRaw = readJsonFile(WELL_KNOWN_FILES.apple, "apple-app-site-association JSON");
const assetRaw = readJsonFile(WELL_KNOWN_FILES.android, "assetlinks JSON");
const manifestRaw = readTextFile(ANDROID_MANIFEST, "AndroidManifest.xml");

validateAasa(aasaRaw, args.portalHost);
validateAssetlinks(assetRaw, manifestRaw);
validateManifest(manifestRaw, args.portalHost, args.requiredAndroidPackage);

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
    if (finding.value !== undefined) {
      process.stdout.write(`  value: ${finding.value}\n`);
    }
  }
  if (report.status === "pass") {
    process.stdout.write("PASS: well-known deployment files valid.\n");
  } else {
    process.stdout.write(`FAIL: ${errors.length} error(s), ${warnings.length} warning(s).\n`);
  }
}

process.exit(report.status === "pass" ? 0 : 1);

function addFinding(severity, target, message, path = "", value = "") {
  report.findings.push({ severity, target, path, message, value });
}

function validateAasa(payload) {
  if (!payload || typeof payload !== "object") {
    report.evidence.aasaHasPlaceholders = true;
    addFinding("error", "apple-app-site-association", "File must be JSON object.");
    return;
  }

  const details = Array.isArray(payload.applinks?.details) ? payload.applinks.details : [];
  if (details.length === 0) {
    addFinding("error", "apple-app-site-association", "Missing applinks.details array.");
  }

  const seenAppIds = new Set();
  const expectedHostPathPrefixes = new Set(["/materials", "/events", "/kiln", "/pieces"]);
  for (const entry of details) {
    if (!entry || typeof entry !== "object") continue;
    const appId = String(entry.appID || "");
    if (!appId || !appId.includes(".")) {
      addFinding("error", "apple-app-site-association", "Each applinks detail must include a valid appID.");
    }
    if (containsPlaceholder(appId)) {
      addFinding("error", "apple-app-site-association", `Placeholder detected in appID: ${appId}`, "appID", appId);
      report.evidence.aasaHasPlaceholders = true;
    }
    seenAppIds.add(appId);

    const paths = Array.isArray(entry.paths) ? entry.paths : [];
    if (paths.length === 0) {
      addFinding("error", "apple-app-site-association", `No paths defined for appID ${appId}`, "paths");
      continue;
    }
    for (const item of paths) {
      if (typeof item !== "string") {
        addFinding("error", "apple-app-site-association", "Path entries must be strings.", "paths");
        continue;
      }
      if (containsPlaceholder(item)) {
        addFinding("error", "apple-app-site-association", `Placeholder detected in paths: ${item}`, "paths", item);
        report.evidence.aasaHasPlaceholders = true;
      }
    }

    if (!paths.some((path) => expectedHostPathPrefixes.has(stripWildcard(path)))) {
      addFinding("warning", "apple-app-site-association", `No core deep-link prefix found for appID ${appId}.`, "paths", paths);
    }
  }

  if (seenAppIds.size === 0) {
    return;
  }
  if (seenAppIds.size === 1) {
    const only = [...seenAppIds][0];
    const [teamId, ...bundleParts] = only.split(".");
    const bundleId = bundleParts.join(".");
    if (!bundleId || !teamId) {
      addFinding("warning", "apple-app-site-association", "appID should be in TEAMID.BUNDLEID format.");
      return;
    }
    report.evidence.appleBundleId = bundleId;
  }
}

function validateAssetlinks(payload, manifestText) {
  if (!Array.isArray(payload)) {
    report.evidence.assetlinksHasPlaceholders = true;
    addFinding("error", "assetlinks.json", "assetlinks must be a JSON array.");
    return;
  }
  if (payload.length === 0) {
    addFinding("error", "assetlinks.json", "assetlinks array is empty.");
  }

  const manifestPackage = parseManifestPackage(manifestText);
  for (const rawEntry of payload) {
    if (!rawEntry || typeof rawEntry !== "object") {
      addFinding("error", "assetlinks.json", "Each item must be an object.");
      continue;
    }
    const entry = rawEntry;
    if (!Array.isArray(entry.relation) || entry.relation.length === 0) {
      addFinding("warning", "assetlinks.json", "relation should include at least one target relation.", "relation");
    }
    const target = entry.target || {};
    const packageName = String(target.package_name || "");
    if (!packageName) {
      addFinding("error", "assetlinks.json", "target.package_name is missing.");
    }
    if (containsPlaceholder(packageName)) {
      addFinding("error", "assetlinks.json", `Placeholder detected in package_name: ${packageName}`, "package_name", packageName);
      report.evidence.assetlinksHasPlaceholders = true;
    }
    if (manifestPackage && packageName && manifestPackage !== packageName) {
      addFinding(
        "error",
        "assetlinks.json",
        `Package mismatch: manifest=${manifestPackage} assetlinks=${packageName}`,
        "package_name",
        packageName,
      );
    }

    const fingerprints = Array.isArray(target.sha256_cert_fingerprints) ? target.sha256_cert_fingerprints : [];
    if (fingerprints.length === 0) {
      addFinding("error", "assetlinks.json", `Missing sha256_cert_fingerprints for package ${packageName}.`, "sha256_cert_fingerprints");
    }
    for (const fingerprint of fingerprints) {
      if (typeof fingerprint !== "string" || !fingerprint.trim()) {
        addFinding("error", "assetlinks.json", "Each fingerprint must be a non-empty string.", "sha256_cert_fingerprints", fingerprint);
        continue;
      }
      if (containsPlaceholder(fingerprint)) {
        addFinding("error", "assetlinks.json", `Placeholder detected in fingerprint: ${fingerprint}`, "sha256_cert_fingerprints", fingerprint);
        report.evidence.assetlinksHasPlaceholders = true;
      }
    }

    if (manifestPackage === packageName) {
      report.evidence.androidPackage = packageName;
    }
  }
}

function validateManifest(raw, expectedHost, expectedPackage) {
  if (!raw) {
    addFinding("error", "AndroidManifest.xml", "Manifest missing or unreadable.", ANDROID_MANIFEST);
    return;
  }
  const packageName = parseManifestPackage(raw);
  if (!packageName) {
    addFinding("error", "AndroidManifest.xml", "Could not parse package name from <manifest> tag.", "manifest/package");
  } else if (expectedPackage && packageName !== expectedPackage) {
    addFinding(
      "error",
      "AndroidManifest.xml",
      `Expected package ${expectedPackage}, but manifest defines ${packageName}.`,
      "manifest/package",
      packageName,
    );
  }

  const hosts = Array.from(raw.matchAll(/android:host="([^"]+)"/g), (match) => match[1]);
  if (hosts.length === 0) {
    addFinding("warning", "AndroidManifest.xml", "No intent filters with android:host found.", "android:data");
    return;
  }

  if (!hosts.includes(expectedHost)) {
    addFinding(
      "error",
      "AndroidManifest.xml",
      `Expected portal host ${expectedHost} in VIEW intent filter data hosts.`,
      "android:data/host",
      hosts,
    );
  }

  const pathPrefixes = Array.from(raw.matchAll(/android:pathPrefix="([^"]+)"/g), (match) => match[1]);
  const requiredPrefixes = new Set(["/materials", "/events", "/kiln", "/pieces"]);
  for (const required of requiredPrefixes) {
    if (!pathPrefixes.includes(required)) {
      addFinding("warning", "AndroidManifest.xml", `Missing pathPrefix ${required} for deep-link handling.`, "android:data/pathPrefix", required);
    }
  }
}

function parseManifestPackage(raw) {
  const match = /<manifest[^>]*package="([^"]+)"/.exec(raw || "");
  return match ? match[1] : "";
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
    }
    if (arg.startsWith("--portal-host=")) {
      options.portalHost = arg.substring("--portal-host=".length);
    }
    if (arg.startsWith("--android-package=")) {
      options.requiredAndroidPackage = arg.substring("--android-package=".length);
    }
  }
  return options;
}

function readTextFile(filePath, label) {
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
  return path.replace(/[*?].*$/, "");
}
