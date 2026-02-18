#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(__filename, "..", "..");

const DEFAULT_BASE_URL = "https://monsoonfire-portal.web.app";
const defaultOutputRoot = resolve(repoRoot, "output", "playwright", "portal");
const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
const DEFAULT_STUDIO_BRAIN_READYZ_PATH = "/readyz";
const DEFAULT_DEEP_PROBE_TIMEOUT_MS = 12000;
const DEFAULT_PROBE_CREDENTIAL_MODE = "same-origin";

const FORBIDDEN_URL_PATTERNS = [
  /127\.0\.0\.1:8787/i,
  /localhost:8787/i,
  /\[::1\]:8787/i,
];
const LOCAL_READYZ_HINT_PATTERNS = [
  /127\.0\.0\.1:8787\/readyz/i,
  /localhost:8787\/readyz/i,
  /\[::1\]:8787\/readyz/i,
];
const CRITICAL_SERVICE_PATTERNS = [
  /\/apiV1\/v1\//i,
  /\/readyz/i,
  /listIntegrationTokens/i,
  /listBillingSummary/i,
  /listEvents/i,
  /listDelegations/i,
  /listSecurityAuditEvents/i,
  /staffListAgentClients/i,
  /staffGetAgentServiceCatalog/i,
  /staffListAgentClientAuditLogs/i,
  /staffGetAgentOpsConfig/i,
  /staffListAgentOperations/i,
  /apiV1\/v1\/agent\.requests\.listStaff/i,
  /apiV1\/v1\/agent\.requests\.listMine/i,
  /apiV1\/v1\/events\.feed/i,
  /apiV1\/v1\/batches\.list/i,
  /staffGetRequest/i,
  /staffCreateRequest/i,
  /staffApproveRequest/i,
  /api\/ops/i,
  /api\/capabilities/i,
  /api\/intake/i,
];

const AUTH_REQUIRED_PATTERNS = [
  /\/apiV1\/v1\//i,
  /\/apiV1\//i,
  /\/staff/i,
  /listIntegrationTokens/i,
  /listBillingSummary/i,
  /listEvents/i,
  /listDelegations/i,
  /staffListAgentClients/i,
  /staffGetAgentServiceCatalog/i,
  /staffGetAgentOpsConfig/i,
  /staffListAgentClientAuditLogs/i,
  /staffListAgentOperations/i,
  /listSecurityAuditEvents/i,
  /staffGetCommunitySafetyConfig/i,
  /staffSetEventStatus/i,
  /staffGetRequest/i,
  /staffCreateRequest/i,
  /staffApproveRequest/i,
  /staff\w*Request/i,
];

const DEEP_ENDPOINT_PROBES = [
  {
    label: "listIntegrationTokens",
    path: "/listIntegrationTokens",
    method: "POST",
    body: {},
    allowAuthFailure: true,
    host: "functions",
  },
  {
    label: "listBillingSummary",
    path: "/listBillingSummary",
    method: "POST",
    body: { limit: 60 },
    allowAuthFailure: true,
    host: "functions",
  },
  {
    label: "listEvents",
    path: "/listEvents",
    method: "POST",
    body: { includeDrafts: true, includeCancelled: true },
    allowAuthFailure: true,
    host: "functions",
  },
  {
    label: "listDelegations",
    path: "/listDelegations",
    method: "POST",
    body: { includeRevoked: true, limit: 200 },
    allowAuthFailure: true,
    host: "functions",
  },
  {
    label: "staffListAgentClients",
    path: "/staffListAgentClients",
    method: "POST",
    body: { includeRevoked: true, limit: 200 },
    allowAuthFailure: true,
    host: "functions",
  },
  {
    label: "staffGetAgentServiceCatalog",
    path: "/staffGetAgentServiceCatalog",
    method: "POST",
    body: {},
    allowAuthFailure: true,
    host: "functions",
  },
  {
    label: "staffGetAgentOpsConfig",
    path: "/staffGetAgentOpsConfig",
    method: "POST",
    body: {},
    allowAuthFailure: true,
    host: "functions",
  },
  {
    label: "staffListAgentClientAuditLogs",
    path: "/staffListAgentClientAuditLogs",
    method: "POST",
    body: { limit: 80 },
    allowAuthFailure: true,
    host: "functions",
  },
  {
    label: "staffListAgentOperations",
    path: "/staffListAgentOperations",
    method: "POST",
    body: { limit: 80 },
    allowAuthFailure: true,
    host: "functions",
  },
  {
    label: "apiV1 v1 agent.requests.listStaff",
    path: "/apiV1/v1/agent.requests.listStaff",
    method: "POST",
    body: { limit: 40, includeClosed: false },
    allowAuthFailure: true,
    host: "functions",
  },
  {
    label: "apiV1 v1 agent.requests.listMine",
    path: "/apiV1/v1/agent.requests.listMine",
    method: "POST",
    body: { limit: 40, includeClosed: false },
    allowAuthFailure: true,
    host: "functions",
  },
  {
    label: "apiV1 v1 events.feed",
    path: "/apiV1/v1/events.feed",
    method: "GET",
    body: null,
    allowAuthFailure: true,
    host: "functions",
  },
  {
    label: "apiV1 v1 batches.list",
    path: "/apiV1/v1/batches.list",
    method: "GET",
    body: null,
    allowAuthFailure: true,
    host: "functions",
  },
  {
    label: "listSecurityAuditEvents",
    path: "/listSecurityAuditEvents",
    method: "POST",
    body: { limit: 100 },
    allowAuthFailure: true,
    host: "functions",
  },
  {
    label: "staffGetCommunitySafetyConfig",
    path: "/staffGetCommunitySafetyConfig",
    method: "POST",
    body: {},
    allowAuthFailure: true,
    host: "functions",
  },
  {
    label: "studio-brain readyz",
    path: DEFAULT_STUDIO_BRAIN_READYZ_PATH,
    method: "GET",
    body: null,
    allowAuthFailure: false,
    host: "studio-brain",
  },
];

const READYZ_PATTERNS = [/\/readyz(?:\?.*)?$/i];

const CORS_ERROR_TOKENS = [
  /No 'Access-Control-Allow-Origin'/i,
  /blocked by CORS policy/i,
  /Response to preflight request doesn't pass access control check/i,
  /TypeError: Failed to fetch/i,
  /net::ERR_FAILED/i,
];

const CORS_RESPONSE_TOKENS = [
  /origin not allowed/i,
  /CORS/i,
];

const FIRESTORE_NOISE = [
  /Could not reach Cloud Firestore backend/i,
  /WebChannelConnection RPC/i,
];

const COOP_WARNING_TOKENS = [
  /Cross-Origin-Opener-Policy policy would block/i,
  /window\.closed/i,
  /window\.close/i,
];

const PAGE_NOISE_TOKENS = [
  ...FIRESTORE_NOISE,
  /Missing or insufficient permissions/i,
  ...COOP_WARNING_TOKENS,
];

const normalizeProbeHeader = (value) => {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
};

const normalizeProbeCredentialMode = (value, fallback = DEFAULT_PROBE_CREDENTIAL_MODE) => {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["omit", "same-origin", "include"].includes(normalized)) {
    return normalized;
  }
  return fallback;
};

const isLocalTarget = (value) => {
  try {
    const parsed = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
};

const isLocalReadyzTarget = (value) => {
  if (typeof value !== "string") return false;
  if (!isReadyzPath(value)) return false;
  if (!value.includes("://")) return false;
  try {
    const parsed = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) || parsed.hostname === "";
  } catch {
    return false;
  }
};

const isExpectedLoopbackReadyzFailure = (value, options = {}) => {
  const isProduction = Boolean(options.isProduction);
  const text = typeof value === "string" ? value : "";
  const hasHint = hasMatch(text, LOCAL_READYZ_HINT_PATTERNS) || isLocalReadyzTarget(text);
  if (!hasHint) return false;
  if (isProduction) return false;
  return Boolean(options.allowLocalLoopback);
};

const isCriticalFunctionCall = (url) => /us-central1-[a-z0-9-]+\.cloudfunctions\.net|:8787/i.test(url);
const isCrossOriginRequest = (requestUrl, requestOrigin) => {
  if (!requestOrigin || typeof requestUrl !== "string" || !requestUrl.trim()) return false;
  try {
    return new URL(requestUrl).origin !== requestOrigin;
  } catch {
    return false;
  }
};

const missingAllowOriginHeader = (requestOrigin, allowOriginHeader, isCrossOrigin) => {
  if (!isCrossOrigin || !requestOrigin) return false;
  return !Boolean(allowOriginHeader && allowOriginHeader.trim());
};

const shouldIgnoreAuthFailure = (url) => hasMatch(url, AUTH_REQUIRED_PATTERNS);

const readReadyzRequestHost = (urlString) => {
  try {
    const parsed = new URL(urlString);
    return {
      origin: parsed.origin,
      host: parsed.host,
      hostname: parsed.hostname,
      pathname: parsed.pathname,
    };
  } catch {
    return { origin: "", host: "", hostname: "", pathname: "" };
  }
};

const ensureDir = async (dirPath) => mkdir(dirPath, { recursive: true });

const normalizeBoolean = (value, fallback = false) => {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const normalizeBaseUrl = (value) => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new URL(trimmed);
  return parsed.toString().replace(/\/+$/, "");
};

const normalizeFunctionsBaseUrl = (value, fallback = DEFAULT_FUNCTIONS_BASE_URL) => {
  if (!value || typeof value !== "string") return fallback;
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || fallback;
};

const parseFunctionsBaseFromPageHost = (baseUrl) => {
  try {
    const parsed = new URL(baseUrl);
    const projectId = parsed.hostname.split(".")[0];
    return projectId ? `https://us-central1-${projectId}.cloudfunctions.net` : DEFAULT_FUNCTIONS_BASE_URL;
  } catch {
    return DEFAULT_FUNCTIONS_BASE_URL;
  }
};

const resolveStudioBrainBaseFromOptions = (options) => {
  const configured = options.studioBrainBaseUrl ? options.studioBrainBaseUrl : "";
  return configured ? configured : "";
};

const probeTimeoutMs = DEFAULT_DEEP_PROBE_TIMEOUT_MS;

const runEndpointProbe = async (page, { label, path, method, body, allowAuthFailure, host }, options) => {
  const baseUrl = host === "functions" ? options.functionsBaseUrl : resolveStudioBrainBaseFromOptions(options);
  if (!baseUrl) {
    return {
      label,
      host,
      path,
      method,
      status: null,
      ok: false,
      fetchError: "missing-base-url",
      allowAuthFailure,
      skipped: true,
      url: path,
      timestamp: new Date().toISOString(),
    };
  }

  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const url = `${normalizedBase}${path.startsWith("/") ? "" : "/"}${path}`;
  const normalizedProbeHeaders = {
    Authorization: normalizeProbeHeader(options.probeBearerToken) ? `Bearer ${normalizeProbeHeader(options.probeBearerToken)}` : "",
    "x-admin-token": normalizeProbeHeader(options.probeAdminToken),
  };
  const credentialMode = normalizeProbeCredentialMode(options.probeCredentialMode || "", DEFAULT_PROBE_CREDENTIAL_MODE);

  const result = await page.evaluate(
    async ({
      inputUrl,
      inputMethod,
      inputBody,
      inputHeaders,
      timeoutMs,
      inputCredentialMode,
      inputPageOrigin,
    }) => {
      const init = {
        method: inputMethod,
        credentials: inputCredentialMode,
        headers: {},
        redirect: "follow",
        mode: "cors",
      };

      if (inputBody && inputMethod !== "GET" && inputMethod !== "HEAD") {
        init.headers["content-type"] = "application/json";
        init.body = JSON.stringify(inputBody);
      }

      Object.entries(inputHeaders || {}).forEach(([key, value]) => {
        if (typeof key === "string" && typeof value === "string" && key.trim() && value.trim()) {
          init.headers[key] = value;
        }
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const stamp = Date.now();

      try {
        const response = await fetch(inputUrl, {
          ...init,
          signal: controller.signal,
        });
        const text = await response.text().catch(() => "");
        const headers = response.headers ? Object.fromEntries(response.headers.entries()) : {};
        const responseOrigin = (() => {
          try {
            return new URL(response.url).origin;
          } catch {
            return "";
          }
        })();
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          type: response.type,
          url: response.url,
          text: text.slice(0, 1400),
          headers,
          durationMs: Date.now() - stamp,
          responseContentType: headers["content-type"] || "",
          allowOriginHeader: headers["access-control-allow-origin"] || "",
          responseOrigin,
          pageOrigin: inputPageOrigin || "",
        };
      } catch (error) {
        return {
          ok: false,
          status: null,
          statusText: "",
          type: "network-fail",
          url: inputUrl,
          fetchError: String(error),
          durationMs: Date.now() - stamp,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    },
    {
      inputUrl: url,
      inputMethod: method,
      inputBody: body,
      inputHeaders: normalizedProbeHeaders,
      timeoutMs: probeTimeoutMs,
      inputCredentialMode: credentialMode,
      inputPageOrigin: options.baseUrl,
    }
  );

  return {
    label,
    host,
    path,
    method,
    url,
    allowAuthFailure,
    skipped: false,
    status: result.status,
    ok: result.ok,
    statusText: result.statusText,
    fetchError: result.fetchError,
    isAuthFailure: result.status === 401 || result.status === 403,
    type: result.type,
    responseType: result.type,
    hasAllowOriginHeader: Boolean(result.allowOriginHeader),
    requestHeaders: {
      ...normalizedProbeHeaders,
      origin: options.baseUrl || "",
    },
    requestCredentialMode: credentialMode,
    durationMs: result.durationMs,
    responseText: result.text,
    text: result.text,
    accessControlAllowOrigin: result.allowOriginHeader || "",
    responseOrigin: result.responseOrigin || "",
    responseContentType: result.responseContentType || "",
    responseHeaders: result.headers || {},
    timestamp: new Date().toISOString(),
  };
};

const isCorsResponseFailure = ({
  method,
  status,
  text,
  allowOriginHeader,
  requestOrigin,
  requestOriginUrl,
  crossOrigin,
}) => {
  const hasAllowOrigin = typeof allowOriginHeader === "string" && allowOriginHeader.trim().length > 0;
  const hasRequestOrigin = typeof requestOrigin === "string" && requestOrigin.trim().length > 0;
  const isOptions = method === "OPTIONS";
  const isCrossOrigin = typeof crossOrigin === "boolean" ? crossOrigin : isCrossOriginRequest(requestOriginUrl || "", requestOrigin);
  const hasMissingAllowOrigin = missingAllowOriginHeader(requestOrigin, allowOriginHeader, isCrossOrigin);

  if (isCrossOrigin && hasRequestOrigin && !hasAllowOrigin) {
    return true;
  }

  if (!Number.isInteger(status)) {
    return hasMissingAllowOrigin && hasRequestOrigin;
  }

  if (isOptions && status >= 200 && status < 400) {
    return hasRequestOrigin && (!hasAllowOrigin || hasMissingAllowOrigin);
  }

  if (status < 300) {
    if (hasMissingAllowOrigin) {
      return true;
    }
    return false;
  }

  const hasCorsBodySignal = hasMatch(text || "", CORS_RESPONSE_TOKENS);
  if (!hasCorsBodySignal) return false;
  return !hasAllowOrigin;
};

const isReadyzPath = (path) => path === DEFAULT_STUDIO_BRAIN_READYZ_PATH || /\/readyz(?:\?.*)?$/i.test(path);

const appendUnique = (items, candidate, keyProps) => {
  const hasExisting = items.some((item) => keyProps.every((key) => String(item[key] || "") === String(candidate[key] || "")));
  if (!hasExisting) {
    items.push(candidate);
  }
};

const runEndpointProbes = async (page, summary, options, runtime) => {
  const results = [];
  const allowLocalLoopbackReadyz = !runtime.enforceLocalhostPolicy;
  const isProduction = Boolean(runtime.enforceLocalhostPolicy);
  const probes = DEEP_ENDPOINT_PROBES.map((probe) => {
    if (runtime.detectedStudioBrainPath && probe.host === "studio-brain" && probe.path === DEFAULT_STUDIO_BRAIN_READYZ_PATH) {
      return {
        ...probe,
        path: runtime.detectedStudioBrainPath,
      };
    }
    return probe;
  });

  for (const probe of probes) {
    const result = await runEndpointProbe(page, probe, options);
    results.push(result);
    summary.network.endpointProbes.push(result);

    const isExpectedStudioBrainLoopback = isExpectedLoopbackReadyzFailure(result.url || `${result.path || ""}`, {
      allowLocalLoopback: allowLocalLoopbackReadyz,
      isProduction,
    });
    const isCors = hasMatch(result.fetchError || "", CORS_ERROR_TOKENS)
      || isCorsResponseFailure({
        method: result.method,
        status: result.status,
        text: result.responseText,
        allowOriginHeader: result.accessControlAllowOrigin,
        requestOrigin: result.requestHeaders?.origin,
        requestOriginUrl: result.responseOrigin || result.url,
        crossOrigin: isCrossOriginRequest(result.responseOrigin || result.url, result.requestHeaders?.origin || ""),
      });
    const isForbiddenStudioBrain = hasMatch(result.url || "", FORBIDDEN_URL_PATTERNS);
    const isAuthFailure = result.isAuthFailure === true;
    const isAuthAllowed = Boolean(result.allowAuthFailure) && isAuthFailure && !runtime.authenticated;
    const isStudioBrainReadyz = isReadyzPath(result.path);
    const isCriticalFailure = !result.ok && !result.skipped && !isAuthAllowed && !isExpectedStudioBrainLoopback;
    const isServerFailure = (result.status !== null && result.status >= 500) || false;

    if (result.skipped) {
      summary.notes.push(`Skipped probe ${result.label}: ${result.fetchError}`);
      continue;
    }

    if (isCors) {
      if (isExpectedStudioBrainLoopback) {
        summary.network.runtimeWarnings.push({
          text: `Expected Studio Brain loopback/readyz request failed CORS gate: ${result.url}`,
          type: "runtime",
          location: result.url,
          timestamp: new Date().toISOString(),
        });
      } else {
        appendUnique(summary.network.corsFailures, {
          url: result.url,
          method: result.method,
          status: result.status || 0,
          resourceType: "fetch",
          errorText: result.fetchError || result.responseText || `${result.status || ""} ${result.statusText || ""}`.trim(),
          timestamp: new Date().toISOString(),
        }, ["url", "method", "status"]);
        appendUnique(summary.network.corsWarnings, {
          text: `endpoint probe "${result.label}" failed: ${result.fetchError || result.responseText || `${result.status || ""} ${result.statusText || ""}`.trim()}`,
          type: "error",
          timestamp: new Date().toISOString(),
          location: result.url,
        }, ["text", "url", "method"]);
      }
    }

    if (isForbiddenStudioBrain) {
      if (isExpectedStudioBrainLoopback) {
        continue;
      }
      appendUnique(summary.network.criticalRequestFailures, {
        url: result.url,
        status: result.status || 0,
        method: result.method,
        resourceType: "fetch",
        errorText: `studio-brain probe targeted forbidden URL: ${result.url}`,
        timestamp: new Date().toISOString(),
      }, ["url", "method"]);
    }

    if ((isCors || isForbiddenStudioBrain || isCriticalFailure) && !isExpectedStudioBrainLoopback) {
      summary.network.criticalRequestFailures.push({
        url: result.url,
        method: result.method,
        resourceType: "fetch",
        errorText: result.fetchError || `${result.status} ${result.statusText}`,
        timestamp: new Date().toISOString(),
      });
    }

    if (isServerFailure) {
      if (!isExpectedStudioBrainLoopback) {
        summary.network.criticalResponseWarnings.push({
          url: result.url,
          status: result.status || 0,
          method: result.method,
          resourceType: "fetch",
          isAuthFailure,
          isReadyzFailure: isStudioBrainReadyz && (result.status ?? 0) >= 400,
          responseHeaders: {
            "content-type": result.responseContentType || "",
            "access-control-allow-origin": result.accessControlAllowOrigin || "",
          },
          ok: result.ok,
          timestamp: new Date().toISOString(),
        });
      }
    }

    if (!result.ok && !isExpectedStudioBrainLoopback) {
      summary.network.responseWarnings.push({
        url: result.url,
        status: result.status || 0,
        method: result.method,
        resourceType: "fetch",
        isAuthFailure,
        isReadyzFailure: isStudioBrainReadyz && (result.status ?? 0) >= 400,
        responseHeaders: {
          "content-type": result.responseContentType || "",
          "access-control-allow-origin": result.accessControlAllowOrigin || "",
        },
        ok: result.ok,
        timestamp: new Date().toISOString(),
      });
    }

    if (isStudioBrainReadyz && (result.status ?? 0) >= 400 && !isExpectedStudioBrainLoopback) {
      summary.network.readyzFailures.push({
        url: result.url,
        method: result.method,
        resourceType: "fetch",
        status: result.status,
        ok: result.ok,
        timestamp: new Date().toISOString(),
        details: `studio-brain readyz probe failed with HTTP ${result.status || "n/a"}`,
      });
    }

    if (result.fetchError) {
      summary.network.requestFailures.push({
        url: result.url,
        method: result.method,
        resourceType: "fetch",
        errorText: result.fetchError,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return results;
};

const parseOptions = (argv) => {
  const options = {
    baseUrl: normalizeBaseUrl(process.env.PORTAL_URL || "") || DEFAULT_BASE_URL,
    outputDir: process.env.PORTAL_OUTPUT_DIR ? resolve(process.cwd(), process.env.PORTAL_OUTPUT_DIR) : defaultOutputRoot,
    staffEmail: process.env.PORTAL_STAFF_EMAIL || "",
    staffPassword: process.env.PORTAL_STAFF_PASSWORD || "",
    requireAuth: normalizeBoolean(process.env.PORTAL_SMOKE_REQUIRE_AUTH, false),
    withAuth: normalizeBoolean(process.env.PORTAL_SMOKE_WITH_AUTH, false),
    deep: normalizeBoolean(process.env.PORTAL_SMOKE_DEEP, false),
    functionsBaseUrl: normalizeFunctionsBaseUrl(
      process.env.PORTAL_FUNCTIONS_BASE_URL || "",
      parseFunctionsBaseFromPageHost(process.env.PORTAL_URL || DEFAULT_BASE_URL)
    ),
    studioBrainBaseUrl: normalizeBaseUrl(process.env.PORTAL_STUDIO_BRAIN_BASE_URL || "") || "",
    probeBearerToken: process.env.PORTAL_SMOKE_PROBE_BEARER_TOKEN || "",
    probeAdminToken: process.env.PORTAL_SMOKE_PROBE_ADMIN_TOKEN || "",
    probeCredentialMode: normalizeProbeCredentialMode(
      process.env.PORTAL_SMOKE_PROBE_CREDENTIAL_MODE || "",
      DEFAULT_PROBE_CREDENTIAL_MODE
    ),
    runMobile: normalizeBoolean(process.env.PORTAL_SMOKE_MOBILE, true),
    headless: normalizeBoolean(process.env.PORTAL_SMOKE_HEADLESS, true),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--base-url") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --base-url");
      options.baseUrl = normalizeBaseUrl(next);
      if (!options.baseUrl) throw new Error("Invalid --base-url value");
      i += 1;
      continue;
    }

    if (arg === "--output-dir") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --output-dir");
      options.outputDir = resolve(process.cwd(), next);
      i += 1;
      continue;
    }

    if (arg === "--staff-email") {
      options.staffEmail = argv[i + 1] || "";
      i += 1;
      continue;
    }

    if (arg === "--staff-password") {
      options.staffPassword = argv[i + 1] || "";
      i += 1;
      continue;
    }

    if (arg === "--require-auth") {
      options.requireAuth = true;
      options.withAuth = true;
      continue;
    }

    if (arg === "--with-auth") {
      options.withAuth = true;
      continue;
    }

    if (arg === "--deep") {
      options.deep = true;
      continue;
    }

    if (arg === "--functions-base-url") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --functions-base-url");
      options.functionsBaseUrl = normalizeFunctionsBaseUrl(next);
      i += 1;
      continue;
    }

    if (arg === "--studio-brain-base-url") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --studio-brain-base-url");
      options.studioBrainBaseUrl = normalizeBaseUrl(next);
      i += 1;
      continue;
    }

    if (arg === "--probe-bearer") {
      options.probeBearerToken = argv[i + 1] || "";
      i += 1;
      continue;
    }

    if (arg === "--probe-admin-token") {
      options.probeAdminToken = argv[i + 1] || "";
      i += 1;
      continue;
    }

    if (arg === "--probe-credential-mode" || arg === "--probe-credentials") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for --probe-credential-mode");
      }
      options.probeCredentialMode = normalizeProbeCredentialMode(next);
      i += 1;
      continue;
    }

    if (arg === "--no-mobile") {
      options.runMobile = false;
      continue;
    }

    if (arg === "--show") {
      options.headless = false;
      continue;
    }
  }

  return options;
};

const hasMatch = (value, patterns) => patterns.some((pattern) => pattern.test(value));

const toSafeText = (value) => {
  if (!value) return "";
  return typeof value === "string" ? value.slice(0, 2000) : String(value);
};

const regexSafe = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const createSummary = (options) => ({
  status: "running",
  startedAt: new Date().toISOString(),
  baseUrl: options.baseUrl,
  baseUrlIsLocal: isLocalTarget(options.baseUrl || ""),
  probeCredentialMode: options.probeCredentialMode || DEFAULT_PROBE_CREDENTIAL_MODE,
  checks: [],
  network: {
    detectedStudioBrainBaseUrls: [],
    forbiddenRequests: [],
    requestFailures: [],
    criticalRequestFailures: [],
    criticalResponseWarnings: [],
    responseWarnings: [],
    readyzFailures: [],
    endpointProbes: [],
    corsFailures: [],
    corsWarnings: [],
    preflightRequests: [],
    runtimeWarnings: [],
    authPopupWarnings: [],
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
  },
  screenshots: [],
  notes: [],
  failures: [],
});

const assert = (condition, message, summary, label) => {
  if (condition) return;
  summary.failures.push(message);
  summary.checks.push({ label, status: "failed", error: message });
  throw new Error(message);
};

const check = async (summary, label, fn) => {
  try {
    await fn();
    summary.checks.push({ label, status: "passed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    summary.checks.push({ label, status: "failed", error: message });
    throw error;
  }
};

const withRequestInstrumentation = (page, summary, runtime = { authenticated: false, enforceLocalhostPolicy: true }) => {
  const isProduction = runtime.enforceLocalhostPolicy && !summary.baseUrlIsLocal;
  const localTarget = summary.baseUrlIsLocal;
  const allowLocalLoopbackReadyz = !runtime.enforceLocalhostPolicy;
  const isPotentialCorsProbe = (request) =>
    request.method() === "OPTIONS" || hasMatch(request.url(), READYZ_PATTERNS);

  const isExpectedLoopbackReadyzRequest = (url) =>
    isExpectedLoopbackReadyzFailure(url, {
      allowLocalLoopback: allowLocalLoopbackReadyz,
      isProduction,
    });
  const isCriticalRequestFailure = (url) =>
    isProduction &&
    !isExpectedLoopbackReadyzRequest(url) &&
    (hasMatch(url, FORBIDDEN_URL_PATTERNS) || hasMatch(url, CRITICAL_SERVICE_PATTERNS) || isCriticalFunctionCall(url));

  const isReadyzRequest = (url) => hasMatch(url, READYZ_PATTERNS);

  page.on("request", (request) => {
    const url = request.url();
    const method = request.method();
    const requestHeaders = request.headers();
    const isCorsProbe = isPotentialCorsProbe(request);
    const isReadyz = isReadyzRequest(url);
    const isExpectedLoopbackReadyz = isExpectedLoopbackReadyzFailure(url, {
      allowLocalLoopback: allowLocalLoopbackReadyz,
      isProduction,
    });
    const isForbiddenStudioBrain = isProduction && hasMatch(url, FORBIDDEN_URL_PATTERNS);
    if (isPotentialCorsProbe(request) && isProduction && isCriticalRequestFailure(url)) {
      summary.network.preflightRequests.push({
        url,
        method,
        resourceType: request.resourceType(),
        originHeader: requestHeaders.origin || "",
        requestMethodHeader: requestHeaders["access-control-request-method"] || "",
        requestHeadersHeader: requestHeaders["access-control-request-headers"] || "",
        secFetchMode: requestHeaders["sec-fetch-mode"] || "",
        timestamp: new Date().toISOString(),
      });
    }

    if (isReadyz) {
      const metadata = readReadyzRequestHost(url);
      if (metadata.origin && !runtime.detectedStudioBrainBaseUrl && metadata.pathname) {
        // Keep the first observed readyz-like origin to support deep studio-brain probing.
        runtime.detectedStudioBrainBaseUrl = metadata.origin;
        runtime.detectedStudioBrainHost = metadata.host;
        runtime.detectedStudioBrainPath = metadata.pathname;
        summary.network.detectedStudioBrainBaseUrls.push({
          origin: metadata.origin,
          host: metadata.host,
          path: metadata.pathname,
          url,
          timestamp: new Date().toISOString(),
        });
      }
    }

    if (isProduction && hasMatch(url, FORBIDDEN_URL_PATTERNS) && !isExpectedLoopbackReadyz) {
      summary.network.forbiddenRequests.push({
        url,
        method: request.method(),
        resourceType: request.resourceType(),
        timestamp: new Date().toISOString(),
      });

      summary.network.criticalRequestFailures.push({
        url,
        status: 0,
        method,
        resourceType: request.resourceType(),
        errorText: "Blocked production request to localhost/127.0.0.1 backend.",
        timestamp: new Date().toISOString(),
      });
    }

    if (isForbiddenStudioBrain) {
      summary.network.runtimeWarnings.push({
        text: `Studio Brain/client runtime reached forbidden host: ${url}`,
        type: "runtime",
        location: method,
        timestamp: new Date().toISOString(),
      });
    }

    if (isExpectedLoopbackReadyz) {
      summary.network.runtimeWarnings.push({
        text: `Studio Brain readyz fallback target resolved to localhost from production page: ${url}`,
        type: "runtime",
        location: method,
        timestamp: new Date().toISOString(),
      });
    }

    if (isReadyz && localTarget) {
      summary.network.readyzFailures.push({
        url,
        method: request.method(),
        resourceType: request.resourceType(),
        event: "request",
        timestamp: new Date().toISOString(),
        details: `readyz call was made against local target (${url}).`,
      });
    }
  });

  page.on("requestfailed", (request) => {
    const failure = request.failure();
    const errorText = toSafeText(failure?.errorText);
    const url = request.url();
    const method = request.method();
    const resourceType = request.resourceType();
    const timestamp = new Date().toISOString();
    const isCors = hasMatch(errorText, CORS_ERROR_TOKENS);
    const isCorsProbe = isPotentialCorsProbe(request);
    const isExpectedLoopbackReadyz = isExpectedLoopbackReadyzFailure(url, {
      allowLocalLoopback: allowLocalLoopbackReadyz,
      isProduction,
    });

    const entry = {
      url,
      method,
      resourceType,
      errorText,
      timestamp,
    };

    if (isCors && !isExpectedLoopbackReadyz && isCriticalRequestFailure(url)) {
      summary.network.corsFailures.push(entry);
    }

    if (isReadyzRequest(url)) {
      summary.network.readyzFailures.push({
        ...entry,
        event: "request-failed",
        details: `readyz request failed in browser transport: ${errorText || "unknown error"}`,
      });
    }

    if (isCors && !isExpectedLoopbackReadyz) {
      summary.network.corsWarnings.push({
        text: errorText,
        url,
        method,
        resourceType,
        timestamp,
      });
    }

    if (isCorsProbe && isCriticalRequestFailure(url)) {
      summary.network.preflightRequests.push({
        url,
        method,
        resourceType,
        event: "request-failed",
        errorText,
        timestamp,
      });
    }

    if (isProduction && (isCors || isCriticalRequestFailure(url)) && !isExpectedLoopbackReadyz) {
      summary.network.criticalRequestFailures.push(entry);
    }

    if (isExpectedLoopbackReadyz && isReadyzRequest(url)) {
      return;
    }

    summary.network.requestFailures.push(entry);
  });

  page.on("response", (response) => {
    const request = response.request();
    const url = response.url();
    const status = response.status();
    const requestMethod = request.method();
    const responseHeaders = response.headers();
    const requestHeaders = request.headers();
    const isCorsProbe = isPotentialCorsProbe(request);
    const requestOrigin = requestHeaders.origin || "";
    const responseOrigin = (() => {
      try {
        return new URL(url).origin;
      } catch {
        return "";
      }
    })();
    const isCorsHeaderMissing = missingAllowOriginHeader(
      requestOrigin,
      responseHeaders["access-control-allow-origin"] || "",
      isCrossOriginRequest(responseOrigin, requestOrigin)
    );
    const isExpectedLoopbackReadyz = isExpectedLoopbackReadyzFailure(url, {
      allowLocalLoopback: allowLocalLoopbackReadyz,
      isProduction,
    });

    if (isCorsProbe || isCriticalRequestFailure(url)) {
      const accessControlAllowOrigin = responseHeaders["access-control-allow-origin"] || "";
      const isCors = !isExpectedLoopbackReadyz && (
        hasMatch(`${requestOrigin}${response.statusText}`, CORS_RESPONSE_TOKENS)
        || isCorsResponseFailure({
          method: requestMethod,
          status,
          text: "",
          requestOrigin,
          allowOriginHeader: accessControlAllowOrigin,
          requestOriginUrl: url,
          crossOrigin: isCrossOriginRequest(responseOrigin, requestOrigin),
        })
      );

      if (isCors) {
        appendUnique(summary.network.corsFailures, {
          url,
          method: requestMethod,
          status,
          resourceType: request.resourceType(),
          errorText: `CORS response metadata indicates browser policy mismatch (status ${status}).`,
          timestamp: new Date().toISOString(),
        }, ["url", "method", "status"]);
      }
    }

    if (isCorsHeaderMissing && isExpectedLoopbackReadyz) {
      summary.network.runtimeWarnings.push({
        text: `Expected loopback readyz CORS header gap observed for ${url}`,
        type: "runtime",
        location: url,
        timestamp: new Date().toISOString(),
      });
    }

    if (isCorsHeaderMissing && isCriticalRequestFailure(url) && !isExpectedLoopbackReadyz) {
      appendUnique(summary.network.corsFailures, {
        url,
        method: requestMethod,
        status,
        resourceType: request.resourceType(),
        errorText: "Missing Access-Control-Allow-Origin header on cross-origin response.",
        timestamp: new Date().toISOString(),
      }, ["url", "method", "status"]);
      appendUnique(summary.network.corsWarnings, {
        text: `Cross-origin response without Access-Control-Allow-Origin from ${url}`,
        location: url,
        type: "error",
        timestamp: new Date().toISOString(),
      }, ["url", "text"]);
    }

    if (!isCriticalRequestFailure(url) || status < 400 || isExpectedLoopbackReadyz) {
      if (isCorsProbe) {
        summary.network.preflightRequests.push({
          url,
          method: requestMethod,
          resourceType: request.resourceType(),
          status,
          event: "response",
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

    const isAuthFailure = status === 401 || status === 403;
    const entry = {
      url,
      status,
      method: requestMethod,
      resourceType: request.resourceType(),
      ok: response.ok(),
      isAuthFailure,
      isReadyzFailure: isReadyzRequest(url) && status >= 400,
      responseHeaders: {
        "content-type": responseHeaders["content-type"] || "",
        "access-control-allow-origin": responseHeaders["access-control-allow-origin"] || "",
      },
      timestamp: new Date().toISOString(),
    };

    if (isReadyzRequest(url) && !entry.ok && !isExpectedLoopbackReadyz) {
      summary.network.readyzFailures.push({
        url,
        method: request.method(),
        resourceType: request.resourceType(),
        status,
        ok: response.ok(),
        timestamp: new Date().toISOString(),
        details: `readyz request returned HTTP ${status}.`,
      });
    }

    if (isAuthFailure && shouldIgnoreAuthFailure(url) && !runtime.authenticated) {
      summary.network.responseWarnings.push(entry);
      return;
    }

    if (status >= 500 && !isExpectedLoopbackReadyz) {
      summary.network.criticalResponseWarnings.push(entry);
      return;
    }

    if (!isExpectedLoopbackReadyz) {
      summary.network.responseWarnings.push(entry);
    }
  });

  page.on("console", (message) => {
    const text = toSafeText(message.text());
    if (!text) return;

    if (hasMatch(text, COOP_WARNING_TOKENS)) {
      summary.network.authPopupWarnings.push({
        text,
        type: message.type(),
        location: toSafeText(message.location()),
        timestamp: new Date().toISOString(),
      });
    }

    if (hasMatch(text, CORS_ERROR_TOKENS)) {
      summary.network.corsWarnings.push({
        text,
        type: message.type(),
        location: toSafeText(message.location()),
        timestamp: new Date().toISOString(),
      });
    }

    if (hasMatch(text, FIRESTORE_NOISE)) {
      summary.network.runtimeWarnings.push({
        text,
        type: message.type(),
        location: toSafeText(message.location()),
        timestamp: new Date().toISOString(),
      });
    }

    if (message.type() === "error" && !hasMatch(text, PAGE_NOISE_TOKENS)) {
      summary.network.consoleErrors.push({
        text,
        type: message.type(),
        location: toSafeText(message.location()),
        timestamp: new Date().toISOString(),
      });
    }

    if (message.type() === "warning") {
      summary.network.consoleWarnings.push({
        text,
        type: message.type(),
        location: toSafeText(message.location()),
        timestamp: new Date().toISOString(),
      });
    }
  });

  page.on("pageerror", (error) => {
    const text = toSafeText(error?.message ?? String(error));
    if (hasMatch(text, PAGE_NOISE_TOKENS)) {
      summary.network.consoleWarnings.push({
        text,
        timestamp: new Date().toISOString(),
      });
      summary.network.runtimeWarnings.push({
        text,
        type: "runtime",
        location: "pageerror",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    summary.network.pageErrors.push({
      text,
      timestamp: new Date().toISOString(),
    });
  });
};

const isAllowedConsoleIssue = (text) => PAGE_NOISE_TOKENS.some((pattern) => pattern.test(text));

const clickNavItem = async (page, label, summaryLabel = label, required = false) => {
  const button = page.getByRole("button", { name: new RegExp(`^${regexSafe(label)}$`, "i") }).first();
  const count = await button.count();
  if (count === 0) {
    if (!required) {
      return false;
    }
    throw new Error(`${summaryLabel} nav item not available.`);
  }

  await button.click({ timeout: 12000 });
  await page.waitForTimeout(600);
  return true;
};

const waitForAuthReady = async (page) => {
  const signOut = page.getByRole("button", { name: /^Sign out$/i }).first();
  const signedOutCard = page.locator(".signed-out-card");

  await Promise.race([
    signOut.waitFor({ timeout: 30000 }),
    signedOutCard.waitFor({ timeout: 30000 }),
  ]);

  const isSignedOut = await signedOutCard.count();
  return isSignedOut > 0;
};

const signInWithEmail = async (page, email, password, summary) => {
  if (!email || !password) {
    return { status: "skipped", reason: "missing credentials" };
  }

  await check(summary, "email-login UI exists", async () => {
    const signedOutCard = page.locator(".signed-out-card");
    await signedOutCard.waitFor({ timeout: 30000 });

    const emailInput = signedOutCard.locator("input[type='email']").first();
    const passwordInput = signedOutCard.locator("input[type='password']").first();
    const submit = signedOutCard.getByRole("button", { name: /^Sign in$/i });

    await emailInput.waitFor({ timeout: 10000 });
    await emailInput.fill(email);
    await passwordInput.fill(password);
    await submit.click();

    await page.waitForTimeout(1200);

    const beforeAuth = await waitForAuthReady(page);
    if (!beforeAuth) {
      return;
    }

    const signedOutError = await signedOutCard.locator(".signed-out-status").first();
    const hasError = await signedOutError.count();
    if (hasError > 0) {
      const message = (await signedOutError.textContent())?.trim() || "sign in failed";
      throw new Error(`Sign in blocked: ${message}`);
    }

    throw new Error("Sign in did not transition to authenticated shell");
  });

  const nowSignedOut = await waitForAuthReady(page);
  if (nowSignedOut) {
    throw new Error("Sign in failed, user remains signed out.");
  }

  return { status: "signed-in" };
};

const takeScreenshot = async (page, outputDir, fileName, summary, label) => {
  const path = resolve(outputDir, fileName);
  await page.screenshot({ path, fullPage: true });
  summary.screenshots.push({ label, path });
};

const run = async () => {
  const options = parseOptions(process.argv.slice(2));
  const summary = createSummary(options);

  if (!options.baseUrl) {
    throw new Error("Missing base URL.");
  }

  if ((options.requireAuth || options.withAuth) && (!options.staffEmail || !options.staffPassword)) {
    throw new Error("--require-auth or --with-auth requested but staff credentials are not provided.");
  }

  await ensureDir(options.outputDir);
  const summaryPath = resolve(options.outputDir, "portal-smoke-summary.json");

  const desktopRuntime = {
    authenticated: false,
    enforceLocalhostPolicy: !summary.baseUrlIsLocal,
    detectedStudioBrainBaseUrl: "",
    detectedStudioBrainHost: "",
    detectedStudioBrainPath: "",
  };

  const browser = await chromium.launch({ headless: options.headless });

  try {
    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: "MonsoonFirePortalPlaywright/1.0",
    });
    const desktopPage = await desktopContext.newPage();
    withRequestInstrumentation(desktopPage, summary, desktopRuntime);

    await check(summary, "base URL reachable", async () => {
      await desktopPage.goto(options.baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await desktopPage.waitForTimeout(800);
      await takeScreenshot(desktopPage, options.outputDir, "portal-01-home-desktop.png", summary, "desktop home");
    });

    if (desktopRuntime.detectedStudioBrainBaseUrl) {
      summary.notes.push(`Detected studio-brain readyz target from page traffic: ${desktopRuntime.detectedStudioBrainBaseUrl}`);
      if (!options.studioBrainBaseUrl) {
        options.studioBrainBaseUrl = desktopRuntime.detectedStudioBrainBaseUrl;
      }
    }

    const isSignedOut = await waitForAuthReady(desktopPage);

    if (isSignedOut) {
      summary.checks.push({
        label: "auth state (public user)",
        status: "passed",
        details: "Portal loaded in signed-out mode.",
      });

      if (options.withAuth || options.requireAuth) {
        await check(summary, "sign-in attempt", async () => {
          await signInWithEmail(
            desktopPage,
            options.staffEmail,
            options.staffPassword,
            summary
          );
        });
        desktopRuntime.authenticated = true;
      }
    } else {
      summary.checks.push({
        label: "auth state (signed in)",
        status: "passed",
        details: "Portal loaded already signed in.",
      });
      desktopRuntime.authenticated = true;
    }

    const afterAuthSignedOut = await waitForAuthReady(desktopPage);

    if (!afterAuthSignedOut) {
      await check(summary, "sidebar renders", async () => {
        const sidebar = desktopPage.locator("#portal-sidebar-nav");
        await sidebar.waitFor({ timeout: 30000 });
      });

      await check(summary, "dashboard renders", async () => {
        await clickNavItem(desktopPage, "Dashboard", "Dashboard", false);
        await takeScreenshot(desktopPage, options.outputDir, "portal-02-dashboard-desktop.png", summary, "desktop dashboard");
      });

      const houseAvailable = await clickNavItem(desktopPage, "House", "House", false);
      if (houseAvailable) {
        await check(summary, "house renders", async () => {
          const heading = desktopPage.locator(".card-title", { hasText: "House" }).first();
          await heading.waitFor({ timeout: 30000 });
          await takeScreenshot(desktopPage, options.outputDir, "portal-03-house-desktop.png", summary, "desktop house");
        });
      }

      const staffAvailable = await clickNavItem(desktopPage, "Staff", "Staff", false);
      if (staffAvailable) {
        await check(summary, "staff renders", async () => {
          const staffHeading = desktopPage.getByRole("heading", { name: /^Staff Console$/i }).first();
          await staffHeading.waitFor({ timeout: 30000 });
          await takeScreenshot(desktopPage, options.outputDir, "portal-04-staff-desktop.png", summary, "desktop staff");
        });
      }

      await check(summary, "messages renders", async () => {
        await clickNavItem(desktopPage, "Messages", "Messages", false);
        await takeScreenshot(desktopPage, options.outputDir, "portal-05-messages-desktop.png", summary, "desktop messages");
      });

      await check(summary, "support renders", async () => {
        await clickNavItem(desktopPage, "Support", "Support", false);
        await takeScreenshot(desktopPage, options.outputDir, "portal-06-support-desktop.png", summary, "desktop support");
      });
    }

    if (options.deep) {
      if (!options.studioBrainBaseUrl && !desktopRuntime.detectedStudioBrainBaseUrl) {
        summary.network.runtimeWarnings.push({
          text: "Deep mode could not infer or resolve a studio-brain base URL; /readyz probe may be skipped.",
          type: "runtime",
          location: "deep-mode",
          timestamp: new Date().toISOString(),
        });
        summary.notes.push("Studio Brain base URL not resolved for deep probe mode.");
      }

      await check(summary, "deep endpoint probes", async () => {
        await runEndpointProbes(desktopPage, summary, options, desktopRuntime);
      });

      const staffAvailable = await clickNavItem(desktopPage, "Staff", "Staff", false);
      if (staffAvailable) {
        await check(summary, "staff view renders in deep mode", async () => {
          const staffHeading = desktopPage.getByRole("heading", { name: /^Staff Console$/i }).first();
          await staffHeading.waitFor({ timeout: 30000 });
          await takeScreenshot(desktopPage, options.outputDir, "portal-07-staff-deep.png", summary, "deep staff");
        });
      }

      const houseAvailable = await clickNavItem(desktopPage, "House", "House", false);
      if (houseAvailable) {
        await takeScreenshot(desktopPage, options.outputDir, "portal-08-house-deep.png", summary, "deep house");
      }
    }

    if (options.runMobile) {
      const mobileContext = await browser.newContext({
        viewport: { width: 390, height: 844 },
        userAgent: "MonsoonFirePortalPlaywrightMobile/1.0",
      });
      const mobilePage = await mobileContext.newPage();
      withRequestInstrumentation(mobilePage, summary, {
        ...desktopRuntime,
      });

      await check(summary, "mobile home", async () => {
        await mobilePage.goto(options.baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await mobilePage.waitForTimeout(900);
        await takeScreenshot(mobilePage, options.outputDir, "portal-10-home-mobile.png", summary, "mobile home");
      });

      const mobileSignedOut = await waitForAuthReady(mobilePage);
      if (!mobileSignedOut) {
        await check(summary, "mobile nav interactions", async () => {
          const homeButton = mobilePage.locator("[aria-label='Go to dashboard'], .brand-home").first();
          await homeButton.click({ timeout: 10000 });
          await mobilePage.waitForTimeout(500);
          await takeScreenshot(mobilePage, options.outputDir, "portal-11-mobile-dashboard.png", summary, "mobile dashboard");
        });
      }

      await mobileContext.close();
    }

    const isCriticalFailure =
      summary.network.forbiddenRequests.length > 0 ||
      summary.network.criticalRequestFailures.length > 0 ||
      summary.network.corsFailures.length > 0 ||
      summary.network.criticalResponseWarnings.length > 0 ||
      summary.network.readyzFailures.length > 0 ||
      summary.network.endpointProbes.some((probe) => {
        if (probe.skipped) return false;
        if (!probe.ok && probe.isAuthFailure && Boolean(probe.allowAuthFailure) && !desktopRuntime.authenticated) return false;
        return !probe.ok;
      }) ||
      summary.network.responseWarnings.some((item) => {
        if (item.isAuthFailure && !desktopRuntime.authenticated) {
          return false;
        }
        return item.status >= 400;
      });

    if (isCriticalFailure) {
      summary.status = "failed";
      const errors = [];
      if (summary.network.forbiddenRequests.length > 0) {
        errors.push(`forbidden requests: ${summary.network.forbiddenRequests.length}`);
      }
      if (summary.network.criticalRequestFailures.length > 0) {
        errors.push(`critical request failures: ${summary.network.criticalRequestFailures.length}`);
      }
      if (summary.network.corsFailures.length > 0) {
        errors.push(`CORS/bridge failures: ${summary.network.corsFailures.length}`);
      }
    if (summary.network.readyzFailures.length > 0) {
        errors.push(`readyz failures: ${summary.network.readyzFailures.length}`);
      }
      if (summary.network.criticalResponseWarnings.length > 0) {
        errors.push(`critical response failures: ${summary.network.criticalResponseWarnings.length}`);
      }
      if (summary.network.responseWarnings.length > 0 && !desktopRuntime.authenticated) {
        const authOnly = summary.network.responseWarnings.filter((item) => item.isAuthFailure).length;
        const actionable = summary.network.responseWarnings.filter((item) => !item.isAuthFailure).length;
        if (actionable > 0) {
          errors.push(`response warnings: ${actionable}`);
        }
        if (authOnly > 0) {
          summary.notes.push(`Observed ${authOnly} auth-gated function responses while unauthenticated.`);
        }
      } else if (summary.network.responseWarnings.length > 0) {
        errors.push(`response warnings: ${summary.network.responseWarnings.length}`);
      }
      summary.failures.push(...errors);
      assert(false, `Portal deep smoke failed: ${errors.join(", ")}`, summary, "overall");
    }

    summary.status = "passed";
    console.log("Portal Playwright smoke passed");
  } catch (error) {
    summary.status = "failed";
    summary.failures.push(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    summary.finishedAt = new Date().toISOString();
    summary.network.consoleWarnings = summary.network.consoleWarnings.filter((entry) => !isAllowedConsoleIssue(entry.text || ""));
    summary.network.consoleErrors = summary.network.consoleErrors.filter((entry) => !isAllowedConsoleIssue(entry.text || ""));
    if (summary.notes.length === 0) {
      const failedDeepProbes = summary.network.endpointProbes.filter((probe) => {
        if (probe.skipped) return false;
        if (!probe.ok && probe.isAuthFailure && Boolean(probe.allowAuthFailure) && !desktopRuntime.authenticated) return false;
        return !probe.ok;
      });

      if (options?.deep && summary.network.endpointProbes.length > 0) {
        summary.notes.push(`Deep endpoint probe mode executed: ${summary.network.endpointProbes.length} probes.`);
      }

      if (failedDeepProbes.length > 0) {
        summary.notes.push(`Deep endpoint probe failures: ${failedDeepProbes.length}`);
      }

      if (summary.network.forbiddenRequests.length > 0) {
        summary.notes.push("Forbidden localhost requests detected. This indicates Studio Brain URL is resolving to local endpoint in production.");
      }
      if (summary.network.corsWarnings.length > 0) {
        summary.notes.push("CORS warnings were observed in console. Review function/API cross-origin headers.");
      }
      if (summary.network.readyzFailures.length > 0) {
        summary.notes.push("readyz failures observed. Verify Studio Brain URL and base URL resolution in production.");
      }
      if (summary.network.authPopupWarnings.length > 0) {
        summary.notes.push(
          "Auth popup warnings were observed (Cross-Origin-Opener-Policy). This is expected if OAuth popup flow is exercised in browser."
        );
      }
      if (summary.network.runtimeWarnings.length > 0) {
        const firestoreWarnings = summary.network.runtimeWarnings.filter((entry) =>
          hasMatch(entry.text || "", FIRESTORE_NOISE)
        );
        if (firestoreWarnings.length > 0) {
          summary.notes.push(`Firestore runtime connectivity warnings observed (${firestoreWarnings.length}).`);
        }
      }
      if (summary.network.responseWarnings.length > 0) {
        summary.notes.push("Some endpoint calls returned authorization errors without session auth; expected for staff-only routes while unsigned-in.");
      }
    }
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    await browser.close();
  }
};

run().catch(async (error) => {
  console.error(`Portal smoke failed: ${error?.message || String(error)}`);
  process.exit(1);
});
