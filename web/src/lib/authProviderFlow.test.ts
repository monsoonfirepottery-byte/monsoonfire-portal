import { describe, expect, it } from "vitest";
import { shouldFallbackToRedirect, shouldTryPopupFirst } from "./authProviderFlow";

describe("authProviderFlow", () => {
  it("prefers popup-first auth for Google", () => {
    expect(shouldTryPopupFirst("google")).toBe(true);
  });

  it("keeps non-Google providers on redirect-first flow", () => {
    expect(shouldTryPopupFirst("apple")).toBe(false);
    expect(shouldTryPopupFirst("facebook")).toBe(false);
    expect(shouldTryPopupFirst("microsoft")).toBe(false);
  });

  it("falls back to redirect for popup-blocked production errors", () => {
    expect(shouldFallbackToRedirect({ code: "auth/popup-blocked" })).toBe(true);
    expect(shouldFallbackToRedirect({ code: "auth/operation-not-supported-in-this-environment" })).toBe(true);
  });

  it("does not redirect-fallback on unrelated auth failures", () => {
    expect(shouldFallbackToRedirect({ code: "auth/popup-closed-by-user" })).toBe(false);
    expect(shouldFallbackToRedirect({ code: "auth/unauthorized-domain" })).toBe(false);
    expect(shouldFallbackToRedirect(new Error("boom"))).toBe(false);
  });
});
