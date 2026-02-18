const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
const LOCAL_LOOPBACK_IPv6 = "[::1]";

type ImportMetaEnv = { VITE_FUNCTIONS_BASE_URL?: string };
const ENV = (import.meta.env ?? {}) as ImportMetaEnv;

type ResolveFunctionsBaseUrlOptions = {
  configuredBaseUrl?: string;
  browserHostname?: string;
};

export type FunctionsBaseUrlResolution = {
  baseUrl: string;
  configured: boolean;
  enabled: boolean;
  reason: string;
};

const BASE_URL_NOT_CONFIGURED_REASON = "Functions base URL is not configured.";

function isLocalHostName(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === LOCAL_LOOPBACK_IPv6;
}

function parseFunctionsHostname(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalizedValue = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const hostname = new URL(normalizedValue).hostname.toLowerCase();
    return hostname === "[::1]" ? "::1" : hostname;
  } catch {
    return "";
  }
}

function normalizeFunctionsUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalizedValue = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(normalizedValue);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`.replace(/\/+$/, "");
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
  return isLocalHostName(resolveBrowserHostname(browserHostname));
}

function getHostLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalizedValue = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(normalizedValue);
    const hostname = parsed.hostname === "::1" ? "[::1]" : parsed.hostname;
    return parsed.port ? `${hostname}:${parsed.port}` : hostname;
  } catch {
    return trimmed;
  }
}

export function isFunctionsUrlAllowedForBrowser(baseUrl: string, browserHostname?: string): boolean {
  const hostname = parseFunctionsHostname(baseUrl);
  if (!hostname) return false;
  if (isBrowserLocalHost(browserHostname)) return true;
  return !isLocalHostName(hostname);
}

export function functionsBaseUrlBlockReason(baseUrl: string, browserHostname?: string): string {
  if (!baseUrl) return BASE_URL_NOT_CONFIGURED_REASON;
  const normalized = normalizeFunctionsUrl(baseUrl);
  if (!normalized) return "Functions base URL is invalid.";

  const resolvedBrowserHostname = resolveBrowserHostname(browserHostname);
  if (isBrowserLocalHost(resolvedBrowserHostname)) return "";

  const hostname = parseFunctionsHostname(normalized);
  if (isLocalHostName(hostname)) {
    const hostLabel = getHostLabel(normalized);
    return `Blocked local Functions target (${hostLabel}) on non-localhost deployment host (${resolvedBrowserHostname}).`;
  }

  return "";
}

function isLoopbackConfiguredForProduction(configuredBaseUrl: string, browserHostname?: string): boolean {
  return !isBrowserLocalHost(browserHostname) && isLocalHostName(parseFunctionsHostname(configuredBaseUrl));
}

function resolveFunctionsBaseUrlFromContext({ configuredBaseUrl, browserHostname }: ResolveFunctionsBaseUrlOptions = {}): FunctionsBaseUrlResolution {
  const configured = configuredBaseUrl ?? ENV.VITE_FUNCTIONS_BASE_URL?.trim();
  const browserHost = resolveBrowserHostname(browserHostname);

  if (!configured) {
    return {
      baseUrl: DEFAULT_FUNCTIONS_BASE_URL,
      configured: false,
      enabled: true,
      reason: "",
    };
  }

  const normalized = normalizeFunctionsUrl(configured);
  if (!normalized) {
    return {
      baseUrl: "",
      configured: true,
      enabled: false,
      reason: "Functions base URL is invalid.",
    };
  }

  if (isLoopbackConfiguredForProduction(normalized, browserHost)) {
    return {
      baseUrl: "",
      configured: true,
      enabled: false,
      reason: functionsBaseUrlBlockReason(configured, browserHost),
    };
  }

  return {
    baseUrl: normalized,
    configured: true,
    enabled: true,
    reason: "",
  };
}

export function resolveFunctionsBaseUrlResolution(options: ResolveFunctionsBaseUrlOptions = {}): FunctionsBaseUrlResolution {
  return resolveFunctionsBaseUrlFromContext(options);
}

export function resolveFunctionsBaseUrl(): string {
  return resolveFunctionsBaseUrlWithContext({
    configuredBaseUrl: ENV.VITE_FUNCTIONS_BASE_URL?.trim(),
  });
}

export function resolveFunctionsBaseUrlWithContext({
  configuredBaseUrl,
  browserHostname,
}: ResolveFunctionsBaseUrlOptions = {}): string {
  return resolveFunctionsBaseUrlFromContext({ configuredBaseUrl, browserHostname }).baseUrl;
}
