import { describe, expect, it } from "vitest";
import {
  isStudioBrainUrlAllowedForBrowser,
  resolveStudioBrainBaseUrlResolution,
  resolveStudioBrainBaseUrlWithContext,
  studioBrainUrlBlockReason,
} from "./studioBrain";

describe("studioBrain URL resolution", () => {
  it("returns localhost fallback for localhost hosts when unset", () => {
    expect(resolveStudioBrainBaseUrlWithContext({ browserHostname: "localhost" })).toBe("http://127.0.0.1:8787");
    expect(resolveStudioBrainBaseUrlWithContext({ browserHostname: "127.0.0.1" })).toBe("http://127.0.0.1:8787");
    expect(resolveStudioBrainBaseUrlWithContext({ browserHostname: "::1" })).toBe("http://[::1]:8787");
  });

  it("defaults to empty on production-like hosts when unset", () => {
    expect(resolveStudioBrainBaseUrlWithContext({ browserHostname: "monsoonfire-portal.web.app" })).toBe("");
    expect(resolveStudioBrainBaseUrlWithContext({ browserHostname: "example.com" })).toBe("");
  });

  it("rejects configured localhost URL on non-localhost hosts", () => {
    expect(
      resolveStudioBrainBaseUrlWithContext({
        configuredBaseUrl: "http://127.0.0.1:8787",
        browserHostname: "monsoonfire-portal.web.app",
      })
    ).toBe("");
  });

  it("rejects configured localhost host without scheme on non-localhost hosts", () => {
    expect(
      resolveStudioBrainBaseUrlWithContext({
        configuredBaseUrl: "127.0.0.1:8787",
        browserHostname: "monsoonfire-portal.web.app",
      })
    ).toBe("");
  });

  it("rejects configured IPv6 localhost host on non-localhost hosts", () => {
    expect(
      resolveStudioBrainBaseUrlWithContext({
        configuredBaseUrl: "http://[::1]:8787",
        browserHostname: "monsoonfire-portal.web.app",
      })
    ).toBe("");
  });

  it("normalizes configured localhost host without scheme on localhost hosts", () => {
    expect(
      resolveStudioBrainBaseUrlWithContext({
        configuredBaseUrl: "127.0.0.1:8787",
        browserHostname: "localhost",
      })
    ).toBe("http://127.0.0.1:8787");
  });

  it("rejects configured localhost host without scheme for invalid values", () => {
    expect(
      resolveStudioBrainBaseUrlWithContext({
        configuredBaseUrl: "localhost:8787/path?x=1",
        browserHostname: "monsoonfire-portal.web.app",
      })
    ).toBe("");
  });

  it("fails closed for malformed configured URL on localhost hosts", () => {
    expect(
      resolveStudioBrainBaseUrlWithContext({
        configuredBaseUrl: "not a real url",
        browserHostname: "localhost",
      })
    ).toBe("");
  });

  it("fails closed for malformed configured URL on production hosts", () => {
    expect(
      resolveStudioBrainBaseUrlWithContext({
        configuredBaseUrl: "not a real url",
        browserHostname: "monsoonfire-portal.web.app",
      })
    ).toBe("");
  });

  it("keeps configured localhost URL on localhost hosts", () => {
    expect(
      resolveStudioBrainBaseUrlWithContext({
        configuredBaseUrl: "http://127.0.0.1:8787",
        browserHostname: "localhost",
      })
    ).toBe("http://127.0.0.1:8787");
  });

  it("keeps configured remote URL everywhere", () => {
    expect(
      resolveStudioBrainBaseUrlWithContext({
        configuredBaseUrl: "https://studio-brain.monsoonfire-portal.example",
        browserHostname: "monsoonfire-portal.web.app",
      })
    ).toBe("https://studio-brain.monsoonfire-portal.example");
  });

  it("rejects IPv6 localhost configured URL on production hosts", () => {
    expect(
      resolveStudioBrainBaseUrlWithContext({
        configuredBaseUrl: "http://[::1]:8787",
        browserHostname: "monsoonfire-portal.web.app",
      })
    ).toBe("");
  });

  it("keeps IPv6 localhost configured URL on loopback hosts", () => {
    expect(
      resolveStudioBrainBaseUrlWithContext({
        configuredBaseUrl: "http://[::1]:8787",
        browserHostname: "::1",
      })
    ).toBe("http://[::1]:8787");
  });

  it("treats localhost configured without scheme as valid on localhost and invalid on production", () => {
    expect(
      resolveStudioBrainBaseUrlWithContext({
        configuredBaseUrl: "localhost:8787",
        browserHostname: "localhost",
      })
    ).toBe("http://localhost:8787");

    expect(
      resolveStudioBrainBaseUrlWithContext({
        configuredBaseUrl: "localhost:8787",
        browserHostname: "monsoonfire-portal.web.app",
      })
    ).toBe("");
  });
});

describe("resolveStudioBrainBaseUrlResolution", () => {
  it("returns enabled local fallback with metadata for localhost-like hosts", () => {
    const resolution = resolveStudioBrainBaseUrlResolution({ browserHostname: "localhost" });
    expect(resolution.configured).toBe(false);
    expect(resolution.enabled).toBe(true);
    expect(resolution.baseUrl).toBe("http://127.0.0.1:8787");
    expect(resolution.reason).toBe("");
  });

  it("returns disabled state and a reason on production-like hosts when unset", () => {
    const resolution = resolveStudioBrainBaseUrlResolution({ browserHostname: "monsoonfire-portal.web.app" });
    expect(resolution.configured).toBe(false);
    expect(resolution.enabled).toBe(false);
    expect(resolution.baseUrl).toBe("");
    expect(resolution.reason).toBe("Studio Brain base URL is not configured.");
  });

  it("marks configured localhost URLs as disabled on non-localhost hosts", () => {
    const resolution = resolveStudioBrainBaseUrlResolution({
      configuredBaseUrl: "http://127.0.0.1:8787",
      browserHostname: "monsoonfire-portal.web.app",
    });
    expect(resolution.configured).toBe(true);
    expect(resolution.enabled).toBe(false);
    expect(resolution.baseUrl).toBe("");
    expect(resolution.reason).toMatch(/Blocked local Studio Brain target \(127\.0\.0\.1:8787\)/);
  });

  it("keeps configured remote URL enabled everywhere", () => {
    const resolution = resolveStudioBrainBaseUrlResolution({
      configuredBaseUrl: "https://studio-brain.monsoonfire-portal.example",
      browserHostname: "monsoonfire-portal.web.app",
    });
    expect(resolution.configured).toBe(true);
    expect(resolution.enabled).toBe(true);
    expect(resolution.baseUrl).toBe("https://studio-brain.monsoonfire-portal.example");
    expect(resolution.reason).toBe("");
  });

  it("returns disabled with parse failure reason for malformed configured URL", () => {
    const resolution = resolveStudioBrainBaseUrlResolution({
      configuredBaseUrl: "not a real url",
      browserHostname: "localhost",
    });
    expect(resolution.configured).toBe(true);
    expect(resolution.enabled).toBe(false);
    expect(resolution.baseUrl).toBe("");
    expect(resolution.reason).toBe("Studio Brain base URL is invalid.");
  });
});

describe("isStudioBrainUrlAllowedForBrowser", () => {
  it("allows localhost Studio Brain targets in localhost browser contexts", () => {
    expect(isStudioBrainUrlAllowedForBrowser("http://127.0.0.1:8787", "localhost")).toBe(true);
    expect(isStudioBrainUrlAllowedForBrowser("http://[::1]:8787", "::1")).toBe(true);
    expect(isStudioBrainUrlAllowedForBrowser("localhost:8787", "localhost")).toBe(true);
  });

  it("blocks localhost Studio Brain targets when browser is non-local", () => {
    expect(isStudioBrainUrlAllowedForBrowser("http://127.0.0.1:8787", "monsoonfire-portal.web.app")).toBe(false);
    expect(isStudioBrainUrlAllowedForBrowser("localhost:8787", "monsoonfire-portal.web.app")).toBe(false);
    expect(isStudioBrainUrlAllowedForBrowser("http://[::1]:8787", "monsoonfire-portal.web.app")).toBe(false);
  });

  it("allows remote Studio Brain targets regardless of browser host", () => {
    expect(isStudioBrainUrlAllowedForBrowser("https://studio-brain.monsoonfire-portal.example", "monsoonfire-portal.web.app")).toBe(true);
    expect(isStudioBrainUrlAllowedForBrowser("https://studio-brain.monsoonfire-portal.example", "localhost")).toBe(true);
  });

  it("fails closed for malformed URLs", () => {
    expect(isStudioBrainUrlAllowedForBrowser("not a real url", "monsoonfire-portal.web.app")).toBe(false);
    expect(isStudioBrainUrlAllowedForBrowser("", "monsoonfire-portal.web.app")).toBe(false);
  });
});

describe("studioBrainUrlBlockReason", () => {
  it("returns not configured reason when missing base URL", () => {
    expect(studioBrainUrlBlockReason("")).toBe("Studio Brain base URL is not configured.");
  });

  it("returns invalid reason for malformed URLs", () => {
    expect(studioBrainUrlBlockReason("not a real url")).toBe("Studio Brain base URL is invalid.");
    expect(studioBrainUrlBlockReason("localhost:8787/path?x=1", "monsoonfire-portal.web.app")).toBe(
      "Blocked local Studio Brain target (localhost:8787) on non-localhost deployment host (monsoonfire-portal.web.app)."
    );
  });

  it("returns disabled reason for localhost base URL on production host", () => {
    expect(studioBrainUrlBlockReason("http://127.0.0.1:8787", "monsoonfire-portal.web.app")).toBe(
      "Blocked local Studio Brain target (127.0.0.1:8787) on non-localhost deployment host (monsoonfire-portal.web.app)."
    );
    expect(studioBrainUrlBlockReason("localhost:8787", "monsoonfire-portal.web.app")).toBe(
      "Blocked local Studio Brain target (localhost:8787) on non-localhost deployment host (monsoonfire-portal.web.app)."
    );
  });

  it("returns empty reason when allowed", () => {
    expect(studioBrainUrlBlockReason("http://127.0.0.1:8787", "localhost")).toBe("");
    expect(studioBrainUrlBlockReason("https://studio-brain.monsoonfire-portal.example", "monsoonfire-portal.web.app")).toBe("");
  });
});
