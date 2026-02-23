#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "../..", "..");
const DEFAULT_PORTAL_URL = "https://portal.monsoonfire.com";
const DEFAULT_DEEP_PATH = "/reservations";
const DEFAULT_WELL_KNOWN_PATH = "/.well-known/apple-app-site-association";
const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
const DEFAULT_PROTECTED_FUNCTION = "listMaterialsProducts";
const DEFAULT_ID_TOKEN_ENV = "PORTAL_CUTOVER_ID_TOKEN";

const CLI_ALIAS_MAP = {
  portalurl: "portalUrl",
  portalUrl: "portalUrl",
  deeppath: "deepPath",
  deepPath: "deepPath",
  wellknownpath: "wellKnownPath",
  wellKnownPath: "wellKnownPath",
  reportpath: "reportPath",
  reportPath: "reportPath",
  timeoutms: "timeoutMs",
  timeoutMs: "timeoutMs",
  functionsbaseurl: "functionsBaseUrl",
  functionsBaseUrl: "functionsBaseUrl",
  protectedfn: "protectedFn",
  protectedFn: "protectedFn",
  protectedbody: "protectedBody",
  protectedBody: "protectedBody",
  idtoken: "idToken",
  idToken: "idToken",
  idtokenenv: "idTokenEnv",
  idTokenEnv: "idTokenEnv",
  requireprotectedcheck: "requireProtectedCheck",
  requireProtectedCheck: "requireProtectedCheck",
};

const options = parseArgs(process.argv.slice(2));
const result = await runVerify(options);

if (result.reportPath) {
  const absoluteReportPath = resolve(repoRoot, result.reportPath);
  mkdirSync(dirname(absoluteReportPath), { recursive: true });
  writeFileSync(absoluteReportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote verification report: ${result.reportPath}\n`);
}

if (!result.ok) {
  process.stdout.write(`\nVerifier FAILED for ${result.portalUrl}\n`);
  for (const issue of result.summary.failures) {
    process.stdout.write(` - ${issue}\n`);
  }
  process.exit(1);
}

process.stdout.write(`\nVerifier PASS for ${result.portalUrl}\n`);
process.stdout.write(`Checks passed: ${result.summary.passed.join(", ")}\n`);

async function runVerify(parsed) {
  const portalUrl = normalizeUrl(parsed.portalUrl || DEFAULT_PORTAL_URL);
  const deepPath = ensureLeadingSlash(parsed.deepPath || DEFAULT_DEEP_PATH);
  const wellKnownPath = ensureLeadingSlash(parsed.wellKnownPath || DEFAULT_WELL_KNOWN_PATH);
  const reportPath = parsed.reportPath || "";
  const timeoutMs = parseInt(parsed.timeoutMs || "15000", 10) || 15000;
  const functionsBaseUrl = normalizeBaseUrl(parsed.functionsBaseUrl || DEFAULT_FUNCTIONS_BASE_URL);
  const protectedFn = normalizeFunctionName(parsed.protectedFn || DEFAULT_PROTECTED_FUNCTION);
  const requireProtectedCheck = coerceBoolean(parsed.requireProtectedCheck);
  const idTokenEnv = String(parsed.idTokenEnv || DEFAULT_ID_TOKEN_ENV).trim();
  const idToken = String(parsed.idToken || process.env[idTokenEnv] || "").trim();

  const checks = [];
  const failures = [];
  const passes = [];
  const warnings = [];

  const root = await requestWithTimeout({ url: portalUrl, timeoutMs });
  checks.push(toReportCheck(root));
  evaluateResult("rootRoute", root, failures, passes);

  const deep = await requestWithTimeout({ url: `${portalUrl}${deepPath}`, timeoutMs });
  checks.push(toReportCheck(deep));
  evaluateResult("deepRoute", deep, failures, passes);

  const wellKnown = await requestWithTimeout({ url: `${portalUrl}${wellKnownPath}`, timeoutMs });
  checks.push(toReportCheck(wellKnown));
  evaluateResult("wellKnownRoute", wellKnown, failures, passes, {
    requireBodyContains: "",
    allowNon200: false,
    minBodyLength: 16,
  });

  const rootSampleAssets = extractAssetPaths(root.body || "");
  const sampleAssets = rootSampleAssets.slice(0, 3);
  const assetChecks = [];
  for (const assetPath of sampleAssets) {
    const assetResponse = await requestWithTimeout({
      url: `${portalUrl}${assetPath}`,
      timeoutMs,
    });
    assetChecks.push({
      path: assetPath,
      status: assetResponse.status,
      cacheControl: assetResponse.cacheControl,
      hasCacheHeader: Boolean(assetResponse.cacheControl),
      ok: assetResponse.ok && assetResponse.status === 200,
    });
  }

  for (const check of assetChecks) {
    if (check.ok && isStrongCacheHeader(check.cacheControl)) {
      passes.push(`asset${check.path}`);
    } else if (check.ok) {
      warnings.push(`asset${check.path} has weak cache header: ${check.cacheControl || "<missing>"}`);
    } else {
      failures.push(`asset ${check.path} request failed (${check.status})`);
    }
  }

  checkHeaders("rootCache", root, root.path, failures, passes, warnings);
  checkHeaders("deepCache", deep, deep.path, failures, passes, warnings);

  const protectedFunctionCheck = {
    required: requireProtectedCheck,
    attempted: false,
    endpoint: `${functionsBaseUrl}/${protectedFn}`,
    functionName: protectedFn,
    requestBody: null,
    status: 0,
    ok: false,
    idTokenSource: "none",
    message: "",
    responseSnippet: "",
  };

  const protectedBodyResult = resolveProtectedBody(protectedFn, parsed.protectedBody);
  if (!protectedBodyResult.ok) {
    failures.push(`protected function payload parse failed: ${protectedBodyResult.error}`);
  } else {
    protectedFunctionCheck.requestBody = protectedBodyResult.body;
  }

  if (!idToken) {
    const hint = `set --id-token <token> or ${idTokenEnv}=<token> in env`;
    if (requireProtectedCheck) {
      failures.push(`protected function check required but no id token provided (${hint})`);
    } else {
      warnings.push(`protected function check skipped (${hint})`);
    }
  } else if (protectedBodyResult.ok) {
    protectedFunctionCheck.attempted = true;
    protectedFunctionCheck.idTokenSource = parsed.idToken ? "cli" : `env:${idTokenEnv}`;
    const protectedResult = await requestJsonWithTimeout({
      url: protectedFunctionCheck.endpoint,
      timeoutMs,
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${idToken}`,
        origin: portalUrl,
      },
      body: JSON.stringify(protectedBodyResult.body),
    });

    protectedFunctionCheck.status = protectedResult.status;
    protectedFunctionCheck.ok =
      protectedResult.ok &&
      protectedResult.status === 200 &&
      protectedResult.json &&
      typeof protectedResult.json === "object" &&
      protectedResult.json.ok === true;
    protectedFunctionCheck.message = protectedResult.error || "";
    protectedFunctionCheck.responseSnippet = snippetFromValue(
      protectedResult.json ?? protectedResult.body ?? "",
      320,
    );

    if (protectedFunctionCheck.ok) {
      passes.push("protectedFunction");
    } else {
      const reason =
        protectedResult.error ||
        `status=${protectedResult.status}, body=${protectedFunctionCheck.responseSnippet || "<empty>"}`;
      failures.push(`protected function check failed (${reason})`);
    }
  }

  const summary = {
    ok: failures.length === 0,
    passed: [...passes],
    warnings: [...warnings],
    failures: [...failures],
  };

  return {
    ok: summary.ok,
    portalUrl,
    checks,
    summary,
    deepPath,
    wellKnownPath,
    sampleAssets,
    assetChecks,
    protectedFunctionCheck,
    reportPath: parsed.reportPath || "",
  };
}

function evaluateResult(name, result, failures, passes, options = {}) {
  const {
    requireBodyContains = "<html",
    allowNon200 = false,
    minBodyLength = 1,
  } = options;

  if (!result || result.error) {
    failures.push(`${name} request failed: ${result?.error || "network error"}`);
    return;
  }

  if (!allowNon200 && result.status !== 200) {
    failures.push(`${name} returned status ${result.status}`);
    return;
  }

  if ((result.body || "").length < minBodyLength) {
    failures.push(`${name} response body is empty or too short`);
    return;
  }

  if (requireBodyContains && !result.body.toLowerCase().includes(requireBodyContains.toLowerCase())) {
    failures.push(`${name} response missing expected marker: ${requireBodyContains}`);
    return;
  }

  if (result.ok) {
    passes.push(name);
  }
}

function checkHeaders(name, result, path, failures, passes, warnings) {
  if (!result || !result.ok) {
    failures.push(`${name} skipped due upstream failure (${path})`);
    return;
  }

  const cache = (result.cacheControl || "").trim();
  if (name === "rootCache" || name === "deepCache") {
    if (!cache) {
      warnings.push(`${name} missing cache-control header at ${path}`);
      return;
    }

    if (isShortHtmlCacheHeader(cache)) {
      passes.push(name);
      return;
    }

    failures.push(`${name} cache-control is too aggressive for html (${path} -> ${cache})`);
    return;
  }

  if (result.ok) {
    passes.push(name);
  }
}

function isShortHtmlCacheHeader(rawHeader) {
  const header = rawHeader.toLowerCase();
  if (header.includes("no-cache") || header.includes("no-store") || header.includes("max-age=0")) {
    return true;
  }

  const match = header.match(/max-age=(\d+)/);
  if (!match) {
    return false;
  }

  const maxAge = Number.parseInt(match[1], 10);
  if (!Number.isFinite(maxAge)) {
    return false;
  }

  return maxAge <= 300;
}

async function requestWithTimeout({ url, timeoutMs, method = "GET", headers = {}, body = undefined }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const result = {
    path: url,
    status: 0,
    ok: false,
    body: "",
    cacheControl: "",
    error: "",
  };

  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "monsoonfire-namecheap-cutover-checker/1.0",
        accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.8",
        ...headers,
      },
      body,
    });
    result.status = response.status;
    result.ok = response.ok;
    result.cacheControl = response.headers.get("cache-control") || "";
    result.body = await response.text();
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function requestJsonWithTimeout({ url, timeoutMs, method = "POST", headers = {}, body = "" }) {
  const result = await requestWithTimeout({
    url,
    timeoutMs,
    method,
    headers: {
      accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
      ...headers,
    },
    body,
  });

  let json = null;
  try {
    json = result.body ? JSON.parse(result.body) : null;
  } catch {
    json = null;
  }

  return {
    ...result,
    json,
  };
}

function isStrongCacheHeader(rawHeader) {
  if (!rawHeader) {
    return false;
  }
  const header = rawHeader.toLowerCase();
  const hasImmutable = /immutable/.test(header);
  const maxAge = /max-age=\d{4,}/.test(header);
  return hasImmutable || maxAge;
}

function extractAssetPaths(html) {
  const candidates = [];
  const pattern = /(?:src|href)=["']([^"']+)["']/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const candidate = match[1] || "";
    if (!candidate.startsWith("/assets/")) {
      continue;
    }
    if (candidate.includes("?")) {
      continue;
    }
    candidates.push(candidate);
  }
  return [...new Set(candidates)];
}

function normalizeUrl(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    return DEFAULT_PORTAL_URL;
  }
  try {
    return new URL(trimmed).toString().replace(/\/$/, "");
  } catch {
    return trimmed;
  }
}

function normalizeBaseUrl(raw) {
  return normalizeUrl(raw).replace(/\/+$/, "");
}

function ensureLeadingSlash(raw) {
  const path = String(raw || "").trim();
  if (!path.startsWith("/")) {
    return `/${path}`;
  }
  return path;
}

function normalizeFunctionName(raw) {
  return String(raw || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "") || DEFAULT_PROTECTED_FUNCTION;
}

function coerceBoolean(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function resolveProtectedBody(functionName, rawBody) {
  if (!rawBody) {
    if (functionName === "listMaterialsProducts") {
      return { ok: true, body: { includeInactive: false } };
    }
    return { ok: true, body: {} };
  }

  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, error: "protected body must be a JSON object" };
    }
    return { ok: true, body: parsed };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function snippetFromValue(value, maxLength = 300) {
  const text =
    typeof value === "string"
      ? value
      : (() => {
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })();

  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function toReportCheck(result) {
  const bodyText = result?.body || "";
  return {
    path: result?.path || "",
    status: result?.status || 0,
    ok: Boolean(result?.ok),
    bodySnippet: snippetFromValue(bodyText, 320),
    bodyLength: bodyText.length,
    cacheControl: result?.cacheControl || "",
    error: result?.error || "",
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token || typeof token !== "string") {
      continue;
    }

    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }

    const match = token.match(/^--([^=]+)(?:=(.*))?$/);
    if (match) {
      const key = match[1].replace(/-/g, "");
      const normKey = CLI_ALIAS_MAP[key.toLowerCase()];
      if (!normKey) {
        continue;
      }
      parsed[normKey] = match[2] ?? (argv[i + 1] || "");
      if (match[2] === undefined) {
        i += 1;
      }
      continue;
    }

    const ps1Style = token.match(/^-(.*)$/);
    if (ps1Style) {
      const key = ps1Style[1];
      const normKey = CLI_ALIAS_MAP[key.toLowerCase()];
      if (!normKey) {
        continue;
      }
      parsed[normKey] = argv[i + 1] || "";
      i += 1;
    }
  }
  return parsed;
}

function printUsage() {
  const usage = [
    "Usage:",
    "  node ./web/deploy/namecheap/verify-cutover.mjs [--portal-url <url>] [--deep-path <path>] [--well-known-path <path>] [--report-path <path>]",
    "    [--functions-base-url <url>] [--protected-fn <name>] [--protected-body <json>]",
    "    [--id-token <token> | --id-token-env <ENV_VAR>] [--require-protected-check <true|false>]",
    "",
    "Examples:",
    "  node ./web/deploy/namecheap/verify-cutover.mjs",
    '  node ./web/deploy/namecheap/verify-cutover.mjs --portal-url https://portal.monsoonfire.com --report-path docs/cutover-verify.json',
    "  PORTAL_CUTOVER_ID_TOKEN=<token> node ./web/deploy/namecheap/verify-cutover.mjs --require-protected-check true",
    "",
    "Compatibility legacy shell aliases are supported:",
    "  -PortalUrl <url> -ReportPath <path>",
  ].join("\n");

  process.stdout.write(`${usage}\n`);
}
