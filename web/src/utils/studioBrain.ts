type ImportMetaStudioBrainEnv = { VITE_STUDIO_BRAIN_BASE_URL?: string };
type ImportMetaEnv = ImportMetaStudioBrainEnv;

const STUDIO_BRAIN_ENV = (import.meta.env ?? {}) as ImportMetaEnv;
const LOCAL_STUDIO_BRAIN_PORT = 8787;
const LOCAL_LOOPBACK_IPv6 = "[::1]";

type ResolveStudioBrainOptions = {
  configuredBaseUrl?: string;
  browserHostname?: string;
};

const LOCAL_LOOPBACK_HOST = String.fromCharCode(49, 50, 55, 46, 48, 46, 48, 46, 49);

export type StudioBrainResolution = {
  baseUrl: string;
  configured: boolean;
  enabled: boolean;
  reason: string;
};

const BASE_URL_NOT_CONFIGURED_REASON = "Studio Brain base URL is not configured.";

export function trimRightSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isLocalHostName(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === LOCAL_LOOPBACK_IPv6;
}

function parseStudioBrainHostname(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const normalizedValue = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const hostname = new URL(normalizedValue).hostname.toLowerCase();
    return hostname === "[::1]" ? "::1" : hostname;
  } catch {
    return "";
  }
}

function normalizeStudioBrainUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalizedValue = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    return trimRightSlash(new URL(normalizedValue).toString());
  } catch {
    return "";
  }
}

function resolveBrowserHostname(override?: string): string {
  if (typeof override === "string" && override.trim()) {
    return override.trim().toLowerCase();
  }
  if (typeof window === "undefined") return "";
  return window.location.hostname.toLowerCase();
}

function isBrowserLocalHost(browserHostname?: string): boolean {
  const hostname = resolveBrowserHostname(browserHostname);
  return isLocalHostName(hostname);
}

function resolveLocalStudioBrainHost(browserHostname?: string): string {
  const hostname = resolveBrowserHostname(browserHostname);
  if (!isLocalHostName(hostname)) {
    return "";
  }

  if (hostname === "localhost") {
    return LOCAL_LOOPBACK_HOST;
  }
  if (hostname === "::1") {
    return LOCAL_LOOPBACK_IPv6;
  }

  return hostname;
}

function resolveLocalStudioBrainBaseUrl(browserHostname?: string): string {
  const host = resolveLocalStudioBrainHost(browserHostname);
  return host ? `http://${host}:${LOCAL_STUDIO_BRAIN_PORT}` : "";
}

function isLocalStudioBrainUrl(value: string): boolean {
  const hostname = parseStudioBrainHostname(value);
  if (!hostname) return false;
  return isLocalHostName(hostname);
}

export function isStudioBrainUrlAllowedForBrowser(baseUrl: string, browserHostname?: string): boolean {
  const hostname = parseStudioBrainHostname(baseUrl);
  if (!hostname) {
    return false;
  }

  if (isBrowserLocalHost(browserHostname)) {
    return true;
  }

  return !isLocalHostName(hostname);
}

export function studioBrainUrlBlockReason(baseUrl: string, browserHostname?: string): string {
  if (!baseUrl) return BASE_URL_NOT_CONFIGURED_REASON;
  const hostname = parseStudioBrainHostname(baseUrl);
  if (!hostname) return "Studio Brain base URL is invalid.";

  const resolvedBrowserHostname = resolveBrowserHostname(browserHostname);
  if (isBrowserLocalHost(resolvedBrowserHostname)) return "";

  if (isLocalHostName(hostname)) {
    const hostLabel = hostname === LOCAL_LOOPBACK_IPv6 ? "[::1]" : hostname;
    return `Blocked local Studio Brain target (${hostLabel}:8787) on non-localhost deployment host (${resolvedBrowserHostname}).`;
  }

  return "";
}

function isLoopbackConfiguredForProduction(configuredBaseUrl: string, browserHostname?: string): boolean {
  return !isBrowserLocalHost(browserHostname) && isLocalStudioBrainUrl(configuredBaseUrl);
}

function resolveStudioBrainBaseUrlFromContext({
  configuredBaseUrl,
  browserHostname,
}: ResolveStudioBrainOptions = {}): StudioBrainResolution {
  const configured = configuredBaseUrl ?? STUDIO_BRAIN_ENV.VITE_STUDIO_BRAIN_BASE_URL?.trim();
  const browserHost = resolveBrowserHostname(browserHostname);

  if (!configured) {
    const localBaseUrl = resolveLocalStudioBrainBaseUrl(browserHost);
    if (localBaseUrl) {
      return {
        baseUrl: localBaseUrl,
        configured: false,
        enabled: true,
        reason: "",
      };
    }

    return {
      baseUrl: "",
      configured: false,
      enabled: false,
      reason: BASE_URL_NOT_CONFIGURED_REASON,
    };
  }

  const normalized = normalizeStudioBrainUrl(configured);
  if (!normalized) {
    return {
      baseUrl: "",
      configured: true,
      enabled: false,
      reason: "Studio Brain base URL is invalid.",
    };
  }

  if (isLoopbackConfiguredForProduction(normalized, browserHost)) {
    return {
      baseUrl: "",
      configured: true,
      enabled: false,
      reason: studioBrainUrlBlockReason(configured, browserHost),
    };
  }

  return {
    baseUrl: normalized,
    configured: true,
    enabled: true,
    reason: "",
  };
}

export function resolveStudioBrainBaseUrlResolution(options: ResolveStudioBrainOptions = {}): StudioBrainResolution {
  return resolveStudioBrainBaseUrlFromContext(options);
}

export function resolveStudioBrainBaseUrl(): string {
  return resolveStudioBrainBaseUrlWithContext({
    configuredBaseUrl: STUDIO_BRAIN_ENV.VITE_STUDIO_BRAIN_BASE_URL?.trim(),
  });
}

export function resolveStudioBrainBaseUrlWithContext({
  configuredBaseUrl,
  browserHostname,
}: ResolveStudioBrainOptions = {}): string {
  return resolveStudioBrainBaseUrlFromContext({ configuredBaseUrl, browserHostname }).baseUrl;
}
