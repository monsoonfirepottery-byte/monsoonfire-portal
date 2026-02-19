#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");
const DEFAULT_ARTIFACT = "output/source-of-truth-contract-matrix/latest.json";

const args = parseArgs(process.argv.slice(2));
const strict = args.strict;
const emitJson = args.json;
const artifactPath = resolve(ROOT, args.artifact || DEFAULT_ARTIFACT);

const report = {
  timestamp: new Date().toISOString(),
  strict,
  status: "pass",
  sources: {},
  checks: [],
  diffs: {},
};

const files = {
  portalContracts: resolve(ROOT, "web/src/api/portalContracts.ts"),
  apiContractsDoc: resolve(ROOT, "docs/API_CONTRACTS.md"),
  functionsIndex: resolve(ROOT, "functions/src/index.ts"),
  functionsApiV1: resolve(ROOT, "functions/src/apiV1.ts"),
  iosContracts: resolve(ROOT, "ios/PortalContracts.swift"),
  androidContracts: resolve(ROOT, "android/app/src/main/java/com/monsoonfire/portal/reference/PortalContracts.kt"),
};

for (const [key, path] of Object.entries(files)) {
  if (!existsSync(path)) {
    addFinding(
      "error",
      "source-file",
      `Missing source file: ${key}`,
      { path },
    );
  }
}

const portalContracts = parsePortalContracts(readFile(files.portalContracts));
const apiContractDoc = parseApiContractDoc(readFile(files.apiContractsDoc));
const backendSurface = parseBackendSurface(
  readFile(files.functionsIndex),
  readFile(files.functionsApiV1),
);
const iosContracts = parseSwiftContracts(readFile(files.iosContracts));
const androidContracts = parseKotlinContracts(readFile(files.androidContracts));

report.sources = {
  portalContracts: {
    interfaceMethods: [...portalContracts.interfaceMethods].sort(),
    fnNameAliases: [...portalContracts.fnNameAliases].sort(),
    requestTypes: [...portalContracts.requestTypes].sort(),
    responseTypes: [...portalContracts.responseTypes].sort(),
    v1Routes: [...portalContracts.v1Routes].sort(),
  },
  apiContractDoc: {
    endpointNames: [...apiContractDoc.endpointNames].sort(),
    endpointPaths: [...apiContractDoc.endpointPaths].sort(),
  },
  backendSurface: {
    directExports: [...backendSurface.directExports].sort(),
    legacyRouteMethods: [...backendSurface.legacyRouteMethods].sort(),
    apiV1Routes: [...backendSurface.apiV1Routes].sort(),
    v1MethodAliases: [...backendSurface.v1MethodAliases].sort(),
  },
  iosContracts: {
    requestTypes: [...iosContracts.requestTypes].sort(),
    responseTypes: [...iosContracts.responseTypes].sort(),
  },
  androidContracts: {
    requestTypes: [...androidContracts.requestTypes].sort(),
    responseTypes: [...androidContracts.responseTypes].sort(),
  },
};

const webMethods = union(portalContracts.interfaceMethods, portalContracts.fnNameAliases);
const webRequestResponseTypes = union(portalContracts.requestTypes, portalContracts.responseTypes);
const backendMethodSurface = union(
  backendSurface.directExports,
  backendSurface.v1MethodAliases,
  backendSurface.legacyRouteMethods,
);
const backendRoutePaths = backendSurface.apiV1Routes;

const docsMethods = apiContractDoc.endpointNames;
const docsRoutePaths = apiContractDoc.endpointPaths;

const docsMissingFromWeb = difference(docsMethods, webMethods).sort();
const webMissingFromDocs = difference(webMethods, docsMethods).sort();
const webMissingFromBackend = difference(webMethods, backendMethodSurface).sort();
const backendLegacyOnly = difference(backendMethodSurface, union(webMethods, docsMethods)).sort();
const iosMissingRequestResponse = {
  request: difference(filterSuffix(portalContracts.requestTypes, "Request"), iosContracts.requestTypes).sort(),
  response: difference(filterSuffix(portalContracts.responseTypes, "Response"), iosContracts.responseTypes).sort(),
};
const iosExtraRequestResponse = {
  request: difference(iosContracts.requestTypes, filterSuffix(portalContracts.requestTypes, "Request")).sort(),
  response: difference(iosContracts.responseTypes, filterSuffix(portalContracts.responseTypes, "Response")).sort(),
};
const androidMissingRequestResponse = {
  request: difference(filterSuffix(portalContracts.requestTypes, "Request"), androidContracts.requestTypes).sort(),
  response: difference(filterSuffix(portalContracts.responseTypes, "Response"), androidContracts.responseTypes).sort(),
};
const androidExtraRequestResponse = {
  request: difference(androidContracts.requestTypes, filterSuffix(portalContracts.requestTypes, "Request")).sort(),
  response: difference(androidContracts.responseTypes, filterSuffix(portalContracts.responseTypes, "Response")).sort(),
};

addFinding(
  "warn",
  "diff",
  "API doc endpoint coverage vs web contract",
  {
    missingInWeb: docsMissingFromWeb,
    missingInDoc: webMissingFromDocs,
  },
  docsMissingFromWeb.length === 0 && webMissingFromDocs.length === 0 ? "pass" : "warn",
);

addFinding(
  "error",
  "backend-drift",
  "Web API methods missing from backend route surface",
  {
    missingFromBackend: webMissingFromBackend,
  },
  webMissingFromBackend.length === 0 ? "pass" : "error",
);

addFinding(
  "warn",
  "backend-drift",
  "Backend methods without explicit web/doc contract surface",
  {
    backendOnly: backendLegacyOnly.slice(0, 80),
    truncated: backendLegacyOnly.length > 80,
  },
  backendLegacyOnly.length === 0 ? "pass" : "warn",
);

addFinding(
  "warn",
  "mobile-parity",
  "iOS contract mirror mismatch (web request/response type names)",
  {
    iosMissingRequestTypes: iosMissingRequestResponse.request,
    iosMissingResponseTypes: iosMissingRequestResponse.response,
    iosExtraRequestTypes: iosExtraRequestResponse.request.slice(0, 60),
    iosExtraResponseTypes: iosExtraRequestResponse.response.slice(0, 60),
  },
  iosMissingRequestResponse.request.length === 0 && iosMissingRequestResponse.response.length === 0 ? "pass" : "warn",
);

addFinding(
  "warn",
  "mobile-parity",
  "Android contract mirror mismatch (web request/response type names)",
  {
    androidMissingRequestTypes: androidMissingRequestResponse.request,
    androidMissingResponseTypes: androidMissingRequestResponse.response,
    androidExtraRequestTypes: androidExtraRequestResponse.request.slice(0, 60),
    androidExtraResponseTypes: androidExtraRequestResponse.response.slice(0, 60),
  },
  androidMissingRequestResponse.request.length === 0 && androidMissingRequestResponse.response.length === 0
    ? "pass"
    : "warn",
);

addFinding(
  "warn",
  "route-coverage",
  "Docs/API routes not represented in API V1 allowlist",
  {
    docsRouteSet: [...docsRoutePaths].slice(0, 80),
    apiV1RouteCount: backendRoutePaths.length,
  },
  webMethods.size === 0 || backendRoutePaths.length > 0 ? "pass" : "warn",
);

report.diffs = {
  web: {
    methods: [...webMethods].sort(),
    requestTypes: [...portalContracts.requestTypes].sort(),
    responseTypes: [...portalContracts.responseTypes].sort(),
  },
  docs: {
    methods: [...docsMethods].sort(),
    endpointPaths: [...docsRoutePaths].sort(),
  },
  backend: {
    directExports: [...backendSurface.directExports].sort(),
    legacyRoutes: [...backendSurface.legacyRouteMethods].sort(),
    apiV1Routes: [...backendRoutePaths].sort(),
  },
  parity: {
    docsMissingFromWeb,
    webMissingFromDoc: webMissingFromDocs,
    webMissingFromBackend,
    backendOnly: backendLegacyOnly,
    iosMissing: {
      request: iosMissingRequestResponse.request,
      response: iosMissingRequestResponse.response,
    },
    androidMissing: {
      request: androidMissingRequestResponse.request,
      response: androidMissingRequestResponse.response,
    },
  },
};

const errorCount = countSeverities("error", report.checks);
const warningCount = countSeverities("warning", report.checks);
if (strict && warningCount > 0) {
  report.status = "fail";
} else if (errorCount > 0) {
  report.status = "fail";
} else {
  report.status = "pass";
}
report.summary = {
  status: report.status,
  errorCount,
  warningCount,
  webMethodCount: webMethods.size,
  backendMethodCount: backendMethodSurface.size,
  docMethodCount: docsMethods.size,
  iosTypeCount: iosContracts.requestTypes.size + iosContracts.responseTypes.size,
  androidTypeCount: androidContracts.requestTypes.size + androidContracts.responseTypes.size,
  apiV1RouteCount: backendRoutePaths.length,
};

if (emitJson) {
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(formatText(report));
}

if (report.status === "fail") {
  process.exit(1);
}
process.exit(0);

function parsePortalContracts(content = "") {
  const interfaceMethods = parseInterfaceMethods(content);
  const fnNameAliases = parsePortalFnNameAliases(content);
  const requestTypes = parseTypeNames(content, "Request");
  const responseTypes = parseTypeNames(content, "Response");
  const v1Routes = parseV1RouteConstants(content);

  return {
    interfaceMethods: Array.from(interfaceMethods),
    fnNameAliases: Array.from(fnNameAliases),
    requestTypes: Array.from(requestTypes),
    responseTypes: Array.from(responseTypes),
    v1Routes: Array.from(v1Routes),
  };
}

function parseApiContractDoc(content = "") {
  const endpointNames = parseEndpointHeadings(content);
  const endpointPaths = parseEndpointPathsFromDoc(content);
  const pathDerivedNames = new Set();
  for (const path of endpointPaths) {
    const segment = path.split("?")[0].split("/")[1];
    if (!segment || segment === "<functionName>") {
      continue;
    }
    pathDerivedNames.add(segment.replace(/[<>]/g, ""));
  }
  const normalizedEndpointNames = union(endpointNames, pathDerivedNames);
  return {
    endpointNames: normalizedEndpointNames,
    endpointPaths: Array.from(endpointPaths),
  };
}

function parseBackendSurface(indexContent = "", apiV1Content = "") {
  const directExports = parseExportedFunctionNames(indexContent);
  const legacyRouteMethods = parseLegacyReservationHandlerMappings(indexContent);
  const apiV1Routes = parseApiV1Routes(apiV1Content);
  const v1MethodAliases = new Set();
  for (const route of apiV1Routes) {
    for (const alias of deriveMethodsFromRoute(route)) {
      v1MethodAliases.add(alias);
    }
  }
  return {
    directExports,
    legacyRouteMethods,
    apiV1Routes: Array.from(apiV1Routes),
    v1MethodAliases: Array.from(v1MethodAliases),
  };
}

function parseSwiftContracts(content = "") {
  const requestTypes = new Set();
  const responseTypes = new Set();
  const structRegex = /\b(struct|typealias)\s+([A-Za-z0-9_]+)\s*/g;
  let match;
  while ((match = structRegex.exec(content)) !== null) {
    const name = match[2];
    if (name.endsWith("Request")) {
      requestTypes.add(name);
      continue;
    }
    if (name.endsWith("Response")) {
      responseTypes.add(name);
    }
  }
  return { requestTypes, responseTypes };
}

function parseKotlinContracts(content = "") {
  const requestTypes = new Set();
  const responseTypes = new Set();
  const classRegex = /\b(?:data )?class\s+([A-Za-z0-9_]+)\b/g;
  const typeAliasRegex = /\btypealias\s+([A-Za-z0-9_]+)\s*=/g;
  let match;
  while ((match = classRegex.exec(content)) !== null) {
    const name = match[1];
    if (name.endsWith("Request")) {
      requestTypes.add(name);
      continue;
    }
    if (name.endsWith("Response")) {
      responseTypes.add(name);
    }
  }
  while ((match = typeAliasRegex.exec(content)) !== null) {
    const name = match[1];
    if (name.endsWith("Request")) {
      requestTypes.add(name);
      continue;
    }
    if (name.endsWith("Response")) {
      responseTypes.add(name);
    }
  }
  return { requestTypes, responseTypes };
}

function parseInterfaceMethods(content = "") {
  const methods = new Set();
  const blockMatch = content.match(/export type PortalApi\s*=\s*{([\s\S]*?)\n};/);
  if (!blockMatch) {
    return methods;
  }
  const block = blockMatch[1];
  const methodRegex = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm;
  let match;
  while ((match = methodRegex.exec(block)) !== null) {
    methods.add(match[1]);
  }
  return methods;
}

function parsePortalFnNameAliases(content = "") {
  const aliases = new Set();
  const blockMatch = content.match(/type\s+PortalFnName\s*=\s*([^;]+);/);
  if (!blockMatch) {
    return aliases;
  }
  const body = blockMatch[1];
  const quoteRegex = /"([^"]+)"/g;
  let match;
  while ((match = quoteRegex.exec(body)) !== null) {
    aliases.add(match[1]);
  }
  return aliases;
}

function parseTypeNames(content = "", suffix) {
  const types = new Set();
  const regex = /export type\s+([A-Za-z0-9_]+)\s*[:=]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const name = match[1];
    if (name.endsWith(suffix)) {
      types.add(name);
    }
  }
  return types;
}

function parseV1RouteConstants(content = "") {
  const routes = new Set();
  const regex = /export const\s+(V1_[A-Z0-9_]+)\s*=\s*["'`]([^"'`]+)["'`]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    routes.add(match[2]);
  }
  return routes;
}

function parseEndpointHeadings(content = "") {
  const names = new Set();
  const section = extractSection(content, "Functions");
  const headingRegex = /^###\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/gm;
  let match;
  while ((match = headingRegex.exec(section)) !== null) {
    const name = match[1].trim();
    if (name === "Production" || name === "Environments") {
      continue;
    }
    const lookahead = section.slice(match.index + match[0].length, match.index + match[0].length + 420);
    if (!/POST\s+\$\{BASE_URL\}\//m.test(lookahead)) {
      continue;
    }
    names.add(name);
  }
  return names;
}

function parseEndpointPathsFromDoc(content = "") {
  const paths = new Set();
  const pathRegex = /\$\{BASE_URL\}\/([^ \n`"')\]]+)/g;
  let match;
  while ((match = pathRegex.exec(content)) !== null) {
    const raw = match[1].trim();
    if (!raw || raw.includes("<") || raw.includes(">")) {
      continue;
    }
    if (raw && raw !== "") {
      paths.add(`/${raw.split("?")[0]}`);
    }
  }
  return paths;
}

function extractSection(content = "", headingName) {
  const normalized = content || "";
  const headingRegex = new RegExp(`^##\\s+${headingName}\\b.*$`, "im");
  const sectionMatch = normalized.match(headingRegex);
  if (!sectionMatch || sectionMatch.index === undefined) {
    return normalized;
  }
  const bodyStart = sectionMatch.index + sectionMatch[0].length;
  const remaining = normalized.slice(bodyStart);
  const nextMatch = remaining.match(/^##\s+/m);
  if (!nextMatch || nextMatch.index === undefined) {
    return remaining;
  }
  return remaining.slice(0, nextMatch.index);
}

function parseExportedFunctionNames(content = "") {
  const methods = new Set();
  const regex = /^export const\s+([A-Za-z0-9_]+)\s*=/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    methods.add(match[1]);
  }
  const namedExportRegex = /^export\s+{([^}]+)}(?:\s+from\s+["'][^"']+["'])?\s*;?/gms;
  while ((match = namedExportRegex.exec(content)) !== null) {
    const block = match[1];
    for (const rawName of block.split(",")) {
      const trimmed = rawName.trim();
      if (!trimmed) {
        continue;
      }
      const aliasMatch = trimmed.match(/([A-Za-z0-9_]+)\s+as\s+[A-Za-z0-9_]+/);
      if (aliasMatch) {
        methods.add(aliasMatch[1]);
        continue;
      }
      methods.add(trimmed);
    }
  }
  return methods;
}

function parseLegacyReservationHandlerMappings(content = "") {
  const methods = new Set();
  const regex = /export const\s+([A-Za-z0-9_]+)\s*=\s*legacyReservationCompatHandler\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const methodName = match[1];
    const route = match[2];
    methods.add(methodName);
    for (const derived of deriveMethodsFromRoute(route)) {
      methods.add(derived);
    }
  }
  return methods;
}

function parseApiV1Routes(content = "") {
  const routes = new Set();
  const setBlock = content.match(/ALLOWED_API_V1_ROUTES\s*=\s*new\s+Set<string>\((\[[\s\S]*?\])\)/);
  if (setBlock) {
    const block = setBlock[1];
    const entryRegex = /"([^"]+)"/g;
    let match;
    while ((match = entryRegex.exec(block)) !== null) {
      routes.add(match[1]);
    }
    return routes;
  }

  const fallbackRegex = /"\/v1\/[A-Za-z0-9_.]+"/g;
  let fallback;
  while ((fallback = fallbackRegex.exec(content)) !== null) {
    routes.add(fallback[0].slice(1, -1));
  }
  return routes;
}

function parseArgs(argv) {
  const options = {
    strict: false,
    json: false,
    artifact: DEFAULT_ARTIFACT,
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
    if (arg === "--artifact") {
      options.artifact = argv[index + 1] || options.artifact;
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      options.artifact = arg.substring("--artifact=".length);
    }
  }
  return options;
}

function deriveMethodsFromRoute(route) {
  if (!route.startsWith("/v1/")) {
    return [route];
  }
  const tail = route.replace(/^\/v1\//, "");
  const segments = tail.split(".");
  if (segments.length === 0) {
    return [];
  }

  const resource = segments[0];
  const actions = segments.slice(1);
  if (actions.length === 0) {
    return [resource];
  }
  const singular = singularize(resource);
  const pascalResource = capitalize(singular);
  const pascalPlural = capitalize(resource);
  const result = [];
  const first = actions[0];
  result.push(`${first}${pascalResource}`);
  result.push(`${first}${pascalPlural}`);
  if (actions.length > 1) {
    const camelTail = actions.map(capitalize).join("");
    result.push(`${camelTail}${pascalResource}`);
    result.push(`${camelTail}${pascalPlural}`);
    const last = actions[actions.length - 1];
    result.push(`${last}${pascalResource}`);
    result.push(`${last}${pascalPlural}`);
    result.push(`${capitalize(first)}${capitalize(last)}${pascalResource}`);
  }
  return [...new Set(result)];
}

function addFinding(severity, category, message, details = {}, status = severity) {
  report.checks.push({
    severity,
    category,
    message,
    status,
    details,
  });
}

function countSeverities(severity, checks) {
  return checks.filter((entry) => entry.status === severity).length;
}

function union(...sets) {
  return new Set(sets.flatMap((set) => [...set]));
}

function difference(a, b) {
  const output = [];
  for (const entry of a) {
    if (!b.has(entry)) {
      output.push(entry);
    }
  }
  return output;
}

function filterSuffix(source, suffix) {
  const out = new Set();
  for (const entry of source) {
    if (entry.endsWith(suffix)) {
      out.add(entry);
    }
  }
  return out;
}

function readFile(path) {
  if (!path || !existsSync(path)) {
    return "";
  }
  return readFileSync(path, "utf8");
}

function singularize(value) {
  if (!value) {
    return value;
  }
  if (value.endsWith("ies")) {
    return `${value.slice(0, -3)}y`;
  }
  if (value.endsWith("s") && value.length > 1) {
    return value.slice(0, -1);
  }
  return value;
}

function capitalize(text) {
  if (!text) {
    return text;
  }
  return `${text[0].toUpperCase()}${text.slice(1)}`;
}

function formatText(payload) {
  const lines = [];
  lines.push(`Source-of-truth contract matrix: ${payload.status.toUpperCase()}`);
  lines.push(`strict=${payload.strict}`);
  lines.push(`checks=${payload.checks.length}, errors=${countSeverities("error", payload.checks)}, warnings=${countSeverities("warning", payload.checks)}`);
  lines.push("");
  for (const check of payload.checks) {
    const prefix = check.status === "error" ? "[ERROR]" : check.status === "warn" ? "[WARN]" : "[PASS]";
    lines.push(`${prefix} ${check.category}: ${check.message}`);
    if (check.details && Object.keys(check.details).length > 0) {
      lines.push(`  ${JSON.stringify(check.details)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
