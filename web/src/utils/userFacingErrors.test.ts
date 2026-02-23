import { describe, expect, it } from "vitest";
import {
  authErrorMessage,
  checkoutErrorMessage,
  requestErrorMessage,
} from "./userFacingErrors";

describe("userFacingErrors", () => {
  it("adds a support-code hint for auth-facing errors", () => {
    const message = authErrorMessage(new Error("Missing or insufficient permissions"));

    expect(message.toLowerCase()).toContain("session");
    expect(message).toContain("support");
    expect(message).toContain("code");
  });

  it("maps checkout auth failures to re-login guidance", () => {
    const message = checkoutErrorMessage(new Error("unauthenticated"));

    expect(message.toLowerCase()).toContain("sign in");
    expect(message).toContain("support");
  });

  it("maps network failures for function calls with retry-safe messaging", () => {
    const message = requestErrorMessage(new Error("Failed to fetch"));

    expect(message.toLowerCase()).toContain("try again");
    expect(message).toContain("support with this code");
  });
});
