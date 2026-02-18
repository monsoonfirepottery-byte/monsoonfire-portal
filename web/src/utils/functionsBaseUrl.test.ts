import { describe, expect, it } from "vitest";
import {
  functionsBaseUrlBlockReason,
  isFunctionsUrlAllowedForBrowser,
  resolveFunctionsBaseUrlResolution,
  resolveFunctionsBaseUrlWithContext,
} from "./functionsBaseUrl";

describe("functions URL resolution", () => {
  it("defaults to production function host when no override is configured", () => {
    expect(resolveFunctionsBaseUrlWithContext({ browserHostname: "localhost" })).toBe(
      "https://us-central1-monsoonfire-portal.cloudfunctions.net"
    );
    expect(resolveFunctionsBaseUrlWithContext({ browserHostname: "monsoonfire-portal.web.app" })).toBe(
      "https://us-central1-monsoonfire-portal.cloudfunctions.net"
    );
  });

  it("keeps configured localhost URLs in localhost browser context", () => {
    expect(
      resolveFunctionsBaseUrlWithContext({
        configuredBaseUrl: "http://127.0.0.1:5001",
        browserHostname: "localhost",
      })
    ).toBe("http://127.0.0.1:5001");
  });

  it("blocks configured localhost URLs on production browser hosts", () => {
    expect(
      resolveFunctionsBaseUrlWithContext({
        configuredBaseUrl: "http://127.0.0.1:5001",
        browserHostname: "monsoonfire-portal.web.app",
      })
    ).toBe("");
    expect(
      resolveFunctionsBaseUrlWithContext({
        configuredBaseUrl: "localhost:5001",
        browserHostname: "monsoonfire-portal.web.app",
      })
    ).toBe("");
  });
});

describe("resolveFunctionsBaseUrlResolution", () => {
  it("returns default enabled resolution for production and localhost browser contexts", () => {
    const production = resolveFunctionsBaseUrlResolution({ browserHostname: "monsoonfire-portal.web.app" });
    expect(production.configured).toBe(false);
    expect(production.enabled).toBe(true);
    expect(production.baseUrl).toBe("https://us-central1-monsoonfire-portal.cloudfunctions.net");
    expect(production.reason).toBe("");

    const local = resolveFunctionsBaseUrlResolution({ browserHostname: "localhost" });
    expect(local.configured).toBe(false);
    expect(local.enabled).toBe(true);
    expect(local.baseUrl).toBe("https://us-central1-monsoonfire-portal.cloudfunctions.net");
  });

  it("marks configured localhost URLs as blocked on non-localhost hosts", () => {
    const resolution = resolveFunctionsBaseUrlResolution({
      configuredBaseUrl: "http://127.0.0.1:8787",
      browserHostname: "monsoonfire-portal.web.app",
    });
    expect(resolution.configured).toBe(true);
    expect(resolution.enabled).toBe(false);
    expect(resolution.baseUrl).toBe("");
    expect(resolution.reason).toMatch(/Blocked local Functions target/);
  });

  it("keeps malformed configured URLs disabled with explicit reason", () => {
    const resolution = resolveFunctionsBaseUrlResolution({
      configuredBaseUrl: "not a real url",
      browserHostname: "localhost",
    });
    expect(resolution.configured).toBe(true);
    expect(resolution.enabled).toBe(false);
    expect(resolution.baseUrl).toBe("");
    expect(resolution.reason).toBe("Functions base URL is invalid.");
  });
});

describe("isFunctionsUrlAllowedForBrowser", () => {
  it("allows localhost functions targets on local browser contexts", () => {
    expect(isFunctionsUrlAllowedForBrowser("http://127.0.0.1:5001", "localhost")).toBe(true);
    expect(isFunctionsUrlAllowedForBrowser("localhost:5001", "127.0.0.1")).toBe(true);
    expect(isFunctionsUrlAllowedForBrowser("http://[::1]:5001", "::1")).toBe(true);
  });

  it("blocks localhost functions targets for non-local browser contexts", () => {
    expect(isFunctionsUrlAllowedForBrowser("http://127.0.0.1:5001", "monsoonfire-portal.web.app")).toBe(false);
    expect(isFunctionsUrlAllowedForBrowser("localhost:5001", "monsoonfire-portal.web.app")).toBe(false);
    expect(isFunctionsUrlAllowedForBrowser("http://[::1]:5001", "monsoonfire-portal.web.app")).toBe(false);
  });

  it("allows remote functions targets regardless of browser context", () => {
    expect(isFunctionsUrlAllowedForBrowser("https://us-central1-monsoonfire-portal.cloudfunctions.net", "monsoonfire-portal.web.app")).toBe(true);
    expect(isFunctionsUrlAllowedForBrowser("https://us-central1-monsoonfire-portal.cloudfunctions.net", "localhost")).toBe(true);
  });

  it("fails closed for malformed URLs", () => {
    expect(isFunctionsUrlAllowedForBrowser("not a real url", "monsoonfire-portal.web.app")).toBe(false);
    expect(isFunctionsUrlAllowedForBrowser("", "monsoonfire-portal.web.app")).toBe(false);
  });
});

describe("functionsBaseUrlBlockReason", () => {
  it("returns not configured reason when empty", () => {
    expect(functionsBaseUrlBlockReason("")).toBe("Functions base URL is not configured.");
  });

  it("returns invalid reason for malformed URLs", () => {
    expect(functionsBaseUrlBlockReason("not a real url")).toBe("Functions base URL is invalid.");
  });

  it("returns empty reason when URL is allowed", () => {
    expect(functionsBaseUrlBlockReason("http://127.0.0.1:8787", "localhost")).toBe("");
    expect(functionsBaseUrlBlockReason("https://us-central1-monsoonfire-portal.cloudfunctions.net", "monsoonfire-portal.web.app")).toBe("");
  });

  it("returns disabled reason for localhost base URL on production host", () => {
    expect(functionsBaseUrlBlockReason("http://127.0.0.1:8787", "monsoonfire-portal.web.app")).toBe(
      "Blocked local Functions target (127.0.0.1:8787) on non-localhost deployment host (monsoonfire-portal.web.app)."
    );
    expect(functionsBaseUrlBlockReason("localhost:8787", "monsoonfire-portal.web.app")).toBe(
      "Blocked local Functions target (localhost:8787) on non-localhost deployment host (monsoonfire-portal.web.app)."
    );
  });
});
