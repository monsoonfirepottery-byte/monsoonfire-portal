#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");

const args = parseArgs(process.argv.slice(2));
const strict = args.strict;
const emitJson = args.json;
const artifactPath = resolve(ROOT, args.artifact);
const portalHost = args.portalHost;

const report = {
  timestamp: new Date().toISOString(),
  status: "pass",
  strict,
  checks: [],
  evidence: {
    portalHost,
    deepLinkPaths: [],
    iosSegments: [],
    androidSegments: [],
    manifestPackage: null,
  },
};

const deepLinkDocs = readText("docs/DEEP_LINK_CONTRACT.md", "deep-link contract");
const iosRouter = readText("ios/DeepLinkRouter.swift", "iOS router");
const androidRouter = readText("android/app/src/main/java/com/monsoonfire/portal/reference/DeepLinkRouter.kt", "android router");
const manifest = readText("android/app/src/main/AndroidManifest.xml", "Android manifest");

validateDeepLinks(deepLinkDocs, iosRouter, androidRouter);
validateManifestContracts(manifest, portalHost);

const wellKnownResult = validateWellKnownFiles();
report.evidence.wellKnown = {
  status: wellKnownResult.status,
  findings: wellKnownResult.findings.length,
};
for (const finding of wellKnownResult.findings) {
  addFinding(finding.severity, "well-known", finding.message, finding.path, finding.value);
}

const warnings = report.checks.filter((entry) => entry.status === "warning");
const errors = report.checks.filter((entry) => entry.status === "error");
if (errors.length > 0 || (strict && warnings.length > 0)) {
  report.status = "fail";
}

if (emitJson) {
  mkdirSync(resolve(artifactPath, ".."), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (!emitJson) {
  const statusLabel = report.status === "pass" ? "PASS" : "FAIL";
  process.stdout.write(`${statusLabel}: mobile store readiness gate.\n`);
  for (const item of report.checks) {
    const prefix = item.status === "pass" ? "[PASS]" : item.status === "warning" ? "[WARN]" : "[ERROR]";
    process.stdout.write(`${prefix} ${item.target}\n`);
    process.stdout.write(`  ${item.message}\n`);
    if (item.value) process.stdout.write(`  value: ${item.value}\n`);
  }
}

process.exit(report.status === "pass" ? 0 : 1);

function addFinding(status, target, message, path = "", value = "") {
  const normalized = status === "pass" ? "pass" : status === "error" ? "error" : "warning";
  report.checks.push({ status: normalized, target, message, path, value });
}

function validateDeepLinks(contractText, iosText, androidText) {
  const docSegments = new Set(parseDeepLinkSegments(contractText));
  const iosSegments = new Set(parseSegmentsFromIosRouter(iosText));
  const androidSegments = new Set(parseSegmentsFromAndroidRouter(androidText));
  report.evidence.deepLinkPaths = [...docSegments];
  report.evidence.iosSegments = [...iosSegments];
  report.evidence.androidSegments = [...androidSegments];

  const sortedDoc = [...docSegments].sort();
  for (const path of sortedDoc) {
    if (!iosSegments.has(path)) {
      addFinding("error", "deep-link", `iOS router missing path contract: /${path}`, "ios/DeepLinkRouter.swift", path);
    }
    if (!androidSegments.has(path)) {
      addFinding("error", "deep-link", `Android router missing path contract: /${path}`, "android/.../DeepLinkRouter.kt", path);
    }
  }

  const sortedIos = [...iosSegments].sort();
  for (const path of sortedIos) {
    if (!docSegments.has(path) && path) {
      addFinding("warning", "deep-link", `iOS deep-link segment not documented: /${path}`, "docs/DEEP_LINK_CONTRACT.md", path);
    }
  }

  const sortedAndroid = [...androidSegments].sort();
  for (const path of sortedAndroid) {
    if (!docSegments.has(path) && path) {
      addFinding("warning", "deep-link", `Android deep-link segment not documented: /${path}`, "docs/DEEP_LINK_CONTRACT.md", path);
    }
  }

  const manifestPaths = new Set(parseManifestPathPrefixes(manifest));
  for (const segment of docSegments) {
    const expectedPath = `/${segment}`;
    if (!manifestPaths.has(expectedPath)) {
      addFinding("warning", "deep-link", `Manifest pathPrefix missing for /${segment}`, "android/AndroidManifest.xml", expectedPath);
    }
  }
}

function validateManifestContracts(manifestText, expectedHost) {
  if (!manifestText) {
    addFinding("error", "android", "AndroidManifest.xml not readable for link host validation.", "android/app/src/main/AndroidManifest.xml");
    return;
  }
  const packageMatch = /<manifest[^>]*package="([^"]+)"/.exec(manifestText);
  const packageName = packageMatch ? packageMatch[1] : "";
  if (!packageName) {
    addFinding("error", "android", "Could not parse manifest package name.");
  }
  report.evidence.manifestPackage = packageName || null;

  const hosts = parseManifestHosts(manifestText);
  if (!hosts.length) {
    addFinding("error", "android", "No android:host entries in manifest deep-link intent filters.", "android/app/src/main/AndroidManifest.xml");
  } else if (!hosts.includes(expectedHost)) {
    addFinding("error", "android", `Manifest hosts do not include ${expectedHost}.`, "android/app/src/main/AndroidManifest.xml", hosts.join(", "));
  }
}

function validateWellKnownFiles() {
  const cmd = `node ./scripts/validate-well-known.mjs --json --strict --artifact .tmp/epic8-well-known-evidence.json --portal-host ${portalHost}`;
  const result = spawnSync(cmd, {
    cwd: ROOT,
    encoding: "utf8",
    shell: true,
    env: process.env,
  });

  if (result.status === 0 && result.stdout) {
    try {
      const parsed = JSON.parse(result.stdout);
      return { status: parsed.status || "pass", findings: parsed.findings || [] };
    } catch {
      return {
        status: "fail",
        findings: [{ severity: "error", message: "Failed to parse well-known evidence output.", path: "scripts/validate-well-known.mjs" }],
      };
    }
  }
  return {
    status: "fail",
    findings: [{ severity: "error", message: result.stderr || result.stdout || "validate-well-known command failed.", path: "scripts/validate-well-known.mjs" }],
  };
}

function parseDeepLinkSegments(text) {
  if (!text) return [];
  const routeSection = extractSection(text, "Canonical routes");
  const source = routeSection || text;
  const routeLines = [...source.matchAll(/- `([^`]+)`/g)];
  const segments = new Set();
  for (const match of routeLines) {
    const path = match[1];
    const normalized = path.split(/[?#]/)[0];
    const root = normalized.split("/")[1];
    if (!root) {
      continue;
    }
    const segment = root.toLowerCase();
    if (segment === "well-known" || segment === "well") {
      continue;
    }
    if (segment) segments.add(segment.replace(/[^a-z0-9_-]/g, ""));
  }
  return [...segments];
}

function parseSegmentsFromIosRouter(text) {
  if (!text) return [];
  const tokens = [];
  const conditions = [...text.matchAll(/path\.contains\("([^"]+)"\)|flow\.contains\("([^"]+)"\)/g)];
  for (const match of conditions) {
    const token = (match[1] || match[2] || "").toLowerCase();
    if (!token) continue;
    for (const segment of tokenToSegments(token)) {
      tokens.push(segment);
    }
  }
  return [...new Set(tokens)];
}

function parseSegmentsFromAndroidRouter(text) {
  if (!text) return [];
  const conditions = [...text.matchAll(/path\.contains\("([^"]+)"\)/g)];
  const tokens = [];
  for (const match of conditions) {
    const token = match[1].toLowerCase();
    for (const segment of tokenToSegments(token)) {
      tokens.push(segment);
    }
  }
  return [...new Set(tokens)];
}

function parseManifestPathPrefixes(text) {
  if (!text) return [];
  return [...text.matchAll(/android:pathPrefix="([^"]+)"/g)].map((match) => match[1]);
}

function extractSection(text, headingName) {
  if (!text) return "";
  const headingRegex = new RegExp(`^##\\s+${escapeRegExp(headingName)}\\b.*$`, "im");
  const headingMatch = text.match(headingRegex);
  if (!headingMatch || headingMatch.index === undefined) {
    return "";
  }

  const bodyStart = headingMatch.index + headingMatch[0].length;
  const remainder = text.slice(bodyStart);
  const nextMatch = remainder.match(/^##\s+/m);
  if (!nextMatch || nextMatch.index === undefined) {
    return remainder;
  }
  return remainder.slice(0, nextMatch.index);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseManifestHosts(text) {
  if (!text) return [];
  return [...text.matchAll(/android:host="([^"]+)"/g)].map((match) => match[1]);
}

function tokenToSegments(raw) {
  const token = raw.toLowerCase().replace(/[^\w/-]/g, "");
  if (!token) {
    return [];
  }
  if (token.includes("/materials")) return ["materials"];
  if (token.includes("material")) return ["materials"];
  if (token.includes("/events")) return ["events"];
  if (token.includes("event")) return ["events"];
  if (token.includes("/kiln")) return ["kiln"];
  if (token.includes("kiln")) return ["kiln"];
  if (token.includes("/pieces")) return ["pieces"];
  if (token.includes("pieces")) return ["pieces"];
  return [];
}

function readText(relativePath, label) {
  const absolute = resolve(ROOT, relativePath);
  if (!existsSync(absolute)) {
    addFinding("error", "read", `Missing ${label} file: ${relativePath}`, relativePath);
    return "";
  }
  try {
    return readFileSync(absolute, "utf8");
  } catch (error) {
    addFinding("error", "read", `Failed to read ${label}: ${error instanceof Error ? error.message : String(error)}`, relativePath);
    return "";
  }
}

function parseArgs(argv) {
  const options = {
    strict: false,
    json: false,
    artifact: "output/mobile-store-readiness/latest.json",
    portalHost: "portal.monsoonfire.com",
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
    if (arg.startsWith("--portal-host=")) {
      options.portalHost = arg.substring("--portal-host=".length);
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
  }

  if (!isAbsolute(options.artifact)) {
    options.artifact = resolve(options.artifact);
  }
  return options;
}
